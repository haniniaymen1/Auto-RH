#!/usr/bin/env bash
# ============================================================
#   Fiches de Paie - INSTALLATION COMPLETE + DEMARRAGE + COMPTE
#   ADMINISTRATEUR - LINUX / macOS
#
#   UN SEUL script qui fait tout, dans l'ordre :
#     1) verifie Node.js ;
#     2) prepare le fichier .env (base de donnees, secret de session,
#        dossiers, PORT / PORTAL_PORT des deux interfaces) ;
#     3) securise les dossiers sensibles ;
#     4) installe les dependances (1ere fois : 3 a 5 minutes) ;
#     5) cree la base de donnees SQLite ;
#     6) construit le site si necessaire (2 a 4 minutes) ;
#     7) cree le compte ADMINISTRATEUR (superadministrateur) ;
#     8) demarre les DEUX interfaces :
#          - Administration RH/IT : PORT du .env    (defaut 4000)
#          - Portail Employes     : PORTAL_PORT du .env (defaut 4001)
#
#   Utilisation :
#     bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh
#   (ou : chmod +x INSTALLER-ET-DEMARRER-LINUX-MAC.sh puis ./INSTALLER-ET-DEMARRER-LINUX-MAC.sh)
#
#   Creation NON interactive du compte administrateur (facultatif) :
#     SUPERADMIN_EMAIL="admin@entreprise.tn" SUPERADMIN_PASSWORD="MotDePasse!2026" \
#       bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh
#     (SUPERADMIN_NOM="Nom complet" facultatif ; INSTALLER_SANS_ADMIN=1 pour passer)
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
echo "  Fiches de Paie - Installation complete et demarrage"
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
echo "[1/7] Node.js detecte : $NODE_VERSION"

# ---------- 2) Preparer le fichier .env ----------
# - DATABASE_URL : chemin ABSOLU de la base SQLite (exige par Prisma) ;
# - AUTH_SECRET : cree une seule fois, conserve ensuite ;
# - PORT / PORTAL_PORT : ports des DEUX interfaces (v0.2.198) — lignes
#   ajoutees si absentes, VALEURS EXISTANTES JAMAIS modifiees ;
# - PAIESAGE_STORAGE_DIR : dossier des PDF (chemin absolu).
PROJECT_DIR="$(pwd)"
touch .env
grep -v '^DATABASE_URL=' .env > .env.tmp 2>/dev/null || true
printf 'DATABASE_URL=file:%s/db/custom.db\n' "$PROJECT_DIR" >> .env.tmp
if ! grep -q '^AUTH_SECRET=' .env.tmp; then
    # Garde de sécurité des données : si une base EXISTE déjà, elle a pu être
    # chiffrée avec la clé PAR DÉFAUT (aucun secret dans le .env) — générer un
    # nouveau secret rendrait alors les données existantes illisibles. On ne
    # génère le secret que pour une PREMIÈRE installation (base absente).
    if [ -f "${PROJECT_DIR}/db/custom.db" ]; then
        echo "  .env : AUTH_SECRET non genere (base existante, cle de chiffrement actuelle conservee)."
        echo "          Pour ajouter un secret plus tard : scripts/chiffrer-base.js"
    else
        printf 'AUTH_SECRET=%s\n' "$(node scripts/gen-secret.js)" >> .env.tmp
    fi
fi
if ! grep -q '^PORT=' .env.tmp; then
    printf 'PORT=4000\n' >> .env.tmp
    echo "  .env : ligne PORT=4000 ajoutee (administration RH/IT)."
fi
if ! grep -q '^PORTAL_PORT=' .env.tmp; then
    printf 'PORTAL_PORT=4001\n' >> .env.tmp
    echo "  .env : ligne PORTAL_PORT=4001 ajoutee (portail employes)."
fi
mv .env.tmp .env
export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"
export PAIESAGE_STORAGE_DIR="${PROJECT_DIR}/storage/payslips"
export AUTH_SECRET="$(grep -E '^AUTH_SECRET=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'")"
mkdir -p "${PROJECT_DIR}/db" "${PROJECT_DIR}/storage/payslips"

# Ports reellement utilises : lignes du .env (defauts 4000 / 4001, v0.2.209).
# Changez ces DEUX lignes dans le .env pour installer le site sur d'autres ports
# (valeurs DIFFERENTES obligatoires), puis relancez ce script.
PORT="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\"'" | tr -d '[:space:]')"
PORT="${PORT:-4000}"
PORTAL_PORT="$(grep -E '^[[:space:]]*PORTAL_PORT[[:space:]]*=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\"'" | tr -d '[:space:]')"
PORTAL_PORT="${PORTAL_PORT:-4001}"
export PORT PORTAL_PORT
echo "[2/7] Fichier .env pret (administration : port ${PORT} — portail : port ${PORTAL_PORT})"

