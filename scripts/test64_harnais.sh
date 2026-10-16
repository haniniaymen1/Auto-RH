#!/usr/bin/env bash
# Régressions Task 64 — harnais COPIE VIERGE (jamais la base réelle).
# 1) db/test-task64.db = schéma seul (prisma db push) + accès de test.
# 2) Serveur admin de test 4200  -> test64_admin.py
# 3) Base réinitialisée, serveur portail de test 4101 -> test64_portail.py
# (les tests 64 MUTENT leur copie : la base est réinitialisée entre les deux).
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
BASETEST="$RACINE/db/test-task64.db"

preparer() {
  rm -f "$BASETEST"
  set -a; . ./.env; set +a
  export DATABASE_URL="file:$BASETEST"
  npx prisma db push --skip-generate > /dev/null 2>&1
  node scripts/test64_inserer.js
}

preparer
node scripts/test64_inserer.js user
export PORT=4200
export HOSTNAME=127.0.0.1
echo "--- Test64 ADMIN (serveur de test port 4200, COPIE vierge) ---"
node .next/standalone/server.js > /tmp/test64-admin.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; kill $PORTAIL 2>/dev/null || true; rm -f "$BASETEST"' EXIT
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4200/login || true)
  [ "$code" = "200" ] && break
  sleep 1
done
python3 scripts/test64_admin.py
kill $SRV 2>/dev/null || true
wait $SRV 2>/dev/null || true

preparer
echo "--- Test64 PORTAIL (serveur de test port 4101, COPIE vierge réinitialisée) ---"
export PORTAL_PORT=4101
node scripts/portail-server.js > /tmp/test64-portail.log 2>&1 &
PORTAIL=$!
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4101/api/health || true)
  [ "$code" = "200" ] && break
  sleep 1
done
python3 scripts/test64_portail.py
