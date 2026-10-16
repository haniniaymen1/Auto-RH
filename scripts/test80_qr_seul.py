#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 80 (19/09/2026) : PORTAIL EMPLOYÉS + ADMINISTRATION.

DEMANDES UTILISATEUR :
  1. « Dans cette fenêtre, afficher uniquement le QR code. » — la page /otp
     de PREMIÈRE connexion n'affiche PLUS que le QR code (l'ancien contenu —
     code affiché, compte à rebours, formulaire « Confirmez le code OTP »,
     boutons « Valider le code », « Générer un nouveau code », « Se
     déconnecter » — est RETIRÉ de cette fenêtre). Après le scan, l'employé
     se RECONNECTE (CIN + mot de passe) : la page de confirmation du code
     (inchangée) s'ouvre alors. Verrou PERSISTANT PortalAccess.qrPresente :
     le QR ne s'affiche qu'UNE SEULE fois (posé quand la page est servie) —
     même après annulation (5 erreurs) ou expiration du défi. En cohérence,
     /api/otp/verify REFUSE (403 OTP_QR_A_SCANNER) tout code tant que le
     défi est en mode première connexion, SANS consommer de tentative.
  2. « Dans le portail d'administration, ajouter une section dans
     « Accès Portal » dédiée à la gestion des QR codes. » — API
     /api/portal-access enrichie (qrPresente + hasQrSecret en booléens,
     jamais le secret), actions « qr » (afficher le QR — SVG + URI
     otpauth://totp/… standard, secret persistant créé à la volée) et
     « reset-qr » (NOUVEAU secret, qrPresente:false, lastUsedWindow:null).
     Interface : section « Gestion des QR codes » dans l'onglet
     « Accès portail » (statuts, compteurs, filtre, Afficher le QR,
     Réinitialiser le QR).

PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base.
Serveurs de test (harnais test80_harnais.sh) :
  - 4218 : portail employés (TTL normal 10 minutes) ;
  - 4219 : serveur d'administration (Next standalone) ;
  - 4220 : portail employés PORTAL_OTP_TTL_MS=3500 (expiration).
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
P1 = "http://127.0.0.1:4218"   # portail employés — TTL normal
P2 = "http://127.0.0.1:4220"   # portail employés — TTL 3,5 s
PA = "http://127.0.0.1:4219"   # administration
DB_COPIE = BASE + "/sandbox-test80/test80.db"

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
        with OP.open(r, timeout=20) as rep:
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
    """URI otpauth:// encodée dans l'attribut data-payload (Task 78/80)."""
    m = re.search(r'data-payload="([^"]*)"', page_otp)
    return html.unescape(m.group(1)) if m else None


def secret_du_qr(page_otp):
    """(NOUVEAU Task 85) secret Base32 de l'URI otpauth du QR de la page."""
    pl = extraire_payload(page_otp)
    if not pl:
        return None
    m = re.search(r"secret=([A-Z2-7]+)", pl)
    return m.group(1) if m else None


def page_qr_seul(page):
    """(MODIFIÉ Task 83) VRAI si la page /otp est la page d'inscription
    « Configuration OTP » (QR + champ Code OTP, aucun code affiché)."""
    return bool(page) and 'class="otp-qr' in page and 'data-payload="' in page \
        and "Configuration OTP" in page and 'id="otp-saisie"' in page \
        and 'id="otp-affiche"' not in page


def page_confirmation(page):
    """(MODIFIÉ Task 85) VRAI si la page /otp est la fenêtre de confirmation
    des connexions suivantes : QR (secret persistant) + champ de
    confirmation — AUCUN code affiché (le bloc otp-affiche est SUPPRIMÉ)."""
    return bool(page) and 'id="otp-affiche"' not in page \
        and "Confirmez le code OTP" in page and 'data-payload' in page


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


def dernier_etat(cin):
    """Lit lastLoginAt + qrPresente + aSecret en base (COPIE)."""
    env = dict(os.environ)
    r = subprocess.run(
        ["node", "scripts/test74_inserer.js", "lire", cin],
        cwd=RACINE, env=env, capture_output=True, text=True, timeout=30,
    )
    m = re.search(r"LASTLOGIN=(\{.*\})", r.stdout)
    return json.loads(m.group(1)) if m else {"cin": cin, "lastLoginAt": "ERREUR"}


def lire_secret_brut(cin):
    """SONDE : lit le secret TOTP EN CLAIR + la fenêtre anti-rejeu directement
    dans la COPIE (déchiffrement identique à celui du portail) — diagnostic."""
    env = dict(os.environ)
    r = subprocess.run(
        ["node", "-e", """
const { PrismaClient } = require('@prisma/client');
const cryptoBd = require('./scripts/lib-crypto-bd.js');
const prisma = new PrismaClient({ log: ['error'] });
(async () => {
  const acc = await prisma.portalAccess.findUnique({
    where: { cin: cryptoBd.chiffrerChamp(process.argv[1], true) },
    select: { totpSecret: true, lastUsedWindow: true },
  });
  // (Task 80) le secret est CHIFFRÉ en base (champ « alea ») : déchiffrement
  // identique à celui du portail — les valeurs historiques sans préfixe
  // sont renvoyées telles quelles.
  const clair = acc && acc.totpSecret ? cryptoBd.dechiffrerChamp(acc.totpSecret) : '';
  console.log('SONDE=' + JSON.stringify({ secret: clair,
    fenetre: acc ? (acc.lastUsedWindow ?? null) : 'ABSENT' }));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
""", cin],
        cwd=RACINE, env=env, capture_output=True, text=True, timeout=30,
    )
    m = re.search(r"SONDE=(\{.*\})", r.stdout)
    d = json.loads(m.group(1)) if m else {"secret": "", "fenetre": "ERREUR"}
    return d.get("secret", ""), d.get("fenetre")


def totp_authentifiant(secret_b32, fenetre=None, period=30, digits=6):
    """Code TOTP calculé comme une application d'authentification (RFC 6238)."""
    if fenetre is None:
        fenetre = int(time.time()) // period
    pad = "=" * ((8 - len(secret_b32) % 8) % 8)
    cle = base64.b32decode(secret_b32 + pad, casefold=True)
    msg = struct.pack(">Q", fenetre)
    h = hmac.new(cle, msg, hashlib.sha1).digest()
    off = h[-1] & 0xF
    code = ((h[off] & 0x7F) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
    return str(code % 10 ** digits).zfill(digits)


def premiere_connexion_qr(port, cin, mot_de_passe):
    """Parcours Task 80 de la 1re connexion :
    verify (premiereConnexion:true) → page QR SEUL → (retour : réponse, cookie,
    page QR). La confirmation se fait APRÈS reconnexion (voir reconnecter)."""
    st, rep, sc = req(port, "/api/verify", {"cin": cin, "password": mot_de_passe})
    ck = cookie_de(sc)
    if st != 200 or not ck:
        return st, rep, None, None
    st2, page_qr, _ = req(port, "/otp", cookie=ck)
    return st, rep, ck, page_qr


def fenetre_actuelle():
    return int(time.time() // 30)


def attendre_fenetre_suivante(w):
    """Anti-rejeu : attend une fenêtre TOTP STRICTEMENT postérieure à w."""
    while int(time.time() // 30) <= w:
        time.sleep(1.0)


def reconnecter(port, cin, mot_de_passe):
    """Reconnexion après affichage du QR : verify (premiereConnexion:false)
    → page de CONFIRMATION (code affiché + formulaire, sans QR)."""
    st, rep, sc = req(port, "/api/verify", {"cin": cin, "password": mot_de_passe})
    ck = cookie_de(sc)
    if st != 200 or not ck:
        return st, rep, None, None
    st2, page, _ = req(port, "/otp", cookie=ck)
    return st, rep, ck, page


# =====================================================================
print("=" * 72)
print("A. STATIQUE — portail, schéma, API admin, interface")
print("=" * 72)

portail = open(BASE + "/scripts/portail-server.js", encoding="utf-8").read()
schema = open(BASE + "/prisma/schema.prisma", encoding="utf-8").read()
route_ts = open(BASE + "/src/app/api/portal-access/route.ts", encoding="utf-8").read()
tsx = open(BASE + "/src/components/payslip/portal-access-tab.tsx", encoding="utf-8").read()
pkg = json.load(open(BASE + "/package.json", encoding="utf-8"))

check("version du produit = 0.2.23 (NOUVEAU Task 93)", pkg.get("version") == "0.2.23", pkg.get("version"))
check("entête portail documentée Task 83 (« Configuration OTP » : QR + champ Code OTP — remplace « QR seul »)",
      "PREMIÈRE CONNEXION EN 2" in portail
      and "REMPLACE la page « QR seul » Task 80" in portail)
check("page d'inscription otpPremiereHtml(defi, svgQr) présente (MODIFIÉ Task 83)",
      "function otpPremiereHtml(defi, svgQr)" in portail)

# Extraction du CORPS de otpPremiereHtml (entre sa définition et otpExpireHtml)
i0 = portail.index("function otpPremiereHtml")
i1 = portail.index("function otpExpireHtml", i0)
corps_qr = portail[i0:i1]
check("page « Configuration OTP » : bloc QR (otp-qr + data-payload) présent",
      'class="otp-qr otp-premiere"' in corps_qr and 'data-payload="' in corps_qr)
check("page « Configuration OTP » : AUCUN code affiché (otp-affiche absent)",
      'id="otp-affiche"' not in corps_qr)
check("page « Configuration OTP » : CHAMP « Code OTP » + bouton « Valider » (maquette carte 2 — MODIFIÉ Task 83)",
      '<label for="otp-saisie">Code OTP</label>' in corps_qr and 'id="btn-otp"' in corps_qr
      and "Confirmez le code OTP" not in corps_qr and "Valider le code" not in corps_qr)
check("page « Configuration OTP » : mention d'expiration (10 minutes) présente",
      "Le QR code expire dans" in corps_qr)
check("page « Configuration OTP » : AUCUN bouton secondaire (Générer un nouveau code / Se déconnecter)",
      "Générer un nouveau code" not in corps_qr and "Se déconnecter" not in corps_qr)
check("page « Configuration OTP » : AUCUN compte à rebours affiché (otp-compte absent)",
      'otp-compte' not in corps_qr and 'id="compte"' not in corps_qr)
check("page « Configuration OTP » : bascule automatique vers la page expirée à la fin du défi",
      "location.replace" in corps_qr and "expireMs" in corps_qr)

check("verrou d'affichage : premiereConnexion = !acc.lastLoginAt && !acc.qrPresente",
      "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail)
check("verrou posé quand la page QR est servie (update qrPresente:true)",
      "data: { qrPresente: true }" in portail)
check("(SUPPRIMÉ Task 85) plus d'endpoint /api/otp/nouveau — le verrou d'affichage vit dans GET /otp et /api/verify",
      '"/api/otp/nouveau"' not in portail)
check("(MODIFIÉ Task 83) refus Task 80 OTP_QR_A_SCANNER SUPPRIMÉ (le code est accepté DANS la fenêtre d'inscription)",
      'code: "OTP_QR_A_SCANNER"' not in portail
      and "defi.premiere" in portail)
check("(MODIFIÉ Task 85) fenêtre de CONFIRMATION des connexions suivantes : QR + formulaire + « Se déconnecter », AUCUN code affiché",
      'id="otp-affiche"' not in portail and "Confirmez le code OTP" in portail
      and 'id="btn-nouveau"' not in portail and "Se déconnecter" in portail)

check("schéma Prisma : champ qrPresente (Boolean @default(false))",
      "qrPresente     Boolean   @default(false)" in schema)
check("API admin : action « qr » (SVG + URI otpauth, secret créé à la volée)",
      'action === "qr"' in route_ts and "otpauth://totp/" in route_ts
      and "genererSecretTotp" in route_ts)
check("(MODIFIÉ Task 86) API admin : action « reset-qr » (nouveau secret + qrPresente:false + lastUsedWindow:null + fenêtre selon l'état)",
      'action === "reset-qr"' in route_ts
      and "totpSecret: nouveauSecret," in route_ts
      and "qrPresente: false," in route_ts
      and "lastUsedWindow: null," in route_ts
      and "otpFenetreCreeA: row.lastLoginAt ? null : new Date()" in route_ts)
check("API admin : liste enrichie en booléens SEULEMENT (jamais le secret)",
      "hasQrSecret: Boolean(r.totpSecret)" in route_ts
      and "qrPresente: r.qrPresente" in route_ts
      and "totpSecret: row.totpSecret" not in route_ts)
check("URI standard identique au portail (issuer=Auto-RH, SHA1, 6 chiffres, 30 s)",
      "&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30" in route_ts)
check("interface : section « Gestion des QR codes » dans l'onglet Accès portail",
      "Gestion des QR codes" in tsx and "Afficher le QR" in tsx
      and "Réinitialiser le QR" in tsx)
check("interface : actions branchées sur les NOUVELLES actions API",
      'action: "qr"' in tsx and 'action: "reset-qr"' in tsx)
check("interface : statuts QR (non généré / jamais affiché / code en attente / actif)",
      '"QR non généré"' in tsx and '"QR jamais affiché"' in tsx
      and "code en attente" in tsx and '"Actif"' in tsx)

# =====================================================================
print()
print("=" * 72)
print("B. PORTAIL 4218 (TTL NORMAL) — première connexion = UNIQUEMENT le QR code")
print("=" * 72)

et = dernier_etat("TEST74EXPIRE")
check("état initial : TEST74EXPIRE vierge (lastLoginAt null, QR jamais affiché)",
      et.get("lastLoginAt") is None and et.get("qrPresente") is False, et)

# B1 — 1re validation CIN + mot de passe → page « UNIQUEMENT le QR code »
st, rep, ck1, page_qr = premiere_connexion_qr(P1, "TEST74EXPIRE", "Expire74x")
d1 = json.loads(rep) if st == 200 else {}
check("1re validation ESPA-like → 200 + otpRequired + premiereConnexion:true",
      st == 200 and d1.get("ok") is True and d1.get("otpRequired") is True
      and d1.get("premiereConnexion") is True, (st, d1))
check("page /otp = « Configuration OTP » (maquette carte 2 : QR + champ Code OTP)",
      page_qr_seul(page_qr), (st, len(page_qr or "")))
check("page /otp : code affiché ABSENT, compte à rebours ABSENT, boutons secondaires ABSENTS",
      bool(page_qr) and 'id="otp-affiche"' not in page_qr
      and "Confirmez le code OTP" not in page_qr and "Valider le code" not in page_qr
      and "Générer un nouveau code" not in page_qr and "Se déconnecter" not in page_qr
      and 'id="compte"' not in page_qr)
uri1 = extraire_payload(page_qr) if page_qr else None
qs1 = urllib.parse.parse_qs(urllib.parse.urlsplit(uri1 or "").query) if uri1 else {}
secret1 = (qs1.get("secret") or [""])[0]
check("QR : URI STANDARD otpauth://totp/Auto-RH:Fiche de paie (label décodé, MODIFIÉ Task 88)",
      (uri1 or "").startswith("otpauth://totp/")
      and urllib.parse.unquote(urllib.parse.urlsplit(uri1 or "").path) == "/Auto-RH:Fiche de paie",
      uri1)
check("QR : l'ANCIEN label avec le CIN (Auto-RH:TEST74EXPIRE) n'existe PLUS (MODIFIÉ Task 88)",
      bool(uri1) and "TEST74EXPIRE" not in urllib.parse.unquote(urllib.parse.urlsplit(uri1 or "").path),
      uri1)
check("QR : paramètres standard (issuer=Auto-RH, SHA1, 6 chiffres, période 30 s)",
      qs1.get("issuer") == ["Auto-RH"] and qs1.get("algorithm") == ["SHA1"]
      and qs1.get("digits") == ["6"] and qs1.get("period") == ["30"], qs1)
check("QR : secret Base32 STRICT (32 caractères A-Z2-7)",
      re.fullmatch(r"[A-Z2-7]{32}", secret1) is not None, secret1)

# B2 — le verrou PERSISTANT est posé dès l'affichage
et = dernier_etat("TEST74EXPIRE")
check("verrou qrPresente posé en base dès que la page QR est servie",
      et.get("qrPresente") is True and et.get("lastLoginAt") is None, et)

# B3 — (MODIFIÉ Task 83) la fenêtre d'inscription PORTE le champ « Code OTP » :
# un code quelconque est refusé (401, une tentative est consommée) ; le code
# TOTP de l'application est ACCEPTÉ directement → session ouverte.
st, rep, _ = req(P1, "/api/otp/verify", {"otp": "123456"}, cookie=ck1)
d3 = json.loads(rep) if st else {}
check("(MODIFIÉ Task 83) code quelconque dans la fenêtre d'inscription → 401 « Code OTP incorrect »",
      st == 401 and "Code OTP incorrect" in str(d3.get("error", "")), (st, str(d3.get("error", ""))[:120]))
st, rep, sc3 = req(P1, "/api/otp/verify", {"otp": totp_authentifiant(secret1)}, cookie=ck1)
d3b = json.loads(rep) if st else {}
ck3 = cookie_de(sc3)
check("(MODIFIÉ Task 90) le VRAI code TOTP de l'application → 200 + inscription terminée DEPUIS la fenêtre d'inscription (redirect /premiere-reussie)",
      st == 200 and d3b.get("ok") is True and d3b.get("redirect") == "/premiere-reussie", (st, str(d3b.get("error", ""))[:120]))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck3)
check("(MODIFIÉ Task 83) fiches accessibles (session ouverte par la fenêtre d'inscription)",
      st == 200, st)
et = dernier_etat("TEST74EXPIRE")
check("première connexion SCELLÉE par la validation dans la fenêtre d'inscription (lastLoginAt posé)",
      et.get("lastLoginAt") not in (None, "ERREUR"), et)

# B4 — RECONNEXION (le QR a été affiché) → fenêtre de CONFIRMATION avec QR
#      (MODIFIÉ Task 85 : QR + champ de confirmation, AUCUN code affiché)
st, rep, ck2, page_code = reconnecter(P1, "TEST74EXPIRE", "Expire74x")
d4 = json.loads(rep) if st == 200 else {}
secret4 = secret_du_qr(page_code) if page_code else None
check("reconnexion → 200 + otpRequired + premiereConnexion:false (verrou d'affichage)",
      st == 200 and d4.get("otpRequired") is True and d4.get("premiereConnexion") is False,
      (st, d4))
check("(MODIFIÉ Task 85) fenêtre de confirmation : QR + formulaire + « Se déconnecter », AUCUN code ni « Générer un nouveau code »",
      page_confirmation(page_code) and "Se déconnecter" in (page_code or "")
      and "Générer un nouveau code" not in (page_code or ""), (st, bool(page_code)))
check("(MODIFIÉ Task 85) fenêtre de confirmation porte le MÊME secret persistant que le QR d'inscription (B1)",
      secret4 == secret1, (secret1[:8] if secret1 else None, secret4[:8] if secret4 else None))

# B5 — confirmation (TOTP de l'application) APRÈS reconnexion → scellement
_fenetre_totp["derniere"] = int(time.time()) // 30  # B3 a consommé la fenêtre courante
st, rep, sc5 = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret4)}, cookie=ck2)
d5 = json.loads(rep) if st == 200 else {}
ck5 = cookie_de(sc5)
check("code confirmé APRÈS reconnexion → 200 + session complète ouverte",
      st == 200 and d5.get("ok") is True and d5.get("redirect") == "/", (st, rep[:150]))
st, rep, _ = req(P1, "/api/my-fiches", cookie=ck5)
check("fiches accessibles (session complète)", st == 200, st)
et = dernier_etat("TEST74EXPIRE")
check("première connexion SCELLÉE (lastLoginAt posé par la confirmation)",
      et.get("lastLoginAt") not in (None, "ERREUR"), et)

# B6 — le code de l'APPLICATION (secret du QR scanné) marche aux connexions
# suivantes (fenêtre FRAÎCHE NON CONSOMMÉE : celle de B5 est passée —
# anti-rejeu ; le traqueur code_totp_frais avance d'une fenêtre)
st, rep, ck6, page6 = reconnecter(P1, "TEST74EXPIRE", "Expire74x")
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret1)}, cookie=ck6)
d6 = json.loads(rep) if st == 200 else {}
check("code TOTP de l'application (secret du QR scanné) accepté après reconnexion",
      st == 200 and d6.get("ok") is True, (st, rep[:150]))

