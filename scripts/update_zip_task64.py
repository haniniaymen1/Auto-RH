#!/usr/bin/env python3
"""Task 64 (18/09/2026) : MOT DE PASSE — initial à usage unique, changement
OBLIGATOIRE, EXPIRATION TOUS LES 15 JOURS pour TOUS les utilisateurs
(employés du portail, RH, IT, superadministrateur) + NOUVEAUX PORTS
4000 (administration) / 4001 (portail). Remplace définitivement l'OTP.

Nouveaux :
  - src/lib/password-policy.ts                (politique 15 jours, partagée)
  - src/app/api/auth/change-password/route.ts (changement du mot de passe admin)
  - src/components/payslip/force-change-password.tsx (écran admin non contournable)
  - scripts/test64_inserer.js                 (jeu de données de test sur COPIE)
  - scripts/test64_portail.py                 (tests E2E portail — 29 contrôles)
  - scripts/test64_admin.py                   (tests E2E administration — 19 contrôles)
Remplacés :
  - prisma/schema.prisma            (PortalAccess : passwordHash, mustChangePassword,
                                     passwordChangedAt, totpSecret nullable ; User :
                                     passwordChangedAt)
  - src/lib/auth.ts                 (getSessionUser calcule l'expiration en temps
                                     réel + motDePasseExpire() 403 standard)
  - src/lib/types.ts                (SessionUser.mustChangePassword)
  - src/lib/db-crypto.ts            (PortalAccess.passwordHash chiffré)
  - src/app/api/auth/login/route.ts (expiration → session 15 min + flag)
  - src/app/api/auth/signup/route.ts (passwordChangedAt = NOW)
  - src/app/api/users/[id]/password/route.ts (reset → 15 jours pleins)
  - src/app/api/stats|payslips*|users*|portal-access/route.ts (garde 403
    MOT_DE_PASSE_EXPIRE sur toutes les API de données)
  - src/app/page.tsx                (écran de changement forcé)
  - src/components/payslip/portal-access-tab.tsx (mot de passe initial affiché
    UNE FOIS + Réinitialiser + badges)
  - scripts/portail-server.js       (CIN + mot de passe, session pending,
                                     /changer + /api/change-password, expiration
                                     15 jours, port 4001)
  - scripts/lib-crypto-bd.js        (carte : passwordHash)
  - scripts/auto-rh.js     (ports 4000/4001)
  - scripts/start-prod.js           (port 4000)
  - scripts/creer-superadmin.js     (passwordChangedAt = NOW)
  - package.json                    (dev/start:dev sur 4000)
  - DEMARRER-SILENCIEUX-WINDOWS.vbs, ARRETER-SILENCIEUX-WINDOWS.vbs,
    ETAT-SILENCIEUX-WINDOWS.vbs, JOURNAUX-SILENCIEUX-WINDOWS.vbs (CRLF, ports)
  - DEMARRER-LINUX-MAC.sh, DEMARRER-PORTAIL-LINUX-MAC.sh,
    DEMARRER-TOUT-LINUX-MAC.sh (ports)
  - Dockerfile, docker-compose.yml, Caddyfile (ports)
  - README-DEPLOIEMENT-LOCAL.md     (section 31, ports, libellés mot de passe)
Compte : 237 (état Task 42) + 6 nouveaux = 243 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 -> 64.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

RETRAIT_64 = [
    # (Task 64) Caddyfile : avait été ajouté par erreur à la 1re passe — il ne
    # faisait JAMAIS partie des archives livrables avant la Task 64 (non-suppressif
    # : conservé dans le dépôt de développement, mis à jour avec les ports 4000).
    "Caddyfile",
]

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    # --- Task 64 : schéma + bibliothèques ---
    ("prisma/schema.prisma", "prisma/schema.prisma", False),
    ("src/lib/password-policy.ts", "src/lib/password-policy.ts", False),
    ("src/lib/auth.ts", "src/lib/auth.ts", False),
    ("src/lib/types.ts", "src/lib/types.ts", False),
    ("src/lib/db-crypto.ts", "src/lib/db-crypto.ts", False),
    # --- Task 64 : API administration ---
    ("src/app/api/auth/login/route.ts", "src/app/api/auth/login/route.ts", False),
    ("src/app/api/auth/change-password/route.ts", "src/app/api/auth/change-password/route.ts", False),
    ("src/app/api/auth/signup/route.ts", "src/app/api/auth/signup/route.ts", False),
    ("src/app/api/users/[id]/password/route.ts", "src/app/api/users/[id]/password/route.ts", False),
    ("src/app/api/stats/route.ts", "src/app/api/stats/route.ts", False),
    ("src/app/api/payslips/route.ts", "src/app/api/payslips/route.ts", False),
    ("src/app/api/payslips/[id]/route.ts", "src/app/api/payslips/[id]/route.ts", False),
    ("src/app/api/payslips/[id]/file/route.ts", "src/app/api/payslips/[id]/file/route.ts", False),
    ("src/app/api/payslips/delete-many/route.ts", "src/app/api/payslips/delete-many/route.ts", False),
    ("src/app/api/payslips/redetect/route.ts", "src/app/api/payslips/redetect/route.ts", False),
    ("src/app/api/users/route.ts", "src/app/api/users/route.ts", False),
    ("src/app/api/users/[id]/route.ts", "src/app/api/users/[id]/route.ts", False),
    ("src/app/api/users/[id]/role/route.ts", "src/app/api/users/[id]/role/route.ts", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    # --- Task 64 : interface administration ---
    ("src/app/page.tsx", "src/app/page.tsx", False),
    ("src/components/payslip/force-change-password.tsx", "src/components/payslip/force-change-password.tsx", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    # --- Task 64 : portail + moteur + ports ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("scripts/lib-crypto-bd.js", "scripts/lib-crypto-bd.js", False),
    ("scripts/auto-rh.js", "scripts/auto-rh.js", False),
    ("scripts/start-prod.js", "scripts/start-prod.js", False),
    ("scripts/creer-superadmin.js", "scripts/creer-superadmin.js", False),
    ("package.json", "package.json", False),
    ("DEMARRER-SILENCIEUX-WINDOWS.vbs", "DEMARRER-SILENCIEUX-WINDOWS.vbs", True),
    ("ARRETER-SILENCIEUX-WINDOWS.vbs", "ARRETER-SILENCIEUX-WINDOWS.vbs", True),
    ("ETAT-SILENCIEUX-WINDOWS.vbs", "ETAT-SILENCIEUX-WINDOWS.vbs", True),
    ("JOURNAUX-SILENCIEUX-WINDOWS.vbs", "JOURNAUX-SILENCIEUX-WINDOWS.vbs", True),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    ("DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", False),
    ("DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh", False),
    ("Dockerfile", "Dockerfile", False),
    ("docker-compose.yml", "docker-compose.yml", False),
    # NB : Caddyfile reste HORS archive (comme avant la Task 64) — modifié au
    # dépôt pour cohérence uniquement.
    # --- Task 64 : documentation ---
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 64 : tests embarqués ---
    ("scripts/test64_inserer.js", "scripts/test64_inserer.js", False),
    ("scripts/test64_portail.py", "scripts/test64_portail.py", False),
    ("scripts/test64_admin.py", "scripts/test64_admin.py", False),
]

ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


# 1) Chaîne cumulative Task 38/39/40/42 (elle-même bâtie sur 34->35->36->37)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task38.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 64 : retraits + remplacements + ajouts (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES} | set(RETRAIT_64)
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

# 3) Contrôles automatiques
ok = True
md5s = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        residus64 = [f for f in RETRAIT_64 if f in names]
        doublons = len(liste) != len(names)
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")
        if residus64:
            ok = False
            print(f"   RETRAITS Task 64 résiduels : {residus64}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 64 : schéma + bibliothèques ---
    sch = zz.read("prisma/schema.prisma").decode("utf-8", errors="replace")
    check("schéma : passwordHash + mustChangePassword + passwordChangedAt (PortalAccess)",
          "passwordHash" in sch and "mustChangePassword" in sch
          and "passwordChangedAt" in sch and "totpSecret     String?" in sch)
    check("schéma : User.passwordChangedAt présent",
          "passwordChangedAt DateTime?" in sch)
    pol = zz.read("src/lib/password-policy.ts").decode("utf-8", errors="replace")
    check("password-policy.ts : 15 jours partagé (null = expiré)",
          "PASSWORD_MAX_AGE_DAYS = 15" in pol and "return true;" in pol)
    auth = zz.read("src/lib/auth.ts").decode("utf-8", errors="replace")
    check("auth.ts : expiration recalculée en temps réel + 403 standard",
          "isPasswordExpired(dbUser.passwordChangedAt)" in auth
          and "motDePasseExpire" in auth and "MOT_DE_PASSE_EXPIRE" in auth)
    dcr = zz.read("src/lib/db-crypto.ts").decode("utf-8", errors="replace")
    check("db-crypto.ts : passwordHash chiffré (carte alea, étendue Task 92)",
          '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"]' in dcr)
    lcb = zz.read("scripts/lib-crypto-bd.js").decode("utf-8", errors="replace")
    check("lib-crypto-bd.js : jumelle identique (passwordHash, étendue Task 92)",
          '"totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA"]' in lcb)

    # --- Contrôles Task 64 : administration ---
    login = zz.read("src/app/api/auth/login/route.ts").decode("utf-8", errors="replace")
    check("login : expiration → session 15 min + flag UI",
          "isPasswordExpired" in login and "MAX_AGE_MOT_DE_PASSE_EXPIRE" in login
          and "mustChangePassword: expire" in login)
    chp = zz.read("src/app/api/auth/change-password/route.ts").decode("utf-8", errors="replace")
    check("change-password : mot de passe actuel exigé + 15 jours remis à zéro",
          "verifyPassword(currentPassword" in chp
          and "passwordChangedAt: new Date()" in chp
          # (MODIFIÉ Task 94 : le minimum 8 a été remplacé par la politique de
          # complexité complète validerPolitiqueMotDePasse — réaligné.)
          and "validerPolitiqueMotDePasse(newPassword)" in chp)
    stats = zz.read("src/app/api/stats/route.ts").decode("utf-8", errors="replace")
    check("stats : garde 403 mot de passe expiré",
          "mustChangePassword" in stats and "motDePasseExpire()" in stats)
    pal = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    check("portal-access : create/reset mot de passe initial (affiché 1 fois)",
          'action === "create"' in pal and 'action === "reset"' in pal
          and "genererMotDePasseInitial" in pal and "initialPassword" in pal
          and 'action === "generate"' not in pal)
    page = zz.read("src/app/page.tsx").decode("utf-8", errors="replace")
    check("page.tsx : écran de changement forcé non contournable",
          "ForceChangePassword" in page and "me?.mustChangePassword" in page)
    fc = zz.read("src/components/payslip/force-change-password.tsx").decode("utf-8", errors="replace")
    check("force-change-password : actuel + nouveau + confirmation",
          "currentPassword" in fc and "newPassword" in fc and "confirmPassword" in fc
          and "15 jours" in fc)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("onglet accès portail : mot de passe initial + réinitialiser (MODIFIÉ Task 80 : section « Gestion des QR codes » dédiée)",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "Changement requis" in tab
          and "Gestion des QR codes" in tab)

    # --- Contrôles Task 64 : portail (mot de passe + 15 jours + 4001) ---
    por = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    check("portail : connexion CIN + mot de passe (scrypt temps constant)",
          "verifierMotDePasse" in por and "hacherMotDePasse" in por
          and 'String(body?.password ?? "")' in por)
    check("portail : session pending + /changer + /api/change-password",
          "PENDING_MAX_AGE" in por and '"/changer"' in por
          and '"/api/change-password"' in por and "mustChangePassword: true" in por)
    check("portail : expiration 15 jours (identique à l'admin)",
          "PASSWORD_MAX_AGE_DAYS = 15" in por and "estMotDePasseExpire" in por)
    check("portail : champ code OTP supprimé, mot de passe + new-password",
          'id="code"' not in por and 'type="password" id="password"' in por
          and 'autocomplete="new-password"' in por)
    check("portail : ancien accès OTP → message Réinitialiser",
          "RÉINITIALISER" in por)
    check("portail : API fiches refusées pendant pending",
          por.count("MUST_CHANGE_PASSWORD") >= 3)
    check("portail : port 4001 par défaut (plus de 3001)",
          '"4001"' in por and "3001" not in por)
    svc = zz.read("scripts/auto-rh.js").decode("utf-8", errors="replace")
    check("service : ports 4000/4001 par défaut",
          'AUTO_RH_PORT_ADMIN || "4000"' in svc and 'AUTO_RH_PORT_PORTAIL || "4001"' in svc)
    sp = zz.read("scripts/start-prod.js").decode("utf-8", errors="replace")
    check("start-prod : port 4000", 'process.env.PORT = "4000"' in sp)
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    check("package.json : dev sur 4000", "next dev -p 4000" in pkg)

    # --- Contrôles Task 64 : lanceurs (ports) ---
    for nom in ["DEMARRER-SILENCIEUX-WINDOWS.vbs", "ARRETER-SILENCIEUX-WINDOWS.vbs",
                "ETAT-SILENCIEUX-WINDOWS.vbs", "JOURNAUX-SILENCIEUX-WINDOWS.vbs"]:
        data = zz.read(nom)
        check(f"{nom} : 4000/4001, plus de 3000/3001",
              b"3000" not in data and b"3001" not in data and b"4000" in data)
    for nom in ["DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh",
                "DEMARRER-TOUT-LINUX-MAC.sh", "Dockerfile", "docker-compose.yml"]:
        data = zz.read(nom)
        check(f"{nom} : 4000/4001, plus de 3000/3001",
              b"3000" not in data and b"3001" not in data)

    # --- Contrôles Task 64 : documentation + tests embarqués ---
    check("README : section 31 (mot de passe initial + 15 jours + ports)",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "4000" in readm and "4001" in readm
          and "mot de passe initial" in readm.lower())
    check("README : plus aucun libellé code OTP hors section 31 (historique)",
          "code OTP" not in readm.split("## 31.")[0])
    t_in = zz.read("scripts/test64_inserer.js").decode("utf-8", errors="replace")
    t_po = zz.read("scripts/test64_portail.py").decode("utf-8", errors="replace")
    t_ad = zz.read("scripts/test64_admin.py").decode("utf-8", errors="replace")
    check("tests Task 64 embarqués (inserer + portail + admin)",
          "TEST64CIN" in t_in and "RÉSULTAT PORTAIL" in t_po and "RÉSULTAT ADMIN" in t_ad)

print("MD5 ZIPs :", md5s[0])
print("TASK64 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
