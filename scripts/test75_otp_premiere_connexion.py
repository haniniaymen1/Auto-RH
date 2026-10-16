#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 75 (18/09/2026) : PORTAIL EMPLOYÉS — « Qr code s'affiche juste pour
la première connexion » — SCELLLEMENT de la première connexion.

(RÉALIGNÉ Task 76 : « Lors de la première connexion, le QR code s'affiche.
Lors des connexions suivantes, l'utilisateur doit obligatoirement saisir son
CIN, son mot de passe ainsi que l'OTP ») — la règle Task 75 « session directe
sans OTP aux connexions suivantes » est ABROGÉE : CHAQUE connexion exige le
code OTP (frais, 10 minutes), SANS QR après la première. Ce test garde la
valeur ajoutée Task 75 : le SCELLLEMENT —
  - lastLoginAt n'est posé QUE par /api/otp/verify (connexion COMPLÈTE) —
    jamais dans /api/verify, jamais pendant l'étape OTP ;
  - un défi abandonné, expiré ou annulé n'écrit RIEN : à la reconnexion,
    l'OTP est de nouveau exigé — et le QR revient si la première connexion
    n'est toujours pas complétée ;
  - « Dernière connexion » (onglet Accès portail) reflète la dernière
    connexion COMPLÈTE (mise à jour à chaque confirmation d'OTP).

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base.
Portails de test : 4210 (TTL normal 10 minutes) + 4211 (PORTAL_OTP_TTL_MS
= 3500 ms — preuve qu'une expiration N'ANNULE PAS le scellement).
Accès de test : jeu Task 66 (TEST66NOUV / TEST66ANCI / TEST66ESPA) + accès
jetables Task 74/75 (TEST74EXPIRE / TEST74ANNULE via scripts/test74_inserer.js).
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
P1 = "http://127.0.0.1:4210"  # TTL normal (10 minutes)
P2 = "http://127.0.0.1:4211"  # TTL réduit (3,5 s)
DB_COPIE = BASE + "/sandbox-test75/test75.db"

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
    m = re.search(r'data-payload="([^"]*)"', page_otp or "")
    if not m:
        return None
    m2 = re.search(r"secret=([A-Z2-7]+)", m.group(1))
    return m2.group(1) if m2 else None


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


# =====================================================================
print("=" * 72)
print("A. STATIQUE — portail-server.js (scellement : lastLoginAt à la confirmation seule)")
print("=" * 72)
portail = open(BASE + "/scripts/portail-server.js", encoding="utf-8").read()
pkg = json.load(open(BASE + "/package.json", encoding="utf-8"))

check("version du produit = 0.2.23 (NOUVEAU Task 93)", pkg.get("version") == "0.2.23", pkg.get("version"))
check("(MODIFIÉ Task 85) règle Task 76 documentée dans l'entête (DEUX ÉTAPES À CHAQUE CONNEXION) + note Task 85",
      "DEUX ÉTAPES À CHAQUE CONNEXION" in portail
      and "jamais affiche le code otp comme ca" in portail)
check("verrou première connexion (MODIFIÉ Task 80) : premiereConnexion = !acc.lastLoginAt && !acc.qrPresente",
      "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail)
check("lastLoginAt JAMAIS écrit dans /api/verify (uniquement à la confirmation OTP)",
      "...(premiereConnexion ? {} : { lastLoginAt: new Date() })" not in portail
      and "lastLoginAt: new Date()," in portail)
check("(MODIFIÉ Task 86) chaque connexion → défi OTP ALIGNÉ sur la fenêtre du secret + session « otp »",
      "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail
      and "createPortalSession(cin, false, false, true)" in portail)
check("branche directe Task 75 SUPPRIMÉE (aucune session ouverte sans OTP)",
      "doitChangerDirect" not in portail
      and "createPortalSession(cin, remember, doitChangerDirect)" not in portail)
check("changement OBLIGATOIRE (initial/expiré) évalué APRÈS l'OTP (Task 64 conservé)",
      "acc.mustChangePassword || estMotDePasseExpire(acc.passwordChangedAt)" in portail
      and 'redirect: "/changer"' in portail)
check("première connexion SCELLÉE dans /api/otp/verify (lastLoginAt posé à la confirmation)",
      "lastLoginAt: new Date()," in portail)
check("réponses : CIN masqué présent", '"•••" + cin.slice(-3)' in portail)
check("(MODIFIÉ Task 85) page de connexion : « Le code OTP n'est JAMAIS affiché à l'écran »",
      "Le code OTP n'est JAMAIS affiché à l'écran" in portail
      and "QR code d'inscription affiché à la PREMIÈRE connexion uniquement" not in portail)
check("invariants Task 74 conservés (QR 10 min, usage unique, 5 tentatives — MODIFIÉ Task 85 : plus de régénération)",
      "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
      and "otpDefis.delete(sess.cin)" in portail
      and '"/api/otp/nouveau"' not in portail)
check("invariants Task 64 conservés (scrypt, tolérance, 15 jours, verrouillage)",
      "verifierMotDePasseTolerant" in portail and "PASSWORD_MAX_AGE_DAYS = 15" in portail
      and "MAX_VERIFY_ATTEMPTS = 5" in portail)
check("jeu d'accès jetables Task 74/75 présent (test74_inserer.js : inserer + lire)",
      "TEST74EXPIRE" in open(BASE + "/scripts/test74_inserer.js", encoding="utf-8").read()
      and 'operation === "lire"' in open(BASE + "/scripts/test74_inserer.js", encoding="utf-8").read())

# =====================================================================
print()
print("=" * 72)
print("B. PORTAIL 4210 (TTL NORMAL 10 MINUTES) — première connexion PUIS directe")
print("=" * 72)

# B0 — état initial : les accès de test sont VIERGES (aucune connexion)
et = dernier_login("TEST66ESPA")
check("état initial : TEST66ESPA sans lastLoginAt (première connexion due)",
      et.get("lastLoginAt") is None, et)

# B1 — PREMIÈRE connexion ESPA → la FENÊTRE QR (« Configuration OTP » :
#      QR + champ Code OTP, AUCUN code affiché — REFONTE Task 85)
st, rep, ck1, secret1, page1, _ = connexion_otp(P1, "TEST66ESPA", "Mot De Passe 66")
d1 = json.loads(rep) if st == 200 else {}
check("1re connexion ESPA → 200 + otpRequired + premiereConnexion:true + redirect /otp",
      st == 200 and d1.get("ok") is True and d1.get("otpRequired") is True
      and d1.get("premiereConnexion") is True and d1.get("redirect") == "/otp"
      and d1.get("expireAt"), (st, rep[:150]))
check("(MODIFIÉ Task 83) page /otp de 1re connexion = « Configuration OTP » (QR + champ Code OTP, AUCUN code affiché)",
      bool(page1) and 'data-payload=' in page1 and 'id="otp-affiche"' not in page1
      and "Configuration OTP" in page1 and 'id="otp-saisie"' in page1,
      bool(page1))
check("(MODIFIÉ Task 85) fenêtre = QR + mention d'expiration, AUCUN code ni compte à rebours",
      bool(page1) and bool(secret1) and "Le QR code expire dans" in page1
      and "10:00" not in page1, bool(page1))
check("pendant l'étape OTP : lastLoginAt ENCORE NULL (connexion pas encore complète)",
      dernier_login("TEST66ESPA").get("lastLoginAt") is None,
      dernier_login("TEST66ESPA"))

# B2 — confirmation (TOTP de l'application) → première connexion SCELLÉE
st, rep, sc2 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret1)}, cookie=ck1)
d2 = json.loads(rep) if st == 200 else {}
ck2 = cookie_de(sc2)
check("(MODIFIÉ Task 90) code confirmé → 200 ok + inscription terminée (redirect /premiere-reussie)",
      st == 200 and d2.get("ok") is True and d2.get("redirect") == "/premiere-reussie", (st, rep[:150]))
