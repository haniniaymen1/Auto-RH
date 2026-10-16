#!/usr/bin/env python3
"""Task 25 — E2E : import d'un document Word (.docx) multi-pages -> fiches
INDIVIDUELLES découpées (1 page = 1 fiche), affectation par CIN,
téléchargement d'un fichier Word individuel par employé.

Cas couverts :
  1. DOCX 3 fiches + sauts de page explicites (+ tableau sur la fiche 2)
  2. DOCX 2 fiches + marqueurs <w:lastRenderedPageBreak/> (rendu Word)
  3. DOCX 2 fiches + sauts de SECTION (<w:sectPr> par paragraphe)
  4. DOCX 2 fiches SANS aucun saut -> repli « candidat CIN » (découpage)
  5. DOCX mono-fiche -> chemin historique INCHANGÉ (fichier complet)
  6. Portail OTP : l'employé voit SES fiches Word et télécharge SA fiche ;
     la fiche d'un autre employé reste interdite (403).
"""
import json, sys, urllib.request, http.cookiejar, io, subprocess, os

BASE = "http://localhost:3000"
ROOT = "/home/z/my-project"
TMP_DIR = "/home/z/my-project/scripts/tmp_task25"
sys.path.insert(0, ROOT + "/scripts")
os.makedirs(TMP_DIR, exist_ok=True)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FIX = f"{ROOT}/scripts/fixtures_docx"

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
    boundary = "----Task25Boundary"
    part = io.BytesIO()
    part.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    part.write(data)
    part.write(f"\r\n--{boundary}--\r\n".encode())
    return len(data), req("/api/payslips/upload", part.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"})

created_ids = []

# CINs de test (uniques dans la base — vérifié)
CIN_A, CIN_B, CIN_C = "70055667", "70066778", "70077889"
ALL_CINS = [CIN_A, CIN_B, CIN_C]

def db_rows_for(cins):
    arg = ",".join(f'"{c}"' for c in cins)
    proc = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        f"(async()=>{{const rows=await db.payslip.findMany({{where:{{cin:{{in:[{arg}]}}}}}});"
        "console.log(JSON.stringify(rows.map(r=>({id:r.id,cin:r.cin,storedName:r.storedName,"
        "fileSize:r.fileSize,fileName:r.fileName,pageNumber:r.pageNumber,sourcePage:r.sourcePage,"
        "employeeName:r.employeeName,period:r.period}))));await db.$disconnect();})()"],
        capture_output=True, text=True, cwd=ROOT)
    return json.loads(proc.stdout or "[]")

def db_rows_test_all():
    """TOUTES les fiches de test : CIN de test OU nom de fichier de fixture
    (couvre les faux CIN « matricule » créés par le chemin historique)."""
    proc = subprocess.run(["node", "-e",
        "const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();"
        "(async()=>{const rows=await db.payslip.findMany({where:{OR:["
        "{cin:{in:['70055667','70066778','70077889','4001','4002','4003']}},"
        "{fileName:{startsWith:'fiche_word_'}}]}});"
        "console.log(JSON.stringify(rows.map(r=>({id:r.id,cin:r.cin,fileName:r.fileName}))));"
        "await db.$disconnect();})()"],
        capture_output=True, text=True, cwd=ROOT)
    return json.loads(proc.stdout or "[]")

# 1) login admin
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

# 1-bis) PRÉ-NETTOYAGE des résidus d'un éventuel run précédent
stale = db_rows_test_all()
for r in stale:
    req(f"/api/payslips/{r['id']}", method="DELETE")
check("pré-nettoyage des résidus", True, f"{len(stale)} fiche(s) supprimée(s)")

def check_individual_files(rows, expected_count, name_pattern, sizes_lt=None):
    """Vérifications communes des fichiers individuels en base."""
    check(f"{expected_count} fiches en base", len(rows) == expected_count, str(len(rows)))
    check("storedName tous distincts (.docx)",
          len(set(r["storedName"] for r in rows)) == expected_count
          and all(r["storedName"].endswith(".docx") for r in rows),
          str([r["storedName"] for r in rows][:5]))
    check("noms affichés suffixés (page/pages N)",
          all("(page" in r["fileName"] for r in rows), str([r["fileName"] for r in rows]))
    if sizes_lt is not None:
        check("tailles individuelles < original",
              all(r["fileSize"] < sizes_lt for r in rows),
              f"max={max(r['fileSize'] for r in rows) if rows else '?'} < {sizes_lt}")

