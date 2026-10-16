#!/usr/bin/env node
/**
 * Task 70 — lanceur DÉTACHÉ du serveur admin de test (preuve navigateur).
 * Comme auto-rh.js : spawn detached + unref -> le serveur survit
 * à la fin du shell qui l'a lancé. COPIE de base uniquement (sandbox).
 *
 * Usage : node scripts/test70_nav_lanceur.js start|stop
 * (Variables PORT_SANDBOX et DB_SANDBOX optionnelles pour les régressions :
 *  la valeur par défaut reste le bac à sable Task 70, port 4202.)
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.env.PORT_SANDBOX || "4202", 10);
const DB_REL = process.env.DB_SANDBOX || path.join("sandbox-test70nav", "test70nav.db");
const PID_FILE = process.env.PID_SANDBOX || path.join(ROOT, "sandbox-test70nav", "serveur.pid");
const LOG_FILE = process.env.LOG_SANDBOX || path.join(ROOT, "sandbox-test70nav", "serveur.log");

// Charge le .env racine (comme start-prod.js)
const envLigne = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
for (const ligne of envLigne.split("\n")) {
  const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.DATABASE_URL = `file:${path.join(ROOT, DB_REL)}`;
process.env.PORT = String(PORT);
process.env.HOSTNAME = "127.0.0.1";

const action = process.argv[2] || "start";

if (action === "stop") {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`Serveur sandbox ${pid} arrêté.`);
  } catch {
    console.log("Aucun serveur sandbox à arrêter (déjà arrêté).");
  }
  process.exit(0);
}

// start : spawn détaché du serveur standalone (build production réel)
const enfant = spawn(process.execPath, [path.join(ROOT, ".next", "standalone", "server.js")], {
  cwd: path.join(ROOT, ".next", "standalone"),
  env: process.env,
  detached: true,
  stdio: ["ignore", fs.openSync(LOG_FILE, "a"),
          fs.openSync(LOG_FILE, "a")],
});
enfant.unref();
fs.writeFileSync(PID_FILE, String(enfant.pid));
console.log(`Serveur sandbox démarré (PID ${enfant.pid}, port ${PORT}, COPIE de base).`);
