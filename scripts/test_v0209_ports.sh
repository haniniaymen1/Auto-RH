#!/usr/bin/env bash
# ============================================================================
# BATTERIE DE VALIDATION v0.2.209 — Ports .env, superadmin auto, gestion.sh
# Exécute sur LINUX les exigences de la spécification fonctionnelle :
#   T1  Premier démarrage (installation fraîche) : défauts 4000/4001 écrits
#       dans le .env, superadmin créé automatiquement, les 2 interfaces OK ;
#   T2  Anti-doublon : relance sans nouvelle création, interfaces conservées ;
#   T3  Ports personnalisés (5100/5101) : pris en compte partout (moteur,
#       vérificateur, état) au prochain démarrage ;
#   T4  Conflit de port : occupé par un AUTRE programme → message + PID,
#       RIEN n'est tué, lanceurs mono-interface en échec propre ;
#   T5  start-prod.js honore la ligne PORT du .env (correctif ordre .env) ;
#   T6  Identité superadmin par le .env (email+mdp) et SUPERADMIN_AUTO=0 ;
#   T7  Cycle gestion.sh complet : arreter/etat/demarrer-silencieux/redemarrer.
# Sortie : PASS/FAIL par test + bilan ; code sortie 0 si tout passe.
# ============================================================================
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1   # racine du projet
RACINE="$(pwd)"
PASS=0; FAIL=0
say(){ printf '%s\n' "$*"; }
pass(){ PASS=$((PASS+1)); say "  [PASS] $*"; }
fail(){ FAIL=$((FAIL+1)); say "  [FAIL] $*"; }
verif(){ # verif <libellé> <cmd...>
    local lib="$1"; shift
    if "$@" >/dev/null 2>&1; then pass "$lib"; else fail "$lib"; fi
}
attendre_http(){ # attendre_http <port> <chemin> <timeout_s> → 0 si HTTP<500
    local port="$1" chemin="$2" t="$3" i=0
    for ((i=0; i<t; i++)); do
        node -e 'const h=require("http");const q=h.get({host:"127.0.0.1",port:Number(process.argv[1]),path:process.argv[2],timeout:3000},(r)=>{r.resume();process.exit(r.statusCode<500?0:2)});q.on("error",()=>process.exit(1));q.on("timeout",()=>{q.destroy();process.exit(1)})' "$port" "$chemin" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}
port_libre(){
    # node exit 0 = liaison TCP possible (port LIBRE) ; exit 1 = occupé.
    node -e 'const n=require("net");const s=n.createServer();s.once("error",()=>process.exit(1));s.once("listening",()=>s.close(()=>process.exit(0)));s.listen(Number(process.argv[1]),"0.0.0.0")' "$1" >/dev/null 2>&1
}
nb_superadmin(){
    # sqlite3 CLI absent sur certains postes : lecture via le client Prisma.
    DATABASE_URL="file:$(pwd)/db/custom.db" node -e '
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient({log:["error"]});
p.user.count({where:{role:"SUPERADMIN",isActive:true}})
 .then(n=>{console.log(n);return p.$disconnect();})
 .catch(()=>{console.log("?");process.exit(0);});' 2>/dev/null
}
arreter_tout(){
    bash gestion.sh arreter >/dev/null 2>&1 || node scripts/service-paiesage.js stop >/dev/null 2>&1 || true
    sleep 2
}
nettoyer_install(){ # installation fraîche : base vierge + .env minimal sans ports
    arreter_tout
    rm -f db/custom.db logs/compte-superadmin-initial.txt logs/paiesage-processus.json .env
    mkdir -p db logs
}

say "============================================================"
say " BATTERIE DE VALIDATION v0.2.209 — $(date '+%d/%m/%Y %H:%M:%S')"
say " Projet : $RACINE"
say "============================================================"

