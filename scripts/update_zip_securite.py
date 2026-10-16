#!/usr/bin/env python3
"""Ajoute les scripts de sécurisation + README mis à jour au ZIP livrable."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPY = "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip"
BASE = "/home/z/my-project"

NEW_FILES = [
    ("SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIER-WINDOWS.bat"),
    ("SECURISER-DOSSIER-LINUX-MAC.sh", "SECURISER-DOSSIER-LINUX-MAC.sh"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
]

# 1) Reconstruit le ZIP canonique en copiant l'existant + nouveaux fichiers
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    existing = set()
    for item in zin.infolist():
        if item.filename in [n for _, n in NEW_FILES]:
            continue  # remplacé par la version à jour
        zout.writestr(item, zin.read(item.filename))
        existing.add(item.filename)
    for src, arc in NEW_FILES:
        p = os.path.join(BASE, src)
        zout.write(p, arc)
        print(f"  + {arc}  ({os.path.getsize(p)} octets)")
    print(f"Total entrees : {len(existing) + len(NEW_FILES)}")

os.replace(tmp, SRC)

# 2) Rafraîchit la copie clairement nommée pour le téléchargement
shutil.copyfile(SRC, COPY)

# 3) Contrôle d'intégrité
for z in (SRC, COPY):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        n = len(zz.namelist())
        print(f"OK {os.path.basename(z)} : {n} fichiers, integrite={'OK' if bad is None else 'KO '+bad}, taille={os.path.getsize(z)//1024} Ko")
