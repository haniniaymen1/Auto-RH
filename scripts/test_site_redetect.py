#!/usr/bin/env python3
# Test de bout en bout sur le site réel :
#  1. login admin
#  2. import des 20 fiches de l'utilisateur (upload multipart)
#  3. POST /api/payslips/redetect (nouvelle route) sur TOUTES les fiches
#  4. recherche admin : CIN complet -> 1 fiche ; partiels -> 0
#  5. portail (3001) : recherche + ouverture PDF (200) + partiel (403)
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://localhost:3000"
PORTAIL = "http://localhost:3001"
DIR = Path("/home/z/my-project/upload/files_extracted")

CINS = {
    "fiche_paie_01.pdf": "32181960", "fiche_paie_02.pdf": "26542351",
    "fiche_paie_03.pdf": "95931034", "fiche_paie_04.pdf": "92832764",
    "fiche_paie_05.pdf": "39537672", "fiche_paie_06.pdf": "10122691",
    "fiche_paie_07.pdf": "27048281", "fiche_paie_08.pdf": "15430391",
    "fiche_paie_09.pdf": "38346578", "fiche_paie_10.pdf": "10518347",
    "fiche_paie_11.pdf": "56670106", "fiche_paie_12.pdf": "81080132",
    "fiche_paie_13.pdf": "68723430", "fiche_paie_14.pdf": "19136193",
    "fiche_paie_15.pdf": "46247510", "fiche_paie_16.pdf": "42784980",
    "fiche_paie_17.pdf": "93534874", "fiche_paie_18.pdf": "80112805",
    "fiche_paie_19.pdf": "86923226", "fiche_paie_20.pdf": "33754330",
}

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
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

# ---- 1. Login (JSON) ----
print("== 1) Login admin ==")
st, hdrs, body = http("POST", BASE + "/api/auth/login",
                      json.dumps({"email": "it@demo.tn", "password": "demo1234", "remember": True}).encode(),
                      {"Content-Type": "application/json"})
setc = hdrs.get("Set-Cookie", "") or hdrs.get("set-cookie", "")
cookie = setc.split(";")[0] if setc else ""
check(f"login (HTTP {st})", st in (200, 201) and cookie, cookie[:30])

# ---- 2. Nettoyage : suppression des copies précédentes (test ré-exécutable) ----
print("== 2) Nettoyage des copies précédentes ==")
st, _, body = http("GET", BASE + "/api/payslips?limit=500", cookie=cookie)
lst = json.loads(body)
deleted = 0
for it in lst.get("items", []):
    if it.get("fileName") in CINS:
        st2, _, _ = http("DELETE", BASE + f"/api/payslips/{it['id']}", cookie=cookie)
        if st2 in (200, 201, 204):
            deleted += 1
check(f"anciennes copies supprimées ({deleted})", True, f"{deleted} fiche(s)")

# ---- 3. Import des 20 fiches ----
print("== 3) Import des 20 fiches de l'utilisateur ==")
boundary = "----pb" + uuid.uuid4().hex
parts = []
for fname in CINS:
    data = (DIR / fname).read_bytes()
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{fname}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n".encode() + data + b"\r\n"
    )
parts.append(f"--{boundary}--\r\n".encode())
st, hdrs, body = http("POST", BASE + "/api/payslips/upload", b"".join(parts),
                      {"Content-Type": f"multipart/form-data; boundary={boundary}"}, cookie)
res = json.loads(body)
ok_n = res.get("success", 0)
check(f"upload 20/20 (HTTP {st})", st == 200 and ok_n == 20, f"success={ok_n}, failed={res.get('failed')}")
# période détectée dès l'import ?
per_ok = sum(1 for r in res.get("results", []) if r.get("period"))
check(f"période détectée dès l'import : {per_ok}/20", per_ok == 20)
cin_import = sum(1 for r in res.get("results", []) if r.get("cin"))
check(f"CIN détecté dès l'import : {cin_import}/20", cin_import == 20)

# ---- 4. Redétection globale (route NOUVELLE) ----
print("== 4) POST /api/payslips/redetect (toutes fiches, anciennes comprises) ==")
st, hdrs, body = http("POST", BASE + "/api/payslips/redetect", b"{}", {"Content-Type": "application/json"}, cookie)
red = json.loads(body)
check(f"redetect OK (HTTP {st})", st == 200, f"total={red.get('total')} updated={red.get('updated')} errors={red.get('errors')}")
check(f"redetect : CIN trouvés {red.get('cinFound')}/{red.get('total')}", red.get("errors") == 0)
# les périodes des 20 nouvelles fiches après redetect
per20 = [d for d in red.get("details", []) if d["fileName"] in CINS and d["status"] == "OK" and d["period"]]
check(f"redetect : périodes sur nos 20 = {len(per20)}/20", len(per20) == 20)

