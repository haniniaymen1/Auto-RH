#!/usr/bin/env python3
"""Task 24 — E2E : import d'un classeur Excel multi-feuilles -> fiches
INDIVIDUELLES découpées (1 feuille = 1 fiche), affectation par CIN,
téléchargement d'un fichier Excel individuel par employé."""
import json, sys, urllib.request, http.cookiejar, io, subprocess, os

BASE = "http://localhost:3000"
ROOT = "/home/z/my-project"
TMP_DIR = "/home/z/my-project/scripts/tmp_task24"
os.makedirs(TMP_DIR, exist_ok=True)

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

def upload_file(path_on_disk, name, mime):
    data = open(path_on_disk, "rb").read()
    boundary = "----Task24Boundary"
    part = io.BytesIO()
    part.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    part.write(data)
    part.write(f"\r\n--{boundary}--\r\n".encode())
    return len(data), req("/api/payslips/upload", part.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"})

created_ids = []

# CINs de test (uniques, jamais utilisés par les vraies fiches)
TEST_CINS = ["87000024", "87000025", "87000026", "88000061", "88000062", "88000063", "89000077"]

# 1) login admin
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

# 1-bis) PRÉ-NETTOYAGE : supprimer les résidus d'un éventuel run précédent
# (via Prisma directement — l'API list peut tronquer les résultats)
def db_ids_for(cins):
    arg = ",".join(f'"{c}"' for c in cins)
    proc = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        f"(async()=>{{const rows=await db.payslip.findMany({{where:{{cin:{{in:[{arg}]}}}}}});"
        "console.log(JSON.stringify(rows.map(r=>r.id)));await db.$disconnect();})()"],
        capture_output=True, text=True, cwd="/home/z/my-project")
    return json.loads(proc.stdout or "[]")

stale_ids = db_ids_for(TEST_CINS)
for pid in stale_ids:
    req(f"/api/payslips/{pid}", method="DELETE")
check("pré-nettoyage des résidus", True, f"{len(stale_ids)} fiche(s) supprimée(s)")

