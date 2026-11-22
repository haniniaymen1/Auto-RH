#!/usr/bin/env bash
# Task 75 — SONDE : prouve le comportement ANCIEN (Task 74) : le QR/OTP est
# exigé À CHAQUE validation CIN + mot de passe (même après une 1re connexion
# complète). Test sur COPIE de la base, portail jetable port 4209, trap EXIT.
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-sonde75"
rm -rf "$SB"; mkdir -p "$SB"
cp db/custom.db "$SB/sonde75.db"
set -a; . ./.env; set +a
export DATABASE_URL="file:$SB/sonde75.db"
export HOSTNAME=127.0.0.1
node scripts/test66_inserer.js inserer >/dev/null
PORTAL_PORT=4209 node scripts/portail-server.js > "$SB/portail.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; rm -rf "$SB"' EXIT
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4209/ || true)
  [ "$code" = "200" ] && break; sleep 1
done

B=http://127.0.0.1:4209
echo "== CONNEXION N°1 (TEST66ESPA) =="
C1=$(curl -s -c "$SB/ck1" -X POST "$B/api/verify" -H 'Content-Type: application/json' \
  -d '{"cin":"TEST66ESPA","password":"MotDePasse66"}')
echo "verify: $C1"
CODE1=$(curl -s -b "$SB/ck1" "$B/otp" | grep -o '<svg' | head -n1)
echo "QR présent page /otp : ${CODE1:-NON}"
OTP=$(curl -s -b "$SB/ck1" "$B/otp" | grep -o 'id="otp-affiche">[0-9]* [0-9]*<' | grep -o '[0-9]' | tr -d '\n')
echo "code OTP lu : $OTP"
curl -s -b "$SB/ck1" -c "$SB/ck1" -X POST "$B/api/otp/verify" -H 'Content-Type: application/json' -d "{\"otp\":\"$OTP\"}"; echo
curl -s -b "$SB/ck1" -c "$SB/ck1" -X POST "$B/api/logout" >/dev/null
echo "== CONNEXION N°2 (même CIN, après déconnexion) =="
C2=$(curl -s -c "$SB/ck2" -X POST "$B/api/verify" -H 'Content-Type: application/json' \
  -d '{"cin":"TEST66ESPA","password":"MotDePasse66"}')
echo "verify: $C2"
echo "$C2" | grep -q '"otpRequired":true' && echo "=> ANCIEN COMPORTEMENT CONFIRMÉ : OTP/QR exigé aussi à la 2e connexion" \
  || echo "=> OTP non exigé à la 2e connexion"
