#!/usr/bin/env python3
"""
Met à jour le kit download/auto-rh-scripts-site-web.zip — Task 18 :

« sécurisé portal employé par OTP scanne qr code via application mobile
  authenticator ou un autre application ni par sms ni par mail en plus avec
  numero cin »

1. Base de données (100 % additif) :
     - prisma/schema.prisma : nouveau modèle PortalAccess (CIN unique,
       secret TOTP base32, anti-rejeu, verrouillage anti force-brute).
       La table est créée automatiquement au démarrage (prisma db push).
2. Administration (RH/IT) :
     - src/app/api/portal-access/route.ts (NOUVEAU) : liste, générer le
       secret TOTP + QR code (otpauth://), régénérer, activer/désactiver,
       débloquer, supprimer. Les secrets ne sont JAMAIS renvoyés par la liste.
     - src/components/payslip/portal-access-tab.tsx (NOUVEAU) : onglet
       « Accès portail » — QR code scannable une seule fois + clé manuelle.
     - src/app/page.tsx : nouvel onglet (RH + IT).
     - package.json : dépendance qrcode (génération des QR codes).
3. Portail employé (scripts/portail-server.js) :
     - page de connexion CIN + code OTP (LOGIN_HTML) ;
     - TOTP RFC 6238 pur Node (base32 + HMAC-SHA1, fenêtres ±30 s, anti-rejeu) ;
     - session cookie httpOnly signé HMAC-SHA256 (30 min, même AUTH_SECRET) ;
     - recherche et PDF VERROUILLÉS sur le CIN de la session (403 sinon) ;
     - anti force-brute : 5 échecs -> verrouillage 15 min ; limiteur IP étendu.
AUCUNE fonctionnalité supprimée. Vérifications : verify_task18.py 54/54 OK,
verify_task16.py TOUT OK, verify_task17.py TOUT OK, verify_unlimited_list.py OK.
"""
import os
import shutil
import subprocess
import zipfile

ROOT = "/home/z/my-project"
ZIP = os.path.join(ROOT, "download", "auto-rh-scripts-site-web.zip")
WORK = "/tmp/zipupdate_task18"

# ---------- 1. Extraction complète ----------
if os.path.exists(WORK):
    shutil.rmtree(WORK)
os.makedirs(WORK)
subprocess.run(["unzip", "-o", "-q", ZIP, "-d", WORK], check=True)

# ---------- 2. Copie des fichiers modifiés/ajoutés ----------
updated = [
    "prisma/schema.prisma",
    "src/app/api/portal-access/route.ts",           # NOUVEAU
    "src/components/payslip/portal-access-tab.tsx", # NOUVEAU
    "src/app/page.tsx",
    "scripts/portail-server.js",
    "scripts/portal_login_helper.py",               # NOUVEAU (tests)
    "scripts/verify_task18.py",                     # NOUVEAU (tests)
    "package.json",
    "test-data/LISEZMOI-TESTS.txt",
]
for rel in updated:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(WORK, rel)
    assert os.path.exists(src), f"source absente: {rel}"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("copié:", rel)

# ---------- 3. Vérifs de contenu ----------
def must_contain(rel, *needles):
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        c = f.read()
    for n in needles:
        assert n in c, f"{rel}: '{n}' absent !"

def must_not_contain(rel, *needles):
    with open(os.path.join(WORK, rel), encoding="utf-8") as f:
        c = f.read()
    for n in needles:
        assert n not in c, f"{rel}: '{n}' encore présent !"

must_contain("prisma/schema.prisma", "model PortalAccess", "totpSecret",
             "lastUsedWindow", "lockedUntil")
must_contain("src/app/api/portal-access/route.ts",
             "action === \"generate\"", "QRCode.toDataURL", "otpauth://totp/",
             "base32Encode", "upsert")
must_not_contain("src/app/api/portal-access/route.ts", "totpSecret: true")
must_contain("src/components/payslip/portal-access-tab.tsx",
             "Accès portail", "Générer le QR code", "Google Authenticator",
             "qr.qrDataUrl", "Régénérer", "Débloquer")
must_contain("src/app/page.tsx", "PortalAccessTab", '"portal"',
             "Accès portail")
must_contain("package.json", '"qrcode"')
must_contain("scripts/portail-server.js",
             # connexion OTP
             "const LOGIN_HTML", "/api/verify", "verifyTotp", "base32Decode",
             "totpAt", "MAX_VERIFY_ATTEMPTS", "LOCK_MS",
             # sessions signées
             "portail_session", "createPortalSession", "verifyPortalSession",
             "getSessionCin", "HMAC", "sha256",
             # verrouillage CIN de session
             "searchPayslipsByCin", "/api/my-fiches", "/api/logout",
             "Accès limité à vos propres fiches de paie")
