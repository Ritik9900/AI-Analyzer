"""ONE-TIME: create the Ed25519 signing key pair for licence keys.

    python licensing/make_keys.py

- Private key -> licensing/keys/private_key.pem  (git-ignored; NEVER share or commit; back it up offline)
- Public key  -> backend/app/licensing/public_key.py  (compiled into every build)

If you lose the private key you cannot issue keys for builds that contain the matching public key.
Re-running refuses to overwrite an existing key unless you pass --force (which invalidates every
licence issued so far once you ship a new build).
"""

import argparse
import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "licensing" / "keys" / "private_key.pem"
PUBLIC_PY = ROOT / "backend" / "app" / "licensing" / "public_key.py"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="replace an existing key pair")
    ap.add_argument("--passphrase", help="encrypt the private key file with this passphrase (recommended)")
    args = ap.parse_args()

    if PRIVATE.exists() and not args.force:
        print(f"A private key already exists at {PRIVATE}. Use --force only if you really want a new key pair.")
        return 1

    key = Ed25519PrivateKey.generate()
    encryption = (
        serialization.BestAvailableEncryption(args.passphrase.encode()) if args.passphrase else serialization.NoEncryption()
    )
    PRIVATE.parent.mkdir(parents=True, exist_ok=True)
    PRIVATE.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption))

    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pub_b64 = base64.urlsafe_b64encode(pub).decode().rstrip("=")
    PUBLIC_PY.write_text(
        "# Ed25519 public key that verifies licence keys. Written by `python licensing/make_keys.py`.\n"
        "# The matching PRIVATE key stays on the developer's machine only (licensing/keys/, git-ignored).\n"
        f'PUBLIC_KEY_B64 = "{pub_b64}"\n',
        encoding="utf-8",
    )
    print(f"Private key: {PRIVATE}  <- back this up somewhere safe and offline")
    print(f"Public key written to {PUBLIC_PY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
