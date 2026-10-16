/**
 * (NOUVEAU v0.2.141) Relance DÉTACHÉE des deux services (méthode identique à
 * scripts/auto-rh.js : spawn detached + unref puis sortie immédiate
 * du parent — les enfants sont re-parentés et survivent à la session).
 *
 *   node scripts/redemarrer-services-4000-4001.js
 *
 * - Administration : scripts/start-prod.js (port 4000)
 * - Portail        : scripts/portail-server.js (port 4001)
 * PID écrits dans logs/auto-rh-processus.json.
 *
 * (CORRIGÉ v0.2.147) ARRÊT FIABLE : Next.js RENOMME son processus
 * (« next-server (v15.x) ») — les motifs ps ne le reconnaissaient pas,
 * l'ancien serveur restait à l'écoute du port 4000 et le nouveau spawn
 * mourait en EADDRINUSE : les mises à jour n'étaient PAS servies. Désormais :
 *   1. motifs ps (standalone/server.js, start-prod.js, portail-server.js,
 *      next-server) ;
 *   2. kill PAR PORT (ss -tlnp → pid à l'écoute de 4000/4001) ;
 *   3. attente + vérification que les ports sont LIBRES (SIGKILL sinon) ;
 *   4. spawn seulement quand les ports sont libres (sinon erreur explicite).
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const ROOT = path.join(__dirname, "..");
const LOG_ADMIN = path.join(ROOT, "logs", "admin-4000.log");
const LOG_PORTAIL = path.join(ROOT, "logs", "portail-4001.log");
const PORT_ADMIN = 4000;
const PORT_PORTAIL = 4001;

/**
 * (NOUVEAU v0.2.167) RECONSTRUCTION AUTOMATIQUE DE L'ADMINISTRATION.
 *
 * Problème corrigé : l'administration est un build Next.js COMPILÉ ; les mises
 * à jour livrées (ZIP) remplacent le code source (src/) mais JAMAIS le build
 * (.next/standalone) — l'interface continuait donc de tourner sur l'ANCIENNE
 * version (ex. messages d'erreur « Erreur serveur. » sans détail, correctifs
 * de configuration SMTP/IMAP absents malgré la mise à jour).
 *
 * Le contrôle réutilise le VÉRIFICATEUR UNIQUE existant (identique au lanceur
 * Linux) : scripts/verifier-build-a-jour.js — exit 0 = à jour, exit 1 = à
 * construire. Il compare le marqueur .next/standalone/.auto-rh-version
 * (écrit par copy-standalone-assets.js après CHAQUE build) à package.json.
 * ⚠ Le numéro package.json.version doit donc être bumpé à CHAQUE livraison
 * (désormais fait en même temps que le fichier VERSION).
 */
// (NOUVEAU 0.2.168) Contrôle d'intégrité de l'extraction AVANT tout build :
// un ZIP mal extrait/mal reconstitué perd des fichiers (souvent src/) et le
// build échouait avec « Couldn't find any pages or app directory » sans
// explication. Manifeste : MANIFEST-LIVRAISON.txt à la racine du ZIP.
function extractionComplete() {
  const { execFileSync } = require("child_process");
  const manifeste = path.join(ROOT, "MANIFEST-LIVRAISON.txt");
  if (!fs.existsSync(manifeste) || !fs.existsSync(path.join(ROOT, "scripts", "verifier-extraction.js"))) {
    return true; // ZIP antérieur à 0.2.168 : contrôle indisponible, non bloquant
  }
  try {
    execFileSync(process.execPath, [path.join(__dirname, "verifier-extraction.js"), "--complet"], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 60000,
    });
    return true;
  } catch {
    return false;
  }
}

function buildNecessaire() {
  const { execFileSync } = require("child_process");
  try {
    execFileSync(process.execPath, [path.join(__dirname, "verifier-build-a-jour.js")], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 30000,
    });
    return false; // exit 0 = build à jour
  } catch {
    return true; // exit 1 (ou incident) = (re)construire — choix sûr
  }
}
function construireAdmin() {
  const { execSync } = require("child_process");
  const envs = Object.assign({}, process.env, {
    PORT: String(PORT_ADMIN),
    HOSTNAME: "0.0.0.0",
    AUTO_RH_ROOT: ROOT,
    AUTO_RH_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
  });
  if (!extractionComplete()) {
    throw new Error(
      "Extraction incomplete : des fichiers du ZIP sont absents ou corrompus. " +
        "Re-extrayez TOUT le contenu du ZIP dans le dossier du projet puis relancez."
    );
  }
  console.log("[BUILD] Administration à reconstruire (nouvelle version) — construction en cours (2 à 4 minutes)…");
  execSync("npx next build", { cwd: ROOT, stdio: "inherit", env: envs, timeout: 900000 });
  execSync("node scripts/copy-standalone-assets.js", { cwd: ROOT, stdio: "inherit", env: envs, timeout: 300000 });
  console.log("[BUILD] Administration reconstruite à la version du package.");
}

// 1) arrêt par MOTIFS ps (inclut « next-server » : nom de processus Next.js)
function tuerMotifs(motifs) {
  try {
    const out = execSync("ps -eo pid,args", { encoding: "utf8" });
    for (const ligne of out.split("\n")) {
      if (motifs.some((m) => ligne.includes(m)) && !ligne.includes("redemarrer-services")) {
        const pid = parseInt(ligne.trim().split(/\s+/)[0], 10);
        if (pid && pid !== process.pid) {
          try { process.kill(pid, "SIGTERM"); } catch { /* déjà mort */ }
        }
      }
    }
  } catch { /* ps indisponible */ }
}

