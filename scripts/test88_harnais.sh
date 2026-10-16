#!/usr/bin/env bash
# Task 88 — harnais de test « Authenticator : l'Account Name affiche
# « Fiche de paie » au lieu du CIN ».
# PRINCIPE : tests UNIQUEMENT sur une COPIE de la base (jamais sur la base
# réelle). UN serveur de test :
#   - port 4263 : portail employés (TTL normal 10 minutes) — preuve du
#     parcours complet : première connexion → QR dont l'URI otpauth porte le
#     label « Auto-RH:Fiche de paie » (SANS le CIN) → code TOTP de
#     l'application accepté → « Configuration réussie » (session fermée,
#     Task 87) → reconnexion CIN + mot de passe + OTP → fiches accessibles.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test88"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test88.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test88.db"
export HOSTNAME=127.0.0.1

echo "--- Insertion des accès jetables (COPIE uniquement) ---"
node scripts/test74_inserer.js inserer
node scripts/test64_inserer.js inserer

echo "--- Démarrage du portail de test (port 4263, TTL normal) ---"
export PORTAL_PORT=4263
node scripts/portail-server.js > "$SB/portail4263.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4263/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST 4263 DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4263.log"
  exit 1
fi

echo "--- Tests Task 88 ---"
PORTAIL_TEST="http://127.0.0.1:4263" \
DB_COPIE="$SB/test88.db" python3 scripts/test88_nom_compte_authenticator.py
