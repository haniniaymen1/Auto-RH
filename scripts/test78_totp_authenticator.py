#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 78 (19/09/2026) : PORTAIL EMPLOYÉS — QR code au FORMAT STANDARD
« otpauth://totp/… » lisible par les APPLICATIONS D'AUTHENTIFICATION.

RETOUR UTILISATEUR (Task 78) : « application authenticator cannot interpret
qr code » — l'ancien QR encodait un JSON maison {app: "SERVICE RH", objet:
"otp-connexion", code, expire} qu'AUCUNE application (Google Authenticator,
Microsoft Authenticator, Authy, FreeOTP…) ne savait interpréter.

NOUVELLE IMPLÉMENTATION :
  - secret TOTP PERSISTANT par employé (PortalAccess.totpSecret — colonne
    historique Task 18 réutilisée ; généré UNE FOIS à la première validation
    CIN + mot de passe, 20 octets aléatoires = 32 caractères Base32) ;
  - le QR de la PREMIÈRE connexion encode l'URI STANDARD (spec « Key URI
    Format ») : otpauth://totp/Auto-RH%3A<CIN>?secret=<B32>&issuer=Auto-RH
    &algorithm=SHA1&digits=6&period=30 — l'application ajoute le compte et
    génère les codes OTP (période 30 s) ;
  - /api/otp/verify accepte le CODE AFFICHÉ à l'écran (inchangé) ET les codes
    TOTP de l'application (tolérance ±1 fenêtre, anti-rejeu lastUsedWindow) ;
  - TOUT le reste est INCHANGÉ : QR seulement à la première connexion
    (verrou lastLoginAt), défi 10 minutes, usage unique, 5 tentatives,
    changement de mot de passe après l'OTP, régénération recalculée en base.

PREUVE CENTRALE (section B) : la suite simule EXACTEMENT une application
d'authentification — elle lit le secret DANS le QR (data-payload), calcule le
code TOTP en Python pur (RFC 6238, HMAC-SHA1) et le soumet au portail, qui
l'accepte : c'est le comportement d'un vrai téléphone. L'algorithme Python est
au préalable validé contre les VECTEURS OFFICIELS RFC 6238 (SHA1).

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base.
Portails de test : 4215 (TTL normal 10 minutes) + 4216 (PORTAL_OTP_TTL_MS
= 3500 ms — preuve que l'expiration du défi d'inscription reste active).
Accès de test : jeu Task 66 (TEST66ESPA) + accès jetables Task 74
(TEST74EXPIRE / TEST74ANNULE via scripts/test74_inserer.js).
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "/home/z/my-project"
RACINE = BASE
P1 = "http://127.0.0.1:4215"  # TTL normal (10 minutes)
P2 = "http://127.0.0.1:4216"  # TTL réduit (3,5 s)
DB_COPIE = BASE + "/sandbox-test78/test78.db"

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


def secret_du_qr(page_otp):
    """(NOUVEAU Task 85) secret Base32 de l'URI otpauth du QR de la page."""
    pl = extraire_payload(page_otp)
    if not pl:
        return None
    m = re.search(r"secret=([A-Z2-7]+)", pl)
    return m.group(1) if m else None


def qr_present(page):
    """VRAI si la page /otp affiche le BLOC QR (MODIFIÉ Task 80 : la page
    d'inscription « UNIQUEMENT le QR » porte class="otp-qr otp-qr-seul")."""
    return bool(page) and 'class="otp-qr' in page and 'data-payload="' in page


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
    return totp_authentifiant(secret_b32, fenetre=w)


