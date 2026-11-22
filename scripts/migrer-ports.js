#!/usr/bin/env node
/**
 * ============================================================
 *  AUTO RH (PaieSage) - MIGRATION DES PORTS (v0.2.212)
 * ============================================================
 *  DEMANDE UTILISATEUR : « j'ai changé le port, encore ne
 *  fonctionne pas ». Cause identifiée : après une modification
 *  de PORT / PORTAL_PORT dans le fichier .env, les lanceurs
 *  « TOUT » démarraient les serveurs sur les NOUVEAUX ports
 *  mais laissaient tourner les ANCIENNES instances (orphelines)
 *  sur les anciens ports : deux administrations, deux portails,
 *  anciens liens encore vivants, état incohérent.
 *
 *  Ce script est appelé PAR LES LANCEURS AVANT LE DÉMARRAGE :
 *    node scripts/migrer-ports.js
 *
 *  Principe :
 *    - lit les ports ACTUELS du .env (PORT, PORTAL_PORT) ;
 *    - lit les PIDs enregistrés au démarrage précédent
 *      (logs/paiesage-processus.json, même fichier que le moteur) ;
 *    - pour chaque PID encore vivant, trouve le port sur lequel
 *      il écoute réellement ; si ce port n'est PLUS celui du
 *      .env, l'instance appartient à l'ANCIENNE configuration :
 *      elle est ARRÊTÉE (arbre complet, parent + enfant) ;
 *    - une instance qui écoute déjà sur le port du .env actuel
 *      est CONSERVÉE (le lanceur décide ensuite : GARDE/LANCE).
 *
 *  Toujours exit 0 : ne bloque JAMAIS un démarrage.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PID_FILE = path.join(ROOT, "logs", "paiesage-processus.json");
const IS_WIN = process.platform === "win32";

/* ---------- Lecture tolérante du .env (espaces, guillemets) ---------- */
function lireEnv(cle, defaut) {
  try {
    const texte = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = texte.match(
      new RegExp("^\\s*" + cle + "\\s*=\\s*\"?'?([^\"'\\r\\n]*)\"?'?\\s*$", "m")
    );
    if (m) {
      const v = String(m[1]).trim().replace(/^["']|["']$/g, "").trim();
      if (/^\d{1,5}$/.test(v)) return v;
    }
  } catch { /* pas de .env : defaut */ }
  return defaut;
}

const PORT_ADMIN = lireEnv("PORT", "4000");
const PORT_PORTAIL = lireEnv("PORTAL_PORT", "4001");

/* -------------------------- Utilitaires PID -------------------------- */
function pidVivant(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/* Port réellement écouté par un PID (ou null). */
function portEcoute(pid) {
  try {
    if (IS_WIN) {
      const out = execSync("netstat -ano -p TCP", { encoding: "utf8", timeout: 10000 });
      for (const ligne of out.split(/\r?\n/)) {
        const m = ligne.match(/^\s*TCP\s+\S+[:.](\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && Number(m[2]) === Number(pid)) return m[1];
      }
      return null;
    }
    // Linux / macOS : lsof d'abord, ss en repli
    try {
      const out = execSync(
        `lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid} 2>/dev/null`,
        { encoding: "utf8", timeout: 10000, shell: "/bin/sh" }
      );
      for (const ligne of out.split(/\r?\n/)) {
        const m = ligne.match(/[:.](\d+)\s+\((LISTEN)/);
        if (m) return m[1];
      }
      return null;
    } catch {
      const out = execSync("ss -tlnp 2>/dev/null", { encoding: "utf8", timeout: 10000, shell: "/bin/sh" });
      for (const ligne of out.split(/\r?\n/)) {
        if (!ligne.includes(`pid=${pid}`)) continue;
        const m = ligne.match(/[:.](\d+)\s+/);
        if (m) return m[1];
      }
      return null;
    }
  } catch { return null; }
}

/* Arrêt de l'ARBRE complet : l'enfant (next-server / portail) tient le
 * port, le parent (start-prod.js) est enregistré — les deux meurent. */
function arreterArbre(pid) {
  if (IS_WIN) {
    try { execSync(`taskkill /PID ${pid} /T /F`, { timeout: 15000 }); } catch { /* déjà mort */ }
    return;
  }
  // Enfants du parent (start-prod.js / portail-server.js) : pgrep -P
  let enfants = [];
  try {
    enfants = execSync(`pgrep -P ${pid} 2>/dev/null || true`, { encoding: "utf8", timeout: 10000, shell: "/bin/sh" })
      .split(/\r?\n/).map(Number).filter(Boolean);
  } catch { /* aucun */ }
  try { process.kill(pid, "SIGTERM"); } catch { /* déjà mort */ }
  for (const e of enfants) { try { process.kill(e, "SIGTERM"); } catch { /* déjà mort */ } }
}

/* ------------------------------- Main -------------------------------- */
async function main() {
  let pids = null;
  try {
    pids = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    console.log("[Migration ports] Aucun demarrage precedant enregistre : rien a migrer.");
    return 0;
  }

  const candidats = [];
  if (pids.admin && pidVivant(Number(pids.admin))) candidats.push(["administration", Number(pids.admin)]);
  if (pids.portail && pidVivant(Number(pids.portail)) && Number(pids.portail) !== Number(pids.admin))
    candidats.push(["portail", Number(pids.portail)]);

  if (!candidats.length) {
    console.log("[Migration ports] Aucune instance precedente vivante : rien a migrer.");
    return 0;
  }

  let migrees = 0;
  for (const [nom, pid] of candidats) {
    const port = portEcoute(pid);
    if (!port) {
      console.log(`[Migration ports] ${nom} : PID ${pid} vivant mais n'ecoute sur aucun port TCP — ignore.`);
      continue;
    }
    if (port === PORT_ADMIN || port === PORT_PORTAIL) {
      console.log(`[Migration ports] ${nom} : deja sur le port actuel ${port} (PID ${pid}) — conservee.`);
      continue;
    }
    console.log(`[Migration ports] ${nom} : ancienne configuration detectee — port ${port} (PID ${pid}) alors que le .env indique desormais ${PORT_ADMIN} / ${PORT_PORTAIL}.`);
    arreterArbre(pid);
    // L'enfant qui tient le port peut avoir un PID different du parent :
    // on verifie et on arrete aussi le port lui-meme.
    dormir(1200);
    if (portEcoute(pid) === port) {
      const tenu = pidSurPort(port);
      if (tenu) { try { process.kill(Number(tenu), "SIGKILL"); } catch { /* déjà mort */ } }
    }
    console.log(`[Migration ports] ${nom} : ancienne instance arretee (port ${port} libere).`);
    migrees++;
  }

  if (migrees) {
    console.log(`[Migration ports] ${migrees} ancienne(s) instance(s) arretee(s) — les serveurs demarreront sur les ports du .env : ${PORT_ADMIN} / ${PORT_PORTAIL}.`);
    // PIDs obsolètes : le fichier ne decrit plus la réalité.
    try { fs.unlinkSync(PID_FILE); } catch { /* déjà absent */ }
  }
  return 0;
}

function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

function pidSurPort(port) {
  try {
    if (IS_WIN) {
      const out = execSync("netstat -ano -p TCP", { encoding: "utf8", timeout: 10000 });
      for (const ligne of out.split(/\r?\n/)) {
        const m = ligne.match(/^\s*TCP\s+\S+[:.](\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && m[1] === String(port)) return m[2];
      }
      return null;
    }
    const out = execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf8", timeout: 10000, shell: "/bin/sh" });
    return (out.split(/\r?\n/)[0] || "").trim() || null;
  } catch { return null; }
}

(async () => {
  await main();
  process.exit(0);
})().catch((e) => { console.error("[ERREUR] migrer-ports : " + (e && e.message ? e.message : e)); process.exit(1); });
