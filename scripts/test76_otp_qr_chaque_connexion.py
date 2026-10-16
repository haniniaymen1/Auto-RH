#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 76 (18/09/2026) : PORTAIL EMPLOYÉS — « Lors de la première connexion,
le QR code s'affiche. Lors des connexions suivantes, l'utilisateur doit
obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP. »

RÈGLE IMPLÉMENTÉE (demande utilisateur, MODIFIE la règle Task 75) :
  - CHAQUE connexion = vérification en DEUX étapes : CIN + mot de passe
    VALIDÉS (POST /api/verify) → un CODE OTP à usage unique frais (6 chiffres,
    valide 10 MINUTES) est généré et AFFICHÉ sur la page /otp ; l'employé le
    confirme pour ouvrir réellement sa session ;
  - PREMIÈRE connexion (aucune connexion complète — verrou lastLoginAt) :
    la page /otp affiche EN PLUS le QR CODE contenant le même code ;
  - connexions SUIVANTES : la page /otp affiche le code OTP SANS AUCUN QR —
    l'employé saisit CIN + mot de passe + l'OTP, obligatoirement ;
  - le changement OBLIGATOIRE du mot de passe (initial / réinitialisé / expiré,
    Task 64) est évalué APRÈS la confirmation du code (la branche directe
    Task 75 est supprimée) ;
  - lastLoginAt reste posé uniquement par /api/otp/verify (connexion
    COMPLÈTE) : un défi abandonné, expiré ou annulé n'écrit RIEN — le QR
    revient à la reconnexion si la première connexion n'est pas complétée ;
  - /api/otp/nouveau régénère le défi dans le BON mode (recalculé en base :
    QR seulement si la première connexion reste due).

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base.
Portails de test : 4212 (TTL normal 10 minutes) + 4213 (PORTAL_OTP_TTL_MS
= 3500 ms — preuve de l'expiration aux DEUX modes).
Accès de test : jeu Task 66 (TEST66ESPA / TEST66NOUV / TEST66ANCI) + accès
jetables Task 74 (TEST74EXPIRE / TEST74ANNULE via scripts/test74_inserer.js).
"""
import html
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
P1 = "http://127.0.0.1:4212"  # TTL normal (10 minutes)
P2 = "http://127.0.0.1:4213"  # TTL réduit (3,5 s)
DB_COPIE = BASE + "/sandbox-test76/test76.db"

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(("OK  " if cond else "KO  ") + nom + ("" if cond else "  -> " + str(detail)[:220]))


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OP = urllib.request.build_opener(SansRedirection)
DERNIERE_LOCATION = None


def req(base, chemin, corps=None, cookie=None, methode=None):
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


def extraire_payload(page_otp):
    """URI otpauth:// encodée dans l'attribut data-payload (MODIFIÉ Task 78 :
    le QR n'encode plus un JSON mais l'URI STANDARD des applications)."""
    m = re.search(r'data-payload="([^"]*)"', page_otp)
    return html.unescape(m.group(1)) if m else None


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
    AUCUNE reconnexion intermédiaire) : verify → GET /otp = la fenêtre QR.
    Retour : (st, rep_verify, cookie_actif, secret_du_qr, page, None)."""
    st, rep, sc = req(base, "/api/verify", {"cin": cin, "password": mot_de_passe})
    ck = cookie_de(sc)
    if st != 200 or not ck:
        return st, rep, None, None, None, None
    st2, page, _ = req(base, "/otp", cookie=ck)
    return st, rep, ck, secret_du_qr(page), page, None


def dernier_login(cin):
    """Lit lastLoginAt en base (COPIE) via scripts/test74_inserer.js lire."""
    env = dict(os.environ)
    r = subprocess.run(
        ["node", "scripts/test74_inserer.js", "lire", cin],
        cwd=RACINE, env=env, capture_output=True, text=True, timeout=30,
    )
    m = re.search(r"LASTLOGIN=(\{.*\})", r.stdout)
    return json.loads(m.group(1)) if m else {"cin": cin, "lastLoginAt": "ERREUR"}


def qr_present(page):
    """VRAI si la page /otp affiche le BLOC QR (MODIFIÉ Task 80 : la page
    d'inscription « UNIQUEMENT le QR » porte class="otp-qr otp-qr-seul" —
    le marqueur ne doit PAS exiger le guillemet de fermeture).
    Marqueurs spécifiques du QR — le logo SVG de l'entête contient déjà
    « <svg » : il ne peut PAS servir de discriminateur."""
    return bool(page) and 'class="otp-qr' in page and 'data-payload="' in page


