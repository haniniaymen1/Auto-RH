#!/usr/bin/env python3
"""Task 94 — « Les mots de passe et le code d'activation doivent être minimum
8 caractères (alphabet minuscule, majuscule, chiffre et symbole) ».

La politique de complexité est appliquée PARTOUT, avec le même message :
  - 8 caractères MINIMUM ;
  - au moins une MINUSCULE (a-z) ;
  - au moins une MAJUSCULE (A-Z) ;
  - au moins un CHIFFRE (0-9) ;
  - au moins un SYMBOLE (caractère non alphanumérique : ! ? - _ % @…).

Phases E2E (bac à sable : copie de db/custom.db, port 4311, .env de sable) :
  A. Mots de passe FAIBLES refusés à l'inscription admin (400) avec le
     message PRÉCIS de la classe manquante (5 variantes) ; code fort + mot
     de passe fort -> 201.
  B. Code d'activation FAIBLE refusé à la saisie (403 politique, AVANT la
     comparaison) même s'il serait le bon ; code fort faux -> 403
     « incorrect » ; code fort bon -> 201.
  C. Changement de mot de passe admin (/api/auth/change-password) :
     faible -> 400 avec message précis.
  D. Réinitialisation superadmin (/api/users/[id]/password) : faible -> 400.
  E. Portail : mot de passe INITIAL généré conforme (classes garanties) ;
     /api/premiere : nouveau mot de passe faible -> 400, fort -> 200.

Contrôles statiques :
  F. policy partagée (password-policy.ts) + 3 routes admin + signup-code.ts ;
  G. générateur initial portail + portail-server.js (serveur + client + textes) ;
  H. gen-signup-code.js : politique à la création, codeFort conforme,
     --verifier honnête, avertissement --assurer ;
  I. interfaces (signup page, force-change-password, users-tab) ;
  J. creer-superadmin.js, README §59, version 0.2.24, .bat ASCII+CRLF.
"""
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error

RACINE = "/home/z/my-project"
PORT = 4311
BASE = f"http://127.0.0.1:{PORT}"
SANDBOX = os.path.join(RACINE, "sandbox-task94")
DB_SABLE = os.path.join(SANDBOX, "test94.db")
ENV_SABLE = os.path.join(SANDBOX, ".env94")
CODE_FORT = "CodeFort94!"
CODE_FAIBLE = "SERVICE RH-8C5T-VGTL"  # sans minuscule : politique NON respectée
MDP_FORT = "MotDePasse94!"
OK = []
KO = []


def check(nom, cond, detail=""):
    if cond:
        OK.append(nom)
        print(f"  [OK]   {nom}")
    else:
        KO.append(nom)
        print(f"  [FAIL] {nom} {detail}")


def lire(chemin, racine=None):
    with open(os.path.join(racine or RACINE, chemin), "r", encoding="utf-8") as f:
        return f.read()


def requete(chemin, payload=None, methode="POST", cookie=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(BASE + chemin, data=data, method=methode,
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            entete = r.headers.get("Set-Cookie", "")
            return r.status, json.loads(r.read().decode() or "{}"), entete
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}"), ""
        except Exception:
            return e.code, {}, ""


def attendre_serveur(timeout_s=150):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE + "/login", timeout=3) as r:
                if r.status < 500:
                    return True
        except urllib.error.HTTPError as e:
            if e.code < 500:
                return True
        except Exception:
            pass
        time.sleep(0.7)
    return False


