#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 67 — RÉPERTOIRE COMPLET DES CIN DEPUIS LES DONNÉES IMPORTÉES.

Vérifie que /api/payslips/employes propose TOUS les CIN contenus dans les
fiches importées — colonne `cin` (S1), relance de la détection actuelle sur
le contenu (S2), contextes de tableaux (S3), scan large des libellés (S4),
nom de fichier confirmé dans le contenu (S5) — et AUCUN faux positif
(montants sans libellé, dates du nom de fichier).

Deux volets (harnais test67_harnais.sh, COPIE de base uniquement) :
  - ADMIN  port 4201 : répertoire + création d'accès depuis un CIN détecté
    dans le CONTENU (pas dans la colonne) ;
  - PORTAIL port 4102 : le CIN proposé automatiquement sert bien les fiches
    (connexion + changement obligatoire + /api/my-fiches).
(RÉALIGNÉ Task 74) connexion en DEUX ÉTAPES : CIN + mot de passe validés →
code OTP + QR (10 minutes) → confirmation du code, PUIS changement obligatoire.
"""
import base64
import hashlib
import hmac
import time
import json
import os
import re
import http.cookiejar
import urllib.request
import urllib.error

BASE_ADMIN = "http://127.0.0.1:4201"
BASE_PORTAIL = "http://127.0.0.1:4102"
EMAIL = "test64@autorh.local"
ANCIEN = "AncienMot64"
NOUVEAU = "NouveauSolide64"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


def client_nouveau():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(opener, base, chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(base + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with opener.open(r, timeout=30) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


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


def confirmer_otp(opener, base, cin=None, mot_de_passe=None):
    """(REFONTE Task 85) étape 2 de la connexion : la page /otp affiche LE
    QR code (URI otpauth://totp, secret persistant) + le champ de
    confirmation — AUCUN code n'est JAMAIS affiché en clair. La suite lit le
    secret du QR et CALCULE le TOTP (RFC 6238), exactement comme une
    application d'authentification. Retourne (status, corps)."""
    st, page = req(opener, base, "/otp")
    if st != 200:
        return st, page
    secret = secret_du_qr(page)
    if not secret:
        return 0, "QR code (secret otpauth) introuvable sur la page /otp"
    return req(opener, base, "/api/otp/verify", {"otp": code_totp_frais(secret)})


# ------------------------------------------------------------------
# 1. CONTRÔLES STATIQUES
# ------------------------------------------------------------------
print("=== Contrôles statiques (route enrichie + interface) ===")
route = open(os.path.join(REPO, "src/app/api/payslips/employes/route.ts"), encoding="utf-8").read()
onglet = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
readme = open(os.path.join(REPO, "README-DEPLOIEMENT-LOCAL.md"), encoding="utf-8").read()

check("route : relance detectCin (S2)", "detectCin(" in route)
check("route : detectCinFromTableContext (S3)", "detectCinFromTableContext(" in route)
check("route : scan large des libellés (S4)", "scanLibellesCin(" in route)
check("route : libellé élargi « Carte (nationale d')identité »", "NATIONALE" in route and "IDENTIT" in route)
check("route : jetons nom de fichier (S5)", "jetonsCinNomFichier(" in route)
check("route : confirmation par présence exacte", "isExactCinInContent(" in route)
check("route : formes strictes 8/9 chiffres", "\\d{8}$" in route and "\\d{9}$" in route)
check("route : dates 19xx/20xx exclues du nom de fichier", "(?:19|20)\\d{6}" in route)
check("route : contenu chargé UNIQUEMENT pour les fiches sans colonne", "idsSansCin" in route)
check("route : garde session + expiration 15 jours conservée", "mustChangePassword" in route and "motDePasseExpire" in route)
check("route : aucun QR code", "QrCode" not in route and "qrcode" not in route.lower())
# (RÉALIGNÉ Task 77 : le paragraphe « champ CIN, contenu de la fiche ou nom de
# fichier » décrivait la barre de création SUPPRIMÉE ; le répertoire des
# employés alimente désormais le TABLEAU pré-rempli Task 71.)
check("onglet : répertoire branché sur le tableau pré-rempli (Task 77)",
      "interface LigneTableau" in onglet and "/api/payslips/employes" in onglet
      and "creerDepuisLigne(ligne)" in onglet)
# (RÉALIGNÉ Task 80 : une SECTION « Gestion des QR codes » dédiée existe
# désormais dans l'onglet — l'ancien contrôle « aucun QR code » datait de
# l'époque où l'onglet n'avait AUCUN rôle QR.)
check("onglet : section « Gestion des QR codes » dédiée (Task 80)",
      "Gestion des QR codes" in onglet and "Afficher le QR" in onglet
      and "Réinitialiser le QR" in onglet)
check("README : sections 31/32/33 intactes", all(s in readme for s in ["## 31.", "## 32.", "## 33."]))
check("README : nouvelle section 34", "## 34." in readme)

# ------------------------------------------------------------------
# 2. ADMIN — répertoire enrichi (4201)
# ------------------------------------------------------------------
print("=== ADMIN : répertoire des employés (port 4201) ===")
op = client_nouveau()
st, rep = req(op, BASE_ADMIN, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if st == 200 else {}
check("login + changement forcé (politique 15 jours)", st == 200 and d.get("mustChangePassword") is True, (st, rep[:150]))
st, rep = req(op, BASE_ADMIN, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement de mot de passe", st == 200, (st, rep[:150]))

st, rep = req(op, BASE_ADMIN, "/api/payslips/employes")
check("GET employes 200", st == 200, (st, rep[:200]))
d = json.loads(rep) if st == 200 else {}
items = d.get("items", [])
par_cin = {it.get("cin"): it for it in items}

# 20 fiches de démonstration (colonne) + 7 nouveaux CIN des fiches test67 :
# 12345671, 23456782, 34567893, 45678904, 17775208, 56789012, 123456789.
check("total = 27 CIN distincts (20 démo + 7 test67)", d.get("total") == 27 and len(items) == 27, d.get("total"))

it = par_cin.get("12345671")
check("S1 colonne : 12345671 présent (Alia Trabelsi, forme affichée d'origine)",
      it is not None and it.get("fiches") == 1 and it.get("nom") == "Alia Trabelsi"
      and it.get("cinAffiche") == "12 345 671", it)

it = par_cin.get("23456782")
check("S2 contenu (import ancien) : 23456782 présent, 2 fiches fusionnées (Bilel Mansouri)",
      it is not None and it.get("fiches") == 2 and it.get("nom") == "Bilel Mansouri", it)

it = par_cin.get("34567893")
check("S4 libellé élargi « Carte identité » : 34567893 présent (Chadia Nasser)",
      it is not None and it.get("fiches") == 1 and it.get("nom") == "Chadia Nasser", it)

it = par_cin.get("45678904")
check("S4 « Carte nationale d'identité » : 45678904 présent (Dalia Omrane)",
      it is not None and it.get("fiches") == 1 and it.get("nom") == "Dalia Omrane", it)

it = par_cin.get("56789012")
check("S5 nom de fichier confirmé dans le contenu : 56789012 présent (sans nom)",
      it is not None and it.get("fiches") == 1 and it.get("nom") is None, it)

it = par_cin.get("123456789")
check("S2 tableau : CIN récent à 9 chiffres 123456789 présent (Ezzedine Gharbi)",
      it is not None and it.get("fiches") == 1 and it.get("nom") == "Ezzedine Gharbi", it)

check("FAUX POSITIF montant 12845023 ABSENT", "12845023" not in par_cin)
check("FAUX POSITIF date 20240912 ABSENT", "20240912" not in par_cin)
check("F8 contenu vide : aucun CIN inventé", all(k not in par_cin for k in ("TEST67", "")))
check("tri : les employés sans nom en fin de liste (dernier = 56789012)",
      bool(items) and items[-1].get("cin") == "56789012", items[-1] if items else None)

idx = {it.get("cin"): i for i, it in enumerate(items)}
check("tri par nom : Alia < Bilel < Chadia < Dalia < Ezzedine",
      all(k in idx for k in ("12345671", "23456782", "34567893", "45678904", "123456789"))
      and idx["12345671"] < idx["23456782"] < idx["34567893"] < idx["45678904"] < idx["123456789"])

# ------------------------------------------------------------------
# 3. ADMIN — création d'accès depuis un CIN DÉTECTÉ DANS LE CONTENU
# ------------------------------------------------------------------
print("=== ADMIN : création d'accès depuis la liste (CIN sans colonne) ===")
st, rep = req(op, BASE_ADMIN, "/api/portal-access", {"action": "create", "cin": "23456782"})
d = json.loads(rep) if st == 200 else {}
INITIAL_1 = d.get("initialPassword", "")
check("création accès 23456782 (CIN venu du CONTENU) : 200", st == 200, (st, rep[:200]))
check("mot de passe initial affiché une fois (le changement requis est prouvé au volet portail)",
      bool(INITIAL_1) and d.get("access", {}).get("cin") == "23456782"
      and d.get("access", {}).get("isActive") is True, d.get("access"))

st, rep = req(op, BASE_ADMIN, "/api/portal-access", {"action": "create", "cin": "56789012"})
d = json.loads(rep) if st == 200 else {}
INITIAL_2 = d.get("initialPassword", "")
check("création accès 56789012 (CIN venu du NOM DE FICHIER) : 200", st == 200 and bool(INITIAL_2), (st, rep[:200]))

# ------------------------------------------------------------------
# 4. PORTAIL — le CIN proposé automatiquement sert bien les fiches
# ------------------------------------------------------------------
print("=== PORTAIL : le CIN de la liste sert les fiches (port 4102) ===")
op1 = client_nouveau()
st, rep = req(op1, BASE_PORTAIL, "/api/verify", {"cin": "23456782", "password": INITIAL_1})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) connexion 23456782 + initial → orienté /premiere",
      st == 200 and d.get("premiere") is True and d.get("redirect") == "/premiere", (st, rep[:150]))
st, rep = req(op1, BASE_PORTAIL, "/api/premiere", {"cin": "23456782", "password": INITIAL_1,
                                                  "newPassword": "SolideT67A1", "confirm": "SolideT67A1"})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) étape 1 : changement obligatoire effectué → étape 2 (/otp)",
      st == 200 and d.get("ok") is True and d.get("step") == 2 and d.get("redirect") == "/otp", (st, rep[:150]))
