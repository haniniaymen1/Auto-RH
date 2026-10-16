#!/usr/bin/env python3
"""Task 83 (19/09/2026) : interface moderne du portail employés (maquette
utilisateur) — première connexion en 2 ÉTAPES sur pages dédiées + champ
« Code OTP » dans le formulaire de connexion (Task 82 fusionnée).

DEMANDES UTILISATEUR :
  « Il n'y a pas de champ permettant de saisir l'OTP. De plus, le même
   problème se produit lorsque le CIN ou le mot de passe est incorrect. Le
   changement du mot de passe initial ne s'affiche pas. » (Task 82)
  « 1. Première connexion : CIN + Mot de passe initial + Nouveau mot de
   passe + Répéter le nouveau mot de passe + Valider → 2e étape : QR Code
   OTP + champ Code OTP + expiration 10 minutes + Valider. 2. Connexions
   suivantes : CIN + Mot de passe + OTP + Se connecter. Règles : initial à
   usage unique, nouveau mot de passe obligatoire, QR seulement à la
   première connexion (expire 10 min, JAMAIS ré-affiché). » (Task 83)

CHANGEMENTS (scripts/portail-server.js) :
  - page /premiere (étape 1) + POST /api/premiere (identification +
    changement du mot de passe initial, politique Task 64/66, quota dédié) ;
  - page /otp mode première « Configuration OTP » (QR + champ Code OTP +
    mention 10 minutes + Valider — REMPLACE la page « QR seul » Task 80) ;
  - page /premiere-reussie « Configuration réussie » (carte 3) ;
  - /api/verify oriente mustChangePassword vers /premiere ; /api/otp/verify
    accepte le code pendant l'inscription (OTP_QR_A_SCANNER supprimé) ;
  - connexion en UNE étape CIN + mot de passe + OTP (Task 82) ;
  - design modernisé (fond clair bleuté, cartes arrondies, ombres légères,
    cercles icônes bleus, œil, notes vertes, boutons verts) + règle
    input[type=password] ajoutée à CSS_OTP (défaut réel découvert en test).

Nouveaux : test82_champ_otp_connexion.py (56 vérif.) + test82_harnais.sh,
test83_premiere_connexion_moderne.py (65 vérif.) + test83_harnais.sh.
Remplacés : portail, package.json (0.2.24), README (§47+§48), suites
réalignées 64_portail/66/67/69/74/75/76/78/80/81/82 + test_task37.
Compte : 278 (état Task 81) + 4 nouveaux = 282 fichiers.
Hérite de la chaîne : 34 -> … -> 79 -> 80 -> 81 -> 83.
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
    ("scripts/test64_portail.py", "scripts/test64_portail.py", False),
    ("scripts/test66_champ_motdepasse.py", "scripts/test66_champ_motdepasse.py", False),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py", False),
    ("scripts/test69_champ_style.py", "scripts/test69_champ_style.py", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test81_reconnexion_apres_scan.py", "scripts/test81_reconnexion_apres_scan.py", False),
    ("scripts/test82_champ_otp_connexion.py", "scripts/test82_champ_otp_connexion.py", False),
    ("scripts/test82_harnais.sh", "scripts/test82_harnais.sh", False),
    ("scripts/test83_premiere_connexion_moderne.py", "scripts/test83_premiere_connexion_moderne.py", False),
    ("scripts/test83_harnais.sh", "scripts/test83_harnais.sh", False),
    ("scripts/test_task37_sans_historique.py", "scripts/test_task37_sans_historique.py", False),
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


# 1) Chaîne cumulative jusqu'à la Task 81
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task81.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 83 : remplacements + ajouts (sans doublons)
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
    t82 = zz.read("scripts/test82_champ_otp_connexion.py").decode("utf-8", errors="replace")
    t83 = zz.read("scripts/test83_premiere_connexion_moderne.py").decode("utf-8", errors="replace")
    t83sh = zz.read("scripts/test83_harnais.sh").decode("utf-8", errors="replace")
    t80 = zz.read("scripts/test80_qr_seul.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 82 : champ Code OTP dans la connexion ---
    check("portail : 3e champ « Code OTP (application d'authentification) » du formulaire de connexion",
          '<label for="otp">Code OTP (application d\'authentification)</label>' in portail
          and 'id="otp" name="otp" class="code" inputmode="numeric" maxlength="8"' in portail)
    check("portail : /api/verify vérifie le code TOTP en direct (connexion UNE étape)",
          "verifyTotp(secretOtp, otpSaisi, acc.lastUsedWindow)" in portail
          and '"Code OTP incorrect. Il vous reste " + restantes + " tentative"' in portail)
    check("portail : code parasite IGNORÉ à la première connexion + 400 malformé",
          "(!tOtp.ok && premiereConnexion) → code parasite IGNORÉ" in portail
          and "Le code OTP doit contenir exactement 6 chiffres. Première connexion ? Laissez le champ Code OTP vide" in portail)

    # --- Contrôles Task 83 : première connexion en 2 étapes (maquette) ---
    check("portail : page /premiere (4 champs maquette + bouton Valider + POST /api/premiere)",
          '<label for="cin">CIN</label>' in portail
          and '<label for="password">Mot de passe initial</label>' in portail
          and '<label for="nouveau">Nouveau mot de passe</label>' in portail
          and '<label for="repete">Répéter le nouveau mot de passe</label>' in portail
          and 'id="form-premiere"' in portail and 'fetch(apiUrl("/api/premiere")' in portail)
    check("portail : /api/premiere (politique Task 64/66 + message générique + quota dédié)",
          'if (pathname === "/api/premiere" && req.method === "POST") {' in portail
          and "validerNouveauMotDePasse(nouveauPropre, actuelPropre, cin)" in portail
          and 'allowRequest(ip, "premiere")' in portail
          and 'const genericPremiere = "CIN ou mot de passe incorrect. Réessayez.";' in portail)
    check("(MODIFIÉ Task 86) portail : étape 2 « Configuration OTP » (QR + champ + compte à rebours qr-cd + Valider)",
          "function otpPremiereHtml(defi, svgQr)" in portail
          and '<span class="carte-titre">Configuration OTP</span>' in portail
          and '<label for="otp-saisie">Code OTP</label>' in portail
          and 'Le QR code expire dans <b id="qr-cd">&nbsp;${LIBELLE_OTP}</b>.' in portail
          and 'location.replace(apiUrl("/premiere-reussie"))' in portail)
    check("(MODIFIÉ Task 87) portail : page « Configuration réussie » + encadré QR unique + bouton « Aller à la page de connexion »",
          ">Configuration réussie</h1>" in portail
          and "Le QR code n'est affiché que lors de la première connexion.</span>" in portail
          and "Aller à la page de connexion" in portail
          and 'clearSessionCookie(res);\n    res.writeHead(200' in portail)
    check("portail : /api/verify oriente mustChangePassword vers /premiere",
          "if (acc.mustChangePassword) {\n      return sendJson(res, 200, {\n        ok: true,\n        premiere: true," in portail)
    check("portail : refus Task 80 OTP_QR_A_SCANNER SUPPRIMÉ",
          'code: "OTP_QR_A_SCANNER"' not in portail)
    check("portail : lien « Première connexion ? » + tête de carte « Connexion » (maquette)",
          '<a class="lien-premiere" href="/premiere">Première connexion ? (mot de passe initial + configuration OTP)</a>' in portail
          and '<span class="carte-titre">Connexion</span>' in portail)
    check("portail : design maquette (fond #f4f6fb ×4, oeil, icon-rond, note-verte, expire-note)",
          portail.count("background: #f4f6fb;") == 4
          and ".oeil {" in portail and ".icon-rond {" in portail
          and ".note-verte {" in portail and ".expire-note {" in portail)
    check("portail : règle input[type=password] dans CSS_OTP (3 occurrences :focus)",
          portail.count('input[type="password"]:focus { border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,.14); }') == 3)
    check("portail : verrou QR unique conservé (!lastLoginAt && !qrPresente)",
          "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
          and "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test82 embarqué (56 vérifications : champ OTP connexion, une étape, anti-rejeu, verrouillage)",
          "TASK 82" in t82 and "0.2.24" in t82 and "connexion UNE étape" in t82)
    check("test83 embarqué (65 vérifications : maquette étapes 1-2-réussie, orientation /premiere, QR jamais ré-affiché)",
          "TASK 83" in t83 and "0.2.24" in t83 and "/premiere-reussie" in t83)
    check("test80 embarqué réaligné Task 83 (0.2.24, refus supprimé)",
          "0.2.24" in t80 and "OTP_QR_A_SCANNER" in t80 and "Task 83" in t80)
    check("harnais test83 embarqué (COPIE de base, port 4235, trap EXIT)",
          "test83.db" in t83sh and "4235" in t83sh and "trap" in t83sh and "COPIE" in t83sh)
    check("README : sections 47 et 48 (champ OTP connexion + première connexion en 2 étapes)",
          "## 47. Portail employés : le champ « Code OTP » directement dans le formulaire de connexion" in readm
          and "## 48. Portail employés : première connexion en 2 étapes (maquette) + design modernisé" in readm
          and "test83_harnais.sh" in readm)
    check("README : sections 45/46 et 31-44 intactes",
          "## 46. Reconnexion après le scan du QR" in readm
          and "## 45. Fenêtre d'inscription : UNIQUEMENT le QR code" in readm
          and "## 31." in readm)

    # --- Invariants Task 74-79 (rien n'a été dégradé) ---
    check("invariant Task 78 : QR otpauth://totp standard + verifyTotp toujours embarqués",
          '"otpauth://totp/"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and "verifyTotp" in portail)
    check("(MODIFIÉ Task 85) invariant Task 78 : validation TOTP SEUL (voie « code écran » supprimée, anti-rejeu conservé)",
          "let codeCorrect = false;" in portail and "code === defi.code" not in portail
          and "verifyTotp(" in portail)
    check("invariant Task 64 : changement obligatoire conservé (/changer + /api/change-password)",
          "/api/change-password" in portail and "mustChangePassword" in portail
          and 'redirect: "/changer",' in portail)

print("TASK83 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
