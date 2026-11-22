#!/usr/bin/env python3
"""Task 85 — réalignement du helper confirmer_otp des suites test66/67/69 :
la fenêtre /otp n'affiche JAMAIS le code — la confirmation se fait par le
TOTP calculé depuis le secret du QR (RFC 6238). Convention : seuls les
CONTRÔLES sont ajustés, jamais les fichiers produit pour « faire passer »."""
import re

RACINE = "/home/z/my-project"

# Corps canonique du helper Task 85 — {req} = appel de requête adapté à la
# suite ({req}(opener, "/otp") / {req}(opener, base, "/otp") / {req}("/otp")).
CANON = '''def totp_now(secret_b32, t=None, pas=30):
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
    st, page = {req}("/otp")
    if st != 200:
        return st, page
    secret = secret_du_qr(page)
    if not secret:
        return 0, "QR code (secret otpauth) introuvable sur la page /otp"
    return {req}("/api/otp/verify", {{"otp": code_totp_frais(secret)}})
'''

IMPORTS = "import base64\nimport hashlib\nimport hmac\nimport time\n"

# 1) repérer l'ancien helper (de « def confirmer_otp » jusqu'à la ligne
#    « return ... /api/otp/verify ... » incluse) et le remplacer.
MOTIF_FIN = re.compile(
    r"return {req}\(\"/api/otp/verify\", \{\"otp\": m\.group\(1\) \+ m\.group\(2\)\}\)".replace("{req}", r"(?P<req>[\w]+)")
)

FICHIERS = {
    "test66_champ_motdepasse.py": 'opener, "/otp"',
    "test67_repertoire_complet.py": 'opener, base, "/otp"',
    "test69_champ_style.py": None,  # signature `requete` : cas particulier
}

for nom, appel in FICHIERS.items():
    chemin = RACINE + "/scripts/" + nom
    with open(chemin, encoding="utf-8") as f:
        txt = f.read()
    m = re.search(
        r'def confirmer_otp\(.*?\n(?:.*?\n)*?    return .*?"/api/otp/verify".*?\n',
        txt,
    )
    if not m:
        print("KO  helper introuvable dans " + nom)
        continue
    bloc = m.group(0)
    if "otp-affiche" not in bloc:
        print("KO  helper inattendu dans " + nom)
        continue
    if nom == "test69_champ_style.py":
        canon = CANON.replace('{req}("/otp")', 'requete("/otp")').replace(
            '{req}("/api/otp/verify", {{"otp": code_totp_frais(secret)}})',
            'requete("/api/otp/verify", {"otp": code_totp_frais(secret)})',
        )
        canon = canon.replace(
            "def confirmer_otp(opener, cin=None, mot_de_passe=None):",
            "def confirmer_otp(requete, cin=None, mot_de_passe=None):",
        )
        canon = canon.replace(
            '"""(REFONTE Task 85) étape 2 de la connexion : la page /otp affiche LE\n    QR code (URI otpauth://totp, secret persistant) + le champ de\n    confirmation — AUCUN code n\'est JAMAIS affiché en clair. La suite lit le\n    secret du QR et CALCULE le TOTP (RFC 6238), exactement comme une\n    application d\'authentification. Retourne (status, corps)."""',
            '"""(REFONTE Task 85) étape 2 de la connexion : la page /otp affiche LE\n    QR code (URI otpauth://totp, secret persistant) + le champ de\n    confirmation — AUCUN code n\'est JAMAIS affiché en clair. La suite lit le\n    secret du QR et CALCULE le TOTP (RFC 6238), exactement comme une\n    application d\'authentification. `requete` = req ou req2.\n    Retourne (st, corps)."""',
        )
    else:
        canon = CANON.replace("{req}(", "req(")
        canon = canon.replace('req("/api/otp/verify", {"otp": code_totp_frais(secret)})', 'req("/api/otp/verify", {"otp": code_totp_frais(secret)})')
        if nom == "test67_repertoire_complet.py":
            canon = canon.replace('req("/otp")', 'req(opener, base, "/otp")')
            canon = canon.replace('req("/api/otp/verify", {"otp": code_totp_frais(secret)})', 'req(opener, base, "/api/otp/verify", {"otp": code_totp_frais(secret)})')
    txt = txt.replace(bloc, canon)
    # imports : insérer base64/hashlib/hmac/time après le premier import json/os
    if "import base64" not in txt:
        txt = txt.replace("import json\n", IMPORTS + "import json\n", 1)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(txt)
    print("OK  " + nom + " — helper Task 85 posé")

# 2) test69 : contrôle statique ligne « 'id="otp-affiche"' in portail »
chemin69 = RACINE + "/scripts/test69_champ_style.py"
with open(chemin69, encoding="utf-8") as f:
    t69 = f.read()
avant69 = t69
t69 = t69.replace(
    "'require(\"qrcode\")' in portail and 'id=\"otp-affiche\"' in portail",
    "'require(\"qrcode\")' in portail and 'id=\"otp-affiche\"' not in portail\n      and 'data-payload=' in portail",
)
if t69 != avant69:
    with open(chemin69, "w", encoding="utf-8") as f:
        f.write(t69)
    print("OK  test69 — contrôle statique QR réorienté (otp-affiche ABSENT)")
else:
    print("??  test69 — motif de contrôle statique non trouvé (à vérifier)")