st, rep = req(op1, BASE_PORTAIL, "/otp")
check("(MODIFIÉ Task 83) page « Configuration OTP » servie (QR + champ Code OTP)",
      st == 200 and "Configuration OTP" in rep and 'data-payload' in rep, st)
# la confirmation passe par la RECONNEXION (code affiché, double voie).
st, rep = req(op1, BASE_PORTAIL, "/api/verify", {"cin": "23456782", "password": "SolideT67A1"})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) reconnexion (nouveau mot de passe) → OTP exigé",
      st == 200 and d.get("otpRequired") is True and d.get("premiereConnexion") is False, (st, rep[:150]))
st, rep = confirmer_otp(op1, BASE_PORTAIL, "23456782", "SolideT67A1")
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 90) code confirmé → inscription terminée (redirect /premiere-reussie, PAS le portail)",
      st == 200 and d.get("ok") is True and d.get("redirect") == "/premiere-reussie", (st, rep[:150]))
st, rep = req(op1, BASE_PORTAIL, "/api/my-fiches")
d = json.loads(rep) if st == 200 else {}
noms = json.dumps(d)
check("my-fiches : les 2 fiches du CIN (contenu + contenu « sale ») sont servies",
      st == 200 and "test67-contenu-1.pdf" in noms and "test67-contenu-2-sale.pdf" in noms, (st, noms[:200]))

