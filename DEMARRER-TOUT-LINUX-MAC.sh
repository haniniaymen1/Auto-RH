#!/usr/bin/env bash
# ============================================================
#   Fiches de Paie - Demarrage des DEUX interfaces - LINUX / macOS
#
#   1) Administration RH/IT (login requis) .... port 4000
#   2) Portail Employes (sans connexion) ...... port 4001
#
#   Utilisation :
#     bash DEMARRER-TOUT-LINUX-MAC.sh
# ============================================================
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

echo ""
echo "============================================================"
echo "  Fiches de Paie - Demarrage des deux interfaces"
echo "    Administration RH/IT : http://localhost:4000 (login)"
echo "    Portail Employes     : http://localhost:4001 (sans login)"
echo "  Dossier : $(pwd)"
echo "============================================================"
echo ""

# ---------- 1) Verifier que Node.js est installe ----------
if ! command -v node >/dev/null 2>&1; then
    echo "[ERREUR] Node.js n'est pas installe. Installez Node.js 20+ (https://nodejs.org) puis relancez."
    exit 1
fi

# ---------- 2) Installation commune (1ere fois ou si incomplete) ----------
# MODIFIE Task 89 : un node_modules INCOMPLET faisait ensuite appeler
# « npx prisma » qui PROPOSAIT de telecharger prisma@latest (version
# incorrecte) via un prompt interactif. Desormais : verification du CLI
# Prisma LOCAL (npm install relance s'il manque) puis appel du CLI LOCAL
# via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/nodemailer/package.json" ]; then  # (MODIFIE Task 92 : nodemailer pour le service Send Mail)
    echo "[Installation] Dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || { echo "[ERREUR] Echec de npm install."; exit 1; }
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    echo "[ERREUR] Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."; exit 1
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || { echo "[ERREUR] Echec de prisma generate."; exit 1; }
fi
if [ ! -f "db/custom.db" ]; then
    node node_modules/prisma/build/index.js db push || { echo "[ERREUR] Echec de la creation de la base."; exit 1; }
fi
echo "[OK] Installation commune terminee."

# Task 40 : securisation AUTOMATIQUE des dossiers sensibles (.env, db,
# storage, logs, backups) - silencieuse, reversible, ne bloque jamais.
node scripts/securiser-auto.js >/dev/null 2>&1 || true

# ---------- 3) Lancer les deux serveurs en arriere-plan ----------
echo ""
echo "Lancement de l'administration (port 4000)..."
nohup bash DEMARRER-LINUX-MAC.sh       > auto-rh-admin.log   2>&1 &
ADMIN_PID=$!
sleep 3
echo "Lancement du portail employes (port 4001)..."
nohup bash DEMARRER-PORTAIL-LINUX-MAC.sh > auto-rh-portail.log 2>&1 &
PORTAL_PID=$!

echo ""
echo "============================================================"
echo "  Les deux interfaces demarrent en arriere-plan :"
echo "    - Administration RH/IT : http://localhost:4000  (PID $ADMIN_PID)"
echo "        premiere fois : construction du site, 2 a 4 minutes"
echo "    - Portail Employes     : http://localhost:4001  (PID $PORTAL_PID)"
echo ""
echo "  Journaux : auto-rh-admin.log et auto-rh-portail.log"
echo "  Arreter  :  kill $ADMIN_PID $PORTAL_PID   (ou fermer le terminal)"
echo "============================================================"
echo ""
echo "Ce terminal peut etre ferme ; les serveurs continuent (nohup)."
