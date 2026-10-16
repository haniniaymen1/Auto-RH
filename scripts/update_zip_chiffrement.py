#!/usr/bin/env python3
"""Task 21 : met à jour les ZIP avec le chiffrement AES-256 intégré."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPY = "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip"
COPY2 = "/home/z/my-project/download/auto-rh.zip"
BASE = "/home/z/my-project"

NEW_FILES = [
    # fichiers modifiés (remplacés dans le ZIP)
    ("src/lib/storage-crypto.ts", "src/lib/storage-crypto.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    ("src/app/api/payslips/[id]/file/route.ts", "src/app/api/payslips/[id]/file/route.ts"),
    ("src/app/api/payslips/redetect/route.ts", "src/app/api/payslips/redetect/route.ts"),
    ("scripts/portail-server.js", "scripts/portail-server.js"),
    ("scripts/start-prod.js", "scripts/start-prod.js"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
    # nouveaux fichiers
    ("scripts/chiffrer-storage.js", "scripts/chiffrer-storage.js"),
    ("CHIFFRER-FICHES-WINDOWS.bat", "CHIFFRER-FICHES-WINDOWS.bat"),
]

tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    replaced = set()
    for item in zin.infolist():
        if item.filename in [n for _, n in NEW_FILES]:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc in NEW_FILES:
        p = os.path.join(BASE, src)
        zout.write(p, arc)
        replaced.add(arc)
    print(f"Fichiers ajoutés/remplacés : {len(replaced)}")

os.replace(tmp, SRC)
for c in (COPY, COPY2):
    shutil.copyfile(SRC, c)

for z in (SRC, COPY, COPY2):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        n = len(zz.namelist())
        print(f"OK {os.path.basename(z)} : {n} fichiers, intégrité={'OK' if bad is None else 'KO'}, taille={os.path.getsize(z)//1024} Ko")
