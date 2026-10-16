#!/usr/bin/env bash
# Task 74 — harnais de test « OTP + QR CODE APRÈS VALIDATION CIN + MOT DE
# PASSE (expire en 10 minutes) ». PRINCIPE : tests fonctionnels UNIQUEMENT
# sur une COPIE de la base (jamais sur la base réelle). DEUX portails
# autonomes :
#   - port 4207 : TTL par défaut (10 minutes) — flux complet de connexion ;
#   - port 4208 : PORTAL_OTP_TTL_MS=3500 (3,5 s) — preuve de l'EXPIRATION
#     (le QR et le code ne valent plus rien après le délai), de la page
#     « expiré », de la RÉGÉNÉRATION et de l'annulation après 5 erreurs.
# Réutilise le jeu de données Task 66 (TEST66ESPA / TEST66NOUV) via
# scripts/test66_inserer.js. Portable : la racine du projet est déduite de
# l'emplacement de CE script (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test74"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test74.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test74.db"
export HOSTNAME=127.0.0.1
echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test66_inserer.js inserer
# (NOUVEAU Task 75) accès jetables TEST74EXPIRE / TEST74ANNULE pour les
# scénarios d'expiration et d'annulation (les re-connexions n'exigent plus
# d'OTP depuis la règle « QR uniquement à la première connexion »).
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test n°1 (port 4207, TTL normal 10 min) ---"
export PORTAL_PORT=4207
node scripts/portail-server.js > "$SB/portail4207.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test n°2 (port 4208, TTL 3,5 s) ---"
PORTAL_PORT=4208 PORTAL_OTP_TTL_MS=3500 node scripts/portail-server.js > "$SB/portail4208.log" 2>&1 &
SRV2=$!

trap 'kill $SRV1 $SRV2 2>/dev/null || true' EXIT

ATTENDU1=0
ATTENDU2=0
for i in $(seq 1 40); do
  if [ "$ATTENDU1" != "1" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4207/ || true)
    if [ "$code" = "200" ]; then ATTENDU1=1; fi
  fi
  if [ "$ATTENDU2" != "1" ]; then
    code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4208/ || true)
    if [ "$code2" = "200" ]; then ATTENDU2=1; fi
  fi
  if [ "$ATTENDU1" = "1" ] && [ "$ATTENDU2" = "1" ]; then break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ] || [ "$ATTENDU2" != "1" ]; then
  echo "PORTAIL DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -20 "$SB/portail4207.log" "$SB/portail4208.log"
  exit 1
fi

echo "--- Tests Task 74 ---"
python3 scripts/test74_otp_qr.py