# ================================================================
# CAS 1 — CLASSEUR MULTI-FEUILLES (1 fiche par feuille)
# ================================================================
print("\n--- Cas 1 : classeur multi-feuilles (3 fiches) ---")
orig_size, (st, resp) = upload_file(f"{ROOT}/test-data/fiches_excel_multi.xlsx", "fiches_excel_multi.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
data = json.loads(resp)
check("upload classeur multi-feuilles -> 200", st == 200, str(st))
res = (data.get("results") or [{}])[0]
check("statut SUCCESS", res.get("status") == "SUCCESS", res.get("message", "")[:120])
check("3 fiches créées", res.get("created") == 3, str(res.get("created")))
check("message = division par fiche", "divisé par fiche de paie" in res.get("message", ""), res.get("message", "")[:140])
items = res.get("items") or []
check("items détaillés = 3", len(items) == 3, str(len(items)))
cins = sorted([i.get("cin") for i in items])
check("CINs affectés 87000024/25/26", cins == ["87000024", "87000025", "87000026"], str(cins))

# 2) base : chaque fiche a son PROPRE fichier xlsx individuel (vérif directe en base)
st, resp = req("/api/payslips?mode=list")
liste = json.loads(resp)
payslips = liste.get("payslips") or liste.get("items") or []
proc_db = subprocess.run(["node", "-e",
    "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
    "(async()=>{const cins=process.argv.slice(1);"
    "const rows=await db.payslip.findMany({where:{cin:{in:cins}}});"
    "console.log(JSON.stringify(rows.map(r=>({cin:r.cin,storedName:r.storedName,fileSize:r.fileSize,fileName:r.fileName,id:r.id}))));"
    "await db.$disconnect();})()",
    "87000024", "87000025", "87000026"], capture_output=True, text=True)
xls = json.loads(proc_db.stdout or "[]")
check("3 fiches XLS en base", len(xls) == 3, str(len(xls)))
check("storedName tous distincts", len(set(p["storedName"] for p in xls)) == 3, str([p["storedName"] for p in xls]))
check("extension .xlsx individuelle", all(p["storedName"].endswith(".xlsx") for p in xls), str([p["storedName"] for p in xls]))
sizes = [p.get("fileSize") for p in xls]
check("tailles individuelles < original", bool(sizes) and all(s < orig_size for s in sizes), f"max={max(sizes) if sizes else '?'} < {orig_size}")
names = sorted([p["fileName"] for p in xls])
check("noms affichés suffixés (feuille N)", all("(feuille " in n for n in names), str(names))
created_ids += [p["id"] for p in xls]

# 3) service du fichier : xlsx valide (PK), UNE feuille, contenu ISOLÉ, styles conservés
target = next(p for p in xls if p.get("cin") == "87000025")
st, fresp = req(f"/api/payslips/{target['id']}/file")
check("GET /file -> 200 + signature ZIP (xlsx)", st == 200 and fresp[:2] == b"PK", f"{st} {len(fresp)} octets")
with op.open(urllib.request.Request(BASE + f"/api/payslips/{target['id']}/file")) as hresp:
    ctype = hresp.headers.get("Content-Type", "")
check("Content-Type spreadsheetml", "spreadsheetml" in ctype, ctype)
tmp_x = f"{TMP_DIR}/fiche_87000025.xlsx"
open(tmp_x, "wb").write(fresp)
proc = subprocess.run(["node", f"{ROOT}/scripts/verify_xlsx_content.js", tmp_x, "87000025", "87000024", "87000026"], capture_output=True, text=True)
check("fichier individuel : 1 feuille, bon CIN, styles conservés, autres CINs absents", proc.returncode == 0, (proc.stdout + proc.stderr).strip()[:220])

# ================================================================
# CAS 2 — FEUILLE « 1 BULLETIN PAR LIGNE » (3 employés dans UNE feuille)
# ================================================================
print("\n--- Cas 2 : feuille tableau (1 bulletin par ligne) ---")
orig2, (st, resp) = upload_file(f"{ROOT}/test-data/bulletins_excel_table.xlsx", "bulletins_excel_table.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
data = json.loads(resp)
check("upload feuille tableau -> 200", st == 200, str(st))
res2 = (data.get("results") or [{}])[0]
check("statut SUCCESS", res2.get("status") == "SUCCESS", res2.get("message", "")[:120])
check("3 fiches créées (fiches étiquetées)", res2.get("created") == 3, str(res2.get("created")))
items2 = res2.get("items") or []
cins2 = sorted([i.get("cin") for i in items2])
check("CINs 88000061/62/63", cins2 == ["88000061", "88000062", "88000063"], str(cins2))

st, resp = req("/api/payslips?mode=list")
payslips = json.loads(resp).get("payslips") or []
proc_db2 = subprocess.run(["node", "-e",
    "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
    "(async()=>{const cins=process.argv.slice(1);"
    "const rows=await db.payslip.findMany({where:{cin:{in:cins}}});"
    "console.log(JSON.stringify(rows.map(r=>({cin:r.cin,storedName:r.storedName,fileSize:r.fileSize,fileName:r.fileName,id:r.id}))));"
    "await db.$disconnect();})()",
    "88000061", "88000062", "88000063"], capture_output=True, text=True)
rows = json.loads(proc_db2.stdout or "[]")
check("3 fiches « ligne » en base", len(rows) == 3, str(len(rows)))
check("storedName tous distincts", len(set(p["storedName"] for p in rows)) == 3, "")
created_ids += [p["id"] for p in rows]

target2 = next((p for p in rows if p.get("cin") == "88000062"), None)
check("fiche 88000062 présente", target2 is not None, "")
st, fresp2 = req(f"/api/payslips/{target2['id']}/file")
check("GET /file -> 200 + xlsx (PK)", st == 200 and fresp2[:2] == b"PK", f"{st} {len(fresp2)} o")
tmp_r = f"{TMP_DIR}/fiche_88000062.xlsx"
open(tmp_r, "wb").write(fresp2)
proc = subprocess.run(["node", f"{ROOT}/scripts/verify_xlsx_content.js", tmp_r, "88000062", "88000061", "88000063"], capture_output=True, text=True)
check("fiche étiquetée : bon CIN isolé, autres absents", proc.returncode == 0, (proc.stdout + proc.stderr).strip()[:220])

# ================================================================
# CAS 3 — CLASSEUR MONO-FICHE (chemin historique INCHANGÉ)
# ================================================================
print("\n--- Cas 3 : classeur mono-fiche (historique) ---")
orig3, (st, resp) = upload_file(f"{ROOT}/test-data/fiche_excel_simple.xlsx", "fiche_excel_simple.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
data = json.loads(resp)
res3 = (data.get("results") or [{}])[0]
check("statut SUCCESS", res3.get("status") == "SUCCESS", res3.get("message", "")[:120])
check("1 seule fiche (pas de division)", res3.get("created") is None, str(res3.get("created")))
check("CIN détecté 89000077", res3.get("cin") == "89000077", str(res3.get("cin")))
st, resp = req("/api/payslips?mode=list")
payslips = json.loads(resp).get("payslips") or []
mono_ids = db_ids_for(["89000077"])
check("fiche mono en base", len(mono_ids) == 1, str(len(mono_ids)))
if mono_ids:
    proc_mono = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        "(async()=>{const r=await db.payslip.findUnique({where:{id:'" + mono_ids[0] + "'}});"
        "console.log(JSON.stringify({fileSize:r.fileSize,storedName:r.storedName}));"
        "await db.$disconnect();})()"], capture_output=True, text=True, cwd="/home/z/my-project")
    m = json.loads(proc_mono.stdout or "{}")
    check("taille = classeur complet (historique)", m.get("fileSize") == orig3, f"{m.get('fileSize')} vs {orig3}")
    created_ids.append(mono_ids[0])

# 4) NETTOYAGE : suppression des fiches de test (base rendue à l'état initial)
print("\n--- Nettoyage ---")
deleted = 0
for pid in created_ids:
    st, _ = req(f"/api/payslips/{pid}", method="DELETE")
    deleted += 1 if st in (200, 204) else 0
check("fiches de test supprimées", deleted == len(created_ids), f"{deleted}/{len(created_ids)}")

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
