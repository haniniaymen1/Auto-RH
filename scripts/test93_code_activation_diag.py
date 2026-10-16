#!/usr/bin/env python3
"""Task 93 — « Cela ne fonctionne ni avec le code d'activation initial, ni avec
le code créé à l'aide du fichier SECURISER-INSCRIPTION-WINDOWS.bat ».

Reproduction EXACTE de la chaîne de l'utilisateur, jamais testée jusqu'ici :
  fichier .env  ->  chargement (copie exacte de start-prod.js)
                ->  process.env  ->  verifierCodeInscription (API /api/auth/signup)

Phases E2E (bac à sable : copie de db/custom.db, port 4310, .env de sable) :
  A. Code INITIAL historique (SERVICE RH-8C5T-VGTL, celui de l'utilisateur) en
     clair dans .env -> conversion automatique (--assurer, Task 91) ->
     REDÉMARRAGE -> ce code est accepté (201) ; minuscules aussi (201) ;
     mauvais code -> 403.
  B. Code CHANGÉ via gen-signup-code.js --code (ce que fait l'option 2/3 du
     menu SECURISER-INSCRIPTION-WINDOWS.bat) -> VRAI redémarrage ->
     le NOUVEAU code est accepté (201), l'ANCIEN est refusé (403).
  C. Le PIÈGE : même changement SANS redémarrage -> le nouveau code est
     refusé (403), l'ancien fonctionne encore : c'est exactement
     « ni l'un ni l'autre ne fonctionne » vu par l'utilisateur.
  D. SIGNUP_ENABLED=false -> même le BON code est refusé (403 « désactivée »).
  E. Anti force-brute : 20 codes erronés -> le suivant (même BON) -> 429.

Contrôles statiques (correctifs Task 93) :
  F. gen-signup-code.js : action --verifier (« Tester un code ») + menu 7 ;
  G. message d'erreur de l'API signup orienté diagnostic (redémarrage) ;
  H. start-prod.js : plus AUCUN npx (CLI Prisma local) + détection de port
     déjà utilisé avec message d'aide ;
  I. auto-rh.js : le message « tournent déjà » explique le vrai
     redémarrage (ARRETER puis DEMARRER) ;
  J. SECURISER-INSCRIPTION-WINDOWS.bat : option « Tester un code » documentée
     (ASCII + CRLF) ; README §58 ; version 0.2.23.
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
PORT = 4310
BASE = f"http://127.0.0.1:{PORT}"
SANDBOX = os.path.join(RACINE, "sandbox-task93")
DB_SABLE = os.path.join(SANDBOX, "test93.db")
ENV_SABLE = os.path.join(SANDBOX, ".env93")
CODE_INITIAL = "SERVICE RH-8C5T-VGTL"  # le code historique de l'utilisateur (Task 91)
CODE_NOUVEAU = "NouveauCode93"
CODE_TIERS = "CodeTiers93"
OK = []
KO = []


def check(nom, cond, detail=""):
    if cond:
        OK.append(nom)
        print(f"  [OK]   {nom}")
    else:
        KO.append(nom)
        print(f"  [FAIL] {nom} {detail}")


def requete(chemin, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + chemin, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


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
    # S'assurer qu'aucun SIGNUP_* ni DATABASE_URL ne fuite depuis
    # l'environnement du test : seules les lignes du FICHIER .env de sable
    # doivent compter (règle de start-prod.js : les variables DÉJÀ définies
    # dans l'environnement sont PRIORITAIRES sur le fichier .env).
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
        raise RuntimeError("serveur de sable non prêt (voir sandbox-task93/serveur.log)")
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


def lire_env():
    with open(ENV_SABLE, "r", encoding="utf-8") as f:
        return f.read()


def ligne_de(texte, cle):
    for l in texte.splitlines():
        if re.match(rf"^\s*{cle}=", l):
            return l.strip()
    return None


def signup(nom, email, code, mdp="secret93x", role="RH"):
    return requete("/api/auth/signup", {"name": nom, "email": email,
                                        "password": mdp, "role": role, "code": code})


# ------------------------------------------------------------------
print("=== Préparation du bac à sable (sandbox-task93) ===")
if os.path.exists(SANDBOX):
    shutil.rmtree(SANDBOX)
os.makedirs(SANDBOX)
shutil.copyfile(os.path.join(RACINE, "db", "custom.db"), DB_SABLE)
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\n")
    f.write(f"SIGNUP_CODE={CODE_INITIAL}\n")
print(f"  .env de sable : {ENV_SABLE}")
print(f"  base de sable : {DB_SABLE}")

# ------------------------------------------------------------------
print("")
print("=== Phase A : code INITIAL (conversion automatique --assurer, Task 91) ===")
r = gen_signup("--assurer")
check("conversion --assurer : code de sortie 0", r.returncode == 0, f"(rc={r.returncode})")
env_apres = lire_env()
check("conversion : ligne SIGNUP_CODE_HASH=scrypt:... écrite",
      (ligne_de(env_apres, "SIGNUP_CODE_HASH") or "").startswith("SIGNUP_CODE_HASH=scrypt:"),
      f"({ligne_de(env_apres, 'SIGNUP_CODE_HASH')})")
check("conversion : ligne SIGNUP_CODE en clair RETIRÉE", ligne_de(env_apres, "SIGNUP_CODE") is None)
check("conversion : le .env ne contient PLUS le code en clair", CODE_INITIAL not in env_apres)

proc = demarrer()
try:
    st, body = signup("Test93 Initial", "task93-a@test.local", CODE_INITIAL)
    check("code INITIAL converti en hash -> accepté (201)", st == 201, f"(reçu {st} {body})")
    st, body = signup("Test93 Minuscules", "task93-b@test.local", CODE_INITIAL.lower())
    check("code initial en minuscules -> 201 (insensible à la casse)", st == 201, f"(reçu {st} {body})")
    st, body = signup("Test93 Mauvais", "task93-x@test.local", "MAUVAIS-CODE-X")
    check("mauvais code -> 403 « incorrect »", st == 403 and "incorrect" in body.get("error", ""),
          f"(reçu {st} {body})")
finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
print("=== Phase B : code CHANGÉ (option 2/3 du menu SECURISER-INSCRIPTION) + VRAI redémarrage ===")
r = gen_signup("--code", CODE_NOUVEAU)
check("--code : code de sortie 0", r.returncode == 0, f"(rc={r.returncode} {r.stdout})")
env_b = lire_env()
check("--code : le hash a été REMPLACÉ (nouveau scrypt:...)",
      (ligne_de(env_b, "SIGNUP_CODE_HASH") or "").startswith("SIGNUP_CODE_HASH=scrypt:")
      and ligne_de(env_apres, "SIGNUP_CODE_HASH") != ligne_de(env_b, "SIGNUP_CODE_HASH"))

proc = demarrer()
try:
    st, body = signup("Test93 Nouveau", "task93-c@test.local", CODE_NOUVEAU)
    check("NOUVEAU code après redémarrage -> 201", st == 201, f"(reçu {st} {body})")
    st, body = signup("Test93 Ancien", "task93-d@test.local", CODE_INITIAL)
    check("ANCIEN code après le changement -> 403", st == 403, f"(reçu {st} {body})")
finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
print("=== Phase C : LE PIÈGE — changement SANS redémarrage (le cas de l'utilisateur) ===")
# On change le FICHIER .env PENDANT que le serveur TOURNE ENCORE (comme quand
# l'utilisateur lance SECURISER-INSCRIPTION sans arrêter les serveurs) :
proc = demarrer()  # ce serveur connaît NOUVEAU (lu au démarrage)
try:
    r = gen_signup("--code", CODE_TIERS)  # le FICHIER change sous ses pieds
    check("--code (tiers) : code de sortie 0", r.returncode == 0, f"(rc={r.returncode})")
    st, body = signup("Test93 SansRestart", "task93-e@test.local", CODE_TIERS)
    check("code changé SANS redémarrage -> refusé (403) : le piège existe", st == 403,
          f"(reçu {st} {body})")
    st, body = signup("Test93 Memoire", "task93-f@test.local", CODE_NOUVEAU)
    check("l'ANCIEN code (en mémoire) fonctionne encore -> 201", st == 201, f"(reçu {st} {body})")
finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
print("=== Phase D : SIGNUP_ENABLED=false — même le BON code est refusé ===")
with open(ENV_SABLE, "a", encoding="utf-8") as f:
    f.write("SIGNUP_ENABLED=false\n")
proc = demarrer()
try:
    st, body = signup("Test93 Disabled", "task93-g@test.local", CODE_NOUVEAU)
    check("SIGNUP_ENABLED=false + BON code -> 403 « désactivée »",
          st == 403 and "désactivée" in body.get("error", ""), f"(reçu {st} {body})")
finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
print("=== Phase E : anti force-brute — 20 erronés puis le BON -> 429 ===")
with open(ENV_SABLE, "r", encoding="utf-8") as f:
    txt = f.read()
with open(ENV_SABLE, "w", encoding="utf-8") as f:
    f.write(re.sub(r"^\s*SIGNUP_ENABLED=.*\n?", "", txt, flags=re.MULTILINE))
proc = demarrer()
try:
    # le fichier contient désormais le hash de CODE_TIERS (changement de la phase C)
    st, body = signup("Test93 Brute", "task93-h@test.local", CODE_TIERS)
    check("compteur remis à zéro après redémarrage : BON code (tiers) -> 201", st == 201,
          f"(reçu {st} {body})")
    derniere = None
    for i in range(20):
        derniere, _ = signup("Test93 Brute", f"task93-h@test.local", f"ERRONE-{i:02d}")
    check("20 codes erronés -> tous 403", derniere == 403, f"(dernier {derniere})")
    st, body = signup("Test93 Brute", "task93-h@test.local", CODE_TIERS)
    check("21e tentative (même BON) -> 429 « Trop de tentatives »",
          st == 429 and "Trop de tentatives" in body.get("error", ""), f"(reçu {st} {body})")
finally:
    arreter(proc)

# ------------------------------------------------------------------
print("")
print("=== Phase F : gen-signup-code.js --verifier (« Tester un code ») ===")
r = gen_signup("--verifier", CODE_TIERS)
check("--verifier code BON : verdict positif affiché", "CE CODE EST LE BON" in r.stdout,
      f"(rc={r.returncode})")
check("--verifier code BON : code de sortie 0", r.returncode == 0, f"(rc={r.returncode})")
check("--verifier code BON : rappelle le VRAI redémarrage (ARRETER puis DEMARRER)",
      "ARRETER" in r.stdout and "DEMARRER" in r.stdout)
r = gen_signup("--verifier", "CODE-FAUX-XX")
check("--verifier code MAUVAIS : verdict négatif affiché", "NE CORRESPOND PAS" in r.stdout)
check("--verifier code MAUVAIS : code de sortie 1 (diagnostic honnête)", r.returncode == 1,
      f"(rc={r.returncode})")
check("--verifier : affiche le chemin du .env testé", ENV_SABLE in r.stdout, f"({r.stdout[:200]})")

# ------------------------------------------------------------------
print("")
print("=== Phase G : message d'erreur de l'API signup orienté diagnostic ===")
with open(os.path.join(RACINE, "src", "app", "api", "auth", "signup", "route.ts"),
          encoding="utf-8") as f:
    route = f.read()
check("403 signup : rappelle ARRÊTEZ puis RELANCEZ les serveurs",
      "ARR\u00caTEZ" in route and "RELANCEZ" in route)
check("403 signup : précise que relancer seulement le démarrage ne suffit pas",
      "relancer seulement le d\u00e9marrage ne suffit pas" in route)
check("403 signup : mentionne l'option « Tester un code » du menu SECURISER-INSCRIPTION",
      "Tester un code" in route and "SECURISER-INSCRIPTION" in route)

# ------------------------------------------------------------------
print("")
print("=== Phase H : start-prod.js — plus AUCUN npx + détection de port occupé ===")
with open(os.path.join(RACINE, "scripts", "start-prod.js"), encoding="utf-8") as f:
    startprod = f.read()
check("start-prod.js : plus AUCUN appel exécutable à npx (Task 89, cohérence — commentaires exclus)",
      "npx" not in "\n".join(l for l in startprod.splitlines()
                             if not l.strip().startswith(("//", "*", "/*"))),
      "(une ligne exécutable contient encore npx)")
check("start-prod.js : CLI Prisma LOCAL (node_modules/prisma/build/index.js)",
      "node_modules/prisma/build/index.js" in startprod
      or 'path.join(ROOT, "node_modules", "prisma", "build", "index.js")' in startprod)
check("start-prod.js : détecte un port DÉJÀ UTILISÉ avant de démarrer",
      "DEJA UTILISE" in startprod)
check("start-prod.js : le message port occupé explique l'ancien serveur en mémoire",
      "ANCIEN contenu du .env EN M" in startprod and "ARRETEZ-LE D'ABORD" in startprod)
check("start-prod.js : le message port occupé donne la marche à suivre",
      "ARRETER-SILENCIEUX-WINDOWS.vbs" in startprod and "auto-rh.js stop" in startprod)

# ------------------------------------------------------------------
print("")
print("=== Phase I : auto-rh.js — le vrai redémarrage expliqué ===")
with open(os.path.join(RACINE, "scripts", "auto-rh.js"), encoding="utf-8") as f:
    service = f.read()
check("service : le cas « tournent déjà » précise que RIEN n'a été relancé",
      "RIEN n'a ete relance" in service)
check("service : précise que le changement du .env n'est PAS appliqué",
      "n'est DONC PAS applique" in service)
check("service : donne le VRAI redémarrage (ARRETER PUIS DEMARRER)",
      "ARRETER-SILENCIEUX-WINDOWS.vbs PUIS DEMARRER-SILENCIEUX-WINDOWS.vbs" in service)
check("service : renvoie à l'option 7 (Tester un code) de SECURISER-INSCRIPTION",
      "SECURISER-INSCRIPTION-WINDOWS.bat, option 7" in service)

# ------------------------------------------------------------------
print("")
print("=== Phase J : lanceurs, README, version ===")
bat = os.path.join(RACINE, "SECURISER-INSCRIPTION-WINDOWS.bat")
with open(bat, "rb") as f:
    brut = f.read()
texte_bat = brut.decode("utf-8", errors="replace")
check("SECURISER-INSCRIPTION-WINDOWS.bat : CRLF préservés", brut.count(b"\r\n") >= 30)
check("SECURISER-INSCRIPTION-WINDOWS.bat : ASCII pur (invariant Task 38/40)",
      all(b < 128 for b in brut))
check("SECURISER-INSCRIPTION-WINDOWS.bat : option « Tester un code » documentée",
      "Tester un code" in texte_bat or "TESTER UN CODE" in texte_bat.upper())
with open(os.path.join(RACINE, "README-DEPLOIEMENT-LOCAL.md"), encoding="utf-8") as f:
    readme = f.read()
check("README : nouvelle section 58 « code d'activation refusé — diagnostic »",
      re.search(r"^##+ 58\.", readme, re.MULTILINE) is not None)
check("README §58 : cause n°1 = serveurs pas vraiment redémarrés",
      "ARRETER-SILENCIEUX" in readme and "DEMARRER-SILENCIEUX" in readme)
with open(os.path.join(RACINE, "package.json"), encoding="utf-8") as f:
    pkg = json.load(f)
check("version : package.json 0.2.23", pkg.get("version") == "0.2.23", f"({pkg.get('version')})")
check("launcher_task93.js : présent (réplique du chargement .env de start-prod.js)",
      os.path.exists(os.path.join(RACINE, "scripts", "launcher_task93.js")))

# ------------------------------------------------------------------
print("")
print(f"=== BILAN : {len(OK)} OK / {len(KO)} FAIL ===")
if KO:
    print("Contrôles en échec :")
    for k in KO:
        print("  -", k)
sys.exit(1 if KO else 0)
