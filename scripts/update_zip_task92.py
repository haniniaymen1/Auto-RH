#!/usr/bin/env python3
"""Task 92 (19/09/2026) : « Send Mail » — service d'envoi d'e-mails depuis
l'onglet « Accès portail » (bouton « Send Mail » par ligne, popup destinataire
+ Send, e-mail CIN/mot de passe initial/serveur/port/URL, panneau SMTP avec
test Gmail, nodemailer).

CHANGEMENTS (v0.2.24) :
  - prisma/schema.prisma : modèle MailConfig (singleton SMTP) +
    PortalAccess.initialPasswordEnc (copie chiffrée du mot de passe initial,
    effacée par le portail dès que l'employé choisit le sien) +
    mailEnvoyeA/mailEnvoyeLe (traçabilité) ;
  - src/lib/db-crypto.ts + scripts/lib-crypto-bd.js : cartes JUMELLES
    (PortalAccess.alea += initialPasswordEnc/mailEnvoyeA ; MailConfig.alea =
    username/password) ;
  - src/lib/mailer.ts (NOUVEAU) : nodemailer + e-mail d'accès texte/HTML ;
  - src/app/api/mail-config/route.ts (NOUVEAU) : GET/PUT + e-mail de test ;
  - src/app/api/portal-access/route.ts : action « send-mail » (409
    MOT_DE_PASSE_INDISPONIBLE + reset: true) ;
  - src/components/payslip/mail-panel.tsx (NOUVEAU) : panneau SMTP
    (pré-remplissage Gmail, e-mail de test) ;
  - src/components/payslip/portal-access-tab.tsx : bouton « Send Mail » par
    ligne + popup (destinataire, Send, aperçu) ;
  - scripts/portail-server.js : effacement de initialPasswordEnc (×2) ;
  - package.json 0.2.24 + nodemailer, package-lock.json, README §57,
    lanceurs avec vérification nodemailer.

Nouveau : scripts/test92_send_mail.py (53 vérifications : statique + E2E sur
COPIE de base avec MINI SERVEUR SMTP LOCAL), test92_serveur_smtp.py,
test92_inserer.js, test92_harnais.sh.
Compte : 297 (état Task 91) + 7 nouveaux = 304 fichiers.
Hérite de la chaîne : 34 -> … -> 88 -> 89 -> 90 -> 91 -> 92.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)

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


# 1) Chaîne cumulative jusqu'à la Task 91
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task91.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 92 : remplacements + ajouts (sans doublons) + retrait Task 35
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

# 3) Contrôles automatiques
ok = True
md5s = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        etat = "OK" if (bad is None and len(liste) == ATTENDU and not manquants and not doublons and md5(z) == empreinte) else "KO"
        if etat == "KO":
            ok = False
        print(f"{os.path.basename(z)} : {len(liste)} fichiers (attendu {ATTENDU}), intégrité "
              f"{'OK' if bad is None else 'KO'}, doublons {'NON' if not doublons else 'OUI'}, "
              f"manquants {manquants or 'NON'}, état {etat}")

with zipfile.ZipFile(SRC) as zz:
    schema = zz.read("prisma/schema.prisma").decode("utf-8")
    crypto_ts = zz.read("src/lib/db-crypto.ts").decode("utf-8")
    crypto_js = zz.read("scripts/lib-crypto-bd.js").decode("utf-8")
    portail = zz.read("scripts/portail-server.js").decode("utf-8")
    route = zz.read("src/app/api/portal-access/route.ts").decode("utf-8")
    mailcfg = zz.read("src/app/api/mail-config/route.ts").decode("utf-8")
    mailer = zz.read("src/lib/mailer.ts").decode("utf-8")
    ui = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8")
    panel = zz.read("src/components/payslip/mail-panel.tsx").decode("utf-8")
    pkg = zz.read("package.json").decode("utf-8")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8")
    sh1 = zz.read("DEMARRER-LINUX-MAC.sh").decode("utf-8")
    bat = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8")
    t90 = zz.read("scripts/test90_redirection_apres_scan.py").decode("utf-8")
    t91 = zz.read("scripts/test91_code_hache_env.py").decode("utf-8")
    t92 = zz.read("scripts/test92_send_mail.py").decode("utf-8")

    # --- Marqueurs Task 92 dans l'archive ---
    def ctrl(nom, cond, detail=""):
        global ok
        if not cond:
            ok = False
        print(("OK  " if cond else "ECHEC  ") + nom + ("" if cond else "  -> " + str(detail)[:200]))

    ctrl("schéma : MailConfig + initialPasswordEnc + mailEnvoyeA/Le",
         "model MailConfig" in schema and 'id             String   @id @default("smtp")' in schema
         and "initialPasswordEnc" in schema and "mailEnvoyeA" in schema and "mailEnvoyeLe" in schema)
    ctrl("cartes jumelles : PortalAccess + MailConfig identiques",
         '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"' in crypto_ts
         and '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"' in crypto_js
         and 'MailConfig: { det: [], alea: ["username", "password"] }' in crypto_ts
         and 'MailConfig: { det: [], alea: ["username", "password"] }' in crypto_js)
    ctrl("portail : copie chiffrée effacée ×2 (employé passe à son mot de passe)",
         portail.count("initialPasswordEnc: null,") == 2)
    ctrl("route portal-access : action send-mail + 409 + reset + traçabilité",
         'action === "send-mail"' in route and "MOT_DE_PASSE_INDISPONIBLE" in route
         and "mailEnvoyeA: dest, mailEnvoyeLe: new Date()" in route
         and route.count("initialPasswordEnc: initialPassword,") == 3)
    ctrl("mail-config : GET/PUT + test + mot de passe jamais renvoyé",
         "export async function GET" in mailcfg and "export async function PUT" in mailcfg
         and 'action !== "test"' in mailcfg and "if (password) data.password = password;" in mailcfg)
    ctrl("mailer.ts : nodemailer + contenu e-mail (CIN/mot de passe/serveur/port/URL)",
         'import nodemailer from "nodemailer"' in mailer and "envoyerEmailAcces" in mailer
         and "Mot de passe initial" in mailer and "Port du site web" in mailer)
    ctrl("UI : bouton « Send Mail » ×2 + popup + MailPanel",
         ui.count(">Send Mail</span>") == 1 and "Send Mail — CIN" in ui
         and "import { MailPanel }" in ui and "<MailPanel />" in ui)
    ctrl("panneau SMTP : pré-remplissage Gmail + e-mail de test + mot de passe conservé",
         "smtp.gmail.com" in panel and "Pré-remplir Gmail" in panel
         and "Envoyer un e-mail de test" in panel and "laisser vide pour conserver" in panel)

    # --- Version + README + suites embarquées ---
    ctrl("package.json : version 0.2.24 + nodemailer", '"version": "0.2.24"' in pkg and '"nodemailer"' in pkg, pkg[:80])
    ctrl("README : section 57 (Send Mail + test Gmail) + 56/55/54 intactes",
         "## 57. Service d'envoi d'e-mails « Send Mail »" in readm
         and "myaccount.google.com/apppasswords" in readm
         and "## 56. Les deux lignes sensibles du `.env`" in readm
         and "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm
         and "## 54. Démarrage local bloqué" in readm)
    ctrl("test92 embarqué (53 vérifications : statique + E2E mini SMTP local)",
         "Task 92" in t92 and "mini serveur smtp local" in t92.lower().replace("\n", " ")
         and "MOT_DE_PASSE_INDISPONIBLE" in t92
         and "Initial92x" in t92)
    ctrl("test89 embarqué : contrôle [VERSION] réaligné 0.2.24",
         '"[VERSION] package.json en 0.2.24"' in zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8"))
    ctrl("test90/91 embarqués : contrôles de version réalignés 0.2.24",
         'pkg.get("version") == "0.2.24"' in t90 and 'pkg.get("version") == "0.2.24"' in t91)

    # --- Lanceurs : vérification nodemailer (Task 92) ---
    ctrl("DEMARRER-LINUX-MAC.sh : vérification nodemailer",
         "node_modules/nodemailer/package.json" in sh1)
    ctrl("PREPARER-AUTO-RH-SILENCIEUX.bat : vérification nodemailer + CRLF intacts",
         "node_modules\\nodemailer\\package.json" in bat and b"\r\n" in zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat"))
    ctrl("DEMARRER-WINDOWS.bat : HORS archive (Task 35 conservée)",
         "DEMARRER-WINDOWS.bat" not in zz.namelist())

    # --- Invariants des Tasks antérieures (91/90/88/87/86/85/83) ---
    ctrl("invariant Task 91 : gen-signup-code.js haché (aucun SIGNUP_CODE= en clair écrit)",
         'ajouterCle(lignes, "SIGNUP_CODE"' not in zz.read("scripts/gen-signup-code.js").decode("utf-8"))
    ctrl("invariant Task 90 : redirect /premiere-reussie (inscription terminée) conservé",
         'redirect: "/premiere-reussie",' in portail
         and 'if (dest === "/premiere-reussie") {' in portail)
    ctrl("invariant Task 88 : label « Auto-RH:Fiche de paie » conservé",
         'encodeURIComponent("Auto-RH:Fiche de paie")' in portail)
    ctrl("invariant Task 87 : retour fenêtre initiale (bouton + redirection /login + fermeture de session)",
         'href="/login" id="btn-connexion"' in portail
         and "Accéder au portail" not in portail
         and "clearSessionCookie(res);" in portail)
    ctrl("invariant Task 86 : fenêtre du secret + garde 410 + compte à rebours conservés",
         "otpFenetreCreeA" in portail and 'code: "OTP_EXPIRE"' in portail and 'id="qr-cd"' in portail)
    ctrl("invariant Task 85 : AUCUN code OTP affiché",
         'id="otp-affiche"' not in portail and "genererCodeOtp" not in portail)
    ctrl("invariant Task 83 : QR unique + « Configuration réussie »",
         "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail
         and ">Configuration réussie</h1>" in portail)

print("TASK92 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