// 2) arrêt PAR PORT : le processus à l'écoute (quelle que soit sa bannière)
function tuerPorts(ports, signal) {
  for (const port of ports) {
    try {
      const out = execSync(
        `ss -tlnp 2>/dev/null | grep -E ":${port}[[:space:]]" || true`,
        { encoding: "utf8", shell: "/bin/bash" }
      );
      for (const ligne of out.split("\n")) {
        const m = ligne.match(/pid=(\d+)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (pid && pid !== process.pid) {
            try { process.kill(pid, signal || "SIGTERM"); } catch { /* déjà mort */ }
          }
        }
      }
    } catch { /* ss absent ou rien à l'écoute */ }
  }
}

// 3) vérification : un port est-il encore à l'écoute ?
function portOccupe(port) {
  return new Promise((resoudre) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    sock.on("connect", () => { sock.destroy(); resoudre(true); });
    sock.on("error", () => resoudre(false));
    setTimeout(() => { try { sock.destroy(); } catch { /* */ } resoudre(false); }, 700);
  });
}

async function attendrePortsLibres(ports, essais) {
  for (let i = 0; i < (essais || 20); i++) {
    const occupees = [];
    for (const p of ports) if (await portOccupe(p)) occupees.push(p);
    if (!occupees.length) return true;
    if (i === 4) tuerPorts(occupees, "SIGKILL"); // insensible à SIGTERM → SIGKILL
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  tuerMotifs(["standalone/server.js", "portail-server.js", "start-prod.js", "next-server"]);
  tuerPorts([PORT_ADMIN, PORT_PORTAIL], "SIGTERM");
  const libres = await attendrePortsLibres([PORT_ADMIN, PORT_PORTAIL], 20);
  if (!libres) {
    const msg = "ARRÊT IMPOSSIBLE : le port " + PORT_ADMIN + " et/ou " + PORT_PORTAIL +
      " reste occupé par un processus externe. Fermez-le puis relancez.";
    console.error("[ERREUR] " + msg);
    fs.appendFileSync(LOG_ADMIN, "\n[REDEMARRER] " + msg + "\n");
    process.exit(1);
  }

  // 3b) (v0.2.167) reconstruction automatique de l'administration si VERSION
  //     a changé depuis le dernier build (mises à jour livrées en ZIP).
  if (buildNecessaire()) {
    const outB = fs.openSync(LOG_ADMIN, "a");
    const sortieConsole = console.log;
    const sortieErreur = console.error;
    console.log = (...a) => { try { fs.writeSync(outB, a.join(" ") + "\n"); } catch { /* */ } sortieConsole(...a); };
    console.error = (...a) => { try { fs.writeSync(outB, a.join(" ") + "\n"); } catch { /* */ } sortieErreur(...a); };
    try {
      construireAdmin();
    } catch (e) {
      sortieErreur("[BUILD] ÉCHEC de la construction : " + (e && e.message ? e.message : e));
      sortieErreur("[BUILD] Le site redémarre avec le build EXISTANT (ancienne version).");
      sortieErreur("[BUILD] Vérifiez la connexion Internet (npm) puis relancez : le build sera retenté.");
    } finally {
      console.log = sortieConsole;
      console.error = sortieErreur;
      try { fs.closeSync(outB); } catch { /* */ }
    }
  }

  // 4) administration (4000)
  const outA = fs.openSync(LOG_ADMIN, "a");
  const admin = spawn(process.execPath, [path.join(ROOT, "scripts", "start-prod.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT_ADMIN),
      HOSTNAME: "0.0.0.0",
      AUTO_RH_ROOT: ROOT,
      AUTO_RH_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
    }),
    detached: true,
    stdio: ["ignore", outA, outA],
  });
  admin.unref();

  // 5) portail employés (4001)
  const outP = fs.openSync(LOG_PORTAIL, "a");
  const portail = spawn(process.execPath, [path.join(ROOT, "scripts", "portail-server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORTAL_PORT: String(PORT_PORTAIL),
      HOSTNAME: "0.0.0.0",
      AUTO_RH_STORAGE_DIR: path.join(ROOT, "storage", "payslips"),
      // (v0.2.161) intervalle du poller IMAP fixé à 15 s (le minimum permis
      // par portail-server.js — demarrerReceptionEmails) ; le .env racine
      // porte la même valeur (portail-server.js charge .env sans écraser
      // l'existant : cette variable d'environnement reste prioritaire).
      AUTO_RH_IMAP_INTERVALLE: "15",
    }),
    detached: true,
    stdio: ["ignore", outP, outP],
  });
  portail.unref();

  fs.writeFileSync(
    path.join(ROOT, "logs", "auto-rh-processus.json"),
    JSON.stringify({ admin: admin.pid, portail: portail.pid, startedAt: new Date().toISOString() }, null, 2)
  );
  console.log(`Administration PID ${admin.pid} (port ${PORT_ADMIN}), Portail PID ${portail.pid} (port ${PORT_PORTAIL}). Parent sort — enfants détachés.`);
  process.exit(0);
})().catch((e) => {
  console.error("[ERREUR]", e && e.message ? e.message : e);
  process.exit(1);
});
