#!/usr/bin/env python3
"""Rank stocks with a multi-factor scoring model.

The model combines multiple factors:
1. Income (dividend/earnings related)
2. Risk (volatility/leverage related; lower is better)
3. Momentum (recent and long-term returns)
4. Value (valuation-oriented metrics)
5. Quality (profitability and growth quality)

Input data is provided as CSV with one stock per row.
"""

from __future__ import annotations

import argparse
import csv
import io
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple


MetricDef = Tuple[str, float, bool]  # (metric_name, metric_weight, higher_is_better)
StockRow = Dict[str, Any]
ScoreRow = Dict[str, Any]

TEXT_COLUMNS = {"ticker", "name", "sector", "date"}

FACTOR_DEFINITIONS: Dict[str, Sequence[MetricDef]] = {
    "income": (
        ("dividend_yield", 0.65, True),
        ("eps_growth_1y", 0.35, True),
    ),
    "risk": (
        ("beta", 0.35, False),
        ("volatility_30d", 0.40, False),
        ("debt_to_equity", 0.25, False),
    ),
    "momentum": (
        ("return_1m", 0.20, True),
        ("return_6m", 0.35, True),
        ("return_12m", 0.45, True),
    ),
    "value": (
        ("earnings_yield", 0.60, True),
        ("fcf_yield", 0.25, True),
        ("price_to_book", 0.15, False),
    ),
    "quality": (
        ("roe", 0.40, True),
        ("profit_margin", 0.30, True),
        ("net_income_growth_1y", 0.30, True),
    ),
}

DEFAULT_FACTOR_WEIGHTS: Dict[str, float] = {
    "income": 0.30,
    "risk": 0.30,
    "momentum": 0.30,
    "value": 0.05,
    "quality": 0.05,
}


def parse_numeric(value: str) -> Optional[float]:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None

    is_percent = raw.endswith("%")
    if is_percent:
        raw = raw[:-1]

    raw = raw.replace(",", "")
    try:
        number = float(raw)
    except ValueError:
        return None

    if is_percent:
        return number / 100.0
    return number


def normalize_return(value: Optional[float], return_scale: str) -> Optional[float]:
    if value is None:
        return None
    if return_scale == "decimal":
        return value
    if return_scale == "percent":
        return value / 100.0
    # auto mode:
    # most decimal returns should sit roughly in [-1.0, +1.0]
    # values with larger magnitude are likely percentages.
    if abs(value) > 2.0:
        return value / 100.0
    return value


def normalize_series(values: Sequence[Optional[float]], higher_is_better: bool) -> List[Optional[float]]:
    valid_values = [v for v in values if v is not None]
    if not valid_values:
        return [None for _ in values]

    lo = min(valid_values)
    hi = max(valid_values)
    if hi == lo:
        return [0.5 if v is not None else None for v in values]

    scores: List[Optional[float]] = []
    for value in values:
        if value is None:
            scores.append(None)
            continue
        scaled = (value - lo) / (hi - lo)
        scores.append(scaled if higher_is_better else 1.0 - scaled)
    return scores


def derive_metrics(stock: StockRow) -> None:
    price = stock.get("price")
    annual_dividend = stock.get("annual_dividend")
    pe_ratio = stock.get("pe_ratio")

    if stock.get("dividend_yield") is None and price and annual_dividend is not None and price > 0:
        stock["dividend_yield"] = annual_dividend / price

    if stock.get("earnings_yield") is None and pe_ratio is not None and pe_ratio > 0:
        stock["earnings_yield"] = 1.0 / pe_ratio

    lookback_pairs = (
        ("return_1m", "price_1m_ago"),
        ("return_6m", "price_6m_ago"),
        ("return_12m", "price_12m_ago"),
    )
    for return_field, lookback_field in lookback_pairs:
        if stock.get(return_field) is None:
            lookback_price = stock.get(lookback_field)
            if price and lookback_price and lookback_price > 0:
                stock[return_field] = (price / lookback_price) - 1.0