# =====================================================================
print("=" * 72)
print("A. STATIQUE — portail-server.js (OTP à CHAQUE connexion, QR 1re seulement)")
print("=" * 72)
portail = open(BASE + "/scripts/portail-server.js", encoding="utf-8").read()
pkg = json.load(open(BASE + "/package.json", encoding="utf-8"))

check("version du produit = 0.2.23 (NOUVEAU Task 93)", pkg.get("version") == "0.2.23", pkg.get("version"))
check("règle Task 76 documentée dans l'entête (DEUX ÉTAPES À CHAQUE CONNEXION — MODIFIÉ Task 85 : fenêtre QR à chaque connexion)",
      "DEUX ÉTAPES À CHAQUE CONNEXION" in portail
      and "obligatoirement saisir son CIN" in portail)
check("(MODIFIÉ Task 86) le défi est créé à CHAQUE validation CIN + mot de passe (fenêtre ALIGNÉE sur le secret)",
      "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in portail
      and "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail)
check("le défi porte le mode « premiere » (QR seulement à la 1re connexion)",
      "premiere: premiere === true" in portail)
check("branche directe Task 75 SUPPRIMÉE (plus de session ouverte sans OTP)",
      "doitChangerDirect" not in portail
      and "createPortalSession(cin, remember, doitChangerDirect)" not in portail)
check("lastLoginAt JAMAIS écrit dans /api/verify (uniquement à la confirmation OTP)",
      "...(premiereConnexion ? {} : { lastLoginAt: new Date() })" not in portail
      and "lastLoginAt: new Date()," in portail)
check("réponse /api/verify : otpRequired + premiereConnexion + redirect /otp",
      "otpRequired: true" in portail and "premiereConnexion," in portail
      and 'redirect: "/otp"' in portail)
check("page /otp : QR généré SEULEMENT si defi.premiere (MODIFIÉ Task 80 : page d'inscription dédiée + pose du verrou)",
      "if (defi.premiere)" in portail
      and "await svgQrOtp(defi)" in portail
      and "data: { qrPresente: true }" in portail)
check("(MODIFIÉ Task 85) otpHtml reçoit le DÉFI (payload construit depuis defi) et rend le QR DÈS QUE LE SVG EXISTE (tous les modes)",
      "function otpHtml(defi, svgQr)" in portail
      and "const payload = contenuQrOtp(defi);" in portail
      and '${svgQr ? `<div class="otp-qr"' in portail)
check("(MODIFIÉ Task 85) textes /otp : mention « Le QR code expire dans » + AUCUN « Ce code OTP expire »",
      "Le QR code expire dans" in portail
      and '"Ce QR code et ce code OTP expirent" : "Ce code OTP expire"' not in portail)
check("(MODIFIÉ Task 85) page de connexion : « obligatoire à CHAQUE connexion » + « Le code OTP n'est JAMAIS affiché à l'écran »",
      "obligatoire à CHAQUE connexion" in portail
      and "Le code OTP n'est JAMAIS affiché à l'écran" in portail)
check("ancienne mention Task 75 ABSENTE de la page de connexion",
      "valables ${LIBELLE_OTP}) à la PREMIÈRE connexion uniquement" not in portail)
check("(MODIFIÉ Task 86) page « expiré » : le QR d'inscription non confirmé est DÉFINITIVEMENT mort, un NOUVEAU QR (nouveau secret) sera affiché",
      "le QR code de vérification n'est valable que" in portail
      and "un NOUVEAU QR code (nouveau secret) sera affiché" in portail)
check("(SUPPRIMÉ Task 85) endpoint /api/otp/nouveau + bouton « Générer un nouveau code » ABSENTS",
      '"/api/otp/nouveau"' not in portail and 'id="btn-nouveau"' not in portail)
check("(MODIFIÉ Task 83 — maquette) page d'inscription « Configuration OTP » (QR + champ Code OTP) + verrou qrPresente + refus Task 80 SUPPRIMÉ",
      "function otpPremiereHtml(defi, svgQr)" in portail
      and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
      and 'code: "OTP_QR_A_SCANNER"' not in portail)
check("invariants Task 74 conservés (TTL 10 min, usage unique, 5 tentatives) + QR otpauth Task 78",
      "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
      and "otpDefis.delete(sess.cin)" in portail
      and '"otpauth://totp/"' in portail and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail)
check("invariants Task 64 conservés (scrypt, tolérance, 15 jours, verrouillage)",
      "verifierMotDePasseTolerant" in portail and "PASSWORD_MAX_AGE_DAYS = 15" in portail
      and "MAX_VERIFY_ATTEMPTS = 5" in portail)
check("session « otp » JAMAIS prolongée (renouvellement glissant bloqué, Task 74)",
      "if (sess.pending || sess.otp) return;" in portail)
check("garde OTP_REQUIS maintenu sur my-fiches + search + fichier PDF + change-password",
      portail.count('code: "OTP_REQUIS"') == 4, portail.count('code: "OTP_REQUIS"'))
check("jeu d'accès jetables Task 74 disponible (test74_inserer.js : inserer + lire)",
      "TEST74EXPIRE" in open(BASE + "/scripts/test74_inserer.js", encoding="utf-8").read()
      and 'operation === "lire"' in open(BASE + "/scripts/test74_inserer.js", encoding="utf-8").read())

# =====================================================================
print()
print("=" * 72)
print("B. PORTAIL 4212 (TTL NORMAL) — QR à la 1re connexion, OTP SANS QR ensuite")
print("=" * 72)

# B0 — état initial : accès vierge
et = dernier_login("TEST66ESPA")
check("état initial : TEST66ESPA sans lastLoginAt (première connexion due)",
      et.get("lastLoginAt") is None, et)

# B1 — PREMIÈRE connexion ESPA → la FENÊTRE QR (« Configuration OTP » —
#      REFONTE Task 85 : QR + champ de confirmation, AUCUN code affiché)
st, rep, ck1, secret1, page1, _ = connexion_otp(P1, "TEST66ESPA", "Mot De Passe 66")
d1 = json.loads(rep) if st == 200 else {}
check("1re connexion ESPA → 200 + otpRequired + premiereConnexion:true + redirect /otp",
      st == 200 and d1.get("ok") is True and d1.get("otpRequired") is True
      and d1.get("premiereConnexion") is True and d1.get("redirect") == "/otp",
      (st, rep[:150]))
pl1 = extraire_payload(page1) if page1 else None
check("(MODIFIÉ Task 83) page /otp (1re connexion) = « Configuration OTP » : bloc QR + champ Code OTP — AUCUN code affiché",
      bool(page1) and qr_present(page1) and 'id="otp-affiche"' not in page1
      and "Configuration OTP" in page1 and 'id="otp-saisie"' in page1,
      bool(page1))
check("(MODIFIÉ Task 85) fenêtre avec secret du QR + mention d'expiration, AUCUN compte à rebours du code",
      bool(page1) and bool(secret1) and "Le QR code expire dans" in page1
      and "10:00" not in page1, bool(page1))
check("QR data-payload = URI STANDARD otpauth://totp/… avec secret Base32 (RÉALIGNÉ Task 78)",
      bool(pl1) and pl1.startswith("otpauth://totp/") and "secret=" in pl1
      and "issuer=Auto-RH" in pl1 and "digits=6" in pl1 and "period=30" in pl1, pl1)
check("pendant l'étape OTP : lastLoginAt ENCORE NULL (connexion pas encore complète)",
      dernier_login("TEST66ESPA").get("lastLoginAt") is None, dernier_login("TEST66ESPA"))

# B2 — confirmation (TOTP de l'application) → première connexion SCELLÉE
st, rep, sc2 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret1)}, cookie=ck1)
d2 = json.loads(rep) if st == 200 else {}
ck2 = cookie_de(sc2)
check("(MODIFIÉ Task 90) code confirmé → 200 ok + inscription terminée (redirect /premiere-reussie)",
      st == 200 and d2.get("ok") is True and d2.get("redirect") == "/premiere-reussie", (st, rep[:150]))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck2)
