"""Task 1: list products mentioned in order.txt that have no price reference.

Run: python list_missing.py
"""

from collections import defaultdict

from lib import load_prices, match_product, normalize, parse_order_txt


def main() -> None:
    prices = load_prices()
    items = parse_order_txt()

    # group unmatched products case-insensitively so each appears once
    missing: dict[str, dict] = {}
    for it in items:
        if match_product(it["name"], prices) is not None:
            continue
        key = normalize(it["name"])
        entry = missing.setdefault(key, {"name": it["name"], "dates": []})
        entry["dates"].append(it["date"] or "?")

    if not missing:
        print("All products in order.txt have a price reference. Nothing missing.")
        return

    print(f"Missing prices: {len(missing)} product(s) have no entry in price.json\n")
    for entry in sorted(missing.values(), key=lambda e: e["name"].lower()):
        dates = ", ".join(entry["dates"])
        print(f"  - {entry['name']}  (seen: {dates})")


if __name__ == "__main__":
    main()
