#!/usr/bin/env python3
"""Task 92 — injection de l'état FINAL dans les 3 ZIP au disque AVANT la
chaîne (même principe que bootstrap_zip_task89/90/91) : les maillons
idempotents 38/64-91 portent des contrôles sur le CONTENU de l'archive
(ATTENDU 304, version 0.2.22, service « Send Mail »…) — l'archive doit donc
déjà porter l'état final Task 92 quand la chaîne redémarre.

Remplacés :
  - prisma/schema.prisma (MailConfig + PortalAccess.initialPasswordEnc/
    mailEnvoyeA/mailEnvoyeLe — Task 92) ;
  - src/lib/db-crypto.ts, scripts/lib-crypto-bd.js (cartes jumelles) ;
  - scripts/portail-server.js (effacement de la copie chiffrée) ;
  - src/app/api/portal-access/route.ts (action « send-mail ») ;
  - src/components/payslip/portal-access-tab.tsx (bouton + popup) ;
  - package.json (0.2.22 + nodemailer), package-lock.json ;
  - README-DEPLOIEMENT-LOCAL.md (§57) ;
  - DEMARRER-LINUX-MAC.sh, DEMARRER-TOUT-LINUX-MAC.sh,
    PREPARER-AUTO-RH-SILENCIEUX.bat (vérification nodemailer) ;
  - suites réalignées version 0.2.22 : test74-91.
Ajoutés :
  - src/app/api/mail-config/route.ts, src/lib/mailer.ts,
    src/components/payslip/mail-panel.tsx,
    scripts/test92_send_mail.py, scripts/test92_serveur_smtp.py,
    scripts/test92_inserer.js, scripts/test92_harnais.sh.
Compte : 297 (état Task 91) + 7 nouveaux = 304 fichiers.
Nota (Task 35 conservée) : DEMARRER-WINDOWS.bat reste HORS archive (kit
silencieux VBS seul) — modifié dans le dépôt pour cohérence, retiré ici
d'un éventuel résidu, sans impact sur le décompte.
"""
import zipfile, shutil, os, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# Task 35 : les lanceurs Windows visibles ne sont PAS dans l'archive.
RETRAIT = [
    "DEMARRER-WINDOWS.bat",
]

FILES = [
    ("prisma/schema.prisma", "prisma/schema.prisma", False),
    ("src/lib/db-crypto.ts", "src/lib/db-crypto.ts", False),
    ("scripts/lib-crypto-bd.js", "scripts/lib-crypto-bd.js", False),
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/app/api/mail-config/route.ts", "src/app/api/mail-config/route.ts", False),
    ("src/lib/mailer.ts", "src/lib/mailer.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("src/components/payslip/mail-panel.tsx", "src/components/payslip/mail-panel.tsx", False),
    ("package.json", "package.json", False),
    ("package-lock.json", "package-lock.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    ("DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh", False),
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
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
    ("scripts/test92_serveur_smtp.py", "scripts/test92_serveur_smtp.py", False),
    ("scripts/test92_inserer.js", "scripts/test92_inserer.js", False),
    ("scripts/test92_harnais.sh", "scripts/test92_harnais.sh", False),
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
    exclus = {arc for _, arc, _ in FILES} | set(RETRAIT)
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