# B7 — annulation après 5 erreurs : le QR NE REVIENT PAS (verrou une seule fois)
st, rep, ck7, page_qr7 = premiere_connexion_qr(P1, "TEST74ANNULE", "Annule74x")
check("1re connexion TEST74ANNULE → page « Configuration OTP » (MODIFIÉ Task 83)",
      st == 200 and page_qr_seul(page_qr7), (st, bool(page_qr7)))
st, rep, ck7b, page_code7 = reconnecter(P1, "TEST74ANNULE", "Annule74x")
check("(MODIFIÉ Task 85) reconnexion TEST74ANNULE → fenêtre de confirmation AVEC QR (secret persistant)",
      st == 200 and page_confirmation(page_code7), (st, bool(page_code7)))
st_refus = None
for mauvais in ["000000", "111111", "222222", "333333", "444444"]:
    st_refus, rep, _ = req(P1, "/api/otp/verify", {"otp": mauvais}, cookie=ck7b)
    if st_refus == 401 and "OTP_ANNULE" in rep:
        break
check("5 mauvais codes → vérification ANNULÉE (401 OTP_ANNULE)",
      st_refus == 401 and "OTP_ANNULE" in rep, (st_refus, rep[:120]))
st, rep, _, page_apres = reconnecter(P1, "TEST74ANNULE", "Annule74x")
d_ap = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) après annulation : reconnexion → fenêtre de confirmation AVEC QR (PAS la fenêtre d'inscription — le QR d'inscription ne revient PAS)",
      st == 200 and d_ap.get("premiereConnexion") is False
      and page_confirmation(page_apres) and "Configuration OTP" not in (page_apres or ""),
      (st, d_ap.get("premiereConnexion")))
