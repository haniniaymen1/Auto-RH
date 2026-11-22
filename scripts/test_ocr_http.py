#!/usr/bin/env python3
"""
Test d'integration HTTP — lecture des fiches "image" (PNG -> PDF) par OCR.

1. Connexion admin (JSON).
2. Upload du PDF IMAGE (conversion PNG -> PDF, sans texte) -> SUCCESS attendu
   avec "CIN détecté par OCR : 18504751".
3. Upload du PNG DIRECT -> SUCCESS attendu (import image, OCR).
4. Recherche par CIN 18504751 -> doit retrouver les fiches.
5. Redetect -> les fiches texte historiques restent intactes (aucune régression).
"""
import json
import sys
import requests

BASE = "http://localhost:3000"
IMG_PDF = "/home/z/my-project/scripts/ocr_test_fiche_image.pdf"
PNG = "/home/z/my-project/scripts/ocr_test_fiche.png"

s = requests.Session()

def step(n, ok, detail=""):
    print(("PASS" if ok else "FAIL") + f" [{n}] {detail}")
    if not ok:
        sys.exit(1)

# 1. Login
r = s.post(f"{BASE}/api/auth/login", json={"email": "it@demo.tn", "password": "demo1234"}, timeout=30)
step("1 login", r.status_code in (200, 201), f"status={r.status_code}")

# 2. Upload PDF image
with open(IMG_PDF, "rb") as f:
    r = s.post(f"{BASE}/api/payslips/upload", files={"files": ("fiche_png_vers_pdf.pdf", f, "application/pdf")}, timeout=300)
res = r.json()
r0 = res["results"][0] if res.get("results") else {}
step("2 upload PDF image -> SUCCESS", r.status_code == 200 and r0.get("status") == "SUCCESS",
     f"message={r0.get('message')} | cin={r0.get('cin')} | nom={r0.get('employeeName')} | periode={r0.get('period')} | net={r0.get('netSalary')}")
step("2b CIN détecté par OCR = 18504751", r0.get("cin") == "18504751", f"cin={r0.get('cin')}")
step("2c message mentionne OCR", "OCR" in (r0.get("message") or ""), f"message={r0.get('message')}")
id_pdf_image = r0.get("id")

# 3. Upload PNG direct
with open(PNG, "rb") as f:
    r = s.post(f"{BASE}/api/payslips/upload", files={"files": ("fiche_directe.png", f, "image/png")}, timeout=300)
res = r.json()
r0 = res["results"][0] if res.get("results") else {}
step("3 upload PNG direct -> SUCCESS", r.status_code == 200 and r0.get("status") == "SUCCESS",
     f"message={r0.get('message')} | cin={r0.get('cin')}")
step("3b CIN PNG = 18504751", r0.get("cin") == "18504751", f"cin={r0.get('cin')}")
id_png = r0.get("id")

# 4. Recherche par CIN
r = s.get(f"{BASE}/api/payslips", params={"cin": "18504751", "limit": 50}, timeout=60)
items = r.json().get("items", [])
step("4 recherche CIN 18504751 -> resultats", r.status_code == 200 and len(items) >= 3,
     f"{len(items)} resultat(s) (original + PDF image + PNG)")

# 4b. Le fichier de la fiche image est servi avec le bon type MIME
r = s.get(f"{BASE}/api/payslips/{id_pdf_image}/file", timeout=60)
ctype = r.headers.get("Content-Type", "")
step("4b fichier PDF image servi en application/pdf", r.status_code == 200 and "pdf" in ctype, f"Content-Type={ctype}")
r = s.get(f"{BASE}/api/payslips/{id_png}/file", timeout=60)
ctype = r.headers.get("Content-Type", "")
step("4c fichier PNG servi en image/png", r.status_code == 200 and ctype == "image/png", f"Content-Type={ctype}")

# 5. Nettoyage : suppression des 2 fiches de test
for rid in (id_pdf_image, id_png):
    if rid:
        r = s.delete(f"{BASE}/api/payslips/{rid}", timeout=60)
        print(f"   suppression {rid}: {r.status_code}")

# 6. Régression : redetect — les fiches historiques restent intactes
r = s.post(f"{BASE}/api/payslips/redetect", timeout=600)
d = r.json()
print(f"   redetect: total={d.get('total')} updated={d.get('updated')} cinFound={d.get('cinFound')} periodFound={d.get('periodFound')} errors={d.get('errors')}")
step("5 redetect sans erreur", r.status_code == 200 and d.get("errors", 0) == 0, "fiches historiques intactes")

r = s.get(f"{BASE}/api/stats", timeout=30)
print(f"   stats: {json.dumps(r.json(), ensure_ascii=False)}")
print("\nTOUT EST OK — les fiches PNG -> PDF et les PNG directs sont lus par OCR.")