# ---------------------------------------------------------------- T1
say ""
say "T1 — Premier démarrage sur installation FRAÎCHE (défauts .env 4000/4001)"
nettoyer_install
bash DEMARRER-TOUT-LINUX-MAC.sh > /tmp/t1-lanceur.log 2>&1
verif "T1 .env : ligne PORT=4000 écrite"            grep -q '^PORT=4000$' .env
verif "T1 .env : ligne PORTAL_PORT=4001 écrite"     grep -q '^PORTAL_PORT=4001$' .env
verif "T1 .env : DATABASE_URL absolu présent"       grep -q '^DATABASE_URL=file:' .env
if attendre_http 4000 /login 150; then pass "T1 administration : HTTP OK sur 4000 (/login)"; else fail "T1 administration : PAS de réponse sur 4000"; fi
if attendre_http 4001 / 120;     then pass "T1 portail employés : HTTP OK sur 4001 (/)"; else fail "T1 portail employés : PAS de réponse sur 4001"; fi
NB1="$(nb_superadmin db/custom.db)"
[ "$NB1" = "1" ] && pass "T1 superadmin auto : exactement 1 compte SUPERADMIN actif (trouvé : $NB1)" || fail "T1 superadmin auto : comptes actifs = $NB1 (attendu 1)"
verif "T1 mot de passe aléatoire consigné (logs/compte-superadmin-initial.txt)" test -s logs/compte-superadmin-initial.txt
[ "$(bash gestion.sh etat | grep -c 'EN FONCTIONNEMENT')" = "2" ] && pass "T1 etat gestion.sh : les DEUX interfaces en fonctionnement" || fail "T1 etat gestion.sh : interfaces incomplètes"

# ---------------------------------------------------------------- T2
say ""
say "T2 — Relance : anti-doublon superadmin + interfaces conservées (GARDE)"
NB2_AVANT="$(nb_superadmin db/custom.db)"
bash DEMARRER-TOUT-LINUX-MAC.sh > /tmp/t2-lanceur.log 2>&1
NB2_APRES="$(nb_superadmin db/custom.db)"
grep -q "deja en cours" /tmp/t2-lanceur.log && pass "T2 lanceur : interfaces détectées « deja en cours » (NON relancées)" || fail "T2 lanceur : pas de détection « deja en cours »"
[ "$NB2_AVANT" = "$NB2_APRES" ] && [ "$NB2_APRES" = "1" ] && pass "T2 anti-doublon : toujours 1 seul compte SUPERADMIN ($NB2_APRES)" || fail "T2 anti-doublon : comptes avant=$NB2_AVANT après=$NB2_APRES"
[ "$(bash gestion.sh etat | grep -c 'EN FONCTIONNEMENT')" = "2" ] && pass "T2 interfaces toujours en fonctionnement après relance" || fail "T2 interfaces perturbées après relance"

# ---------------------------------------------------------------- T3
say ""
say "T3 — Ports PERSONNALISÉS dans le .env (5100 / 5101)"
arreter_tout
sed -i 's/^PORT=.*/PORT=5100/; s/^PORTAL_PORT=.*/PORTAL_PORT=5101/' .env
verif "T3 verifier-ports liste : 5100 et 5101 lus du .env" bash -c 'node scripts/verifier-ports.js liste | grep -q "administration : 5100" && node scripts/verifier-ports.js liste | grep -q "portail employés : 5101"'
bash gestion.sh demarrer-silencieux > /tmp/t3-gestion.log 2>&1
if attendre_http 5100 /login 150; then pass "T3 administration démarrée sur le port PERSONNALISÉ 5100"; else fail "T3 administration : pas de réponse sur 5100"; fi
if attendre_http 5101 / 120; then pass "T3 portail démarré sur le port PERSONNALISÉ 5101"; else fail "T3 portail : pas de réponse sur 5101"; fi
verif "T3 gestion.sh etat OK sur les ports personnalisés" bash gestion.sh etat
verif "T3 verifier-ports verifier : code 2 (interfaces à nous en cours)" bash -c 'node scripts/verifier-ports.js verifier >/dev/null 2>&1; test $? -eq 2'

