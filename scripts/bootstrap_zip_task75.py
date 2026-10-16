#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 75 — BOOTSTRAP : injecte UNE FOIS les fichiers Task 75 dans les 3 ZIP
au disque (l'archive doit porter l'état final AVANT que la chaîne idempotente
soit relancée, car les maillons intermédiaires vérifient ATTENDU = 266).
Contenu injecté : portail-server.js (verrou première connexion), README
(section 40 + note §39), package.json (0.2.5), test74_otp_qr.py +
test74_harnais.sh (réalignés), test64_portail.py + test66_champ_motdepasse.py
(réalignés) + 3 NOUVEAUX (test74_inserer.js, test75_otp_premiere_connexion.py,
test75_harnais.sh) => 263 + 3 = 266 fichiers.
Ensuite on relance scripts/update_zip_task75.py qui rejoue la chaîne
complète + overlay + contrôles (idempotent)."""
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
    ("scripts/test74_harnais.sh", "scripts/test74_harnais.sh"),
    ("scripts/test64_portail.py", "scripts/test64_portail.py"),
    ("scripts/test66_champ_motdepasse.py", "scripts/test66_champ_motdepasse.py"),
    ("scripts/test74_inserer.js", "scripts/test74_inserer.js"),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py"),
    ("scripts/test75_harnais.sh", "scripts/test75_harnais.sh"),
]
ATTENDU = 266


def lire(src):
    return open(os.path.join(BASE, src), "rb").read()


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc in FILES:
        zout.writestr(arc, lire(src))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

ok = True
md5s = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, md5s):
    with zipfile.ZipFile(z) as zz:
        noms = zz.namelist()
        integre = zz.testzip() is None
        sans_doublon = len(noms) == len(set(noms))
        print(f"{os.path.basename(z)} : {len(noms)} fichiers (attendu {ATTENDU}), "
              f"intégrité={'OK' if integre else 'KO'}, doublons={'OUI!' if not sans_doublon else 'non'}")
        if not integre or not sans_doublon or len(noms) != ATTENDU or empreinte != md5s[0]:
            ok = False

print("MD5 bootstrap :", md5s[0])
print("BOOTSTRAP TASK75 :", "TOUT OK" if ok else "PROBLÈME DÉTECTÉ")
sys.exit(0 if ok else 1)
