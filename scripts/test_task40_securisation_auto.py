#!/usr/bin/env python3
"""Task 40 : sécurisation AUTOMATIQUE des dossiers sensibles au démarrage.

À la demande de l'administrateur (« Possible de faire de façon automatique
sans besoin des fichiers scripts dans zip ») : la protection locale assurée
par les anciens menus SECURISER-DOSSIER-* (retirés des ZIP en Task 38) est
désormais INTÉGRÉE au démarrage — plus aucun script manuel nécessaire.

Vérifications :
  A. scripts/securiser-auto.js : ASCII, commande icacls Windows fidèle à
     l'ancien menu (compte courant + SYSTEM *S-1-5-18 + Administrateurs
     *S-1-5-32-544, /inheritance:r), chmod Unix 700/600, toujours exit 0,
     échappatoire AUTO_RH_SAUT_SECURISATION.
  B. Comportement réel : exécution dans un bac à sable (cibles factices),
     modes appliqués, journal logs/securisation-auto.log, idempotence,
     option --etat, cible absente tolérée.
  C. Intégration à la chaîne de démarrage (dépôt) : auto-rh.js,
     PREPARER-AUTO-RH-SILENCIEUX.bat (CRLF+ASCII), .bat visibles Windows,
     3 lanceurs Linux/macOS.
  D. Effet RÉEL constaté après redémarrage du service : journal créé,
     .env 600, db/storage/logs 700 sur le dépôt de développement.
  E. ZIP livrables : 237 fichiers (Task 42 : - INSTALLER-DEMARRAGE-AUTOMATIQUE),
     3 ZIP identiques (MD5), securiser-auto.js
     embarqué (ASCII), auto-rh.js et lanceurs remplacés,
     README section 29 + tableau 28 mis à jour, retraits Task 38 toujours
     absents, SECURISER-INSCRIPTION toujours présent.
  F. Régressions : admin 4000 + portail 4001 servis, connexion IT OK.
"""
import hashlib
import json
import os
import shutil
import stat as statmod
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import http.cookiejar
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
resultats = []
IS_WIN = sys.platform == "win32"

RETRAIT = [
    "SCINDER-FICHES-WINDOWS.bat",
    "SCINDER-EXCEL-WINDOWS.bat",
    "SCINDER-DOCX-WINDOWS.bat",
    "SECURISER-DOSSIER-WINDOWS.bat",
    "SECURISER-DOSSIERS-WINDOWS.bat",
    "SECURISER-DOSSIER-LINUX-MAC.sh",
]
REINTEGRE = "SECURISER-INSCRIPTION-WINDOWS.bat"

ZIPS = [
    os.path.join(BASE, "download", "auto-rh-scripts-site-web.zip"),
    os.path.join(BASE, "download", "Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download", "auto-rh.zip"),
]
ATTENDU = 306  # (MODIFIÉ Task 93) 304 (état Task 92) + 2 fichiers Task 93 (test93_code_activation_diag + launcher_task93)


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
    req = urllib.request.Request(url, headers={"User-Agent": "task40-test"})
    with urllib.request.urlopen(req, timeout=timeout) as rep:
        return rep.status, rep.read().decode("utf-8", errors="replace")


def mode_of(p):
    return statmod.S_IMODE(os.stat(p).st_mode)


# ---- A. Le script de sécurisation automatique ----
sec_path = os.path.join(BASE, "scripts", "securiser-auto.js")
sec = open(sec_path, "rb").read() if os.path.exists(sec_path) else b""
check("securiser-auto.js existe et est ASCII pur", bool(sec) and sec.isascii())
check("commande Windows fidèle à l'ancien menu (icacls + héritage coupé + SIDs SYSTEM/Admin)",
      all(x in sec for x in [b"icacls", b"/inheritance:r", b"(OI)(CI)F",
                             b"*S-1-5-18", b"*S-1-5-32-544"]))
check("chmod Unix 700 dossiers / 600 fichiers sensibles",
      b"0o700" in sec and b"0o600" in sec)
check("ne bloque JAMAIS le démarrage (exit 0 constant)", b"process.exit(0)" in sec)
check("échappatoire support AUTO_RH_SAUT_SECURISATION", b"AUTO_RH_SAUT_SECURISATION" in sec)
check("option d'état --etat", b"--etat" in sec)