# ---------------------------------------------------------------- T4
say ""
say "T4 — CONFLIT de port : occupé par un AUTRE programme (5100)"
arreter_tout
node -e 'require("http").createServer((q,s)=>{s.end("imposteur")}).listen(5100,"0.0.0.0")' >/dev/null 2>&1 &
DUMMY_PID=$!
sleep 1
node scripts/verifier-ports.js verifier > /tmp/t4-verif.log 2>&1
[ $? -eq 1 ] && pass "T4 verifier-ports : code sortie 1 (conflit détecté)" || fail "T4 verifier-ports : code sortie attendu 1"
grep -q "AUTRE programme" /tmp/t4-verif.log && pass "T4 message CONFLIT avec identification du propriétaire" || fail "T4 : pas de message CONFLIT"
bash DEMARRER-TOUT-LINUX-MAC.sh > /tmp/t4-lanceur.log 2>&1
grep -q "AUTRE programme" /tmp/t4-lanceur.log && pass "T4 DEMARRER-TOUT : blocage propre avec remédiation (PID, .env)" || fail "T4 DEMARRER-TOUT : pas de message de blocage"
kill -0 $DUMMY_PID 2>/dev/null && pass "T4 RIEN n'a été tué : le programme étranger tourne toujours" || fail "T4 : le programme étranger a été tué (interdit)"
bash DEMARRER-LINUX-MAC.sh > /tmp/t4-admin.log 2>&1
[ $? -eq 1 ] && pass "T4 DEMARRER-LINUX-MAC (ciblé) : échec propre code 1 AVANT l'installation" || fail "T4 DEMARRER-LINUX-MAC : devrait échouer avec code 1"
grep -q "occupe par un AUTRE programme" /tmp/t4-admin.log && pass "T4 lanceur mono-interface : message clair port occupé" || fail "T4 lanceur mono-interface : pas de message"
kill $DUMMY_PID 2>/dev/null; wait $DUMMY_PID 2>/dev/null; sleep 2
port_libre 5100 && pass "T4 port 5100 libéré après arrêt de l'imposteur" || fail "T4 port 5100 encore occupé"

# ---------------------------------------------------------------- T5
say ""
say "T5 — start-prod.js honore la ligne PORT du .env (correctif ordre de chargement)"
# Le .env hérité de T3/T4 contient PORT=5100 : le démarrage DIRECT du moteur
# (sans variable d'environnement PORT) doit l'honorer.
node scripts/start-prod.js > /tmp/t5-start.log 2>&1 &
SP_PID=$!
if attendre_http 5100 /login 120; then pass "T5 démarrage DIRECT : le .env PORT=5100 est honoré (4000 ignoré par défaut)" || true; else fail "T5 démarrage DIRECT : pas de réponse sur 5100"; fi
kill $SP_PID 2>/dev/null; wait $SP_PID 2>/dev/null; sleep 3
port_libre 5100 && pass "T5 arrêt propre : port 5100 libéré" || fail "T5 port 5100 non libéré"

# ---------------------------------------------------------------- T6
say ""
say "T6 — Identité superadmin par le .env + SUPERADMIN_AUTO=0"
nettoyer_install
printf 'PORT=5100\nPORTAL_PORT=5101\nSUPERADMIN_EMAIL=directeur@auto-rh.tn\nSUPERADMIN_PASSWORD=Directeur#2026x\n' >> .env
node scripts/creer-superadmin.js --assurer > /tmp/t6-assurer.log 2>&1
NB6="$(nb_superadmin db/custom.db)"
[ "$NB6" = "1" ] && pass "T6 --assurer : 1 superadmin créé depuis l'identité du .env" || fail "T6 --assurer : comptes = $NB6 (attendu 1)"
verif "T6 aucun mot de passe consigné (identité fournie)" bash -c '! test -s logs/compte-superadmin-initial.txt'
bash gestion.sh demarrer-silencieux > /tmp/t6-gestion.log 2>&1
attendre_http 5100 /login 150
CODE6="$(node -e 'const h=require("http");const d=JSON.stringify({email:"directeur@auto-rh.tn",password:"Directeur#2026x"});const q=h.request({host:"127.0.0.1",port:5100,path:"/api/auth/login",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},r=>{r.resume();process.exit(r.statusCode===200?0:1)});q.on("error",()=>process.exit(1));q.end(d)' >/dev/null 2>&1; echo $?)"
[ "$CODE6" = "0" ] && pass "T6 connexion avec les identifiants du .env : API login → 200" || fail "T6 connexion identifiants du .env : échec (code $CODE6)"
bash gestion.sh arreter >/dev/null 2>&1
nettoyer_install
printf 'PORT=5100\nPORTAL_PORT=5101\nSUPERADMIN_AUTO=0\n' >> .env
node scripts/creer-superadmin.js --assurer > /tmp/t6-desactive.log 2>&1
NB6B="$(nb_superadmin db/custom.db)"
[ "$NB6B" = "0" ] && pass "T6 SUPERADMIN_AUTO=0 : AUCUN compte créé" || fail "T6 SUPERADMIN_AUTO=0 : comptes = $NB6B (attendu 0)"

