#!/usr/bin/env python3
"""
Task 81 — SONDE DE DIAGNOSTIC (COPIE de base, portail de test only).
Rejoue le parcours EXACT signalé par l'utilisateur :
  1re connexion (CIN + mot de passe) → page QR seule (scan) → DÉCONNATION
  (POST /api/logout) → RECONNEXION (mêmes identifiants) → ???
et variantes (sans logout, cookie conservé ; expiration du défi ; etc.).
Chaque étape affiche le code HTTP + réponse pour diagnostic.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SB = os.path.join(RACINE, "sandbox-dbg81")
PORT = 4232
BASE = f"http://127.0.0.1:{PORT}"
CIN = "TEST64CIN"
MDP_INIT = "Initial64x"

def req(method, path, body=None, timeout=15):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("Cookie", CJ.header_output() or "")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, resp.headers.get_all("Set-Cookie") or [], raw
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get_all("Set-Cookie") or [], e.read().decode("utf-8", "replace")

class Jar:
    def __init__(self):
        self.cookies = {}
    def absorb(self, set_cookies):
        for sc in set_cookies:
            first = sc.split(";")[0]
            if "=" in first:
                k, v = first.split("=", 1)
                if v == "":
                    self.cookies.pop(k.strip(), None)
                else:
                    self.cookies[k.strip()] = v.strip()
    def header_output(self):
        return "; ".join(f"{k}={v}" for k, v in self.cookies.items())

CJ = Jar()

def etape(n, titre):
    print(f"\n=== ÉTAPE {n} : {titre} ===")

def montrer(code, raw):
    try:
        j = json.loads(raw)
        print(f"  → HTTP {code} : {json.dumps(j, ensure_ascii=False)[:400]}")
        return j
    except Exception:
        print(f"  → HTTP {code} (HTML, {len(raw)} octets)")
        return None

def main():
    subprocess.run(["rm", "-rf", SB], check=True)
    os.makedirs(SB, exist_ok=True)
    subprocess.run(["cp", os.path.join(RACINE, "db/custom.db"), os.path.join(SB, "test81.db")], check=True)
    env = dict(os.environ)
    with open(os.path.join(RACINE, ".env")) as f:
        for ligne in f:
            ligne = ligne.strip()
            if ligne and not ligne.startswith("#") and "=" in ligne:
                k, v = ligne.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    env["DATABASE_URL"] = f"file:{SB}/test81.db"
    env["PORTAL_PORT"] = str(PORT)
    env["HOSTNAME"] = "127.0.0.1"

    for op in (["inserer"], ["user"]):
        subprocess.run(["node", "scripts/test64_inserer.js"] + op, cwd=RACINE, env=env, check=True)

    log = open(os.path.join(SB, "portail.log"), "w")
    srv = subprocess.Popen(["node", "scripts/portail-server.js"], cwd=RACINE, env=env,
                           stdout=log, stderr=subprocess.STDOUT)
    try:
        ok = False
        for _ in range(60):
            try:
                c, _, _ = req("GET", "/")
                if c == 200:
                    ok = True
                    break
            except Exception:
                pass
            time.sleep(1)
        if not ok:
            print("PORTAIL DE TEST KO")
            return 1
        print(f"Portail de test démarré sur {BASE}")

        etape(1, "1re connexion : POST /api/verify (CIN + mot de passe initial)")
        code, sc, raw = req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
        CJ.absorb(sc)
        j1 = montrer(code, raw)

        etape(2, "GET /otp → page QR SEULE (le verrou qrPresente est posé)")
        code, sc, raw = req("GET", "/otp")
        CJ.absorb(sc)
        print(f"  → HTTP {code} ; contient otp-qr-seul : {'otp-qr-seul' in raw} ; contient QR : {'data-payload' in raw}")
        j = req("GET", "/otp")[2]
        time.sleep(0.5)

        etape("2b", "État base après affichage QR (qrPresente/lastLoginAt/passwordHash présents)")
        out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", CIN], cwd=RACINE, env=env,
                             capture_output=True, text=True)
        print("  " + (out.stdout.strip().replace("\n", "\n  ") or out.stderr.strip()[:300]))

        etape(3, "L'utilisateur SE DÉCONNECTE : POST /api/logout")
        code, sc, raw = req("POST", "/api/logout")
        CJ.absorb(sc)
        montrer(code, raw)

        etape(4, "RECONNEXION : POST /api/verify (MÊMES identifiants) — LE POINT SIGNALÉ")
        code, sc, raw = req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
        CJ.absorb(sc)
        j4 = montrer(code, raw)

        etape(5, "2e déconnexion + reconnexion (répétition du parcours)")
        code, sc, raw = req("POST", "/api/logout")
        CJ.absorb(sc)
        code, sc, raw = req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
        CJ.absorb(sc)
        j5 = montrer(code, raw)

        etape(6, "Poursuite normale : GET /otp → page de confirmation (sans QR)")
        code, sc, raw = req("GET", "/otp")
        CJ.absorb(sc)
        import re
        m = re.search(r'data-code="([0-9]{6})"', raw) or re.search(r'code affiché[^0-9]*([0-9]{6})', raw)
        codeotp = m.group(1) if m else None
        if not codeotp:
            m2 = re.findall(r'[0-9]{6}', raw)
            codeotp = m2[0] if m2 else None
        print(f"  → HTTP {code} ; QR absent : {'data-payload' not in raw} ; code trouvé : {codeotp}")

        etape(7, "POST /api/otp/verify avec le code (1re connexion COMPLÈTE)")
        code, sc, raw = req("POST", "/api/otp/verify", {"otp": codeotp})
        CJ.absorb(sc)
        j7 = montrer(code, raw)

        etape(8, "Changement obligatoire du mot de passe (mustChangePassword)")
        nouveau = "Nouveau81x!"
        code, sc, raw = req("POST", "/api/change-password", {"currentPassword": MDP_INIT, "newPassword": nouveau})
        CJ.absorb(sc)
        montrer(code, raw)

        etape(9, "Déconnexion puis reconnexion avec le NOUVEAU mot de passe")
        req("POST", "/api/logout")
        code, sc, raw = req("POST", "/api/verify", {"cin": CIN, "password": nouveau})
        CJ.absorb(sc)
        montrer(code, raw)

        etape(10, "Reconnexion avec l'ANCIEN mot de passe initial (contrôle du message)")
        req("POST", "/api/logout")
        code, sc, raw = req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
        CJ.absorb(sc)
        montrer(code, raw)

        print("\n=== FIN SONDE ===")
        return 0
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
        log.close()

if __name__ == "__main__":
    sys.exit(main())
