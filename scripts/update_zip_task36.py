#!/usr/bin/env python3
"""Task 36 : plus AUCUNE donnée de contenu dans les résultats de recherche.

Remplacés dans les 3 ZIP :
  - src/app/api/payslips/route.ts         (snippet: null — buildExactSnippet retiré
                                           de la réponse, import supprimé)
  - src/components/payslip/search-tab.tsx (extraits de contenu retirés : tableau
                                           desktop + cartes mobiles)
  - README-DEPLOIEMENT-LOCAL.md           (section 26)
Nouveaux :
  - scripts/test_task36_sans_snippet.py   (test E2E — 11 vérifications)
Hérite de l'overlay Task 35/35-bis (exécuté d'abord, lui-même héritant de Task 34).

La recherche par CIN analyse toujours le contenu intégral des fiches pour
TROUVER le numéro (comportement inchangé) mais n'affiche plus et ne renvoie
plus aucune donnée issue de ce contenu (demande de l'administrateur).
"""
import zipfile, shutil, os, subprocess, sys

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    ("src/app/api/payslips/route.ts", "src/app/api/payslips/route.ts", False),
    ("src/components/payslip/search-tab.tsx", "src/components/payslip/search-tab.tsx", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test_task36_sans_snippet.py", "scripts/test_task36_sans_snippet.py", False),
]

# Le ZIP ne doit plus contenir AUCUNE trace de buildExactSnippet dans la route
# ni d'affichage de snippet dans l'interface de recherche.
INTERDITS_ROUTE = ["buildExactSnippet"]
INTERDITS_TAB = ["p.snippet", "snippet}"]


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


# 1) Overlay Task 35/35-bis d'abord (cumulatif : Task 34 -> 35 -> 36)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task35.py")])
if r.returncode != 0:
    print("OVERLAY TASK35 EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Post-traitement : remplacements (sans doublons)
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

# 3) Contrôles automatiques
ok = True
for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers, intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if doublons:
            ok = False
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")

with zipfile.ZipFile(SRC) as zz:
    route = zz.read("src/app/api/payslips/route.ts").decode("utf-8", errors="replace")
    tab = zz.read("src/components/payslip/search-tab.tsx").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    test36 = zz.read("scripts/test_task36_sans_snippet.py").decode("utf-8", errors="replace")
    check1 = "buildExactSnippet" not in route and "snippet: null" in route
    check2 = not any(m in tab for m in INTERDITS_TAB) and "Task 36" in tab
    check3 = "## 26. Résultats de recherche sans données de contenu" in readm
    check4 = "AUCUN snippet non vide" in test36 and "mode search" in test36
    print(f"   API : snippet null, buildExactSnippet absent : {'OK' if check1 else 'KO'}")
    print(f"   Interface : extraits retirés (desktop + mobile) : {'OK' if check2 else 'KO'}")
    print(f"   README section 26 : {'OK' if check3 else 'KO'}")
    print(f"   test_task36 embarqué : {'OK' if check4 else 'KO'}")
    ok = ok and check1 and check2 and check3 and check4

print("TASK36 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
