/**
 * ============================================================================
 * Task 108 — « Taux de fiabilité et taux d'erreur après l'importation »
 * — harnais E2E sur build sandbox (vérification d'authenticité des CIN).
 * ============================================================================
 * DEMANDE : calculer le taux de fiabilité et le taux d'erreur après
 * l'importation en vérifiant le nombre de CIN corrects (vrais) et de
 * numéros CIN incorrects (faux).
 *
 * RÈGLE IMPLÉMENTÉE (src/lib/cin-validation.ts) :
 *   VRAI  = format tunisien authentique (8 chiffres classique, 9 biométrique,
 *           sans lettres, sans 4 zéros en tête)
 *   FAUX  = valeur détectée hors format (lettres DEMO001234, longueur
 *           anormale, 000005678…)
 *   non détecté = aucune valeur CIN sur la fiche (ni vrai ni faux)
 *
 * PREUVES ATTENDUES (build sandbox, base dédiée, serveur 4310) :
 *   P1  Cas A : 10 fiches, CIN authentiques distincts 8 chiffres
 *       → fiabilite {total:10, vrais:10, faux:0, nonDetectes:0, 100 %, 0 %}
 *   P2  Cas B : 6 pages — 4 CIN fictifs (DEMO001234, SPEC0001, 000005678,
 *       DEMO009012) + 1 page SANS CIN (annexe de la fiche précédente) +
 *       1 CIN biométrique 9 chiffres (140000911 = vrai)
 *       → created=5, fiabilite {total:5, vrais:1, faux:4, nonDetectes:0,
 *         20 %, 80 %}
 *   P3  Import COMBINÉ (cas A + cas B + fichier corrompu en UNE requête)
 *       → processed=3, corrompu=ERROR sans fiabilite, global
 *         {total:15, vrais:11, faux:4, nonDetectes:0, 73,3 %, 26,7 %}
 *   P4  Mono-fiches : CIN authentique → {1,1,0,0,100 %,0 %} ; SANS CIN
 *       → {1,0,0,1,0 %,0 %} (catégorie « non détecté » distincte)
 *   P5  NON-RÉGRESSION Task 104 : spécimen 20 fiches même CIN 07451236
 *       → created=20, fiabilite {20,20,0,0,100 %,0 %}
 *   P6  ImportLog : chaque import journalise « — Fiabilité CIN : … » avec
 *       les comptages exacts (trace vérifiable a posteriori)
 *   P7  Base : 52 fiches, CIN stockés conformes, fiche sans CIN présente,
 *       page annexe rattachée (pageNumber=2 pour DEMO009012)
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
const SECRET = "t108-secret-test-harnais";

process.env.DATABASE_URL = "file:" + DB; // AVANT tout require Prisma (leçon Task 98)
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();
const { PDFDocument, StandardFonts } = require(path.join(ROOT, "node_modules", "pdf-lib"));

const EMAIL_IT = "it-fiabilite@autorh.local";
const MDP_IT = "It2026!t108";

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
  const boundary = "----auto-rh108" + crypto.randomBytes(8).toString("hex");
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

/* --------------------------- verdicts ------------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}
process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

/* ------------------- construction des cas de test ------------------------ */
// Cas A : 10 fiches, CIN authentiques 8 chiffres TOUS DISTINCTS
async function casA() {
  const pages = [];
  for (let i = 1; i <= 10; i++) {
    const nn = String(7451235 + i); // 07451236 .. 07451245
    pages.push([
      "FICHE DE PAIE",
      "Societe Test Fiabilite",
      `Nom et prenom Employe A${String(i).padStart(2, "0")}`,
      `CIN : 0${nn}`,
      `Matricule MAT-A${String(i).padStart(2, "0")}`,
      "Salaire de base 1450,000",
      "Total brut 1520,000",
      "Net a payer 1240,000",
    ]);
  }
  return pdfSynthese(pages);
}
// Cas B : 6 pages — CIN fictifs variés + 1 page sans CIN + 1 biométrique
async function casB() {
  return pdfSynthese([
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B01 Demo", "CIN (FORMAT FICTIF)", "DEMO 001 234", "Net a payer 1100,000"],
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B02 Spec", "CIN : SPEC-0001", "Net a payer 1200,000"],
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B03 Zeros", "CIN (FORMAT FICTIF)", "000 005 678 (INVALIDE)", "Net a payer 1300,000"],
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B04 Id", "CIN (FORMAT FICTIF)", "ID: DEMO009012", "Net a payer 1400,000"],
    // page 5 : AUCUN CIN (elle devient annexe de la fiche B04 — historique)
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B05 Sans", "Matricule MAT-B05", "Net a payer 1500,000"],
    ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom B06 Bio", "N° CIN : 140000911", "Net a payer 1600,000"],
  ]);
}

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
    await prisma.importLog.deleteMany({});
    await prisma.user.deleteMany({});
    try { fs.mkdirSync(STORAGE, { recursive: true }); for (const f of fs.readdirSync(STORAGE)) fs.unlinkSync(path.join(STORAGE, f)); } catch (_) { /* ignore */ }
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT Fiabilite (Task 108)", passwordHash: hashPassword(MDP_IT),
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
    const uploader = (fichiers) => {
      const mp = multipart(fichiers.map((f, i) => ({ name: "files", filename: f.nom, data: f.data, type: f.type })));
      return httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { ...auth, "Content-Type": mp.contentType }, body: mp.body });
    };
    const pdfA = await casA();
    const pdfB = await casB();

    /* ------------- P1 : Cas A — 10 CIN authentiques ------------------- */
    console.log("=== P1 : Cas A — 10 fiches, CIN authentiques (vrais) ===");
    const r1 = await uploader([{ nom: "cas_a_vrais.pdf", data: pdfA }]);
    const j1 = JSON.parse(r1.body || "{}");
    const res1 = (j1.results || [])[0] || {};
    const f1 = res1.fiabilite || {};
    verdict("P1.created10", r1.status === 200 && res1.created === 10, `created=${res1.created}`);
    verdict("P1.fiabilite100", f1.total === 10 && f1.vrais === 10 && f1.faux === 0 && f1.nonDetectes === 0 && f1.tauxFiabilite === 100 && f1.tauxErreur === 0,
      `fiabilite= ${JSON.stringify(f1)}`);

    /* ------------- P2 : Cas B — CIN fictifs + biométrique ------------- */
    console.log("=== P2 : Cas B — 4 CIN fictifs (faux) + 1 biométrique (vrai) + 1 annexe ===");
    const r2 = await uploader([{ nom: "cas_b_mixtes.pdf", data: pdfB }]);
    const j2 = JSON.parse(r2.body || "{}");
    const res2 = (j2.results || [])[0] || {};
    const f2 = res2.fiabilite || {};
    const cins2 = (res2.items || []).map((it) => it.cin);
    verdict("P2.created5", r2.status === 200 && res2.created === 5, `created=${res2.created} (page sans CIN = annexe)`);
    verdict("P2.cinsAttendus", JSON.stringify(cins2) === JSON.stringify(["DEMO001234", "SPEC0001", "000005678", "DEMO009012", "140000911"]), `cins=${cins2.join(",")}`);
    verdict("P2.fiabilite20_80", f2.total === 5 && f2.vrais === 1 && f2.faux === 4 && f2.nonDetectes === 0 && f2.tauxFiabilite === 20 && f2.tauxErreur === 80,
      `fiabilite= ${JSON.stringify(f2)}`);

    /* ------------- P3 : import combiné + fichier corrompu ------------- */
    console.log("=== P3 : import COMBINÉ (A + B + corrompu) en une requête ===");
    const r3 = await uploader([
      { nom: "combo_vrais.pdf", data: pdfA },
      { nom: "combo_mixtes.pdf", data: pdfB },
      { nom: "corrompu.pdf", data: Buffer.from("ceci n'est pas un pdf") },
    ]);
    const j3 = JSON.parse(r3.body || "{}");
    const f3 = j3.fiabilite || {};
    const statuts3 = (j3.results || []).map((r) => r.status);
    verdict("P3.processed3", j3.processed === 3 && statuts3.join(",") === "SUCCESS,SUCCESS,ERROR", `processed=${j3.processed}, statuts=${statuts3.join(",")}`);
    verdict("P3.corrompuSansFiabilite", !(j3.results || [])[2]?.fiabilite, "le fichier en ERREUR n'a pas de fiabilite (0 fiche créée)");
    verdict("P3.global73_26", f3.total === 15 && f3.vrais === 11 && f3.faux === 4 && f3.nonDetectes === 0 && f3.tauxFiabilite === 73.3 && f3.tauxErreur === 26.7,
      `global= ${JSON.stringify(f3)}`);

    /* ------------- P4 : mono-fiches (vrai + sans CIN) ------------------ */
    console.log("=== P4 : mono-fiches — CIN vrai, puis fiche SANS CIN ===");
    const monoVrai = await pdfSynthese([
      ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom Mono Vrai", "CIN : 09593103", "Net a payer 1240,000"],
    ]);
    const r4a = await uploader([{ nom: "mono_vrai.pdf", data: monoVrai }]);
    const fa = ((JSON.parse(r4a.body || "{}").results || [])[0] || {}).fiabilite || {};
    verdict("P4a.monoVrai100", fa.total === 1 && fa.vrais === 1 && fa.tauxFiabilite === 100 && fa.tauxErreur === 0, `fiabilite= ${JSON.stringify(fa)}`);
    const monoSans = await pdfSynthese([
      ["FICHE DE PAIE", "Societe Test Fiabilite", "Nom et prenom Mono Sans", "Matricule MAT-NO", "Net a payer 1250,000"],
    ]);
    const r4b = await uploader([{ nom: "mono_sans_cin.pdf", data: monoSans }]);
    const res4b = (JSON.parse(r4b.body || "{}").results || [])[0] || {};
    const fb = res4b.fiabilite || {};
    verdict("P4b.monoSansCin", res4b.status === "SUCCESS" && fb.total === 1 && fb.vrais === 0 && fb.faux === 0 && fb.nonDetectes === 1 && fb.tauxFiabilite === 0 && fb.tauxErreur === 0,
      `fiabilite= ${JSON.stringify(fb)}`);

    /* ------------- P5 : NON-RÉGRESSION spécimen Task 104 --------------- */
    console.log("=== P5 : spécimen 20 fiches (Task 104) → 20 vrais, 100 % ===");
    const specimen = fs.readFileSync("/home/z/my-project/upload/20_fiches_de_paie_specimen.pdf");
    const r5 = await uploader([{ nom: "20_fiches_de_paie_specimen.pdf", data: specimen }]);
    const res5 = (JSON.parse(r5.body || "{}").results || [])[0] || {};
    const f5 = res5.fiabilite || {};
    verdict("P5.specimen20", res5.created === 20, `created=${res5.created}`);
    verdict("P5.fiabiliteSpecimen", f5.total === 20 && f5.vrais === 20 && f5.faux === 0 && f5.tauxFiabilite === 100, `fiabilite= ${JSON.stringify(f5)}`);

    /* ------------- P6 : ImportLog journalisé --------------------------- */
    console.log("=== P6 : ImportLog — trace « Fiabilité CIN » vérifiable ===");
    const logsBrut = await prisma.importLog.findMany({ orderBy: { createdAt: "asc" } });
    // (leçon Task 104) champs ImportLog chiffrés en base → déchiffrer AVANT lecture
    const logs = logsBrut.map((l) => cryptoBd.dechiffrerObjet("ImportLog", l));
    const casALog = logs.find((l) => l.fileName === "cas_a_vrais.pdf");
    const casBLog = logs.find((l) => l.fileName === "cas_b_mixtes.pdf");
    const sansLog = logs.find((l) => l.fileName === "mono_sans_cin.pdf");
    verdict("P6.nombreEntrees", logs.length === 8, `entrées ImportLog = ${logs.length} (attendu 8 : 1+1+3+1+1+1 fichiers uploadés)`);
    verdict("P6.casA", /Fiabilité CIN : 100 % \(10 vrais, 0 faux, 0 non détecté sur 10 fiches\) — taux d'erreur : 0 %/.test(casALog?.message || ""), casALog?.message?.slice(-110) || "(absent)");
    verdict("P6.casB", /Fiabilité CIN : 20 % \(1 vrai, 4 faux, 0 non détectés sur 5 fiches\) — taux d'erreur : 80 %/.test(casBLog?.message || ""), casBLog?.message?.slice(-110) || "(absent)");
    verdict("P6.sansCin", /Fiabilité CIN : 0 % \(0 vrai, 0 faux, 1 non détecté sur 1 fiche\) — taux d'erreur : 0 %/.test(sansLog?.message || ""), sansLog?.message?.slice(-110) || "(absent)");

    /* ------------- P7 : état en base ----------------------------------- */
    console.log("=== P7 : base de données — 52 fiches, CIN conformes ===");
    const brut = await prisma.payslip.findMany();
    const fiches = brut.map((f) => cryptoBd.dechiffrerObjet("Payslip", f));
    verdict("P7.total52", fiches.length === 52, `payslips en base = ${fiches.length} (10+5+15+1+1+20)`);
    const demo = fiches.filter((f) => f.cin === "DEMO001234").length;
    const zeros = fiches.filter((f) => f.cin === "000005678").length;
    const bio = fiches.filter((f) => f.cin === "140000911").length;
    verdict("P7.cinsStockés", demo === 2 && zeros === 2 && bio === 2, `DEMO001234=${demo}, 000005678=${zeros}, 140000911=${bio} (×2 : P2 + P3)`);
    const sansCin = fiches.filter((f) => !f.cin || !f.cin.trim());
    verdict("P7.ficheSansCin", sansCin.length === 1, `fiches sans CIN = ${sansCin.length} (mono_sans_cin.pdf)`);
    const demoFiches = fiches.filter((f) => f.cin === "DEMO009012");
    verdict("P7.annexeRattachée", demoFiches.length === 2 && demoFiches.every((f) => f.pageNumber === 2),
      `fiches DEMO009012 = ${demoFiches.length}, pageNumber=${demoFiches.map((f) => f.pageNumber).join(",")} (attendu 2,2 : page 5 sans CIN = annexe)`);

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
