/**
 * Lanceur de production cross-platform (Windows / macOS / Linux).
 *
 * Utilisation :  npm run start     (ou : node scripts/start-prod.js)
 *
 * - Definit les variables d'environnement manquantes (PORT, HOSTNAME).
 * - Demarre .next/standalone/server.js avec le dossier du projet comme
 *   repertoire courant, afin que :
 *     - la base SQLite  (db/custom.db)  reste au meme endroit,
 *     - les PDF importes (storage/payslips/) restent au meme endroit.
 *
 * Variables optionnelles :
 *   PORT=3000       numero de port (3000 par defaut)
 *   HOSTNAME=0.0.0.0  0.0.0.0 = accessible depuis les autres PC du reseau
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");

if (!fs.existsSync(SERVER)) {
  console.error("");
  console.error("============================================================");
  console.error("  Build de production introuvable !");
  console.error("  Lancez d'abord la commande :  npm run build");
  console.error("============================================================");
  console.error("");
  process.exit(1);
}

// Valeurs par defaut conviviales (surchargeables : PORT=4000 npm run start)
process.env.NODE_ENV = "production";
if (!process.env.PORT) process.env.PORT = "3000";
if (!process.env.HOSTNAME) process.env.HOSTNAME = "0.0.0.0";

// Repertoire courant = racine du projet (important pour db/ et storage/)
process.chdir(ROOT);

// Charge le .env de la racine (DATABASE_URL, AUTH_SECRET...)
// sans ecraser les variables deja presentes dans l'environnement.
const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// ============================================================
//  CORRECTIF « Fichier PDF introuvable » :
//  le server.js standalone de Next.js force process.chdir(__dirname),
//  le repertoire courant du site devient .next/standalone/ et les PDF
//  importes partaient alors dans .next/standalone/storage/payslips/.
//  On fixe donc ICI la racine du projet et le dossier des PDF en
//  variables ABSOLUES, lues par le site (src/lib/storage-dir.ts).
//  Les variables deja definies par l'utilisateur restent prioritaires.
// ============================================================
if (!process.env.AUTO_RH_ROOT) process.env.AUTO_RH_ROOT = ROOT;
if (!process.env.AUTO_RH_STORAGE_DIR) {
  process.env.AUTO_RH_STORAGE_DIR = path.join(ROOT, "storage", "payslips");
}

// ============================================================
//  NOUVEAU : synchronisation du schema Prisma au demarrage.
//  Ajoute les NOUVELLES colonnes (ex. sourcePage pour les PDF
//  multi-fiches) sans jamais supprimer les donnees existantes.
//  Operation idempotente et rapide si la base est deja a jour.
//  Ne change rien au comportement si la base est deja correcte.
// ============================================================
try {
  const { execSync } = require("child_process");
  console.log("  Verification du schema de la base de donnees (prisma db push)...");
  execSync("npx prisma db push --skip-generate", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    timeout: 120000,
  });
} catch (e) {
  console.log("  (schema deja a jour ou verification impossible — demarrage normal)");
}

// ============================================================
//  NOUVEAU : copie automatique des ressources standalone.
//  `next build` REGENERE .next/standalone/ et EFFACE les ressources
//  copiées manuellement (worker pdf.js, tesseract.js OCR, canvas natif,
//  langue française, .next/static, public, .env). Sans cette étape,
//  l'import de fiches échoue en production :
//    - « Setting up fake worker failed » (PDF)
//    - worker OCR bloqué (PNG / images)
//  → d'où des détections fausses ou vides après chaque rebuild.
//  Le script est idempotent : il ne rajoute que ce qui manque,
//  sans jamais supprimer ni modifier la configuration existante.
// ============================================================
try {
  const { execSync } = require("child_process");
  console.log("  Copie des ressources standalone (pdf.js, OCR, static)...");
  execSync("node scripts/copy-standalone-assets.js", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    timeout: 180000,
  });
} catch (e) {
  console.log("  (copie des ressources impossible — démarrage normal)");
}

console.log("");
console.log("============================================================");
console.log("  Fiches de Paie - Serveur de production");
console.log(`  Local  :  http://localhost:${process.env.PORT}`);
console.log(`  Reseau :  http://<adresse-ip-du-poste>:${process.env.PORT}`);
console.log("  (Ctrl+C pour arreter)");
console.log("============================================================");
console.log("");

// Demarre le serveur standalone
require(SERVER);
