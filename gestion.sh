#!/usr/bin/env bash
# ============================================================================
#   Auto RH (PaieSage) - GESTION UNIFIEE des services - LINUX / macOS
#   (NOUVEAU v0.2.209)
#
#   Point d'entree UNIQUE pour demarrer, arreter, surveiller et configurer
#   les deux interfaces. Tous les PORTS sont lus dans le fichier .env
#   (aucun port code en dur : defauts 4000/4001 uniquement si .env absent).
#
#   Commandes :
#     demarrer [tout|admin|portail]          Demarrage NORMAL (premier plan,
#                                            Ctrl+C arrete les serveurs)
#     demarrer-silencieux [tout|admin|portail]
#                                            Demarrage en ARRIERE-PLAN detache
#                                            (aucune fenetre, journaux dans logs/)
#     arreter [tout|admin|portail]           Arret precis des serveurs
#     redemarrer [tout|admin|portail]        Arret puis redemarrage silencieux
#     etat                                   Etat des interfaces (ports, PIDs, HTTP)
#     journaux [cible] [n]                   Dernieres lignes des journaux
#     ports                                  Ports du .env + disponibilite
#     superadmin [options]                   Super administrateur (auto par defaut)
#     installer                              Dependances + client Prisma + base
#     aide                                   Cette aide
#
#   Exemples :
#     bash gestion.sh demarrer-silencieux
#     bash gestion.sh demarrer admin
#     bash gestion.sh etat
#     bash gestion.sh ports
#     bash gestion.sh superadmin --creer --email a@b.tn --nom "Nom" --password XXXX
# ============================================================================
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1
ROOT="$(pwd)"
SCRIPT_PATH="$ROOT/$(basename "$0")"

# --------------------------------------------------------------------------
# 1) Chargement COMPLET du .env : chaque cle KEY=valeur est exportee.
#    Le .env est LA source de verite (les valeurs y gagnent toujours).
#    Guillemets simples/doubles et espaces de bord sont retires.
# --------------------------------------------------------------------------
charger_env() {
    if [ -f "$ROOT/.env" ]; then
        while IFS= read -r ligne || [ -n "$ligne" ]; do
            case "$ligne" in
                ''|\#*|\;*) continue ;;
            esac
            cle="${ligne%%=*}"
            val="${ligne#*=}"
            [ "$cle" = "$ligne" ] && continue
            cle="$(printf '%s' "$cle" | tr -d ' \t' | tr -d '"' | tr -d "'")"
            val="$(printf '%s' "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
            case "$cle" in ''|*[!A-Za-z0-9_]*) continue ;; esac
            export "$cle=$val"
        done < "$ROOT/.env"
    fi
}
charger_env

# ----------------------------------------------------------------------------
# 1bis) Cohérence du .env sur installation neuve : PORT, PORTAL_PORT et
# DATABASE_URL y sont ECRITS s'ils manquent (idempotent, comme les lanceurs
# DEMARRER-*) — ainsi le moteur silencieux, le vérificateur de ports et les
# lanceurs partagent EXACTEMENT les mêmes valeurs.
# ----------------------------------------------------------------------------
if [ -f "$ROOT/.env" ]; then
    grep -q '^PORT=' "$ROOT/.env" 2>/dev/null \
        || printf 'PORT=%s\n' "${PAIESAGE_PORT_ADMIN:-${PORT:-4000}}" >> "$ROOT/.env"
    grep -q '^PORTAL_PORT=' "$ROOT/.env" 2>/dev/null \
        || printf 'PORTAL_PORT=%s\n' "${PAIESAGE_PORT_PORTAIL:-${PORTAL_PORT:-4001}}" >> "$ROOT/.env"
    grep -q '^DATABASE_URL=' "$ROOT/.env" 2>/dev/null \
        || printf 'DATABASE_URL=file:%s/db/custom.db\n' "$ROOT" >> "$ROOT/.env"
fi

# --------------------------------------------------------------------------
# 2) Ports : PRIORITE IDENTIQUE au moteur scripts/service-paiesage.js
#    PAIESAGE_PORT_ADMIN > PORT (.env) > 4000   /   PAIESAGE_PORT_PORTAIL > PORTAL_PORT > 4001
# --------------------------------------------------------------------------
PORT_ADMIN="${PAIESAGE_PORT_ADMIN:-${PORT:-4000}}"
PORT_PORTAIL="${PAIESAGE_PORT_PORTAIL:-${PORTAL_PORT:-4001}}"
export PORT="$PORT_ADMIN" PORTAL_PORT="$PORT_PORTAIL"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export DATABASE_URL="${DATABASE_URL:-file:$ROOT/db/custom.db}"
export SERVICE_RH_ROOT="${SERVICE_RH_ROOT:-$ROOT}"

