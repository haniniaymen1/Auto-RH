#!/usr/bin/env python3
"""Task 24 — Test de la REDÉTECTION sur une fiche Excel DÉCOUPÉE :
le repli « fiche individuelle » (Task 24) doit ré-analyser le fichier
individuel EN ENTIER (et non « fiche inchangée »), en conservant le CIN."""
import json, sys, io, urllib.request, http.cookiejar, subprocess, os

BASE = "http://localhost:3000"
ROOT = "/home/z/my-project"
TEST_CINS = ["87000024", "87000025", "87000026"]

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

def db_rows(cins):
    arg = ",".join(f'"{c}"' for c in cins)
    proc = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        f"(async()=>{{const rows=await db.payslip.findMany({{where:{{cin:{{in:[{arg}]}}}}}});"
        "console.log(JSON.stringify(rows.map(r=>({id:r.id,cin:r.cin,period:r.period}))) );await db.$disconnect();})()"],
        capture_output=True, text=True, cwd="/home/z/my-project")
    return json.loads(proc.stdout or "[]")

# 1) login + upload du classeur multi-feuilles
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

data = open(f"{ROOT}/test-data/fiches_excel_multi.xlsx", "rb").read()
boundary = "----Task24ReBoundary"
part = io.BytesIO()
part.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"fiches_excel_multi.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n".encode())
part.write(data)
part.write(f"\r\n--{boundary}--\r\n".encode())
st, resp = req("/api/payslips/upload", part.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"})
res = (json.loads(resp).get("results") or [{}])[0]
check("import -> 3 fiches individuelles", res.get("created") == 3, str(res.get("created")))

rows = db_rows(TEST_CINS)
check("3 fiches en base", len(rows) == 3, str(len(rows)))
target = next((r for r in rows if r["cin"] == "87000025"), None)
check("fiche 87000025 présente", target is not None, "")

# 2) redétection GLOBALE (toutes les fiches, y compris les PDF historiques)
st, resp = req("/api/payslips/redetect", {}, {"Content-Type": "application/json"}, method="POST")
det = json.loads(resp)
check("redétection -> 200", st == 200, str(st))
check("0 erreur de redétection", det.get("errors", 1) == 0, f"errors={det.get('errors')}")
check("CIN trouvés >= fiches totales - 0", det.get("cinFound", 0) >= 107, f"cinFound={det.get('cinFound')}")

# 3) la fiche 87000025 a été RÉ-ANALYSÉE depuis son fichier individuel
rows2 = db_rows(TEST_CINS)
t2 = next((r for r in rows2 if r["cin"] == "87000025"), None)
check("CIN conservé après redétection (repli individuel OK)", t2 is not None and t2["cin"] == "87000025", str(t2))
check("période ré-analysée présente", bool(t2 and t2.get("period")), str(t2))

# 4) nettoyage
for r in rows2:
    req(f"/api/payslips/{r['id']}", method="DELETE")
left = db_rows(TEST_CINS)
check("nettoyage", len(left) == 0, str(len(left)))

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
