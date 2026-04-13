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
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple


MetricDef = Tuple[str, float, bool]  # (metric_name, metric_weight, higher_is_better)

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


def derive_metrics(stock: Dict[str, Optional[float]]) -> None:
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


def load_stocks(csv_path: Path, return_scale: str) -> List[Dict[str, Optional[float]]]:
    stocks: List[Dict[str, Optional[float]]] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "ticker" not in reader.fieldnames:
            raise ValueError("CSV must include a 'ticker' column.")

        for row in reader:
            stock: Dict[str, Optional[float]] = {}
            for key, raw_value in row.items():
                if key is None:
                    continue
                key = key.strip()
                if key in ("ticker", "name"):
                    stock[key] = (raw_value or "").strip()  # type: ignore[assignment]
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


def compute_factor_scores(stocks: Sequence[Dict[str, Optional[float]]]) -> Dict[str, List[Optional[float]]]:
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
    stocks: Sequence[Dict[str, Optional[float]]],
    factor_weights: Dict[str, float],
) -> List[Dict[str, object]]:
    factor_scores = compute_factor_scores(stocks)

    results: List[Dict[str, object]] = []
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

        item: Dict[str, object] = {
            "ticker": stock.get("ticker", ""),
            "name": stock.get("name", ""),
            "composite": composite,
            "recommendation": recommendation(composite),
        }
        item.update(stock_factor_scores)
        results.append(item)

    results.sort(key=lambda item: float(item["composite"]), reverse=True)
    return results


def format_score(value: Optional[float]) -> str:
    if value is None:
        return "-"
    return f"{value:.3f}"


def print_results(results: Sequence[Dict[str, object]], top_n: int) -> None:
    rows = list(results if top_n <= 0 else results[:top_n])
    if not rows:
        print("No scored stocks to display.")
        return

    columns = ["Rank", "Ticker", "Composite", "Income", "Risk", "Momentum", "Value", "Quality", "Signal"]
    rendered_rows: List[List[str]] = []

    for idx, item in enumerate(rows, start=1):
        rendered_rows.append(
            [
                str(idx),
                str(item.get("ticker", "")),
                format_score(item.get("composite")),  # type: ignore[arg-type]
                format_score(item.get("income")),  # type: ignore[arg-type]
                format_score(item.get("risk")),  # type: ignore[arg-type]
                format_score(item.get("momentum")),  # type: ignore[arg-type]
                format_score(item.get("value")),  # type: ignore[arg-type]
                format_score(item.get("quality")),  # type: ignore[arg-type]
                str(item.get("recommendation", "")),
            ]
        )

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


def write_output_csv(output_path: Path, results: Sequence[Dict[str, object]]) -> None:
    fieldnames = [
        "ticker",
        "name",
        "composite",
        "income",
        "risk",
        "momentum",
        "value",
        "quality",
        "recommendation",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in results:
            writer.writerow(
                {
                    "ticker": row.get("ticker", ""),
                    "name": row.get("name", ""),
                    "composite": format_score(row.get("composite")),  # type: ignore[arg-type]
                    "income": format_score(row.get("income")),  # type: ignore[arg-type]
                    "risk": format_score(row.get("risk")),  # type: ignore[arg-type]
                    "momentum": format_score(row.get("momentum")),  # type: ignore[arg-type]
                    "value": format_score(row.get("value")),  # type: ignore[arg-type]
                    "quality": format_score(row.get("quality")),  # type: ignore[arg-type]
                    "recommendation": row.get("recommendation", ""),
                }
            )


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
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    factor_weights = parse_factor_weights(args.weights)
    stocks = load_stocks(args.input_csv, return_scale=args.returns_scale)
    results = score_stocks(stocks, factor_weights)

    print_results(results, top_n=args.top)
    if args.output:
        write_output_csv(args.output, results)
        print(f"\nSaved scored results to: {args.output}")

    print("\nNote: This is a quantitative screening tool, not financial advice.")


if __name__ == "__main__":
    main()
