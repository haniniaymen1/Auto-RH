#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 85 — « jamais affiche le code otp comme ca / dans cette fenetre n
affiche que qr code qui expire apres 10 minute » (capture : le code OTP
« 963 903 » affiché en clair dans la fenêtre de confirmation des connexions
suivantes).

REFONTE APPLIQUÉE (scripts/portail-server.js, v0.2.15) :
  1. la fenêtre /otp de CONFIRMATION (connexions suivantes) est alignée sur
     la fenêtre d'inscription : QR code (URI otpauth://totp standard, secret
     PERSISTANT) + mention « Le QR code expire dans 10 minutes. » + champ
     « Code OTP » + bouton « Valider le code » + « Se déconnecter » ;
  2. AUCUN code OTP n'est JAMAIS affiché en clair : plus de bloc
     « otp-affiche », plus de compte à rebours du code, plus de texte
     « Un code à usage unique vient d'être généré… », plus de bouton
     « Générer un nouveau code », plus d'endpoint /api/otp/nouveau, plus de
     code stocké dans le défi (genererCodeOtp SUPPRIMÉ) ;
  3. /api/otp/verify n'accepte PLUS que le TOTP de l'application
     d'authentification (RFC 6238, tolérance ±1 fenêtre, anti-rejeu
     lastUsedWindow) — l'ancienne voie « code affiché à l'écran » est
     retirée ;
  4. à l'expiration du défi (10 minutes), la fenêtre bascule vers la page
     « Code OTP expiré » → reconnexion CIN + mot de passe (inchangé).

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test85_harnais.sh, portails de test 4247 TTL normal / 4248 TTL 3,5 s).
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
P1 = os.environ.get("PORTAL_TTL_NORMAL", "http://127.0.0.1:4247")
P2 = os.environ.get("PORTAL_TTL_COURT", "http://127.0.0.1:4248")
DB_COPIE = os.environ.get("DB_COPIE", BASE + "/sandbox-test85/test85.db")

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(("OK  " if cond else "KO  ") + nom + ("" if cond else "  -> " + str(detail)[:220]))


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


class _BloqueurRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def json_de(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {}


def uri_et_secret(page_html):
    """Extrait (uri otpauth, secret Base32) du QR data-payload de la page."""
    m = re.search(r'data-payload="([^"]*)"', page_html or "")
    if not m:
        return None, None
    uri = m.group(1).replace("&amp;", "&")
    m2 = re.search(r"secret=([A-Z2-7]+)", uri)
    return (uri, m2.group(1) if m2 else None)


def lire_etat(cin):
    out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", cin],
                         cwd=RACINE, capture_output=True, text=True,
                         env={**os.environ, "DATABASE_URL": "file:" + DB_COPIE})
    brut = out.stdout.strip()
    m = re.search(r"\{.*\}", brut, re.S)
    return json_de(m.group(0)) if m else {}


# =====================================================================
print("=" * 72)
print("SECTION 0 : contrôles statiques (scripts/portail-server.js v0.2.15)")
print("=" * 72)
src = open(PORTAIL, encoding="utf-8").read()
pkg = json.load(open(PKG, encoding="utf-8"))

check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)",
      pkg.get("version") == "0.2.23", pkg.get("version"))
check("S02 demande utilisateur Task 85 documentée dans l'en-tête",
      "jamais affiche le code otp comme ca" in src
      and "dans cette fenetre n affiche que qr code qui expire apres 10 minute" in src)

# Corps de otpHtml (fenêtre de confirmation) — entre otpHtml et otpPremiereHtml
i0 = src.index("function otpHtml")
i1 = src.index("function otpPremiereHtml", i0)
corps_conf = src[i0:i1]
check("S03 fenêtre de confirmation : AUCUN bloc « otp-affiche » (code jamais affiché)",
      'id="otp-affiche"' not in corps_conf and "otp-affiche" not in corps_conf)
check("S04 fenêtre de confirmation : AUCUN compte à rebours du code (id=compte / otp-compte)",
      'id="compte"' not in corps_conf and 'class="otp-compte"' not in corps_conf)
check("S05 fenêtre de confirmation : AUCUN bouton « Générer un nouveau code » (btn-nouveau supprimé)",
      "Générer un nouveau code</button>" not in corps_conf and 'id="btn-nouveau"' not in corps_conf)
check("S06 fenêtre de confirmation : AUCUN texte « code à usage unique généré »",
      "vient d'être généré" not in corps_conf)
check("S07 fenêtre de confirmation : bloc QR conditionnel (svgQr ? otp-qr + data-payload)",
      '${svgQr ? `<div class="otp-qr" id="qr-bloc" data-payload=' in corps_conf)
check("S08 fenêtre de confirmation : mention « Le QR code expire dans » (10 minutes)",
      "Le QR code expire dans" in corps_conf)
