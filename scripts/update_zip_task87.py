#!/usr/bin/env python3
"""Task 87 (19/09/2026) : après « Configuration réussie », retour à la
fenêtre initiale de connexion (« apres cette fenetre derige vers fenetre
initial (cin, mot de passe, otp) »).

AVANT (v0.2.16) : la page /premiere-reussie laissait la session d'inscription
OUVERTE — redirection automatique (5 s) et bouton « Accéder au portail »
menaient directement aux fiches.

CHANGEMENTS (scripts/portail-server.js, v0.2.24) :
  - la session d'inscription est FERMÉE au moment où la page est servie
    (clearSessionCookie sur la route /premiere-reussie) ;
  - le texte annonce la fenêtre de connexion (CIN, mot de passe et code OTP) ;
  - bouton « Aller à la page de connexion » (href=/login, id=btn-connexion) ;
  - redirection automatique (5 s) vers /login ;
  - l'employé re-saisit CIN + mot de passe + OTP pour entrer au portail —
    le parcours 2FA complet est validé DÈS la première connexion.

Nouveaux : test87_redirection_connexion_initiale.py (30 vérif.) +
test87_harnais.sh (COPIE de base, portail 4261, trap EXIT).
Remplacés : portail, package.json (0.2.24), README (§52), suites réalignées
74/75/76/78/80/81/82/83 (version + carte 3/B6/B7 Task 87)/84/85/86.
Compte : 288 (état Task 86) + 2 nouveaux = 290 fichiers.
Hérite de la chaîne : 34 -> … -> 84 -> 85 -> 86 -> 87.
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
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
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
    ("scripts/test87_harnais.sh", "scripts/test87_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 86
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task86.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 87 : remplacements + ajouts (sans doublons)
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
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    t87 = zz.read("scripts/test87_redirection_connexion_initiale.py").decode("utf-8", errors="replace")
    t87sh = zz.read("scripts/test87_harnais.sh").decode("utf-8", errors="replace")
    t83 = zz.read("scripts/test83_premiere_connexion_moderne.py").decode("utf-8", errors="replace")
    t86 = zz.read("scripts/test86_expiration_qr.py").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Cœur Task 87 : retour à la fenêtre initiale de connexion ---
    check("portail : demande utilisateur Task 87 tracée dans l'en-tête",
          "apres cette fenetre derige vers fenetre initial" in portail)
    check("portail : en-tête (NOUVEAU Task 87) documente la fermeture de session + la destination /login",
          "(NOUVEAU Task 87) APRÈS LA FENÊTRE « CONFIGURATION RÉUSSIE »" in portail
          and "la session créée par l'inscription est FERMÉE" in portail)
    check("portail : bouton « Aller à la page de connexion » (href=/login, id=btn-connexion)",
          'href="/login" id="btn-connexion"' in portail
          and "Aller à la page de connexion" in portail)
    check("portail : l'ANCIEN bouton « Accéder au portail » est SUPPRIMÉ",
          "Accéder au portail" not in portail)
    check("portail : texte « redirigé vers la fenêtre de connexion (CIN, mot de passe et code OTP) »",
          "redirigé vers la fenêtre de connexion" in portail
          and "(CIN, mot de passe et code OTP)" in portail)
    check("portail : l'ANCIEN texte « redirigé vers le portail employé » est SUPPRIMÉ",
          "redirigé vers le portail employé" not in portail)
    check("portail : redirection automatique (5 s) vers /login",
          'setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);' in portail)

    # --- Fermeture de session sur la route /premiere-reussie ---
    check("portail : route /premiere-reussie ferme la session (clearSessionCookie avant le 200)",
          "clearSessionCookie(res);\n    res.writeHead(200" in portail)
    check("portail : commentaire (MODIFIÉ Task 87) sur la route + la section SUCCESS_HTML",
          "(MODIFIÉ Task 87) la session d'inscription est FERMÉE" in portail
          and "(MODIFIÉ Task 87) redirection automatique (5 s) ET bouton vers la" in portail)

    # --- Invariants des Tasks antérieures ---
    bloc_reussie = portail.split("const SUCCESS_HTML = `")[1].split("`;")[0] if "const SUCCESS_HTML = `" in portail else ""
    check("portail : le bloc SUCCESS_HTML ne pointe PLUS vers « / » (bouton + redirection = /login)",
          bool(bloc_reussie) and 'apiUrl("/")' not in bloc_reussie
          and 'href="/login"' in bloc_reussie)
    check("portail : garde Task 83 conservée (sans session → 302 /login)",
          'if (!sess || sess.pending || sess.otp) {\n      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });' in portail)
    check("design Task 83/84 intact : fond #f4f6fb ×4, cercles verts ×8, notes vertes",
          portail.count("background: #f4f6fb;") == 4
          and portail.count("border-radius: 50%; background: #059669;") == 8
          and ".note-verte {" in portail and ".expire-note {" in portail)
    check("invariant Task 86 : fenêtre du secret + garde 410 + compte à rebours conservés",
          "otpFenetreCreeA" in portail and "async function obtenirSecretFenetre(acc)" in portail
          and 'code: "OTP_EXPIRE"' in portail and 'id="qr-cd"' in portail)
    check("invariant Task 85 : AUCUN code affiché (otp-affiche / genererCodeOtp / api-otp-nouveau absents)",
          'id="otp-affiche"' not in portail and "genererCodeOtp" not in portail
          and '"/api/otp/nouveau"' not in portail)
    check("invariant Task 83 : verrou qrPresente + « Configuration réussie » + encadré QR unique",
          "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail
          and ">Configuration réussie</h1>" in portail
          and "Le QR code n'est affiché que lors de la première connexion.</span>" in portail)
    check("invariant Task 78 : QR otpauth://totp standard + verifyTotp + anti-rejeu conservés",
          '"otpauth://totp/"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and "verifyTotp" in portail and "lastUsedWindow: fenetreTotp" in portail)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test87 embarqué (30 vérifications : statique + E2E session fermée → fenêtre initiale → reconnexion 2FA)",
          "TASK 87" in t87 and "fenêtre initiale" in t87
          and "clearSessionCookie" in t87 and "SECTION A" in t87)
    check("harnais test87 embarqué (COPIE de base, port 4261, trap EXIT)",
          "test87.db" in t87sh and "4261" in t87sh and "trap" in t87sh and "COPIE" in t87sh)
    check("test83 embarqué réaligné (bouton connexion + B6 session fermée + B7 fenêtre initiale)",
          "Aller à la page de connexion" in t83
          and "B6 la session d'inscription est FERMÉE" in t83
          and "B7 portail inaccessible sans reconnexion" in t83)
    check("test86 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t86)
    check("test74 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t74)
    check("README : section 52 (retour à la fenêtre initiale) + sections 51/50 intactes",
          "## 52. Portail employés : après « Configuration réussie », retour à la fenêtre initiale de connexion" in readm
          and "## 51. Portail employés : le QR code d'inscription EXPIRE VRAIMENT après 10 minutes" in readm
          and "## 50. Portail employés : la fenêtre de confirmation n'affiche JAMAIS le code OTP" in readm)

print("TASK87 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
