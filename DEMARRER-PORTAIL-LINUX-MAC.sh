#!/usr/bin/env bash
# ============================================================
#   Fiches de Paie - PORTAIL EMPLOYES (sans connexion) - LINUX / macOS
#
#   Une seule page : recherche par numero de CIN.
#   Port 4001 (DIFFERENT du port de l'administration : 4000).
#
#   Utilisation :
#     bash DEMARRER-PORTAIL-LINUX-MAC.sh
#   (ou : chmod +x DEMARRER-PORTAIL-LINUX-MAC.sh puis ./DEMARRER-PORTAIL-LINUX-MAC.sh)
# ============================================================
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

fail() {
    echo ""
    echo "[ERREUR] $1"
    echo ""
    exit 1
}

echo ""
echo "============================================================"
echo "  Fiches de Paie - Portail Employes (recherche par CIN, sans login)"
echo "  Administration : port 4000   -   Portail : port 4001"
echo "  Dossier : $(pwd)"
echo "============================================================"
echo ""

# ---------- 1) Verifier que Node.js est installe ----------
if ! command -v node >/dev/null 2>&1; then
    echo "[ERREUR] Node.js n'est pas installe sur ce poste."
    echo "  Installez Node.js 20+ (https://nodejs.org) puis relancez."
    exit 1
fi
NODE_VERSION="$(node -v)"
echo "[1/4] Node.js detecte : $NODE_VERSION"

# ---------- 2) Preparer le .env avec le chemin absolu de la base ----------
PROJECT_DIR="$(pwd)"
touch .env
if ! grep -q '^DATABASE_URL=' .env; then
    printf 'DATABASE_URL=file:%s/db/custom.db\n' "$PROJECT_DIR" >> .env
fi
export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"
# Dossier des PDF du site : chemin ABSOLU (correctif « PDF introuvable »)
export AUTO_RH_STORAGE_DIR="${PROJECT_DIR}/storage/payslips"
echo "[2/4] Base de donnees configuree : db/custom.db"

# Task 40 : securisation AUTOMATIQUE des dossiers sensibles (.env, db,
# storage, logs, backups) - silencieuse, reversible, ne bloque jamais.
node scripts/securiser-auto.js >/dev/null 2>&1 || true

# ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
# via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ]; then
    echo "[3/4] Installation ou completion des dependances (3 a 5 minutes)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    fail "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || fail "La generation du client Prisma a echoue."
else
    echo "[3/4] Dependances deja installees."
fi

# ---------- 4) Creer la base si elle n'existe pas ----------
if [ ! -f "db/custom.db" ]; then
    echo "[4/4] Creation de la base de donnees..."
    # MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
    node node_modules/prisma/build/index.js db push || fail "La creation de la base de donnees a echoue."
else
    echo "[4/4] Base de donnees presente."
fi

# ---------- Adresse IP du poste (pour l'acces depuis le reseau) ----------
LAN_IP=""
if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    LAN_IP="$(hostname -I | awk '{print $1}')"
elif command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi

echo ""
echo "============================================================"
echo "  Portail pret !  http://localhost:4001"
if [ -n "$LAN_IP" ]; then
    echo "  Acces reseau local :  http://${LAN_IP}:4001"
fi
echo ""
echo "  Rappel : administration RH/IT sur le port 4000 (login requis)."
echo "  Laissez ce terminal OUVERT. Ctrl+C = arreter le portail."
echo "============================================================"
echo ""

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:4001 >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open http://localhost:4001 >/dev/null 2>&1 &
fi

exec node scripts/portail-server.js
