#!/usr/bin/env bash
# Task 83 — harnais de test « première connexion en 2 étapes (maquette) ».
# PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (jamais
# sur la base réelle). UN serveur de test :
#   - port 4235 : portail employés (TTL par défaut 10 minutes) — parcours
#     complets de la maquette : (1) /premiere : CIN + mot de passe initial +
#     nouveau mot de passe ×2 → « Valider » ; (2) /otp : QR code + champ
#     Code OTP + mention 10 minutes + « Valider » ; (3) /premiere-reussie :
#     « Configuration réussie » ; (4) connexions suivantes : CIN + mot de
#     passe + OTP en UNE étape, QR JAMAIS ré-affiché ; (5) erreurs explicites.
# Réutilise le jeu de données Task 64 (TEST64CIN / Initial64x et
# TEST64EXPIRE / AncienMotDePasse64) via scripts/test64_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test83"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test83.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test83.db"
export HOSTNAME=127.0.0.1

echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test64_inserer.js inserer

echo "--- Démarrage du portail de test (port 4235, TTL normal 10 min) ---"
export PORTAL_PORT=4235
node scripts/portail-server.js > "$SB/portail4235.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4235/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4235.log"
  exit 1
fi

echo "--- Tests Task 83 ---"
python3 scripts/test83_premiere_connexion_moderne.py