check("S09 fenêtre de confirmation : champ « Confirmez le code OTP (6 chiffres) » + « Valider le code » + « Se déconnecter »",
      "Confirmez le code OTP (6 chiffres)" in corps_conf
      and "Valider le code" in corps_conf and "Se déconnecter" in corps_conf)
check("S10 fenêtre de confirmation : le texte affirme que le code n'est JAMAIS affiché sur la page",
      "il n'est JAMAIS affiché sur cette page" in corps_conf)
check("S11 fenêtre de confirmation : bascule automatique vers la page expirée à la fin du défi",
      "location.replace(apiUrl(\"/otp\"))" in corps_conf and "expireMs" in corps_conf)
check("S12 fenêtre de confirmation : AUCUN appel à /api/otp/nouveau",
      "api/otp/nouveau" not in corps_conf)

check("S13 endpoint /api/otp/nouveau SUPPRIMÉ (plus aucune route de régénération)",
      '"/api/otp/nouveau"' not in src)
check("S14 générateur de code à usage unique SUPPRIMÉ (genererCodeOtp) — le code n'existe plus",
      "genererCodeOtp" not in src and "defi.code" not in src)
check("S15 /api/otp/verify : TOTP SEUL (codeCorrect=false initial, plus de comparaison au code affiché)",
      "let codeCorrect = false;" in src and "code === defi.code" not in src)
check("S16 /api/otp/verify : message 400 aligné (code généré par l'application)",
      "généré par votre application d'authentification" in src
      and "affiché dans le portail" not in src)
check("S17 CSS : règles .otp-code / .otp-compte SUPPRIMÉES (seul le commentaire Task 85 subsiste)",
      ".otp-code {" not in src and ".otp-compte {" not in src
      and "SUPPRIMÉ Task 85" in src)
check("S18 (MODIFIÉ Task 86) page « Code OTP expiré » : un NOUVEAU QR code (nouveau secret) sera affiché",
      "le QR code de vérification n'est valable que" in src
      and "un NOUVEAU QR code (nouveau secret) sera affiché" in src)
check("S19 page de connexion : « Le code OTP n'est JAMAIS affiché à l'écran »",
      "Le code OTP n'est JAMAIS affiché à l'écran" in src)
check("S20 invariants Task 78 conservés (URI otpauth standard + secret chiffré en base — Task 86 : fenêtre)",
      '"otpauth://totp/"' in src
      and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in src
      and "cryptoBd.chiffrerChamp(secret, false)" in src)
check("S21 invariants Task 83 conservés (/premiere + Configuration OTP + verrou qrPresente)",
      "function otpPremiereHtml(defi, svgQr)" in src
      and "data: { qrPresente: true }" in src
      and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in src)
check("S22 invariants Task 64/82 conservés (gardes OTP_REQUIS ×4, champ Code OTP du formulaire)",
      src.count('code: "OTP_REQUIS"') == 4
      and '<label for="otp">Code OTP (application d\'authentification)</label>' in src)
check("S23 TTL 10 minutes inchangé (défaut 600 000 ms, réductible en test uniquement)",
      "n <= 600000 ? n : 10 * 60 * 1000" in src)

# =====================================================================
print()
print("=" * 72)
print("SECTION A : portail 4247 (TTL normal) — la fenêtre n'affiche JAMAIS le code")
print("=" * 72)

s = Session(P1)
code, brut = s.req("GET", "/")
check("A0 portail de test répond (200)", code == 200, code)

# A1 — première connexion : étape 1 sans OTP → /premiere (Task 83)
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
j1 = json_de(brut) or {}
check("A1 première connexion → 200 otpRequired premiereConnexion:true (défi 10 min posé)",
      code == 200 and j1.get("ok") is True and j1.get("otpRequired") is True
      and j1.get("premiereConnexion") is True and j1.get("redirect") == "/otp"
      and j1.get("expireAt"), (code, brut[:160]))
if j1.get("expireAt"):
    from datetime import datetime
    reste = datetime.fromisoformat(j1["expireAt"].replace("Z", "+00:00")).timestamp() - time.time()
    check("A1 le défi expire ≈ maintenant + 10 minutes (entre +9 et +11 min)",
          540 <= reste <= 660, round(reste, 1))

# A2 — fenêtre d'inscription « Configuration OTP » : QR + champ, AUCUN code
code, brut = s.req("GET", "/otp")
check("A2 /otp → « Configuration OTP » (QR + champ Code OTP — Task 83 conservée)",
      code == 200 and "Configuration OTP" in brut and 'data-payload' in brut
      and 'id="otp-saisie"' in brut, code)
check("A2 AUCUN code affiché en clair (otp-affiche absent)",
      'otp-affiche' not in brut)
