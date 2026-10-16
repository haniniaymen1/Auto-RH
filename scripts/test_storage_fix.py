#!/usr/bin/env python3
"""
Test E2E du correctif « Fichier PDF introuvable sur le serveur ».

Scénario reproduit EXACTEMENT le bug de l'utilisateur :
  - site d'administration lancé en build STANDALONE via scripts/start-prod.js
    (Next.js force process.chdir(.next/standalone) → ancien code écrivait
     les PDF dans .next/standalone/storage/payslips/) ;
  - portail employés lancé depuis la racine du projet (port 3001).

Vérifications :
  A. login admin OK
  B. upload de 3 PDF → succès
  C. les fichiers sont physiquement dans <racine>/storage/payslips
     (et AUCUN nouveau fichier dans .next/standalone/storage/payslips)
  D. téléchargement admin (port 3000) → 200
  E. recherche portail (3001) → fiches trouvées ; téléchargement portail → 200
  F. simulation d'un PDF « égaré » par l'ANCIEN code (dans
     .next/standalone/storage/payslips + ligne DB) → portail ET admin → 200
  G. redetect (relit tous les PDF via resolveStoredFile) → 0 erreur
"""
import json
import os
import shutil
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE_SITE = "http://localhost:3000"
BASE_PORTAL = "http://localhost:3001"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # portable
STORAGE = os.path.join(ROOT, "storage", "payslips")
STRANDED = os.path.join(ROOT, ".next", "standalone", "storage", "payslips")
# PDFs de test : upload/user_slips s'il existe, sinon test-data/payslips (fourni)
USER_SLIPS = os.path.join(ROOT, "upload", "user_slips")
if not os.path.isdir(USER_SLIPS) or not any(
    f.endswith(".pdf") for f in os.listdir(USER_SLIPS)
):
    USER_SLIPS = os.path.join(ROOT, "test-data", "payslips")

PASS = 0
FAIL = 0

def check(label, ok, extra=""):
    global PASS, FAIL
    if ok:
        print("PASS ", label)
        PASS += 1
    else:
        print("ÉCHEC", label, extra)
        FAIL += 1