check("my-fiches accessible (session complète)", st == 200 and json.loads(rep).get("exact") is True, (st, rep[:120]))
sel1 = dernier_login("TEST66ESPA").get("lastLoginAt")
check("lastLoginAt MAINTENANT POSÉ (première connexion scellée)", sel1 is not None, sel1)

# B3 — DEUXIÈME connexion ESPA → OTP OBLIGATOIRE, SANS QR
st, rep, _ = req(P1, "/api/logout", {}, cookie=ck2)
check("déconnexion OK (200)", st == 200, (st, rep[:80]))
st, rep, sc3 = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse66"})
d3 = json.loads(rep) if st == 200 else {}
ck3 = cookie_de(sc3)
check("2e connexion ESPA → otpRequired:true + premiereConnexion:false (OTP obligatoire)",
      st == 200 and d3.get("ok") is True and d3.get("otpRequired") is True
      and d3.get("premiereConnexion") is False and d3.get("redirect") == "/otp",
      (st, rep[:150]))
st, page3, _ = req(P1, "/otp", cookie=ck3)
secret3 = secret_du_qr(page3)
pl3 = extraire_payload(page3)
check("(MODIFIÉ Task 85) page /otp (2e connexion) : QR PRÉSENT (secret persistant) + champ de saisie, AUCUN code affiché",
      st == 200 and bool(secret3) and qr_present(page3) and pl3 is not None
      and 'id="otp-affiche"' not in page3, (st, bool(secret3)))
