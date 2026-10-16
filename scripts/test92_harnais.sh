#!/usr/bin/env bash
# Task 92 — harnais « Send Mail » : COPIE VIERGE (jamais la base réelle).
# 1) db/test-task92.db = schéma seul (prisma db push) + données de test.
# 2) MINI SERVEUR SMTP LOCAL port 1925 (capture des messages — aucun envoi Internet).
# 3) Serveur admin de test 4200 (standalone) -> test92_send_mail.py
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
BASETEST="$RACINE/db/test-task92.db"
SMTPPORT=1925
SMTPDIR=/tmp/test92-smtp

rm -rf "$SMTPDIR"
rm -f "$BASETEST"
set -a; . ./.env; set +a
export DATABASE_URL="file:$BASETEST"
npx prisma db push --skip-generate > /dev/null 2>&1
node scripts/test92_inserer.js
node scripts/test92_inserer.js user

python3 scripts/test92_serveur_smtp.py --port "$SMTPPORT" --out "$SMTPDIR" > /tmp/test92-smtp.log 2>&1 &
SMTP_PID=$!
export PORT=4200
export HOSTNAME=127.0.0.1
echo "--- Test92 SEND MAIL (admin 4200 + mini SMTP 1925, COPIE vierge) ---"
node .next/standalone/server.js > /tmp/test92-admin.log 2>&1 &
SRV=$!
trap 'kill $SRV $SMTP_PID 2>/dev/null || true; rm -f "$BASETEST"' EXIT
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4200/login || true)
  [ "$code" = "200" ] && break
  sleep 1
done
python3 scripts/test92_send_mail.py "$SMTPDIR"
