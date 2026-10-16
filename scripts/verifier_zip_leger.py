#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VÉRIFICATEUR DU ZIP LÉGER — AutoRH / Auto-RH
Vérifie download/auto-rh-scripts-site-web-v<VERSION>-leger.zip :
  1.  Intégrité de l'archive (aucun CRC erroné) + unicité des entrées
  2.  Correspondance EXACTE du contenu : liste attendue (src, scripts, prisma,
      public, test-data, ocr-data, home + fichiers racine) MOINS les exclusions
      documentées = contenu de l'archive (ni manquant, ni inattendu)
  3.  Garde anti-régression : les 711 fichiers de référence v0.2.138 SAUF
      scripts/fiches_1000.json (exclu) sont tous présents (710/710)
  4.  Exclusions réellement ABSENTES (PPTX, anciens readmes, fixtures,
      médias de diagnostic)
  5.  Dépendances fonctionnelles PRÉSENTES (ocr-data, formation PDF, readme)
  6.  Marqueurs v0.2.143 (unification signature doc-réponse) + version
  7.  Modules signature/tampon/QR + workflow e-mail + lanceurs présents
Usage : python3 scripts/verifier_zip_leger.py [0.2.143]
"""
import sys, zipfile, hashlib, re, os
from pathlib import Path

PROJET = Path("/home/z/my-project")
VERSION = sys.argv[1] if len(sys.argv) > 1 else "0.2.143"
ZIP = PROJET / f"download/auto-rh-scripts-site-web-v{VERSION}-leger.zip"

EXCLUSIONS = [
    "servicerh-guide-utilisation-employe.pptx",
    "servicerh-guide-utilisation-it.pptx",
    "servicerh-guide-utilisation-rh.pptx",
    "servicerh-guide-utilisation-superadmin.pptx",
    "servicerh-readme-technique-v0.2.133.pdf",
    "servicerh-readme-technique-reduit.pdf",
    "servicerh-readme-technique-reduit-v0.2.134.pdf",
    "scripts/fiches_1000.json",
    "scripts/fixtures_multi/archive_fiches.zip",
    "scripts/fixtures_multi/fiche_image.png",
    "scripts/diag_render_p1.png",
    "scripts/ocr_test_fiche.png",
    "scripts/ocr_test_fiche_image.pdf",
    "scripts/nouveau_p1_hd.png",
    "scripts/nouveau_p2_hd.png",
    "scripts/nouveau_p1.png",
    "scripts/render_A_page1.png",
    "scripts/font_test_bold_48px_LXGW_WenKai.png",
    "scripts/font_test_bold_48px_DejaVu_Sans.png",
    "scripts/spec_header.png",
    "scripts/ancien_p1.png",
    "scripts/regen_p1.png",
    "scripts/regen_p500.png",
]

RACINE = [
    ".dockerignore", ".env.example", "Caddyfile", "Dockerfile",
    "docker-compose.yml", "components.json", "eslint.config.mjs",
    "next.config.ts", "package.json", "package-lock.json", "postcss.config.mjs",
    "tailwind.config.ts", "tsconfig.json", "README-DEPLOIEMENT-LOCAL.md",
    "VERSION",
    "ARRETER-SILENCIEUX-WINDOWS.vbs", "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs",
    "CHIFFRER-FICHES-WINDOWS.bat", "CREER-SUPERADMIN-WINDOWS.bat",
    "DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh",
    "DEMARRER-PORTAIL-WINDOWS.bat", "DEMARRER-SILENCIEUX-WINDOWS.vbs",
    "DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-WINDOWS.bat",
    "DEMARRER-WINDOWS.bat", "ETAT-SILENCIEUX-WINDOWS.vbs",
    "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs", "JOURNAUX-SILENCIEUX-WINDOWS.vbs",
    "PREPARER-AUTO-RH-SILENCIEUX.bat", "SAUVEGARDER-BD-WINDOWS.bat",
    "SCINDER-DOCX-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat",
    "SCINDER-FICHES-WINDOWS.bat", "SECURISER-DOSSIER-LINUX-MAC.sh",
    "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat",
    "auto-rh-readme-technique.pdf", "servicerh-readme-technique.pdf",
    "servicerh-support-formation-rh.pdf",
]

DOSSIERS = ["src", "scripts", "prisma", "public", "test-data", "ocr-data", "home"]

CONTROLEURS = [
    # (libellé, chemin, marqueur de contenu attendu ou None)
    ("Schéma Prisma + champs doc-réponse v0.2.143", "prisma/schema.prisma", "docElecActif"),
    ("Moteur tampon partagé JS (jeton HMAC)", "scripts/tampon-document.js", "jetonReponse"),
    ("Document acceptation unifié", "scripts/document-acceptation.js", "chargerConfig"),
    ("Document refus délégué", "scripts/document-refus.js", None),
    ("Panneau doc-signer (aperçu interactif)", "src/components/payslip/doc-signer-panel.tsx", "apercu"),
    ("Aperçu positionnement partagé Import/Réponses", "src/components/payslip/apercu-positionnement.tsx", None),
    ("Moteur signature fiches (stamp.ts)", "src/lib/stamp.ts", None),
    ("Crypto signature", "src/lib/signature-crypto.ts", None),
    ("Signature PAdES", "src/lib/signature-pades.ts", None),
    ("Config doc-signer API", "src/app/api/doc-signer-config/route.ts", None),
    ("Workflow e-mail portail (décision congé)", "scripts/portail-server.js", "envoyerEmailDecisionConge"),
    ("OCR fonctionnel (dépendance conservée)", "src/lib/payslip-ocr.ts", "fra.traineddata"),
    ("Configuration env exemple", ".env.example", None),
    ("README déploiement local", "README-DEPLOIEMENT-LOCAL.md", None),
]

resultats = []

def ctrl(nom, ok, detail=""):
    resultats.append((nom, ok, detail))
    print(f"  {'OK ' if ok else 'FAIL'} {nom}{(' — ' + detail) if detail else ''}")

print(f"Vérification du ZIP léger : {ZIP.name}")
print("=" * 78)

# 1) Intégrité + unicité -----------------------------------------------------
try:
    zf = zipfile.ZipFile(ZIP)
    corr = zf.testzip()
    noms = zf.namelist()
    ctrl("Intégrité ZIP (CRC de toutes les entrées)", corr is None,
         f"{len(noms)} entrées")
    ctrl("Unicité des entrées (aucun doublon)",
         len(noms) == len(set(noms)))
except Exception as e:
    ctrl("Ouverture du ZIP", False, str(e))
    for nom, _, _ in CONTROLEURS:
        resultats.append((nom, False, ""))
    _fin = 1
    print("=" * 78)
    echoues = [n for n, ok, _ in resultats if not ok]
    print(f"RÉSULTAT : {len(resultats) - len(echoues)}/{len(resultats)} contrôles OK — {len(echoues)} ÉCHEC(S)")
    sys.exit(1)

ensemble_zip = set(noms)

# 2) Contenu exact attendu ---------------------------------------------------
attendu = set(RACINE)
for d in DOSSIERS:
    for p in (PROJET / d).rglob("*"):
        if p.is_file():
            attendu.add(str(p.relative_to(PROJET)))
attendu -= set(EXCLUSIONS)
manquants = sorted(attendu - ensemble_zip)
inattendus = sorted(ensemble_zip - attendu)
ctrl("Contenu EXACT (attendu = projet − exclusions ; ni manquant ni inattendu)",
     not manquants and not inattendus,
     "" if not (manquants or inattendus)
     else f"{len(manquants)} manquant(s) {manquants[:3]}… / {len(inattendus)} inattendu(s) {inattendus[:3]}…")

# 3) Garde anti-régression v0.2.138 (711 - fiches_1000.json) -----------------
ref = [l.strip() for l in
       (PROJET / "scripts/reference-v0.2.138-fichiers.txt").read_text().splitlines()
       if l.strip()]
ref_attendus = [f for f in ref if f != "scripts/fiches_1000.json"]
ref_manquants = [f for f in ref_attendus if f not in ensemble_zip]
ctrl("Garde anti-régression : référence v0.2.138 (711 − 1 exclu = 710)",
     not ref_manquants, f"{len(ref_attendus) - len(ref_manquants)}/{len(ref_attendus)} présents")

# 4) Exclusions réellement absentes ------------------------------------------
presents = [f for f in EXCLUSIONS if f in ensemble_zip]
ctrl("Exclusions légères toutes ABSENTES de l'archive (23 fichiers)",
     not presents, "absentes : oui" if not presents else f"encore présents : {presents}")

# 5) Dépendances fonctionnelles conservées -----------------------------------
fonctionnels = ["ocr-data/fra.traineddata", "servicerh-support-formation-rh.pdf",
                "auto-rh-readme-technique.pdf", "servicerh-readme-technique.pdf",
                "package-lock.json"]
absents = [f for f in fonctionnels if f not in ensemble_zip]
ctrl("Dépendances fonctionnelles PRÉSENTES (OCR, formation, readmes, lock)",
     not absents, "5/5" if not absents else f"absents : {absents}")

# 6) Version ------------------------------------------------------------------
# NB : le fichier VERSION porte historiquement le préfixe « v » (v0.2.143)
version_fic = zf.read("VERSION").decode().strip().lstrip("v")
pkg = zf.read("package.json").decode()
m = re.search(r'"version"\s*:\s*"([^"]+)"', pkg)
pkg_version = m.group(1) if m else "?"
ctrl(f"VERSION = {VERSION} (VERSION + package.json)",
     version_fic == VERSION and pkg_version == VERSION,
     f"VERSION={version_fic}, package.json={pkg_version}")

# 7) Marqueurs code (unification v0.2.143 + workflow) -------------------------
for nom, chemin, marqueur in CONTROLEURS:
    if chemin not in ensemble_zip:
        ctrl(nom, False, f"{chemin} ABSENT de l'archive")
        continue
    if marqueur is None:
        ctrl(nom, True, chemin)
    else:
        try:
            contenu = zf.read(chemin).decode("utf-8", "ignore")
            ctrl(nom, marqueur in contenu, f"« {marqueur} » dans {chemin}")
        except Exception as e:
            ctrl(nom, False, str(e))

# Bilan -----------------------------------------------------------------------
taille = ZIP.stat().st_size
md5 = hashlib.md5(ZIP.read_bytes()).hexdigest()
complet = PROJET / f"download/auto-rh-scripts-site-web-v{VERSION}.zip"
t_complet = complet.stat().st_size if complet.exists() else 0
gain = (1 - taille / t_complet) * 100 if t_complet else 0

print("=" * 78)
echoues = [n for n, ok, _ in resultats if not ok]
print(f"RÉSULTAT : {len(resultats) - len(echoues)}/{len(resultats)} contrôles OK — {len(echoues)} échec(s)")
if echoues:
    for n in echoues:
        print(f"  ✗ {n}")
print(f"Taille légère : {taille:,} octets ({taille/1e6:.1f} Mo) vs complet {t_complet/1e6:.1f} Mo → gain {gain:.0f} %")
print(f"MD5 léger     : {md5}")
sys.exit(1 if echoues else 0)
