#!/usr/bin/env python3
"""
Met à jour le kit de déploiement auto-rh-scripts-site-web.zip avec la
fonctionnalité OCR (fiches image PNG -> PDF, scans, PNG/JPG directs) :

  AJOUTS   : src/lib/payslip-ocr.ts, scripts/test_ocr.js, ocr-data/fra.traineddata
  MODIFS   : payslip-extractor.ts, upload/route.ts, [id]/file/route.ts,
             import-tab.tsx, next.config.ts, package.json,
             copy-standalone-assets.js, portail-server.js
  README   : section OCR + FAQ mise à jour

Aucun fichier existant du kit n'est supprimé.
"""
import os
import re
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers du projet (ajouts + mises à jour) ----------
updated = [
    "src/lib/payslip-ocr.ts",
    "src/lib/payslip-extractor.ts",
    "src/app/api/payslips/upload/route.ts",
    "src/app/api/payslips/[id]/file/route.ts",
    "src/components/payslip/import-tab.tsx",
    "next.config.ts",
    "package.json",
    "scripts/copy-standalone-assets.js",
    "scripts/portail-server.js",
    "scripts/test_ocr.js",
    "ocr-data/fra.traineddata",
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---------- 3. Patch du README ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, "r", encoding="utf-8") as f:
    content = f.read()

old_faq = """**Un PDF importé n'apparaît pas dans la recherche**
Le PDF est probablement **scanné en image** (sans couche texte) : la recherche par CIN ne peut pas lire son contenu. Ce cas est signalé à l'import (« Aucun texte extractible »). Utilisez des fiches exportées en PDF texte depuis Sage."""
new_faq = """**Un PDF importé n'apparaît pas dans la recherche**
1) Si le PDF contient du texte, vérifiez dans l'administration que le CIN y figure bien. 2) Si le PDF est une **image** (scan, conversion PNG → PDF) ou si vous déposez directement un **PNG / JPG**, le site le lit automatiquement par **OCR** (reconnaissance de caractères, français) — voir la partie 13. Si l'OCR échoue, améliorez la qualité/lisibilité de l'image (résolution, contraste) puis réimportez."""
assert old_faq in content, "bloc FAQ introuvable"
content = content.replace(old_faq, new_faq)

content = content.rstrip("\n") + """

---

## 13. Fiches image, scans et fichiers PNG/JPG — lecture par OCR intégrée

Depuis cette version, le site lit **automatiquement** les fiches de paie qui ne contiennent pas de texte :

| Type de fichier | Comportement |
|---|---|
| PDF texte (export Sage) | Lecture directe (inchangée) |
| PDF image (conversion « PNG to PDF », scan, photo) | **OCR automatique** de chaque page |
| **PNG / JPG** déposés directement | **OCR automatique** — plus besoin de convertir en PDF |

**Comment ça marche** : si aucune extraction de texte n'est possible, chaque page est rendue en image puis analysée par l'OCR **Tesseract (français)**, intégré au site. Les mêmes règles de détection s'appliquent ensuite (CIN, nom, période, net à payer, matricule) : les fiches image deviennent recherchables par CIN exactement comme les autres.

**Points importants** :
- Le langage OCR (`ocr-data/fra.traineddata`) est **inclus dans le dossier du site** : l'OCR fonctionne **100 % hors ligne**.
- L'ajout de nouveaux formats est **incrémental** : les fiches PDF texte existantes sont traitées exactement comme avant, sans aucune modification.
- Les messages d'import indiquent quand l'OCR a été utilisé : « CIN détecté **par OCR** : … ».
- L'OCR prend quelques secondes par fiche (rendu + reconnaissance). Pour de gros lots de fiches image, laissez l'import se terminer.
- Après une mise à jour du code : relancez `npm install` (nouveaux paquets `tesseract.js` et `@napi-rs/canvas`), puis `npm run build` et redémarrez. Le script de build copie automatiquement les ressources OCR dans le dossier de production.
"""
with open(readme, "w", encoding="utf-8") as f:
    f.write(content)
print("README patché (section 13 + FAQ).")

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
check = subprocess.run(
    ["unzip", "-l", ZIP], capture_output=True, text=True).stdout
for want in ["src/lib/payslip-ocr.ts", "ocr-data/fra.traineddata",
             "scripts/test_ocr.js", "src/components/payslip/import-tab.tsx"]:
    print(("OK  " if want in check else "MANQUANT ") + want)
print("Fichiers totaux dans le ZIP:", len([l for l in check.splitlines() if l.strip() and not l.startswith(('Archive', 'Length', '----', '  '))]))
