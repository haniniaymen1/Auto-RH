#!/usr/bin/env python3
"""Task 88 (19/09/2026) : Authenticator — l'« Account Name » affiche
« Fiche de paie » au lieu du CIN (« Dans l'application Authenticator, le
champ Account Name contient actuellement le CIN. Je souhaite que le nom
affiché dans Account Name soit "Fiche de paie" à la place du CIN. »).

AVANT (v0.2.17) : l'URI otpauth://totp encodée dans le QR code portait le
label « Auto-RH:CIN » : l'application d'authentification affichait le CIN
de l'employé dans « Account Name » — un identifiant sensible visible en
permanence sur l'écran du téléphone.

CHANGEMENTS (v0.2.24) :
  - le label devient « Auto-RH:Fiche de paie » : l'Authenticator affiche
    « Fiche de paie » (Account Name) avec l'émetteur « Auto-RH » ;
  - le CIN ne figure PLUS dans l'URI (gain de confidentialité) ;
  - le calcul TOTP est INCHANGÉ (le label ne participe pas au HMAC) — les
    comptes déjà associés continuent de générer des codes valables ;
  - les DEUX générateurs sont alignés : portail (contenuQrOtp) ET
    administration (contenuQr, section « Gestion des QR codes »).

Nouveaux : test88_nom_compte_authenticator.py (27 vérif.) +
test88_harnais.sh (COPIE de base, portail 4263, trap EXIT).
Remplacés : portail, route.ts, package.json (0.2.24), README (§53),
suites réalignées 74/75/76/78 (label décodé)/80 (label décodé)/81/82/83/
84/85/86/87.
Compte : 290 (état Task 87) + 2 nouveaux = 292 fichiers.
Hérite de la chaîne : 34 -> … -> 85 -> 86 -> 87 -> 88.
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
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
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
    ("scripts/test88_nom_compte_authenticator.py", "scripts/test88_nom_compte_authenticator.py", False),
    ("scripts/test88_harnais.sh", "scripts/test88_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 87
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task87.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 88 : remplacements + ajouts (sans doublons)
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
    route_ts = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    t88 = zz.read("scripts/test88_nom_compte_authenticator.py").decode("utf-8", errors="replace")
    t88sh = zz.read("scripts/test88_harnais.sh").decode("utf-8", errors="replace")
    t78 = zz.read("scripts/test78_totp_authenticator.py").decode("utf-8", errors="replace")
    t80 = zz.read("scripts/test80_qr_seul.py").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t87 = zz.read("scripts/test87_redirection_connexion_initiale.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Cœur Task 88 : Account Name « Fiche de paie » (PLUS le CIN) ---
    check("portail : demande utilisateur Task 88 tracée dans l'en-tête",
          "Fiche de paie" in portail and "MODIFIÉ Task 88" in portail)
    check("portail : contenuQrOtp = label « Auto-RH:Fiche de paie »",
          'encodeURIComponent("Auto-RH:Fiche de paie")' in portail)
    check("portail : l'ANCIEN label « Auto-RH:CIN » (concaténation defi.cin) est SUPPRIMÉ",
          'Auto-RH:" + defi.cin' not in portail and '"Auto-RH:" +' not in portail)
    check("portail : commentaire (MODIFIÉ Task 88) « Account Name » AU LIEU du CIN",
          "« Account Name » doit afficher « Fiche de paie » AU LIEU du CIN" in portail)
    check("administration : contenuQr = label « Auto-RH:Fiche de paie » (aligné sur le portail)",
          'encodeURIComponent("Auto-RH:Fiche de paie")' in route_ts)
    check("administration : l'ANCIEN label « Auto-RH:CIN » (concaténation cin) est SUPPRIMÉ",
          'Auto-RH:" + cin' not in route_ts and '"Auto-RH:" +' not in route_ts)
    check("administration : commentaire (MODIFIÉ Task 88) + void cin (paramètre conservé)",
          "(MODIFIÉ Task 88) le CIN n'entre PLUS dans le label" in route_ts and "void cin;" in route_ts)
    check("portail + administration : issuer/algorithm/digits/period INCHANGÉS (Task 78)",
          '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in route_ts)
    check("portail : le label ne participe PAS au calcul TOTP (verifyTotp + lastUsedWindow inchangés)",
          "verifyTotp" in portail and "lastUsedWindow: fenetreTotp" in portail)

    # --- Invariants des Tasks antérieures ---
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
    check("invariant Task 87 : retour à la fenêtre initiale de connexion (bouton + redirection /login)",
          'href="/login" id="btn-connexion"' in portail
          and 'setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);' in portail
          and "Accéder au portail" not in portail)
    check("design Task 83/84 intact : fond #f4f6fb ×4, cercles verts ×8, notes vertes",
          portail.count("background: #f4f6fb;") == 4
          and portail.count("border-radius: 50%; background: #059669;") == 8
          and ".note-verte {" in portail and ".expire-note {" in portail)
    check("administration : invariants Task 86 conservés (qrFenetreExpiree, fenetreRenouvelee, reset-qr)",
          "qrFenetreExpiree: fenetreExpiree" in route_ts
          and "data: { totpSecret: secret, otpFenetreCreeA: new Date() }" in route_ts
          and "otpFenetreCreeA: row.lastLoginAt ? null : new Date()" in route_ts)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test88 embarqué (27 vérifications : statique + E2E label « Fiche de paie » sans le CIN)",
          "TASK 88" in t88 and "Fiche de paie" in t88
          and "decoupage_authenticator" in t88 and "SECTION A" in t88)
    check("harnais test88 embarqué (COPIE de base, port 4263, trap EXIT)",
          "test88.db" in t88sh and "4263" in t88sh and "trap" in t88sh and "COPIE" in t88sh)
    check("test78 embarqué réaligné (label décodé « Auto-RH:Fiche de paie » — MODIFIÉ Task 88)",
          '"/Auto-RH:Fiche de paie"' in t78
          and 'encodeURIComponent("Auto-RH:Fiche de paie")' in t78)
    check("test80 embarqué réaligné (label décodé « Auto-RH:Fiche de paie » — MODIFIÉ Task 88)",
          '"/Auto-RH:Fiche de paie"' in t80)
    check("test74 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t74)
    check("test87 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t87)
    check("README : section 53 (Account Name « Fiche de paie ») + sections 52/51 intactes",
          "## 53. Authenticator : l'« Account Name » affiche « Fiche de paie » au lieu du CIN" in readm
          and "## 52. Portail employés : après « Configuration réussie », retour à la fenêtre initiale de connexion" in readm
          and "## 51. Portail employés : le QR code d'inscription EXPIRE VRAIMENT après 10 minutes" in readm)

print("TASK88 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
