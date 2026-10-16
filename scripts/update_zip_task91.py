#!/usr/bin/env python3
"""Task 91 (19/09/2026) : « Je veux que ces deux lignes soient hachées » —
le code d'inscription n'est plus JAMAIS stocké en clair dans .env.

CHANGEMENTS (v0.2.24) :
  - scripts/gen-signup-code.js : --assurer (lancé par les scripts de
    démarrage) CONVERTIT automatiquement tout ancien SIGNUP_CODE=... en
    clair vers SIGNUP_CODE_HASH=scrypt:... (le code NE CHANGE PAS), et pour
    une installation vierge génère un code fort ALÉATOIRE écrit UNIQUEMENT
    en hash et AFFICHÉ UNE SEULE FOIS ; plus aucun chemin d'écriture en
    clair dans l'outil ;
  - DEMARRER-WINDOWS.bat : plus aucune invitation à lire le code dans .env,
    commentaires à jour (CRLF préservés) ;
  - DEMARRER-LINUX-MAC.sh : SUPPRESSION de l'écriture
    « SIGNUP_CODE=PAIESAGE-2026 » (défaut connu de tous) remplacée par
    l'appel gen-signup-code.js --assurer ;
  - README : §56 (deux lignes hachées — SIGNUP_CODE haché par défaut ;
    AUTH_SECRET : clé racine non hachable, explication + protections) ;
  - package.json : 0.2.24.

Nouveau : scripts/test91_code_hache_env.py (37 vérifications : conversion
automatique sur le .env EXACT de l'utilisateur, génération hash-only,
idempotence, SIGNUP_ENABLED intouché, statut, statique Windows/Linux).
Remplacés : gen-signup-code.js, DEMARRER-LINUX-MAC.sh, .env.example (plus
aucun code en clair en exemple), package.json,
README (§56), suites réalignées 74/75/76/78/80/81/82/83/84/85/86/87/88/89/90
(version 0.2.24).
Nota (Task 35 conservée) : DEMARRER-WINDOWS.bat reste HORS archive (kit
silencieux VBS seul) — modifié dans le dépôt pour cohérence ; tout résidu
est retiré de l'archive par le RETRAIT ci-dessous.
Compte : 296 (état Task 90) + 1 nouveau = 297 fichiers.
Hérite de la chaîne : 34 -> … -> 88 -> 89 -> 90 -> 91.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)

# Task 35 : les lanceurs Windows visibles ne sont PAS dans l'archive.
RETRAIT = [
    "DEMARRER-WINDOWS.bat",
]

FILES = [
    ("scripts/gen-signup-code.js", "scripts/gen-signup-code.js", False),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    (".env.example", ".env.example", False),
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
    ("scripts/test89_demarrage_sans_npx.py", "scripts/test89_demarrage_sans_npx.py", False),
    ("scripts/test90_redirection_apres_scan.py", "scripts/test90_redirection_apres_scan.py", False),
    ("scripts/test91_code_hache_env.py", "scripts/test91_code_hache_env.py", False),
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


# 1) Chaîne cumulative jusqu'à la Task 90
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task90.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 91 : remplacements + ajout (sans doublons) + retrait Task 35
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES} | set(RETRAIT)
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
    outil = zz.read("scripts/gen-signup-code.js").decode("utf-8")
    sh = zz.read("DEMARRER-LINUX-MAC.sh").decode("utf-8")
    pkg = zz.read("package.json").decode("utf-8")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8")
    t89 = zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8")
    t90 = zz.read("scripts/test90_redirection_apres_scan.py").decode("utf-8")
    t91 = zz.read("scripts/test91_code_hache_env.py").decode("utf-8")
    portail = zz.read("scripts/portail-server.js").decode("utf-8")

    # --- Marqueurs Task 91 dans l'outil de sécurisation ---
    def ctrl(nom, cond, detail=""):
        global ok
        if not cond:
            ok = False
        print(("OK  " if cond else "ECHEC  ") + nom + ("" if cond else "  -> " + str(detail)[:200]))

    ctrl("outil : conversion automatique « SÉCURISATION AUTOMATIQUE » + code NE CHANGE PAS",
         "SÉCURISATION AUTOMATIQUE" in outil and "NE CHANGE PAS" in outil)
    ctrl("outil : génération hash-only (« stocké UNIQUEMENT en HASH »)",
         "UNIQUEMENT en HASH" in outil and "ajouterCle(lignes, \"SIGNUP_CODE_HASH\"" in outil)
    ctrl("outil : PLUS AUCUN chemin d'écriture en clair (ajouterCle ... \"SIGNUP_CODE\" supprimé)",
         'ajouterCle(lignes, "SIGNUP_CODE"' not in outil)
    ctrl("outil : marqueur (MODIFIÉ Task 91) documenté",
         "(MODIFIÉ Task 91" in outil and "hachées" in outil)

    # --- Scripts de démarrage ---
    ctrl("DEMARRER-WINDOWS.bat : HORS archive (Task 35 conservée)",
         "DEMARRER-WINDOWS.bat" not in zz.namelist())
    ctrl("DEMARRER-LINUX-MAC.sh : plus de SIGNUP_CODE=PAIESAGE-2026 + appel --assurer",
         "SIGNUP_CODE=PAIESAGE-2026" not in sh and "gen-signup-code.js --assurer" in sh)
    exemple = zz.read(".env.example").decode("utf-8")
    ctrl(".env.example : plus AUCUN code en clair en exemple + repère Task 91",
         "SIGNUP_CODE=PAIESAGE-2026" not in exemple
         and not any(l.startswith("SIGNUP_CODE=") for l in exemple.splitlines())
         and "Task 91" in exemple)

    # --- Version + README + suites embarquées ---
    ctrl("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    ctrl("README : section 56 (deux lignes hachées + AUTH_SECRET expliquée) + 55/54/53 intactes",
         "## 56. Les deux lignes sensibles du `.env`" in readm
         and "clé racine symétrique" in readm
         and "NE PEUT PAS être hachée" in readm
         and "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm
         and "## 54. Démarrage local bloqué" in readm
         and "## 53. Authenticator : l'« Account Name » affiche « Fiche de paie » au lieu du CIN" in readm)
    ctrl("test91 embarqué (37 vérifications : conversion cas EXACT de l'utilisateur + hash-only + statique)",
         "Task 91" in t91 and "SERVICE RH-8C5T-VGTL" in t91
         and "SÉCURISATION AUTOMATIQUE" in t91 and "HASH_VALIDE" in t91)
    ctrl("test89 embarqué : contrôle [VERSION] réaligné 0.2.24",
         'check("[VERSION] package.json en 0.2.24"' in t89)
    ctrl("test90 embarqué : contrôles de version réalignés 0.2.24",
         'pkg.get("version") == "0.2.24"' in t90
         and 'check("S01 version du produit = 0.2.24 (NOUVEAU Task 94)"' in t90)

    # --- Invariants des Tasks antérieures (90/88/87/86/85/83) ---
    ctrl("invariant Task 90 : redirect /premiere-reussie (inscription terminée) conservé",
         'redirect: "/premiere-reussie",' in portail
         and 'if (dest === "/premiere-reussie") {' in portail)
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

print("TASK91 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
