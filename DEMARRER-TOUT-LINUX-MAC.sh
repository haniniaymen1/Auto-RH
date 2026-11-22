#!/usr/bin/env bash
# ============================================================
#   Fiches de Paie - Demarrage des DEUX interfaces - LINUX / macOS
#
#   1) Administration RH/IT (login requis) .... PORT du .env (defaut 4000)
#   2) Portail Employes (sans connexion) ...... PORTAL_PORT du .env (defaut 4001)
#
#   Utilisation :
#     bash DEMARRER-TOUT-LINUX-MAC.sh
# ============================================================
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

# ---------- 0) Ports : lus depuis le .env ----------
# PORT = administration RH/IT (defaut 4000) ; PORTAL_PORT = portail (defaut 4001)
# Lecture tolérante : espaces autour du signe « = », guillemets, apostrophes.
PORT="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\"'" | tr -d '[:space:]')"
PORT="${PORT:-4000}"
PORTAL_PORT="$(grep -E '^[[:space:]]*PORTAL_PORT[[:space:]]*=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\"'" | tr -d '[:space:]')"
PORTAL_PORT="${PORTAL_PORT:-4001}"

echo ""
echo "============================================================"
echo "  Fiches de Paie - Demarrage des deux interfaces"
echo "    Administration RH/IT : http://localhost:${PORT} (login)"
echo "    Portail Employes     : http://localhost:${PORTAL_PORT} (sans login)"
echo "  Dossier : $(pwd)"
echo "============================================================"
echo ""

# ---------- 1) Verifier que Node.js est installe ----------
if ! command -v node >/dev/null 2>&1; then
    echo "[ERREUR] Node.js n'est pas installe. Installez Node.js 20+ (https://nodejs.org) puis relancez."
    exit 1
fi

# ---------- 1bis) Preparer le .env avec le chemin absolu de la base ----------
# (CORRECTIF 0.2.202) Sur une machine NEUVE, ce lanceur creait la base SANS
# avoir prepare le fichier .env : Prisma echouait avec « Environment
# variable not found: DATABASE_URL ». Desormais le .env (DATABASE_URL
# absolu) est prepare ICI, AVANT les commandes Prisma - comme dans
# INSTALLER-ET-DEMARRER-LINUX-MAC.sh.
# (v0.2.212) AUTH_SECRET est cree ICI s'il manque : plus de lanceurs
# individuels pour le faire.
PROJECT_DIR="$(pwd)"
touch .env
grep -v '^DATABASE_URL=' .env > .env.tmp 2>/dev/null || true
printf 'DATABASE_URL=file:%s/db/custom.db\n' "$PROJECT_DIR" >> .env.tmp
mv .env.tmp .env
export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"

# ---------- (0.2.206) DEBUT BLOC PORTS .ENV ----------
# (CORRECTIF 0.2.206) Ports ECRITS dans le .env s'ils sont absents : ainsi le
# moteur (scripts/service-paiesage.js) et les lanceurs partagent EXACTEMENT
# les memes ports. Sans ces lignes, le moteur partait sur ses defauts
# (4000/4001) tandis qu'un lanceur pouvait demarrer ailleurs : l'etat disait
# « ARRETE (port 4000 sans reponse) » pendant que le site repondait ailleurs.
# Ecriture IDEMPOTENTE : rien n'est ajoute si la ligne existe deja, JAMAIS de
# valeur utilisateur ecrasee.
if ! grep -q '^PORT=' .env 2>/dev/null; then
    printf 'PORT=%s\n' "${PORT:-4000}" >> .env
    echo "  .env : ligne PORT=${PORT:-4000} ajoutee (administration RH/IT)."
fi
if ! grep -q '^PORTAL_PORT=' .env 2>/dev/null; then
    printf 'PORTAL_PORT=%s\n' "${PORTAL_PORT:-4001}" >> .env
    echo "  .env : ligne PORTAL_PORT=${PORTAL_PORT:-4001} ajoutee (portail employes)."
fi
# ---------- (0.2.206) FIN BLOC PORTS .ENV ----------

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
# (CORRECTIF 0.2.202) Client GENERE (.prisma/client) teste : si npm a
# saute les scripts d'installation (npm >= 11), le paquet @prisma/client
# existe mais le client n'a PAS ete genere - d'ou un plantage au demarrage.
if [ ! -f "node_modules/.prisma/client/index.js" ]; then
    node node_modules/prisma/build/index.js generate || { echo "[ERREUR] Echec de prisma generate."; exit 1; }
fi
if [ ! -f "db/custom.db" ]; then
    node node_modules/prisma/build/index.js db push || { echo "[ERREUR] Echec de la creation de la base."; exit 1; }
