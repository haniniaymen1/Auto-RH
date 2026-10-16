#!/usr/bin/env python3
"""
Met à jour le kit download/auto-rh-scripts-site-web.zip — Task 15 :

1. « false information detected » : nom lu « COTES » / « RIT TEST » sur les
   fiches PNG->PDF (bande d'en-tête + OCR morcelé « H AN RIT TEST »).
   Fichiers modifiés/ajoutés :
     - src/lib/payslip-ocr-adaptive.ts  (déclencheur hi-res si nom suspect +
       NOUVEAU ocrImageAdaptiveParts : texte + partie hi-res séparées)
     - src/lib/payslip-extractor.ts     (NOUVEAU nameHasStrayFragments ;
       fragment d'en-tête d'un seul mot court -> repli dernier recours)
     - src/app/api/payslips/upload/route.ts (arbitrage du NOM, image path)
     - src/lib/payslip-reanalyze.ts         (arbitrage du NOM, image path)
2. « delete paie sage » : nom « Auto-RH » retiré de toutes les surfaces
   visibles (titre onglet, en-tête, pied de page, login, signup, portail,
   bannières console, README, Docker).
   Fichiers : layout.tsx, page.tsx, login, signup, portail-server.js,
   start-prod.js, DEMARRER-*.bat/.sh, README-DEPLOIEMENT-LOCAL.md,
   Dockerfile, docker-compose.yml.
3. « change icone z par icone fiche » : favicon « Z » remplacé par l'icône
   FICHE (carré vert + document blanc) : public/fiche-icon.svg (NOUVEAU),
   public/fiche-icon.png (NOUVEAU), layout.tsx (icons), middleware.ts
   (exclusions matcher), portail-server.js (favicon inline data-URI).

Aucun fichier existant du kit n'est supprimé ; aucune config de détection
existante modifiée (uniquement des ajouts).
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_task15"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers modifiés / ajoutés ----------
updated = [
    # --- détection (Task 15) ---
    "src/lib/payslip-ocr-adaptive.ts",
    "src/lib/payslip-extractor.ts",
    "src/app/api/payslips/upload/route.ts",
    "src/lib/payslip-reanalyze.ts",
    # --- branding / icône ---
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/login/page.tsx",
    "src/app/signup/page.tsx",
    "src/middleware.ts",
    "public/fiche-icon.svg",
    "public/fiche-icon.png",
    "scripts/portail-server.js",
    "scripts/start-prod.js",
    "DEMARRER-WINDOWS.bat",
    "DEMARRER-PORTAIL-WINDOWS.bat",
    "DEMARRER-TOUT-WINDOWS.bat",
    "DEMARRER-LINUX-MAC.sh",
    "DEMARRER-PORTAIL-LINUX-MAC.sh",
    "DEMARRER-TOUT-LINUX-MAC.sh",
    "README-DEPLOIEMENT-LOCAL.md",
    "Dockerfile",
    "docker-compose.yml",
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

must_contain("src/lib/payslip-ocr-adaptive.ts", "ocrImageAdaptiveParts", "nameLooksSuspicious", "nameHasStrayFragments")
must_contain("src/lib/payslip-extractor.ts", "nameHasStrayFragments", "headerFragmentFallback")
must_contain("src/app/api/payslips/upload/route.ts", "ocrImageAdaptiveParts", "ARBITRAGE DU NOM", "nameHasStrayFragments")
must_contain("src/lib/payslip-reanalyze.ts", "ocrImageAdaptiveParts", "nameHasStrayFragments")
must_contain("src/app/layout.tsx", "Fiches de Paie | Recherche par CIN", "/fiche-icon.svg")
must_contain("scripts/portail-server.js", "Fiches de Paie — Portail Employés", "data:image/svg+xml")
must_contain("public/fiche-icon.svg", "#059669")
assert os.path.getsize(os.path.join(WORK, "public/fiche-icon.png")) > 1000

# le nom Auto-RH ne doit rester que dans des COMMENTAIRES de code
import re
for rel in ["src/app/layout.tsx", "src/app/page.tsx", "src/app/login/page.tsx",
            "src/app/signup/page.tsx", "scripts/portail-server.js", "scripts/start-prod.js"]:
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if "Auto-RH" in s:
                assert s.startswith(("//", "*", "/*", "{/*", "#", "<!--")), \
                    f"{rel}: Auto-RH visible hors commentaire: {s[:80]}"

# ---------- 4. README : section NOUVEAUTÉ ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, encoding="utf-8") as f:
    rc = f.read()
marker = "## NOUVEAUTÉ 15/09/2026"
if marker not in rc:
    section = """## NOUVEAUTÉ 15/09/2026

### 1. Détection corrigée : nom lu « COTES » / partiel (« RIT TEST ») sur les fiches images
Sur les fiches scannées / converties PNG->PDF, la bande d'en-tête pouvait être
mal lue par l'OCR : le nom affiché devenait « COTES » (déchet de la bande
d'en-tête) ou un fragment (« RIT TEST » au lieu de « EMPLOYE TEST »).
Correctifs (uniquement des AJOUTS, aucune règle existante modifiée) :
- nouvelle détection des noms « suspects » (fragment d'en-tête, garbage,
  lettres isolées collées au nom par l'OCR) ;
- passe OCR haute lisibilité automatique quand le nom est suspect ;
- arbitrage du nom : la meilleure lecture est retenue, comme pour le CIN.
Après mise à jour, cliquez « Redétecter CIN & périodes » pour corriger les
fiches déjà importées (aucun ré-import nécessaire). Note : la relecture
haute lisibilité peut prendre quelques dizaines de secondes par fiche
concernée — c'est normal.

### 2. Nom « Auto-RH » retiré
L'application s'affiche désormais « Fiches de Paie » (onglet, en-tête,
connexion, portail). Aucune fonctionnalité changée.

### 3. Nouvelle icône « fiche »
Le favicon (ancien « Z ») est remplacé par l'icône fiche verte, identique au
logo de l'interface (fichiers publics/fiche-icon.svg et .png).
"""
    # insère après le titre principal (1re ligne)
    lines = rc.split("\n")
    lines.insert(1, "\n" + section)
    rc = "\n".join(lines)
    with open(readme, "w", encoding="utf-8") as f:
        f.write(rc)
    print("README: section NOUVEAUTÉ ajoutée")
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
        "public/fiche-icon.svg", "public/fiche-icon.png",
        "src/lib/payslip-ocr-adaptive.ts", "scripts/portail-server.js",
        "DEMARRER-WINDOWS.bat", "start-prod.js", "scripts/start-prod.js",
    ]:
        hit = [n for n in names if n.endswith(probe.split("/")[-1]) or n == probe]
        assert hit, f"MANQUANT dans le ZIP: {probe}"
    print("Sondes ZIP: OK")
print("DONE")