def totp_authentifiant(secret_b32, fenetre=None, period=30, digits=6):
    """Code TOTP calculé comme le fait une application d'authentification
    (RFC 6238 : HMAC-SHA1 sur le compteur, troncature dynamique, 6 chiffres)."""
    if fenetre is None:
        fenetre = int(time.time()) // period
    pad = "=" * ((8 - len(secret_b32) % 8) % 8)
    cle = base64.b32decode(secret_b32 + pad, casefold=True)
    msg = struct.pack(">Q", fenetre)
    h = hmac.new(cle, msg, hashlib.sha1).digest()
    off = h[-1] & 0xF
    code = ((h[off] & 0x7F) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
    return str(code % 10 ** digits).zfill(digits)


def dernier_login(cin):
    """Lit lastLoginAt/totpSecret en base (COPIE) via scripts/test74_inserer.js."""
    env = dict(os.environ)
    r = subprocess.run(
        ["node", "scripts/test74_inserer.js", "lire", cin],
        cwd=RACINE, env=env, capture_output=True, text=True, timeout=30,
    )
    m = re.search(r"LASTLOGIN=(\{.*\})", r.stdout)
    return json.loads(m.group(1)) if m else {"cin": cin, "lastLoginAt": "ERREUR"}


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


def reconnecter(base, cin, mot_de_passe):
    """Reconnexion APRÈS affichage du QR (Task 80) : verify → page de
    confirmation (code affiché + formulaire, SANS QR)."""
    st, rep, sc = req(base, "/api/verify", {"cin": cin, "password": mot_de_passe})
    ck = cookie_de(sc)
    if st != 200 or not ck:
        return st, rep, None, None
    st2, page, _ = req(base, "/otp", cookie=ck)
    return st, rep, ck, page


# =====================================================================
print("=" * 72)
print("0. ALGORITHME TOTP (simulateur d'application) — VECTEURS RFC 6238")
print("=" * 72)
# RFC 6238 / SHA1 : clé « 12345678901234567890 » (Base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
# T=59 s → compteur 1 → 8 chiffres = 94287082 (vecteur officiel).
VEC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
check("vecteur officiel RFC 6238 (SHA1, 8 chiffres, T=59) → 94287082",
      totp_authentifiant(VEC, fenetre=1, digits=8) == "94287082",
      totp_authentifiant(VEC, fenetre=1, digits=8))
check("même vecteur tronqué à 6 chiffres → 287082",
      totp_authentifiant(VEC, fenetre=1, digits=6) == "287082",
      totp_authentifiant(VEC, fenetre=1, digits=6))
check("code à l'instant courant = 6 chiffres numériques",
      re.fullmatch(r"[0-9]{6}", totp_authentifiant(VEC)) is not None)

# =====================================================================
print()
print("=" * 72)
print("A. STATIQUE — portail-server.js (QR otpauth:// + secret persistant)")
print("=" * 72)
portail = open(BASE + "/scripts/portail-server.js", encoding="utf-8").read()
pkg = json.load(open(BASE + "/package.json", encoding="utf-8"))
schema = open(BASE + "/prisma/schema.prisma", encoding="utf-8").read()

check("version du produit = 0.2.23 (NOUVEAU Task 93)", pkg.get("version") == "0.2.23", pkg.get("version"))
check("entête : retour utilisateur Task 78 documenté (QR illisible par les applications)",
      "application authenticator cannot interpret qr code" in portail
      and "otpauth://totp" in portail)
check("encodage Base32 présent (base32Encode, RFC 4648 sans bourrage)",
      "function base32Encode(buf)" in portail and "B32_ALPHABET" in portail)
check("générateur de secret persistant : 20 octets aléatoires → 32 caractères Base32",
      "function genererSecretTotp()" in portail
      and "base32Encode(crypto.randomBytes(20))" in portail)
check("QR = URI STANDARD otpauth://totp/… (label, secret, issuer, SHA1, digits, period — label MODIFIÉ Task 88)",
      '"otpauth://totp/"' in portail
      and 'encodeURIComponent("Auto-RH:Fiche de paie")' in portail
      and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail)
check("ANCIEN payload JSON {app SERVICE RH, otp-connexion} ABSENT du portail",
      'app: "SERVICE RH"' not in portail and 'objet: "otp-connexion"' not in portail
      and "Math.floor(defi.expireAt / 1000)" not in portail)
check("(MODIFIÉ Task 86) le défi porte le CIN, le secret TOTP et la fenêtre ALIGNÉE (creerDefiOtp à 5 arguments)",
      "function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs)" in portail
      and "cin," in portail and 'totpSecret: String(totpSecret || "")' in portail)
check("(MODIFIÉ Task 86) appel /api/verify : le défi est créé avec le secret de fenêtre ALIGNÉ",
      "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail)
check("(MODIFIÉ Task 86) secret de FENÊTRE dans /api/verify (réutilisé vivant, régénéré sinon, CHIFFRÉ en base)",
      "const fenetre = await obtenirSecretFenetre(acc);" in portail
      and "otpFenetreCreeA: new Date()" in portail
      and "cryptoBd.chiffrerChamp(secret, false)" in portail)
check("(SUPPRIMÉ Task 85) plus d'endpoint /api/otp/nouveau (la garantie de secret persistant vit dans /api/verify et GET /otp)",
      '"/api/otp/nouveau"' not in portail)
check("colonne PortalAccess.totpSecret existe (schéma Prisma)",
      re.search(r"model PortalAccess \{[\s\S]*?totpSecret\s+String\?", schema) is not None)
check("colonne PortalAccess.lastUsedWindow existe (anti-rejeu TOTP)",
      re.search(r"model PortalAccess \{[\s\S]*?lastUsedWindow\s+Int\?", schema) is not None)
check("(MODIFIÉ Task 85) /api/otp/verify : TOTP SEUL accepté (voie « code écran » SUPPRIMÉE — secret déchiffré avant vérification)",
      "let codeCorrect = false;" in portail
      and "code === defi.code" not in portail
      and "let fenetreTotp = null;" in portail
      and "cryptoBd.dechiffrerChamp(accTotp.totpSecret)" in portail)
check("anti-rejeu : la fenêtre TOTP consommée est enregistrée à la réussite",
      "lastUsedWindow: fenetreTotp" in portail)
check("primitives RFC 6238 intactes (totpAt + verifyTotp ±1 fenêtre)",
      "function totpAt(secretBuf, counter)" in portail
      and "function verifyTotp(secretB32, code, lastUsedWindow)" in portail
      and "for (const w of [now, now - 1, now + 1])" in portail)
check("otpHtml(defi, svgQr) : payload construit DEPUIS le défi (secret + CIN)",
      "function otpHtml(defi, svgQr)" in portail
      and "const payload = contenuQrOtp(defi);" in portail)
check("(MODIFIÉ Task 85) QR d'INSCRIPTION seulement à la première connexion (verrous lastLoginAt + qrPresente) — la fenêtre de confirmation porte AUSSI le QR (secret persistant, tous les modes)",
      "if (defi.premiere)" in portail
      and "await svgQrOtp(defi)" in portail
      and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail)
check("(MODIFIÉ Task 83 — maquette) page d'inscription « Configuration OTP » (QR + champ Code OTP) : otpPremiereHtml + pose du verrou + refus Task 80 SUPPRIMÉ",
      "function otpPremiereHtml(defi, svgQr)" in portail
      and "data: { qrPresente: true }" in portail
      and 'code: "OTP_QR_A_SCANNER"' not in portail)
check("consignes /otp : APPLICATION D'AUTHENTIFICATION (Google/Microsoft/Authy/FreeOTP) — page d'inscription (MODIFIÉ Task 83 : le champ Code OTP est DANS la fenêtre) et page de confirmation",
      "APPLICATION D'AUTHENTIFICATION" in portail
      and "Google Authenticator" in portail and "FreeOTP" in portail
      and "Scannez le QR code avec votre application" in portail
      and "PAS avec l'appareil photo" in portail)
check("ancienne mention « il contient le même code » ABSENTE (le QR n'encode plus le code)",
      "il contient le même code" not in portail)
check("invariants Task 74/76 conservés (TTL 10 min, usage unique, 5 tentatives — MODIFIÉ Task 85 : plus de régénération en base)",
      "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
      and "otpDefis.delete(sess.cin)" in portail
      and '"/api/otp/nouveau"' not in portail)
check("invariants Task 64 conservés (scrypt, tolérance, 15 jours, pending)",
      "verifierMotDePasseTolerant" in portail and "PASSWORD_MAX_AGE_DAYS = 15" in portail
      and "estMotDePasseExpire" in portail)
check("garde OTP_REQUIS maintenu sur my-fiches + search + fichier PDF + change-password",
      portail.count('code: "OTP_REQUIS"') == 4, portail.count('code: "OTP_REQUIS"'))

# =====================================================================
print()
print("=" * 72)
print("B. PORTAIL 4215 (TTL NORMAL) — LE TÉLÉPHONE SIMULÉ SCANNE ET VALIDE")
print("=" * 72)

# B0 — état initial : accès vierges
et = dernier_login("TEST66ESPA")
check("état initial : TEST66ESPA sans lastLoginAt (première connexion due)",
      et.get("lastLoginAt") is None, et)

# B1 — PREMIÈRE connexion ESPA → page « UNIQUEMENT le QR code » (Task 80)
# Parcours manuel (le helper reconnecte déjà en interne — ici on conserve la
# session de la PAGE QR pour prouver le refus 403 Task 80) :
st, rep, sc = req(P1, "/api/verify", {"cin": "TEST66ESPA", "password": "Mot De Passe 66"})
ck_qr = cookie_de(sc)
d1 = json.loads(rep) if st == 200 else {}
check("1re connexion ESPA → 200 + otpRequired + premiereConnexion:true + redirect /otp",
      st == 200 and d1.get("ok") is True and d1.get("otpRequired") is True
      and d1.get("premiereConnexion") is True and d1.get("redirect") == "/otp",
      (st, rep[:150]))
st, page_qr1, _ = req(P1, "/otp", cookie=ck_qr)
check("(MODIFIÉ Task 83) page /otp de 1re connexion = « Configuration OTP » : bloc QR + champ Code OTP — AUCUN code affiché",
      qr_present(page_qr1) and 'id="otp-affiche"' not in page_qr1
      and "Configuration OTP" in page_qr1 and 'id="otp-saisie"' in page_qr1,
      bool(page_qr1))
uri1 = extraire_payload(page_qr1) if page_qr1 else None
check("QR data-payload = URI STANDARD otpauth://totp/… (RÉALIGNÉ Task 78)",
      bool(uri1) and uri1.startswith("otpauth://totp/"), uri1)
qs = urllib.parse.parse_qs(urllib.parse.urlsplit(uri1 or "").query) if uri1 else {}
secret1 = (qs.get("secret") or [""])[0]
check("URI : label décodé = Auto-RH:Fiche de paie (spec Key URI Format, MODIFIÉ Task 88 — Account Name SANS le CIN)",
      bool(uri1) and urllib.parse.unquote(urllib.parse.urlsplit(uri1).path) == "/Auto-RH:Fiche de paie",
      urllib.parse.urlsplit(uri1 or "").path)
check("URI : l'ANCIEN label avec le CIN (Auto-RH:TEST66ESPA) n'existe PLUS (MODIFIÉ Task 88)",
      bool(uri1) and "TEST66ESPA" not in urllib.parse.unquote(urllib.parse.urlsplit(uri1).path),
      urllib.parse.urlsplit(uri1 or "").path)
check("URI : paramètres standard (issuer=Auto-RH, SHA1, 6 chiffres, période 30 s)",
      qs.get("issuer") == ["Auto-RH"] and qs.get("algorithm") == ["SHA1"]
      and qs.get("digits") == ["6"] and qs.get("period") == ["30"], qs)
check("secret du QR = Base32 STRICT (32 caractères A-Z2-7)",
      re.fullmatch(r"[A-Z2-7]{32}", secret1) is not None, secret1)
check("le QR N'ENCODE PLUS le code affiché (aucun paramètre « code » dans l'URI)",
      "code" not in qs and "code=" not in (uri1 or ""), (uri1, secret1))

# B2 — (MODIFIÉ Task 83) LE TÉLÉPHONE SIMULÉ : la fenêtre d'inscription porte
# DÉSORMAIS le champ « Code OTP » → le code de l'application est validé
# DIRECTEMENT dans cette fenêtre (plus de refus Task 80, plus de reconnexion).
code_app = totp_authentifiant(secret1)
st, rep, sc2 = req(P1, "/api/otp/verify", {"otp": code_app}, cookie=ck_qr)
d2 = json.loads(rep) if st == 200 else {}
ck2 = cookie_de(sc2)
check("(MODIFIÉ Task 90) code TOTP de l'application validé DANS la fenêtre d'inscription → 200 ok + inscription terminée (redirect /premiere-reussie)",
      st == 200 and d2.get("ok") is True and d2.get("redirect") == "/premiere-reussie", (st, rep[:180], code_app))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck2)
check("session ouverte par l'application : les fiches sont accessibles",
      st == 200, st)
et = dernier_login("TEST66ESPA")
check("première connexion SCELLÉE par le code de l'application (lastLoginAt posé)",
      et.get("lastLoginAt") not in (None, "ERREUR"), et)
# (MODIFIÉ Task 85) le code_app de B2 a consommé la fenêtre TOTP courante :
# on l'enregistre dans le traqueur de la suite pour que code_totp_frais
# parte de la fenêtre SUIVANTE (anti-rejeu lastUsedWindow).
_fenetre_totp["derniere"] = int(time.time()) // 30

# B3 — ANTI-REJEU : le MÊME code TOTP ne peut pas servir deux fois
st, rep, ck3, secret3, page3, _ = connexion_otp(P1, "TEST66ESPA", "Mot De Passe 66")
d3 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion ESPA → nouveau défi (otpRequired, fenêtre AVEC QR — 2e connexion)",
      st == 200 and d3.get("otpRequired") is True and qr_present(page3)
      and secret3 == secret1, (st, bool(secret3)))
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_app}, cookie=ck3)
rep3 = json.loads(rep) if st else {}
check("MÊME code rejoué → REFUSÉ (anti-rejeu lastUsedWindow / hors fenêtre)",
      st == 401, (st, rep3.get("error", "")[:150]))
