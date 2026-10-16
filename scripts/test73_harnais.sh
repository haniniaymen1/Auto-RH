#!/usr/bin/env bash
# Task 73 — harnais de test « ENLEVE LA PARTIE ROUGE ET AJOUTE BOUTON
# RECHERCHE » (Accès portail). PRINCIPE : tests fonctionnels UNIQUEMENT sur
# une COPIE de la base (jamais sur la base réelle). Serveur admin standalone
# port 4205. Portable : la racine du projet est déduite de l'emplacement de
# CE script (fonctionne dans le dépôt de développement ET dans l'archive
# extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test73"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test73.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test73.db"
export PORT=4205
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test65_inserer.js inserer
node scripts/test64_inserer.js user
echo "--- Démarrage du serveur admin de test (port 4205) ---"
node .next/standalone/server.js > "$SB/serveur.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
ATTENDU=0
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4205/login || true)
  if [ "$code" = "200" ]; then ATTENDU=1; break; fi
  sleep 1
done
if [ "$ATTENDU" != "1" ]; then
  echo "SERVEUR DE TEST DEMARRAGE KO — extrait du journal :"
  tail -20 "$SB/serveur.log"
  exit 1
fi
echo "--- Tests Task 73 ---"
python3 scripts/test73_recherche_bouton.py
