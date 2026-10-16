#!/usr/bin/env python3
"""Task 74 (18/09/2026) : PORTAIL EMPLOYÉS — « un OTP avec un QR code
s'affiche dans le portail employé lorsque l'employé valide son CIN et son
mot de passe. QR doit expirer après 10 minutes » :

  1. VÉRIFICATION EN DEUX ÉTAPES : après CIN + mot de passe VALIDÉS
     (POST /api/verify), le portail génère un CODE OTP à usage unique
     (6 chiffres) + un QR CODE (SVG serveur, paquet qrcode — aucun CDN)
     contenant le MÊME code + son instant d'expiration, et pose une session
     transitoire « otp » signée (10 minutes max, JAMAIS prolongée). La page
     /otp affiche le QR, le code en clair, un compte à rebours et le
     formulaire de confirmation (POST /api/otp/verify — tolérance
     tirets/espaces, 5 essais max puis annulation).
  2. EXPIRATION : 10 MINUTES (PORTAL_OTP_TTL_MS permet seulement de RÉDUIRE
     la durée en test, plancher 3 s). Expiré → 410 OTP_EXPIRE + page
     « Code OTP expiré » (Se reconnecter). /api/otp/nouveau régénère un code
     tant que la session « otp » est valable. /api/logout annule le défi.
  3. SÉCURITÉ : aucune donnée avant confirmation (my-fiches, search, fichier
     PDF, change-password → 403 OTP_REQUIS) ; le changement OBLIGATOIRE de
     mot de passe (Task 64) est évalué APRÈS l'OTP ; le mauvais mot de passe
     ne génère JAMAIS de code ; verrouillage 5 échecs, limiteur par IP,
     sessions signées HMAC — inchangés.

Nouveaux :
  - scripts/test74_otp_qr.py (67 vérifications : statique + flux complet sur
    portail 4207 TTL normal + EXPIRATION réelle sur portail 4208 TTL 3,5 s)
  - scripts/test74_harnais.sh (harnais portable : COPIE + 2 portails 4207/4208)
Remplacés :
  - scripts/portail-server.js  (OTP + QR + gardes + page /otp + version)
  - README-DEPLOIEMENT-LOCAL.md (section 39)
  - package.json (0.2.3 -> 0.2.4)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70,71,73}.py : ATTENDU 261 -> 263
  - scripts/test_task40_securisation_auto.py : ATTENDU 261 -> 263
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 261 -> 263
  - scripts/test64_portail.py, test66_champ_motdepasse.py,
    test67_repertoire_complet.py, test69_champ_style.py (étape OTP réalignée)
  - scripts/update_zip_task69.py (contrôle « aucun QR » -> « QR attendu /otp »)
Compte : 261 (état Task 73) + 2 nouveaux = 263 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74.
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
    # --- Task 74 : portail OTP + QR + doc + version + tests embarqués ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("package.json", "package.json", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test74_harnais.sh", "scripts/test74_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 73 (elle-même bâtie sur 34->...->73)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task73.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 74 : remplacements + ajouts (sans doublons)
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
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t74sh = zz.read("scripts/test74_harnais.sh").decode("utf-8", errors="replace")
    t64 = zz.read("scripts/test64_portail.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 74 : OTP + QR + expiration 10 minutes ---
    check("portail : paquet qrcode + QR SVG serveur (aucun CDN)",
          'require("qrcode")' in portail and 'type: "svg"' in portail)
    check("portail : TTL 10 minutes par défaut, réductible en test uniquement",
          "PORTAL_OTP_TTL_MS" in portail and "n <= 600000 ? n : 10 * 60 * 1000" in portail)
    check("(MODIFIÉ Task 85) portail : routes /otp + /api/otp/verify — /api/otp/nouveau SUPPRIMÉ",
          'pathname === "/otp"' in portail
          and '"/api/otp/verify"' in portail and '"/api/otp/nouveau"' not in portail)
    check("portail : session « otp » signée (ot dans le jeton) JAMAIS prolongée",
          "function createPortalSession(cin, remember, pending, otp)" in portail
          and "ot: otp ? 1 : 0" in portail and "if (sess.pending || sess.otp) return;" in portail)
    check("(MODIFIÉ Task 86) portail : /api/verify → otpRequired + /otp (code JAMAIS généré — défi ALIGNÉ sur la fenêtre du secret)",
          "otpRequired: true" in portail and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail)
    check("portail : confirmation (usage unique, 5 essais, tolérance tirets/espaces)",
          "otpDefis.delete(sess.cin)" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and 'String(body?.otp ?? "").replace(/[\\s-]/g, "")' in portail)
    check("portail : expiration 410 OTP_EXPIRE + annulation 401 OTP_ANNULE",
          'code: "OTP_EXPIRE"' in portail and 'code: "OTP_ANNULE"' in portail)
    check("(MODIFIÉ Task 85) portail : page /otp (QR + champ de confirmation — AUCUN code affiché ni compte à rebours) + page expirée",
          'id="otp-affiche"' not in portail and 'data-payload=' in portail
          and 'id="compte"' not in portail and "function otpExpireHtml" in portail
          and "Se reconnecter" in portail)
    check("(SUPPRIMÉ Task 85) plus de régénération — la déconnexion annule le défi (conservé)",
          "otpDefis.delete(sessDeconnexion.cin)" in portail)
    check("portail : gardes OTP_REQUIS ×4 (my-fiches, search, PDF, change-password)",
          portail.count('code: "OTP_REQUIS"') == 4, portail.count('code: "OTP_REQUIS"'))
    check("portail : pending posé APRÈS l'OTP (createPortalSession sess.cin, false, true)",
          "setSessionCookie(res, createPortalSession(sess.cin, false, true), PENDING_MAX_AGE)" in portail)
    check("portail : invariants Task 64/66/69 conservés (scrypt, 15 jours, 12px, autocomplete)",
          "verifierMotDePasseTolerant" in portail and "PASSWORD_MAX_AGE_DAYS = 15" in portail
          and 'id="code"' not in portail
          and portail.count('input[type="password"] {\n    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;') == 3)  # (MODIFIÉ Task 83 : + CSS_OTP/premiere)

    # --- Tests réalignés embarqués ---
    check("test64_portail réaligné Task 74 (étape OTP après CIN+mot de passe)",
          "RÉALIGNÉ Task 74" in t64 and "confirmer_otp" in t64)
    check("tests Task 74 embarqués (otp_qr + harnais 4207/4208)",
          "RÉSULTAT TASK 74" in t74 and "test74.db" in t74sh
          and "4207" in t74sh and "4208" in t74sh and "PORTAL_OTP_TTL_MS=3500" in t74sh)

    # --- Version + documentation ---
    check("package.json : version 0.2.24 (MODIFIÉ Task 83)", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 39 (OTP + QR 10 minutes) + sections 31-38 intactes",
          "## 39. Portail employés : connexion en DEUX ÉTAPES — code OTP + QR code valables 10 minutes" in readm
          and "## 38. Accès portail : bandeau vert et puces retirés" in readm
          and "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm)
    check("README : libellés OTP hors section 31 bien présents (§39)",
          "code OTP" in readm.split("## 39.")[1] if "## 39." in readm else False)

print("MD5 ZIPs :", md5s[0])
print("TASK74 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