# ---------- 3) Securiser les dossiers sensibles ----------
# Task 40 : .env (600), base (700), storage, logs, backups — silencieux,
# reversible, ne bloque jamais.
node scripts/securiser-auto.js >/dev/null 2>&1 || true
echo "[3/7] Dossiers sensibles securises (.env, db, storage, logs)"

# ---------- 4) Installer les dependances ----------
# MODIFIE Task 89 : verification du CLI Prisma ET Next LOCAUX puis appel du
# CLI LOCAL via node — plus aucun npx, aucun prompt, aucun blocage.
if [ ! -d "node_modules" ] || [ ! -f "node_modules/prisma/build/index.js" ] || [ ! -f "node_modules/next/dist/bin/next" ] || [ ! -f "node_modules/nodemailer/package.json" ]; then  # (MODIFIE Task 92 : nodemailer pour le service Send Mail)
    echo "[4/7] Installation des dependances (3 a 5 minutes, une seule fois)..."
    npm install --no-audit --no-fund || fail "L'installation npm a echoue. Verifiez votre connexion Internet puis relancez."
else
    echo "[4/7] Dependances deja installees."
fi
if [ ! -f "node_modules/prisma/build/index.js" ]; then
    fail "Le CLI Prisma local est introuvable apres installation. Verifiez votre connexion Internet puis relancez."
fi
if [ ! -d "node_modules/@prisma/client" ]; then
    node node_modules/prisma/build/index.js generate || fail "La generation du client Prisma a echoue."
fi

# ---------- 5) Creer / mettre a jour la base de donnees SQLite ----------
echo "[5/7] Verification de la base de donnees..."
node node_modules/prisma/build/index.js db push || fail "La creation de la base de donnees a echoue."

# ---------- 6) Build de production (1ere fois OU NOUVELLE VERSION) ----------
if ! command -v node >/dev/null 2>&1 || ! node scripts/verifier-build-a-jour.js; then
    echo "[6/7] Construction du site necessaire (premiere fois ou NOUVELLE VERSION extraite) : 2 a 4 minutes..."
    node node_modules/next/dist/bin/next build || fail "Le build a echoue."
    node scripts/copy-standalone-assets.js || fail "La copie des ressources a echoue."
else
    echo "[6/7] Build de production deja a jour (version du build = version du package)."
fi

# ---------- 7) Creer le compte ADMINISTRATEUR ----------
# Le superadministrateur est le SEUL a pouvoir creer les comptes RH et IT
# depuis l'onglet Utilisateurs ; il ne peut pas etre cree par l'inscription
# publique. Deux modes :
#   - NON interactif : SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD dans
#     l'environnement au lancement du script ;
#   - interactif : questions affichees (mot de passe masque).
# INSTALLER_SANS_ADMIN=1 passe cette etape (compte cree plus tard avec :
# node scripts/creer-superadmin.js).
COMPTE_CREE="non"
COMPTE_EXISTANT="non"
if [ "${INSTALLER_SANS_ADMIN:-0}" = "1" ]; then
    echo "[7/7] Creation de l'administrateur PASSEE (INSTALLER_SANS_ADMIN=1)."
elif [ -n "${SUPERADMIN_EMAIL:-}" ] && [ -n "${SUPERADMIN_PASSWORD:-}" ]; then
    echo "[7/7] Creation du compte administrateur (mode non interactif)..."
    node scripts/creer-superadmin.js --creer \
        --email "${SUPERADMIN_EMAIL}" \
        --nom "${SUPERADMIN_NOM:-Administrateur}" \
        --password "${SUPERADMIN_PASSWORD}" \
        || fail "La creation du compte administrateur a echoue (voir le message au-dessus)."
    COMPTE_CREE="oui"
else
    if [ -t 0 ]; then
        echo ""
        echo "  Compte ADMINISTRATEUR (superadministrateur) — il cree ensuite les"
        echo "  comptes RH et IT depuis l'onglet Utilisateurs du site."
        printf "  Creer le compte maintenant ? [O/n] : "
        read -r REPONSE_ADMIN
        if [ -z "$REPONSE_ADMIN" ] || [ "$REPONSE_ADMIN" = "o" ] || [ "$REPONSE_ADMIN" = "O" ] || [ "$REPONSE_ADMIN" = "oui" ] || [ "$REPONSE_ADMIN" = "Oui" ]; then
            printf "  E-mail de l'administrateur : "
            read -r ADMIN_EMAIL
            printf "  Nom affiche (facultatif) : "
            read -r ADMIN_NOM
            printf "  Mot de passe (saisie masquee) : "
            read -rs ADMIN_MDP
            echo ""
            if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_MDP" ]; then
                echo "  [ATTENTION] E-mail ou mot de passe vide : compte NON cree."
                echo "  Creez-le plus tard avec :  node scripts/creer-superadmin.js"
            else
                node scripts/creer-superadmin.js --creer \
                    --email "$ADMIN_EMAIL" \
                    --nom "${ADMIN_NOM:-Administrateur}" \
                    --password "$ADMIN_MDP" \
                    || fail "La creation du compte administrateur a echoue (voir le message au-dessus)."
                COMPTE_CREE="oui"
            fi
        else
            echo "  Compte NON cree. Pour le creer plus tard :"
            echo "    node scripts/creer-superadmin.js"
        fi
    else
        echo "[7/7] Terminal non interactif : creation du compte PASSEE."
        echo "      Creez le compte avec :  SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... (relance)"
        echo "      ou :  node scripts/creer-superadmin.js"
    fi
