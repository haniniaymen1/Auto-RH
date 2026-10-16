#!/usr/bin/env python3
"""Task 38/39/40/42 : évolution du contenu des 3 ZIP livrables.

Task 38 (17/09/2026) : retrait des lanceurs utilitaires encadrés par
l'administrateur (conservés dans le dépôt de développement — non-suppressif) :
  - SCINDER-FICHES-WINDOWS.bat        (migration PDF ponctuelle, Task 23)
  - SCINDER-EXCEL-WINDOWS.bat         (migration Excel ponctuelle, Task 24)
  - SCINDER-DOCX-WINDOWS.bat          (migration Word ponctuelle, Task 25)
  - SECURISER-DOSSIER-WINDOWS.bat     (permissions NTFS optionnelles)
  - SECURISER-DOSSIERS-WINDOWS.bat    (permissions + EFS optionnels)
  - SECURISER-DOSSIER-LINUX-MAC.sh    (chmod Linux/macOS optionnel)

Task 39 (17/09/2026) : SECURISER-INSCRIPTION-WINDOWS.bat, initialement compris
dans le retrait Task 38, est RÉINTÉGRÉ aux 3 ZIP à la demande de
l'administrateur (menu confort du code d'inscription, section 22) — ré-ajouté
depuis le dépôt de développement (CRLF + ASCII vérifiés automatiquement).

Task 40 (17/09/2026) : sécurisation AUTOMATIQUE des dossiers sensibles au
démarrage — répond à « Possible de faire de façon automatique sans besoin
des fichiers scripts dans zip ». Les protections NTFS/chmod des anciens
menus SECURISER-DOSSIER sont désormais appliquées par le site lui-même :
Nouveaux :
  - scripts/securiser-auto.js            (protection silencieuse icacls/chmod,
                                          idempotente, exit 0 constant)
  - scripts/test_task40_securisation_auto.py (test E2E)
Remplacés :
  - scripts/auto-rh.js          (start -> appelle securiser-auto.js)
  - PREPARER-AUTO-RH-SILENCIEUX.bat     (appel dès l'étape .env, CRLF)
  - DEMARRER-LINUX-MAC.sh                (appel après préparation .env)
  - DEMARRER-PORTAIL-LINUX-MAC.sh        (idem)
  - DEMARRER-TOUT-LINUX-MAC.sh           (idem, installation commune)
  - README-DEPLOIEMENT-LOCAL.md          (section 29 + sections 13/23/28)
Les .bat visibles Windows (DEMARRER-*.bat) ne sont PAS dans les ZIP (kit
silencieux seul) — modifiés dans le dépôt pour cohérence, sans impact
décompte.
Aucun impact fonctionnement : aucune modification de src/ ni du portail
(pas de rebuild), serveurs vérifiés après redémarrage réel.

Task 42 (17/09/2026) : UN SEUL fichier de démarrage — « on peut faire dans
un seul fichier de telle façon créer automatique raccourci au startup ».
  - DEMARRER-SILENCIEUX-WINDOWS.vbs remplacé : il crée lui-même, à CHAQUE
    lancement, le raccourci « Auto-RH - Demarrage silencieux » dans le
    dossier Démarrage (Startup) de Windows s'il manque (silencieux,
    idempotent) — son ancien double rôle (lancer + auto-démarrage) est
    documenté en README section 30 ;
  - INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs RETIRÉ de l'archive (role
    intégré au fichier unique ; conservé dans le dépôt — non-suppressif) ;
  - README-DEPLOIEMENT-LOCAL.md : section 30 + sections 9 / lanceurs / 28.
Compte : 238 (Task 40) - 1 (INSTALLER) = 237 fichiers.
Hérite de l'overlay Task 37 (exécuté d'abord : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40/42).
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

RETRAIT = [
    "SCINDER-FICHES-WINDOWS.bat",
    "SCINDER-EXCEL-WINDOWS.bat",
    "SCINDER-DOCX-WINDOWS.bat",
    "SECURISER-DOSSIER-WINDOWS.bat",
    "SECURISER-DOSSIERS-WINDOWS.bat",
    "SECURISER-DOSSIER-LINUX-MAC.sh",
    # --- Task 42 : fusion dans DEMARRER-SILENCIEUX (raccourci auto) ---
    "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs",
]

REINTEGRE = "SECURISER-INSCRIPTION-WINDOWS.bat"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test_task38_sans_lanceurs.py", "scripts/test_task38_sans_lanceurs.py", False),
    (REINTEGRE, REINTEGRE, True),
    # --- Task 40 : sécurisation automatique au démarrage ---
    ("scripts/securiser-auto.js", "scripts/securiser-auto.js", False),
    ("scripts/test_task40_securisation_auto.py", "scripts/test_task40_securisation_auto.py", False),
    ("scripts/auto-rh.js", "scripts/auto-rh.js", False),
    ("PREPARER-AUTO-RH-SILENCIEUX.bat", "PREPARER-AUTO-RH-SILENCIEUX.bat", True),
    ("DEMARRER-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", False),
    ("DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", False),
    ("DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh", False),
    # --- Task 42 : le lanceur unique (raccourci Startup automatique) ---
    ("DEMARRER-SILENCIEUX-WINDOWS.vbs", "DEMARRER-SILENCIEUX-WINDOWS.vbs", True),
]

ATTENDU = 237  # 238 (état Task 40) - INSTALLER-DEMARRAGE-AUTOMATIQUE (Task 42)


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


# 1) Overlay Task 37 d'abord (cumulatif : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task37.py")])
if r.returncode != 0:
    print("OVERLAY TASK37 EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Post-traitement : retraits + réintégration/remplacements (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = set(RETRAIT) | {arc for _, arc, _ in FILES}
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
        residus = [f for f in RETRAIT if f in names]
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        for grp, val in (("RETRAIT résiduels", residus), ("MANQUANTS", manquants)):
            if val:
                ok = False
                print(f"   {grp} : {val}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check1 = "## 28. Lanceurs utilitaires retirés de l'archive" in readm
    check1b = "a été **réintégré**" in readm
    avant28 = readm.split("## 28.")[0]
    check2 = not [f for f in RETRAIT if f in avant28]
    check3 = ("node scripts\\scinder-pdfs-multipages.js --verifier" in readm
              and "node scripts\\scinder-excel-multipages.js --verifier" in readm
              and "node scripts\\scinder-docx-multipages.js --verifier" in readm
              and "node scripts\\gen-signup-code.js" in readm
              and "icacls" in readm and "cipher /e /i" in readm)
    check3b = "double-cliquez sur `SECURISER-INSCRIPTION-WINDOWS.bat`" in avant28
    noms = set(zz.namelist())
    bat = zz.read(REINTEGRE)
    check4b = b"\r\n" in bat and bat.replace(b"\r\n", b"").isascii()
    check4 = all(c in noms for c in [
        "scripts/scinder-pdfs-multipages.js", "scripts/scinder-excel-multipages.js",
        "scripts/scinder-docx-multipages.js", "scripts/gen-signup-code.js",
        "scripts/sauvegarde-bd.js", "scripts/chiffrer-storage.js"])
    preparer = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8", errors="replace")
    check5 = "gen-signup-code.js --assurer" in preparer
    t38 = zz.read("scripts/test_task38_sans_lanceurs.py").decode("utf-8", errors="replace")
    check6 = "TASK38:" in t38
    # --- Contrôles Task 40 : sécurisation automatique au démarrage ---
    secu = zz.read("scripts/securiser-auto.js")
    check7 = (secu.isascii() and b"icacls" in secu and b"/inheritance:r" in secu
              and b"*S-1-5-18" in secu and b"*S-1-5-32-544" in secu
              and b"0o700" in secu and b"0o600" in secu and b"process.exit(0)" in secu)
    svc_zip = zz.read("scripts/auto-rh.js").decode("utf-8", errors="replace")
    check8 = "securiser-auto.js" in svc_zip and "spawnSync" in svc_zip
    prep_bytes = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat")
    check9 = (b"securiser-auto.js" in prep_bytes and b"\r\n" in prep_bytes
              and prep_bytes.replace(b"\r\n", b"").isascii())
    check10 = all(b"securiser-auto.js" in zz.read(s) for s in [
        "DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh"])
    t40 = zz.read("scripts/test_task40_securisation_auto.py").decode("utf-8", errors="replace")
    check11 = "TASK40:" in t40
    sec29 = readm.split("## 29.")[1] if "## 29." in readm else ""
    check12 = ("## 29. Sécurisation AUTOMATIQUE des dossiers au démarrage" in readm
               and "AUTO_RH_SAUT_SECURISATION" in sec29
               and "icacls" in sec29 and "chmod 700" in sec29 and "PAS automatisé" in sec29
               and readm.count("protection AUTOMATIQUE au démarrage (section 29)") >= 2
               and "Protection AUTOMATIQUE depuis le 17/09/2026 (section 29)" in readm
               and "Automatique depuis le 17/09/2026 (section 29)" in readm)
    # --- Contrôles Task 42 : un seul lanceur (raccourci Startup automatique) ---
    dem = zz.read("DEMARRER-SILENCIEUX-WINDOWS.vbs")
    check13 = (dem.replace(b"\r\n", b"").isascii()
               and b'SpecialFolders("Startup")' in dem
               and b"Auto-RH - Demarrage silencieux.lnk" in dem
               and b"CreateShortcut" in dem
               and b"TargetPath" in dem
               and b"fso.FileExists(raccourciAuto)" in dem
               and b"PREPARER-AUTO-RH-SILENCIEUX.bat" in dem
               and b"demarrage-etat.txt" in dem
               and b"localhost:3000" in dem)
    check14 = ("## 30. Un seul lanceur : démarrage + raccourci automatique" in readm
               and readm.count("INSTALLER-DEMARRAGE-AUTOMATIQUE") == 1
               and "shell:startup" in readm.split("## 30.")[1]
               and "créé\n   **automatiquement**" in readm.split("## 30.")[0]
               and "Double-cliquer sur `DEMARRER-SILENCIEUX-WINDOWS.vbs`" in readm)
    print(f"   README section 28 : {'OK' if check1 else 'KO'}")
    print(f"   README note réintégration SECURISER-INSCRIPTION : {'OK' if check1b else 'KO'}")
    print(f"   README : aucun des 7 noms retirés hors section 28 : {'OK' if check2 else 'KO'}")
    print(f"   README : instructions terminal/natives présentes : {'OK' if check3 else 'KO'}")
    print(f"   README section 22 double-clic rétabli : {'OK' if check3b else 'KO'}")
    print(f"   {REINTEGRE} réintégré CRLF+ASCII : {'OK' if check4b else 'KO'}")
    print(f"   Outils JS conservés (scinder ×3, inscription, sauvegarde, chiffrement) : {'OK' if check4 else 'KO'}")
    print(f"   Démarrage silencieux autonome (gen-signup-code --assurer) : {'OK' if check5 else 'KO'}")
    print(f"   test task38 embarqué : {'OK' if check6 else 'KO'}")
    print(f"   TASK40 securiser-auto.js embarqué (ASCII + icacls/chmod + exit 0) : {'OK' if check7 else 'KO'}")
    print(f"   TASK40 auto-rh.js intégré (spawnSync) : {'OK' if check8 else 'KO'}")
    print(f"   TASK40 PREPARER .bat remplacé (appel + CRLF+ASCII) : {'OK' if check9 else 'KO'}")
    print(f"   TASK40 3 lanceurs .sh remplacés : {'OK' if check10 else 'KO'}")
    print(f"   TASK40 test embarqué : {'OK' if check11 else 'KO'}")
    print(f"   TASK40 README section 29 + 13/23/28 à jour : {'OK' if check12 else 'KO'}")
    print(f"   TASK42 lanceur unique CRLF+ASCII (raccourci Startup auto, idempotent) : {'OK' if check13 else 'KO'}")
    print(f"   TASK42 README section 30 + INSTALLER absent avant §30 : {'OK' if check14 else 'KO'}")
    ok = ok and all([check1, check1b, check2, check3, check3b, check4, check4b,
                     check5, check6, check7, check8, check9, check10, check11, check12,
                     check13, check14])

print("MD5 ZIPs :", md5s[0])
print("TASK42 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
