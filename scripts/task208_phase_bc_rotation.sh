#!/bin/bash
# ============================================================================
# Task 208 — Phase B/C : archivage des fiches orphelines + rotation des clés
# (storage restant + base de données), avec l'outil officiel chiffrer-base.js
# ============================================================================
set -uo pipefail
cd /home/z/my-project
TS=$(date +%Y%m%d-%H%M%S)
ANCIENNE='autorh-storage-local-a-changer-dans-env'

echo "== 1. Archivage des fiches orphelines (base : 0 ligne Payslip) =="
ORPHELINS="backups/fiches-orphelines-cle-perdue-$TS"
mkdir -p "$ORPHELINS"
n=0
if [ -d storage/payslips ]; then
  for f in storage/payslips/*; do
    [ -e "$f" ] || continue
    mv "$f" "$ORPHELINS/" && n=$((n+1))
  done
fi
chmod 700 "$ORPHELINS"
echo "fichiers orphelins déplacés vers $ORPHELINS : $n"
echo "suppression des copies standalone inutilisées (.next/standalone/storage)…"
rm -rf .next/standalone/storage
echo "storage/payslips après nettoyage : $(ls storage/payslips 2>/dev/null | wc -l) fichier(s)"

echo ""
echo "== 2. Rotation BASE : déchiffrement avec l'ANCIENNE matière =="
AUTO_RH_STORAGE_KEY="$ANCIENNE" node scripts/chiffrer-base.js --dechiffrer 2>&1 | tail -18

echo ""
echo "== 3. Rotation BASE : re-chiffrement avec la NOUVELLE clé (.env) =="
node scripts/chiffrer-base.js 2>&1 | tail -18

echo ""
echo "== 4. Rotation STORAGE restant (tampons + documents) avec la NOUVELLE clé =="
node scripts/chiffrer-storage.js 2>&1 | tail -12

echo ""
echo "== 5. Vérifications =="
echo "--- storage --verifier ---"
node scripts/chiffrer-storage.js --verifier 2>&1 | grep -E "Fichiers examinés|Chiffrés|En clair|Erreurs"
echo "--- base --statut ---"
node scripts/chiffrer-base.js --statut 2>&1 | tail -12
echo "PHASE B/C TERMINÉE"
