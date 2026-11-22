#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — changement des PORTS 3000 -> 4000 (administration) et
3001 -> 4001 (portail employés) dans les lanceurs Windows et fichiers
divers, SANS toucher à l'encodage (les .bat/.vbs restent exactement
comme ils sont : CRLF, encodage d'origine préservé — seuls les chiffres
des ports sont remplacés, en BINAIRE).
"""
import io
import sys

BASE = "/home/z/my-project"

# (fichier, nb occurrences "3000", nb occurrences "3001")
CIBLES = [
    ("DEMARRER-WINDOWS.bat", 3, 0),
    ("DEMARRER-PORTAIL-WINDOWS.bat", 3, 6),
    ("DEMARRER-TOUT-WINDOWS.bat", 5, 5),
    ("DEMARRER-SILENCIEUX-WINDOWS.vbs", 2, 1),
    ("ARRETER-SILENCIEUX-WINDOWS.vbs", 1, 1),
    ("ETAT-SILENCIEUX-WINDOWS.vbs", 1, 1),
    ("JOURNAUX-SILENCIEUX-WINDOWS.vbs", 1, 1),
    ("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs", 1, 1),
    ("DEMARRER-LINUX-MAC.sh", 2, 0),
    ("DEMARRER-PORTAIL-LINUX-MAC.sh", 3, 6),
    ("DEMARRER-TOUT-LINUX-MAC.sh", 4, 4),
    ("Caddyfile", 1, 0),
    ("Dockerfile", 4, 2),
    ("docker-compose.yml", 3, 4),
]

# Vérifier d'abord les attendus (état d'origine OU état déjà appliqué)
erreurs = []
for nom, n3000, n3001 in CIBLES:
    with io.open(f"{BASE}/{nom}", "rb") as f:
        data = f.read()
    c30 = data.count(b"3000")
    c31 = data.count(b"3001")
    c40 = data.count(b"4000")
    c41 = data.count(b"4001")
    deja = c30 == 0 and c31 == 0 and c40 >= n3000 and c41 >= n3001
    if not deja and (c30 != n3000 or c31 != n3001):
        erreurs.append(f"{nom} : attendu 3000×{n3000}/3001×{n3001} (ou déjà appliqué), trouvé 3000×{c30}/3001×{c31}/4000×{c40}/4001×{c41}")
if erreurs:
    print("ATTENDUS NON CONFORMES :")
    for e in erreurs:
        print("  -", e)
    sys.exit(1)

# Remplacement binaire (préserve CRLF et encodage d'origine). Idempotent :
# si 4000/4001 déjà en place et plus aucun 3000/3001, le fichier est déjà traité.
for nom, n3000, n3001 in CIBLES:
    chemin = f"{BASE}/{nom}"
    with io.open(chemin, "rb") as f:
        data = f.read()
    if data.count(b"3000") == 0 and data.count(b"3001") == 0:
        print(f"  [skip déjà appliqué] {nom}")
        continue
    data = data.replace(b"3000", b"4000").replace(b"3001", b"4001")
    with io.open(chemin, "wb") as f:
        f.write(data)
    print(f"  [ok] {nom}")

# Contrôles post-remplacement
for nom, n3000, n3001 in CIBLES:
    with io.open(f"{BASE}/{nom}", "rb") as f:
        data = f.read()
    assert data.count(b"4000") >= n3000, nom
    assert data.count(b"4001") >= n3001, nom
    assert b"3000" not in data, f"reste 3000 dans {nom}"
    assert b"3001" not in data, f"reste 3001 dans {nom}"
    # CRLF : avertissement seulement (certains .bat du dépôt sont historiquement
    # en LF — le remplacement binaire ne modifie JAMAIS les fins de ligne).
    if nom.endswith((".bat", ".vbs")):
        nl = data.count(b"\n")
        crlf = data.count(b"\r\n")
        if nl != crlf:
            print(f"  [info] {nom} : fins de ligne LF historiques ({nl} LF / {crlf} CRLF) — inchangées")
print("Terminé : ports 4000/4001 appliqués aux lanceurs, encodage et fins de ligne préservés.")