def serve_and_verify(target_row, expected_cin, forbidden_cins, extra_forbidden_text=None):
    """Télécharge la fiche et vérifie isolation + validité DOCX."""
    st, fresp = req(f"/api/payslips/{target_row['id']}/file")
    check(f"GET /file ({expected_cin}) -> 200 + signature ZIP",
          st == 200 and fresp[:2] == b"PK", f"{st} {len(fresp)} octets")
    with op.open(urllib.request.Request(BASE + f"/api/payslips/{target_row['id']}/file")) as hresp:
        ctype = hresp.headers.get("Content-Type", "")
    check("Content-Type wordprocessingml", "wordprocessingml" in ctype, ctype)
    tmp = f"{TMP_DIR}/fiche_{expected_cin}.docx"
    open(tmp, "wb").write(fresp)
    args = ["node", f"{ROOT}/scripts/verify_docx_content.js", tmp, expected_cin] + forbidden_cins
    proc = subprocess.run(args, capture_output=True, text=True)
    check(f"fichier individuel {expected_cin} : CIN isolé, autres absents, XML valide",
          proc.returncode == 0, (proc.stdout + proc.stderr).strip()[:200])
    if extra_forbidden_text:
        proc2 = subprocess.run(["node", "-e",
            "const JSZip=require('jszip');const fs=require('fs');"
            "(async()=>{const z=await JSZip.loadAsync(fs.readFileSync(process.argv[1]));"
            "const d=await z.file('word/document.xml').async('string');"
            "console.log(d.includes(process.argv[2])?'LEAK':'OK');})()", tmp, extra_forbidden_text],
            capture_output=True, text=True, cwd=ROOT)
        check(f"donnée sensible « {extra_forbidden_text[:24]}… » absente",
              proc2.stdout.strip() == "OK", proc2.stdout.strip())

# ================================================================
# CAS 1 — DOCX 3 fiches, sauts de page explicites, tableau fiche 2
# ================================================================
print("\n--- Cas 1 : 3 fiches + sauts de page explicites ---")
orig1, (st, resp) = upload_file(f"{FIX}/fiche_word_multipages.docx", "fiche_word_multipages.docx", DOCX_MIME)
data = json.loads(resp)
check("upload DOCX multi-pages -> 200", st == 200, str(st))
res = (data.get("results") or [{}])[0]
check("statut SUCCESS", res.get("status") == "SUCCESS", res.get("message", "")[:130])
check("3 fiches créées", res.get("created") == 3, str(res.get("created")))
check("message = division par fiche", "divisé par fiche de paie" in res.get("message", ""), res.get("message", "")[:150])
items = res.get("items") or []
cins = sorted([i.get("cin") for i in items])
check("CINs affectés A/B/C", cins == sorted(ALL_CINS), str(cins))

rows1 = db_rows_for(ALL_CINS)
check_individual_files(rows1, 3, "(page ", orig1)
check("pageNumber = 1 page par fiche", all(r["pageNumber"] == 1 for r in rows1), str([r["pageNumber"] for r in rows1]))
check("sourcePage 1/2/3", sorted(r["sourcePage"] for r in rows1) == [1, 2, 3],
      str(sorted(r["sourcePage"] for r in rows1)))
created_ids += [r["id"] for r in rows1]

# la fiche B (page 2) contient le TABLEAU (fidélité) et exclut A et C
target_b = next(r for r in rows1 if r["cin"] == CIN_B)
serve_and_verify(target_b, CIN_B, [CIN_A, CIN_C])
tmp_b = f"{TMP_DIR}/fiche_{CIN_B}.docx"
proc_tbl = subprocess.run(["node", "-e",
    "const JSZip=require('jszip');const fs=require('fs');"
    "(async()=>{const z=await JSZip.loadAsync(fs.readFileSync(process.argv[1]));"
    "const d=await z.file('word/document.xml').async('string');"
    "console.log(JSON.stringify({tbl:d.includes('<w:tbl>'),rub:d.includes('Rubrique')}));})()",
    tmp_b], capture_output=True, text=True, cwd=ROOT)
tbl = json.loads(proc_tbl.stdout or "{}")
check("fidélité : tableau de la fiche B conservé", tbl.get("tbl") and tbl.get("rub"), proc_tbl.stdout.strip())

# la fiche C (page 3) ne contient NI le nom ni les montants de la fiche A
target_c = next(r for r in rows1 if r["cin"] == CIN_C)
serve_and_verify(target_c, CIN_C, [CIN_A, CIN_B], extra_forbidden_text="JAZIRI Leila")

