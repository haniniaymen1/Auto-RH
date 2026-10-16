#!/usr/bin/env python3
"""Task 25 : met à jour les ZIP avec le découpage automatique des documents Word multi-pages."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Task 25 — découpage automatique des documents Word multi-pages
    ("src/lib/docx-splitter.ts", "src/lib/docx-splitter.ts"),
    ("src/app/api/payslips/upload/route.ts", "src/app/api/payslips/upload/route.ts"),
    ("src/lib/payslip-reanalyze.ts", "src/lib/payslip-reanalyze.ts"),
    ("src/components/payslip/import-tab.tsx", "src/components/payslip/import-tab.tsx"),
    ("scripts/scinder-docx-multipages.js", "scripts/scinder-docx-multipages.js"),
    ("scripts/build_test_docx.js", "scripts/build_test_docx.js"),
    ("scripts/test_docx_splitter_unit.js", "scripts/test_docx_splitter_unit.js"),
    ("scripts/verify_docx_content.js", "scripts/verify_docx_content.js"),
    ("SCINDER-DOCX-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat"),
    # Dépendance ajoutée (jszip — désormais déclarée)
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
        # vérifie la présence des fichiers Task 25
        missing = [arc for _, arc in FILES if arc not in names]
        if missing:
            print(f"   ⚠ MANQUANTS dans {os.path.basename(z)} : {missing}")
