#!/bin/bash
# ============================================================================
# Task 209 — ROTATION DES CLÉS n°2 + durcissement FS du stockage
#
# CONTEXTE : le commit git 0976863 (2026-09-27 12:44:33) contient le .env
# AVEC les clés posées à 12:10 par la Task 208. Même sans remote, ces
# secrets doivent être considérés comme exposés : rotation complète
# (AUTH_SECRET + AUTO_RH_STORAGE_KEY) avec les outils officiels
# chiffrer-base.js / chiffrer-storage.js, PUIS durcissement des permissions
# (dossiers 0700, fichiers 0600) — .env étant désormais HORS suivi git.
# ============================================================================
set -euo pipefail
cd /home/z/my-project
TS=$(date +%Y%m%d-%H%M%S)

echo "== 1. Arrêt des services =="
node scripts/auto-rh.js stop >/dev/null 2>&1 || true
sleep 2
if curl -s -o /dev/null --max-time 2 http://localhost:4000/ || curl -s -o /dev/null --max-time 2 http://localhost:4001/; then
  echo "ERREUR : un serveur répond encore — arrêt manuel requis."; exit 1
fi
echo "services arrêtés (4000/4001 muets)."

echo ""
echo "== 2. Suppression des doublons standalone (storage/db/logs/backups) =="
rm -rf .next/standalone/storage .next/standalone/db .next/standalone/logs .next/standalone/backups
echo "doublons supprimés."

echo ""
echo "== 3. Sauvegardes préalables =="
mkdir -p backups
cp -p .env "backups/env-avant-rotation-task209-$TS.bak" && chmod 600 "backups/env-avant-rotation-task209-$TS.bak"
cp -p db/custom.db "backups/db-avant-rotation-task209-$TS.bak"
echo "sauvegardes : backups/env-avant-rotation-task209-$TS.bak + backups/db-avant-rotation-task209-$TS.bak"

echo ""
echo "== 4. Lecture de l'ANCIENNE clé =="
ANCIENNE=$(grep '^AUTO_RH_STORAGE_KEY=' .env | head -1 | cut -d= -f2-)
if [ -z "$ANCIENNE" ] || [ "$ANCIENNE" = "autorh-storage-local-a-changer-dans-env" ]; then
  echo "ERREUR : clé actuelle introuvable ou repli public — abandon."; exit 1
fi
echo "ancienne clé lue (${#ANCIENNE} car.) — ne sera jamais affichée."

echo ""
echo "== 5. Déchiffrement DB avec l'ANCIENNE clé =="
AUTO_RH_STORAGE_KEY="$ANCIENNE" node scripts/chiffrer-base.js --dechiffrer 2>&1 | tail -6

echo ""
echo "== 6. Déchiffrement STORAGE avec l'ANCIENNE clé =="
AUTO_RH_STORAGE_KEY="$ANCIENNE" node scripts/chiffrer-storage.js --dechiffrer 2>&1 | tail -6

echo ""
echo "== 7. Génération et pose des NOUVELLES clés (.env) =="
NOUVELLE=$(openssl rand -base64 48)
NOUVEAU_AUTH=$(openssl rand -hex 48)
sed -i "s|^AUTO_RH_STORAGE_KEY=.*|AUTO_RH_STORAGE_KEY=${NOUVELLE}|" .env
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${NOUVEAU_AUTH}|" .env
chmod 600 .env
grep -q "^AUTO_RH_STORAGE_KEY=" .env && grep -q "^AUTH_SECRET=" .env && echo ".env mis à jour (600) — clés nouvelles posées."

echo ""
echo "== 8. Re-chiffrement DB avec la NOUVELLE clé =="
node scripts/chiffrer-base.js 2>&1 | tail -6

echo ""
echo "== 9. Re-chiffrement STORAGE avec la NOUVELLE clé =="
node scripts/chiffrer-storage.js 2>&1 | tail -8

echo ""
echo "== 10. Vérifications =="
node scripts/chiffrer-storage.js --verifier 2>&1 | grep -E "Fichiers examinés|Chiffrés lors|En clair|Erreurs" || true
node scripts/chiffrer-base.js --statut 2>&1 | tail -8 || true

echo ""
echo "== 11. Durcissement FS du stockage (700 dossiers / 600 fichiers) =="
for d in storage storage/payslips storage/tampons storage/documents-demandes storage/quarantaine-cle-perdue; do
  [ -d "$d" ] && chmod 700 "$d"
done
find storage/payslips storage/tampons storage/documents-demandes storage/quarantaine-cle-perdue -type f -exec chmod 600 {} \; 2>/dev/null || true
ls -ld storage storage/tampons storage/documents-demandes | awk '{print $1, $NF}'

echo ""
echo "ROTATION TASK 209 TERMINÉE — build + restart à lancer ensuite."
