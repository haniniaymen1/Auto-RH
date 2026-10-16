#!/usr/bin/env python3
"""Task 15 — E2E HTTP : upload du PNG pdf2png (EMPLOYE TEST) sur le serveur
de production (port 3000) + vérification détection + recherche CIN + nettoyage."""
import requests, sys, json

BASE = "http://localhost:3000"
PNG = "/home/z/my-project/upload/pdf2png_extracted/Docs From Bh225_260914145812 (1)/Docs From Bh225_260914145812 (1)-1.png"
NAME = "Task15 pdf2png verification.png"

s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "it@demo.tn", "password": "demo1234"}, timeout=30)
assert r.status_code in (200, 201), f"login KO: {r.status_code} {r.text[:200]}"
print("1. Login OK")

with open(PNG, "rb") as f:
    r = s.post(f"{BASE}/api/payslips/upload", files={"files": (NAME, f, "image/png")}, timeout=900)
up = r.json()
print("2. Upload:", json.dumps(up, ensure_ascii=False)[:400])
items = up.get("results") or up.get("items") or ([up] if "cin" in up else [])
assert items, f"pas de résultat d'upload: {r.status_code} {r.text[:300]}"
it = items[0]
pid = it.get("id")
cin, name, period, net, mat = it.get("cin"), it.get("employeeName"), it.get("period"), it.get("netSalary"), it.get("matricule")
print(f"   CIN={cin} | Nom={name} | Période={period} | Net={net} | Mat={mat}")

ok = True
def check(label, cond, got):
    global ok
    print(("   ✅" if cond else "   ❌") + f" {label}: {got}")
    if not cond: ok = False

check("CIN", cin == "12345678", cin)
check("Nom", bool(name) and "EMPLOYE" in name.upper().replace(" ", "") and "TEST" in name.upper(), name)
check("Période", bool(period) and "01/08/26" in period, period)
check("Net", bool(net) and str(net).startswith("1593"), net)

# 3. recherche CIN exacte (mode=search, comme le champ de recherche)
r = s.get(f"{BASE}/api/payslips", params={"cin": "12345678", "mode": "search"}, timeout=60)
found = r.json().get("items", [])
match = [x for x in found if x.get("id") == pid]
check("Recherche CIN 12345678 -> fiche trouvée", len(match) == 1, f"{len(found)} résultat(s)")
if match:
    check("Nom en base", "EMPLOYE" in (match[0].get("employeeName") or "").upper().replace(" ", ""),
          match[0].get("employeeName"))

# 4. nettoyage : suppression de la fiche de test
if pid:
    r = s.delete(f"{BASE}/api/payslips/{pid}", timeout=30)
    print("5. Nettoyage (DELETE):", r.status_code)

print("\nVERDICT E2E:", "TOUT OK ✅" if ok else "ÉCHEC ❌")
sys.exit(0 if ok else 1)
