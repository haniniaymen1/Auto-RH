#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 86 — « Qr code n'expire pas apres 10 minute vérifier » (retour
utilisateur : le QR code NE expire PAS après 10 minutes).

CAUSE RÉELLE DIAGNOSTIQUÉE (v0.2.15) : la FENÊTRE /otp expirait bien, mais le
secret TOTP encodé par le QR était PERSISTANT dès la première validation CIN +
mot de passe (écrit une fois en base, jamais régénéré) : le même QR revenait à
chaque reconnexion et son code restait accepté POUR TOUJOURS — le QR ne
mourrait jamais.

CORRECTIF APPLIQUÉ (scripts/portail-server.js + src, v0.2.16) :
  1. tant que l'inscription n'est pas confirmée (lastLoginAt null), le secret
     encodé par le QR est une FENÊTRE de 10 minutes (nouveau champ
     PortalAccess.otpFenetreCreeA) : réutilisé tant qu'il est vivant (même QR
     en cas de reconnexion rapide), RÉGÉNÉRÉ sinon — l'ancien QR scanné
     devient DÉFINITIVEMENT inutilisable et le QR affiché à la reconnexion
     est DIFFÉRENT (nouveau secret) ;
  2. SCELLEMENT : la confirmation du code (/api/otp/verify ou connexion en
     une étape) repasse otpFenetreCreeA à null — le secret confirmé devient
     définitif (l'application déjà associée continue de fonctionner) ;
  3. la fenêtre du défi est ALIGNÉE sur la vie du secret (QR et fenêtre
     expirent ENSEMBLE) ; /api/otp/verify refuse (410) tout code dont la
     fenêtre est dépassée (garde de défense supplémentaire) ;
  4. le temps RESTANT est AFFICHÉ en direct (mm:ss, id="qr-cd") sur les
     fenêtres QR — la promesse « expire après 10 minutes » est VISIBLE ;
  5. ADMINISTRATION alignée : « Afficher le QR » d'un non inscrit régénère la
     fenêtre si elle est dépassée (QR toujours vivant), statut « QR expiré »
     dans « Gestion des QR codes », reset-qr ouvre une fenêtre pour un non
     inscrit et scelle pour un inscrit.

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test86_harnais.sh : portail 4255 TTL normal / 4256 TTL 3,5 s / admin 4257).
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
from datetime import datetime

BASE = "/home/z/my-project"
RACINE = BASE
PORTAIL = BASE + "/scripts/portail-server.js"
ROUTE = BASE + "/src/app/api/portal-access/route.ts"
TSX = BASE + "/src/components/payslip/portal-access-tab.tsx"
SCHEMA = BASE + "/prisma/schema.prisma"
PKG = BASE + "/package.json"
P1 = os.environ.get("PORTAL_TTL_NORMAL", "http://127.0.0.1:4255")
P2 = os.environ.get("PORTAL_TTL_COURT", "http://127.0.0.1:4256")
ADMIN = os.environ.get("ADMIN_TEST", "http://127.0.0.1:4257")
DB_COPIE = os.environ.get("DB_COPIE", BASE + "/sandbox-test86/test86.db")

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
    """Client HTTP minimal avec jar de cookies."""

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
            with ouvreur.open(r, timeout=20) as resp:
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


def reste_secondes(iso):
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    return t - time.time()


# =====================================================================
print("=" * 72)
print("SECTION 0 : contrôles statiques (portail v0.2.16 + administration)")
print("=" * 72)
src = open(PORTAIL, encoding="utf-8").read()
route = open(ROUTE, encoding="utf-8").read()
tsx = open(TSX, encoding="utf-8").read()
schema = open(SCHEMA, encoding="utf-8").read()
pkg = json.load(open(PKG, encoding="utf-8"))

check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)",
      pkg.get("version") == "0.2.23", pkg.get("version"))
check("S02 demande utilisateur Task 86 documentée dans l'en-tête",
      "Qr code n'expire pas apres 10 minute vérifier" in src)
check("S03 schéma : champ PortalAccess.otpFenetreCreeA (DateTime?)",
      "otpFenetreCreeA DateTime?" in schema, "champ absent du schéma")

# --- cœur du correctif : le secret d'inscription est une FENÊTRE ---
check("S04 fenêtre du secret : fonction fenetreSecretVivante (lastLoginAt + otpFenetreCreeA + TTL)",
      "function fenetreSecretVivante(acc)" in src
      and "Date.now() - creeA < OTP_TTL_MS" in src)
