#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère MANIFEST-LIVRAISON.txt (taille<TAB>chemin, une ligne par fichier) à
partir du contenu du ZIP LÉGER (dénominateur commun aux 2 ZIPs livrés).
Le manifeste ne se liste jamais lui-même ; db/custom.db est contrôlé à part
par verifier-extraction.js --complet.
Usage : python3 scripts/generer-manifest-livraison.py <fichier.zip-leger> <sortie>
"""
import subprocess
import sys
import re
import io

zip_path, sortie = sys.argv[1], sys.argv[2]
out = subprocess.run(["unzip", "-l", zip_path], capture_output=True, text=True).stdout
entrees = []
motif = re.compile(r"^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$")
for ligne in out.splitlines():
    m = motif.match(ligne)
    if not m:
        continue
    taille, nom = int(m.group(1)), m.group(2).strip()
    if nom.endswith("/"):
        continue  # répertoires
    if nom == "MANIFEST-LIVRAISON.txt":
        continue  # jamais auto-référencé
    entrees.append((taille, nom))

entrees.sort(key=lambda e: e[1])
with io.open(sortie, "w", encoding="utf-8", newline="\n") as f:
    for taille, nom in entrees:
        f.write(f"{taille}\t{nom}\n")
print(f"MANIFEST-LIVRAISON.txt généré : {len(entrees)} fichiers, depuis {zip_path}")
