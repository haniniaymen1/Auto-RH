#!/usr/bin/env python3
"""
Met à jour le kit de déploiement auto-rh-scripts-site-web.zip avec la
fonctionnalité MULTI-FORMATS (ajouts sans suppression — aucune config
existante retirée) :

  AJOUTS   : src/lib/payslip-office.ts (ZIP/Excel/Word),
             scripts/make_multi_format_fixtures.js, scripts/test_multi_formats.py,
             scripts/test_font_ocr.js
  MODIFS   : upload/route.ts (ZIP+XLSX+DOCX, chemins historiques inchangés),
             [id]/file/route.ts (MIME Excel/Word ajoutés),
             import-tab.tsx (nouveaux formats acceptés),
             next.config.ts (+3 paquets externes), package.json (dépendances),
             types.ts (champs optionnels), portail-server.js (MIME)
  README   : section 14 « Formats multiples » + FAQ

Aucun fichier existant du kit n'est supprimé.
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_multi"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers du projet (ajouts + mises à jour) ----------
updated = [
    "src/lib/payslip-office.ts",
    "src/lib/types.ts",
    "src/app/api/payslips/upload/route.ts",
    "src/app/api/payslips/[id]/file/route.ts",
    "src/components/payslip/import-tab.tsx",
    "next.config.ts",
    "package.json",
    "scripts/portail-server.js",
    "scripts/make_multi_format_fixtures.js",
    "scripts/test_multi_formats.py",
    "scripts/test_font_ocr.js",
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

old_faq = """1) Si le PDF contient du texte, vérifiez dans l'administration que le CIN y figure bien. 2) Si le PDF est une **image** (scan, conversion PNG → PDF) ou si vous déposez directement un **PNG / JPG**, le site le lit automatiquement par **OCR** (reconnaissance de caractères, français) — voir la partie 13. Si l'OCR échoue, améliorez la qualité/lisibilité de l'image (résolution, contraste) puis réimportez."""
new_faq = """1) Si le PDF contient du texte, vérifiez dans l'administration que le CIN y figure bien. 2) Si le PDF est une **image** (scan, conversion PNG → PDF) ou si vous déposez directement un **PNG / JPG**, le site le lit automatiquement par **OCR** (reconnaissance de caractères, français) — voir la partie 13. Si l'OCR échoue, améliorez la qualité/lisibilité de l'image (résolution, contraste) puis réimportez. 3) Vous pouvez aussi importer une **archive ZIP** contenant plusieurs fiches (PDF, PNG/JPG, Excel, Word — tout mélangé), des **classeurs Excel** (XLSX/XLS) ou des **documents Word** (DOCX) — voir la partie 14. Les fichiers contenant PLUSIEURS fiches (PDF multi-pages, ZIP, Excel multi-feuilles) sont automatiquement découpés : 1 fiche = 1 enregistrement recherchable par CIN."""
assert old_faq in content, "bloc FAQ OCR introuvable"
content = content.replace(old_faq, new_faq)

content = content.rstrip("\n") + """

---

## 14. Formats multiples — ZIP, Excel (XLSX), Word (DOCX) et fiches multiples

Depuis cette version, l'import accepte **tous les usages courants** — les fichiers déjà acceptés (PDF texte, PDF image, PNG/JPG) restent traités exactement comme avant :

| Ce que vous avez | Ce que fait le site |
|---|---|
| Plusieurs fiches dans **1 seul PDF** (multi-pages) | **Découpe automatique** — 1 fiche par page, pages du même CIN regroupées |
| Plusieurs **PNG convertis en 1 seul PDF** | OCR de chaque page + découpe automatique par fiche |
| Plusieurs PNG/JPG dans **1 archive ZIP** | Chaque image = 1 fiche (OCR) |
| Plusieurs PDF dans **1 archive ZIP** | Chaque PDF = 1 fiche (ou découpe si multi-fiches) |
| Plusieurs **XLSX / XLS** dans 1 ZIP, ou 1 classeur | Chaque **feuille** = 1 fiche ; plusieurs CIN dans le classeur → 1 fiche par CIN |
| Plusieurs **DOCX** dans 1 ZIP, ou 1 document | Texte extrait automatiquement ; plusieurs CIN → 1 fiche par CIN |
| **ZIP « tout mélangé »** (PDF + PNG + Excel + Word, sous-dossiers inclus) | Tous les fichiers sont traités individuellement |

**Détails pratiques** :
- Formats acceptés à l'import : `PDF`, `PNG`, `JPG`, `ZIP`, `XLSX`, `XLS`, `XLSM`, `DOCX`.
- Les archives ZIP imbriquées (ZIP dans ZIP) sont acceptées jusqu'à 2 niveaux ; les dossiers `__MACOSX`, fichiers cachés et temporaires Office (`~$…`) sont ignorés.
- Les MÊMES règles de détection (CIN, nom, période, net à payer, matricule) sont appliquées à tous les formats : aucune règle n'a été modifiée, les nouveaux formats sont un **ajout**.
- Le fichier original (Excel, Word, ZIP décompressé fichier par fichier) est conservé : chaque fiche reste ouvrable/téléchargeable depuis l'administration et le portail.
- Après un import ZIP, le résultat détaille ce qui a été fait **fichier par fichier** (importés, fiches créées, erreurs éventuelles).

**Test rapide** : `node scripts/make_multi_format_fixtures.js` génère des échantillons (XLSX 2 feuilles, DOCX 1 et 2 fiches, PNG, ZIP mixte) dans `scripts/fixtures_multi/`, puis `python3 scripts/test_multi_formats.py` vérifie le site complet (46 vérifications).
"""

with open(readme, "w", encoding="utf-8") as f:
    f.write(content)
print("README mis à jour (FAQ + section 14)")

# ---------- 4. Ré-empaquetage ----------
new_zip = ZIP + ".new"
if os.path.exists(new_zip):
    os.remove(new_zip)
with zipfile.ZipFile(new_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    for base, dirs, files in os.walk(WORK):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, WORK)
            zf.write(full, rel)
os.replace(new_zip, ZIP)
print("ZIP mis à jour :", ZIP, "-", round(os.path.getsize(ZIP) / 1024 / 1024, 2), "Mo")