st, rep, sc4 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret3)}, cookie=ck3)
d4 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) un NOUVEAU TOTP de l'application est accepté (plus de voie « code écran »)",
      st == 200 and d4.get("ok") is True, (st, rep[:150]))

# B4 — PERSISTANCE du secret : le code d'application marche AUX CONNEXIONS SUIVANTES
st, rep, ck5, secret5, page5, _ = connexion_otp(P1, "TEST66ESPA", "Mot De Passe 66")
d5 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) 3e connexion ESPA → otpRequired + premiereConnexion:false + fenêtre AVEC QR (même secret)",
      st == 200 and d5.get("otpRequired") is True and d5.get("premiereConnexion") is False
      and qr_present(page5), (st, d5.get("premiereConnexion")))
# MÊME secret que B1 (persistant en base) — le code de B2 est consommé
# (anti-rejeu B3) ; une vraie application affiche un code frais à chaque
# rotation de 30 s — la suite utilise une fenêtre non consommée.
check("QR de la 3e connexion = le MÊME secret persistant (lu en B1)",
      secret5 == secret1, (secret1, secret5))
st, rep, sc6 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret5)}, cookie=ck5)
d6 = json.loads(rep) if st == 200 else {}
check("code TOTP calculé depuis le MÊME secret (B1) → accepté : secret PERSISTANT",
      st == 200 and d6.get("ok") is True, (st, rep[:150]))

