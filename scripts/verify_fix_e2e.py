#!/usr/bin/env python3
"""E2E ciblé post-correctifs : nettoie les fiches de test puis re-upload UNE pièce.

Usage : python3 verify_fix_e2e.py A|B|C|D|E|clean
  clean -> supprime les fiches créées par les tests (Docs/bulletin_specimen/bulletin_900xxx)
  A -> Docs From Bh225_260914145812 (1).pdf   (PDF image, CIN 149654358 attendu)
  B -> Docs From Bh225_260914145812 (1)-1.png (PNG direct, CIN 149654358 attendu)
  C -> bulletins_specimen_50 (1).pdf          (50 fiches texte)
  D -> bulletins_specimen_50_PDF (1).zip      (50 PDF)
  E -> bulletins_specimen_50_PNG (1).zip      (50 PNG OCR)
"""
import json, sys, requests

BASE = "http://localhost:3000"
UP = "/home/z/my-project/upload/"
TRUTH = json.load(open("/home/z/my-project/scripts/specimen_truth.json"))
truth_by_cin = {t["cin"]: t for t in TRUTH}

s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "it@demo.tn", "password": "demo1234"}, timeout=30)
assert r.status_code in (200, 201), "login échoué"

def db_get(url):
    return s.get(f"{BASE}{url}", timeout=120)

# ---------- clean ----------
if len(sys.argv) > 1 and sys.argv[1] == "clean":
    d = db_get("/api/payslips").json()
    n = 0
    for it in d.get("items", []):
        fn = it.get("fileName", "")
        if fn.startswith(("Docs From Bh225", "bulletins_specimen_50", "bulletin_900")):
            s.delete(f"{BASE}/api/payslips/{it['id']}", timeout=60)
            n += 1
    print(f"Supprimé {n} fiche(s) de test.")
    sys.exit(0)

JOBS = {
    "A": ("Docs From Bh225_260914145812 (1).pdf", "application/pdf"),
    "B": ("Docs From Bh225_260914145812 (1)-1.png", "image/png"),
    "C": ("bulletins_specimen_50 (1).pdf", "application/pdf"),
    "D": ("bulletins_specimen_50_PDF (1).zip", "application/zip"),
    "E": ("bulletins_specimen_50_PNG (1).zip", "application/zip"),
}
tag = sys.argv[1] if len(sys.argv) > 1 else "A"
fname, mime = JOBS[tag]

with open(UP + fname, "rb") as f:
    r = s.post(f"{BASE}/api/payslips/upload", files={"files": (fname, f, mime)}, timeout=590)
assert r.status_code in (200, 201), f"upload: {r.status_code} {r.text[:200]}"
data = r.json()
results = data.get("results") or data.get("items") or []
print(f"[{tag}] {fname} -> réponse HTTP {r.status_code}, {len(results)} résultat(s) dans la réponse")

# Vérification VIA LA BASE (source de vérité, la réponse HTTP peut agréger)
d = db_get("/api/payslips").json()
if tag == "A":
    items = [it for it in d.get("items", []) if it.get("fileName") == fname]
elif tag == "B":
    items = [it for it in d.get("items", []) if it.get("fileName") == fname]
elif tag == "C":
    items = [it for it in d.get("items", []) if it.get("fileName") == fname]
else:  # D : bulletin_900xxx.pdf ; E : bulletin_900xxx.png (50 fichiers)
    ext = ".pdf" if tag == "D" else ".png"
    items = [it for it in d.get("items", [])
             if it.get("fileName", "").startswith("bulletin_900") and it.get("fileName", "").endswith(ext)]
print(f"[{tag}] fiches en base pour ce lot : {len(items)}")

issues = []
if tag in ("A", "B"):
    # A = fiche « EMPLOYE TEST » (CIN imprimé 12345678)
    # B = fiche « Amine trablesi » (CIN imprimé 149654358)
    exp_cin, exp_nom = ("12345678", "EmployeTest") if tag == "A" else ("149654358", "aminetrablesi")
    for it in items:
        if it["fileName"] != fname: continue
        print(f"   cin={it.get('cin')} | nom={it.get('employeeName')!r} | periode={it.get('period')!r} | net={it.get('netSalary')!r} | mat={it.get('matricule')!r}")
        if it.get("cin") != exp_cin: issues.append(f"{tag}: cin={it.get('cin')} attendu {exp_cin}")
        nom = (it.get("employeeName") or "").lower().replace(" ", "")
        if nom != exp_nom: issues.append(f"{tag}: nom={it.get('employeeName')!r}")
        if "01/08/26" not in (it.get("period") or ""): issues.append(f"{tag}: periode={it.get('period')!r}")
        if "1593" not in (it.get("netSalary") or ""): issues.append(f"{tag}: net={it.get('netSalary')!r}")
else:
    ok = 0
    for it in items:
        cin = it.get("cin") or ""
        t = truth_by_cin.get(cin)
        if t is None:
            issues.append(f"{tag}: cin inconnu={cin!r} ({it.get('fileName')})")
            continue
        nom_det = (it.get("employeeName") or "").upper().replace(" ", "")
        nom_vrai = (t["nom"] or "").upper().replace(" ", "")
        if nom_det == nom_vrai: ok += 1
        else: issues.append(f"{tag} {cin}: nom={it.get('employeeName')!r} attendu {t['nom']!r}")
    print(f"   -> {ok}/{len(TRUTH)} noms corrects")

if issues:
    print(f"\n{len(issues)} PROBLÈME(S):")
    for i in issues[:30]: print("  -", i)
    sys.exit(1)
print(f"\n[{tag}] TOUT EST CORRECT ✅")