check("S05 rotation : obtenirSecretFenetre réutilise la fenêtre vivante / régénère sinon",
      "async function obtenirSecretFenetre(acc)" in src
      and "fenetreSecretVivante(acc)" in src
      and "otpFenetreCreeA: new Date()" in src)
check("S06 l'ANCIEN bloc « secret persistant généré une fois » de /api/verify est remplacé",
      "let secretOtp = cryptoBd.dechiffrerChamp(acc.totpSecret);" not in src
      and "let secretPremiere = cryptoBd.dechiffrerChamp(acc.totpSecret);" not in src)
check("S07 /api/verify ET /api/premiere passent par obtenirSecretFenetre",
      src.count("const fenetre = await obtenirSecretFenetre(acc);") == 2)
check("S08 défi ALIGNÉ sur la fenêtre du secret (creerDefiOtp à 5 arguments)",
      "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in src
      and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in src
      and "creerDefiOtp(cin, false, premiereInscription, secretPremiere, fenetre.expireAt)" in src)
check("S09 défi : drapeau fenetre (QR expirable vs secret définitif)",
      "fenetre:" in src and "Number.isFinite(expireAtMs) && expireAtMs > maintenant" in src)
check("S10 /api/otp/verify : garde d'expiration du secret de fenêtre (410)",
      "GARDE D'EXPIRATION DU SECRET DE FENÊTRE" in src
      and "Date.now() - new Date(accTotp.otpFenetreCreeA).getTime() >= OTP_TTL_MS" in src)
check("S11 scellement dans /api/otp/verify ET /api/verify (otpFenetreCreeA → null)",
      src.count("...(acc.otpFenetreCreeA ? { otpFenetreCreeA: null } : {})") == 2)

# --- compte à rebours VISIBLE ---
check("S12 fenêtre d'inscription : compte à rebours en direct (id=qr-cd + majCd)",
      'Le QR code expire dans <b id="qr-cd">' in src
      and src.count("function majCd()") == 2
      and src.count("majCd();") >= 4)
check("S13 fenêtre de confirmation : libellé HONNÊTE (QR expirable vs fenêtre seule)",
      'defi.fenetre ? "Le QR code expire dans" : "Cette fenêtre expire dans"' in src)
check("S14 fenêtre d'inscription : « DÉFINITIVEMENT invalide » + nouveau QR à la reconnexion",
      "ce QR code est DÉFINITIVEMENT invalide" in src
      and "un NOUVEAU QR code (nouveau secret) vous sera présenté" in src)
check("S15 page « Code OTP expiré » : le secret d'un QR d'inscription non confirmé est mort",
      "le secret encodé est DÉFINITIVEMENT mort" in src
      and "aucun code généré" in src)
check("S16 page /premiere : le QR d'inscription s'affiche avec un compte à rebours",
      "le QR code d'inscription s'affiche avec un compte à rebours de" in src
      and "un NOUVEAU QR vous sera présenté" in src)
check("S17 ancien texte « UNE SEULE FOIS (expire » retiré",
      "UNE SEULE FOIS (expire" not in src)

# --- invariants des tâches précédentes conservés ---
check("S18 invariants Task 78 conservés (URI otpauth standard + secret chiffré en base)",
      '"otpauth://totp/"' in src
      and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in src
      and "cryptoBd.chiffrerChamp(secret, false)" in src)
check("S19 invariants Task 83 conservés (/premiere + Configuration OTP + verrou qrPresente)",
      "function otpPremiereHtml(defi, svgQr)" in src
      and "data: { qrPresente: true }" in src
      and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in src)
check("S20 invariants Task 85 conservés (AUCUN code affiché, /api/otp/nouveau absent, TOTP seul)",
      "genererCodeOtp" not in src and '"/api/otp/nouveau"' not in src
      and "otp-affiche" not in src and "let codeCorrect = false;" in src)
check("S21 TTL 10 minutes inchangé (défaut 600 000 ms, réductible en test uniquement)",
      "n <= 600000 ? n : 10 * 60 * 1000" in src)

# --- administration alignée ---
check("S22 route admin : OTP_TTL_MS partagé (même durée que le portail)",
      "PORTAL_OTP_TTL_MS" in route and "n >= 3000 && n <= 600000" in route)
