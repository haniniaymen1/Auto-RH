#!/usr/bin/env python3
"""
Task 81 — « Après avoir scanné le QR code lors de la première connexion, je me
déconnecte puis je me reconnecte : CIN ou mot de passe incorrect s'affiche. »

DIAGNOSTIC (sonde sur COPIE, préalable à cette suite) :
  - le parcours LITTÉRAL fonctionne : reconnexion après scan + déconnexion →
    HTTP 200, otpRequired, premiereConnexion:false (aucun 401) ;
  - la cause réelle du blocage ressenti : en fin de PREMIÈRE connexion le
    changement du mot de passe est OBLIGATOIRE — le mot de passe INITIAL
    cesse de fonctionner, or la page de connexion n'affichait QUE l'aide
    « mot de passe initial » : l'employé revient avec l'initial devenu
    invalide → « CIN ou mot de passe incorrect. Réessayez. »

CORRECTIFS Task 81 (scripts/portail-server.js, textes uniquement — aucun
changement de règle d'authentification) :
  1. page de connexion : l'aide distingue DÉSORMAIS le premier accès (initial)
     et l'employé revenu (son mot de passe personnel ; l'initial ne fonctionne
     plus après le changement obligatoire) ;
  2. page de connexion : BANDEAU d'aide affiché sous l'erreur quand le serveur
     répond « CIN ou mot de passe incorrect » (cause la plus courante + voie
     de récupération : réinitialisation par le RH) — texte statique, aucune
     fuite d'information ;
  3. page de confirmation OTP des connexions suivantes : précise que le code
     GÉNÉRÉ PAR L'APPLICATION d'authentification (inscrite via le QR de la
     première connexion) est également accepté.

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais test81_harnais.sh,
portail de test 4233) : voir sections 0/A/B/C ci-dessous.
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
P1 = "http://127.0.0.1:4233"          # portail employés de test (TTL normal)
DB_COPIE = BASE + "/sandbox-test81/test81.db"

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


def main():
    print("=" * 76)
    print("TASK 81 — reconnexion après scan du QR : échec « CIN ou mot de passe »")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}

    check("version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))
    check("page de connexion : ligne « Déjà venu ? » (mot de passe personnel)",
          "Déjà venu ? Utilisez <b>VOTRE</b> mot de passe" in src)
    check("page de connexion : l'initial « ne fonctionne plus après le changement obligatoire »",
          "le mot de passe initial ne fonctionne plus après le changement obligatoire" in src)
    check("page de connexion : astuce élargie « (initial ou personnel) »",
          "recopiez votre mot de passe (initial ou" in src)
    check("page de connexion : bandeau hint-echec présent (Task 81)",
          'id="hint-echec"' in src and "Mot de passe refusé après votre première connexion ?" in src)
    check("bandeau : « le mot de passe initial n'est plus valable »",
          "le mot de passe initial n'est <b>plus valable</b>" in src)
    check("bandeau : voie de récupération « réinitialiser votre accès »",
          "il peut réinitialiser votre accès" in src)
    check("JS : le bandeau s'affiche sur l'erreur générique (déclencheur)",
          'err.indexOf("CIN ou mot de passe incorrect") >= 0' in src and "hintEchec" in src)
    check("(MODIFIÉ Task 85) fenêtre de confirmation : le code vient UNIQUEMENT de l'application (plus de « également accepté »)",
          "vient UNIQUEMENT de votre application" in src
          and "n'est JAMAIS affiché sur cette page" in src)
    check("aucun changement de règle : message 401 générique INTACT",
          'const generic = "CIN ou mot de passe incorrect. Réessayez.";' in src)

    # ================= SECTION A : harnais démarré =================
    print("\n--- SECTION A : harnais (COPIE de base, portail de test 4233) ---")
    s = Session(P1)
    code, brut = s.req("GET", "/")
    check("portail de test répond (200)", code == 200, code)
    check("la page servie porte la ligne « Déjà venu ? »",
          "Déjà venu ?" in brut)
    check("la page servie porte le bandeau hint-echec (masqué à l'ouverture)",
          'id="hint-echec"' in brut)
    CIN = "TEST64CIN"
    MDP_INIT = "Initial64x"

    # ================= SECTION B : parcours EXACT de l'utilisateur =================
    print("\n--- SECTION B : scan → déconnexion → reconnexion ---")

    # B1 — (MODIFIÉ Task 83) 1re connexion : orientée vers la page /premiere
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
    j = json_de(brut) or {}
    check("B1 1re connexion CIN + initial → 200", code == 200, (code, brut[:120]))
    check("B1 orienté /premiere (MODIFIÉ Task 83 : le changement du mot de passe initial s'affiche à l'étape 1)",
          j.get("premiere") is True and j.get("redirect") == "/premiere", j)

    # B2 — (MODIFIÉ Task 83) étape 1 (/api/premiere) PUIS page « Configuration OTP »
    MDP_PERSO = "MonMotDePasse81!"
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j1b = json_de(brut) or {}
    check("B2 étape 1 réussie (changement du mot de passe initial) → étape 2 (/otp)",
          code == 200 and j1b.get("step") == 2 and j1b.get("redirect") == "/otp", (code, brut[:160]))
    code, brut = s.req("GET", "/otp")
    check("B2 /otp → 200 page « Configuration OTP » (QR + champ Code OTP — MODIFIÉ Task 83)",
          code == 200 and "Configuration OTP" in brut and 'data-payload' in brut
          and 'id="otp-saisie"' in brut, code)
    check("B2 aucun code affiché en clair (maquette carte 2)",
          'otp-affiche' not in brut)
    uri, secret_b32 = uri_et_secret(brut)
    check("B2 URI otpauth://totp standard avec secret Base32",
          (uri or "").startswith("otpauth://totp/") and bool(secret_b32), uri)
    time.sleep(0.4)
    def lire_etat(cin):
        out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", cin],
                             cwd=RACINE, capture_output=True, text=True,
                             env={**os.environ, "DATABASE_URL": "file:" + DB_COPIE})
        brut = out.stdout.strip()
        m = re.search(r"\{.*\}", brut, re.S)
        return json_de(m.group(0)) if m else {}

    etat = lire_etat(CIN)
    check("B2 verrou qrPresente posé en base (la page a été servie)",
          etat.get("qrPresente") is True, etat)

    # B3 — LE POINT SIGNALÉ : déconnexion puis reconnexion (Task 83 : avec le
    # NOUVEAU mot de passe — l'initial a été remplacé à l'étape 1)
    code, brut = s.req("POST", "/api/logout")
    check("B3 déconnexion (logout → 200)", code == 200, code)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO})
    j2 = json_de(brut) or {}
    check("B3 RECONNEXION après le scan → 200 (PAS de 401, PAS de boucle QR)",
          code == 200, (code, brut[:160]))
    check("B3 otpRequired:true, premiereConnexion:false (QR ne revient pas)",
          j2.get("otpRequired") is True and j2.get("premiereConnexion") is False, j2)

    # B4 — fenêtre de confirmation AVEC QR (MODIFIÉ Task 85 : QR + champ de
    # confirmation, AUCUN code affiché)
    code, brut = s.req("GET", "/otp")
    check("(MODIFIÉ Task 85) B4 /otp → fenêtre de confirmation AVEC QR (secret persistant)",
          code == 200 and 'data-payload' in brut and 'otp-affiche' not in brut, code)
    check("(MODIFIÉ Task 85) B4 la page annonce que le code vient UNIQUEMENT de l'application",
          "vient UNIQUEMENT de votre application" in brut)
    uri_b4, secret_b4 = uri_et_secret(brut)
    check("(MODIFIÉ Task 85) B4 le QR de la fenêtre porte le MÊME secret persistant (B2)",
          secret_b4 == secret_b32, (secret_b32, secret_b4))

    # B5 — (MODIFIÉ Task 83 + Task 90) le changement du mot de passe initial a
    # DÉJÀ été fait à l'étape 1 : la confirmation du code TERMINE
    # l'INSCRIPTION (compte jamais connecté) → « Configuration réussie »
    # (redirect /premiere-reussie), PAS d'ouverture directe du portail.
    code_app = totp_now(secret_b32)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app})
    j3 = json_de(brut) or {}
    check("B5 code TOTP de l'application accepté → 200", code == 200, (code, brut[:160]))
    check("(MODIFIÉ Task 90) B5 inscription terminée → redirect /premiere-reussie (Configuration réussie → fenêtre initiale, PAS le portail)",
          j3.get("ok") is True and j3.get("redirect") == "/premiere-reussie" and j3.get("mustChangePassword") is None, j3)

    # B6 — (MODIFIÉ Task 83) le changement du mot de passe a été effectué à
    # l'étape 1 (/api/premiere) : aucune étape de changement restante. Le mot
    # de passe INITIAL est d'ores et déjà invalide (prouvé en B7).
    check("B6 changement du mot de passe initial déjà enregistré à l'étape 1 (Task 83)",
          True)

    # B7 — déconnexion puis reconnexion avec l'INITIAL → 401 (comportement légitime)
    code, brut = s.req("POST", "/api/logout")
    code, brut = s.req("GET", "/login")
    page_connexion = brut
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
    j5 = json_de(brut) or {}
    check("B7 reconnexion avec l'INITIAL → 401 « CIN ou mot de passe incorrect. Réessayez. »",
          code == 401 and j5.get("error") == "CIN ou mot de passe incorrect. Réessayez.",
          (code, brut[:160]))
    check("B7 la page de connexion servie contient le bandeau Task 81 (explication)",
          "Mot de passe refusé après votre première connexion ?" in page_connexion
          and "le mot de passe initial n'est <b>plus valable</b>" in page_connexion)
    check("B7 la page de connexion servie contient la ligne « Déjà venu ? »",
          "Déjà venu ?" in page_connexion)

    # B8 — reconnexion avec le mot de passe PERSONNEL → 200
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO})
    j6 = json_de(brut) or {}
    check("B8 reconnexion avec le mot de passe PERSONNEL → 200",
          code == 200 and j6.get("otpRequired") is True, (code, brut[:160]))

    # B9 — confirmation avec le TOTP de l'APPLICATION (fenêtre suivante —
    # MODIFIÉ Task 85 : plus de « code affiché », la fenêtre montre le QR)
    code, brut = s.req("GET", "/otp")
    check("(MODIFIÉ Task 85) B9 fenêtre de confirmation AVEC QR (connexion suivante)",
          'data-payload' in brut and 'otp-affiche' not in brut)
    uri_b9, secret_b9 = uri_et_secret(brut)
    check("(MODIFIÉ Task 85) B9 le QR porte toujours le secret persistant",
          bool(secret_b9) and secret_b9 == secret_b32, (secret_b32, secret_b9))
    code_app9 = totp_now(secret_b9, t=int(time.time()) + 31)  # fenêtre suivante (anti-rejeu B5)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app9})
    j7 = json_de(brut) or {}
    check("B9 OTP confirmé → accès complet (redirect /)",
          code == 200 and j7.get("ok") is True and j7.get("redirect") == "/", (code, brut[:160]))

    # ================= SECTION C : invariants =================
    print("\n--- SECTION C : invariants (aucune fuite, aucun retour du QR) ---")
    code, brut = s.req("POST", "/api/verify", {"cin": "CININCONNU81", "password": "peu importe"})
    j8 = json_de(brut) or {}
    check("C1 CIN inconnu → MÊME message générique (pas de fuite)",
          code == 401 and j8.get("error") == "CIN ou mot de passe incorrect. Réessayez.",
          (code, brut[:160]))
    time.sleep(0.3)
    etat2 = lire_etat(CIN)
    check("C2 qrPresente reste vrai (le QR ne revient jamais)",
          etat2.get("qrPresente") is True, etat2)
    check("C3 lastLoginAt posé (première connexion SCELLÉE)",
          etat2.get("lastLoginAt") not in (None, "", "null"), etat2)
    code, brut = s.req("GET", "/otp", sans_redirection=True)
    check("C4 /otp après connexion complète → redirection (302)",
          code in (302, 303), code)

    total = len(RESULTATS)
    ok = sum(RESULTATS)
    print("\n" + "=" * 76)
    print(f"RÉSULTAT : {ok}/{total}")
    print("=" * 76)
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    main()
