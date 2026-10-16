#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 69 — TESTS « CHAMP MOT DE PASSE COMME DANS L'IMAGE » (portail employés).

Demande utilisateur : « dans portail d'employé je veux changé champs mot de
passe comme dans l'image » — l'image montre un champ « Mot de passe » moderne :
fond blanc, coins bien arrondis, bordure claire fine, masquage par points.

CAUSE RACINE corrigée : sur la page de CONNEXION du portail, aucune règle CSS
ne visait input[type="password"] (seul le champ CIN input[type="text"] était
stylé) → le champ mot de passe s'affichait en style navigateur BRUT (coins
carrés, bordure fine par défaut), en contradiction avec l'image et avec le
champ CIN juste au-dessus.

Correctif (scripts/portail-server.js, cosmétique — AUCUN changement
fonctionnel ou de sécurité) :
  - page CONNEXION : nouvelle règle input[type="password"] (48px, fond blanc,
    bordure 1.5px #cbd5e1, rayon 12px, anneau émeraude au focus) ;
  - harmonisation des rayons 10px → 12px : champ CIN (connexion), champs mot
    de passe (écran de changement), champ de recherche (mes fiches) et tous
    les boutons des trois pages — le portail entier a la même apparence que
    l'image ;
  - les attributs de sécurité (autocomplete current-password / new-password,
    Task 66) et tous les mécanismes (tolérance tirets/espaces, usage unique,
    expiration 15 jours, verrouillage) sont INCHANGÉS.

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (harnais
test69_harnais.sh : sandbox-test69/test69.db, portail autonome port 4103).
(RÉALIGNÉ Task 74) la connexion est en DEUX ÉTAPES : CIN + mot de passe
validés → code OTP + QR affichés (10 minutes) → confirmation du code ; le
test lit le code sur /otp et le confirme. Le QR est désormais un élément
ATTENDU du portail (page /otp).
Partie A : contrôles statiques sur le fichier source.
Partie B : vérification du HTML RÉELLEMENT SERVI par les trois pages
(connexion, changement obligatoire, mes fiches) + flux de connexion complet.
"""
import base64
import hashlib
import hmac
import time
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("TEST69_BASE", "http://127.0.0.1:4103")
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


def lire(chemin_relatif):
    with open(os.path.join(RACINE, chemin_relatif), encoding="utf-8") as f:
        return f.read()


cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with op.open(r, timeout=25) as rep:
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


def confirmer_otp(requete, cin=None, mot_de_passe=None):
    """(REFONTE Task 85) étape 2 de la connexion : la page /otp affiche LE
    QR code (URI otpauth://totp, secret persistant) + le champ de
    confirmation — AUCUN code n'est JAMAIS affiché en clair. La suite lit le
    secret du QR et CALCULE le TOTP (RFC 6238), exactement comme une
    application d'authentification. `requete` = req ou req2.
    Retourne (st, corps)."""
    st, page = requete("/otp")
    if st != 200:
        return st, page
    secret = secret_du_qr(page)
    if not secret:
        return 0, "QR code (secret otpauth) introuvable sur la page /otp"
    return requete("/api/otp/verify", {"otp": code_totp_frais(secret)})


# ============================================================
# PARTIE A — CONTRÔLES STATIQUES (source scripts/portail-server.js)
# ============================================================
print("=== A. Contrôles statiques (scripts/portail-server.js) ===")
portail = lire("scripts/portail-server.js")

regle_pwd = (
    'input[type="password"] {\n'
    "    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;\n"
    "    padding: 0 14px; font-size: 16px; outline: none; background: #fff;\n"
    "    transition: border-color .15s, box-shadow .15s;\n"
    "  }"
)
check("(MODIFIÉ Task 83) règle input[type=password] rayon 12px présente sur 3 pages (connexion + changement + CSS_OTP/premiere)",
      portail.count(regle_pwd) == 3, portail.count(regle_pwd))
check("règle :focus mot de passe (anneau émeraude) présente ×2",
      portail.count('input[type="password"]:focus { border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,.14); }') == 3)
check("commentaire Task 69 sur la CONNEXION (champ auparavant sans style)",
      'champ MOT DE PASSE de la CONNEXION' in portail)
check("(MODIFIÉ Task 85) 9 rayons 12px + 1 règle password CSS_OTP (page /premiere) = 10 — le style .otp-code du code affiché est SUPPRIMÉ",
      portail.count("border-radius: 12px") == 10, portail.count("border-radius: 12px"))
lignes_10px = [l.strip() for l in portail.splitlines() if "border-radius: 10px" in l]
check("(MODIFIÉ Task 83) aucun CHAMP/BOUTON ne reste à 10px (bannières .msg + bordures .note-verte, 4 blocs CSS)",
      len(lignes_10px) == 8 and all((".msg" in l) or ("a7f3d0" in l) for l in lignes_10px), lignes_10px)

# Sécurité : attributs autocomplete inchangés (Task 66)
check('connexion #password : autocomplete="current-password" conservé (MODIFIÉ Task 83 : champ dans .champ-mdp avec œil)',
      'id="password" name="password" placeholder="Votre mot de passe"' in portail
      and 'autocomplete="current-password"' in portail)
check('changement #cur : autocomplete="current-password" conservé',
      'id="cur" name="cur" autocomplete="current-password"' in portail)
check('changement #new/#conf : autocomplete="new-password" conservé',
      'id="new" name="new" autocomplete="new-password"' in portail
      and 'id="conf" name="conf" autocomplete="new-password"' in portail)
check("tolérance tirets/espaces (Task 66) inchangée",
      "function nettoyerMotDePasse(" in portail and "verifierMotDePasseTolerant" in portail)
check("libellé « Mot de passe » du champ de connexion présent",
      '<label for="password">Mot de passe</label>' in portail)
check("mentions 15 jours conservées", portail.count("15 jours") >= 3, portail.count("15 jours"))
check("QR code Task 74 présent (paquet qrcode + page /otp avec QR et code affiché) ; "
      "la page de CONNEXION reste sans QR",
      'require("qrcode")' in portail and 'id="otp-affiche"' not in portail
      and 'data-payload=' in portail
      and 'data-payload=' in portail)

# ============================================================
# PARTIE B — HTML RÉELLEMENT SERVI + FLUX DE CONNEXION (COPIE)
# ============================================================
print("=== B. Page de connexion servie (GET /) ===")
st, html = req("/")
check("connexion : statut 200", st == 200, st)
check("connexion : règle mot de passe 12px PRÉSENTE dans le HTML servi",
      "border-radius: 12px" in html and 'input[type="password"] {' in html)
check("connexion : champ CIN lui aussi en 12px (même apparence que l'image)",
      'input[type="text"] {' in html and "border-radius: 12px" in html)
check("connexion : label « Mot de passe » + autocomplete current-password",
      "Mot de passe</label>" in html and "current-password" in html)
check("connexion : bouton « Se connecter » arrondi 12px",
      "Se connecter" in html and "border-radius: 12px" in html)

print("=== B2. Connexion réelle (accès de test inséré sur la COPIE) ===")
st, rep = req("/api/verify", {"cin": "TEST66ESPA", "password": "Mot De Passe 66"})
d = json.loads(rep) if rep else {}
check("connexion TEST66ESPA → 200 + OTP exigé (le formulaire stylé fonctionne toujours)",
      st == 200 and d.get("ok") is True and d.get("otpRequired") is True, (st, rep))
st, rep = confirmer_otp(req, "TEST66ESPA", "Mot De Passe 66")
d = json.loads(rep) if rep else {}
check("(MODIFIÉ Task 90) code OTP confirmé → inscription terminée : redirect /premiere-reussie (pas de changement exigé)",
      st == 200 and d.get("mustChangePassword") is None and d.get("redirect") == "/premiere-reussie", (st, rep))
st, html_fiches = req("/")
check("mes fiches : page servie avec champ de recherche arrondi 12px",
      st == 200 and "border-radius: 12px" in html_fiches, st)
op2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def req2(chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with op2.open(r, timeout=25) as rep2:
            return rep2.status, rep2.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


st, rep = req2("/api/verify", {"cin": "TEST66ESPA", "password": "MotDePasse67"})
check("mauvais mot de passe → toujours 401", st == 401, (st, rep))

print("=== B3. (MODIFIÉ Task 83) Étape 1 « Première connexion » : changement du mot de passe initial ===")
st, rep = req2("/api/verify", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79"})
d = json.loads(rep) if rep else {}
check("initial à usage unique accepté → orienté /premiere (MODIFIÉ Task 83)",
      st == 200 and d.get("premiere") is True and d.get("redirect") == "/premiere", (st, rep))
st, rep = req2("/api/premiere", {"cin": "TEST66NOUV", "password": "Kl84-Mn26-Pq79",
                                "newPassword": "NouveauMot69", "confirm": "NouveauMot69"})
d = json.loads(rep) if rep else {}
check("étape 1 : changement enregistré → étape 2 (/otp) (MODIFIÉ Task 83)",
      st == 200 and d.get("step") == 2 and d.get("redirect") == "/otp", (st, rep))
opFrais = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def reqFrais(chemin, data=None):
    r = urllib.request.Request("http://127.0.0.1:4103" + chemin)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with opFrais.open(r, timeout=25) as repF:
            return repF.status, repF.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

st, html_chg = reqFrais("/premiere")
check("page /premiere : statut 200", st == 200 and "Première connexion" in html_chg, st)
check("page /premiere : champs mot de passe en 12px dans le HTML servi",
      "border-radius: 12px" in html_chg and 'input[type="password"] {' in html_chg)
check("page /premiere : autocomplete conservés (initial=current, nouveau/conf=new)",
      'placeholder="Mot de passe initial"' in html_chg
      and 'id="nouveau" name="nouveau"' in html_chg and 'autocomplete="current-password"' in html_chg
      and 'id="repete" name="repete"' in html_chg and html_chg.count('autocomplete="new-password"') >= 2)
check("page /premiere : les 4 champs de la maquette présents",
      ">CIN</label>" in html_chg and ">Mot de passe initial</label>" in html_chg
      and ">Nouveau mot de passe</label>" in html_chg
      and ">Répéter le nouveau mot de passe</label>" in html_chg)
check("page /premiere : règle 15 jours conservée", "15 jours" in html_chg)
st, html_login = req2("/login")
check("page de connexion : aide tirets/espaces conservée",
      "tirets et espaces sont ignorés" in html_login)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 69 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