fi
echo "[OK] Installation commune terminee."

# ---------- (v0.2.212) AUTH_SECRET : cree ici s'il manque ----------
# Les deux serveurs partagent la meme cle de signature des sessions.
if ! grep -q '^AUTH_SECRET=' .env 2>/dev/null; then
    node scripts/gen-secret.js > .secret.tmp 2>/dev/null && \
        { printf 'AUTH_SECRET=%s\n' "$(cat .secret.tmp)" >> .env ; rm -f .secret.tmp ; }
fi

# Task 40 : securisation AUTOMATIQUE des dossiers sensibles (.env, db,
# storage, logs, backups) - silencieuse, reversible, ne bloque jamais.
node scripts/securiser-auto.js >/dev/null 2>&1 || true
# ---------- (v0.2.209) Superadministrateur : creation automatique ----------
# Base vierge au premier demarrage : compte SUPERADMIN cree automatiquement.
# IDEMPOTENT : rien n'est cree si un compte actif existe deja (anti-doublon).
# SUPERADMIN_AUTO=0 dans le .env desactive ; SUPERADMIN_EMAIL /
# SUPERADMIN_PASSWORD configurent l'identite ; sinon mot de passe aleatoire
# genere et consigne dans logs/compte-superadmin-initial.txt.
SUPERADMIN_AUTO="$(grep -E '^SUPERADMIN_AUTO=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
if [ "${SUPERADMIN_AUTO:-1}" != "0" ] && [ -f "db/custom.db" ]; then
    node scripts/creer-superadmin.js --assurer || echo "[ATTENTION] Superadministrateur : etape non terminee (demarrage continue)."
fi

# ---------- (v0.2.212) Migration des ports ----------
# Si le .env a change de port depuis le dernier demarrage, les ANCIENNES
# instances encore en marche sont arretees ici ; sinon elles continuaient
# de servir les anciens liens et le changement de port semblait « ne pas
# fonctionner ». Toujours exit 0 : ne bloque jamais le demarrage.
node scripts/migrer-ports.js || true


# ---------- (0.2.206) DEBUT BLOC DIAGNOSTIC PORTS ----------
# (CORRECTIF 0.2.206) L'ancien controle declarait l'interface « deja en
# cours » des qu'UN PROGRAMME - n'importe lequel - repondait en HTTP sur le
# port : une instance CASSEE (page d'erreur 5xx), un serveur lance depuis un
# AUTRE dossier extrait (v0.2.203, v0.2.202...) ou tout autre logiciel
# bloquaient le relancement et l'utilisateur voyait « NON relancee » alors
# que rien ne fonctionnait dans le navigateur. Desormais :
#   1) le processus qui ECOUTE le port est identifie (ss, sinon lsof) ;
#   2) il est considere comme CETTE application seulement si c'est node avec
#      LE DOSSIER DU PROJET comme repertoire courant (/proc/<pid>/exe et cwd) ;
#   3) instance a nous mais MUETTE ou en ERREUR HTTP (5xx) : ARRET PRECIS
#      (moteur scripts/service-paiesage.js stop - PIDs et ports du .env,
#      jamais global) puis RELANCE ;
#   4) port occupe par AUTRE CHOSE : RIEN n'est tue - message avec PID +
#      commande + remediation (liberer le port OU changer le port du .env).

port_repond() {   # 0 = HTTP<500 (utilisable) ; 2 = HTTP>=500 (erreur) ; 1 = muet/ferme
    node -e 'const h=require("http");const q=h.get({host:"127.0.0.1",port:Number(process.argv[1]),path:"/",timeout:4000},(r)=>{r.resume();process.exit(r.statusCode<500?0:2)});q.on("error",()=>process.exit(1));q.on("timeout",()=>{q.destroy();process.exit(1)})' "$1" >/dev/null 2>&1
}

pid_ecoute() {    # PID du processus a l'ecoute du port (ss, sinon lsof), ou vide
    local port="$1" pid=""
    if command -v ss >/dev/null 2>&1; then
        pid="$(ss -ltnp 2>/dev/null | grep -E "[:.]${port}[[:space:]]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
    fi
    if [ -z "$pid" ] && command -v lsof >/dev/null 2>&1; then
        pid="$(lsof -nP -sTCP:LISTEN -iTCP:"$port" 2>/dev/null | awk 'NR>1{print $2; exit}')"
    fi
    printf '%s' "$pid"
}

