#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 71 — BOOTSTRAP : injecte UNE FOIS les fichiers Task 71 dans les 3 ZIP
au disque (l'archive doit porter l'état final AVANT que la chaîne idempotente
soit relancée, car les maillons intermédiaires vérifient ATTENDU = 259).
Ensuite on relance scripts/update_zip_task71.py qui rejoue la chaîne
complète + overlay + contrôles (idempotent)."""
import zipfile, os, shutil, hashlib, sys

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
FILES = [
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py"),
    ("scripts/test71_harnais.sh", "scripts/test71_harnais.sh"),
]


def lire(src):
    return open(os.path.join(BASE, src), "rb").read()


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


# Injecte dans l'archive principale SANS reconstruire la chaîne (bootstrap)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc in FILES:
        zout.writestr(arc, lire(src))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        names = zz.namelist()
        print(f"{os.path.basename(z)} : {len(set(names))} fichiers, intégrité {'OK' if zz.testzip() is None else 'KO'}, "
              f"test71={'présent' if any('test71' in n for n in names) else 'ABSENT'}, md5={md5(z)[:12]}")
print("BOOTSTRAP TERMINÉ — relancer update_zip_task71.py pour la chaîne complète.")
