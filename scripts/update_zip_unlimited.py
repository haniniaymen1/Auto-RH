#!/usr/bin/env python3
"""
Met à jour le kit auto-rh-scripts-site-web.zip : liste des fiches ILLIMITÉE.
  MODIFS : src/app/api/payslips/route.ts
           (avant : limite par défaut 200, plafond 500 → désormais illimité par
            défaut ; `limit`/`offset` explicites restent honorés)
Aucun fichier existant du kit n'est supprimé, aucune config de détection modifiée.
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_unlimited"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie du fichier modifié ----------
updated = [
    "src/app/api/payslips/route.ts",
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---------- 3. Vérif contenu du fichier dans le kit ----------
dst_route = os.path.join(WORK, "src/app/api/payslips/route.ts")
with open(dst_route, "r", encoding="utf-8") as f:
    c = f.read()
assert "ILLIMITÉ" in c and "limit > 0 ? limit : undefined" in c, "patch absent !"
assert "??" + ' "200"' not in c, "ancienne limite 200 encore présente !"
print("route.ts du kit : illimité confirmé, ancienne limite supprimée.")

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

# ---------- 5. Vérification finale ----------
check = subprocess.run(["unzip", "-l", ZIP], capture_output=True, text=True).stdout
print("OK  src/app/api/payslips/route.ts présent" if "src/app/api/payslips/route.ts" in check else "MANQUANT route.ts")
