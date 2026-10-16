#!/usr/bin/env node
/**
 * ============================================================
 *  Fiches de Paie - MOTEUR DE SERVICE « SILENCIEUX »
 *  (Task 30 : fonctionnement en ARRIERE-PLAN, sans fenetre CMD)
 * ============================================================
 *
 *  Fait tourner les deux serveurs (administration port 4000 +
 *  portail employes port 4001) en processus DETACHES et CACHES,
 *  puis garantit le PONT D'APERCU (port 3000 -> administration) :
 *  la plateforme expose l'application via un proxy qui pointe le
 *  port 3000 ; sans pont, l'aperçu repond 502 et les telechargements
 *  publics (/api/download-scripts...) sont inaccessibles. Le pont
 *  est un simple aiguillage reseau : AUCUN port AutoRH change.
 *    - Windows  : spawn avec detached:true + windowsHide:true
 *                 -> AUCUNE fenetre noire n'apparait ;
 *    - Linux/Mac: processus detache standard (nohup-like).
 *
 *  Les PIDs sont enregistres dans logs/auto-rh-processus.json
 *  pour permettre un ARRET PROPRE plus tard (ARRETER-...-VBS),
 *  et les sorties console sont conservees dans :
 *    - logs/auto-rh-administration.log
 *    - logs/auto-rh-portail.log
 *
 *  Commandes :
 *    node scripts/auto-rh.js start    -> demarre (et attend que les 2 ports repondent)
 *    node scripts/auto-rh.js stop     -> arrete proprement les 2 serveurs
 *    node scripts/auto-rh.js restart  -> stop puis start
 *    node scripts/auto-rh.js status   -> etat affiche dans la console
 *    node scripts/auto-rh.js statusfile -> etat ecrit dans logs/etat-actuel.txt
 *
 *  Fichiers d'etat (lus par les lanceurs .vbs, contenu ASCII) :
 *    logs/demarrage-etat.txt  : ETAT=OK|ERREUR + MESSAGE=... + OUVRIR=http://localhost:3000
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
const PID_FILE = path.join(LOGS, "auto-rh-processus.json");
const ETAT_START = path.join(LOGS, "demarrage-etat.txt");
const ETAT_STOP = path.join(LOGS, "arret-etat.txt");
const ETAT_STATUS = path.join(LOGS, "etat-actuel.txt");
const LOG_ADMIN = path.join(LOGS, "auto-rh-administration.log");
const LOG_PORTAIL = path.join(LOGS, "auto-rh-portail.log");
const LOG_PONT = path.join(LOGS, "auto-rh-pont.log");

const PORT_ADMIN = String(process.env.AUTO_RH_PORT_ADMIN || "4000");
const PORT_PORTAIL = String(process.env.AUTO_RH_PORT_PORTAIL || "4001");
// (NOUVEAU v0.2.109) Pont d'aperçu : la plateforme proxy 81 -> 3000.
// Desactivable avec AUTO_RH_PONT_PREVIEW=0 si un autre service occupe 3000.
const PONT_ACTIF = String(process.env.AUTO_RH_PONT_PREVIEW || "1") !== "0";
const PORT_PONT = String(process.env.AUTO_RH_PORT_PONT || "3000");
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
    if (j && (j.admin || j.portail || j.pont)) return j;
  } catch (_) { /* absent/corrompu */ }
  return null;
}

function ecrirePids(admin, portail, pont) {
  ensureLogs();
  let deja = {};
  try { deja = JSON.parse(fs.readFileSync(PID_FILE, "utf8")) || {}; } catch (_) { /* absent */ }
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify(
      Object.assign({}, deja, {
        admin: admin !== undefined ? admin : deja.admin || null,
        portail: portail !== undefined ? portail : deja.portail || null,
        pont: pont !== undefined ? pont : deja.pont || null,
        startedAt: new Date().toISOString(),
      }),
      null,
      2
    )
  );
}

