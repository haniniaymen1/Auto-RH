#!/bin/bash
# ============================================================================
# Task 208 — Phase A : arrêt services + sauvegardes + secrets dans .env
# Rotation des clés de chiffrement (AUTO_RH_STORAGE_KEY + AUTH_SECRET)
# ============================================================================
set -uo pipefail
cd /home/z/my-project
TS=$(date +%Y%m%d-%H%M%S)

echo "== 1. Arrêt des services =="
node scripts/auto-rh.js stop 2>&1 | tail -3

echo "== 2. Sauvegardes (db + storage + tampons + documents-demandes) =="
mkdir -p backups
TAR="backups/avant-rotation-cles-$TS.tar.gz"
tar czf "$TAR" db/custom.db storage/payslips storage/tampons storage/documents-demandes 2>/dev/null
chmod 600 "$TAR"
echo "sauvegarde : $TAR ($(du -h "$TAR" | cut -f1))"
cp -p db/custom.db "db/custom.db.avant-rotation-$TS.bak" && chmod 600 "db/custom.db.avant-rotation-$TS.bak"

echo "== 3. État AVANT .env =="
cat .env

echo "== 4. Génération des secrets + ajout .env (additif) =="
AUTH_SECRET_NEW=$(openssl rand -hex 48)
STORAGE_KEY_NEW=$(openssl rand -base64 48)
if grep -q "^AUTH_SECRET=" .env; then echo "AUTH_SECRET déjà présent — non modifié"; else
  printf '\n# Secret de signature des sessions (HMAC) — Task 208, NE PAS PERDRE, ne jamais commiter\nAUTH_SECRET=%s\n' "$AUTH_SECRET_NEW" >> .env
fi
if grep -q "^AUTO_RH_STORAGE_KEY=" .env; then echo "AUTO_RH_STORAGE_KEY déjà présent — non modifié"; else
  printf '# Clé de chiffrement dédiée (fiches storage + champs DB) — Task 208, NE PAS PERDRE, ne jamais commiter\nAUTO_RH_STORAGE_KEY=%s\n' "$STORAGE_KEY_NEW" >> .env
fi
chmod 600 .env
echo "permissions : $(stat -c %a .env) (.env)"
echo "== 5. État APRÈS .env (secrets masqués) =="
sed -E 's/^(AUTH_SECRET|AUTO_RH_STORAGE_KEY)=.*/\1=<masqué, '"$(awk -F= '/^(AUTH_SECRET|AUTO_RH_STORAGE_KEY)=/{print length($2)}' .env | paste -sd/ -)"' caractères>/' .env

echo "== 6. Confirmations audit =="
grep -q "^AUTO_RH_STORAGE_DISABLE=1" .env && echo "⚠ AUTO_RH_STORAGE_DISABLE=1 ACTIF" || echo "AUTO_RH_STORAGE_DISABLE : non défini → chiffrement ACTIF ✓"
grep -q "^\.env" .gitignore && echo ".env ignoré par git ✓" || (grep -q "env" .gitignore && echo ".env couvert par .gitignore (.env*) ✓")
echo "PHASE A TERMINÉE"
