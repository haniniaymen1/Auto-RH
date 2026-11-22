#!/usr/bin/env python3
"""
Task 82 — « Il n'y a pas de champ permettant de saisir l'OTP. De plus, le
même problème se produit lorsque le CIN ou le mot de passe est incorrect.
Le changement du mot de passe initial ne s'affiche pas. » (capture : page
d'inscription QR de la première connexion, localhost:4001/otp)

CORRECTIFS Task 82 (scripts/portail-server.js) :
  1. FORMULAIRE DE CONNEXION : TROISIÈME CHAMP « Code OTP (application
     d'authentification) » — l'employé inscrit via le QR de la première
     connexion saisit CIN + mot de passe + code OTP en UNE étape (demande
     Task 74 : « l'utilisateur doit obligatoirement saisir son CIN, son mot
     de passe ainsi que l'OTP »). Première connexion → champ laissé VIDE
     (le QR d'inscription s'affiche ensuite) ; pas d'application sous la
     main → champ vide, un code est présenté à l'étape suivante ;
  2. /api/verify accepte `otp` : vérification TOTP DIRECTE (tolérance ±1
     fenêtre, anti-rejeu lastUsedWindow) → connexion COMPLÈTE en une
     requête ; code REFUSÉ aux connexions suivantes = même traitement qu'un
     mauvais mot de passe (compteur + verrouillage 15 min après 5) avec
     message explicite (« Code OTP incorrect. Il vous reste N tentative(s) ») ;
     code parasite à la PREMIÈRE connexion = IGNORÉ (parcours QR intact —
     y compris le QR montré par le RH : code valable → connexion directe) ;
     code malformé = 400 explicite ;
  3. CHANGEMENT DU MOT DE PASSE INITIAL : la connexion en une étape évalue
     « changement obligatoire ? » (Task 64) et renvoie redirect:/changer —
     la page de changement S'AFFICHE dès la connexion (session pending),
     comme après la confirmation OTP du parcours en deux étapes ;
  4. CHAMP VIDE → parcours en deux étapes INCHANGÉ (défi + page /otp,
     double voie code affiché / application — Task 78).

CONTENU (contrôles statiques + E2E sur COPIE de base, harnais
test82_harnais.sh, portail de test 4234) : sections 0/A/B/C ci-dessous.
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
P1 = "http://127.0.0.1:4234"          # portail employés de test (TTL normal)
DB_COPIE = BASE + "/sandbox-test82/test82.db"

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


def main():
    print("=" * 76)
    print("TASK 82 — champ « Code OTP » dans le formulaire de connexion")
    print("=" * 76)

    # ================= SECTION 0 : statique =================
    print("\n--- SECTION 0 : contrôles statiques ---")
    src = open(PORTAIL, encoding="utf-8").read()
    pkg = json_de(open(PKG, encoding="utf-8").read()) or {}

    check("version du produit = 0.2.23 (NOUVEAU Task 93)",
          pkg.get("version") == "0.2.23", pkg.get("version"))
    # --- Le 3e champ du formulaire de connexion (demande Task 82) ---
    check("formulaire : label « Code OTP (application d'authentification) »",
          '<label for="otp">Code OTP (application d\'authentification)</label>' in src)
    check("formulaire : champ id=otp (class code, one-time-code, numérique)",
          'id="otp" name="otp" class="code" inputmode="numeric" maxlength="8"' in src
          and 'autocomplete="one-time-code"' in src)
    check("formulaire : consigne « Dès votre 2ᵉ connexion : saisissez le code à 6 chiffres »",
          "Dès votre 2ᵉ connexion : saisissez le code à 6 chiffres" in src)
    check("formulaire : « PREMIÈRE connexion ? Laissez ce champ VIDE »",
          "PREMIÈRE connexion ? Laissez ce champ VIDE" in src)
    check("formulaire : double voie annoncée (« un code vous sera présenté à l'étape suivante »)",
          "un code vous sera présenté à l'étape suivante" in src)
    check("en-tête de page : « saisissez aussi votre <b>code OTP</b> dans le champ dédié »",
          "saisissez aussi votre <b>code OTP</b> dans le" in src)
    check("pied de page : « CIN + mot de passe + code OTP »",
          "accès protégé par CIN + mot de passe + code OTP" in src)
    check("JS : champ otp lu (inputOtp)",
          'var inputOtp = document.getElementById("otp")' in src
          and '(inputOtp.value || "")' in src)
    check("JS : validation client « exactement 6 chiffres »",
          "Le code OTP doit contenir exactement 6 chiffres — ou laissez le champ Code OTP vide." in src)
    check("JS : le code OTP est envoyé à /api/verify (body otp)",
          "JSON.stringify({ cin: cin, password: password, otp: otp, remember: inputRemember.checked === true })" in src)
    check("JS : champ otp vidé à l'envoi (esprit Task 17)",
          "inputOtp.value = \"\";" in src)
    # --- Serveur : vérification TOTP directe (connexion en UNE étape) ---
    check("serveur : /api/verify lit body.otp (tolérance tirets/espaces)",
          'const otpSaisi = String(body?.otp ?? "").replace(/[\\s-]/g, "");' in src)
    check("serveur : vérification TOTP directe verifyTotp(secretOtp, otpSaisi, acc.lastUsedWindow)",
          "verifyTotp(secretOtp, otpSaisi, acc.lastUsedWindow)" in src)
    check("serveur : code malformé → 400 explicite",
          "Le code OTP doit contenir exactement 6 chiffres. Première connexion ? Laissez le champ Code OTP vide" in src)
    check("serveur : code refusé (connexions suivantes) → message « Code OTP incorrect. Il vous reste »",
          '"Code OTP incorrect. Il vous reste " + restantes + " tentative"' in src)
    check("serveur : code refusé → même traitement qu'un mauvais mot de passe (compteur + verrou)",
          "Trop de codes OTP incorrects : accès temporairement verrouillé" in src
          and "failedAttempts: lock ? 0 : attempts" in src)
    check("serveur : première connexion + code parasite → IGNORÉ (parcours QR intact)",
          "(!tOtp.ok && premiereConnexion) → code parasite IGNORÉ" in src)
    check("serveur : connexion une étape → anti-rejeu lastUsedWindow + lastLoginAt scellé",
          "acc.lastUsedWindow !== tOtp.window ? { lastUsedWindow: tOtp.window } : {}" in src
          and "!acc.lastLoginAt ? { lastLoginAt: new Date() } : {}" in src)
    check("serveur : hygiène — défi OTP en cours supprimé (otpDefis.delete)",
          "otpDefis.delete(cin);" in src)
    check("serveur : connexion une étape → /changer quand le changement est dû (Task 64, cas « expiré »)",
          "doitChanger" in src and 'redirect: "/changer",' in src)
    check("(MODIFIÉ Task 86) serveur : parcours deux étapes conservé (champ vide → défi aligné sur la fenêtre + /otp)",
          "const defi = creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt);" in src
          and 'redirect: "/otp",' in src)
    # --- Conservations (Tasks 78/80/81 intactes) ---
    check("conservé Task 81 : message 401 générique + bandeau hint-echec INTACTS",
          'const generic = "CIN ou mot de passe incorrect. Réessayez.";' in src
          and 'id="hint-echec"' in src)
    check("conservé Task 80/83 : page d'inscription otpPremiereHtml + verrou qrPresente",
          "function otpPremiereHtml(defi, svgQr)" in src
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in src)
    check("conservé Task 78 : QR otpauth + double voie /api/otp/verify (refus Task 80 supprimé Task 83)",
          '"otpauth://totp/"' in src and "verifyTotp" in src
          and 'code: "OTP_QR_A_SCANNER"' not in src)

    # ================= SECTION A : harnais démarré =================
    print("\n--- SECTION A : harnais (COPIE de base, portail de test 4234) ---")
    s = Session(P1)
    code, brut = s.req("GET", "/")
    check("portail de test répond (200)", code == 200, code)
    check("la page servie affiche le champ Code OTP (id=otp)",
          'id="otp" name="otp"' in brut)
    check("la page servie affiche le label « Code OTP (application d'authentification) »",
          "Code OTP (application d'authentification)" in brut)
    check("la page servie annonce « PREMIÈRE connexion ? Laissez ce champ VIDE »",
          "PREMIÈRE connexion ? Laissez ce champ VIDE" in brut)
    CIN = "TEST64CIN"
    MDP_INIT = "Initial64x"
    CIN2 = "TEST64EXPIRE"
    MDP2 = "AncienMotDePasse64"

    # ================= SECTION B : connexion en UNE étape =================
    print("\n--- SECTION B : CIN + mot de passe + code OTP (une étape) ---")

    # B1 — (MODIFIÉ Task 83) 1re connexion SANS code → orientée /premiere ;
    #      étape 1 (changement du mot de passe initial) → étape 2 (QR + champ)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_INIT})
    j = json_de(brut) or {}
    check("B1 1re connexion sans OTP → 200, orientée /premiere (MODIFIÉ Task 83)",
          code == 200 and j.get("premiere") is True and j.get("redirect") == "/premiere",
          (code, brut[:120]))
    MDP_PERSO = "MonMotDePasse82!"
    code, brut = s.req("POST", "/api/premiere",
                       {"cin": CIN, "password": MDP_INIT, "newPassword": MDP_PERSO, "confirm": MDP_PERSO})
    j1b = json_de(brut) or {}
    check("B1 étape 1 réussie (changement du mot de passe initial) → étape 2 (/otp)",
          code == 200 and j1b.get("step") == 2 and j1b.get("redirect") == "/otp",
          (code, brut[:160]))
    code, brut = s.req("GET", "/otp")
    check("B1 page « Configuration OTP » servie (QR + champ, verrou qrPresente posé — MODIFIÉ Task 83)",
          code == 200 and "Configuration OTP" in brut and 'data-payload' in brut
          and 'id="otp-saisie"' in brut, code)
    uri, secret_b32 = uri_et_secret(brut)
    check("B1 URI otpauth://totp standard avec secret Base32",
          (uri or "").startswith("otpauth://totp/") and bool(secret_b32), uri)
    w_qr = fenetre_actuelle()

    # B2 — LE PARCOURS TASK 82 : reconnexion en UNE étape avec le code de
    #      l'application saisi dans le 3e champ du formulaire (le mot de passe
    #      a DÉJÀ été changé à l'étape 1 — MODIFIÉ Task 83)
    code_app = totp_now(secret_b32)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": code_app})
    j2 = json_de(brut) or {}
    check("B2 connexion UNE étape (CIN + mot de passe + OTP) → 200",
          code == 200, (code, brut[:160]))
    check("B2 accès complet DIRECT (redirect /) — le changement a été fait à l'étape 1 (MODIFIÉ Task 83)",
          j2.get("ok") is True and j2.get("redirect") == "/" and j2.get("mustChangePassword") is None, j2)
    check("B2 AUCUN otpRequired (connexion complète immédiate, pas de page /otp)",
          j2.get("otpRequired") is None, j2)

    # B3-B4 — session complète : fiches accessibles
    code, brut = s.req("GET", "/")
    check("B3 session complète : fiches accessibles (200, pas la page de connexion)",
          code == 200 and 'id="form-otp"' not in brut and 'id="form-premiere"' not in brut, code)
    check("B4 (fusionné en B3 — le changement a eu lieu à l'étape 1 /premiere)", True)

    # B5 — connexions SUIVANTES en UNE étape (mot de passe personnel + code)
    attendre_fenetre_apres(w_qr)  # fenêtre TOTP postérieure à celle du QR/de B2
    code, brut = s.req("POST", "/api/logout")
    check("B5 déconnexion (logout → 200)", code == 200, code)
    w_b5 = fenetre_actuelle()
    code_app2 = totp_now(secret_b32)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": code_app2})
    j4 = json_de(brut) or {}
    check("B5 reconnexion UNE étape → 200, redirect / (PAS d'otpRequired, PAS de QR)",
          code == 200 and j4.get("ok") is True and j4.get("redirect") == "/"
          and j4.get("otpRequired") is None, (code, brut[:160]))
    code, brut = s.req("GET", "/")
    check("B5 fiches accessibles immédiatement (connexion complète en une requête)",
          code == 200 and 'id="form-otp"' not in brut, code)

    # B6 — ANTI-REJEU : le MÊME code rejoué est refusé (erreur EXPLICITE)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": code_app2})
    j5 = json_de(brut) or {}
    check("B6 même code rejoué → 401 « Code OTP incorrect. Il vous reste 4 tentatives » (1 tentative consommée par le rejet)",
          code == 401 and str(j5.get("error", "")).startswith("Code OTP incorrect. Il vous reste 4 tentative"),
          (code, brut[:160]))

    # B7 — code MALFORMÉ → 400 explicite
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": "12ab"})
    j6 = json_de(brut) or {}
    check("B7 code malformé (12ab) → 400 « doit contenir exactement 6 chiffres »",
          code == 400 and "exactement 6 chiffres" in str(j6.get("error", "")), (code, brut[:160]))

    # B8 — champ VIDE aux connexions suivantes → parcours deux étapes
    #      (MODIFIÉ Task 85 : la fenêtre /otp montre le QR + le champ —
    #      AUCUN code affiché ; la confirmation passe par l'application)
    code, brut = s.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO})
    j7 = json_de(brut) or {}
    check("B8 champ OTP vide → 200 otpRequired (deux étapes inchangé)",
          code == 200 and j7.get("otpRequired") is True and j7.get("premiereConnexion") is False, j7)
    code, brut = s.req("GET", "/otp")
    check("(MODIFIÉ Task 85) B8 fenêtre de confirmation : QR + champ de saisie, AUCUN code affiché",
          code == 200 and 'data-payload' in brut and 'id="otp-saisie"' in brut
          and 'otp-affiche' not in brut, code)
    uri_b8, secret_b8 = uri_et_secret(brut)
    check("(MODIFIÉ Task 85) B8 le QR porte le secret persistant (B1)",
          secret_b8 == secret_b32, (secret_b32, secret_b8))
    code_app8 = totp_now(secret_b8, t=int(time.time()) + 31)  # fenêtre suivante (anti-rejeu B5)
    code, brut = s.req("POST", "/api/otp/verify", {"otp": code_app8})
    j8 = json_de(brut) or {}
    check("(MODIFIÉ Task 85) B8 TOTP de l'application accepté → accès complet",
          code == 200 and j8.get("ok") is True and j8.get("redirect") == "/", (code, brut[:160]))

    # ================= SECTION B' : première connexion + code parasite =================
    print("\n--- SECTION B' : première connexion + code parasite (ignoré) ---")
    s2 = Session(P1)
    code, brut = s2.req("POST", "/api/verify",
                        {"cin": CIN2, "password": MDP2, "otp": "000000"})
    j9 = json_de(brut) or {}
    check("B'1 1re connexion + code parasite → 200 otpRequired premiereConnexion:true (IGNORÉ, pas d'erreur)",
          code == 200 and j9.get("otpRequired") is True and j9.get("premiereConnexion") is True,
          (code, brut[:160]))
    code, brut = s2.req("GET", "/otp")
    check("B'2 parcours d'inscription QR intact (page « Configuration OTP » — MODIFIÉ Task 83)",
          code == 200 and "Configuration OTP" in brut and 'data-payload' in brut, code)
    uri2, secret2 = uri_et_secret(brut)
    code, brut = s2.req("POST", "/api/logout")
    # Reconnexion UNE étape avec le VRAI code (le QR vient d'être affiché → inscrit)
    attendre_fenetre_apres(fenetre_actuelle() - 1)
    code_app3 = totp_now(secret2)
    code, brut = s2.req("POST", "/api/verify", {"cin": CIN2, "password": MDP2, "otp": code_app3})
    j10 = json_de(brut) or {}
    check("B'3 reconnexion UNE étape avec le code de l'application → 200",
          code == 200, (code, brut[:160]))
    check("B'3 mot de passe EXPIRÉ → changement obligatoire (motif expire, /changer)",
          j10.get("mustChangePassword") is True and j10.get("motif") == "expire"
          and j10.get("redirect") == "/changer", j10)

    # ================= SECTION C : invariants =================
    print("\n--- SECTION C : invariants (fuite, état, verrouillage) ---")
    code, brut = s.req("POST", "/api/verify",
                       {"cin": "CININCONNU82", "password": "peu importe", "otp": "123456"})
    j11 = json_de(brut) or {}
    check("C1 CIN inconnu (+ otp) → MÊME message générique (aucune fuite)",
          code == 401 and j11.get("error") == "CIN ou mot de passe incorrect. Réessayez.",
          (code, brut[:160]))
    time.sleep(0.3)

    def lire_etat(cin):
        out = subprocess.run(["node", "scripts/test74_inserer.js", "lire", cin],
                             cwd=RACINE, capture_output=True, text=True,
                             env={**os.environ, "DATABASE_URL": "file:" + DB_COPIE})
        brut = out.stdout.strip()
        m = re.search(r"\{.*\}", brut, re.S)
        return json_de(m.group(0)) if m else {}

    etat = lire_etat(CIN)
    check("C2 TEST64CIN : lastLoginAt posé + qrPresente vrai (première connexion scellée par l'étape une-étape)",
          etat.get("lastLoginAt") not in (None, "", "null") and etat.get("qrPresente") is True, etat)
    etat2 = lire_etat(CIN2)
    check("C3 TEST64EXPIRE : lastLoginAt posé (scellé par la reconnexion une étape)",
          etat2.get("lastLoginAt") not in (None, "", "null"), etat2)
    code, brut = s.req("GET", "/otp", sans_redirection=True)
    check("C4 /otp après connexion complète → redirection (302)",
          code in (302, 303), code)

    # C5 — VERROUILLAGE : 5 codes OTP incorrects (mot de passe CORRECT) → verrou
    s3 = Session(P1)
    dernier = None
    for i in range(5):
        code, brut = s3.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": "999999"})
        dernier = (code, json_de(brut) or {})
        time.sleep(0.45)
    check("C5 5ᵉ code incorrect → verrouillage annoncé (« Trop de codes OTP incorrects »)",
          dernier[0] == 401 and "Trop de codes OTP incorrects" in str(dernier[1].get("error", "")),
          dernier)
    code, brut = s3.req("POST", "/api/verify", {"cin": CIN, "password": MDP_PERSO, "otp": "999999"})
    check("C5 6ᵉ tentative → 423 (accès temporairement verrouillé)",
          code == 423, (code, brut[:160]))

    total = len(RESULTATS)
    ok = sum(RESULTATS)
    print("\n" + "=" * 76)
    print(f"RÉSULTAT : {ok}/{total}")
    print("=" * 76)
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    main()
