#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 74 (18/09/2026) : PORTAIL EMPLOYÉS — « un OTP avec un QR code
s'affiche dans le portail employé lorsque l'employé valide son CIN et son
mot de passe. QR doit expirer après 10 minutes ».

(RÉALIGNÉ Task 75, PUIS Task 76 : « Lors de la première connexion, le QR
code s'affiche. Lors des connexions suivantes, l'utilisateur doit
obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP ») —
la vérification en DEUX étapes est exigée À CHAQUE connexion (défi de
10 minutes). Les scénarios répétés (usage unique, expiration, annulation)
utilisent des accès jetables frais (test74_inserer.js : TEST74EXPIRE,
TEST74ANNULE) ou des connexions JAMAIS complétées (défi abandonné = la
première connexion reste due).

(RÉALIGNÉ Task 85 — « jamais affiche le code otp comme ca, dans cette
fenetre n affiche que qr code qui expire apres 10 minute ») : la fenêtre
/otp affiche LE QR CODE dans TOUS les cas (première connexion ET
connexions suivantes) + le champ de confirmation — AUCUN code OTP n'est
généré, affiché ou accepté (plus de bloc code, plus de compte à rebours,
plus de bouton « Générer un nouveau code », endpoint /api/otp/nouveau
SUPPRIMÉ). La suite CALCULE le TOTP (RFC 6238) depuis le secret Base32 du
QR, exactement comme une application d'authentification ; l'anti-rejeu
(Task 78) est respecté en avançant d'une fenêtre à chaque confirmation.

