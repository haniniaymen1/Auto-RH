#!/usr/bin/env python3
"""Task 66 (18/09/2026) : CHAMP « MOT DE PASSE » — correction du problème
« le champ de mot de passe mauvais » :

  1. autocomplete="current-password" sur les champs de CONNEXION (portail
     employés, écran de changement « actuel », administration /login) : le
     navigateur PROPOSE le mot de passe enregistré au lieu de pré-remplir
     le champ avec un mot de passe GÉNÉRÉ faux (comportement de
     "new-password"). Les champs de CRÉATION (signup, « nouveau »/
     « confirmer ») restent en "new-password".
  2. Saisie TOLÉRANTE : tirets et espaces ignorés à la saisie des mots de
     passe du portail (initial affiché « XXXX-XXXX-XXXX » accepté avec ou
     sans tirets, collages parasites tolérés) — hash de la forme NETTOYÉE
     côté API admin (création/réinitialisation) et côté portail (changement).
  3. Aides visuelles (portail connexion + changement, popup RH/IT).

Nouveaux :
  - scripts/test66_inserer.js            (3 accès de test : styles nouveau/ancien/espaces)
  - scripts/test66_champ_motdepasse.py   (29 vérifications E2E sur COPIE 4102)
  - scripts/test66_harnais.sh            (harnais portable : COPIE + portail autonome)
Remplacés :
  - scripts/portail-server.js            (current-password + tolérance + aides)
  - src/app/api/portal-access/route.ts   (hash de la forme nettoyée de l'initial)
  - src/app/login/page.tsx               (current-password)
  - src/components/payslip/portal-access-tab.tsx (consigne tirets/espaces)
  - scripts/test_task37_sans_historique.py (attentes Task 66, 19 contrôles)
  - README-DEPLOIEMENT-LOCAL.md          (section 33)
Compte : 247 (état Task 65) + 3 nouveaux = 250 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 -> 64 -> 65 -> 66.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    # --- Task 66 : portail + administration ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/app/login/page.tsx", "src/app/login/page.tsx", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    # --- Task 66 : test Task 37 mis en cohérence + documentation ---
    ("scripts/test_task37_sans_historique.py", "scripts/test_task37_sans_historique.py", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 66 : tests embarqués ---
    ("scripts/test66_inserer.js", "scripts/test66_inserer.js", False),
    ("scripts/test66_champ_motdepasse.py", "scripts/test66_champ_motdepasse.py", False),
    ("scripts/test66_harnais.sh", "scripts/test66_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 65 (elle-même bâtie sur 34->...->64->65)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task65.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 66 : remplacements + ajouts (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES}
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
        doublons = len(liste) != len(names)
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 66 : portail (HTML + logique serveur) ---
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    check("portail : connexion en current-password (Task 66)",
          'id="password" name="password" placeholder="Votre mot de passe"' in portail
          and 'autocomplete="current-password"' in portail)
    check("portail : AUCUN new-password sur la page de connexion",
          'id="password" name="password" placeholder="Votre mot de passe"\n               autocomplete="new-password"' not in portail)
    check("portail : changement — « actuel » current-password, « nouveau »/« confirmer » new-password",
          'id="cur" name="cur" autocomplete="current-password"' in portail
          and 'id="new" name="new" autocomplete="new-password"' in portail
          and 'id="conf" name="conf" autocomplete="new-password"' in portail)
    check("portail : saisie tolérante (nettoyerMotDePasse + verifierMotDePasseTolerant)",
          "function nettoyerMotDePasse(" in portail
          and "function verifierMotDePasseTolerant(" in portail
          and "verifierMotDePasseTolerant(password, hashClair)" in portail
          and "verifierMotDePasseTolerant(currentPassword, hashClair)" in portail)
    check("portail : changement enregistre le hash de la forme NETTOYÉE",
          "hacherMotDePasse(nouveauPropre)" in portail and "nettoyerMotDePasse(newPassword)" in portail)
    check("portail : aides « tirets et espaces sont ignorés »",
          portail.count("tirets et espaces sont ignorés") >= 2)
    check("portail : politique 15 jours Task 64 inchangée",
          "PASSWORD_MAX_AGE_DAYS = 15" in portail and "estMotDePasseExpire" in portail)

    # --- Contrôles Task 66 : administration ---
    route_ts = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    check("admin API : hash de la forme nettoyée de l'initial (create + reset)",
          route_ts.count("hacher(nettoyerMotDePasse(initialPassword))") == 2)
    login_tsx = zz.read("src/app/login/page.tsx").decode("utf-8", errors="replace")
    check("admin /login : current-password, plus de new-password",
          'autoComplete="current-password"' in login_tsx
          and 'autoComplete="new-password"' not in login_tsx)
    # (RÉALIGNÉ Task 77 : le sélecteur Task 65 a été supprimé AVEC la barre de
    # création ; la consigne tirets/espaces reste dans le dialogue du mot de
    # passe initial — inchangée.)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("onglet : consigne tirets/espaces ignorés + barre absente (MODIFIÉ Task 80 : section « Gestion des QR codes » dédiée)",
          "tirets et espaces sont ignorés" in tab and "Choisir dans la liste" not in tab
          and "Gestion des QR codes" in tab)

    # --- Contrôles Task 66 : test Task 37 mis en cohérence ---
    t37 = zz.read("scripts/test_task37_sans_historique.py").decode("utf-8", errors="replace")
    check("test Task 37 : attentes current-password (Task 66)",
          'current-password' in t37 and 'autoComplete="new-password"\' not in login_tsx' in t37)

    # --- Contrôles Task 66 : documentation + tests embarqués ---
    check("README : section 33 (champ mot de passe)",
          "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm
          and "tirets" in readm and "current-password" in readm)
    check("README : sections 31/32 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm)
    t_in = zz.read("scripts/test66_inserer.js").decode("utf-8", errors="replace")
    t_py = zz.read("scripts/test66_champ_motdepasse.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test66_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 66 embarqués (inserer + champ_motdepasse + harnais)",
          "TEST66NOUV" in t_in and "RÉSULTAT TASK 66" in t_py
          and "test66.db" in t_sh and "COPIE" in t_sh)

print("MD5 ZIPs :", md5s[0])
print("TASK66 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
