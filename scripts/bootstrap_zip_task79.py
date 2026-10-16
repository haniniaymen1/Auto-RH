#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 79 — BOOTSTRAP : injecte UNE FOIS les fichiers Task 79 dans les 3 ZIP
au disque (l'archive doit porter l'état final AVANT que la chaîne idempotente
soit relancée, car les maillons intermédiaires vérifient ATTENDU = 274).
Contenu injecté : src/app/api/stats/route.ts (withCin = CIN distincts
normalisés), src/app/page.tsx (sous-titre « CIN distincts dans le contenu »),
src/lib/types.ts (doc Task 79), package.json (0.2.9),
README-DEPLOIEMENT-LOCAL.md (section 44), test74/test75/test76/test78
(réalignés version 0.2.9) + 2 NOUVEAUX (test79_cin_distincts.py,
test79_harnais.sh) => 272 + 2 = 274 fichiers.
Ensuite on relance scripts/update_zip_task79.py qui rejoue la chaîne complète
+ overlay + contrôles (idempotent)."""
import zipfile, os, shutil, hashlib, sys

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
FILES = [
    ("src/app/api/stats/route.ts", "src/app/api/stats/route.ts"),
    ("src/app/page.tsx", "src/app/page.tsx"),
    ("src/lib/types.ts", "src/lib/types.ts"),
    ("package.json", "package.json"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py"),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py"),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py"),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py"),
    ("scripts/test79_cin_distincts.py", "scripts/test79_cin_distincts.py"),
    ("scripts/test79_harnais.sh", "scripts/test79_harnais.sh"),
]
ATTENDU = 274


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
    stats = zz.read("src/app/api/stats/route.ts").decode("utf-8", errors="replace")
    if "cinsDistincts" not in stats or "normalizeQuery" not in stats:
        print("BOOTSTRAP : route stats sans dédoublonnage — état final ABSENT")
        ok = False
print("BOOTSTRAP TASK 79 :", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
