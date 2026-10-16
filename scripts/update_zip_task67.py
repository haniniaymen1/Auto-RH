#!/usr/bin/env python3
"""Task 67 (18/09/2026) : RÉPERTOIRE COMPLET DES CIN DEPUIS LES DONNÉES
IMPORTÉES — corrige « 1 CIN détecté » alors que les fiches importées en
contiennent plusieurs (l'utilisateur devait SAISIR le CIN à la main) :

  1. /api/payslips/employes puise désormais dans TOUTES les sources de chaque
     fiche : colonne cin (S1), RELANCE de la détection actuelle sur le texte
     stocké pour les fiches sans colonne — rattrape les imports anciens (S2),
     contextes de tableaux (S3), scan large de TOUS les libellés CIN (« Carte
     identité », « Carte nationale d'identité »…) avec formes strictes (S4),
     jetons 8-9 chiffres du nom de fichier CONFIRMÉS par le contenu, dates
     exclues (S5). Réponse TOUJOURS limitée à CIN/nom/fiches (aucun contenu
     exposé), base jamais modifiée, gardes session + 15 jours inchangées.
  2. Onglet « Accès portail » : texte d'aide « (champ CIN, contenu de la
     fiche ou nom de fichier) ».
  3. Test Task 65 mis en cohérence (liste blanche de la réponse).

Nouveaux :
  - scripts/test67_inserer.js            (9 fiches : S1..S5 + 2 négatifs)
  - scripts/test67_repertoire_complet.py (40 vérifications E2E COPIE 4201+4102)
  - scripts/test67_harnais.sh            (harnais portable : COPIE + 2 serveurs)
Remplacés :
  - src/app/api/payslips/employes/route.ts        (répertoire enrichi)
  - src/components/payslip/portal-access-tab.tsx  (texte d'aide)
  - scripts/test65_remplissage_auto.py            (contrôle liste blanche)
  - README-DEPLOIEMENT-LOCAL.md                   (section 34)
Compte : 250 (état Task 66) + 3 nouveaux = 253 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 -> 64 -> 65 -> 66 -> 67.
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
    # --- Task 67 : répertoire enrichi + interface ---
    ("src/app/api/payslips/employes/route.ts", "src/app/api/payslips/employes/route.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    # --- Task 67 : test Task 65 mis en cohérence + documentation ---
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 67 : tests embarqués ---
    ("scripts/test67_inserer.js", "scripts/test67_inserer.js", False),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py", False),
    ("scripts/test67_harnais.sh", "scripts/test67_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 66 (elle-même bâtie sur 34->...->66)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task66.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 67 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 67 : API répertoire enrichi ---
    route_ts = zz.read("src/app/api/payslips/employes/route.ts").decode("utf-8", errors="replace")
    check("API : relance de la détection actuelle (S2)",
          "detectCin(" in route_ts and "detectCinFromTableContext(" in route_ts)
    check("API : scan large des libellés (S4, « Carte (nationale d')identité »)",
          "scanLibellesCin(" in route_ts and "NATIONALE" in route_ts and "IDENTIT" in route_ts)
    check("API : nom de fichier confirmé par le contenu (S5)",
          "jetonsCinNomFichier(" in route_ts and "isExactCinInContent(" in route_ts)
    check("API : dates 19xx/20xx exclues (S5)",
          "(?:19|20)\\d{6}" in route_ts and "(?:19|20)\\d{7}" in route_ts)
    check("API : contenu chargé UNIQUEMENT pour les fiches sans colonne",
          "idsSansCin" in route_ts)
    # (MODIFIÉ Task 70) la réponse ajoute les compteurs fichesTotal /
    # fichesSansCin — le return est multi-ligne, la liste blanche des champs
    # du répertoire reste CIN/nom/fiches.
    check("API : réponse limitée à CIN/nom/fiches (liste blanche) + compteurs Task 70",
          "total: items.length," in route_ts
          and "fichesTotal" in route_ts and "fichesSansCin" in route_ts)
    check("API : gardes session + expiration 15 jours (Task 64) inchangées",
          "getSessionUser" in route_ts and "motDePasseExpire()" in route_ts
          and "mustChangePassword" in route_ts)
    check("API : aucun QR code", "QrCode" not in route_ts and "qrcode" not in route_ts.lower())

    # --- Contrôles Task 67 : onglet + signaux des maillons précédents ---
    # (RÉALIGNÉ Task 77 : le paragraphe des sources et le sélecteur ont été
    # supprimés avec la barre de création ; le répertoire des employés alimente
    # le tableau pré-rempli Task 71.)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("onglet : répertoire branché sur le tableau pré-rempli (Task 77)",
          "interface LigneTableau" in tab and "/api/payslips/employes" in tab
          and "creerDepuisLigne(ligne)" in tab)
    check("onglet : barre de création ABSENTE (Task 77)",
          "Choisir dans la liste" not in tab and 'list="auto-rh-cins-employes"' not in tab
          and "setCin(" not in tab)
    check("onglet : Task 66 conservée (consigne tirets) + section QR dédiée (MODIFIÉ Task 80)",
          "tirets et espaces sont ignorés" in tab and "Gestion des QR codes" in tab)

    # --- Contrôles Task 67 : test Task 65 mis en cohérence ---
    t65 = zz.read("scripts/test65_remplissage_auto.py").decode("utf-8", errors="replace")
    check("test Task 65 : contrôle liste blanche (Task 67)",
          "réponse limitée à CIN/nom/fiches" in t65 and "repertoire\\.set" in t65)

    # --- Contrôles Task 67 : documentation + tests embarqués ---
    check("README : section 34 (répertoire complet des CIN)",
          "## 34. Répertoire COMPLET des CIN depuis les données importées" in readm
          and "nom de fichier" in readm and "aucune réimportation" in readm)
    check("README : sections 31/32/33 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm)
    t_in = zz.read("scripts/test67_inserer.js").decode("utf-8", errors="replace")
    t_py = zz.read("scripts/test67_repertoire_complet.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test67_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 67 embarqués (inserer + repertoire_complet + harnais)",
          "test67-nomfichier-bulletin_56789012_2024.pdf" in t_in and "RÉSULTAT TASK 67" in t_py
          and "test67.db" in t_sh and "COPIE" in t_sh and "4102" in t_sh)

print("MD5 ZIPs :", md5s[0])
print("TASK67 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