uri1, secret1 = uri_et_secret(brut)
check("A2 URI otpauth://totp standard avec secret Base32 (Task 78)",
      (uri1 or "").startswith("otpauth://totp/") and bool(secret1), uri1)

# A3 — confirmation DANS la fenêtre d'inscription (TOTP de l'application)
code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret1)})
j2 = json_de(brut) or {}
check("(MODIFIÉ Task 90) A3 TOTP de l'application accepté dans la fenêtre d'inscription → 200 (inscription terminée : redirect /premiere-reussie)",
      code == 200 and j2.get("ok") is True and j2.get("redirect") == "/premiere-reussie", (code, brut[:160]))

# A4 — CONNEXION SUIVANTE : la fenêtre de confirmation = QR code + champ,
#      AUCUN code affiché (LE POINT TASK 85)
code, brut = s.req("POST", "/api/logout")
check("A4 déconnexion (logout → 200)", code == 200, code)
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
j3 = json_de(brut) or {}
check("A4 reconnexion → 200 otpRequired premiereConnexion:false",
      code == 200 and j3.get("otpRequired") is True and j3.get("premiereConnexion") is False,
      (code, brut[:160]))
code, brut = s.req("GET", "/otp")
check("A4 (MODIFIÉ Task 85) la fenêtre de confirmation affiche LE QR CODE (data-payload présent)",
      code == 200 and 'class="otp-qr"' in brut and 'data-payload' in brut, code)
check("A4 (MODIFIÉ Task 85) AUCUN code OTP en clair (otp-affiche / otp-compte / usage unique générés absents)",
      'otp-affiche' not in brut and 'id="compte"' not in brut
      and "vient d'être généré" not in brut)
check("A4 (SUPPRIMÉ Task 85) AUCUN bouton « Générer un nouveau code »",
      "Générer un nouveau code" not in brut and 'id="btn-nouveau"' not in brut)
check("A4 (MODIFIÉ Task 86) compte à rebours VISIBLE + libellé honnête du secret DÉFINITIF (inscrit : c'est la fenêtre qui expire)",
      'id="qr-cd"' in brut and "Cette fenêtre expire dans" in brut)
check("A4 champ de confirmation + « Valider le code » + « Se déconnecter » présents",
      "Confirmez le code OTP (6 chiffres)" in brut
      and "Valider le code" in brut and "Se déconnecter" in brut)
check("A4 la page affirme que le code vient UNIQUEMENT de l'application (jamais affiché)",
      "vient UNIQUEMENT de votre application" in brut
      and "il n'est JAMAIS affiché sur cette page" in brut)
uri2, secret2 = uri_et_secret(brut)
check("A4 le QR de la fenêtre de confirmation = le MÊME secret persistant (A2)",
      secret2 == secret1, (secret1, secret2))

# A5 — l'ancien endpoint de régénération n'existe plus
code, brut = s.req("POST", "/api/otp/nouveau")
check("A5 (SUPPRIMÉ Task 85) POST /api/otp/nouveau → 404 (route retirée)",
      code == 404, (code, brut[:120]))

# A6 — un code quelconque est refusé (plus JAMAIS de code écran valide)
code, brut = s.req("POST", "/api/otp/verify", {"otp": "000000"})
j4 = json_de(brut) or {}
check("A6 code quelconque → 401 « Code OTP incorrect. Il vous reste 4 tentatives »",
      code == 401 and "Code OTP incorrect. Il vous reste 4 tentative" in str(j4.get("error", "")),
      (code, brut[:160]))

# A7 — le TOTP de l'application (fenêtre suivante) ouvre la session
code_app = totp_now(secret2, t=int(time.time()) + 31)
code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app})
j5 = json_de(brut) or {}
check("A7 TOTP de l'application accepté → 200 + accès complet (redirect /)",
      code == 200 and j5.get("ok") is True and j5.get("redirect") == "/", (code, brut[:160]))
code, brut = s.req("GET", "/api/my-fiches")
check("A7 fiches accessibles (session complète)", code == 200, (code, brut[:120]))

# A8 — ANTI-REJEU : le MÊME TOTP ne passe pas deux fois (conservé Task 78)
code, brut = s.req("POST", "/api/logout")
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app})
j6 = json_de(brut) or {}
check("A8 le MÊME TOTP rejoué → 401 (anti-rejeu lastUsedWindow conservé)",
      code == 401, (code, brut[:160]))

# =====================================================================
print()
print("=" * 72)
print("SECTION B : portail 4248 (TTL 3,5 s) — le QR code EXPIRE après le délai")
print("=" * 72)
s2 = Session(P2)
code, brut = s2.req("GET", "/")
check("B0 portail TTL court répond (200)", code == 200, code)
code, brut = s2.req("POST", "/api/verify", {"cin": "TEST74ANNULE", "password": "Annule74x"})
j7 = json_de(brut) or {}
check("B1 première connexion (TTL court) → 200 otpRequired + expireAt ≈ +3,5 s",
      code == 200 and j7.get("otpRequired") is True and j7.get("expireAt"), (code, brut[:160]))
