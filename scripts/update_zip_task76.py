#!/usr/bin/env python3
"""Task 76 (18/09/2026) : PORTAIL EMPLOYÉS — « Lors de la première connexion,
le QR code s'affiche. Lors des connexions suivantes, l'utilisateur doit
obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP » :

  1. RÈGLE (MODIFIE la règle Task 75) : la vérification en deux étapes revient
     À CHAQUE connexion — après CIN + mot de passe VALIDÉS, un code OTP à
     usage unique frais (10 minutes) est généré et affiché sur /otp. La
     branche « session directe » (doitChangerDirect) est SUPPRIMÉE.
  2. QR CODE UNIQUEMENT À LA PREMIÈRE CONNEXION (verrou lastLoginAt inchangé,
     Task 75) : le défi porte un champ `premiere` ; la page /otp rend le bloc
     QR seulement si defi.premiere — les connexions suivantes montrent le
     code SANS QR. /api/otp/nouveau recalcule le mode EN BASE.
  3. SCELLLEMENT INCHANGÉ : lastLoginAt n'est écrit QUE par /api/otp/verify
     (connexion COMPLÈTE) — plus JAMAIS dans /api/verify.
  4. DOCUMENTATION : README section 41 + notes de mise à jour en tête des
     sections 39/40 ; page de connexion : « obligatoire à CHAQUE connexion »
     + « QR code affiché à la PREMIÈRE connexion uniquement ».

Nouveaux :
  - scripts/test76_otp_qr_chaque_connexion.py (72 vérifications : statique +
    flux 1re/2e/3e connexions, QR seulement à la 1re, gardes, régénération
    dans le bon mode, annulation, usage unique, expiration aux deux modes,
    lastLoginAt lu en base)
  - scripts/test76_harnais.sh (harnais portable : COPIE + 2 portails
    4212/4213 — TTL normal et TTL 3,5 s)
Remplacés :
  - scripts/portail-server.js  (défi OTP à chaque connexion + QR conditionnel)
  - README-DEPLOIEMENT-LOCAL.md (section 41 + notes §39/§40)
  - package.json (0.2.5 -> 0.2.6)
  - scripts/test74_otp_qr.py, test75_otp_premiere_connexion.py,
    test64_portail.py, test66_champ_motdepasse.py (réalignés Task 76)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70,71,73,74,75}.py : ATTENDU 266 -> 268
  - scripts/test_task40_securisation_auto.py : ATTENDU 266 -> 268
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 266 -> 268
Compte : 266 (état Task 75) + 2 nouveaux = 268 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76.
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
    # --- Task 76 : OTP à chaque connexion, QR seulement à la première ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("package.json", "package.json", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test76_harnais.sh", "scripts/test76_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 75 (elle-même bâtie sur 34->...->75)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task75.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 76 : remplacements + ajouts (sans doublons)
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
    t76 = zz.read("scripts/test76_otp_qr_chaque_connexion.py").decode("utf-8", errors="replace")
    t76sh = zz.read("scripts/test76_harnais.sh").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t75 = zz.read("scripts/test75_otp_premiere_connexion.py").decode("utf-8", errors="replace")
    t64 = zz.read("scripts/test64_portail.py").decode("utf-8", errors="replace")
    t66 = zz.read("scripts/test66_champ_motdepasse.py").decode("utf-8", errors="replace")
    t69 = zz.read("scripts/test69_champ_style.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 76 : OTP à chaque connexion, QR à la première seule ---
    check("(MODIFIÉ Task 86) portail : défi créé à CHAQUE connexion (fenêtre ALIGNÉE sur le secret du QR)",
          "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in portail
          and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail)
    check("portail : règle documentée dans l'entête (DEUX ÉTAPES À CHAQUE CONNEXION)",
          "DEUX ÉTAPES À CHAQUE CONNEXION" in portail)
    check("portail : branche directe Task 75 SUPPRIMÉE (aucune session sans OTP)",
          "doitChangerDirect" not in portail
          and "createPortalSession(cin, remember, doitChangerDirect)" not in portail)
    check("portail : QR généré SEULEMENT si defi.premiere (MODIFIÉ Task 80 : page d'inscription dédiée + verrou posé)",
          "if (defi.premiere)" in portail and "await svgQrOtp(defi)" in portail
          and "function otpHtml(defi, svgQr)" in portail
          and "function otpPremiereHtml(defi, svgQr)" in portail
          and "data: { qrPresente: true }" in portail)
    check("(MODIFIÉ Task 85) portail : rendu QR conditionnel dans la page (svgQr ? bloc otp-qr) + mention d'expiration",
          '${svgQr ? `<div class="otp-qr"' in portail
          and "Le QR code expire dans" in portail)
    check("(SUPPRIMÉ Task 85) plus d'endpoint /api/otp/nouveau (le mode vit dans GET /otp et /api/verify)",
          '"/api/otp/nouveau"' not in portail)  # (MODIFIÉ Task 85)
    check("portail : lastLoginAt JAMAIS écrit dans /api/verify (Task 75/76)",
          "...(premiereConnexion ? {} : { lastLoginAt: new Date() })" not in portail
          and "lastLoginAt: new Date()," in portail)
    check("(MODIFIÉ Task 85) page de connexion : « CHAQUE connexion » + « Le code OTP n'est JAMAIS affiché à l'écran »",
          "obligatoire à CHAQUE connexion" in portail
          and "Le code OTP n'est JAMAIS affiché à l'écran" in portail)
    check("portail : invariants Task 74 conservés (TTL 10 min, usage unique, 5 tentatives, gardes ×4)",
          "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and "otpDefis.delete(sess.cin)" in portail
          and portail.count('code: "OTP_REQUIS"') == 4)

    # --- Tests embarqués Task 76 + réalignés ---
    check("tests Task 76 embarqués (otp_qr_chaque_connexion + harnais 4212/4213)",
          "RÉSULTAT TASK 76" in t76 and "test76.db" in t76sh
          and "4212" in t76sh and "4213" in t76sh
          and "PORTAL_OTP_TTL_MS=3500" in t76sh)
    check("test74 réaligné Task 76 (2e connexion = OTP sans QR)",
          "Task 76" in t74 and "2e connexion ESPA" in t74
          and 'premiereConnexion") is False' in t74)
    check("test75 réaligné Task 76 (scellement conservé + OTP sans QR aux connexions suivantes)",
          "RÉALIGNÉ Task 76" in t75 and "ABROGÉE" in t75
          and "premiereConnexion\") is False" in t75)
    check("(MODIFIÉ Task 85) test64/test66 réalignés Task 76/83 (OTP à chaque connexion, confirmation par TOTP)",
          "Task 76" in t64 and "code_totp_frais" in t64
          and "Task 83" in t66 and 'data-payload' in t66)
    check("(MODIFIÉ Task 85) test69 réaligné Task 83/85 (contrôles source CSS/OTP non cassés — 10 rayons 12px)",
          "MODIFIÉ Task 83" in t69 and portail.count("border-radius: 12px") == 10)

    # --- Version + documentation ---
    check("package.json : version 0.2.24 (MODIFIÉ Task 83)", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 41 (OTP à chaque connexion, QR à la première) + notes §39/§40",
          "## 41. Portail employés : OTP obligatoire À CHAQUE connexion" in readm
          and "Mise à jour (section 41, version 0.2.6)" in readm)
    check("README : sections 31-40 intactes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 38. Accès portail : bandeau vert et puces retirés" in readm
          and "## 39. Portail employés : connexion en DEUX ÉTAPES — code OTP + QR code valables 10 minutes" in readm
          and "## 40. Portail employés : le QR code ne s'affiche qu'à la PREMIÈRE connexion" in readm)

print("MD5 ZIPs :", md5s[0])
print("TASK76 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
