#!/usr/bin/env node
"use strict";
/* ============================================================
 * Test dedie v0.2.206 — DIAGNOSTIC DE PORTS des lanceurs Linux
 * (« deja en cours » alors que les pages ne fonctionnent pas).
 *
 * Le bloc de diagnostic est EXTRAIT du VRAI DEMARRER-TOUT-LINUX-MAC.sh
 * et execute REELLEMENT contre de VRAIS processus node sur des ports
 * isoles :
 *   A) port libre                -> LANCE
 *   B) node, cwd = projet, 200   -> GARDE (deja en cours : correct)
 *   C) node, cwd = autre dossier -> BLOQUE (autre programme, PID, remediation)
 *   D) node, cwd = projet, muet  -> REPARE + ARRET REEL par le moteur
 *      scripts/service-paiesage.js stop (port libere, processus mort)
 *   E) node, cwd = projet, 500   -> REPARE (instance en erreur HTTP)
 * Non-regression : installateur garde, enregistrement des PIDs,
 * aucune reference a l'ancien service-rh.js, syntaxe bash des 2 lanceurs.
 * ============================================================ */
const fs = require("fs"), path = require("path");
const { spawnSync, spawn } = require("child_process");

const BASE = "/home/z/my-project";
const TOUT = path.join(BASE, "DEMARRER-TOUT-LINUX-MAC.sh");
const INSTALL = path.join(BASE, "INSTALLER-ET-DEMARRER-LINUX-MAC.sh");
const MOTEUR = path.join(BASE, "scripts", "service-paiesage.js");
const SANDBOX = path.join(BASE, "scripts", "sandbox-206");
const PROJET = path.join(SANDBOX, "projet");
const AUTRE = path.join(SANDBOX, "autre");
const PORTS = { garde: 6861, bloque: 6862, muet: 6863, erre: 6864, libre: 6865 };

let nb = 0, fails = 0;
function ctrl(cond, msg) {
  nb++;
  console.log("  [%s] %s", cond ? "OK" : "FAIL", msg);
  if (!cond) fails++;
}

function decider(port, projectDir) {
  const r = spawnSync("bash", ["-c",
    `set -u; source "${SANDBOX}/diag.sh"; PROJECT_DIR="${projectDir}"; ` +
    `decider_port "${port}" "Interface de test"; echo "DECISION=\${DECISION}"`],
    { encoding: "utf8" });
  const out = r.stdout || "";
  const dec = (out.match(/DECISION=(\w+)/) || [])[1] || "?";
  return { dec, out };
}

function serveur(port, cwd, mode) {
  const code = {
    ok: `require("http").createServer((q,s)=>{s.end("ok")}).listen(${port},"0.0.0.0")`,
    muet: `require("http").createServer(()=>{}).listen(${port},"0.0.0.0")`,
    erre: `require("http").createServer((q,s)=>{s.statusCode=500;s.end("err")}).listen(${port},"0.0.0.0")`,
  }[mode];
  return spawn("node", ["-e", code], { cwd, stdio: "ignore" });
}