et = dernier_etat("TEST74ANNULE")
check("l'annulation n'a pas scellé TEST74ANNULE (lastLoginAt null) mais le verrou QR reste posé",
      et.get("lastLoginAt") is None and et.get("qrPresente") is True, et)

# =====================================================================
print()
print("=" * 72)
print("C. PORTAIL 4220 (TTL 3,5 s) — l'expiration NE ré-affiche PAS le QR")
print("=" * 72)
st, rep, ckA, pageA = premiere_connexion_qr(P2, "TEST74EXPIRE", "Expire74x")
check("(TTL court) TEST74EXPIRE déjà scellé (4218) → page de confirmation directe",
      st == 200 and page_confirmation(pageA), (st, bool(pageA)))
st, rep, ckB, pageB = premiere_connexion_qr(P2, "TEST80FRAIS", "Frais80xx")
check("(TTL court) accès INCONNU → refusé (pas d'énumération)", st == 401, st)
# Prouve l'invariant Task 80 avec TEST74ANNULE (annulé, non scellé,
# verrou QR posé en B7) :
st, rep, ckC, pageC = reconnecter(P2, "TEST74ANNULE", "Annule74x")
secretC = secret_du_qr(pageC) if pageC else None
time.sleep(4.0)
# (MODIFIÉ Task 85) TOTP de la fenêtre courante (aucune fenêtre consommée
# pour ce compte) — le défi 3,5 s est de toute façon expiré : 410 attendu.
st, rep, _ = req(P2, "/api/otp/verify", {"otp": totp_authentifiant(secretC)}, cookie=ckC)
repC = json.loads(rep) if st else {}
check("confirmation APRÈS expiration → 410 OTP_EXPIRE (rien n'est scellé)",
      st == 410 and repC.get("code") == "OTP_EXPIRE", (st, repC.get("error", "")[:120]))
