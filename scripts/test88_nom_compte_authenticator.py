#!/usr/bin/env python3
"""
Task 88 — Authenticator : l'« Account Name » affiche « Fiche de paie » au
lieu du CIN (« Dans l'application Authenticator, le champ Account Name
contient actuellement le CIN. Je souhaite que le nom affiché dans Account
Name soit "Fiche de paie" à la place du CIN. »).

AVANT (v0.2.17) : l'URI otpauth://totp portait le label « Auto-RH:CIN » —
l'application d'authentification affichait le CIN dans « Account Name ».

APRÈS (v0.2.18) :
  - le label devient « Auto-RH:Fiche de paie » : l'Authenticator affiche
    « Fiche de paie » (Account Name) avec l'émetteur « Auto-RH » ;
  - le CIN ne figure PLUS dans l'URI (plus sur l'écran du téléphone) ;
  - le calcul TOTP est INCHANGÉ (le label ne participe pas au HMAC) — les
    comptes déjà associés continuent de générer des codes valables ;
  - les DEUX générateurs sont alignés : portail (contenuQrOtp) ET
    administration (contenuQr, section « Gestion des QR codes »).

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test88_harnais.sh, portail de test 4263) : sections 0/A ci-dessous.
"""
import base64
import hashlib
import hmac
import html as html_mod
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "/home/z/my-project"
RACINE = BASE
PORTAIL = BASE + "/scripts/portail-server.js"
ROUTE = BASE + "/src/app/api/portal-access/route.ts"
PKG = BASE + "/package.json"
P1 = "http://127.0.0.1:4263"          # portail employés de test (TTL normal)
DB_COPIE = BASE + "/sandbox-test88/test88.db"

NOUVEAU_LABEL = "Auto-RH:Fiche de paie"
ANCIEN_LABEL_PORTAIL = 'Auto-RH:" + defi.cin'
ANCIEN_LABEL_ROUTE = 'Auto-RH:" + cin'
ISSUER_LINE = '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"'

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
    uri = html_mod.unescape(m.group(1))
    ms = re.search(r"secret=([A-Z2-7]+)", uri)
    return uri, (ms.group(1) if ms else None)


def decoupage_authenticator(uri):
    """Simule le découpage d'une application Authenticator (spec Key URI
    Format) : chemin décodé → préfixe « émetteur:compte » coupé au premier
    deux-points. Retourne (émetteur, account_name, chemin_décodé)."""
    if not uri:
        return None, None, None
    chemin = urllib.parse.unquote(urllib.parse.urlsplit(uri).path)
    label = chemin.lstrip("/")
    if ":" not in label:
        return None, None, chemin
    emetteur, compte = label.split(":", 1)
    return emetteur, compte, chemin


def lire_etat(cin):
    out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", cin],
                         cwd=RACINE, capture_output=True, text=True,
                         env={**os.environ, "DATABASE_URL": "file:" + DB_COPIE})
    brut = out.stdout.strip()
    m = re.search(r"\{.*\}", brut, re.S)
    return json_de(m.group(0)) if m else {}


