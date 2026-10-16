#!/usr/bin/env python3
"""Vérification « detection fausse » : upload E2E des 5 fichiers de l'utilisateur
et comparaison systématique avec la vérité terrain.

Fichiers testés :
  A. Docs From Bh225_260914145812 (1).pdf     -> Amine trablesi (PDF image)
  B. Docs From Bh225_260914145812 (1)-1.png   -> Amine trablesi (PNG direct, OCR)
  C. bulletins_specimen_50 (1).pdf            -> 50 bulletins dans 1 PDF (texte)
  D. bulletins_specimen_50_PDF (1).zip        -> 50 PDF individuels
  E. bulletins_specimen_50_PNG (1).zip        -> 50 PNG (OCR)
"""
import json, sys, requests

BASE = "http://localhost:3000"
UP = "/home/z/my-project/upload/"
TRUTH = json.load(open("/home/z/my-project/scripts/specimen_truth.json"))
truth_by_cin = {t["cin"]: t for t in TRUTH}

s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "it@demo.tn", "password": "demo1234"}, timeout=30)
assert r.status_code in (200, 201), "login échoué"

def upload(fname, mime):
    with open(UP + fname, "rb") as f:
        r = s.post(f"{BASE}/api/payslips/upload",
                   files={"files": (fname, f, mime)}, timeout=590)
    assert r.status_code in (200, 201), f"upload {fname}: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data.get("results") or data.get("items") or []

def show(tag, recs):
    print(f"\n===== {tag} : {len(recs)} enregistrement(s) =====")
    for rec in recs[:4]:
        print(f"  cin={rec.get('cin')} | nom={rec.get('employeeName')!r} | "
              f"periode={rec.get('period')!r} | net={rec.get('netSalary')!r} | "
              f"mat={rec.get('matricule')!r}")
    if len(recs) > 4: print(f"  ... (+{len(recs)-4})")
    return recs

all_issues = []

# ---------- A. PDF image Amine trablesi ----------
recs = show("A. Docs (1).pdf (PDF image)", upload("Docs From Bh225_260914145812 (1).pdf", "application/pdf"))
for rec in recs:
    if rec.get("cin") != "149654358": all_issues.append(f"A: cin={rec.get('cin')} attendu 149654358")
    nom = (rec.get("employeeName") or "").lower().replace(" ", "")
    if nom != "aminetrablesi": all_issues.append(f"A: nom={rec.get('employeeName')!r} attendu 'Amine trablesi'")
    if "01/08/26" not in (rec.get("period") or ""): all_issues.append(f"A: periode={rec.get('period')!r} attendu 01/08/26-31/08/26")
    if "1593" not in (rec.get("netSalary") or ""): all_issues.append(f"A: net={rec.get('netSalary')!r} attendu 1593,851")

# ---------- B. PNG direct Amine trablesi ----------
recs = show("B. Docs (1)-1.png (PNG direct)", upload("Docs From Bh225_260914145812 (1)-1.png", "image/png"))
for rec in recs:
    if rec.get("cin") != "149654358": all_issues.append(f"B: cin={rec.get('cin')} attendu 149654358")
    nom = (rec.get("employeeName") or "").lower().replace(" ", "")
    if nom != "aminetrablesi": all_issues.append(f"B: nom={rec.get('employeeName')!r} attendu 'Amine trablesi'")
    if "01/08/26" not in (rec.get("period") or ""): all_issues.append(f"B: periode={rec.get('period')!r}")
    if "1593" not in (rec.get("netSalary") or ""): all_issues.append(f"B: net={rec.get('netSalary')!r} attendu 1593,851")

# ---------- C. 50 bulletins dans 1 PDF (texte) ----------
recs = show("C. bulletins_specimen_50 (1).pdf (1 PDF, 50 fiches)", upload("bulletins_specimen_50 (1).pdf", "application/pdf"))
ok_c = 0
for rec in recs:
    cin = rec.get("cin") or ""
    t = truth_by_cin.get(cin)
    if t is None:
        all_issues.append(f"C: cin inconnu={cin!r} nom={rec.get('employeeName')!r}")
        continue
    nom_det = (rec.get("employeeName") or "").upper().replace(" ", "")
    nom_vrai = (t["nom"] or "").upper().replace(" ", "")
    if nom_det != nom_vrai:
        all_issues.append(f"C {cin}: nom={rec.get('employeeName')!r} attendu {t['nom']!r}")
    else:
        ok_c += 1
print(f"  -> C: {ok_c}/{len(TRUTH)} noms corrects par CIN")

# ---------- D. ZIP de 50 PDF ----------
recs = show("D. bulletins_specimen_50_PDF (1).zip", upload("bulletins_specimen_50_PDF (1).zip", "application/zip"))
ok_d = 0
for rec in recs:
    cin = rec.get("cin") or ""
    t = truth_by_cin.get(cin)
    if t is None:
        all_issues.append(f"D: cin inconnu={cin!r} nom={rec.get('employeeName')!r}")
        continue
    nom_det = (rec.get("employeeName") or "").upper().replace(" ", "")
    nom_vrai = (t["nom"] or "").upper().replace(" ", "")
    if nom_det != nom_vrai:
        all_issues.append(f"D {cin}: nom={rec.get('employeeName')!r} attendu {t['nom']!r}")
    else:
        ok_d += 1
print(f"  -> D: {ok_d}/{len(TRUTH)} noms corrects par CIN")

# ---------- E. ZIP de 50 PNG (OCR) ----------
recs = show("E. bulletins_specimen_50_PNG (1).zip (OCR)", upload("bulletins_specimen_50_PNG (1).zip", "application/zip"))
ok_e = 0
for rec in recs:
    cin = rec.get("cin") or ""
    t = truth_by_cin.get(cin)
    if t is None:
        all_issues.append(f"E: cin inconnu={cin!r} nom={rec.get('employeeName')!r}")
        continue
    nom_det = (rec.get("employeeName") or "").upper().replace(" ", "")
    nom_vrai = (t["nom"] or "").upper().replace(" ", "")
    if nom_det != nom_vrai:
        all_issues.append(f"E {cin}: nom={rec.get('employeeName')!r} attendu {t['nom']!r}")
    else:
        ok_e += 1
print(f"  -> E: {ok_e}/{len(TRUTH)} noms corrects par CIN")

# ---------- Bilan ----------
print("\n================ BILAN ================")
if all_issues:
    print(f"{len(all_issues)} PROBLÈME(S) DE DÉTECTION :")
    for i in all_issues[:40]: print("  -", i)
    sys.exit(1)
else:
    print("AUCUNE FAUSSE DÉTECTION — tout est correct ✅")