# ================================================================
# CAS 2 — marqueurs de rendu <w:lastRenderedPageBreak/>
# ================================================================
print("\n--- Cas 2 : marqueurs de rendu Word ---")
orig2, (st, resp) = upload_file(f"{FIX}/fiche_word_rendered.docx", "fiche_word_rendered.docx", DOCX_MIME)
data = json.loads(resp)
res2 = (data.get("results") or [{}])[0]
check("upload DOCX rendu -> 200", st == 200, str(st))
check("2 fiches créées", res2.get("created") == 2, str(res2.get("created")))
rows2 = db_rows_for(ALL_CINS)
# rows2 = fiches du cas 1 (3) + cas 2 (2) + cas 3... non encore importé
new2 = [r for r in rows2 if "(page " in r["fileName"] and r["fileName"].startswith("fiche_word_rendered")]
check_individual_files(new2, 2, "(page ", orig2)
created_ids += [r["id"] for r in new2]
t = next((r for r in new2 if r["cin"] == CIN_A), None)
if t: serve_and_verify(t, CIN_A, [CIN_B, CIN_C])

# ================================================================
# CAS 3 — sauts de section (<w:sectPr> dans les paragraphes)
# ================================================================
print("\n--- Cas 3 : sauts de section ---")
orig3, (st, resp) = upload_file(f"{FIX}/fiche_word_sections.docx", "fiche_word_sections.docx", DOCX_MIME)
data = json.loads(resp)
res3 = (data.get("results") or [{}])[0]
check("upload DOCX sections -> 200", st == 200, str(st))
check("2 fiches créées", res3.get("created") == 2, str(res3.get("created")))
rows_all = db_rows_for(ALL_CINS)
new3 = [r for r in rows_all if r["fileName"].startswith("fiche_word_sections")]
check_individual_files(new3, 2, "(page ", orig3)
created_ids += [r["id"] for r in new3]
t = next((r for r in new3 if r["cin"] == CIN_B), None)
if t: serve_and_verify(t, CIN_B, [CIN_A, CIN_C])

# ================================================================
# CAS 4 — SANS aucun saut : repli « candidat CIN » (2 fiches)
# ================================================================
print("\n--- Cas 4 : sans saut (repli candidat CIN) ---")
orig4, (st, resp) = upload_file(f"{FIX}/fiche_word_sans_saut.docx", "fiche_word_sans_saut.docx", DOCX_MIME)
data = json.loads(resp)
res4 = (data.get("results") or [{}])[0]
check("upload DOCX sans saut -> 200", st == 200, str(st))
check("2 fiches créées (repli CIN)", res4.get("created") == 2, str(res4.get("created")))
rows_all = db_rows_for(ALL_CINS)
new4 = [r for r in rows_all if r["fileName"].startswith("fiche_word_sans_saut")]
check_individual_files(new4, 2, "(page ", orig4)
created_ids += [r["id"] for r in new4]
t = next((r for r in new4 if r["cin"] == CIN_A), None)
if t:
    # Comportement MIROIR du découpage texte historique (splitTextIntoCinBlocks) :
    # la fiche A emporte le préambule + son contenu + les lignes d'en-tête
    # du bulletin suivant (titre, société, NOM du suivant) — comme dans le
    # contenu historique. Le CIN du suivant et ses DONNÉES de paie restent
    # dans le fichier du suivant (vérifié ci-dessous : CIN B absent).
    serve_and_verify(t, CIN_A, [CIN_B])
t2 = next((r for r in new4 if r["cin"] == CIN_B), None)
if t2:
    serve_and_verify(t2, CIN_B, [CIN_A])

# ================================================================
# CAS 5 — DOCX mono-fiche : chemin historique INCHANGÉ
# ================================================================
print("\n--- Cas 5 : mono-fiche (historique) ---")
orig5, (st, resp) = upload_file(f"{FIX}/fiche_word_unique.docx", "fiche_word_unique.docx", DOCX_MIME)
data = json.loads(resp)
res5 = (data.get("results") or [{}])[0]
check("upload DOCX unique -> 200", st == 200, str(st))
check("statut SUCCESS", res5.get("status") == "SUCCESS", res5.get("message", "")[:120])
check("1 seule fiche (pas de division)", res5.get("created") is None, str(res5.get("created")))
check("CIN détecté A", res5.get("cin") == CIN_A, str(res5.get("cin")))
mono = [r for r in db_rows_for([CIN_A]) if r["fileName"] == "fiche_word_unique.docx"]
check("fiche mono en base (fichier complet)", len(mono) == 1, str(len(mono)))
if mono:
    check("taille = document complet (historique)", mono[0]["fileSize"] == orig5,
          f"{mono[0]['fileSize']} vs {orig5}")
    created_ids.append(mono[0]["id"])