def _load_stocks_from_reader(reader: csv.DictReader, return_scale: str) -> List[StockRow]:
    stocks: List[StockRow] = []
    if not reader.fieldnames or "ticker" not in reader.fieldnames:
        raise ValueError("CSV must include a 'ticker' column.")

    for row in reader:
        stock: StockRow = {}
        for key, raw_value in row.items():
            if key is None:
                continue
            key = key.strip()
            if key in TEXT_COLUMNS:
                stock[key] = (raw_value or "").strip()
            else:
                stock[key] = parse_numeric(raw_value or "")

        derive_metrics(stock)

        for return_key in ("return_1m", "return_6m", "return_12m"):
            stock[return_key] = normalize_return(stock.get(return_key), return_scale)

        ticker = stock.get("ticker")
        if isinstance(ticker, str) and ticker:
            stocks.append(stock)

    if not stocks:
        raise ValueError("No valid stock rows found in CSV.")
    return stocks


def load_stocks(csv_path: Path, return_scale: str) -> List[StockRow]:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return _load_stocks_from_reader(reader, return_scale)


def load_stocks_from_text(csv_text: str, return_scale: str) -> List[StockRow]:
    reader = csv.DictReader(io.StringIO(csv_text))
    return _load_stocks_from_reader(reader, return_scale)


def parse_factor_weights(weights_arg: str) -> Dict[str, float]:
    weights = dict(DEFAULT_FACTOR_WEIGHTS)
    if not weights_arg:
        return weights

    for assignment in weights_arg.split(","):
        part = assignment.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"Invalid weight assignment '{part}'. Use factor=value.")
        factor, raw_weight = part.split("=", 1)
        factor = factor.strip().lower()
        if factor not in FACTOR_DEFINITIONS:
            valid = ", ".join(sorted(FACTOR_DEFINITIONS))
            raise ValueError(f"Unknown factor '{factor}'. Valid factors: {valid}")
        try:
            value = float(raw_weight.strip())
        except ValueError as exc:
            raise ValueError(f"Weight for '{factor}' is not a number.") from exc
        if value < 0:
            raise ValueError(f"Weight for '{factor}' must be non-negative.")
        weights[factor] = value

    if sum(weights.values()) <= 0:
        raise ValueError("At least one factor weight must be greater than zero.")
    return weights


def compute_factor_scores(stocks: Sequence[StockRow]) -> Dict[str, List[Optional[float]]]:
    factor_scores: Dict[str, List[Optional[float]]] = {}

    for factor, metrics in FACTOR_DEFINITIONS.items():
        metric_norms: List[Tuple[float, List[Optional[float]]]] = []
        for metric_name, metric_weight, higher_is_better in metrics:
            metric_values = [stock.get(metric_name) for stock in stocks]
            metric_norm = normalize_series(metric_values, higher_is_better)
            metric_norms.append((metric_weight, metric_norm))

        scores_for_factor: List[Optional[float]] = []
        for i in range(len(stocks)):
            weighted_sum = 0.0
            used_weight = 0.0
            for metric_weight, metric_norm in metric_norms:
                metric_score = metric_norm[i]
                if metric_score is None:
                    continue
                weighted_sum += metric_score * metric_weight
                used_weight += metric_weight
            if used_weight > 0:
                scores_for_factor.append(weighted_sum / used_weight)
            else:
                scores_for_factor.append(None)
        factor_scores[factor] = scores_for_factor

    return factor_scores


def recommendation(score: float) -> str:
    if score >= 0.75:
        return "Strong Buy"
    if score >= 0.60:
        return "Buy"
    if score >= 0.45:
        return "Hold"
    return "Reduce"


