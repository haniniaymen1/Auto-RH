#!/usr/bin/env node
/**
 * ============================================================
 *  Fiches de Paie - MOTEUR DE SERVICE « SILENCIEUX »
 *  (Task 30 : fonctionnement en ARRIERE-PLAN, sans fenetre CMD)
 * ============================================================
 *
 *  Fait tourner les deux serveurs (administration + portail employes)
 *  en processus DETACHES et CACHES :
 *    - ports : PORT (administration) et PORTAL_PORT (portail) lus dans le
 *      .env de la racine — comme les lanceurs classiques ; les variables
 *      PAIESAGE_PORT_ADMIN / PAIESAGE_PORT_PORTAIL restent prioritaires,
 *      defauts historiques 4000 / 4001 ;
 *    - Windows  : spawn avec detached:true + windowsHide:true
 *                 -> AUCUNE fenetre noire n'apparait ;
 *    - Linux/Mac: processus detache standard (nohup-like).
 *
 *  Les PIDs sont enregistres dans logs/paiesage-processus.json
 *  pour permettre un ARRET PROPRE plus tard (ARRETER-...-VBS),
 *  et les sorties console sont conservees dans :
 *    - logs/paiesage-administration.log
 *    - logs/paiesage-portail.log
 *
 *  Commandes :
 *    node scripts/service-paiesage.js start    -> demarre (et attend que les 2 ports repondent)
 *    node scripts/service-paiesage.js stop     -> arrete proprement les 2 serveurs
 *    node scripts/service-paiesage.js restart  -> stop puis start
 *    node scripts/service-paiesage.js status   -> etat affiche dans la console
 *    node scripts/service-paiesage.js statusfile -> etat ecrit dans logs/etat-actuel.txt
 *
 *  Fichiers d'etat (lus par les lanceurs .vbs, contenu ASCII) :
 *    logs/demarrage-etat.txt  : ETAT=OK|ERREUR + MESSAGE=... + OUVRIR=http://localhost:<port administration>
 *    logs/arret-etat.txt      : ETAT=OK|ERREUR + MESSAGE=...
 *    logs/etat-actuel.txt     : lignes lisibles de l'etat courant
 *
 *  Comportements important :
 *    - start est IDEMPOTENT : si les deux serveurs repondent deja,
 *      rien n'est relance (etat OK « deja en cours ») ;
 *    - stop est IDEMPOTENT : rien a arreter -> etat OK ;
 *    - les serveurs lances PAR LES .bat VISIBLES (fenetres CMD) ne
 *      sont PAS touches par ce moteur (pas de PID enregistre) : le
 *      stop l'indique clairement au lieu de tuer des processus inconnus.
 * ============================================================
 */
"use strict";

