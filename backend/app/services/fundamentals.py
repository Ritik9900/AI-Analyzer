"""Valuation, quality and analyst data from Yahoo, plus a Piotroski F-Score from annual statements.

Yahoo coverage varies (Indian banks, for example, have no current ratio or gross profit), so every
field is optional and the F-Score is reported as `score / tests-with-data`.
"""

import logging
import math

import pandas as pd

from app.schemas import Fundamentals, PiotroskiTest

logger = logging.getLogger(__name__)


def _num(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _pct(value, digits: int = 2) -> float | None:
    """Yahoo ratio (0.16) -> percent (16.0)."""
    f = _num(value)
    return None if f is None else round(f * 100, digits)


def _row(df: pd.DataFrame, *names: str) -> pd.Series | None:
    for name in names:
        if name in df.index:
            return df.loc[name]
    return None


def _at(series: pd.Series | None, i: int) -> float | None:
    if series is None or len(series) <= i:
        return None
    return _num(series.iloc[i])


def _ratio(a: float | None, b: float | None) -> float | None:
    return None if a is None or b in (None, 0) else a / b


def _cmp(cur: float | None, prev: float | None, better: str) -> bool | None:
    if cur is None or prev is None:
        return None
    return cur > prev if better == "higher" else cur < prev


def piotroski(income: pd.DataFrame, balance: pd.DataFrame, cashflow: pd.DataFrame) -> tuple[list[PiotroskiTest], str | None]:
    """The nine Piotroski (2000) tests comparing the latest fiscal year (t) with the prior one (p)."""
    if income.empty or balance.empty or cashflow.empty:
        return [], None

    ni = _row(income, "Net Income", "Net Income Common Stockholders")
    rev = _row(income, "Total Revenue", "Operating Revenue")
    gp = _row(income, "Gross Profit")
    ta = _row(balance, "Total Assets")
    ltd = _row(balance, "Long Term Debt")
    ca = _row(balance, "Current Assets")
    cl = _row(balance, "Current Liabilities")
    shares = _row(balance, "Ordinary Shares Number", "Share Issued")
    cfo = _row(cashflow, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")

    roa_t, roa_p = _ratio(_at(ni, 0), _at(ta, 0)), _ratio(_at(ni, 1), _at(ta, 1))
    lev_t = _ratio(_at(ltd, 0) or 0.0, _at(ta, 0)) if ltd is not None else None
    lev_p = _ratio(_at(ltd, 1) or 0.0, _at(ta, 1)) if ltd is not None else None
    cr_t, cr_p = _ratio(_at(ca, 0), _at(cl, 0)), _ratio(_at(ca, 1), _at(cl, 1))
    gm_t, gm_p = _ratio(_at(gp, 0), _at(rev, 0)), _ratio(_at(gp, 1), _at(rev, 1))
    at_t, at_p = _ratio(_at(rev, 0), _at(ta, 0)), _ratio(_at(rev, 1), _at(ta, 1))
    cfo_t, ni_t = _at(cfo, 0), _at(ni, 0)
    sh_t, sh_p = _at(shares, 0), _at(shares, 1)

    tests = [
        PiotroskiTest(name="Positive return on assets", passed=None if roa_t is None else roa_t > 0),
        PiotroskiTest(name="Positive operating cash flow", passed=None if cfo_t is None else cfo_t > 0),
        PiotroskiTest(name="Return on assets improved", passed=_cmp(roa_t, roa_p, "higher")),
        PiotroskiTest(name="Cash flow exceeds net income (earnings quality)", passed=None if cfo_t is None or ni_t is None else cfo_t > ni_t),
        PiotroskiTest(name="Long-term debt / assets fell", passed=None if lev_t is None or lev_p is None else lev_t <= lev_p),
        PiotroskiTest(name="Current ratio improved", passed=_cmp(cr_t, cr_p, "higher")),
        PiotroskiTest(name="No new shares issued", passed=None if sh_t is None or sh_p is None else sh_t <= sh_p * 1.005),
        PiotroskiTest(name="Gross margin improved", passed=_cmp(gm_t, gm_p, "higher")),
        PiotroskiTest(name="Asset turnover improved", passed=_cmp(at_t, at_p, "higher")),
    ]
    fiscal_year = str(income.columns[0])[:10] if len(income.columns) else None
    return tests, fiscal_year


def compute_fundamentals(info: dict, statements: tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame], last_price: float) -> Fundamentals:
    if not info and all(df.empty for df in statements):
        return Fundamentals(available=False, note="Fundamental data unavailable from Yahoo for this symbol.")

    is_financial = (info.get("sector") or "").lower().startswith("financial")
    target = _num(info.get("targetMeanPrice"))
    dte = _num(info.get("debtToEquity"))
    gross = _num(info.get("grossMargins"))

    try:
        tests, fiscal_year = piotroski(*statements)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Piotroski failed: %s", exc)
        tests, fiscal_year = [], None
    usable = [t for t in tests if t.passed is not None]

    notes = []
    if is_financial:
        notes.append("Financial company: debt, current-ratio and gross-margin metrics are not meaningful.")
    if tests and len(usable) < 9:
        notes.append(f"F-Score computed on {len(usable)} of 9 tests (missing statement lines).")

    return Fundamentals(
        available=True,
        sector=info.get("sector"),
        industry=info.get("industry"),
        market_cap=_num(info.get("marketCap")),
        pe_trailing=_num(info.get("trailingPE")),
        pe_forward=_num(info.get("forwardPE")),
        price_to_book=_num(info.get("priceToBook")),
        peg=_num(info.get("trailingPegRatio")) or _num(info.get("pegRatio")),
        roe_pct=_pct(info.get("returnOnEquity")),
        roa_pct=_pct(info.get("returnOnAssets")),
        debt_to_equity=None if dte is None or is_financial else round(dte / 100, 2),  # Yahoo reports D/E x100
        current_ratio=_num(info.get("currentRatio")),
        gross_margin_pct=None if gross in (None, 0.0) else _pct(gross),
        operating_margin_pct=_pct(info.get("operatingMargins")),
        profit_margin_pct=_pct(info.get("profitMargins")),
        revenue_growth_pct=_pct(info.get("revenueGrowth")),
        earnings_growth_pct=_pct(info.get("earningsGrowth")),
        dividend_yield_pct=_num(info.get("dividendYield")),  # Yahoo already reports this in percent
        payout_ratio_pct=_pct(info.get("payoutRatio")),
        free_cash_flow=_num(info.get("freeCashflow")),
        analyst_target_mean=target,
        analyst_target_low=_num(info.get("targetLowPrice")),
        analyst_target_high=_num(info.get("targetHighPrice")),
        analyst_upside_pct=round((target / last_price - 1) * 100, 2) if target and last_price else None,
        analyst_rating=info.get("recommendationKey"),
        analyst_count=int(info["numberOfAnalystOpinions"]) if _num(info.get("numberOfAnalystOpinions")) else None,
        piotroski_score=sum(1 for t in usable if t.passed) if usable else None,
        piotroski_max=len(usable) if usable else None,
        piotroski_tests=tests,
        fiscal_year=fiscal_year,
        note=" ".join(notes) or None,
    )
