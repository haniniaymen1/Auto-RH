#!/usr/bin/env bash
# Task 90 — harnais de test « après le scan du QR code, retour à la fenêtre
# initiale de connexion (CIN + mot de passe + OTP), jamais d'ouverture
# directe du portail quand la confirmation termine l'inscription ».
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). DEUX serveurs de test :
#   - port 4264 : portail employés TTL réduit (PORTAL_OTP_TTL_MS=3500) —
#     LE SCÉNARIO DE L'UTILISATEUR : QR n°1 → expiration → nouvelle
#     inscription (QR n°2) → scan + code → redirect /premiere-reussie
#     (Configuration réussie, session refermée) → fenêtre initiale ;
#   - port 4265 : portail employés TTL normal (10 minutes) — employé DÉJÀ
#     INSCRIT (secret scellé) : la confirmation ouvre TOUJOURS l'espace
#     directement (connexion normale à deux facteurs inchangée).
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test90"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test90.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test90.db"
export HOSTNAME=127.0.0.1

echo "--- Insertion des accès jetables (COPIE uniquement) ---"
node scripts/test74_inserer.js inserer
node scripts/test64_inserer.js user

echo "--- Démarrage du portail de test (port 4264, TTL 3,5 s) ---"
export PORTAL_PORT=4264
export PORTAL_OTP_TTL_MS=3500
node scripts/portail-server.js > "$SB/portail4264.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test (port 4265, TTL normal) ---"
export PORTAL_PORT=4265
unset PORTAL_OTP_TTL_MS
node scripts/portail-server.js > "$SB/portail4265.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4264/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST 4264 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4264.log"
  exit 1
fi
ATTENDU2=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4265/ || true)
  if [ "$code" = "200" ]; then ATTENDU2=1; break; fi
  sleep 1
done
if [ "$ATTENDU2" != "1" ]; then
  echo "SERVEUR DE TEST 4265 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4265.log"
  exit 1
fi

echo "--- Tests Task 90 ---"
PORTAL_TTL_COURT="http://127.0.0.1:4264" PORTAL_TTL_NORMAL="http://127.0.0.1:4265" \
DB_COPIE="$SB/test90.db" python3 scripts/test90_redirection_apres_scan.py
