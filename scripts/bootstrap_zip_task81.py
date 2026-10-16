#!/usr/bin/env python3
"""Task 81 — injection de l'état FINAL dans les 3 ZIP au disque AVANT la
chaîne (même principe que bootstrap_zip_task80) : les maillons idempotents
64-80 portent des contrôles sur le CONTENU de l'archive (version 0.2.11,
page QR seul, otpauth, bandeau d'échec expliqué…) — l'archive doit donc déjà
porter l'état final Task 81 quand la chaîne redémarre.

Remplacés :
  - scripts/portail-server.js (page de connexion : « Déjà venu ? » + bandeau
    d'échec expliqué ; page de confirmation : code de l'application accepté) ;
  - package.json (0.2.11), README-DEPLOIEMENT-LOCAL.md (§46) ;
  - suites réalignées (version) : test74, test75, test76, test78, test80.
Ajoutés :
  - scripts/test81_reconnexion_apres_scan.py, scripts/test81_harnais.sh.
"""
import zipfile, shutil, os, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test81_reconnexion_apres_scan.py", "scripts/test81_reconnexion_apres_scan.py", False),
    ("scripts/test81_harnais.sh", "scripts/test81_harnais.sh", False),
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
print(f"MD5 commun : {empreinte}")
print("BOOTSTRAP TASK 81 TERMINÉ")
