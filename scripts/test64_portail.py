#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — TESTS E2E DU PORTAIL EMPLOYÉS sur COPIE VIERGE de base (port 4101).

(RÉALIGNÉ Task 74) après la validation CIN + mot de passe, le portail exige
une VÉRIFICATION EN DEUX ÉTAPES : code OTP + QR code affichés (10 minutes).
Le test lit le code affiché sur la page /otp et le confirme, exactement
comme un employé. La décision « changement OBLIGATOIRE » (Task 64) arrive
APRÈS la confirmation du code.
(RÉALIGNÉ Task 75 PUIS Task 76 : « Lors de la première connexion, le QR
code s'affiche. Lors des connexions suivantes, l'utilisateur doit
obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP ») —
chaque connexion exige l'OTP (code frais 10 minutes) ; le QR n'est affiché
qu'à la PREMIÈRE connexion (B) — les connexions SUIVANTES (C et D) passent
par la page /otp SANS QR, et le changement OBLIGATOIRE du mot de passe
(initial ou expiré) est appliqué APRÈS la confirmation du code.

(RÉALIGNÉ Task 83 — maquette utilisateur : la PREMIÈRE connexion passe par
la page DÉDIÉE /premiere — CIN + mot de passe initial + nouveau mot de
passe ×2 + « Valider » — PUIS l'étape 2 /otp affiche le QR + champ Code
OTP ; /api/premiere applique la même politique de mot de passe que
/api/change-password. Le changement du mot de passe initial arrive DONC
À L'ÉTAPE 1 (avant le QR). La page de connexion porte DÉSORMAIS le champ
Code OTP (Task 82/83) : « Connexion avec CIN + mot de passe + OTP ».
Les sections C/D/E/F (usage unique de l'initial, expiration 15 jours,
ancien accès, force brute) restent inchangées.)

(RÉALIGNÉ Task 85 — « jamais affiche le code otp comme ca, dans cette
fenetre n affiche que qr code qui expire apres 10 minute ») : la fenêtre
/otp N'AFFICHE JAMAIS LE CODE — elle montre le QR code (URI otpauth://totp
standard, secret persistant) dans TOUS les cas (inscription ET
confirmations suivantes) + le champ de confirmation. La suite ne lit plus
aucun code à l'écran : elle CALCULE le TOTP (RFC 6238) depuis le secret
Base32 du QR, exactement comme une application d'authentification.

La copie (db/test-task64.db) ne contient QUE le schéma + les accès de test
(scripts/test64_inserer.js) : aucune fiche historique, aucun compte réel.
La base réelle db/custom.db n'est JAMAIS touchée.

Scénario :
  A. Page de connexion = CIN + mot de passe + champ Code OTP (Task 82/83) +
     lien « Première connexion » (/premiere).
  B. Mot de passe INITIAL (PREMIÈRE connexion) → orienté /premiere →
     /api/premiere (politique du nouveau mot de passe) → étape 2 : QR +
     confirmation (TOTP calculé depuis le QR) → session complète.
  C. Mot de passe initial à USAGE UNIQUE ; 2e connexion avec le nouveau mot
     de passe = OTP OBLIGATOIRE via la fenêtre QR (Task 85 : QR + champ
     code, AUCUN code affiché) → confirmation → accès.
  D. EXPIRATION 15 JOURS (passwordChangedAt reculé de 16 jours) → 3e
     connexion = fenêtre QR puis changement OBLIGATOIRE (Task 76) →
     renouvellement → 4e connexion = fenêtre QR puis accès direct.
  E. Ancien accès OTP (sans mot de passe) → message « Réinitialiser ».
  F. Anti force-brute : 5 échecs puis 6e tentative → 423 verrouillé.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import http.cookiejar
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4101"
RACINE = "/home/z/my-project"
CIN = "TEST64CIN"
INITIAL = "Initial64x"
NOUVEAU1 = "MonNouveauMot64"
NOUVEAU2 = "EncorePlusSolide64"

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


