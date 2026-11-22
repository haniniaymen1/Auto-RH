#!/usr/bin/env bash
# Task 94 — balayage de régressions, PAR LOT (appel : regressions_task94.sh <nom> [<nom>...]).
# Chaque suite est lancée avec un timeout pour qu'aucun blocage n'arrête le balayage.
set -u
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
LOG=/tmp/regressions_task94.log
RECAP=/tmp/regressions_task94.recap

for nom in "$@"; do
  harnais="scripts/test${nom}_harnais.sh"
  py="scripts/test_task${nom}_superadmin.py"
  echo "===== test${nom} =====" >> "$LOG"
  debut=$(date +%s)
  if [ -f "$harnais" ]; then
    timeout 560 bash "$harnais" >> "$LOG" 2>&1
  elif [ "$nom" = "34" ]; then
    timeout 300 python3 scripts/test_task34_superadmin.py >> "$LOG" 2>&1
  elif [ "$nom" = "36" ]; then
    timeout 300 python3 scripts/test_task36_sans_snippet.py >> "$LOG" 2>&1
  elif [ "$nom" = "37" ]; then
    timeout 300 python3 scripts/test_task37_sans_historique.py >> "$LOG" 2>&1
  elif [ "$nom" = "38" ]; then
    timeout 300 python3 scripts/test_task38_sans_lanceurs.py >> "$LOG" 2>&1
  elif [ "$nom" = "40" ]; then
    timeout 300 python3 scripts/test_task40_securisation_auto.py >> "$LOG" 2>&1
  elif [ "$nom" = "42" ]; then
    timeout 300 python3 scripts/test_task42_demarrage_unique.py >> "$LOG" 2>&1
  else
    echo "harnais introuvable pour $nom" >> "$LOG"
    timeout 1 false
  fi
  rc=$?
  fin=$(date +%s)
  if [ $rc -eq 0 ]; then
    echo "[test${nom}] OK ($((fin-debut))s)" >> "$RECAP"
  elif [ $rc -eq 124 ]; then
    echo "[test${nom}] TIMEOUT ($((fin-debut))s)" >> "$RECAP"
  else
    echo "[test${nom}] ECHEC rc=$rc ($((fin-debut))s)" >> "$RECAP"
  fi
done
echo "--- lot terminé : $* ---"