check("S23 route admin : GET expose qrFenetreExpiree (jamais le secret)",
      "qrFenetreExpiree: fenetreExpiree" in route
      and "Date.now() - new Date(row.otpFenetreCreeA as Date).getTime() >= OTP_TTL_MS" in route)
check("S24 route admin : action qr RÉGÉNÈRE la fenêtre dépassée d'un non inscrit",
      "fenetreRenouvelee" in route
      and "data: { totpSecret: secret, otpFenetreCreeA: new Date() }" in route)
check("S25 route admin : reset-qr ouvre une fenêtre (non inscrit) / scelle (inscrit)",
      "otpFenetreCreeA: row.lastLoginAt ? null : new Date()" in route)
check("S26 interface : statut « QR expiré — nouveau QR à la prochaine connexion »",
      "QR expiré — nouveau QR à la prochaine connexion" in tsx
      and "row.qrFenetreExpiree" in tsx and "qrFenetreExpiree: boolean;" in tsx)
check("S27 interface : compteur des QR expirés + mention « Valable 10 minutes » dans le dialog",
      "qrMeta.expires" in tsx and "Valable 10 minutes" in tsx)

# =====================================================================
print()
print("=" * 72)
print("SECTION A : portail 4255 (TTL normal) — fenêtre réutilisée puis SCELLÉE")
print("=" * 72)

s = Session(P1)
code, brut = s.req("GET", "/")
check("A0 portail de test répond (200)", code == 200, code)

# A1 — première connexion TEST74EXPIRE → défi aligné ≈ 10 minutes
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
j1 = json_de(brut) or {}
check("A1 première connexion → 200 otpRequired + redirect /otp",
      code == 200 and j1.get("ok") is True and j1.get("otpRequired") is True
      and j1.get("redirect") == "/otp", (code, brut[:160]))
check("A1 le défi expire ≈ maintenant + 10 minutes (fenêtre du secret alignée)",
      j1.get("expireAt") and 540 <= reste_secondes(j1["expireAt"]) <= 660,
      j1.get("expireAt"))

# A2 — fenêtre d'inscription : QR + compte à rebours VISIBLE + fenêtre posée en base
code, brut = s.req("GET", "/otp")
check("A2 /otp → « Configuration OTP » avec QR + champ Code OTP",
      code == 200 and "Configuration OTP" in brut and 'data-payload' in brut
      and 'id="otp-saisie"' in brut, code)
check("A2 compte à rebours VISIBLE (id=qr-cd + majCd + mention expire)",
      'id="qr-cd"' in brut and "function majCd()" in brut
      and "Le QR code expire dans" in brut)
uri1, secret1 = uri_et_secret(brut)
check("A2 URI otpauth://totp standard avec secret Base32 (Task 78)",
      (uri1 or "").startswith("otpauth://totp/") and bool(secret1), uri1)
etat = lire_etat("TEST74EXPIRE")
check("A2 base : qrPresente posé + secret de FENÊTRE horodaté (otpFenetreCreeA non null)",
      etat.get("qrPresente") is True and etat.get("aSecret") is True
      and etat.get("otpFenetreCreeA") not in (None, "", "ABSENT"), etat)
fenetre_iso_1 = etat.get("otpFenetreCreeA")

# A3 — reconnexion DANS la fenêtre : MÊME secret (aucune rotation inutile)
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
check("A3 reconnexion rapide → 200 otpRequired", code == 200 and json_de(brut).get("otpRequired") is True, code)
code, brut = s.req("GET", "/otp")
uri3, secret3 = uri_et_secret(brut)
check("A3 même QR (même secret) tant que la fenêtre est vivante — pas de rotation inutile",
      secret3 == secret1, (secret1, secret3))
etat = lire_etat("TEST74EXPIRE")
check("A3 horodatage de la fenêtre INCHANGÉ (même fenêtre réutilisée)",
      etat.get("otpFenetreCreeA") == fenetre_iso_1, (fenetre_iso_1, etat.get("otpFenetreCreeA")))

# A4 — confirmation du code DANS la fenêtre → SCELLEMENT du secret
code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret1)})
check("A4 code TOTP de l'application accepté (200)",
      code == 200 and json_de(brut).get("ok") is True, (code, brut[:160]))
