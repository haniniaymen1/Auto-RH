#!/usr/bin/env node
/* ============================================================================
 * (NOUVEAU v0.2.209) VÉRIFICATEUR DE PORTS — lecture du .env, contrôle de
 * disponibilité AVANT lancement, identification du propriétaire, état HTTP.
 *
 * Portabilité : Linux, macOS, Windows (aucune dépendance externe obligatoire).
 *
 * Utilisation :
 *   node scripts/verifier-ports.js              → disponibilité des ports du .env
 *   node scripts/verifier-ports.js etat         → état HTTP des deux interfaces
 *   node scripts/verifier-ports.js liste        → ports configurés (aucun test)
 *   node scripts/verifier-ports.js verifier 5100 "Portail employés" PORTAL_PORT
 *                                               → UN port ciblé (lanceurs mono-interface)
 *
 * Codes de sortie de « verifier » :
 *   0 = tous les ports sont libres (ou utilisés par CETTE application :
 *       PIDs enregistrés dans logs/paiesage-processus.json) ;
 *   1 = au moins un port est occupé par un AUTRE programme (conflit) ;
 *   2 = interfaces déjà en cours (les PIDs nous appartiennent).
 *
 * Priorité des ports — IDENTIQUE au moteur scripts/service-paiesage.js :
 *   administration : PAIESAGE_PORT_ADMIN > PORT (.env) > 4000
 *   portail        : PAIESAGE_PORT_PORTAIL > PORTAL_PORT (.env) > 4001
 * ============================================================ */
"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PID_FILE = path.join(ROOT, "logs", "paiesage-processus.json");
const IS_WIN = process.platform === "win32";

/* ----------------------------- Lecture du .env ----------------------------- */
function lireEnv(cle, defaut) {
  try {
    const texte = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = texte.match(new RegExp("^\\s*" + cle + "\\s*=\\s*\"?'?([^\"'\\r\\n]*)\"?'?\\s*$", "m"));
    if (m && m[1].trim() !== "") return m[1].trim();
  } catch { /* pas de .env : défaut */ }
  return process.env[cle] !== undefined ? String(process.env[cle]) : defaut;
}

const PORT_ADMIN = String(lireEnv("PAIESAGE_PORT_ADMIN", lireEnv("PORT", "4000")));
const PORT_PORTAIL = String(lireEnv("PAIESAGE_PORT_PORTAIL", lireEnv("PORTAL_PORT", "4001")));

/* --------------------------- PIDs enregistrés ------------------------------ */
function pidsEnregistres() {
  try {
    const j = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
    return [Number(j.admin) || 0, Number(j.portail) || 0].filter((p) => p > 0);
  } catch { return []; }
}

function pidVivant(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === "EPERM"; }
}

/* ------------------- Identification du processus propriétaire --------------- */
function pidsSurPort(port) {
  try {
    if (IS_WIN) {
      const out = execSync(`netstat -ano -p TCP`, { encoding: "utf8", timeout: 10000 });
      const lignes = out.split(/\r?\n/).filter((l) => l.includes("LISTENING"));
      const pids = [];
      for (const l of lignes) {
        const cols = l.trim().split(/\s+/);
        if (cols.length >= 5 && cols[1].endsWith(":" + port)) pids.push(Number(cols[4]));
      }
      return [...new Set(pids)].filter(Number.isFinite);
    }
    // Linux / macOS : ss, sinon lsof, sinon /proc/net/tcp (Linux seul)
    try {
      const out = execSync(`ss -ltnp 2>/dev/null`, { encoding: "utf8", timeout: 10000, shell: "/bin/sh" });
      const pids = [];
      for (const m of out.matchAll(/[:.](\d+)\s+.*?pid=(\d+)/g)) {
        if (m[1] === String(port)) pids.push(Number(m[2]));
      }
      if (pids.length) return [...new Set(pids)];
    } catch { /* ss indisponible */ }
    try {
      const out = execSync(`lsof -nP -sTCP:LISTEN -iTCP:${port}`, { encoding: "utf8", timeout: 10000, shell: "/bin/sh" });
      const pids = out.split(/\r?\n/).slice(1)
        .map((l) => Number(l.trim().split(/\s+/)[1]))
        .filter(Number.isFinite);
      if (pids.length) return [...new Set(pids)];
    } catch { /* lsof indisponible */ }
    // Dernier repli Linux : /proc/net/tcp (port en hexadécimal)
    if (!IS_WIN) {
      try {
        const hexPort = Number(port).toString(16).toUpperCase().padStart(4, "0");
        for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
          try {
            const lignes = fs.readFileSync(f, "utf8").split(/\r?\n/).slice(1);
            for (const l of lignes) {
              const cols = l.trim().split(/\s+/);
              if (cols.length > 9 && cols[1] && cols[1].split(":")[1] === hexPort && cols[3] === "0A") {
                const inode = cols[9];
                const pids = [];
                for (const d of fs.readdirSync("/proc")) {
                  if (!/^\d+$/.test(d)) continue;
                  try {
                    const fdDir = `/proc/${d}/fd`;
                    for (const fd of fs.readdirSync(fdDir)) {
                      const lien = fs.readlinkSync(`${fdDir}/${fd}`);
                      if (lien === `socket:[${inode}]`) { pids.push(Number(d)); break; }
                    }
                    if (pids.includes(Number(d))) break;
                  } catch { /* processus disparu */ }
                }
                if (pids.length) return [...new Set(pids)];
              }
            }
          } catch { /* pas de tcp6 */ }
        }
      } catch { /* /proc indisponible (macOS) */ }
    }
    return [];
  } catch { return []; }
}