if j7.get("expireAt"):
    from datetime import datetime
    reste = datetime.fromisoformat(j7["expireAt"].replace("Z", "+00:00")).timestamp() - time.time()
    check("B1 expireAt ≈ maintenant + 3,5 s (entre 1,5 et 6 s)",
          1.5 <= reste <= 6.0, round(reste, 1))
code, brut = s2.req("GET", "/otp")
uri_b, secret_b = uri_et_secret(brut)
check("B2 fenêtre QR servie (QR + champ — première connexion « Configuration OTP »)",
      code == 200 and "Configuration OTP" in brut and bool(secret_b), code)
# (MODIFIÉ Task 85) la page « Code OTP expiré » est prouvée SANS consommer la
# session : le 410 du verify (B3) EFFACE le cookie — le GET /otp qui suivrait
# redirige vers /login (comportement Task 74 conservé).
time.sleep(4.2)
code, brut = s2.req("GET", "/otp")
check("B3 page « Code OTP expiré » + bouton « Se reconnecter » (session encore posée, défi purgé)",
      code == 200 and "Code OTP expiré" in brut and "Se reconnecter" in brut, (code, brut[:120]))
code, brut = s2.req("POST", "/api/otp/verify", {"otp": totp_now(secret_b)})
j8 = json_de(brut) or {}
check("B4 TOTP CORRECT mais défi EXPIRÉ → 410 OTP_EXPIRE (le QR expire bien)",
      code == 410 and j8.get("code") == "OTP_EXPIRE" and "expir" in brut.lower(),
      (code, brut[:180]))
et = lire_etat("TEST74ANNULE")
check("B5 l'expiration n'écrit RIEN : lastLoginAt toujours null (première connexion due)",
      et.get("lastLoginAt") is None, et)

# =====================================================================
print()
print("=" * 72)
print("SECTION C : invariants (état base, aucun retour du code, verrou QR)")
print("=" * 72)
et = lire_etat("TEST74EXPIRE")
check("C1 TEST74EXPIRE : lastLoginAt posé + qrPresente vrai (parcours A complet)",
      et.get("lastLoginAt") not in (None, "", "null") and et.get("qrPresente") is True, et)
et2 = lire_etat("TEST74ANNULE")
check("C2 TEST74ANNULE : qrPresente posé (la page QR a été servie) mais lastLoginAt null",
      et2.get("qrPresente") is True and et2.get("lastLoginAt") is None, et2)
# C3 — session COMPLÈTE puis GET /otp → redirection (jamais de QR inutile) :
# la session de A est restée en attente OTP (A8) — on ouvre une session
# complète. (RÉALIGNÉ Task 86 — contrôle rendu DÉTERMINISTE) le code de A7
# visait la fenêtre FUTURE (now+31) consommée par l'anti-rejeu : une simple
# pause de 31 s ne garantit pas d'être passé À LA FENÊTRE SUIVANTE (l'écart
# réel dépend de la phase dans la fenêtre de 30 s et de la durée de la
# section B). On attend EXPLICITEMENT le début d'une fenêtre strictement
# postérieure à celle consommée en A7, puis on soumet le code courant.
fenetre_a7 = (int(time.time()) + 31) // 30  # fenêtre du code « futur » de A7
delai = (fenetre_a7 + 1) * 30 - time.time() + 1.0
if delai > 0:
    time.sleep(delai)
code, brut = s.req("POST", "/api/logout")
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
j_c3v = json_de(brut) or {}
code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret2)})
j_c3o = json_de(brut) or {}
code, brut = s.req("GET", "/otp", sans_redirection=True)
check("C3 /otp avec session complète → redirection (302/303) — jamais de QR inutile",
      code in (302, 303), (code, "verify=" + str(code) + " " + brut[:100],
                           "otp_verify=" + json.dumps(j_c3o)[:150],
                           "otp_req=" + json.dumps(j_c3v)[:120]))
code, brut = s.req("POST", "/api/verify", {"cin": "CININCONNU85", "password": "peu importe"})
j9 = json_de(brut) or {}
check("C4 CIN inconnu → MÊME message générique (aucune fuite)",
      code == 401 and j9.get("error") == "CIN ou mot de passe incorrect. Réessayez.",
      (code, brut[:160]))

# =====================================================================
total = len(RESULTATS)
reussis = sum(1 for r in RESULTATS if r)
print()
print("=" * 72)
print(f"RÉSULTAT TASK 85 : {reussis}/{total} " + ("— TOUT OK" if reussis == total else "— PROBLÈME DÉTECTÉ"))
print("=" * 72)
sys.exit(0 if reussis == total else 1)
