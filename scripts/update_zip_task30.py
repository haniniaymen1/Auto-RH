#!/usr/bin/env python3
"""Task 30 : ajoute aux ZIP le mode silencieux (arrière-plan, sans fenêtre CMD).

Nouveaux fichiers (100 % additifs) :
  - scripts/auto-rh.js                        (moteur start/stop/status, multi-OS)
  - PREPARER-AUTO-RH-SILENCIEUX.bat                   (tâche de préparation cachée, Windows)
  - DEMARRER-SILENCIEUX-WINDOWS.vbs                    (double-clic : démarre sans fenêtre)
  - ARRETER-SILENCIEUX-WINDOWS.vbs                     (double-clic : arrêt propre)
  - ETAT-SILENCIEUX-WINDOWS.vbs                        (double-clic : état dans une popup)
  - JOURNAUX-SILENCIEUX-WINDOWS.vbs                    (double-clic : ouvre logs\\)
  - INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs        (optionnel : auto-démarrage session)
Mis à jour : README-DEPLOIEMENT-LOCAL.md (section 21).
"""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    ("scripts/auto-rh.js", "scripts/auto-rh.js", False),
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
    ("DEMARRER-SILENCIEUX-WINDOWS.vbs", "DEMARRER-SILENCIEUX-WINDOWS.vbs", True),
    ("ARRETER-SILENCIEUX-WINDOWS.vbs", "ARRETER-SILENCIEUX-WINDOWS.vbs", True),
    ("ETAT-SILENCIEUX-WINDOWS.vbs", "ETAT-SILENCIEUX-WINDOWS.vbs", True),
    ("JOURNAUX-SILENCIEUX-WINDOWS.vbs", "JOURNAUX-SILENCIEUX-WINDOWS.vbs", True),
    ("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs", "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs", True),
    # Documentation
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
]


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    cibles = {arc for _, arc, _ in FILES}
    for item in zin.infolist():
        if item.filename in cibles:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))

os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

ok = True
for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        names = zz.namelist()
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers, intégrité={'OK' if bad is None else 'KO'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   ⚠ MANQUANTS : {manquants}")

# Contrôles spécifiques Task 30 : CRLF + ASCII pur pour .bat/.vbs dans le ZIP
with zipfile.ZipFile(SRC) as zz:
    for arc in ["PREPARER-AUTO-RH-SILENCIEUX.bat", "DEMARRER-SILENCIEUX-WINDOWS.vbs",
                "ARRETER-SILENCIEUX-WINDOWS.vbs", "ETAT-SILENCIEUX-WINDOWS.vbs",
                "JOURNAUX-SILENCIEUX-WINDOWS.vbs", "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs"]:
        d = zz.read(arc)
        crlf = b"\r\n" in d and d.count(b"\n") == d.count(b"\r\n")
        ascii_ok = all(b < 128 for b in d)
        print(f"   {arc}: CRLF={'OK' if crlf else 'KO'}, ASCII={'OK' if ascii_ok else 'KO'}")
        if not (crlf and ascii_ok):
            ok = False

print("TASK30 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