def main():
    print("=" * 76)
    print("TASK 88 — Authenticator : Account Name « Fiche de paie » (plus le CIN)")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    route = open(ROUTE, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}

    check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))

    # --- Portail : contenuQrOtp porte le NOUVEAU label ---
    check("S02 portail : label = encodeURIComponent(\"Auto-RH:Fiche de paie\")",
          'encodeURIComponent("' + NOUVEAU_LABEL + '")' in src, "label portail")
    check("S03 portail : l'ANCIEN label concaténé avec le CIN est SUPPRIMÉ",
          ANCIEN_LABEL_PORTAIL not in src, "reste ancien label")
    check("S04 portail : commentaire (MODIFIÉ Task 88) documente la demande « Account Name »",
          "(MODIFIÉ Task 88) le LABEL de l'URI est" in src
          and "« Account Name » doit afficher « Fiche de paie » AU LIEU du CIN" in src,
          "commentaire")
    check("S05 portail : en-tête documente le label « Fiche de paie » (MODIFIÉ Task 88)",
          'Auto-RH:"Fiche de paie" (MODIFIÉ Task 88' in src, "en-tête")

    # --- Administration : contenuQr aligné sur le portail ---
    check("S06 administration : label = encodeURIComponent(\"Auto-RH:Fiche de paie\")",
          'encodeURIComponent("' + NOUVEAU_LABEL + '")' in route, "label route.ts")
    check("S07 administration : l'ANCIEN label concaténé avec le CIN est SUPPRIMÉ",
          ANCIEN_LABEL_ROUTE not in route, "reste ancien label")
    check("S08 administration : commentaire (MODIFIÉ Task 88) + void cin (paramètre conservé)",
          "(MODIFIÉ Task 88) le CIN n'entre PLUS dans le label" in route
          and "void cin;" in route, "commentaire route.ts")

    # --- Paramètres standard INCHANGÉS (les deux générateurs) ---
    check("S09 portail + administration : issuer/algorithm/digits/period INCHANGÉS",
          ISSUER_LINE in src and ISSUER_LINE in route, ISSUER_LINE)
    check("S10 portail : le label ne contient AUCUNE concaténation de variable CIN",
          '"Auto-RH:" +' not in src, "concaténation résiduelle")
    check("S11 administration : le label ne contient AUCUNE concaténation de variable CIN",
          '"Auto-RH:" +' not in route, "concaténation résiduelle")

    # --- Simulation du découpage d'une application Authenticator ---
    emetteur, compte, chemin = decoupage_authenticator(
        "otpauth://totp/" + urllib.parse.quote(NOUVEAU_LABEL, safe="") +
        "?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Auto-RH")
    check("S12 Authenticator simulé : émetteur = « Auto-RH »",
          emetteur == "Auto-RH", (emetteur, chemin))
    check("S13 Authenticator simulé : Account Name = « Fiche de paie » (PLUS le CIN)",
          compte == "Fiche de paie", compte)

    # --- Invariants : Tasks 85/86/87 restent entières ---
    check("S14 invariant Task 85 : AUCUN code OTP affiché à l'écran (mécanisme supprimé)",
          'id="otp-affiche"' not in src and '"/api/otp/nouveau"' not in src
          and "function genererCodeOtp" not in src, "Task 85")
    check("S15 invariant Task 86 : fenêtre de 10 minutes du secret d'inscription conservée",
          "otpFenetreCreeA" in src and "function obtenirSecretFenetre" in src
          and 'code: "OTP_EXPIRE"' in src and 'id="qr-cd"' in src, "Task 86")
    check("S16 invariant Task 87 : retour à la fenêtre initiale de connexion conservé",
          'href="/login" id="btn-connexion"' in src
          and 'setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);' in src,
          "Task 87")

    # ================= SECTION A : E2E — parcours complet =================
    print("\n--- SECTION A : E2E — première connexion → QR « Fiche de paie » → TOTP ---")
    CIN = "TEST64CIN"
    MDP_INIT = "Initial64x"
    MDP_PERSO = "MonMotDePasse88!"
    s = Session(P1)

    # A1 — étape 1 : identification + changement du mot de passe initial
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j1 = json_de(brut) or {}
    check("A1 /api/premiere → 200 (identification + changement en une requête)",
          code == 200 and j1.get("ok") is True, (code, brut[:160]))

    # A2 — étape 2 : le QR servi porte le NOUVEAU label, SANS le CIN
    code, brut = s.req("GET", "/otp")
    uri, secret_b32 = uri_et_secret(brut)
    emetteur_a, compte_a, chemin_a = decoupage_authenticator(uri)
    check("A2 fenêtre d'inscription → 200 avec QR otpauth + compte à rebours",
          code == 200 and uri and uri.startswith("otpauth://totp/")
          and 'id="qr-cd"' in brut, (code, bool(uri)))
    check("A2 (NOEUD Task 88) label décodé du QR servi = « Auto-RH:Fiche de paie »",
          chemin_a == "/" + NOUVEAU_LABEL, chemin_a)
    check("A2 l'Account Name affiché par l'Authenticator = « Fiche de paie »",
          emetteur_a == "Auto-RH" and compte_a == "Fiche de paie", (emetteur_a, compte_a))
    check("A2 le CIN de l'employé n'apparaît NULLE PART dans l'URI (plus sur l'écran du téléphone)",
          bool(uri) and CIN not in uri and CIN not in chemin_a, chemin_a)
    qs_a = urllib.parse.parse_qs(urllib.parse.urlsplit(uri or "").query) if uri else {}
    check("A2 paramètres standard : issuer=Auto-RH, SHA1, 6 chiffres, période 30 s",
          qs_a.get("issuer") == ["Auto-RH"] and qs_a.get("algorithm") == ["SHA1"]
          and qs_a.get("digits") == ["6"] and qs_a.get("period") == ["30"], qs_a)
    w_qr = fenetre_actuelle()

    # A3 — le code TOTP de l'application est accepté (le label n'affecte PAS le calcul)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret_b32)})
    j3 = json_de(brut) or {}
    check("A3 code TOTP accepté pendant l'inscription → 200 (le label ne change pas le HMAC)",
          code == 200 and j3.get("ok") is True, (code, brut[:160]))

    # A4 — (Task 87) « Configuration réussie » : session fermée, retour connexion
    code, brut = s.req("GET", "/premiere-reussie")
    check("A4 /premiere-reussie → 200 « Configuration réussie » + session FERMÉE (Task 87)",
          code == 200 and "Configuration réussie" in brut
          and "portail_session" not in s.cookies, (code, s.cookies))

    # A5 — RECONNEXION COMPLÈTE par la fenêtre initiale (3 champs)
    attendre_fenetre_apres(w_qr)  # anti-rejeu : fenêtre TOTP strictement postérieure
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": totp_now(secret_b32)})
    j5 = json_de(brut) or {}
    check("A5 reconnexion par la fenêtre initiale (CIN + mot de passe + OTP) → 200 redirect:/",
          code == 200 and j5.get("ok") is True and j5.get("redirect") == "/", (code, brut[:160]))

    # A6 — état final : fiches accessibles + scellement Task 86 inchangé
    code, brut = s.req("GET", "/")
    check("A6 / après reconnexion → fiches (pas de formulaire de connexion)",
          code == 200 and 'id="form"' not in brut and 'id="form-premiere"' not in brut, (code, brut[:120]))
    time.sleep(0.3)
    etat = lire_etat(CIN)
    check("A6 état final : lastLoginAt posé + secret SCELLÉ (otpFenetreCreeA null) + qrPresente",
          etat.get("lastLoginAt") not in (None, "ABSENT")
          and etat.get("otpFenetreCreeA") in (None, "null", "")
          and etat.get("qrPresente") is True, etat)

    return bilan("TASK 88")


if __name__ == "__main__":
    sys.exit(main())
