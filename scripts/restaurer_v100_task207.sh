#!/bin/bash
# ============================================================================
# Task 207 — Restauration de l'environnement Auto-RH v0.2.100
# (procédure Task 205 ré-appliquée : le sandbox a été réinitialisé et le
#  dépôt /home/z/my-project est reparti de l'ancien instantané v0.2.82 ;
#  le miroir /tmp/my-project = état final Task 206, v0.2.100)
# ============================================================================
set -uo pipefail
MIROIR=/tmp/my-project
PROJET=/home/z/my-project
TS=$(date +%Y%m%d-%H%M%S)

etape() { echo ""; echo "======== $1 ========"; }

etape "0. Sauvegarde DB actuelle (v0.2.82)"
cp -p "$PROJET/db/custom.db" "$PROJET/db/custom.db.avant-restauration-v100-$TS.bak" \
  && echo "sauvegarde OK : db/custom.db.avant-restauration-v100-$TS.bak"

etape "1. rsync dossiers applicatifs (miroir -> projet)"
# src avec exclusions des artéfacts signup purgés (Task 198) encore présents dans le miroir
rsync -a \
  --exclude "src/app/api/auth/signup" \
  --exclude "src/app/signup" \
  --exclude "src/lib/signup-code.ts" \
  "$MIROIR/src/" "$PROJET/src/"
rsync -a "$MIROIR/prisma/" "$PROJET/prisma/"
rsync -a \
  --exclude "gen-signup-code.js" \
  --exclude "test_task31_signup_code.py" \
  "$MIROIR/scripts/" "$PROJET/scripts/"
rsync -a "$MIROIR/public/" "$PROJET/public/"
rsync -a "$MIROIR/download/" "$PROJET/download/"
rsync -a "$MIROIR/storage/" "$PROJET/storage/"
rsync -a "$MIROIR/test-data/" "$PROJET/test-data/"
[ -d "$MIROIR/documents-demandes" ] && rsync -a "$MIROIR/documents-demandes/" "$PROJET/documents-demandes/"
[ -d "$MIROIR/home" ] && rsync -a "$MIROIR/home/" "$PROJET/home/"
[ -d "$MIROIR/upload" ] && rsync -a "$MIROIR/upload/" "$PROJET/upload/"
[ -d "$MIROIR/mini-services" ] && rsync -a "$MIROIR/mini-services/" "$PROJET/mini-services/"
[ -d "$MIROIR/tests" ] && rsync -a "$MIROIR/tests/" "$PROJET/tests/"
echo "rsync dossiers terminés"

etape "2. Fichiers racine"
for f in package.json package-lock.json next.config.ts tailwind.config.ts tsconfig.json \
         components.json postcss.config.mjs eslint.config.mjs \
         Dockerfile docker-compose.yml .dockerignore .env.example \
         README-DEPLOIEMENT-LOCAL.md Caddyfile worklog.md fra.traineddata \
         next-env.d.ts auto-rh-readme-technique.pdf signatures-exemple-auto-rh.zip; do
  if [ -f "$MIROIR/$f" ]; then cp -p "$MIROIR/$f" "$PROJET/$f"; fi
done
for f in "$MIROIR"/LIRE-MOI-*.txt; do
  [ -f "$f" ] && cp -p "$f" "$PROJET/"
done
for f in "$MIROIR"/*.bat "$MIROIR"/*.vbs "$MIROIR"/*.sh; do
  b=$(basename "$f")
  [ "$b" = "SECURISER-INSCRIPTION-WINDOWS.bat" ] && continue  # purgé Task 198
  [ -f "$f" ] && cp -p "$f" "$PROJET/"
done
echo "fichiers racine copiés"

etape "3. Nettoyage download/ — discipline Task 206 (readme : v0.2.100 + générique seulement)"
cd "$PROJET/download" || exit 1
for f in auto-rh-readme-technique-v0.2.*.pdf; do
  [ -e "$f" ] || continue
  case "$f" in
    *v0.2.100*) echo "gardé   : $f" ;;
    *) mv -f "$f" /tmp/my-project/archive-readmes-20260927/ 2>/dev/null && echo "archivé : $f" ;;
  esac
done

etape "4. Base de données = celle du miroir (v0.2.100)"
cp -p "$MIROIR/db/custom.db" "$PROJET/db/custom.db" && echo "db/custom.db remplacée"

etape "5. node_modules + prisma"
cd "$PROJET" || exit 1
npm install --no-audit --no-fund 2>&1 | tail -3
npx prisma generate 2>&1 | tail -2
npx prisma db push 2>&1 | tail -3

etape "6. Build production (standalone)"
npm run build 2>&1 | tail -6

etape "7. Services 4000/4001 (arrêt du next dev du sandbox + service moteur)"
pkill -f "next dev -p 4000" 2>/dev/null && echo "next dev arrêté" || echo "pas de next dev"
pkill -f "next-server" 2>/dev/null && echo "next-server arrêté" || echo "pas de next-server"
sleep 2
node scripts/auto-rh.js restart 2>&1 | tail -8

etape "8. Santé de base"
sleep 3
ADMIN=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/ || echo "?")
PORTAIL=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4001/ || echo "?")
echo "admin 4000 -> HTTP $ADMIN (307 attendu)"
echo "portail 4001 -> HTTP $PORTAIL (200 attendu)"
echo ""
echo "RESTAURATION TERMINÉE (TS=$TS)"
