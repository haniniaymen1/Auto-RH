#!/usr/bin/env python3
"""Task 27 : met à jour les ZIP avec la détection du CIN tunisien à 9 chiffres."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Task 27 — CIN tunisien 9 chiffres (détection + arbitrage + splitters)
    ("src/lib/payslip-extractor.ts", "src/lib/payslip-extractor.ts"),
    ("src/lib/payslip-office.ts", "src/lib/payslip-office.ts"),
    ("src/lib/docx-splitter.ts", "src/lib/docx-splitter.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    # Scripts de test / diagnostic
    ("scripts/diag_cin_tunisien.js", "scripts/diag_cin_tunisien.js"),
    ("scripts/test_task27_cin9.py", "scripts/test_task27_cin9.py"),
    ("scripts/test_task27_redetect.py", "scripts/test_task27_redetect.py"),
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
        missing = [arc for _, arc in FILES if arc not in names]
        if missing:
            print(f"   ⚠ MANQUANTS dans {os.path.basename(z)} : {missing}")
