#!/usr/bin/env bash
# Task 82 — harnais de test « champ Code OTP dans le formulaire de connexion ».
# PRINCIPE : tests fonctionnels UNIQUEMENT sur une COPIE de la base (jamais
# sur la base réelle). UN serveur de test :
#   - port 4234 : portail employés (TTL par défaut 10 minutes) — parcours
#     complets : (1) connexion en UNE étape CIN + mot de passe + code OTP de
#     l'application d'authentification (le NOUVEAU 3e champ du formulaire)
#     → changement OBLIGATOIRE du mot de passe initial AFFICHÉ (/changer) →
#     mot de passe personnel → reconnexions suivantes en UNE étape ;
#     (2) code parasite ignoré à la PREMIÈRE connexion (parcours QR intact) ;
#     (3) code incorrect → messages explicites, compteur, verrouillage ;
#     (4) champ VIDE → parcours en deux étapes inchangé (double voie).
# Réutilise le jeu de données Task 64 (TEST64CIN / Initial64x et
# TEST64EXPIRE / AncienMotDePasse64) via scripts/test64_inserer.js.
# Portable : la racine du projet est déduite de l'emplacement de CE script
# (dépôt de développement OU archive extraite).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-test82"
rm -rf "$SB"
mkdir -p "$SB"
cp db/custom.db "$SB/test82.db"
set -a
. ./.env
set +a
export DATABASE_URL="file:$SB/test82.db"
export HOSTNAME=127.0.0.1

echo "--- Préparation du jeu de données (COPIE) ---"
node scripts/test64_inserer.js inserer

echo "--- Démarrage du portail de test (port 4234, TTL normal 10 min) ---"
export PORTAL_PORT=4234
node scripts/portail-server.js > "$SB/portail4234.log" 2>&1 &
SRV1=$!

trap 'kill $SRV1 2>/dev/null || true' EXIT

ATTENDU1=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4234/ || true)
  if [ "$code" = "200" ]; then ATTENDU1=1; break; fi
  sleep 1
done
if [ "$ATTENDU1" != "1" ]; then
  echo "SERVEUR DE TEST DÉMARRAGE KO — extrait du journal :"
  tail -20 "$SB/portail4234.log"
  exit 1
fi

echo "--- Tests Task 82 ---"
python3 scripts/test82_champ_otp_connexion.py
