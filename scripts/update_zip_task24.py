#!/usr/bin/env python3
"""Task 24 : met à jour les ZIP avec le découpage automatique des classeurs Excel multi-feuilles."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Task 24 — découpage automatique des classeurs Excel multi-feuilles
    ("src/lib/excel-splitter.ts", "src/lib/excel-splitter.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    ("src/lib/payslip-reanalyze.ts", "src/lib/payslip-reanalyze.ts"),
    ("src/components/payslip/import-tab.tsx", "src/components/payslip/import-tab.tsx"),
    ("scripts/scinder-excel-multipages.js", "scripts/scinder-excel-multipages.js"),
    ("SCINDER-EXCEL-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat"),
    # Dépendance ajoutée (exceljs)
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
        names = zz.namelist()
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers, intégrité={'OK' if bad is None else 'KO'}, taille={os.path.getsize(z)//1024} Ko")
        # vérifie la présence des fichiers Task 24
        missing = [arc for _, arc in FILES if arc not in names]
        if missing:
            print(f"   ⚠ MANQUANTS dans {os.path.basename(z)} : {missing}")