def score_stocks(
    stocks: Sequence[StockRow],
    factor_weights: Dict[str, float],
) -> List[ScoreRow]:
    factor_scores = compute_factor_scores(stocks)

    results: List[ScoreRow] = []
    for i, stock in enumerate(stocks):
        weighted_sum = 0.0
        used_weight = 0.0
        stock_factor_scores: Dict[str, Optional[float]] = {}

        for factor, weight in factor_weights.items():
            factor_value = factor_scores[factor][i]
            stock_factor_scores[factor] = factor_value
            if factor_value is None or weight <= 0:
                continue
            weighted_sum += factor_value * weight
            used_weight += weight

        if used_weight <= 0:
            composite = None
        else:
            composite = weighted_sum / used_weight

        if composite is None:
            continue

        item: ScoreRow = {
            "ticker": stock.get("ticker", ""),
            "name": stock.get("name", ""),
            "composite": composite,
            "recommendation": recommendation(composite),
        }
        for text_key in ("sector", "date"):
            if isinstance(stock.get(text_key), str) and stock[text_key]:
                item[text_key] = stock[text_key]
        for numeric_key in ("forward_return_1m", "forward_return_3m", "forward_return_6m"):
            if stock.get(numeric_key) is not None:
                item[numeric_key] = stock.get(numeric_key)
        item.update(stock_factor_scores)
        results.append(item)

    results.sort(key=lambda item: float(item["composite"]), reverse=True)
    return results


def format_score(value: Optional[float]) -> str:
    if value is None:
        return "-"
    return f"{value:.3f}"


def apply_sector_neutral_ranking(results: Sequence[ScoreRow], sector_column: str = "sector") -> List[ScoreRow]:
    rows = [dict(item) for item in results]

    grouped: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    ungrouped: List[int] = []
    for idx, row in enumerate(rows):
        sector = row.get(sector_column)
        if not isinstance(sector, str) or not sector.strip():
            ungrouped.append(idx)
            continue

        date_key = ""
        if isinstance(row.get("date"), str):
            date_key = row["date"].strip()
        grouped[(date_key, sector.strip())].append(idx)

    if not grouped:
        for row in rows:
            row["sector_neutral"] = row.get("composite")
        return rows

    for indices in grouped.values():
        sector_composites = [rows[i].get("composite") for i in indices]
        normalized = normalize_series(sector_composites, higher_is_better=True)
        for local_idx, global_idx in enumerate(indices):
            neutral_score = normalized[local_idx]
            rows[global_idx]["sector_neutral"] = neutral_score

    for idx in ungrouped:
        rows[idx]["sector_neutral"] = rows[idx].get("composite")
    for row in rows:
        if row.get("sector_neutral") is None:
            row["sector_neutral"] = row.get("composite")

    rows.sort(key=lambda item: float(item.get("sector_neutral", 0.0)), reverse=True)
    return rows


def print_results(results: Sequence[ScoreRow], top_n: int, use_sector_neutral: bool = False) -> None:
    rows = list(results if top_n <= 0 else results[:top_n])
    if not rows:
        print("No scored stocks to display.")
        return

    columns = ["Rank", "Ticker", "Composite"]
    if use_sector_neutral:
        columns.append("SectorNeutral")
    columns.extend(["Income", "Risk", "Momentum", "Value", "Quality", "Signal"])
    rendered_rows: List[List[str]] = []

    for idx, item in enumerate(rows, start=1):
        row = [
            str(idx),
            str(item.get("ticker", "")),
            format_score(item.get("composite")),  # type: ignore[arg-type]
        ]
        if use_sector_neutral:
            row.append(format_score(item.get("sector_neutral")))  # type: ignore[arg-type]
        row.extend(
            [
                format_score(item.get("income")),  # type: ignore[arg-type]
                format_score(item.get("risk")),  # type: ignore[arg-type]
                format_score(item.get("momentum")),  # type: ignore[arg-type]
                format_score(item.get("value")),  # type: ignore[arg-type]
                format_score(item.get("quality")),  # type: ignore[arg-type]
                str(item.get("recommendation", "")),
            ]
        )
        rendered_rows.append(row)

    widths = [len(col) for col in columns]
    for row in rendered_rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def render_row(cells: Sequence[str]) -> str:
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    separator = "-+-".join("-" * width for width in widths)
    print(render_row(columns))
    print(separator)
    for row in rendered_rows:
        print(render_row(row))


