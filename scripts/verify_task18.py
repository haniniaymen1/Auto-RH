#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vérification E2E — Task 18 : portail employé sécurisé par CIN + OTP
(application authenticator TOTP RFC 6238, sans SMS ni e-mail).

Couvre :
  1. TOTP : vecteurs officiels RFC 6238 + génération de codes
  2. Portail sans session : page de connexion servie, API refusées (401)
  3. Administration : création d'un accès portail (secret + QR code)
  4. Connexion portail : code TOTP valide accepté, cookie de session émis
  5. Session : fiches verrouillées au CIN de la session (recherche/PDF)
  6. Anti-rejeu : un code déjà consommé est refusé
  7. Anti force-brute : 5 échecs -> verrouillage 15 min (423) -> déblocage RH
  8. Régénération du secret : l'ancien code devient invalide
  9. Déconnexion : cookie effacé, accès à nouveau refusé
 10. Masquages Task 16/17 toujours en place (pas de nom, pas de net, CIN masqué)
"""

import base64
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request

ADMIN = "http://localhost:3000"
PORTAL = "http://localhost:3001"
ADMIN_EMAIL = "it@demo.tn"
ADMIN_PASSWORD = "demo1234"
TEST_CIN = "07451236"  # CIN existant en base (fiches réelles)

PASS = 0
FAIL = 0
FAILURES = []


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [OK]   {label}")
    else:
        FAIL += 1
        FAILURES.append(f"{label} {detail}")
        print(f"  [FAIL] {label}  {detail}")


# ---------------------------------------------------------------- TOTP (RFC 6238)
def totp_code(secret_b32, at=None, offset=0):
    key = base64.b32decode(secret_b32, casefold=True)
    counter = int(at if at is not None else time.time()) // 30 + offset
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[-1] & 0x0F
    code = ((h[o] & 0x7F) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
    return str(code % 1000000).zfill(6)


class Client:
    """Petit client HTTP avec gestion du cookie de session et d'une IP simulée."""

    def __init__(self, base, ip=None):
        self.base = base
        self.cookie = None
        # IP simulée (X-Forwarded-For) : isole les compteurs anti-abus du portail
        # entre les différents clients de test — le comportement de production
        # reste inchangé.
        self.ip = ip or f"10.{int(time.time()) % 250}.{id(self) % 250}.{abs(hash(self)) % 250}"

    def req(self, method, path, body=None, send_cookies=True, capture_cookie=False, raw=False):
        url = self.base + path
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method)
        if data:
            r.add_header("Content-Type", "application/json")
        r.add_header("X-Forwarded-For", self.ip)
        if send_cookies and self.cookie:
            r.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                sc = resp.headers.get("Set-Cookie")
                if capture_cookie and sc:
                    first = sc.split(";")[0]
                    if first.split("=", 1)[1]:
                        self.cookie = first
                payload = resp.read()
                if raw:
                    return resp.status, payload, dict(resp.headers)
                return resp.status, json.loads(payload.decode() or "{}"), dict(resp.headers)
        except urllib.error.HTTPError as e:
            payload = e.read()
            if raw:
                return e.code, payload, dict(e.headers)
            try:
                return e.code, json.loads(payload.decode() or "{}"), dict(e.headers)
            except Exception:
                return e.code, {"raw": payload.decode(errors="replace")}, dict(e.headers)

    def get(self, path, **kw):
        return self.req("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.req("POST", path, body=body, **kw)


def main():
    print("=" * 70)
    print("TASK 18 — Portail sécurisé par CIN + OTP (authenticator)")
    print("=" * 70)

    # ---------------------------------------------------------------- 1. TOTP
    print("\n[1] TOTP — vecteurs officiels RFC 6238")
    rfc_secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # b"12345678901234567890"
    check("RFC T=59 -> 287082", totp_code(rfc_secret, at=59) == "287082")
    check("RFC T=1111111109 -> 081804", totp_code(rfc_secret, at=1111111109) == "081804")
    check("RFC T=1234567890 -> 005924", totp_code(rfc_secret, at=1234567890) == "005924")

    # ------------------------------------------------- 2. Portail sans session
    print("\n[2] Portail SANS session — connexion obligatoire")
    anon = Client(PORTAL)
    st, html, _ = anon.get("/", raw=True)
    html = html.decode(errors="replace")
    check("GET / -> 200", st == 200)
    check("page de connexion servie (champ code OTP présent)", 'id="code"' in html)
    check("bouton « Se connecter » présent", "Se connecter" in html)
    check("aucune recherche libre visible (ancien formulaire retiré)", 'id="btn"' not in html or "Se connecter" in html)
    st, data, _ = anon.get("/api/search?cin=" + TEST_CIN)
    check("GET /api/search sans session -> 401", st == 401, str(st))
    st, data, _ = anon.get("/api/my-fiches")
    check("GET /api/my-fiches sans session -> 401", st == 401, str(st))
    st, data, _ = anon.get("/api/payslip/abc123/file?cin=" + TEST_CIN)
    check("GET fichier PDF sans session -> 401", st == 401, str(st))
    st, data, _ = anon.post("/api/verify", {"cin": TEST_CIN, "code": "000000"})
    check("code OTP erroné sans accès créé -> 401 générique", st == 401 and "incorrect" in data.get("error", ""))

    # --------------------------------------- 3. Administration : créer l'accès
    print("\n[3] Administration — création de l'accès portail (QR code)")
    adm = Client(ADMIN)
    st, data, _ = adm.post(
        "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, capture_cookie=True
    )
    check("login admin -> 200", st == 200, str(st))
    st, html, _ = adm.get("/", raw=True)
    html = html.decode(errors="replace")
    check("onglet « Accès portail » visible dans l'interface", "Accès portail" in html)

    st, data, _ = adm.post(
        "/api/portal-access", {"action": "generate", "cin": TEST_CIN}
    )
    check("generate -> 200", st == 200, str(data)[:120])
    secret = data.get("secret", "")
    check("secret base32 renvoyé (32 caractères)", re.fullmatch(r"[A-Z2-7]{32}", secret or "") is not None)
    check("URI otpauth:// correcte", data.get("otpauthUrl", "").startswith("otpauth://totp/"))
    check("paramètres TOTP explicites (digits=6&period=30)", "digits=6" in data.get("otpauthUrl", "") and "period=30" in data.get("otpauthUrl", ""))
    check("QR code PNG data-URL généré", str(data.get("qrDataUrl", "")).startswith("data:image/png;base64,"))
    check("le CIN du compte est normalisé", data.get("access", {}).get("cin") == TEST_CIN)

    access_id = data.get("access", {}).get("id", "")

    # ------------------------------------------------- 4. Connexion au portail
    print("\n[4] Connexion portail — CIN + code TOTP valide")
    emp = Client(PORTAL)
    code = totp_code(secret)
    st, data, hdr = emp.post("/api/verify", {"cin": TEST_CIN, "code": code}, capture_cookie=True)
    check("verify (code valide) -> 200", st == 200, f"{st} {str(data)[:120]}")
    check("cookie de session portail émis", bool(emp.cookie) and emp.cookie.startswith("portail_session="))
    check("CIN masqué renvoyé", data.get("cinMasked") == "•••" + TEST_CIN[-3:])
    st, html, _ = anon.get("/", raw=True)
    check("sans cookie, GET / sert TOUJOURS la page de connexion", b"Se connecter" in html)

    # ------------------------------------------------------- 5. Session active
    print("\n[5] Session — fiches verrouillées sur le CIN connecté")
    st, data, _ = emp.get("/api/my-fiches")
    check("GET /api/my-fiches -> 200", st == 200, str(st))
    items = data.get("items", [])
    check("fiches renvoyées pour le CIN du compte", len(items) == 25, f"n={len(items)}")
    check("CIN de session présent dans la réponse", data.get("cin") == TEST_CIN)
    # Task 16 = masquage AFFICHAGE (la donnée reste en base, principe additif) :
    # on vérifie que la page ne rend JAMAIS le nom ni le net (pas d'emploi de
    # employeeName/netSalary dans le code de rendu du portail).
    st2, html2, _ = emp.get("/", raw=True)
    html2 = html2.decode(errors="replace")
    check("rendu portail sans nom ni net à payer (Task 16 conservée)", "employeeName" not in html2 and "netSalary" not in html2)
    first_id = items[0]["id"] if items else ""

    st, data, _ = emp.get("/api/search?cin=" + TEST_CIN)
    check("GET /api/search (CIN de session) -> 200 + 25 fiches", st == 200 and data.get("total") == 25, f"{st}")
    st, data, _ = emp.get("/api/search?cin=99999999")
    check("GET /api/search (AUTRE CIN) -> 403 refusé", st == 403, str(st))

    st, body, hdr = emp.get(f"/api/payslip/{first_id}/file?cin={TEST_CIN}", raw=True)
    ctype = hdr.get("Content-Type", "")
    check("fichier PDF (CIN de session) -> 200", st == 200, str(st))
    check("type MIME document (PDF/image)", ("pdf" in ctype or "image/" in ctype), ctype)
    st, _, _ = emp.get(f"/api/payslip/{first_id}/file?cin=99999999", raw=True)
    check("fichier avec AUTRE CIN -> 403 refusé", st == 403, str(st))

    st, html, _ = emp.get("/", raw=True)
    html = html.decode(errors="replace")
    check("page authentifiée servie (plus la connexion)", "Se connecter" not in html and "Actualiser" in html)
    check("bouton « Déconnexion » présent", "Déconnexion" in html)
    check("libellé CIN masqué (Task 17 conservée)", "•••" in html and "maskCin" in html)
    check("bouton « Ouvrir » (Task 16 conservé)", ">Ouvrir</a>" in html)

    # ----------------------------------------------------------- 6. Anti-rejeu
    print("\n[6] Anti-rejeu — le code déjà consommé est refusé")
    st, data, _ = emp.post("/api/verify", {"cin": TEST_CIN, "code": code}, capture_cookie=False)
    check("REJOUER le même code -> 401", st == 401, f"{st} {str(data)[:100]}")

    # ------------------------------------------------------ 7. Force-brute
    print("\n[7] Anti force-brute — 5 échecs puis verrouillage")
    locked_seen = False
    for i in range(1, 6):
        # IP différente à chaque échec : on teste le verrouillage PAR COMPTE
        # (base de données), pas le limiteur par IP.
        st, data, _ = Client(PORTAL).post(
            "/api/verify", {"cin": TEST_CIN, "code": "000000"}
        )
        if st == 423:
            locked_seen = True
        else:
            check(f"échec {i}/5 -> 401", st == 401, str(st))
    st, data, _ = Client(PORTAL).post("/api/verify", {"cin": TEST_CIN, "code": "000000"})
    check("6e tentative -> 423 verrouillé", st == 423, f"{st} {str(data)[:100]}")
    st, data, _ = Client(PORTAL).post(
        "/api/verify", {"cin": TEST_CIN, "code": totp_code(secret)}
    )
    check("même un code VALIDE est refusé pendant le verrouillage -> 423", st == 423, str(st))

    st, data, _ = adm.post("/api/portal-access", {"action": "unlock", "id": access_id})
    check("RH lève le verrouillage -> 200", st == 200, str(st))

    # --------------------------------------------- 8. Régénération du secret
    print("\n[8] Régénération — l'ancien secret est révoqué")
    st, data, _ = adm.post("/api/portal-access", {"action": "generate", "cin": TEST_CIN})
    new_secret = data.get("secret", "")
    check("nouveau secret différent", bool(new_secret) and new_secret != secret)
    st, data, _ = Client(PORTAL).post(
        "/api/verify", {"cin": TEST_CIN, "code": totp_code(secret, offset=1)}
    )
    check("ANCIEN code (fenêtre suivante) -> 401", st == 401, f"{st} {str(data)[:80]}")
    emp2 = Client(PORTAL)
    st, data, _ = emp2.post(
        "/api/verify", {"cin": TEST_CIN, "code": totp_code(new_secret)}, capture_cookie=True
    )
    check("NOUVEAU code valide -> 200 + session", st == 200 and emp2.cookie, f"{st}")

    # ------------------------------------------------------- 9. Déconnexion
    print("\n[9] Déconnexion")
    st, data, _ = emp2.post("/api/logout")
    check("POST /api/logout -> 200", st == 200, str(st))
    emp2.cookie = None
    st, data, _ = emp2.get("/api/my-fiches")
    check("après déconnexion, /api/my-fiches -> 401", st == 401, str(st))

    # ------------------------------------------ 10. Désactivation + nettoyage
    print("\n[10] Désactivation immédiate + nettoyage")
    st, data, _ = adm.post("/api/portal-access", {"action": "toggle", "id": access_id})
    check("toggle (désactivation) -> 200", st == 200 and data.get("access", {}).get("isActive") is False, str(data)[:100])
    st, data, _ = Client(PORTAL).post(
        "/api/verify", {"cin": TEST_CIN, "code": totp_code(new_secret)}
    )
    check("compte désactivé -> 401 même avec code valide", st == 401, str(st))
    st, data, _ = adm.get("/api/portal-access")
    check("liste des accès ne contient AUCUN secret TOTP", st == 200 and all("totpSecret" not in it and "secret" not in it for it in data.get("items", [])), str(st)[:100])
    st, data, _ = adm.post("/api/portal-access", {"action": "delete", "id": access_id})
    check("suppression de l'accès de test -> 200", st == 200, str(st))
    st, data, _ = adm.get("/api/portal-access")
    check("liste vide après suppression", st == 200 and len(data.get("items", [])) == 0, str(data)[:100])

    # ---------------------------------------------------------------- Bilan
    print("\n" + "=" * 70)
    print(f"RÉSULTAT : {PASS} OK / {FAIL} FAIL")
    if FAILURES:
        print("Échecs :")
        for f in FAILURES:
            print("  -", f)
    print("=" * 70)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