cmd_processus() { # commande lisible du processus (tronquee a 90 caracteres)
    local pid="$1" cmd=""
    if [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ]; then
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
    elif [ -n "$pid" ] && command -v ps >/dev/null 2>&1; then
        cmd="$(ps -p "$pid" -o command= 2>/dev/null)"
    fi
    printf '%s' "${cmd:-?}" | cut -c1-90
}

est_notre_app() { # 0 = processus de CETTE application ; 1 = autre programme ; 2 = indetermine (macOS, pas de /proc)
    local pid="$1" cmd=""
    [ -n "$pid" ] || return 1
    # 1) PID ENREGISTRE par ce projet (moteur silencieux / lanceurs) ? — decisive.
    if [ -r "logs/paiesage-processus.json" ] && grep -q "\"${pid}\"" logs/paiesage-processus.json 2>/dev/null; then
        return 0
    fi
    # 2) Ligne de commande (v0.2.209) : nos serveurs tournent sous
    #    scripts/start-prod.js (administration, enfant « next-server » /
    #    standalone/server.js) ou scripts/portail-server.js (portail).
    #    Un AUTRE node lance dans le dossier (test, dev...) ne correspond a
    #    AUCUN de ces motifs : il est traite comme un programme etranger
    #    (BLOQUE) et jamais tue. L'ancien test « exe=node + cwd=projet »
    #    confondait un tel node etranger avec cette application.
    if [ -r "/proc/$pid/cmdline" ]; then
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
        case "$cmd" in
            *start-prod.js*|*standalone/server.js*|*portail-server.js*|*next-server*) return 0 ;;
            *) return 1 ;;
        esac
    fi
    return 2
}

decider_port() {  # $1 = port, $2 = libelle ; fixe DECISION : GARDE|LANCE|REPARE|BLOQUE
    local port="$1" nom="$2" etat=0 pid="" cmd="" qui=0
    DECISION="LANCE"
    port_repond "$port" || etat=$?
    pid="$(pid_ecoute "$port")"
    if [ "$etat" -eq 0 ]; then
        est_notre_app "$pid" ; qui=$?
        if [ "$qui" -ne 0 ] && [ "$qui" -ne 2 ]; then
            cmd="$(cmd_processus "$pid")"
            echo "[ERREUR] Le port ${port} (${nom}) est occupe par un AUTRE programme (PID ${pid} : ${cmd})."
            echo "         Ce n'est pas cette application : RIEN n'a ete tue."
            echo "         Remediation : kill ${pid}   OU   changer ce port dans le fichier .env puis relancer."
            DECISION="BLOQUE"
        else
            echo "${nom} deja en cours (port ${port}) : NON relancee."
            DECISION="GARDE"
        fi
        return 0
    fi
    if [ "$etat" -eq 2 ]; then
        echo "[ATTENTION] ${nom} (port ${port}) repond avec une ERREUR HTTP (5xx)."
    fi
    if [ -n "$pid" ]; then
        est_notre_app "$pid" ; qui=$?
        if [ "$qui" -eq 1 ]; then
            cmd="$(cmd_processus "$pid")"
            echo "[ERREUR] Le port ${port} (${nom}) est occupe par un AUTRE programme (PID ${pid} : ${cmd})."
            echo "         Ce n'est pas cette application : RIEN n'a ete tue."
            echo "         Remediation : kill ${pid}   OU   changer ce port dans le fichier .env puis relancer."
            DECISION="BLOQUE"
            return 0
        fi
        echo "            Instance de CETTE application detectee (PID ${pid}) : arret precis puis relance."
        DECISION="REPARE"
    fi
}

arret_precis_si_repare() { # arrete les instances REPAREES via le moteur, repli kill precise
    if [ "${ACT_ADMIN:-LANCE}" = "REPARE" ] || [ "${ACT_PORTAIL:-LANCE}" = "REPARE" ]; then
        echo "[Arret precis] Moteur scripts/service-paiesage.js stop (PIDs et ports du .env, jamais global)..."
        node scripts/service-paiesage.js stop >/dev/null 2>&1 || true
        local essai=0 p=0 libre=1
        for essai in $(seq 1 40); do
            libre=1
            if [ "${ACT_ADMIN:-LANCE}" = "REPARE" ]; then
                p="$(pid_ecoute "$PORT")" ; [ -n "$p" ] && libre=0
            fi
            if [ "${ACT_PORTAIL:-LANCE}" = "REPARE" ]; then
                p="$(pid_ecoute "$PORTAL_PORT")" ; [ -n "$p" ] && libre=0
            fi
            [ "$libre" -eq 1 ] && break
            sleep 0.5
        done
        if [ "${ACT_ADMIN:-LANCE}" = "REPARE" ]; then
            p="$(pid_ecoute "$PORT")" ; [ -n "$p" ] && est_notre_app "$p" && kill "$p" 2>/dev/null
        fi
        if [ "${ACT_PORTAIL:-LANCE}" = "REPARE" ]; then
            p="$(pid_ecoute "$PORTAL_PORT")" ; [ -n "$p" ] && est_notre_app "$p" && kill "$p" 2>/dev/null
        fi
        sleep 1
    fi
}
# ---------- (0.2.206) FIN BLOC DIAGNOSTIC PORTS ----------

