#!/usr/bin/env python3
"""Expérience contrôlée : où vont VRAIMENT les écritures du serveur de sable ?"""
import json, os, shutil, signal, sqlite3, subprocess, sys, time, urllib.request, urllib.error

RACINE = "/home/z/my-project"
PORT = 4311
BASE = f"http://127.0.0.1:{PORT}"
SANDBOX = os.path.join(RACINE, "sandbox-exp93")
DB_SABLE = os.path.join(SANDBOX, "exp.db")
ENV_SABLE = os.path.join(SANDBOX, ".env")

def compteur(chemin):
    con = sqlite3.connect(chemin)
    n = con.execute("SELECT COUNT(*) FROM User").fetchone()[0]
    ids = [r[0] for r in con.execute("SELECT id FROM User ORDER BY createdAt").fetchall()]
    con.close()
    return n, ids

def signup(email, code):
    data = json.dumps({"name": "Exp93", "email": email, "password": "secret93x", "role": "RH", "code": code}).encode()
    req = urllib.request.Request(BASE + "/api/auth/signup", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

if os.path.exists(SANDBOX):
    shutil.rmtree(SANDBOX)
os.makedirs(SANDBOX)
shutil.copyfile(os.path.join(RACINE, "db", "custom.db"), DB_SABLE)

n_reel_avant, ids_reel_avant = compteur(os.path.join(RACINE, "db", "custom.db"))
n_sable_avant, ids_sable_avant = compteur(DB_SABLE)
print(f"AVANT : vraie base={n_reel_avant} users, sable={n_sable_avant} users")
print(f"  ids vraie base : {ids_reel_avant}")
print(f"  ids sable      : {ids_sable_avant}")

with open(ENV_SABLE, "w") as f:
    f.write(f"DATABASE_URL=file:{DB_SABLE}\nSIGNUP_CODE=CODEEXP93\n")

env = dict(os.environ)
env.update({"PORT": str(PORT), "HOSTNAME": "127.0.0.1",
            "AUTO_RH_ROOT": RACINE,
            "AUTO_RH_STORAGE_DIR": os.path.join(RACINE, "storage", "payslips"),
            "DOTENV_PATH": ENV_SABLE})
for cle in list(env.keys()):
    if cle.startswith("SIGNUP_"):
        env.pop(cle)
    if cle.startswith("DATABASE_URL"):
        env.pop(cle)

proc = subprocess.Popen(["node", os.path.join(RACINE, "scripts", "launcher_task93.js")],
                        cwd=RACINE, env=env,
                        stdout=open(os.path.join(SANDBOX, "serveur.log"), "wb"),
                        stderr=subprocess.STDOUT, start_new_session=True)
deadline = time.time() + 60
ok = False
while time.time() < deadline:
    try:
        with urllib.request.urlopen(BASE + "/login", timeout=2) as r:
            if r.status < 500:
                ok = True
                break
    except Exception:
        pass
    time.sleep(0.5)
print("serveur prêt :", ok)

st1 = signup("exp93-zeta@test.local", "CODEEXP93")
print("POST exp93-zeta (code bon) ->", st1)
st2 = signup("exp93-zeta@test.local", "CODEEXP93")
print("POST exp93-zeta bis (même email) ->", st2, "(409 attendu si l'écriture est visible)")

n_reel_apres, ids_reel_apres = compteur(os.path.join(RACINE, "db", "custom.db"))
n_sable_apres, ids_sable_apres = compteur(DB_SABLE)
print(f"APRES : vraie base={n_reel_apres} users, sable={n_sable_apres} users")
print(f"  ids vraie base : {ids_reel_apres}")
print(f"  ids sable      : {ids_sable_apres}")
ajouts_reel = set(ids_reel_apres) - set(ids_reel_avant)
ajouts_sable = set(ids_sable_apres) - set(ids_sable_avant)
print("  AJOUTÉS à la vraie base :", ajouts_reel)
print("  AJOUTÉS au sable        :", ajouts_sable)

# décrypter les emails ajoutés
os.chdir(RACINE)
dec = subprocess.run(["node", "-e", f"""
const {{dechiffrerChamp}} = require('./scripts/lib-crypto-bd.js');
const ids = {json.dumps(sorted(list(ajouts_reel) + list(ajouts_sable)))};
const con = require('child_process');
"""], capture_output=True, text=True)

try:
    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
except Exception:
    pass
time.sleep(1.5)
try:
    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
except Exception:
    pass

# les écritures SQLite sont-elles visibles après arrêt ?
n_sable_fin, _ = compteur(DB_SABLE)
n_reel_fin, _ = compteur(os.path.join(RACINE, "db", "custom.db"))
print(f"APRES ARRÊT : vraie base={n_reel_fin}, sable={n_sable_fin}")