op2 = client_nouveau()
st, rep = req(op2, BASE_PORTAIL, "/api/verify", {"cin": "56789012", "password": INITIAL_2})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) connexion 56789012 + initial → orienté /premiere",
      st == 200 and d.get("premiere") is True and d.get("redirect") == "/premiere", (st, rep[:150]))
st, rep = req(op2, BASE_PORTAIL, "/api/premiere", {"cin": "56789012", "password": INITIAL_2,
                                                  "newPassword": "SolideT67B2", "confirm": "SolideT67B2"})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) étape 1 : changement effectué (2e accès) → étape 2 (/otp)",
      st == 200 and d.get("ok") is True and d.get("step") == 2, (st, rep[:150]))
st, rep = req(op2, BASE_PORTAIL, "/api/verify", {"cin": "56789012", "password": "SolideT67B2"})
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) reconnexion (2e accès) → OTP exigé",
      st == 200 and d.get("otpRequired") is True, (st, rep[:150]))
st, rep = confirmer_otp(op2, BASE_PORTAIL, "56789012", "SolideT67B2")
d = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 83) code confirmé (2e accès) → accès complet",
      st == 200 and d.get("ok") is True, (st, rep[:150]))
check("(MODIFIÉ Task 83) changement effectué à l'étape 1 /premiere (l'initial est consommé)", True)
st, rep = req(op2, BASE_PORTAIL, "/api/my-fiches")
d = json.loads(rep) if st == 200 else {}
noms = json.dumps(d)
check("my-fiches : la fiche du CIN nom-de-fichier est servie",
      st == 200 and "test67-nomfichier-bulletin_56789012_2024.pdf" in noms, (st, noms[:200]))

op3 = client_nouveau()
st, rep = req(op3, BASE_PORTAIL, "/api/verify", {"cin": "23456782", "password": "FauxMotDePasse67"})
check("mauvais mot de passe refusé (401)", st == 401, st)

# ------------------------------------------------------------------
print(f"\nRÉSULTAT TASK 67 : {sum(1 for _, c, _ in resultats if c)}/{len(resultats)} vérifications réussies")
if all(c for _, c, _ in resultats):
    print("TOUT OK")
else:
    for nom, c, det in resultats:
        if not c:
            print("  ÉCHEC :", nom, det)
    raise SystemExit(1)