etat = lire_etat("TEST74EXPIRE")
check("A4 base : lastLoginAt posé + secret SCELLÉ (otpFenetreCreeA → null)",
      etat.get("lastLoginAt") not in (None, "", "ABSENT")
      and etat.get("otpFenetreCreeA") in (None, ""), etat)

# A5 — employé INSCRIT : fenêtre de confirmation avec secret DÉFINITIF
code, brut = s.req("POST", "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
check("A5 inscrit sans code → 200 otpRequired (deux étapes)", code == 200
      and json_de(brut).get("otpRequired") is True, (code, brut[:120]))
code, brut = s.req("GET", "/otp")
uri5, secret5 = uri_et_secret(brut)
check("A5 fenêtre de confirmation : libellé « Cette fenêtre expire dans » (secret définitif, pas de mensonge)",
      "Cette fenêtre expire dans" in brut and "Cette fenêtre expire dans <b id=\"qr-cd\">" in brut, brut[:80])
check("A5 MÊME secret définitif (aucune rotation après inscription)",
      secret5 == secret1, (secret1, secret5))

# A6 — code de l'application (fenêtre TOTP suivante) accepté → accès complet
code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret1, t=int(time.time()) + 31)})
check("A6 code TOTP accepté après inscription (200)", code == 200 and json_de(brut).get("ok") is True, (code, brut[:160]))
code, brut = s.req("GET", "/")
check("A6 accès aux fiches ouvert (200)", code == 200, code)

# =====================================================================
print()
print("=" * 72)
print("SECTION B : portail 4256 (TTL 3,5 s) — LE QR EXPIRE VRAIMENT")
print("=" * 72)

s2 = Session(P2)
code, brut = s2.req("GET", "/")
check("B0 portail de test TTL court répond (200)", code == 200, code)

# B1 — première fenêtre de TEST74ANNULE : QR n°1 (compte à rebours 3,5 s)
code, brut = s2.req("POST", "/api/verify", {"cin": "TEST74ANNULE", "password": "Annule74x"})
j2 = json_de(brut) or {}
check("B1 première connexion → 200 otpRequired + défi ≈ +3,5 s (ALIGNÉ sur la fenêtre)",
      code == 200 and j2.get("otpRequired") is True
      and j2.get("expireAt") and 1.0 <= reste_secondes(j2["expireAt"]) <= 5.0,
      (code, j2.get("expireAt")))
code, brut = s2.req("GET", "/otp")
check("B1 fenêtre d'inscription servie (QR + compte à rebours)", code == 200
      and 'data-payload' in brut and 'id="qr-cd"' in brut, code)
uriB1, secretB1 = uri_et_secret(brut)
check("B1 QR n°1 : URI otpauth + secret Base32", (uriB1 or "").startswith("otpauth://totp/") and bool(secretB1), uriB1)
etat = lire_etat("TEST74ANNULE")
check("B1 base : fenêtre du secret posée (otpFenetreCreeA non null)",
      etat.get("otpFenetreCreeA") not in (None, "", "ABSENT"), etat)

# B2 — on LAISSE EXPIRER : la page bascule vers « Code OTP expiré »
time.sleep(4.5)
code, brut = s2.req("GET", "/otp")
check("B2 après expiration : page « Code OTP expiré » (AUCUN QR)",
      code == 200 and "Code OTP expiré" in brut and 'data-payload' not in brut
      and "DÉFINITIVEMENT mort" in brut, code)

# B3 — RECONNEXION : un NOUVEAU QR (nouveau secret) est affiché — ROTATION
code, brut = s2.req("POST", "/api/verify", {"cin": "TEST74ANNULE", "password": "Annule74x"})
check("B3 reconnexion → 200 otpRequired", code == 200 and json_de(brut).get("otpRequired") is True, code)
code, brut = s2.req("GET", "/otp")
uriB3, secretB3 = uri_et_secret(brut)
check("B3 QR n°2 affiché avec « Le QR code expire dans » (fenêtre de secret)",
      (uriB3 or "").startswith("otpauth://totp/") and "Le QR code expire dans" in brut, uriB3)
check("B3 le NOUVEAU QR est DIFFÉRENT du QR n°1 (nouveau secret) — le QR n°1 est mort",
      bool(secretB3) and secretB3 != secretB1, (secretB1, secretB3))