def client_nouveau():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(opener, chemin, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with opener.open(r, timeout=15) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def reculer_date_expiration():
    env = dict(os.environ)
    env["DATABASE_URL"] = "file:/home/z/my-project/db/test-task64.db"
    subprocess.run(
        ["node", "scripts/test64_inserer.js", "dater"],
        cwd=RACINE, env=env, check=True, capture_output=True,
    )


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


def secret_du_qr(page):
    """(NOUVEAU Task 85) extrait le secret Base32 de l'URI otpauth://totp
    embarquée dans l'attribut data-payload du QR code de la page /otp."""
    m = re.search(r'data-payload="([^"]+)"', page or "")
    if not m:
        return None
    m2 = re.search(r"secret=([A-Z2-7]+)", m.group(1))
    return m2.group(1) if m2 else None


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


def confirmer_otp(opener, cin=None, mot_de_passe=None):
    """(REFONTE Task 85) étape 2 de la connexion : la page /otp affiche LE
    QR code (URI otpauth://totp, secret persistant) + le champ de
    confirmation — AUCUN code n'est JAMAIS affiché en clair. La suite lit le
    secret du QR et CALCULE le TOTP (RFC 6238), exactement comme une
    application d'authentification. Retourne (status, corps)."""
    st, page = req(opener, "/otp")
    if st != 200:
        return st, page
    secret = secret_du_qr(page)
    if not secret:
        return 0, "QR code (secret otpauth) introuvable sur la page /otp"
    return req(opener, "/api/otp/verify", {"otp": code_totp_frais(secret)})


print("=== A. Page de connexion (Task 82/83 : CIN + mot de passe + OTP) ===")
op = client_nouveau()
st, html = req(op, "/")
check("page racine 200", st == 200, st)
check("champ mot de passe présent", 'type="password"' in html and 'id="password"' in html)
check("(MODIFIÉ Task 82/83) champ Code OTP PRÉSENT sur la page de connexion",
      'id="otp" name="otp"' in html and 'one-time-code' in html)
check("(NOUVEAU Task 83) lien visible vers la page Première connexion (/premiere)",
      'href="/premiere"' in html)
check("(NOUVEAU Task 83) tête de carte « Connexion » de la maquette",
      'carte-titre">Connexion' in html)
check("mention changement tous les 15 jours", "15 jours" in html)

print("=== B. (MODIFIÉ Task 83) Initial → /premiere (changement à l'étape 1) → QR → accès ===")
op = client_nouveau()
st, rep = req(op, "/api/verify", {"cin": CIN.lower(), "password": INITIAL})
d = json.loads(rep)
check("connexion initial 200 + orienté vers /premiere (Task 83 : changement à l'étape 1)",
      st == 200 and d.get("ok") is True and d.get("premiere") is True
      and d.get("redirect") == "/premiere", (st, rep))

st, rep = req(op, "/api/premiere", {"cin": CIN, "password": "MauvaisAncien", "newPassword": NOUVEAU1, "confirm": NOUVEAU1})
check("(MODIFIÉ Task 83) /api/premiere avec mauvais initial refusé (401, message générique)",
      st == 401 and "CIN ou mot de passe incorrect" in rep, (st, rep))

st, rep = req(op, "/api/premiere", {"cin": CIN, "password": INITIAL, "newPassword": INITIAL, "confirm": INITIAL})
check("(MODIFIÉ Task 83) nouveau == actuel refusé (400)", st == 400, (st, rep))

st, rep = req(op, "/api/premiere", {"cin": CIN, "password": INITIAL, "newPassword": CIN, "confirm": CIN})
check("(MODIFIÉ Task 83) nouveau == CIN refusé (400)", st == 400, (st, rep))

st, rep = req(op, "/api/premiere", {"cin": CIN, "password": INITIAL, "newPassword": NOUVEAU1, "confirm": NOUVEAU1})
d = json.loads(rep)
check("(MODIFIÉ Task 83) étape 1 acceptée (200) → étape 2 (/otp)",
      st == 200 and d.get("ok") is True and d.get("step") == 2 and d.get("redirect") == "/otp", (st, rep))

st, html = req(op, "/otp")
check("(MODIFIÉ Task 83) étape 2 : page « Configuration OTP » (QR + champ Code OTP)",
      st == 200 and "Configuration OTP" in html and 'data-payload' in html
      and 'id="otp-saisie"' in html, st)

# (Task 83) la confirmation passe par la RECONNEXION (CIN + NOUVEAU mot de
# passe) → fenêtre de confirmation (REFONTE Task 85 : QR code + champ code,
# AUCUN code affiché — la suite calcule le TOTP depuis le secret du QR).
st, rep = req(op, "/api/verify", {"cin": CIN, "password": NOUVEAU1})
d = json.loads(rep)
check("(MODIFIÉ Task 83) reconnexion avec le NOUVEAU mot de passe → OTP exigé",
      st == 200 and d.get("otpRequired") is True and d.get("premiereConnexion") is False, (st, rep))
st, page = req(op, "/otp")
secret85 = secret_du_qr(page)
check("(MODIFIÉ Task 85) page de confirmation avec QR code (AUCUN code affiché)",
      bool(secret85) and 'id="otp-affiche"' not in page
      and 'Générer un nouveau code' not in page, bool(secret85))
st, rep = req(op, "/api/otp/verify", {"otp": code_totp_frais(secret85) if secret85 else "000000"})
d = json.loads(rep)
check("(MODIFIÉ Task 90) code TOTP de l'application confirmé → inscription terminée (redirect /premiere-reussie, PAS le portail)",
      st == 200 and d.get("ok") is True and d.get("redirect") == "/premiere-reussie", (st, rep))
st, rep = req(op, "/api/my-fiches")
check("accès fiches après la première connexion complète (200)", st == 200, (st, rep))
st, html = req(op, "/")
check("page des fiches servie (session complète)", "Portail Employés" in html and "choisissez votre mot de passe" not in html)

print("=== C. Mot de passe initial à usage unique + 2e connexion AVEC OTP SANS QR (Task 76) ===")
op2 = client_nouveau()
st, rep = req(op2, "/api/verify", {"cin": CIN, "password": INITIAL})
check("re-connexion avec l'initial refusée (401)", st == 401, (st, rep))
st, rep = req(op2, "/api/verify", {"cin": CIN, "password": NOUVEAU1})
d = json.loads(rep)
check("2e connexion avec le NOUVEAU mot de passe → OTP OBLIGATOIRE via la fenêtre QR (Task 85)",
      st == 200 and d.get("ok") is True and d.get("otpRequired") is True
      and d.get("premiereConnexion") is False, (st, rep))
st, page2 = req(op2, "/otp")
check("(MODIFIÉ Task 85) 2e connexion : fenêtre /otp AVEC QR code et SANS code affiché",
      st == 200 and 'data-payload' in page2 and 'id="otp-affiche"' not in page2, st)
st, rep = confirmer_otp(op2)
d = json.loads(rep)
check("code OTP confirmé (2e connexion) → accès fiches", st == 200 and d.get("ok") is True, (st, rep))
st, rep = req(op2, "/api/my-fiches")
check("accès fiches après confirmation (200)", st == 200, (st, rep))

print("=== D. Expiration 15 jours → OTP SANS QR puis changement OBLIGATOIRE (Task 76) ===")
reculer_date_expiration()
op3 = client_nouveau()
st, rep = req(op3, "/api/verify", {"cin": CIN, "password": NOUVEAU1})
d = json.loads(rep)
check("mot de passe expiré → connexion validée + OTP OBLIGATOIRE SANS QR (Task 76 : 3e connexion)",
      st == 200 and d.get("ok") is True and d.get("otpRequired") is True
      and d.get("premiereConnexion") is False, (st, rep))
st, rep = confirmer_otp(op3)
d = json.loads(rep)
check("code confirmé → changement OBLIGATOIRE (motif expire)",
      st == 200 and d.get("mustChangePassword") is True and d.get("motif") == "expire", (st, rep))
st, html = req(op3, "/")
check("écran « mot de passe expiré »", "Mot de passe expiré" in html, st)
st, rep = req(op3, "/api/change-password", {"currentPassword": NOUVEAU1, "newPassword": NOUVEAU2})
check("changement après expiration accepté", st == 200, (st, rep))
st, rep = req(op3, "/api/my-fiches")
check("accès fiches après renouvellement (200)", st == 200, (st, rep))
st, rep = req(op3, "/api/verify", {"cin": CIN, "password": NOUVEAU2})
d = json.loads(rep)
check("4e connexion avec le mot de passe renouvelé → OTP OBLIGATOIRE sans QR (Task 76)",
      st == 200 and d.get("ok") is True and d.get("otpRequired") is True
      and d.get("premiereConnexion") is False, (st, rep))
st, rep = confirmer_otp(op3)
d = json.loads(rep)
check("code confirmé (4e connexion) → accès DIRECT sans nouveau changement",
      st == 200 and d.get("ok") is True and d.get("redirect") == "/"
      and "mustChangePassword" not in d, (st, rep))

print("=== E. Ancien accès OTP (sans mot de passe) ===")
op4 = client_nouveau()
st, rep = req(op4, "/api/verify", {"cin": "TEST64OTP", "password": "NimporteQuoi64"})
check("ancien OTP refusé (401)", st == 401, (st, rep))
check("message invite à RÉINITIALISER", "RÉINITIALISER" in rep or "réinitialiser" in rep.lower(), rep)

print("=== F. Anti force-brute (compte dédié TEST64EXPIRE) ===")
op5 = client_nouveau()
codes = []
for i in range(6):
    st, rep = req(op5, "/api/verify", {"cin": "TEST64EXPIRE", "password": "FauxMotDePasse" + str(i)})
    codes.append(st)
check("5 premiers échecs = 401", all(c == 401 for c in codes[:5]), codes)
check("6e tentative → verrouillage 423", codes[5] == 423, codes)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT PORTAIL : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