function supprimerPids() {
  try { fs.unlinkSync(PID_FILE); } catch (_) { /* absent */ }
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

// ------------------------------------------------------------
// PONT D'APERCU (v0.2.109) : 3000 -> administration 4000
// ------------------------------------------------------------
/** Garantit que le pont d'aperçu tourne (IDEMPOTENT, jamais bloquant).
 *  Retourne le PID du pont démarré, true s'il répondait déjà, sinon null. */
async function assurerPont() {
  if (!PONT_ACTIF) return null;
  try {
    if (await httpRepond(PORT_PONT, 1000)) return true; // deja en place
  } catch (_) { /* reponse = true de toute facon dans httpRepond */ }
  const outPont = fs.openSync(LOG_PONT, "a");
  const enfantPont = spawn(
    process.execPath,
    [path.join(ROOT, "scripts", "pont-preview-3000.js")],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        AUTO_RH_PORT_PONT: PORT_PONT,
        AUTO_RH_PORT_ADMIN: PORT_ADMIN,
      }),
      detached: true,
      stdio: ["ignore", outPont, outPont],
      windowsHide: true,
    }
  );
  enfantPont.unref();
  const ok = await attendreHttp(PORT_PONT, 10000);
  return ok ? enfantPont.pid : null;
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
      `Les serveurs tournent DEJA : Administration http://localhost:${PORT_ADMIN} - Portail http://localhost:${PORT_PORTAIL}. RIEN n'a ete relance : un changement recent du fichier .env (code d'inscription...) n'est DONC PAS applique tant que les serveurs tournent. Pour l'appliquer : ARRETER-SILENCIEUX-WINDOWS.vbs PUIS DEMARRER-SILENCIEUX-WINDOWS.vbs.`,
      `http://localhost:${PORT_ADMIN}`
    );
    logLine(LOG_ADMIN, `[${stamp()}] (service) start demande alors que les serveurs tournent deja - rien a faire. Pour appliquer un changement de .env : ARRETER puis DEMARRER (Task 93).`);
    console.log("Deja en cours d'execution : RIEN n'a ete relance.");
    console.log("Un changement recent du .env n'est PAS applique : faites ARRETER-SILENCIEUX-WINDOWS.vbs PUIS DEMARRER-SILENCIEUX-WINDOWS.vbs.");
    // (NOUVEAU v0.2.109) Le pont d'aperçu doit pourtant être garanti MÊME
    // quand les serveurs tournent déjà : c'est lui qui rend l'aperçu de la
    // plateforme (et les téléchargements publics) accessible.
    const pontDejaLa = await assurerPont();
    if (pontDejaLa) {
      ecrirePids(undefined, undefined, typeof pontDejaLa === "number" ? pontDejaLa : undefined);
      console.log(`Pont d'apercu actif (port ${PORT_PONT} -> administration ${PORT_ADMIN}).`);
      logLine(LOG_PONT, `[${stamp()}] (service) pont verifie au demarrage : ${typeof pontDejaLa === "number" ? "relance PID " + pontDejaLa : "deja actif"}.`);
    } else {
      console.log(`ATTENTION : pont d'apercu absent sur le port ${PORT_PONT} (desactive ou port occupe par une autre application).`);
    }
    return 0;
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
        AUTO_RH_ROOT: ROOT,
        AUTO_RH_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
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
        AUTO_RH_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
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
  const okAdmin = await attendreHttp(PORT_ADMIN, 240000); // premier demarrage : db push + ressources
  const okPortail = await attendreHttp(PORT_PORTAIL, 90000);

  if (okAdmin && okPortail) {
    // (NOUVEAU v0.2.109) Pont d'aperçu : 3000 -> administration.
    let pidPont = null;
    try { pidPont = await assurerPont(); } catch (_) { /* jamais bloquant */ }
    if (pidPont) {
      ecrirePids(undefined, undefined, typeof pidPont === "number" ? pidPont : null);
      console.log(`Pont d'apercu actif : port ${PORT_PONT} -> administration ${PORT_ADMIN}${typeof pidPont === "number" ? " (PID " + pidPont + ")" : ""}.`);
    } else {
      console.log(`ATTENTION : pont d'apercu absent sur le port ${PORT_PONT} (l'aperçu de la plateforme restera en 502).`);
    }
    ecrireEtat(
      ETAT_START, true,
      `Serveurs demarres en arriere-plan. Administration : http://localhost:${PORT_ADMIN} (login requis) - Portail : http://localhost:${PORT_PORTAIL}${pidPont ? ` - Pont d'apercu : port ${PORT_PONT} actif` : ""}. Pour arreter : ARRETER-SILENCIEUX-WINDOWS.vbs`,
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
    if (adminUp || portailUp) {
      ecrireEtat(
        ETAT_STOP, false,
        "Des serveurs repondent mais n'ont PAS ete lances par le mode silencieux (aucun PID enregistre). Fermez les fenetres CMD visibles (Ctrl+C) puis reessayez, ou redemarrez le poste."
      );
      console.error("Serveurs actifs mais non lances par le mode silencieux.");
      return 1;
    }
    ecrireEtat(ETAT_STOP, true, "Rien a arreter : les serveurs ne tournent pas.");
    console.log("Rien a arreter.");
    return 0;
  }

  const tues = [];
  for (const [nom, pid] of [["administration", pids.admin], ["portail", pids.portail], ["pont d'apercu", pids.pont]]) {
    if (pid && pidVivant(pid)) {
      tuerArbre(pid);
      tues.push(`${nom} (PID ${pid})`);
    }
  }
  supprimerPids();

  // Verifie que les ports sont bien liberés (best effort, 6 s max)
  let encoreAdmin = true, encorePortail = true;
  for (let i = 0; i < 12; i++) {
    encoreAdmin = await httpRepond(PORT_ADMIN, 400);
    encorePortail = await httpRepond(PORT_PORTAIL, 400);
    if (!encoreAdmin && !encorePortail) break;
    dormir(500);
  }

  if (encoreAdmin || encorePortail) {
    ecrireEtat(
      ETAT_STOP, false,
      `Arret partiel : ${tues.join(", ") || "aucun processus"} mais un service repond encore sur ${encoreAdmin ? PORT_ADMIN : PORT_PORTAIL}. Un autre programme utilise peut-etre ce port.`
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
  const pontUp = await httpRepond(PORT_PONT, 1000);
  const lignes = [
    "=== AutoRH - Etat des serveurs (mode arriere-plan) ===",
    `Administration : ${adminUp ? `EN FONCTIONNEMENT - http://localhost:${PORT_ADMIN} repond` : `ARRETE (port ${PORT_ADMIN} sans reponse)`}`,
    `Portail        : ${portailUp ? `EN FONCTIONNEMENT - http://localhost:${PORT_PORTAIL} repond` : `ARRETE (port ${PORT_PORTAIL} sans reponse)`}`,
    `Pont d'apercu  : ${pontUp ? `EN FONCTIONNEMENT - port ${PORT_PONT} -> administration ${PORT_ADMIN}` : PONT_ACTIF ? `ARRETE (port ${PORT_PONT} sans reponse - l'apercu de la plateforme sera en 502)` : "DESACTIVE (AUTO_RH_PONT_PREVIEW=0)"}`,
    pids
      ? `Processus enregistres : administration PID ${pids.admin}, portail PID ${pids.portail}${pids.pont ? `, pont d'apercu PID ${pids.pont}` : ""} (depuis ${pids.startedAt})`
      : "Aucun processus enregistre par le mode silencieux (demarrage visible ou absent).",
    "Journaux : dossier logs\\ (auto-rh-administration.log, auto-rh-portail.log, auto-rh-pont.log).",
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
  else {
    console.log("Usage : node scripts/auto-rh.js start|stop|restart|status|statusfile");
    code = 2;
  }
  process.exit(code);
})().catch((e) => {
  console.error("Erreur inattendue :", e && e.message);
  process.exit(1);
});
