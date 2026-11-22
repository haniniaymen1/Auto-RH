#!/usr/bin/env node
/**
 * v0.2.198 — PREUVE DÉDIÉE : PORTS DES DEUX INTERFACES CONFIGURABLES PAR LE .ENV
 * ==========================================================================
 * (Demande utilisateur : « comment changer les deux ports de deux interfaces ? »
 *  — intégration au ZIP complet demandée ensuite.)
 *
 * DÉSORMAIS (v0.2.198) :
 *   - PORT=XXXX (administration RH/IT) et PORTAL_PORT=XXXX (portail employés)
 *     se lisent dans le .env de la racine ;
 *   - portail-server.js ne retombe PLUS sur process.env.PORT (l'ancien repli
 *     démarrait le portail sur le port de l'administration → EADDRINUSE dès
 *     qu'on ajoutait PORT au .env) ;
 *   - les 8 lanceurs (3 .bat Windows visibles, 3 .sh Linux/macOS, 2 .vbs du
 *     kit silencieux) lisent le .env, AFFICHENT les vrais ports et ouvrent le
 *     navigateur sur le port configuré — plus aucun 3001 fantôme ni 4000
 *     obsolète ;
 *   - redemarrer-services-4000-4001.js et service-paiesage.js respectent
 *     PORT / PORTAL_PORT du .env (PAIESAGE_PORT_* prioritaires, défauts
 *     historiques 4000 / 4001 conservés).
 *
 * Le test extrait le CODE RÉEL (lanceurs + serveurs) et vérifie :
 *   A. résolution du port du portail (nouvelle sémantique) ;
 *   B. lanceurs Windows : lecture .env + URLs dynamiques + CRLF intégral ;
 *   C. lanceurs Linux/macOS : lecture .env + URLs dynamiques + bash -n ;
 *   D. kit silencieux .vbs : LirePortAdmin + plus de « 3001 » ;
 *   E. redemarrer-services : lirePortEnv éprouvé sur un .env temporaire ;
 *   F. service-paiesage : priorité PAIESAGE_PORT_* > .env > défaut.
 *
 * Usage : node scripts/test_v02198_ports.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

function lire(f) {
  return fs.readFileSync(f, "utf8");
}
function crlfIntegral(f) {
  const brut = fs.readFileSync(f, "latin1");
  return !/[^\r]\n/.test(brut) && brut.includes("\r\n");
}

// Dossier temporaire pour éprouver lirePortEnv sur un VRAI .env
const TMPROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ports-v02198-"));

console.log("== A — scripts/portail-server.js : résolution du port du portail ==");
(() => {
  const src = lire("scripts/portail-server.js");
  const lignePort = src.match(/const PORT = parseInt\((.*)\, 10\);/);
  check("A1 — la constante PORT existe", !!lignePort, "");
  const expr = lignePort ? lignePort[1] : "";
  check("A2 — plus AUCUN repli sur process.env.PORT",
    expr === 'process.env.PORTAL_PORT || "4001"', expr);
  check("A3 — commentaire explicatif du correctif présent",
    src.includes("PLUS de repli sur PORT") && src.includes("EADDRINUSE"), "");
  // Comportement réel : la MÊME expression évaluée avec des env simulés
  const resoudrePort = new Function(
    "process", "parseInt",
    'return parseInt(' + expr + ', 10);'
  );
  check("A4 — PORTAL_PORT absent → 4001 (défaut)",
    resoudrePort({ env: {} }, parseInt) === 4001, "");
  check("A5 — PORT=4000 (administration) N'AUCUN effet sur le portail",
    resoudrePort({ env: { PORT: "4000" } }, parseInt) === 4001, "");
  check("A6 — PORTAL_PORT=5005 honoré",
    resoudrePort({ env: { PORTAL_PORT: "5005" } }, parseInt) === 5005, "");
  check("A7 — node --check portail-server.js",
    spawnSync("node", ["--check", "scripts/portail-server.js"]).status === 0, "");
})();

console.log("== B — lanceurs Windows (.bat) : lecture .env + URLs dynamiques ==");
(() => {
  const dem = lire("DEMARRER-WINDOWS.bat");
  check("B1 — DEMARRER-WINDOWS : défaut PORT=3000 + lecture .env (findstr ^PORT=)",
    dem.includes('set "PORT=3000"') && dem.includes('findstr /B /C:"PORT="'), "");
  check("B2 — DEMARRER-WINDOWS : navigateur + affichages sur !PORT!",
    dem.includes('start "" http://localhost:!PORT!') &&
    dem.includes("Ouverture de http://localhost:!PORT!") &&
    dem.includes("ADRESSE-IP-DE-CE-POSTE:!PORT!"), "");
  check("B3 — DEMARRER-WINDOWS : plus AUCUN localhost:3000 codé en dur",
    !dem.includes("localhost:3000"), "");
  check("B4 — DEMARRER-WINDOWS : rappel du portail via PORTAL_PORT cité",
    dem.includes("PORTAL_PORT"), "");

  const por = lire("DEMARRER-PORTAIL-WINDOWS.bat");
  check("B5 — DEMARRER-PORTAIL : défauts PORTAL_PORT=4001 / PORT_ADMIN=3000",
    por.includes('set "PORTAL_PORT=4001"') && por.includes('set "PORT_ADMIN=3000"'), "");
  check("B6 — DEMARRER-PORTAIL : lecture .env des DEUX variables",
    por.includes('findstr /B /C:"PORTAL_PORT="') && por.includes('findstr /B /C:"PORT="'), "");
  check("B7 — DEMARRER-PORTAIL : navigateur + affichages sur !PORTAL_PORT! / !PORT_ADMIN!",
    por.includes('start "" http://localhost:!PORTAL_PORT!') &&
    por.includes("ADRESSE-IP-DE-CE-POSTE:!PORTAL_PORT!") &&
    por.includes("port !PORT_ADMIN!"), "");
  check("B8 — DEMARRER-PORTAIL : plus AUCUNE trace du faux port 3001",
    !por.includes("3001"), "");

  const tout = lire("DEMARRER-TOUT-WINDOWS.bat");
  check("B9 — DEMARRER-TOUT : lecture .env des DEUX variables + défauts",
    tout.includes('findstr /B /C:"PORT="') &&
    tout.includes('findstr /B /C:"PORTAL_PORT="') &&
    tout.includes('set "PORT=3000"') &&
    tout.includes('set "PORTAL_PORT=4001"'), "");
  check("B10 — DEMARRER-TOUT : fenêtres + affichages dynamiques",
    tout.includes("Fiches de Paie Administration (port !PORT!)") &&
    tout.includes("Fiches de Paie Portail Employes (port !PORTAL_PORT!)") &&
    tout.includes("http://localhost:!PORT!") &&
    tout.includes("http://localhost:!PORTAL_PORT!"), "");
  check("B11 — DEMARRER-TOUT : plus AUCUN localhost:3000 ni localhost:3001 codé",
    !tout.includes("localhost:3000") && !tout.includes("localhost:3001"), "");

  check("B12 — les 3 .bat sont en CRLF intégral (cmd.exe)",
    crlfIntegral("DEMARRER-WINDOWS.bat") &&
    crlfIntegral("DEMARRER-PORTAIL-WINDOWS.bat") &&
    crlfIntegral("DEMARRER-TOUT-WINDOWS.bat"), "");
})();

console.log("== C — lanceurs Linux/macOS (.sh) : lecture .env + URLs dynamiques ==");
(() => {
  const dem = lire("DEMARRER-LINUX-MAC.sh");
  check("C1 — DEMARRER-LINUX : PORT lu dans .env, défaut 3000, exporté",
    dem.includes("grep -E '^PORT=' .env") && dem.includes('PORT="${PORT:-3000}"') &&
    dem.includes("export PORT"), "");
  check("C2 — DEMARRER-LINUX : affichages sur ${PORT}, plus AUCUN localhost:4000",
    dem.includes("http://localhost:${PORT}") &&
    dem.includes("http://${LAN_IP}:${PORT}") && !dem.includes("localhost:4000"), "");

  const por = lire("DEMARRER-PORTAIL-LINUX-MAC.sh");
  check("C3 — DEMARRER-PORTAIL-LINUX : PORTAL_PORT lu, défaut 4001, exporté",
    por.includes("grep -E '^PORTAL_PORT=' .env") &&
    por.includes('PORTAL_PORT="${PORTAL_PORT:-4001}"') &&
    por.includes("export PORTAL_PORT"), "");
  check("C4 — DEMARRER-PORTAIL-LINUX : affichages + navigateur sur ${PORTAL_PORT}",
    por.includes("http://localhost:${PORTAL_PORT}") &&
    por.includes("xdg-open http://localhost:${PORTAL_PORT}") &&
    por.includes("open http://localhost:${PORTAL_PORT}") &&
    por.includes("administration RH/IT sur le port ${PORT_ADMIN}"), "");
  check("C5 — DEMARRER-PORTAIL-LINUX : plus AUCUN localhost:4001 ni localhost:4000",
    !por.includes("localhost:4001") && !por.includes("localhost:4000"), "");

  const tout = lire("DEMARRER-TOUT-LINUX-MAC.sh");
  check("C6 — DEMARRER-TOUT-LINUX : les DEUX variables lues + défauts",
    tout.includes("grep -E '^PORT=' .env") &&
    tout.includes("grep -E '^PORTAL_PORT=' .env") &&
    tout.includes('PORT="${PORT:-3000}"') &&
    tout.includes('PORTAL_PORT="${PORTAL_PORT:-4001}"'), "");
  check("C7 — DEMARRER-TOUT-LINUX : affichages dynamiques, plus aucun port codé",
    tout.includes("http://localhost:${PORT}") &&
    tout.includes("http://localhost:${PORTAL_PORT}") &&
    !tout.includes("localhost:4000") && !tout.includes("localhost:4001"), "");

  for (const f of ["DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", "DEMARRER-TOUT-LINUX-MAC.sh"]) {
    const r = spawnSync("bash", ["-n", f]);
    check(`C8 — bash -n ${f}`, r.status === 0, r.stderr ? r.stderr.toString() : "");
  }
})();

console.log("== D — kit silencieux (.vbs) : LirePortAdmin + plus de 3001 ==");
(() => {
  const sil = lire("DEMARRER-SILENCIEUX-WINDOWS.vbs");
  check("D1 — DEMARRER-SILENCIEUX : fonction LirePortAdmin (PORT du .env, défaut 4000)",
    sil.includes("Function LirePortAdmin") &&
    sil.includes('Left(Trim(lignesEnv(j)), 5) = "PORT="') &&
    sil.includes('LirePortAdmin = "4000"'), "");
  check("D2 — DEMARRER-SILENCIEUX : navigateur ouvert sur le port LU (plus de 4000 codé)",
    sil.includes('sh.Run "http://localhost:" & portAdmin') &&
    !sil.includes('sh.Run "http://localhost:4000"'), "");
  check("D3 — DEMARRER-SILENCIEUX : PORTAL_PORT documenté dans l'en-tête",
    sil.includes("PORTAL_PORT=XXXX"), "");
  check("D4 — INSTALLER-DEMARRAGE : plus de « port 3000 + portail port 3001 »",
    !lire("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs").includes("port 3000 + portail port 3001"), "");
  check("D5 — INSTALLER-DEMARRAGE : énoncé exact (4000 + 4001 par défaut, .env)",
    lire("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs").includes(
      "administration port 4000 + portail port 4001") &&
    lire("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs").includes("modifiables dans le fichier .env"), "");
  check("D6 — les 2 .vbs sont en CRLF intégral",
    crlfIntegral("DEMARRER-SILENCIEUX-WINDOWS.vbs") &&
    crlfIntegral("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs"), "");
})();

console.log("== E — scripts/redemarrer-services-4000-4001.js : lirePortEnv éprouvé ==");
(() => {
  const src = lire("scripts/redemarrer-services-4000-4001.js");
  check("E1 — lirePortEnv défini + ports lus depuis .env (défauts 4000/4001)",
    src.includes("function lirePortEnv(cle, defaut)") &&
    src.includes('lirePortEnv("PORT", 4000)') &&
    src.includes('lirePortEnv("PORTAL_PORT", 4001)'), "");
  check("E2 — node --check redemarrer-services-4000-4001.js",
    spawnSync("node", ["--check", "scripts/redemarrer-services-4000-4001.js"]).status === 0, "");
  // Éprouver la VRAIE fonction (extraite) sur un VRAI .env temporaire
  const i0 = src.indexOf("function lirePortEnv");
  const i1 = src.indexOf("\n}", i0) + 2;
  const corps = src.slice(i0, i1);
  const { lirePortEnv } = new Function("fs", "path", "ROOT",
    corps + "\nreturn { lirePortEnv };")(fs, path, TMPROOT);
  fs.writeFileSync(path.join(TMPROOT, ".env"), "DATABASE_URL=file:/x/db.db\nPORT=5001\nPORTAL_PORT=6002\n");
  check("E3 — .env réel : PORT=5001 lu", lirePortEnv("PORT", 4000) === 5001, "");
  check("E4 — .env réel : PORTAL_PORT=6002 lu", lirePortEnv("PORTAL_PORT", 4001) === 6002, "");
  check("E5 — valeur guillemée acceptée (PORT=\"5001\")",
    (fs.writeFileSync(path.join(TMPROOT, ".env"), 'PORT="5001"\n'),
      lirePortEnv("PORT", 4000) === 5001), "");
  fs.rmSync(path.join(TMPROOT, ".env"));
  check("E6 — sans .env : défauts historiques 4000 / 4001",
    lirePortEnv("PORT", 4000) === 4000 && lirePortEnv("PORTAL_PORT", 4001) === 4001, "");
  check("E7 — clé PARTIELLE ignorée (PORT= ne capte pas PORTAL_PORT=)",
    (fs.writeFileSync(path.join(TMPROOT, ".env"), "PORTAL_PORT=6002\n"),
      lirePortEnv("PORT", 4000) === 4000), "");
  fs.rmSync(path.join(TMPROOT, ".env"));
})();

console.log("== F — scripts/service-paiesage.js : priorité PAIESAGE_PORT_* > .env > défaut ==");
(() => {
  const src = lire("scripts/service-paiesage.js");
  check("F1 — lirePortEnv défini + résolution .env (défauts 4000/4001)",
    src.includes("function lirePortEnv(cle, defaut)") &&
    src.includes('lirePortEnv("PORT", "4000")') &&
    src.includes('lirePortEnv("PORTAL_PORT", "4001")'), "");
  check("F2 — priorité PAIESAGE_PORT_ADMIN / PAIESAGE_PORT_PORTAIL conservée",
    src.includes("process.env.PAIESAGE_PORT_ADMIN || lirePortEnv") &&
    src.includes("process.env.PAIESAGE_PORT_PORTAIL || lirePortEnv"), "");
  check("F3 — node --check service-paiesage.js",
    spawnSync("node", ["--check", "scripts/service-paiesage.js"]).status === 0, "");
  const i0 = src.indexOf("function lirePortEnv");
  const i1 = src.indexOf("\n}", i0) + 2;
  const corps = src.slice(i0, i1);
  const { lirePortEnv } = new Function("fs", "path", "ROOT",
    corps + "\nreturn { lirePortEnv };")(fs, path, TMPROOT);
  fs.writeFileSync(path.join(TMPROOT, ".env"), "PORT=5001\nPORTAL_PORT=6002\n");
  const resoudreAdmin = new Function("process", "String", "lirePortEnv",
    'return String(process.env.PAIESAGE_PORT_ADMIN || lirePortEnv("PORT","4000"));');
  const resoudrePortail = new Function("process", "String", "lirePortEnv",
    'return String(process.env.PAIESAGE_PORT_PORTAIL || lirePortEnv("PORTAL_PORT","4001"));');
  check("F4 — mode silencieux : suit le .env (5001 / 6002)",
    resoudreAdmin({ env: {} }, String, lirePortEnv) === "5001" &&
    resoudrePortail({ env: {} }, String, lirePortEnv) === "6002", "");
  check("F5 — PAIESAGE_PORT_ADMIN=7000 reste PRIORITAIRE",
    resoudreAdmin({ env: { PAIESAGE_PORT_ADMIN: "7000" } }, String, lirePortEnv) === "7000", "");
  check("F6 — PAIESAGE_PORT_PORTAIL=8000 reste PRIORITAIRE",
    resoudrePortail({ env: { PAIESAGE_PORT_PORTAIL: "8000" } }, String, lirePortEnv) === "8000", "");
  fs.rmSync(path.join(TMPROOT, ".env"));
})();

setTimeout(() => {
  fs.rmSync(TMPROOT, { recursive: true, force: true });
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 400);