# ---------- 3) Lancer les deux serveurs en arriere-plan ----------
# (0.2.203) ANTI-DOUBLE-INSTANCE : une interface qui repond deja n'est PAS
# relancee ; les PIDs demarres sont ENREGISTRES dans
# logs/paiesage-processus.json (meme fichier que le moteur
# scripts/service-paiesage.js) pour un ARRET PRECIS par
# ARRETER-LINUX-MAC.sh / gestion.sh.
# (0.2.206) le controle devient un DIAGNOSTIC PRECIS (voir le bloc ci-dessus) :
# GARDE si l'interface repond vraiment, RELANCE si le port est libre,
# REPARE (arret precis puis relance) si l'instance a nous est muette ou en
# erreur, BLOQUE avec remediation si le port appartient a un autre programme.

decider_port "$PORT" "Administration RH/IT" ;        ACT_ADMIN="$DECISION"
decider_port "$PORTAL_PORT" "Portail employes" ;     ACT_PORTAIL="$DECISION"
arret_precis_si_repare

ADMIN_PID=""; PORTAIL_PID=""
if [ "$ACT_ADMIN" = "LANCE" ] || [ "$ACT_ADMIN" = "REPARE" ] || [ "$ACT_PORTAIL" = "LANCE" ] || [ "$ACT_PORTAIL" = "REPARE" ]; then
    # (v0.2.212) Build de production AVANT le lancement, fait UNE fois ici :
    # avant, chaque lanceur individuel construisait de son cote.
    if node scripts/verifier-build-a-jour.js; then
        echo "[OK] Build de production deja a jour."
    else
        echo "[Build] Construction du site necessaire : 2 a 4 minutes..."
        node node_modules/next/dist/bin/next build || { echo "[ERREUR] Le build a echoue."; exit 1; }
        node scripts/copy-standalone-assets.js || { echo "[ERREUR] La copie des ressources a echoue."; exit 1; }
    fi
fi
if [ "$ACT_ADMIN" = "LANCE" ] || [ "$ACT_ADMIN" = "REPARE" ]; then
    echo "Lancement de l'administration (port ${PORT})..."
    nohup node scripts/start-prod.js > paiesage-admin.log 2>&1 &
    ADMIN_PID=$!
    sleep 3
fi
if [ "$ACT_PORTAIL" = "LANCE" ] || [ "$ACT_PORTAIL" = "REPARE" ]; then
    echo "Lancement du portail employes (port ${PORTAL_PORT})..."
    nohup node scripts/portail-server.js > paiesage-portail.log 2>&1 &
    PORTAIL_PID=$!
fi
# (0.2.203) enregistrement des PIDs demarres (0 = conserve l'existant)
node scripts/service-paiesage.js record "${ADMIN_PID:-0}" "${PORTAIL_PID:-0}" >/dev/null 2>&1 || true

echo ""
echo "============================================================"
echo "  Etat apres lancement :"
echo "    - Administration RH/IT : http://localhost:${PORT}   [${ACT_ADMIN}] (PID ${ADMIN_PID:-deja en cours})"
echo "        premiere fois : construction du site, 2 a 4 minutes"
echo "    - Portail Employes     : http://localhost:${PORTAL_PORT}   [${ACT_PORTAIL}] (PID ${PORTAIL_PID:-deja en cours})"
echo ""
echo "  Journaux : paiesage-admin.log et paiesage-portail.log"
echo "  Arreter  :  bash ARRETER-LINUX-MAC.sh   (arret precis, libere les ports)"
echo "              (ou : node scripts/service-paiesage.js stop)"
if [ "$ACT_ADMIN" = "BLOQUE" ] || [ "$ACT_PORTAIL" = "BLOQUE" ]; then
    echo ""
    echo "  [IMPORTANT] Au moins un port est occupe par un AUTRE programme :"
    echo "  liberez-le (kill <PID>) ou changez PORT / PORTAL_PORT dans le .env"
    echo "  puis relancez ce lanceur (voir le guide, section Problemes courants)."
fi
echo "============================================================"
echo ""
echo "Ce terminal peut etre ferme ; les serveurs continuent (nohup)."
