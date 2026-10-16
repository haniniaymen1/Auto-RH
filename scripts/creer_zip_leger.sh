#!/usr/bin/env bash
# =============================================================================
# CRÉATION DU LIVRABLE ZIP LÉGER — AutoRH / Auto-RH
# Identique au ZIP complet (creer_zip_livrable.sh) MOINS les documents
# lourds non fonctionnels : guides de formation PPTX, anciennes éditions
# du readme, médias de diagnostic et fixtures de test de scripts/.
# TOUT le code applicatif, l'OCR (ocr-data), les données de test
# (test-data), les lanceurs et la documentation courante sont conservés.
# Garde anti-régression : les 711 fichiers de référence v0.2.138
# (scripts/reference-v0.2.138-fichiers.txt) SAUF scripts/fiches_1000.json
# (fixture de test exclue) doivent tous être présents, sinon ÉCHEC.
# Usage : bash scripts/creer_zip_leger.sh [version]   (défaut : 0.2.158)
# =============================================================================
set -euo pipefail

VERSION="${1:-0.2.158}"
PROJET="/home/z/my-project"
cd "$PROJET"

ZIP="download/auto-rh-scripts-site-web-v${VERSION}-leger.zip"
GEN="download/auto-rh-scripts-site-web-leger.zip"
LISTE=$(mktemp)
EXCL=$(mktemp)
trap 'rm -f "$LISTE" "$EXCL"' EXIT

# ---------------------------------------------------------------------------
# EXCLUSIONS DOCUMENTÉES (aucun impact sur le fonctionnement du site) :
#  • 4 guides de formation PPTX (29,2 Mo compressé) — documents de formation,
#    non servis par l'application ; disponibles dans le ZIP complet.
#  • 3 anciennes éditions du readme (v0.2.133 / réduites) — remplacées par
#    auto-rh-readme-technique.pdf et servicerh-readme-technique.pdf (conservés,
#    servis par /api/download-readme) ; /api/download-formation garde
#    servicerh-support-formation-rh.pdf (conservé).
#  • scripts/fiches_1000.json (2,4 Mo) + scripts/fixtures_multi/ — fixtures
#    réservées aux utilitaires de test/diagnostic.
#  • 13 médias de diagnostic racine de scripts/ (rendus PNG, PDF test OCR,
#    > 60 Ko) — entrées/sorties des scripts de diagnostic OCR/polices.
# ---------------------------------------------------------------------------
EXCLUSIONS=(
  servicerh-guide-utilisation-employe.pptx
  servicerh-guide-utilisation-it.pptx
  servicerh-guide-utilisation-rh.pptx
  servicerh-guide-utilisation-superadmin.pptx
  servicerh-readme-technique-v0.2.133.pdf
  servicerh-readme-technique-reduit.pdf
  servicerh-readme-technique-reduit-v0.2.134.pdf
  scripts/fiches_1000.json
  scripts/fixtures_multi/archive_fiches.zip
  scripts/fixtures_multi/fiche_image.png
  scripts/diag_render_p1.png
  scripts/ocr_test_fiche.png
  scripts/ocr_test_fiche_image.pdf
  scripts/nouveau_p1_hd.png
  scripts/nouveau_p2_hd.png
  scripts/nouveau_p1.png
  scripts/render_A_page1.png
  scripts/font_test_bold_48px_LXGW_WenKai.png
  scripts/font_test_bold_48px_DejaVu_Sans.png
  scripts/spec_header.png
  scripts/ancien_p1.png
  scripts/regen_p1.png
  scripts/regen_p500.png
)
for f in "${EXCLUSIONS[@]}"; do
  if [ -e "$f" ]; then echo "$f" >> "$EXCL"
  else echo "AVERTISSEMENT : exclusion absente du projet (ignorée) : $f" >&2; fi
done
sort -u "$EXCL" -o "$EXCL"

# 1) Répertoires entiers (code + données OCR/test + home historique)
for d in src scripts prisma public test-data ocr-data home; do
  find "$d" -type f >> "$LISTE"
done

# 2) Fichiers racine (structure v0.2.138 complète, SANS les exclusions)
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
  servicerh-support-formation-rh.pdf
)
for f in "${RACINE[@]}"; do
  if [ -f "$f" ]; then echo "$f" >> "$LISTE"
  else echo "AVERTISSEMENT : fichier racine absent (non inclus) : $f" >&2; fi
done

sort -u "$LISTE" -o "$LISTE"

# 3) Retrait des exclusions (les deux listes sont triées → comm)
COMPTAVANT=$(wc -l < "$LISTE")
comm -23 "$LISTE" "$EXCL" > "${LISTE}.leger" && mv "${LISTE}.leger" "$LISTE"
COMPTAPRES=$(wc -l < "$LISTE")
echo "[EXCLUS] $((COMPTAVANT - COMPTAPRES)) fichier(s) exclu(s) — $COMPTAPRES fichiers conservés."

# 4) GARDE ANTI-RÉGRESSION — les 711 fichiers de référence v0.2.138 SAUF
#    scripts/fiches_1000.json doivent tous être dans la liste, sinon ÉCHEC.
grep -vxF "scripts/fiches_1000.json" scripts/reference-v0.2.138-fichiers.txt > "${EXCL}.ref" 2>/dev/null || true
MANQ=$(comm -23 "${EXCL}.ref" "$LISTE" | wc -l)
if [ "$MANQ" -gt 0 ]; then
  echo "ÉCHEC : $MANQ fichier(s) de la référence v0.2.138 absents — ZIP léger NON créé :" >&2
  comm -23 "${EXCL}.ref" "$LISTE" >&2
  exit 1
fi
echo "[GARDE] Les 710 fichiers de référence v0.2.138 (711 - fiches_1000.json exclu) sont tous inclus."

# 5) Création ZIP + copie générique identique
rm -f "$ZIP" "$GEN"
zip -q "$ZIP" -@ < "$LISTE"
cp "$ZIP" "$GEN"

# 6) Vérifications finales
unzip -t "$ZIP" > /dev/null && echo "[OK] Intégrité ZIP vérifiée"
ENT=$(unzip -l "$ZIP" | tail -1 | awk '{print $2}')
TAILLE=$(du -h "$ZIP" | cut -f1)
echo "[OK] Entrées : $ENT — taille : $TAILLE"
md5sum "$ZIP" "$GEN"
