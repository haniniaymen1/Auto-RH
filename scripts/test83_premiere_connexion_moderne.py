#!/usr/bin/env python3
"""
Task 83 — interface moderne du portail employé (maquette utilisateur) :
« 1. Première connexion : CIN + Mot de passe initial + Nouveau mot de passe +
Répéter le nouveau mot de passe + Valider → 2e étape : QR Code OTP + champ
Code OTP + message d'expiration 10 minutes + Valider. 2. Connexions
suivantes : CIN + Mot de passe + OTP + Se connecter. Règles : le mot de
passe initial ne sert qu'à la première connexion ; l'utilisateur DOIT
définir un nouveau mot de passe ; le QR code n'est généré qu'à la première
connexion, expire après 10 minutes, et n'est JAMAIS ré-affiché ensuite. »

IMPLÉMENTATION (scripts/portail-server.js, v0.2.13) :
  - page /premiere (étape 1, carte 1 de la maquette) + POST /api/premiere
    (identification + changement du mot de passe initial en une requête) ;
  - page /otp mode première (étape 2, carte 2) : QR + champ Code OTP +
    mention d'expiration + Valider (REMPLACE la page « QR seul » Task 80) ;
  - page /premiere-reussie (carte 3) : « Configuration réussie » ;
  - /api/verify oriente vers /premiere tout compte mustChangePassword ;
  - /api/otp/verify accepte le code pendant l'inscription (refus Task 80
    OTP_QR_A_SCANNER supprimé) ;
  - connexions suivantes : 3 champs (CIN + mot de passe + OTP) Task 82,
    connexion en UNE étape, QR jamais ré-affiché (verrou qrPresente) ;
  - design modernisé (fond clair bleuté, cartes blanches arrondies, ombres
    légères, cercles icônes verts depuis Task 84 — bleu #2563eb → vert
    #059669 —, œil afficher/masquer, boutons verts).

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test83_harnais.sh, portail de test 4235) : sections 0/A/B/C ci-dessous.
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
P1 = "http://127.0.0.1:4235"          # portail employés de test (TTL normal)
DB_COPIE = BASE + "/sandbox-test83/test83.db"

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
    print("TASK 83 — première connexion en 2 étapes (maquette) + design moderne")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}

    check("version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))

    # --- Page /premiere (étape 1 — carte 1 de la maquette) ---
    check("étape 1 : page /premiere avec les 4 champs demandés",
          '<label for="cin">CIN</label>' in src
          and '<label for="password">Mot de passe initial</label>' in src
          and '<label for="nouveau">Nouveau mot de passe</label>' in src
          and '<label for="repete">Répéter le nouveau mot de passe</label>' in src)
    check("étape 1 : bouton « Valider » + POST /api/premiere",
          'id="form-premiere"' in src and 'fetch(apiUrl("/api/premiere")' in src
          and "Valider" in src)
    check("étape 1 : sous-titre maquette (« changer votre mot de passe initial et configurer votre compte OTP »)",
          "vous devez changer votre mot de\n        passe initial et configurer votre compte OTP" in src)
    check("étape 1 : œil afficher/masquer sur les 3 champs mot de passe",
          src.count('class="oeil" data-cible=') >= 4)  # 1 connexion + 3 ici

    # --- Page /otp mode première (étape 2 — carte 2 de la maquette) ---
    check("étape 2 : otpPremiereHtml remplace otpQrSeulHtml",
          "function otpPremiereHtml(defi, svgQr)" in src
          and "function otpQrSeulHtml" not in src)
    check("étape 2 : « Configuration OTP » + badge d'étape 2",
          '<span class="carte-titre">Configuration OTP</span>' in src
          and '<span class="etq-etape" aria-hidden="true">2</span>' in src)
    check("étape 2 : QR (data-payload) + champ « Code OTP » + bouton « Valider »",
          'id="qr-bloc" data-payload=' in src
          and '<label for="otp-saisie">Code OTP</label>' in src
          and 'id="btn-otp"' in src)
    check("(MODIFIÉ Task 86) étape 2 : mention d'expiration avec compte à rebours en direct « Le QR code expire dans »",
          'Le QR code expire dans <b id="qr-cd">&nbsp;${LIBELLE_OTP}</b>.' in src)
    check("étape 2 : le code confirmé ouvre /premiere-reussie",
          'location.replace(apiUrl("/premiere-reussie"))' in src)

    # --- Page /premiere-reussie (carte 3 de la maquette) ---
    check("carte 3 : page « Configuration réussie » servie à /premiere-reussie",
          "const SUCCESS_HTML" in src and ">Configuration réussie</h1>" in src
          and "Votre compte est maintenant sécurisé avec l'authentification à deux" in src)
    check("carte 3 : encadré vert « Le QR code n'est affiché que lors de la première connexion. »",
          "Le QR code n'est affiché que lors de la première connexion.</span>" in src)
    check("(MODIFIÉ Task 87) carte 3 : bouton « Aller à la page de connexion » + redirection automatique vers /login",
          "Aller à la page de connexion" in src and 'setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);' in src
          and 'href="/login" id="btn-connexion"' in src)

    # --- Page de connexion (2ᵉ connexion et suivantes — maquette bas) ---
    check("connexion : tête de carte « Connexion » + sous-titre maquette",
          '<span class="carte-titre">Connexion</span>' in src
          and "Veuillez vous identifier pour accéder à votre portail employé." in src)
    check("connexion : 3 champs CIN + mot de passe + OTP + « Se connecter »",
          'id="otp" name="otp"' in src and 'id="password" name="password"' in src
          and "Se connecter" in src)
    check("connexion : lien visible vers la page Première connexion (/premiere)",
          '<a class="lien-premiere" href="/premiere">Première connexion ? (mot de passe initial + configuration OTP)</a>' in src)
    check("connexion : JS suit redirect « /premiere »",
          'if (r.data && r.data.premiere) {' in src
          and 'location.replace(apiUrl("/premiere"));' in src)

    # --- Serveur : /api/premiere ---
    check("serveur : /api/premiere — identification + changement en une requête",
          'if (pathname === "/api/premiere" && req.method === "POST") {' in src
          and "validerNouveauMotDePasse(nouveauPropre, actuelPropre, cin)" in src)
    check("serveur : répétition vérifiée (« La répétition ne correspond pas au nouveau mot de passe. »)",
          '"La répétition ne correspond pas au nouveau mot de passe.",' in src)
    check("serveur : message générique identique (pas d'énumération) + verrouillage 423",
          'const genericPremiere = "CIN ou mot de passe incorrect. Réessayez.";' in src
          and 'return sendJson(res, 423, {' in src)
    check("serveur : refus si mot de passe déjà personnalisé (400)",
          "Votre mot de passe est déjà personnalisé. Connectez-vous avec votre CIN, votre mot de passe et votre code OTP." in src)
    check("serveur : politique du nouveau mot de passe identique à /api/change-password (Task 64/66)",
          "const nouveauPropre = nettoyerMotDePasse(nouveauBrut);" in src
          and "cryptoBd.chiffrerChamp(hacherMotDePasse(nouveauPropre), false)" in src)
    check("(MODIFIÉ Task 86) serveur : secret de FENÊTRE pour l'étape 2 (réutilisé vivant / régénéré sinon) + défi aligné",
          "const fenetre = await obtenirSecretFenetre(acc);" in src
          and "const secretPremiere = fenetre.secret;" in src
          and "creerDefiOtp(cin, false, premiereInscription, secretPremiere, fenetre.expireAt);" in src)
    check("serveur : QR unique (verrou !lastLoginAt && !qrPresente) — JAMAIS ré-affiché",
          "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in src)

    # --- Serveur : /api/verify + /api/otp/verify ---
    check("serveur : /api/verify oriente mustChangePassword vers /premiere",
          "if (acc.mustChangePassword) {\n      return sendJson(res, 200, {\n        ok: true,\n        premiere: true," in src
          and 'redirect: "/premiere",' in src)
    check("serveur : refus Task 80 OTP_QR_A_SCANNER SUPPRIMÉ (le code est accepté pendant l'inscription)",
          'code: "OTP_QR_A_SCANNER"' not in src)
    check("serveur : /api/otp/verify scelle la première connexion (lastLoginAt)",
          "lastLoginAt: new Date()," in src)

    # --- Design moderne (maquette) ---
    check("design : fond clair bleuté #f4f6fb (4 blocs CSS)",
          src.count("background: #f4f6fb;") == 4)
    check("design : cartes blanches arrondies + ombres légères (rgba(15, 23, 42, 0.07))",
          src.count("box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);") == 4)
    check("design : cercles icônes verts + badge d'étape + œil + notes vertes",
          ".icon-rond {" in src and ".etq-etape {" in src and ".oeil {" in src
          and ".note-verte {" in src and ".expire-note {" in src)
    check("design : cercles du portail EN VERT (Task 84) — 8 cercles #059669, 8 ombres vertes, AUCUN bleu restant",
          src.count("border-radius: 50%; background: #059669;") == 8
          and src.count("box-shadow: 0 6px 14px rgba(5, 150, 105, 0.28);") == 8
          and src.count("#2563eb") == 0
          and src.count("rgba(37, 99, 235") == 0)
    check("design : boutons verts inchangés (#059669)",
          "background: #059669;" in src)

    # ================= SECTION A : pages servies =================
    print("\n--- SECTION A : pages servies (portail de test 4235) ---")
    s = Session(P1)
    code, brut = s.req("GET", "/login")
    check("A1 /login → 200 avec tête de carte + lien /premiere + œil",
          code == 200 and "carte-titre\">Connexion" in brut
          and 'href="/premiere"' in brut and 'class="oeil"' in brut, code)
    code, brut = s.req("GET", "/premiere")
    check("A2 /premiere → 200 avec les 4 champs + bouton Valider",
          code == 200 and ">CIN</label>" in brut and ">Mot de passe initial</label>" in brut
          and ">Nouveau mot de passe</label>" in brut
          and ">Répéter le nouveau mot de passe</label>" in brut
          and "Valider" in brut, code)
    code, brut = s.req("GET", "/premiere-reussie", sans_redirection=True)
    check("A3 /premiere-reussie sans session → 302 vers /login",
          code in (302, 303) and "/login" in brut or code in (302, 303), (code, brut[:80]))

    # ================= SECTION B : parcours maquette =================
    print("\n--- SECTION B : première connexion en 2 étapes (cartes 1→2→3) ---")
    CIN = "TEST64CIN"
    MDP_INIT = "Initial64x"
    MDP_PERSO = "MonMotDePasse83!"

    # B1 — la connexion classique oriente vers la page /premiere
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
    j = json_de(brut) or {}
    check("B1 CIN + initial → 200 premiere:true redirect:/premiere (PAS otpRequired)",
          code == 200 and j.get("premiere") is True and j.get("redirect") == "/premiere"
          and j.get("otpRequired") is None, (code, brut[:160]))

    # B2 — erreurs de saisie sur /api/premiere (contrôles avant la réussite)
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": "AutreMot83x!", "confirm": "Different83!"})
    j2 = json_de(brut) or {}
    check("B2 répétition différente → 400 explicite",
          code == 400 and "La répétition ne correspond pas au nouveau mot de passe." in str(j2.get("error", "")),
          (code, brut[:160]))
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": "FauxMotDePasse", "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j3 = json_de(brut) or {}
    check("B2 mot de passe initial faux → 401 message GÉNÉRIQUE (aucune fuite)",
          code == 401 and j3.get("error") == "CIN ou mot de passe incorrect. Réessayez.", (code, brut[:160]))

    # B3 — LE PARCOURS RÉUSSI : étape 1 (identification + changement)
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j5 = json_de(brut) or {}
    check("B3 étape 1 réussie → 200 ok step:2 redirect:/otp",
          code == 200 and j5.get("ok") is True and j5.get("step") == 2
          and j5.get("redirect") == "/otp", (code, brut[:160]))
    check("B3 premiereConnexion:true (le QR va s'afficher — première et dernière fois)",
          j5.get("premiereConnexion") is True, j5)

    # B4 — étape 2 : page « Configuration OTP » (QR + champ + mention + Valider)
    code, brut = s.req("GET", "/otp")
    check("B4 /otp → 200 « Configuration OTP » (badge 2) avec QR",
          code == 200 and "Configuration OTP" in brut and 'data-payload' in brut, code)
    check("B4 champ « Code OTP » + mention d'expiration + bouton « Valider » présents",
          '<label for="otp-saisie">Code OTP</label>' in brut
          and "Le QR code expire dans" in brut and 'id="btn-otp"' in brut)
    check("B4 AUCUN code affiché en clair (maquette : QR + saisie uniquement)",
          'otp-affiche' not in brut)
    uri, secret_b32 = uri_et_secret(brut)
    check("B4 URI otpauth://totp standard avec secret Base32 (Task 78 conservée)",
          (uri or "").startswith("otpauth://totp/") and bool(secret_b32), uri)
    time.sleep(0.4)
    etat = lire_etat(CIN)
    check("B4 verrou qrPresente posé en base (le QR ne reviendra JAMAIS)",
          etat.get("qrPresente") is True, etat)
    check("B4 secret TOTP persistant en base (aSecret) — le QR encode le secret de l'employé",
          etat.get("aSecret") is True, etat)
    w_qr = fenetre_actuelle()

    # B5 — validation du code de l'application DANS la fenêtre d'inscription
    code_app = totp_now(secret_b32)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app})
    j6 = json_de(brut) or {}
    check("B5 code TOTP de l'application accepté pendant l'inscription → 200",
          code == 200, (code, brut[:160]))
    check("(MODIFIÉ Task 90) B5 inscription terminée (redirect /premiere-reussie — Configuration réussie) — PAS de /changer (mot de passe déjà choisi à l'étape 1)",
          j6.get("ok") is True and j6.get("redirect") == "/premiere-reussie" and j6.get("mustChangePassword") is None, j6)

    # B6 — carte 3 : « Configuration réussie » (MODIFIÉ Task 87 : la session
    # d'inscription est FERMÉE au service de la page — retour à la connexion)
    code, brut = s.req("GET", "/premiere-reussie")
    check("(MODIFIÉ Task 87) B6 /premiere-reussie → 200 « Configuration réussie » + encadré QR unique + bouton connexion",
          code == 200 and "Configuration réussie" in brut
          and "Le QR code n'est affiché que lors de la première connexion." in brut
          and "Aller à la page de connexion" in brut
          and "fenêtre de connexion" in brut, code)
    check("(NOUVEAU Task 87) B6 la session d'inscription est FERMÉE (cookie portail_session effacé)",
          "portail_session" not in s.cookies, s.cookies)

    # B7 — accès au portail (MODIFIÉ Task 87 : la session est FERMÉE après
    # « Configuration réussie » → la fenêtre initiale de connexion est servie)
    code, brut = s.req("GET", "/")
    check("(MODIFIÉ Task 87) B7 portail inaccessible sans reconnexion → fenêtre de connexion servie",
          code == 200 and 'id="form"' in brut and "Se connecter" in brut, code)

    # B8 — 2ᵉ connexion : UNE étape (CIN + mot de passe personnel + OTP)
    attendre_fenetre_apres(w_qr)
    code, brut = s.req("POST", "/api/logout")
    check("B8 déconnexion (logout → 200)", code == 200, code)
    w_b8 = fenetre_actuelle()
    code_app2 = totp_now(secret_b32)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": code_app2})
    j7 = json_de(brut) or {}
    check("B8 reconnexion UNE étape → 200 redirect:/ (CIN + mot de passe + OTP)",
          code == 200 and j7.get("ok") is True and j7.get("redirect") == "/"
          and j7.get("otpRequired") is None, (code, brut[:160]))
    code, brut = s.req("GET", "/otp", sans_redirection=True)
    check("B8 /otp après connexion complète → redirection (le QR ne revient pas)",
          code in (302, 303), code)

    # B9 — le mot de passe INITIAL ne fonctionne plus (règle utilisateur)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
    j8 = json_de(brut) or {}
    check("B9 le mot de passe initial est REFUSÉ après la première connexion (401)",
          code == 401 and j8.get("error") == "CIN ou mot de passe incorrect. Réessayez.", (code, brut[:160]))

    # B10 — reconnexion SANS otp → étape 2 : la fenêtre QR (MODIFIÉ Task 85 :
    # QR + champ de confirmation, AUCUN code affiché — TOTP de l'application)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO})
    j9 = json_de(brut) or {}
    check("B10 sans OTP → 200 otpRequired (confirmation à l'étape suivante)",
          code == 200 and j9.get("otpRequired") is True and j9.get("premiereConnexion") is False, j9)
    code, brut = s.req("GET", "/otp")
    check("(MODIFIÉ Task 85) B10 fenêtre de confirmation AVEC QR (secret persistant) + champ, AUCUN code affiché",
          code == 200 and 'data-payload' in brut and 'otp-affiche' not in brut and 'otp-saisie' in brut, code)
    uri_b10, secret_b10 = uri_et_secret(brut)
    check("(MODIFIÉ Task 85) B10 le QR porte le secret persistant (B4)",
          secret_b10 == secret_b32, (secret_b32, secret_b10))
    code_app10 = totp_now(secret_b10, t=int(time.time()) + 31)  # fenêtre suivante (anti-rejeu B8)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app10})
    j10 = json_de(brut) or {}
    check("(MODIFIÉ Task 85) B10 TOTP de l'application accepté → accès complet",
          code == 200 and j10.get("ok") is True, (code, brut[:160]))

    # B11 — /api/premiere sur un compte déjà configuré → 400 explicite
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_PERSO, "newPassword": "EncoreAutre83!", "confirm": "EncoreAutre83!"})
    j11 = json_de(brut) or {}
    check("B11 /api/premiere sur compte déjà configuré → 400 « déjà personnalisé »",
          code == 400 and "déjà personnalisé" in str(j11.get("error", "")), (code, brut[:160]))

    # ================= SECTION C : invariants =================
    print("\n--- SECTION C : invariants (état, expire, verrouillage) ---")
    time.sleep(0.3)
    etat2 = lire_etat(CIN)
    check("C1 état final : lastLoginAt posé + qrPresente vrai + secret persistant",
          etat2.get("lastLoginAt") not in (None, "", "null")
          and etat2.get("qrPresente") is True
          and etat2.get("aSecret") is True, etat2)

    # C2 — TEST64EXPIRE (mot de passe expiré) : parcours une étape → /changer
    s2 = Session(P1)
    code, brut = s2.req("POST", "/api/verify", {"cin": "TEST64EXPIRE", "password": "AncienMotDePasse64"})
    j12 = json_de(brut) or {}
    check("C2 TEST64EXPIRE → 200 otpRequired premiereConnexion:true (QR dû : jamais connecté)",
          code == 200 and j12.get("otpRequired") is True and j12.get("premiereConnexion") is True, j12)
    code, brut = s2.req("GET", "/otp")
    uri2, secret2 = uri_et_secret(brut)
    check("C2 page QR de l'inscription (compte jamais connecté)", bool(secret2), (code, bool(uri2)))
    attendre_fenetre_apres(fenetre_actuelle() - 1)
    code, brut = s2.req("POST", "/api/verify",
                        {"cin": "TEST64EXPIRE", "password": "AncienMotDePasse64", "otp": totp_now(secret2)})
    j13 = json_de(brut) or {}
    check("C2 connexion une étape → changement OBLIGATOIRE (motif expire, /changer)",
          code == 200 and j13.get("mustChangePassword") is True and j13.get("motif") == "expire"
          and j13.get("redirect") == "/changer", j13)
    code, brut = s2.req("GET", "/changer")
    check("C2 page /changer affichée (motif « Mot de passe expiré »)",
          code == 200 and "Mot de passe expiré" in brut, code)

    # C3 — /api/premiere : CIN inconnu → même message générique (aucune fuite)
    # (placé AVANT le test de verrouillage : il consomme peu de quota)
    code, brut = s2.req("POST", "/api/premiere",
                        {"cin": "CININCONNU83", "password": "peu importe", "newPassword": "NouveauMot83!", "confirm": "NouveauMot83!"})
    j15 = json_de(brut) or {}
    check("C3 /api/premiere CIN inconnu → MÊME message générique (aucune fuite)",
          code == 401 and j15.get("error") == "CIN ou mot de passe incorrect. Réessayez.", (code, brut[:120]))

    # C4 — verrouillage : 5 codes OTP incorrects (mot de passe CORRECT) → verrou
    # (pause d'une fenêtre complète du limiteur — 15 requêtes / minute / IP)
    s3 = Session(P1)
    time.sleep(65)
    dernier = None
    for i in range(5):
        code, brut = s3.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": "999999"})
        dernier = (code, json_de(brut) or {})
        time.sleep(0.45)
    check("C4 5ᵉ code incorrect → verrouillage annoncé (« Trop de codes OTP incorrects »)",
          dernier[0] == 401 and "Trop de codes OTP incorrects" in str(dernier[1].get("error", "")),
          dernier)
    code, brut = s3.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": "999999"})
    check("C4 6ᵉ tentative → 423 (accès temporairement verrouillé)", code == 423, (code, brut[:120]))

    total = len(RESULTATS)
    ok = sum(RESULTATS)
    print("\n" + "=" * 76)
    print(f"RÉSULTAT : {ok}/{total}")
    print("=" * 76)
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    main()
