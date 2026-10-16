/**
 * ============================================================================
 * Task 104 — « ce fichier n'est pas découpé » (20_fiches_de_paie_specimen.pdf)
 * — harnais E2E sur build sandbox (correctif groupMultiPayslips).
 * ============================================================================
 * CAUSE (prouvée par test104_specimen.js, code RÉEL 0.2.30) : les 20 pages du
 * PDF portent le MÊME CIN fictif 07451236 (écrit « CIN : », « C.I.N. : »,
 * « Carte ID : ») avec 20 employés DIFFÉRENTS (EMP-0001..0020, noms tous
 * distincts). La règle historique « pages consécutives + même CIN = une fiche
 * qui déborde » fusionnait tout → groupMultiPayslips = null → 1 seul
 * enregistrement, fichier non découpé.
 *
 * CORRECTIF : dans groupMultiPayslips, des pages consécutives du même CIN
 * démarrent une NOUVELLE fiche quand leur IDENTITÉ diffère (nom substantiel-
 * lement différent — similarité bigrammes ≥ 0.75 sinon — ou matricule
 * différent si un nom manque). Une page de continuation répète l'identité de
 * SON employé : jamais touchée.
 *
 * Preuves attendues (build sandbox, base dédiée) :
 *   P0  serveur standalone 4310 + compte IT + login
 *   P1  upload du PDF utilisateur → SUCCESS, created = 20, message
 *       « 20 fiches individuelles créées »
 *   P2  base : 20 fiches cin=07451236, 20 noms distincts, 20 fichiers
 *       individuels distincts, pageNumber=1, nom affiché « (page N).pdf »
 *   P3  fichiers : le PDF individuel de 3 employés échantillonnés = 1 page,
 *       contient LEUR nom et pas celui d'un autre employé
 *   P4  NON-RÉGRESSION : fiche 2 pages même personne (en-tête répété) →
 *       1 enregistrement (comportement historique préservé)
 *   P5  NON-RÉGRESSION : 3 copies strictement identiques → 3 fiches
 *       individuelles (correctif Task 101 préservé)
 *   P6  l'original complet n'est plus référencé et son fichier supprimé
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
const PORT_ADMIN = 4310;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const DB = path.join(ROOT, "db", "custom.db");
const STORAGE = path.join(ROOT, "storage", "payslips");
const SECRET = "t104-secret-test-harnais";

process.env.DATABASE_URL = "file:" + DB; // AVANT tout require Prisma (leçon Task 98)
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();
const { PDFDocument, StandardFonts } = require(path.join(ROOT, "node_modules", "pdf-lib"));
const { PDFParse } = require(path.join(ROOT, "node_modules", "pdf-parse"));

const EMAIL_IT = "it-specimen@autorh.local";
const MDP_IT = "It2026!t104";

/* ------------------------------ HTTP ------------------------------------- */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout GET " + url)));
  });
}
function httpRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(body ? { "Content-Length": body.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(180000, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (body) req.write(body);
    req.end();
  });
}
function multipart(files) {
  const boundary = "----auto-rh104" + crypto.randomBytes(8).toString("hex");
  const parts = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type || "application/pdf"}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: "multipart/form-data; boundary=" + boundary };
}
async function attendreServeur(url) {
  for (let i = 0; i < 120; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
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

/* --------------------- PDF de synthèse (pdf-lib) -------------------------- */
async function pdfSynthese(pagesTextes) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lignes of pagesTextes) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    for (const l of lignes) {
      page.drawText(l, { x: 50, y, size: 11, font });
      y -= 22;
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/* --------------------------- decrypt stockage ----------------------------- */
function decryptStorage(buf) {
  const MAGIC = Buffer.from("PAIESAGE1", "utf8"); // 9 octets (pas 8 !)
  if (!(buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC))) return buf;
  const nonce = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const data = buf.subarray(MAGIC.length + 28);
  const key = crypto.scryptSync(SECRET, "autorh-storage-v1", 32);
  const d = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}

/* --------------------------- verdicts ------------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}
process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

(async () => {
  let admin = null;
  let errAdmin = "";
  try {
    /* ---------------- P0 : serveur + compte IT + login ---------------- */
    console.log("=== P0 : serveur standalone + login IT ===");
    if (!(await portLibre(PORT_ADMIN))) throw new Error(`port ${PORT_ADMIN} déjà occupé`);
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT_ADMIN), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => { errAdmin = (errAdmin + c).slice(-40000); });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);

    await prisma.payslip.deleteMany({});
    await prisma.user.deleteMany({});
    // stockage sandbox vidé (le P6 compte les orphelins)
    try { fs.mkdirSync(STORAGE, { recursive: true }); for (const f of fs.readdirSync(STORAGE)) fs.unlinkSync(path.join(STORAGE, f)); } catch (_) { /* ignore */ }
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT Specimen (Task 104)", passwordHash: hashPassword(MDP_IT),
        role: "IT", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequest("POST", `${ADMIN}/api/auth/login`, { headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({ email: EMAIL_IT, password: MDP_IT })) });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
    verdict("P0.loginIT", loginR.status === 200 && Boolean(cookie), `login IT → ${loginR.status}`);
    const auth = { Cookie: `auto_rh_session=${cookie}` };
    const uploader = (fichier, nom) => {
      const mp = multipart([{ name: "files", filename: nom, data: fichier }]);
      return httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { ...auth, "Content-Type": mp.contentType }, body: mp.body });
    };

    /* ------------- P1 : upload du fichier utilisateur ------------------ */
    console.log("=== P1 : upload « 20_fiches_de_paie_specimen.pdf » ===");
    const specimen = fs.readFileSync("/home/z/my-project/upload/20_fiches_de_paie_specimen.pdf");
    const r1 = await uploader(specimen, "20_fiches_de_paie_specimen.pdf");
    const j1 = JSON.parse((r1.body || "{}").results ? r1.body : JSON.stringify({ results: JSON.parse(r1.body || "{}").results || [] }));
    const res1 = (j1.results || [])[0] || {};
    verdict("P1.status", r1.status === 200 && res1.status === "SUCCESS", `HTTP ${r1.status}, status=${res1.status}, message=${(res1.message || "").slice(0, 90)}`);
    verdict("P1.created20", res1.created === 20, `created=${res1.created}`);
    verdict("P1.message", /20 fiches individuelles/i.test(res1.message || ""), res1.message || "(vide)");

    /* ------------- P2 : état en base ----------------------------------- */
    console.log("=== P2 : base de données ===");
    const brut = await prisma.payslip.findMany({ orderBy: { sourcePage: "asc" } });
    const fiches = brut.map((f) => cryptoBd.dechiffrerObjet("Payslip", f)); // champs AES (leçon carte chiffrage)
    verdict("P2.20Fiches", fiches.length === 20, `payslips en base = ${fiches.length}`);
    verdict("P2.cinUnique", fiches.every((f) => f.cin === "07451236"), `cins = ${[...new Set(fiches.map((f) => f.cin))].join(",")}`);
    const noms = fiches.map((f) => f.employeeName);
    verdict("P2.20NomsDistincts", new Set(noms).size === 20, `noms (${noms.length}) : ${noms.slice(0, 3).join(" | ")} …`);
    const stNames = fiches.map((f) => f.storedName);
    verdict("P2.20FichiersDistincts", new Set(stNames).size === 20, `storedName distincts = ${new Set(stNames).size}`);
    verdict("P2.taillesIndividuelles", fiches.every((f) => f.fileSize > 0 && f.fileSize < specimen.length), `tailles ${Math.min(...fiches.map((f) => f.fileSize))}..${Math.max(...fiches.map((f) => f.fileSize))} < original ${specimen.length}`);
    verdict("P2.pageNumber1", fiches.every((f) => f.pageNumber === 1), `pageNumber = {[...new Set(fiches.map(f=>f.pageNumber))].join(",")}`);
    verdict("P2.nomAffiche", fiches.every((f) => /20_fiches_de_paie_specimen \(page \d+\)\.pdf$/.test(f.fileName || "")), fiches[0].fileName);
    verdict("P2.sourcePage", fiches.every((f, i) => f.sourcePage === i + 1), `sourcePage 1..20 = ${fiches.map((f) => f.sourcePage).join(",")}`);

    /* ------------- P3 : fichiers individuels découpés ------------------ */
    console.log("=== P3 : contenu des PDF individuels (déchiffrés) ===");
    for (const idx of [0, 10, 19]) {
      const f = fiches[idx];
      const brutF = fs.readFileSync(path.join(STORAGE, f.storedName));
      const pdf = decryptStorage(brutF);
      let pages = -1, texte = "";
      try {
        const doc = await PDFDocument.load(pdf);
        pages = doc.getPageCount();
      } catch { /* pages = -1 */ }
      try {
        const parser = new PDFParse({ data: pdf });
        const r = await parser.getText();
        texte = r.text || "";
        await parser.destroy().catch(() => undefined);
      } catch { /* texte vide */ }
      const sonNom = f.employeeName;
      const autres = noms.filter((n) => n !== sonNom);
      const aUnAutre = autres.some((n) => n && texte.includes(n));
      verdict(`P3.f${idx + 1} [${sonNom}]`, pages === 1 && texte.includes(sonNom) && !aUnAutre,
        `pages=${pages}, nomPrésent=${texte.includes(sonNom)}, autreNomPrésent=${aUnAutre}, taillePDF=${pdf.length}`);
    }

    /* ------------- P4 : NON-RÉGRESSION fiche 2 pages même personne ----- */
    console.log("=== P4 : fiche 2 pages, même personne → 1 enregistrement ===");
    const nbAvant = await prisma.payslip.count();
    const pdf2p = await pdfSynthese([
      ["FICHE DE PAIE", "Societe Demo", "Nom et prenom Amine Ben Ali", "CIN : 09593103", "Salaire de base 1450,000", "Total brut 1520,000"],
      ["FICHE DE PAIE", "Societe Demo", "Nom et prenom Amine Ben Ali", "CIN : 09593103", "Prime exceptionnelle 200,000", "Net a payer 1240,000"],
    ]);
    const r4 = await uploader(pdf2p, "fiche_deux_pages.pdf");
    const res4 = (JSON.parse(r4.body || "{}").results || [])[0] || {};
    const nbApres4 = await prisma.payslip.count();
    const tous4 = (await prisma.payslip.findMany()).map((x) => cryptoBd.dechiffrerObjet("Payslip", x));
    const cin4 = tous4.filter((x) => x.cin === "09593103").length;
    verdict("P4.uneSeuleFiche", r4.status === 200 && res4.status === "SUCCESS" && !("created" in res4) && nbApres4 === nbAvant + 1 && cin4 === 1,
      `HTTP ${r4.status}, created=${res4.created}, delta base=${nbApres4 - nbAvant}, fiches cin 09593103=${cin4}`);

    /* ------------- P5 : NON-RÉGRESSION copies identiques (Task 101) ---- */
    console.log("=== P5 : 3 copies identiques → 3 fiches individuelles ===");
    const pageCopie = ["FICHE DE PAIE", "Societe Demo", "Nom et prenom Karim Copie", "CIN : 01112222", "Net a payer 999,000"];
    const pdf3 = await pdfSynthese([pageCopie, pageCopie, pageCopie]);
    const r5 = await uploader(pdf3, "trois_copies.pdf");
    const res5 = (JSON.parse(r5.body || "{}").results || [])[0] || {};
    const tous5 = (await prisma.payslip.findMany()).map((x) => cryptoBd.dechiffrerObjet("Payslip", x));
    const copies = tous5.filter((x) => x.cin === "01112222");
    verdict("P5.troisFiches", r5.status === 200 && res5.created === 3 && copies.length === 3 && new Set(copies.map((c) => c.storedName)).size === 3,
      `HTTP ${r5.status}, created=${res5.created}, en base=${copies.length}, fichiers distincts=${new Set(copies.map((c) => c.storedName)).size}`);

    /* ------------- P6 : original complet supprimé du stockage ---------- */
    console.log("=== P6 : original complet non conservé ===");
    const tous6 = (await prisma.payslip.findMany()).map((x) => cryptoBd.dechiffrerObjet("Payslip", x));
    const refs = tous6.map((x) => x.storedName);
    const specEnStockage = fs.existsSync(STORAGE)
      ? fs.readdirSync(STORAGE).filter((n) => !refs.includes(n))
      : [];
    verdict("P6.orphelins", specEnStockage.length === 0, `fichiers orphelins = ${specEnStockage.length}${specEnStockage.length ? " (" + specEnStockage.slice(0, 3).join(", ") + ")" : ""}`);

    console.log("\n===== RÉSULTAT : " + resultats.filter((r) => r.ok).length + " PASS, " + resultats.filter((r) => !r.ok).length + " ECHEC =====");
    if (errAdmin) console.log("[stderr serveur] " + errAdmin.slice(-600));
    process.exit(resultats.every((r) => r.ok) ? 0 : 1);
  } catch (e) {
    console.error("ERREUR HARNAIS:", e);
    if (errAdmin) console.error("[stderr serveur] " + errAdmin.slice(-1500));
    process.exit(2);
  } finally {
    try { if (admin) admin.kill("SIGTERM"); } catch (_) { /* ignore */ }
    await prisma.$disconnect().catch(() => undefined);
  }
})();
