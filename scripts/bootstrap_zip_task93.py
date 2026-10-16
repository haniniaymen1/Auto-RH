#!/usr/bin/env python3
"""Task 93 — injection de l'état FINAL dans les 3 ZIP au disque AVANT la
chaîne (même principe que bootstrap_zip_task89/90/91/92) : les maillons
idempotents 38/64-92 portent des contrôles sur le CONTENU de l'archive
(ATTENDU 306, version 0.2.23, option « Tester un code »…) — l'archive doit
donc déjà porter l'état final Task 93 quand la chaîne redémarre.

Remplacés :
  - scripts/gen-signup-code.js (--verifier + option de menu 7 — Task 93) ;
  - SECURISER-INSCRIPTION-WINDOWS.bat (option 7 documentée) ;
  - src/app/api/auth/signup/route.ts (message 403 orienté diagnostic) ;
  - scripts/start-prod.js (détection de port occupé + CLI Prisma local) ;
  - scripts/auto-rh.js (message « déjà en cours » explicite) ;
  - package.json (0.2.23), package-lock.json ;
  - README-DEPLOIEMENT-LOCAL.md (§58) ;
  - suites réalignées version 0.2.23 : test74-92.
Ajoutés :
  - scripts/test93_code_activation_diag.py, scripts/launcher_task93.js.
Compte : 304 (état Task 92) + 2 nouveaux = 306 fichiers.
Nota (Task 35 conservée) : DEMARRER-WINDOWS.bat reste HORS archive (kit
silencieux VBS seul) — retiré ici d'un éventuel résidu, sans impact sur le
décompte.
"""
import zipfile, shutil, os

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

RETRAIT = [
    "DEMARRER-WINDOWS.bat",
]

FILES = [
    ("scripts/gen-signup-code.js", "scripts/gen-signup-code.js", False),
    ("SECURISER-INSCRIPTION-WINDOWS.bat", "SECURISER-INSCRIPTION-WINDOWS.bat", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("scripts/start-prod.js", "scripts/start-prod.js", False),
    ("scripts/auto-rh.js", "scripts/auto-rh.js", False),
    ("package.json", "package.json", False),
    ("package-lock.json", "package-lock.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test81_reconnexion_apres_scan.py", "scripts/test81_reconnexion_apres_scan.py", False),
    ("scripts/test82_champ_otp_connexion.py", "scripts/test82_champ_otp_connexion.py", False),
    ("scripts/test83_premiere_connexion_moderne.py", "scripts/test83_premiere_connexion_moderne.py", False),
    ("scripts/test84_cercles_verts.py", "scripts/test84_cercles_verts.py", False),
    ("scripts/test85_fenetre_qr_seul.py", "scripts/test85_fenetre_qr_seul.py", False),
    ("scripts/test86_expiration_qr.py", "scripts/test86_expiration_qr.py", False),
    ("scripts/test87_redirection_connexion_initiale.py", "scripts/test87_redirection_connexion_initiale.py", False),
    ("scripts/test88_nom_compte_authenticator.py", "scripts/test88_nom_compte_authenticator.py", False),
    ("scripts/test89_demarrage_sans_npx.py", "scripts/test89_demarrage_sans_npx.py", False),
    ("scripts/test90_redirection_apres_scan.py", "scripts/test90_redirection_apres_scan.py", False),
    ("scripts/test91_code_hache_env.py", "scripts/test91_code_hache_env.py", False),
    ("scripts/test92_send_mail.py", "scripts/test92_send_mail.py", False),
    ("scripts/test93_code_activation_diag.py", "scripts/test93_code_activation_diag.py", False),
    ("scripts/launcher_task93.js", "scripts/launcher_task93.js", False),
]

ATTENDU = 306  # 304 (état Task 92) + 2 fichiers Task 93


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES} | set(RETRAIT)
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        etat = "OK" if (bad is None and len(liste) == ATTENDU and not manquants and not doublons) else "KO"
        print(f"{os.path.basename(z)} : {len(liste)} fichiers (attendu {ATTENDU}), intégrité "
              f"{'OK' if bad is None else 'KO'}, doublons {'NON' if not doublons else 'OUI'}, "
              f"manquants {manquants or 'NON'}, état {etat}")
