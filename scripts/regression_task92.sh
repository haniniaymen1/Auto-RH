#!/usr/bin/env bash
# Task 92 — RÉGRESSIONS COMPLÈTES : toutes les suites (34 -> 92), séquentiel.
cd /home/z/my-project
declare -a RESULTATS=()

lancer() {
  local nom="$1"; shift
  echo "════════ $nom ════════"
  if "$@" > "/tmp/reg_${nom}.log" 2>&1; then
    RESULTATS+=("OK   $nom")
    echo "→ OK ($nom)"
  else
    RESULTATS+=("KO   $nom")
    echo "→ KO ($nom) — voir /tmp/reg_${nom}.log"
  fi
}

lancer test64 bash scripts/test64_harnais.sh
for t in 65 66 67 69 70 71 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92; do
  h="scripts/test${t}_harnais.sh"
  [ -f "$h" ] && lancer "test$t" bash "$h"
done
lancer task34 python3 scripts/test_task34_superadmin.py
lancer task36 python3 scripts/test_task36_sans_snippet.py
lancer task37 python3 scripts/test_task37_sans_historique.py
lancer task38 python3 scripts/test_task38_sans_lanceurs.py
lancer task40 python3 scripts/test_task40_securisation_auto.py
lancer task42 python3 scripts/test_task42_demarrage_unique.py

echo ""
echo "════════ BILAN ════════"
ko=0
for r in "${RESULTATS[@]}"; do
  echo "$r"
  [[ "$r" == KO* ]] && ko=$((ko+1))
done
echo "Suites en échec : $ko"
exit $ko