# B5 — mauvais code TOTP (fenêtre très éloignée) refusé puis TOTP valide OK
st, rep, ck7, secret7, page7, _ = connexion_otp(P1, "TEST74EXPIRE", "Expire74x")
uri7 = extraire_payload(page7) if page7 else None
qs7 = urllib.parse.parse_qs(urllib.parse.urlsplit(uri7 or "").query) if uri7 else {}
secret7 = (qs7.get("secret") or [""])[0]
check("1re connexion TEST74EXPIRE → QR otpauth avec SON PROPRE secret (unique par employé)",
      st == 200 and bool(secret7) and secret7 != secret1, (st, bool(secret7)))
code_lointain = totp_authentifiant(secret7, fenetre=int(time.time()) // 30 - 7)
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_lointain}, cookie=ck7)
check("code TOTP d'une fenêtre éloignée (−7 périodes) → REFUSÉ",
      st == 401, (st, rep[:150]))
st, rep, sc8 = req(P1, "/api/otp/verify", {"otp": totp_authentifiant(secret7)}, cookie=ck7)
d8 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) puis le TOTP courant de l'application → accepté (défi toujours actif après 1 erreur — aucune fenêtre consommée pour ce compte)",
      st == 200 and d8.get("ok") is True, (st, rep[:150]))