Flux attendu (vérification en DEUX étapes — REFONTE Task 85) :
  1. CIN + mot de passe VALIDÉS (POST /api/verify) → le portail pose un
     défi OTP (10 minutes) + une session transitoire « otp » (cookie signé) ;
  2. GET /otp → la FENÊTRE QR : QR code (URI otpauth://totp/…, SVG serveur,
     paquet qrcode — aucun CDN) + mention d'expiration + champ Code OTP +
     bouton Valider — AUCUN code en clair. À la PREMIÈRE connexion, la
     fenêtre d'inscription « Configuration OTP » est servie et le verrou
     PERSISTANT qrPresente est posé dès l'affichage ;
  3. POST /api/otp/verify avec le TOTP de l'application (tolérance
     tirets/espaces) → session complète (ou « pending » si changement de
     mot de passe exigé, Task 64) + lastLoginAt posé (première connexion
     SCELLÉE, Task 75). Mauvais code : 5 essais max puis annulation.
     Expiration : 10 MINUTES → 410 OTP_EXPIRE + page « Code OTP expiré »
     → reconnexion.
  4. GARDES : aucune donnée tant que le code n'est pas confirmé
     (my-fiches, search, fichier PDF, change-password → 403 OTP_REQUIS) ;
     la consultation ne PROLONGE jamais une session « otp ».
  5. (Task 76, conservée) CONNEXION SUIVANTE : même CIN → OTP OBLIGATOIRE
     via la même fenêtre QR (le QR d'INSCRIPTION ne s'affiche qu'UNE
     SEULE fois — verrous lastLoginAt + qrPresente, Task 80).

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base.
Portails de test : 4207 (TTL normal 10 minutes) + 4208 (PORTAL_OTP_TTL_MS
= 3500 ms — preuve de l'expiration sans attendre 10 minutes).
"""
import base64
import datetime
import hashlib
import hmac
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "/home/z/my-project"
P1 = "http://127.0.0.1:4207"  # TTL normal (10 minutes)
P2 = "http://127.0.0.1:4208"  # TTL réduit (3,5 s) pour l'expiration

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(("OK  " if cond else "KO  ") + nom + ("" if cond else "  -> " + str(detail)[:220]))


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OP = urllib.request.build_opener(SansRedirection)
DERNIERE_LOCATION = None  # en-tête Location de la DERNIÈRE réponse (redirections)


def req(base, chemin, corps=None, cookie=None, methode=None):
    """Requête HTTP sans suivre les redirections. Retourne (status, corps, set_cookies)."""
    global DERNIERE_LOCATION
    data = json.dumps(corps).encode("utf-8") if corps is not None else None
    r = urllib.request.Request(
        base + chemin, data=data, method=methode or ("POST" if data is not None else "GET")
    )
    if data is not None:
        r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", "portail_session=" + cookie)
    try:
        with OP.open(r, timeout=15) as rep:
            DERNIERE_LOCATION = rep.headers.get("Location")
            return (
                rep.status,
                rep.read().decode("utf-8", "replace"),
                rep.headers.get_all("Set-Cookie") or [],
            )
    except urllib.error.HTTPError as e:
        DERNIERE_LOCATION = e.headers.get("Location")
        return (
            e.code,
            e.read().decode("utf-8", "replace"),
            e.headers.get_all("Set-Cookie") or [],
        )


def cookie_de(set_cookies):
    for c in set_cookies:
        m = re.match(r"portail_session=([^;]+)", c)
        if m and m.group(1):
            return m.group(1)
    return None


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


_fenetre_totp = {"derniere": None}


def code_totp_frais(secret_b32):
    """(Task 85) calcule le TOTP d'une fenêtre NON ENCORE CONSOMMÉE :
    l'anti-rejeu du portail (Task 78, lastUsedWindow) refuse une fenêtre
    déjà utilisée (w <= lastUsedWindow) — la suite avance d'une fenêtre à
    chaque confirmation et attend (≤ 30 s) que le serveur, qui tolère
    ±1 fenêtre autour de « maintenant », l'accepte."""
    maintenant = int(time.time()) // 30
    w = _fenetre_totp["derniere"]
    if w is None or w < maintenant:
        w = maintenant
    else:
        w = w + 1
        if w > maintenant + 1:
            time.sleep((w - 1 - maintenant) * 30 + 2)
    _fenetre_totp["derniere"] = w
    return totp_now(secret_b32, t=w * 30 + 1)


def extraire_payload(page_otp):
    """URI otpauth:// encodée dans l'attribut data-payload (MODIFIÉ Task 78 :
    le QR n'encode plus un JSON mais l'URI STANDARD des applications
    d'authentification — secret Base32, PAS un code)."""
    m = re.search(r'data-payload="([^"]*)"', page_otp)
    return html.unescape(m.group(1)) if m else None


def secret_du_qr(page_otp):
    """(NOUVEAU Task 85) secret Base32 de l'URI otpauth du QR de la page."""
    pl = extraire_payload(page_otp)
    if not pl:
        return None
    m = re.search(r"secret=([A-Z2-7]+)", pl)
    return m.group(1) if m else None


def connexion_otp(base, cin, mot_de_passe):
    """Flux (REFONTE Task 85 : la fenêtre /otp affiche LE QR code + le champ
    de confirmation dans TOUS les cas — AUCUN code n'est affiché, plus
    AUCUNE reconnexion intermédiaire) :
      1. verify → cookie « otp » ;
      2. GET /otp → la fenêtre QR (page « Configuration OTP » à la première
         connexion — verrou qrPresente posé — ou fenêtre de confirmation).
    Retour : (st, rep_verify, cookie_actif, secret_du_qr, page, None).
    La confirmation se fait par POST /api/otp/verify avec
    code_totp_frais(secret_du_qr(page))."""
    st, rep, sc = req(base, "/api/verify", {"cin": cin, "password": mot_de_passe})
    ck = cookie_de(sc)
    if st != 200 or not ck:
        return st, rep, None, None, None, None
    st2, page, _ = req(base, "/otp", cookie=ck)
    return st, rep, ck, secret_du_qr(page), page, None


# =====================================================================
print("=" * 72)
print("A. STATIQUE — portail-server.js (flux OTP + QR + expiration 10 min)")
print("=" * 72)
portail = open(BASE + "/scripts/portail-server.js", encoding="utf-8").read()
pkg = json.load(open(BASE + "/package.json", encoding="utf-8"))

check("version du produit = 0.2.23 (NOUVEAU Task 93)", pkg.get("version") == "0.2.23", pkg.get("version"))
check("génération QR : paquet qrcode requis (rendu SVG serveur, aucun CDN)",
      'require("qrcode")' in portail and 'type: "svg"' in portail)
check("TTL OTP = 10 minutes par défaut (600 000 ms), réductible en test uniquement",
      "n <= 600000 ? n : 10 * 60 * 1000" in portail and "PORTAL_OTP_TTL_MS" in portail)
check("routes Task 74 présentes (/otp, /api/otp/verify) — /api/otp/nouveau SUPPRIMÉ (MODIFIÉ Task 85)",
      '"/otp"' in portail and '"/api/otp/verify"' in portail
      and '"/api/otp/nouveau"' not in portail)
check("session « otp » signée (4e paramètre + champ ot du jeton)",
      "function createPortalSession(cin, remember, pending, otp)" in portail
      and "ot: otp ? 1 : 0" in portail and "otp: p.ot === 1 || p.ot === true" in portail)
check("session « otp » JAMAIS prolongée (renouvellement glissant bloqué)",
      "if (sess.pending || sess.otp) return;" in portail)
check("défi OTP : usage unique, 5 tentatives max, purge des défis expirés",
      "otpDefis.delete(sess.cin)" in portail and "OTP_MAX_TENTATIVES = 5" in portail
      and "if (d.expireAt <= maintenant) otpDefis.delete(k)" in portail)
check("QR code = URI STANDARD otpauth://totp/… (RÉALIGNÉ Task 78 — lisible par les applications d'authentification)",
      '"otpauth://totp/"' in portail
      and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
      and 'app: "SERVICE RH"' not in portail)
check("/api/verify : succès → otpRequired + redirection /otp + cookie « otp »",
      "otpRequired: true" in portail
      and "createPortalSession(cin, false, false, true)" in portail
      and 'redirect: "/otp"' in portail)
check("expiration serveur : 410 OTP_EXPIRE avec libellé de validité",
      'code: "OTP_EXPIRE"' in portail and "LIBELLE_OTP" in portail)
check("annulation après 5 mauvais codes : 401 OTP_ANNULE",
      'code: "OTP_ANNULE"' in portail)
check("garde OTP_REQUIS sur my-fiches + search + fichier PDF + change-password",
      portail.count('code: "OTP_REQUIS"') == 4, portail.count('code: "OTP_REQUIS"'))
check("(MODIFIÉ Task 85) fenêtre /otp : QR code + mention d'expiration + champ one-time-code — AUCUN code en clair ni compte à rebours",
      'id="otp-affiche"' not in portail and 'id="compte"' not in portail
      and 'data-payload=' in portail and 'autocomplete="one-time-code"' in portail
      and 'id="otp-saisie"' in portail and "Le QR code expire dans" in portail)
check("page OTP expirée + bouton « Se reconnecter » (reconnexion complète)",
      "function otpExpireHtml" in portail and "Code OTP expiré" in portail
      and "Se reconnecter" in portail)
check("(SUPPRIMÉ Task 85) plus de bouton « Générer un nouveau code » ni d'endpoint de régénération",
      'id="btn-nouveau"' not in portail and '"/api/otp/nouveau"' not in portail
      and "genererCodeOtp" not in portail and "defi.code" not in portail)
check("(MODIFIÉ Task 83 — maquette) page d'inscription « Configuration OTP » (QR + champ Code OTP) + verrou qrPresente + refus Task 80 SUPPRIMÉ",
      "function otpPremiereHtml(defi, svgQr)" in portail
      and "data: { qrPresente: true }" in portail
      and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
      and 'code: "OTP_QR_A_SCANNER"' not in portail)
check("déconnexion : le défi OTP en cours est annulé",
      "otpDefis.delete(sessDeconnexion.cin)" in portail)
check("page de connexion : branche otpRequired → /otp",
      "r.data.otpRequired" in portail and 'location.replace(apiUrl("/otp"))' in portail)
check("invariant Task 64 conservé : aucun champ id=\"code\" dans le portail",
      'id="code"' not in portail)
check("invariants Task 64/66 conservés (scrypt, tolerance, 15 jours, pending)",
      "verifierMotDePasseTolerant" in portail and "PASSWORD_MAX_AGE_DAYS = 15" in portail
      and "estMotDePasseExpire" in portail and "MUST_CHANGE_PASSWORD" in portail)

# =====================================================================
print()
print("=" * 72)
print("B. PORTAIL 4207 (TTL NORMAL 10 MINUTES) — flux complet")
print("=" * 72)

# B1 — sans session : /otp protégé
st, rep, sc = req(P1, "/otp")
check("/otp sans session → redirection /login",
      st == 302 and DERNIERE_LOCATION == "/login", (st, DERNIERE_LOCATION))

# B2 — mauvais mot de passe : AUCUN défi, réponse inchangée (Task 64)
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "FauxMotDePasse74"})
check("mauvais mot de passe → 401, aucun OTP", st == 401, (st, rep[:120]))

