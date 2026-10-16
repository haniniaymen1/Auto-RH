#!/usr/bin/env python3
"""Task 90 (19/09/2026) : après le scan du QR code, retour à la fenêtre
initiale de connexion (CIN + mot de passe + OTP) — même quand la
confirmation termine l'inscription sur un défi NON « premiere » (QR expiré
puis re-scanné à la reconnexion) ; l'employé n'aboutit plus directement sur
« Vos fiches de paie ».

CHANGEMENTS (v0.2.24) :
  - /api/otp/verify : lorsque la confirmation termine l'INSCRIPTION
    (lastLoginAt null ET otpFenetreCreeA non null — secret de fenêtre non
    scellé), la réponse renvoie redirect=/premiere-reussie (page
    « Configuration réussie » qui referme la session — Task 87 — puis
    fenêtre initiale) au lieu de redirect=/ ;
  - la page /otp (otpHtml) suit la destination du serveur :
    /premiere-reussie (inscription terminée), /changer (Task 64), /
    (employé DÉJÀ INSCRIT — connexion normale INCHANGÉE).

Nouveaux : test90_redirection_apres_scan.py (39 vérifications) +
test90_harnais.sh (COPIE de base, portail TTL 3,5 s port 4264 + portail
TTL normal port 4265 — scénario EXACT de l'utilisateur : QR n°1 →
expiration → nouvelle inscription → QR n°2 → code → /premiere-reussie →
fenêtre initiale → reconnexion 3 champs → fiches ; puis inscrit → accès
direct).
Remplacés : scripts/portail-server.js, package.json (0.2.24), README (§55),
suites réalignées 64/66/67/69/74/75/76/78/80/81/82/83/84/85/86/87/88/89.
Compte : 294 (état Task 89) + 2 nouveaux = 296 fichiers.
Hérite de la chaîne : 34 -> … -> 87 -> 88 -> 89 -> 90.
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
    ("scripts/test86_expiration_qr.py", "scripts/test86_expiration_qr.py", False),
    ("scripts/test87_redirection_connexion_initiale.py", "scripts/test87_redirection_connexion_initiale.py", False),
    ("scripts/test88_nom_compte_authenticator.py", "scripts/test88_nom_compte_authenticator.py", False),
    ("scripts/test89_demarrage_sans_npx.py", "scripts/test89_demarrage_sans_npx.py", False),
    ("scripts/test90_redirection_apres_scan.py", "scripts/test90_redirection_apres_scan.py", False),
    ("scripts/test90_harnais.sh", "scripts/test90_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 89
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task89.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 90 : remplacements + ajouts (sans doublons)
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
        etat = "OK" if (bad is None and len(liste) == ATTENDU and not manquants and not doublons and md5(z) == empreinte) else "KO"
        if etat == "KO":
            ok = False
        print(f"{os.path.basename(z)} : {len(liste)} fichiers (attendu {ATTENDU}), intégrité "
              f"{'OK' if bad is None else 'KO'}, doublons {'NON' if not doublons else 'OUI'}, "
              f"manquants {manquants or 'NON'}, état {etat}")

with zipfile.ZipFile(SRC) as zz:
    portail = zz.read("scripts/portail-server.js").decode("utf-8")
    pkg = zz.read("package.json").decode("utf-8")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8")
    t75 = zz.read("scripts/test75_otp_premiere_connexion.py").decode("utf-8")
    t81 = zz.read("scripts/test81_reconnexion_apres_scan.py").decode("utf-8")
    t89 = zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8")
    t90 = zz.read("scripts/test90_redirection_apres_scan.py").decode("utf-8")
    t90sh = zz.read("scripts/test90_harnais.sh").decode("utf-8")

    # --- Marqueurs Task 90 dans le portail embarqué ---
    def ctrl(nom, cond, detail=""):
        global ok
        if not cond:
            ok = False
        print(("OK  " if cond else "ECHEC  ") + nom + ("" if cond else "  -> " + str(detail)[:200]))

    ctrl("portail : branche « inscription vient de se terminer » + redirect /premiere-reussie",
         "if (!acc.lastLoginAt && acc.otpFenetreCreeA) {" in portail
         and 'redirect: "/premiere-reussie",' in portail)
    ctrl("portail : session COMPLÈTE posée dans la branche (garde /premiere-reussie)",
         "createPortalSession(sess.cin, remember, false)," in portail)
    ctrl("portail : employé DÉJÀ INSCRIT → redirect / conservé (connexion normale)",
         'redirect: "/",\n    });\n  }\n\n  // ---- (SUPPRIMÉ Task 85) endpoint /api/otp/nouveau ----' in portail)
    ctrl("portail : commentaire (NOUVEAU Task 90) + en-tête documentés",
         "(NOUVEAU Task 90 — « Apres le scan du QR code, je veux etre redirige" in portail
         and "(NOUVEAU Task 90) APRÈS LE SCAN DU QR CODE, RETOUR À LA FENÊTRE" in portail)
    ctrl("portail (otpHtml) : destination /premiere-reussie suivie + ancienne ligne SUPPRIMÉE",
         'if (dest === "/premiere-reussie") {' in portail
         and 'location.replace(apiUrl(r.d && r.d.redirect === "/changer" ? "/changer" : "/"));' not in portail)
    ctrl("portail (otpHtml) : /changer et / conservés + message « configuration terminée »",
         'location.replace(apiUrl(dest === "/changer" ? "/changer" : "/"));' in portail
         and "Code confirmé — configuration terminée…" in portail)

    # --- Version + README + suites embarquées ---
    ctrl("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    ctrl("README : section 55 (après le scan du QR, retour à la fenêtre initiale) + 54/53/52 intactes",
         "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm
         and "## 54. Démarrage local bloqué" in readm
         and "## 53. Authenticator : l'« Account Name » affiche « Fiche de paie » au lieu du CIN" in readm
         and "## 52. Portail employés : après « Configuration réussie », retour à la fenêtre initiale de connexion" in readm)
    ctrl("test90 embarqué (39 vérifications : statique + scénario E2E utilisateur + inscrit)",
         "TASK90" in t90 and "LE SCÉNARIO DE L'UTILISATEUR" in t90
         and 'redirect") == "/premiere-reussie"' in t90)
    ctrl("harnais test90 embarqué (COPIE de base, portails 4264 TTL court + 4265)",
         "test90.db" in t90sh and "PORTAL_OTP_TTL_MS=3500" in t90sh
         and "test90_redirection_apres_scan.py" in t90sh)
    ctrl("test74 embarqué réaligné (redirect /premiere-reussie + version 0.2.24)",
         'd2.get("redirect") == "/premiere-reussie"' in t74
         and 'pkg.get("version") == "0.2.24"' in t74)
    ctrl("test75 embarqué réaligné (redirect /premiere-reussie ×2)",
         t75.count('redirect") == "/premiere-reussie"') >= 2, t75.count("/premiere-reussie"))
    ctrl("test81 embarqué réaligné (B5 redirect /premiere-reussie, B9 / conservé)",
         'j3.get("redirect") == "/premiere-reussie"' in t81
         and 'j7.get("redirect") == "/"' in t81)
    ctrl("test89 embarqué : contrôle [VERSION] réaligné 0.2.24",
         'check("[VERSION] package.json en 0.2.24"' in t89)

    # --- Invariants des Tasks antérieures (88/87/86/85/83) ---
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

print("TASK90 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
