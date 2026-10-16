#!/usr/bin/env python3
"""Task 38/39/42 : retrait des lanceurs utilitaires encadrés par l'administrateur.

Les 7 utilitaires optionnels suivants sont retirés des 3 ZIP livrables,
SANS impact sur le fonctionnement (migrations devenues automatiques à
l'import, protections OS optionnelles, fusion du lanceur unique) :

  - SCINDER-FICHES-WINDOWS.bat       (Task 23, migration ponctuelle PDF)
  - SCINDER-EXCEL-WINDOWS.bat        (Task 24, migration ponctuelle Excel)
  - SCINDER-DOCX-WINDOWS.bat         (Task 25, migration ponctuelle Word)
  - SECURISER-DOSSIER-WINDOWS.bat    (permissions NTFS optionnelles)
  - SECURISER-DOSSIERS-WINDOWS.bat   (permissions + EFS optionnels)
  - SECURISER-DOSSIER-LINUX-MAC.sh   (chmod Linux/macOS optionnel)
  - INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs (Task 42 : rôle intégré à
    DEMARRER-SILENCIEUX-WINDOWS.vbs qui crée le raccourci Startup lui-même,
    README section 30)

Task 39 (17/09/2026) : SECURISER-INSCRIPTION-WINDOWS.bat, initialement
compris dans le retrait Task 38, est RÉINTÉGRÉ aux 3 ZIP à la demande de
l'administrateur (menu confort du code d'inscription, section 22).

Vérifications :
  A. Les 7 fichiers sont ABSENTS des 3 ZIP ; SECURISER-INSCRIPTION-WINDOWS.bat
     est PRÉSENT (CRLF + ASCII) ; les outils JS conservés
     (scinder-*.js, gen-signup-code.js, sauvegarde-bd.js, chiffrer-storage.js)
     restent présents ; le démarrage silencieux appelle toujours
     gen-signup-code.js --assurer tout seul.
  B. README embarqué : section 28 présente (retraits + note de
     réintégration), AUCUN des 7 noms en dehors de la section 28
     (instructions remplacées par les commandes natives/terminal).
  C. Les 3 ZIP sont identiques (MD5) et intègres.
  D. Régressions : serveurs admin (4000) et portail (4001) servent leurs
     pages, connexion administration fonctionnelle.
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

RETRAIT = [
    "SCINDER-FICHES-WINDOWS.bat",
    "SCINDER-EXCEL-WINDOWS.bat",
    "SCINDER-DOCX-WINDOWS.bat",
    "SECURISER-DOSSIER-WINDOWS.bat",
    "SECURISER-DOSSIERS-WINDOWS.bat",
    "SECURISER-DOSSIER-LINUX-MAC.sh",
    "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs",  # Task 42 : fusion lanceur unique
]

REINTEGRE = "SECURISER-INSCRIPTION-WINDOWS.bat"

CONSERVES = [
    "scripts/scinder-pdfs-multipages.js",
    "scripts/scinder-excel-multipages.js",
    "scripts/scinder-docx-multipages.js",
    "scripts/gen-signup-code.js",
    "scripts/sauvegarde-bd.js",
    "scripts/chiffrer-storage.js",
]

ZIPS = [
    os.path.join(BASE, "download", "auto-rh-scripts-site-web.zip"),
    os.path.join(BASE, "download", "Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download", "auto-rh.zip"),
]


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
    req = urllib.request.Request(url, headers={"User-Agent": "task38-test"})
    with urllib.request.urlopen(req, timeout=timeout) as rep:
        return rep.status, rep.read().decode("utf-8", errors="replace")


# ---- A. ZIP principal : retraits + capacités conservées ----
z1 = ZIPS[0]
with zipfile.ZipFile(z1) as zz:
    noms = set(zz.namelist())
    for f in RETRAIT:
        check(f"retiré du ZIP : {f}", f not in noms)
    bat = zz.read(REINTEGRE)
    check(f"réintégré au ZIP : {REINTEGRE} (CRLF + ASCII)",
          b"\r\n" in bat and bat.replace(b"\r\n", b"").isascii())
    for c in CONSERVES:
        if c not in noms:
            check(f"outil conservé présent : {c}", False)
    check("outils JS de scindage conservés (scinder-*.js)",
          all(c in noms for c in CONSERVES[:3]))
    check("outils inscription/sauvegarde/chiffrement conservés",
          all(c in noms for c in CONSERVES[3:]))
    preparer = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8", errors="replace")
    check("démarrage silencieux autonome (gen-signup-code.js --assurer appelé)",
          "gen-signup-code.js --assurer" in preparer)
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check("README : section 28 présente", "## 28. Lanceurs utilitaires retirés de l'archive" in readm)
    check("README : note de réintégration SECURISER-INSCRIPTION",
          "a été **réintégré**" in readm)
    avant28 = readm.split("## 28.")[0]
    residuels = [f for f in RETRAIT if f in avant28]
    check("README : aucun des 7 noms hors section 28 (instructions remplacées)",
          not residuels, ", ".join(residuels))
    check("README : double-clic SECURISER-INSCRIPTION rétabli (section 22)",
          "double-cliquez sur `SECURISER-INSCRIPTION-WINDOWS.bat`" in avant28)
    check("README : instructions terminal de remplacement présentes",
          "node scripts\\scinder-pdfs-multipages.js --verifier" in readm
          and "node scripts\\gen-signup-code.js" in readm
          and "icacls" in readm)
    try:
        test38 = zz.read("scripts/test_task38_sans_lanceurs.py").decode("utf-8", errors="replace")
        check("test task38 embarqué", "TASK38:" in test38)
    except KeyError:
        check("test task38 embarqué", False, "absent du ZIP")

# ---- B/C. Les 3 ZIP : intégrité, retraits, identité MD5 ----
md5s = [md5(z) for z in ZIPS]
for z, empreinte in zip(ZIPS[1:], md5s[1:]):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        noms_z = set(zz.namelist())
        absents = [f for f in RETRAIT if f in noms_z]
        check(f"{os.path.basename(z)} : intégrité + 7 retraits + .bat réintégré + identique au ZIP principal",
              bad is None and not absents and REINTEGRE in noms_z and empreinte == md5s[0],
              f"absents={absents} md5={empreinte[:8]}")

# ---- D. Régressions : serveurs et connexion ----
st, _ = page("http://localhost:4000/login")
check("site administration servi (4000)", st == 200, f"{st}")
st, _ = page("http://localhost:4001/")
check("portail servi (4001)", st == 200, f"{st}")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    "http://localhost:4000/api/auth/login",
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
print(f"TASK38: {total_ok}/{len(resultats)} vérifications OK")
sys.exit(0 if all(resultats) else 1)
