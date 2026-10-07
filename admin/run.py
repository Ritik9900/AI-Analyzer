"""Start the Portfolio Analyzer admin console (local, developer-only).

    backend\\.venv\\Scripts\\python.exe admin\\run.py            (or double-click admin\\start-admin.cmd)

Opens your browser with a one-time sign-in link. Only this computer can reach the console.
"""

import argparse
import os
import secrets
import sys
import threading
import webbrowser
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    os.environ.setdefault("PA_ADMIN_TOKEN", secrets.token_urlsafe(32))
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import uvicorn

    from server import TOKEN, app

    url = f"http://127.0.0.1:{args.port}/auth?t={TOKEN}"
    print("\nPortfolio Analyzer - Admin console")
    print(f"Open: {url}\n(Keep this window open; press Ctrl+C to stop.)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
