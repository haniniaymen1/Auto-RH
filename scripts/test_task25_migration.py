#!/usr/bin/env python3
"""Task 25 — Test de MIGRATION : un document Word PARTAGÉ (plusieurs fiches
-> un même .docx, état des imports antérieurs au découpage automatique) est
scindé par scripts/scinder-docx-multipages.js en fiches INDIVIDUELLES
(un .docx chiffré par employé, original déplacé dans _originaux/)."""
import json, sys, io, subprocess, os, time, urllib.request, http.cookiejar

BASE = "http://localhost:3000"
ROOT = "/home/z/my-project"
FIXTURE = f"{ROOT}/scripts/fixtures_docx/fiche_word_multipages.docx"
TMP_DIR = f"{ROOT}/scripts/tmp_task25"
os.makedirs(TMP_DIR, exist_ok=True)
SHARED_NAME = f"test-shared-{int(time.time()*1000)}.docx"
CINS = ["70055667", "70066778", "70077889"]
NAMES = ["JAZIRI Leila", "CHOUIKHA Rachid", "EMPLOYE Test"]
PERIODS = ["05/2026", "06/2026", "07/2026"]

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None, method=None):
    h = {}
    body = None
    if data is not None:
        body = json.dumps(data).encode(); h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, body, h, method=method)
    try:
        with op.open(r, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    ok += 1 if cond else 0
    fail += 0 if cond else 1
    print(("  ✔ " if cond else "  ✘ ") + name + ((" | " + extra) if extra else ""))

# 0) login
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

# 1) PRÉPARATION : fichier partagé chiffré + 3 fiches pointant dessus
prep = subprocess.run(["node", "-e", """
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT='/home/z/my-project';
// .env
const envPath=path.join(ROOT,'.env');
if(fs.existsSync(envPath)){for(const line of fs.readFileSync(envPath,'utf8').split(/\\r?\\n/)){const m=line.match(/^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$/);if(m&&process.env[m[1]]===undefined){process.env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}}}
const MAGIC=Buffer.from('PAIESAGE1','utf8');
const key=()=>crypto.scryptSync(process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY||process.env.AUTH_SECRET||'autorh-storage-local-a-changer-dans-env','autorh-storage-v1',32);
function encryptBuf(buf){const nonce=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key(),nonce);const enc=Buffer.concat([c.update(buf),c.final()]);return Buffer.concat([MAGIC,nonce,c.getAuthTag(),enc]);}
const src=fs.readFileSync(process.argv[1]);
const storedName=process.argv[2];
const dir=path.join(ROOT,'storage','payslips');
fs.writeFileSync(path.join(dir,storedName),encryptBuf(src));
console.log(JSON.stringify({storedName,size:src.length}));
""", FIXTURE, SHARED_NAME], capture_output=True, text=True, cwd=ROOT)
meta = json.loads(prep.stdout or "{}")
check("fichier partagé chiffré écrit", meta.get("size", 0) > 0, SHARED_NAME)

create = subprocess.run(["node", "-e", """
const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();
(async()=>{
  const [storedName,text]=process.argv.slice(1);
  const cins=['70055667','70066778','70077889'];
  const names=['JAZIRI Leila','CHOUIKHA Rachid','EMPLOYE Test'];
  const periods=['05/2026','06/2026','07/2026'];
  const norm=text.toUpperCase();
  for(let i=0;i<3;i++){
    await db.payslip.create({data:{
      fileName:'fiches_word_test.docx',storedName,fileSize:1000+i,
      content:text,normalizedContent:norm,cin:cins[i],employeeName:names[i],
      period:periods[i],netSalary:'2 320,000',matricule:'400'+(i+1),
      pageNumber:3,sourcePage:i+1}});
  }
  const rows=await db.payslip.findMany({where:{cin:{in:cins}}});
  console.log(JSON.stringify(rows.map(r=>({id:r.id,cin:r.cin}))));
  await db.$disconnect();
})()""", SHARED_NAME, "BULLETIN DE PAIE\nSociete : DEMO SARL\nC.I.N : 70055667\nC.I.N : 70066778\nC.I.N : 70077889"], capture_output=True, text=True, cwd=ROOT)
recs = json.loads(create.stdout or "[]")
check("3 fiches partagées créées en base", len(recs) == 3, str(len(recs)))

# 2) VÉRIFICATION (lecture seule)
proc = subprocess.run(["node", f"{ROOT}/scripts/scinder-docx-multipages.js", "--verifier"],
                      capture_output=True, text=True, cwd=ROOT)
out = proc.stdout + proc.stderr
check("mode --verifier : 1 document partagé détecté", "1 document(s) Word partagé" in out, out.strip().splitlines()[-4] if out.strip() else "")
check("mode --verifier : 3 pages reconnues", "3 page(s) reconnue(s)" in out, "")
check("mode --verifier : plages [1-1][2-2][3-3]", "[1-1]" in out and "[2-2]" in out and "[3-3]" in out, "")
check("mode --verifier : aucune modification", "fiches mises à jour : 0" in out, "")

# 3) SCINDAGE réel
proc = subprocess.run(["node", f"{ROOT}/scripts/scinder-docx-multipages.js"],
                      capture_output=True, text=True, cwd=ROOT)
out = proc.stdout + proc.stderr
check("scindage : 1 document scindé", "Documents scindés : 1" in out, out.strip().splitlines()[-4] if out.strip() else "")
check("scindage : 3 fiches mises à jour", "fiches mises à jour : 3" in out, "")
check("scindage : 0 erreur", "ignorés/erreurs : 0" in out, "")

# 4) chaque fiche sert SON fichier Word individuel (via l'API admin)
serve_ok = 0
for rec, cin in zip(recs, CINS):
    st, fdata = req(f"/api/payslips/{rec['id']}/file")
    if st != 200 or fdata[:2] != b"PK":
        continue
    tmp = f"{TMP_DIR}/migr_{cin}.docx"
    open(tmp, "wb").write(fdata)
    p = subprocess.run(["node", f"{ROOT}/scripts/verify_docx_content.js", tmp, cin,
                        *[c for c in CINS if c != cin]], capture_output=True, text=True)
    if p.returncode == 0:
        serve_ok += 1
check("3/3 fichiers individuels servis + CIN isolé", serve_ok == 3, f"{serve_ok}/3")

# noms affichés « (page N).docx »
after = subprocess.run(["node", "-e",
    "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
    "(async()=>{const rows=await db.payslip.findMany({where:{cin:{in:['70055667','70066778','70077889']}}});"
    "console.log(JSON.stringify(rows.map(r=>({cin:r.cin,fileName:r.fileName,pageNumber:r.pageNumber,storedName:r.storedName}))));"
    "await db.$disconnect();})()"], capture_output=True, text=True, cwd=ROOT)
rows = json.loads(after.stdout or "[]")
check("noms affichés « (page N).docx »", all("(page " in r["fileName"] for r in rows), str([r["fileName"] for r in rows]))
check("pageNumber = 1 par fiche", all(r["pageNumber"] == 1 for r in rows), str([r["pageNumber"] for r in rows]))
check("storedName tous distincts", len(set(r["storedName"] for r in rows)) == 3, "")

# 5) original déplacé dans _originaux/
check("original déplacé vers _originaux/",
      os.path.exists(f"{ROOT}/storage/payslips/_originaux/{SHARED_NAME}"),
      SHARED_NAME)
check("original absent du dossier principal",
      not os.path.exists(f"{ROOT}/storage/payslips/{SHARED_NAME}"))

# 6) NETTOYAGE : suppression des 3 fiches (unlink automatique par l'API) +
#    retrait de l'original conservé
for rec in recs:
    req(f"/api/payslips/{rec['id']}", method="DELETE")
try:
    os.remove(f"{ROOT}/storage/payslips/_originaux/{SHARED_NAME}")
except OSError:
    pass
left = subprocess.run(["node", "-e",
    "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
    "(async()=>{const n=await db.payslip.count({where:{cin:{in:['70055667','70066778','70077889']}}});"
    "console.log(n);await db.$disconnect();})()"], capture_output=True, text=True, cwd=ROOT)
check("nettoyage complet (base à l'état initial)", left.stdout.strip() == "0", left.stdout.strip())

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
