/**
 * ============================================================================
 * Task 112 — TEST DE VOLUME 240 000 FICHES DE PAIE (build sandbox 0.2.35)
 * ============================================================================
 * DEMANDE : « test avec 240 000 fiche de paie et donne moi un résultats »
 *
 * PRINCIPE :
 *   - Importer 240 000 vrais PDF par OCR prendrait des jours ; on INSÈRE donc
 *     directement en base 240 000 fiches CHIFFRÉES exactement comme le fait
 *     l'application (mêmes champs, même chiffrement AES-256-GCM via
 *     scripts/lib-crypto-bd.js), puis on mesure la performance RÉELLE du
 *     système via les VRAIES routes HTTP authentifiées de la build 0.2.35.
 *   - Serveur sandbox sur le port 4310 avec base DÉDIÉE db/test240k.db.
 *
 * USAGE : node test112_240k.js [tout|seed|indexation|mesures]
 *   seed       = création schéma + insertion 240 000 fiches (chronométrée)
 *   indexation = construit l'index de recherche rapide (lots, IDEMPOTENT —
 *                relancer la commande jusqu'à « INDEXATION TERMINÉE »)
 *   mesures    = scénarios HTTP chronométrés (pagination, recherche CIN,
 *                détail, liste illimitée) + mémoire serveur + taille base
 *   tout       = seed puis indexation puis mesures (défaut)
 * ============================================================================
 */
const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = "/home/z/my-project/task104_specimen/app";
const SERVER = path.join(ROOT, ".next", "standalone", "task104_specimen", "app", "server.js");
const PORT = 4310;
const ADMIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, "db", "test240k.db");
const SECRET = "t240k-secret-volume";
const NB_FICHES = 240000;
const TAILLE_LOT = 2000; // 120 lots

process.env.DATABASE_URL = "file:" + DB;
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

const EMAIL_IT = "it-volume@autorh.local";
const MDP_IT = "It2026!volume240k";

/* ------------------------------ utilitaires ------------------------------ */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDur = (ms) =>
  ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${(ms / 1000).toFixed(2)} s`;
const fmtOc = (o) => (o >= 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.round(o / 1024)} Ko`);

