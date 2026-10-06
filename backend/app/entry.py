"""Command-line entry point of the packaged backend (pa-backend.exe).

  pa-backend.exe --port 8123 --data-dir <dir>     run the signals service (used by the desktop app)
  pa-backend.exe --download-models [--pause]      download the local AI models
  pa-backend.exe --device-id                      print this device's ID
  pa-backend.exe --self-test                      check every bundled dependency imports and runs
"""

import argparse
import os
import sys
from pathlib import Path


def _pause(enabled: bool) -> None:
    if enabled:
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            pass


def _self_test(models_dir: Path) -> int:
    ok = True

    def check(label, fn):
        nonlocal ok
        try:
            detail = fn()
            print(f"[ok] {label}{f': {detail}' if detail else ''}")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"[FAIL] {label}: {type(exc).__name__}: {exc}")

    import numpy as np
    import pandas as pd

    check("fastapi / uvicorn", lambda: __import__("uvicorn").__version__)
    check("yfinance", lambda: __import__("yfinance").__version__)
    check("cryptography", lambda: __import__("cryptography").__version__)
    check("app.main", lambda: (__import__("app.main"), "imported")[1])

    def pipeline():
        from app.services import forecast, technicals

        idx = pd.bdate_range("2024-01-01", periods=300)
        close = 100 * np.exp(np.cumsum(np.random.default_rng(1).normal(0, 0.01, 300)))
        df = pd.DataFrame({"Open": close, "High": close * 1.01, "Low": close * 0.99, "Close": close}, index=idx)
        t = technicals.compute_technicals(df)
        f = forecast.forecast(df["Close"], 26, "daily")
        return f"rsi={t.rsi_14} forecast={f.model}"

    check("indicator + forecast pipeline", pipeline)

    def lic():
        from app.licensing.device import device_id
        from app.licensing.public_key import PUBLIC_KEY_B64

        if PUBLIC_KEY_B64.startswith("NOT_SET"):
            raise RuntimeError("licence public key not set (run licensing/make_keys.py)")
        return f"device {device_id()}"

    check("licensing", lic)

    for mod in ("torch", "transformers", "chronos"):
        check(f"optional ML: {mod}", lambda m=mod: getattr(__import__(m), "__version__", "imported"))
    from app.model_download import models_ready

    print(f"[..] local models downloaded: {models_ready(models_dir)}")
    print("\nSELF-TEST", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="pa-backend")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--data-dir")
    p.add_argument("--download-models", action="store_true")
    p.add_argument("--device-id", action="store_true")
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--pause", action="store_true", help="wait for Enter before exiting (for shortcuts)")
    args = p.parse_args(argv)

    from app.licensing.manager import default_data_dir

    data_dir = Path(args.data_dir) if args.data_dir else default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["PA_DATA_DIR"] = str(data_dir)
    models_dir = data_dir / "models"

    if args.download_models:
        from app.model_download import download_all

        rc = download_all(models_dir)
        _pause(args.pause)
        return rc

    if args.device_id:
        from app.licensing.device import device_id

        print(device_id())
        _pause(args.pause)
        return 0

    # Must be set before app.config is imported.
    from app.model_download import models_ready

    os.environ.setdefault("MODELS_DIR", str(models_dir))
    os.environ.setdefault("ENABLE_LOCAL_MODELS", "true" if models_ready(models_dir) else "false")

    if args.self_test:
        rc = _self_test(models_dir)
        _pause(args.pause)
        return rc

    import uvicorn

    from app.main import app

    # Explicit loop/protocol choices avoid uvicorn's dynamic "auto" imports in frozen builds.
    uvicorn.run(app, host=args.host, port=args.port, log_level="info", loop="asyncio", http="h11", ws="none", lifespan="off")
    return 0


if __name__ == "__main__":
    sys.exit(main())
