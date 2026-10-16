#!/usr/bin/env python3
"""Task 33 : met à jour les ZIP avec « Se souvenir de moi » + session glissante.

Remplacés :
  - scripts/portail-server.js        (case « Se souvenir de moi », durées
                                      configurables PORTAL_SESSION_*_MINUTES,
                                      renouvellement glissant, compat jetons rm)
  - README-DEPLOIEMENT-LOCAL.md      (section 24)
Nouveaux :
  - scripts/test_task33_souvenir.py  (test E2E 21 vérifications)
  - scripts/extrait-acces-portail.js (helper de test lecture seule)
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
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("scripts/test_task33_souvenir.py", "scripts/test_task33_souvenir.py", False),
    ("scripts/extrait-acces-portail.js", "scripts/extrait-acces-portail.js", False),
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
            print(f"   MANQUANTS : {manquants}")

# Contrôles automatiques sur le ZIP source
with zipfile.ZipFile(SRC) as zz:
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    test33 = zz.read("scripts/test_task33_souvenir.py").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check1 = "PORTAL_SESSION_MAX_AGE_MINUTES" in portail and "REMEMBER_MAX_AGE" in portail \
        and "renouvelerSession" in portail and "Se souvenir de moi sur cet appareil" in portail
    check2 = "rm: remember ? 1 : 0" in portail and "sess.rm === true" in portail
    check3 = "Task 33" in test33 and "2592000" in test33 and "1800" in test33
    check4 = "## 24. Rester connecté au portail" in readm and "PORTAL_SESSION_REMEMBER_MINUTES" in readm
    # plus aucun « 30 minutes » figé comme seule durée de session
    check5 = "const SESSION_MAX_AGE = 30 * 60; // 30 minutes (données sensibles)" not in portail
    print(f"   portail Task 33 (souvenir+config+glissant) : {'OK' if check1 else 'KO'}")
    print(f"   jetons rm compatibles : {'OK' if check2 else 'KO'}")
    print(f"   test E2E embarqué : {'OK' if check3 else 'KO'}")
    print(f"   README section 24 : {'OK' if check4 else 'KO'}")
    print(f"   ancienne constante figée retirée : {'OK' if check5 else 'KO'}")
    ok = ok and check1 and check2 and check3 and check4 and check5

print("TASK33 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