NODE_BIN="$(command -v node 2>/dev/null || true)"

erreur()   { printf '\033[31m[ERREUR] %s\033[0m\n' "$1" >&2; }
ok()       { printf '\033[32m[OK] %s\033[0m\n' "$1"; }
info()     { printf '[INFO] %s\n' "$1"; }

exiger_node() {
    if [ -z "$NODE_BIN" ]; then
        erreur "Node.js est introuvable. Installez Node.js 20+ (https://nodejs.org) puis relancez."
        exit 1
    fi
}

exiger_build() {   # l'administration demande un build .next (premier lancement)
    if [ "$1" = "admin" ] || [ "$1" = "tout" ]; then
        if [ ! -f "$ROOT/node_modules/next/dist/bin/next" ]; then
            info "node_modules absent : lancement de l'installation (3 a 5 minutes)..."
            "$0" installer || exit 1
        fi
    fi
}

# --------------------------------------------------------------------------
# 3) Verification de disponibilite des ports AVANT tout lancement.
#    Code retour du verificateur : 0 = libre ; 1 = conflit externe (STOP) ;
#    2 = deja en cours par CETTE application.
# --------------------------------------------------------------------------
verifier_ports_avant() {
    exiger_node
    local sortie rc
    sortie=$("$NODE_BIN" scripts/verifier-ports.js verifier 2>&1)
    rc=$?
    echo "$sortie" | sed 's/^/  /'
    if [ "$rc" -eq 1 ]; then
        erreur "Conflit de port : liberation refusee, lancement annule. Corrigez le port dans le .env puis relancez."
        exit 1
    fi
    return $rc
}

# Super administrateur : creation AUTOMATIQUE au premier demarrage (base vierge).
# IDEMPOTENT (rien si un compte actif existe deja) ; SUPERADMIN_AUTO=0 desactive.
superadmin_auto() {
    if [ "$SUPERADMIN_AUTO" = "0" ]; then
        info "SUPERADMIN_AUTO=0 : creation automatique du superadministrateur desactivee."
        return 0
    fi
    # --assurer est auto-suffisant : il cree la base (db push) si elle est absente.
    "$NODE_BIN" scripts/creer-superadmin.js --assurer || erreur "Etape superadministrateur non terminee (le demarrage continue)."
}