function httpRequete(method, url, { headers = {}, body = null, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: { ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        let octets = 0;
        res.on("data", (c) => { chunks.push(c); octets += c.length; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, octets, texte: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (body) req.write(body);
    req.end();
  });
}

async function attendreServeur(url) {
  for (let i = 0; i < 240; i++) { try { await httpRequete("GET", url, { timeoutMs: 5000 }); return; } catch { await attendre(500); } }
  throw new Error("serveur injoignable : " + url);
}

function portLibre(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 800 }, () => { sock.destroy(); resolve(false); });
    sock.on("error", () => resolve(true));
    sock.on("timeout", () => { sock.destroy(); resolve(true); });
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function rssMo(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = st.match(/VmRSS:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}

/* ------------------------------ données ------------------------------ */
function contenuFiche(i) {
  const cin = String(10000000 + i);
  const net = (3200 + ((i * 7919) % 4500) + ((i % 100) / 100)).toFixed(3);
  const base = (net * 0.72).toFixed(3);
  return `ROYAUME DU MAROC - BULLETIN DE PAIE
Societe SERVICE RH INDUSTRIES SA - RC 51234 - CNSS 8765432
CIN : ${cin}
Matricule : MAT${String(i).padStart(6, "0")}
Employe : EMPLOYE ${i}
Fonction : TECHNICIEN ${1 + (i % 12)}
Periode : du 01/08/26 au 31/08/26
Salaire de base : ${base} DT
Prime d anciennete : ${(net * 0.05).toFixed(3)} DT
Prime de transport : 200,000 DT
Heures supplementaires : ${(i % 8) * 12},500 DT
Brut imposable : ${net} DT
Retenue CNSS (4,48%) : -${(net * 0.0448).toFixed(3)} DT
Retenue AMO : -${(net * 0.022).toFixed(3)} DT
Impot sur le revenu : -${(net * 0.12).toFixed(3)} DT
Total retenues : -${(net * 0.1868).toFixed(3)} DT
NET A PAYER : ${(net * 0.8132).toFixed(3)} DT
Mode de paiement : Virement bancaire - RIB 007 780 0001234567890123 45
Document genere par Auto-RH - Fiche de paie numerique authentifiee.`;
}

function ligneFiche(i) {
  const contenu = contenuFiche(i);
  return cryptoBd.chiffrerObjet("Payslip", {
    fileName: `fiche_paie_${String(i).padStart(7, "0")}.pdf`,
    storedName: `fiche_paie_${String(i).padStart(7, "0")}.pdf`,
    fileSize: 48000 + (i % 9000),
    content: contenu,
    normalizedContent: contenu.toUpperCase().replace(/[\s.\/\-]/g, ""),
    cin: String(10000000 + i),
    employeeName: `EMPLOYE ${i}`,
    period: "du 01/08/26 au 31/08/26",
    netSalary: `${(3200 + ((i * 7919) % 4500) + ((i % 100) / 100)).toFixed(3)} DT`,
    matricule: `MAT${String(i).padStart(6, "0")}`,
    pageNumber: 1,
    sourcePage: null,
    uploadedAt: new Date(Date.now() - i * 1000),
  });
}

/* ------------------------------ phases ------------------------------ */
async function phaseSeed() {
  const t0 = Date.now();
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: "file:" + DB }, stdio: "pipe",
  });
  console.log(`Schéma créé (db/test240k.db) — ${fmtDur(Date.now() - t0)}`);
  await prisma.payslip.deleteMany({});

  const t1 = Date.now();
  for (let debut = 0; debut < NB_FICHES; debut += TAILLE_LOT) {
    const lot = [];
    for (let i = debut; i < Math.min(debut + TAILLE_LOT, NB_FICHES); i++) lot.push(ligneFiche(i));
    await prisma.payslip.createMany({ data: lot });
    if ((debut / TAILLE_LOT) % 20 === 0) {
      const pct = Math.round((debut / NB_FICHES) * 100);
      console.log(`  insertion… ${pct} % (${debut}/${NB_FICHES}) — ${fmtDur(Date.now() - t1)}`);
    }
  }
  const dureeSeed = Date.now() - t1;
  const nb = await prisma.payslip.count();
  const tailleDb = fs.statSync(DB).size;
  console.log(`\nSEED TERMINÉ : ${nb} fiches chiffrées insérées en ${fmtDur(dureeSeed)} (${Math.round(NB_FICHES / (dureeSeed / 1000))} fiches/s)`);
  console.log(`Taille base : ${fmtOc(tailleDb)}`);
  return { nb, dureeSeed, tailleDb };
}

