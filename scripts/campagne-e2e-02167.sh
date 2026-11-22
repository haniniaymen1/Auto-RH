#!/bin/bash
# Pilote E2E complet 4 types × acceptation/refus — v0.2.167
cd /home/z/my-project
L=/tmp/e2e-4types-02167.log
echo "=== CAMPAIGNE E2E COMPLÈTE v0.2.167 — démarrée $(date '+%H:%M:%S') ===" > "$L"
for PHASE in preparer vague-a vague-b1 vague-b2 vague-c1 vague-c2 verifier; do
  echo "" >> "$L"
  echo "########## PHASE $PHASE — $(date '+%H:%M:%S') ##########" >> "$L"
  node scripts/test_complet_4types.js "$PHASE" >> "$L" 2>&1
  RC=$?
  echo "########## PHASE $PHASE fin (exit $RC) — $(date '+%H:%M:%S') ##########" >> "$L"
  if [ $RC -ne 0 ]; then echo "ARRÊT : phase $PHASE en échec (exit $RC)" >> "$L"; exit $RC; fi
  # pause pour laisser le poller IMAP (15 s) traiter les réponses injectées
  if [ "$PHASE" != "verifier" ] && [ "$PHASE" != "preparer" ]; then
    echo "(attente 80 s pour le poller IMAP…)" >> "$L"
    sleep 80
  fi
  if [ "$PHASE" == "preparer" ]; then
    echo "(attente 30 s après création des demandes…)" >> "$L"
    sleep 30
  fi
done
echo "" >> "$L"
echo "=== CAMPAIGNE TERMINÉE $(date '+%H:%M:%S') — nettoyage ===" >> "$L"
node scripts/test_complet_4types.js nettoyer >> "$L" 2>&1
echo "=== RAPPORT FINAL ===" >> "$L"
node scripts/test_complet_4types.js rapport >> "$L" 2>&1
echo "=== FIN $(date '+%H:%M:%S') ===" >> "$L"