et = dernier_etat("TEST74ANNULE")
check("l'expiration n'écrit RIEN : lastLoginAt toujours null",
      et.get("lastLoginAt") is None, et)
st, rep, _, pageD = reconnecter(P2, "TEST74ANNULE", "Annule74x")
dD = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après expiration → fenêtre de confirmation AVEC QR (PAS de ré-affichage de la fenêtre d'inscription)",
      st == 200 and dD.get("premiereConnexion") is False
      and page_confirmation(pageD) and "Configuration OTP" not in (pageD or ""),
      (st, dD.get("premiereConnexion")))


# =====================================================================
print()
print("=" * 72)
print("D. ADMINISTRATION 4219 — section « Gestion des QR codes » (API)")
print("=" * 72)

import http.cookiejar  # noqa: E402  (client admin à jar de cookies)


class ClientAdmin:
    """Client administration : cookies gérés automatiquement (connexion,
    changement de mot de passe, puis appels API)."""

    def __init__(self, base):
        self.base = base
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cj)
        )

    def req(self, chemin, corps=None):
        data = json.dumps(corps).encode("utf-8") if corps is not None else None
        r = urllib.request.Request(self.base + chemin, data=data)
        if data is not None:
            r.add_header("Content-Type", "application/json")
        try:
            with self.op.open(r, timeout=20) as rep:
                return rep.status, rep.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")


