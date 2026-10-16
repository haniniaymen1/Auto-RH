#!/usr/bin/env python3
"""Task 80 — injection de l'état FINAL dans les 3 ZIP au disque AVANT la
chaîne (même principe que bootstrap_zip_task79) : les maillons idempotents
64-79 portent des contrôles sur le CONTENU de l'archive (version 0.2.10,
section « Gestion des QR codes », page QR seul, qrPresente…) — l'archive
doit donc déjà porter l'état final Task 80 quand la chaîne redémarre.

Remplacés :
  - scripts/portail-server.js (page « UNIQUEMENT le QR code », verrou
    qrPresente, refus OTP_QR_A_SCANNER, secret TOTP chiffré en base) ;
  - prisma/schema.prisma (champ qrPresente) ;
  - src/app/api/portal-access/route.ts (actions « qr » / « reset-qr ») ;
  - src/components/payslip/portal-access-tab.tsx (section dédiée) ;
  - package.json (0.2.10), README-DEPLOIEMENT-LOCAL.md (§45) ;
  - scripts/test64_inserer.js (mode « lire » enrichi) ;
  - suites réalignées : test64_portail, test65, test66, test67, test69,
    test70, test71, test73, test74, test75, test76, test77, test78.
Ajoutés :
  - scripts/test80_qr_seul.py, scripts/test80_harnais.sh.
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
    ("prisma/schema.prisma", "prisma/schema.prisma", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test64_inserer.js", "scripts/test64_inserer.js", False),
    ("scripts/test64_portail.py", "scripts/test64_portail.py", False),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("scripts/test66_champ_motdepasse.py", "scripts/test66_champ_motdepasse.py", False),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py", False),
    ("scripts/test69_champ_style.py", "scripts/test69_champ_style.py", False),
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py", False),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py", False),
    ("scripts/test73_recherche_bouton.py", "scripts/test73_recherche_bouton.py", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test77_sans_barre_cin.py", "scripts/test77_sans_barre_cin.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test80_harnais.sh", "scripts/test80_harnais.sh", False),
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
print("BOOTSTRAP TASK 80 TERMINÉ")
