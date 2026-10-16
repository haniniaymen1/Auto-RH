#!/usr/bin/env python3
"""
Met à jour le kit download/auto-rh-scripts-site-web.zip — Task 19 :

« portail employé n'affiche pas les fichiers pdf par contre portail
  administration detecté » (bulletins_specimen_50_PDF.zip — CIN alphanumériques
  type « SPEC-0001 »)

Cause : les gardes « numéros séparés » du regex exact Task 14 rejetaient à
tort un CIN alphanumérique écrit avec séparateurs au milieu d'une ligne de
tableau PDF (« Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 … ») → fiches PDF
invisibles dans le portail (my-fiches) et dans la recherche admin, et
ouverture de fichier 403.

Correctif 100 % additif (aucune règle existante modifiée) :
  - src/lib/payslip-extractor.ts : NOUVELLES fonctions exactCinRegexRelaxed /
    isExactCinInContentRelaxed / findExactCinMatchRelaxed — réservées aux
    requêtes contenant au moins une LETTRE (CIN numériques : comportement
    strict Task 14 strictement inchangé) ;
  - src/app/api/payslips/route.ts : filtre de recherche admin — OU additif
    (égalité du CIN détecté normalisé + correspondance assouplie) + extrait
    de secours assoupli ;
  - scripts/portail-server.js : mêmes OU additifs dans searchPayslipsByCin
    (recherche portail) et dans la re-vérification /file (Ouvrir/Télécharger) ;
    nouvelle aide sameCin() ;
  - scripts/portal_login_helper.py : normalisation du CIN identique à l'API
    admin (correction de l'OUTIL DE TEST, pas de l'application).

Vérifications : verify_task19.py 28/28 OK ; régressions verify_task18.py
54/54 OK, verify_task16.py TOUT OK, verify_task17.py TOUT OK,
verify_unlimited_list.py OK (107/107).
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_task19"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers modifiés/ajoutés ----------
updated = [
    "src/lib/payslip-extractor.ts",
    "src/app/api/payslips/route.ts",
    "scripts/portail-server.js",
    "scripts/portal_login_helper.py",
    "scripts/verify_task19.py",                     # NOUVEAU (tests)
    "test-data/LISEZMOI-TESTS.txt",
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    assert os.path.exists(src), f"source absente: {rel}"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---------- 3. Vérifs de contenu ----------
def must_contain(rel, *needles):
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        c = f.read()
    for n in needles:
        assert n in c, f"{rel}: '{n}' absent !"

must_contain("src/lib/payslip-extractor.ts",
             "exactCinRegexRelaxed", "isExactCinInContentRelaxed",
             "findExactCinMatchRelaxed", "gate : lettres obligatoires")
must_contain("src/app/api/payslips/route.ts",
             "isExactCinInContentRelaxed", "findExactCinMatchRelaxed",
             "Task 19, additif")
must_contain("scripts/portail-server.js",
             "exactCinRegexRelaxed", "isExactCinInContentRelaxed",
             "function sameCin",
             "r.cin === q ||",               # comparaisons historiques conservées
             "isExactCinInContent(r.content, q) ||")
# le strict Task 14 est TOUJOURS testé en premier (comportement conservé)
with open(os.path.join(WORK, "scripts/portail-server.js"), encoding="utf-8") as f:
    pc = f.read()
assert pc.find("isExactCinInContent(r.content, q)") < pc.find("isExactCinInContentRelaxed(r.content, q)"), \
    "le strict doit être évalué avant le relaxé"
must_contain("scripts/portal_login_helper.py", "_normalize_cin")
must_contain("scripts/verify_task19.py", "SPEC-0001", "my-fiches", "28/28" if False else "RÉSULTAT")
must_contain("test-data/LISEZMOI-TESTS.txt", "NOUVEAUTÉ 15/09/2026 (v6)")
print("Vérifs de contenu: OK")

# ---------- 4. README : section NOUVEAUTÉ (v6) ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, encoding="utf-8") as f:
    rc = f.read()
section = """## NOUVEAUTÉ 15/09/2026 (v6) — Correctif : fiches PDF à CIN alphanumérique invisibles dans le portail