def write_output_csv(output_path: Path, results: Sequence[ScoreRow]) -> None:
    base_fieldnames = [
        "ticker",
        "name",
        "sector",
        "date",
        "composite",
        "sector_neutral",
        "income",
        "risk",
        "momentum",
        "value",
        "quality",
        "recommendation",
    ]
    backtest_fields = ["forward_return_1m", "forward_return_3m", "forward_return_6m"]
    fieldnames = list(base_fieldnames)
    if any(any(field in row for field in backtest_fields) for row in results):
        fieldnames.extend(backtest_fields)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in results:
            writer.writerow(
                {
                    "ticker": row.get("ticker", ""),
                    "name": row.get("name", ""),
                    "sector": row.get("sector", ""),
                    "date": row.get("date", ""),
                    "composite": format_score(row.get("composite")),  # type: ignore[arg-type]
                    "sector_neutral": format_score(row.get("sector_neutral")),  # type: ignore[arg-type]
                    "income": format_score(row.get("income")),  # type: ignore[arg-type]
                    "risk": format_score(row.get("risk")),  # type: ignore[arg-type]
                    "momentum": format_score(row.get("momentum")),  # type: ignore[arg-type]
                    "value": format_score(row.get("value")),  # type: ignore[arg-type]
                    "quality": format_score(row.get("quality")),  # type: ignore[arg-type]
                    "recommendation": row.get("recommendation", ""),
                    "forward_return_1m": format_score(row.get("forward_return_1m")),  # type: ignore[arg-type]
                    "forward_return_3m": format_score(row.get("forward_return_3m")),  # type: ignore[arg-type]
                    "forward_return_6m": format_score(row.get("forward_return_6m")),  # type: ignore[arg-type]
                }
            )


def parse_backtest_date(date_value: Any) -> Optional[datetime]:
    if not isinstance(date_value, str) or not date_value.strip():
        return None
    text = date_value.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m", "%Y/%m"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def percentile_cut(values: Sequence[float], q: int) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    position = max(0, min(len(sorted_values) - 1, int(round((q / 100.0) * (len(sorted_values) - 1)))))
    return sorted_values[position]


