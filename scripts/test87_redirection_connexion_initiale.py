#!/usr/bin/env python3
"""
Task 87 — après la fenêtre « Configuration réussie », retour à la FENÊTRE
INITIALE de connexion (« apres cette fenetre derige vers fenetre initial
(cin, mot de passe, otp) »).

AVANT (v0.2.16) : la page /premiere-reussie laissait la session d'inscription
OUVERTE — la redirection automatique (5 s) et le bouton « Accéder au portail »
menaient directement au portail (fiches), sans jamais re-passer par la
connexion.

APRÈS (v0.2.17) :
  - la session créée par l'inscription est FERMÉE au moment où la page est
    servie (cookie portail_session effacé) ;
  - le texte annonce la fenêtre de connexion (CIN, mot de passe et code OTP) ;
  - la redirection automatique (5 s) ET le bouton « Aller à la page de
    connexion » mènent à /login ;
  - l'employé re-saisit CIN + mot de passe + code OTP pour entrer au portail :
    le parcours complet d'authentification à deux facteurs est validé DÈS la
    première connexion.

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test87_harnais.sh, portail de test 4261) : sections 0/A ci-dessous.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "/home/z/my-project"
RACINE = BASE
PORTAIL = BASE + "/scripts/portail-server.js"
PKG = BASE + "/package.json"
P1 = "http://127.0.0.1:4261"          # portail employés de test (TTL normal)
DB_COPIE = BASE + "/sandbox-test87/test87.db"

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(("OK  " if cond else "KO  ") + nom + ("" if cond else "  -> " + str(detail)[:220]))


def bilan(nom):
    total = len(RESULTATS)
    verts = sum(RESULTATS)
    print("=" * 76)
    print(f"{nom} : {verts}/{total}")
    print("=" * 76)
    return 0 if verts == total else 1


def totp_now(secret_b32, t=None, pas=30):
    """RFC 6238 SHA-1, 6 chiffres — même algorithme que les applications."""
    if t is None:
        t = int(time.time())
    cle = base64.b32decode(secret_b32 + "=" * ((8 - len(secret_b32) % 8) % 8))
    c = (t // pas).to_bytes(8, "big")
    mac = hmac.new(cle, c, hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    code = ((mac[o] & 0x7F) << 24 | mac[o + 1] << 16 | mac[o + 2] << 8 | mac[o + 3]) % 1000000
    return str(code).zfill(6)


def fenetre_actuelle():
    return int(time.time() // 30)


def attendre_fenetre_apres(w):
    """Anti-rejeu : attend une fenêtre TOTP STRICTEMENT postérieure à w."""
    while fenetre_actuelle() <= w:
        time.sleep(1.0)


class Session:
    """Client HTTP minimal avec jar de cookies (portail de test)."""

    def __init__(self, base):
        self.base = base
        self.cookies = {}

    def _cookie(self):
        return "; ".join(f"{k}={v}" for k, v in self.cookies.items())

    def req(self, methode, chemin, corps=None, sans_redirection=False):
        data = json.dumps(corps).encode() if corps is not None else None
        r = urllib.request.Request(self.base + chemin, data=data, method=methode)
        r.add_header("Content-Type", "application/json")
        r.add_header("Cookie", self._cookie())
        ouvreur = urllib.request.build_opener(_BloqueurRedirection) if sans_redirection else urllib.request.build_opener()
        try:
            with ouvreur.open(r, timeout=15) as resp:
                brut = resp.read().decode("utf-8", "replace")
                self._absorber(resp.headers.get_all("Set-Cookie") or [])
                return resp.status, brut
        except urllib.error.HTTPError as e:
            brut = e.read().decode("utf-8", "replace")
            self._absorber(e.headers.get_all("Set-Cookie") or [])
            return e.code, brut

    def _absorber(self, set_cookies):
        for sc in set_cookies:
            premier = sc.split(";")[0]
            if "=" in premier:
                k, v = premier.split("=", 1)
                if v == "":
                    self.cookies.pop(k.strip(), None)
                else:
                    self.cookies[k.strip()] = v.strip()


def json_de(raw):
    try:
        return json.loads(raw)
    except Exception:
        return None


class _BloqueurRedirection(urllib.request.HTTPRedirectHandler):
    """Empêche urllib de suivre les 3xx (contrôle brut du code de statut)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def uri_et_secret(page_html):
    """Extrait l'URI otpauth (data-payload du QR) puis le paramètre secret."""
    m = re.search(r'data-payload="([^"]+)"', page_html)
    if not m:
        return None, None
    import html as html_mod
    uri = html_mod.unescape(m.group(1))
    ms = re.search(r"secret=([A-Z2-7]+)", uri)
    return uri, (ms.group(1) if ms else None)


