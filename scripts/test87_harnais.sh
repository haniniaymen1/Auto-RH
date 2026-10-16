#!/usr/bin/env bash
# Task 87 — harnais de test « après « Configuration réussie », retour à la
# fenêtre initiale de connexion » (« apres cette fenetre derige vers fenetre
# initial (cin, mot de passe, otp) »).
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). UN serveur de test :
#   - port 4261 : portail employés (TTL normal 10 minutes) — preuve du
#     parcours complet : première connexion → QR → code TOTP → page
#     « Configuration réussie » (session FERMÉE au service) → fenêtre
#     initiale de connexion servie à la place du portail → reconnexion
#     CIN + mot de passe + OTP → fiches accessibles.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test87"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test87.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test87.db"
export HOSTNAME=127.0.0.1

echo "--- Insertion des accès jetables (COPIE uniquement) ---"
node scripts/test74_inserer.js inserer
node scripts/test64_inserer.js inserer

echo "--- Démarrage du portail de test (port 4261, TTL normal) ---"
export PORTAL_PORT=4261
node scripts/portail-server.js > "$SB/portail4261.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4261/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST 4261 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4261.log"
  exit 1
fi

echo "--- Tests Task 87 ---"
PORTAIL_TEST="http://127.0.0.1:4261" \
DB_COPIE="$SB/test87.db" python3 scripts/test87_redirection_connexion_initiale.py
