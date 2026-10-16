#!/usr/bin/env python3
"""Task 37 : AUCUN historique de saisie dans tout le projet.

Remplacés dans les 3 ZIP :
  - src/components/ui/input.tsx           (autoComplete="off" PAR DÉFAUT)
  - src/components/ui/textarea.tsx        (idem)
  - src/app/login/page.tsx                (email off + new-password)
  - src/app/signup/page.tsx               (email off, form off)
  - src/components/payslip/import-tab.tsx (input fichier off)
  - scripts/portail-server.js             (code OTP : one-time-code -> off ;
                                           form + CIN déjà off depuis Task 33-bis)
  - README-DEPLOIEMENT-LOCAL.md           (section 27)
  - scripts/test_task33_souvenir.py       (assertion OTP mise en cohérence)
Nouveaux :
  - scripts/test_task37_sans_historique.py (test E2E — 18 vérifications)
Hérite de l'overlay Task 36 (exécuté d'abord : 34 -> 35/35-bis -> 36 -> 37).

L'historique de saisie du navigateur (suggestions des valeurs déjà tapées)
est désactivé sur TOUS les champs de l'administration ET du portail.
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
    ("src/components/ui/input.tsx", "src/components/ui/input.tsx", False),
    ("src/components/ui/textarea.tsx", "src/components/ui/textarea.tsx", False),
    ("src/app/login/page.tsx", "src/app/login/page.tsx", False),
    ("src/app/signup/page.tsx", "src/app/signup/page.tsx", False),
    ("src/components/payslip/import-tab.tsx", "src/components/payslip/import-tab.tsx", False),
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test_task33_souvenir.py", "scripts/test_task33_souvenir.py", False),
    ("scripts/test_task37_sans_historique.py", "scripts/test_task37_sans_historique.py", False),
]


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


# 1) Overlay Task 36 d'abord (cumulatif : 34 -> 35/35-bis -> 36 -> 37)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task36.py")])
if r.returncode != 0:
    print("OVERLAY TASK36 EN ECHEC — arrêt.")
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
    input_tsx = zz.read("src/components/ui/input.tsx").decode("utf-8", errors="replace")
    login_tsx = zz.read("src/app/login/page.tsx").decode("utf-8", errors="replace")
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check1 = 'autoComplete="off"' in input_tsx.split("{...props}")[0]
    check2 = 'autoComplete="new-password"' in login_tsx and 'autoComplete="current-password"' not in login_tsx and 'autoComplete="email"' not in login_tsx
    check3 = "one-time-code" not in portail and 'autocomplete="username"' not in portail and portail.count('autocomplete="off"') >= 3
    check4 = "## 27. Champs de saisie sans historique" in readm
    t33 = zz.read("scripts/test_task33_souvenir.py").decode("utf-8", errors="replace")
    check5 = "code OTP sans historique" in t33 and 'autocomplete="one-time-code"' not in t33
    check6 = "TASK37:" in zz.read("scripts/test_task37_sans_historique.py").decode("utf-8", errors="replace")
    print(f"   Input : off par défaut sur TOUS les champs : {'OK' if check1 else 'KO'}")
    print(f"   login : off + new-password, aucun email/current-password : {'OK' if check2 else 'KO'}")
    print(f"   portail : form+CIN+code off, zéro username/one-time-code : {'OK' if check3 else 'KO'}")
    print(f"   README section 27 : {'OK' if check4 else 'KO'}")
    print(f"   test_task33 assertion OTP en cohérence : {'OK' if check5 else 'KO'}")
    print(f"   test_task37 embarqué : {'OK' if check6 else 'KO'}")
    ok = ok and check1 and check2 and check3 and check4 and check5 and check6

print("TASK37 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
