#!/usr/bin/env python3
"""Task 42 : UN SEUL fichier de démarrage — raccourci Startup créé AUTOMATIQUEMENT.

Demande : « on peut faire dans un seul fichier de telle façon créer
automatique raccourci au startup ».

Le rôle de l'ancien INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs est intégré
à DEMARRER-SILENCIEUX-WINDOWS.vbs : à CHAQUE lancement, il vérifie le
raccourci « Auto-RH - Demarrage silencieux » dans le dossier Démarrage
(Startup) de Windows et le crée automatiquement s'il manque (silencieux,
idempotent), avant de démarrer le site en arrière-plan comme avant.

Vérifications :
  A. DEMARRER-SILENCIEUX-WINDOWS.vbs (dépôt) : ASCII + CRLF, logique de
     création automatique du raccourci (SpecialFolders("Startup"),
     CreateShortcut, TargetPath vers lui-même, garde d'idempotence,
     états « ACTIVE (raccourci cree automatiquement) » / « DEJA ACTIF »),
     et le démarrage historique inchangé (PREPARER caché, attente
     demarrage-etat.txt, ouverture du navigateur, rappels ARRETER/ETAT).
  B. Non-suppressif : INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs existe
     toujours dans le dépôt de développement.
  C. ZIP livrables : 237 fichiers, 3 ZIP identiques (MD5), INSTALLER
     ABSENT, lanceur unique PRÉSENT (CRLF + ASCII, logique raccourci),
     SECURISER-INSCRIPTION et securiser-auto.js toujours embarqués.
  D. README embarqué : section 30 présente, INSTALLER cité UNE seule fois
     (dans la section 30), section 9 = création automatique, tableau
     « 4 fichiers à double-clic », référence historique conservée.
  E. Régressions : admin (3000) + portail (3001) servis, connexion IT OK.
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import http.cookiejar
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
resultats = []

DEM = "DEMARRER-SILENCIEUX-WINDOWS.vbs"
INSTALLER = "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs"
RACCOURCI = "Auto-RH - Demarrage silencieux.lnk"

ZIPS = [
    os.path.join(BASE, "download", "auto-rh-scripts-site-web.zip"),
    os.path.join(BASE, "download", "Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download", "auto-rh.zip"),
]
ATTENDU = 237  # 238 (Task 40) - INSTALLER (Task 42)


def check(libelle, ok, detail=""):
    resultats.append(ok)
    print(("OK " if ok else "KO ") + libelle + ((" — " + str(detail)[:120]) if detail else ""))


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def page(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "task42-test"})
    with urllib.request.urlopen(req, timeout=timeout) as rep:
        return rep.status, rep.read().decode("utf-8", errors="replace")


# ---- A. Le fichier unique (dépôt) ----
chemin_dem = os.path.join(BASE, DEM)
dem = open(chemin_dem, "rb").read()
sans_crlf = dem.replace(b"\r\n", b"")
check("lanceur unique ASCII pur + CRLF", sans_crlf.isascii() and b"\r\n" in dem)
check("raccourci : dossier Démarrage ciblé (SpecialFolders Startup)",
      b'SpecialFolders("Startup")' in dem)
check("raccourci : nom exact « Auto-RH - Demarrage silencieux.lnk »",
      RACCOURCI.encode() in dem)
check("raccourci : création via CreateShortcut + TargetPath vers lui-même",
      b"CreateShortcut" in dem
      and b'lienAuto.TargetPath = fso.BuildPath(dossier, "' + DEM.encode() + b'")' in dem)
check("raccourci : idempotent (aucun effet s'il existe déjà)",
      b"If fso.FileExists(raccourciAuto) Then" in dem)
check("raccourci : état ACTIVE (cree automatiquement) / DEJA ACTIF signalés",
      b"ACTIVE (raccourci cree automatiquement)" in dem
      and b"DEJA ACTIF (raccourci present)" in dem)
check("raccourci : état rappelé dans la popup de confirmation",
      b"Demarrage automatique a l'allumage du PC : " in dem)
check("échec de création toléré (jamais bloquant)",
      b"Err.Clear" in dem and b"non configure (creez le raccourci manuellement : shell:startup)" in dem)
check("démarrage historique inchangé (PREPARER caché + attente état + navigateur)",
      b"PREPARER-AUTO-RH-SILENCIEUX.bat" in dem
      and b"demarrage-etat.txt" in dem
      and b"http://localhost:3000" in dem)
check("rappels ARRETER / ETAT conservés",
      b"ARRETER-SILENCIEUX-WINDOWS.vbs" in dem and b"ETAT-SILENCIEUX-WINDOWS.vbs" in dem)

# ---- B. Non-suppressif ----
check("INSTALLER conservé dans le dépôt (principe non-suppressif)",
      os.path.isfile(os.path.join(BASE, INSTALLER)))

# ---- C. ZIP livrables ----
md5s = [md5(z) for z in ZIPS]
for z, empreinte in zip(ZIPS, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        noms = set(liste)
        base_ok = (bad is None and len(liste) == ATTENDU and len(liste) == len(noms)
                   and INSTALLER not in noms and DEM in noms
                   and empreinte == md5s[0])
        if DEM in noms:
            contenu = zz.read(DEM)
            base_ok = base_ok and contenu.replace(b"\r\n", b"").isascii() \
                and b'SpecialFolders("Startup")' in contenu and b"\r\n" in contenu \
                and RACCOURCI.encode() in contenu
        check(f"{os.path.basename(z)} : intégrité + {ATTENDU} fichiers + sans doublons + "
              f"INSTALLER absent + lanceur unique (raccourci auto) + identique (3 ZIP)",
              base_ok, f"n={len(liste)} md5={empreinte[:8]}")

with zipfile.ZipFile(ZIPS[0]) as zz:
    noms = set(zz.namelist())
    check("SECURISER-INSCRIPTION-WINDOWS.bat toujours embarqué",
          "SECURISER-INSCRIPTION-WINDOWS.bat" in noms)
    check("securiser-auto.js toujours embarqué (protection automatique)",
          "scripts/securiser-auto.js" in noms)
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")

    # ---- D. README embarqué ----
    check("README : section 30 présente (un seul lanceur)",
          "## 30. Un seul lanceur : démarrage + raccourci automatique (17/09/2026)" in readm)
    avant30 = readm.split("## 30.")[0]
    check("README : INSTALLER cité une seule fois, uniquement dans la section 30",
          readm.count(INSTALLER) == 1 and INSTALLER not in avant30)
    check("README : section 9 = création automatique du raccourci",
          "créé\n   **automatiquement**" in readm and "shell:startup" in readm)
    check("README : tableau quotidien « 4 fichiers à double-clic »",
          "### Utilisation quotidienne (4 fichiers à double-clic)" in readm
          and INSTALLER not in readm.split("## 28.")[0].split("### Utilisation quotidienne")[1].split("## ")[0])
    check("README : référence historique « Double-cliquer sur DEMARRER-SILENCIEUX » conservée",
          "Double-cliquer sur `DEMARRER-SILENCIEUX-WINDOWS.vbs`" in readm)
    check("README : désactivation documentée (suppression du raccourci)",
          "Win + R` → `shell:startup" in readm.replace("«", "`").replace("»", "`")
          or "Win + R` -> `shell:startup" in readm)

# ---- E. Régressions ----
st, _ = page("http://localhost:3000/login")
check("site administration servi (3000)", st == 200, f"{st}")
st, _ = page("http://localhost:3001/")
check("portail servi (3001)", st == 200, f"{st}")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    "http://localhost:3000/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234", "remember": False}).encode(),
    method="POST", headers={"Content-Type": "application/json"},
)
try:
    with opener.open(req, timeout=30) as rep:
        st = rep.status
except urllib.error.HTTPError as e:
    st = e.code
check("connexion IT fonctionne toujours", st == 200, f"{st}")

total_ok = sum(resultats)
print(f"TASK42: {total_ok}/{len(resultats)} vérifications OK")
sys.exit(0 if all(resultats) else 1)
