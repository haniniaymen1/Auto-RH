#!/usr/bin/env python3
"""Task 73 (18/09/2026) : ACCÈS PORTAIL — « enleve la partie rouge et ajoute
bouton recherche » (capture annotée : bandeau vert « CIN rempli
automatiquement… » + puces CIN cliquables encadrés en rouge) :

  1. Composant portal-access-tab.tsx : le bandeau vert et les PUCES CIN
     cliquables sont SUPPRIMÉS (zone sous le champ sobre : alerte « fiches
     sans CIN » + texte d'aide uniquement). NOUVEAU bouton « Rechercher »
     (loupe) à côté du champ : popover avec recherche par nom ou par CIN
     (insensible casse, tolère espaces/tirets/points/slashes), un clic sur un
     résultat remplit le champ et referme le panneau — le rôle des puces, en
     compact. Compteur honnête « N affichés sur M détectés », état vide
     annoncé. AUCUN autre changement : remplissage 100 % automatique (Task
     70), datalist + « Choisir dans la liste » (Task 65/67), tableau
     pré-rempli (Task 71), libellés/expiration (Task 64) — tous conservés.
  2. Tests Task 70/71 remis en cohérence (contrôles « bandeau + puces »
     devenus « bandeau/puces ABSENTS + Rechercher présent » — même démarche
     que les Tasks 66/70 : seuls les CONTRÔLES sont réalignés, jamais les
     fichiers pour « faire passer »).
  3. AUCUN changement de sécurité : autocomplete (Task 66), tolérance
     tirets/espaces, mot de passe initial à usage unique, changement
     obligatoire, expiration 15 jours, ports 4000/4001 — inchangés.

Nouveaux :
  - scripts/test73_recherche_bouton.py (46 vérifications : statique + bundle +
    algorithme de recherche recalculé + création après sélection + upsert,
    sur COPIE de base 4205)
  - scripts/test73_harnais.sh      (harnais portable : COPIE + admin 4205)
Remplacés :
  - src/components/payslip/portal-access-tab.tsx (bandeau/puces retirés,
    bouton « Rechercher »)
  - scripts/test70_remplissage_auto.py           (contrôles réalignés Task 73)
  - scripts/test71_tableau_auto.py               (contrôles réalignés Task 73)
  - README-DEPLOIEMENT-LOCAL.md                  (section 38 + notes 36/37)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70,71}.py : ATTENDU 259 -> 261
  - scripts/test_task40_securisation_auto.py : ATTENDU 259 -> 261
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 259 -> 261
Compte : 259 (état Task 71) + 2 nouveaux = 261 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73.
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
    # --- Task 73 : composant + tests réalignés + doc + tests embarqués ---
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py", False),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test73_recherche_bouton.py", "scripts/test73_recherche_bouton.py", False),
    ("scripts/test73_harnais.sh", "scripts/test73_harnais.sh", False),
    # --- version du produit (0.2.3) ---
    ("package.json", "package.json", False),
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


# 1) Chaîne cumulative jusqu'à la Task 71 (elle-même bâtie sur 34->...->71)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task71.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 73 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 73 : bandeau/puces retirés + bouton « Rechercher » ---
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("composant : bandeau vert « CIN rempli automatiquement » ABSENT",
          "CIN rempli automatiquement depuis" not in tab)
    check("composant : puces CIN ABSENTES (slice 20, pastilles, « • accès existant »)",
          "employes.slice(0, 20).map" not in tab and "+ {employes.length - 20} autres" not in tab
          and "• accès existant" not in tab)
    # (RÉALIGNÉ Task 77 : le bouton « Rechercher » a été retiré AVEC TOUTE la
    # barre de création (« enleve ce qui dans le cadre rouge » — la capture
    # encadrait la barre complète ET la colonne « Employé »). La suppression
    # Task 73 (bandeau + puces) reste acquise.)
    check("composant : bouton « Rechercher » + popover SUPPRIMÉS avec la barre (Task 77)",
          '<Search className="h-4 w-4" />' not in tab
          and 'from "@/components/ui/popover"' not in tab
          and "rechercheRapide" not in tab and "resultatsRapides" not in tab
          and "filtrerEmployes" not in tab and "choisirEmploye" not in tab
          and "Rechercher un employé par nom ou par CIN" not in tab)
    check("composant : champ CIN + sélecteur + actualiser SUPPRIMÉS (Task 77)",
          'list="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab
          and "pickerOpen" not in tab and "Actualiser" not in tab
          and "onClick={() => create()}" not in tab)
    check("composant : Task 70 — mécanique du champ retirée, alerte sans CIN conservée",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "s'écrit TOUT SEUL" not in tab
          and "aucun CIN identifiable" in tab and "fichesSansCin" in tab)
    check("composant : colonne « Employé » SUPPRIMÉE (Task 77)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab
          and "Détecté dans {ligne.fiches}" not in tab)
    check("composant : Task 71 conservée (tableau pré-rempli + badge + bouton dans la ligne)",
          "interface LigneTableau" in tab and tab.count("Accès non créé") >= 2
          and "creerDepuisLigne(ligne)" in tab and "await create(ligne.cin)" in tab
          and "Filtrer le tableau par nom ou par CIN" in tab)
    check("composant : Task 64/66 conservées + section QR dédiée (MODIFIÉ Task 80)",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "expire tous les 15 jours" in tab
          and "tirets et espaces sont ignorés" in tab
          and "Gestion des QR codes" in tab)

    # --- Tests réalignés embarqués (contrôles uniquement) ---
    # (RÉALIGNÉ Task 77 : test70/test71 ont été réalignés une seconde fois —
    # barre de création et colonne « Employé » supprimées ; les contrôles
    # suivent la réalité des tests, jamais l'inverse.)
    t70 = zz.read("scripts/test70_remplissage_auto.py").decode("utf-8", errors="replace")
    t71 = zz.read("scripts/test71_tableau_auto.py").decode("utf-8", errors="replace")
    check("test Task 70 réaligné (barre ABSENTE attendue + tableau conservé)",
          "RÉALIGNÉ Task 77" in t70 and "RÉSULTAT TASK 70" in t70
          and 'not in tab' in t70)
    check("test Task 71 réaligné (colonne Employé ABSENTE attendue + tableau conservé)",
          "RÉALIGNÉ Task 77" in t71 and "RÉSULTAT TASK 71" in t71
          and 'not in tab' in t71)

    # --- Tests embarqués Task 73 ---
    t_py = zz.read("scripts/test73_recherche_bouton.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test73_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 73 embarqués (recherche_bouton + harnais, COPIE 4205)",
          "RÉSULTAT TASK 73" in t_py and "filtrer_employes" in t_py
          and "test73.db" in t_sh and "COPIE" in t_sh and "4205" in t_sh
          and "test65_inserer.js" in t_sh)

    # --- Documentation ---
    check("README : section 38 (bandeau/puces retirés + bouton Rechercher)",
          "## 38. Accès portail : bandeau vert et puces retirés — NOUVEAU bouton « Rechercher »" in readm
          and "test73_harnais.sh" in readm and "enleve la partie rouge" in readm)
    check("README : sections 31/32/33/34/35/36/37 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm
          and "## 34. Répertoire COMPLET des CIN depuis les données importées" in readm
          and "## 35. Champ « Mot de passe » du portail : style harmonisé avec l'image fournie" in readm
          and "## 36. Accès portail : le champ CIN se remplit TOUT SEUL — 100 % automatique" in readm
          and "## 37. Accès portail : le TABLEAU des employés se pré-remplit AUTOMATIQUEMENT" in readm)

    # --- Signaux des maillons précédents (71/70/69/66/64) toujours présents ---
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
print("TASK73 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
