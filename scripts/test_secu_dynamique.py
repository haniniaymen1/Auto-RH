#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tests dynamiques NON destructifs de sécurité — Auto-RH 0.2.24
Cible : admin http://localhost:4000 + portail http://localhost:4001
Ne modifie AUCUNE donnée : uniquement des requêtes GET/POST refusées attendues.
"""
import json
import urllib.request
import urllib.error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)

BASE_A = "http://localhost:4000"
BASE_P = "http://localhost:4001"
resultats = []


def req(url, method="GET", data=None, headers=None, cookies=None):
    h = dict(headers or {})
    if cookies:
        h["Cookie"] = cookies
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with opener.open(r, timeout=15) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:  # connexion refusée etc.
        return 0, {}, str(e).encode()


def check(nom, ok, detail=""):
    resultats.append((nom, ok, detail))
    print(("PASS " if ok else "FAIL ") + nom + (" — " + detail if detail else ""))


# ============ A. API admin sans session -> 401 JSON ============
for ep in ["/api/users", "/api/payslips", "/api/portal-access", "/api/mail-config",
           "/api/auth/change-password", "/api/import-logs", "/api/dashboard"]:
    st, hd, bd = req(BASE_A + ep)
    try:
        j = json.loads(bd.decode("utf-8", "replace"))
        msg = j.get("error", "")[:60]
    except Exception:
        msg = bd[:60].decode("utf-8", "replace")
    check("A: %s sans session -> 401" % ep, st == 401, "%s %s" % (st, msg))

# ============ B. Falsification du cookie de session ============
st, hd, bd = req(BASE_A + "/api/users", cookies="auto_rh_session=abc.def")
check("B1: cookie falsifié (mauvaise signature) -> 401", st == 401, str(st))
st, hd, bd = req(BASE_A + "/api/users", cookies="auto_rh_session=eyJpZCI6IjEiLCJlbWFpbCI6ImFAYS5iIiwibmFtZSI6IkgiLCJyb2xlIjoiU1VQRVJBRE1JTiJ9.signature-inventee")
check("B2: token forgé sans vraie clé -> 401", st == 401, str(st))

# ============ C. Page protégée -> redirection /login ============
st, hd, bd = req(BASE_A + "/")
loc = hd.get("location", hd.get("Location", ""))
check("C1: / sans session -> 307 vers /login", st in (307, 302) and "/login" in loc, "%s -> %s" % (st, loc))
st, hd, bd = req(BASE_A + "/db/custom.db")
loc = hd.get("location", hd.get("Location", ""))
check("C2: /db/custom.db protégé (pas de fuite base)", st in (307, 302, 401, 404), "%s %s" % (st, loc))
st, hd, bd = req(BASE_A + "/.env")
try:
    corps = bd.decode("utf-8", "replace")
except Exception:
    corps = ""
fuite = ("AUTH_SECRET=" in corps and "scrypt" not in corps[:0]) or "SIGNUP_CODE_HASH=" in corps or "BEGIN RSA" in corps
check("C3: GET /.env ne divulgue AUCUN secret", not fuite, "status %s, %d octets" % (st, len(corps)))

# ============ D. Set-Cookie flags (signup avec code faux -> pas de cookie; on vérifie via login faux aussi) ============
# On ne crée PAS de compte : on vérifie les flags via la doc + un test sandbox séparé.
# Ici : vérifier que login en échec ne pose PAS de cookie de session.
st, hd, bd = req(BASE_A + "/api/auth/login", "POST",
                 {"email": "test-securite-inexistant@autorh.local", "password": "Xx1!aaaa"})
sc = hd.get("set-cookie", hd.get("Set-Cookie", "")) or ""
check("D1: login échoué -> 401 + AUCUN cookie posé", st == 401 and "auto_rh_session=" not in sc, "%s set-cookie=%r" % (st, sc[:50]))
try:
    j = json.loads(bd.decode())
    msg = j.get("error", "")
except Exception:
    msg = ""
check("D2: message d'erreur uniforme (pas d'énumération d'emails)",
      "Email ou mot de passe incorrect" in msg, msg[:60])

# ============ E. Portail sans auth ============
st, hd, bd = req(BASE_P + "/api/my-fiches")
check("E1: portail /api/my-fiches sans session -> 401", st == 401, str(st))
st, hd, bd = req(BASE_P + "/api/my-fiches", cookies="auto-rh_portail=tampered.sig")
check("E2: portail cookie falsifié -> 401", st == 401, str(st))
st, hd, bd = req(BASE_P + "/api/verify", "POST", {"cin": "X", "password": "Y"})
check("E3: /api/verify mauvais CIN -> refus (pas de fuite)", st in (401, 403, 400), str(st))

# ============ F. Path traversal sur le portail ============
st, hd, bd = req(BASE_P + "/fiches/..%2f..%2f..%2fdb%2fcustom.db")
check("F1: traversal /fiches/../../db/custom.db -> refusé", st in (400, 401, 403, 404), str(st))
st, hd, bd = req(BASE_P + "/api/fichier?nom=../../db/custom.db")
check("F2: traversal param fichier -> refusé", st in (400, 401, 403, 404), str(st))

# ============ G. Route publique download-scripts ============
st, hd, bd = req(BASE_A + "/api/download-scripts")
ct = hd.get("content-type", hd.get("Content-Type", ""))
check("G1: /api/download-scripts public -> 200 application/zip", st == 200 and "zip" in ct, "%s %s" % (st, ct))
md5ok = __import__("hashlib").md5(bd).hexdigest()
check("G2: ZIP servi = ZIP public (MD5)", md5ok == "084443a4609aa64e7ffb997847ac1862", md5ok)

# ============ H. Méthodes HTTP ============
st, hd, bd = req(BASE_A + "/api/auth/login", "GET")
check("H1: GET sur /api/auth/login -> 405", st == 405, str(st))

# ============ Résumé ============
nb_ok = sum(1 for _, ok, _ in resultats if ok)
print()
print("TOTAL: %d/%d PASS" % (nb_ok, len(resultats)))
with open("/home/z/my-project/sandbox-securite/resultats-dynamiques.txt", "w") as f:
    for nom, ok, detail in resultats:
        f.write(("%s | %s | %s\n" % ("PASS" if ok else "FAIL", nom, detail)))