admin = ClientAdmin(PA)

st, rep = admin.req("/api/portal-access")
check("API admin sans session → 401 (cookie jar vide avant login)", st == 401, st)

st, rep = admin.req("/api/auth/login", {"email": "test64@autorh.local", "password": "AncienMot64"})
dL = json.loads(rep) if st == 200 else {}
check("login admin de test → 200 (changement obligatoire annoncé)",
      st == 200 and dL.get("mustChangePassword") is True, (st, dL))
st, rep = admin.req("/api/auth/change-password",
                    {"currentPassword": "AncienMot64", "newPassword": "Solide80xx"})
check("changement du mot de passe admin → 200", st == 200, (st, rep[:120]))
st, rep = admin.req("/api/portal-access")
dItems = json.loads(rep) if st == 200 else {}
items = dItems.get("items") or []
check("GET /api/portal-access → 200 + items enrichis", st == 200 and len(items) > 0, (st, len(items)))
par_cin = {it["cin"]: it for it in items}
check("chaque item expose qrPresente + hasQrSecret (booléens Task 80)",
      all("qrPresente" in it and "hasQrSecret" in it for it in items),
      [it.get("cin") for it in items][:4])
check("AUCUN secret exposé (ni totpSecret, ni passwordHash dans la réponse)",
      all("totpSecret" not in it and "passwordHash" not in it for it in items))
