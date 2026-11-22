#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Teste la recherche CIN EXACTE de l'admin sur les 20 fiches importées."""
import json
import urllib.request

BASE = "http://localhost:3000"

SLIPS = {
    "09123456": "Bulletin_Paie_01_Janvier2025.pdf",
    "09876543": "Bulletin_Paie_02_Fevrier2025.pdf",
    "04567890": "Bulletin_Paie_03_Mars2026.pdf",
    "01112223": "Bulletin_Paie_04_Avril2026.pdf",
    "02223334": "Bulletin_Paie_05_Mai2026.pdf",
    "05556667": "Bulletin_Paie_06_Juin2026.pdf",
    "03334445": "Bulletin_Paie_07_Juillet2026.pdf",
    "08123456": "Bulletin_Paie_08_Aout2026.pdf",
    "A123456": "Bulletin_Paie_09_Septembre2026.pdf",
    "A654321": "Bulletin_Paie_10_Octobre2026.pdf",
    "B234567": "Bulletin_Paie_11_Novembre2026.pdf",
    "06112233": "Bulletin_Paie_12_Decembre2026.pdf",
    "1234567": "Bulletin_Paie_13_Janvier2027.pdf",
    "07070707": "Bulletin_Paie_14_Fevrier2027.pdf",
    "04445556": "Bulletin_Paie_15_Mars2027.pdf",
    "06667778": "Bulletin_Paie_16_Avril2027.pdf",
    "07778889": "Bulletin_Paie_17_Mai2027.pdf",
    "03445566": "Bulletin_Paie_18_Juin2027.pdf",
    "02233445": "Bulletin_Paie_19_Juillet2027.pdf",
    "08889990": "Bulletin_Paie_20_Aout2027.pdf",
}
PARTIALS = ["0912", "1234", "123456", "091234", "A123", "23456", "654321", "812345"]
# Variantes de saisie tolérées (casse + espaces dans la SAISIE)
VARIANTS = [("a123456", "Bulletin_Paie_09_Septembre2026.pdf"),
            ("08 12 34 56", "Bulletin_Paie_08_Aout2026.pdf"),
            ("a 654321", "Bulletin_Paie_10_Octobre2026.pdf")]


def api(path, cookie=None):
    req = urllib.request.Request(BASE + path)
    if cookie:
        req.add_header("Cookie", cookie)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode()), r.headers


def main():
    # login
    data = json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data,
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    cookie = resp.headers["Set-Cookie"].split(";")[0]

    errors = 0
    print("=== 1) Recherche exacte : chaque CIN → sa fiche (total=1) ===")
    for cin, expected in SLIPS.items():
        d, _ = api(f"/api/payslips?cin={urllib.parse.quote(cin)}", cookie)
        names = [i["fileName"] for i in d["items"]]
        ok = d.get("total") == 1 and names == [expected] and d.get("exact") is True
        if not ok:
            errors += 1
        print(f"{'PASS' if ok else 'ÉCHEC'}  {cin:<9} → total={d.get('total')} {names}")

    print("\n=== 2) Requêtes partielles → total=0 ===")
    for p in PARTIALS:
        d, _ = api(f"/api/payslips?cin={p}", cookie)
        ok = d.get("total") == 0
        if not ok:
            errors += 1
        print(f"{'PASS' if ok else 'ÉCHEC'}  \"{p}\" → total={d.get('total')}")

    print("\n=== 3) Variantes de saisie (casse/espaces) tolérées ===")
    for q, expected in VARIANTS:
        d, _ = api(f"/api/payslips?cin={urllib.parse.quote(q)}", cookie)
        names = [i["fileName"] for i in d["items"]]
        ok = d.get("total") == 1 and names == [expected]
        if not ok:
            errors += 1
        print(f"{'PASS' if ok else 'ÉCHEC'}  \"{q}\" → total={d.get('total')} {names}")

    print("\n" + ("✔ ADMIN : TOUS LES TESTS PASSENT" if errors == 0 else f"✘ ADMIN : {errors} ERREUR(S)"))
    raise SystemExit(0 if errors == 0 else 1)


import urllib.parse
main()
