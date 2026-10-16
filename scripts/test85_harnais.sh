#!/usr/bin/env bash
# Task 85 — harnais de test « la fenêtre de confirmation OTP n'affiche JAMAIS
# le code — uniquement le QR code (expirant après 10 minutes) ».
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). DEUX serveurs de test :
#   - port 4247 : portail employés (TTL normal 10 minutes) — preuves du
#     parcours « QR + champ de confirmation, AUCUN code en clair » ;
#   - port 4248 : portail TTL réduit (PORTAL_OTP_TTL_MS=3500) — preuve de
#     l'EXPIRATION du QR après le délai.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test85"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test85.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test85.db"
export HOSTNAME=127.0.0.1

echo "--- Insertion des accès jetables (COPIE uniquement) ---"
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test (port 4247, TTL normal) ---"
export PORTAL_PORT=4247
node scripts/portail-server.js > "$SB/portail4247.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test (port 4248, TTL 3,5 s) ---"
export PORTAL_PORT=4248
export PORTAL_OTP_TTL_MS=3500
node scripts/portail-server.js > "$SB/portail4248.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4247/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST 4247 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4247.log"
  exit 1
fi
ATTENDU2=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4248/ || true)
  if [ "$code" = "200" ]; then ATTENDU2=1; break; fi
  sleep 1
done
if [ "$ATTENDU2" != "1" ]; then
  echo "SERVEUR DE TEST 4248 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4248.log"
  exit 1
fi

echo "--- Tests Task 85 ---"
PORTAL_TTL_NORMAL="http://127.0.0.1:4247" PORTAL_TTL_COURT="http://127.0.0.1:4248" \
DB_COPIE="$SB/test85.db" python3 scripts/test85_fenetre_qr_seul.py