check("my-fiches accessible (session complète)", (st, rep)[0] == 200 and bool(ck2), st)
et = dernier_login("TEST66ESPA")
check("lastLoginAt MAINTENANT POSÉ (première connexion scellée, Task 75)",
      et.get("lastLoginAt") is not None, et)

# B3 — DEUXIÈME connexion ESPA → OTP OBLIGATOIRE, SANS QR (Task 76)
st, rep, _ = req(P1, "/api/logout", {}, cookie=ck2)
check("déconnexion OK (200)", st == 200, (st, rep[:80]))
st, rep, sc3 = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse66"})
d3 = json.loads(rep) if st == 200 else {}
ck3 = cookie_de(sc3)
check("2e connexion ESPA → otpRequired:true + premiereConnexion:false (Task 76 : OTP à chaque connexion)",
      st == 200 and d3.get("ok") is True and d3.get("otpRequired") is True
      and d3.get("premiereConnexion") is False, (st, rep[:150]))
st, page3, _ = req(P1, "/otp", cookie=ck3)
secret3 = secret_du_qr(page3)
check("(MODIFIÉ Task 85) 2e connexion : fenêtre /otp AVEC QR + champ de confirmation, AUCUN code affiché",
      st == 200 and 'data-payload' in page3 and 'id="otp-affiche"' not in page3
      and bool(secret3), (st, bool(secret3)))