function mort(pid) {
  try { process.kill(pid, 0); return false; } catch (e) { return true; }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* tue les RELIQUATS node d'un run precedent sur nos ports isoles
   (cwd supprime -> processus etranger -> fausses decisions BLOQUE) */
function nettoyerPorts() {
  const r = spawnSync("bash", ["-c",
    "for p in " + Object.values(PORTS).join(" ") + "; do" +
    " ss -ltnp 2>/dev/null | grep -E \"[:.]$p[[:space:]]\" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u |" +
    " while read pid; do" +
    " [ -r /proc/$pid/exe ] && case $(readlink /proc/$pid/exe) in *node*) kill -9 $pid 2>/dev/null;; esac;" +
    " done; done"]);
  return r.status === 0;
}

(async () => {
  console.log("=== TEST DEDIE v0.2.206 (diagnostic de ports des lanceurs Linux) ===");

  /* 0) environnement : extraction du bloc reel + bac a sable */
  nettoyerPorts();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(PROJET, { recursive: true });
  fs.mkdirSync(AUTRE, { recursive: true });
  fs.mkdirSync(path.join(PROJET, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(PROJET, ".env"),
    `PORT=${PORTS.muet}\nPORTAL_PORT=${PORTS.bloque}\nDATABASE_URL=file:${PROJET}/db/custom.db\n`);
  fs.copyFileSync(MOTEUR, path.join(PROJET, "scripts", "service-paiesage.js"));
  const ex = spawnSync("sed", ["-n",
    "/DEBUT BLOC DIAGNOSTIC PORTS/,/FIN BLOC DIAGNOSTIC PORTS/p", TOUT]);
  const bloc = ex.stdout.toString();
  ctrl(bloc.includes("decider_port()") && bloc.includes("est_notre_app()") &&
       bloc.includes("pid_ecoute()") && bloc.includes("port_repond()"),
       "bloc de diagnostic extrait du vrai lanceur (4 fonctions)");
  fs.writeFileSync(path.join(SANDBOX, "diag.sh"), bloc);

  /* syntaxe bash */
  ctrl(spawnSync("bash", ["-n", TOUT]).status === 0, "bash -n DEMARRER-TOUT-LINUX-MAC.sh");
  ctrl(spawnSync("bash", ["-n", INSTALL]).status === 0, "bash -n INSTALLER-ET-DEMARRER-LINUX-MAC.sh");

  /* A) port libre -> LANCE */
  let r = decider(PORTS.libre, PROJET);
  ctrl(r.dec === "LANCE", "A) port libre -> decision LANCE (recu : " + r.dec + ")");

  /* B) notre application qui repond -> GARDE */
  let s = serveur(PORTS.garde, PROJET, "ok");
  await pause(800);
  r = decider(PORTS.garde, PROJET);
  ctrl(r.dec === "GARDE", "B) instance a nous qui repond (HTTP 200) -> GARDE (recu : " + r.dec + ")");
  ctrl(/deja en cours \(port \d+\) : NON relancee\./.test(r.out), "B) message « deja en cours : NON relancee »");
  s.kill("SIGKILL"); await pause(300);

  /* C) programme etranger sur le port -> BLOQUE + remediation */
  s = serveur(PORTS.bloque, AUTRE, "ok");
  await pause(800);
  r = decider(PORTS.bloque, PROJET);
  ctrl(r.dec === "BLOQUE", "C) port occupe par un AUTRE programme -> BLOQUE (recu : " + r.dec + ")");
  ctrl(/AUTRE programme \(PID \d+/.test(r.out) && /kill \d+/.test(r.out) &&
       /\.env/.test(r.out), "C) message avec PID + remediation (kill <PID> ou .env)");
  s.kill("SIGKILL"); await pause(300);

  /* D) notre application MUETTE -> REPARE + arret reel par le moteur */
  s = serveur(PORTS.muet, PROJET, "muet");
  await pause(800);
  const pidMuet = s.pid;
  r = decider(PORTS.muet, PROJET);
  ctrl(r.dec === "REPARE", "D1) instance a nous MUETTE (aucune reponse HTTP) -> REPARE (recu : " + r.dec + ")");
  ctrl(new RegExp("Instance de CETTE application detectee \\(PID " + pidMuet + "\\)").test(r.out),
       "D1) message avec le PID de l'instance muette");
  /* arret precis REEL : le moteur (copie) arrete le processus par son port */
  const arret = spawnSync("node", [path.join(PROJET, "scripts", "service-paiesage.js"), "stop"],
    { cwd: PROJET, encoding: "utf8" });
  await pause(1500);
  ctrl(mort(pidMuet), "D2) ARRET REEL : le moteur a tue le processus muette (PID " + pidMuet + " mort)");
  r = decider(PORTS.muet, PROJET);
  ctrl(r.dec === "LANCE", "D3) apres arret : port libre -> LANCE (recu : " + r.dec + ")");

  /* E) notre application en erreur HTTP 5xx -> REPARE */
  s = serveur(PORTS.erre, PROJET, "erre");
  await pause(800);
  r = decider(PORTS.erre, PROJET);
  ctrl(r.dec === "REPARE" && /ERREUR HTTP \(5xx\)/.test(r.out),
       "E) instance a nous en ERREUR HTTP 5xx -> REPARE (recu : " + r.dec + ")");
  s.kill("SIGKILL"); await pause(300);

  /* F) non-regression du lanceur complet */
  const toutSrc = fs.readFileSync(TOUT, "utf8"), insSrc = fs.readFileSync(INSTALL, "utf8");
  ctrl(toutSrc.includes('decider_port "$PORT" "Administration RH/IT"') &&
       toutSrc.includes('decider_port "$PORTAL_PORT" "Portail employes"') &&
       toutSrc.includes("arret_precis_si_repare"),
       "F1) DEMARRER-TOUT : diagnostic branche sur les DEUX interfaces");
  ctrl(toutSrc.includes('if [ "$ACT_ADMIN" = "LANCE" ] || [ "$ACT_ADMIN" = "REPARE" ]') &&
       toutSrc.includes('if [ "$ACT_PORTAIL" = "LANCE" ] || [ "$ACT_PORTAIL" = "REPARE" ]'),
       "F2) lancement conditionne aux decisions LANCE/REPARE");
  ctrl(toutSrc.includes('node scripts/service-paiesage.js record "${ADMIN_PID:-0}" "${PORTAIL_PID:-0}"'),
       "F3) enregistrement des PIDs conserve (0.2.203)");
  ctrl(toutSrc.includes("ARRETER-SILENCIEUX-LINUX-MAC.sh") &&
       toutSrc.includes("Problemes courants"),
       "F4) resume : arret precis + renvoi au guide (Problemes courants)");
  ctrl(toutSrc.includes("BLOQUE") && toutSrc.includes("kill <PID>"),
       "F5) remediation BLOQUE affichee dans le resume");
  ctrl(insSrc.includes("Verification des ports avant demarrage") &&
       insSrc.includes("decider_port \"$PORT\"") && insSrc.includes("arret_precis_si_repare"),
       "F6) INSTALLER-ET-DEMARRER : meme garde avant lancement");
  ctrl(!toutSrc.includes("service-rh.js") && !insSrc.includes("service-rh.js"),
       "F7) aucune reference a l'ancien service-rh.js dans les 2 lanceurs");
  ctrl(!/(DEBUT|FIN) BLOC DIAGNOSTIC PORTS/.test(toutSrc.split("DEBUT BLOC")[0]) === false ||
       toutSrc.includes("DEBUT BLOC DIAGNOSTIC PORTS"), "F8) bloc delimite par marqueurs (test extractible)");

  /* G) coherence des ports : lignes PORT/PORTAL_PORT ecrites si absentes */
  console.log("\n-- G - bloc PORTS .ENV (extraction + execution reelle)");
  ctrl(toutSrc.includes("DEBUT BLOC PORTS .ENV") &&
       insSrc.includes("ligne PORT=3000 ajoutee"),
       "G1) lanceurs : bloc ports .env present (TOUT + INSTALLER)");
  const blocPorts = spawnSync("sed", ["-n",
    "/DEBUT BLOC PORTS .ENV/,/FIN BLOC PORTS .ENV/p", TOUT]).stdout.toString();
  ctrl(blocPorts.includes("grep -q '^PORT='") && blocPorts.includes("PORTAL_PORT"),
       "G2) bloc extrait (idempotent, grep de garde)");
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, ".env"), "DATABASE_URL=file:/x/custom.db\n");
  spawnSync("bash", ["-c",
    `set -u; unset PORT PORTAL_PORT; source /dev/stdin <<'BLOC'\n${blocPorts}\nBLOC`],
    { cwd: SANDBOX, encoding: "utf8" });
  const envApres = fs.readFileSync(path.join(SANDBOX, ".env"), "utf8");
  ctrl(/^PORT=3000$/m.test(envApres) && /^PORTAL_PORT=4001$/m.test(envApres),
       "G3) lignes PORT=3000 + PORTAL_PORT=4001 ajoutees au .env sans ces lignes");
  fs.writeFileSync(path.join(SANDBOX, ".env"),
    envApres.replace(/^PORT=3000$/m, "PORT=6860"));
  spawnSync("bash", ["-c",
    `set -u; unset PORT PORTAL_PORT; source /dev/stdin <<'BLOC'\n${blocPorts}\nBLOC`],
    { cwd: SANDBOX, encoding: "utf8" });
  const envFin = fs.readFileSync(path.join(SANDBOX, ".env"), "utf8");
  ctrl(/^PORT=6860$/m.test(envFin) && (envFin.match(/^PORT=/gm) || []).length === 1,
       "G4) valeur utilisateur PRESERVEE (PORT=6860) et aucune ligne dupliquee");

  nettoyerPorts();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log("\n=== TOTAL : %d controles, %d echec(s) ===", nb, fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("Erreur inattendue :", e && e.stack || e); nettoyerPorts(); process.exit(1); });
