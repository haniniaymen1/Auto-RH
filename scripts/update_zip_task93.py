#!/usr/bin/env python3
"""Task 93 (20/09/2026) : « Le code d'activation ne fonctionne ni avec
l'initial, ni avec le nouveau » — diagnostic complet.

CHANGEMENTS (v0.2.24) :
  - scripts/gen-signup-code.js : NOUVELLE action --verifier + option de menu
    7 « TESTER un code » — applique EXACTEMENT l'algorithme du site (scrypt,
    temps constant, insensible à la casse), affiche le chemin du .env testé,
    l'état SIGNUP_ENABLED, et POURQUOI le site refuse (redémarrage réel,
    blocage 10 minutes, désactivation) ;
  - SECURISER-INSCRIPTION-WINDOWS.bat : option 7 documentée (ASCII+CRLF) ;
  - src/app/api/auth/signup/route.ts : message 403 orienté diagnostic
    (ARRÊTEZ puis RELANCEZ + option « Tester un code ») ;
  - scripts/start-prod.js : détection d'un port DÉJÀ UTILISÉ (ancien serveur
    en mémoire) avec message d'aide + CLI Prisma LOCAL (plus AUCUN npx —
    cohérence Task 89) ;
  - scripts/auto-rh.js : le cas « tournent déjà » précise que RIEN
    n'a été relancé et donne le VRAI redémarrage (ARRETER puis DEMARRER) ;
  - README §58, package.json 0.2.24.

Nouveau : scripts/test93_code_activation_diag.py (43 vérifications : E2E
chaîne complète .env → chargement → API sur COPIE de base + contrôles
statiques), scripts/launcher_task93.js (réplique exacte du chargement .env
de start-prod.js).
Compte : 304 (état Task 92) + 2 nouveaux = 306 fichiers.
Hérite de la chaîne : 34 -> … -> 88 -> 89 -> 90 -> 91 -> 92 -> 93.
"""
import zipfile, shutil, os, subprocess, sys, hashlib, re

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
    ("SECURISER-INSCRIPTION-WINDOWS.bat", "SECURISER-INSCRIPTION-WINDOWS.bat", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("scripts/start-prod.js", "scripts/start-prod.js", False),
    ("scripts/auto-rh.js", "scripts/auto-rh.js", False),
    ("package.json", "package.json", False),
    ("package-lock.json", "package-lock.json", False),
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
    ("scripts/test92_send_mail.py", "scripts/test92_send_mail.py", False),
    ("scripts/test93_code_activation_diag.py", "scripts/test93_code_activation_diag.py", False),
    ("scripts/launcher_task93.js", "scripts/launcher_task93.js", False),
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


# 1) Chaîne cumulative jusqu'à la Task 92
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task92.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 93 : remplacements + ajouts (sans doublons) + retrait Task 35
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
    gen = zz.read("scripts/gen-signup-code.js").decode("utf-8")
    bat = zz.read("SECURISER-INSCRIPTION-WINDOWS.bat").decode("utf-8")
    bat_brut = zz.read("SECURISER-INSCRIPTION-WINDOWS.bat")
    route = zz.read("src/app/api/auth/signup/route.ts").decode("utf-8")
    startprod = zz.read("scripts/start-prod.js").decode("utf-8")
    service = zz.read("scripts/auto-rh.js").decode("utf-8")
    pkg = zz.read("package.json").decode("utf-8")
    lock = zz.read("package-lock.json").decode("utf-8")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8")
    t89 = zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8")
    t90 = zz.read("scripts/test90_redirection_apres_scan.py").decode("utf-8")
    t91 = zz.read("scripts/test91_code_hache_env.py").decode("utf-8")
    t92 = zz.read("scripts/test92_send_mail.py").decode("utf-8")
    t93 = zz.read("scripts/test93_code_activation_diag.py").decode("utf-8")
    l93 = zz.read("scripts/launcher_task93.js").decode("utf-8")
    portail = zz.read("scripts/portail-server.js").decode("utf-8")

    def ctrl(nom, cond, detail=""):
        global ok
        if not cond:
            ok = False
        print(("OK  " if cond else "ECHEC  ") + nom + ("" if cond else "  -> " + str(detail)[:200]))

    # --- Marqueurs Task 93 dans l'archive ---
    ctrl("gen-signup-code : action --verifier (verdicts BON / NE CORRESPOND PAS)",
         "--verifier" in gen and "CE CODE EST LE BON" in gen and "NE CORRESPOND PAS" in gen)
    ctrl("gen-signup-code : scrypt + temps constant + casse indifférente (même algo que le site)",
         "scryptSync" in gen and "timingSafeEqual" in gen and "canoniser" in gen)
    ctrl("gen-signup-code : menu option 7 « TESTER un code »",
         "7) TESTER un code" in gen and "Votre choix (1-7)" in gen)
    ctrl("gen-signup-code : diagnostic des 3 causes (redémarrage réel, 429, SIGNUP_ENABLED)",
         "ARRETER-SILENCIEUX-WINDOWS.vbs PUIS" in gen and "Trop de tentatives" in gen
         and "SIGNUP_ENABLED=false" in gen)
    ctrl("SECURISER bat : option 7 documentée + CRLF + ASCII pur",
         "TESTER un code" in bat and bat_brut.count(b"\r\n") >= 30 and all(b < 128 for b in bat_brut))
    ctrl("route signup : message 403 orienté diagnostic",
         "Tester un code" in route and "ARRÊTEZ puis RELANCEZ" in route
         and "relancer seulement le démarrage ne suffit pas" in route)
    ctrl("start-prod : plus AUCUN npx exécutable (commentaires exclus)",
         "npx" not in "\n".join(l for l in startprod.splitlines()
                                if not l.strip().startswith(("//", "*", "/*"))))
    ctrl("start-prod : CLI Prisma LOCAL + détection port occupé + message d'aide",
         "node_modules/prisma/build/index.js" in startprod or 'path.join(ROOT, "node_modules", "prisma"' in startprod
         and "DEJA UTILISE" in startprod and "ARRETEZ-LE D'ABORD" in startprod)
    ctrl("service : « déjà en cours » = RIEN relancé + vrai redémarrage",
         "RIEN n'a ete relance" in service and "ARRETER-SILENCIEUX-WINDOWS.vbs PUIS DEMARRER-SILENCIEUX-WINDOWS.vbs" in service
         and "SECURISER-INSCRIPTION-WINDOWS.bat, option 7" in service)
    ctrl("launcher_task93 : réplique du chargement .env de start-prod.js",
         "COPIE EXACTE" in l93 and "process.env[m[1]] === undefined" in l93)

    # --- Version + README + suites embarquées ---
    ctrl("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    ctrl("package-lock.json : version 0.2.24", lock.count('"version": "0.2.24"') >= 2)
    ctrl("README : section 58 (diagnostic code d'activation) + 57/56/55 intactes",
         "## 58. « Le code d'activation ne fonctionne ni avec l'initial, ni avec le nouveau »" in readm
         and "## 57. Service d'envoi d'e-mails « Send Mail »" in readm
         and "## 56. Les deux lignes sensibles du `.env`" in readm
         and "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm)
    ctrl("test93 embarqué (E2E chaîne complète + --verifier)",
         "Task 93" in t93 and "launcher_task93" in t93 and "SERVICE RH-8C5T-VGTL" in t93)
    ctrl("test89 embarqué : contrôle [VERSION] réaligné 0.2.24",
         '"[VERSION] package.json en 0.2.24"' in t89)
    ctrl("test90/91/92 embarqués : contrôles de version réalignés 0.2.24",
         'pkg.get("version") == "0.2.24"' in t90 and 'pkg.get("version") == "0.2.24"' in t91
         and 'pkg.get("version") == "0.2.24"' in t92)

    # --- Lanceurs / invariants historiques ---
    ctrl("DEMARRER-WINDOWS.bat : HORS archive (Task 35 conservée)",
         "DEMARRER-WINDOWS.bat" not in zz.namelist())
    ctrl("invariant Task 92 : send-mail + mail-config + mailer conservés",
         zz.read("src/app/api/mail-config/route.ts").decode("utf-8").count("export async function") >= 2
         and 'action === "send-mail"' in zz.read("src/app/api/portal-access/route.ts").decode("utf-8"))
    ctrl("invariant Task 91 : gen-signup-code.js haché (aucun SIGNUP_CODE= en clair écrit)",
         'ajouterCle(lignes, "SIGNUP_CODE"' not in gen)
    ctrl("invariant Task 90 : redirect /premiere-reussie (inscription terminée) conservé",
         'redirect: "/premiere-reussie",' in portail
         and 'if (dest === "/premiere-reussie") {' in portail)
    ctrl("invariant Task 88 : label « Auto-RH:Fiche de paie » conservé",
         'encodeURIComponent("Auto-RH:Fiche de paie")' in portail)
    ctrl("invariant Task 87 : retour fenêtre initiale (bouton + redirection /login + fermeture de session)",
         'href="/login" id="btn-connexion"' in portail
         and "clearSessionCookie(res);" in portail)
    ctrl("invariant Task 86 : fenêtre du secret + garde 410 + compte à rebours conservés",
         "otpFenetreCreeA" in portail and 'code: "OTP_EXPIRE"' in portail and 'id="qr-cd"' in portail)
    ctrl("invariant Task 85 : AUCUN code OTP affiché",
         'id="otp-affiche"' not in portail and "genererCodeOtp" not in portail)
    ctrl("invariant Task 83 : QR unique + « Configuration réussie »",
         "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail
         and ">Configuration réussie</h1>" in portail)

print("TASK93 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