st, rep, sc3b = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret3)}, cookie=ck3)
ck3b = cookie_de(sc3b)
check("code confirmé (2e connexion) → 200 + session complète",
      st == 200 and json.loads(rep).get("ok") is True, (st, rep[:120]))
st, rep, _ = req(P1, "/", cookie=ck3b)
check("GET / avec la session complète → fiches servies (pas de redirection /otp)",
      st == 200 and "Portail Employés" in rep and DERNIERE_LOCATION is None,
      (st, DERNIERE_LOCATION))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck3b)
check("my-fiches accessible après la 2e connexion (200)",
      st == 200 and json.loads(rep).get("exact") is True, (st, rep[:120]))
st, rep, _ = req(P1, "/otp", cookie=ck3b)
check("page /otp AVEC session complète → redirection (jamais de QR inutile)",
      st == 302, (st, DERNIERE_LOCATION))

# B4 — (MODIFIÉ Task 83) PREMIÈRE connexion NOUV (mot de passe initial) :
#      orientée /premiere → étape 1 (changement) → étape 2 (QR) → confirmation
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79"})
d4pre = json.loads(rep) if st == 200 else {}
check("1re connexion NOUV (mot de passe initial) → orienté /premiere (Task 83)",
      st == 200 and d4pre.get("premiere") is True and d4pre.get("redirect") == "/premiere",
      (st, rep[:120]))
st, rep, sc4 = req(P1, "/api/premiere", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79",
                                        "newPassword": "NouveauMot75", "confirm": "NouveauMot75"})
ck4 = cookie_de(sc4)
d4 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) étape 1 NOUV réussie (changement du mot de passe initial) → étape 2 (/otp)",
      st == 200 and d4.get("ok") is True and d4.get("step") == 2 and d4.get("redirect") == "/otp",
      (st, rep[:150]))
st, page_qr4, _ = req(P1, "/otp", cookie=ck4)
check("(MODIFIÉ Task 83) NOUV : page « Configuration OTP » (QR + champ, aucun code affiché)",
      bool(page_qr4) and 'data-payload=' in page_qr4 and 'id="otp-affiche"' not in page_qr4)
# reconnexion avec le NOUVEAU mot de passe → page de confirmation (double voie)
st, rep, sc5 = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "NouveauMot75"})
ck5 = cookie_de(sc5)
st, page5, _ = req(P1, "/otp", cookie=ck5)
secret5 = secret_du_qr(page5)
check("(MODIFIÉ Task 85) reconnexion NOUV (nouveau mot de passe) → fenêtre de confirmation avec QR (aucun code affiché)",
      bool(secret5) and 'id="otp-affiche"' not in page5, bool(secret5))
st, rep, sc5b = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret5)}, cookie=ck5)
ck5b = cookie_de(sc5b)
d5 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 90) code confirmé → inscription terminée (redirect /premiere-reussie — le changement a été fait à l'étape 1)",
      st == 200 and d5.get("ok") is True and d5.get("redirect") == "/premiere-reussie", (st, rep[:180]))
st, rep, _ = req(P1, "/api/logout", {}, cookie=ck5b)
st, rep, sc6b = req(P1, "/api/verify", {"cin": "TEST66NOUV", "password": "NouveauMot75"})
d6 = json.loads(rep) if st == 200 else {}
ck6b = cookie_de(sc6b)
check("2e connexion NOUV (après changement) → OTP OBLIGATOIRE sans QR (Task 76)",
      st == 200 and d6.get("otpRequired") is True and d6.get("premiereConnexion") is False,
      (st, rep[:150]))