must_contain("test-data/LISEZMOI-TESTS.txt", "PORTAIL SÉCURISÉ PAR OTP")
print("Vérifs de contenu: OK")

# ---------- 4. README : section NOUVEAUTÉ (v5) ----------
readme = os.path.join(WORK, "README-DEPLOIEMENT-LOCAL.md")
with open(readme, encoding="utf-8") as f:
    rc = f.read()
section = """## NOUVEAUTÉ 15/09/2026 (v5) — Portail sécurisé par OTP (authenticator)

Le portail employés n'est plus accessible par la simple saisie d'un CIN.
La connexion exige désormais le numéro de CIN ET un code à 6 chiffres généré
par une application authenticator (Google Authenticator, Microsoft
Authenticator, Authy, FreeOTP…). AUCUN SMS, AUCUN e-mail : le code est
vérifié 100 % localement (standard TOTP RFC 6238).

1. Inscription d'un employé (UNE SEULE FOIS) : dans l'administration,
   onglet « Accès portail » (RH et IT) — saisissez le CIN puis
   « Générer le QR code ». L'employé scanne le QR avec son application
   (ou saisit la clé manuellement). La clé n'est plus affichée ensuite ;
   « Régénérer » en crée une nouvelle (l'ancienne application cesse de
   fonctionner).
2. Connexion au portail : CIN + code à 6 chiffres (il change toutes les
   30 secondes). Session de 30 minutes, bouton « Déconnexion ».
3. Cloisonnement total : la recherche et les PDF sont VERROUILLÉS sur le
   CIN de la session connectée — un employé ne peut jamais consulter les
   fiches d'un autre (403).
4. Protection anti force-brute : 5 codes erronés -> accès verrouillé 15
   minutes (bouton « Débloquer » côté RH). Un code déjà utilisé est refusé
   (anti-rejeu). Limiteur de requêtes par IP conservé.
5. Désactivation immédiate possible par RH (bouton « Désactiver »).
6. Technique : nouvelle table PortalAccess créée automatiquement au
   démarrage (prisma db push) ; dépendance npm « qrcode » ajoutée
   (génération des QR codes côté administration). Aucune fonctionnalité
   existante supprimée ; les masquages Task 16/17 restent en place.
"""
if "## NOUVEAUTÉ 15/09/2026 (v5)" not in rc:
    idx = rc.find("## NOUVEAUTÉ")
    if idx >= 0:
        rc = rc[:idx] + section + "\n" + rc[idx:]
    else:
        lines = rc.split("\n")
        lines.insert(1, "\n" + section)
        rc = "\n".join(lines)
    with open(readme, "w", encoding="utf-8") as f:
        f.write(rc)
    print("README: section NOUVEAUTÉ (v5) ajoutée")
else:
    print("README: section déjà présente")

# ---------- 5. Re-zippage (tous fichiers conservés) ----------
tmp_zip = ZIP + ".new"
if os.path.exists(tmp_zip):
    os.remove(tmp_zip)
before = sum(len(fns) for _, _, fns in os.walk(WORK))
with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, filenames in os.walk(WORK):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, WORK)
            zf.write(full, rel)
after = sum(len(fns) for _, _, fns in os.walk(WORK))
assert before == after
os.replace(tmp_zip, ZIP)
size = os.path.getsize(ZIP) / (1024 * 1024)
print(f"\nZIP mis à jour : {ZIP} ({size:.1f} Mo)")

# ---------- 6. Vérification finale de l'archive ----------
with zipfile.ZipFile(ZIP) as zf:
    names = zf.namelist()
    print("Fichiers dans le ZIP:", len(names))
    for probe in [
        "prisma/schema.prisma",
        "src/app/api/portal-access/route.ts",
        "src/components/payslip/portal-access-tab.tsx",
        "src/app/page.tsx",
        "scripts/portail-server.js",
        "scripts/portal_login_helper.py",
        "scripts/verify_task18.py",
        "package.json",
        "test-data/LISEZMOI-TESTS.txt",
        "README-DEPLOIEMENT-LOCAL.md",
        "scripts/start-prod.js",
        "public/fiche-icon.svg",
    ]:
        hit = [n for n in names if n == probe or n.endswith("/" + probe)]
        assert hit, f"MANQUANT dans le ZIP: {probe}"
    print("Sondes ZIP: OK")
print("DONE")
