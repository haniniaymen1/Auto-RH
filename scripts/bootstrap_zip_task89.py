#!/usr/bin/env python3
"""Task 89 — injection de l'état FINAL dans les 3 ZIP au disque AVANT la
chaîne (même principe que bootstrap_zip_task81/83/84/85/86/87/88) : les
maillons idempotents 38/64-88 portent des contrôles sur le CONTENU de
l'archive (ATTENDU 294, version 0.2.19, démarrage SANS npx…) — l'archive
doit donc déjà porter l'état final Task 89 quand la chaîne redémarre.

Remplacés :
  - PREPARER-AUTO-RH-SILENCIEUX.bat (CLI Prisma/Next LOCAL via node, vérif
    robuste des dépendances, garde-fou — signalement « Ok to proceed? (y) »
    sur prisma@8.0.0-rc.15, Task 89) ;
  - DEMARRER-LINUX-MAC.sh, DEMARRER-PORTAIL-LINUX-MAC.sh,
    DEMARRER-TOUT-LINUX-MAC.sh (même correctif, variantes shell) ;
  - package.json (0.2.19), README-DEPLOIEMENT-LOCAL.md (§54) ;
  - suites réalignées : test74, test75, test76, test78, test80, test81,
    test82, test83, test84, test85, test86, test87, test88 (version 0.2.19).
Ajoutés :
  - scripts/test89_demarrage_sans_npx.py, scripts/test89_harnais.sh.
Compte : 292 (état Task 88) + 2 nouveaux = 294 fichiers.
"""
import zipfile, shutil, os, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    ("DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", False),
    ("DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh", False),
    ("package.json", "package.json", False),
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
    ("scripts/test89_harnais.sh", "scripts/test89_harnais.sh", False),
]


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES}
    total = 0
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
        total += 1
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
        total += 1
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

empreinte = md5(SRC)
for z in [SRC] + COPIES:
    with zipfile.ZipFile(z) as zz:
        noms = zz.namelist()
        bad = zz.testzip()
        etat = "OK" if (bad is None and len(noms) == total and md5(z) == empreinte) else "KO"
        print(f"{os.path.basename(z)} : {len(noms)} fichiers, intégrité {'OK' if bad is None else 'KO'}, état {etat}")
print(f"MD5 bootstrap : {empreinte}")