def http(method, url, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, method=method, data=data)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, body if raw else json.loads(body or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, body if raw else json.loads(body or b"{}")
        except Exception:
            return e.code, body

# ---------- A. login ----------
status, login = http("POST", f"{BASE_SITE}/api/auth/login",
                     data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(),
                     headers={"Content-Type": "application/json"})
cookie = ""
if status == 200:
    set_cookie = None
    # urllib ne donne pas direct accès aux Set-Cookie multiples → via urlopen
    req = urllib.request.Request(f"{BASE_SITE}/api/auth/login", method="POST",
                                 data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        status = r.status
        set_cookie = r.headers.get("Set-Cookie", "")
    cookie = set_cookie.split(";")[0] if set_cookie else ""
check("A. login admin (it@demo.tn)", status == 200 and cookie != "", f"status={status} cookie={cookie[:20]}")

AUTH = {"Cookie": cookie}

# ---------- B. upload de 3 PDF ----------
files = sorted(f for f in os.listdir(USER_SLIPS) if f.endswith(".pdf"))[:3]
boundary = uuid.uuid4().hex
body = b""
for fname in files:
    with open(os.path.join(USER_SLIPS, fname), "rb") as fh:
        content = fh.read()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; "
             f"filename=\"{fname}\"\r\nContent-Type: application/pdf\r\n\r\n").encode() + content + b"\r\n"
body += f"--{boundary}--\r\n".encode()

before_stranded = set(os.listdir(STRANDED)) if os.path.isdir(STRANDED) else set()
before_storage = set(os.listdir(STORAGE)) if os.path.isdir(STORAGE) else set()

status, up = http("POST", f"{BASE_SITE}/api/payslips/upload", data=body,
                  headers={**AUTH, "Content-Type": f"multipart/form-data; boundary={boundary}"})
ok_upload = status == 200 and up.get("success") == 3
check("B. upload 3 PDF → succès", ok_upload, json.dumps(up)[:300])

uploaded = [r for r in up.get("results", []) if r.get("status") == "SUCCESS"]
first_id = uploaded[0].get("id") if uploaded else None
first_cin = uploaded[0].get("cin") if uploaded else None
check("B2. upload retourne id + CIN", bool(first_id) and bool(first_cin),
      f"id={first_id} cin={first_cin}")

# ---------- C. emplacement physique ----------
time.sleep(0.5)
after_stranded = set(os.listdir(STRANDED)) if os.path.isdir(STRANDED) else set()
after_storage = set(os.listdir(STORAGE)) if os.path.isdir(STORAGE) else set()
new_in_storage = after_storage - before_storage
new_in_stranded = after_stranded - before_stranded
check("C. 3 nouveaux PDF dans <racine>/storage/payslips", len(new_in_storage) == 3,
      f"{len(new_in_storage)} nouveaux")
check("C2. AUCUN nouveau PDF dans .next/standalone/storage", len(new_in_stranded) == 0,
      f"{sorted(new_in_stranded)[:3]}")

# ---------- D. téléchargement admin → 200 ----------
status, _ = http("GET", f"{BASE_SITE}/api/payslips/{first_id}/file", headers=AUTH, raw=True)
check("D. téléchargement PDF via admin (3000) → 200", status == 200, f"status={status}")

# ---------- E. portail : recherche + téléchargement ----------
status, search = http("GET", f"{BASE_PORTAL}/api/search?cin={first_cin}")
ids = [i["id"] for i in search.get("items", [])]
check("E. recherche portail trouve la fiche", status == 200 and first_id in ids,
      f"status={status} total={search.get('total')}")
if first_id in ids:
    status, _ = http("GET", f"{BASE_PORTAL}/api/payslip/{first_id}/file?cin={first_cin}", raw=True)
    check("E2. téléchargement PDF via portail (3001) → 200", status == 200, f"status={status}")
else:
    check("E2. téléchargement PDF via portail (3001) → 200", False, "fiche absente de la recherche portail")

# ---------- F. simulation d'un PDF égaré (ancien bug) ----------
stranded_name = f"9999999999999-e2e-stranded-test.pdf"
src = os.path.join(STORAGE, sorted(new_in_storage)[0]) if new_in_storage else os.path.join(
    STORAGE, sorted(after_storage)[0])
os.makedirs(STRANDED, exist_ok=True)
shutil.copyfile(src, os.path.join(STRANDED, stranded_name))

# insère une ligne DB pointant vers ce fichier égaré (comme les fiches de l'utilisateur)
insert_js = f"""
const {{ PrismaClient }} = require("@prisma/client");
const fs = require("fs");
const db = new PrismaClient();
(async () => {{
  const content = fs.readFileSync("{src}", "utf8") // binaire → on extrait via le texte existant
  }})()""".strip()
# On utilise node avec lecture du PDF via le texte de la fiche source (API admin)
status, detail = http("GET", f"{BASE_SITE}/api/payslips/{first_id}", headers=AUTH)
check("F0. détail fiche (contenu texte) accessible", status == 200 and detail.get("content"),
      f"status={status}")

content = json.dumps(detail.get("content", ""))
normalized = content.upper().replace(" ", "").replace(".", "").replace("/", "").replace("-", "")
payload = {
    "fileName": "e2e-stranded-test.pdf",
    "storedName": stranded_name,
    "fileSize": os.path.getsize(src),
    "content": detail.get("content", ""),
    "normalizedContent": normalized,
    "cin": detail.get("cin"),
    "employeeName": detail.get("employeeName"),
    "period": detail.get("period"),
    "netSalary": detail.get("netSalary"),
    "matricule": detail.get("matricule"),
    "pageNumber": detail.get("pageNumber") or 1,
}
with open(f"{ROOT}/scripts/_insert_e2e.json", "w") as fh:
    fh.write(json.dumps(payload))
insert_script = r'''
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const db = new PrismaClient();
db.payslip.create({ data }).then((r) => {
  console.log("CREATED:" + r.id);
  return db.$disconnect();
}).catch((e) => { console.error("ERR:" + e.message); process.exit(1); });
'''
with open(f"{ROOT}/scripts/_insert_stranded.js", "w") as fh:
    fh.write(insert_script)
out = os.popen(f'cd {ROOT} && DATABASE_URL=file:{ROOT}/db/custom.db node scripts/_insert_stranded.js {ROOT}/scripts/_insert_e2e.json').read().strip()
stranded_id = out.replace("CREATED:", "") if out.startswith("CREATED:") else None
check("F1. insertion fiche « égarée » en base", stranded_id is not None, out[:200])

if stranded_id:
    # portail : le candidat n°7 (.next/standalone/storage/payslips) doit le trouver
    status, _ = http("GET", f"{BASE_PORTAL}/api/payslip/{stranded_id}/file?cin={first_cin}", raw=True)
    check("F2. portail trouve le PDF ÉGARÉ (standalone) → 200", status == 200, f"status={status}")
    # admin : resolveStoredFile doit aussi le trouver
    status, _ = http("GET", f"{BASE_SITE}/api/payslips/{stranded_id}/file", headers=AUTH, raw=True)
    check("F3. admin trouve le PDF ÉGARÉ (standalone) → 200", status == 200, f"status={status}")
    # nettoyage : suppression via l'API (doit supprimer le fichier égaré)
    status, _ = http("DELETE", f"{BASE_SITE}/api/payslips/{stranded_id}", headers=AUTH)
    gone = not os.path.exists(os.path.join(STRANDED, stranded_name))
    check("F4. suppression fiche égarée + fichier physique", status == 200 and gone,
          f"status={status} fichier_supprimé={gone}")

# ---------- G. redetect : relit tous les PDF via resolveStoredFile ----------
status, rd = http("POST", f"{BASE_SITE}/api/payslips/redetect",
                  data=b"", headers={**AUTH, "Content-Type": "application/json"})
check("G. redetect global sans erreur", status == 200 and rd.get("errors") == 0,
      f"status={status} errors={rd.get('errors')} updated={rd.get('updated')}")

print(f"\nBILAN STORAGE FIX : {PASS} PASS / {FAIL} ÉCHEC")
sys.exit(0 if FAIL == 0 else 1)
