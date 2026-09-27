"""Convert drugs_raw.jsonl (Macedonian labels) into the API JSON format."""
import json
import sys
from datetime import datetime

BASE = "https://lekovi.zdravstvo.gov.mk"

DISPENSING = {"Rp": "prescription", "H": "hospitalOnly", "BRp": "otcPharmacy", "BR*": "otcGeneralSale"}
PRODUCT_TYPE = {"Г": "generic", "О": "original", "БС": "biosimilar"}
YES_NO = {"Да": True, "Не": False}
DOSAGE_PLACEHOLDERS = {"", "xx", "хх", "x", "hh", "xх", "/", "0"}  # Latin and Cyrillic x/х


def text(v):
    """Empty string -> null. Everything else kept exactly as on the site."""
    return v if v else None


def date(v):
    return datetime.strptime(v, "%d.%m.%Y").strftime("%Y-%m-%d") if v else None


def price(v):
    """'0' on the site means no price set -> null."""
    n = float(v)
    if n == 0:
        return None
    return int(n) if n.is_integer() else n


def ean(v):
    return v if v and v != "0" else None


def link(links, label):
    urls = links.get(label)
    return BASE + urls[0] if urls else None


def convert(raw):
    t, d, links = raw["table"], raw["detail"], raw["detailLinks"]
    dosage = d["Дозирање"]
    return {
        "id": raw["id"],
        "detailUrl": f"{BASE}/drugsregister/detailview/{raw['id']}",
        "nameLatin": d["Име на лекот (латиница)"],
        "nameCyrillic": d["Име на лекот (кирилица)"],
        "genericName": d["Генеричко име"],
        "atcCode": text(d["АТЦ"]),
        "extendedAtcCode": text(d["Проширен АТЦ"]),
        "ean": ean(d["EAN код"]),
        "pharmaceuticalForm": d["Фармацевтска форма"],
        "strength": text(d["Јачина"]),
        "packaging": d["Пакување"],
        "composition": text(d["Состав"]),
        "dosage": None if dosage.strip() in DOSAGE_PLACEHOLDERS else dosage,
        "dispensing": DISPENSING[t["Начин на издавање"]],
        "productType": PRODUCT_TYPE[t["Г/О/БС"]],
        "specialWarning": text(d["Посебни предупредувања"]),
        "specialistRecommendation": text(d["Препорака од Специјалист/супспецијалист/конзилиум"]),
        "manufacturers": d["Производители"],
        # label on the site mixes Cyrillic "Мест" with a Latin "a"
        "manufacturingSites": text(d.get("Местa на производство", "")),
        "marketingAuthorizationHolder": d["Носител на одобрение"],
        "authorization": {
            "number": text(d["Број на решение"]),
            "issuedDate": date(t["Датум на решение"]),
            "expiryDate": date(t["Датум на важност"]),
            "renewalDate": date(t["Датум на обнова"]),
        },
        "prices": {
            "wholesaleExVat": price(t["Големопродажна цена без ДДВ"]),
            "retailWithVat": price(t["Малопродажна цена со ДДВ"]),
            "reference": price(d["Референтна цена"]),
        },
        "isOnPositiveList": YES_NO[d["Позитивна листа"]],
        "fundCode": text(d["Фондовска шифра"]),
        "hasBraille": YES_NO[d["Браилово писмо"]],
        "hasVariations": t["Варијации"] == "Да",
        "documents": {
            "smpcUrl": link(links, "Збирен извештај"),
            "patientLeafletUrl": link(links, "Упатство за употреба"),
            "labelUrl": link(links, "Налепница/Пакување"),
        },
    }


def build(src):
    rows = [json.loads(line) for line in open(src, encoding="utf-8")]
    drugs = [convert(r) for r in rows]
    return {
        "source": BASE + "/drugsregister",
        "scrapedDate": "2026-09-27",
        "currency": "MKD",
        "count": len(drugs),
        "drugs": drugs,
    }


if __name__ == "__main__":
    # Usage: python3 scripts/transform.py raw/drugs_raw.jsonl > public/data/drug-register.json
    out = build(sys.argv[1] if len(sys.argv) > 1 else "raw/drugs_raw.jsonl")
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(",", ":"))