def lire_etat(cin):
    out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", cin],
                         cwd=RACINE, capture_output=True, text=True,
                         env={**os.environ, "DATABASE_URL": "file:" + DB_COPIE})
    brut = out.stdout.strip()
    m = re.search(r"\{.*\}", brut, re.S)
    return json_de(m.group(0)) if m else {}


def main():
    print("=" * 76)
    print("TASK 87 — après « Configuration réussie », retour à la fenêtre initiale")
    print("de connexion (CIN + mot de passe + code OTP) — session fermée")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}

    check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))

    # --- Carte 3 : bouton + texte + redirection automatique ---
    check("S02 carte 3 : bouton « Aller à la page de connexion » (href=/login, id=btn-connexion)",
          "Aller à la page de connexion" in src
          and 'href="/login" id="btn-connexion"' in src, "bouton")
    check("S03 carte 3 : l'ANCIEN bouton « Accéder au portail » est SUPPRIMÉ du source",
          "Accéder au portail" not in src, "reste")
    check("S04 carte 3 : texte « redirigé vers la fenêtre de connexion (CIN, mot de passe et code OTP) »",
          "redirigé vers la fenêtre de connexion" in src
          and "(CIN, mot de passe et code OTP)" in src, "texte")
    check("S05 carte 3 : l'ANCIEN texte « redirigé vers le portail employé » est SUPPRIMÉ",
          "redirigé vers le portail employé" not in src, "reste")
    check("S06 carte 3 : redirection automatique (5 s) vers /login",
          'setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);' in src,
          "setTimeout")
    # le bloc SUCCESS_HTML LUI-MÊME ne doit plus pointer vers « / » (d'autres
    # pages redirigent légitimement vers le portail après authentification)
    bloc_reussie = src.split("const SUCCESS_HTML = `")[1].split("`;")[0] if "const SUCCESS_HTML = `" in src else ""
    check("S07 carte 3 : AUCUNE cible « / » dans le bloc SUCCESS_HTML (bouton + redirection = /login)",
          bloc_reussie and 'apiUrl("/")' not in bloc_reussie
          and 'href="/login"' in bloc_reussie
          and 'location.replace(apiUrl("/login")); }, 5000);' in bloc_reussie, "bloc")
    check("S08 carte 3 : encadré « QR unique » et titre « Configuration réussie » inchangés (Task 83)",
          "Le QR code n'est affiché que lors de la première connexion.</span>" in src
          and ">Configuration réussie</h1>" in src, "carte 3")

    # --- Route : la session d'inscription est FERMÉE au service de la page ---
    check("S09 route /premiere-reussie : la session est FERMÉE (clearSessionCookie avant le 200)",
          "clearSessionCookie(res);\n    res.writeHead(200" in src, "route")
    check("S10 route /premiere-reussie : commentaire (MODIFIÉ Task 87) présent",
          "(MODIFIÉ Task 87) la session d'inscription est FERMÉE" in src, "commentaire")
    check("S11 route /premiere-reussie : la garde sans session renvoie toujours à /login (Task 83)",
          'if (!sess || sess.pending || sess.otp) {\n      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });' in src,
          "garde")

    # --- Invariants : les Tasks 80/83/85/86 restent entières ---
    check("S12 invariant Task 86 : la fenêtre du secret d'inscription est conservée (otpFenetreCreeA + obtenirSecretFenetre)",
          "otpFenetreCreeA" in src and "function obtenirSecretFenetre" in src, "Task 86")
    check("S13 invariant Task 86 : la garde 410 OTP_EXPIRE refuse les codes d'une fenêtre dépassée",
          'code: "OTP_EXPIRE"' in src, "Task 86")
    check("S14 invariant Task 85 : AUCUN code OTP affiché à l'écran (mécanisme supprimé : bloc, bouton, endpoint, générateur)",
          'id="otp-affiche"' not in src and '"/api/otp/nouveau"' not in src
          and "function genererCodeOtp" not in src and "btn-nouveau" not in src, "Task 85")
    check("S15 invariant Task 83 : le QR ne s'affiche qu'UNE fois (verrou qrPresente)",
          "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in src, "Task 83")
    check("S16 invariant Task 82 : connexion en UNE étape (CIN + mot de passe + OTP)",
          'id="otp" name="otp"' in src, "Task 82")

    # ================= SECTION A : E2E — parcours complet =================
    print("\n--- SECTION A : E2E — première connexion → réussie → fenêtre initiale → portail ---")
    CIN = "TEST64CIN"
    MDP_INIT = "Initial64x"
    MDP_PERSO = "MonMotDePasse87!"
    s = Session(P1)

    # A1 — étape 1 : identification + changement du mot de passe initial
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j1 = json_de(brut) or {}
    check("A1 /api/premiere → 200 (identification + changement en une requête)",
          code == 200 and j1.get("ok") is True, (code, brut[:160]))

    # A2 — étape 2 : la fenêtre d'inscription affiche le QR (compte à rebours)
    code, brut = s.req("GET", "/otp")
    uri, secret_b32 = uri_et_secret(brut)
    check("A2 fenêtre d'inscription → 200 avec QR otpauth + compte à rebours",
          code == 200 and uri and uri.startswith("otpauth://totp/")
          and 'id="qr-cd"' in brut, (code, bool(uri)))
    w_qr = fenetre_actuelle()

    # A3 — le code TOTP de l'application est accepté (scellement Task 86)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret_b32)})
    j3 = json_de(brut) or {}
    check("A3 code TOTP accepté pendant l'inscription → 200",
          code == 200 and j3.get("ok") is True, (code, brut[:160]))

    # A4 — (Task 87) la page « Configuration réussie » est servie ET ferme la session
    code, brut = s.req("GET", "/premiere-reussie")
    check("A4 /premiere-reussie → 200 « Configuration réussie » + encadré QR unique",
          code == 200 and "Configuration réussie" in brut
          and "Le QR code n'est affiché que lors de la première connexion." in brut, (code, brut[:120]))
    check("A4 bouton « Aller à la page de connexion » + annonce de la fenêtre de connexion",
          "Aller à la page de connexion" in brut
          and 'href="/login"' in brut
          and "redirigé vers la fenêtre de connexion" in brut, "contenu")
    check("A4 redirection automatique (5 s) vers /login DANS LA PAGE SERVIE",
          'location.replace(apiUrl("/login")); }, 5000);' in brut, "setTimeout")
    check("A4 (NOEUD Task 87) la session d'inscription est FERMÉE (cookie portail_session effacé)",
          "portail_session" not in s.cookies, s.cookies)

    # A5 — (Task 87) le portail N'EST PLUS accessible : la fenêtre initiale est servie
    code, brut = s.req("GET", "/")
    check("A5 / sans session → fenêtre INITIALE de connexion (CIN + mot de passe + OTP), PAS les fiches",
          code == 200 and 'id="form"' in brut and 'id="otp" name="otp"' in brut
          and "Se connecter" in brut, (code, brut[:120]))
    code, brut = s.req("GET", "/api/my-fiches")
    check("A5 /api/my-fiches → 401 (session expirée — aucune fiche sans reconnexion)",
          code == 401, (code, brut[:120]))

    # A6 — (Task 87) rafraîchir /premiere-reussie sans session → retour connexion
    code, brut = s.req("GET", "/premiere-reussie", sans_redirection=True)
    check("A6 /premiere-reussie sans session → 302 vers /login (pas de re-service)",
          code in (302, 303), (code, brut[:120]))

    # A7 — RECONNEXION COMPLÈTE par la fenêtre initiale (CIN + mot de passe + OTP)
    attendre_fenetre_apres(w_qr)  # anti-rejeu : fenêtre TOTP strictement postérieure
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": totp_now(secret_b32)})
    j7 = json_de(brut) or {}
    check("A7 reconnexion par la fenêtre initiale (3 champs) → 200 redirect:/",
          code == 200 and j7.get("ok") is True and j7.get("redirect") == "/"
          and j7.get("otpRequired") is None, (code, brut[:160]))

    # A8 — le portail est de nouveau accessible (2FA validé dès la 1ʳᵉ connexion)
    code, brut = s.req("GET", "/")
    check("A8 / après reconnexion → fiches (PAGE_HTML, pas de formulaire de connexion)",
          code == 200 and 'id="form"' not in brut and 'id="form-premiere"' not in brut, (code, brut[:120]))
    code, brut = s.req("GET", "/otp", sans_redirection=True)
    check("A8 /otp après reconnexion complète → redirection (le QR ne revient pas)",
          code in (302, 303), code)

    # A9 — état final en base : scellement Task 86 inchangé par Task 87
    time.sleep(0.3)
    etat = lire_etat(CIN)
    check("A9 état final : lastLoginAt posé + secret SCELLÉ (otpFenetreCreeA null) + qrPresente",
          etat.get("lastLoginAt") not in (None, "ABSENT")
          and etat.get("otpFenetreCreeA") in (None, "null", "")
          and etat.get("qrPresente") is True, etat)

    return bilan("TASK 87")


if __name__ == "__main__":
    sys.exit(main())
