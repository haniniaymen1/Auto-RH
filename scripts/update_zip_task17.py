#!/usr/bin/env python3
"""
Met à jour le kit download/auto-rh-scripts-site-web.zip — Task 17 :

« la meme fonctionalité mais dans l'affichage cin n'affiche que 3 caractére
derniere, meme chose pour portail de employé ainsi apres la recherche le
champ sera vide »

1. Nouveau helper de masquage (100 % additif) :
     - src/lib/utils.ts : maskCin() -> « ••• » + 3 derniers caractères
       (ex. 07778889 -> « •••889 ») ; masquage PUREMENT VISUEL.
2. Interface d'administration — CIN affiché masqué partout :
     - all-tab.tsx    : colonne CIN (desktop + carte mobile) masquée
     - search-tab.tsx : colonne CIN, carte mobile et ligne de résultat
       (« avec un CIN se terminant par •••023 ») masquées
     - import-tab.tsx : badge CIN des résultats d'import masqué
     - pdf-dialog.tsx : badge « CIN : … » de la visionneuse masqué
     - page.tsx       : le champ de recherche est VIDÉ après la recherche
       (le CIN complet ne reste pas affiché) ; lastSearched alimente la
       ligne de résultat masquée.
3. Portail employé (scripts/portail-server.js) :
     - maskCin() ajouté ; ligne de résultat « avec un CIN se terminant par
       •••023 » (ancien « avec le CIN exact … ») ;
     - message « Aucun bulletin… » affiche le CIN masqué ;
     - le champ CIN est vidé dès que la recherche est lancée.
AUCUNE donnée ni config supprimée : l'API renvoie toujours le CIN complet
(requis pour la recherche exacte et l'ouverture des PDF) ; seuls les
AFFICHAGES changent. Vérifications : verify_task17.py 17/17, verify_task16.py
TOUT OK, verify_unlimited_list.py OK.
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_task17"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers modifiés ----------
updated = [
    "src/lib/utils.ts",
    "src/components/payslip/all-tab.tsx",
    "src/components/payslip/search-tab.tsx",
    "src/components/payslip/import-tab.tsx",
    "src/components/payslip/pdf-dialog.tsx",
    "src/app/page.tsx",
    "scripts/portail-server.js",
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

def must_not_contain(rel, *needles):
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        c = f.read()
    for n in needles:
        assert n not in c, f"{rel}: '{n}' encore présent !"

must_contain("src/lib/utils.ts", "export function maskCin", "•••")
must_contain("src/components/payslip/all-tab.tsx", "maskCin(p.cin)")
must_contain("src/components/payslip/search-tab.tsx",
             "maskCin(p.cin ?? \"\")", "maskCin(lastSearched)",
             "avec un CIN se terminant par", "lastSearched: string")
must_not_contain("src/components/payslip/search-tab.tsx",
                 "avec le CIN exact", "query.trim().toUpperCase()")
must_contain("src/components/payslip/import-tab.tsx", "maskCin(result.cin)")
must_contain("src/components/payslip/pdf-dialog.tsx", "CIN : {maskCin(payslip.cin)}")
must_contain("src/app/page.tsx", "setQuery(\"\")", "lastSearched={lastSearched}")
must_contain("scripts/portail-server.js",
             "function maskCin", 'input.value = "";',
             "avec un CIN se terminant par", "esc(maskCin(query))",
             # l'accès PDF continue d'utiliser le CIN complet
             'encodeURIComponent(query)')
must_not_contain("scripts/portail-server.js", "avec le CIN exact")
print("Vérifs de contenu: OK")

# ---------- 4. README : section NOUVEAUTÉ (v4) ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, encoding="utf-8") as f:
    rc = f.read()
section = """## NOUVEAUTÉ 15/09/2026 (v4) — CIN masqué (3 derniers caractères)

Dans la continuité du masquage des données sensibles, le CIN n'est plus
affiché en clair — seuls les 3 DERNIERS caractères restent visibles
(ex. 07778889 -> « •••889 ») :

1. Interface d'administration : colonne CIN, résultats de recherche,
   résultats d'import et visionneuse affichent le CIN masqué. Après une
   recherche, le champ de saisie est vidé automatiquement (le CIN complet
   ne reste pas à l'écran) ; la ligne de résultat affiche « avec un CIN se
   terminant par •••023 ».
2. Portail employé : la ligne « N fiches trouvées » affiche désormais le
   CIN masqué et le champ de saisie est vidé dès que la recherche est
   lancée.
3. IMPORTANT — rien ne change côté données : le CIN complet reste en base,
   la recherche exige toujours le CIN COMPLET, et l'ouverture/téléchargement
   des PDF continue de vérifier le CIN complet dans le contenu de la fiche.
   Seul l'AFFICHAGE est masqué.
"""
if "## NOUVEAUTÉ 15/09/2026 (v4)" not in rc:
    idx = rc.find("## NOUVEAUTÉ")
    if idx >= 0:
        rc = rc[:idx] + section + "\n" + rc[idx:]
    else:
        lines = rc.split("\n")
        lines.insert(1, "\n" + section)
        rc = "\n".join(lines)
    with open(readme, "w", encoding="utf-8") as f:
        f.write(rc)
    print("README: section NOUVEAUTÉ (v4) ajoutée")
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
        "src/lib/utils.ts",
        "src/components/payslip/all-tab.tsx",
        "src/components/payslip/search-tab.tsx",
        "src/components/payslip/import-tab.tsx",
        "src/components/payslip/pdf-dialog.tsx",
        "src/app/page.tsx",
        "scripts/portail-server.js",
        "README-DEPLOIEMENT-LOCAL.md",
        "public/fiche-icon.svg",
        "scripts/start-prod.js",
    ]:
        hit = [n for n in names if n == probe or n.endswith("/" + probe)]
        assert hit, f"MANQUANT dans le ZIP: {probe}"
    print("Sondes ZIP: OK")
print("DONE")