const { spawn, spawnSync, execSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOGS = path.join(ROOT, "logs");
const PID_FILE = path.join(LOGS, "paiesage-processus.json");
const ETAT_START = path.join(LOGS, "demarrage-etat.txt");
const ETAT_STOP = path.join(LOGS, "arret-etat.txt");
const ETAT_STATUS = path.join(LOGS, "etat-actuel.txt");
const LOG_ADMIN = path.join(LOGS, "paiesage-administration.log");
const LOG_PORTAIL = path.join(LOGS, "paiesage-portail.log");

// (NOUVEAU) Ports configurables : lus dans le .env de la racine (mêmes
// variables que les lanceurs DEMARRER-*.bat / *.sh). Priorité :
//   PAIESAGE_PORT_ADMIN  >  PORT du .env         >  4000 (défaut historique)
//   PAIESAGE_PORT_PORTAIL >  PORTAL_PORT du .env  >  4001 (défaut historique)
function lirePortEnv(cle, defaut) {
  try {
    const texte = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = texte.match(new RegExp("^\\s*" + cle + "\\s*=\\s*\"?([0-9]+)\"?\\s*$", "m"));
    if (m) return m[1];
  } catch {
    /* pas de .env lisible : défaut */
  }
  return defaut;
}
const PORT_ADMIN = String(process.env.PAIESAGE_PORT_ADMIN || lirePortEnv("PORT", "4000"));
const PORT_PORTAIL = String(process.env.PAIESAGE_PORT_PORTAIL || lirePortEnv("PORTAL_PORT", "4001"));

// (v0.2.209) Lecture générique d'une clé du .env (chaîne brute, sans guillemets).
function lireEnvBrut(cle, defaut) {
  try {
    const texte = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = texte.match(new RegExp("^\\s*" + cle + "\\s*=\\s*\"?'?([^\"'\\r\\n]*)\"?'?\\s*$", "m"));
    if (m) return m[1].trim();
  } catch {
    /* pas de .env lisible : défaut */
  }
  return defaut;
}
const IS_WIN = process.platform === "win32";

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------
function ensureLogs() {
  try { fs.mkdirSync(LOGS, { recursive: true }); } catch (_) { /* deja present */ }
}

function logLine(file, msg) {
  try { fs.appendFileSync(file, msg + "\n"); } catch (_) { /* best effort */ }
}

/** Une requete HTTP "quelconque" reussit des qu'une reponse arrive (200/302/401...). */
function httpRepond(port, timeoutMs) {
  return new Promise((resolve) => {
    const to = setTimeout(() => { req.destroy(new Error("timeout")); }, timeoutMs || 1500);
    const req = http.get(
      { host: "127.0.0.1", port: Number(port), path: "/", timeout: timeoutMs || 1500 },
      (res) => { clearTimeout(to); res.resume(); resolve(true); }
    );
    req.on("error", () => { clearTimeout(to); resolve(false); });
  });
}

async function attendreHttp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpRepond(port, 1500)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

function pidVivant(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === "EPERM"; }
}

function lirePids() {
  try {
    const j = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
    if (j && (j.admin || j.portail)) return j;
  } catch (_) { /* absent/corrompu */ }
  return null;
}

function ecrirePids(admin, portail) {
  ensureLogs();
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({ admin, portail, startedAt: new Date().toISOString() }, null, 2)
  );
}

function supprimerPids() {
  try { fs.unlinkSync(PID_FILE); } catch (_) { /* absent */ }
}

// ------------------------------------------------------------
// (NOUVEAU 0.2.203) DECOUVERTE PRECISE du PID a l'ecoute d'un port.
// Repli de « stop » quand aucun PID n'est enregistre (serveurs lances
// par un .bat/.sh visible, un ancien nohup, etc.). On ne tue QUE le
// processus a l'ecoute de NOS ports, et UNIQUEMENT s'il s'agit de
// node — JAMAIS de commande globale taskkill/killall.
// ------------------------------------------------------------
function pidsSurPort(port) {
  const pids = [];
  if (IS_WIN) {
    try {
      const out = execSync("netstat -ano -p TCP", { encoding: "utf8", timeout: 10000 });
      for (const ligne of out.split(/\r?\n/)) {
        // TCP    0.0.0.0:4000    0.0.0.0:0    LISTENING    1234
        const m = ligne.match(/^\s*TCP\s+\S+[:.](\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && m[1] === String(port)) pids.push(Number(m[2]));
      }
    } catch (_) { /* netstat indisponible : repli inactif */ }
    return [...new Set(pids)];
  }
  // Linux / macOS : ss (preferentiel) puis lsof, les deux silencieux.
  try {
    const out = execSync("ss -ltnp 2>/dev/null || true", { encoding: "utf8", timeout: 10000, shell: "/bin/bash" });
    for (const ligne of out.split(/\r?\n/)) {
      if (!new RegExp("[:.]" + String(port) + "\\s").test(ligne)) continue;
      const m = ligne.match(/pid=(\d+)/);
      if (m) pids.push(Number(m[1]));
    }
  } catch (_) { /* ss indisponible */ }
  if (pids.length === 0) {
    try {
      const out = execSync("lsof -t -i TCP:" + Number(port) + " -sTCP:LISTEN 2>/dev/null || true",
        { encoding: "utf8", timeout: 10000, shell: "/bin/bash" });
      for (const ligne of out.split(/\r?\n/)) {
        const pid = Number(ligne.trim());
        if (pid > 0) pids.push(pid);
      }
    } catch (_) { /* lsof indisponible */ }
  }
  return [...new Set(pids)];
}

/** VRAI uniquement si le processus est bien node (securite de l'arret).
 *  (0.2.203) on verifie le BINAIRE reel /proc/<pid>/exe d'abord : le
 *  nom affiche (comm) peut avoir ete change par le programme lui-meme
 *  (process.title de Next : « next-server (v1... » ; portail :
 *  « MainThread ») alors que le binaire reste node. */
function estNode(pid) {
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", timeout: 10000 });
      return /^"node\.exe"/i.test(out.trim());
    }
    try {
      const exe = fs.readlinkSync(`/proc/${pid}/exe`);
      if (path.basename(exe).startsWith("node")) return true;
    } catch (_) { /* permission ou disparu */ }
    try {
      if (fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "node") return true;
    } catch (_) { /* disparu */ }
    try {
      const argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0];
      if (path.basename(argv0).startsWith("node")) return true;
    } catch (_) { /* disparu */ }
    return false;
  } catch (_) { return false; }
}