# B6 — annulation après 5 mauvais codes (invariant Task 74 inchangé)
st, rep, ck9, secret9, page9, _ = connexion_otp(P1, "TEST74ANNULE", "Annule74x")
check("(MODIFIÉ Task 85) 1re connexion TEST74ANNULE → fenêtre QR (« Configuration OTP », première connexion toujours due)",
      st == 200 and qr_present(page9) and "Configuration OTP" in (page9 or ""), st)
check("(MODIFIÉ Task 85) la fenêtre d'inscription porte le QR + le champ de confirmation, AUCUN code",
      qr_present(page9) and 'id="otp-affiche"' not in (page9 or ""), st)
st_refus = None
for mauvais in ["000000", "111111", "222222", "333333", "444444"]:
    st_refus, rep, _ = req(P1, "/api/otp/verify", {"otp": mauvais}, cookie=ck9)
    if st_refus == 401 and "annulée" in rep:
        break
check("5 mauvais codes → vérification ANNULÉE (401 OTP_ANNULE)",
      st_refus == 401 and "OTP_ANNULE" in rep, (st_refus, rep[:120]))
st, rep, _, page_re = reconnecter(P1, "TEST74ANNULE", "Annule74x")
d_re = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) après annulation : reconnexion → fenêtre de confirmation AVEC QR (secret persistant), AUCUN code affiché",
      st == 200 and d_re.get("premiereConnexion") is False
      and qr_present(page_re) and 'id="otp-affiche"' not in (page_re or ""),
      (st, d_re.get("premiereConnexion")))

