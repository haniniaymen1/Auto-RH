#!/usr/bin/env python3
"""Task 32 : met à jour les ZIP avec la sécurisation du contenu de custom.db.

Nouveaux fichiers :
  - src/lib/db-crypto.ts                       (jumelle TS de lib-crypto-bd)
  - scripts/lib-crypto-bd.js                   (chiffrement AES-256-GCM des champs)
  - scripts/chiffrer-base.js                   (migration + statut + rollback + VACUUM)
  - scripts/sauvegarde-bd.js                   (sauvegardes chiffrées .pgb)
  - SECURISER-DOSSIERS-WINDOWS.bat             (permissions + EFS, double-clic)
  - SAUVEGARDER-BD-WINDOWS.bat                 (sauvegarde chiffrée, double-clic)
  - scripts/test_task32_migration.py           (test migration sur copie)
  - scripts/test_task32_securite_bd.py         (test E2E serveurs 18 vérifications)
Remplacés :
  - src/lib/db.ts                              (middleware Prisma chiffre/déchiffre)
  - src/app/api/payslips/route.ts              (recherche CIN : filtre JS)
  - src/app/api/stats/route.ts                 (distinct employés en JS)
  - scripts/portail-server.js                  (recherche/verify/fichier déchiffrés)
  - README-DEPLOIEMENT-LOCAL.md                (section 23)
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
    ("src/lib/db-crypto.ts", "src/lib/db-crypto.ts", False),
    ("src/lib/db.ts", "src/lib/db.ts", False),
    ("src/app/api/payslips/route.ts", "src/app/api/payslips/route.ts", False),
    ("src/app/api/stats/route.ts", "src/app/api/stats/route.ts", False),
    ("scripts/lib-crypto-bd.js", "scripts/lib-crypto-bd.js", False),
    ("scripts/chiffrer-base.js", "scripts/chiffrer-base.js", False),
    ("scripts/sauvegarde-bd.js", "scripts/sauvegarde-bd.js", False),
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("scripts/test_task32_migration.py", "scripts/test_task32_migration.py", False),
    ("scripts/test_task32_securite_bd.py", "scripts/test_task32_securite_bd.py", False),
    ("SECURISER-DOSSIERS-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat", True),
    ("SAUVEGARDER-BD-WINDOWS.bat", "SAUVEGARDER-BD-WINDOWS.bat", True),
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
            print(f"   MANQUANTS : {manquants}")

# Contrôles automatiques sur le ZIP source
with zipfile.ZipFile(SRC) as zz:
    lib = zz.read("scripts/lib-crypto-bd.js").decode("utf-8", errors="replace")
    dbts = zz.read("src/lib/db.ts").decode("utf-8", errors="replace")
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    route = zz.read("src/app/api/payslips/route.ts").decode("utf-8", errors="replace")
    stats = zz.read("src/app/api/stats/route.ts").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check1 = "encbd1d" in lib and "CARTE_CHAMPS" in lib and "scryptSync" in lib
    check2 = "$extends" in dbts and "chiffrerObjet" in dbts and "dechiffrerObjet" in dbts
    check3 = "lib-crypto-bd.js" in portail and "dechiffrerObjet" in portail and "chiffrerChamp" in portail
    check4 = "normalizedContent.includes(q)" in route and "Task 32" in route
    check5 = "nomsDistincts" in stats and 'distinct: ["employeeName"]' not in stats
    check6 = "## 23. Sécuriser le contenu de la base" in readm and "chiffrer-base.js" in readm
    print(f"   lib crypto (formats+carte) : {'OK' if check1 else 'KO'}")
    print(f"   middleware db.ts : {'OK' if check2 else 'KO'}")
    print(f"   portail patché : {'OK' if check3 else 'KO'}")
    print(f"   recherche admin JS : {'OK' if check4 else 'KO'}")
    print(f"   stats JS : {'OK' if check5 else 'KO'}")
    print(f"   README section 23 : {'OK' if check6 else 'KO'}")
    # CRLF + ASCII des 2 nouveaux .bat
    for bat in ["SECURISER-DOSSIERS-WINDOWS.bat", "SAUVEGARDER-BD-WINDOWS.bat"]:
        d = zz.read(bat)
        crlf = b"\r\n" in d and d.count(b"\n") == d.count(b"\r\n")
        ascii_ok = all(b < 128 for b in d)
        print(f"   {bat} CRLF+ASCII : {'OK' if crlf and ascii_ok else 'KO'}")
        ok = ok and crlf and ascii_ok
    ok = ok and check1 and check2 and check3 and check4 and check5 and check6

print("TASK32 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
