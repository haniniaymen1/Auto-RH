#!/usr/bin/env python3
"""Task 85 (19/09/2026) : la fenêtre de confirmation OTP n'affiche JAMAIS le
code — uniquement le QR code (expirant après 10 minutes).

DEMANDE UTILISATEUR : « jamais affiche le code otp comme ca / dans cette
fenetre n affiche que qr code qui expire apres 10 minute » (capture du code
« 963 903 » affiché en clair dans la fenêtre de confirmation des connexions
suivantes).

CHANGEMENTS (scripts/portail-server.js) :
  - fenêtre de confirmation /otp (connexions suivantes) alignée sur la
    fenêtre d'inscription : QR code (URI otpauth://totp standard, secret
    PERSISTANT) + mention « Le QR code expire dans 10 minutes. » + champ
    « Code OTP » + « Valider le code » + « Se déconnecter » ;
  - SUPPRESSION TOTALE du mécanisme « code à usage unique affiché » : bloc
    otp-affiche, compte à rebours, bouton « Générer un nouveau code »,
    endpoint /api/otp/nouveau (→ 404), générateur genererCodeOtp, champ
    code du défi, styles .otp-code/.otp-compte ;
  - /api/otp/verify : TOTP SEUL (RFC 6238, ±1 fenêtre, anti-rejeu) ;
  - messages de garde OTP_REQUIS réécrits (plus de « code affiché ») ;
  - textes page expirée + pied de page connexion réalignés.

Nouveaux : test85_fenetre_qr_seul.py (55 vérif.) + test85_harnais.sh.
Remplacés : portail, package.json (0.2.24), README (§50), suites réalignées
64p/66/67/69/74/75/76/78/80/81/82/83/84 (confirmation par TOTP calculé depuis
le QR — seuls les CONTRÔLES, jamais les fichiers pour « faire passer »).
Compte : 284 (état Task 84) + 2 nouveaux = 286 fichiers.
Hérite de la chaîne : 34 -> … -> 80 -> 81 -> 83 -> 84 -> 85.
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
    ("scripts/test83_premiere_connexion_moderne.py", "scripts/test83_premiere_connexion_moderne.py", False),
    ("scripts/test84_cercles_verts.py", "scripts/test84_cercles_verts.py", False),
    ("scripts/test85_fenetre_qr_seul.py", "scripts/test85_fenetre_qr_seul.py", False),
    ("scripts/test85_harnais.sh", "scripts/test85_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 84
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task84.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 85 : remplacements + ajouts (sans doublons)
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
    t85 = zz.read("scripts/test85_fenetre_qr_seul.py").decode("utf-8", errors="replace")
    t85sh = zz.read("scripts/test85_harnais.sh").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t84 = zz.read("scripts/test84_cercles_verts.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 85 : la fenêtre n'affiche JAMAIS le code ---
    check("portail : AUCUN bloc « otp-affiche » (le code n'est jamais affiché)",
          'id="otp-affiche"' not in portail)
    check("portail : AUCUN compte à rebours du code (id=\"compte\" / .otp-compte supprimés)",
          'id="compte"' not in portail and ".otp-compte {" not in portail)
    check("portail : AUCUN bouton « Générer un nouveau code » (btn-nouveau supprimé)",
          'id="btn-nouveau"' not in portail and "Générer un nouveau code</button>" not in portail)
    check("portail : AUCUN texte « code à usage unique généré »",
          "vient d'être généré" not in portail)
    check("portail : endpoint /api/otp/nouveau SUPPRIMÉ (route retirée)",
          '"/api/otp/nouveau"' not in portail)
    check("portail : générateur genererCodeOtp + champ defi.code SUPPRIMÉS",
          "genererCodeOtp" not in portail and "defi.code" not in portail)
    check("portail : fenêtre de confirmation avec QR conditionnel (svgQr ? otp-qr + data-payload)",
          '${svgQr ? `<div class="otp-qr" id="qr-bloc" data-payload=' in portail)
    check("portail : mention « Le QR code expire dans » + champ de confirmation + Valider + Se déconnecter",
          portail.count("Le QR code expire dans") >= 2
          and "Confirmez le code OTP (6 chiffres)" in portail
          and "Valider le code" in portail and "Se déconnecter" in portail)
    check("portail : le texte affirme que le code n'est JAMAIS affiché sur la page",
          "il n'est JAMAIS affiché sur cette page" in portail)
    check("portail : /api/otp/verify TOTP SEUL (codeCorrect=false, plus de comparaison au code affiché)",
          "let codeCorrect = false;" in portail and "code === defi.code" not in portail)
    check("portail : messages de garde OTP_REQUIS réécrits (×4 — plus de « code affiché dans le portail »)",
          portail.count("Confirmez d'abord le code OTP généré par votre application d'authentification.") == 4
          and "affiché dans le portail" not in portail)
    check("portail : bascule automatique vers la page expirée à la fin du défi (les deux fenêtres)",
          portail.count('location.replace(apiUrl("/otp"))') >= 2)

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
    check("invariant Task 82 : champ « Code OTP » du formulaire de connexion conservé",
          '<label for="otp">Code OTP (application d\'authentification)</label>' in portail)
    check("invariant Task 64 : changement obligatoire conservé (/changer + /api/change-password)",
          "/api/change-password" in portail and 'redirect: "/changer",' in portail)
    check("invariant Task 74 : TTL 10 minutes + 5 tentatives + page « Code OTP expiré »",
          "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and "function otpExpireHtml" in portail and "Se reconnecter" in portail)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test85 embarqué (55 vérifications : statique + E2E fenêtre QR seul)",
          "RÉSULTAT TASK 85" in t85 and "jamais affiche le code otp comme ca" in t85
          and "SECTION A" in t85 and "SECTION B" in t85 and "SECTION C" in t85
          and "totp_now" in t85 and "/api/otp/nouveau" in t85)
    check("harnais test85 embarqué (COPIE de base, ports 4247/4248, trap EXIT, TTL 3,5 s)",
          "test85.db" in t85sh and "4247" in t85sh and "4248" in t85sh
          and "PORTAL_OTP_TTL_MS=3500" in t85sh and "trap" in t85sh)
    check("test74 embarqué réaligné (TOTP depuis le QR + version 0.2.24)",
          "code_totp_frais" in t74 and 'pkg.get("version") == "0.2.24"' in t74)
    check("test84 embarqué réaligné version 0.2.24 (cercles verts conservés)",
          'pkg.get("version") == "0.2.24"' in t84
          and "AUCUN bleu restant" in t84)
    check("README : section 50 (fenêtre QR seul) + sections 48/49 intactes",
          "## 50. Portail employés : la fenêtre de confirmation n'affiche JAMAIS le code OTP" in readm
          and "## 49. Portail employés : les cercles des têtes de carte passent au vert" in readm
          and "## 48. Portail employés : première connexion en 2 étapes (maquette) + design modernisé" in readm)

print("TASK85 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
