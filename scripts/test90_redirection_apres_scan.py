#!/usr/bin/env python3
"""
Task 90 — Après le scan du QR code, retour à la fenêtre INITIALE de
connexion (CIN + mot de passe + OTP), jamais d'ouverture directe du portail
quand la confirmation TERMINE l'inscription (« J'ai attendu 10 minutes
jusqu'à l'expiration du QR code. Ensuite, j'ai effectué une nouvelle
inscription : un nouveau QR code s'est affiché. Après l'avoir scanné, le
système me redirige vers l'interface « Vos fiches de paie ». Je ne souhaite
pas cette redirection. Après le scan du QR code, je veux être redirigé vers
la page d'inscription initiale, avec les champs suivants : CIN, Mot de
passe, OTP »).

AVANT (v0.2.19) : la confirmation du code sur la fenêtre /otp d'un défi NON
« premiere » (cas du QR expiré puis re-scanné à la reconnexion — la page
montre pourtant bien un QR d'INSCRIPTION, secret de fenêtre non scellé,
Tasks 85/86) ouvrait la session COMPLÈTE et renvoyait redirect=/ : l'employé
aboutissait DIRECTEMENT sur « Vos fiches de paie » sans jamais repasser par
la fenêtre de connexion à deux facteurs qu'il vient de configurer.

APRÈS (v0.2.20) :
  - /api/otp/verify : lorsque la confirmation termine l'INSCRIPTION
    (lastLoginAt null ET otpFenetreCreeA non null — secret de fenêtre non
    scellé), la réponse renvoie redirect=/premiere-reussie (la page
    « Configuration réussie » referme la session — Task 87 — puis ramène à
    la FENÊTRE INITIALE : CIN + mot de passe + code OTP) ;
  - la page /otp (otpHtml) suit la destination décidée par le serveur :
    /premiere-reussie (inscription terminée), /changer (Task 64), /
    (employé DÉJÀ INSCRIT — connexion normale à deux facteurs INCHANGÉE).

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test90_harnais.sh, portails de test 4264 TTL 3,5 s et 4265 TTL normal) :
sections 0/A/B/C ci-dessous.
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
import urllib.request

BASE = "/home/z/my-project"
RACINE = BASE
PORTAIL = BASE + "/scripts/portail-server.js"
PKG = BASE + "/package.json"
README = BASE + "/README-DEPLOIEMENT-LOCAL.md"
P_COURT = "http://127.0.0.1:4264"     # portail TTL 3,5 s (expiration réelle)
P_NORMAL = "http://127.0.0.1:4265"    # portail TTL normal (inscrit, sans pression)
DB_COPIE = BASE + "/sandbox-test90/test90.db"

CIN = "TEST74EXPIRE"
MDP = "Expire74x"

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


class _BloqueurRedirection(urllib.request.HTTPRedirectHandler):
    """Empêche urllib de suivre les 3xx (contrôle brut du code de statut)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def json_de(raw):
    try:
        return json.loads(raw)
    except Exception:
        return None