# ================================================================
# CAS 6 — PORTAIL OTP : isolation par CIN + téléchargement Word
# ================================================================
print("\n--- Cas 6 : portail OTP (isolation + téléchargement) ---")
import portal_login_helper as plh
try:
    cookie = plh.portal_login(CIN_B)
    check("connexion portail OTP (CIN B)", bool(cookie), cookie[:30])
    preq = urllib.request.Request("http://localhost:3001/api/my-fiches")
    preq.add_header("Cookie", cookie)
    with urllib.request.urlopen(preq, timeout=60) as pr:
        pdata = json.loads(pr.read())
    pitems = pdata.get("items") or []
    # NB : le champ cin n'est PAS renvoyé par le portail (masquage Task 17) —
    # l'isolation est garantie côté serveur (requête verrouillée sur le CIN
    # de session). On vérifie donc le NOMBRE et l'IDENTITÉ des fichiers.
    expected_b = ["fiche_word_sans_saut (page 3).docx",
                  "fiche_word_sections (page 2).docx",
                  "fiche_word_rendered (page 2).docx",
                  "fiche_word_multipages (page 2).docx"]
    got_names = sorted(p.get("fileName") or "" for p in pitems)
    check(f"portail : {len(pitems)} fiche(s) = exactement celles du CIN B",
          pdata.get("total") == len(pitems) == 4 and got_names == sorted(expected_b),
          f"total={pdata.get('total')} {got_names}")
    check("portail : fiches Word individuelles (noms suffixés)",
          all("(page" in (p.get("fileName") or "") for p in pitems),
          str([p.get("fileName") for p in pitems]))
    # téléchargement de SA fiche via le portail
    target = next(p for p in pitems if "multipages" in (p.get("fileName") or ""))
    furl = f"http://localhost:3001/api/payslip/{target['id']}/file?cin={CIN_B}"
    freq = urllib.request.Request(furl)
    freq.add_header("Cookie", cookie)
    with urllib.request.urlopen(freq, timeout=60) as fr:
        fdata = fr.read()
        fctype = fr.headers.get("Content-Type", "")
    check("portail : téléchargement -> ZIP (docx)", fdata[:2] == b"PK", f"{len(fdata)} octets")
    check("portail : Content-Type wordprocessingml", "wordprocessingml" in fctype, fctype)
    tmp_p = f"{TMP_DIR}/portail_{CIN_B}.docx"
    open(tmp_p, "wb").write(fdata)
    proc = subprocess.run(["node", f"{ROOT}/scripts/verify_docx_content.js", tmp_p, CIN_B, CIN_A, CIN_C],
                          capture_output=True, text=True)
    check("portail : SA fiche isolée (CIN B seul, XML valide)", proc.returncode == 0,
          (proc.stdout + proc.stderr).strip()[:180])
    # la fiche d'un AUTRE employé reste interdite (403)
    other = next(r for r in rows1 if r["cin"] == CIN_A)
    ourl = urllib.request.Request(f"http://localhost:3001/api/payslip/{other['id']}/file?cin={CIN_A}")
    ourl.add_header("Cookie", cookie)
    try:
        urllib.request.urlopen(ourl, timeout=60)
        other_status = 200
    except urllib.error.HTTPError as e2:
        other_status = e2.code
    check("portail : fiche d'un autre employé -> 403", other_status == 403, str(other_status))
finally:
    plh.cleanup()
check("cleanup accès portail de test", True)

# ================================================================
# NETTOYAGE : suppression des fiches de test (base rendue à 107)
# ================================================================
print("\n--- Nettoyage ---")
all_test = db_rows_test_all()
deleted = 0
for r in all_test:
    st, _ = req(f"/api/payslips/{r['id']}", method="DELETE")
    deleted += 1 if st in (200, 204) else 0
check("fiches de test supprimées", deleted == len(all_test), f"{deleted}/{len(all_test)}")
rest = db_rows_test_all()
check("base rendue à l'état initial (0 fiche de test)", len(rest) == 0, str(len(rest)))

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
