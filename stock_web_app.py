#!/usr/bin/env python3
"""Simple web UI server for the stock analyzer."""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

from stock_analyzer import (
    apply_sector_neutral_ranking,
    load_stocks_from_text,
    parse_factor_weights,
    run_backtest,
    score_stocks,
)


ROOT = Path(__file__).resolve().parent
UI_FILE = ROOT / "templates" / "index.html"
JS_FILE = ROOT / "static" / "app.js"
CSS_FILE = ROOT / "static" / "styles.css"


def parse_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    content_length = handler.headers.get("Content-Length")
    if not content_length:
        return {}
    try:
        raw_length = int(content_length)
    except ValueError:
        raise ValueError("Invalid Content-Length header.")
    body = handler.rfile.read(raw_length)
    if not body:
        return {}
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Request body is not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("JSON payload must be an object.")
    return payload


class StockRequestHandler(BaseHTTPRequestHandler):
    server_version = "StockAnalyzerHTTP/1.0"

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found.")
            return
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send_file(UI_FILE, "text/html; charset=utf-8")
            return
        if self.path == "/static/app.js":
            self._send_file(JS_FILE, "application/javascript; charset=utf-8")
            return
        if self.path == "/static/styles.css":
            self._send_file(CSS_FILE, "text/css; charset=utf-8")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found.")

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/analyze":
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found.")
            return
        try:
            payload = parse_json_body(self)
            csv_text = str(payload.get("csv_text", "")).strip()
            if not csv_text:
                raise ValueError("csv_text is required.")

            returns_scale = str(payload.get("returns_scale", "auto"))
            if returns_scale not in ("auto", "decimal", "percent"):
                raise ValueError("returns_scale must be one of: auto, decimal, percent.")

            weights_input = str(payload.get("weights", "")).strip()
            factor_weights = parse_factor_weights(weights_input)
            stocks = load_stocks_from_text(csv_text, return_scale=returns_scale)
            results = score_stocks(stocks, factor_weights)

            sector_neutral = bool(payload.get("sector_neutral", False))
            sector_column = str(payload.get("sector_column", "sector")).strip() or "sector"
            if sector_neutral:
                results = apply_sector_neutral_ranking(results, sector_column=sector_column)
            else:
                for row in results:
                    row["sector_neutral"] = row.get("composite")

            backtest_enabled = bool(payload.get("backtest", False))
            backtest_forward_column = str(payload.get("backtest_forward_column", "forward_return_1m")).strip()
            backtest_score_column = str(payload.get("backtest_score_column", "composite")).strip()
            if backtest_score_column not in ("composite", "sector_neutral"):
                raise ValueError("backtest_score_column must be composite or sector_neutral.")
            backtest_result = None
            if backtest_enabled:
                backtest_result = run_backtest(
                    results,
                    forward_return_column=backtest_forward_column,
                    score_column=backtest_score_column,
                )

            response = {
                "ok": True,
                "row_count": len(results),
                "results": results,
                "backtest": backtest_result,
            }
            self._send_json(HTTPStatus.OK, response)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive handler
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"Server error: {exc}"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve the stock analysis web UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=5000, help="Port to bind. Default: 5000")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    server = ThreadingHTTPServer((args.host, args.port), StockRequestHandler)
    print(f"Serving stock UI at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
