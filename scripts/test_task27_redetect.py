#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 27 (complément) : la REDÉTECTION répare les fiches importées AVANT le fix.
Simule une fiche historique importée avec le CIN FAUX (le N° CNSS 17700137 —
comportement d'avant Task 27), puis lance la redétection : le CIN doit devenir
140000911 sans toucher aux 107 fiches existantes."""
import json, sys, io, urllib.request, http.cookiejar

BASE = "http://localhost:3000"
FAILS = []

def check(name, cond, extra=""):
    print(("  [OK] " if cond else "  [!!] ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAILS.append(name)

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    h = {"Content-Type": "application/json"} if data is not None else {}
    r = urllib.request.Request(BASE + path, body, h, method=method)
    try:
        with opener.open(r, timeout=300) as resp:
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

st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin", st == 200, str(st))

# État initial
st, j = req("/api/payslips")
lst = j if isinstance(j, list) else (j.get("payslips") or j.get("items") or [])
n0 = len(lst)
print("  état initial :", n0, "fiches")

# 1) Crée une fiche « historique » via l'import réel — le contenu contient le
#    CIN 140000911 ; on écrase ensuite son champ cin avec le N° CNSS (état
#    d'avant-fix) directement en base, comme si l'ancien code l'avait détecté.
REAL = "/home/z/my-project/upload/bulletins_tunis_call_center_50_UNFICHIER (page 2) (1) (1).docx"
boundary = "----task27b"
with open(REAL, "rb") as f:
    content = f.read()
body = io.BytesIO()
body.write(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"repair_me.docx\"\r\n"
            "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n" % boundary).encode())
body.write(content)
body.write(("\r\n--%s--\r\n" % boundary).encode())
r = urllib.request.Request(BASE + "/api/payslips/upload", body.getvalue(),
    {"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
with opener.open(r, timeout=300) as resp:
    j = json.loads(resp.read())
item = (j.get("results") or [j])[0]
fid = item.get("id")
check("fiche importée (CIN correct post-fix)", item.get("cin") == "140000911", repr(item.get("cin")))

# 2) Simule l'état historique : cin = N° CNSS (17700137)
import sqlite3
db = sqlite3.connect("/home/z/my-project/db/custom.db")
db.execute("UPDATE Payslip SET cin='17700137' WHERE id=?", (fid,))
db.commit()
db.close()
print("  champ cin écrasé en base avec le N° CNSS 17700137 (simulation avant-fix)")

# 3) Redétection globale
st, j = req("/api/payslips/redetect", {}, method="POST")
check("redétection -> 200", st == 200, str(st))

# 4) Vérifie la réparation
st, j = req("/api/payslips")
lst = j if isinstance(j, list) else (j.get("payslips") or j.get("items") or [])
mine = [x for x in lst if x["id"] == fid]
check("fiche toujours présente", len(mine) == 1)
if mine:
    check("CIN réparé par la redétection = 140000911", mine[0].get("cin") == "140000911",
          repr(mine[0].get("cin")))

# 5) Aucune autre fiche modifiée
check("nombre de fiches inchangé", len(lst) == n0 + 1, str(len(lst)) + " vs " + str(n0 + 1))

# 6) Nettoyage
req("/api/payslips/" + fid, method="DELETE")
st, j = req("/api/payslips")
lst = j if isinstance(j, list) else (j.get("payslips") or j.get("items") or [])
check("nettoyage : base à l'état initial", len(lst) == n0, str(len(lst)))

print("")
if FAILS:
    print("ÉCHEC :", FAILS); sys.exit(1)
print("REDÉTECTION OK (Task 27)")
