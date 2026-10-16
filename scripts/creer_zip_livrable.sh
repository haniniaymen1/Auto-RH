#!/usr/bin/env bash
# =============================================================================
# CRÉATION DU LIVRABLE ZIP COMPLET — AutoRH / Auto-RH
# Garde anti-régression : AUCUN fichier présent dans la référence v0.2.138
# (scripts/reference-v0.2.138-fichiers.txt — les 711 fichiers src/scripts/prisma
# de l'archive servicerh-scripts-site-web-v0.2.138.zip) ne peut être omis.
# Usage : bash scripts/creer_zip_livrable.sh [version]   (défaut : 0.2.158)
# =============================================================================
set -euo pipefail

VERSION="${1:-0.2.158}"
PROJET="/home/z/my-project"
cd "$PROJET"

ZIP="download/auto-rh-scripts-site-web-v${VERSION}.zip"
GEN="download/auto-rh-scripts-site-web.zip"
LISTE=$(mktemp)
trap 'rm -f "$LISTE"' EXIT

# 1) Répertoires entiers (code + données OCR/test + home historique)
for d in src scripts prisma public test-data ocr-data home; do
  find "$d" -type f >> "$LISTE"
done

# 2) Fichiers racine (structure v0.2.138 complète + documents livrés)
RACINE=(
  .dockerignore .env.example Caddyfile Dockerfile docker-compose.yml
  components.json eslint.config.mjs next.config.ts package.json package-lock.json
  postcss.config.mjs tailwind.config.ts tsconfig.json
  README-DEPLOIEMENT-LOCAL.md VERSION
  ARRETER-SILENCIEUX-WINDOWS.vbs CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs
  CHIFFRER-FICHES-WINDOWS.bat CREER-SUPERADMIN-WINDOWS.bat
  DEMARRER-LINUX-MAC.sh DEMARRER-PORTAIL-LINUX-MAC.sh DEMARRER-PORTAIL-WINDOWS.bat
  DEMARRER-SILENCIEUX-WINDOWS.vbs DEMARRER-TOUT-LINUX-MAC.sh DEMARRER-TOUT-WINDOWS.bat
  DEMARRER-WINDOWS.bat ETAT-SILENCIEUX-WINDOWS.vbs
  INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs JOURNAUX-SILENCIEUX-WINDOWS.vbs
  PREPARER-AUTO-RH-SILENCIEUX.bat SAUVEGARDER-BD-WINDOWS.bat
  SCINDER-DOCX-WINDOWS.bat SCINDER-EXCEL-WINDOWS.bat SCINDER-FICHES-WINDOWS.bat
  SECURISER-DOSSIER-LINUX-MAC.sh SECURISER-DOSSIER-WINDOWS.bat
  SECURISER-DOSSIERS-WINDOWS.bat
  auto-rh-readme-technique.pdf servicerh-readme-technique.pdf
  servicerh-readme-technique-reduit.pdf servicerh-readme-technique-v0.2.133.pdf
  servicerh-readme-technique-reduit-v0.2.134.pdf servicerh-support-formation-rh.pdf
  servicerh-guide-utilisation-employe.pptx servicerh-guide-utilisation-it.pptx
  servicerh-guide-utilisation-rh.pptx servicerh-guide-utilisation-superadmin.pptx
)
for f in "${RACINE[@]}"; do
  if [ -f "$f" ]; then echo "$f" >> "$LISTE"
  else echo "AVERTISSEMENT : fichier racine absent (non inclus) : $f" >&2; fi
done

sort -u "$LISTE" -o "$LISTE"

# 3) GARDE ANTI-RÉGRESSION — chaque fichier src/scripts/prisma de v0.2.138
#    doit être dans la liste, sinon ÉCHEC (le ZIP n'est PAS créé).
MANQ=$(comm -23 scripts/reference-v0.2.138-fichiers.txt "$LISTE" | wc -l)
if [ "$MANQ" -gt 0 ]; then
  echo "ÉCHEC : $MANQ fichier(s) de la référence v0.2.138 absents — ZIP NON créé :" >&2
  comm -23 scripts/reference-v0.2.138-fichiers.txt "$LISTE" >&2
  exit 1
fi
echo "[GARDE] Les $(wc -l < scripts/reference-v0.2.138-fichiers.txt) fichiers de référence v0.2.138 sont tous inclus."

# 4) Création ZIP + copie générique identique
rm -f "$ZIP" "$GEN"
zip -q "$ZIP" -@ < "$LISTE"
cp "$ZIP" "$GEN"

# 5) Vérifications finales
unzip -t "$ZIP" > /dev/null && echo "[OK] Intégrité ZIP vérifiée"
ENT=$(unzip -l "$ZIP" | tail -1 | awk '{print $2}')
TAILLE=$(du -h "$ZIP" | cut -f1)
echo "[OK] Entrées : $ENT — taille : $TAILLE"
md5sum "$ZIP" "$GEN"
