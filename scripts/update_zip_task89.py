#!/usr/bin/env python3
"""Task 89 (19/09/2026) : démarrage local SANS npx — plus aucun prompt bloquant
(signalement : « it stuck in this step » — capture : « Need to install the
following packages: prisma@8.0.0-rc.15 — Ok to proceed? (y) » à l'étape
[3/6] « Dependances deja installees » du démarrage silencieux).

AVANT (v0.2.18) : un node_modules INCOMPLET (CLI Prisma absent) faisait
appeler « npx prisma » : npx PROPOSAIT de télécharger la DERNIÈRE version
publiée (prisma@8.0.0-rc.15, incompatible avec la 6.x figée par
package.json) via un prompt INTERACTIF — blocage définitif en mode
silencieux (fenêtre cachée, personne pour répondre).

CHANGEMENTS (v0.2.24) — les 7 scripts de démarrage (4 Windows + 3 Linux/Mac) :
  1. vérif ROBUSTE des dépendances : node_modules + CLI Prisma local
     (node_modules/prisma/build/index.js) + Next local
     (node_modules/next/dist/bin/next) -> npm install relancé s'il manque ;
  2. CLI LOCAL appelé directement via « node <chemin> » : plus AUCUN npx
     exécutable — aucun téléchargement hors de contrôle, AUCUN prompt ;
  3. garde-fou : échec PROPRE avec message clair si le CLI manque encore.
Nota : les 3 .bat visibles Windows (DEMARRER-WINDOWS.bat,
DEMARRER-PORTAIL-WINDOWS.bat, DEMARRER-TOUT-WINDOWS.bat) sont corrigés dans
le dépôt mais ne font pas partie du kit ZIP (même traitement que Task 38).

Nouveaux : test89_demarrage_sans_npx.py (53 vérif.) + test89_harnais.sh
(COPIE de base, E2E des commandes locales exactes).
Remplacés : PREPARER-AUTO-RH-SILENCIEUX.bat, 3 lanceurs .sh, package.json
(0.2.24), README (§54), suites réalignées 74/75/76/78/80/81/82/83/84/85/86/
87/88 (version 0.2.24).
Compte : 292 (état Task 88) + 2 nouveaux = 294 fichiers.
Hérite de la chaîne : 34 -> … -> 86 -> 87 -> 88 -> 89.
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
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    ("DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", False),
    ("DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh", False),
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
    ("scripts/test89_harnais.sh", "scripts/test89_harnais.sh", False),
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


def ligne_npx_executable(texte, prefixe_commentaire):
    for numero, ligne in enumerate(texte.splitlines(), 1):
        epure = ligne.strip()
        if epure.startswith(prefixe_commentaire):
            continue
        if epure.startswith("npx ") or epure.startswith("npx\t") or (epure.startswith("call ") and epure[5:].lstrip().startswith("npx")):
            return (numero, ligne)
    return None


# 1) Chaîne cumulative jusqu'à la Task 88
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task88.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 89 : remplacements + ajouts (sans doublons)
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
    prep = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat")
    prep_txt = prep.decode("utf-8", errors="replace")
    sh1 = zz.read("DEMARRER-LINUX-MAC.sh").decode("utf-8", errors="replace")
    sh2 = zz.read("DEMARRER-PORTAIL-LINUX-MAC.sh").decode("utf-8", errors="replace")
    sh3 = zz.read("DEMARRER-TOUT-LINUX-MAC.sh").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    t89 = zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8", errors="replace")
    t89sh = zz.read("scripts/test89_harnais.sh").decode("utf-8", errors="replace")
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    route_ts = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    vbs = zz.read("DEMARRER-SILENCIEUX-WINDOWS.vbs")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Cœur Task 89 : PREPARER sans npx exécutable, CLI LOCAL via node ---
    check("PREPARER : AUCUNE ligne exécutable npx (commentaires exclus)",
          ligne_npx_executable(prep_txt, "REM") is None,
          ligne_npx_executable(prep_txt, "REM"))
    check("PREPARER : CLI Prisma LOCAL appelé via node",
          'node "node_modules\\prisma\\build\\index.js"' in prep_txt)
    check("PREPARER : build Next LOCAL via node",
          'node "node_modules\\next\\dist\\bin\\next" build' in prep_txt)
    check("PREPARER : déclencheur robuste (CLI Prisma + Next locaux vérifiés)",
          'if not exist "node_modules\\prisma\\build\\index.js" set "BESOIN_INSTALL=1"' in prep_txt
          and 'if not exist "node_modules\\next\\dist\\bin\\next" set "BESOIN_INSTALL=1"' in prep_txt)
    check("PREPARER : garde-fou échec PROPRE (jamais de prompt)",
          "CLI Prisma local est introuvable" in prep_txt)
    check("PREPARER : CRLF + ASCII (invariant Task 38/40 conservé)",
          b"\r\n" in prep and prep.replace(b"\r\n", b"").isascii())
    check("PREPARER : invariant Task 40 (securiser-auto.js appelé)",
          b"securiser-auto.js" in prep)
    check("PREPARER : invariant Task 31 (gen-signup-code --assurer)",
          "gen-signup-code.js --assurer" in prep_txt)
    check("PREPARER : traçabilité MODIFIE Task 89", "MODIFIE Task 89" in prep_txt)

    # --- Les 3 lanceurs .sh : même correctif ---
    for nom, txt in [("DEMARRER-LINUX-MAC.sh", sh1),
                     ("DEMARRER-PORTAIL-LINUX-MAC.sh", sh2),
                     ("DEMARRER-TOUT-LINUX-MAC.sh", sh3)]:
        check(f"{nom} : AUCUNE ligne exécutable npx (commentaires exclus)",
              ligne_npx_executable(txt, "#") is None,
              ligne_npx_executable(txt, "#"))
        check(f"{nom} : CLI Prisma LOCAL via node + déclencheur robuste + garde-fou",
              "node node_modules/prisma/build/index.js" in txt
              and '[ ! -f "node_modules/prisma/build/index.js" ]' in txt
              and "CLI Prisma local est introuvable" in txt)
        check(f"{nom} : invariant Task 40 (securiser-auto.js)", "securiser-auto.js" in txt)

    check("DEMARRER-LINUX-MAC.sh : build Next LOCAL via node",
          "node node_modules/next/dist/bin/next build" in sh1)

    # --- Version + README + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 54 (démarrage bloqué npx/prisma@8.0.0-rc.15) + 53/52/51 intactes",
          "## 54. Démarrage local bloqué" in readm
          and "prisma@8.0.0-rc.15" in readm
          and "## 53. Authenticator : l'« Account Name » affiche « Fiche de paie » au lieu du CIN" in readm
          and "## 52. Portail employés : après « Configuration réussie », retour à la fenêtre initiale de connexion" in readm
          and "## 51. Portail employés : le QR code d'inscription EXPIRE VRAIMENT après 10 minutes" in readm)
    check("test89 embarqué (53 vérifications : statique 7 scripts + E2E CLI local)",
          "TASK89" in t89 and "SANS npx" in t89 and "ligne_npx_executable" in t89)
    check("harnais test89 embarqué (COPIE de base, E2E db push/generate)",
          "test89.db" in t89sh and "COPIE" in t89sh and "test89_demarrage_sans_npx.py" in t89sh)
    check("test74 embarqué réaligné (version 0.2.24)",
          'pkg.get("version") == "0.2.24"' in t74)
    check("lanceur VBS inchangé (Task 42/64 conservés)",
          b"PREPARER-AUTO-RH-SILENCIEUX.bat" in vbs and b"localhost:4000" in vbs)

    # --- Invariants des Tasks antérieures (85/83/86/87/88) ---
    check("invariant Task 88 : label « Auto-RH:Fiche de paie » portail + administration",
          'encodeURIComponent("Auto-RH:Fiche de paie")' in portail
          and 'encodeURIComponent("Auto-RH:Fiche de paie")' in route_ts
          and 'Auto-RH:" + defi.cin' not in portail)
    check("invariant Task 86 : fenêtre du secret + garde 410 + compte à rebours conservés",
          "otpFenetreCreeA" in portail and 'code: "OTP_EXPIRE"' in portail and 'id="qr-cd"' in portail)
    check("invariant Task 85 : AUCUN code OTP affiché",
          'id="otp-affiche"' not in portail and "genererCodeOtp" not in portail)
    check("invariant Task 83 : QR unique + « Configuration réussie »",
          "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail
          and ">Configuration réussie</h1>" in portail)
    check("invariant Task 87 : retour fenêtre initiale (bouton + redirection /login)",
          'href="/login" id="btn-connexion"' in portail
          and "Accéder au portail" not in portail)

print("TASK89 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