# ---- B. Comportement réel dans un bac à sable ----
try:
    bac = tempfile.mkdtemp(prefix="task40-secu-")
    os.makedirs(os.path.join(bac, "scripts"))
    for d in ["db", os.path.join("storage", "payslips"), "backups"]:
        os.makedirs(os.path.join(bac, d))
    with open(os.path.join(bac, ".env"), "w") as f:
        f.write("DATABASE_URL=file:/x/db/custom.db\nAUTO_RH_STORAGE_KEY=abc\n")
    with open(os.path.join(bac, "db", "custom.db"), "w") as f:
        f.write("x")
    shutil.copyfile(sec_path, os.path.join(bac, "scripts", "securiser-auto.js"))

    p1 = subprocess.run(["node", os.path.join("scripts", "securiser-auto.js")],
                        cwd=bac, capture_output=True, text=True, timeout=60)
    check("exécution sandbox : exit 0", p1.returncode == 0, p1.stdout.strip()[:80])
    if not IS_WIN:
        check("sandbox : .env verrouillé 600", mode_of(os.path.join(bac, ".env")) == 0o600)
        check("sandbox : db verrouillé 700", mode_of(os.path.join(bac, "db")) == 0o700)
        check("sandbox : storage verrouillé 700", mode_of(os.path.join(bac, "storage")) == 0o700)
        check("sandbox : storage/payslips verrouillé 700",
              mode_of(os.path.join(bac, "storage", "payslips")) == 0o700)
        check("sandbox : backups verrouillé 700", mode_of(os.path.join(bac, "backups")) == 0o700)
        check("sandbox : base custom.db verrouillée 600",
              mode_of(os.path.join(bac, "db", "custom.db")) == 0o600)
        check("sandbox : logs verrouillés 700 (créés par le journal)",
              mode_of(os.path.join(bac, "logs")) == 0o700)
    journal = os.path.join(bac, "logs", "securisation-auto.log")
    check("journal securisation-auto.log créé avec lignes OK",
          os.path.exists(journal) and "OK : db" in open(journal, encoding="utf-8", errors="replace").read())

    p2 = subprocess.run(["node", os.path.join("scripts", "securiser-auto.js")],
                        cwd=bac, capture_output=True, text=True, timeout=60)
    check("idempotence : 2e passe exit 0 sans erreur", p2.returncode == 0)

    p3 = subprocess.run(["node", os.path.join("scripts", "securiser-auto.js"), "--etat"],
                        cwd=bac, capture_output=True, text=True, timeout=60)
    check("option --etat fonctionne (exit 0)", p3.returncode == 0 and "Etat de la securisation" in p3.stdout)

    shutil.rmtree(os.path.join(bac, "backups"))
    p4 = subprocess.run(["node", os.path.join("scripts", "securiser-auto.js")],
                        cwd=bac, capture_output=True, text=True, timeout=60)
    check("cible absente tolérée (exit 0, 'absent' compté)",
          p4.returncode == 0 and "absent(s)" in p4.stdout)
    shutil.rmtree(bac, ignore_errors=True)
except Exception as e:  # pragma: no cover
    check("bloc sandbox exécuté sans exception", False, repr(e))

# ---- C. Intégration à la chaîne de démarrage (dépôt) ----
svc = open(os.path.join(BASE, "scripts", "auto-rh.js"), encoding="utf-8", errors="replace").read()
check("auto-rh.js appelle securiser-auto.js au start (spawnSync)",
      "securiser-auto.js" in svc and "spawnSync" in svc)

prep = open(os.path.join(BASE, "PREPARER-AUTO-RH-SILENCIEUX.bat"), "rb").read()
check("PREPARER-AUTO-RH-SILENCIEUX.bat : appel ajouté (CRLF + ASCII)",
      b"securiser-auto.js" in prep and b"\r\n" in prep and prep.replace(b"\r\n", b"").isascii())

for bat in ["DEMARRER-WINDOWS.bat", "DEMARRER-PORTAIL-WINDOWS.bat"]:
    contenu = open(os.path.join(BASE, bat), "rb").read()
    check(f"{bat} (dépôt) : appel ajouté", b"securiser-auto.js" in contenu)