def demarrer():
    env = dict(os.environ)
    env.update({
        "PORT": str(PORT),
        "HOSTNAME": "127.0.0.1",
        "AUTO_RH_ROOT": RACINE,
        "AUTO_RH_STORAGE_DIR": os.path.join(RACINE, "storage", "payslips"),
        "DOTENV_PATH": ENV_SABLE,
    })
    for cle in list(env.keys()):
        if cle.startswith("SIGNUP_") or cle.startswith("DATABASE_URL"):
            env.pop(cle)
    journal = os.path.join(SANDBOX, "serveur.log")
    proc = subprocess.Popen(
        ["node", os.path.join(RACINE, "scripts", "launcher_task93.js")],
        cwd=RACINE, env=env,
        stdout=open(journal, "ab"), stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    if not attendre_serveur():
        raise RuntimeError("serveur de sable non prêt (voir sandbox-task94/serveur.log)")
    return proc


def arreter(proc):
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        pass
    deadline = time.time() + 12
    while time.time() < deadline:
        if proc.poll() is not None:
            time.sleep(1)
            return
        time.sleep(0.4)
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        pass
    time.sleep(1)


def gen_signup(*args):
    env = dict(os.environ)
    env["AUTO_RH_DOTENV"] = ENV_SABLE
    return subprocess.run(
        ["node", os.path.join(RACINE, "scripts", "gen-signup-code.js"), *args],
        cwd=RACINE, env=env, capture_output=True, text=True,
    )


def ligne_de(texte, cle):
    for l in texte.splitlines():
        if re.match(rf"^\s*{cle}=", l):
            return l.strip()
    return None


def conforme_classes(m):
    """Les 4 classes sont-elles présentes ? (minuscule, majuscule, chiffre, symbole)"""
    return (
        len(m) >= 8
        and re.search(r"[a-z]", m) is not None
        and re.search(r"[A-Z]", m) is not None
        and re.search(r"[0-9]", m) is not None
        and re.search(r"[^A-Za-z0-9]", m) is not None
    )


VARIANTES_FAIBLES = [
    # (mot de passe, fragment attendu du message)
    ("Ab1!x", "au moins 8 caractères"),
    ("azertyui1!", "LETTRE MAJUSCULE"),
    ("AZERTYUI1!", "LETTRE MINUSCULE"),
    ("Azertyuiop!", "CHIFFRE"),
    ("Azertyui1", "SYMBOLE"),
]

# ------------------------------------------------------------------
print("=== Préparation du bac à sable (sandbox-task94) ===")
if os.path.exists(SANDBOX):
    shutil.rmtree(SANDBOX)
os.makedirs(SANDBOX)
shutil.copyfile(os.path.join(RACINE, "db", "custom.db"), DB_SABLE)
# Code d'activation FORT configuré directement en hash (le même mécanisme que
# SECURISER-INSCRIPTION) : la phase A teste les mots de passe, la phase B le code.
r_hash = gen_signup("--hash", CODE_FORT)
hash_code_fort = r_hash.stdout.strip().splitlines()[-1].strip()
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
    f.write(f"SIGNUP_CODE_HASH={hash_code_fort}\n")
print(f"  .env de sable : {ENV_SABLE}")
print(f"  base de sable : {DB_SABLE}")

# ------------------------------------------------------------------
print("")
print("=== Phase F : politique partagée (src/lib) + routes d'administration ===")
pp = lire("src/lib/password-policy.ts")
check("password-policy.ts : LONGUEUR_MIN_MOT_DE_PASSE = 8",
      "LONGUEUR_MIN_MOT_DE_PASSE = 8" in pp)
check("password-policy.ts : REGLE_MOT_DE_PASSE (minuscule, majuscule, chiffre, symbole)",
      "REGLE_MOT_DE_PASSE" in pp and "minuscule" in pp and "majuscule" in pp
      and "chiffre" in pp and "symbole" in pp)
for classe, regex in [("minuscule", "[a-z]"), ("majuscule", "[A-Z]"),
                      ("chiffre", "[0-9]"), ("symbole", "[^A-Za-z0-9]")]:
    check(f"password-policy.ts : la politique vérifie la classe {classe}",
          f"/{regex}/.test(m)" in pp)
check("password-policy.ts : validerPolitiqueMotDePasse renvoie null si conforme",
      "export function validerPolitiqueMotDePasse" in pp and "return null;" in pp)

sc = lire("src/lib/signup-code.ts")
check("signup-code.ts : LONGUEUR_MIN_CODE_INSCRIPTION = 8",
      "LONGUEUR_MIN_CODE_INSCRIPTION = 8" in sc)
check("signup-code.ts : politiqueCodeInscription exportée",
      "export function politiqueCodeInscription" in sc)
for classe, regex in [("minuscule", "[a-z]"), ("majuscule", "[A-Z]"),
                      ("chiffre", "[0-9]"), ("symbole", "[^A-Za-z0-9]")]:
    check(f"signup-code.ts : la politique du CODE vérifie la classe {classe}",
          f"/{regex}/.test(c)" in sc)
check("signup-code.ts : message de la politique du code oriente SECURISER-INSCRIPTION",
      "SECURISER-INSCRIPTION-WINDOWS.bat (option 2 ou 3)" in sc)

su = lire("src/app/api/auth/signup/route.ts")
check("signup : importe validerPolitiqueMotDePasse (Task 94)",
      "validerPolitiqueMotDePasse" in su)
check("signup : importe politiqueCodeInscription (Task 94)",
      "politiqueCodeInscription" in su)
check("signup : la politique du CODE est vérifiée AVANT la comparaison",
      su.find("politiqueCodeInscription(code)") < su.find("verifierCodeInscription(code)")
      and su.find("politiqueCodeInscription(code)") != -1)
check("signup : plus aucun minimum à 6 (remplacé par la politique)",
      "length < 6" not in su and "6 caractères" not in su)

cp = lire("src/app/api/auth/change-password/route.ts")
check("change-password : applique validerPolitiqueMotDePasse",
      "validerPolitiqueMotDePasse(newPassword)" in cp)
check("change-password : garde la règle « DIFFÉRENT du mot de passe actuel »",
      "DIFFÉRENT du mot de passe actuel" in cp)

up = lire("src/app/api/users/[id]/password/route.ts")
check("users/[id]/password : applique validerPolitiqueMotDePasse",
      "validerPolitiqueMotDePasse(password)" in up)

# ------------------------------------------------------------------
print("")
print("=== Phase G : générateur initial + portail (serveur, client, textes) ===")
pa = lire("src/app/api/portal-access/route.ts")
check("portal-access : le générateur initial garantit minuscule + majuscule + chiffre",
      'majuscules = "ABCDEFGHJKMNPQRSTUVWXYZ"' in pa
      and 'minuscules = "abcdefghjkmnpqrstuvwxyz"' in pa
      and 'chiffres = "23456789"' in pa)
check("portal-access : mélange Fisher-Yates (classes garanties même mélangées)",
      "for (let i = caracteres.length - 1; i > 0; i--)" in pa)
check("portal-access : commenté Task 94 (mot de passe initial conforme)",
      "MODIFIÉ Task 94" in pa)

po = lire("scripts/portail-server.js")
check("portail : erreurPolitiqueMotDePasse définie (miroir password-policy.ts)",
      "function erreurPolitiqueMotDePasse(m)" in po)
check("portail : la politique est appliquée EN PREMIER dans validerNouveauMotDePasse",
      po.find("erreurPolitiqueMotDePasse(nouveau)") != -1
      and po.find("erreurPolitiqueMotDePasse(nouveau)") < po.find("DIFFÉRENT du mot de passe actuel"))
check("portail : politique vérifie les 4 classes",
      all(f"/{r}/.test(m)" in po for r in ["[a-z]", "[A-Z]", "[0-9]", "[^A-Za-z0-9]"]))
check("portail : contrôle CLIENT /changer aligné (4 classes)",
      "nw.length < 8 || !/[a-z]/.test(nw) || !/[A-Z]/.test(nw) || !/[0-9]/.test(nw) || !/[^A-Za-z0-9]/.test(nw)" in po)
check("portail : texte /changer annonce la règle complète",
      "<b>minuscule</b>" in po and "<b>majuscule</b>" in po
      and "<b>chiffre</b>" in po and "<b>symbole</b>" in po)
check("portail : écran /premiere annonce la règle complète",
      "avec <b>minuscule</b>" in po)
check("portail : prévient que tirets/espaces ne comptent pas comme symbole",
      "tirets et espaces sont ignorés" in po)

# ------------------------------------------------------------------
print("")
print("=== Phase H : gen-signup-code.js (création, génération, diagnostic) ===")
gs = lire("scripts/gen-signup-code.js")
check("gen-signup-code : erreurPolitiqueCode (miroir de la politique du site)",
      "function erreurPolitiqueCode(code)" in gs
      and all(f"/{r}/.test(c)" in gs for r in ["[a-z]", "[A-Z]", "[0-9]", "[^A-Za-z0-9]"]))
check("gen-signup-code : le code généré porte les SYMBOLES (tirets + « ! »)",
      'return "SERVICE RH-" + g1 + "-" + g2 + "!";' in gs)
check("gen-signup-code : le code généré garantit les classes (pioche par classe)",
      "pioche(MINUSCULES)" in gs and "pioche(MAJUSCULES)" in gs and "pioche(CHIFFRES)" in gs)
check("gen-signup-code : option 3 du menu annonce la règle",
      "8 car. min. avec minuscule, majuscule, chiffre et symbole" in gs)
check("gen-signup-code : --assurer AVERTIT si le code converti est faible",
      "erreurPolitiqueCode(clair)" in gs)
check("gen-signup-code : --verifier reproduit la politique AVANT la comparaison",
      gs.find("erreurPolitiqueCode(code)") < gs.find("hashCorrespond(canon, hash)")
      and gs.find("erreurPolitiqueCode(code)") != -1)
check("gen-signup-code : --verifier dit « le BON — MAIS le site le REFUSERA »",
      "MAIS le site le REFUSERA" in gs)

# ------------------------------------------------------------------
print("")
print("=== Phase I : interfaces (signup, force-change, users-tab) ===")
sp = lire("src/app/signup/page.tsx")
check("signup page : placeholder mot de passe à 8 caractères + classes",
      "8 caractères min. — minuscule, majuscule, chiffre, symbole" in sp)
check("signup page : minLength=8 (mot de passe et confirmation)",
      sp.count("minLength={8}") >= 2)
check("signup page : la règle du CODE est affichée",
      "8 caractères minimum, avec minuscule," in sp)

fc = lire("src/components/payslip/force-change-password.tsx")
check("force-change-password : aide mise à jour (classes + exemples)",
      "minuscule, majuscule, chiffre et" in fc and "symbole" in fc)

ut = lire("src/components/payslip/users-tab.tsx")
check("users-tab : contrôle client sur les 4 classes",
      "!/[^A-Za-z0-9]/.test(mdp)" in ut)
check("users-tab : message client complet",
      "8 caractères minimum, avec minuscule, majuscule, chiffre et symbole" in ut)
check("users-tab : placeholder mis à jour",
      "8 car. min. : minuscule, majuscule, chiffre, symbole" in ut)

# ------------------------------------------------------------------
print("")
print("=== Phase J : creer-superadmin, README, version, .bat ===")
cs = lire("scripts/creer-superadmin.js")
check("creer-superadmin : politique complète (4 classes listées)",
      "une minuscule" in cs and "une majuscule" in cs and "un chiffre" in cs
      and "un symbole" in cs)
check("creer-superadmin : vérifie la longueur 8",
      "mdp.length < 8" in cs)

rdm = lire("README-DEPLOIEMENT-LOCAL.md")
check("README : section 59 politique de complexité présente",
      "## 59. Politique de complexité" in rdm)
check("README §59 : mentionne mot de passe initial conforme ET code d'activation",
      "mot de passe initial" in rdm and "code d'activation" in rdm)

pkg = json.loads(lire("package.json"))
check("version : package.json 0.2.24", pkg.get("version") == "0.2.24",
      f"({pkg.get('version')})")

bat = open(os.path.join(RACINE, "SECURISER-INSCRIPTION-WINDOWS.bat"), "rb").read()
check("SECURISER-INSCRIPTION-WINDOWS.bat : CRLF préservés", b"\r\n" in bat)
try:
    bat.decode("ascii")
    check("SECURISER-INSCRIPTION-WINDOWS.bat : ASCII pur", True)
except UnicodeDecodeError:
    check("SECURISER-INSCRIPTION-WINDOWS.bat : ASCII pur", False)

print(f"\n  --- Statique : {len(OK)} OK / {len(KO)} FAIL pour l'instant ---")

# ------------------------------------------------------------------
print("")
print("=== Phase H-E2E : gen-signup-code.js — refus des codes faibles à la création ===")
for code_faible, fragment in [
    ("court1!", "au moins 8 caractères"),
    ("TOUTMAJUSCULE1!", "LETTRE MINUSCULE"),
    ("toutminuscule1!", "LETTRE MAJUSCULE"),
    ("SansChiffres!", "CHIFFRE"),
    ("SansSymbole1A", "SYMBOLE"),
]:
    r = gen_signup("--code", code_faible)
    check(f"--code « {code_faible} » refusé (exit 1) : {fragment}",
          r.returncode == 1 and fragment in r.stdout,
          f"(rc={r.returncode}, sortie={r.stdout.strip()[:120]!r})")

r = gen_signup("--code", "CodePerso94!")
check("--code « CodePerso94! » accepté (exit 0) et hash scrypt écrit",
      r.returncode == 0
      and (ligne_de(open(ENV_SABLE, encoding="utf-8").read(),
                    "SIGNUP_CODE_HASH") or "").startswith("SIGNUP_CODE_HASH=scrypt:"))

# Réinitialise le .env de sable : hash du code FORT (pour les phases E2E)
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
    f.write(f"SIGNUP_CODE_HASH={hash_code_fort}\n")

# --assurer sur un .env SANS code : génère un code fort CONFORME (affiché une fois)
env_vierge = ENV_SABLE + ".vierge"
with open(env_vierge, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
env_tmp = dict(os.environ)
env_tmp["AUTO_RH_DOTENV"] = env_vierge
r = subprocess.run(["node", os.path.join(RACINE, "scripts", "gen-signup-code.js"), "--assurer"],
                   cwd=RACINE, env=env_tmp, capture_output=True, text=True)
m = re.search(r"(SERVICE RH-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}!)", r.stdout)
check("--assurer (aucun code) : génère un code au format SERVICE RH-xxxx-xxxx!",
      r.returncode == 0 and m is not None, f"(sortie={r.stdout.strip()[:160]!r})")
if m:
    check("--assurer : le code généré respecte la politique (4 classes)",
          conforme_classes(m.group(1)), f"({m.group(1)})")

# --verifier : le code BON mais FAIBLE est annoncé refusé par le site
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
    f.write(f"SIGNUP_CODE_HASH={gen_signup('--hash', CODE_FAIBLE).stdout.strip().splitlines()[-1].strip()}\n")
r = gen_signup("--verifier", CODE_FAIBLE)
check("--verifier : le code faible « le BON — MAIS le site le REFUSERA »",
      r.returncode == 0 and "MAIS le site le REFUSERA" in r.stdout,
      f"(rc={r.returncode}, sortie={r.stdout.strip()[-200:]!r})")
r = gen_signup("--verifier", "AutreCode94!")
check("--verifier : code fort mais FAUX -> « NE CORRESPOND PAS » (exit 1)",
      r.returncode == 1 and "NE CORRESPOND PAS" in r.stdout)

# ------------------------------------------------------------------
# Phases A-E : serveur de sable
# ------------------------------------------------------------------
print("")
print("=== Démarrage du serveur de sable (port 4311, code FORT configuré) ===")
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
    f.write(f"SIGNUP_CODE_HASH={hash_code_fort}\n")
proc = demarrer()
print("  serveur prêt.")

try:
    # ---- Phase A : mots de passe faibles refusés à l'inscription ----
    print("")
    print("=== Phase A : inscription admin — mots de passe faibles refusés ===")
    for i, (mdp, fragment) in enumerate(VARIANTES_FAIBLES):
        st, rep, _ = requete("/api/auth/signup", {
            "name": "Agent Test", "email": f"faible{i}@test94.local",
            "password": mdp, "role": "RH", "code": CODE_FORT,
        })
        check(f"signup mot de passe faible « {mdp} » -> 400 avec « {fragment} »",
              st == 400 and fragment in (rep.get("error") or ""),
              f"({st}, {rep!r})")

    # ---- Phase B : code faible refusé AVANT la comparaison ----
    print("")
    print("=== Phase B : code d'activation — politique à la saisie ===")
    st, rep, _ = requete("/api/auth/signup", {
        "name": "Agent Test", "email": "codefaible@test94.local",
        "password": MDP_FORT, "role": "RH", "code": CODE_FAIBLE,
    })
    check("code SANS minuscule -> 403 POLITIQUE (pas « incorrect »)",
          st == 403 and "LETTRE MINUSCULE" in (rep.get("error") or "")
          and "incorrect" not in (rep.get("error") or ""),
          f"({st}, {rep!r})")
    st, rep, _ = requete("/api/auth/signup", {
        "name": "Agent Test", "email": "codecourt@test94.local",
        "password": MDP_FORT, "role": "RH", "code": "court1!",
    })
    check("code trop court -> 403 « au moins 8 caractères »",
          st == 403 and "au moins 8 caractères" in (rep.get("error") or ""),
          f"({st}, {rep!r})")

    # ---- Phase B-bis : code fort + mot de passe fort -> 201 ----
    st, rep, cookie = requete("/api/auth/signup", {
        "name": "Agent Fort", "email": "fort@test94.local",
        "password": MDP_FORT, "role": "RH", "code": CODE_FORT,
    })
    check("signup code fort + mot de passe fort -> 201",
          st == 201, f"({st}, {rep!r})")
    st2, rep2, _ = requete("/api/auth/signup", {
        "name": "Agent Deux", "email": "faux@test94.local",
        "password": MDP_FORT, "role": "IT", "code": "AutreCode94!",
    })
    check("code fort mais FAUX -> 403 « Code d'activation incorrect »",
          st2 == 403 and "Code d'activation incorrect" in (rep2.get("error") or ""),
          f"({st2}, {rep2!r})")

    # ---- Phase C : changement de mot de passe admin ----
    print("")
    print("=== Phase C : /api/auth/change-password — politique ===")
    st, rep, _ = requete("/api/auth/change-password", {
        "currentPassword": MDP_FORT, "newPassword": "faible1A",
    }, cookie=cookie)
    check("changement vers mot de passe SANS symbole -> 400 « SYMBOLE »",
          st == 400 and "SYMBOLE" in (rep.get("error") or ""), f"({st}, {rep!r})")
    st, rep, _ = requete("/api/auth/change-password", {
        "currentPassword": MDP_FORT, "newPassword": "Nouveau94x!",
    }, cookie=cookie)
    check("changement vers mot de passe FORT -> 200",
          st == 200, f"({st}, {rep!r})")
    MDP_FORT_ACTUEL = "nouveau94x!"

    # ---- Phase D : réinitialisation superadmin ----
    print("")
    print("=== Phase D : /api/users/[id]/password — politique (superadmin) ===")
    # Insère un superadmin directement dans la base de sable (hash scrypt auth.ts)
    MDP_SUPER = "SuperAdmin94!"
    node_hash = subprocess.run(
        ["node", "-e",
         "const c=require('crypto');"
         "const s=c.randomBytes(16).toString('hex');"
         "console.log('scrypt:'+s+':'+c.scryptSync(process.env.SERVICE_RH_MDP_TEST,s,64).toString('hex'));"],
        cwd=RACINE, capture_output=True, text=True, check=True,
        env={**os.environ, "AUTO_RH_MDP_TEST": MDP_SUPER},
    ).stdout.strip()
    con = sqlite3.connect(DB_SABLE)
    # NB (Task 32) : les champs User.email (déterministe) et User.name (aléa)
    # sont CHIFFRÉS en base — on insère via le même module lib-crypto-bd.js
    # (clé de repli identique côté serveur de sable : aucun AUTH_SECRET).
    node_enc = subprocess.run(
        ["node", "-e",
         "const lib=require('/home/z/my-project/scripts/lib-crypto-bd.js');"
         "console.log(JSON.stringify(["
         "lib.chiffrerChamp(process.env.SERVICE_RH_EMAIL_TEST,true),"
         "lib.chiffrerChamp('Super Admin',false)]));"],
        cwd=RACINE, capture_output=True, text=True, check=True,
        env={**os.environ, "AUTO_RH_EMAIL_TEST": "super@test94.local"},
    ).stdout.strip()
    email_enc, nom_enc = json.loads(node_enc)
    con.execute(
        "INSERT INTO User (id, email, name, passwordHash, role, isActive, passwordChangedAt, createdAt) "
        "VALUES (?, ?, ?, ?, 'SUPERADMIN', 1, ?, datetime('now'))",
        ("cuid-super94", email_enc, nom_enc, node_hash,
         __import__("datetime").datetime.now().isoformat(sep=" ", timespec="seconds")),
    )
    con.commit()
    con.close()
    # Connexion superadmin -> cookie de session
    req_login = urllib.request.Request(
        BASE + "/api/auth/login",
        data=json.dumps({"email": "super@test94.local", "password": MDP_SUPER}).encode(),
        method="POST", headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req_login, timeout=25) as r:
        cookie_super = r.headers.get("Set-Cookie", "").split(";")[0]
    check("superadmin de sable connecté", bool(cookie_super))
    # Identifiant du compte RH créé en phase B-bis (email CHIFFRÉ en base :
    # recherche par la valeur déterministe encbd1d:..., même clé de repli)
    node_enc2 = subprocess.run(
        ["node", "-e",
         "const lib=require('/home/z/my-project/scripts/lib-crypto-bd.js');"
         "console.log(lib.chiffrerChamp(process.env.SERVICE_RH_EMAIL_TEST,true));"],
        cwd=RACINE, capture_output=True, text=True, check=True,
        env={**os.environ, "AUTO_RH_EMAIL_TEST": "fort@test94.local"},
    ).stdout.strip()
    con = sqlite3.connect(DB_SABLE)
    (id_rh,) = con.execute(
        "SELECT id FROM User WHERE email = ?", (node_enc2,)).fetchone()
    con.close()
    st, rep, _ = requete(f"/api/users/{id_rh}/password",
                         {"password": "SansSymbole1A"}, cookie=cookie_super)
    check("réinitialisation SANS symbole -> 400 « SYMBOLE »",
          st == 400 and "SYMBOLE" in (rep.get("error") or ""), f"({st}, {rep!r})")
    st, rep, _ = requete(f"/api/users/{id_rh}/password",
                         {"password": "Reset94xyz!"}, cookie=cookie_super)
    check("réinitialisation avec mot de passe FORT -> 200",
          st == 200, f"({st}, {rep!r})")

    # ---- Phase E : portail — mot de passe initial + /api/premiere ----
    print("")
    print("=== Phase E : portail — mot de passe initial conforme + politique ===")
    st, rep, _ = requete("/api/portal-access", {
        "action": "create", "cin": "TEST94CIN",
    }, cookie=cookie_super)
    check("création accès portail -> 200", st == 200, f"({st}, {rep!r})")
    initial = rep.get("initialPassword") or ""
    check("mot de passe initial au format lisible XXXX-XXXX-XXXX (tirets)",
          re.fullmatch(r"[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}", initial) is not None,
          f"({initial!r})")
    check("mot de passe initial : les 4 classes présentes (tirets = symboles)",
          conforme_classes(initial), f"({initial!r})")
    propre = initial.replace("-", "")
    check("mot de passe initial SANS tirets : minuscule + majuscule + chiffre garantis",
          len(propre) >= 8 and re.search(r"[a-z]", propre) and re.search(r"[A-Z]", propre)
          and re.search(r"[0-9]", propre), f"({propre!r})")

    # Portail DE SABLE (base copiée) sur un port isolé : /api/premiere
    print("")
    print("=== Phase E-bis : portail de sable — /api/premiere (politique) ===")
    PORT_PORTAIL = 4312
    PORTAL = f"http://127.0.0.1:{PORT_PORTAIL}"
    proc_portail = subprocess.Popen(
        ["node", os.path.join(RACINE, "scripts", "portail-server.js")],
        cwd=RACINE,
        env={**os.environ,
             "PORTAL_PORT": str(PORT_PORTAIL),
             "HOSTNAME": "127.0.0.1",
             "DATABASE_URL": f"file:{DB_SABLE}",
             "AUTO_RH_ROOT": RACINE},
        stdout=open(os.path.join(SANDBOX, "portail.log"), "ab"),
        stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        # Attendre le portail de sable
        pret = False
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(PORTAL + "/", timeout=2) as rr:
                    if rr.status < 500:
                        pret = True
                        break
            except Exception:
                pass
            time.sleep(0.5)
        check("portail de sable prêt", pret)

        st, rep = None, None
        for _ in range(2):
            data = json.dumps({
                "cin": "TEST94CIN", "password": initial,
                "newPassword": "Azertyui1", "confirm": "Azertyui1",
            }).encode()
            req_p = urllib.request.Request(PORTAL + "/api/premiere", data=data,
                                           method="POST",
                                           headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req_p, timeout=25) as rr:
                    st, rep = rr.status, json.loads(rr.read().decode() or "{}")
            except urllib.error.HTTPError as e:
                st, rep = e.code, json.loads(e.read().decode() or "{}")
            break
        check("portail /api/premiere : nouveau mot de passe SANS symbole -> 400 « SYMBOLE »",
              st == 400 and "SYMBOLE" in (rep.get("error") or ""), f"({st}, {rep!r})")

        data = json.dumps({
            "cin": "TEST94CIN", "password": initial,
            "newPassword": "Nouveau94x!", "confirm": "Nouveau94x!",
        }).encode()
        req_p = urllib.request.Request(PORTAL + "/api/premiere", data=data,
                                       method="POST",
                                       headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req_p, timeout=25) as rr:
                st, rep = rr.status, json.loads(rr.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            st, rep = e.code, json.loads(e.read().decode() or "{}")
        check("portail /api/premiere : nouveau mot de passe FORT -> 200",
              st == 200, f"({st}, {rep!r})")
    finally:
        try:
            os.killpg(os.getpgid(proc_portail.pid), signal.SIGTERM)
        except Exception:
            pass
        time.sleep(1)

finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
bilan = f"=== BILAN : {len(OK)} OK / {len(KO)} FAIL ==="
print(bilan)
if KO:
    print("  Échecs :")
    for k in KO:
        print(f"   - {k}")
sys.exit(1 if KO else 0)
