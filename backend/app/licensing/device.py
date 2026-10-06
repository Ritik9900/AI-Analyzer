"""Stable, privacy-preserving device identifier.

Windows: SHA-256 of the per-installation MachineGuid plus BIOS/board model strings, shown as
XXXXX-XXXXX-XXXXX-XXXXX. Nothing personal (user name, serials, MAC) leaves the machine, and the ID
changes only if Windows is reinstalled or the motherboard is replaced.
"""

import base64
import hashlib
import platform
import subprocess
import sys
from functools import lru_cache
from pathlib import Path


class DeviceIdError(RuntimeError):
    pass


def _windows_parts() -> list[str]:
    import winreg

    parts: list[str] = []
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY
        ) as k:
            parts.append(str(winreg.QueryValueEx(k, "MachineGuid")[0]).strip().lower())
    except OSError as exc:
        raise DeviceIdError(f"Cannot read MachineGuid: {exc}") from exc
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\BIOS") as k:
            for name in ("SystemManufacturer", "SystemProductName", "BaseBoardManufacturer", "BaseBoardProduct"):
                try:
                    parts.append(str(winreg.QueryValueEx(k, name)[0]).strip().lower())
                except OSError:
                    parts.append("")
    except OSError:
        parts += ["", "", "", ""]
    return parts


def _other_parts() -> list[str]:
    # Development fallback for macOS / Linux. The packaged app targets Windows.
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        if Path(p).exists():
            return [Path(p).read_text().strip()]
    if sys.platform == "darwin":
        out = subprocess.run(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], capture_output=True, text=True, check=False).stdout
        for line in out.splitlines():
            if "IOPlatformUUID" in line:
                return [line.split("=")[-1].strip().strip('"')]
    raise DeviceIdError(f"No stable machine identifier on {platform.system()}")


@lru_cache(maxsize=1)
def device_id() -> str:
    parts = _windows_parts() if sys.platform == "win32" else _other_parts()
    digest = hashlib.sha256(("PA-DEVICE-v1|" + "|".join(parts)).encode("utf-8")).digest()
    code = base64.b32encode(digest).decode("ascii")[:20]
    return "-".join(code[i : i + 5] for i in range(0, 20, 5))


def normalize(device: str) -> str:
    """Accept IDs typed with spaces, lower case or without dashes."""
    raw = "".join(ch for ch in device.upper() if ch.isalnum())
    return "-".join(raw[i : i + 5] for i in range(0, len(raw), 5))