fi

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

est_notre_app() { # 0 = node + dossier du projet ; 1 = autre programme ; 2 = indetermine (macOS, pas de /proc)
    local pid="$1"
    [ -n "$pid" ] || return 1
    if [ -r "/proc/$pid/exe" ]; then
        case "$(readlink "/proc/$pid/exe" 2>/dev/null)" in *node*) : ;; *) return 1 ;; esac
        [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$PROJECT_DIR" ] || return 1
        return 0
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

# ---------- (v0.2.212) Migration des ports ----------
# Si le .env a change de port depuis le dernier demarrage, les ANCIENNES
# instances encore en marche sont arretees ici ; sinon elles continuaient
# de servir les anciens liens et le changement de port semblait « ne pas
# fonctionner ». Toujours exit 0 : ne bloque jamais le demarrage.
node scripts/migrer-ports.js || true

# ---------- 8) Demarrer les DEUX interfaces ----------
# Administration RH/IT (login requis) et Portail Employes (sans connexion),
# en arriere-plan (nohup) : le terminal peut etre ferme.
# (0.2.206) Diagnostic precis des ports AVANT lancement : ne relance pas
# une interface qui repond deja, repare (arret precis puis relance) une
# instance a nous muette ou en erreur, et signale un port occupe par un
# AUTRE programme sans rien tuer (PID + commande + remediation).
echo ""
echo "Verification des ports avant demarrage..."
decider_port "$PORT" "Administration RH/IT" ;     ACT_ADMIN="$DECISION"
decider_port "$PORTAL_PORT" "Portail employes" ;  ACT_PORTAIL="$DECISION"
arret_precis_si_repare
ADMIN_PID=""; PORTAIL_PID=""
if [ "$ACT_ADMIN" = "LANCE" ] || [ "$ACT_ADMIN" = "REPARE" ]; then
    echo "Demarrage de l'administration RH/IT (port ${PORT})..."
    nohup node scripts/start-prod.js      > paiesage-admin.log   2>&1 &
    ADMIN_PID=$!
    sleep 2
else
    echo "Administration RH/IT : non relancee (${ACT_ADMIN})."
fi
if [ "$ACT_PORTAIL" = "LANCE" ] || [ "$ACT_PORTAIL" = "REPARE" ]; then
    echo "Demarrage du portail employes (port ${PORTAL_PORT})..."
    nohup node scripts/portail-server.js  > paiesage-portail.log 2>&1 &
    PORTAL_PID=$!
    sleep 3
else
    echo "Portail employes : non relance (${ACT_PORTAIL})."
fi

# ---------- Adresse IP du poste (acces depuis le reseau local) ----------
LAN_IP=""
if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    LAN_IP="$(hostname -I | awk '{print $1}')"
elif command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi

echo ""
echo "============================================================"
echo "  Installation terminee — etat des interfaces :"
echo "    Administration RH/IT : http://localhost:${PORT}  (login) [${ACT_ADMIN}] PID ${ADMIN_PID:-deja en cours}"
echo "    Portail Employes     : http://localhost:${PORTAL_PORT}  (sans login) [${ACT_PORTAIL}] PID ${PORTAL_PID:-deja en cours}"
if [ -n "$LAN_IP" ]; then
    echo "  Acces reseau local   : http://${LAN_IP}:${PORT} et http://${LAN_IP}:${PORTAL_PORT}"
fi
if [ "$COMPTE_CREE" = "oui" ]; then
    echo "  Compte administrateur : CREE — connectez-vous avec l'e-mail saisi."
else
    echo "  Compte administrateur : non cree par ce lancement."
    echo "    node scripts/creer-superadmin.js   (ou relancez ce script)"
fi
echo ""
echo "  Premiere connexion au site : construction a la volee, comptez"
echo "  quelques dizaines de secondes sur la premiere page."
echo "  Journaux : paiesage-admin.log et paiesage-portail.log"
echo "  Arreter  :  bash ARRETER-LINUX-MAC.sh   (arret precis)"
echo "              (ou : node scripts/service-paiesage.js stop)"
echo "============================================================"
echo ""

# Ouvrir le navigateur sur les deux interfaces (si un navigateur existe).
(command -v xdg-open >/dev/null 2>&1 && nohup xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 &) || true
(command -v open >/dev/null 2>&1 && nohup open "http://localhost:${PORT}" >/dev/null 2>&1 &) || true

echo "Ce terminal peut etre ferme ; les serveurs continuent (nohup)."
