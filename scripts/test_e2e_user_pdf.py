#!/usr/bin/env python3
"""E2E — la fiche problematique de l'utilisateur (PNG -> PDF sans texte).

1. Connexion admin.
2. Upload du PDF « Docs From Bh225... » -> SUCCESS attendu.
3. Verification des champs : CIN 149654358, nom « Amine trablesi ».
4. Recherche par CIN 149654358 -> doit retrouver la fiche.
5. Recherche par le nom dans les resultats -> present.
"""
import sys
import requests

BASE = "http://localhost:3000"
PDF = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf"

s = requests.Session()

def step(n, ok, detail=""):
    print(("PASS" if ok else "FAIL") + f" [{n}] {detail}")
    if not ok:
        sys.exit(1)

# 1. Login
r = s.post(f"{BASE}/api/auth/login", json={"email": "it@demo.tn", "password": "demo1234"}, timeout=30)
step("1 login", r.status_code in (200, 201), f"status={r.status_code}")

# 2. Upload
with open(PDF, "rb") as f:
    r = s.post(
        f"{BASE}/api/payslips/upload",
        files={"files": ("Docs From Bh225_260914145812 (1)-1.pdf", f, "application/pdf")},
        timeout=300,
    )
step("2 upload", r.status_code in (200, 201), f"status={r.status_code}")
data = r.json()
results = data.get("results") or data.get("items") or []
rec = results[0] if results else data
print("   message:", rec.get("message", "")[:160])
print("   cin:", rec.get("cin"), "| nom:", rec.get("employeeName"),
      "| periode:", rec.get("period"), "| net:", rec.get("netSalary"))
step("2b CIN correct", rec.get("cin") == "149654358", f"cin={rec.get('cin')}")
nom = (rec.get("employeeName") or "").lower().replace(" ", "")
step("2c nom correct", nom == "aminetrablesi", f"nom={rec.get('employeeName')!r}")
step("2d periode", bool(rec.get("period")), f"period={rec.get('period')}")
step("2e net", bool(rec.get("netSalary")), f"net={rec.get('netSalary')}")

# 3. Recherche par CIN exact
r = s.get(f"{BASE}/api/payslips", params={"cin": "149654358"}, timeout=60)
items = r.json().get("items", [])
step("3 recherche CIN", len(items) >= 1, f"{len(items)} resultat(s)")
match = any(i.get("cin") == "149654358" or i.get("matchedBy") == "cin_content" for i in items)
step("3b matched", match, f"matchedBy={[i.get('matchedBy') for i in items]}")

# 4. La nouvelle fiche est-elle dans les resultats ?
nom_trouve = any(
    "aminetrablesi" in ((i.get("employeeName") or "").lower().replace(" ", ""))
    for i in items
)
step("4 nom dans resultats", nom_trouve, "« Amine trablesi » present")

print("\n*** E2E UTILISATEUR : TOUS LES TESTS PASSENT ***")
