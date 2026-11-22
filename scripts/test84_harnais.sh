#!/usr/bin/env bash
# Task 84 — harnais de test « cercles du portail passés au vert ».
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). UN serveur de test :
#   - port 4244 : portail employés — vérifie que les cercles des têtes de
#     carte (.etq-etape numérotés + .icon-rond icônes) sont servis EN VERT
#     (#059669) sur TOUTES les pages, sans AUCUN bleu restant, et que le
#     parcours fonctionnel (connexion, messages génériques) est intact.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test84"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test84.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test84.db"
export HOSTNAME=127.0.0.1

echo "--- Démarrage du portail de test (port 4244) ---"
export PORTAL_PORT=4244
node scripts/portail-server.js > "$SB/portail4244.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4244/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4244.log"
  exit 1
fi

echo "--- Tests Task 84 ---"
python3 scripts/test84_cercles_verts.py