check("(MODIFIÉ Task 86) page /otp (2e connexion, employé INSCRIT) : fenêtre à durée LIMITÉE (libellé honnête « Cette fenêtre expire dans ») + champ de saisie",
      "Cette fenêtre expire dans" in page3 and 'autocomplete="one-time-code"' in page3
      and "Valider le code" in page3, page3[:80])
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck3)
check("garde : my-fiches TOUJOURS bloqué avant confirmation (403 OTP_REQUIS)",
      st == 403 and json.loads(rep).get("code") == "OTP_REQUIS", (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "000000"}, cookie=ck3)
check("mauvais code (2e connexion) → 401 + tentatives restantes",
      st == 401 and "tentative" in rep and "4" in rep, (st, rep[:150]))
st, rep, sc4 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret3)}, cookie=ck3)
d4 = json.loads(rep) if st == 200 else {}
ck4 = cookie_de(sc4)
check("bon code (2e connexion) → 200 + session complète",
      st == 200 and d4.get("ok") is True and d4.get("redirect") == "/", (st, rep[:150]))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck4)
check("my-fiches accessible après la 2e confirmation (200)",
      st == 200 and json.loads(rep).get("exact") is True, (st, rep[:120]))
sel2 = dernier_login("TEST66ESPA").get("lastLoginAt")
check("lastLoginAt MIS À JOUR par la 2e connexion complète (horodatage différent)",
      sel2 is not None and sel2 != sel1, (sel1, sel2))

# B4 — TROISIÈME connexion ESPA : l'OTP est de nouveau exigé (CHAQUE connexion)
st, rep, _ = req(P1, "/api/logout", {}, cookie=ck4)
st, rep, sc5 = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse66"})
d5 = json.loads(rep) if st == 200 else {}
ck5 = cookie_de(sc5)
check("3e connexion ESPA → ENCORE otpRequired:true + premiereConnexion:false",
      st == 200 and d5.get("otpRequired") is True and d5.get("premiereConnexion") is False,
      (st, rep[:150]))
st, page5, _ = req(P1, "/otp", cookie=ck5)
secret5 = secret_du_qr(page5)
check("(MODIFIÉ Task 85) 3e connexion : fenêtre AVEC QR (même secret persistant) + AUCUN code affiché",
      st == 200 and qr_present(page5) and bool(secret5) and secret5 == secret3, (bool(secret5),))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret5)}, cookie=ck5)
check("3e confirmation → 200 (session ouverte)", st == 200, (st, rep[:120]))

# B6 — (MODIFIÉ Task 83) PREMIÈRE connexion NOUV (initial) : /premiere →
#      étape 1 (changement) → étape 2 (QR + champ) → confirmation par reconnexion
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79"})
d6pre = json.loads(rep) if st == 200 else {}
check("1re connexion NOUV (initial) → orienté /premiere (Task 83)",
      st == 200 and d6pre.get("premiere") is True and d6pre.get("redirect") == "/premiere",
      (st, rep[:120]))
st, rep, sc7 = req(P1, "/api/premiere", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79",
                                        "newPassword": "NouveauMot76", "confirm": "NouveauMot76"})
