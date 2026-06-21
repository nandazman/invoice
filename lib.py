"""Shared helpers: load price reference, parse order.txt, match products.

Used by both list_missing.py (task 1) and build_order.py (task 2).
"""

import json
import re
from difflib import get_close_matches
from pathlib import Path

BASE = Path(__file__).resolve().parent
PRICE_FILE = BASE / "price.json"
ORDER_TXT = BASE / "order.txt"

# Domain synonyms: how a name written in order.txt maps to a "Nama Produk"
# in price.json. Keys are normalized (lowercase, single spaces).
ALIASES = {
    "milo": "Milo Active Go",
    "uht": "Susu UHT",
    "syrup lychee": "FO Lychee",
    "syrup mint": "FO Mint",
    "gula aren cair": "Gula Merah Cair",
    "gula merah cair": "Gula Merah Cair",
    "selasin": "Biji Selasih",
    "soda": "Soda Fanta",
    "madu": "Madu Quickfresh",
    "black tea": "Blacktea Goalpara",
    "blacktea": "Blacktea Goalpara",
    "lecy kaleng": "Herring Lychee",
    "lychee kaleng": "Herring Lychee",
    "krimer": "Krimer",
    "nata decoco": "Nata De Coco Kara",
    "cup ice": "Cup Ice Starrindo 14oz",
    "handgloves": "Handgloves",
    "bunga telang": "Bunga Telang",
    "thaitea": "Thaitea Chatramue",
}

# Minimum difflib similarity to accept a fuzzy match (0-1). High on purpose so
# unknown products are reported as missing instead of mis-matched.
FUZZY_CUTOFF = 0.82


def normalize(name: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def load_prices(path: Path = PRICE_FILE) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def match_product(raw_name: str, prices: list[dict]) -> dict | None:
    """Return the price entry matching raw_name, or None if missing.

    Order of attempts: alias map -> exact normalized name -> fuzzy match.
    """
    norm = normalize(raw_name)
    if not norm:
        return None

    by_norm = {normalize(p["Nama Produk"]): p for p in prices}

    # 1. alias
    if norm in ALIASES:
        return by_norm.get(normalize(ALIASES[norm]))

    # 2. exact normalized
    if norm in by_norm:
        return by_norm[norm]

    # 3. fuzzy
    hit = get_close_matches(norm, list(by_norm), n=1, cutoff=FUZZY_CUTOFF)
    if hit:
        return by_norm[hit[0]]

    return None


# Matches a trailing quantity token that starts with a digit, e.g.
# "4", "10pack", "24btl", "1dus", "3kg", "1/2kg", "250".
_QTY_RE = re.compile(r"(\d[\d/]*)\s*([a-zA-Z]*)\s*\S*$")


def parse_order_txt(path: Path = ORDER_TXT) -> list[dict]:
    """Parse order.txt into a flat list of line items.

    Each item: {date, raw_line, name, qty_text}. Header/date/blank lines
    are skipped. Only lines with a trailing numeric quantity are kept.
    """
    items: list[dict] = []
    current_date = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.upper().startswith("BAR"):
            continue

        # date marker like "- 1 Juni"
        m = re.match(r"^-\s*(\d+\s+\w+)\s*$", line)
        if m:
            current_date = m.group(1)
            continue

        # order header carries the full date "Order Lujitiam 1 Juni 2026"
        m = re.match(r"^order lujitiam\s+(.+)$", line, re.IGNORECASE)
        if m:
            current_date = m.group(1).strip()
            continue

        # strip a leading bullet dash
        body = re.sub(r"^-\s*", "", line)

        # find trailing quantity; name is everything before it
        qm = re.search(r"\s+(\d[\w/]*)", body)
        if not qm:
            continue
        name = body[: qm.start()].strip()
        qty_text = body[qm.start():].strip()
        if not name:
            continue

        items.append(
            {
                "date": current_date,
                "raw_line": line,
                "name": name,
                "qty_text": qty_text,
            }
        )

    return items