st, page6b, _ = req(P1, "/otp", cookie=ck6b)
secret6b = secret_du_qr(page6b)
check("(MODIFIÉ Task 85) 2e connexion NOUV : fenêtre /otp AVEC QR + champ de confirmation, AUCUN code affiché",
      st == 200 and 'data-payload' in page6b and 'id="otp-affiche"' not in page6b
      and bool(secret6b), (st, bool(secret6b)))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret6b)}, cookie=ck6b)
check("code confirmé → accès direct / (plus aucun changement exigé)",
      st == 200 and json.loads(rep).get("ok") is True and json.loads(rep).get("redirect") == "/",
      (st, rep[:120]))

# B5 — (MODIFIÉ Task 83) défi ANNULÉ (5 erreurs) : la première connexion RESTE due
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61"})
d7pre = json.loads(rep) if st == 200 else {}
check("1re connexion ANCI (initial) → orienté /premiere (Task 83)",
      st == 200 and d7pre.get("premiere") is True, (st, rep[:120]))
st, rep, sc7 = req(P1, "/api/premiere", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61",
                                        "newPassword": "AnciMot83x!", "confirm": "AnciMot83x!"})
ck7 = cookie_de(sc7)
check("(MODIFIÉ Task 83) étape 1 ANCI réussie → étape 2 (/otp)",
      st == 200 and json.loads(rep).get("step") == 2, (st, rep[:120]))
st, page_qr7, _ = req(P1, "/otp", cookie=ck7)
check("(MODIFIÉ Task 83) ANCI : page « Configuration OTP » (QR + champ, aucun code affiché)",
      bool(page_qr7) and 'data-payload=' in page_qr7 and 'id="otp-affiche"' not in page_qr7)
# reconnexion avec le NOUVEAU mot de passe → page de confirmation
st, rep, sc7b = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "AnciMot83x!"})
ck7b = cookie_de(sc7b)
st, page7, _ = req(P1, "/otp", cookie=ck7b)
secret7 = secret_du_qr(page7)
check("(MODIFIÉ Task 85) reconnexion ANCI (nouveau mot de passe) → fenêtre de confirmation avec QR (aucun code affiché)",
      bool(secret7) and 'id="otp-affiche"' not in page7, bool(secret7))
faux = "000000"
dernier = None
for i in range(5):
    dernier = req(P1, "/api/otp/verify", {"otp": faux}, cookie=ck7b)
check("5 mauvais codes → 401 OTP_ANNULE (vérification annulée)",
      dernier[0] == 401 and json.loads(dernier[1]).get("code") == "OTP_ANNULE",
      (dernier[0], dernier[1][:150]))
check("après annulation : lastLoginAt TOUJOURS NULL (1re connexion non complétée)",
      dernier_login("TEST66ANCI").get("lastLoginAt") is None, dernier_login("TEST66ANCI"))
st, rep, sc8 = req(P1, "/api/verify", {"cin": "TEST66ANCI", "password": "AnciMot83x!"})
d8 = json.loads(rep) if st == 200 else {}
ck8 = cookie_de(sc8)
check("reconnexion ANCI après annulation → OTP DE NOUVEAU exigé",
      st == 200 and d8.get("otpRequired") is True, (st, rep[:120]))
st, page_qr8, _ = req(P1, "/otp", cookie=ck8)
secret8 = secret_du_qr(page_qr8)
check("(MODIFIÉ Task 85) ANCI après annulation : fenêtre de confirmation AVEC QR (secret persistant) et SANS code",
      bool(secret8) and 'data-payload' in page_qr8 and 'id="otp-affiche"' not in page_qr8,
      bool(secret8))
st, rep, sc9 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret8)}, cookie=ck8)
d9 = json.loads(rep) if st == 200 else {}
check("bon code → 200 (ANCI : première connexion complétée, hash ancien style conservé Task 64/65)",
      st == 200 and d9.get("ok") is True, (st, rep[:150]))

# =====================================================================
print()
print("=" * 72)
print("C. PORTAIL 4211 (TTL 3,5 s) — une EXPIRATION n'annule PAS la première connexion")
print("=" * 72)

