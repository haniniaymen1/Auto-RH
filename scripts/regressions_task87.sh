#!/usr/bin/env bash
# Task 87 — régressions complètes : toutes les suites du projet.
# Chaque suite s'exécute sur sa COPIE de base (harnais dédié) ou en direct
# pour les suites task34-42. Stoppe au premier échec (set -e par suite).
set -u
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

ECHECS=0
lancer() {
  local nom="$1"; shift
  echo ""
  echo "############ $nom ############"
  if "$@" > "/tmp/reg_${nom}.log" 2>&1; then
    echo "VERT : $nom"
  else
    echo "ROUGE : $nom (journal : /tmp/reg_${nom}.log)"
    tail -15 "/tmp/reg_${nom}.log"
    ECHECS=$((ECHECS + 1))
  fi
}

lancer test64 bash scripts/test64_harnais.sh
lancer test65 bash scripts/test65_harnais.sh
lancer test66 bash scripts/test66_harnais.sh
lancer test67 bash scripts/test67_harnais.sh
lancer test69 bash scripts/test69_harnais.sh
lancer test70 bash scripts/test70_harnais.sh
lancer test71 bash scripts/test71_harnais.sh
lancer test73 bash scripts/test73_harnais.sh
lancer test74 bash scripts/test74_harnais.sh
lancer test75 bash scripts/test75_harnais.sh
lancer test76 bash scripts/test76_harnais.sh
lancer test77 bash scripts/test77_harnais.sh
lancer test78 bash scripts/test78_harnais.sh
lancer test79 bash scripts/test79_harnais.sh
lancer test80 bash scripts/test80_harnais.sh
lancer test81 bash scripts/test81_harnais.sh
lancer test82 bash scripts/test82_harnais.sh
lancer test83 bash scripts/test83_harnais.sh
lancer test84 bash scripts/test84_harnais.sh
lancer test85 bash scripts/test85_harnais.sh
lancer test86 bash scripts/test86_harnais.sh
lancer test87 bash scripts/test87_harnais.sh
lancer task34 python3 scripts/test_task34_superadmin.py
lancer task36 python3 scripts/test_task36_sans_snippet.py
lancer task37 python3 scripts/test_task37_sans_historique.py
lancer task38 python3 scripts/test_task38_sans_lanceurs.py
lancer task40 python3 scripts/test_task40_securisation_auto.py
lancer task42 python3 scripts/test_task42_demarrage_unique.py

echo ""
echo "============================================="
if [ "$ECHECS" -eq 0 ]; then
  echo "RÉGRESSIONS TASK 87 : 28 SUITES, TOUTES VERTES"
else
  echo "RÉGRESSIONS TASK 87 : $ECHECS SUITE(S) ROUGE(S)"
fi
echo "============================================="
exit "$ECHECS"
