#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 94-bis — TEST COMPLET du ZIP « auto-rh-scripts-site-web-CORRIGE (1).zip »
(version corrigée par un tiers : nodemailer ^7.0.7, politique de mot de passe
4 classes, SMTP personnalisé, e-mail allégé, libellés français).

Le script :
  1. prépare la base sandbox (prisma db push --force-reset) ;
  2. démarre 3 puits SMTP locaux (2525 = accepte AUTH, 2535 = refuse AUTH 535,
     2465 = SSL/TLS avec certificat auto-signé) ;
  3. démarre le serveur d'administration (standalone, port 4400) et le
     portail (port 4401) avec des variables d'environnement explicites ;
  4. exécute toutes les sections de tests (A..M) ;
  5. arrête les serveurs et affiche le rapport détaillé.

Usage : python3 scripts/test94_zip_corrige.py
"""

import base64
import json
import os
import re
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

SANDBOX = "/home/z/my-project/sandbox-task94-testzip/extracted"
RUNDIR = "/home/z/my-project/sandbox-task94-testzip"
DB = f"file:{SANDBOX}/db/custom.db"
AUTH_SECRET = "secret-test-sandbox-task94-zip-corrige-0123456789abcdef"
ADMIN = "http://localhost:4400"
PORTAL = "http://localhost:4401"
PORT_ADMIN = 4400
PORT_PORTAIL = 4401

CODE_ACTIVATION = "Auto-RH-Test94!"          # conforme aux 4 familles
MDP_SUPERADMIN_1 = "SuperAdmin94!"
MDP_SUPERADMIN_2 = "SuperAdmin95!nov"
MDP_RH_1 = "RhCompte94!x"
MDP_RH_2 = "RhCompte95!y"
SMTP_HOST = "127.0.0.1"
SMTP_PORT_OK = 2525      # accepte l'AUTH service_rh_mail / BonMotDePasse94!
SMTP_PORT_KO = 2535      # refuse toute AUTH avec 535
SMTP_PORT_SSL = 2465     # SSL/TLS direct, certificat auto-signé
SMTP_USER = "service_rh_mail"
SMTP_PASS = "BonMotDePasse94!"
SMTP_FROM = "auto-rh@monentreprise.tn"
PORTAIL_URL_CFG = "http://192.168.1.10:4001"

results = []
procs = []


def sect(num, titre):
    print(f"\n===== SECTION {num} — {titre} =====", flush=True)


def check(nom, ok, detail=""):
    results.append((nom, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {nom}" + (f" — {detail}" if detail else ""), flush=True)


# ----------------------------------------------------------------------
# Puits SMTP minimal (EHLO/HELO, AUTH LOGIN/PLAIN, MAIL, RCPT, DATA, QUIT)
# ----------------------------------------------------------------------
class PuitsSMTP(threading.Thread):
    daemon = True

    def __init__(self, port, mode, tls_ctx=None):
        super().__init__()
        self.port = port
        self.mode = mode          # "ok" | "refuse_auth"
        self.tls_ctx = tls_ctx
        self.messages = []
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(16)
        self.actif = True

    def run(self):
        while self.actif:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                break
            threading.Thread(target=self.session, args=(conn,), daemon=True).start()

    def session(self, conn):
        buf = b""

        def envoyer(ligne):
            conn.sendall((ligne + "\r\n").encode())

        def recevoir():
            nonlocal buf
            while b"\r\n" not in buf:
                d = conn.recv(4096)
                if not d:
                    return None
                buf += d
            ligne, buf = buf.split(b"\r\n", 1)
            return ligne.decode(errors="replace")

        if self.tls_ctx:
            try:
                conn = self.tls_ctx.wrap_socket(conn, server_side=True)
            except ssl.SSLError:
                conn.close()
                return
        envoyer("220 smtp-test.local Service prêt")
        en_auth = False
        etape_auth = 0
        creds = []
        destinataires = []
        expediteur = None
        while True:
            try:
                ligne = recevoir()
                if ligne is None:
                    break
            except (ssl.SSLError, ConnectionResetError, OSError):
                break
            U = ligne.upper()
            if en_auth:
                creds.append(ligne.strip())
                if etape_auth == 1:          # attendu : username (b64)
                    etape_auth = 2
                    envoyer("334 UGFzc3dvcmQ6")
                else:                         # attendu : password (b64)
                    try:
                        user = base64.b64decode(creds[0]).decode() if creds[0] else ""
                        pw = base64.b64decode(creds[1]).decode() if len(creds) > 1 else ""
                    except Exception:
                        user, pw = "?", "?"
                    if self.mode == "refuse_auth" or pw != SMTP_PASS:
                        envoyer("535 5.7.8 Identifiants d'authentification invalides")
                    else:
                        envoyer("235 2.7.0 Authentification acceptée")
                    en_auth = False
                continue
            if U.startswith("EHLO") or U.startswith("HELO"):
                envoyer("250-smtp-test.local")
                envoyer("250-AUTH LOGIN PLAIN")
                envoyer("250 OK")
            elif U.startswith("AUTH PLAIN"):
                m = re.search(r"AUTH PLAIN (.+)$", ligne)
                okcred = False
                if m:
                    try:
                        dec = base64.b64decode(m.group(1)).decode()
                        parts = dec.split("\x00")
                        user, pw = parts[1], parts[2]
                        okcred = (self.mode != "refuse_auth" and pw == SMTP_PASS)
                    except Exception:
                        okcred = False
                envoyer("235 2.7.0 Authentification acceptée" if okcred
                        else "535 5.7.8 Identifiants d'authentification invalides")
            elif U.startswith("AUTH LOGIN"):
                en_auth = True
                etape_auth = 1
                creds = []
                envoyer("334 VXNlcm5hbWU6")
            elif U.startswith("MAIL FROM"):
                expediteur = ligne.split(":", 1)[1].strip()
                envoyer("250 OK")
            elif U.startswith("RCPT TO"):
                destinataires.append(ligne.split(":", 1)[1].strip())
                envoyer("250 OK")
            elif U.startswith("DATA"):
                envoyer("354 Finissez avec <CRLF>.<CRLF>")
                corps = []
                while True:
                    l = recevoir()
                    if l is None:
                        break
                    if l == ".":
                        break
                    corps.append(l)
                self.messages.append({
                    "from": expediteur, "to": list(destinataires),
                    "data": "\n".join(corps),
                })
                destinataires = []
                envoyer("250 OK message accepté")
            elif U.startswith("RSET"):
                destinataires = []
                expediteur = None
                envoyer("250 OK")
            elif U.startswith("NOOP"):
                envoyer("250 OK")
            elif U.startswith("QUIT"):
                envoyer("221 Au revoir")
                break
            else:
                envoyer("502 Commande non implémentée")
        try:
            conn.close()
        except Exception:
            pass

    def stop(self):
        self.actif = False
        try:
            self.sock.close()
        except Exception:
            pass


def requete(url, methode="GET", corps=None, entetes=None, cookie=None, timeout=15):
    data = json.dumps(corps).encode() if corps is not None else None
    h = {"Content-Type": "application/json"}
    if entetes:
        h.update(entetes)
    if cookie:
        h["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, headers=h, method=methode)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            brut = r.read().decode(errors="replace")
            try:
                j = json.loads(brut)
            except Exception:
                j = None
            return r.status, j, brut, dict(r.headers)
    except urllib.error.HTTPError as e:
        brut = e.read().decode(errors="replace")
        try:
            j = json.loads(brut)
        except Exception:
            j = None
        return e.code, j, brut, dict(e.headers)


def extraire_cookie(entetes):
    sc = ""
    for k, v in entetes.items():
        if k.lower() == "set-cookie":
            sc = v
            break
    m = re.search(r"(auto_rh_session=[^;]+)", sc)
    return m.group(1) if m else None


def attendre_service(url, essais=120, delai=0.5):
    for _ in range(essais):
        try:
            st, _, _, _ = requete(url, timeout=3)
            if st < 500:
                return True
        except Exception:
            pass
        time.sleep(delai)
    return False


def regex_4_familles(s):
    return (len(s) >= 8 and re.search(r"[a-z]", s) and re.search(r"[A-Z]", s)
            and re.search(r"[0-9]", s) and re.search(r"[^A-Za-z0-9]", s))


# ====================== SECTION 0 : préparation ======================
def preparer():
    sect("0", "PRÉPARATION (base, puits SMTP, serveurs)")
    env = dict(os.environ)
    env.update({
        "DATABASE_URL": DB,
        "AUTH_SECRET": AUTH_SECRET,
        "SIGNUP_ENABLED": "yes",
    })
    # Hash du code d'activation avec le propre outil du ZIP
    r = subprocess.run(["node", "scripts/gen-signup-code.js", "--hash", CODE_ACTIVATION],
                       cwd=SANDBOX, capture_output=True, text=True, env=env,
                       stdin=subprocess.DEVNULL, timeout=60)
    lignes = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.startswith("scrypt:")]
    code_hash = lignes[-1] if lignes else ""
    check("Hash du code d'activation généré par gen-signup-code.js", bool(code_hash),
          CODE_ACTIVATION)
    env["SIGNUP_CODE_HASH"] = code_hash

    # Base réinitialisée
    r = subprocess.run(["npx", "prisma", "db", "push", "--accept-data-loss",
                        "--force-reset", "--skip-generate"],
                       cwd=SANDBOX, capture_output=True, text=True, env=env, timeout=180)
    ok_db = "in sync" in (r.stdout + r.stderr) or "sync" in (r.stdout + r.stderr)
    check("Base SQLite sandbox réinitialisée (schéma Prisma)", ok_db,
          (r.stdout + r.stderr).strip().splitlines()[-1] if r.stderr else "")

    # Certificat auto-signé pour le puits SSL
    cert = os.path.join(RUNDIR, "smtp-test.crt")
    cle = os.path.join(RUNDIR, "smtp-test.key")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", cle, "-out", cert, "-days", "2", "-subj",
                    "/CN=smtp-test.local"], capture_output=True,
                   stdin=subprocess.DEVNULL, timeout=60)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, cle)

    puits = [PuitsSMTP(SMTP_PORT_OK, "ok"), PuitsSMTP(SMTP_PORT_KO, "refuse_auth"),
             PuitsSMTP(SMTP_PORT_SSL, "ok", ctx)]
    for p in puits:
        p.start()
    time.sleep(0.4)
    check("3 puits SMTP démarrés (2525 accepte / 2535 refuse / 2465 SSL)", True)

    # Serveur d'administration (standalone — chemin imbriqué, artefact du
    # sandbox imbriqué dans /home/z/my-project, PAS un bug du ZIP)
    serveur_js = os.path.join(SANDBOX, ".next/standalone/sandbox-task94-testzip/extracted/server.js")
    env_admin = dict(env)
    env_admin.update({
        "PORT": str(PORT_ADMIN), "HOSTNAME": "0.0.0.0",
        "AUTO_RH_ROOT": SANDBOX,
        "AUTO_RH_STORAGE_DIR": f"{SANDBOX}/storage/payslips",
        "NODE_ENV": "production",
    })
    pa = subprocess.Popen(["node", serveur_js], cwd=SANDBOX, env=env_admin,
                          stdout=open(f"{RUNDIR}/admin.log", "ab"),
                          stderr=subprocess.STDOUT)
    procs.append(pa)

    # Portail
    env_p = dict(env)
    env_p.update({"PORTAL_PORT": str(PORT_PORTAIL),
                  "AUTO_RH_STORAGE_DIR": f"{SANDBOX}/storage/payslips"})
    pp = subprocess.Popen(["node", "scripts/portail-server.js"], cwd=SANDBOX, env=env_p,
                          stdout=open(f"{RUNDIR}/portail.log", "ab"),
                          stderr=subprocess.STDOUT)
    procs.append(pp)

    ok_a = attendre_service(f"{ADMIN}/login")
    check(f"Serveur d'administration prêt sur {PORT_ADMIN}", ok_a)
    ok_p = attendre_service(PORTAL + "/")
    check(f"Portail employés prêt sur {PORT_PORTAIL}", ok_p)
    if not (ok_a and ok_p):
        print("!! Serveurs non prêts — abandon")
        return False, env, puits, code_hash
    return True, env, puits, code_hash


def tout_arreter(puits):
    for p in puits:
        p.stop()
    for pr in procs:
        try:
            pr.terminate()
        except Exception:
            pass
    for pr in procs:
        try:
            pr.wait(timeout=5)
        except Exception:
            try:
                pr.kill()
            except Exception:
                pass


# ====================== sections de tests ======================
def exec_sections(env, puits):
    global cookie_admin
    cookie_admin = None

    # ---------- A. Pages publiques ----------
    sect("A", "PAGES PUBLIQUES")
    st, _, _, _ = requete(f"{ADMIN}/login")
    check("A1  GET /login → 200", st == 200, f"status={st}")
    st, _, _, _ = requete(f"{ADMIN}/signup")
    check("A2  GET /signup → 200", st == 200, f"status={st}")
    st, _, _, _ = requete(f"{PORTAL}/")
    check("A3  GET portail / → 200", st == 200, f"status={st}")
    st, _, brut, _ = requete(f"{ADMIN}/.env")
    check("A4  GET /.env : aucun secret exposé (contenu sans DATABASE_URL/SIGNUP_CODE_HASH)",
          "DATABASE_URL" not in brut and "SIGNUP_CODE_HASH" not in brut and "AUTH_SECRET" not in brut,
          f"status={st}, {len(brut)} octets")
    st, _, _, _ = requete(f"{ADMIN}/api/download-scripts")
    check("A5  GET /api/download-scripts sans session → refusé (401/403/404)", st in (401, 403, 404), f"status={st}")

    # ---------- B. Superadmin : script + connexion ----------
    sect("B", "CRÉATION SUPERADMIN (script ZIP) + CONNEXION")
    env_node = dict(env)
    r = subprocess.run(["node", "scripts/creer-superadmin.js", "--creer",
                        "--email", "super94@test.tn", "--nom", "Super Admin 94",
                        "--password", "faible123"], cwd=SANDBOX,
                       capture_output=True, text=True, env=env_node,
                       stdin=subprocess.DEVNULL, timeout=120)
    sortie = (r.stdout + r.stderr)
    check("B1  creer-superadmin REFUSE le mot de passe faible («faible123»)",
          r.returncode != 0 and ("fort" in sortie or "8 caractères" in sortie or "symbole" in sortie),
          sortie.strip().splitlines()[-1] if sortie.strip() else f"rc={r.returncode}")
    r = subprocess.run(["node", "scripts/creer-superadmin.js", "--creer",
                        "--email", "super94@test.tn", "--nom", "Super Admin 94",
                        "--password", MDP_SUPERADMIN_1], cwd=SANDBOX,
                       capture_output=True, text=True, env=env_node,
                       stdin=subprocess.DEVNULL, timeout=120)
    check("B2  creer-superadmin ACCEPTE «SuperAdmin94!» (4 familles)",
          r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else "ok")

    st, j, brut, h = requete(f"{ADMIN}/api/auth/login",
                             "POST", {"email": "super94@test.tn", "password": MDP_SUPERADMIN_1})
    check("B3  POST /api/auth/login superadmin → 200", st == 200, f"status={st} {j}")
    cookie_admin = extraire_cookie(h)
    check("B4  Cookie de session next-auth reçu", bool(cookie_admin),
          (cookie_admin or "")[:40] + "…")
    st, j, _, _ = requete(f"{ADMIN}/api/auth/me", cookie=cookie_admin)
    check("B5  GET /api/auth/me → session superadmin", st == 200 and (j or {}).get("user", {}).get("role") == "SUPERADMIN", f"{j}")
    must = (j or {}).get("user", {}).get("mustChangePassword")
    if must:
        st2, j2, _, _ = requete(f"{ADMIN}/api/auth/change-password", "POST",
                                {"currentPassword": MDP_SUPERADMIN_1, "newPassword": MDP_SUPERADMIN_2},
                                cookie=cookie_admin)
        check("B6  Changement obligatoire détecté → changement immédiat OK", st2 == 200, f"status={st2}")
        st, j, _, h = requete(f"{ADMIN}/api/auth/login",
                              "POST", {"email": "super94@test.tn", "password": MDP_SUPERADMIN_2})
        cookie_admin = extraire_cookie(h)
        check("B7  Reconnexion avec le nouveau mot de passe", st == 200, f"status={st}")
    else:
        check("B6  Compte superadmin sans changement obligatoire (passwordChangedAt déjà posé)", True)
        check("B7  (non applicable)", True)

    # ---------- C. Inscription RH/IT : politique de complexité ----------
    sect("C", "SIGNUP — POLITIQUE 4 CLASSES + CODE D'ACTIVATION")
    faibles = [
        ("C1", "court8!", "court8!", "trop court (<8)"),
        ("C2", "queeminuscule1!", "queeminuscule1!", "sans MAJUSCULE"),
        ("C3", "QUEEMAJUSCULE1!", "QUEEMAJUSCULE1!", "sans minuscule"),
        ("C4", "SansChiffre!", "SansChiffre!", "sans chiffre"),
        ("C5", "SansSymbole94x", "SansSymbole94x", "sans symbole"),
    ]
    for tag, mdp, conf, libelle in faibles:
        st, j, _, _ = requete(f"{ADMIN}/api/auth/signup", "POST", {
            "name": "RH Test 94", "email": f"rh94-{tag.lower()}@test.tn",
            "password": mdp, "role": "RH", "code": CODE_ACTIVATION})
        msg = (j or {}).get("error", "")
        check(f"{tag}  signup mot de passe {libelle} → 400 + message français",
              st == 400 and ("fort" in msg or "8 caractères" in msg or "minuscule" in msg
                             or "majuscule" in msg or "chiffre" in msg or "symbole" in msg),
              f"status={st} msg=«{msg[:90]}»")
    st, j, _, _ = requete(f"{ADMIN}/api/auth/signup", "POST", {
        "name": "RH Test 94", "email": "rh94@test.tn",
        "password": MDP_RH_1, "role": "RH", "code": "SERVICE RH-MAUVAIS1!"})
    check("C6  signup avec code d'activation INVALIDE → refusé",
          st in (400, 401, 403), f"status={st} msg=«{(j or {}).get('error', '')[:70]}»")
    st, j, _, h = requete(f"{ADMIN}/api/auth/signup", "POST", {
        "name": "RH Test 94", "email": "rh94@test.tn",
        "password": MDP_RH_1, "role": "RH", "code": CODE_ACTIVATION})
    check("C7  signup COMPLET (code valable + 4 familles) → 201",
          st == 201, f"status={st} {j}")
    st, j, _, h2 = requete(f"{ADMIN}/api/auth/signup", "POST", {
        "name": "RH Doublon", "email": "rh94@test.tn",
        "password": MDP_RH_2, "role": "IT", "code": CODE_ACTIVATION})
    check("C8  signup email DÉJÀ UTILISÉ → 409", st == 409, f"status={st}")

    # ---------- D. Changement de mot de passe (compte RH) ----------
    sect("D", "CHANGE-PASSWORD — POLITIQUE (compte RH)")
    st, j, _, h = requete(f"{ADMIN}/api/auth/login",
                          "POST", {"email": "rh94@test.tn", "password": MDP_RH_1})
    cookie_rh = extraire_cookie(h)
    check("D1  Connexion RH (compte créé en C7)", st == 200 and bool(cookie_rh), f"status={st}")
    st, j, _, _ = requete(f"{ADMIN}/api/auth/change-password", "POST",
                          {"currentPassword": MDP_RH_1, "newPassword": "faible94"},
                          cookie=cookie_rh)
    msg = (j or {}).get("error", "")
    check("D2  change-password faible → 400 + message français",
          st == 400 and ("fort" in msg or "8 caractères" in msg or "majuscule" in msg
                         or "symbole" in msg or "chiffre" in msg or "minuscule" in msg),
          f"status={st} msg=«{msg[:90]}»")
    st, j, _, _ = requete(f"{ADMIN}/api/auth/change-password", "POST",
                          {"currentPassword": MDP_RH_1, "newPassword": MDP_RH_2},
                          cookie=cookie_rh)
    check("D3  change-password CONFORME → 200", st == 200, f"status={st} {j}")
    st, j, _, h3 = requete(f"{ADMIN}/api/auth/login",
                           "POST", {"email": "rh94@test.tn", "password": MDP_RH_2})
    check("D4  Reconnexion RH avec le NOUVEAU mot de passe", st == 200, f"status={st}")

    # ---------- E. Réinitialisation par le superadmin ----------
    sect("E", "RÉINITIALISATION PAR SUPERADMIN (users/[id]/password)")
    st, j, _, _ = requete(f"{ADMIN}/api/users", cookie=cookie_admin)
    users = (j or {}).get("users", j if isinstance(j, list) else [])
    rh = next((u for u in users if (u or {}).get("email") == "rh94@test.tn"), None)
    check("E1  Liste des utilisateurs accessible (RH trouvé)", bool(rh), f"{len(users)} utilisateur(s)")
    if rh:
        uid = rh["id"]
        st, j, _, _ = requete(f"{ADMIN}/api/users/{uid}/password", "POST",
                              {"password": "faible94"}, cookie=cookie_admin)
        msg = (j or {}).get("error", "")
        check("E2  Réinitialisation FAIBLE → 400 + message français",
              st == 400 and ("fort" in msg or "8 caractères" in msg or "symbole" in msg
                             or "majuscule" in msg or "minuscule" in msg or "chiffre" in msg),
              f"status={st} msg=«{msg[:90]}»")
        st, j, _, _ = requete(f"{ADMIN}/api/users/{uid}/password", "POST",
                              {"password": "RhReinit94!z"}, cookie=cookie_admin)
        check("E3  Réinitialisation CONFORME → 200", st == 200, f"status={st} {j}")

    # ---------- F. Portail employés : accès + politique initiale ----------
    sect("F", "PORTAIL — ACCÈS EMPLOYÉ + MOT DE PASSE INITIAL")
    st, j, _, _ = requete(f"{ADMIN}/api/portal-access", "POST",
                          {"action": "create", "cin": "0999988776"}, cookie=cookie_admin)
    mdp_initial_1 = (j or {}).get("initialPassword", "")
    acces_1 = (j or {}).get("access", {}).get("id")
    check("F1  Création accès CIN 0999988776 → mot de passe initial 12 car. (3×4)",
          st == 200 and re.fullmatch(r"[A-Za-z0-9!@#$%*+=?]{4}-[A-Za-z0-9!@#$%*+=?]{4}-[A-Za-z0-9!@#$%*+=?]{4}", mdp_initial_1) is not None,
          f"status={st} initial=«{mdp_initial_1}»")
    check("F2  Mot de passe initial conforme aux 4 familles",
          bool(regex_4_familles(mdp_initial_1)), f"«{mdp_initial_1}»")

    st, j, _, _ = requete(f"{PORTAL}/api/verify", "POST",
                          {"cin": "0999988776", "password": mdp_initial_1, "otp": ""})
    check("F3  /api/verify (CIN + initial, sans OTP) → parcours PREMIÈRE connexion (premiere=true)",
          st == 200 and (j or {}).get("premiere") is True, f"status={st} {j}")

    st, j, _, _ = requete(f"{PORTAL}/api/premiere", "POST",
                          {"cin": "0999988776", "password": mdp_initial_1,
                           "newPassword": "faible94", "confirm": "faible94"})
    msg = (j or {}).get("error", "")
    check("F4  /api/premiere mot de passe personnel FAIBLE → 400 + français",
          st == 400 and ("fort" in msg or "8 caractères" in msg or "majuscule" in msg
                         or "minuscule" in msg or "chiffre" in msg or "symbole" in msg),
          f"status={st} msg=«{msg[:90]}»")
    st, j, _, _ = requete(f"{PORTAL}/api/premiere", "POST",
                          {"cin": "0999988776", "password": mdp_initial_1,
                           "newPassword": "Employe94!perso", "confirm": "Employe94!perso"})
    check("F5  /api/premiere mot de passe personnel CONFORME → accepté (étape QR ensuite)",
          st == 200, f"status={st} {str(j)[:110]}")

    # ---------- G. SMTP : serveur personnalisé ----------
    sect("G", "SMTP PERSONNALISÉ — VALIDATION API + ENVOIS RÉELS")
    cfg_ok = {"host": SMTP_HOST, "port": SMTP_PORT_OK, "secure": False,
              "username": SMTP_USER, "password": SMTP_PASS, "from": SMTP_FROM,
              "portailUrl": PORTAIL_URL_CFG}
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT", cfg_ok, cookie=cookie_admin)
    check("G1  PUT config SMTP (login simple «service_rh_mail», port 2525) → enregistrée",
          st == 200 and (j or {}).get("config", {}).get("username") == SMTP_USER,
          f"status={st} username={str((j or {}).get('config', {}).get('username'))}")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT",
                          dict(cfg_ok, username="mon user espacé"), cookie=cookie_admin)
    check("G2  PUT login AVEC ESPACE → 400 refusé",
          st == 400, f"status={st} msg=«{(j or {}).get('error', '')[:70]}»")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT",
                          dict(cfg_ok, port=465, secure=False), cookie=cookie_admin)
    st, jg, _, _ = requete(f"{ADMIN}/api/mail-config", cookie=cookie_admin)
    cfg_get = jg if isinstance(jg, dict) else {}
    secure_effectif = cfg_get.get("secure", cfg_get.get("config", {}).get("secure"))
    check("G3  Port 465 → SSL/TLS FORCÉ côté API (secure=true en lecture)",
          secure_effectif is True, f"secure={secure_effectif}")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT", cfg_ok, cookie=cookie_admin)
    check("G4  Restauration config port 2525", st == 200, f"status={st}")

    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "POST",
                          {"action": "test", "dest": "test94@exemple.tn"}, cookie=cookie_admin)
    time.sleep(0.6)
    recu = puits[0].messages
    check("G5  E-mail de test ENVOYÉ et REÇU par le serveur SMTP local (auth login simple)",
          st == 200 and len(recu) >= 1, f"status={st} reçus={len(recu)}")

    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT",
                          dict(cfg_ok, port=SMTP_PORT_KO), cookie=cookie_admin)
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "POST",
                          {"action": "test", "dest": "test94@exemple.tn"}, cookie=cookie_admin)
    msg = str((j or {}).get("error", ""))
    check("G6  Mauvais identifiants → erreur 535 du serveur AFFICHÉE à l'UI",
          st in (400, 502) and "535" in msg, f"status={st} msg=«{msg[:100]}»")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT", cfg_ok, cookie=cookie_admin)

    # ---------- H. E-mail « Envoyer l'e-mail » ALLÉGÉ ----------
    sect("H", "E-MAIL ALLÉGÉ (sans CIN / serveur / port) + envoi réel")
    st, j, _, _ = requete(f"{ADMIN}/api/portal-access", "POST",
                          {"action": "create", "cin": "0888877665"}, cookie=cookie_admin)
    mdp_initial_2 = (j or {}).get("initialPassword", "")
    acces_2 = (j or {}).get("access", {}).get("id")
    check("H1  Création 2e accès (CIN 0888877665)", st == 200 and bool(acces_2),
          f"status={st} initial=«{mdp_initial_2}»")
    n_avant = len(puits[0].messages)
    st, j, _, _ = requete(f"{ADMIN}/api/portal-access", "POST",
                          {"action": "send-mail", "id": acces_2,
                           "dest": "employe088@exemple.tn"}, cookie=cookie_admin)
    time.sleep(0.6)
    check("H2  send-mail → 200, e-mail parti vers le SMTP réel",
          st == 200 and len(puits[0].messages) == n_avant + 1,
          f"status={st} msg=«{str((j or {}).get('message', ''))[:70]}»")
    corps = puits[0].messages[-1]["data"] if len(puits[0].messages) > n_avant else ""
    check("H3  L'e-mail CONTIENT l'adresse d'accès au portail",
          PORTAIL_URL_CFG in corps, PORTAIL_URL_CFG)
    check("H4  L'e-mail CONTIENT le mot de passe initial",
          mdp_initial_2 in corps, f"«{mdp_initial_2}»")
    check("H5  L'e-mail NE contient PAS le CIN de l'employé", "0888877665" not in corps)
    check("H6  L'e-mail NE contient PAS le port du site (4400)", "4400" not in corps)
    check("H7  L'e-mail NE contient PAS la ligne « Serveur : »", not re.search(r"Serveur\s*:", corps))
    ligne_sujet = next((l for l in corps.splitlines() if l.lower().startswith("subject:")), "")
    check("H8  Objet de l'e-mail = «Vos accès au portail des fiches de paie…»",
          ("vos acc" in ligne_sujet.lower()) or ("=?utf-8" in ligne_sujet.lower() and "vos_acc" in ligne_sujet.lower().replace("=?utf-8?q?", "")),
          ligne_sujet[:80])
    st, j, _, _ = requete(f"{ADMIN}/api/portal-access", "POST",
                          {"action": "send-mail", "id": acces_1,
                           "dest": "employe099@exemple.tn"}, cookie=cookie_admin)
    msg = str((j or {}).get("code", "")) + " " + str((j or {}).get("error", ""))
    check("H9  send-mail pour un employé ayant DÉJÀ son mot de passe → 409 MOT_DE_PASSE_INDISPONIBLE",
          st == 409 and "MOT_DE_PASSE_INDISPONIBLE" in msg, f"status={st}")

    # ---------- I. Puits SSL (port 465 simulé 2465) ----------
    sect("I", "SSL/TLS DIRECT (port 465 simulé) + certificat auto-signé")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT",
                          dict(cfg_ok, port=SMTP_PORT_SSL, secure=True), cookie=cookie_admin)
    n_avant = len(puits[2].messages)
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "POST",
                          {"action": "test", "dest": "ssl94@exemple.tn"}, cookie=cookie_admin)
    time.sleep(0.8)
    check("I1  Envoi via SSL/TLS + certificat auto-signé → accepté (rejectUnauthorized:false)",
          st == 200 and len(puits[2].messages) == n_avant + 1,
          f"status={st} reçus_ssl={len(puits[2].messages) - n_avant} msg=«{str((j or {}).get('error', ''))[:80]}»")
    st, j, _, _ = requete(f"{ADMIN}/api/mail-config", "PUT", cfg_ok, cookie=cookie_admin)

    # ---------- J. Libellés français (bundles construits) ----------
    sect("J", "LIBELLÉS FRANÇAIS DANS LES BUNDLES CONSTRUITS")
    # IMPORTANT : ne lire QUE les chunks de l'application (client + serveur),
    # JAMAIS les node_modules copiés dans standalone (~1 Go) ni les polices.
    racines_js = [
        os.path.join(SANDBOX, ".next/static"),
        os.path.join(SANDBOX, ".next/standalone/sandbox-task94-testzip/extracted/.next/static"),
        os.path.join(SANDBOX, ".next/standalone/sandbox-task94-testzip/extracted/.next/server/app"),
        os.path.join(SANDBOX, ".next/standalone/sandbox-task94-testzip/extracted/.next/server/chunks"),
    ]
    chunks = []
    for rac in racines_js:
        if os.path.isdir(rac):
            for r2, _, fs in os.walk(rac):
                for f in fs:
                    if f.endswith((".js", ".html", ".rsc")) and os.path.getsize(os.path.join(r2, f)) < 20_000_000:
                        chunks.append(os.path.join(r2, f))
    texte_total = ""
    for c in chunks:
        try:
            texte_total += open(c, encoding="utf-8", errors="ignore").read()
        except Exception:
            pass
    check("J0  Bundles application analysés (hors node_modules)", len(chunks) > 10,
          f"{len(chunks)} fichiers, {len(texte_total) // 1024} Ko")
    check("J1  «Envoyer l'e-mail» présent dans les bundles (boutons traduits)",
          "Envoyer l'e-mail" in texte_total or "Envoyer l\\'e-mail" in texte_total)
    check("J2  Aucun libellé visible «Send Mail» / «Send» dans les bundles",
          "Send Mail" not in texte_total and ">Send<" not in texte_total)
    check("J3  Règle du mot de passe affichée (8 caractères + 4 familles) dans les bundles",
          ("8 caractères minimum" in texte_total) or ("8 caract" in texte_total))

    # ---------- K. Scripts CLI : codes d'activation ----------
    sect("K", "SCRIPTS CLI — GÉNÉRATION/VÉRIFICATION DU CODE D'ACTIVATION")
    r = subprocess.run(["node", "scripts/gen-signup-code.js", "--hash", "SERVICE RH-8C5T-VGTL"],
                       cwd=SANDBOX, capture_output=True, text=True, env=env_node,
                       stdin=subprocess.DEVNULL, timeout=60)
    s = r.stdout + r.stderr
    check("K1  --hash code HISTORIQUE faible (sans minuscule) → REFUSÉ",
          "minuscule" in s, s.strip().splitlines()[-1][:80] if s.strip() else "")
    r = subprocess.run(["node", "scripts/gen-signup-code.js", "--code"],
                       cwd=SANDBOX, capture_output=True, text=True, env=env_node,
                       stdin=subprocess.DEVNULL, timeout=60)
    s = r.stdout + r.stderr
    m = re.search(r"SERVICE RH-[A-Za-z0-9!@#$%*+=?]{5}-[A-Za-z0-9!@#$%*+=?]{5}", s)
    check("K2  --code génère un code fort SERVICE RH-xxxxx-xxxxx", bool(m),
          m.group(0) if m else s.strip().splitlines()[-1][:80] if s.strip() else "")
    if m:
        gen = m.group(0)
        check("K3  Le code généré satisfait les 4 familles", regex_4_familles(gen), gen)
    r = subprocess.run(["node", "scripts/gen-signup-code.js", "--verifier", "auto-rh-test94!"],
                       cwd=SANDBOX, capture_output=True, text=True,
                       env=dict(env, DATABASE_URL=DB),
                       stdin=subprocess.DEVNULL, timeout=60)
    s = r.stdout + r.stderr
    check("K4  --verifier confirme le code du .env (tolérant à la casse)",
          "CE CODE EST LE BON" in s,
          [l for l in s.splitlines() if "CODE EST" in l or "✘" in l or "✗" in l][:1] or [s.strip().splitlines()[-1][:80]])

    # ---------- L. Sécurité de base ----------
    sect("L", "SÉCURITÉ DE BASE")
    st, _, _, _ = requete(f"{ADMIN}/api/users", cookie=None)
    check("L1  /api/users sans session → refusé", st in (401, 403), f"status={st}")
    st, _, _, _ = requete(f"{ADMIN}/api/mail-config", cookie=None)
    check("L2  /api/mail-config sans session → refusé", st in (401, 403), f"status={st}")
    st, j, _, _ = requete(f"{PORTAL}/api/verify", "POST", {"cin": "inconnu", "password": "Xy9!abcde", "otp": ""})
    check("L3  Portail : CIN inconnu → refusé sans énumération", st in (401, 400), f"status={st}")

    # ---------- M. Fichier parasite du ZIP ----------
    sect("M", "CONTENU DU ZIP — ANOMALIES MINEURES")
    parasite = os.path.join(SANDBOX, "home/z/my-project/scripts/apply_specimen_update.py")
    check("M1  Fichier parasite «home/z/my-project/scripts/…» présent dans le ZIP (à signaler)",
          os.path.exists(parasite), "inoffensif mais inutile — hors arbre du projet")


def main():
    try:
        ok, env, puits, code_hash = preparer()
    except Exception as e:
        print(f"!! EXCEPTION pendant la préparation : {e!r}")
        return 1
    if not ok:
        tout_arreter(puits)
        return 1

    try:
        exec_sections(env, puits)
    except Exception as e:
        check("EXCEPTION pendant les tests", False, repr(e))
    tout_arreter(puits)

    # ----- rapport -----
    print("\n" + "=" * 70)
    print("RAPPORT FINAL — ZIP « auto-rh-scripts-site-web-CORRIGE (1).zip »")
    print("=" * 70)
    total = len(results)
    passes = sum(1 for _, okk, _ in results if okk)
    for nom, okk, detail in results:
        print(f"  [{'PASS' if okk else 'FAIL'}] {nom}" + (f" — {detail}" if detail else ""))
    print(f"\n  TOTAL : {passes}/{total} tests réussis")
    print("=" * 70)
    return 0 if passes == total else 2


if __name__ == "__main__":
    sys.exit(main())
