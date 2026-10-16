#!/usr/bin/env bash
# Task 66 — harnais de test « CHAMP DE MOT DE PASSE » (saisie tolérante +
# autocomplete correct). PRINCIPE : tests fonctionnels UNIQUEMENT sur une
# COPIE de la base (jamais sur la base réelle). Portail autonome port 4102.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (fonctionne dans le dépôt de développement ET dans l'archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test66"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test66.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test66.db"
export PORTAL_PORT=4102
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test66_inserer.js inserer
echo "--- Démarrage du portail de test (port 4102) ---"
node scripts/portail-server.js > "$SB/portail.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
ATTENDU=0
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/ || true)
  if [ "$code" = "200" ]; then ATTENDU=1; break; fi
  sleep 1
done
if [ "$ATTENDU" != "1" ]; then
  echo "PORTAIL DE TEST DEMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail.log"
  exit 1
fi
echo "--- Tests Task 66 ---"
python3 scripts/test66_champ_motdepasse.py
