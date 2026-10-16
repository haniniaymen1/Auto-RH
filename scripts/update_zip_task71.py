#!/usr/bin/env python3
"""Task 71 (18/09/2026) : ACCÈS PORTAIL — LE TABLEAU DES EMPLOYÉS SE
PRÉ-REMPLIT AUTOMATIQUEMENT (demande : « remplissage automatique de la zone
rouge » — la liste des accès restait vide tant qu'aucun accès n'était créé) :

  1. Composant portal-access-tab.tsx : le tableau fusionne AUTOMATIQUEMENT
     tous les employés détectés dans les fiches importées avec les accès déjà
     créés (et les accès créés à la main). Chaque employé SANS accès porte le
     badge « Accès non créé » et un bouton « Créer l'accès » DIRECTEMENT dans
     sa ligne (desktop + mobile). Tri « à créer d'abord » (max fiches, puis
     alphabétique) — le champ auto-rempli (Task 70) suit le MÊME ordre.
     Compteurs (à créer / créés / détectés), filtre nom ou CIN, colonne
     « Employé », défilement avec en-tête figé. AUCUNE fonctionnalité
     précédente retirée (Task 64/65/66/67/69/70 toutes conservées).
  2. AUCUN changement de sécurité : autocomplete (Task 66), tolérance
     tirets/espaces, mot de passe initial à usage unique, changement
     obligatoire, expiration 15 jours, ports 4000/4001 — inchangés.

Nouveaux :
  - scripts/test71_tableau_auto.py (48 vérifications : statique + bundle +
    fusion recalculée + création depuis une ligne, sur COPIE de base 4203)
  - scripts/test71_harnais.sh      (harnais portable : COPIE + admin 4203)
Remplacés :
  - src/components/payslip/portal-access-tab.tsx (tableau pré-rempli)
  - README-DEPLOIEMENT-LOCAL.md                  (section 37)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70}.py : ATTENDU 257 -> 259
  - scripts/test_task40_securisation_auto.py : ATTENDU 257 -> 259
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 257 -> 259
Compte : 257 (état Task 70) + 2 nouveaux = 259 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71.
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
    # --- Task 71 : composant + doc + tests embarqués ---
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py", False),
    ("scripts/test71_harnais.sh", "scripts/test71_harnais.sh", False),
]

ATTENDU = 307  # (NOUVEAU Task 94) chaîne idempotente : l'archive courante porte l'état FINAL Task 94 (307 fichiers)


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


# 1) Chaîne cumulative jusqu'à la Task 70 (elle-même bâtie sur 34->...->70)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task70.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 71 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 71 : tableau pré-rempli automatiquement ---
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("composant : fusion sans doublon détectés + accès (LigneTableau)",
          "interface LigneTableau" in tab and "cle: `detecte:${e.cin}`" in tab
          and "cle: `acces:${row.id}`" in tab)
    check("composant : badge « Accès non créé » + bouton dans la ligne",
          tab.count("Accès non créé") >= 2 and "creerDepuisLigne(ligne)" in tab
          and "await create(ligne.cin)" in tab)
    check("composant : tri « à créer d'abord » + même tri que le champ (Task 70)",
          "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab)
    # (RÉALIGNÉ Task 77 : la colonne « Employé » a été SUPPRIMÉE à la demande
    # de l'utilisateur — tableau à 5 colonnes, en-tête toujours figé.)
    check("composant : compteurs + filtre + colonne Employé SUPPRIMÉE + en-tête figé (Task 77)",
          "nbRestants" in tab and "Filtrer le tableau par nom ou par CIN" in tab
          and ">Employé</th>" not in tab and "sticky top-0" in tab
          and tab.count("colSpan={5}") == 3)
    check("composant : la mention « Aucun accès portail créé » ne vit que dans la section QR (MODIFIÉ Task 80)",
          "Aucun accès portail créé" in tab
          and "Aucun employé détecté pour le moment" in tab
          and tab.index("Aucun accès portail créé") > tab.index("Gestion des QR codes"))
    # (RÉALIGNÉ Task 77 : la barre de création — champ auto Task 70, recherche
    # Task 73, datalist + sélecteur Task 65 — a été SUPPRIMÉE ; le tableau
    # pré-rempli est la seule surface de création.)
    check("composant : barre de création SUPPRIMÉE (Task 70/73/65 du champ retirées, Task 77)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "resultatsRapides" not in tab and 'list="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab
          and "CIN rempli automatiquement depuis" not in tab
          and "employes.slice(0, 20).map" not in tab)
    check("composant : Task 64/66 conservées (libellés + consigne tirets) + alerte sans CIN + section QR dédiée (MODIFIÉ Task 80)",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "expire tous les 15 jours" in tab
          and "tirets et espaces sont ignorés" in tab
          and "aucun CIN identifiable" in tab
          and "Gestion des QR codes" in tab)

    # --- Tests embarqués Task 71 ---
    t_py = zz.read("scripts/test71_tableau_auto.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test71_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 71 embarqués (tableau_auto + harnais, COPIE 4203)",
          "RÉSULTAT TASK 71" in t_py and "fusion_tableau" in t_py
          and "test71.db" in t_sh and "COPIE" in t_sh and "4203" in t_sh
          and "test65_inserer.js" in t_sh)

    # --- Documentation ---
    check("README : section 37 (tableau pré-rempli automatiquement)",
          "## 37. Accès portail : le TABLEAU des employés se pré-remplit AUTOMATIQUEMENT" in readm
          and "Accès non créé" in readm and "test71_harnais.sh" in readm)
    check("README : sections 31/32/33/34/35/36 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm
          and "## 34. Répertoire COMPLET des CIN depuis les données importées" in readm
          and "## 35. Champ « Mot de passe » du portail : style harmonisé avec l'image fournie" in readm
          and "## 36. Accès portail : le champ CIN se remplit TOUT SEUL — 100 % automatique" in readm)

    # --- Signaux des maillons précédents (70/69/66/64) toujours présents ---
    route_ts = zz.read("src/app/api/payslips/employes/route.ts").decode("utf-8", errors="replace")
    check("Task 70 : API répertoire + compteurs toujours en place",
          "fichesTotal" in route_ts and "fichesSansCin" in route_ts
          and "scanLibellesCin(" in route_ts and "jetonsCinNomFichier(" in route_ts)
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    check("(MODIFIÉ Task 85) Task 69 : style champ mot de passe toujours en place (9 + 1 règle password CSS_OTP = 10 — style .otp-code du code affiché SUPPRIMÉ)",
          portail.count("border-radius: 12px") == 10)
    check("Task 66 : autocomplete + tolérance toujours en place",
          'autocomplete="current-password"' in portail and "nettoyerMotDePasse(" in portail)
    check("Task 64 : expiration 15 jours toujours en place", portail.count("15 jours") >= 3)

print("MD5 ZIPs :", md5s[0])
print("TASK71 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