it_ex = par_cin.get("TEST74EXPIRE")
check("TEST74EXPIRE : QR affiché + secret présent + actif (après parcours portail B)",
      it_ex is not None and it_ex.get("qrPresente") is True
      and it_ex.get("hasQrSecret") is True and it_ex.get("lastLoginAt") is not None, it_ex)
it_cin = par_cin.get("TEST64CIN")
check("TEST64CIN : secret ABSENT → hasQrSecret:false (statut « QR non généré »)",
      it_cin is not None and it_cin.get("hasQrSecret") is False, it_cin)
it_otp = par_cin.get("TEST64OTP")
check("TEST64OTP : secret présent, jamais affiché → qrPresente:false",
      it_otp is not None and it_otp.get("hasQrSecret") is True
      and it_otp.get("qrPresente") is False, it_otp)

# --- D2 : action « qr » — afficher le QR (création du secret à la volée) ---
st, rep = admin.req("/api/portal-access", {"action": "qr", "id": it_cin["id"]})
dQr = json.loads(rep) if st == 200 else {}
payload_cin = dQr.get("payload") or ""
qsCin = urllib.parse.parse_qs(urllib.parse.urlsplit(payload_cin).query) if payload_cin else {}
check("action « qr » → 200 + SVG + URI otpauth standard (label « Fiche de paie », MODIFIÉ Task 88)",
      st == 200 and dQr.get("svg", "").lstrip().startswith("<svg")
      and payload_cin.startswith("otpauth://totp/Auto-RH%3AFiche%20de%20paie"), (st, payload_cin[:80]))
