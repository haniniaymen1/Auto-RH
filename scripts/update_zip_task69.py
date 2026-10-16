#!/usr/bin/env python3
"""Task 69 (18/09/2026) : CHAMP « MOT DE PASSE » DU PORTAIL EMPLOYÉS STYLÉ
COMME L'IMAGE FOURNIE PAR L'UTILISATEUR (fond blanc, coins arrondis, bordure
claire, masquage par points) :

  1. Page de CONNEXION : nouvelle règle CSS input[type="password"] (48px,
     fond blanc, bordure 1.5px #cbd5e1, rayon 12px, anneau émeraude au
     focus) — avant, AUCUN style ne visait ce champ (rendu navigateur brut).
  2. Harmonisation des rayons 10px -> 12px : champ CIN (connexion), champs
     mot de passe (écran de changement), champ de recherche (mes fiches) et
     boutons des trois pages — le portail entier est cohérent.
  3. AUCUN changement fonctionnel ou de sécurité : autocomplete (Task 66),
     tolérance tirets/espaces, usage unique, expiration 15 jours, ports
     4000/4001 — inchangés.

Nouveaux :
  - scripts/test69_champ_style.py (26 vérifications : statique + HTML servi
    + flux de connexion, COPIE de base port 4103)
  - scripts/test69_harnais.sh     (harnais portable : COPIE + portail 4103)
Remplacés :
  - scripts/portail-server.js     (style du champ mot de passe + harmonie)
  - README-DEPLOIEMENT-LOCAL.md   (section 35)
Remis en cohérence (hors archive) :
  - scripts/test_task40_securisation_auto.py : ATTENDU 250 -> 255
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 250 -> 255
Compte : 253 (état Task 67) + 2 nouveaux = 255 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 -> 64 -> 65 -> 66 -> 67 -> 69.
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
    # --- Task 69 : style du champ mot de passe + documentation ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    # --- Task 69 : tests embarqués ---
    ("scripts/test69_champ_style.py", "scripts/test69_champ_style.py", False),
    ("scripts/test69_harnais.sh", "scripts/test69_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 67 (elle-même bâtie sur 34->...->67)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task67.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 69 : remplacements + ajouts (sans doublons)
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

    # --- Contrôles Task 69 : style du champ mot de passe ---
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    regle_pwd = (
        'input[type="password"] {\n'
        "    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;\n"
        "    padding: 0 14px; font-size: 16px; outline: none; background: #fff;\n"
        "    transition: border-color .15s, box-shadow .15s;\n"
        "  }"
    )
    check("(MODIFIÉ Task 83) règle mot de passe 12px présente ×3 (connexion + changement + CSS_OTP/premiere)",
          portail.count(regle_pwd) == 3, portail.count(regle_pwd))
    check("(MODIFIÉ Task 83) anneau émeraude au focus ×3",
          portail.count('input[type="password"]:focus') == 3)
    check("(MODIFIÉ Task 85) 9 rayons 12px + 1 règle password CSS_OTP = 10 — le style .otp-code du code affiché est SUPPRIMÉ",
          portail.count("border-radius: 12px") == 10, portail.count("border-radius: 12px"))
    lignes_10px = [l for l in portail.splitlines() if "border-radius: 10px" in l]
    check("(MODIFIÉ Task 83) bannières .msg + bordures .note-verte restent à 10px (4 blocs CSS)",
          len(lignes_10px) == 8 and all((".msg" in l) or ("a7f3d0" in l) for l in lignes_10px), lignes_10px)

    # --- Sécurité Task 66 + mécanismes Task 64 inchangés ---
    check("(MODIFIÉ Task 83) autocomplete Task 66 conservés (œil = indentation modifiée, courant ×3, new ×4)",
          'id="password" name="password" placeholder="Votre mot de passe"' in portail
          and 'autocomplete="current-password"' in portail
          and 'id="cur" name="cur" autocomplete="current-password"' in portail
          and 'id="new" name="new" autocomplete="new-password"' in portail
          and 'id="conf" name="conf" autocomplete="new-password"' in portail
          and 'id="nouveau" name="nouveau"' in portail and 'id="repete" name="repete"' in portail)
    check("portail : tolérance tirets/espaces (Task 66) inchangée",
          "function nettoyerMotDePasse(" in portail and "verifierMotDePasseTolerant" in portail)
    check("portail : expiration 15 jours (Task 64) inchangée",
          portail.count("15 jours") >= 3)
    # (RÉALIGNÉ Task 74) le portail possède désormais une page /otp avec QR
    # code (paquet qrcode) : le QR est ATTENDU dans portail-server.js.
    check("(MODIFIÉ Task 85) portail : QR code Task 74 présent (paquet qrcode + page /otp) — AUCUN code affiché",
          'require("qrcode")' in portail and 'id="otp-affiche"' not in portail
          and 'pathname === "/otp"' in portail)

    # --- Documentation + tests embarqués Task 69 ---
    check("README : section 35 (style du champ mot de passe, image utilisateur)",
          "## 35. Champ « Mot de passe » du portail : style harmonisé avec l'image fournie" in readm
          and "rendu navigateur brut" in readm and "test69_harnais.sh" in readm)
    check("README : sections 31/32/33/34 toujours présentes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 32. Remplissage AUTOMATIQUE du CIN" in readm
          and "## 33. Champ « Mot de passe » : remplissage navigateur correct + saisie tolérante" in readm
          and "## 34. Répertoire COMPLET des CIN depuis les données importées" in readm)
    t_py = zz.read("scripts/test69_champ_style.py").decode("utf-8", errors="replace")
    t_sh = zz.read("scripts/test69_harnais.sh").decode("utf-8", errors="replace")
    check("tests Task 69 embarqués (champ_style + harnais, COPIE 4103)",
          "RÉSULTAT TASK 69" in t_py and "test69.db" in t_sh and "COPIE" in t_sh
          and "4103" in t_sh and "test66_inserer.js" in t_sh)

    # --- Signaux des maillons précédents (67/65/64) toujours présents ---
    route_ts = zz.read("src/app/api/payslips/employes/route.ts").decode("utf-8", errors="replace")
    check("Task 67 : API répertoire complet toujours en place",
          "scanLibellesCin(" in route_ts and "jetonsCinNomFichier(" in route_ts)
    # (RÉALIGNÉ Task 77 : l'onglet « Accès portail » a évolué — la barre de
    # création est supprimée, le tableau pré-rempli Task 71 est conservé ; le
    # style de la page de CONNEXION du portail reste inchangé.)
    tab = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    check("Accès portail : tableau pré-rempli conservé, barre supprimée (Task 77)",
          "interface LigneTableau" in tab and "Accès non créé" in tab
          and "Choisir dans la liste" not in tab)

print("MD5 ZIPs :", md5s[0])
print("TASK69 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
