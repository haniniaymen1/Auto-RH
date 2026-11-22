#!/usr/bin/env python3
# Test de bout en bout des NOUVEAUX FORMATS d'import (ZIP / XLSX / DOCX / PNG)
# sur le site réel — principe : tous les formats passent par le MÊME pipeline
# de détection (CIN, employé, période, net, matricule), aucune règle modifiée.
#
#  1. login admin
#  2. nettoyage des restes d'exécutions précédentes (par CIN de test + id)
#  3. XLSX 2 feuilles          -> 2 fiches créées (2 CIN)
#  4. XLSX 1 feuille           -> 1 fiche
#  5. DOCX 1 fiche             -> 1 fiche
#  6. DOCX 2 fiches            -> 2 fiches créées
#  7. PNG image (OCR)          -> 1 fiche
#  8. ZIP mixte (xlsx+docx+png+pdf) -> 6 fiches créées (entryResults détaillés)
#  9. recherche admin par CIN  -> fiches trouvées
# 10. type MIME du fichier XLSX servi (route [id]/file)
# 11. portail 3001 : recherche CIN + ouverture fichier (200) + CIN partiel (403)
# 12. nettoyage final
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://localhost:3000"
PORTAIL = "http://localhost:3001"
DIR = Path("/home/z/my-project/scripts/fixtures_multi")

# CIN de test (uniquement des CIN fictifs créés par ce test)
TEST_CINS = [
    "70011223", "70022334",  # xlsx 2 feuilles
    "70033445",              # xlsx 1 feuille
    "70044556",              # docx 1 fiche
    "70055667", "70066778",  # docx 2 fiches
    "70077889",              # png OCR
]

passn = 0
failn = 0


def check(label, ok, extra=""):
    global passn, failn
    if ok:
        passn += 1
        print(f"  PASS  {label}{(' — ' + extra) if extra else ''}")
    else:
        failn += 1
        print(f"  FAIL  {label}{(' — ' + extra) if extra else ''}")


def http(method, url, data=None, headers=None, cookie=None):
    req = urllib.request.Request(url, method=method, data=data)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def header(hdrs, name):
    """Recherche d'en-tête insensible à la casse."""
    for k, v in hdrs.items():
        if k.lower() == name.lower():
            return v
    return ""


def upload_files(paths, cookie):
    boundary = "----pb" + uuid.uuid4().hex
    parts = []
    for p in paths:
        data = Path(p).read_bytes()
        name = Path(p).name
        ctype = {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".zip": "application/zip",
        }.get(Path(p).suffix.lower(), "application/octet-stream")
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n".encode() + data + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    st, hdrs, body = http(
        "POST", BASE + "/api/payslips/upload", b"".join(parts),
        {"Content-Type": f"multipart/form-data; boundary={boundary}"}, cookie,
    )
    return st, json.loads(body)


def delete_by_cin(cookie):
    deleted = 0
    for cin in TEST_CINS:
        st, _, body = http("GET", BASE + f"/api/payslips?cin={cin}", cookie=cookie)
        if st != 200:
            continue
        for it in json.loads(body).get("items", []):
            http("DELETE", BASE + f"/api/payslips/{it['id']}", cookie=cookie)
            deleted += 1
    return deleted


# ---- 1. Login ----
print("== 1) Login admin ==")
st, hdrs, body = http("POST", BASE + "/api/auth/login",
                      json.dumps({"email": "it@demo.tn", "password": "demo1234", "remember": True}).encode(),
                      {"Content-Type": "application/json"})
setc = hdrs.get("Set-Cookie", "") or hdrs.get("set-cookie", "")
cookie = setc.split(";")[0] if setc else ""
check(f"login (HTTP {st})", st in (200, 201) and cookie, cookie[:30])

# ---- 2. Nettoyage préalable (ré-exécutable) ----
print("== 2) Nettoyage des exécutions précédentes ==")
n = delete_by_cin(cookie)
check(f"anciennes fiches de test supprimées ({n})", True)

# ---- 3-7. Imports unitaires des nouveaux formats ----
def check_common_fields(label, r, cin, period_prefix):
    check(f"{label} : SUCCESS", r.get("status") == "SUCCESS", r.get("message", "")[:80])
    check(f"{label} : CIN={cin}", r.get("cin") == cin, f"reçu={r.get('cin')}")
    check(f"{label} : période détectée", (r.get("period") or "").startswith(period_prefix), f"reçu={r.get('period')}")
    check(f"{label} : nom détecté", bool(r.get("employeeName")), f"reçu={r.get('employeeName')}")
    check(f"{label} : net détecté", bool(r.get("netSalary")), f"reçu={r.get('netSalary')}")

print("== 3) XLSX 2 feuilles (2 employés) ==")
st, res = upload_files([DIR / "classeur_2_fiches.xlsx"], cookie)
r = res["results"][0]
check(f"upload HTTP {st}", st == 200)
check_common_fields("xlsx2", r, "70011223", "01/2026")
check("xlsx2 : 2 fiches créées", r.get("created") == 2, f"created={r.get('created')}")
cins_items = sorted(i["cin"] for i in (r.get("items") or []))
check("xlsx2 : items CIN 70011223+70022334", cins_items == ["70011223", "70022334"], str(cins_items))
ID_XLSX2 = r.get("id")
# les 2 enregistrements 'items' doivent porter période/nom/net de CHAQUE feuille
it0 = (r.get("items") or [{}])[0]
check("xlsx2 : items[0] période 01/2026", (it0.get("period") or "").startswith("01/2026"), f"reçu={it0.get('period')}")

print("== 4) XLSX 1 feuille ==")
st, res = upload_files([DIR / "classeur_1_fiche.xlsx"], cookie)
r = res["results"][0]
check_common_fields("xlsx1", r, "70033445", "03/2026")

