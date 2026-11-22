#!/usr/bin/env python3
"""Task 19 — E2E : le portail doit AFFICHER les fiches PDF à CIN alphanumérique.
Scénario utilisateur réel :
  1. accès créé par le RH (CIN saisi « SPEC-0001 », stocké normalisé « SPEC0001 »)
  2. employé tape « SPEC-0001 » à la connexion → session OK
  3. /api/my-fiches → les fiches PDF (bulletin_900001…) doivent apparaître
  4. /api/payslip/<id>/file → 200 (Ouvrir/Télécharger fonctionnent)
"""
import json, sys, urllib.request
sys.path.insert(0, "/home/z/my-project/scripts")
import portal_login_helper as plh

PORTAL = "http://localhost:3001"

def get(path, cookie):
    req = urllib.request.Request(PORTAL + path)
    req.add_header("Cookie", cookie)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()

ok = True
# 1+2. Connexion avec le CIN TEL QUE L'EMPLOYÉ LE TAPE (avec tiret)
try:
    cookie = plh.portal_login("SPEC-0001", send="SPEC-0001")
    print("1) connexion « SPEC-0001 » (avec tiret)       : OK")
except Exception as e:
    print("1) connexion « SPEC-0001 » (avec tiret)       : ÉCHEC ->", e); sys.exit(1)

# 3. my-fiches
st, body = get("/api/my-fiches", cookie)
data = json.loads(body.decode())
items = data.get("items") or []
pdfs = [i for i in items if i.get("fileName", "").endswith(".pdf")]
print(f"2) my-fiches                                  : {st} — {data.get('total')} fiche(s), dont {len(pdfs)} PDF")
for i in items:
    print("     -", i.get("fileName"))
if not pdfs:
    print("   !! AUCUNE FICHE PDF — bug Task 19 non corrigé"); ok = False

# 4. ouverture du fichier PDF
if pdfs:
    fid = pdfs[0]["id"]
    try:
        st, body = get(f"/api/payslip/{fid}/file?cin=SPEC-0001", cookie)
        print(f"3) /file cin=SPEC-0001 (avec tiret)           : {st} — {len(body)} octets", "✓" if st == 200 else "✗")
        if st != 200: ok = False
    except urllib.error.HTTPError as e:
        print(f"3) /file cin=SPEC-0001 (avec tiret)           : HTTP {e.code} ✗"); ok = False
    # sécurité : autre CIN refusé
    try:
        st, body = get(f"/api/payslip/{fid}/file?cin=07451236", cookie)
        print(f"4) /file autre CIN (doit être 403)            : {st}", "✓" if st == 403 else "✗ SÉCURITÉ!!")
        if st != 403: ok = False
    except urllib.error.HTTPError as e:
        print(f"4) /file autre CIN (doit être 403)            : HTTP {e.code} ✓"); ok = ok and e.code == 403

# 5. connexion avec la forme normalisée (sans tiret) — même accès
try:
    cookie2 = plh.portal_login("SPEC0001")
    st, body = get("/api/my-fiches", cookie2)
    d2 = json.loads(body.decode())
    print(f"5) connexion « SPEC0001 » + my-fiches         : {st} — {d2.get('total')} fiche(s) ✓")
except Exception as e:
    print("5) connexion « SPEC0001 »                     : ÉCHEC ->", e); ok = False

plh.cleanup()
print("cleanup OK —", "TOUT OK ✔" if ok else "ÉCHECS ✗")
sys.exit(0 if ok else 1)
