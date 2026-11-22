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
 *   PORT=4000       numero de port (4000 par defaut — v0.2.209 : meme source de
 *                   verite que .env.example / verifier-ports.js / service-paiesage.js ;
 *                   les lanceurs lisent PORT du fichier .env, jamais de valeur figee)
 *   HOSTNAME=0.0.0.0  0.0.0.0 = accessible depuis les autres PC du reseau
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");

// ============================================================
//  (CORRECTIF 0.2.207) VERIFICATION DU BUILD COMPLET + CONSTRUCTION
//  AUTOMATIQUE. Ancien comportement : la simple presence de
//  .next/standalone/server.js suffisait — un build INTERROMPU (fenetre
//  fermee pendant la construction de 2 a 4 minutes) passait le controle
//  puis plantait au demarrage : « Could not find a production build in
//  the './.next' directory » (incident utilisateur Windows, port 2000).
//  Desormais : verifier-build-a-jour.js (server.js + BUILD_ID + marque de
//  version) DECIDE ; si le build manque, est perime ou est incomplet, il
//  est RECONSTRUIT ICI automatiquement avec le next LOCAL (jamais npx) —
//  donc aussi depuis le chemin silencieux (moteur service-paiesage.js)
//  qui, lui, ne verifiait RIEN avant de lancer ce script.
// ============================================================
const racineProjet = ROOT;
console.log("  Verification du build de production (verifier-build-a-jour.js)...");
const ctrlBuild = require("child_process").spawnSync(
  process.execPath,
  [path.join(__dirname, "verifier-build-a-jour.js")],
  { cwd: racineProjet, stdio: "inherit" }
);
if (ctrlBuild.status !== 0) {
  const nextLocal = path.join(racineProjet, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextLocal)) {
    console.error("");
    console.error("============================================================");
    console.error("  Build de production absent ET dependances incompletes !");
    console.error("  Lancez d'abord l'installateur (INSTALLER-ET-DEMARRER-...),");
    console.error("  ou : npm install   PUIS   relancez ce lanceur.");
    console.error("============================================================");
    console.error("");
    process.exit(1);
  }
  console.log("");
  console.log("  Construction du site necessaire (premiere fois, build interrompu");
  console.log("  ou nouvelle version) : 2 a 4 minutes, UNE SEULE FOIS.");
  console.log("  Laissez la fenetre OUVERTE pendant la construction...");
  console.log("");
  const buildProd = require("child_process").spawnSync(
    process.execPath,
    [nextLocal, "build"],
    { cwd: racineProjet, stdio: "inherit" }
  );
  if (buildProd.status !== 0) {
    console.error("");
    console.error("[ERREUR] La construction du site a echoue.");
    console.error("         Relancez ce lanceur pour reessayer (construction reprise du debut).");
    console.error("");
    process.exit(1);
  }
  try {
    require("child_process").spawnSync(
      process.execPath,
      [path.join(__dirname, "copy-standalone-assets.js")],
      { cwd: racineProjet, stdio: "inherit" }
    );
  } catch (_) { /* la copie est refaite plus bas de toute facon */ }
  console.log("  Construction terminee.");
}
if (!fs.existsSync(SERVER)) {
  console.error("");
  console.error("============================================================");
  console.error("  Build de production introuvable apres construction !");
  console.error("  Consultez les messages ci-dessus puis relancez ce lanceur.");
  console.error("============================================================");
  console.error("");
  process.exit(1);
}

// ============================================================
//  (v0.2.209) CHARGEMENT DU .ENV AVANT LES DEFAUTS — CORRECTIF.
//  L'ancien ordre posait d'abord le defaut PORT, PUIS chargeait le .env
//  « sans ecraser les variables deja presentes » : le defaut rendant PORT
//  toujours defini, une ligne PORT=XXXX du .env etait IGNOREE en demarrage
//  direct (node scripts/start-prod.js). Desormais le .env est charge
//  D'ABORD (les variables d'environnement deja posees restent prioritaires),
//  puis SEULES les variables encore manquantes recoivent un defaut :
//  PORT du .env est honore, defaut 4000 aligne sur .env.example /
//  verifier-ports.js / service-paiesage.js (une seule source de verite).
// ============================================================

// Repertoire courant = racine du projet (important pour db/ et storage/)
process.chdir(ROOT);

// Charge le .env de la racine (DATABASE_URL, AUTH_SECRET, PORT, PORTAL_PORT...)
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

// Valeurs par defaut — SEULEMENT pour ce qui reste indefini après le .env
// (surchargeable aussi par l'environnement : PORT=5100 npm run start)
process.env.NODE_ENV = "production";
if (!process.env.PORT) process.env.PORT = "4000";
if (!process.env.HOSTNAME) process.env.HOSTNAME = "0.0.0.0";

// ============================================================
//  CORRECTIF « Fichier PDF introuvable » :
//  le server.js standalone de Next.js force process.chdir(__dirname),
//  le repertoire courant du site devient .next/standalone/ et les PDF
//  importes partaient alors dans .next/standalone/storage/payslips/.
//  On fixe donc ICI la racine du projet et le dossier des PDF en
//  variables ABSOLUES, lues par le site (src/lib/storage-dir.ts).
//  Les variables deja definies par l'utilisateur restent prioritaires.
// ============================================================
if (!process.env.SERVICE_RH_ROOT) process.env.SERVICE_RH_ROOT = ROOT;
if (!process.env.SERVICE_RH_STORAGE_DIR) {
  process.env.SERVICE_RH_STORAGE_DIR = path.join(ROOT, "storage", "payslips");
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

// ============================================================
//  (NOUVEAU 0.2.203) ARRET PROPRE SUR SIGNAL.
//  Le mode silencieux (scripts/service-paiesage.js stop) envoie
//  SIGTERM pour arrêter le serveur. Sans gestionnaire, le processus
//  disparaît sans aucun journal ; ici l'arrêt est JOURNALISÉ et quitte
//  avec le code 0 — les connexions en cours sont closes par le
//  système, le port est libéré immédiatement.
// ============================================================
let arretDejaSignale = false;
function arretPropreSignal(sig) {
  if (arretDejaSignale) return;
  arretDejaSignale = true;
  console.log(`[start-prod] Signal ${sig} recu : arret du serveur, liberation du port ${process.env.PORT}...`);
  setImmediate(() => process.exit(0));
}
process.on("SIGTERM", () => arretPropreSignal("SIGTERM"));
process.on("SIGINT", () => arretPropreSignal("SIGINT"));

// Demarre le serveur standalone
require(SERVER);
