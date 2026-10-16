/**
 * Lanceur du serveur APERÇU (port 3000) — processus détaché survivant au shell.
 * Sert le lien public /api/download-scripts (passerelle → port 3000).
 * Usage : node scripts/apercu-3000.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");
const PORT = process.env.SERVICE_RH_PORT_APERCU || "3000";

if (!fs.existsSync(SERVER)) {
  console.error("Build standalone introuvable : npm run build d'abord.");
  process.exit(1);
}

const out = fs.openSync(path.join(ROOT, "logs", "apercu-3000.log"), "a");
fs.appendFileSync(out, `\r\n[${new Date().toISOString()}] ===== Demarrage apercu (port ${PORT}) =====\r\n`);

const enfant = spawn(process.execPath, [SERVER], {
  detached: true,
  stdio: ["ignore", out, out],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: PORT,
    HOSTNAME: "0.0.0.0",
    DATABASE_URL: "file:" + path.join(ROOT, "db", "custom.db"),
  },
  cwd: path.join(ROOT, ".next", "standalone"),
});
enfant.unref();
console.log(`Apercu PID ${enfant.pid} (port ${PORT}).`);
