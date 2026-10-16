#!/usr/bin/env bash
# Task 89 — harnais de test « Démarrage local SANS npx (aucun prompt bloquant) ».
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). Pas de serveur ici : le correctif concerne les 7 scripts de
# démarrage — contrôles statiques + E2E des commandes LOCALES exactes
# (db push + generate exécutés sur la COPIE via « node node_modules/... »).
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test89"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test89.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test89.db"

echo "--- Tests Task 89 (démarrage sans npx) ---"
RACINE="$RACINE" DB_COPIE="$SB/test89.db" python3 scripts/test89_demarrage_sans_npx.py
