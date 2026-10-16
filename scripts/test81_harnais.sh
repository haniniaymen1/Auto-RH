#!/usr/bin/env bash
# Task 81 — harnais de test « reconnexion après le scan du QR ».
# PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (jamais
# sur la base réelle). UN serveur de test :
#   - port 4233 : portail employés (TTL par défaut 10 minutes) — parcours
#     complet signalé par l'utilisateur : 1re connexion CIN + mot de passe
#     initial → page QR seule (scan) → DÉCONNEXION → RECONNEXION → page de
#     confirmation → code de l'application accepté → changement OBLIGATOIRE
#     du mot de passe → reconnexion avec l'initial devenu invalide (401
#     expliqué par le bandeau Task 81) → reconnexion avec le mot de passe
#     personnel (200).
# Réutilise le jeu de données Task 64 (TEST64CIN / Initial64x) via
# scripts/test64_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test81"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test81.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test81.db"
export HOSTNAME=127.0.0.1

echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test64_inserer.js inserer

echo "--- Démarrage du portail de test (port 4233, TTL normal 10 min) ---"
export PORTAL_PORT=4233
node scripts/portail-server.js > "$SB/portail4233.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4233/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4233.log"
  exit 1
fi

echo "--- Tests Task 81 ---"
python3 scripts/test81_reconnexion_apres_scan.py
