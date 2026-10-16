#!/usr/bin/env python3
"""Task 23 : met à jour les ZIP avec le découpage automatique des PDF multi-fiches."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Task 23 — découpage automatique des PDF multi-fiches (1 fiche = 1 PDF)
    ("src/lib/pdf-splitter.ts", "src/lib/pdf-splitter.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    ("src/app/api/payslips/[id]/route.ts", "src/app/api/payslips/[id]/route.ts"),
    ("src/lib/payslip-reanalyze.ts", "src/lib/payslip-reanalyze.ts"),
    ("scripts/scinder-pdfs-multipages.js", "scripts/scinder-pdfs-multipages.js"),
    ("SCINDER-FICHES-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat"),
    # Dépendance ajoutée (pdf-lib)
    ("package.json", "package.json"),
    ("package-lock.json", "package-lock.json"),
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