/** (NOUVEAU 0.2.203) arrete uniquement les node a l'ecoute des ports indiques. */
async function arreterParPorts(cibles) {
  const tues = [];
  const nonNodes = [];
  for (const [nom, port] of cibles) {
    for (const pid of pidsSurPort(port)) {
      if (estNode(pid)) {
        tuerArbre(pid);
        tues.push(`${nom} (PID ${pid}, decouvert par le port ${port})`);
      } else {
        nonNodes.push(`port ${port} : PID ${pid} n'est PAS node — non touche`);
      }
    }
  }
  if (tues.length) {
    logLine(LOG_ADMIN, `[${new Date().toISOString()}] (service) arret par decouverte de ports : ${tues.join(", ")}`);
  }
  return { tues, nonNodes };
}

/** Attente synchrone ~ms (compatible tous Node, y compris en script). */
function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Tue un processus et ses enfants (arbre). */
function tuerArbre(pid) {
  if (IS_WIN) {
    try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); return true; }
    catch (_) { return false; }
  }
  try { process.kill(pid, "SIGTERM"); } catch (_) { return false; }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && pidVivant(pid)) dormir(200);
  if (pidVivant(pid)) {
    try { process.kill(pid, "SIGKILL"); } catch (_) { /* deja mort */ }
  }
  return true;
}

function ecrireEtat(file, ok, message, ouvrir) {
  ensureLogs();
  const lignes = [`ETAT=${ok ? "OK" : "ERREUR"}`];
  if (ouvrir) lignes.push(`OUVRIR=${ouvrir}`);
  lignes.push(`MESSAGE=${message}`);
  lignes.push(`DATE=${new Date().toISOString()}`);
  fs.writeFileSync(file, lignes.join("\r\n") + "\r\n");
}

