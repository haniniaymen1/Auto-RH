#!/usr/bin/env python3
"""Task 25 — Test de la REDÉTECTION sur des fiches Word DÉCOUPÉES :
le repli « fiche individuelle découpée » (Task 25, miroir Tasks 23/24)
doit ré-analyser le fichier Word individuel EN ENTIER (et non « fiche
inchangée »), en conservant le CIN, le nom et la période."""
import json, sys, io, urllib.request, http.cookiejar, subprocess, os

BASE = "http://localhost:3000"
ROOT = "/home/z/my-project"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FIX = f"{ROOT}/scripts/fixtures_docx"
TEST_CINS = ["70055667", "70066778", "70077889"]

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None, headers=None, method=None):
    h = dict(headers or {})
    body = None
    if data is not None and isinstance(data, dict):
        body = json.dumps(data).encode(); h["Content-Type"] = "application/json"
    elif data is not None:
        body = data
    r = urllib.request.Request(BASE + path, body, h, method=method)
    try:
        with op.open(r, timeout=300) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    ok += 1 if cond else 0
    fail += 0 if cond else 1
    print(("  ✔ " if cond else "  ✘ ") + name + ((" | " + extra) if extra else ""))

def db_rows():
    proc = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        "(async()=>{const rows=await db.payslip.findMany({where:{OR:["
        "{cin:{in:['70055667','70066778','70077889','4001','4002','4003']}},"
        "{fileName:{startsWith:'fiche_word_'}}]}});"
        "console.log(JSON.stringify(rows.map(r=>({id:r.id,cin:r.cin,fileName:r.fileName,"
        "employeeName:r.employeeName,period:r.period}))));await db.$disconnect();})()"],
        capture_output=True, text=True, cwd=ROOT)
    return json.loads(proc.stdout or "[]")

def upload_file(path_on_disk, name, mime):
    data = open(path_on_disk, "rb").read()
    boundary = "----Task25RdBoundary"
    part = io.BytesIO()
    part.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    part.write(data)
    part.write(f"\r\n--{boundary}--\r\n".encode())
    return req("/api/payslips/upload", part.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"})

# 0) login + pré-nettoyage
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))
stale = db_rows()
for r in stale:
    req(f"/api/payslips/{r['id']}", method="DELETE")
check("pré-nettoyage", True, f"{len(stale)} supprimée(s)")

# 1) import du DOCX 3 fiches (sauts de page) -> 3 fiches individuelles
st, resp = upload_file(f"{FIX}/fiche_word_multipages.docx", "fiche_word_multipages.docx", DOCX_MIME)
res = (json.loads(resp).get("results") or [{}])[0]
check("import 3 fiches individuelles", res.get("created") == 3, str(res.get("created")))
rows = db_rows()
check("3 fiches en base", len(rows) == 3, str(len(rows)))
before = {r["id"]: (r["cin"], r["employeeName"], r["period"]) for r in rows}

# 2) redétection GLOBALE
st, resp = req("/api/payslips/redetect", {}, method="POST")
check("redétection -> 200", st == 200, str(st))
rd = json.loads(resp)
check("redétection : 0 erreur", (rd.get("errors") or 0) == 0, str(rd)[:160])

# 3) les fiches découpées conservent CIN / nom / période (ré-analyse du
#    fichier INDIVIDUEL — pas « fiche inchangée »)
rows2 = db_rows()
check("toujours 3 fiches", len(rows2) == 3, str(len(rows2)))
same = sum(1 for r in rows2 if before.get(r["id"]) == (r["cin"], r["employeeName"], r["period"]))
check("CIN/nom/période conservés sur les 3", same == 3, f"{same}/3")
names = sorted(r["employeeName"] or "" for r in rows2)
check("noms ré-analysés depuis les fichiers individuels",
      names == ["CHOUIKHA Rachid", "EMPLOYE Test", "JAZIRI Leila"], str(names))
periods = sorted(r["period"] or "" for r in rows2)
check("périodes 05/06/07-2026", periods == ["05/2026", "06/2026", "07/2026"], str(periods))

# 4) nettoyage
deleted = 0
for r in db_rows():
    st, _ = req(f"/api/payslips/{r['id']}", method="DELETE")
    deleted += 1 if st in (200, 204) else 0
check("nettoyage (base à 107)", len(db_rows()) == 0, f"{deleted} supprimée(s)")

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
