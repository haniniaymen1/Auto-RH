# ============================================================
#  Fiches de Paie - Image Docker de production
#
#  Construction :  docker build -t auto-rh .
#  Demarrage   :  docker run -d --name auto-rh -p 4000:4000 \
#                   -v ./db:/app/db -v ./storage:/app/storage \
#                   auto-rh
#  (ou plus simple : docker compose up -d)
# ============================================================

# ---------- Etape 1 : installation des dependances ----------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

# ---------- Etape 2 : build du site ----------
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL factice : uniquement pour que "prisma generate" passe pendant le build
ENV DATABASE_URL="file:/tmp/build.db"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npx next build \
 && node scripts/copy-standalone-assets.js

# ---------- Etape 3 : image finale legere ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/app/db/custom.db \
    AUTO_RH_ROOT=/app \
    AUTO_RH_STORAGE_DIR=/app/storage/payslips

# Le build standalone contient server.js + node_modules + .next/static + public
COPY --from=builder /app/.next/standalone ./

# Portail employes (page publique de recherche par CIN, port 4001)
COPY --from=builder /app/scripts/portail-server.js ./scripts/portail-server.js

# Dossiers de donnees persistants (montes en volumes)
RUN mkdir -p /app/db /app/storage/payslips

EXPOSE 4000 4001
VOLUME ["/app/db", "/app/storage"]

CMD ["node", "server.js"]