# ---- 5. Recherche ADMIN : exact -> 1 ; partiel -> 0 ----
print("== 5) Recherche ADMIN (port 3000) ==")
for fname, cin in CINS.items():
    st, _, body = http("GET", BASE + f"/api/payslips?cin={cin}", cookie=cookie)
    d = json.loads(body)
    files = [i["fileName"] for i in d.get("items", [])]
    check(f"admin {cin} -> 1 fiche exacte", st == 200 and d.get("total") == 1 and d.get("exact") and files == [fname],
          f"total={d.get('total')} {files[:1]}")

partials = ["3218196", "2181960", "2654235", "542351", "9593", "1034", "9283276", "3953767",
            "1012269", "122691", "2704828", "1543039", "3834657", "1051834", "5667010",
            "8108013", "6872343", "1913619", "4624751", "4278498", "9353487", "8011280",
            "8692322", "3375433", "26 542 35"]  # + variante mal saisie
leaks = []
for p in partials:
    st, _, body = http("GET", BASE + f"/api/payslips?cin={urllib.request.quote(p)}", cookie=cookie)
    d = json.loads(body)
    if d.get("total", 0) != 0:
        leaks.append((p, d.get("total")))
check(f"admin : {len(partials)} recherches partielles -> 0 résultat", not leaks, f"fuites={leaks}")

# saisie avec séparateurs (comme écrit dans le PDF) doit aussi marcher
for q, fname in [("26 542 351", "fiche_paie_02.pdf"), ("9593-1034", "fiche_paie_03.pdf"),
                 ("270.482.81", "fiche_paie_07.pdf"), ("38/346/578", "fiche_paie_09.pdf")]:
    st, _, body = http("GET", BASE + f"/api/payslips?cin={urllib.request.quote(q)}", cookie=cookie)
    d = json.loads(body)
    files = [i["fileName"] for i in d.get("items", [])]
    check(f"admin saisie « {q} » -> {fname}", d.get("total") == 1 and files == [fname], f"{files}")

# ---- 6. PORTAIL : recherche + ouverture PDF ----
# NB : le portail limite à 30 requêtes/minute/IP (anti-abus) -> pause entre requêtes.
print("== 6) PORTAIL employés (port 3001) ==")

def portail_get(path):
    """GET portail avec gestion du 429 (1 retry après pause)."""
    st, _, body = http("GET", PORTAIL + path)
    if st == 429:
        time.sleep(62)
        st, _, body = http("GET", PORTAIL + path)
    return st, body

ids = {}
first = True
for fname, cin in CINS.items():
    if not first:
        time.sleep(2.2)  # ~27 requêtes/minute, sous la limite
    first = False
    st, body = portail_get(f"/api/search?cin={cin}")
    d = json.loads(body)
    ok = st == 200 and d.get("total") == 1 and d["items"][0]["fileName"] == fname
    if ok:
        ids[fname] = d["items"][0]["id"]
    check(f"portail {cin} -> {fname}", ok, f"total={d.get('total')}")
    per = d["items"][0].get("period") if d.get("items") else None
    if per is not None:
        check(f"portail période {fname} = « {per} »", bool(per))

# ouverture PDF : CIN complet -> 200 ; partiel -> 403 ; sans CIN -> 400
# (limiteur "file" : 60/min -> pause courte avant les demandes de fichier)
time.sleep(2.2)
sample = "fiche_paie_02.pdf"
sid = ids[sample]
st, hdrs, body = http("GET", PORTAIL + f"/api/payslip/{sid}/file?cin=26542351")
check("portail ouverture PDF CIN complet -> 200", st == 200 and body[:5] == b"%PDF-", f"HTTP {st}")
st, _, body = http("GET", PORTAIL + f"/api/payslip/{sid}/file?cin=2654235")
check("portail ouverture PDF CIN partiel -> 403", st == 403, f"HTTP {st}")
time.sleep(2.2)
st, _, body = http("GET", PORTAIL + f"/api/payslip/{sid}/file")
check("portail ouverture PDF sans CIN -> 400", st == 400, f"HTTP {st}")
time.sleep(2.2)
st, body = portail_get("/api/search?cin=26%20542%20351")
d = json.loads(body)
check("portail saisie « 26 542 351 » (espaces) -> 1 fiche", d.get("total") == 1)
time.sleep(2.2)
st, body = portail_get("/api/search?cin=9593-1034")
d = json.loads(body)
check("portail saisie « 9593-1034 » (tiret) -> 1 fiche", d.get("total") == 1)

print(f"\n================ BILAN SITE : {passn} PASS / {failn} FAIL ================")
sys.exit(1 if failn else 0)
