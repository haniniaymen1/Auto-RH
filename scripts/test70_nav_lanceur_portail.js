#!/usr/bin/env node
/**
 * Task 70 — lanceur DÉTACHÉ du PORTAIL de test (régressions Task 64 : port 4101).
 * Même mécanique que test70_nav_lanceur.js (spawn detached + unref).
 * COPIE de base uniquement : DB fournie via DB_SANDBOX.
 *
 * Usage : PORT_SANDBOX=4101 DB_SANDBOX=db/test-task64.db \
 *         PID_SANDBOX=... LOG_SANDBOX=... node scripts/test70_nav_lanceur_portail.js start|stop
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.env.PORT_SANDBOX || "4101", 10);
const DB_REL = process.env.DB_SANDBOX || path.join("db", "test-task64.db");
const PID_FILE = process.env.PID_SANDBOX || path.join(ROOT, "sandbox-test64", "portail4101.pid");
const LOG_FILE = process.env.LOG_SANDBOX || path.join(ROOT, "sandbox-test64", "portail4101.log");

// Charge le .env racine (comme portail-server.js)
const envLigne = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
for (const ligne of envLigne.split("\n")) {
  const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.DATABASE_URL = `file:${path.join(ROOT, DB_REL)}`;
process.env.PORTAL_PORT = String(PORT);

const action = process.argv[2] || "start";

if (action === "stop") {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`Portail sandbox ${pid} arrêté.`);
  } catch {
    console.log("Aucun portail sandbox à arrêter (déjà arrêté).");
  }
  process.exit(0);
}

const enfant = spawn(process.execPath, [path.join(ROOT, "scripts", "portail-server.js")], {
  cwd: ROOT,
  env: process.env,
  detached: true,
  stdio: ["ignore", fs.openSync(LOG_FILE, "a"), fs.openSync(LOG_FILE, "a")],
});
enfant.unref();
fs.writeFileSync(PID_FILE, String(enfant.pid));
console.log(`Portail sandbox démarré (PID ${enfant.pid}, port ${PORT}, COPIE de base).`);