// ------------------------------------------------------------
// START
// ------------------------------------------------------------
async function demarrer() {
  ensureLogs();
  const stamp = () => new Date().toISOString();

  // Deja en cours ? (les deux ports repondent -> rien a faire)
  const adminUp = await httpRepond(PORT_ADMIN, 1500);
  const portailUp = await httpRepond(PORT_PORTAIL, 1500);
  if (adminUp && portailUp) {
    // (MODIFIE Task 93 : ce cas EST le piège vécu par l'administrateur —
    //  il vient de changer le code d'inscription / le .env, relance
    //  DEMARRER-SILENCIEUX, et le moteur répond « rien à faire » : les
    //  serveurs EN COURS gardent l'ANCIEN .env en mémoire. Le message
    //  explique désormais le VRAI redémarrage au lieu de laisser croire
    //  que le changement a été appliqué.)
    ecrireEtat(
      ETAT_START, true,
      `Les serveurs tournent DEJA sur les ports du .env : Administration http://localhost:${PORT_ADMIN} - Portail http://localhost:${PORT_PORTAIL}. RIEN n'a ete relance : un changement recent du fichier .env n'est DONC PAS applique tant que les serveurs tournent. Pour l'appliquer : Windows - ARRETER-WINDOWS.bat PUIS DEMARRER-TOUT-WINDOWS.bat ; Linux/macOS - bash ARRETER-LINUX-MAC.sh PUIS bash DEMARRER-TOUT-LINUX-MAC.sh (ou GESTION.bat / bash gestion.sh, choix redemarrer).`,
      `http://localhost:${PORT_ADMIN}`
    );
    logLine(LOG_ADMIN, `[${stamp()}] (service) start demande alors que les serveurs tournent deja - rien a faire. Pour appliquer un changement de .env : ARRETER puis DEMARRER (Task 93).`);
    console.log("Deja en cours d'execution : RIEN n'a ete relance.");
    console.log("Un changement recent du .env n'est PAS applique : faites ARRETER-WINDOWS.bat puis DEMARRER-TOUT-WINDOWS.bat - ou sous Linux : bash ARRETER-LINUX-MAC.sh puis bash DEMARRER-TOUT-LINUX-MAC.sh.");
    return 0;
  }

  // (CORRECTIF 0.2.206) Instance MUETTE (a l'ecoute mais sans reponse HTTP)
  // : arretee precisement ici, sinon le nouveau processus meurt en
  // EADDRINUSE et l'utilisateur reste bloque sur une page morte.
  {
    const muettes = [];
    for (const [nom, port] of [["administration", PORT_ADMIN], ["portail", PORT_PORTAIL]]) {
      if (pidsSurPort(port).length > 0 && !(await httpRepond(port, 800))) muettes.push([nom, port]);
    }
    if (muettes.length) {
      const { tues: tuesMuets } = await arreterParPorts(muettes);
      if (tuesMuets.length) {
        logLine(LOG_ADMIN, `[${stamp()}] (service) start : instance(s) muette(s) arretee(s) : ${tuesMuets.join(", ")}`);
      }
      dormir(500);
    }
  }

  // Nettoie d'eventuels PIDs de l'execution precedente (stale)
  const pids = lirePids();
  if (pids) {
    for (const pid of [pids.admin, pids.portail]) {
      if (pid && pidVivant(pid)) tuerArbre(pid);
    }
    supprimerPids();
    dormir(800);
  }

  // Task 40 : SECURISATION AUTOMATIQUE des dossiers sensibles (.env, db,
  // storage, logs, backups) AVANT le lancement des serveurs. Le script
  // dedie est silencieux, idempotent et ne peut JAMAIS bloquer le
  // demarrage (erreurs ignorees, journal : logs/securisation-auto.log).
  try {
    const sec = spawnSync(
      process.execPath,
      [path.join(__dirname, "securiser-auto.js")],
      { cwd: ROOT, windowsHide: true, timeout: 120000 }
    );
    console.log(
      "Securisation automatique des dossiers : " +
      (sec.status === 0 ? "OK." : "terminee avec avertissements (voir logs/securisation-auto.log).")
    );
  } catch (_) { /* ne jamais bloquer le demarrage */ }

  // (v0.2.209) Création AUTOMATIQUE du superadministrateur au premier
  // démarrage (base vierge) — idempotent : rien n'est créé si un compte
  // SUPERADMIN actif existe déjà (protection anti-doublon). Jamais bloquant :
  // un échec est signalé mais le démarrage continue. SUPERADMIN_AUTO=0 dans
  // le .env désactive l'étape ; SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
  // préconfigurent l'identité (sinon mot de passe aléatoire consigné une
  // seule fois dans logs/compte-superadmin-initial.txt).
  if ((process.env.SUPERADMIN_AUTO || lireEnvBrut("SUPERADMIN_AUTO", "1")) !== "0") {
    try {
      const sa = spawnSync(
        process.execPath,
        [path.join(__dirname, "creer-superadmin.js"), "--assurer"],
        { cwd: ROOT, windowsHide: true, timeout: 120000 }
      );
      const sortie = (sa.stdout || "").toString().trim().split(/\r?\n/).filter(Boolean);
      for (const l of sortie) console.log("  " + l);
      console.log(
        "Superadministrateur : " +
        (sa.status === 0 ? "OK." : "etape non terminee (voir message ci-dessus, demarrage continue).")
      );
    } catch (_) { /* ne jamais bloquer le demarrage */ }
  }

  logLine(LOG_ADMIN, `\r\n[${stamp()}] ===== Demarrage silencieux (administration, port ${PORT_ADMIN}) =====`);
  logLine(LOG_PORTAIL, `\r\n[${stamp()}] ===== Demarrage silencieux (portail, port ${PORT_PORTAIL}) =====`);

  // --- Administration (start-prod.js : .env + schema + ressources + serveur standalone) ---
  const outAdmin = fs.openSync(LOG_ADMIN, "a");
  const enfantAdmin = spawn(
    process.execPath,
    [path.join(ROOT, "scripts", "start-prod.js")],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: PORT_ADMIN,
        HOSTNAME: "0.0.0.0",
        PAIESAGE_ROOT: ROOT,
        PAIESAGE_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
      }),
      detached: true,
      stdio: ["ignore", outAdmin, outAdmin],
      windowsHide: true,
    }
  );
  enfantAdmin.unref();

  // --- Portail employes (portail-server.js) ---
  const outPortail = fs.openSync(LOG_PORTAIL, "a");
  const enfantPortail = spawn(
    process.execPath,
    [path.join(ROOT, "scripts", "portail-server.js")],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORTAL_PORT: PORT_PORTAIL,
        HOSTNAME: "0.0.0.0",
        PAIESAGE_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
      }),
      detached: true,
      stdio: ["ignore", outPortail, outPortail],
      windowsHide: true,
    }
  );
  enfantPortail.unref();

  ecrirePids(enfantAdmin.pid, enfantPortail.pid);
  console.log(`Administration PID ${enfantAdmin.pid} (port ${PORT_ADMIN}), Portail PID ${enfantPortail.pid} (port ${PORT_PORTAIL}).`);

  // --- Attente de la disponibilite reelle des deux interfaces ---
  // (CORRECTIF 0.2.207) 420 s : start-prod.js peut RECONSTRUIRE le site
  // (2 a 4 min) avant de repondre — build absent, interrompu ou perime.
  const okAdmin = await attendreHttp(PORT_ADMIN, 420000); // premier demarrage : build auto + db push + ressources
  const okPortail = await attendreHttp(PORT_PORTAIL, 90000);

  if (okAdmin && okPortail) {
    ecrireEtat(
      ETAT_START, true,
      `Serveurs demarres en arriere-plan. Administration : http://localhost:${PORT_ADMIN} (login requis) - Portail : http://localhost:${PORT_PORTAIL}. Pour arreter : ARRETER-SILENCIEUX-WINDOWS.vbs`,
      `http://localhost:${PORT_ADMIN}`
    );
    console.log("OK : les deux serveurs repondent.");
    return 0;
  }

  const detail = [];
  if (!okAdmin) detail.push(`administration (port ${PORT_ADMIN})`);
  if (!okPortail) detail.push(`portail (port ${PORT_PORTAIL})`);
  ecrireEtat(
    ETAT_START, false,
    `Le demarrage a echoue pour : ${detail.join(" et ")}. Consultez les journaux (JOURNAUX-SILENCIEUX-WINDOWS.vbs). Causes frequentes : premier build incomplet, port deja utilise par une autre application.`
  );
  console.error("ECHEC : " + detail.join(", "));
  return 1;
}

