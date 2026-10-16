#!/usr/bin/env python3
"""Task 22 : met à jour les ZIP avec le correctif CIN + ré-application Task 20/21."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Correctif Task 22 « l'employé ne voit pas sa fiche »
    ("src/lib/payslip-extractor.ts", "src/lib/payslip-extractor.ts"),
    ("src/app/api/payslips/route.ts", "src/app/api/payslips/route.ts"),
    # Task 21 (chiffrement AES-256) ré-appliquée
    ("src/lib/storage-crypto.ts", "src/lib/storage-crypto.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    ("src/app/api/payslips/[id]/file/route.ts", "src/app/api/payslips/[id]/file/route.ts"),
    ("src/app/api/payslips/redetect/route.ts", "src/app/api/payslips/redetect/route.ts"),
    ("scripts/portail-server.js", "scripts/portail-server.js"),
    ("scripts/chiffrer-storage.js", "scripts/chiffrer-storage.js"),
    ("CHIFFRER-FICHES-WINDOWS.bat", "CHIFFRER-FICHES-WINDOWS.bat"),
    # Task 20 (sécurisation NTFS) ré-appliquée
    ("SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIER-WINDOWS.bat"),
    ("SECURISER-DOSSIER-LINUX-MAC.sh", "SECURISER-DOSSIER-LINUX-MAC.sh"),
    # Documentation
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
]

tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename in [n for _, n in FILES]:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc in FILES:
        zout.write(os.path.join(BASE, src), arc)

os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        print(f"OK {os.path.basename(z)} : {len(zz.namelist())} fichiers, intégrité={'OK' if bad is None else 'KO'}, taille={os.path.getsize(z)//1024} Ko")