# =====================================================================
print()
print("=" * 72)
print("C. PORTAIL 4216 (TTL 3,5 s) — l'EXPIRATION du QR d'inscription reste active")
print("(" + "accès TEST74ANNULE : l'annulation B6 ne scelle PAS la première connexion)")
print("=" * 72)
st, rep, ckA, secretA, pageA, _ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
dA = json.loads(rep) if st == 200 else {}
check("(TTL réduit, MODIFIÉ Task 85) TEST74ANNULE → fenêtre de confirmation AVEC QR (le QR d'inscription a déjà été affiché en B6)",
      st == 200 and dA.get("otpRequired") is True and qr_present(pageA)
      and 'id="otp-affiche"' not in (pageA or "") and bool(secretA), st)
time.sleep(4.0)
# (MODIFIÉ Task 85) le TOTP de la fenêtre courante est le bon code du défi :
# le refus observé après le sommeil est bien dû à l'EXPIRATION, pas à un
# code faux (aucune fenêtre consommée pour ce compte — codes tous faux).
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_authentifiant(secretA)}, cookie=ckA)
repA = json.loads(rep) if rep.startswith("{") else {}
check("confirmation APRÈS expiration → 410 OTP_EXPIRE (rien n'est scellé)",
      st == 410 and repA.get("code") == "OTP_EXPIRE", (st, repA.get("error", "")[:120]))
et = dernier_login("TEST74ANNULE")
check("l'expiration n'écrit RIEN : lastLoginAt toujours null (première connexion due)",
      et.get("lastLoginAt") is None, et)
st, rep, ckB, secretB, pageB, _ = connexion_otp(P2, "TEST74ANNULE", "Annule74x")
dB = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après expiration → fenêtre de confirmation AVEC QR (secret persistant), AUCUN code affiché",
      st == 200 and dB.get("premiereConnexion") is False and qr_present(pageB)
      and 'id="otp-affiche"' not in (pageB or "") and bool(secretB),
      (st, dB.get("premiereConnexion")))

# =====================================================================
n_ok = sum(1 for r in RESULTATS if r)
n_tot = len(RESULTATS)
print()
print("=" * 72)
print(f"RESULTAT TASK 78 : {n_ok}/{n_tot} contrôles OK")
print("=" * 72)
sys.exit(0 if n_ok == n_tot else 1)