# B3 — CIN + mot de passe VALIDÉS → la FENÊTRE QR (REFONTE Task 85 : QR +
#      champ de confirmation dans TOUS les cas, AUCUN code affiché)
st, rep, ck1, secret1, page1, _ = connexion_otp(P1, "TEST66ESPA", "Mot De Passe 66")
d1 = json.loads(rep) if st == 200 else {}
check("connexion ESPA (tolérance espaces) → 200 ok + otpRequired + redirect /otp",
      st == 200 and d1.get("ok") is True and d1.get("otpRequired") is True
      and d1.get("redirect") == "/otp" and d1.get("expireAt"), (st, rep[:150]))
check("cookie de session « otp » posé", bool(ck1), sc)

# B3b — (MODIFIÉ Task 85) la FENÊTRE = QR code + champ de confirmation,
#       AUCUN code affiché (première connexion → « Configuration OTP »)
check("(MODIFIÉ Task 85) fenêtre /otp de 1re connexion = QR + champ de confirmation (AUCUN code en clair)",
      bool(page1) and 'data-payload=' in page1 and 'id="otp-affiche"' not in page1
      and 'id="otp-saisie"' in page1 and "Générer un nouveau code" not in page1
      and bool(secret1), bool(page1))

# B4 — (MODIFIÉ Task 85) la fenêtre porte le QR (URI standard) + la mention
#      d'expiration — plus de reconnexion intermédiaire
check("fenêtre /otp servie (200)",
      st == 200 or bool(page1), st)
