#!/usr/bin/env node
"use strict";
/* ============================================================
 * Test dedie v0.2.207 — « Could not find a production build in
 * the './.next' directory » (incident utilisateur Windows, port 2000).
 *
 * EXÉCUTION RÉELLE du cas utilisateur : build INCOMPLET (server.js présent,
 * BUILD_ID absent — construction interrompue) → start-prod.js doit le
 * DETECTER (verifier-build-a-jour.js durci) puis le RECONSTRUIRE
 * automatiquement (next local, 2 a 4 min) puis DEMARRER et REPONDRE.
 * Plus : verification unitaire du verdict (5 états), garde .bat durcie
 * (CRLF, verifier avant start-prod, next LOCAL jamais npx), lanceur Linux
 * déjà branché sur le vérificateur, moteur attend 420 s.
 * ============================================================ */
const fs = require("fs"), path = require("path");
const { spawnSync, spawn } = require("child_process");

const BASE = "/home/z/my-project";
const VERIF = path.join(BASE, "scripts", "verifier-build-a-jour.js");
const START = path.join(BASE, "scripts", "start-prod.js");
const BAT = path.join(BASE, "DEMARRER-WINDOWS.bat");
const LNX = path.join(BASE, "DEMARRER-LINUX-MAC.sh");
const MOTEUR = path.join(BASE, "scripts", "service-paiesage.js");
const STANDALONE = path.join(BASE, ".next", "standalone");
const ID_RACINE = path.join(BASE, ".next", "BUILD_ID");
const ID_INTERNE = path.join(STANDALONE, ".next", "BUILD_ID");
const MARQUE = path.join(STANDALONE, ".service-rh-version");
const PORT = 4020;