ck7 = cookie_de(sc7)
d7 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) étape 1 NOUV réussie → étape 2 (/otp)",
      st == 200 and d7.get("ok") is True and d7.get("step") == 2 and d7.get("redirect") == "/otp",
      (st, rep[:150]))
st, page_qr6, _ = req(P1, "/otp", cookie=ck7)
check("(MODIFIÉ Task 83) NOUV : page « Configuration OTP » (QR + champ, aucun code affiché)",
      bool(page_qr6) and qr_present(page_qr6) and 'id="otp-affiche"' not in page_qr6)
# reconnexion avec le NOUVEAU mot de passe → confirmation (double voie)
st, rep, sc8 = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "NouveauMot76"})
ck8 = cookie_de(sc8)
st, page6, _ = req(P1, "/otp", cookie=ck8)
secret6 = secret_du_qr(page6)
check("(MODIFIÉ Task 85) reconnexion NOUV (nouveau mot de passe) → fenêtre de confirmation avec QR (aucun code affiché)",
      bool(secret6) and 'id="otp-affiche"' not in page6, bool(secret6))
# (MODIFIÉ Task 85) la fenêtre de confirmation consomme une fenêtre TOTP :
# déconnexion immédiate — la confirmation effective se fera plus bas (B6 bis)
st, rep, _ = req(P1, "/api/logout", {}, cookie=ck8)
st, rep, sc9 = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "NouveauMot76"})
d9 = json.loads(rep) if st == 200 else {}
ck9 = cookie_de(sc9)
check("2e connexion NOUV (après changement) → OTP OBLIGATOIRE (Task 76)",
      st == 200 and d9.get("otpRequired") is True and d9.get("premiereConnexion") is False,
      (st, rep[:150]))
st, page9, _ = req(P1, "/otp", cookie=ck9)
secret9 = secret_du_qr(page9)
check("(MODIFIÉ Task 85) 2e connexion NOUV : fenêtre AVEC QR + AUCUN code affiché",
      st == 200 and qr_present(page9) and bool(secret9), (st, bool(secret9)))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret9)}, cookie=ck9)
d10 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 90) confirmation → inscription terminée (redirect /premiere-reussie — aucun nouveau changement de mot de passe exigé)",
      st == 200 and d10.get("ok") is True and d10.get("redirect") == "/premiere-reussie"
      and "mustChangePassword" not in d10, (st, rep[:150]))

# B7 — (MODIFIÉ Task 85) plus de RÉGÉNÉRATION sans ressaisie : /premiere →
#      QR, POST /api/otp/nouveau → 404 (SUPPRIMÉ), reconnexion avec le
#      NOUVEAU mot de passe → fenêtre de confirmation (QR persistant)
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61"})
dApre = json.loads(rep) if st == 200 else {}
check("1re connexion ANCI (initial) → orienté /premiere (Task 83)",
      st == 200 and dApre.get("premiere") is True, (st, rep[:120]))
st, rep, scA0 = req(P1, "/api/premiere", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61",
                                         "newPassword": "AnciMot83x!", "confirm": "AnciMot83x!"})
ckA = cookie_de(scA0)
dA = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) étape 1 ANCI réussie → étape 2 (/otp)",
      st == 200 and dA.get("step") == 2 and dA.get("redirect") == "/otp", (st, rep[:120]))
st, page_qrA, _ = req(P1, "/otp", cookie=ckA)
check("(MODIFIÉ Task 83) ANCI : page « Configuration OTP » avec QR (accès encore vierge)",
      st == 200 and qr_present(page_qrA) and 'id="otp-affiche"' not in page_qrA, st)
st, rep, _ = req(P1, "/api/otp/nouveau", methode="POST", cookie=ckA)
check("(SUPPRIMÉ Task 85) POST /api/otp/nouveau → 404 (plus de régénération sans ressaisie)",
      st == 404, (st, rep[:120]))
st, rep, scA2 = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "AnciMot83x!"})
ckA2 = cookie_de(scA2)
st, pageA2, _ = req(P1, "/otp", cookie=ckA2)
secretA2 = secret_du_qr(pageA2)
check("(MODIFIÉ Task 85) reconnexion ANCI → fenêtre de confirmation AVEC QR (secret persistant), AUCUN code affiché",
      st == 200 and qr_present(pageA2) and bool(secretA2) and 'id="otp-affiche"' not in pageA2,
      (bool(secretA2),))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secretA2)}, cookie=ckA2)