Symptôme : après l'import de bulletins dont le numéro CIN contient des
lettres/séparateurs (ex. « SPEC-0001 »), l'administration listait bien les
fiches, mais le portail employé n'affichait PAS les fiches PDF correspondantes
(seuls les PNG/Excel apparaissaient) et l'ouverture d'un PDF pouvait être
refusée.

Cause : la protection « anti-numéros séparés » (une partie de CIN ne doit
jamais correspondre, ex. « 542351 » dans « 26 542 351 ») rejetait à tort le
CIN dès qu'il était écrit avec des séparateurs au milieu d'une ligne de
tableau (ex. ligne PDF « Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 … »).

Correctif (100 % additif — aucune règle existante modifiée) :
1. Recherche admin (onglet « Recherche CIN ») : les CIN alphanumériques sont
   désormais retrouvés (égalité du CIN détecté indépendante des séparateurs
   « SPEC-0001 » ≡ « SPEC0001 » + correspondance assouplie du contenu).
2. Portail employé : les fiches PDF apparaissent dans « Vos fiches de paie »
   et s'ouvrent/téléchargent normalement (Ouvrir / Télécharger), que le CIN
   de session ait été saisi avec ou sans tiret.
3. Sécurité inchangée pour les CIN numériques : les gardes Task 14 restent
   strictement identiques (une partie de CIN ne correspond toujours JAMAIS) ;
   le cloisonnement par session (403 pour un autre CIN), l'OTP et
   l'anti-rejeu sont inchangés.
Vérifié par scripts/verify_task19.py (28/28) + régressions complètes.
"""
if "## NOUVEAUTÉ 15/09/2026 (v6)" not in rc:
    idx = rc.find("## NOUVEAUTÉ")
    if idx >= 0:
        rc = rc[:idx] + section + "\n" + rc[idx:]
    else:
        lines = rc.split("\n")
        lines.insert(1, "\n" + section)
        rc = "\n".join(lines)
    with open(readme, "w", encoding="utf-8") as f:
        f.write(rc)
    print("README: section NOUVEAUTÉ (v6) ajoutée")
else:
    print("README: section déjà présente")

# ---------- 5. Re-zippage (tous fichiers conservés) ----------
tmp_zip = ZIP + ".new"
if os.path.exists(tmp_zip):
    os.remove(tmp_zip)
before = sum(len(fns) for _, _, fns in os.walk(WORK))
with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, filenames in os.walk(WORK):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, WORK)
            zf.write(full, rel)
after = sum(len(fns) for _, _, fns in os.walk(WORK))
assert before == after
os.replace(tmp_zip, ZIP)
size = os.path.getsize(ZIP) / (1024 * 1024)
print(f"\nZIP mis à jour : {ZIP} ({size:.1f} Mo)")

# ---------- 6. Vérification finale de l'archive ----------
with zipfile.ZipFile(ZIP) as zf:
    names = zf.namelist()
    print("Fichiers dans le ZIP:", len(names))
    for probe in [
        "src/lib/payslip-extractor.ts",
        "src/app/api/payslips/route.ts",
        "scripts/portail-server.js",
        "scripts/portal_login_helper.py",
        "scripts/verify_task19.py",
        "src/app/api/portal-access/route.ts",
        "src/components/payslip/portal-access-tab.tsx",
        "prisma/schema.prisma",
        "package.json",
        "test-data/LISEZMOI-TESTS.txt",
        "README-DEPLOIEMENT-LOCAL.md",
        "scripts/start-prod.js",
    ]:
        hit = [n for n in names if n == probe or n.endswith("/" + probe)]
        assert hit, f"MANQUANT dans le ZIP: {probe}"
    print("Sondes ZIP: OK")
print("DONE")
