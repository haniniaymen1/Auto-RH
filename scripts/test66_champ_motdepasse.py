#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 66 — TESTS « CHAMP DE MOT DE PASSE » sur COPIE de base (portail autonome 4102).

(RÉALIGNÉ Task 74) la connexion est désormais en DEUX ÉTAPES : CIN + mot de
passe validés → code OTP + QR affichés (10 minutes) → confirmation du code.
Le test lit le code sur /otp et le confirme ; les décisions « changement
OBLIGATOIRE » arrivent APRÈS la confirmation.
(RÉALIGNÉ Task 75 PUIS Task 76 : « Lors de la première connexion, le QR
code s'affiche. Lors des connexions suivantes, l'utilisateur doit
obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP ») —
chaque connexion exige l'OTP ; les re-connexions passent par la page /otp
SANS QR (Task 76), le changement obligatoire reste évalué après le code.

Problème corrigé : « le champ de mot de passe mauvais ».
  1. autocomplete="new-password" sur les champs de CONNEXION faisait
     PRÉ-REMPLIR le champ par le navigateur avec un mot de passe GÉNÉRÉ
     faux → correction : autocomplete="current-password" (portail connexion,
     portail changement « actuel », administration /login).
  2. Le mot de passe initial AFFICHÉ « XXXX-XXXX-XXXX » était refusé s'il
     était recopié SANS tirets ou avec un espace parasite → correction :
     hash de la forme NETTOYÉE + vérification TOLÉRANTE (tirets/espaces de
     la saisie ignorés).

La copie (sandbox-test66/test66.db) ne contient que le schéma + les accès de
test (scripts/test66_inserer.js). La base réelle n'est JAMAIS touchée.

Scénario :
  A. Statique : HTML servi (connexion + changement) + fichiers sources.
  B. Style NOUVEAU : initial accepté AVEC tirets, SANS tirets, avec espace
     parasite ; preuve d'identité tolérante ; validations (≥8 hors tirets) ;
     changement ; re-connexion directe (même avec espace final).
  C. Style ANCIEN (hash avec tirets) : recopié AVEC tirets = accepté
     (compatibilité) ; SANS tirets = refusé (comportement documenté).
  D. Mot de passe choisi avec espaces : accepté avec et sans espaces.