// ------------------------------------------------------------
// STOP
// ------------------------------------------------------------
async function arreter() {
  ensureLogs();
  const pids = lirePids();

  if (!pids) {
    const adminUp = await httpRepond(PORT_ADMIN, 1500);
    const portailUp = await httpRepond(PORT_PORTAIL, 1500);
    // (CORRECTIF 0.2.206) Decouverte INCONDITIONNELLE des deux ports : les
    // instances MUETTES (encore a l'ecoute mais qui ne repondent plus au
    // HTTP) doivent aussi etre arretees — c'est l'incident « Rien a arreter
    // puis deja en cours alors que la page ne repondait plus ». La
    // decouverte ne touche QUE des processus NODE a l'ecoute de NOS deux
    // ports (.env) — jamais les autres programmes du systeme.
    const { tues, nonNodes } = await arreterParPorts([
      ["administration", PORT_ADMIN],
      ["portail", PORT_PORTAIL],
    ]);
    if (!tues.length && !nonNodes.length && !adminUp && !portailUp &&
        pidsSurPort(PORT_ADMIN).length === 0 && pidsSurPort(PORT_PORTAIL).length === 0) {
      ecrireEtat(ETAT_STOP, true, "Rien a arreter : les serveurs ne tournent pas.");
      console.log("Rien a arreter.");
      return 0;
    }
    supprimerPids();
    // (CORRECTIF 0.2.206) Verifie la liberation REELLE des ports (6 s max) :
    // reponse HTTP OU presence d'un processus encore a l'ecoute (une
    // instance muette vivante ne compte plus comme « libere »).
    let encoreAdmin = true, encorePortail = true;
    for (let i = 0; i < 12; i++) {
      encoreAdmin = (await httpRepond(PORT_ADMIN, 400)) || pidsSurPort(PORT_ADMIN).length > 0;
      encorePortail = (await httpRepond(PORT_PORTAIL, 400)) || pidsSurPort(PORT_PORTAIL).length > 0;
      if (!encoreAdmin && !encorePortail) break;
      dormir(500);
    }
    if (encoreAdmin || encorePortail) {
      ecrireEtat(
        ETAT_STOP, false,
        `Arret partiel : ${tues.join(", ") || "aucun processus node arrete"} ; ${encoreAdmin ? PORT_ADMIN : PORT_PORTAIL} repond encore.${nonNodes.length ? " " + nonNodes.join(" ; ") + "." : " Un autre programme utilise peut-etre ce port."}`
      );
      return 1;
    }
    ecrireEtat(
      ETAT_STOP, true,
      tues.length
        ? `Arret effectue : ${tues.join(", ")}.`
        : "Arret effectue (plus rien ne repond sur les ports)."
    );
    console.log("Arret effectue (decouverte par ports).");
    return 0;
  }

  const tues = [];
  for (const [nom, pid] of [["administration", pids.admin], ["portail", pids.portail]]) {
    if (pid && pidVivant(pid)) {
      tuerArbre(pid);
      tues.push(`${nom} (PID ${pid})`);
    }
  }
  supprimerPids();

  // (CORRECTIF 0.2.206) Verifie que les ports sont bien liberes (best
  // effort, 6 s max) : reponse HTTP OU processus encore a l'ecoute.
  let encoreAdmin = true, encorePortail = true;
  for (let i = 0; i < 12; i++) {
    encoreAdmin = (await httpRepond(PORT_ADMIN, 400)) || pidsSurPort(PORT_ADMIN).length > 0;
    encorePortail = (await httpRepond(PORT_PORTAIL, 400)) || pidsSurPort(PORT_PORTAIL).length > 0;
    if (!encoreAdmin && !encorePortail) break;
    dormir(500);
  }

  if (encoreAdmin || encorePortail) {
    // (NOUVEAU 0.2.203) dernier repli : un processus node non enregistre
    // (ex. relance hors moteur) tient encore un port -> arret precise.
    const { tues: tuesF, nonNodes } = await arreterParPorts(
      [
        ["administration", PORT_ADMIN, encoreAdmin],
        ["portail", PORT_PORTAIL, encorePortail],
      ].filter(([, , up]) => up === true)
    );
    if (tuesF.length) {
      for (let i = 0; i < 12; i++) {
        encoreAdmin = await httpRepond(PORT_ADMIN, 400);
        encorePortail = await httpRepond(PORT_PORTAIL, 400);
        if (!encoreAdmin && !encorePortail) break;
        dormir(500);
      }
      if (!encoreAdmin && !encorePortail) {
        ecrireEtat(
          ETAT_STOP, true,
          `Arret effectue : ${tues.concat(tuesF).join(", ")}.`
        );
        console.log("Arret effectue.");
        return 0;
      }
    }
    ecrireEtat(
      ETAT_STOP, false,
      `Arret partiel : ${tues.concat(tuesF).join(", ") || "aucun processus"} mais un service repond encore sur ${encoreAdmin ? PORT_ADMIN : PORT_PORTAIL}.${nonNodes.length ? " " + nonNodes.join(" ; ") + "." : " Un autre programme (non node) utilise peut-etre ce port."}`
    );
    return 1;
  }

  ecrireEtat(
    ETAT_STOP, true,
    tues.length
      ? `Arret effectue : ${tues.join(", ")}.`
      : "Arret effectue (les processus enregistres avaient deja pris fin)."
  );
  console.log("Arret effectue.");
  return 0;
}