def run_backtest(
    results: Sequence[ScoreRow],
    forward_return_column: str = "forward_return_1m",
    score_column: str = "composite",
) -> Dict[str, Any]:
    by_date: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    for row in results:
        date_val = row.get("date")
        score = row.get(score_column)
        if score is None and score_column != "composite":
            score = row.get("composite")
        forward_return = row.get(forward_return_column)
        if not isinstance(date_val, str):
            continue
        if not isinstance(score, (int, float)) or not isinstance(forward_return, (int, float)):
            continue
        by_date[date_val].append((float(score), float(forward_return)))

    dated_rows: List[Tuple[datetime, str, List[Tuple[float, float]]]] = []
    for date_key, pairs in by_date.items():
        parsed = parse_backtest_date(date_key)
        if parsed and len(pairs) >= 4:
            dated_rows.append((parsed, date_key, pairs))

    dated_rows.sort(key=lambda item: item[0])
    if not dated_rows:
        return {"periods": [], "summary": None}

    periods: List[Dict[str, Any]] = []
    cumulative = 1.0
    long_only_cumulative = 1.0
    for _, date_key, pairs in dated_rows:
        pairs.sort(key=lambda item: item[0], reverse=True)
        bucket_size = max(1, len(pairs) // 5)
        top_bucket = [r for _, r in pairs[:bucket_size]]
        bottom_bucket = [r for _, r in pairs[-bucket_size:]]

        top_avg = sum(top_bucket) / len(top_bucket)
        bottom_avg = sum(bottom_bucket) / len(bottom_bucket)
        spread = top_avg - bottom_avg
        cumulative *= 1.0 + spread
        long_only_cumulative *= 1.0 + top_avg

        periods.append(
            {
                "date": date_key,
                "n_stocks": len(pairs),
                "top_quantile_return": top_avg,
                "bottom_quantile_return": bottom_avg,
                "long_short_spread": spread,
                "cumulative_long_short": cumulative - 1.0,
                "cumulative_long_only": long_only_cumulative - 1.0,
            }
        )

    spreads = [p["long_short_spread"] for p in periods]
    summary = {
        "periods": len(periods),
        "avg_long_short_spread": sum(spreads) / len(spreads),
        "median_long_short_spread": percentile_cut(spreads, 50),
        "final_cumulative_long_short": periods[-1]["cumulative_long_short"],
        "final_cumulative_long_only": periods[-1]["cumulative_long_only"],
    }
    return {"periods": periods, "summary": summary}


def print_backtest(backtest_result: Dict[str, Any]) -> None:
    summary = backtest_result.get("summary")
    periods = backtest_result.get("periods", [])
    if not summary or not periods:
        print("\nBacktest: not enough valid rows. Include date + forward returns across multiple dates.")
        return

    print("\nBacktest summary (top quintile minus bottom quintile):")
    print(f"- Periods: {summary['periods']}")
    print(f"- Avg spread: {summary['avg_long_short_spread']:.3%}")
    print(f"- Median spread: {summary['median_long_short_spread']:.3%}")
    print(f"- Final cumulative long-short: {summary['final_cumulative_long_short']:.3%}")
    print(f"- Final cumulative long-only: {summary['final_cumulative_long_only']:.3%}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze and rank stocks using income, risk, momentum, and related factors."
    )
    parser.add_argument("input_csv", type=Path, help="Path to input CSV file.")
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="Number of top-ranked stocks to print (<=0 prints all). Default: 10",
    )
    parser.add_argument(
        "--weights",
        default="",
        help=(
            "Optional factor weights, e.g. "
            "'income=0.35,risk=0.25,momentum=0.30,value=0.05,quality=0.05'. "
            "Unspecified factors keep default weights."
        ),
    )
    parser.add_argument(
        "--returns-scale",
        choices=("auto", "decimal", "percent"),
        default="auto",
        help="How return values are encoded in CSV. Default: auto",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional output CSV path for scored results.",
    )
    parser.add_argument(
        "--sector-neutral",
        action="store_true",
        help="Enable sector-neutral ranking (requires sector column for best results).",
    )
    parser.add_argument(
        "--sector-column",
        default="sector",
        help="Column used for sector grouping when --sector-neutral is enabled.",
    )
    parser.add_argument(
        "--backtest",
        action="store_true",
        help="Run a basic quantile backtest if date and forward returns are available.",
    )
    parser.add_argument(
        "--backtest-forward-column",
        default="forward_return_1m",
        help="Forward return column for backtest (default: forward_return_1m).",
    )
    parser.add_argument(
        "--backtest-score-column",
        choices=("composite", "sector_neutral"),
        default="composite",
        help="Score column used for ranking in backtest.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    factor_weights = parse_factor_weights(args.weights)
    stocks = load_stocks(args.input_csv, return_scale=args.returns_scale)
    results = score_stocks(stocks, factor_weights)
    if args.sector_neutral:
        results = apply_sector_neutral_ranking(results, sector_column=args.sector_column)
    else:
        for row in results:
            row["sector_neutral"] = row.get("composite")

    print_results(results, top_n=args.top, use_sector_neutral=args.sector_neutral)
    if args.output:
        write_output_csv(args.output, results)
        print(f"\nSaved scored results to: {args.output}")
    if args.backtest:
        bt = run_backtest(
            results,
            forward_return_column=args.backtest_forward_column,
            score_column=args.backtest_score_column,
        )
        print_backtest(bt)

    print("\nNote: This is a quantitative screening tool, not financial advice.")


if __name__ == "__main__":
    main()
