#!/usr/bin/env python3
"""Task 35 + 35-bis : le ZIP ne contient plus que les lanceurs SILENCIEUX (Windows).

Retirés de l'archive :
  - DEMARRER-WINDOWS.bat        -> DEMARRER-SILENCIEUX-WINDOWS.vbs
  - DEMARRER-TOUT-WINDOWS.bat   -> DEMARRER-SILENCIEUX-WINDOWS.vbs
  - DEMARRER-PORTAIL-WINDOWS.bat-> DEMARRER-SILENCIEUX-WINDOWS.vbs (démarre les 2)
  - CHIFFRER-FICHES-WINDOWS.bat          -> (35) couvert par un jumeau silencieux
  - CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs -> (35-bis) retrait SUR DEMANDE :
    plus AUCUN lanceur de chiffrement dans l'archive. Aucune capacité perdue :
    le chiffrement est AUTOMATIQUE à l'import (Task 21) et l'outil reste fourni
    pour l'administrateur dans scripts/chiffrer-storage.js (terminal).
  - INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs -> (Task 42, 17/09/2026)
    retiré de l'archive : DEMARRER-SILENCIEUX-WINDOWS.vbs crée lui-même le
    raccourci Startup automatiquement (README section 30). Fichier conservé
    dans le dépôt de développement (non-suppressif).
Ajoutés / remplacés :
  - PREPARER-AUTO-RH-SILENCIEUX.bat (commentaires mis en cohérence)
  - scripts/portail-server.js   (message d'erreur -> démarrage silencieux)
  - README-DEPLOIEMENT-LOCAL.md (toutes les instructions Windows -> .vbs,
    section 14 réécrite sans lanceur de chiffrement)
Hérite de l'overlay Task 34 (exécuté d'abord).

Les fichiers restent présents dans le dépôt de développement : le retrait
concerne UNIQUEMENT le contenu des 3 ZIP livrables (non-suppressif).
"""
import zipfile, shutil, os, subprocess, sys

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

RETRAIT = [
    "DEMARRER-WINDOWS.bat",
    "DEMARRER-TOUT-WINDOWS.bat",
    "DEMARRER-PORTAIL-WINDOWS.bat",
    "CHIFFRER-FICHES-WINDOWS.bat",
    "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs",
]

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
]

SILENCIEUX = [
    "DEMARRER-SILENCIEUX-WINDOWS.vbs",
    "ARRETER-SILENCIEUX-WINDOWS.vbs",
    "ETAT-SILENCIEUX-WINDOWS.vbs",
    "JOURNAUX-SILENCIEUX-WINDOWS.vbs",
    "PREPARER-AUTO-RH-SILENCIEUX.bat",
    "CREER-SUPERADMIN-WINDOWS.bat",
]


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


# 1) Overlay Task 34 d'abord (cumulatif : fichiers code + README + tests)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task34.py")])
if r.returncode != 0:
    print("OVERLAY TASK34 EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Post-traitement : retraits + remplacements (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = set(RETRAIT) | {arc for _, arc, _ in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

# 3) Contrôles automatiques
ok = True
for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        restants = [n for n in RETRAIT if n in names]
        manquants = [n for n in SILENCIEUX if n not in names]
        doublons = len(liste) != len(names)
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers, intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if doublons:
            ok = False
        if restants:
            ok = False
            print(f"   ENCORE PRESENTS (à retirer) : {restants}")
        if manquants:
            ok = False
            print(f"   MANQUANTS (silencieux) : {manquants}")

with zipfile.ZipFile(SRC) as zz:
    prep = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat")
    crea = zz.read("CREER-SUPERADMIN-WINDOWS.bat")
    port = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    # (35-bis) plus AUCUN lanceur de chiffrement dans l'archive ni dans le README
    check2 = b"DEMARRER-WINDOWS.bat" not in prep and b"demarrage complet" in prep
    check3 = b"(" not in crea and b")" not in crea and b"DEMARRER-SILENCIEUX-WINDOWS.vbs" in crea
    check4 = "DEMARRER-SILENCIEUX-WINDOWS.vbs) puis r" in port
    check5 = (
        "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs" not in readm
        and "CHIFFRER-FICHES-WINDOWS.bat" not in readm
        and "chiffrer-storage.js" in readm
        and "Double-cliquer sur `DEMARRER-SILENCIEUX-WINDOWS.vbs`" in readm
        and "Laisser la fenêtre noire ouverte" not in readm
        and "invite à lancer DEMARRER-WINDOWS.bat" not in readm
    )
    print(f"   PREPARER commentaires cohérents : {'OK' if check2 else 'KO'}")
    print(f"   CREER-SUPERADMIN sans parenthèses + renvoi silencieux : {'OK' if check3 else 'KO'}")
    print(f"   portail-server.js message silencieux : {'OK' if check4 else 'KO'}")
    print(f"   README sans lanceur CHIFFRER + instructions silencieuses : {'OK' if check5 else 'KO'}")
    ok = ok and check2 and check3 and check4 and check5

print("TASK35 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
