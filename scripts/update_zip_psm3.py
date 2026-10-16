#!/usr/bin/env python3
"""
Mise à jour incrémentale du kit auto-rh-scripts-site-web.zip :

  CORRECTIF « fiches scannées mal lues » (ex. TUNIS CALL CENTER) :
  - payslip-ocr.ts       : PSM 3 explicite pour la 1re passe OCR (le défaut
                           tesseract.js v7 lit mal les fiches en tableau) ;
  - payslip-extractor.ts : noms en casse mixte (« Amine trablesi »), CIN lu
                           dans le contexte de la colonne « N° CIN » (y
                           compris 9 chiffres imprimés), arbitrage anti-
                           fragments-d'en-tête (« ETATCIVIL ENFACHARGE ») ;
  - scripts/test_e2e_user_pdf.py : test E2E du cas réel (AJOUT).

Aucun fichier du kit n'est supprimé ; aucune règle de détection existante
n'est modifiée (ajouts uniquement).
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_psm3"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers mis à jour (remplacement à l'identique
#              du chemin, contenu enrichi — rien n'est retiré) ----------
updated = [
    "src/lib/payslip-ocr.ts",
    "src/lib/payslip-extractor.ts",
    "scripts/test_e2e_user_pdf.py",  # AJOUT (nouveau test E2E)
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---------- 3. Patch README (note de version, en complément — rien
#              d'existant n'est retiré) ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, "r", encoding="utf-8") as f:
    content = f.read()

note = """
### Mise à jour OCR — fiches en tableau scannées (qualité de lecture)

La première passe OCR utilise désormais explicitement le mode de segmentation
**PSM 3** (le défaut de tesseract.js v7 lisait mal certaines fiches en tableau :
caractères erronés dans le matricule, le nom ou le CIN — ex. « 14965358 » au
lieu de « 149654358 »). Sont également ajoutés, sans rien modifier au
comportement existant :

- lecture du **nom en casse mixte** sur les fiches en tableau
  (« Amine trablesi »), même quand le nom de famille est en minuscules ;
- lecture du **CIN dans le contexte de la colonne « N° CIN »**, y compris les
  CIN imprimés sur **9 chiffres**, en évitant de confondre avec le N° CNSS
  (« 17775208 - 08 ») ;
- détection et correction des **fragments d'en-tête** mal lus comme nom
  (« ETATCIVIL ENFACHARGE », « AGHIRGE »).

Si vous mettez à jour un site déjà déployé : remplacez les fichiers du
dossier du site par ceux de ce kit, puis `npm run build` et redémarrez.
Aucun paquet supplémentaire n'est nécessaire.
"""
marker = "### Mise à jour OCR — fiches en tableau scannées (qualité de lecture)"
if marker not in content:
    content = content.rstrip("\n") + "\n" + note
    print("README : note de version ajoutée.")
else:
    print("README : note déjà présente, inchangé.")
with open(readme, "w", encoding="utf-8") as f:
    f.write(content)

# ---------- 4. Re-création du ZIP (tous les fichiers conservés) ----------
tmp_zip = ZIP + ".new"
with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(WORK):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, WORK)
            z.write(full, rel)
shutil.move(tmp_zip, ZIP)
size = os.path.getsize(ZIP) / (1024 * 1024)
print(f"\nZIP mis à jour : {ZIP} ({size:.1f} Mo)")

# ---------- 5. Vérification ----------
check = subprocess.run(["unzip", "-l", ZIP], capture_output=True, text=True).stdout
for want in [
    "src/lib/payslip-ocr.ts",
    "src/lib/payslip-extractor.ts",
    "scripts/test_e2e_user_pdf.py",
    "ocr-data/fra.traineddata",
    "scripts/portail-server.js",
    "README-DEPLOIEMENT-LOCAL.md",
]:
    print(("OK  " if want in check else "MANQUANT ") + want)
total = len([l for l in check.splitlines() if l.strip() and not l.startswith(("Archive", "Length", "----", "  "))])
print("Fichiers totaux dans le ZIP:", total)
