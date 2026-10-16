#!/usr/bin/env python3
"""Task 65 (18/09/2026) : REMPLISSAGE AUTOMATIQUE du CIN dans l'onglet
« Accès portail » — plus besoin de taper le numéro à la main : le CIN est
sélectionné/rempli automatiquement depuis la liste des employés détectés
dans les fiches de paie importées.

Nouveaux :
  - src/app/api/payslips/employes/route.ts (répertoire des employés : CIN
    distincts + nom + nombre de fiches, dédoublonnés, gardes Task 64)
  - scripts/test65_inserer.js          (jeu de données de test sur COPIE)
  - scripts/test65_remplissage_auto.py (32 vérifications E2E sur COPIE 4201)
  - scripts/test65_harnais.sh          (harnais portable : COPIE + serveur)
Remplacés :
  - src/components/payslip/portal-access-tab.tsx (sélecteur « Choisir dans
    la liste » + datalist d'autocomplétion + badge « Accès existant »)
  - README-DEPLOIEMENT-LOCAL.md (section 32)
Compte : 243 (état Task 64) + 4 nouveaux = 247 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 -> 64 -> 65.
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
    # --- Task 65 : nouvelle API + interface ---
    ("src/app/api/payslips/employes/route.ts", "src/app/api/payslips/employes/route.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    # --- Task 65 : documentation ---
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 65 : tests embarqués ---
    ("scripts/test65_inserer.js", "scripts/test65_inserer.js", False),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("scripts/test65_harnais.sh", "scripts/test65_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 64 (elle-même bâtie sur 34->...->42->64)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task64.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 65 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 65 : API répertoire des employés ---
    emp = zz.read("src/app/api/payslips/employes/route.ts").decode("utf-8", errors="replace")
    check("employes : gardes session + mot de passe expiré",
          "getSessionUser" in emp and "motDePasseExpire()" in emp and "unauthorized()" in emp)
    check("employes : normalisation identique au portail (normalizeQuery)",
          "normalizeQuery" in emp)
    # (MODIFIÉ Task 67) le contenu est LU par l'API pour le scan interne des
    # fiches sans colonne cin — la RÉPONSE reste limitée à CIN/nom/fiches :
    # on vérifie la liste blanche exacte des champs renvoyés.
    # (MODIFIÉ Task 70) la réponse ajoute les compteurs de diagnostic
    # fichesTotal / fichesSansCin (rétrocompatibles) — return multi-ligne.
    check("employes : réponse limitée à CIN/nom/fiches + compteurs Task 70 (contenu = scan interne uniquement)",
          "repertoire.set(cle, {" in emp
          and "cinAffiche" in emp and "derniereFiche" in emp
          and "total: items.length," in emp
          and "fichesTotal" in emp and "fichesSansCin" in emp)

    # --- Contrôles Task 65 : interface (remplissage automatique) ---
    # (RÉALIGNÉ Task 77 : la barre de création — champ CIN, datalist, sélecteur,
    # recherche — a été SUPPRIMÉE à la demande de l'utilisateur ; le répertoire
    # des employés alimente désormais le TABLEAU pré-rempli Task 71.)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("onglet : fetch /api/payslips/employes", "/api/payslips/employes" in tab)
    check("onglet : ancienne barre de création ABSENTE (Task 77)",
          "Choisir dans la liste" not in tab and "function choisirEmploye" not in tab
          and 'list="auto-rh-cins-employes"' not in tab and "Accès existant" not in tab)
    check("onglet : répertoire branché sur le tableau pré-rempli (Task 71/77)",
          "interface LigneTableau" in tab and "creerDepuisLigne(ligne)" in tab
          and "await create(ligne.cin)" in tab)
    check("onglet : section « Gestion des QR codes » dédiée (MODIFIÉ Task 80)",
          "Gestion des QR codes" in tab and "Afficher le QR" in tab)
    check("onglet : libellés mot de passe Task 64 conservés",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "expire tous les 15 jours" in tab)

    # --- Contrôles Task 65 : documentation + tests embarqués ---
    check("README : section 32 (remplissage automatique du CIN)",
          "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "Choisir dans la liste" in readm and "dédoublonnés" in readm)
    check("README : section 31 (Task 64) toujours présente",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm)
    t_in = zz.read("scripts/test65_inserer.js").decode("utf-8", errors="replace")
    t_py = zz.read("scripts/test65_remplissage_auto.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test65_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 65 embarqués (inserer + remplissage_auto + harnais)",
          "TEST65CIN1" in t_in and "RÉSULTAT REMPLISSAGE AUTO" in t_py
          and "test65.db" in t_sh and "COPIE" in t_sh)

print("MD5 ZIPs :", md5s[0])
print("TASK65 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
