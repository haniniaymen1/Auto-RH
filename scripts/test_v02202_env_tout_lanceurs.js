#!/usr/bin/env node
/**
 * v0.2.202 — PREUVE DÉDIÉE : « Environment variable not found: DATABASE_URL »
 * ===========================================================================
 * (Capture utilisateur : sous Windows, DEMARRER-TOUT-WINDOWS.bat → npm install
 *  OK → prisma db push → P1012 « Environment variable not found: DATABASE_URL »
 *  → « [ERREUR] La creation de la base de donnees a echoue. »
 *
 *  CAUSE RACINE : les DEUX lanceurs « TOUT » (Windows + Linux/macOS) exécutent
 *  l'installation commune (npm install + prisma db push) SANS avoir préparé le
 *  fichier .env — contrairement à tous les autres lanceurs. Sur un poste neuf :
 *  P1012 garanti.
 *
 *  CORRECTIF 0.2.202 :
 *   1. DEMARRER-TOUT-WINDOWS.bat / DEMARRER-TOUT-LINUX-MAC.sh : le .env
 *      (DATABASE_URL absolu) est préparé AVANT les commandes Prisma ;
 *   2. durcissement npm >= 11 (la même capture montre « npm warn
 *      install-scripts » : postinstall de @prisma/client potentiellement
 *      sauté) : TOUS les lanceurs testent désormais le CLIENT GÉNÉRÉ
 *      node_modules/.prisma/client/index.js (et non plus le paquet
 *      @prisma/client) avant de sauter « prisma generate » ;
 *   3. DEMARRER-WINDOWS.bat : generate unifié si .prisma/client absent ;
 *   4. guide : entrée « Environment variable not found: DATABASE_URL ».
 *
 * Usage : node scripts/test_v02202_env_tout_lanceurs.js
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

const TOUT_WIN = fs.readFileSync("DEMARRER-TOUT-WINDOWS.bat", "utf8");
const TOUT_LNX = fs.readFileSync("DEMARRER-TOUT-LINUX-MAC.sh", "utf8");
const WIN = fs.readFileSync("DEMARRER-WINDOWS.bat", "utf8");
const PORTAIL_WIN = fs.readFileSync("DEMARRER-PORTAIL-WINDOWS.bat", "utf8");
const LNX = fs.readFileSync("DEMARRER-LINUX-MAC.sh", "utf8");
const PORTAIL_LNX = fs.readFileSync("DEMARRER-PORTAIL-LINUX-MAC.sh", "utf8");
const GUIDE = fs.readFileSync("GUIDE-INSTALLATION-LINUX-WINDOWS.txt", "utf8");

console.log("== A — DEMARRER-TOUT-WINDOWS.bat : .env préparé AVANT Prisma ==");
check("A1 — bloc « 1bis) Preparer le .env » présent",
  TOUT_WIN.includes("1bis) Preparer le .env"), "");
check("A2 — DATABASE_URL écrit dans le .env AVANT « prisma db push » (ordre réel)",
  TOUT_WIN.indexOf("DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db") >= 0 &&
  TOUT_WIN.indexOf("DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db") < TOUT_WIN.indexOf("prisma db push"), "");
check("A3 — écriture atomique : .env.tmp puis move /y .env.tmp .env",
  TOUT_WIN.includes("> .env.tmp echo DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db") &&
  TOUT_WIN.indexOf("move /y .env.tmp .env") < TOUT_WIN.indexOf("prisma db push"), "");
check("A4 — .env existant préservé (findstr /V : la ligne DATABASE_URL est réécrite, le reste conservé)",
  TOUT_WIN.includes('if exist .env findstr /V /B /C:"DATABASE_URL=" .env >> .env.tmp'), "");
check("A5 — variable d'environnement DATABASE_URL aussi posée (ceinture et bretelles)",
  TOUT_WIN.includes('set "DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db"') &&
  TOUT_WIN.indexOf('set "DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db"') < TOUT_WIN.indexOf("prisma db push"), "");
check("A6 — AUTH_SECRET toujours laissé au lanceur DEMARRER-WINDOWS.bat (comportement inchangé)",
  TOUT_WIN.includes("AUTH_SECRET : cree par le lanceur"), "");
check("A7 — CRLF intégral (aucun LF isolé — exigence 0.2.198 conservée)",
  !/[^\r]\n/.test(TOUT_WIN), "");

console.log("== B — DEMARRER-TOUT-LINUX-MAC.sh : .env préparé AVANT Prisma ==");
check("B1 — bloc « 1bis) Preparer le .env » présent",
  TOUT_LNX.includes("1bis) Preparer le .env"), "");
check("B2 — DATABASE_URL écrit dans le .env AVANT « db push » (ordre réel)",
  TOUT_LNX.indexOf("printf 'DATABASE_URL=file:%s/db/custom.db") >= 0 &&
  TOUT_LNX.indexOf("printf 'DATABASE_URL=file:%s/db/custom.db") < TOUT_LNX.indexOf("db push ||"), "");
check("B3 — export DATABASE_URL (chemin absolu) avant db push",
  TOUT_LNX.includes('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"') &&
  TOUT_LNX.indexOf('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"') < TOUT_LNX.indexOf("db push ||"), "");
check("B4 — .env existant préservé (grep -v puis réécriture) + mv .env.tmp .env",
  TOUT_LNX.includes("grep -v '^DATABASE_URL=' .env > .env.tmp") &&
  TOUT_LNX.includes("mv .env.tmp .env"), "");
check("B5 — syntaxe bash valide (bash -n réel)",
  spawnSync("bash", ["-n", "DEMARRER-TOUT-LINUX-MAC.sh"]).status === 0, "");

console.log("== C — durcissement npm >= 11 : client GÉNÉRÉ (.prisma/client) testé ==");
const condWin = 'if not exist "node_modules\\.prisma\\client\\index.js" (';
const condLnx = 'if [ ! -f "node_modules/.prisma/client/index.js" ]; then';
check("C1 — DEMARRER-TOUT-WINDOWS.bat : condition generate sur .prisma\\client\\index.js",
  TOUT_WIN.includes(condWin), "");
check("C2 — DEMARRER-WINDOWS.bat : generate UNIFIÉ si .prisma/client absent (après le if/else dépendances)",
  WIN.includes(condWin) && WIN.indexOf(condWin) > WIN.indexOf("Dependances deja installees") &&
  WIN.indexOf(condWin) < WIN.indexOf("prisma db push"), "");
check("C3 — DEMARRER-PORTAIL-WINDOWS.bat : condition generate sur .prisma\\client\\index.js",
  PORTAIL_WIN.includes(condWin), "");
check("C4 — DEMARRER-TOUT-LINUX-MAC.sh : condition generate sur .prisma/client/index.js",
  TOUT_LNX.includes(condLnx), "");
check("C5 — DEMARRER-LINUX-MAC.sh : condition generate sur .prisma/client/index.js",
  LNX.includes(condLnx), "");
check("C6 — DEMARRER-PORTAIL-LINUX-MAC.sh : condition generate sur .prisma/client/index.js",
  PORTAIL_LNX.includes(condLnx), "");
check("C7 — plus AUCUNE condition generate fondée sur le seul paquet @prisma/client",
  !TOUT_WIN.includes('if not exist "node_modules\\@prisma\\client" (') &&
  !PORTAIL_WIN.includes('if not exist "node_modules\\@prisma\\client" (') &&
  !TOUT_LNX.includes('if [ ! -d "node_modules/@prisma/client" ]') &&
  !LNX.includes('if [ ! -d "node_modules/@prisma/client" ]') &&
  !PORTAIL_LNX.includes('if [ ! -d "node_modules/@prisma/client" ]'), "");

console.log("== D — EXÉCUTION RÉELLE : dossier VIERGE + VRAI « prisma db push » ==");
// Le bloc 1bis RÉEL est extrait du lanceur Linux (entre les marqueurs) et
// exécuté tel quel : c'est exactement ce que fera l'utilisateur.
const m1 = TOUT_LNX.indexOf("# ---------- 1bis)");
const m2 = TOUT_LNX.indexOf("# ---------- 2) Installation commune");
check("D0 — bloc 1bis isolable du lanceur réel (marqueurs présents)", m1 >= 0 && m2 > m1, "");
const bloc = TOUT_LNX.slice(m1, m2);

function scenario(nom, preparer, verifs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v02202-" + nom + "-"));
  const racine = path.join(dir, "projet");
  fs.mkdirSync(path.join(racine, "db"), { recursive: true });
  fs.mkdirSync(path.join(racine, "prisma"), { recursive: true });
  fs.copyFileSync("prisma/schema.prisma", path.join(racine, "prisma", "schema.prisma"));
  // node_modules RÉEL lié (le CLI Prisma local est utilisé — aucune npm install)
  fs.symlinkSync(path.resolve("node_modules"), path.join(racine, "node_modules"), "dir");
  if (preparer) preparer(racine);
  // 1) exécution RÉELLE du bloc extrait du lanceur
  const r1 = spawnSync("bash", ["-c", bloc], { cwd: racine, encoding: "utf8", timeout: 60000 });
  if (r1.status !== 0) return { dir, echec: "bloc bash: " + (r1.stderr || r1.stdout || "") };
  // 2) VRAI « prisma db push » SANS variable d'environnement DATABASE_URL :
  //    Prisma doit la trouver dans le .env fraîchement créé (scénario Windows).
  const env = Object.assign({}, process.env);
  delete env.DATABASE_URL;
  const r2 = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push"],
    { cwd: racine, env, encoding: "utf8", timeout: 120000 });
  const verite = {
    dir,
    bash: r1.status === 0,
    dbPush: r2.status === 0,
    sortie: String(r2.stdout || "") + String(r2.stderr || ""),
    db: path.join(racine, "db", "custom.db"),
    contenuEnv: (() => { try { return fs.readFileSync(path.join(racine, ".env"), "utf8"); } catch (_) { return ""; } })(),
  };
  return Object.assign(verite, verifs(verite));
}

// Scénario 1 : poste NEUF (aucun .env) — la panne de la capture utilisateur
const s1 = scenario("neuf", null, (v) => ({
  envCree: v.contenuEnv.includes("DATABASE_URL=file:"),
  cheminAbsolu: v.contenuEnv.includes("/db/custom.db"),
  dbCreee: fs.existsSync(v.db) && fs.statSync(v.db).size > 10000 &&
    fs.readFileSync(v.db).slice(0, 15).toString("latin1").startsWith("SQLite format 3"),
}));
check("D1 — poste NEUF : le bloc du lanceur crée le .env (DATABASE_URL absolu)",
  s1.envCree && s1.cheminAbsolu, s1.echec || s1.contenuEnv);
check("D2 — poste NEUF : VRAI « prisma db push » réussit via le .env (plus de P1012)",
  s1.dbPush, (s1.sortie || "").slice(0, 300));
check("D3 — poste NEUF : base SQLite réellement créée (fichier + en-tête SQLite)",
  s1.dbCreee, "");

// Scénario 2 : .env préexistant (PORT=8080) — conservé + DATABASE_URL ajouté
const s2 = scenario("port", (racine) => fs.writeFileSync(path.join(racine, ".env"), "PORT=8080\nPORTAL_PORT=8081\n", "utf8"), (v) => ({
  portGarde: v.contenuEnv.includes("PORT=8080") && v.contenuEnv.includes("PORTAL_PORT=8081"),
  urlAjoutee: (v.contenuEnv.match(/DATABASE_URL=/g) || []).length === 1,
  dbPushOk: v.dbPush,
}));
check("D4 — .env existant : PORT/PORTAL_PORT CONSERVÉS, DATABASE_URL ajouté (1 seule fois)",
  s2.portGarde && s2.urlAjoutee, s2.contenuEnv);
check("D5 — .env existant : db push réussit", s2.dbPushOk, s2.sortie.slice(0, 200));

// Scénario 3 : .env avec DATABASE_URL déjà présent — AUCUN doublon
const s3 = scenario("doublon", (racine) => fs.writeFileSync(path.join(racine, ".env"),
  "PORT=3000\nDATABASE_URL=file:/ancienne/base.db\n", "utf8"), (v) => ({
  sansDoublon: (v.contenuEnv.match(/DATABASE_URL=/g) || []).length === 1,
  remplacee: v.contenuEnv.includes("DATABASE_URL=file:") && !v.contenuEnv.includes("/ancienne/base.db"),
}));
check("D6 — DATABASE_URL déjà présent : réécrite (ancienne valeur remplacée), AUCUN doublon",
  s3.sansDoublon && s3.remplacee, s3.contenuEnv);

// Nettoyage
for (const s of [s1, s2, s3]) { try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (_) {} }

console.log("== E — guide mis à jour ==");
check("E1 — guide : entrée « Environment variable not found: DATABASE_URL » (corrigé v0.2.202, relancer le lanceur)",
  GUIDE.includes("Environment variable not found: DATABASE_URL") &&
  GUIDE.includes("CORRIGE a partir de la v0.2.202"), "");
check("E2 — guide : version finale « Fin du guide - v0.2.202 » + ASCII strict",
  GUIDE.includes("Fin du guide - v0.2.202") && !/[^\x09\x0A\x20-\x7E]/.test(GUIDE), "");

console.log("== F — non-régression des AUTRES lanceurs (leur préparation .env intacte) ==");
check("F1 — DEMARRER-WINDOWS.bat : .env préparé avant prisma db push (ordre)",
  WIN.indexOf("DATABASE_URL=file:%PROJECT_UNIX%/db/custom.db") < WIN.indexOf("prisma db push") &&
  WIN.includes("move /y .env.tmp .env"), "");
check("F2 — DEMARRER-PORTAIL-WINDOWS.bat : .env préparé avant prisma db push (ordre)",
  PORTAIL_WIN.indexOf("DATABASE_URL=file:") < PORTAIL_WIN.indexOf("prisma db push"), "");
check("F3 — DEMARRER-LINUX-MAC.sh : .env préparé + export avant db push (ordre)",
  LNX.indexOf("printf 'DATABASE_URL=file:%s/db/custom.db") < LNX.indexOf("db push ||") &&
  LNX.includes('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"'), "");
check("F4 — DEMARRER-PORTAIL-LINUX-MAC.sh : .env préparé + export avant db push (ordre)",
  PORTAIL_LNX.indexOf("DATABASE_URL=file:") < PORTAIL_LNX.indexOf("db push ||") &&
  PORTAIL_LNX.includes('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"'), "");
check("F5 — INSTALLER-ET-DEMARRER-LINUX-MAC.sh : préparation .env + export conservés (héritage 199)",
  (() => { const t = fs.readFileSync("INSTALLER-ET-DEMARRER-LINUX-MAC.sh", "utf8");
    return t.indexOf("DATABASE_URL=file:%s/db/custom.db") < t.indexOf("db push ||") &&
      t.includes('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"'); })(), "");
check("F6 — syntaxe bash OK sur les 4 lanceurs .sh modifiés/voisins",
  ["DEMARRER-TOUT-LINUX-MAC.sh", "DEMARRER-LINUX-MAC.sh", "DEMARRER-PORTAIL-LINUX-MAC.sh", "INSTALLER-ET-DEMARRER-LINUX-MAC.sh"]
    .every((f) => spawnSync("bash", ["-n", f]).status === 0), "");

setTimeout(() => {
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 300);