pl = extraire_payload(page1) if page1 else None
check("(MODIFIÉ Task 85) AUCUN code affiché sur la fenêtre (bloc otp-affiche et compte à rebours absents)",
      bool(page1) and 'id="otp-affiche"' not in page1 and 'class="otp-code"' not in page1
      and "Un code à usage unique vient d'être généré" not in page1, bool(page1))
check("QR data-payload = URI STANDARD otpauth://totp/… avec secret Base32 (RÉALIGNÉ Task 78)",
      bool(pl) and pl.startswith("otpauth://totp/") and "secret=" in pl
      and "issuer=Auto-RH" in pl and "digits=6" in pl and "period=30" in pl, pl)
if d1.get("expireAt"):
    # (RÉALIGNÉ Task 78) l'URI otpauth n'encode PLUS l'expiration — elle vient
    # de la réponse /api/verify (le défi du QR reste de 10 min).
    reste = datetime.datetime.fromisoformat(
        d1["expireAt"].replace("Z", "+00:00")).timestamp() - time.time()
    check("défi expire ≈ maintenant + 10 minutes (entre +9 min et +11 min)",
          540 <= reste <= 660, round(reste, 1))
check("(MODIFIÉ Task 85) mention d'expiration du QR affichée (« Le QR code expire dans »)",
      bool(page1) and "Le QR code expire dans" in page1, bool(page1))
check("fenêtre : formulaire de confirmation (champ one-time-code + bouton Valider)",
      bool(page1) and 'autocomplete="one-time-code"' in page1 and "Valider" in page1)
