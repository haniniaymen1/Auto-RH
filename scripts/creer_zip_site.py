#!/usr/bin/env python3
# Task 160/162 — ZIP du site Auto-RH (version testée) pour déploiement
# Usage : python3 creer_zip_site.py [nom_sortie.zip]  (défaut : version v2)
import os, sys, zipfile, time

ROOT = "/home/z/my-project"
OUT = os.path.join(ROOT, "download",
                   sys.argv[1] if len(sys.argv) > 1
                   else "auto-rh-site-teste-v2-20260924.zip")

# Dossiers inclus en entier
DIRS = ["src", "prisma", "public", "storage", "tessdata", "ocr-data",
        "documents-demandes"]
# Dossiers exclus à l'intérieur d'un dossier inclus
SKIP_IN_DIRS = {"src": set(), "public": set()}
# db : uniquement custom.db (pas les sauvegardes .old*)
DB_FILES = ["db/custom.db"]
# scripts : uniquement les fichiers de premier niveau (pas taskNNN/test-data)
# racine : tous les fichiers sauf la liste noire ci-dessous
ROOT_EXCLUDE = {"fra.traineddata", "tsconfig.tsbuildinfo",
                ".initial_snapshot.json", ".pending_clone.json"}

total = 0
files = []

def add(arc, disk):
    global total
    files.append((arc, disk))
    total += os.path.getsize(disk)

for d in DIRS:
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, d)):
        dirnames[:] = [x for x in dirnames if x not in SKIP_IN_DIRS.get(d, set())
                       and not x.startswith(".next")]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if os.path.islink(full):
                continue
            add(os.path.relpath(full, ROOT), full)

for rel in DB_FILES:
    add(rel, os.path.join(ROOT, rel))

sc = os.path.join(ROOT, "scripts")
for fn in sorted(os.listdir(sc)):
    full = os.path.join(sc, fn)
    if os.path.isfile(full):
        add(os.path.join("scripts", fn), full)

for fn in sorted(os.listdir(ROOT)):
    full = os.path.join(ROOT, fn)
    if os.path.isfile(full) and fn not in ROOT_EXCLUDE:
        add(fn, full)

print(f"Fichiers à archiver : {len(files)}")
print(f"Taille brute        : {total/1024/1024:.1f} Mo")
t0 = time.time()
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for arc, disk in files:
        z.write(disk, arc)

with zipfile.ZipFile(OUT) as z:
    bad = z.testzip()
    n = len(z.infolist())
size = os.path.getsize(OUT)
print(f"ZIP créé            : {OUT}")
print(f"Intégrité           : {'OK' if bad is None else 'CORROMPU: ' + bad}")
print(f"Entrées             : {n}")
print(f"Taille ZIP          : {size/1024/1024:.1f} Mo ({time.time()-t0:.0f} s)")
