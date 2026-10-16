#!/usr/bin/env bash
# Task 78 — harnais de test « QR CODE AU FORMAT STANDARD otpauth://totp/… ».
# PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (jamais
# sur la base réelle). DEUX portails autonomes :
#   - port 4215 : TTL par défaut (10 minutes) — simulation complète d'une
#     application d'authentification (lecture du secret DANS le QR, calcul
#     RFC 6238, validation du code par le portail), anti-rejeu, double voie,
#     persistance du secret, annulation ;
#   - port 4216 : PORTAL_OTP_TTL_MS=3500 (3,5 s) — preuve que l'expiration
#     du défi d'inscription reste active (410 OTP_EXPIRE, rien n'est scellé).
# Réutilise le jeu de données Task 66 (TEST66ESPA…) via
# scripts/test66_inserer.js + les accès jetables Task 74
# (TEST74EXPIRE / TEST74ANNULE) via scripts/test74_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test78"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test78.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test78.db"
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test66_inserer.js inserer
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test n°1 (port 4215, TTL normal 10 min) ---"
export PORTAL_PORT=4215
node scripts/portail-server.js > "$SB/portail4215.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test n°2 (port 4216, TTL 3,5 s) ---"
PORTAL_PORT=4216 PORTAL_OTP_TTL_MS=3500 node scripts/portail-server.js > "$SB/portail4216.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
ATTENDU2=0
for i in $(seq 1 40); do
  if [ "$ATTENDU1" != "1" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4215/ || true)
    if [ "$code" = "200" ]; then ATTENDU1=1; fi
  fi
  if [ "$ATTENDU2" != "1" ]; then
    code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4216/ || true)
    if [ "$code2" = "200" ]; then ATTENDU2=1; fi
  fi
  if [ "$ATTENDU1" = "1" ] && [ "$ATTENDU2" = "1" ]; then break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ] || [ "$ATTENDU2" != "1" ]; then
  echo "PORTAIL DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -20 "$SB/portail4215.log" "$SB/portail4216.log"
  exit 1
fi

echo "--- Tests Task 78 ---"
python3 scripts/test78_totp_authenticator.py