check("(MODIFIÉ Task 85) TOTP accepté (200) — ANCI scellé", st == 200, (st, rep[:120]))

# B8 — ANNULATION (5 erreurs) à une 2e connexion : la reconnexion ouvre de
#      nouveau la fenêtre QR (REFONTE Task 85 : QR à chaque fenêtre)
st, rep, ckB, secretB, pageB, _ = connexion_otp(P1, "TEST66ESPA", "MotDePasse66")
dB = json.loads(rep) if st == 200 else {}
check("reconnexion ESPA → otpRequired + premiereConnexion:false (après scellement)",
      st == 200 and dB.get("otpRequired") is True and dB.get("premiereConnexion") is False,
      (st, rep[:120]))
dernier = None
for i in range(5):
    dernier = req(P1, "/api/otp/verify", {"otp": "000000"}, cookie=ckB)
check("5 mauvais codes → 401 OTP_ANNULE (vérification annulée)",
      dernier[0] == 401 and json.loads(dernier[1]).get("code") == "OTP_ANNULE",
      (dernier[0], dernier[1][:150]))
st, rep, ckC, secretC, pageC, _ = connexion_otp(P1, "TEST66ESPA", "MotDePasse66")
dC = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après annulation → OTP de nouveau exigé, fenêtre AVEC QR (2e connexion)",
      st == 200 and dC.get("otpRequired") is True and dC.get("premiereConnexion") is False
      and qr_present(pageC), (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secretC)}, cookie=ckC)
check("bon code après annulation → 200 (session ouverte)", st == 200, (st, rep[:120]))

# B9 — USAGE UNIQUE : un code quelconque (pas celui de l'application) est
#      refusé sur le défi suivant — seule la fenêtre TOTP valide passe
st, rep, ckD, secretD, pageD, _ = connexion_otp(P1, "TEST66ANCI", "AnciMot83x!")
dD = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) 2e connexion ANCI → fenêtre AVEC QR (première connexion déjà complétée en B7)",
      st == 200 and dD.get("premiereConnexion") is False and qr_present(pageD),
      (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "123123"}, cookie=ckD)
check("un code quelconque (pas celui de l'application) est refusé (401)",
      st == 401, (st, rep[:120]))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secretD)}, cookie=ckD)
check("(MODIFIÉ Task 85) le TOTP de l'application est accepté (200)", st == 200, (st, rep[:120]))

# =====================================================================
print()
print("=" * 72)
print("C. PORTAIL 4213 (TTL 3,5 s) — EXPIRATION aux DEUX modes")
print("=" * 72)

st, rep, _ = req(P2, "/api/health")
check("portail 4213 en ligne (sonde)", st == 200, (st, rep[:80]))

# C1 — expiration à la PREMIÈRE connexion : reconnexion → fenêtre de
#      confirmation (REFONTE Task 85 : QR à chaque fenêtre)
st, rep, ckX, secretX, pageX, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
dX = json.loads(rep) if st == 200 else {}
check("1re connexion TEST74EXPIRE → otpRequired + premiereConnexion:true + fenêtre QR (« Configuration OTP »)",
      st == 200 and dX.get("otpRequired") is True and dX.get("premiereConnexion") is True
      and qr_present(pageX) and bool(secretX), (st, rep[:120]))
time.sleep(4.2)
# (MODIFIÉ Task 85) TOTP de la fenêtre COURANTE (aucune consommation
# antérieure pour ce compte) — le défi 3,5 s est de toute façon expiré.
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretX)}, cookie=ckX)
dX2 = json.loads(rep) if rep.startswith("{") else {}
check("code CORRECT mais EXPIRÉ → 410 OTP_EXPIRE (validité dépassée)",
      st == 410 and dX2.get("code") == "OTP_EXPIRE", (st, rep[:150]))
check("après expiration : lastLoginAt TOUJOURS NULL (première connexion non complétée)",
      dernier_login("TEST74EXPIRE").get("lastLoginAt") is None,
      dernier_login("TEST74EXPIRE"))
st, rep, ckX2, secretX2, pageX2, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
dX3 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après expiration → OTP DE NOUVEAU exigé, fenêtre de confirmation AVEC QR (secret persistant)",
      st == 200 and dX3.get("otpRequired") is True and dX3.get("premiereConnexion") is False
      and qr_present(pageX2) and bool(secretX2), (st, rep[:120]))
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretX2)}, cookie=ckX2)
check("code frais confirmé → 200 (première connexion ENFIN complétée)",
      st == 200 and json.loads(rep).get("ok") is True, (st, rep[:120]))
