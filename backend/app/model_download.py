"""Download the local Hugging Face models (run by the installer, or from the Start menu shortcut).

This is the ONLY code path that downloads model weights. The running service always loads models
offline from the data folder.
"""

import os
import time
from pathlib import Path

MODELS = [
    # (repo, folder, allow_patterns) — FinBERT: skip the TensorFlow/Flax copies of the weights
    ("amazon/chronos-bolt-small", "chronos-bolt-small", None),
    ("ProsusAI/finbert", "finbert", ["*.json", "*.txt", "*.bin", "*.safetensors"]),
]
DONE_MARKER = ".download-complete"


def models_ready(models_dir: Path) -> bool:
    return all((models_dir / folder / DONE_MARKER).exists() for _, folder, _ in MODELS)


def download_all(models_dir: Path, retries: int = 3) -> int:
    # Must happen before huggingface_hub is imported (app.config forces offline mode otherwise).
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    try:
        import truststore  # use the Windows certificate store (works behind corporate TLS inspection)

        truststore.inject_into_ssl()
    except Exception:  # noqa: BLE001
        pass
    from huggingface_hub import snapshot_download

    print("Portfolio Analyzer - downloading local AI models (about 650 MB).")
    print(f"Destination: {models_dir}\n")
    failed = []
    for repo, folder, patterns in MODELS:
        target = models_dir / folder
        if (target / DONE_MARKER).exists():
            print(f"[ok] {repo} already downloaded")
            continue
        for attempt in range(1, retries + 1):
            try:
                print(f"[..] {repo} (attempt {attempt}/{retries})")
                snapshot_download(repo_id=repo, local_dir=str(target), allow_patterns=patterns)
                (target / DONE_MARKER).write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
                print(f"[ok] {repo}")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[!!] {repo}: {exc}")
                if attempt < retries:
                    time.sleep(5 * attempt)
        else:
            failed.append(repo)

    if failed:
        print("\nSome models could not be downloaded:", ", ".join(failed))
        print("The app still works, using built-in statistical estimates instead of these models.")
        print("Retry later from Start menu > 'Portfolio Analyzer - Download AI models'.")
        return 1
    print("\nAll models downloaded.")
    return 0