check("(SUPPRIMÉ Task 85) AUCUN bouton « Générer un nouveau code » sur la fenêtre",
      bool(page1) and "Générer un nouveau code" not in page1)
check("(MODIFIÉ Task 85) la fenêtre AFFICHE le QR (secret persistant ré-associable)",
      bool(page1) and 'data-payload' in page1)

# B5 — GARDES : aucune donnée avant confirmation du code
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck1)
check("my-fiches bloqué pendant l'étape OTP (403 OTP_REQUIS)",
      st == 403 and json.loads(rep).get("code") == "OTP_REQUIS", (st, rep[:120]))
st, rep, _ = req(P1, "/api/search?cin=TEST66ESPA", cookie=ck1)
check("search bloquée pendant l'étape OTP (403 OTP_REQUIS)",
      st == 403 and json.loads(rep).get("code") == "OTP_REQUIS", (st, rep[:120]))
st, rep, _ = req(P1, "/api/change-password", {"currentPassword": "x", "newPassword": "y"}, cookie=ck1)
check("change-password bloqué pendant l'étape OTP (403 OTP_REQUIS)",
      st == 403 and json.loads(rep).get("code") == "OTP_REQUIS", (st, rep[:120]))
st, rep, _ = req(P1, "/", cookie=ck1)
check("GET / pendant l'étape OTP → redirection /otp (jamais les fiches)",
      st == 302 and DERNIERE_LOCATION == "/otp", (st, DERNIERE_LOCATION))
st, rep, _ = req(P1, "/changer", cookie=ck1)
check("GET /changer pendant l'étape OTP → redirection /otp",
      st == 302 and DERNIERE_LOCATION == "/otp", (st, DERNIERE_LOCATION))

# B6 — mauvais code : message avec tentatives restantes
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "000000"}, cookie=ck1)
check("mauvais code → 401 + tentatives restantes annoncées",
      st == 401 and "tentative" in rep and "4" in rep, (st, rep[:150]))

# B7 — bon code → session complète (ESPA : pas de changement exigé)
# (MODIFIÉ Task 85) le TOTP de l'application est volontairement saisi avec
# TIRETS + ESPACE parasite — la tolérance de saisie (esprit Task 66) est
# prouvée ici.
code_b7 = code_totp_frais(secret1)
code_formate = code_b7[:3] + "-" + code_b7[3:] + " "
st, rep, sc2 = req(P1, "/api/otp/verify", {"otp": code_formate}, cookie=ck1)
d2 = json.loads(rep) if st == 200 else {}
ck2 = cookie_de(sc2)
check("code saisi avec tirets/espace parasite → accepté (tolérance Task 66)",
      st == 200, (st, rep[:120]))
check("(MODIFIÉ Task 90) bon code (toléré) → 200 ok + redirection /premiere-reussie (inscription terminée) + CIN masqué",
      st == 200 and d2.get("ok") is True and d2.get("redirect") == "/premiere-reussie"
      and d2.get("cinMasked", "").startswith("•••"), (st, rep[:150]))
check("cookie de session COMPLÈTE posé après confirmation", bool(ck2), sc2)

# B8 — accès aux fiches APRÈS confirmation
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck2)
check("my-fiches accessible après confirmation du code (200)",
      st == 200 and json.loads(rep).get("exact") is True, (st, rep[:120]))

# B9 — USAGE UNIQUE : un code refusé sur un autre défi (accès jetable ANCI,
# MODIFIÉ Task 75 : ESPA a DÉJÀ complété sa première connexion en B7 — les
# re-connexions n'exigent plus d'OTP, donc le nouveau défi est créé sur un
# accès encore vierge : TEST66ANCI).
# (MODIFIÉ Task 83) ANCI est un accès mustChangePassword : sa première
# connexion passe par /premiere (étape 1 : changement de l'initial), puis la
# reconnexion avec le NOUVEAU mot de passe ouvre la page de confirmation.
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61"})
dA83 = json.loads(rep) if st == 200 else {}
check("première connexion ANCI → orientée /premiere (MODIFIÉ Task 83)",
      st == 200 and dA83.get("premiere") is True, (st, rep[:120]))