# Arret d'UN service precise : PID enregistre (logs/paiesage-processus.json).
# Seuls les PIDs ENREGISTRES par ce projet sont tues — jamais un autre programme.
arreter_un() {
    local cle="$1" port="$2"
    local pid="$("$NODE_BIN" -e '
const fs=require("fs");
try{const j=JSON.parse(fs.readFileSync("logs/paiesage-processus.json","utf8"));
console.log(String(j["'"$cle"'"]||0));}catch{console.log("0");}')"
    if [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && ok "$cle arrete (PID $pid, port $port)."
    else
        info "$cle : aucun PID enregistre vivant (port $port)."
    fi
}

# --------------------------------------------------------------------------
# 4) Commandes
# --------------------------------------------------------------------------
CMD="${1:-aide}"; CIBLE="${2:-tout}"

case "$CMD" in

  demarrer)   # ---- Premier plan : les serveurs vivent dans CE terminal ----
    exiger_node; exiger_build "$CIBLE"
    verifier_ports_avant
    case $? in
      2) erreur "Deja en cours (PIDs enregistres). Utilisez : bash gestion.sh etat  |  redemarrer  |  arreter." ; exit 3 ;;
    esac
    superadmin_auto
    echo ""
    echo "Demarrage NORMAL (${CIBLE}) - Ctrl+C arrete les serveurs."
    echo "  Administration : http://localhost:$PORT_ADMIN   |   Portail : http://localhost:$PORT_PORTAIL"
    echo ""
    trap 'kill 0' INT TERM
    case "$CIBLE" in
      admin)   exec "$NODE_BIN" scripts/start-prod.js ;;
      portail) exec "$NODE_BIN" scripts/portail-server.js ;;
      tout)
        "$NODE_BIN" scripts/start-prod.js      & ADMIN_PID=$!
        "$NODE_BIN" scripts/portail-server.js  & PORTAIL_PID=$!
        "$NODE_BIN" scripts/service-paiesage.js record "$ADMIN_PID" "$PORTAIL_PID" >/dev/null 2>&1 || true
        wait
        ;;
      *) erreur "Cible inconnue : $CIBLE (tout|admin|portail)."; exit 1 ;;
    esac
    ;;

  demarrer-silencieux)   # ---- Arriere-plan detache (nohup/detached, journaux logs/) ----
    exiger_node; exiger_build "$CIBLE"
    verifier_ports_avant   # code 1 : sortie avec erreur deja affichee ; code 2 : le moteur reprend nos instances
    superadmin_auto
    case "$CIBLE" in
      tout)
        echo "Demarrage silencieux des DEUX interfaces (ports $PORT_ADMIN et $PORT_PORTAIL)..."
        "$NODE_BIN" scripts/service-paiesage.js start
        ;;
      admin)
        mkdir -p logs
        info "Administration en arriere-plan (port $PORT_ADMIN), journal logs/paiesage-administration.log"
        nohup "$NODE_BIN" scripts/start-prod.js >> logs/paiesage-administration.log 2>&1 &
        "$NODE_BIN" scripts/service-paiesage.js record "$!" 0 >/dev/null 2>&1 || true
        ok "Administration lancee (PID $!)."
        ;;
      portail)
        mkdir -p logs
        info "Portail en arriere-plan (port $PORT_PORTAIL), journal logs/paiesage-portail.log"
        nohup "$NODE_BIN" scripts/portail-server.js >> logs/paiesage-portail.log 2>&1 &
        "$NODE_BIN" scripts/service-paiesage.js record 0 "$!" >/dev/null 2>&1 || true
        ok "Portail lance (PID $!)."
        ;;
      *) erreur "Cible inconnue : $CIBLE (tout|admin|portail)."; exit 1 ;;
    esac
    ;;

  arreter)   # ---- Arret precis : uniquement les PIDs de CE projet ----
    exiger_node
    case "$CIBLE" in
      tout)    "$NODE_BIN" scripts/service-paiesage.js stop ;;
      admin)   arreter_un "admin" "$PORT_ADMIN" ;;
      portail) arreter_un "portail" "$PORT_PORTAIL" ;;
      *) erreur "Cible inconnue : $CIBLE (tout|admin|portail)."; exit 1 ;;
    esac
    ;;

  redemarrer)   # ---- Arret puis redemarrage silencieux ----
    "$SCRIPT_PATH" arreter "$CIBLE" || true
    sleep 1
    exec "$SCRIPT_PATH" demarrer-silencieux "$CIBLE"
    ;;

  etat)   # ---- Ports, PIDs et reponse HTTP ----
    exiger_node
    echo "Ports du .env : administration=$PORT_ADMIN, portail=$PORT_PORTAIL"
    "$NODE_BIN" scripts/service-paiesage.js status
    ;;

  journaux)   # ---- Dernieres lignes des journaux ----
    N="${3:-50}"
    case "$CIBLE" in
      admin)      F="logs/paiesage-administration.log" ;;
      portail)    F="logs/paiesage-portail.log" ;;
      silencieux) F="logs/paiesage-silencieux.log" ;;
      demarrage)  F="logs/demarrage-etat.txt" ;;
      arret)      F="logs/arret-etat.txt" ;;
      *) erreur "Journal inconnu : $CIBLE (admin|portail|silencieux|demarrage|arret)."; exit 1 ;;
    esac
    if [ -f "$F" ]; then echo "--- $F (dernieres $N lignes) ---"; tail -n "$N" "$F"; else info "Journal absent : $F."; fi
    ;;

  ports)   # ---- Ports du .env + disponibilite (verifier|etat|liste) ----
    exiger_node
    exec "$NODE_BIN" scripts/verifier-ports.js "${2:-verifier}"
    ;;

  superadmin)   # ---- Par defaut : creation automatique idempotente ----
    exiger_node
    shift 1 2>/dev/null || true
    if [ $# -eq 0 ]; then
        "$NODE_BIN" scripts/creer-superadmin.js --assurer
    else
        "$NODE_BIN" scripts/creer-superadmin.js "$@"
    fi
    ;;

  installer)   # ---- Dependances + client Prisma + base ----
    exiger_node
    info "npm install (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || { erreur "Echec de npm install."; exit 1; }
    [ -f "node_modules/.prisma/client/index.js" ] || "$NODE_BIN" node_modules/prisma/build/index.js generate || { erreur "Echec de prisma generate."; exit 1; }
    [ -f "db/custom.db" ] || { "$NODE_BIN" node_modules/prisma/build/index.js db push || { erreur "Echec de la creation de la base."; exit 1; }; }
    "$NODE_BIN" scripts/securiser-auto.js >/dev/null 2>&1 || true
    ok "Installation terminee. Demarrage : bash gestion.sh demarrer-silencieux"
    ;;

  aide|--help|-h)
    sed -n '3,30p' "$0" | sed 's/^# \{0,2\}//'
    ;;

  *)
    erreur "Commande inconnue : $CMD"
    echo "Tapez : bash gestion.sh aide"
    exit 1
    ;;
esac
