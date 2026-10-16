#!/bin/bash
# VERDICT DE BUILD SUR DISQUE (protocole « sorties terminal instables »)
cd /home/z/my-project
{
  echo "=== BUILD v0.2.116 — $(date -Iseconds) ==="
  npm run build 2>&1
  CODE=$?
  echo "=== EXIT CODE: $CODE ==="
  if [ $CODE -eq 0 ]; then
    echo "VERDICT: BUILD_OK"
  else
    echo "VERDICT: BUILD_KO"
  fi
} > /home/z/my-project/scripts/verif-build-resultat-v02116.txt 2>&1
echo "termine"