"""
import base64
import hashlib
import hmac
import time
import json
import os
import re
import sys
import http.cookiejar
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4102"
RACINE = "/home/z/my-project"

INITIAL_AFFICHE = "Kl84-Mn26-Pq79"   # tel qu'affiché dans l'interface RH
INITIAL_SANS_TIRETS = "Kl84Mn26Pq79"
NOUVEAU1 = "NouveauMot66"
NOUVEAU2 = "EncorePlusSolide66"

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


def lire(chemin):
    with open(os.path.join(RACINE, chemin), encoding="utf-8") as f:
        return f.read()


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


print("=== A. Statique : champs de CONNEXION en current-password ===")
op = client_nouveau()
st, html = req(op, "/")
check("page connexion 200", st == 200, st)
check("connexion : champ mot de passe en current-password (Task 66)",
      'type="password" id="password"' in html and 'autocomplete="current-password"' in html)
check("connexion : AUCUN new-password sur la page de connexion",
      'autocomplete="new-password"' not in html)
check("connexion : aide « tirets et espaces sont ignorés » affichée",
      "tirets et espaces sont ignorés" in html)

portail = lire("scripts/portail-server.js")
route_ts = lire("src/app/api/portal-access/route.ts")
login_tsx = lire("src/app/login/page.tsx")
onglet = lire("src/components/payslip/portal-access-tab.tsx")

check("portail : fonction nettoyerMotDePasse présente",
      "function nettoyerMotDePasse(" in portail and "verifierMotDePasseTolerant" in portail)
check("portail : écran changement — « actuel » en current-password",
      'id="cur" name="cur" autocomplete="current-password"' in portail)
check("portail : écran changement — « nouveau »/« confirmer » restent new-password (création)",
      'id="new" name="new" autocomplete="new-password"' in portail
      and 'id="conf" name="conf" autocomplete="new-password"' in portail)
check("admin /login : mot de passe en current-password (Task 66)",
      'autoComplete="current-password"' in login_tsx
      and 'autoComplete="new-password"' not in login_tsx)
check("admin API : hash de la forme NETTOYÉE de l'initial",
      "nettoyerMotDePasse" in route_ts and "hacher(nettoyerMotDePasse(initialPassword))" in route_ts)
check("onglet Accès portail : consigne tirets/espaces ignorés",
      "tirets et espaces sont ignorés" in onglet)

print("=== B. Style NOUVEAU : initial accepté avec/sans tirets, espace parasite ===")
# (MODIFIÉ Task 83) la preuve d'identité par l'INITIAL et la politique du
# NOUVEAU mot de passe s'exercent DÉSORMAIS via /api/premiere (étape 1 de la
# première connexion) — MÊME vérification tolérante (Task 66), MÊME politique
# (>= 8 vrais caractères hors tirets, != actuel, != CIN). Les échecs de
# politique (400) ne consomment PAS l'initial : chaque variante de saisie
# reste prouvable avant l'enregistrement final.
# B1. Recopié EXACTEMENT comme affiché (avec tirets) : orienté /premiere.
op1 = client_nouveau()
st, rep = req(op1, "/api/verify", {"cin": "TEST66NOUV", "password": INITIAL_AFFICHE})
d = json.loads(rep)
check("connexion initial AVEC tirets → 200 + orienté /premiere (MODIFIÉ Task 83)",
      st == 200 and d.get("ok") is True and d.get("premiere") is True, (st, rep))

# B2. Recopié SANS tirets (cas « retranscription à la main ») : la preuve
# d'identité tolérante passe par /api/premiere (échec de POLITIQUE 400 =
# l'initial a été accepté, le nouveau mot de passe est trop faible).
st, rep = req(op1, "/api/premiere", {"cin": "TEST66NOUV", "password": INITIAL_SANS_TIRETS,
                                     "newPassword": "a-b-c-d-e-f-g", "confirm": "a-b-c-d-e-f-g"})
check("initial SANS tirets accepté par /api/premiere → politique refuse le nouveau trop faible (400, MODIFIÉ Task 83)",
      st == 400 and "au moins 8 caractères" in rep, (st, rep[:150]))
st, rep = req(op1, "/api/premiere", {"cin": "TEST66NOUV", "password": INITIAL_SANS_TIRETS,
                                     "newPassword": INITIAL_AFFICHE, "confirm": INITIAL_AFFICHE})
check("nouveau == actuel (hors tirets) refusé (400)", st == 400, (st, rep))

# B3. Collage parasite : espace de fin + retour à la ligne
st, rep = req(op1, "/api/premiere", {"cin": "TEST66NOUV", "password": INITIAL_AFFICHE + " \n",
                                     "newPassword": INITIAL_AFFICHE, "confirm": INITIAL_AFFICHE})
check("initial avec espace/retour parasite accepté (nouveau == actuel → 400, pas 401)",
      st == 400, (st, rep[:120]))

# B4. Mauvais mot de passe : toujours refusé
op4 = client_nouveau()
st, rep = req(op4, "/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq78"})
check("mauvais mot de passe → 401", st == 401, (st, rep))
st, rep = req(op4, "/api/premiere", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq78",
                                     "newPassword": NOUVEAU1, "confirm": NOUVEAU1})
check("mauvais mot de passe ACTUEL refusé par /api/premiere (401, message générique)",
      st == 401 and "CIN ou mot de passe incorrect" in rep, (st, rep[:120]))

# B5. Enregistrement : preuve SANS tirets + forme nettoyée → étape 2 (/otp)
st, rep = req(op1, "/api/premiere", {"cin": "TEST66NOUV", "password": INITIAL_SANS_TIRETS,
                                     "newPassword": NOUVEAU1, "confirm": NOUVEAU1})
d = json.loads(rep)
check("étape 1 acceptée avec preuve SANS tirets (200) → étape 2 (/otp) (MODIFIÉ Task 83)",
      st == 200 and d.get("ok") is True and d.get("step") == 2 and d.get("redirect") == "/otp", (st, rep))
st, html_chg = req(op1, "/otp")
check("(MODIFIÉ Task 83) étape 2 servie : page « Configuration OTP » (QR + champ Code OTP)",
      st == 200 and "Configuration OTP" in html_chg and 'data-payload' in html_chg, st)

# B6. Re-connexion avec le nouveau mot de passe (tolérance espaces)
# (RÉALIGNÉ Task 76) 3e connexion NOUV : OTP obligatoire (sans QR), accès
# direct après confirmation — plus aucun changement exigé.
op5 = client_nouveau()
st, rep = req(op5, "/api/verify", {"cin": "TEST66NOUV", "password": NOUVEAU1})
d = json.loads(rep)
check("re-connexion NOUVEAU mot de passe → OTP OBLIGATOIRE sans QR (Task 76)",
      st == 200 and d.get("ok") is True and d.get("otpRequired") is True
      and d.get("premiereConnexion") is False, (st, rep))
st, rep = confirmer_otp(op5, "TEST66NOUV", NOUVEAU1)
d = json.loads(rep)
check("(MODIFIÉ Task 90) OTP confirmé (3e connexion) → inscription terminée : redirect /premiere-reussie, sans changement",
      st == 200 and d.get("ok") is True and d.get("redirect") == "/premiere-reussie"
      and "mustChangePassword" not in d, (st, rep))
st, rep = req(op5, "/api/my-fiches")
check("accès fiches après confirmation (200)", st == 200, st)
op6 = client_nouveau()
st, rep = req(op6, "/api/verify", {"cin": "TEST66NOUV", "password": NOUVEAU1 + " "})
check("re-connexion avec espace final parasite = acceptée", st == 200, (st, rep))
# usage unique de l'initial conservé
op7 = client_nouveau()
st, rep = req(op7, "/api/verify", {"cin": "TEST66NOUV", "password": INITIAL_AFFICHE})
check("initial à usage unique : refusé après changement (401)", st == 401, (st, rep))

print("=== C. Style ANCIEN (hash avec tirets, Task 64/65) : compatibilité ===")
opA = client_nouveau()
st, rep = req(opA, "/api/verify", {"cin": "TEST66ANCI", "password": "Hx72-Gt94-Ls61"})
check("ancien initial recopié AVEC tirets → accepté (compatibilité)", st == 200, (st, rep))
opB = client_nouveau()
st, rep = req(opB, "/api/verify", {"cin": "TEST66ANCI", "password": "Hx72Gt94Ls61"})
check("ancien initial SANS tirets → refusé (comportement documenté : RH réinitialise)", st == 401, (st, rep))

print("=== D. Mot de passe choisi avec espaces : tolérance symétrique ===")
opE = client_nouveau()
st, rep = req(opE, "/api/verify", {"cin": "TEST66ESPA", "password": "Mot De Passe 66"})
check("mot de passe à espaces recopié AVEC espaces → accepté", st == 200, (st, rep))
opF = client_nouveau()
st, rep = req(opF, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse66"})
check("même mot de passe tapé SANS espaces → accepté", st == 200, (st, rep))
opG = client_nouveau()
st, rep = req(opG, "/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse67"})
check("mot de passe faux → toujours refusé (401)", st == 401, (st, rep))

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 66 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
