"""PyInstaller entry point. All application logic lives in the Nuitka-compiled app.pyd."""

import multiprocessing
import sys

import bundle_imports  # noqa: F401  - makes PyInstaller bundle every third-party module app.pyd uses

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from app.entry import main

    sys.exit(main())
