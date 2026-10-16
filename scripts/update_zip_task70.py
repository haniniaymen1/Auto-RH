#!/usr/bin/env python3
"""Task 70 (18/09/2026) : ACCÈS PORTAIL — LE CHAMP CIN SE REMPLIT TOUT SEUL
(100 % AUTOMATIQUE, SANS AUCUNE SAISIE NI CLIC OBLIGATOIRE) :

  1. Composant portal-access-tab.tsx : useEffect qui écrit AUTOMATIQUEMENT le
     premier employé détecté SANS accès portail dans le champ au chargement,
     puis, après chaque création, le CIN détecté suivant (enchaînement sans
     ressaisie). Puces cliquables de tous les CIN détectés (20 max + bouton
     « + N autres »), bandeau vert « CIN rempli automatiquement », bandeau
     orange « X fiches sans CIN identifiable » (compteurs API Task 70),
     suspension polie de l'écriture automatique en cas de saisie clavier.
  2. API /api/payslips/employes : NOUVEAUX compteurs fichesTotal /
     fichesSansCin (rétrocompatibles) + source S6 « valeur sur la ligne
     suivante du libellé » avec gardes anti-faux-positifs (Periode, Employe,
     libellés de bulletin) — vérifié par diag70_source_s6.mjs.
  3. AUCUN changement de sécurité : autocomplete (Task 66), tolérance
     tirets/espaces, mot de passe initial à usage unique, changement
     obligatoire, expiration 15 jours, ports 4000/4001 — inchangés.

Nouveaux :
  - scripts/test70_remplissage_auto.py (44 vérifications : statique + bundle +
    flux E2E sur COPIE de base port 4202)
  - scripts/test70_harnais.sh     (harnais portable : COPIE + admin 4202)
Remplacés :
  - src/components/payslip/portal-access-tab.tsx (remplissage 100 % auto)
  - src/app/api/payslips/employes/route.ts       (compteurs + source S6)
  - src/lib/payslip-extractor.ts                 (S6 + anti-faux-positifs)
  - scripts/test65_remplissage_auto.py           (ATTENDU API Task 70)
  - README-DEPLOIEMENT-LOCAL.md                  (section 36)
Remis en cohérence (hors archive) :
  - scripts/test_task40_securisation_auto.py : ATTENDU 255 -> 257
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 255 -> 257
Compte : 255 (état Task 69) + 2 nouveaux = 257 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70.
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
    # --- Task 70 : composant + API + extracteur + doc + test 65 remis en cohérence ---
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("src/app/api/payslips/employes/route.ts", "src/app/api/payslips/employes/route.ts", False),
    ("src/lib/payslip-extractor.ts", "src/lib/payslip-extractor.ts", False),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 70 : tests embarqués ---
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py", False),
    ("scripts/test70_harnais.sh", "scripts/test70_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 69 (elle-même bâtie sur 34->...->69)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task69.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 70 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 70 : remplissage 100 % automatique ---
    # (RÉALIGNÉ Task 77 : le champ auto-rempli a été SUPPRIMÉ avec la barre de
    # création — seuls les contrôles sont ajustés, jamais les fichiers.)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("composant : ancienne mécanique du champ ABSENTE (Task 77)",
          "REMPLISSAGE 100 % AUTOMATIQUE" in tab  # survit dans l'historique du composant
          and "setCin(prochainCinAuto.cin)" not in tab
          and "const prochainCinAuto" not in tab
          and "saisieManuelleRef" not in tab)
    # (RÉALIGNÉ Task 77 : la barre de création complète a été SUPPRIMÉE — la
    # mécanique Task 70 du champ, la recherche Task 73 et les aides Task 65 ont
    # disparu avec elle ; l'algorithme survit dans le TRI du tableau pré-rempli.)
    check("composant : mécanique du champ SUPPRIMÉE avec la barre (Task 77)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "cinAutoRempli" not in tab and 'list="auto-rh-cins-employes"' not in tab)
    check("composant : barre absente + algorithme Task 70 dans le TRI du tableau",
          "Choisir dans la liste" not in tab and "resultatsRapides" not in tab
          and "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab)
    check("composant : Task 73 — bandeau/puces toujours retirés + alerte sans CIN conservée",
          "CIN rempli automatiquement depuis" not in tab and "employes.slice(0, 20).map" not in tab
          and "aucun CIN identifiable" in tab)
    check("composant : section « Gestion des QR codes » dédiée (MODIFIÉ Task 80)",
          "Gestion des QR codes" in tab and "Réinitialiser le QR" in tab)

    # --- API + extracteur Task 70 ---
    route_ts = zz.read("src/app/api/payslips/employes/route.ts").decode("utf-8", errors="replace")
    check("API : compteurs fichesTotal/fichesSansCin + 5 sources (Task 67) + S6",
          "fichesTotal" in route_ts and "fichesSansCin" in route_ts
          and "scanLibellesCin(" in route_ts and "jetonsCinNomFichier(" in route_ts
          and "valeursCinLigneSuivante(" in route_ts)
    extr = zz.read("src/lib/payslip-extractor.ts").decode("utf-8", errors="replace")
    check("extracteur : S6 avec gardes anti-faux-positifs (Periode, Employe, deux-points)",
          "export function valeursCinLigneSuivante" in extr
          and "PERIODE092026" in extr and "PERIODE|PERIOD|EMPLOYE" in extr
          and 'ligne.includes(":")' in extr)
    t65 = zz.read("scripts/test65_remplissage_auto.py").decode("utf-8", errors="replace")
    check("test65 remis en cohérence (compteurs Task 70 dans l'ATTENDU API)",
          "fichesTotal" in t65 and "fichesSansCin" in t65)

    # --- Tests embarqués Task 70 ---
    t_py = zz.read("scripts/test70_remplissage_auto.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test70_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 70 embarqués (remplissage_auto + harnais, COPIE 4202)",
          "RÉSULTAT TASK 70" in t_py and "test70.db" in t_sh and "COPIE" in t_sh
          and "4202" in t_sh and "test65_inserer.js" in t_sh)

    # --- Documentation ---
    check("README : section 36 (champ CIN 100 % automatique)",
          "## 36. Accès portail : le champ CIN se remplit TOUT SEUL — 100 % automatique" in readm
          and "PUCES cliquables" in readm and "test70_harnais.sh" in readm)
    check("README : sections 31/32/33/34/35 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm
          and "## 34. Répertoire COMPLET des CIN depuis les données importées" in readm
          and "## 35. Champ « Mot de passe » du portail : style harmonisé avec l'image fournie" in readm)

    # --- Signaux des maillons précédents (69/66/64) toujours présents ---
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    check("(MODIFIÉ Task 85) Task 69 : style champ mot de passe toujours en place (9 + 1 règle password CSS_OTP = 10 — style .otp-code du code affiché SUPPRIMÉ)",
          portail.count("border-radius: 12px") == 10)
    check("Task 66 : autocomplete + tolérance toujours en place",
          'autocomplete="current-password"' in portail and "nettoyerMotDePasse(" in portail)
    check("Task 64 : expiration 15 jours toujours en place", portail.count("15 jours") >= 3)

print("MD5 ZIPs :", md5s[0])
print("TASK70 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
