#!/usr/bin/env python3
"""Task 34 : met à jour les ZIP avec l'interface SUPERADMINISTRATEUR.

Remplacés :
  - src/lib/auth.ts                       (rôle SUPERADMIN accepté, helpers estSuperadmin/peutGererUtilisateurs)
  - src/lib/types.ts                      (SessionUser.role inclut SUPERADMIN)
  - src/app/api/auth/login/route.ts       (cast rôle élargi)
  - src/app/api/auth/signup/route.ts      (cast rôle élargi — inscription toujours RH/IT)
  - src/app/api/users/route.ts            (liste : IT + SUPERADMIN)
  - src/app/api/users/[id]/route.ts       (PATCH/DELETE : IT + SUPERADMIN + garde dernier superadmin)
  - src/components/payslip/users-tab.tsx  (actions superadmin : mot de passe + rôle, badge 3 niveaux)
  - src/app/page.tsx                      (badge en-tête 3 niveaux, onglet pour IT+SUPERADMIN)
  - README-DEPLOIEMENT-LOCAL.md           (section 25)
Nouveaux :
  - src/app/api/users/[id]/password/route.ts  (réinitialisation mot de passe — superadmin)
  - src/app/api/users/[id]/role/route.ts      (changement de rôle RH<->IT — superadmin)
  - scripts/creer-superadmin.js               (création/promotion superadmin, emails chiffrés)
  - scripts/supprime-utilisateur.js           (suppression CLI + porte de secours)
  - CREER-SUPERADMIN-WINDOWS.bat              (double-clic, ASCII + CRLF)
  - scripts/test_task34_superadmin.py         (test E2E 39 vérifications)
  - scripts/test_tty_saisie_masquee.py        (test TTY réel saisie masquée — correctif .bat)
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
    ("src/lib/auth.ts", "src/lib/auth.ts", False),
    ("src/lib/types.ts", "src/lib/types.ts", False),
    ("src/app/api/auth/login/route.ts", "src/app/api/auth/login/route.ts", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("src/app/api/users/route.ts", "src/app/api/users/route.ts", False),
    ("src/app/api/users/[id]/route.ts", "src/app/api/users/[id]/route.ts", False),
    ("src/app/api/users/[id]/password/route.ts", "src/app/api/users/[id]/password/route.ts", False),
    ("src/app/api/users/[id]/role/route.ts", "src/app/api/users/[id]/role/route.ts", False),
    ("src/components/payslip/users-tab.tsx", "src/components/payslip/users-tab.tsx", False),
    ("src/app/page.tsx", "src/app/page.tsx", False),
    ("scripts/creer-superadmin.js", "scripts/creer-superadmin.js", False),
    ("scripts/supprime-utilisateur.js", "scripts/supprime-utilisateur.js", False),
    ("scripts/test_task34_superadmin.py", "scripts/test_task34_superadmin.py", False),
    ("scripts/test_tty_saisie_masquee.py", "scripts/test_tty_saisie_masquee.py", False),
    ("CREER-SUPERADMIN-WINDOWS.bat", "CREER-SUPERADMIN-WINDOWS.bat", True),
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
    auth = zz.read("src/lib/auth.ts").decode("utf-8", errors="replace")
    delroute = zz.read("src/app/api/users/[id]/route.ts").decode("utf-8", errors="replace")
    pwdroute = zz.read("src/app/api/users/[id]/password/route.ts").decode("utf-8", errors="replace")
    tab = zz.read("src/components/payslip/users-tab.tsx").decode("utf-8", errors="replace")
    crea = zz.read("scripts/creer-superadmin.js").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    bat = zz.read("CREER-SUPERADMIN-WINDOWS.bat")
    check1 = "SUPERADMIN" in auth and "estSuperadmin" in auth and "TOUS_ROLES" in auth
    check2 = "estDernierSuperadminActif" in delroute and "estSuperadmin" in delroute
    check3 = "forbiddenSuperadmin" in pwdroute and "hashPassword" in pwdroute
    check4 = "meRole" in tab and "KeyRound" in tab and "BadgeRole" in tab
    check5 = "chiffrerChamp(email, true)" in crea and "SUPERADMIN" in crea
    check6 = "## 25. Superadministrateur" in readm and "CREER-SUPERADMIN-WINDOWS.bat" in readm
    crlf = b"\r\n" in bat and bat.count(b"\n") == bat.count(b"\r\n")
    ascii_ok = all(b < 128 for b in bat)
    # (correctif .bat) saisie masquée SANS readline parasite + .bat blindé
    # (l'interface readline légitime du MENU est visible ; la saisie MASQUÉE ne
    # doit plus créer readline avant le mode brut — marqueurs du correctif :)
    check7 = (
        "SEUL lecteur" in crea
        and "Buffer.concat" in crea
        and "Mode masqué SANS readline" in crea
        and "accumulateur UTF-8" in crea
    )
    check8 = b"chcp 65001" in bat and b"scripts\\creer-superadmin.js" in bat and b"node_modules\\@prisma\\client" in bat
    # (correctif 2) le .bat ne doit contenir AUCUNE parenthese : sous cmd, une
    # parenthese dans un echo situe dans un bloc if ( ... ) produit
    # "X etait inattendu." et l'abandon immediat (cause reelle du signalement).
    check9 = b"(" not in bat and b")" not in bat
    check10 = b"goto ERREUR_NODE" in bat and b":ERREUR_ZIP" in bat and b":ERREUR_INSTALL" in bat
    print(f"   auth.ts SUPERADMIN : {'OK' if check1 else 'KO'}")
    print(f"   route [id] garde dernier superadmin : {'OK' if check2 else 'KO'}")
    print(f"   route password superadmin : {'OK' if check3 else 'KO'}")
    print(f"   users-tab superadmin : {'OK' if check4 else 'KO'}")
    print(f"   creer-superadmin chiffre les emails : {'OK' if check5 else 'KO'}")
    print(f"   README section 25 : {'OK' if check6 else 'KO'}")
    print(f"   .bat CRLF+ASCII : {'OK' if crlf and ascii_ok else 'KO'}")
    print(f"   saisie masquée corrigée (sans readline parasite) : {'OK' if check7 else 'KO'}")
    print(f"   .bat blindé (chcp + vérifications fichiers) : {'OK' if check8 else 'KO'}")
    print(f"   .bat ZÉRO parenthèse (anti « était inattendu ») : {'OK' if check9 else 'KO'}")
    print(f"   .bat flux goto sans blocs if : {'OK' if check10 else 'KO'}")
    ok = ok and check1 and check2 and check3 and check4 and check5 and check6 and check7 and check8 and check9 and check10 and crlf and ascii_ok

print("TASK34 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