for sh in ["DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh"]:
    contenu = open(os.path.join(BASE, sh), encoding="utf-8", errors="replace").read()
    check(f"{sh} : appel ajouté", "securiser-auto.js" in contenu)

# ---- D. Effet RÉEL constaté sur le dépôt (service redémarré pendant la tâche) ----
journal_reel = os.path.join(BASE, "logs", "securisation-auto.log")
check("effet réel : journal de sécurisation présent après redémarrage",
      os.path.exists(journal_reel) and "OK" in open(journal_reel, encoding="utf-8", errors="replace").read())
if not IS_WIN:
    check("effet réel : .env du dépôt verrouillé 600", mode_of(os.path.join(BASE, ".env")) == 0o600)
    check("effet réel : db du dépôt verrouillé 700", mode_of(os.path.join(BASE, "db")) == 0o700)
    check("effet réel : storage du dépôt verrouillé 700", mode_of(os.path.join(BASE, "storage")) == 0o700)
    check("effet réel : logs du dépôt verrouillés 700", mode_of(os.path.join(BASE, "logs")) == 0o700)

# ---- E. ZIP livrables ----
md5s = [md5(z) for z in ZIPS]
for z, empreinte in zip(ZIPS, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        noms = set(liste)
        base_ok = (bad is None and len(liste) == ATTENDU and len(liste) == len(noms)
                   and empreinte == md5s[0])
        residus = [f for f in RETRAIT if f in noms]
        check(f"{os.path.basename(z)} : intégrité + {ATTENDU} fichiers + sans doublons + identique (3 ZIP)",
              base_ok, f"n={len(liste)} residus={residus} md5={empreinte[:8]}")
        check(f"{os.path.basename(z)} : retraits Task 38 toujours absents + .bat inscription présent",
              not residus and REINTEGRE in noms)

with zipfile.ZipFile(ZIPS[0]) as zz:
    noms = set(zz.namelist())
    sec_zip = zz.read("scripts/securiser-auto.js")
    check("ZIP : securiser-auto.js embarqué ASCII", sec_zip.isascii() and b"icacls" in sec_zip)
    try:
        t40 = zz.read("scripts/test_task40_securisation_auto.py").decode("utf-8", errors="replace")
        check("ZIP : test task40 embarqué", "TASK40:" in t40)
    except KeyError:
        check("ZIP : test task40 embarqué", False, "absent")
    svc_zip = zz.read("scripts/auto-rh.js").decode("utf-8", errors="replace")
    check("ZIP : auto-rh.js remplace (intégration présente)",
          "securiser-auto.js" in svc_zip and "spawnSync" in svc_zip)
    prep_zip = zz.read("PREPARER-AUTO-RH-SILENCIEUX.bat")
    check("ZIP : PREPARER remplacé (appel + CRLF + ASCII)",
          b"securiser-auto.js" in prep_zip and b"\r\n" in prep_zip
          and prep_zip.replace(b"\r\n", b"").isascii())
    shs_ok = all(b"securiser-auto.js" in zz.read(s)
                 for s in ["DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh",
                           "DEMARRER-TOUT-LINUX-MAC.sh"])
    check("ZIP : 3 lanceurs Linux/macOS remplacés (appel présent)", shs_ok)
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    check("ZIP README : section 29 présente",
          "## 29. Sécurisation AUTOMATIQUE des dossiers au démarrage" in readm)
    check("ZIP README : section 29 décrit automatisme + icacls/chmod + EFS manuel",
          "scripts\\securiser-auto.js" in readm.split("## 29.")[1]
          and "icacls" in readm.split("## 29.")[1] and "chmod 700" in readm.split("## 29.")[1]
          and "PAS automatisé" in readm.split("## 29.")[1])
    check("ZIP README : tableau 28 pointe vers la protection automatique",
          readm.count("protection AUTOMATIQUE au démarrage (section 29)") >= 2)
    check("ZIP README : section 13 annonce la protection automatique",
          "Protection AUTOMATIQUE depuis le 17/09/2026 (section 29)" in readm)
    check("ZIP README : section 23 renvoie à l'automatique",
          "Automatique depuis le 17/09/2026 (section 29)" in readm)

# ---- F. Régressions serveurs ----
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
print(f"TASK40: {total_ok}/{len(resultats)} vérifications OK")
sys.exit(0 if all(resultats) else 1)
