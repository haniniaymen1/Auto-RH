#!/usr/bin/env python3
"""Task 78 (19/09/2026) : PORTAIL EMPLOYÉS — « application authenticator
cannot interpret qr code » (retour utilisateur) — le QR code de la première
connexion encodait un JSON maison {app: "SERVICE RH", objet: "otp-connexion",
code, expire} qu'AUCUNE application d'authentification ne savait interpréter.
RÉÉCRITURE au FORMAT STANDARD :

  1. QR = URI STANDARD « otpauth://totp/… » (spec « Key URI Format ») :
     label Auto-RH:<CIN>, secret Base32, issuer=Auto-RH, algorithm=SHA1,
     digits=6, period=30 — lisible par Google/Microsoft Authenticator, Authy,
     FreeOTP… L'application ajoute le compte et génère les codes.
  2. SECRET TOTP PERSISTANT par employé (PortalAccess.totpSecret — colonne
     historique Task 18 réutilisée, AUCUNE migration) : 20 octets aléatoires
     = 32 caractères Base32, généré UNE FOIS à la première validation CIN +
     mot de passe (lazy dans /api/verify ET /api/otp/nouveau).
  3. DOUBLE VALIDATION dans /api/otp/verify : le code AFFICHÉ à l'écran
     (inchangé) OU un code TOTP de l'application (tolérance ±1 fenêtre 30 s,
     anti-rejeu lastUsedWindow enregistré à la réussite).
  4. CONSERVÉ : QR seulement à la première connexion (verrou lastLoginAt),
     défi 10 minutes, usage unique, 5 tentatives, changement de mot de passe
     après l'OTP, régénération recalculée en base (Tasks 74/75/76).

Nouveaux :
  - scripts/test78_totp_authenticator.py (51 vérifications : vecteurs RFC
    6238, simulation COMPLÈTE d'une application d'authentification — lecture
    du secret DANS le QR, calcul du code, validation par le portail —
    anti-rejeu, double voie, persistance du secret, expiration)
  - scripts/test78_harnais.sh (COPIE + portails 4215/4216)
Remplacés :
  - scripts/portail-server.js (QR otpauth + secret persistant + double voie)
  - README-DEPLOIEMENT-LOCAL.md (section 43)
  - package.json (0.2.7 -> 0.2.8)
  - scripts/test74, test75, test76 (réalignés Task 78)
  - scripts/update_zip_task74/75/76/77 (contrôles réalignés Task 78)
Remis en cohérence (hors archive) :
  - scripts/patch_attendu_task78.py : ATTENDU 270 -> 272 dans les maillons
    38/64/65/66/67/69/70/71/73/74/75/76/77 + suites task40/42
Compte : 270 (état Task 77) + 2 nouveaux = 272 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76 -> 77 -> 78.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    # --- Task 78 : QR otpauth:// + secret TOTP persistant ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("package.json", "package.json", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test78_harnais.sh", "scripts/test78_harnais.sh", False),
]

ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)


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


# 1) Chaîne cumulative jusqu'à la Task 77 (elle-même bâtie sur 34->...->77)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task77.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 78 : remplacements + ajouts (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES}
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
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    schema = zz.read("prisma/schema.prisma").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t75 = zz.read("scripts/test75_otp_premiere_connexion.py").decode("utf-8", errors="replace")
    t76 = zz.read("scripts/test76_otp_qr_chaque_connexion.py").decode("utf-8", errors="replace")
    t78 = zz.read("scripts/test78_totp_authenticator.py").decode("utf-8", errors="replace")
    t78sh = zz.read("scripts/test78_harnais.sh").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 78 : QR otpauth + secret persistant + double voie ---
    # (MODIFIÉ Task 88) le label est « Auto-RH:Fiche de paie » (Account Name
    # SANS le CIN, demande utilisateur) — contrôle réaligné en conséquence.
    check("portail : QR = URI STANDARD otpauth://totp/… (label Auto-RH:Fiche de paie — MODIFIÉ Task 88, issuer/algorithm/digits/period)",
          '"otpauth://totp/"' in portail
          and 'encodeURIComponent("Auto-RH:Fiche de paie")' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail)
    check("portail : ANCIEN JSON {app SERVICE RH, otp-connexion} ABSENT",
          'app: "SERVICE RH"' not in portail and 'objet: "otp-connexion"' not in portail)
    check("portail : retour utilisateur Task 78 documenté dans l'entête",
          "application authenticator cannot interpret qr code" in portail)
    check("portail : base32Encode + genererSecretTotp (20 octets -> 32 caractères Base32)",
          "function base32Encode(buf)" in portail
          and "base32Encode(crypto.randomBytes(20))" in portail)
    check("(MODIFIÉ Task 86) portail : secret de FENÊTRE (obtenirSecretFenetre — réutilisé vivant, régénéré sinon, CHIFFRÉ en base ; /api/otp/nouveau SUPPRIMÉ)",
          "const fenetre = await obtenirSecretFenetre(acc);" in portail
          and "otpFenetreCreeA: new Date()" in portail
          and "cryptoBd.chiffrerChamp(secret, false)" in portail
          and '"/api/otp/nouveau"' not in portail
          and "totpSecret     String?" in schema.replace("totpSecret    String?", "totpSecret     String?"))
    check("(MODIFIÉ Task 85) portail : VALIDATION TOTP SEUL (voie « code écran » SUPPRIMÉE — anti-rejeu et secret déchiffré conservés)",
          "let codeCorrect = false;" in portail
          and "code === defi.code" not in portail
          and "cryptoBd.dechiffrerChamp(accTotp.totpSecret)" in portail
          and "lastUsedWindow: fenetreTotp" in portail)
    check("(MODIFIÉ Task 86) portail : défi ALIGNÉ (5 arguments) + QR toujours réservé à la première connexion (page d'inscription dédiée + verrou)",
          "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in portail
          and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail
          and "if (defi.premiere)" in portail
          and "function otpPremiereHtml(defi, svgQr)" in portail
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail)
    check("portail : consignes APPLICATION D'AUTHENTIFICATION (Google/Microsoft/Authy/FreeOTP)",
          "APPLICATION D'AUTHENTIFICATION" in portail and "Google Authenticator" in portail
          and "PAS avec l'appareil photo" in portail)
    check("portail : invariants Task 74/76 conservés (TTL, usage unique, gardes ×4, verrou lastLoginAt)",
          "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and portail.count('code: "OTP_REQUIS"') == 4
          and "const premiereConnexion = !acc.lastLoginAt" in portail)

    # --- Tests embarqués Task 78 + réalignés ---
    check("tests Task 78 embarqués (totp_authenticator + harnais, COPIE 4215/4216, vecteurs RFC 6238)",
          "RESULTAT TASK 78" in t78 and "94287082" in t78
          and "totp_authentifiant" in t78 and "otpauth://totp/" in t78
          and "test78.db" in t78sh and "4215" in t78sh and "4216" in t78sh
          and "COPIE" in t78sh and "test66_inserer.js" in t78sh)
    check("test74 réaligné Task 81 (bandeau échec expliqué + version 0.2.11)",
          "Task 83" in t74 and "0.2.24" in t74)
    check("test75 réaligné Task 81 (version 0.2.11)",
          "Task 83" in t75 and "0.2.24" in t75)
    check("test76 réaligné Task 83 (otpHtml(defi) + version 0.2.24)",
          "Task 83" in t76 and "function otpHtml(defi, svgQr)" in t76
          and '"0.2.24"' in t76)

    # --- Version + documentation ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 43 (QR otpauth standard, secret persistant, double validation)",
          "## 43. Portail employés : le QR code devient une vraie inscription « application d'authentification »" in readm
          and "application authenticator cannot interpret qr code" in readm
          and "test78_harnais.sh" in readm)
    check("README : sections 31-42 intactes",
          "## 42. Accès portail : la barre de création et la colonne « Employé » retirées" in readm
          and "## 41. Portail employés : OTP obligatoire À CHAQUE connexion" in readm
          and "## 39. Portail employés : connexion en DEUX ÉTAPES" in readm
          and "## 31." in readm)

print("TASK78 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