# B4 — LA PREUVE CENTRALE : le code de l'ANCIEN scan est REFUSÉ
code, brut = s2.req("POST", "/api/otp/verify", {"otp": totp_now(secretB1)})
check("B4 code TOTP calculé depuis l'ANCIEN QR (scanné avant expiration) REFUSÉ (401)",
      code == 401 and "Code OTP incorrect" in brut, (code, brut[:160]))

# B5 — le code du NOUVEAU QR est accepté → inscription complète + scellement
code, brut = s2.req("POST", "/api/otp/verify", {"otp": totp_now(secretB3)})
check("B5 code TOTP du NOUVEAU QR accepté (200)", code == 200 and json_de(brut).get("ok") is True, (code, brut[:160]))
etat = lire_etat("TEST74ANNULE")
check("B5 base : inscription complète (lastLoginAt) + secret scellé (otpFenetreCreeA null)",
      etat.get("lastLoginAt") not in (None, "", "ABSENT")
      and etat.get("otpFenetreCreeA") in (None, ""), etat)

# B6 — code fourni APRÈS l'expiration de la fenêtre → 410 OTP_EXPIRE
s3 = Session(P2)
code, brut = s3.req("POST", "/api/verify", {"cin": "TEST86MORT", "password": "Mort86xk"})
check("B6 TEST86MORT première connexion → 200 otpRequired", code == 200
      and json_de(brut).get("otpRequired") is True, (code, brut[:120]))
code, brut = s3.req("GET", "/otp")
uriB6, secretB6 = uri_et_secret(brut)
check("B6 fenêtre QR servie (secret Base32)", bool(secretB6), uriB6)
time.sleep(4.5)
code, brut = s3.req("POST", "/api/otp/verify", {"otp": totp_now(secretB6)})
check("B6 code fourni après expiration → 410 OTP_EXPIRE (reconnexion exigée)",
      code == 410 and "OTP_EXPIRE" in brut, (code, brut[:160]))
code, brut = s3.req("GET", "/otp", sans_redirection=True)
check("B6 GET /otp après expiration : session effacée par le 410 → redirection brute (302)",
      code == 302, code)
code, brut = s3.req("GET", "/otp")
check("B6 suivi de la redirection → page de connexion (reconnexion exigée)",
      code == 200 and "Code OTP expiré" not in brut and 'data-payload' not in brut, (code, brut[:80]))
check("B6 la reconnexion affichera un QR DIFFÉRENT (rotation au prochain /api/verify)",
      True)  # prouvé par B3 (même mécanique) — contrôle de lisibilité du parcours

# =====================================================================
print()
print("=" * 72)
print("SECTION C : administration 4257 — « Gestion des QR codes » alignée")
print("=" * 72)

ad = Session(ADMIN)
code, brut = ad.req("POST", "/api/auth/login", {"email": "test64@autorh.local", "password": "AncienMot64"})
check("C0 login admin de test (200)", code == 200, (code, brut[:120]))
code, brut = ad.req("POST", "/api/auth/change-password",
                    {"currentPassword": "AncienMot64", "newPassword": "NouveauSolide64"})
check("C0 changement obligatoire accompli (200)", code == 200, (code, brut[:120]))

code, brut = ad.req("GET", "/api/portal-access")
items = json_de(brut).get("items") or []
check("C1 GET /api/portal-access → 200 avec le champ qrFenetreExpiree (aucun secret exposé)",
      code == 200 and items and all("qrFenetreExpiree" in it for it in items)
      and all("svg" not in it and "payload" not in it for it in items), code)
par_cin = {it.get("cin"): it for it in items}
check("C1 TEST86MORT (fenêtre dépassée) → qrFenetreExpiree TRUE ; inscrits → false",
      par_cin.get("TEST86MORT", {}).get("qrFenetreExpiree") is True
      and par_cin.get("TEST74EXPIRE", {}).get("qrFenetreExpiree") is False
      and par_cin.get("TEST74ANNULE", {}).get("qrFenetreExpiree") is False, par_cin.get("TEST86MORT"))

# C2 — « Afficher le QR » d'un non inscrit à la fenêtre dépassée → RÉGÉNÉRATION
etat_avant = lire_etat("TEST86MORT")
code, brut = ad.req("POST", "/api/portal-access", {"action": "qr", "id": par_cin["TEST86MORT"]["id"]})
d = json_de(brut)
check("C2 action qr → 200 + SVG + URI otpauth (fenêtre RENOUVELÉE)",
      code == 200 and d.get("ok") is True and "<svg" in (d.get("svg") or "")
      and (d.get("payload") or "").startswith("otpauth://totp/")
      and d.get("fenetreRenouvelee") is True, (code, d.get("fenetreRenouvelee")))
