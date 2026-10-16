#!/usr/bin/env python3
"""Task 77 (19/09/2026) : ADMIN « Accès portail » — « enleve ce qui dans le
cadre rouge » (capture annotée : la BARRE DE CRÉATION complète — champ CIN +
« Choisir dans la liste » + « Rechercher » + « Créer l'accès » + bouton
actualiser — ET la colonne « Employé » du tableau étaient encadrés en rouge) :

  1. BARRE DE CRÉATION SUPPRIMÉE : plus de champ CIN (ni datalist, ni
     auto-remplissage Task 70), plus de sélecteur « Choisir dans la liste »
     (Task 65), plus de bouton « Rechercher » (Task 73), plus de bouton
     « Créer l'accès » du haut, plus de bouton d'actualisation — et le
     paragraphe « Remplissage 100 % automatique » qui décrivait le champ.
  2. CRÉATION VIA LE TABLEAU UNIQUEMENT (Task 71) : chaque ligne « Accès non
     créé » porte son bouton « Créer l'accès » qui transmet le CIN de la
     ligne — create() exige désormais un CIN passé en argument.
  3. COLONNE « Employé » SUPPRIMÉE (desktop + cartes mobiles) : le nom n'est
     plus AFFICHÉ mais reste dans les données — le filtre « par nom ou par
     CIN » du tableau reste opérationnel. Tableau à 5 colonnes (colSpan 5).
  4. CONSERVÉ : tableau pré-rempli, badge « Accès non créé », compteurs,
     filtre, alerte « fiches sans CIN identifiable » (Task 70), mot de passe
     initial affiché une seule fois + Réinitialiser + expiration 15 jours
     (Task 64/66), OTP/QR du portail (Tasks 74-76) inchangés.

Nouveaux :
  - scripts/test77_sans_barre_cin.py (44 vérifications : statiques + flux de
    création depuis la ligne sur COPIE port 4214)
  - scripts/test77_harnais.sh (harnais portable : COPIE + admin 4214)
Remplacés :
  - src/components/payslip/portal-access-tab.tsx (barre + colonne supprimées)
  - README-DEPLOIEMENT-LOCAL.md (section 42 + note en tête de §38)
  - package.json (0.2.6 -> 0.2.7)
  - scripts/test65, test67, test70, test71, test73 (réalignés Task 77)
  - scripts/test74, test75, test76 (version 0.2.7)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70,71,73,74,75,76}.py : ATTENDU 268 -> 270
  - scripts/test_task40_securisation_auto.py : ATTENDU 268 -> 270
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 268 -> 270
Compte : 268 (état Task 76) + 2 nouveaux = 270 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76 -> 77.
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
    # --- Task 77 : barre de création + colonne « Employé » supprimées ---
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("package.json", "package.json", False),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py", False),
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py", False),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py", False),
    ("scripts/test73_recherche_bouton.py", "scripts/test73_recherche_bouton.py", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test77_sans_barre_cin.py", "scripts/test77_sans_barre_cin.py", False),
    ("scripts/test77_harnais.sh", "scripts/test77_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 76 (elle-même bâtie sur 34->...->76)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task76.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 77 : remplacements + ajouts (sans doublons)
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
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    t77 = zz.read("scripts/test77_sans_barre_cin.py").decode("utf-8", errors="replace")
    t77sh = zz.read("scripts/test77_harnais.sh").decode("utf-8", errors="replace")
    t65 = zz.read("scripts/test65_remplissage_auto.py").decode("utf-8", errors="replace")
    t70 = zz.read("scripts/test70_remplissage_auto.py").decode("utf-8", errors="replace")
    t71 = zz.read("scripts/test71_tableau_auto.py").decode("utf-8", errors="replace")
    t73 = zz.read("scripts/test73_recherche_bouton.py").decode("utf-8", errors="replace")
    t76 = zz.read("scripts/test76_otp_qr_chaque_connexion.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 77 : barre de création + colonne « Employé » absentes ---
    check("composant : BARRE DE CRÉATION supprimée (champ + datalist + aides + actualiser)",
          "Numéro CIN complet de l'employé" not in tab
          and 'list="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab and "pickerOpen" not in tab
          and "Actualiser" not in tab and "onClick={() => create()}" not in tab)
    check("composant : recherche « Rechercher » Task 73 supprimée avec la barre",
          "rechercheRapide" not in tab and "resultatsRapides" not in tab
          and "filtrerEmployes" not in tab and 'from "@/components/ui/popover"' not in tab
          and "Rechercher un employé par nom ou par CIN" not in tab)
    check("composant : mécanique Task 70 du champ supprimée (auto-remplissage)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "cinAutoRempli" not in tab and "choisirEmploye" not in tab)
    check("composant : COLONNE « Employé » supprimée (desktop + mobile, 5 colonnes)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab
          and tab.count("colSpan={5}") == 3
          and "Détecté dans {ligne.fiches}" not in tab)
    check("composant : création VIA LE TABLEAU uniquement (create exige un CIN de ligne)",
          "async function create(valeur: string)" in tab
          and "creerDepuisLigne(ligne)" in tab and "await create(ligne.cin)" in tab
          and "busyId === ligne.cle || generating" in tab)
    check("composant : nom resté en DONNÉES — filtre du tableau par nom ou CIN opérationnel",
          "nom: string | null;" in tab
          and '(l.nom ?? "").toLowerCase().includes(qNom)' in tab
          and "Filtrer le tableau par nom ou par CIN" in tab)
    check("composant : Task 71 conservée (fusion + tri + badge + compteurs + en-tête figé)",
          "interface LigneTableau" in tab and "cle: `detecte:${e.cin}`" in tab
          and "cle: `acces:${row.id}`" in tab
          and "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab
          and tab.count("Accès non créé") >= 2 and "nbRestants" in tab
          and "sticky top-0" in tab and "max-h-[480px]" in tab)
    check("composant : Task 70/64/66 conservées (alerte sans CIN, libellés, statuts) + aucun QR",
          "fichesSansCin" in tab and "fichesTotal" in tab
          and "aucun CIN identifiable" in tab
          and "Créer l'accès" in tab and "Réinitialiser" in tab
          and "expire tous les 15 jours" in tab and "tirets et espaces sont ignorés" in tab
          and "Changement requis" in tab and "À réinitialiser" in tab and "Verrouillé" in tab
          and "Gestion des QR codes" in tab)  # (MODIFIÉ Task 80 : section QR dédiée)

    # --- Tests embarqués Task 77 + réalignés ---
    check("tests Task 77 embarqués (sans_barre_cin + harnais, COPIE 4214)",
          "RÉSULTAT TASK 77" in t77 and "test77.db" in t77sh and "COPIE" in t77sh
          and "4214" in t77sh and "test65_inserer.js" in t77sh)
    check("test65 réaligné Task 77 (barre absente attendue, tableau conservé)",
          "RÉALIGNÉ Task 77" in t65 and "Choisir dans la liste" in t65)
    check("test70 réaligné Task 77 (champ supprimé, tri survit dans le tableau)",
          "RÉALIGNÉ Task 77" in t70 and "RÉSULTAT TASK 70" in t70
          and 'not in tab' in t70)
    check("test71 réaligné Task 77 (colonne Employé absente, tableau complet)",
          "RÉALIGNÉ Task 77" in t71 and "colSpan={5}" in t71)
    check("test73 réaligné Task 77 (Rechercher supprimé, filtre du tableau conservé)",
          "RÉALIGNÉ Task 77" in t73 and "Filtrer le tableau par nom ou par CIN" in t73)
    check("test76 réaligné (version 0.2.24, MODIFIÉ Task 83)", '"0.2.24"' in t76)

    # --- Version + documentation ---
    check("package.json : version 0.2.24 (MODIFIÉ Task 83)", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 42 (barre + colonne supprimées, création via le tableau)",
          "## 42. Accès portail : la barre de création et la colonne « Employé » retirées" in readm
          and "enleve ce qui dans le cadre rouge" in readm
          and "test77_harnais.sh" in readm)
    check("README : note de mise à jour en tête de §38",
          "Mise à jour (section 42, version 0.2.7)" in readm)
    check("README : sections 31-41 intactes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 37. Accès portail : le TABLEAU des employés se pré-remplit AUTOMATIQUEMENT" in readm
          and "## 39. Portail employés : connexion en DEUX ÉTAPES — code OTP + QR code valables 10 minutes" in readm
          and "## 41. Portail employés : OTP obligatoire À CHAQUE connexion" in readm)

print("MD5 ZIPs :", md5s[0])
print("TASK77 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