print("== 5) DOCX 1 fiche ==")
st, res = upload_files([DIR / "fiche_word_1.docx"], cookie)
r = res["results"][0]
check_common_fields("docx1", r, "70044556", "04/2026")

print("== 6) DOCX 2 fiches dans 1 document ==")
st, res = upload_files([DIR / "fiche_word_2.docx"], cookie)
r = res["results"][0]
check(f"docx2 : SUCCESS", r.get("status") == "SUCCESS", r.get("message", "")[:80])
check("docx2 : 2 fiches créées", r.get("created") == 2, f"created={r.get('created')}")
cins_items = sorted(i["cin"] for i in (r.get("items") or []))
check("docx2 : items CIN 70055667+70066778", cins_items == ["70055667", "70066778"], str(cins_items))

print("== 7) PNG image (OCR direct) ==")
st, res = upload_files([DIR / "fiche_image.png"], cookie)
r = res["results"][0]
check_common_fields("png", r, "70077889", "07/2026")

# ---- 8. ZIP mixte ----
print("== 8) ZIP mixte (XLSX + DOCX + PNG + PDF) ==")
st, res = upload_files([DIR / "archive_fiches.zip"], cookie)
r = res["results"][0]
check(f"zip : HTTP {st}", st == 200)
check("zip : SUCCESS", r.get("status") == "SUCCESS", r.get("message", "")[:100])
check("zip : 6 fiches créées au total", r.get("created") == 6, f"created={r.get('created')}")
entries = {e.get("fileName"): e for e in (r.get("entryResults") or [])}
check("zip : 4 fichiers traités", len(entries) == 4, str(list(entries)))
check("zip : xlsx -> 2 fiches", entries.get("classeur_2_fiches.xlsx", {}).get("created") == 2)
check("zip : docx -> 2 fiches", entries.get("fiche_word_2.docx", {}).get("created") == 2)
check("zip : png -> 1 fiche OCR CIN 70077889", entries.get("fiche_image.png", {}).get("cin") == "70077889")
check("zip : pdf -> 1 fiche (chemin historique)", entries.get("fiche_de_paie_01.pdf", {}).get("status") == "SUCCESS")
# ID de la fiche PDF créée depuis le ZIP (pour nettoyage ciblé)
ID_ZIP_PDF = entries.get("fiche_de_paie_01.pdf", {}).get("id")

# ---- 9. Recherche admin par CIN ----
# NB : le ZIP contient les MÊMES échantillons que les imports unitaires
# -> chaque CIN de ces échantillons existe en 2 exemplaires (attendu).
print("== 9) Recherche admin par CIN (nouveaux formats) ==")
st, _, body = http("GET", BASE + "/api/payslips?cin=70011223", cookie=cookie)
items = json.loads(body).get("items", [])
check("recherche 70011223 -> 2 fiches (direct + ZIP)", st == 200 and len(items) == 2, f"items={len(items)}")
check("recherche : nom employé présent", bool(items and items[0].get("employeeName")))
st, _, body = http("GET", BASE + "/api/payslips?cin=70033445", cookie=cookie)
items1 = json.loads(body).get("items", [])
check("recherche 70033445 -> 1 fiche (xlsx 1 feuille)", st == 200 and len(items1) == 1, f"items={len(items1)}")
st, _, body = http("GET", BASE + "/api/payslips?cin=70077889", cookie=cookie)
items_png = json.loads(body).get("items", [])
check("recherche 70077889 (PNG/OCR) -> 2 fiches", st == 200 and len(items_png) == 2, f"items={len(items_png)}")

# ---- 10. Type MIME du fichier Excel servi ----
print("== 10) Fichier original servi (type MIME) ==")
if ID_XLSX2:
    st, hdrs, _ = http("GET", BASE + f"/api/payslips/{ID_XLSX2}/file", cookie=cookie)
    ct = header(hdrs, "Content-Type").lower()
    check("xlsx : MIME spreadsheetml", st == 200 and "spreadsheetml" in ct, f"HTTP {st}, CT={ct[:60]}")
else:
    check("xlsx : id disponible", False, "ID_XLSX2 manquant")

# ---- 11. Portail 3001 (CIN unique = 70033445, fiche Excel) ----
print("== 11) Portail public (3001) ==")
st, _, body = http("GET", PORTAIL + "/api/search?cin=70033445")
data = json.loads(body)
check("portail : recherche 70033445 -> 1 fiche", st == 200 and data.get("total") == 1, f"total={data.get('total')}")
if data.get("items"):
    pid = data["items"][0]["id"]
    st, hdrs, _ = http("GET", PORTAIL + f"/api/payslip/{pid}/file?cin=70033445")
    ct = header(hdrs, "Content-Type").lower()
    check("portail : ouverture fiche XLSX (200 + MIME ok)", st == 200 and "spreadsheetml" in ct, f"HTTP {st}, CT={ct[:50]}")
    st, _, body = http("GET", PORTAIL + f"/api/payslip/{pid}/file?cin=70033")
    check("portail : CIN partiel -> 403", st == 403, f"HTTP {st}")
else:
    check("portail : item disponible", False, "aucun item")

# ---- 12. Nettoyage final ----
print("== 12) Nettoyage final ==")
n = delete_by_cin(cookie)
if ID_ZIP_PDF:
    http("DELETE", BASE + f"/api/payslips/{ID_ZIP_PDF}", cookie=cookie)
    n += 1
check(f"fiches de test supprimées ({n})", n >= 12, f"{n} supprimée(s)")

print("")
print(f"=== RÉSULTAT : {passn} PASS / {failn} FAIL ===")
sys.exit(1 if failn else 0)
