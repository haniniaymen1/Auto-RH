#!/usr/bin/env python3
"""
Met à jour le kit auto-rh-scripts-site-web.zip — correctifs « detection fausse » :

  1. start-prod.js          : copie AUTOMATIQUE des ressources standalone au
                              démarrage (worker pdf.js, OCR tesseract, langue FR,
                              static, public, .env). Avant, tout rebuild effaçait
                              ces ressources -> imports en échec/détection fausse.
  2. payslip-extractor.ts   : arbitrage CIN N° CNSS vs N° CIN étendu (règle
                              hi-res), détection des noms lus sur une ligne
                              d'en-tête (« COTES »), nom ≠ fonction (les noms en
                              MAJUSCULES de la ligne de valeurs sont prioritaires
                              sur la fonction en casse mixte), vocabulaire
                              fonctions élargi. 100 % additif.
  3. upload/route.ts        : même arbitrage CIN sur le chemin images PNG/JPG.
  4. payslip-reanalyze.ts   : même arbitrage CIN à la redétection d'images.

Aucun fichier du kit n'est supprimé, aucune règle de détection existante retirée.
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_detection"

if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

updated = [
    "scripts/start-prod.js",
    "src/lib/payslip-extractor.ts",
    "src/app/api/payslips/upload/route.ts",
    "src/lib/payslip-reanalyze.ts",
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---- Patch README : section « Correctifs détection fausse » ajoutée à la fin ----
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, "r", encoding="utf-8") as f:
    content = f.read()

section = """

---

## 13. Correctifs « détection fausse » (dernière version)

Cette version corrige les détections erronées constatées sur certains bulletins :

| Symptôme | Cause | Correctif |
|---|---|---|
| Après un `npm run build`, les imports échouent ou détectent mal | le build efface le worker pdf.js et l'OCR du dossier de production | `npm run start` recopie AUTOMATIQUEMENT ces ressources au démarrage (plus aucune manipulation manuelle) |
| CIN détecté = N° CNSS alors que le vrai CIN figure sous la colonne « N° CIN » | le numéro CNSS « 17775208 - 08 » est lu en premier | arbitrage automatique : le CIN lu sous « N° CIN » remplace le N° CNSS (PDF, images PNG/JPG et redétection) |
| Nom de l'employé = fonction (« Assistant Administratif », « Clientele »…) | sur la ligne de valeurs, la fonction en casse mixte passait avant le nom en MAJUSCULES | le nom en MAJUSCULES de la ligne de valeurs est désormais prioritaire |
| Nom = fragment d'en-tête (« COTES », « TES ») sur fiches scannées | nom lu dans la bande d'en-tête du tableau | déclenchement de la passe « haute lisibilité » + arbitrage du nom |

**Important** : après mise à jour, relancez `npm run build` puis `npm run start` — les fiches déjà importées peuvent être corrigées SANS ré-import via le bouton **Redétection** de l'onglet « Toutes les fiches ».
"""
content = content.rstrip("\n") + section
with open(readme, "w", encoding="utf-8") as f:
    f.write(content)
print("README patché (section 13 en fin de fichier).")

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

check = subprocess.run(["unzip", "-l", ZIP], capture_output=True, text=True).stdout
for want in ["scripts/start-prod.js", "src/lib/payslip-extractor.ts",
             "src/app/api/payslips/upload/route.ts", "src/lib/payslip-reanalyze.ts"]:
    print(("OK  " if want in check else "MANQUANT ") + want)