function commandeDuPid(pid) {
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", timeout: 10000 });
      return (out.split(/\r?\n/)[0] || "").split('","')[0].replace(/^"/, "").slice(0, 60);
    }
    try {
      return (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim() || "?").slice(0, 60);
    } catch {
      const out = execSync(`ps -p ${pid} -o command=`, { encoding: "utf8", timeout: 10000, shell: "/bin/sh" });
      return (out.trim() || "?").slice(0, 60);
    }
  } catch { return "?"; }
}

/* PID du parent (Linux : /proc/<pid>/stat, Windows : wmic) — 0 si inconnu. */
function pidParent(pid) {
  try {
    if (IS_WIN) {
      const out = execSync(`wmic process where processid=${pid} get parentprocessid /value`, { encoding: "utf8", timeout: 10000 });
      const m = out.match(/ParentProcessID=(\d+)/i);
      return m ? Number(m[1]) : 0;
    }
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // Champs 1-2 (pid, comm) peuvent contenir des espaces entre parenthèses :
    // on repart de la DERNIÈRE parenthèse fermante, puis champ 4 = ppid.
    const apres = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(apres[1]) || 0;
  } catch { return 0; }
}

/* Le PID (ou l'un de ses ancêtres) appartient-il à CETTE application ?
 * Le serveur de l'administration est un ENFANT de scripts/start-prod.js :
 * seul le parent est enregistré dans logs/paiesage-processus.json. */
function estALui(pid, enregistres) {
  const vus = new Set();
  let courant = Number(pid);
  while (courant > 0 && !vus.has(courant)) {
    vus.add(courant);
    if (enregistres.includes(courant)) return true;
    courant = pidParent(courant);
  }
  return false;
}

/* ------------------------- Test de disponibilité --------------------------- */
function portDisponible(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(Number(port), "0.0.0.0");
  });
}

/* ------------------------------ État HTTP ---------------------------------- */
function httpRepond(port, chemin) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: Number(port), path: chemin || "/", timeout: 4000 },
      (res) => { res.resume(); resolve(res.statusCode < 500 ? "OK" : "ERREUR " + res.statusCode); }
    );
    req.on("error", () => resolve("sans réponse"));
    req.on("timeout", () => { req.destroy(); resolve("sans réponse"); });
  });
}

/* --------------------------------- Main ------------------------------------ */
async function main() {
  const mode = (process.argv[2] || "verifier").toLowerCase();
  // (v0.2.209) Mode CIBLÉ : « verifier <port> [libellé] [chemin-état] » ne teste
  // qu'UN seul port — utilisé par les lanceurs mono-interface
  // (DEMARRER-LINUX-MAC.sh, DEMARRER-PORTAIL-*, DEMARRER-WINDOWS.bat…).
  const interfaces = process.argv[3] && /^\d{1,5}$/.test(process.argv[3])
    ? [[process.argv[4] || "interface", String(Number(process.argv[3])), process.argv[5] || "/", process.argv[6] || "PORT"]]
    : [
      ["administration", PORT_ADMIN, "/login", "PORT"],
      ["portail employés", PORT_PORTAIL, "/", "PORTAL_PORT"],
    ];

  if (mode === "liste") {
    for (const [nom, port] of interfaces) console.log(`${nom} : ${port}`);
    return 0;
  }

  if (mode === "etat") {
    let enCours = 0;
    for (const [nom, port, chemin] of interfaces) {
      const etat = await httpRepond(port, chemin);
      console.log(`${nom} (port ${port}) : ${etat}`);
      if (etat === "OK") enCours++;
    }
    return enCours === interfaces.length ? 0 : 1;
  }

  // ---- mode « verifier » (défaut) : disponibilité AVANT lancement ----
  const enregistres = pidsEnregistres().filter(pidVivant);
  let conflit = 0, notre = 0;
  for (const [nom, port] of interfaces) {
    if (await portDisponible(port)) {
      console.log(`[OK]      ${nom} — port ${port} LIBRE.`);
      continue;
    }
    const pids = pidsSurPort(port);
    const notres = pids.filter((p) => estALui(p, enregistres));
    if (notres.length) {
      notre++;
      console.log(`[EN COURS] ${nom} — port ${port} utilisé par CETTE application (PID ${notres.join(", ")}) : rien à relancer.`);
      continue;
    }
    conflit++;
    const qui = pids.length ? `PID ${pids.join(", ")} : ${pids.map(commandeDuPid).join(" / ")}` : "processus non identifiable";
    const variable = interfaces[0].length > 3 ? interfaces[0][3]
      : (nom.includes("portail") ? "PORTAL_PORT" : "PORT");
    console.log(`[CONFLIT] ${nom} — port ${port} occupé par un AUTRE programme (${qui}).`);
    console.log(`          RIEN ne sera tué. Remèdes : libérer le port, ou changer ${variable} dans le fichier .env puis relancer.`);
  }
  if (conflit) return 1;
  if (notre) return 2;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error("[ERREUR] verifier-ports : " + (e && e.message ? e.message : e)); process.exit(1); });
