#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 28 — NON-RÉGRESSION E2E : le VRAI classeur « 1 bulletin par LIGNE »
(bulletins_specimen_50.xlsx : feuille « Bulletins » avec colonnes Matricule |
Nom | … | N° CNSS | N° CIN | …) doit toujours être découpé en fiches
individuelles (ici fiches ÉTIQUETÉES, une par ligne)."""
import json, sys, urllib.request, http.cookiejar, io, os, sqlite3

BASE = "http://localhost:3000"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
FAILS = []

def check(name, cond, extra=""):
    print(("  [OK] " if cond else "  [!!] ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAILS.append(name)

def req(path, data=None, method=None):
    body = None
    h = {}
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, body, h, method=method)
    try:
        with opener.open(r, timeout=180) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None

def upload_file(path_on_disk, name, mime):
    boundary = "----task28rtb"
    with open(path_on_disk, "rb") as f:
        content = f.read()
    body = io.BytesIO()
    body.write(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
                "Content-Type: %s\r\n\r\n" % (boundary, name, mime)).encode())
    body.write(content)
    body.write(("\r\n--%s--\r\n" % boundary).encode())
    r = urllib.request.Request(
        BASE + "/api/payslips/upload", body.getvalue(),
        {"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    with opener.open(r, timeout=600) as resp:
        return resp.status, json.loads(resp.read())

def all_fiches():
    st, j = req("/api/payslips")
    return (j if isinstance(j, list) else (j.get("payslips") or j.get("items") or []))

PREFIX = "bulletins_specimen_50"

print("== Login admin ==")
st, j = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

for x in list(all_fiches()):
    if (x.get("fileName") or "").startswith(PREFIX):
        req("/api/payslips/" + x["id"], method="DELETE")

print("== Import du classeur TABLEAU PAR LIGNES (feuille Bulletins, 50 lignes) ==")
st, j = upload_file("/home/z/my-project/upload/bulletins_specimen_50.xlsx",
                    "bulletins_specimen_50.xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
check("upload -> 200", st == 200, str(st))
if isinstance(j, list):
    j = j[0] if j else {}
if isinstance(j, dict) and isinstance(j.get("results"), list) and j["results"]:
    j = j["results"][0]
created = j.get("created")
check("50 fiches créées (1 bulletin = 1 ligne)", created == 50,
      str(created) + " — " + str(j.get("message"))[:110])
items = j.get("items") or []
cins = sorted({it.get("cin") for it in items if it.get("cin")})
check("50 CIN distincts", len(cins) == 50, str(len(cins)))

con = sqlite3.connect("/home/z/my-project/db/custom.db")
rows = con.execute(
    "SELECT storedName, COUNT(*) c FROM Payslip WHERE fileName LIKE ? GROUP BY storedName",
    (PREFIX + "%",)).fetchall()
con.close()
check("fichiers individuels distincts", len(rows) == 50 and all(r[1] == 1 for r in rows),
      str(len(rows)) + " / 50")

removed = 0
for x in all_fiches():
    if (x.get("fileName") or "").startswith(PREFIX):
        req("/api/payslips/" + x["id"], method="DELETE")
        removed += 1
check("fiches de test supprimées", removed == 50, str(removed))
check("base rendue à l'état initial (107 fiches)", len(all_fiches()) == 107, str(len(all_fiches())))

print("")
if FAILS:
    print("ÉCHEC :", len(FAILS), "->", FAILS)
    sys.exit(1)
print("NON-RÉGRESSION TABLEAU PAR LIGNES : OK (Task 28)")