async function phaseMesures() {
  let admin = null;
  const resultats = [];
  const mesure = (nom, ms, extra) => {
    resultats.push({ nom, ms, ...extra });
    console.log(`  → ${nom} : ${fmtDur(ms)}${extra.taille ? ` — réponse ${fmtOc(extra.taille)}` : ""}${extra.items !== undefined ? ` — items=${extra.items}` : ""}${extra.total !== undefined ? ` — total=${extra.total}` : ""}`);
  };

  try {
    if (!(await portLibre(PORT))) throw new Error(`port ${PORT} déjà occupé`);
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const pidSrv = admin.pid;
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);
    console.log(`Serveur sandbox 4310 démarré (PID ${pidSrv}, RSS ${rssMo(pidSrv)} Mo)`);

    // connexion IT
    await prisma.user.deleteMany({});
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT Volume (Task 112)", passwordHash: hashPassword(MDP_IT),
        role: "IT", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequete("POST", `${ADMIN}/api/auth/login`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL_IT, password: MDP_IT }), timeoutMs: 60000 });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) { const m = c.match(/auto_rh_session=([^;]+)/); if (m) cookie = m[1]; }
    if (loginR.status !== 200 || !cookie) throw new Error("login IT échoué " + loginR.status);
    const H = { Cookie: `auto_rh_session=${cookie}` };
    console.log("Login IT OK — début des mesures\n");

    // --- P0 : comptage ---
    let t = Date.now();
    let r = await httpRequete("GET", `${ADMIN}/api/payslips?limit=1&offset=0`, { headers: H });
    let j = JSON.parse(r.texte);
    mesure("P0 comptage total (limit=1)", Date.now() - t, { total: j.total, items: j.items.length, taille: r.octets });
    if (j.total !== NB_FICHES) console.log(`  ⚠ total attendu ${NB_FICHES}, obtenu ${j.total}`);

    // --- P1..P3 : pagination SQL ---
    const pages = [["P1 1re page (limit=20)", 0], ["P2 page milieu (offset=120000)", 120000], ["P3 dernière page (offset=239980)", 239980]];
    for (const [nom, off] of pages) {
      t = Date.now();
      r = await httpRequete("GET", `${ADMIN}/api/payslips?limit=20&offset=${off}`, { headers: H });
      j = JSON.parse(r.texte);
      mesure(nom, Date.now() - t, { items: j.items.length, taille: r.octets, total: j.total });
      if (j.items[0]) console.log(`     1er item : CIN=${j.items[0].cin} — ${j.items[0].employeeName}`);
    }

    // --- P4 : page de 100 ---
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips?limit=100&offset=0`, { headers: H });
    j = JSON.parse(r.texte);
    mesure("P4 page de 100 fiches", Date.now() - t, { items: j.items.length, taille: r.octets });

    // --- S1 : recherche CIN présent en FIN de table (pire cas) ---
    const cinFin = String(10000000 + 239999); // CIN inséré en dernier
    let rssAvant = rssMo(pidSrv);
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips?cin=${cinFin}&limit=20`, { headers: H });
    const dureeS1 = Date.now() - t;
    j = JSON.parse(r.texte);
    let rssApres = rssMo(pidSrv);
    mesure(`S1 recherche CIN ${cinFin} (fin de table)`, dureeS1, { total: j.total, taille: r.octets });
    console.log(`     RAM serveur : ${rssAvant} Mo → ${rssApres} Mo`);
    if (j.items[0]) console.log(`     trouvé : CIN=${j.items[0].cin} — ${j.items[0].employeeName} — net=${j.items[0].netSalary}`);

    // --- S2 : recherche CIN au MILIEU ---
    const cinMilieu = String(10000000 + 120000);
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips?cin=${cinMilieu}&limit=20`, { headers: H });
    j = JSON.parse(r.texte);
    mesure(`S2 recherche CIN ${cinMilieu} (milieu)`, Date.now() - t, { total: j.total, taille: r.octets });

    // --- S3 : recherche CIN ABSENT ---
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips?cin=99999999&limit=20`, { headers: H });
    j = JSON.parse(r.texte);
    mesure("S3 recherche CIN absent (99999999)", Date.now() - t, { total: j.total, taille: r.octets });
    console.log(`     RAM serveur après recherches : ${rssMo(pidSrv)} Mo`);

    // --- D1 : détail d'une fiche par id (champ employeeName chiffré en base :
    //     on prend simplement la fiche du milieu via un CIN connu du jeu de test) ---
    const idFiche = (await prisma.payslip.findFirst({ select: { id: true }, orderBy: { uploadedAt: "asc" }, skip: 150000 })).id;
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips/${idFiche}`, { headers: H });
    j = JSON.parse(r.texte);
    mesure("D1 détail fiche par id", Date.now() - t, { taille: r.octets });
    if (j.cin) console.log(`     détail : CIN=${j.cin} — ${j.employeeName} — ${j.content.length} caractères de contenu`);

    // --- L0 : liste ILLIMITÉE (240 000 items) ---
    rssAvant = rssMo(pidSrv);
    t = Date.now();
    r = await httpRequete("GET", `${ADMIN}/api/payslips`, { headers: H, timeoutMs: 600000 });
    const dureeL0 = Date.now() - t;
    j = JSON.parse(r.texte);
    rssApres = rssMo(pidSrv);
    mesure("L0 liste ILLIMITÉE (240 000 fiches)", dureeL0, { items: j.items.length, taille: r.octets });
    console.log(`     RAM serveur : ${rssAvant} Mo → ${rssApres} Mo`);

    // --- état final ---
    const tailleDb = fs.statSync(DB).size;
    console.log(`\nTaille finale base : ${fmtOc(tailleDb)} — RAM serveur finale : ${rssMo(pidSrv)} Mo`);
    console.log("\n===== FIN MESURES =====");
    try { admin.kill("SIGTERM"); } catch { }
    await attendre(500);
    process.exit(0);
  } catch (e) {
    console.error("ERREUR HARNAIS:", e.message || e);
    process.exit(1);
  } finally {
    try { if (admin) admin.kill("SIGTERM"); } catch { }
    await prisma.$disconnect().catch(() => undefined);
  }
}

/* ------------------------------ indexation ------------------------------ */
async function phaseIndexation() {
  let admin = null;
  try {
    if (!(await portLibre(PORT))) throw new Error(`port ${PORT} déjà occupé`);
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const pidSrv = admin.pid;
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);

    await prisma.user.deleteMany({});
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT Volume (Task 112)", passwordHash: hashPassword(MDP_IT),
        role: "IT", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequete("POST", `${ADMIN}/api/auth/login`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL_IT, password: MDP_IT }), timeoutMs: 60000 });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) { const m = c.match(/auto_rh_session=([^;]+)/); if (m) cookie = m[1]; }
    if (loginR.status !== 200 || !cookie) throw new Error("login IT échoué " + loginR.status);
    const H = { Cookie: `auto_rh_session=${cookie}` };

    const st = await httpRequete("GET", `${ADMIN}/api/payslips/indexation`, { headers: H, timeoutMs: 60000 });
    const js = JSON.parse(st.texte);
    console.log(`État initial : ${JSON.stringify(js)}`);

    const t0 = Date.now();
    const LIMITE_MS = 480000; // 8 min max par exécution (idempotent : relancer pour continuer)
    let appels = 0, cumule = 0;
    for (;;) {
      const t = Date.now();
      const r = await httpRequete("POST", `${ADMIN}/api/payslips/indexation`, { headers: H, timeoutMs: 120000 });
      const j = JSON.parse(r.texte);
      if (r.status !== 200) { console.log("  réponse indexation:", r.texte.slice(0, 200)); throw new Error("indexation KO " + r.status); }
      appels++;
      cumule += j.traites || 0;
      if (appels % 10 === 0 || j.termine) {
        console.log(`  appel #${appels} — traites appel=${j.traites} cumul=${cumule} restants=${j.restants} (${fmtDur(j.dureeMs)} appel, ${fmtDur(Date.now() - t0)} total)`);
      }
      if (j.termine) {
        const rss = rssMo(pidSrv);
        console.log(`\nINDEXATION TERMINÉE : ${cumule} fiches indexées en ${appels} appels — ${fmtDur(Date.now() - t0)} — RAM serveur ${rss} Mo`);
        const tailleDb = fs.statSync(DB).size;
        console.log(`Taille base après indexation : ${fmtOc(tailleDb)}`);
        break;
      }
      if (Date.now() - t0 > LIMITE_MS) {
        console.log(`\nPAUSE (budget 8 min écoulé) : ${cumule} fiches indexées, ${j.restants} restantes — RELANCER la même commande pour continuer (idempotent).`);
        break;
      }
    }
    try { admin.kill("SIGTERM"); } catch { }
    await attendre(500);
    process.exit(0);
  } catch (e) {
    console.error("ERREUR HARNAIS:", e.message || e);
    process.exit(1);
  } finally {
    try { if (admin) admin.kill("SIGTERM"); } catch { }
    await prisma.$disconnect().catch(() => undefined);
  }
}

/* ------------------------------ main ------------------------------ */
(async () => {
  const phase = process.argv[2] || "tout";
  try {
    if (phase === "seed" || phase === "tout") await phaseSeed();
    if (phase === "indexation" || phase === "tout") await phaseIndexation();
    if (phase === "mesures" || phase === "tout") await phaseMesures();
  } catch (e) {
    console.error("ERREUR:", e.message || e);
    process.exit(1);
  }
})();
