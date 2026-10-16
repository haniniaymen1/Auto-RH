#!/usr/bin/env python3
"""
Met à jour le kit download/auto-rh-scripts-site-web.zip — Task 16 :

« suppression affichage colonne employé, et net à payer dans l'interface
d'administration et dans le portail employé suppression affichage le nom
d'employé et net à payer et changement le mot ouvrir le pdf par ouvrir »

1. Interface d'administration : colonnes « Employé » et « Net à payer »
   retirées de l'affichage (tableau desktop + cartes mobiles) :
     - src/components/payslip/all-tab.tsx     (onglet « Toutes les fiches »)
     - src/components/payslip/search-tab.tsx  (résultats « Recherche CIN »)
     - src/components/payslip/import-tab.tsx  (lignes de résultat d'import :
       mentions « Employé : » et « Net : » retirées)
     - src/components/payslip/pdf-dialog.tsx  (nom de l'employé retiré de
       l'en-tête de la visionneuse ; période + CIN conservés)
2. Portail employé (scripts/portail-server.js) : nom d'employé + net à payer
   masqués sur les cartes de résultats ; bouton « Ouvrir le PDF » renommé
   « Ouvrir ». Période, fichier, taille, date et « Télécharger » inchangés.
3. test-data/LISEZMOI-TESTS.txt : libellé du bouton mis à jour dans la doc.

IMPORTANT : aucune donnée ni aucune config de détection supprimée.
Les champs restent détectés et stockés en base (CIN, nom, période, net) ;
seul leur AFFICHAGE est masqué. Le filtrage local par nom (onglet « Toutes
les fiches ») reste fonctionnel. Zéro régression (verify_task16.py 17/17,
verify_unlimited_list.py OK).
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_task16"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers modifiés ----------
updated = [
    "src/components/payslip/all-tab.tsx",
    "src/components/payslip/search-tab.tsx",
    "src/components/payslip/import-tab.tsx",
    "src/components/payslip/pdf-dialog.tsx",
    "scripts/portail-server.js",
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

def must_not_contain(rel, *needles):
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        c = f.read()
    for n in needles:
        assert n not in c, f"{rel}: '{n}' encore présent !"

# Admin : colonnes masquées, structure restante intacte
for rel in ["src/components/payslip/all-tab.tsx", "src/components/payslip/search-tab.tsx"]:
    must_not_contain(rel, "<TableHead>Employé</TableHead>", "<TableHead>Net à payer</TableHead>")
    must_contain(rel, "Task 16 : colonne « Employé » masquée",
                 "Task 16 : colonne « Net à payer » masquée",
                 "Task 16 : champs « Employé » et « Net à payer » masqués (cartes mobiles)")
must_contain("src/components/payslip/all-tab.tsx",
             "<TableHead>Fichier</TableHead>", "<TableHead>Période</TableHead>",
             "<TableHead>CIN</TableHead>", "<TableHead>Importé le</TableHead>",
             "<TableHead className=\"text-right\">Actions</TableHead>",
             # le filtre par nom reste fonctionnel
             "(p.employeeName ?? \"\").toLowerCase().includes(f)")
must_contain("src/components/payslip/search-tab.tsx",
             "<TableHead>Période</TableHead>", "<TableHead>CIN</TableHead>")
must_not_contain("src/components/payslip/import-tab.tsx",
                 "Employé : ", "Net : {result.netSalary}")
must_contain("src/components/payslip/import-tab.tsx", "Task 16", "Période : {result.period}")
must_not_contain("src/components/payslip/pdf-dialog.tsx", "payslip.employeeName")
must_contain("src/components/payslip/pdf-dialog.tsx", "Task 16", "Période : {payslip.period}", "CIN : {payslip.cin}")

# Portail : bouton renommé, nom/net masqués, reste intact
must_not_contain("scripts/portail-server.js", "Ouvrir le PDF", "it.employeeName", "it.netSalary")
must_contain("scripts/portail-server.js",
             '">Ouvrir</a>', 'class="period"', "Télécharger", "Task 16")

# Doc de test : libellé à jour
must_contain("test-data/LISEZMOI-TESTS.txt", "Ouvrir")
must_not_contain("test-data/LISEZMOI-TESTS.txt", "Ouvrir le PDF")
print("Vérifs de contenu: OK")

# ---------- 4. README : section NOUVEAUTÉ (v3) ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, encoding="utf-8") as f:
    rc = f.read()
section = """## NOUVEAUTÉ 15/09/2026 (v3) — Masquage des colonnes sensibles

À la demande de l'administrateur, les informations nominatives et salariales
ne sont PLUS AFFICHÉES (elles restent détectées et stockées en base) :

1. Interface d'administration : les colonnes « Employé » et « Net à payer »
   sont retirées des listes (tableau + cartes mobiles), ainsi que les
   mentions « Employé : » / « Net : » des résultats d'import et le nom de
   l'employé dans l'en-tête de la visionneuse. Restent affichés : fichier,
   période, CIN, date d'import, actions (Voir / Télécharger / Supprimer).
   Astuce : le filtre de l'onglet « Toutes les fiches » accepte toujours un
   nom d'employé pour retrouver une fiche, même sans colonne visible.
2. Portail employé : le nom d'employé et le net à payer ne sont plus
   affichés sur les fiches trouvées. Restent affichés : période, fichier,
   taille, date d'import, boutons d'action.
3. Le bouton « Ouvrir le PDF » du portail s'appelle désormais « Ouvrir ».

Aucune donnée supprimée, aucune détection modifiée : seul l'affichage change.
"""
if "## NOUVEAUTÉ 15/09/2026 (v3)" not in rc:
    idx = rc.find("## NOUVEAUTÉ")
    if idx >= 0:
        rc = rc[:idx] + section + "\n" + rc[idx:]
    else:
        lines = rc.split("\n")
        lines.insert(1, "\n" + section)
        rc = "\n".join(lines)
    with open(readme, "w", encoding="utf-8") as f:
        f.write(rc)
    print("README: section NOUVEAUTÉ (v3) ajoutée")
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
        "src/components/payslip/all-tab.tsx",
        "src/components/payslip/search-tab.tsx",
        "src/components/payslip/import-tab.tsx",
        "src/components/payslip/pdf-dialog.tsx",
        "scripts/portail-server.js",
        "test-data/LISEZMOI-TESTS.txt",
        "README-DEPLOIEMENT-LOCAL.md",
        "public/fiche-icon.svg",
        "scripts/start-prod.js",
    ]:
        hit = [n for n in names if n == probe or n.endswith("/" + probe)]
        assert hit, f"MANQUANT dans le ZIP: {probe}"
    print("Sondes ZIP: OK")
print("DONE")