secret_cin = (qsCin.get("secret") or [""])[0]
check("QR admin : secret Base32 STRICT (32 caractères) + paramètres standard",
      re.fullmatch(r"[A-Z2-7]{32}", secret_cin) is not None
      and qsCin.get("issuer") == ["Auto-RH"] and qsCin.get("period") == ["30"], secret_cin)
st, rep = admin.req("/api/portal-access")
par_cin2 = {it["cin"]: it for it in json.loads(rep).get("items", [])}
check("après « qr » : le secret persistant a été créé à la volée (hasQrSecret:true)",
      par_cin2.get("TEST64CIN", {}).get("hasQrSecret") is True)
st, rep = admin.req("/api/portal-access", {"action": "qr", "id": it_cin["id"]})
dQr2 = json.loads(rep) if st == 200 else {}
check("2e « qr » : MÊME URI (secret PERSISTANT — aucune régénération)",
      st == 200 and dQr2.get("payload") == payload_cin, (st, dQr2.get("payload", "")[:80]))

# --- D3 : action « reset-qr » — nouveau secret pour TEST74EXPIRE ---
st, rep = admin.req("/api/portal-access", {"action": "reset-qr", "id": it_ex["id"]})
dRs = json.loads(rep) if st == 200 else {}
payload_rs = dRs.get("payload") or ""
qsRs = urllib.parse.parse_qs(urllib.parse.urlsplit(payload_rs).query) if payload_rs else {}
secret_rs = (qsRs.get("secret") or [""])[0]
check("action « reset-qr » → 200 + NOUVEAU QR (SVG + URI otpauth, label « Fiche de paie », MODIFIÉ Task 88)",
      st == 200 and dRs.get("svg", "").lstrip().startswith("<svg")
      and payload_rs.startswith("otpauth://totp/Auto-RH%3AFiche%20de%20paie"), (st, payload_rs[:80]))
check("reset-qr : secret DIFFÉRENT de celui du QR affiché au portail (ancien secret invalidé)",
      bool(secret_rs) and secret_rs != secret1, (secret1[:8], secret_rs[:8]))
# SONDE : le secret ÉCRIT en base (lu directement dans la COPIE) doit être
# exactement celui embarqué dans l'URI renvoyée.
secret_bd, _ = lire_secret_brut("TEST74EXPIRE")
check("SONDE : secret en base (lecture directe) = secret du QR reset-qr",
      secret_bd == secret_rs, (secret_bd[:8], secret_rs[:8]))
