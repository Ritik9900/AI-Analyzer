"""Runs packaging/build.ps1 in the background, streams its log and records the result."""

import hashlib
import json
import os
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path

from db import Database, now_iso

ROOT = Path(__file__).resolve().parent.parent
DIST = Path(os.environ.get("PA_ADMIN_DIST", ROOT / "packaging" / "dist"))


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=10)
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
        return (out.stdout.strip() + ("-dirty" if dirty else "")) or None
    except Exception:  # noqa: BLE001
        return None


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


class BuildRunner:
    def __init__(self, db: Database, log_dir: Path):
        self.db = db
        self.log_dir = log_dir
        self.proc: subprocess.Popen | None = None
        self.current_id: int | None = None
        self._lock = threading.Lock()
        # Interrupted by an admin restart: never leave builds "running" forever.
        db.run("UPDATE builds SET status='failed', error='Admin console stopped during the build' WHERE status='running'")

    def command(self, version: str, hard_expiry: str | None, skip_backend: bool, reuse_native: bool, no_obfuscate: bool) -> list[str]:
        override = os.environ.get("PA_ADMIN_BUILD_CMD")  # tests / custom pipelines
        if override:
            return [t.strip("\"") for t in shlex.split(override.format(version=version), posix=False)]
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "packaging" / "build.ps1"), "-Version", version]
        if hard_expiry:
            cmd += ["-HardExpiry", hard_expiry]
        if skip_backend:
            cmd.append("-SkipBackend")
        if reuse_native:
            cmd.append("-ReuseNative")
        if no_obfuscate:
            cmd.append("-NoObfuscate")
        return cmd

    def start(self, version: str, hard_expiry: str | None, skip_backend: bool, reuse_native: bool, no_obfuscate: bool) -> int:
        with self._lock:
            if self.proc and self.proc.poll() is None:
                raise RuntimeError("A build is already running.")
            self.log_dir.mkdir(parents=True, exist_ok=True)
            log_file = self.log_dir / f"build-{version}-{time.strftime('%Y%m%d-%H%M%S')}.log"
            options = {"skip_backend": skip_backend, "reuse_native": reuse_native, "no_obfuscate": no_obfuscate}
            build_id = self.db.run(
                "INSERT INTO builds (version, hard_expiry, options, status, started_at, git_commit, log_file) VALUES (?, ?, ?, 'running', ?, ?, ?)",
                version, hard_expiry, json.dumps(options), now_iso(), _git_commit(), str(log_file),
            )
            fh = log_file.open("wb")
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            self.proc = subprocess.Popen(
                self.command(version, hard_expiry, skip_backend, reuse_native, no_obfuscate),
                cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags,
            )
            self.current_id = build_id
            threading.Thread(target=self._wait, args=(build_id, version, self.proc, fh, time.monotonic()), daemon=True).start()
            self.db.audit("build.start", f"#{build_id} v{version} {json.dumps(options)}")
            return build_id

    def _wait(self, build_id: int, version: str, proc: subprocess.Popen, fh, t0: float) -> None:
        code = proc.wait()
        fh.close()
        duration = int(time.monotonic() - t0)
        row = self.db.one("SELECT status FROM builds WHERE id=?", build_id)
        if row and row["status"] == "cancelled":
            status, error = "cancelled", "Cancelled by you"
        elif code == 0:
            status, error = "succeeded", None
        else:
            status, error = "failed", f"build.ps1 exited with code {code}"
        installer = DIST / f"PortfolioAnalyzer-Setup-{version}.exe"
        size = sha = path = None
        if status == "succeeded" and installer.exists():
            size, sha, path = installer.stat().st_size, _sha256(installer), str(installer)
        elif status == "succeeded":
            status, error = "failed", f"Build finished but {installer.name} was not found"
        self.db.run(
            "UPDATE builds SET status=?, finished_at=?, duration_s=?, installer_path=?, size_bytes=?, sha256=?, error=? WHERE id=?",
            status, now_iso(), duration, path, size, sha, error, build_id,
        )
        self.db.audit(f"build.{status}", f"#{build_id} v{version}")
        with self._lock:
            if self.current_id == build_id:
                self.proc, self.current_id = None, None

    def cancel(self) -> bool:
        with self._lock:
            if not (self.proc and self.proc.poll() is None):
                return False
            self.db.run("UPDATE builds SET status='cancelled' WHERE id=?", self.current_id)
            if sys.platform == "win32":  # kill the whole tree (PowerShell -> python/node children)
                subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            else:
                self.proc.terminate()
            return True

    def read_log(self, build_id: int, offset: int) -> dict:
        row = self.db.one("SELECT log_file, status FROM builds WHERE id=?", build_id)
        if not row:
            raise KeyError(build_id)
        path = Path(row["log_file"])
        text, new_offset = "", offset
        if path.exists():
            with path.open("rb") as fh:
                fh.seek(offset)
                data = fh.read(256 * 1024)
                new_offset = offset + len(data)
                text = data.decode("utf-8", errors="replace")
        return {"text": text, "offset": new_offset, "status": row["status"]}
