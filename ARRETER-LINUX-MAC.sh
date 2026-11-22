#!/usr/bin/env bash
# ============================================================
#   Auto RH (PaieSage) - ARRET du site - LINUX / macOS  (NOUVEAU v0.2.210)
#
#   Utilisation :
#     bash ARRETER-LINUX-MAC.sh
#   (ou : chmod +x ARRETER-LINUX-MAC.sh puis ./ARRETER-LINUX-MAC.sh)
#
#   Arrete PROPREMENT les deux interfaces (administration RH/IT et
#   portail employes), demarrees par n'importe quel lanceur :
#     - arret PRECIS par PID : seuls les processus ENREGISTRES par
#       CE projet (logs/paiesage-processus.json) sont tues, arbre
#       compris — JAMAIS un autre programme du systeme, JAMAIS de
#       commande globale kill/killall ;
#     - si un serveur tournait au PREMIER PLAN dans un terminal
#       (DEMARRER-...), fermez plutot ce terminal (Ctrl+C) ;
#     - la disponibilite des ports du .env est reverifiee a la fin ;
#     - le detail est journalise dans logs/arret-etat.txt.
#
#   Ports : lus dans le .env (PORT et PORTAL_PORT, defauts 4000/4001)
#   — identiques a gestion.sh, DEMARRER-TOUT et au moteur silencieux.
#
#   Relancer ensuite : bash DEMARRER-TOUT-LINUX-MAC.sh
#          (ou : bash gestion.sh demarrer-silencieux)
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
echo "  Auto RH - Arret des services en local"
echo "  Dossier : $(pwd)"
echo "============================================================"
echo ""

# ---------- 1) Verifier que Node.js est installe ----------
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js n'est pas installe sur ce poste : les serveurs ne peuvent pas etre identifies. Installez Node.js 20+ (https://nodejs.org) puis relancez."
fi
echo "[1/3] Node.js detecte : $(node -v)"

# ---------- 2) Ports : meme priorite que gestion.sh / moteur silencieux ----------
#    PAIESAGE_PORT_ADMIN > PORT (.env) > 4000
#    PAIESAGE_PORT_PORTAIL > PORTAL_PORT (.env) > 4001
PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
PORT="${PORT:-4000}"
PORTAL_PORT="$(grep -E '^PORTAL_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
PORTAL_PORT="${PORTAL_PORT:-4001}"
PAIESAGE_PORT_ADMIN="$(grep -E '^PAIESAGE_PORT_ADMIN=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
PAIESAGE_PORT_PORTAIL="$(grep -E '^PAIESAGE_PORT_PORTAIL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
PORT="${PAIESAGE_PORT_ADMIN:-${PORT}}"
PORTAL_PORT="${PAIESAGE_PORT_PORTAIL:-${PORTAL_PORT}}"
echo "[2/3] Ports du .env : administration=${PORT}, portail=${PORTAL_PORT}"

# ---------- 3) Arret precis par PID (moteur du projet) ----------
echo "[3/3] Arret des serveurs enregistres..."
node scripts/service-paiesage.js stop || true

# ---------- Verification finale : ports libres ? ----------
#    Code retour du verificateur : 0 = libre ; 1 = autre programme ;
#    2 = encore en cours par CETTE application (arret incomplet).
LIBRES=1
ENCOURS=0
node scripts/verifier-ports.js verifier "$PORT" "Administration RH/IT" PORT >/dev/null 2>&1
case $? in 2) LIBRES=0; ENCOURS=1 ;; 1|3) LIBRES=0 ;; esac
node scripts/verifier-ports.js verifier "$PORTAL_PORT" "Portail employes" PORTAL_PORT >/dev/null 2>&1
case $? in 2) LIBRES=0; ENCOURS=1 ;; 1|3) LIBRES=0 ;; esac

echo ""
if [ "$LIBRES" -eq 1 ]; then
    echo "============================================================"
    echo "  Arret termine : les ports ${PORT} et ${PORTAL_PORT} sont libres."
    echo "  Detail : logs/arret-etat.txt"
    echo "============================================================"
elif [ "$ENCOURS" -eq 1 ]; then
    echo "============================================================"
    echo "  Arret INCOMPLET : un serveur de CETTE application ecoute"
    echo "  encore. Relancez ce script, ou consultez le journal :"
    echo "  bash gestion.sh journaux arret"
    echo "============================================================"
else
    echo "============================================================"
    echo "  Arret termine, MAIS un port reste occupe par un AUTRE"
    echo "  programme (aucun processus etranger n'a ete touche)."
    echo "  Identifiez-le :  bash gestion.sh ports"
    echo "  Detail : logs/arret-etat.txt"
    echo "============================================================"
fi
echo ""
exit 0
