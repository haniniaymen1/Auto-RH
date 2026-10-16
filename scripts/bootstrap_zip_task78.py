#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 78 — BOOTSTRAP : injecte UNE FOIS les fichiers Task 78 dans les 3 ZIP
au disque (l'archive doit porter l'état final AVANT que la chaîne idempotente
soit relancée, car les maillons intermédiaires vérifient ATTENDU = 272).
Contenu injecté : scripts/portail-server.js (QR otpauth:// standard + secret
TOTP persistant + double validation des codes), README-DEPLOIEMENT-LOCAL.md
(section 43), package.json (0.2.8), test74_otp_qr.py,
test75_otp_premiere_connexion.py, test76_otp_qr_chaque_connexion.py
(réalignés Task 78) + 2 NOUVEAUX (test78_totp_authenticator.py,
test78_harnais.sh) => 270 + 2 = 272 fichiers.
Ensuite on relance scripts/update_zip_task78.py qui rejoue la chaîne complète
+ overlay + contrôles (idempotent)."""
import zipfile, os, shutil, hashlib, sys

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
    ("package.json", "package.json"),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py"),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py"),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py"),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py"),
    ("scripts/test78_harnais.sh", "scripts/test78_harnais.sh"),
]
ATTENDU = 272


def lire(src):
    return open(os.path.join(BASE, src), "rb").read()


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(SRC + ".tmp", "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc in FILES:
        zout.writestr(arc, lire(src))
os.replace(SRC + ".tmp", SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

ok = True
empreintes = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, empreintes):
    with zipfile.ZipFile(z) as zz:
        liste = zz.namelist()
        names = set(liste)
        n = len(names)
        integre = zz.testzip() is None
        identique = empreinte == empreintes[0]
        print(f"BOOTSTRAP {os.path.basename(z)} : {n} fichiers (attendu {ATTENDU}), intégrité={'OK' if integre else 'KO'}, identique={'oui' if identique else 'NON'}")
        if n != ATTENDU or not integre or not identique:
            ok = False
with zipfile.ZipFile(SRC) as zz:
    p = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    if '"otpauth://totp/"' not in p or "genererSecretTotp" not in p:
        print("BOOTSTRAP : portail sans QR otpauth — état final ABSENT")
        ok = False
print("BOOTSTRAP TASK 78 :", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
