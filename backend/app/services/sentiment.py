"""FinBERT headline sentiment, with a clearly-flagged keyword-heuristic mock.

Loaded lazily, once, from a local directory only; any failure degrades to the mock.
"""

import logging
import re
import threading

from app.config import settings
from app.schemas import Headline, Sentiment

logger = logging.getLogger(__name__)

POSITIVE_THRESHOLD = 0.15

_classifier = None
_load_error: str | None = None
_lock = threading.Lock()


def _load_classifier():
    global _classifier, _load_error
    if not settings.enable_local_models:
        return None
    if _classifier is not None or _load_error is not None:
        return _classifier
    with _lock:
        if _classifier is None and _load_error is None:
            try:
                if not settings.finbert_path.exists():
                    raise FileNotFoundError(f"{settings.finbert_path} not found (see README step 4)")
                import torch
                from transformers import pipeline

                torch.set_num_threads(settings.torch_num_threads)
                path = str(settings.finbert_path)
                _classifier = pipeline("text-classification", model=path, tokenizer=path, top_k=None, device=-1)
                logger.info("FinBERT loaded from %s", path)
            except Exception as exc:  # noqa: BLE001
                _load_error = f"{type(exc).__name__}: {exc}"
                logger.warning("FinBERT unavailable, using mock sentiment: %s", _load_error)
    return _classifier


def status() -> dict:
    return {"loaded": _classifier is not None, "error": _load_error}


def _label(score: float) -> str:
    if score > POSITIVE_THRESHOLD:
        return "positive"
    if score < -POSITIVE_THRESHOLD:
        return "negative"
    return "neutral"


def _finbert_scores(classifier, titles: list[str]) -> list[float]:
    outputs = classifier(titles, truncation=True, max_length=128)
    scores = []
    for result in outputs:
        probs = {d["label"].lower(): float(d["score"]) for d in result}
        scores.append(probs.get("positive", 0.0) - probs.get("negative", 0.0))
    return scores


_POS = re.compile(
    r"\b(beat|beats|surge|surges|soar|soars|jump|jumps|rally|rallies|upgrade|upgraded|record|growth|"
    r"gain|gains|strong|outperform|raises|raised|bullish|profit|expands|wins|tops)\b",
    re.I,
)
_NEG = re.compile(
    r"\b(miss|misses|fall|falls|drop|drops|plunge|plunges|slump|downgrade|downgraded|lawsuit|probe|cut|"
    r"cuts|weak|decline|declines|loss|losses|bearish|recall|layoffs|warns|slashes|sinks)\b",
    re.I,
)


def _mock_scores(titles: list[str]) -> list[float]:
    scores = []
    for title in titles:
        pos, neg = len(_POS.findall(title)), len(_NEG.findall(title))
        scores.append(0.0 if pos + neg == 0 else round((pos - neg) / (pos + neg) * 0.6, 3))
    return scores


def analyze(headlines: list[dict]) -> Sentiment:
    titles = [h["title"] for h in headlines]
    classifier = _load_classifier()
    note = None
    model, is_mock = "ProsusAI/finbert", False

    if not titles:
        scores = []
        model, is_mock = ("ProsusAI/finbert", False) if classifier else ("mock-keyword", True)
        note = "No recent headlines found."
    elif classifier is not None:
        try:
            scores = _finbert_scores(classifier, titles)
        except Exception as exc:  # noqa: BLE001
            logger.exception("FinBERT inference failed; using mock")
            scores, model, is_mock = _mock_scores(titles), "mock-keyword", True
            note = f"FinBERT inference failed ({type(exc).__name__}); keyword heuristic shown."
    else:
        scores, model, is_mock = _mock_scores(titles), "mock-keyword", True
        note = (
            "Local models disabled (ENABLE_LOCAL_MODELS=false); keyword heuristic shown."
            if not settings.enable_local_models
            else f"FinBERT not loaded ({(_load_error or '').split(':', 1)[0]}); keyword heuristic shown. See /health."
        )

    items = [Headline(**h, label=_label(s), score=round(s, 3)) for h, s in zip(headlines, scores)]
    aggregate = round(sum(scores) / len(scores), 3) if scores else 0.0
    return Sentiment(model=model, is_mock=is_mock, score=aggregate, label=_label(aggregate), headlines=items, note=note)