check("TEST74EXPIRE : lastLoginAt MAINTENANT POSÉ (scellé)",
      dernier_login("TEST74EXPIRE").get("lastLoginAt") is not None,
      dernier_login("TEST74EXPIRE"))

# C2 — expiration à une CONNEXION SUIVANTE : reconnexion → nouvelle fenêtre
# (pause d'une période TOTP : la fenêtre W a été consommée en C1 — anti-rejeu)
time.sleep(31)
st, rep, ckY, secretY, pageY, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
dY = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) 2e connexion TEST74EXPIRE → otpRequired:true + premiereConnexion:false + fenêtre AVEC QR",
      st == 200 and dY.get("otpRequired") is True and dY.get("premiereConnexion") is False
      and qr_present(pageY), (st, rep[:120]))
time.sleep(4.2)
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretY)}, cookie=ckY)
dY2 = json.loads(rep) if rep.startswith("{") else {}
check("code correct mais EXPIRÉ (2e connexion) → 410 OTP_EXPIRE",
      st == 410 and dY2.get("code") == "OTP_EXPIRE", (st, rep[:150]))
st, rep, _ = req(P2, "/otp", cookie=ckY)
check("page /otp après expiration → page « Code OTP expiré » + Se reconnecter",
      st == 200 and "Code OTP expiré" in rep and "Se reconnecter" in rep, (st, rep[:120]))

# C3 — (MODIFIÉ Task 85) plus de régénération : POST /api/otp/nouveau → 404,
#      la RECONNEXION crée un nouveau défi utilisable immédiatement
st, rep, _ = req(P2, "/api/otp/nouveau", methode="POST", cookie=ckY)
check("(SUPPRIMÉ Task 85) POST /api/otp/nouveau (2e connexion) → 404", st == 404, (st, rep[:120]))
st, rep, scZ = req(P2, "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
ckZ = cookie_de(scZ)
check("reconnexion après expiration (2e connexion) → nouveau défi (200, otpRequired)",
      st == 200 and json.loads(rep).get("otpRequired") is True, (st, rep[:120]))
st, pageZ, _ = req(P2, "/otp", cookie=ckZ)
secretZ = secret_du_qr(pageZ)
check("(MODIFIÉ Task 85) nouvelle fenêtre AVEC QR (même secret persistant) — AUCUN code affiché",
      st == 200 and qr_present(pageZ) and bool(secretZ) and secretZ == secretY, (bool(secretZ),))
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretZ)}, cookie=ckZ)
check("(MODIFIÉ Task 85) TOTP accepté immédiatement (200)", st == 200, (st, rep[:150]))

# C4 — annulation à la 1re connexion : reconnexion → fenêtre de confirmation
#      AVEC QR (REFONTE Task 85 — le QR d'INSCRIPTION, lui, ne revient pas)
st, rep, ckW, secretW, pageW, _ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
dW = json.loads(rep) if st == 200 else {}
check("1re connexion TEST74ANNULE → OTP + fenêtre QR (« Configuration OTP », premiereConnexion:true)",
      st == 200 and dW.get("premiereConnexion") is True and qr_present(pageW), (st, rep[:120]))
dernier2 = None
for i in range(5):
    dernier2 = req(P2, "/api/otp/verify", {"otp": "999999"}, cookie=ckW)
check("5 mauvais codes → 401 OTP_ANNULE", dernier2[0] == 401, (dernier2[0], dernier2[1][:120]))
st, rep, ckW2, secretW2, pageW2, _ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
dW2 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après annulation → OTP de nouveau exigé, fenêtre de confirmation AVEC QR (le QR d'inscription ne revient PAS — page de confirmation)",
      st == 200 and dW2.get("premiereConnexion") is False and qr_present(pageW2)
      and "Configuration OTP" not in pageW2 and bool(secretW2), (st, rep[:120]))

# =====================================================================
total = len(RESULTATS)
reussis = sum(1 for r in RESULTATS if r)
print()
print("=" * 72)
print(f"RÉSULTAT TASK 76 : {reussis}/{total} " + ("— TOUT OK" if reussis == total else "— PROBLÈME DÉTECTÉ"))
print("=" * 72)
sys.exit(0 if reussis == total else 1)
