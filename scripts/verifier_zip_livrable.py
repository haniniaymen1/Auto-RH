#!/usr/bin/env python3
# =============================================================================
# VÉRIFICATION EXHAUSTIVE du livrable ZIP v0.2.142 :
#   A) Les ~120 fichiers que v0.2.141 avait PERDUS sont TOUS présents
#   B) Contenu bit-à-bit : les fichiers v0.2.138 non modifiés par les 5
#      demandes (703) sont IDENTIQUES entre l'archive v0.2.142 et v0.2.138
#   C) Marqueurs des 5 dernières demandes présents (contenu)
#   D) Fichiers racine livrés (scripts Windows, PDF, PPTX, OCR, .env.example)
# Usage : python3 scripts/verifier_zip_livrable.py
# =============================================================================
import hashlib
import sys
import zipfile
from pathlib import Path

PROJET = Path("/home/z/my-project")
import sys
VERSION_LIVRABLE = sys.argv[1] if len(sys.argv) > 1 else "0.2.143"
ZIP = PROJET / "download" / f"auto-rh-scripts-site-web-v{VERSION_LIVRABLE}.zip"
DIR_138 = PROJET / "audit" / "v138"
PERDUS = PROJET / "scripts" / "fichiers-perdus-v02141.txt"

ok = 0
ko = 0
def check(label, cond, detail=""):
    global ok, ko
    if cond:
        ok += 1
        print(f"  OK   {label}" + (f" — {detail}" if detail else ""))
    else:
        ko += 1
        print(f"  FAIL {label}" + (f" — {detail}" if detail else ""))

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

