#!/usr/bin/env bash
# Task 86 — harnais de test « le QR code d'inscription EXPIRE VRAIMENT après
# 10 minutes » (« Qr code n'expire pas apres 10 minute vérifier »).
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). TROIS serveurs de test :
#   - port 4255 : portail employés (TTL normal 10 minutes) — preuves
#     « fenêtre réutilisée tant qu'elle est vivante » + scellement après
#     confirmation + libellé honnête du secret définitif (inscrit) ;
#   - port 4256 : portail TTL réduit (PORTAL_OTP_TTL_MS=3500) — preuve de la
#     ROTATION du secret après expiration (QR n°2 ≠ QR n°1, code de l'ancien
#     scan REFUSÉ) et du 410 OTP_EXPIRE ;
#   - port 4257 : administration standalone (même TTL court) — preuves de la
#     rotation « Afficher le QR », du statut qrFenetreExpiree et du
#     comportement de reset-qr (fenêtre ouverte / scellé).
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test86"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test86.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test86.db"
export HOSTNAME=127.0.0.1

echo "--- Insertion des accès jetables (COPIE uniquement) ---"
node scripts/test74_inserer.js inserer
node scripts/test64_inserer.js user

echo "--- Démarrage du portail de test (port 4255, TTL normal) ---"
export PORTAL_PORT=4255
node scripts/portail-server.js > "$SB/portail4255.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test (port 4256, TTL 3,5 s) ---"
export PORTAL_PORT=4256
export PORTAL_OTP_TTL_MS=3500
node scripts/portail-server.js > "$SB/portail4256.log" 2>&1 &
SRV2=$!

echo "--- Démarrage de l'administration de test (port 4257, même TTL court) ---"
export PORT=4257
node .next/standalone/server.js > "$SB/admin4257.log" 2>&1 &
SRV3=$!

trap 'kill $SRV1 $SRV2 $SRV3 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4255/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST 4255 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4255.log"
  exit 1
fi
ATTENDU2=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4256/ || true)
  if [ "$code" = "200" ]; then ATTENDU2=1; break; fi
  sleep 1
done
if [ "$ATTENDU2" != "1" ]; then
  echo "SERVEUR DE TEST 4256 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4256.log"
  exit 1
fi
ATTENDU3=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4257/login || true)
  if [ "$code" = "200" ]; then ATTENDU3=1; break; fi
  sleep 1
done
if [ "$ATTENDU3" != "1" ]; then
  echo "SERVEUR DE TEST 4257 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/admin4257.log"
  exit 1
fi

echo "--- Tests Task 86 ---"
PORTAL_TTL_NORMAL="http://127.0.0.1:4255" PORTAL_TTL_COURT="http://127.0.0.1:4256" \
ADMIN_TEST="http://127.0.0.1:4257" TTL_S="3.5" \
DB_COPIE="$SB/test86.db" python3 scripts/test86_expiration_qr.py
