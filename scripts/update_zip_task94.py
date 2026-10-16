#!/usr/bin/env python3
"""Task 94 (20/09/2026) : politique de complexité — mots de passe ET code
d'activation à 8 caractères minimum (minuscule, majuscule, chiffre, symbole).

CHANGEMENTS (v0.2.24) :
  - src/lib/password-policy.ts : validerPolitiqueMotDePasse (8 car. min. +
    4 classes, messages précis par classe manquante) ;
  - src/lib/signup-code.ts : politiqueCodeInscription (même politique pour
    le code d'activation) ;
  - src/app/api/auth/signup/route.ts : mot de passe (fin du minimum à 6) ET
    code soumis à la politique — le code faible est refusé AVANT la
    comparaison, même s'il serait le bon ;
  - src/app/api/auth/change-password/route.ts : politique complète ;
  - src/app/api/users/[id]/password/route.ts : politique complète ;
  - src/app/api/portal-access/route.ts : le mot de passe initial généré
    garantit minuscule + majuscule + chiffre (tirets = symboles) ;
  - scripts/portail-server.js : politique IDENTIQUE (serveur + client +
    textes /premiere et /changer — tirets/espaces ignorés = pas un symbole) ;
  - scripts/creer-superadmin.js : politique complète (4 classes listées) ;
  - scripts/gen-signup-code.js : refus des codes faibles à la création,
    codeFort conforme (SERVICE RH-xxxx-xxxx! : classes garanties), --verifier
    honnête (« le BON — MAIS le site le REFUSERA »), avertissement --assurer ;
  - src/app/signup/page.tsx, force-change-password.tsx, users-tab.tsx :
    textes et contrôles clients alignés ;
  - README §59, package.json 0.2.24.

Nouveau : scripts/test94_politique_complexite.py (83 vérifications : statique
+ CLI + E2E sur COPIE de base, .env de sable, ports isolés 4311/4312).
Compte : 306 (état Task 93) + 1 nouveau = 307 fichiers.
Hérite de la chaîne : 34 -> … -> 88 -> 89 -> 90 -> 91 -> 92 -> 93 -> 94.
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
    ("src/lib/password-policy.ts", "src/lib/password-policy.ts", False),
    ("src/lib/signup-code.ts", "src/lib/signup-code.ts", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("src/app/api/auth/change-password/route.ts", "src/app/api/auth/change-password/route.ts", False),
    ("src/app/api/users/[id]/password/route.ts", "src/app/api/users/[id]/password/route.ts", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/app/signup/page.tsx", "src/app/signup/page.tsx", False),
    ("src/components/payslip/force-change-password.tsx", "src/components/payslip/force-change-password.tsx", False),
    ("src/components/payslip/users-tab.tsx", "src/components/payslip/users-tab.tsx", False),
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("scripts/creer-superadmin.js", "scripts/creer-superadmin.js", False),
    ("scripts/gen-signup-code.js", "scripts/gen-signup-code.js", False),
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
    ("scripts/test94_politique_complexite.py", "scripts/test94_politique_complexite.py", False),
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


# 1) Chaîne cumulative jusqu'à la Task 93
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task93.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 94 : remplacements + ajout (sans doublons) + retrait Task 35
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
    pp = zz.read("src/lib/password-policy.ts").decode("utf-8")
    sc = zz.read("src/lib/signup-code.ts").decode("utf-8")
    su = zz.read("src/app/api/auth/signup/route.ts").decode("utf-8")
    cp = zz.read("src/app/api/auth/change-password/route.ts").decode("utf-8")
    up = zz.read("src/app/api/users/[id]/password/route.ts").decode("utf-8")
    pa = zz.read("src/app/api/portal-access/route.ts").decode("utf-8")
    po = zz.read("scripts/portail-server.js").decode("utf-8")
    cs = zz.read("scripts/creer-superadmin.js").decode("utf-8")
    gen = zz.read("scripts/gen-signup-code.js").decode("utf-8")
    sp = zz.read("src/app/signup/page.tsx").decode("utf-8")
    ut = zz.read("src/components/payslip/users-tab.tsx").decode("utf-8")
    pkg = zz.read("package.json").decode("utf-8")
    lock = zz.read("package-lock.json").decode("utf-8")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8")
    t89 = zz.read("scripts/test89_demarrage_sans_npx.py").decode("utf-8")
    t90 = zz.read("scripts/test90_redirection_apres_scan.py").decode("utf-8")
    t91 = zz.read("scripts/test91_code_hache_env.py").decode("utf-8")
    t92 = zz.read("scripts/test92_send_mail.py").decode("utf-8")
    t93 = zz.read("scripts/test93_code_activation_diag.py").decode("utf-8")
    t94 = zz.read("scripts/test94_politique_complexite.py").decode("utf-8")
    bat_brut = zz.read("SECURISER-INSCRIPTION-WINDOWS.bat")
    portail = po

    def ctrl(nom, cond, detail=""):
        global ok
        if not cond:
            ok = False
        print(("OK  " if cond else "ECHEC  ") + nom + ("" if cond else "  -> " + str(detail)[:200]))

    # --- Marqueurs Task 94 dans l'archive ---
    ctrl("password-policy : politique 8 car. + 4 classes (validerPolitiqueMotDePasse)",
         "LONGUEUR_MIN_MOT_DE_PASSE = 8" in pp and "export function validerPolitiqueMotDePasse" in pp
         and "/[^A-Za-z0-9]/.test(m)" in pp)
    ctrl("signup-code : politiqueCodeInscription (8 car. + 4 classes)",
         "export function politiqueCodeInscription" in sc and "LONGUEUR_MIN_CODE_INSCRIPTION = 8" in sc
         and "/[^A-Za-z0-9]/.test(c)" in sc)
    ctrl("route signup : politique du CODE AVANT la comparaison",
         su.find("politiqueCodeInscription(code)") != -1
         and su.find("politiqueCodeInscription(code)") < su.find("verifierCodeInscription(code)"))
    ctrl("route signup : plus AUCUN minimum à 6 (politique complète)",
         "length < 6" not in su and "6 caractères" not in su
         and "validerPolitiqueMotDePasse(password)" in su)
    ctrl("change-password : politique complète appliquée",
         "validerPolitiqueMotDePasse(newPassword)" in cp)
    ctrl("users/[id]/password : politique complète appliquée",
         "validerPolitiqueMotDePasse(password)" in up)
    ctrl("portal-access : générateur initial avec classes garanties (Task 94)",
         'chiffres = "23456789"' in pa and "pioche" not in pa
         and "for (let i = caracteres.length - 1; i > 0; i--)" in pa)
    ctrl("portail : erreurPolitiqueMotDePasse + politique EN PREMIER dans validerNouveauMotDePasse",
         "function erreurPolitiqueMotDePasse(m)" in po
         and po.find("erreurPolitiqueMotDePasse(nouveau)") < po.find("DIFFÉRENT du mot de passe actuel"))
    ctrl("portail : contrôle client /changer sur les 4 classes",
         "nw.length < 8 || !/[a-z]/.test(nw) || !/[A-Z]/.test(nw) || !/[0-9]/.test(nw) || !/[^A-Za-z0-9]/.test(nw)" in po)
    ctrl("portail : textes /premiere et /changer annoncent la règle complète",
         "avec <b>minuscule</b>" in po and po.count("<b>symbole</b>") >= 2)
    ctrl("creer-superadmin : politique complète (4 classes listées)",
         "une minuscule" in cs and "une majuscule" in cs and "un chiffre" in cs and "un symbole" in cs)
    ctrl("gen-signup-code : erreurPolitiqueCode + refus à la création",
         "function erreurPolitiqueCode(code)" in gen
         and "Règle complète : 8 caractères minimum" in gen)
    ctrl("gen-signup-code : codeFort conforme (SERVICE RH-…-…! + classes garanties)",
         'return "SERVICE RH-" + g1 + "-" + g2 + "!";' in gen
         and "pioche(MINUSCULES)" in gen and "pioche(MAJUSCULES)" in gen and "pioche(CHIFFRES)" in gen)
    ctrl("gen-signup-code : --verifier politique (le BON — MAIS le site le REFUSERA)",
         "MAIS le site le REFUSERA" in gen and "erreurPolitiqueCode(code)" in gen)
    ctrl("gen-signup-code : --assurer avertit si le code converti est faible",
         "erreurPolitiqueCode(clair)" in gen)
    ctrl("signup page : minLength 8 + règle du code affichée",
         sp.count("minLength={8}") >= 2 and "8 caractères minimum, avec minuscule," in sp)
    ctrl("users-tab : contrôle client 4 classes + placeholder",
         "!/[^A-Za-z0-9]/.test(mdp)" in ut and "8 car. min. : minuscule, majuscule, chiffre, symbole" in ut)

    # --- Version + README + suites embarquées ---
    ctrl("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    ctrl("package-lock.json : version 0.2.24", lock.count('"version": "0.2.24"') >= 2)
    ctrl("README : section 59 (politique de complexité) + 58/57/56 intactes",
         "## 59. Politique de complexité" in readm
         and "## 58. « Le code d'activation ne fonctionne ni avec l'initial, ni avec le nouveau »" in readm
         and "## 57. Service d'envoi d'e-mails « Send Mail »" in readm
         and "## 56. Les deux lignes sensibles du `.env`" in readm)
    ctrl("test94 embarqué (statique + CLI + E2E politique)",
         "Task 94" in t94 and "politique" in t94 and "sandbox-task94" in t94)
    ctrl("test89 embarqué : contrôle [VERSION] réaligné 0.2.24",
         '"[VERSION] package.json en 0.2.24"' in t89)
    ctrl("test90/91/92/93 embarqués : contrôles de version réalignés 0.2.24",
         'pkg.get("version") == "0.2.24"' in t90 and 'pkg.get("version") == "0.2.24"' in t91
         and 'pkg.get("version") == "0.2.24"' in t92 and 'pkg.get("version") == "0.2.24"' in t93)

    # --- Lanceurs / invariants historiques ---
    ctrl("SECURISER bat : ASCII pur + CRLF (invariant conservé)",
         all(b < 128 for b in bat_brut) and bat_brut.count(b"\r\n") >= 30)
    ctrl("DEMARRER-WINDOWS.bat : HORS archive (Task 35 conservée)",
         "DEMARRER-WINDOWS.bat" not in zz.namelist())
    ctrl("invariant Task 93 : --verifier + option 7 conservés",
         "--verifier" in gen and "7) TESTER un code" in gen)
    ctrl("invariant Task 92 : send-mail + mail-config + mailer conservés",
         zz.read("src/app/api/mail-config/route.ts").decode("utf-8").count("export async function") >= 2
         and 'action === "send-mail"' in pa)
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

print("TASK94 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
