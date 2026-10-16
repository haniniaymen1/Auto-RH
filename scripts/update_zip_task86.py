#!/usr/bin/env python3
"""Task 86 (19/09/2026) : le QR code d'inscription EXPIRE VRAIMENT après
10 minutes (« Qr code n'expire pas apres 10 minute vérifier »).

CAUSE RÉELLE (v0.2.15) : la fenêtre /otp expirait (défi purgé, bascule vers
« Code OTP expiré »), MAIS le secret TOTP encodé par le QR était PERSISTANT
dès la première validation CIN + mot de passe : le même QR revenait à chaque
reconnexion et son code restait accepté POUR TOUJOURS.

CHANGEMENTS (scripts/portail-server.js + src, v0.2.24) :
  - secret d'inscription = FENÊTRE de 10 minutes (nouveau champ
    PortalAccess.otpFenetreCreeA) : réutilisé tant qu'il est vivant (même QR),
    RÉGÉNÉRÉ sinon (ancien scan DÉFINITIVEMENT mort, QR différent au retour) ;
  - SCELLEMENT par la confirmation du code (/api/otp/verify + connexion une
    étape) : otpFenetreCreeA → null — le secret confirmé devient définitif ;
  - fenêtre du défi ALIGNÉE sur la vie du secret (creerDefiOtp à 5 arguments,
    drapeau defi.fenetre) ; garde /api/otp/verify 410 si fenêtre dépassée ;
  - compte à rebours VISIBLE en direct (id="qr-cd" + majCd, mm:ss) ;
  - libellés honnêtes (QR expirable vs « Cette fenêtre expire dans ») ;
  - administration : OTP_TTL_MS partagé, GET qrFenetreExpiree, action « qr »
    avec rotation si fenêtre dépassée (fenetreRenouvelee + expireA),
    « reset-qr » fenêtre ouverte (non inscrit) / scellé (inscrit) ;
  - interface « Gestion des QR codes » : statut « QR expiré — nouveau QR à la
    prochaine connexion », compteur, dialog « Valable 10 minutes ».

Nouveaux : test86_expiration_qr.py (74 vérif.) + test86_harnais.sh.
Remplacés : portail, prisma/schema.prisma, route.ts, portal-access-tab.tsx,
package.json (0.2.24), README (§51), test74_inserer.js, suites réalignées
74/75/76/78/80/81/82/83/84/85 (version + contrôles Task 86 ; C3 de test85
rendu DÉTERMINISTE — anti-rejeu Task 78 vs fenêtre future).
Compte : 286 (état Task 85) + 2 nouveaux = 288 fichiers.
Hérite de la chaîne : 34 -> … -> 83 -> 84 -> 85 -> 86.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)

FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("prisma/schema.prisma", "prisma/schema.prisma", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test74_inserer.js", "scripts/test74_inserer.js", False),
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
    ("scripts/test86_harnais.sh", "scripts/test86_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 85
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task85.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 86 : remplacements + ajouts (sans doublons)
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
    schema = zz.read("prisma/schema.prisma").decode("utf-8", errors="replace")
    route_ts = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    tsx = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    inserer = zz.read("scripts/test74_inserer.js").decode("utf-8", errors="replace")
    t86 = zz.read("scripts/test86_expiration_qr.py").decode("utf-8", errors="replace")
    t86sh = zz.read("scripts/test86_harnais.sh").decode("utf-8", errors="replace")
    t85 = zz.read("scripts/test85_fenetre_qr_seul.py").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Cœur Task 86 : le secret d'inscription est une FENÊTRE ---
    check("portail : demande utilisateur Task 86 tracée dans l'en-tête",
          "Qr code n'expire pas apres 10 minute vérifier" in portail)
    check("portail : fenêtre du secret (fenetreSecretVivante + obtenirSecretFenetre)",
          "function fenetreSecretVivante(acc)" in portail
          and "async function obtenirSecretFenetre(acc)" in portail)
    check("portail : l'ancien secret persistant « généré une fois » est remplacé",
          "let secretOtp = cryptoBd.dechiffrerChamp(acc.totpSecret);" not in portail
          and "let secretPremiere = cryptoBd.dechiffrerChamp(acc.totpSecret);" not in portail)
    check("portail : /api/verify ET /api/premiere passent par obtenirSecretFenetre",
          portail.count("const fenetre = await obtenirSecretFenetre(acc);") == 2)
    check("portail : défi ALIGNÉ sur la fenêtre du secret (creerDefiOtp à 5 arguments)",
          "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in portail
          and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail
          and "creerDefiOtp(cin, false, premiereInscription, secretPremiere, fenetre.expireAt)" in portail)
    check("portail : garde d'expiration du secret de fenêtre (410) dans /api/otp/verify",
          "GARDE D'EXPIRATION DU SECRET DE FENÊTRE" in portail
          and "Date.now() - new Date(accTotp.otpFenetreCreeA).getTime() >= OTP_TTL_MS" in portail)
    check("portail : SCELLEMENT dans /api/otp/verify ET /api/verify (otpFenetreCreeA → null)",
          portail.count("...(acc.otpFenetreCreeA ? { otpFenetreCreeA: null } : {})") == 2)

    # --- Compte à rebours visible + libellés honnêtes ---
    check("portail : compte à rebours VISIBLE (id=qr-cd + majCd sur les deux fenêtres)",
          'Le QR code expire dans <b id="qr-cd">' in portail
          and portail.count("function majCd()") == 2)
    check("portail : libellé honnête (QR expirable vs « Cette fenêtre expire dans »)",
          'defi.fenetre ? "Le QR code expire dans" : "Cette fenêtre expire dans"' in portail)
    check("portail : QR d'inscription DÉFINITIVEMENT invalide après expiration",
          "ce QR code est DÉFINITIVEMENT invalide" in portail
          and "le secret encodé est DÉFINITIVEMENT mort" in portail)

    # --- Schéma + administration ---
    check("schéma : champ PortalAccess.otpFenetreCreeA (DateTime?)",
          "otpFenetreCreeA DateTime?" in schema)
    check("route admin : OTP_TTL_MS partagé + qrFenetreExpiree exposé (jamais le secret)",
          "PORTAL_OTP_TTL_MS" in route_ts and "qrFenetreExpiree: fenetreExpiree" in route_ts)
    check("route admin : action qr avec rotation (fenetreRenouvelee + expireA)",
          "fenetreRenouvelee" in route_ts
          and "data: { totpSecret: secret, otpFenetreCreeA: new Date() }" in route_ts)
    check("route admin : reset-qr ouvre une fenêtre (non inscrit) / scelle (inscrit)",
          "otpFenetreCreeA: row.lastLoginAt ? null : new Date()" in route_ts)
    check("interface : statut « QR expiré — nouveau QR à la prochaine connexion » + compteur",
          "QR expiré — nouveau QR à la prochaine connexion" in tsx
          and "row.qrFenetreExpiree" in tsx and "qrMeta.expires" in tsx
          and "qrFenetreExpiree: boolean;" in tsx)
    check("interface : dialog « Valable 10 minutes »",
          "Valable 10 minutes" in tsx)

    # --- Design + invariants des Tasks antérieures ---
    check("design Task 83/84 intact : fond #f4f6fb ×4, cercles verts ×8, notes vertes",
          portail.count("background: #f4f6fb;") == 4
          and portail.count("border-radius: 50%; background: #059669;") == 8
          and ".note-verte {" in portail and ".expire-note {" in portail)
    check("invariant Task 78 : QR otpauth://totp standard + verifyTotp + anti-rejeu conservés",
          '"otpauth://totp/"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and "verifyTotp" in portail and "lastUsedWindow: fenetreTotp" in portail)
    check("invariant Task 83 : /premiere + « Configuration OTP » + verrou qrPresente conservés",
          'id="form-premiere"' in portail and "function otpPremiereHtml(defi, svgQr)" in portail
          and "data: { qrPresente: true }" in portail
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail)
    check("invariant Task 85 : AUCUN code affiché (otp-affiche / genererCodeOtp / api-otp-nouveau absents)",
          'id="otp-affiche"' not in portail and "genererCodeOtp" not in portail
          and '"/api/otp/nouveau"' not in portail)
    check("invariant Task 64/74 : TTL 10 minutes + 5 tentatives + page « Code OTP expiré »",
          "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and "function otpExpireHtml" in portail and "Se reconnecter" in portail)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test86 embarqué (74 vérifications : statique + rotation + ancien scan refusé + admin)",
          "RÉSULTAT TASK 86" in t86 and "Qr code n'expire pas apres 10 minute vérifier" in t86
          and "SECTION A" in t86 and "SECTION B" in t86 and "SECTION C" in t86
          and "totp_now" in t86 and "qrFenetreExpiree" in t86)
    check("harnais test86 embarqué (COPIE de base, ports 4255/4256/4257, trap EXIT, TTL 3,5 s)",
          "test86.db" in t86sh and "4255" in t86sh and "4256" in t86sh and "4257" in t86sh
          and "PORTAL_OTP_TTL_MS=3500" in t86sh and "trap" in t86sh)
    check("test74_inserer.js : 3e accès jetable TEST86MORT + lecture otpFenetreCreeA",
          "TEST86MORT" in inserer and "otpFenetreCreeA" in inserer)
    check("test85 embarqué réaligné (C3 déterministe + version 0.2.24)",
          "fenetre_a7" in t85 and 'pkg.get("version") == "0.2.24"' in t85)
    check("test74 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t74)
    check("README : section 51 (QR expire vraiment) + sections 50/49 intactes",
          "## 51. Portail employés : le QR code d'inscription EXPIRE VRAIMENT après 10 minutes" in readm
          and "## 50. Portail employés : la fenêtre de confirmation n'affiche JAMAIS le code OTP" in readm
          and "## 49. Portail employés : les cercles des têtes de carte passent au vert" in readm)

print("TASK86 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
