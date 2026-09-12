"""Refresh display-only NSE identifiers. Does not access the application database."""
import csv
import io
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SOURCES = [
    ("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", "SYMBOL", "ISIN NUMBER"),
    ("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv", "Symbol", "ISINNumber"),
]


def main():
    identifiers = {}
    for url, symbol_column, isin_column in SOURCES:
        content = subprocess.check_output(
            ["curl", "--http1.1", "--fail", "--silent", "--show-error", "--location",
             "--max-time", "30", "--user-agent", "Mozilla/5.0", url], text=True, encoding="cp1252"
        )
        reader = csv.DictReader(io.StringIO(content))
        rows = [{key.strip(): value.strip() for key, value in row.items()} for row in reader]
        if len(rows) < 100:
            raise ValueError(f"Unexpected directory response from {url}")

        for row in rows:
            symbol, isin = row[symbol_column], row[isin_column]
            if not re.fullmatch(r"[A-Z0-9][A-Z0-9.&-]*", symbol) or not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
                raise ValueError("Invalid directory identifier")
            if symbol in identifiers and identifiers[symbol] != isin:
                raise ValueError(f"Conflicting security identifiers for {symbol}")
            identifiers[symbol] = isin

    target = Path(__file__).resolve().parents[1] / "apps/web/src/lib/logo-data/nse.json"
    payload = {"retrievedAt": datetime.now(timezone.utc).date().isoformat(),
               "sources": [source[0] for source in SOURCES],
               "identifiers": dict(sorted(identifiers.items()))}
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(identifiers)} NSE equity and ETF identifiers")


if __name__ == "__main__":
    main()
