import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Hard guarantee: Hugging Face libraries never reach the network from this service.
# Must be set before huggingface_hub / transformers are imported anywhere.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    enable_local_models: bool = False
    models_dir: Path = Path("models")
    chronos_model_subdir: str = "chronos-bolt-small"
    finbert_model_subdir: str = "finbert"

    # Long-term investing defaults: 5y of daily data, forecast on weekly closes ~6 months out.
    lookback_period: str = "5y"  # env LOOKBACK_PERIOD (old HISTORY_PERIOD=6mo is intentionally ignored)
    forecast_horizon_weeks: int = 26
    timing_window_days: int = 126  # ~6 months of daily bars for short-term entry-timing indicators
    torch_num_threads: int = 4
    max_headlines: int = 10
    quote_cache_seconds: int = 30

    @property
    def resolved_models_dir(self) -> Path:
        return self.models_dir if self.models_dir.is_absolute() else BACKEND_DIR / self.models_dir

    @property
    def chronos_path(self) -> Path:
        return self.resolved_models_dir / self.chronos_model_subdir

    @property
    def finbert_path(self) -> Path:
        return self.resolved_models_dir / self.finbert_model_subdir


settings = Settings()