// ------------------------------------------------------------
// STATUS
// ------------------------------------------------------------
async function etatTexte() {
  const pids = lirePids();
  const adminUp = await httpRepond(PORT_ADMIN, 1500);
  const portailUp = await httpRepond(PORT_PORTAIL, 1500);
  const lignes = [
    "=== PaieSage - Etat des serveurs (mode arriere-plan) ===",
    `Administration : ${adminUp ? `EN FONCTIONNEMENT - http://localhost:${PORT_ADMIN} repond` : `ARRETE (port ${PORT_ADMIN} sans reponse)`}`,
    `Portail        : ${portailUp ? `EN FONCTIONNEMENT - http://localhost:${PORT_PORTAIL} repond` : `ARRETE (port ${PORT_PORTAIL} sans reponse)`}`,
    pids
      ? `Processus enregistres : administration PID ${pids.admin}, portail PID ${pids.portail} (depuis ${pids.startedAt})`
      : "Aucun processus enregistre par le mode silencieux (demarrage visible ou absent).",
    "Journaux : dossier logs\\ (paiesage-administration.log, paiesage-portail.log).",
  ];
  return lignes.join("\r\n");
}

async function etatConsole() {
  const txt = await etatTexte();
  console.log(txt);
  return 0;
}

async function etatFichier() {
  ensureLogs();
  const txt = await etatTexte();
  fs.writeFileSync(ETAT_STATUS, txt + "\r\n");
  return 0;
}

