#!/usr/bin/env bash
# Task 75 — harnais de test « QR CODE + OTP UNIQUEMENT À LA PREMIÈRE
# CONNEXION ». PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la
# base (jamais sur la base réelle). DEUX portails autonomes :
#   - port 4210 : TTL par défaut (10 minutes) — 1re connexion avec QR PUIS
#     connexions suivantes DIRECTES (sans OTP) ;
#   - port 4211 : PORTAL_OTP_TTL_MS=3500 (3,5 s) — preuve qu'une EXPIRATION
#     n'annule PAS la première connexion (reconnexion → OTP de nouveau exigé).
# Réutilise le jeu Task 66 (TEST66NOUV / TEST66ANCI / TEST66ESPA) + les accès
# jetables Task 74/75 (TEST74EXPIRE / TEST74ANNULE, scripts/test74_inserer.js
# — dont le mode « lire » prouve l'état du verrou lastLoginAt). Portable : la
# racine du projet est déduite de l'emplacement de CE script.
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test75"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test75.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test75.db"
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test66_inserer.js inserer
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test n°1 (port 4210, TTL normal 10 min) ---"
export PORTAL_PORT=4210
node scripts/portail-server.js > "$SB/portail4210.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test n°2 (port 4211, TTL 3,5 s) ---"
PORTAL_PORT=4211 PORTAL_OTP_TTL_MS=3500 node scripts/portail-server.js > "$SB/portail4211.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
ATTENDU2=0
for i in $(seq 1 40); do
  if [ "$ATTENDU1" != "1" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4210/ || true)
    if [ "$code" = "200" ]; then ATTENDU1=1; fi
  fi
  if [ "$ATTENDU2" != "1" ]; then
    code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4211/ || true)
    if [ "$code2" = "200" ]; then ATTENDU2=1; fi
  fi
  if [ "$ATTENDU1" = "1" ] && [ "$ATTENDU2" = "1" ]; then break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ] || [ "$ATTENDU2" != "1" ]; then
  echo "PORTAIL DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -20 "$SB/portail4210.log" "$SB/portail4211.log"
  exit 1
fi

echo "--- Tests Task 75 ---"
python3 scripts/test75_otp_premiere_connexion.py