st, rep, scA = req(P1, "/api/premiere", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61",
                                         "newPassword": "AnciMot74x!", "confirm": "AnciMot74x!"})
ckA = cookie_de(scA)
st, pageA_qr, _ = req(P1, "/otp", cookie=ckA)
st, rep, scB = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "AnciMot74x!"})
ck3 = cookie_de(scB)
st, pageB, _ = req(P1, "/otp", cookie=ck3)
secret3 = secret_du_qr(pageB)
check("(MODIFIÉ Task 85) première connexion ANCI → nouveau défi (QR + champ code sur la fenêtre — aucun code affiché)",
      st == 200 and bool(ck3) and bool(secret3) and 'id="otp-affiche"' not in pageB,
      (st, bool(secret3)))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "000000"}, cookie=ck3)
check("(MODIFIÉ Task 85) un code arbitraire (pas celui de l'application) est refusé (401)",
      st == 401, (st, rep[:120]))
st, rep, sc4 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret3)}, cookie=ck3)
check("(MODIFIÉ Task 85) le TOTP de l'application est accepté (200)", st == 200, (st, rep[:120]))

# B10 — (MODIFIÉ Task 76) DEUXIÈME connexion ESPA : l'OTP est OBLIGATOIRE
# (chaque connexion = deux étapes) mais SANS QR — la première connexion a
# été complétée en B7 (verrou lastLoginAt).
st, rep, sc10 = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse66"})
d10 = json.loads(rep) if st == 200 else {}
ck10 = cookie_de(sc10)
check("2e connexion ESPA → otpRequired:true + premiereConnexion:false (Task 76 : OTP à chaque connexion)",
      st == 200 and d10.get("ok") is True and d10.get("otpRequired") is True
      and d10.get("premiereConnexion") is False, (st, rep[:150]))
st, page10, _ = req(P1, "/otp", cookie=ck10)
secret10 = secret_du_qr(page10)
check("(MODIFIÉ Task 85) 2e connexion : fenêtre /otp AVEC QR code + champ de confirmation, AUCUN code affiché",
      st == 200 and 'data-payload' in page10 and 'id="otp-affiche"' not in page10
      and bool(secret10), (st, bool(secret10)))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret10)}, cookie=ck10)
check("code confirmé (2e connexion) → 200 (session ouverte)", st == 200, (st, rep[:120]))

# B11 — (MODIFIÉ Task 83) accès TEST66NOUV — JAMAIS connecté : sa première
# connexion est encore due ; B11 l'ABANDONNE volontairement (vérification
# CIN + initial SANS terminer /api/premiere, puis déconnexion) pour prouver
# en B12 qu'elle restera due.
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79"})
d6 = json.loads(rep) if st == 200 else {}
check("1re vérification NOUV → orientée /premiere (première connexion due — MODIFIÉ Task 83)",
      st == 200 and d6.get("premiere") is True and d6.get("redirect") == "/premiere", (st, rep[:120]))
st, rep, _ = req(P1, "/api/logout", {})
check("déconnexion OK (200)", st == 200, (st, rep[:80]))

# B12 — flux complet avec MOT DE PASSE INITIAL (MODIFIÉ Task 83 : le
# changement du mot de passe initial se fait à l'ÉTAPE 1 /api/premiere, puis
# l'étape 2 affiche le QR + champ Code OTP ; la confirmation ouvre l'accès).
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79"})
d7 = json.loads(rep) if st == 200 else {}
check("reconnexion NOUV (abandon en B11) → première connexion TOUJOURS due (orientée /premiere)",
      st == 200 and d7.get("premiere") is True and d7.get("redirect") == "/premiere", (st, rep[:120]))
st, rep, sc8 = req(P1, "/api/premiere", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79",
                                         "newPassword": "NouveauMot74", "confirm": "NouveauMot74"})
ck8 = cookie_de(sc8)
d8 = json.loads(rep) if st == 200 else {}
check("étape 1 : changement du mot de passe initial enregistré → étape 2 (/otp) (MODIFIÉ Task 83)",
      st == 200 and d8.get("ok") is True and d8.get("step") == 2 and d8.get("redirect") == "/otp",
      (st, rep[:180]))