// ------------------------------------------------------------
// (NOUVEAU 0.2.203) RECORD — enregistrement de PIDs EXTERNES.
// Les lanceurs qui demarrent les serveurs hors moteur (nohup Linux,
// scripts .sh) inscrivent leurs PIDs dans le MEME fichier que le
// moteur : l'arret suivant (stop) reste donc PRECIS (par PID).
// Fusion avec l'existant : une valeur 0/absente CONSERVE le PID deja
// enregistre pour cette interface.
// ------------------------------------------------------------
function enregistrerPidsExternes(pidAdminArg, pidPortailArg) {
  const ancien = lirePids() || {};
  const a = Number(pidAdminArg) > 0 ? Number(pidAdminArg) : (ancien.admin || null);
  const p = Number(pidPortailArg) > 0 ? Number(pidPortailArg) : (ancien.portail || null);
  if (!a && !p) return false;
  ecrirePids(a, p);
  return true;
}

// ------------------------------------------------------------
// Point d'entree
// ------------------------------------------------------------
(async () => {
  const cmd = (process.argv[2] || "").toLowerCase();
  let code = 0;
  if (cmd === "start") code = await demarrer();
  else if (cmd === "stop") code = await arreter();
  else if (cmd === "restart") { await arreter(); dormir(1000); code = await demarrer(); }
  else if (cmd === "status") code = await etatConsole();
  else if (cmd === "statusfile") code = await etatFichier();
  else if (cmd === "record") {
    const ok = enregistrerPidsExternes(process.argv[3], process.argv[4]);
    if (ok) {
      const j = lirePids();
      console.log(`PIDs enregistres : administration ${j.admin || "-"}, portail ${j.portail || "-"}.`);
      code = 0;
    } else {
      console.log("Usage : record <pidAdmin> <pidPortail> (0 = conserver l'existant)");
      code = 2;
    }
  }
  else {
    console.log("Usage : node scripts/service-paiesage.js start|stop|restart|status|statusfile|record");
    code = 2;
  }
  process.exit(code);
})().catch((e) => {
  console.error("Erreur inattendue :", e && e.message);
  process.exit(1);
});
