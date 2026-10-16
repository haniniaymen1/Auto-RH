#!/bin/bash
# Ré-import complet des fiches (Task 141) — les fichiers sur disque sont EN CLAIR
# (déchiffrés temporairement) ; l'API les re-chiffre à l'import. Journal détaillé.
cd /home/z/my-project
LOG=/tmp/reimport-141.log
echo "=== Ré-import $(date -Iseconds) ===" >> "$LOG"
curl -s -c /tmp/cookie141.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@autorh.local","password":"AutoRH-2026!RH2"}' -o /dev/null
total=0; ok=0; ko=0
for f in storage/payslips/*.pdf; do
  base=$(basename "$f")
  [ "$base" = "1789395058525-509cd565d702197f.pdf" ] && continue  # déjà importé
  total=$((total+1))
  r=$(curl -s -b /tmp/cookie141.txt -X POST http://localhost:4000/api/payslips/upload -F "files=@$f")
  if echo "$r" | rg -q '"status":"SUCCESS"'; then ok=$((ok+1)); else ko=$((ko+1)); echo "ECHEC $base : $(echo "$r" | head -c 160)" >> "$LOG"; fi
  [ $((total % 25)) -eq 0 ] && echo "avance : $total traitées ($ok ok, $ko ko)" >> "$LOG"
done
echo "=== TERMINÉ : $total traitées, $ok succès, $ko échecs ===" >> "$LOG"
