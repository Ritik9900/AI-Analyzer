"""Issue a licence key for one recipient's device.

    python licensing/issue_license.py --device ABCDE-FGHIJ-KLMNO-PQRST --days 30 --name "Ravi Kumar"

Options:
    --activate-within N   days the recipient has to activate the key (default 14). The licence then
                          runs for --days from activation, and never beyond (issue + N + days).
    --passphrase P        if the private key file is encrypted
    --verify-only KEY     decode and check an existing key instead of issuing one

Every issued key is appended to licensing/issued/licenses.csv (git-ignored) for your records.
The admin console (admin/) uses the same functions and also keeps a full database.
"""

import argparse
import csv
import os
import secrets
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.licensing import keys  # noqa: E402
from app.licensing.device import normalize  # noqa: E402
from app.licensing.public_key import PUBLIC_KEY_B64  # noqa: E402

PRIVATE = Path(os.environ.get("PA_PRIVATE_KEY", ROOT / "licensing" / "keys" / "private_key.pem"))
LEDGER = Path(os.environ.get("PA_LICENSE_LEDGER", ROOT / "licensing" / "issued" / "licenses.csv"))
DEVICE_ID_LEN = 23  # XXXXX-XXXXX-XXXXX-XXXXX


class IssueError(ValueError):
    pass


def private_key_encrypted(path: Path = PRIVATE) -> bool:
    return path.exists() and b"ENCRYPTED" in path.read_bytes()


def load_private_key(passphrase: str | None, path: Path = PRIVATE):
    from cryptography.hazmat.primitives import serialization

    if not path.exists():
        raise IssueError(f"No private key at {path}. Run `python licensing/make_keys.py` first (once).")
    try:
        return serialization.load_pem_private_key(path.read_bytes(), password=passphrase.encode() if passphrase else None)
    except (TypeError, ValueError) as exc:
        raise IssueError("Wrong passphrase for the private key (or the key file is damaged).") from exc


def public_key_b64(private_key) -> str:
    import base64

    from cryptography.hazmat.primitives import serialization

    raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def build_payload(device: str, days: int, name: str, activate_within: int = 14, issued: date | None = None) -> dict:
    device = normalize(device)
    if len(device) != DEVICE_ID_LEN:
        raise IssueError(f"Device ID '{device}' does not look right (expected XXXXX-XXXXX-XXXXX-XXXXX).")
    if not 1 <= int(days) <= 3650:
        raise IssueError("Days must be between 1 and 3650.")
    if not 1 <= int(activate_within) <= 365:
        raise IssueError("Activate-within must be between 1 and 365 days.")
    if not name.strip():
        raise IssueError("A licensee name is required.")
    issued = issued or date.today()
    return {
        "v": 1,
        "product": keys.PRODUCT,
        "lid": secrets.token_hex(8),
        "name": name.strip()[:80],
        "device": device,
        "days": int(days),
        "issued": issued.isoformat(),
        "activate_by": (issued + timedelta(days=int(activate_within))).isoformat(),
    }


def sign(payload: dict, private_key) -> str:
    key = keys.sign_key(payload, private_key)
    keys.verify_key(key, public_key_b64(private_key))  # sanity check
    return key


def append_ledger(payload: dict, key: str, path: Path = LEDGER) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["issued", "licence_id", "name", "device", "days", "activate_by", "key"])
        w.writerow([payload["issued"], payload["lid"], payload["name"], payload["device"], payload["days"], payload["activate_by"], key])


def main() -> int:
    ap = argparse.ArgumentParser(description="Issue a device-locked licence key")
    ap.add_argument("--device", help="Device ID shown in the recipient's app")
    ap.add_argument("--days", type=int, help="validity in days, counted from activation")
    ap.add_argument("--name", help="licensee name shown in the app")
    ap.add_argument("--activate-within", type=int, default=14)
    ap.add_argument("--passphrase")
    ap.add_argument("--verify-only", metavar="KEY")
    args = ap.parse_args()

    if PUBLIC_KEY_B64.startswith("NOT_SET"):
        sys.exit("The public key in backend/app/licensing/public_key.py is not set. Run make_keys.py first.")

    if args.verify_only:
        try:
            payload = keys.verify_key(args.verify_only, PUBLIC_KEY_B64)
        except keys.LicenseKeyError as exc:
            sys.exit(f"INVALID: {exc}")
        print("VALID key:", payload)
        return 0

    if not (args.device and args.days and args.name):
        ap.error("--device, --days and --name are required")
    try:
        private_key = load_private_key(args.passphrase)
        if public_key_b64(private_key) != PUBLIC_KEY_B64:
            sys.exit("Your private key does not match backend/app/licensing/public_key.py; builds would reject this key.")
        payload = build_payload(args.device, args.days, args.name, args.activate_within)
        key = sign(payload, private_key)
    except IssueError as exc:
        sys.exit(str(exc))
    append_ledger(payload, key)

    print(f"\nLicence for {payload['name']} | device {payload['device']} | {payload['days']} days from activation | activate by {payload['activate_by']}\n")
    print(key)
    print(f"\nRecorded in {LEDGER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
