#!/usr/bin/env bash
# ============================================================
#   Fiches de Paie - Demarrage automatique sous LINUX / macOS
#
#   Utilisation :
#     bash DEMARRER-LINUX-MAC.sh
#   (ou : chmod +x DEMARRER-LINUX-MAC.sh puis ./DEMARRER-LINUX-MAC.sh)
#
#   Premiere execution : installation + build (3 a 5 minutes)
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
echo "  Fiches de Paie - Demarrage du site en local"
echo "  Dossier : $(pwd)"
echo "============================================================"
echo ""

# ---------- 1) Verifier que Node.js est installe ----------
if ! command -v node >/dev/null 2>&1; then
    echo "[ERREUR] Node.js n'est pas installe sur ce poste."
    echo ""
    echo "  Debian/Ubuntu :  sudo apt install -y curl"
    echo "                   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "                   sudo apt install -y nodejs"
    echo "  macOS         :  brew install node   (ou https://nodejs.org)"
    echo ""
    exit 1
fi
NODE_VERSION="$(node -v)"
echo "[1/5] Node.js detecte : $NODE_VERSION"

# ---------- 2) Preparer le fichier .env avec le chemin absolu de la base ----------
# Prisma exige un chemin ABSOLU pour SQLite.
# AUTH_SECRET (signature des sessions) est CONSERVE s'il existe deja, sinon il
# est cree. (Les comptes RH/IT sont crees par le superadministrateur depuis
# l'onglet Utilisateurs — plus aucun code d'inscription automatique.)
PROJECT_DIR="$(pwd)"
touch .env
grep -v '^DATABASE_URL=' .env > .env.tmp 2>/dev/null || true
printf 'DATABASE_URL=file:%s/db/custom.db\n' "$PROJECT_DIR" >> .env.tmp
if ! grep -q '^AUTH_SECRET=' .env.tmp; then
    printf 'AUTH_SECRET=%s\n' "$(node scripts/gen-secret.js)" >> .env.tmp
fi
mv .env.tmp .env
export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"
# Dossier des PDF : chemin ABSOLU (correctif « PDF introuvable », build standalone)
export AUTO_RH_STORAGE_DIR="${PROJECT_DIR}/storage/payslips"
echo "[2/5] Base de donnees et securite configurees"

# Task 40 : securisation AUTOMATIQUE des dossiers sensibles (.env, db,
# storage, logs, backups) - silencieuse, reversible, ne bloque jamais.
node scripts/securiser-auto.js >/dev/null 2>&1 || true

# ---------- 3) Installer les dependances (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma ET Next LOCAUX (npm install relance s'ils manquent) puis appel du
# CLI LOCAL via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/next/dist/bin/next" ] || [ ! -f "node_modules/nodemailer/package.json" ]; then  # (MODIFIE Task 92 : nodemailer pour le service Send Mail)
    echo "[3/5] Installation ou completion des dependances (3 a 5 minutes)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
else
    echo "[3/5] Dependances deja installees."
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    fail "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || fail "La generation du client Prisma a echoue."
fi

# ---------- 4) Creer / mettre a jour la base de donnees SQLite ----------
echo "[4/5] Verification de la base de donnees..."
# MODIFIE Task 89 : CLI Prisma LOCAL (plus de npx — cf. section 3).
node node_modules/prisma/build/index.js db push || fail "La creation de la base de donnees a echoue."

# ---------- 5) Build de production (1ere fois OU NOUVELLE VERSION) ----------
# (MODIFIE 0.2.53) le controle est fait par un VRAI fichier JS,
# scripts/verifier-build-a-jour.js (exit 0 = a jour, exit 1 = a construire),
# et plus par un node -e inline. Logique conservee : on construit si node
# est ABSENT ou si le controle ECHOUE (|| — l'ancien && court-circuitait).
# (NOUVEAU 0.2.168) Contrôle d'intégrité de l'extraction avant tout build
if [ -f "MANIFEST-LIVRAISON.txt" ] && [ -f "scripts/verifier-extraction.js" ]; then
    node scripts/verifier-extraction.js --complet || fail "Extraction incomplete : re-extrayez TOUT le contenu du ZIP dans ce dossier puis relancez."
fi
if ! command -v node >/dev/null 2>&1 || ! node scripts/verifier-build-a-jour.js; then
    echo "[5/5] Construction du site necessaire (premiere fois ou NOUVELLE VERSION extraite) : 2 a 4 minutes..."
    node node_modules/next/dist/bin/next build || fail "Le build a echoue."
    node scripts/copy-standalone-assets.js || fail "La copie des ressources a echoue."
else
    echo "[5/5] Build de production deja a jour (version du build = version du package)."
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
echo "  Site pret !  http://localhost:4000"
if [ -n "$LAN_IP" ]; then
    echo "  Acces reseau local :  http://${LAN_IP}:4000"
fi
echo ""
echo "  Laissez ce terminal OUVERT pendant l'utilisation."
echo "  Ctrl+C = arreter le site."
echo "============================================================"
echo ""

exec node scripts/start-prod.js