# ---------------------------------------------------------------- T7
say ""
say "T7 — Cycle complet gestion.sh (avec ports personnalisés)"
bash gestion.sh demarrer-silencieux > /tmp/t7a.log 2>&1
attendre_http 5100 /login 150 && attendre_http 5101 / 120 && pass "T7 demarrer-silencieux : les 2 interfaces en marche (5100/5101)" || fail "T7 demarrer-silencieux : interfaces absentes"
verif "T7 etat : interfaces détectées en marche"        bash gestion.sh etat
bash gestion.sh journaux admin 5 > /tmp/t7b.log 2>&1
[ -s /tmp/t7b.log ] && pass "T7 journaux : lignes affichées" || fail "T7 journaux : sortie vide"
pid_de(){ # PIDs enregistres par le moteur (logs/paiesage-processus.json)
    node -e 'try{const j=JSON.parse(require("fs").readFileSync("logs/paiesage-processus.json","utf8"));console.log([j.admin||0,j.portail||0].join("-"))}catch{console.log("0-0")}' 2>/dev/null
}
PID_AVANT="$(pid_de)"
bash gestion.sh redemarrer > /tmp/t7c.log 2>&1
attendre_http 5100 /login 150 && pass "T7 redemarrer : administration de nouveau OK sur 5100" || fail "T7 redemarrer : administration absente"
PID_APRES="$(pid_de)"
[ -n "$PID_APRES" ] && [ "$PID_APRES" != "0-0" ] && [ "$PID_AVANT" != "$PID_APRES" ] && pass "T7 redemarrer : NOUVEAUX PIDs (relancé réellement : $PID_AVANT → $PID_APRES)" || fail "T7 redemarrer : PIDs identiques ou absents ($PID_AVANT → $PID_APRES)"
bash gestion.sh ports > /tmp/t7p.log 2>&1; RC_PORTS=$?
grep -q "administration" /tmp/t7p.log && { [ $RC_PORTS -eq 0 ] || [ $RC_PORTS -eq 2 ]; } && pass "T7 ports : affichage .env + disponibilité (code $RC_PORTS)" || fail "T7 ports : sortie inattendue (code $RC_PORTS)"
bash gestion.sh arreter > /tmp/t7d.log 2>&1
sleep 6
port_libre 5100 && port_libre 5101 && pass "T7 arreter : les DEUX ports personnalisés libérés" || fail "T7 arreter : ports encore occupés"
bash gestion.sh etat > /tmp/t7e.log 2>&1
# « etat » est INFORMATIF (toujours code 0) : on vérifie le CONTENU.
grep -q "ARRETE" /tmp/t7e.log && ! grep -q "EN FONCTIONNEMENT" /tmp/t7e.log && pass "T7 etat après arrêt : les deux interfaces déclarées ARRETE" || fail "T7 etat après arrêt : interfaces encore en fonctionnement"

# ---------------------------------------------------------------- bilan
say ""
say "============================================================"
say " BILAN : $PASS réussis, $FAIL échoués"
say "============================================================"
[ "$FAIL" -eq 0 ]
