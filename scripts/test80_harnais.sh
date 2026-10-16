#!/usr/bin/env bash
# Task 80 — harnais de test « UNIQUEMENT LE QR CODE + GESTION DES QR CODES ».
# PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (jamais
# sur la base réelle). TROIS serveurs de test :
#   - port 4218 : portail employés (TTL par défaut 10 minutes) — parcours
#     complet Task 80 : page /otp de première connexion = UNIQUEMENT le QR
#     code (aucun code affiché, aucun formulaire, aucun bouton), verrou
#     qrPresente posé à l'affichage, refus de confirmation tant que le défi
#     est en mode QR, reconnexion → page de confirmation (sans QR), scellement ;
#   - port 4219 : serveur ADMINISTRATION (Next standalone) — API
#     /api/portal-access enrichie (qrPresente/hasQrSecret) + actions
#     « qr » (afficher le QR) et « reset-qr » (nouveau secret) ;
#   - port 4220 : portail employés PORTAL_OTP_TTL_MS=3500 (3,5 s) — preuve
#     que l'expiration du QR reste active et ne ré-affiche PAS le QR.
# Réutilise le jeu de données Task 64 (TEST64CIN / TEST64OTP + compte admin
# de test) et les accès jetables Task 74 (TEST74EXPIRE / TEST74ANNULE) via
# scripts/test74_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test80"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test80.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test80.db"
export HOSTNAME=127.0.0.1

echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test64_inserer.js inserer
node scripts/test64_inserer.js user
node scripts/test74_inserer.js inserer

echo "--- Démarrage du portail de test n°1 (port 4218, TTL normal 10 min) ---"
export PORTAL_PORT=4218
node scripts/portail-server.js > "$SB/portail4218.log" 2>&1 &
SRV1=$!

echo "--- Démarrage du portail de test n°2 (port 4220, TTL 3,5 s) ---"
PORTAL_PORT=4220 PORTAL_OTP_TTL_MS=3500 node scripts/portail-server.js > "$SB/portail4220.log" 2>&1 &
SRV2=$!

echo "--- Démarrage du serveur d'administration de test (port 4219) ---"
export PORT=4219
node .next/standalone/server.js > "$SB/admin4219.log" 2>&1 &
SRV3=$!

trap 'kill $SRV1 $SRV2 $SRV3 2>/dev/null || true' EXIT

ATTENDU1=0
ATTENDU2=0
ATTENDU3=0
for i in $(seq 1 60); do
  if [ "$ATTENDU1" != "1" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4218/ || true)
    if [ "$code" = "200" ]; then ATTENDU1=1; fi
  fi
  if [ "$ATTENDU2" != "1" ]; then
    code2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4220/ || true)
    if [ "$code2" = "200" ]; then ATTENDU2=1; fi
  fi
  if [ "$ATTENDU3" != "1" ]; then
    code3=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4219/login || true)
    if [ "$code3" = "200" ]; then ATTENDU3=1; fi
  fi
  if [ "$ATTENDU1" = "1" ] && [ "$ATTENDU2" = "1" ] && [ "$ATTENDU3" = "1" ]; then break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ] || [ "$ATTENDU2" != "1" ] || [ "$ATTENDU3" != "1" ]; then
  echo "SERVEURS DE TEST DEMARRAGE KO — extraits des journaux :"
  tail -20 "$SB/portail4218.log" "$SB/portail4220.log" "$SB/admin4219.log"
  exit 1
fi

echo "--- Tests Task 80 ---"
python3 scripts/test80_qr_seul.py