st, page_qr7, _ = req(P1, "/otp", cookie=ck8)
check("étape 2 : page « Configuration OTP » (QR + champ Code OTP — MODIFIÉ Task 83)",
      st == 200 and "Configuration OTP" in page_qr7 and 'data-payload' in page_qr7
      and 'id="otp-saisie"' in page_qr7, st)
# reconnexion avec le NOUVEAU mot de passe → fenêtre de confirmation (MODIFIÉ
# Task 85 : QR + champ code, AUCUN code affiché — TOTP calculé depuis le QR)
st, rep, scC = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "NouveauMot74"})
ckC = cookie_de(scC)
st, pageC, _ = req(P1, "/otp", cookie=ckC)
secretC = secret_du_qr(pageC)
check("(MODIFIÉ Task 85) reconnexion NOUV (nouveau mot de passe) → fenêtre de confirmation avec QR (aucun code affiché)",
      bool(secretC) and 'id="otp-affiche"' not in pageC, bool(secretC))
st, rep, sc9 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secretC)}, cookie=ckC)
d9 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 90) code confirmé → inscription terminée : redirect /premiere-reussie (le changement a été fait à l'étape 1 — Task 83)",
      st == 200 and d9.get("ok") is True and d9.get("redirect") == "/premiere-reussie", (st, rep[:150]))
st, rep, _ = req(P1, "/api/my-fiches", cookie=cookie_de(sc9))
check("fiches accessibles (session complète)",
      st == 200, (st, rep[:120]))

# B13 — confirmation SANS session
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "123456"})
check("confirmation sans session → 401 OTP_SESSION_ABSENTE",
      st == 401 and json.loads(rep).get("code") == "OTP_SESSION_ABSENTE", (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/nouveau", methode="POST")
check("(SUPPRIMÉ Task 85) endpoint de régénération supprimé → 404", st == 404, (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "12 34 5"}, cookie=ck2 or ck1)
check("code mal formé (5 chiffres) → 400", st == 400, (st, rep[:120]))

# =====================================================================
print()
print("=" * 72)
print("C. PORTAIL 4208 (TTL 3,5 s) — EXPIRATION DU QR ET DU CODE OTP")
print("=" * 72)

st, rep, _ = req(P2, "/api/health")
check("portail 4208 en ligne (sonde)", st == 200, (st, rep[:80]))

st, rep, ckX, secretX, pageX, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
dX = json.loads(rep) if st == 200 else {}
check("connexion TEST74EXPIRE (accès jetable, 1re connexion) → otpRequired + expireAt",
      st == 200 and dX.get("otpRequired") is True and dX.get("premiereConnexion") is True
      and dX.get("expireAt"), (st, rep[:120]))
if dX.get("expireAt"):
    from datetime import datetime, timezone
    exp = datetime.fromisoformat(dX["expireAt"].replace("Z", "+00:00"))
    reste = exp.timestamp() - time.time()
    check("expireAt ≈ maintenant + 3,5 s (TTL réduit bien lu du serveur)",
          1.5 <= reste <= 6.0, round(reste, 2))
check("(MODIFIÉ Task 85) page /otp (4208) : QR + champ de confirmation à la 1re connexion, AUCUN code affiché",
      bool(pageX) and 'data-payload=' in pageX and 'id="otp-affiche"' not in pageX
      and 'id="otp-saisie"' in pageX and bool(secretX), (bool(pageX), bool(secretX)))

time.sleep(4.2)
# (MODIFIÉ Task 85) le TOTP courant est utilisé SANS consommation de fenêtre
# (aucune confirmation antérieure pour ce compte) — le défi 3,5 s est
# de toute façon expiré : 410 OTP_EXPIRE attendu.
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretX)}, cookie=ckX)
dX2 = json.loads(rep) if rep.startswith("{") else {}
check("code CORRECT mais EXPIRÉ → 410 OTP_EXPIRE (validité dépassée)",
      st == 410 and dX2.get("code") == "OTP_EXPIRE" and "expir" in rep.lower(), (st, rep[:180]))
