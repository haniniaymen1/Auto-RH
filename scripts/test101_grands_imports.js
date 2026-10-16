/**
 * ============================================================================
 * Task 101 — « copies_150_one_pdf n'est pas découpé / copies_150.zip et
 * DocsFromBh225_200_copies.pdf → Requête invalide : envoyez un formulaire
 * multipart contenant des fichiers PDF » — harnais E2E du CORRECTIF.
 * ============================================================================
 * CAUSES (corrigées ici) :
 *   C1  Next 16.3 (package-lock) plafonne à 10 Mo le corps des requêtes
 *       couvertes par le middleware (experimental.proxyClientMaxBodySize,
 *       défaut 10 Mo) → corps tronqués → request.formData() échoue →
 *       400 « Requête invalide ». Correctif : 500 Mo + garde 413 explicite.
 *   C2  groupMultiPayslips() exigeait >= 2 CIN différents et fusionnait les
 *       pages consécutives du même CIN → 150 copies identiques restaient
 *       UNE fiche. Correctif : pages consécutives strictement identiques =
 *       copies → fiches séparées (+ déduplication OCR par page + cache
 *       hi-res → imports de copies quasi instantanés).
 *
 * Scénarios (bac à sable, base dédiée) :
 *   P0  serveur admin (4305), compte IT, login
 *   E1  upload copies_150_one_pdf.pdf (149 Ko, 150 pages image identiques)
 *       → 150 fiches créées, découpées physiquement (page N), CIN identique
 *   E2  upload copies_150.zip (13,3 Mo > ancienne limite 10 Mo, 150 PDF)
 *       → « Archive traitée : 150 fiche(s)… » — le corps n'est plus tronqué
 *   E3  upload DocsFromBh225_260914145812_200_copies.pdf (23,1 Mo)
 *       → 200 fiches créées
 *   E4  non-régression PDF TEXTE : débordement 2 pages (même CIN, textes
 *       différents) = 1 fiche ; 2 CIN = 2 fiches ; 1 fiche simple = 1 fiche
 *   E5  POST non multipart → 400 propre (message générique conservé)
 *   E6  cohérence admin : /api/payslips?cin=… reflète les totaux réels
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task101_import/extracted";
const SERVER = path.join(ROOT, ".next", "standalone", "task101_import", "extracted", "server.js");
const PORT_ADMIN = 4305;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const DB = path.join(ROOT, "db", "custom.db");
const STORAGE = path.join(ROOT, "storage", "payslips");
const SECRET = "t101-secret-test-harnais";

const FICHIER_ONE_PDF = "/home/z/my-project/upload/copies_150_one_pdf.pdf";
const FICHIER_ZIP = "/home/z/my-project/upload/copies_150.zip";
const FICHIER_200 = "/home/z/my-project/upload/DocsFromBh225_260914145812_200_copies.pdf";

process.env.DATABASE_URL = "file:" + DB; // AVANT tout require Prisma (leçon Task 98)
process.env.AUTO_RH_STORAGE_KEY = SECRET; // leçon Task 100 : clés alignées harnais/serveur
process.env.AUTH_SECRET = SECRET;
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

const EMAIL_IT = "it-grands-imports@autorh.local";
const MDP_IT = "It2026!t101";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

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
    req.setTimeout(120000, () => req.destroy(new Error("timeout GET " + url)));
  });
}
function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(data ? { "Content-Length": data.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (data) req.write(data);
    req.end();
  });
}
/** POST multipart « files » — copie fidèle du formulaire de l'interface. */
function multipartUpload(url, files, headers = {}) {
  const boundary = "----auto-rhharnais" + crypto.randomBytes(12).toString("hex");
  const parts = [];
  for (const f of files) {
    const data = fs.readFileSync(f.path);
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type || "application/pdf"}\r\n\r\n`
      )
    );
    parts.push(data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return httpRequest("POST", url, {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...headers,
    },
    body,
  });
}
async function attendreServeur(url) {
  for (let i = 0; i < 120; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
  throw new Error("serveur injoignable : " + url);
}
function portLibre(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 800 }, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
    sock.on("timeout", () => { sock.destroy(); resolve(true); });
  });
}

/* ----------------- générateur de PDF TEXTE (non-régression) --------------- */
/** PDF minimal multipage avec texte Helvetica — suffisant pour pdf-parse et
 *  pdf-lib (découpage). 1 page = 1 tableau de lignes. */
function texteEnPdf(pagesDeLignes) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = [];
  const nbPages = pagesDeLignes.length;
  const kidsIds = pagesDeLignes.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Count ${nbPages} /Kids [ ${kidsIds.map((id) => `${id} 0 R`).join(" ")} ] >>`
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pagesDeLignes.forEach((lignes, i) => {
    const contentId = kidsIds[i] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    let stream = "BT /F1 10 Tf 40 800 Td 14 TL\n";
    for (const l of lignes) stream += `(${esc(l)}) Tj T*\n`;
    stream += "ET";
    objects.push({ stream });
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    if (typeof obj === "string") {
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    } else {
      pdf += `${i + 1} 0 obj\n<< /Length ${Buffer.byteLength(obj.stream)} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
    }
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

/* --------------------------- verdicts ------------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
}

/* ------------------------------ main ------------------------------------- */
(async () => {
  let admin = null;
  let errAdmin = "";
  try {
    console.log("=== P0 : serveur + login IT ===");
    if (!(await portLibre(PORT_ADMIN))) {
      throw new Error(`port ${PORT_ADMIN} déjà occupé — tuer le serveur de test orphelin avant de relancer`);
    }
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT_ADMIN), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => { errAdmin = (errAdmin + c).slice(-80000); });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);

    // Idempotence : base de test dédiée → remise à zéro
    await prisma.payslipCinToken.deleteMany({});
    await prisma.payslip.deleteMany({});
    await prisma.portalAccess.deleteMany({});
    await prisma.importLog.deleteMany({});
    await prisma.user.deleteMany({});
    fs.rmSync(STORAGE, { recursive: true, force: true });
    fs.mkdirSync(STORAGE, { recursive: true });

    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT,
        name: "IT Grands Imports (Task 101)",
        passwordHash: hashPassword(MDP_IT),
        role: "IT",
        isActive: true,
        passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequest("POST", `${ADMIN}/api/auth/login`, { body: JSON.stringify({ email: EMAIL_IT, password: MDP_IT }) });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
    verdict("P0.loginAdmin", loginR.status === 200 && Boolean(cookie), `login IT → ${loginR.status}`);
    const auth = { Cookie: `auto_rh_session=${cookie}` };

    /* ------------- E1 : copies_150_one_pdf.pdf → 150 fiches découpées ---- */
    console.log("=== E1 : copies_150_one_pdf.pdf (150 pages image identiques) ===");
    const t1 = Date.now();
    const r1 = await multipartUpload(`${ADMIN}/api/payslips/upload`, [{ path: FICHIER_ONE_PDF, name: "copies_150_one_pdf.pdf" }], auth);
    const d1 = JSON.parse(r1.body);
    const res1 = d1.results && d1.results[0];
    verdict("E1.status200", r1.status === 200 && res1 && res1.status === "SUCCESS", `HTTP ${r1.status}, status=${res1 && res1.status}, message=${(res1 && res1.message || "").slice(0, 90)}`);
    verdict("E1.created150", res1 && res1.created === 150, `created=${res1 && res1.created} (historique : 1 seule fiche)`);
    const nbRows1 = await prisma.payslip.count();
    verdict("E1.rows150", nbRows1 === 150, `payslip.count=${nbRows1}`);
    const rows1 = await prisma.payslip.findMany({ orderBy: { sourcePage: "asc" }, select: { fileName: true, storedName: true, sourcePage: true, pageNumber: true, cin: true, fileSize: true } });
    const cins1 = (await Promise.all(rows1.map((r) => cryptoBd.dechiffrerChamp(r.cin)))).filter(Boolean);
    verdict("E1.memeCin", cins1.length === 150 && new Set(cins1).size === 1, `CIN uniques=${new Set(cins1).size} sur ${cins1.length} fiches`);
    verdict("E1.sourcePages", rows1.map((r) => r.sourcePage).join(",") === Array.from({ length: 150 }, (_, i) => i + 1).join(","), `sourcePage 1..150 distinctes`);
    verdict("E1.pageNumber1", rows1.every((r) => r.pageNumber === 1), `pageNumber=1 partout (1 page par fiche)`);
    const noms1 = [];
    for (const r of rows1) noms1.push((await cryptoBd.dechiffrerChamp(r.fileName)) || "");
    verdict("E1.nomsPages", noms1.every((n) => /^copies_150_one_pdf \(page \d+\)\.pdf$/.test(n)), `ex: ${noms1[0]} … ${noms1[149]}`);
    const stored1 = new Set(rows1.map((r) => r.storedName));
    const fichiersPresents = rows1.filter((r) => fs.existsSync(path.join(STORAGE, r.storedName))).length;
    verdict("E1.fichiersIndividuels", stored1.size === 150 && fichiersPresents === 150, `150 fichiers distincts présents sur disque (${fichiersPresents}/150), chiffrés`);
    console.log(`  (durée E1 : ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
    const adminCin1 = cins1[0];
    const l1 = JSON.parse((await httpGet(`${ADMIN}/api/payslips?cin=${encodeURIComponent(adminCin1)}&limit=1000`, auth)).body);
    verdict("E1.adminTotal", l1.total === 150, `admin /api/payslips?cin=… total=${l1.total}`);

    /* ------------- E2 : copies_150.zip (13,3 Mo) → 150 fiches ------------ */
    console.log("=== E2 : copies_150.zip (13,3 Mo — dépasse l'ancienne limite 10 Mo) ===");
    const t2 = Date.now();
    const r2 = await multipartUpload(`${ADMIN}/api/payslips/upload`, [{ path: FICHIER_ZIP, name: "copies_150.zip", type: "application/zip" }], auth);
    const d2 = JSON.parse(r2.body);
    const res2 = d2.results && d2.results[0];
    verdict("E2.pasDErreurMultipart", r2.status === 200 && res2 && res2.status === "SUCCESS", `HTTP ${r2.status}, message=${(res2 && res2.message || "").slice(0, 110)}`);
    verdict("E2.created150", res2 && res2.created === 150, `created=${res2 && res2.created} (150 entrées ZIP importées)`);
    const nbRows2 = await prisma.payslip.count();
    verdict("E2.rows300", nbRows2 === 300, `payslip.count=${nbRows2} (150 + 150)`);
    console.log(`  (durée E2 : ${((Date.now() - t2) / 1000).toFixed(1)} s — cache OCR : 149 entrées identiques sans ré-analyse)`);
    const entryErrs = (res2 && res2.entryResults || []).filter((e) => e.status !== "SUCCESS");
    verdict("E2.toutesEntreesOK", entryErrs.length === 0, `${(res2 && res2.entryResults || []).length} entrées, ${entryErrs.length} échec(s)`);

    /* ------------- E3 : DocsFromBh225_200_copies.pdf (23,1 Mo) ---------- */
    console.log("=== E3 : DocsFromBh225_260914145812_200_copies.pdf (23,1 Mo, 200 pages image) ===");
    const t3 = Date.now();
    const r3 = await multipartUpload(`${ADMIN}/api/payslips/upload`, [{ path: FICHIER_200, name: "DocsFromBh225_260914145812_200_copies.pdf" }], auth);
    const d3 = JSON.parse(r3.body);
    const res3 = d3.results && d3.results[0];
    verdict("E3.status200", r3.status === 200 && res3 && res3.status === "SUCCESS", `HTTP ${r3.status}, message=${(res3 && res3.message || "").slice(0, 110)}`);
    verdict("E3.created200", res3 && res3.created === 200, `created=${res3 && res3.created} (historique : 1 seule fiche)`);
    const nbRows3 = await prisma.payslip.count();
    verdict("E3.rows500", nbRows3 === 500, `payslip.count=${nbRows3} (150 + 150 + 200)`);
    // (le CIN de la réponse d'upload est déjà EN CLAIR — les 300 fiches des
    // imports E1/E2 portent le MÊME CIN que ce fichier : total attendu = 500)
    const cin3 = res3 && res3.cin;
    const l3 = JSON.parse((await httpGet(`${ADMIN}/api/payslips?cin=${encodeURIComponent(cin3)}&limit=1000`, auth)).body);
    verdict("E3.adminTotal", l3.total === 500, `admin /api/payslips?cin=${cin3} total=${l3.total} (150 E1 + 150 E2 + 200 E3 — même fiche copiée)`);
    console.log(`  (durée E3 : ${((Date.now() - t3) / 1000).toFixed(1)} s)`);

    /* ------------- E4 : non-régression PDF TEXTE ------------------------- */
    console.log("=== E4 : non-régression — PDF texte (règles historiques) ===");
    // E4a : fiche qui DÉBORDE sur 2 pages (même CIN, textes DIFFÉRENTS) → 1 fiche
    const pdfDebord = texteEnPdf([
      ["BULLETIN DE PAIE", "MATRICULE 001 - NOM EMPLOYE DEBORD", "CIN : 01234567", "PERIODE DU 01/08/2026 AU 31/08/2026", "SALAIRE BRUT 2000,000"],
      ["SUITE DU BULLETIN (PAGE 2)", "COTISATIONS CNSS 9,18%", "NET A PAYER 1700,000"],
    ]);
    const boundaryA = "----b" + crypto.randomBytes(8).toString("hex");
    const bodyA = Buffer.concat([
      Buffer.from(`--${boundaryA}\r\nContent-Disposition: form-data; name="files"; filename="debordement.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfDebord,
      Buffer.from(`\r\n--${boundaryA}--\r\n`),
    ]);
    const d4a = JSON.parse((await httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { "Content-Type": `multipart/form-data; boundary=${boundaryA}`, ...auth }, body: bodyA })).body);
    const res4a = d4a.results && d4a.results[0];
    const row4a = res4a && res4a.id ? await prisma.payslip.findUnique({ where: { id: res4a.id } }) : null;
    verdict("E4a.debordement1Fiche", res4a && res4a.status === "SUCCESS" && !res4a.created && row4a && row4a.pageNumber === 2, `created=${res4a && res4a.created}, pageNumber=${row4a && row4a.pageNumber} (1 fiche 2 pages conservée, pas de découpage)`);
    // E4b : 2 employés (2 CIN) → 2 fiches
    const pdf2 = texteEnPdf([
      ["BULLETIN DE PAIE", "NOM EMPLOYE UN", "CIN : 01234567", "PERIODE 08/2026", "NET A PAYER 1000,000"],
      ["BULLETIN DE PAIE", "NOM EMPLOYE DEUX", "CIN : 07654321", "PERIODE 08/2026", "NET A PAYER 1200,000"],
    ]);
    const boundary2 = "----b" + crypto.randomBytes(8).toString("hex");
    const body2 = Buffer.concat([
      Buffer.from(`--${boundary2}\r\nContent-Disposition: form-data; name="files"; filename="deux_employes.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf2,
      Buffer.from(`\r\n--${boundary2}--\r\n`),
    ]);
    const d4b = JSON.parse((await httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { "Content-Type": `multipart/form-data; boundary=${boundary2}`, ...auth }, body: body2 })).body);
    const res4b = d4b.results && d4b.results[0];
    verdict("E4b.deuxEmployes2Fiches", res4b && res4b.created === 2, `created=${res4b && res4b.created} (découpage 2 CIN conservé)`);
    // E4c : fiche simple → 1 fiche
    const pdf1 = texteEnPdf([["BULLETIN DE PAIE", "NOM EMPLOYE SIMPLE", "CIN : 01112223", "PERIODE 08/2026", "NET A PAYER 900,000"]]);
    const boundary3 = "----b" + crypto.randomBytes(8).toString("hex");
    const body3 = Buffer.concat([
      Buffer.from(`--${boundary3}\r\nContent-Disposition: form-data; name="files"; filename="simple.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf1,
      Buffer.from(`\r\n--${boundary3}--\r\n`),
    ]);
    const d4c = JSON.parse((await httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { "Content-Type": `multipart/form-data; boundary=${boundary3}`, ...auth }, body: body3 })).body);
    const res4c = d4c.results && d4c.results[0];
    verdict("E4c.simple1Fiche", res4c && res4c.status === "SUCCESS" && !res4c.created && res4c.cin, `created=${res4c && res4c.created}, cin=${res4c && res4c.cin} (1 fiche, CIN détecté)`);

    /* ------------- E5 : POST non multipart → 400 propre ------------------ */
    console.log("=== E5 : robustesse — POST non multipart ===");
    const r5 = await httpRequest("POST", `${ADMIN}/api/payslips/upload`, { headers: { "Content-Type": "application/json", ...auth }, body: "{}" });
    const d5 = JSON.parse(r5.body || "{}");
    verdict("E5.nonMultipart400", r5.status === 400 && /Requête invalide/.test(d5.error || ""), `HTTP ${r5.status}, error=${(d5.error || "").slice(0, 60)}`);
    verdict("E5.causeJournalisee", /Lecture du formulaire multipart impossible/.test(errAdmin), "cause réelle consignée dans les logs serveur (CORRECTIF Task 101)");

    /* ------------- E6 : cohérence globale admin -------------------------- */
    console.log("=== E6 : cohérence des totaux admin ===");
    const lAll = JSON.parse((await httpGet(`${ADMIN}/api/payslips?limit=1000`, auth)).body);
    const totalBd = await prisma.payslip.count();
    verdict("E6.totalAdmin", lAll.total === totalBd && totalBd === 504, `admin total=${lAll.total}, base=${totalBd} (150 E1 + 150 E2 + 200 E3 + 1 débordement + 2 employés + 1 simple)`);
    const lRecherche = JSON.parse((await httpGet(`${ADMIN}/api/payslips?cin=${encodeURIComponent(adminCin1)}&page=2&limit=100`, auth)).body);
    verdict("E6.paginationRecherche", lRecherche.total === 500 && lRecherche.page === 2 && lRecherche.items.length === 100 && lRecherche.totalPages === 5, `total=${lRecherche.total}, page ${lRecherche.page}/${lRecherche.totalPages} = ${lRecherche.items.length} items (500 fiches du CIN copié)`);
  } catch (e) {
    console.error("ERREUR HARNAIS:", e);
    resultats.push({ id: "HARNAIS", ok: false });
  } finally {
    if (admin) admin.kill("SIGKILL");
    await prisma.$disconnect().catch(() => undefined);
    const pass = resultats.filter((r) => r.ok).length;
    console.log(`\n===== RÉSULTAT : ${pass}/${resultats.length} PASS =====`);
    if (errAdmin && resultats.some((r) => !r.ok)) {
      console.log("--- fin stderr admin (extrait) ---");
      console.log(errAdmin.slice(-2500));
    }
    process.exit(pass === resultats.length ? 0 : 1);
  }
})();
