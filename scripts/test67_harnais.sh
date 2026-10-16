#!/usr/bin/env bash
# Task 67 — harnais de test « RÉPERTOIRE COMPLET DES CIN DEPUIS LES DONNÉES
# IMPORTÉES ». PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la
# base (jamais sur la base réelle). Deux serveurs sur la MÊME COPIE :
#   - administration standalone port 4201 (répertoire + création d'accès) ;
#   - portail employés port 4102 (le CIN proposé automatiquement sert bien
#     les fiches de l'employé).
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (fonctionne dans le dépôt de développement ET dans l'archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test67"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test67.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test67.db"
export PORT=4201
export PORTAL_PORT=4102
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test67_inserer.js inserer
node scripts/test64_inserer.js user
echo "--- Démarrage du serveur admin de test (port 4201) ---"
node .next/standalone/server.js > "$SB/serveur.log" 2>&1 &
SRV=$!
echo "--- Démarrage du portail de test (port 4102) ---"
node scripts/portail-server.js > "$SB/portail.log" 2>&1 &
PRT=$!
trap 'kill $SRV $PRT 2>/dev/null || true' EXIT
ATTENDU=0
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4201/login || true)
  codep=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/ || true)
  if [ "$code" = "200" ] && [ "$codep" = "200" ]; then ATTENDU=1; break; fi
  sleep 1
done
if [ "$ATTENDU" != "1" ]; then
  echo "SERVEURS DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -15 "$SB/serveur.log"
  tail -15 "$SB/portail.log"
  exit 1
fi
echo "--- Tests Task 67 ---"
python3 scripts/test67_repertoire_complet.py