st, rep, _ = req(P2, "/api/health")
check("portail 4211 en ligne (sonde)", st == 200, (st, rep[:80]))

st, rep, ckX, secretX, pageX, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
dX = json.loads(rep) if st == 200 else {}
check("1re connexion TEST74EXPIRE (accès jetable) → OTP + fenêtre « Configuration OTP » (premiereConnexion:true, MODIFIÉ Task 83)",
      st == 200 and dX.get("otpRequired") is True and dX.get("premiereConnexion") is True
      and bool(pageX) and 'data-payload=' in pageX, (st, rep[:120]))
time.sleep(4.2)
# (MODIFIÉ Task 85) TOTP de la fenêtre COURANTE (aucune fenêtre consommée
# pour ce compte) — le défi 3,5 s est de toute façon expiré : 410 attendu.
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretX)}, cookie=ckX)
dX2 = json.loads(rep) if rep.startswith("{") else {}
check("code CORRECT mais EXPIRÉ → 410 OTP_EXPIRE (10 minutes — ici 3,5 s)",
      st == 410 and dX2.get("code") == "OTP_EXPIRE", (st, rep[:150]))
check("après expiration : lastLoginAt TOUJOURS NULL (1re connexion non complétée)",
      dernier_login("TEST74EXPIRE").get("lastLoginAt") is None,
      dernier_login("TEST74EXPIRE"))
st, rep, _ = req(P2, "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
dX3 = json.loads(rep) if st == 200 else {}
check("reconnexion après expiration → OTP DE NOUVEAU exigé (MODIFIÉ Task 80 : premiereConnexion:false — le QR a déjà été affiché, la confirmation se fait sans QR)",
      st == 200 and dX3.get("otpRequired") is True and dX3.get("premiereConnexion") is False,
      (st, rep[:120]))
st, rep, ckY, secretY, _, _ = connexion_otp(P2, "TEST74EXPIRE", "Expire74x")
# (MODIFIÉ Task 85) TOTP de la fenêtre COURANTE (aucune consommation
# antérieure pour ce compte ; le compteur global peut être en avance —
# inutilisable avec un TTL de 3,5 s).
st, rep, scY = req(P2, "/api/otp/verify", {"otp": totp_now(secretY)}, cookie=ckY)
check("code frais confirmé → 200 (première connexion ENFIN complétée)",
      st == 200 and json.loads(rep).get("ok") is True, (st, rep[:120]))
check("TEST74EXPIRE : lastLoginAt MAINTENANT POSÉ (scellé)",
      dernier_login("TEST74EXPIRE").get("lastLoginAt") is not None,
      dernier_login("TEST74EXPIRE"))
# (MODIFIÉ Task 85) la fenêtre de confirmation consomme une fenêtre TOTP :
# pause d'une période (30 s) pour que la prochaine confirmation utilise une
# fenêtre fraîche (anti-rejeu Task 78) malgré le TTL réduit de ce portail.
time.sleep(31)
st, rep, scX4 = req(P2, "/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
dX4 = json.loads(rep) if st == 200 else {}
ckX4 = cookie_de(scX4)
check("connexion suivante TEST74EXPIRE → OTP OBLIGATOIRE sans QR (Task 76)",
      st == 200 and dX4.get("otpRequired") is True and dX4.get("premiereConnexion") is False,
      (st, rep[:120]))
st, pageX4, _ = req(P2, "/otp", cookie=ckX4)
secretX4 = secret_du_qr(pageX4)
check("(MODIFIÉ Task 85) connexion suivante : fenêtre /otp AVEC QR + champ de confirmation, AUCUN code affiché",
      st == 200 and 'data-payload' in pageX4
      and bool(secretX4), (st, bool(secretX4)))
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_now(secretX4)}, cookie=ckX4)
check("code confirmé → 200 (session complète)", st == 200, (st, rep[:120]))

# =====================================================================
total = len(RESULTATS)
reussis = sum(1 for r in RESULTATS if r)
print()
print("=" * 72)
print(f"RÉSULTAT TASK 75 : {reussis}/{total} " + ("— TOUT OK" if reussis == total else "— PROBLÈME DÉTECTÉ"))
print("=" * 72)
sys.exit(0 if reussis == total else 1)
