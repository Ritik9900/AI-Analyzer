"""Private-key handling for the admin console.

The private key is unlocked with its passphrase once per admin session and kept in memory only.
The passphrase is never stored.
"""

import re
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from app.licensing import keys  # noqa: E402
from licensing import issue_license as il  # noqa: E402
from licensing import make_keys as mk  # noqa: E402


def build_public_key() -> str | None:
    """Public key currently compiled into builds (read from disk each time; it can change at runtime)."""
    text = mk.PUBLIC_PY.read_text(encoding="utf-8") if mk.PUBLIC_PY.exists() else ""
    m = re.search(r'PUBLIC_KEY_B64\s*=\s*"([^"]+)"', text)
    return None if not m or m.group(1).startswith("NOT_SET") else m.group(1)


class Signer:
    def __init__(self):
        self._key = None
        self._lock = threading.Lock()

    def status(self) -> dict:
        exists = il.PRIVATE.exists()
        build_pub = build_public_key()
        derived = il.public_key_b64(self._key) if self._key else None
        return {
            "private_key_path": str(il.PRIVATE),
            "private_key_exists": exists,
            "encrypted": il.private_key_encrypted() if exists else False,
            "unlocked": self._key is not None,
            "build_public_key_set": build_pub is not None,
            "public_key_fingerprint": (build_pub or "")[:12] or None,
            # None until unlocked (we can only compare once the private key is loaded)
            "matches_build": None if derived is None else derived == build_pub,
        }

    def unlock(self, passphrase: str | None) -> dict:
        key = il.load_private_key(passphrase or None)
        with self._lock:
            self._key = key
        return self.status()

    def lock(self) -> dict:
        with self._lock:
            self._key = None
        return self.status()

    def generate(self, passphrase: str | None) -> dict:
        mk.generate(passphrase or None, force=False)
        return self.unlock(passphrase)

    def issue(self, device: str, days: int, name: str, activate_within: int) -> tuple[dict, str]:
        with self._lock:
            if self._key is None:
                raise il.IssueError("Unlock the signing key first (Keys panel).")
            if il.public_key_b64(self._key) != build_public_key():
                raise il.IssueError(
                    "This private key does not match backend/app/licensing/public_key.py, so builds would reject its keys."
                )
            payload = il.build_payload(device, days, name, activate_within)
            return payload, il.sign(payload, self._key)

    def verify(self, key: str) -> dict:
        pub = build_public_key()
        if not pub:
            raise il.IssueError("No public key set yet: generate the key pair first.")
        return keys.verify_key(key, pub)
