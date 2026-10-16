#!/usr/bin/env python3
"""Task 81 (19/09/2026) : « Après avoir scanné le QR code lors de la première
connexion, je me déconnecte puis je me reconnecte : CIN ou mot de passe
incorrect s'affiche. »

DIAGNOSTIC (sonde sur COPIE) : le parcours LITTÉRAL fonctionne (reconnexion
après scan + déconnexion → HTTP 200, premiereConnexion:false). La cause du
blocage ressenti : le changement du mot de passe est OBLIGATOIRE en fin de
première connexion — l'INITIAL cesse de fonctionner, or la page de connexion
n'affichait QUE l'aide « mot de passe initial » : l'employé revenu recopiait
l'initial devenu invalide, sans aucune explication.

CHANGEMENTS (textes uniquement — AUCUNE règle d'authentification modifiée) :
  1. PAGE DE CONNEXION : l'aide distingue le premier accès (initial) et
     l'employé revenu (« Déjà venu ? Utilisez VOTRE mot de passe… ») ;
  2. PAGE DE CONNEXION : BANDEAU d'aide affiché sous l'erreur quand le
     serveur répond « CIN ou mot de passe incorrect » (cause la plus courante
     + voie de récupération : réinitialisation par le RH) — texte statique,
     aucune fuite d'information (message serveur identique pour un CIN
     inconnu et un mauvais mot de passe) ;
  3. ASTUCE élargie : « recopiez votre mot de passe (initial ou personnel) » ;
  4. PAGE DE CONFIRMATION OTP (connexions suivantes) : précise que le code
     GÉNÉRÉ PAR L'APPLICATION d'authentification (inscrite via le QR) est
     également accepté (double voie Task 78 conservée).

CONSERVÉ : règles Tasks 74-80 (QR à la première connexion seule, page QR
seul, 10 minutes, usage unique, 5 tentatives, changement de mot de passe
après l'OTP, verrou qrPresente, secret TOTP chiffré, anti-rejeu).

Nouveaux :
  - scripts/test81_reconnexion_apres_scan.py (39 vérifications)
  - scripts/test81_harnais.sh (COPIE + port 4233, trap EXIT)
Remplacés :
  - scripts/portail-server.js, package.json (0.2.11),
    README-DEPLOIEMENT-LOCAL.md (§46), test74/75/76/78/80 (réalignés version).
Remis en cohérence (hors archive) :
  - scripts/patch_attendu_task81.py : ATTENDU 276 -> 278 dans les maillons
    38/64/65/66/67/69/70/71/73/74/75/76/77/78/79/80 + suites task40/42 ;
    contrôles de version des maillons 74-80 réalignés 0.2.11.
Compte : 276 (état Task 80) + 2 nouveaux = 278 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76 -> 77 -> 78
-> 79 -> 80 -> 81.
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
    ("scripts/test81_harnais.sh", "scripts/test81_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 80 (elle-même bâtie sur 34->...->80)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task80.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 81 : remplacements + ajouts (sans doublons)
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
    t81 = zz.read("scripts/test81_reconnexion_apres_scan.py").decode("utf-8", errors="replace")
    t81sh = zz.read("scripts/test81_harnais.sh").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t80 = zz.read("scripts/test80_qr_seul.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 81 : page de connexion expliquée ---
    check("portail : ligne « Déjà venu ? Utilisez VOTRE mot de passe » (page de connexion)",
          "Déjà venu ? Utilisez <b>VOTRE</b> mot de passe" in portail)
    check("portail : l'initial « ne fonctionne plus après le changement obligatoire »",
          "le mot de passe initial ne fonctionne plus après le changement obligatoire" in portail)
    check("portail : BANDEAU hint-echec (explication sous l'erreur)",
          'id="hint-echec"' in portail
          and "Mot de passe refusé après votre première connexion ?" in portail
          and "le mot de passe initial n'est <b>plus valable</b>" in portail
          and "il peut réinitialiser votre accès" in portail)
    check("portail : déclencheur JS du bandeau sur l'erreur générique",
          'err.indexOf("CIN ou mot de passe incorrect") >= 0' in portail
          and "hintEchec" in portail)
    check("portail : astuce élargie « (initial ou personnel) »",
          "recopiez votre mot de passe (initial ou" in portail)
    check("(MODIFIÉ Task 85) portail : fenêtre de confirmation — le code vient UNIQUEMENT de l'application (jamais affiché)",
          "vient UNIQUEMENT de votre application" in portail
          and "il n'est JAMAIS affiché sur cette page" in portail)
    check("portail : message 401 générique INTACT (aucun changement de règle)",
          'const generic = "CIN ou mot de passe incorrect. Réessayez.";' in portail)

    # --- Contrôles Task 81 : version + suite embarquée ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test74 embarqué réaligné Task 81 (version 0.2.11)",
          "0.2.24" in t74 and "Task 83" in t74)
    check("test80 embarqué réaligné Task 81 (version 0.2.11)",
          "0.2.24" in t80)
    check("test81 embarqué (39 vérifications : statique + parcours scan→déconnexion→reconnexion→401 expliqué→mot de passe personnel)",
          "TASK 81" in t81 and "RECONNEXION après le scan → 200 (PAS de 401, PAS de boucle QR)" in t81
          and "totp_now" in t81 and "hint-echec" in t81)
    check("harnais test81 embarqué (COPIE de base, port 4233, trap EXIT)",
          "test81.db" in t81sh and "4233" in t81sh and "trap" in t81sh and "COPIE" in t81sh)
    check("README : section 46 (reconnexion après le scan expliquée)",
          "## 46. Reconnexion après le scan du QR" in readm
          and "test81_harnais.sh" in readm and "Déjà venu ?" in readm)
    check("README : sections 45 et 31-44 intactes",
          "## 45. Fenêtre d'inscription : UNIQUEMENT le QR code" in readm
          and "## 44. Tableau de bord : « CIN détectés » compte désormais les CIN DISTINCTS" in readm
          and "## 31." in readm)

    # --- Invariants Task 74-80 (rien n'a été dégradé) ---
    check("invariant Task 80/83 : page « Configuration OTP » + verrou qrPresente toujours dans le portail embarqué",
          "function otpPremiereHtml(defi, svgQr)" in portail
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
          and 'code: "OTP_QR_A_SCANNER"' not in portail)
    check("invariant Task 78 : QR otpauth://totp standard + verifyTotp toujours embarqués",
          '"otpauth://totp/"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and "verifyTotp" in portail)
    check("invariant Task 64 : changement obligatoire après l'OTP conservé",
          "/api/change-password" in portail and "mustChangePassword" in portail)

print("TASK81 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