let nb = 0, fails = 0;
function ctrl(cond, msg) {
  nb++;
  console.log("  [%s] %s", cond ? "OK" : "FAIL", msg);
  if (!cond) fails++;
}
const sauve = { id: null, marque: null };
function probe(port, ms) {
  return new Promise((res) => {
    const h = require("http");
    const to = setTimeout(() => { q.destroy(new Error("timeout")); }, ms || 2500);
    const q = h.get({ host: "127.0.0.1", port, path: "/", timeout: ms || 2500 },
      (r) => { clearTimeout(to); r.resume(); res(true); });
    q.on("error", () => { clearTimeout(to); res(false); });
  });
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("=== TEST DEDIE v0.2.207 (build incomplet -> reconstruction automatique) ===");

  /* 0) precondition : build complet present (construit avant le test) */
  ctrl(fs.existsSync(ID_RACINE) && fs.existsSync(ID_INTERNE),
       "precondition : build complet present (BUILD_ID racine + standalone)");

  /* 1) verdicts unitaires du vérificateur durci */
  const ver = () => spawnSync("node", [VERIF], { cwd: BASE, encoding: "utf8" });
  let v = ver();
  ctrl(v.status === 0 && /VERDICT=A_JOUR/.test(v.stdout), "verificateur : build complet -> A_JOUR (exit 0)");
  const idInterneSauve = fs.readFileSync(ID_INTERNE), marqueSauve = fs.readFileSync(MARQUE);
  fs.unlinkSync(ID_INTERNE);
  v = ver();
  ctrl(v.status === 1 && /VERDICT=BUILD_INCOMPLET/.test(v.stdout),
       "verificateur : BUILD_ID standalone absent -> BUILD_INCOMPLET (exit 1) — LE CAS UTILISATEUR");
  fs.writeFileSync(ID_INTERNE, idInterneSauve);
  fs.unlinkSync(MARQUE);
  v = ver();
  ctrl(v.status === 1 && /VERDICT=BUILD_PERIME/.test(v.stdout),
       "verificateur : marque absente -> BUILD_PERIME (exit 1)");
  fs.writeFileSync(MARQUE, "0.0.0-FAUX");
  v = ver();
  ctrl(v.status === 1 && /BUILD_PERIME/.test(v.stdout),
       "verificateur : marque != package -> BUILD_PERIME (exit 1)");
  fs.writeFileSync(MARQUE, marqueSauve);

  /* 2) LE CAS UTILISATEUR REEL : build incomplet -> reconstruction auto */
  fs.unlinkSync(ID_INTERNE);                       // construction interrompue
  const srv = spawn("node", [START], {
    cwd: BASE, env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let journal = "";
  srv.stdout.on("data", (d) => { journal += d; });
  srv.stderr.on("data", (d) => { journal += d; });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 480000) {               // 8 min : build 2-4 min + demarrage
    if (await probe(PORT, 2000)) { up = true; break; }
    await pause(4000);
    if (srv.exitCode !== null) break;              // plante avant de repondre
  }
  ctrl(/Verification du build de production/.test(journal) &&
       /BUILD_INCOMPLET/.test(journal),
       "start-prod : DETECTE le build incomplet (verdict visible)");
  ctrl(/Construction du site necessaire/.test(journal),
       "start-prod : CONSTRUCTION AUTOMATIQUE declenchee (2 a 4 min)");
  ctrl(fs.existsSync(ID_INTERNE) && fs.existsSync(MARQUE),
       "apres reconstruction : BUILD_ID + marque RECREES (build complet)");
  ctrl(up, "LE SITE REPOND sur le port " + PORT + " (" +
       Math.round((Date.now() - t0) / 1000) + " s) — l'incident utilisateur est gueri");
  srv.kill("SIGTERM");                              // arret propre (journalise)
  await pause(1500);

  /* 3) re-verification rapide : build complet -> demarrage direct */
  const t1 = Date.now();
  const srv2 = spawn("node", [START], {
    cwd: BASE, env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let j2 = "";
  srv2.stdout.on("data", (d) => { j2 += d; });
  let up2 = false;
  while (Date.now() - t1 < 60000) {
    if (await probe(PORT, 2000)) { up2 = true; break; }
    await pause(1500);
    if (srv2.exitCode !== null) break;
  }
  ctrl(!/Construction du site necessaire/.test(j2),
       "demarrage suivant : AUCUNE reconstruction (build reconnu a jour)");
  ctrl(up2, "demarrage direct : le site repond en " +
       Math.round((Date.now() - t1) / 1000) + " s");
  srv2.kill("SIGTERM");
  await pause(1500);

  /* 4) garde .bat durcie (contenu + CRLF) */
  const bat = fs.readFileSync(BAT, "utf8");
  ctrl(/node scripts\\verifier-build-a-jour\.js\r\nif errorlevel 1 \(/.test(bat),
       "DEMARRER-WINDOWS.bat : garde sur le VERIFICATEUR (et plus server.js seul)");
  ctrl(bat.includes("call node node_modules\\next\\dist\\bin\\next build") &&
       !bat.includes("npx next build"),
       "DEMARRER-WINDOWS.bat : build avec le next LOCAL (jamais npx)");
  ctrl(/\r\n/.test(bat) && !/[^\r]\n/.test(bat),
       "DEMARRER-WINDOWS.bat : CRLF integre");
  const iVerif = bat.indexOf("verifier-build-a-jour.js");
  const iStart = bat.indexOf("start-prod");
  ctrl(0 < iVerif && iVerif < iStart,
       "DEMARRER-WINDOWS.bat : verification AVANT le lancement du serveur");

  /* 5) Linux et moteur deja relies au vérificateur durci */
  const lnx = fs.readFileSync(LNX, "utf8");
  ctrl(lnx.includes("! node scripts/verifier-build-a-jour.js") &&
       lnx.includes("node node_modules/next/dist/bin/next build"),
       "DEMARRER-LINUX-MAC.sh : meme verifier + build local (Linux corrige par (1))");
  const mot = fs.readFileSync(MOTEUR, "utf8");
  ctrl(mot.includes("attendreHttp(PORT_ADMIN, 420000)"),
       "moteur silencieux : attente administration 420 s (temps de reconstruction)");

  console.log("\n=== TOTAL : %d controles, %d echec(s) ===", nb, fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("Erreur inattendue :", e && e.stack || e); process.exit(1); });
