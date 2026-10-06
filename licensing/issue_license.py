"""Issue a licence key for one recipient's device.

    python licensing/issue_license.py --device ABCDE-FGHIJ-KLMNO-PQRST --days 30 --name "Ravi Kumar"

Options:
    --activate-within N   days the recipient has to activate the key (default 14). The licence then
                          runs for --days from activation, and never beyond (issue + N + days).
    --passphrase P        if the private key file is encrypted
    --verify-only KEY     decode and check an existing key instead of issuing one

Every issued key is appended to licensing/issued/licenses.csv (git-ignored) for your records.
"""

import argparse
import csv
import secrets
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from cryptography.hazmat.primitives import serialization  # noqa: E402

from app.licensing import keys  # noqa: E402
from app.licensing.device import normalize  # noqa: E402
from app.licensing.public_key import PUBLIC_KEY_B64  # noqa: E402

PRIVATE = ROOT / "licensing" / "keys" / "private_key.pem"
LEDGER = ROOT / "licensing" / "issued" / "licenses.csv"


def load_private_key(passphrase: str | None):
    if not PRIVATE.exists():
        sys.exit(f"No private key at {PRIVATE}. Run `python licensing/make_keys.py` first (once).")
    return serialization.load_pem_private_key(PRIVATE.read_bytes(), password=passphrase.encode() if passphrase else None)


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
    device = normalize(args.device)
    if len(device) != 23:
        sys.exit(f"Device ID '{args.device}' does not look right (expected XXXXX-XXXXX-XXXXX-XXXXX).")
    if not 1 <= args.days <= 3650:
        sys.exit("--days must be between 1 and 3650")

    issued = date.today()
    payload = {
        "v": 1,
        "product": keys.PRODUCT,
        "lid": secrets.token_hex(8),
        "name": args.name.strip()[:80],
        "device": device,
        "days": args.days,
        "issued": issued.isoformat(),
        "activate_by": (issued + timedelta(days=args.activate_within)).isoformat(),
    }
    key = keys.sign_key(payload, load_private_key(args.passphrase))
    keys.verify_key(key, PUBLIC_KEY_B64)  # sanity check: the build's public key accepts it

    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    new = not LEDGER.exists()
    with LEDGER.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["issued", "licence_id", "name", "device", "days", "activate_by", "key"])
        w.writerow([payload["issued"], payload["lid"], payload["name"], device, args.days, payload["activate_by"], key])

    print(f"\nLicence for {payload['name']} | device {device} | {args.days} days from activation | activate by {payload['activate_by']}\n")
    print(key)
    print(f"\nRecorded in {LEDGER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
