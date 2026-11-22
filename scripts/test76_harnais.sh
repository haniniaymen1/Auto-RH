#!/usr/bin/env bash
# Task 76 — harnais de test « OTP À CHAQUE CONNEXION, QR CODE SEULEMENT À LA
# PREMIÈRE ». PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la
# base (jamais sur la base réelle). DEUX portails autonomes :
#   - port 4212 : TTL par défaut (10 minutes) — flux complets 1re/2e/3e
#     connexions, régénération, annulation, changement de mot de passe ;
#   - port 4213 : PORTAL_OTP_TTL_MS=3500 (3,5 s) — preuve de l'EXPIRATION
#     aux deux modes (1re connexion avec QR, connexions suivantes sans QR).
# Réutilise le jeu de données Task 66 (TEST66ESPA / TEST66NOUV / TEST66ANCI)
# via scripts/test66_inserer.js + les accès jetables Task 74
# (TEST74EXPIRE / TEST74ANNULE) via scripts/test74_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test76"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test76.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test76.db"
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test66_inserer.js inserer
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test n°1 (port 4212, TTL normal 10 min) ---"
export PORTAL_PORT=4212
node scripts/portail-server.js > "$SB/portail4212.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test n°2 (port 4213, TTL 3,5 s) ---"
PORTAL_PORT=4213 PORTAL_OTP_TTL_MS=3500 node scripts/portail-server.js > "$SB/portail4213.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
ATTENDU2=0
for i in $(seq 1 40); do
  if [ "$ATTENDU1" != "1" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4212/ || true)
    if [ "$code" = "200" ]; then ATTENDU1=1; fi
  fi
  if [ "$ATTENDU2" != "1" ]; then
    code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4213/ || true)
    if [ "$code2" = "200" ]; then ATTENDU2=1; fi
  fi
  if [ "$ATTENDU1" = "1" ] && [ "$ATTENDU2" = "1" ]; then break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ] || [ "$ATTENDU2" != "1" ]; then
  echo "PORTAIL DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -20 "$SB/portail4212.log" "$SB/portail4213.log"
  exit 1
fi

echo "--- Tests Task 76 ---"
python3 scripts/test76_otp_qr_chaque_connexion.py