st, rep, _ = req(P2, "/otp", cookie=ckX)
check("page /otp après expiration → page « Code OTP expiré » + Se reconnecter",
      st == 200 and "Code OTP expiré" in rep and "Se reconnecter" in rep, (st, rep[:120]))

# (MODIFIÉ Task 85) plus de régénération sans ressaisie : la reconnexion
# (CIN + mot de passe) crée un NOUVEAU défi utilisable immédiatement.
st, rep, _ = req(P2, "/api/otp/nouveau", methode="POST", cookie=ckX)
check("(SUPPRIMÉ Task 85) POST /api/otp/nouveau → 404 (plus de régénération sans ressaisie)",
      st == 404, (st, rep[:120]))
st, rep, scY = req(P2, "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
ckY = cookie_de(scY)
check("reconnexion après expiration → nouveau défi (200, otpRequired)",
      st == 200 and json.loads(rep).get("otpRequired") is True, (st, rep[:120]))
st, rep, _ = req(P2, "/otp", cookie=ckY)
secretY = secret_du_qr(rep)
check("(MODIFIÉ Task 85) fenêtre de confirmation avec QR — le QR d'inscription ne revient PAS (verrou Task 80 conservé)",
      bool(secretY) and "Configuration OTP" not in rep, bool(secretY))
# (MODIFIÉ Task 85) TOTP de la fenêtre COURANTE (aucune fenêtre consommée
# pour ce compte ; le compteur global de la suite peut être en avance —
# inutilisable avec un TTL de 3,5 s).
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretY)}, cookie=ckY)
check("TOTP accepté immédiatement après reconnexion (200) — l'expiration ne bloque que le défi mort",
      st == 200, (st, rep[:150]))

# 5 mauvais codes → annulation (accès jetable TEST74ANNULE — MODIFIÉ Task 75 :
# TEST74EXPIRE va compléter sa première connexion ci-dessus avec le TOTP de
# l'application)
st, rep, ckZ, secretZ, _, page_qrZ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
faux = "999999"
dernier = None
for i in range(5):
    dernier = req(P2, "/api/otp/verify", {"otp": faux}, cookie=ckZ)
check("5 mauvais codes → 5e réponse 401 OTP_ANNULE (vérification annulée)",
      dernier[0] == 401 and json.loads(dernier[1]).get("code") == "OTP_ANNULE",
      (dernier[0], dernier[1][:150]))
st, rep, _ = req(P2, "/otp", cookie=ckZ)
check("page /otp après annulation → état expiré (reconnexion exigée)",
      st == 200 and "Code OTP expiré" in rep, (st, rep[:120]))
st, rep, _ = req(P2, "/api/otp/verify", {"otp": code_totp_frais(secretZ)}, cookie=ckZ)
check("même le BON TOTP est refusé après annulation (410)",
      st == 410, (st, rep[:150]))
# (NOUVEAU Task 75) l'annulation n'a PAS scellé la première connexion : le
# même employé qui se reconnecte obtient un NOUVEAU défi OTP.
st, rep, ckZ2, secretZ2, pageZ2, _ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
check("(MODIFIÉ Task 85) reconnexion après annulation → OTP de NOUVEAU exigé (première connexion toujours incomplète, Task 75)",
      st == 200 and bool(ckZ2) and bool(secretZ2), (st, bool(secretZ2)))
check("(MODIFIÉ Task 85) après annulation : la fenêtre de confirmation porte le QR (secret persistant) et AUCUN code",
      bool(pageZ2) and 'data-payload' in pageZ2 and 'id="otp-affiche"' not in pageZ2)

# =====================================================================
total = len(RESULTATS)
reussis = sum(1 for r in RESULTATS if r)
print()
print("=" * 72)
print(f"RÉSULTAT TASK 74 : {reussis}/{total} " + ("— TOUT OK" if reussis == total else "— PROBLÈME DÉTECTÉ"))
print("=" * 72)
sys.exit(0 if reussis == total else 1)