check("reset-qr : message explicite pour le RH",
      re.search(r"nouveau qr code", (dRs.get("message") or ""), re.IGNORECASE) is not None,
      dRs.get("message"))
et = dernier_etat("TEST74EXPIRE")
check("reset-qr en base : qrPresente repassé à false, lastLoginAt INTACT",
      et.get("qrPresente") is False and et.get("lastLoginAt") not in (None, "ERREUR"), et)
st, rep = admin.req("/api/portal-access")
par_cin3 = {it["cin"]: it for it in json.loads(rep).get("items", [])}
check("liste après reset-qr : qrPresente:false + hasQrSecret:true",
      par_cin3.get("TEST74EXPIRE", {}).get("qrPresente") is False
      and par_cin3.get("TEST74EXPIRE", {}).get("hasQrSecret") is True)

# --- D4 : après reset-qr, la reconnexion portail ouvre la fenêtre de
#     confirmation (MODIFIÉ Task 85 : QR du secret persistant — le re-scan
#     de l'inscription passe par l'affichage admin) ---
st, rep, _, page_rs = reconnecter(P1, "TEST74EXPIRE", "Expire74x")
d_rs = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) reconnexion après reset-qr → fenêtre de confirmation avec QR persistant (PAS la fenêtre d'inscription)",
      st == 200 and d_rs.get("premiereConnexion") is False
      and page_confirmation(page_rs) and "Configuration OTP" not in (page_rs or ""),
      (st, d_rs.get("premiereConnexion")))

# --- D5 : robustesse + sécurité des actions ---
st, rep = admin.req("/api/portal-access", {"action": "reset-qr", "id": "id-inconnu"})
check("reset-qr sur id inconnu → 404", st == 404, (st, rep[:100]))
st, rep = admin.req("/api/portal-access", {"action": "qr", "id": "id-inconnu"})
check("qr sur id inconnu → 404", st == 404, (st, rep[:100]))
st, rep = admin.req("/api/portal-access", {"action": "action-fantome", "id": it_cin["id"]})
check("action inconnue → 400", st == 400, (st, rep[:100]))

# --- D6 : le NOUVEAU secret (reset) est actif dans le portail — un code TOTP
#     calculé depuis le NOUVEAU QR est accepté, l'ANCIEN est refusé ---
fenetre_d6 = int(time.time()) // 30
st, rep, ck_new, page_new = reconnecter(P1, "TEST74EXPIRE", "Expire74x")
st, rep, _ = req(P1, "/api/otp/verify",
                 {"otp": totp_authentifiant(secret_rs, fenetre=fenetre_d6)}, cookie=ck_new)
d_new = json.loads(rep) if st == 200 else {}
secret_bd2, fenetre_bd2 = lire_secret_brut("TEST74EXPIRE")
check("code TOTP calculé depuis le NOUVEAU secret (reset) → accepté",
      st == 200 and d_new.get("ok") is True,
      (st, rep[:150], "bd=" + secret_bd2[:8], "fenetre_bd=" + str(fenetre_bd2),
       "fenetre_test=" + str(fenetre_d6)))
st, rep, ck_old, page_old = reconnecter(P1, "TEST74EXPIRE", "Expire74x")
code_ancien = totp_authentifiant(secret1, fenetre=int(time.time()) // 30)
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_ancien}, cookie=ck_old)
check("code TOTP de l'ANCIEN secret → REFUSÉ (401)",
      st == 401, (st, rep[:120]))
# (MODIFIÉ Task 85) plus de « code écran » : la confirmation passe par le
# NOUVEAU secret — fenêtre suivante non consommée (fenetre_d6 l'a été).
_fenetre_totp["derniere"] = fenetre_d6
st, rep, _ = req(P1, "/api/otp/verify", {"otp": code_totp_frais(secret_rs)}, cookie=ck_old)
d_old2 = json.loads(rep) if st == 200 else {}
check("(MODIFIÉ Task 85) le TOTP du NOUVEAU secret (fenêtre fraîche) reste accepté après le refus de l'ancien",
      st == 200 and d_old2.get("ok") is True, (st, rep[:150]))

# =====================================================================
n_ok = sum(1 for r in RESULTATS if r)
n_tot = len(RESULTATS)
print()
print("=" * 72)
print(f"RESULTAT TASK 80 : {n_ok}/{n_tot} contrôles OK")
print("=" * 72)
sys.exit(0 if n_ok == n_tot else 1)
