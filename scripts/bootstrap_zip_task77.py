#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 77 — BOOTSTRAP : injecte UNE FOIS les fichiers Task 77 dans les 3 ZIP
au disque (l'archive doit porter l'état final AVANT que la chaîne idempotente
soit relancée, car les maillons intermédiaires vérifient ATTENDU = 270).
Contenu injecté : src/components/payslip/portal-access-tab.tsx (barre de
création + colonne « Employé » supprimées), README (section 42 + note §38),
package.json (0.2.7), test65_remplissage_auto.py, test67_repertoire_complet.py,
test70_remplissage_auto.py, test71_tableau_auto.py, test73_recherche_bouton.py,
test74_otp_qr.py, test75_otp_premiere_connexion.py,
test76_otp_qr_chaque_connexion.py (réalignés Task 77) + 2 NOUVEAUX
(test77_sans_barre_cin.py, test77_harnais.sh) => 268 + 2 = 270 fichiers.
Ensuite on relance scripts/update_zip_task77.py qui rejoue la chaîne complète
+ overlay + contrôles (idempotent)."""
import zipfile, os, shutil, hashlib, sys

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
FILES = [
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx"),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md"),
    ("package.json", "package.json"),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py"),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py"),
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py"),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py"),
    ("scripts/test73_recherche_bouton.py", "scripts/test73_recherche_bouton.py"),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py"),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py"),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py"),
    ("scripts/test77_sans_barre_cin.py", "scripts/test77_sans_barre_cin.py"),
    ("scripts/test77_harnais.sh", "scripts/test77_harnais.sh"),
]
ATTENDU = 270


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
print("BOOTSTRAP TASK77 :", "TOUT OK" if ok else "PROBLÈME DÉTECTÉ")
sys.exit(0 if ok else 1)