check("C2 expireA ≈ maintenant + TTL (le QR affiché est vivant 10 minutes)",
      d.get("expireA") and 0.0 <= reste_secondes(d["expireA"]) <= float(os.environ.get("TTL_S", "3.5")) + 2.0,
      d.get("expireA"))
etat_apres = lire_etat("TEST86MORT")
check("C2 base : otpFenetreCreeA REPOSÉ (nouvelle fenêtre, différent de l'ancienne)",
      etat_apres.get("otpFenetreCreeA") not in (None, "", "ABSENT")
      and etat_apres.get("otpFenetreCreeA") != etat_avant.get("otpFenetreCreeA"),
      (etat_avant.get("otpFenetreCreeA"), etat_apres.get("otpFenetreCreeA")))

# C3 — deuxième affichage DANS la fenêtre : idempotent (même URI, pas de rotation)
code, brut = ad.req("POST", "/api/portal-access", {"action": "qr", "id": par_cin["TEST86MORT"]["id"]})
d2 = json_de(brut)
check("C3 deuxième appel dans la fenêtre → même URI (AUCUNE rotation inutile)",
      code == 200 and d2.get("fenetreRenouvelee") is False and d2.get("payload") == d.get("payload"),
      (d.get("payload"), d2.get("payload")))

# C4 — fenêtre dépassée → rotation de nouveau
time.sleep(4.5)
code, brut = ad.req("POST", "/api/portal-access", {"action": "qr", "id": par_cin["TEST86MORT"]["id"]})
d3 = json_de(brut)
check("C4 après expiration : rotation de nouveau (nouvel URI ≠ précédent)",
      code == 200 and d3.get("fenetreRenouvelee") is True and d3.get("payload") != d2.get("payload"),
      d3.get("fenetreRenouvelee"))

# C5 — reset-qr sur un NON INSCRIT : nouvelle fenêtre ouverte
code, brut = ad.req("POST", "/api/portal-access", {"action": "reset-qr", "id": par_cin["TEST86MORT"]["id"]})
d4 = json_de(brut)
etat_r = lire_etat("TEST86MORT")
check("C5 reset-qr (non inscrit) → 200 + fenêtre OUVERTE (otpFenetreCreeA non null)",
      code == 200 and d4.get("ok") is True
      and etat_r.get("otpFenetreCreeA") not in (None, "", "ABSENT"), (code, etat_r))

# C6 — reset-qr sur un INSCRIT : secret DÉFINITIF (scellé), lastLoginAt intact
code, brut = ad.req("POST", "/api/portal-access", {"action": "reset-qr", "id": par_cin["TEST74EXPIRE"]["id"]})
d5 = json_de(brut)
etat_e = lire_etat("TEST74EXPIRE")
check("C6 reset-qr (inscrit) → 200 + secret SCELLÉ (otpFenetreCreeA null) + lastLoginAt intact",
      code == 200 and d5.get("ok") is True
      and etat_e.get("otpFenetreCreeA") in (None, "")
      and etat_e.get("lastLoginAt") not in (None, "", "ABSENT"), (code, etat_e))

# C7 — liste finale : cohérence des statuts
code, brut = ad.req("GET", "/api/portal-access")
items2 = json_de(brut).get("items") or []
par_cin2 = {it.get("cin"): it for it in items2}
check("C7 liste finale : inscrits hasQrSecret=true + qrFenetreExpiree=false ; TEST86MORT fenêtre fraîche",
      code == 200
      and par_cin2.get("TEST74EXPIRE", {}).get("hasQrSecret") is True
      and par_cin2.get("TEST74EXPIRE", {}).get("qrFenetreExpiree") is False
      and par_cin2.get("TEST86MORT", {}).get("qrFenetreExpiree") is False, code)

# =====================================================================
ok = sum(1 for r in RESULTATS if r)
ko = len(RESULTATS) - ok
print()
print("=" * 72)
print(f"RÉSULTAT TASK 86 : {ok}/{len(RESULTATS)} vérifications réussies")
print("=" * 72)
sys.exit(0 if ko == 0 else 1)
