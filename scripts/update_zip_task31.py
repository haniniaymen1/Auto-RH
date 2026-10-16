#!/usr/bin/env python3
"""Task 31 : met à jour les ZIP avec la sécurisation du code d'inscription.

Nouveaux fichiers :
  - src/lib/signup-code.ts                     (hash scrypt + temps constant + interrupteur)
  - scripts/gen-signup-code.js                 (menu sécuriser/changer/désactiver, multi-OS)
  - SECURISER-INSCRIPTION-WINDOWS.bat          (double-clic : menu, saisie masquée)
  - scripts/test_task31_signup_code.py         (tests E2E 14 vérifications)
Remplacés :
  - src/app/api/auth/signup/route.ts           (SIGNUP_CODE_HASH prioritaire, SIGNUP_ENABLED, anti force-brute)
  - DEMARRER-WINDOWS.bat                       (code par défaut ALÉATOIRE au lieu de PAIESAGE-2026)
  - PREPARER-AUTO-RH-SILENCIEUX.bat           (idem pour le mode silencieux)
  - README-DEPLOIEMENT-LOCAL.md                (section 22)
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
    ("src/lib/signup-code.ts", "src/lib/signup-code.ts", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("scripts/gen-signup-code.js", "scripts/gen-signup-code.js", False),
    ("SECURISER-INSCRIPTION-WINDOWS.bat", "SECURISER-INSCRIPTION-WINDOWS.bat", True),
    ("DEMARRER-WINDOWS.bat", "DEMARRER-WINDOWS.bat", False),  # historique : LF dans le ZIP
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
    ("scripts/test_task31_signup_code.py", "scripts/test_task31_signup_code.py", False),
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

# Contrôles : PAIESAGE-2026 ne doit plus créer le défaut ; le bat sécurisé est CRLF/ASCII
with zipfile.ZipFile(SRC) as zz:
    dw = zz.read("DEMARRER-WINDOWS.bat").decode("utf-8", errors="replace")
    prep = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8", errors="replace")
    check1 = "gen-signup-code.js --assurer" in dw and "echo SIGNUP_CODE=PAIESAGE-2026" not in dw
    check2 = "gen-signup-code.js --assurer" in prep and "echo SIGNUP_CODE=PAIESAGE-2026" not in prep
    sec = zz.read("SECURISER-INSCRIPTION-WINDOWS.bat")
    crlf = b"\r\n" in sec and sec.count(b"\n") == sec.count(b"\r\n")
    ascii_ok = all(b < 128 for b in sec)
    route = zz.read("src/app/api/auth/signup/route.ts").decode("utf-8", errors="replace")
    check3 = "SIGNUP_CODE_HASH" in route and "verifierCodeInscription" in route and "SIGNUP_ENABLED" in route
    print(f"   DEMARRER-WINDOWS.bat sans défaut fixe : {'OK' if check1 else 'KO'}")
    print(f"   PREPARER-...-SILENCIEUX.bat sans défaut fixe : {'OK' if check2 else 'KO'}")
    print(f"   SECURISER-INSCRIPTION-WINDOWS.bat CRLF+ASCII : {'OK' if crlf and ascii_ok else 'KO'}")
    print(f"   route signup (hash + interrupteur) : {'OK' if check3 else 'KO'}")
    ok = ok and check1 and check2 and check3 and crlf and ascii_ok

print("TASK31 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
