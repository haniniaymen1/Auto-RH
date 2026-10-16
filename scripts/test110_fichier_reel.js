/**
 * ============================================================================
 * Task 110 — TEST SUR FICHIERS RÉELS de l'utilisateur (build sandbox 0.2.35)
 * ============================================================================
 * DEMANDE : « mettre de le test le fichier pdf » — passer les vrais fichiers
 * de l'utilisateur dans la build 0.2.35 pour vérifier :
 *   1) le DÉCOUPAGE (problème B : copies_150_one_pdf non découpé, les deux
 *      autres en erreur — rapport 17:43 ANTÉRIEUR au correctif 0.2.29 18:45,
 *      jamais rejoué depuis) ;
 *   2) la NOUVELLE fonctionnalité 0.2.35 : taux de fiabilité / taux d'erreur
 *      des CIN (vrais / faux / non détectés) après import.
 *
 * USAGE : node test110_fichier_reel.js <1|2|3>
 *   1 = copies_150_one_pdf.pdf                          (150 pages, scan)
 *   2 = copies_150.zip                                  (150 PDF, 13 Mo)
 *   3 = DocsFromBh225_260914145812_200_copies.pdf       (200 pages, 23 Mo)
 *
 * Chaque exécution démarre le serveur sandbox sur 4310 avec base DÉDIÉE
 * vierge, uploade LE fichier demandé, puis affiche :
 *   statut HTTP, durée, created, items (CIN/nom), fiabilité (total/vrais/
 *   faux/non détectés/taux), comptage base, trace ImportLog.
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = "/home/z/my-project/task104_specimen/app";
const SERVER = path.join(ROOT, ".next", "standalone", "task104_specimen", "app", "server.js");
const PORT = 4310;
const ADMIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, "db", "custom.db");
const STORAGE = path.join(ROOT, "storage", "payslips");
const SECRET = "t110-secret-fichiers-reels";

process.env.DATABASE_URL = "file:" + DB;
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

const EMAIL_IT = "it-reels@autorh.local";
const MDP_IT = "It2026!t110";

const FICHIERS = {
  "1": "/home/z/my-project/upload/copies_150_one_pdf.pdf",
  "2": "/home/z/my-project/upload/copies_150.zip",
  "3": "/home/z/my-project/upload/DocsFromBh225_260914145812_200_copies.pdf",
};

/* ------------------------------ HTTP ------------------------------------- */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout GET")));
  });
}
function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(body ? { "Content-Length": body.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end()".slice(0, 6), () => {});
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (body) req.write(body);
    req.end();
  });
}
function multipart(files) {
  const boundary = "----auto-rh110" + crypto.randomBytes(8).toString("hex");
  const parts = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: "multipart/form-data; boundary=" + boundary };
}
async function attendreServeur(url) {
  for (let i = 0; i < 240; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
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
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
const fmtDur = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);

(async () => {
  const choix = process.argv[2] || "1";
  const chemin = FICHIERS[choix];
  if (!chemin || !fs.existsSync(chemin)) { console.error("fichier introuvable pour le choix", choix); process.exit(2); }
  let admin = null, errAdmin = "";
  try {
    console.log(`=== Task 110 — fichier réel n°${choix} : ${path.basename(chemin)} (${fs.statSync(chemin).size} octets) ===`);
    if (!(await portLibre(PORT))) throw new Error(`port ${PORT} déjà occupé`);
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => { errAdmin = (errAdmin + c).slice(-40000); });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);

    // base vierge dédiée
    await prisma.payslip.deleteMany({});
    await prisma.importLog.deleteMany({});
    await prisma.user.deleteMany({});
    try { fs.mkdirSync(STORAGE, { recursive: true }); for (const f of fs.readdirSync(STORAGE)) fs.unlinkSync(path.join(STORAGE, f)); } catch (_) {}
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT Fichiers reels (Task 110)", passwordHash: hashPassword(MDP_IT),
        role: "IT", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequest("POST", `${ADMIN}/api/auth/login`, { headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({ email: EMAIL_IT, password: MDP_IT })), timeoutMs: 30000 });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) { const m = c.match(/auto_rh_session=([^;]+)/); if (m) cookie = m[1]; }
    if (loginR.status !== 200 || !cookie) throw new Error("login IT échoué " + loginR.status);
    console.log("login IT OK, upload en cours… (patience : scans = OCR)");

    const t0 = Date.now();
    const mp = multipart([{ name: "files", filename: path.basename(chemin), data: fs.readFileSync(chemin), type: chemin.endsWith(".zip") ? "application/zip" : "application/pdf" }]);
    const r = await httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { Cookie: `auto_rh_session=${cookie}`, "Content-Type": mp.contentType }, body: mp.body, timeoutMs: 900000 });
    const duree = Date.now() - t0;
    console.log(`\nHTTP ${r.status} — durée ${fmtDur(duree)}`);
    let j = {};
    try { j = JSON.parse(r.body || "{}"); } catch (_) { console.log("corps non JSON :", (r.body || "").slice(0, 400)); }

    if (j.fiabilite) console.log("FIABILITÉ GLOBALE :", JSON.stringify(j.fiabilite));
    if (Array.isArray(j.results)) {
      for (const res of j.results) {
        console.log(`\n— fichier « ${res.fileName} » : statut=${res.status}, created=${res.created}${res.error ? ", erreur=" + res.error : ""}`);
        if (res.fiabilite) console.log("  fiabilité fichier :", JSON.stringify(res.fiabilite));
        const items = res.items || [];
        console.log(`  items=${items.length}`);
        const cinValeurs = items.map((it) => it.cin || "(vide)");
        const uniques = [...new Set(cinValeurs)];
        console.log(`  CIN distincts (${uniques.length}) :`, uniques.slice(0, 10).join(" | "), uniques.length > 10 ? "…" : "");
        if (items[0]) console.log("  1er item :", JSON.stringify({ cin: items[0].cin, nom: items[0].employeeName, periode: items[0].period, net: items[0].netSalary, pages: items[0].pages, ocrUsed: items[0].ocrUsed || (items[0].ocr ? undefined : undefined) }));
      }
    }
    if (j.error) console.log("ERREUR globale :", j.error);

    // état en base
    const nbFiches = await prisma.payslip.count();
    console.log(`\nBase : ${nbFiches} fiche(s) de paie au total`);
    const logs = (await prisma.importLog.findMany({ orderBy: { createdAt: "asc" } })).map((l) => cryptoBd.dechiffrerObjet("ImportLog", l));
    for (const l of logs) console.log(`ImportLog [${l.status}] ${l.fileName} : ${(l.message || "").slice(0, 220)}`);
    console.log("\n===== FIN TEST fichier n°" + choix + " =====");
    if (errAdmin) console.log("[stderr serveur] " + errAdmin.slice(-800));
    try { admin.kill("SIGTERM"); } catch (_) {}
    await attendre(500);
    process.exit(0);
  } catch (e) {
    console.error("ERREUR HARNAIS:", e.message || e);
    if (errAdmin) console.error("[stderr serveur] " + errAdmin.slice(-1500));
    process.exit(1);
  } finally {
    try { if (admin) admin.kill("SIGTERM"); } catch (_) {}
    await prisma.$disconnect().catch(() => undefined);
  }
})();