def uri_et_secret(page_html):
    """Extrait l'URI otpauth (data-payload du QR) puis le paramètre secret."""
    m = re.search(r'data-payload="([^"]+)"', page_html)
    if not m:
        return None, None
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
    print("TASK 90 — après le scan du QR : retour à la fenêtre initiale (CIN + mdp + OTP)")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}
    readm = open(README, encoding="utf-8").read()

    check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))

    # --- Portail : la branche d'inscription terminée dans /api/otp/verify ---
    check("S02 portail : branche « inscription vient de se terminer » (lastLoginAt null + otpFenetreCreeA non null)",
          "if (!acc.lastLoginAt && acc.otpFenetreCreeA) {" in src, "branche absente")
    check("S03 portail : la branche renvoie redirect=/premiere-reussie (PAS le portail)",
          'redirect: "/premiere-reussie",' in src, "redirect absent")
    check("S04 portail : la branche pose une session COMPLÈTE (exigée par la garde de /premiere-reussie)",
          "createPortalSession(sess.cin, remember, false)," in src, "session complète absente")
    check("S05 portail : l'employé DÉJÀ INSCRIT (secret scellé) ouvre toujours le portail (redirect /)",
          'redirect: "/",\n    });\n  }\n\n  // ---- (SUPPRIMÉ Task 85) endpoint /api/otp/nouveau ----' in src,
          "return inscrit modifié")
    check("S06 portail : commentaire (NOUVEAU Task 90) documente la demande « page d'inscription initiale »",
          "(NOUVEAU Task 90 — « Apres le scan du QR code, je veux etre redirige" in src
          and "vers la page d inscription initiale (CIN, Mot de passe, OTP) »)" in src,
          "commentaire")
    check("S07 portail : en-tête documente Task 90 (MÊME QUAND L'INSCRIPTION SE TERMINE SUR UN DÉFI NON PREMIERE)",
          "(NOUVEAU Task 90) APRÈS LE SCAN DU QR CODE, RETOUR À LA FENÊTRE" in src
          and "DÉFI NON « PREMIERE »" in src, "en-tête")

    # --- Portail : la page /otp suit la destination du serveur ---
    check("S08 portail (otpHtml) : destination /premiere-reussie suivie (inscription terminée)",
          'if (dest === "/premiere-reussie") {' in src
          and 'location.replace(apiUrl("/premiere-reussie"));' in src, "client /premiere-reussie")
    check("S09 portail (otpHtml) : /changer (Task 64) et / (inscrit) conservés",
          'location.replace(apiUrl(dest === "/changer" ? "/changer" : "/"));' in src, "client /changer ou /")
    check("S10 portail (otpHtml) : l'ANCIENNE décision mono-ligne (tout vers /) est SUPPRIMÉE",
          'location.replace(apiUrl(r.d && r.d.redirect === "/changer" ? "/changer" : "/"));' not in src,
          "ancienne ligne encore présente")
    check("S11 portail (otpHtml) : message « Code confirmé — configuration terminée… » (même parcours que Task 87)",
          "Code confirmé — configuration terminée…" in src, "message absent")

    # --- Invariants des Tasks antérieures ---
    check("S12 invariant Task 87 : /premiere-reussie referme la session (clearSessionCookie) + garde 302 /login",
          "if (pathname === \"/premiere-reussie\"" in src
          and "clearSessionCookie(res);" in src
          and "if (!sess || sess.pending || sess.otp) {" in src, "garde/fermeture")
    check("S13 invariant Task 88 : label « Auto-RH:Fiche de paie » conservé",
          'encodeURIComponent("Auto-RH:Fiche de paie")' in src, "label")
    check("S14 invariants Tasks 85/86 : AUCUN code affiché + fenêtre du secret (otpFenetreCreeA) conservée",
          'id="otp-affiche"' not in src and "otpFenetreCreeA" in src and 'id="qr-cd"' in src,
          "invariant 85/86")
    check("S15 README : section 55 (après le scan du QR, retour à la fenêtre initiale) + 54/53 intactes",
          "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm
          and "## 54. Démarrage local bloqué" in readm
          and "## 53. Authenticator : l'« Account Name » affiche « Fiche de paie » au lieu du CIN" in readm,
          "README")

    # =====================================================================
    print()
    print("=" * 72)
    print("SECTION A : portail 4264 (TTL 3,5 s) — LE SCÉNARIO DE L'UTILISATEUR")
    print("QR n°1 → expiration → nouvelle inscription (QR n°2) → scan + code")
    print("→ « Configuration réussie » + FENÊTRE INITIALE (PAS les fiches)")
    print("=" * 72)

    s = Session(P_COURT)
    code, brut = s.req("GET", "/", sans_redirection=True)
    check("A0 portail de test répond (200)", code == 200, code)

    # A1 — première connexion TEST74EXPIRE → défi premiere (QR n°1)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP})
    j1 = json_de(brut) or {}
    check("A1 première connexion → 200 otpRequired + redirect /otp (premiereConnexion)",
          code == 200 and j1.get("ok") is True and j1.get("otpRequired") is True
          and j1.get("redirect") == "/otp" and j1.get("premiereConnexion") is True, (code, brut[:160]))
    code, brut = s.req("GET", "/otp")
    check("A2 fenêtre d'inscription « Configuration OTP » avec QR + champ Code OTP",
          code == 200 and "Configuration OTP" in brut and 'data-payload' in brut
          and 'id="otp-saisie"' in brut, code)
    uri1, secret1 = uri_et_secret(brut)
    check("A2 QR n°1 : URI otpauth://totp standard avec secret Base32",
          (uri1 or "").startswith("otpauth://totp/") and bool(secret1), uri1)
    etat = lire_etat(CIN)
    check("A2 base : verrou qrPresente posé + secret de FENÊTRE (otpFenetreCreeA non null)",
          etat.get("qrPresente") is True and etat.get("otpFenetreCreeA") not in (None, "", "ABSENT"), etat)

    # A3 — LE SCÉNARIO : on LAISSE EXPIRER (10 min en production, 3,5 s ici)
    # puis NOUVELLE INSCRIPTION à la reconnexion (QR n°2, nouveau secret).
    time.sleep(4.5)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP})
    j2 = json_de(brut) or {}
    check("A3 reconnexion après expiration → 200 otpRequired + premiereConnexion:false (défi NON premiere)",
          code == 200 and j2.get("ok") is True and j2.get("otpRequired") is True
          and j2.get("premiereConnexion") is False, (code, brut[:160]))
    code, brut = s.req("GET", "/otp")
    check("A3 la fenêtre affiche UN NOUVEAU QR (page « Vérification en deux étapes », défi non premiere)",
          code == 200 and "Vérification en deux étapes" in brut and 'data-payload' in brut, code)
    uri2, secret2 = uri_et_secret(brut)
    check("A3 le NOUVEAU QR est DIFFÉRENT du QR n°1 (nouveau secret — Task 86)",
          bool(secret2) and secret2 != secret1, (secret1, secret2))

    # A4 — LE CŒUR TASK 90 : scan du nouveau QR + confirmation du code
    w_scan = fenetre_actuelle()
    code, brut = s.req("POST", "/api/otp/verify", {"otp": totp_now(secret2)})
    j3 = json_de(brut) or {}
    check("A4 code TOTP du NOUVEAU QR accepté (200)", code == 200 and j3.get("ok") is True, (code, brut[:160]))
    check("A4 (MODIFIÉ Task 90) redirect=/premiere-reussie — JAMAIS « / » (l'inscription vient de se terminer)",
          j3.get("redirect") == "/premiere-reussie", j3)
    check("A4 AUCUN mustChangePassword (le mot de passe est déjà en place)",
          j3.get("mustChangePassword") is None, j3)
    etat = lire_etat(CIN)
    check("A4 base : lastLoginAt posé + secret SCELLÉ (otpFenetreCreeA → null)",
          etat.get("lastLoginAt") not in (None, "", "ABSENT")
          and etat.get("otpFenetreCreeA") in (None, ""), etat)

    # A5 — la page « Configuration réussie » referme la session (Task 87)
    code, brut = s.req("GET", "/premiere-reussie")
    check("A5 /premiere-reussie → 200 « Configuration réussie » + session FERMÉE (cookie effacé)",
          code == 200 and "Configuration réussie" in brut
          and "portail_session" not in s.cookies, (code, s.cookies))

    # A6 — le portail n'est PAS ouvert : la fenêtre initiale est servie
    code, brut = s.req("GET", "/")
    check("A6 GET / sans session → FENÊTRE INITIALE servie (formulaire de connexion, PAS « Vos fiches de paie »)",
          code == 200 and 'id="form"' in brut and "Vos fiches de paie" not in brut
          and "Code OTP" in brut, (code, brut[:120]))
    code, brut = s.req("GET", "/api/my-fiches")
    check("A6 /api/my-fiches sans session → 401 (les fiches restent inaccessibles)",
          code == 401, (code, brut[:100]))

    # A7 — RECONNEXION COMPLÈTE par la fenêtre initiale (3 champs)
    attendre_fenetre_apres(w_scan)  # anti-rejeu : fenêtre strictement postérieure au scan
    w_a7 = fenetre_actuelle()
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP, "otp": totp_now(secret2)})
    j4 = json_de(brut) or {}
    check("A7 reconnexion 3 champs (CIN + mot de passe + OTP) → 200 redirect=/",
          code == 200 and j4.get("ok") is True and j4.get("redirect") == "/", (code, brut[:160]))
    code, brut = s.req("GET", "/")
    check("A7 « Vos fiches de paie » accessible APRÈS l'authentification complète",
          code == 200 and "Vos fiches de paie" in brut, (code, brut[:120]))

    # =====================================================================
    print()
    print("=" * 72)
    print("SECTION B : portail 4265 (TTL normal) — EMPLOYÉ DÉJÀ INSCRIT :")
    print("la confirmation d'un QR ouvre TOUJOURS l'espace directement")
    print("=" * 72)

    s2 = Session(P_NORMAL)
    code, brut = s2.req("POST", "/api/logout")
    check("B0 déconnexion (logout → 200)", code == 200, code)
    code, brut = s2.req("POST", "/api/verify", {"cin": CIN, "password": MDP})
    j5 = json_de(brut) or {}
    check("B1 connexion de l'inscrit → 200 otpRequired (deux étapes, sans QR « premiere »)",
          code == 200 and j5.get("ok") is True and j5.get("otpRequired") is True
          and j5.get("premiereConnexion") is False, (code, brut[:160]))
    code, brut = s2.req("GET", "/otp")
    uriB, secretB = uri_et_secret(brut)
    check("B1 la fenêtre QR porte le secret DÉFINITIF (scellé à l'inscription — Task 86)",
          bool(secretB) and secretB == secret2, (secret2, secretB))
    w_b = fenetre_actuelle()
    attendre_fenetre_apres(w_a7)  # anti-rejeu : fenêtre strictement postérieure à A7
    code, brut = s2.req("POST", "/api/otp/verify", {"otp": totp_now(secretB)})
    j6 = json_de(brut) or {}
    check("B2 (INVARIANT) confirmé DÉJÀ INSCRIT → 200 + redirect=/ (accès direct au portail)",
          code == 200 and j6.get("ok") is True and j6.get("redirect") == "/", (code, brut[:160]))
    code, brut = s2.req("GET", "/")
    check("B2 « Vos fiches de paie » ouverte directement (connexion normale à deux facteurs)",
          code == 200 and "Vos fiches de paie" in brut, (code, brut[:120]))

    # =====================================================================
    print("\n--- SECTION C : invariants (garde de /premiere-reussie, refus) ---")
    s3 = Session(P_NORMAL)
    code, brut = s3.req("GET", "/premiere-reussie", sans_redirection=True)
    check("C1 /premiere-reussie SANS session → 302 /login (garde intacte)",
          code == 302, (code, brut[:100]))
    code, brut = s3.req("POST", "/api/verify", {"cin": "CININCONNU90", "password": "peu importe"})
    check("C2 CIN inconnu → 401 message générique (aucune fuite)",
          code == 401 and json_de(brut).get("error") == "CIN ou mot de passe incorrect. Réessayez.",
          (code, brut[:120]))

    return bilan("TASK90")


if __name__ == "__main__":
    sys.exit(main())
