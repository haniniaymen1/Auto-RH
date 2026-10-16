#!/usr/bin/env python3
"""Task 28 : met à jour les ZIP avec le garde « bulletin vertical »
(découpage 1 feuille = 1 fiche des classeurs Excel multi-bulletins verticaux)."""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    # Task 28 — garde « bulletin vertical » dans expandSheetTexts
    ("src/lib/payslip-office.ts", "src/lib/payslip-office.ts"),
    # Scripts de test / diagnostic
    ("scripts/diag_split_excel_50.js", "scripts/diag_split_excel_50.js"),
    ("scripts/diag_rowtable_reg.js", "scripts/diag_rowtable_reg.js"),
    ("scripts/diag_split_rowtable_trace.js", "scripts/diag_split_rowtable_trace.js"),
    ("scripts/test_task28_split_excel.py", "scripts/test_task28_split_excel.py"),
    ("scripts/test_task28_rowtable_reg.py", "scripts/test_task28_rowtable_reg.py"),
    ("scripts/ts-resolve-hook.mjs", "scripts/ts-resolve-hook.mjs"),
    ("scripts/register-loader.mjs", "scripts/register-loader.mjs"),
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