print("=== A) Fichiers perdus par v0.2.141 → TOUS présents dans v0.2.142 ===")
with zipfile.ZipFile(ZIP) as z:
    noms = set(z.namelist())

    perdus = [l.strip() for l in PERDUS.read_text().splitlines() if l.strip()]
    absents = [f for f in perdus if f not in noms]
    check(f"{len(perdus)} fichiers perdus par v0.2.141 présents", not absents,
          f"absents : {absents[:5]}" if absents else "")

    print("=== B) Contenu bit-à-bit vs v0.2.138 (fichiers non modifiés par les 5 demandes) ===")
    MODIFIES_TASKS = {
        "prisma/schema.prisma",
        # (v0.2.143) unification document de réponse / Import de fichiers :
        # composant d'aperçu interactif étendu (élément tampon + ancre bas
        # 42 pt + variante document) — extension ADDITIVE sans régression.
        "src/components/payslip/apercu-positionnement.tsx",
        "scripts/portail-server.js",
        "src/app/api/demandes/[id]/repondre/route.ts",
        "src/app/api/demandes/[id]/route.ts",
        "src/app/api/demandes/route.ts",
        "src/components/payslip/demandes-tab.tsx",
        "src/lib/db-crypto.ts",
        "src/lib/demandes.ts",
    }
    ref_files = [l.strip() for l in
                 (PROJET / "scripts" / "reference-v0.2.138-fichiers.txt").read_text().splitlines()
                 if l.strip()]
    identiques, differents_attendus, divergences = 0, 0, []
    for f in ref_files:
        if f not in noms:
            divergences.append(f"{f} (ABSENT de l'archive)")
            continue
        h_zip = sha(z.read(f))
        h_138 = sha((DIR_138 / f).read_bytes())
        if h_zip == h_138:
            identiques += 1
        elif f in MODIFIES_TASKS:
            differents_attendus += 1
        else:
            divergences.append(f"{f} (contenu différent, hors tasks)")
    check(f"{identiques} fichiers strictement identiques à v0.2.138",
          identiques == len(ref_files) - len(MODIFIES_TASKS) - len([d for d in divergences if "ABSENT" in d]))
    check(f"{differents_attendus}/8 fichiers modifiés = exactement ceux des 5 demandes",
          differents_attendus == len(MODIFIES_TASKS) and not divergences,
          "; ".join(divergences[:5]) if divergences else "")

    print("=== C) Marqueurs des 5 dernières demandes (contenu dans l'archive) ===")
    marqueurs = [
        ("Demande 1+2 — matrice deux étapes", "src/lib/demandes.ts", b"statutFinalDepuisDecisions"),
        ("Demande 1+2 — schéma décision Manager", "prisma/schema.prisma", b"decisionManager"),
        ("Demande 1+2 — refuseePar", "prisma/schema.prisma", b"refuseePar"),
        ("Demande 1 — transmission RH (portail)", "scripts/portail-server.js", b"envoyerEmailTransmissionRh"),
        ("Demande 1 — notification RH au refus manager", "scripts/portail-server.js", b"envoyerEmailRefusManagerRh"),
        ("Demande 3 — classifier formulations", "scripts/classification-reponses.js", b"VALIDATION"),
        ("Demande 4 — document signé & tamponné", "scripts/document-acceptation.js", b"PKCS"),
        ("Demande 5 — document de refus", "scripts/document-refus.js", b"REFUS"),
        ("Demande 5 — consultation (API doc-refus)", "src/app/api/demandes/[id]/doc-refus/route.ts", b""),
        ("Demande 5 — consultation (API doc-signe)", "src/app/api/demandes/[id]/doc-signe/route.ts", b""),
        ("Test deux étapes", "scripts/test_task181_deux_etapes.js", b""),
        ("UI bloc validation deux étapes", "src/components/payslip/demandes-tab.tsx", b"Validation"),
    ]
    for label, fichier, motif in marqueurs:
        if fichier not in noms:
            check(label, False, f"{fichier} ABSENT")
            continue
        data = z.read(fichier)
        check(label, motif in data if motif else len(data) > 0, fichier)

    print("=== D) Fichiers racine livrés (fonctionnalités v0.2.138) ===")
    racine = [
        ".dockerignore", ".env.example", "Caddyfile", "Dockerfile", "docker-compose.yml",
        "components.json", "eslint.config.mjs", "next.config.ts", "package.json",
        "package-lock.json", "postcss.config.mjs", "tailwind.config.ts", "tsconfig.json",
        "README-DEPLOIEMENT-LOCAL.md", "VERSION",
        "ARRETER-SILENCIEUX-WINDOWS.vbs", "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs",
        "CHIFFRER-FICHES-WINDOWS.bat", "CREER-SUPERADMIN-WINDOWS.bat",
        "DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-PORTAIL-WINDOWS.bat",
        "DEMARRER-SILENCIEUX-WINDOWS.vbs", "DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-TOUT-WINDOWS.bat",
        "DEMARRER-WINDOWS.bat", "ETAT-SILENCIEUX-WINDOWS.vbs",
        "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs", "JOURNAUX-SILENCIEUX-WINDOWS.vbs",
        "PREPARER-AUTO-RH-SILENCIEUX.bat", "SAUVEGARDER-BD-WINDOWS.bat",
        "SCINDER-DOCX-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
        "SECURISER-DOSSIER-LINUX-MAC.sh", "SECURISER-DOSSIER-WINDOWS.bat",
        "SECURISER-DOSSIERS-WINDOWS.bat",
        "auto-rh-readme-technique.pdf", "servicerh-readme-technique.pdf",
        "servicerh-readme-technique-reduit.pdf", "servicerh-readme-technique-v0.2.133.pdf",
        "servicerh-readme-technique-reduit-v0.2.134.pdf", "servicerh-support-formation-rh.pdf",
        "servicerh-guide-utilisation-employe.pptx", "servicerh-guide-utilisation-it.pptx",
        "servicerh-guide-utilisation-rh.pptx", "servicerh-guide-utilisation-superadmin.pptx",
        "ocr-data/fra.traineddata", "home/z/my-project/scripts/apply_specimen_update.py",
    ]
    absents_r = [f for f in racine if f not in noms]
    check(f"{len(racine)} fichiers racine/Docker/OCR/docs présents", not absents_r,
          f"absents : {absents_r}" if absents_r else "")

    ver = z.read("VERSION").decode().strip()
    check(f"VERSION de l'archive = v{VERSION_LIVRABLE}", ver == "v" + VERSION_LIVRABLE, ver)

print()
print(f"RÉSULTAT : {ok} OK / {ko} FAIL")
sys.exit(1 if ko else 0)
