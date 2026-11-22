#!/usr/bin/env bash
# Teste le portail employés (3001) sur les 20 fiches : recherche exacte + accès PDF
BASE="http://localhost:3001"
PASS=0; FAIL=0

check() { # $1=libellé $2=attendu $3=obtenu
  if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "ÉCHEC $1 (attendu=$2 obtenu=$3)"; FAIL=$((FAIL+1)); fi
}

echo "=== Recherche portail : chaque CIN → 1 fiche ==="
declare -A CINS=(
  [09123456]=Bulletin_Paie_01_Janvier2025.pdf [09876543]=Bulletin_Paie_02_Fevrier2025.pdf
  [04567890]=Bulletin_Paie_03_Mars2026.pdf    [01112223]=Bulletin_Paie_04_Avril2026.pdf
  [02223334]=Bulletin_Paie_05_Mai2026.pdf     [05556667]=Bulletin_Paie_06_Juin2026.pdf
  [03334445]=Bulletin_Paie_07_Juillet2026.pdf [08123456]=Bulletin_Paie_08_Aout2026.pdf
  [A123456]=Bulletin_Paie_09_Septembre2026.pdf [A654321]=Bulletin_Paie_10_Octobre2026.pdf
  [B234567]=Bulletin_Paie_11_Novembre2026.pdf  [06112233]=Bulletin_Paie_12_Decembre2026.pdf
  [1234567]=Bulletin_Paie_13_Janvier2027.pdf   [07070707]=Bulletin_Paie_14_Fevrier2027.pdf
  [04445556]=Bulletin_Paie_15_Mars2027.pdf     [06667778]=Bulletin_Paie_16_Avril2027.pdf
  [07778889]=Bulletin_Paie_17_Mai2027.pdf      [03445566]=Bulletin_Paie_18_Juin2027.pdf
  [02233445]=Bulletin_Paie_19_Juillet2027.pdf  [08889990]=Bulletin_Paie_20_Aout2027.pdf
)
for cin in "${!CINS[@]}"; do
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$cin")
  json=$(curl -s "$BASE/api/search?cin=$enc")
  total=$(echo "$json" | python3 -c "import json,sys;print(json.load(sys.stdin).get('total',-1))")
  name=$(echo "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);i=d.get('items',[]);print(i[0]['fileName'] if i else '-')")
  check "CIN $cin → 1 fiche (${CINS[$cin]})" "1|${CINS[$cin]}" "$total|$name"
done

echo "=== Requêtes partielles → 0 ==="
for p in 0912 1234 123456 654321 A123; do
  total=$(curl -s "$BASE/api/search?cin=$p" | python3 -c "import json,sys;print(json.load(sys.stdin).get('total',-1))")
  check "partiel \"$p\" → 0" "0" "$total"
done

echo "=== Accès PDF : CIN exact → 200, partiel → 403 ==="
# id de la fiche 01 via recherche
ID=$(curl -s "$BASE/api/search?cin=09123456" | python3 -c "import json,sys;print(json.load(sys.stdin)['items'][0]['id'])")
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/payslip/$ID/file?cin=09123456")
check "PDF avec CIN exact → 200" "200" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/payslip/$ID/file?cin=0912")
check "PDF avec CIN partiel → 403" "403" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/payslip/$ID/file")
check "PDF sans CIN → 400" "400" "$code"

echo; echo "BILAN PORTAIL : $PASS PASS / $FAIL ÉCHEC"
[ "$FAIL" = "0" ]
