/**
 * ============================================================================
 * Task 100 — « Le nombre de fiches affiché au portail employé est différent
 * du nombre attendu » — harnais E2E du CORRECTIF.
 * ============================================================================
 * CAUSE (corrigée ici) : searchPayslipsByCin() du portail tronquait la liste
 * à MAX_RESULTS = 100 (.slice) → compteur affiché faux (100 au lieu de 102).
 *
 * Scénarios (bac à sable, base dédiée, AUTH_SECRET connu → sessions portail
 * forgées exactement comme createPortalSession) :
 *   P0  serveurs admin (4204) + portail (4304), compte IT, login admin
 *   P1  chemin NON indexé (repli historique) : parité admin/portail
 *       — 135 fiches du même CIN (le scénario exact de l'utilisateur,
 *         > 100 : l'ANCIEN code portail renvoyait 100)
 *   P2  indexation par la VRAIE route API (POST /api/payslips/indexation)
 *   P3  chemin INDEXÉ (production) : parité stricte des TOTAUX
 *       admin (pagination serveur) vs portail (liste complète)
 *   P4  upload réel → indexé automatiquement → visible au portail
 *   P5  non-régression : 401 sans session, 403 CIN étranger, forme API
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task100_portal/base";
const SERVER = path.join(ROOT, ".next", "standalone", "task100_portal", "base", "server.js");
const PORTAIL = path.join(ROOT, "scripts", "portail-server.js");
const PORT_ADMIN = 4204;
const PORT_PORTAIL = 4304;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const PORTAIL_URL = `http://127.0.0.1:${PORT_PORTAIL}`;
const DB = path.join(ROOT, "db", "custom.db");
const SECRET = "t100-secret-test-harnais"; // AUTH_SECRET des DEUX serveurs

process.env.DATABASE_URL = "file:" + DB; // AVANT tout require Prisma (leçon Task 98)
// (leçon Task 100 — 1er run) : la clé de CHIFFREMENT des champs est dérivée
// de AUTO_RH_STORAGE_KEY (repli AUTH_SECRET). Mêmes variables pour le
// harnais ET les deux serveurs, sinon les données écrites par le harnais
// sont illisibles par les serveurs (login 401 « Email ou mot de passe
// incorrect »). AUTH_SECRET sert aussi à signer les sessions portail.
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

const EMAIL_IT = "it-nombre-portail@autorh.local";
const MDP_IT = "It2026!t100";

/* ---------- jumelles exactes des règles du portail/admin (indépendantes) --- */
function normaliserCin(v) { return String(v ?? "").toUpperCase().replace(/[\s./\-]/g, ""); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
function jetonPortail(cin) {
  const payload = Buffer.from(JSON.stringify({
    cin, exp: Math.floor(Date.now() / 1000) + 3600, rm: 0, pd: 0, ot: 0,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
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
function httpRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === null ? null : Buffer.from(body, "utf8");
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(240000, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (data) req.write(data);
    req.end();
  });
}
async function attendreServeur(url) {
  for (let i = 0; i < 120; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
  throw new Error("serveur injoignable : " + url);
}
/** Garde : refuse de démarrer si un TEST orphelin occupe déjà le port
 *  (leçon Task 100 : un serveur Task 99 orphelin sur 4204 répondait avec
 *  SON ancienne base → login 401 incompréhensible). */
function portLibre(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 800 }, () => {
      sock.destroy();
      resolve(false); // occupé
    });
    sock.on("error", () => resolve(true)); // libre
    sock.on("timeout", () => { sock.destroy(); resolve(true); });
  });
}

/* --------------------------- verdicts ------------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}
process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

/* ------------------------ données de test -------------------------------- */
let compteurContenu = 0;
function contenuFiche(cin, extra) {
  compteurContenu++;
  const mois = String((compteurContenu % 12) + 1).padStart(2, "0");
  const lignes = [
    "REPUBLIQUE TUNISIENNE — BULLETIN DE PAIE",
    "SOCIETE EXEMPLE SARL — AFFILIE CNSS 17775208-08",
    `MATRICULE: ${1000 + (compteurContenu % 9000)}`,
  ];
  if (cin) lignes.push(`CIN: ${cin}`);
  if (extra) lignes.push(extra);
  lignes.push(
    `NOM: EMPLOYE ${compteurContenu}`,
    `PERIODE: du 01/${mois}/26 au 28/${mois}/26`,
    "SALAIRE BRUT: 1 250,500 TND",
    "NET A PAYER: 1 050,250 TND",
    "MODE DE PAIEMENT: VIREMENT BANCAIRE",
    "SIGNATURE: LE DIRECTEUR DES RESSOURCES HUMAINES"
  );
  return lignes.join("\n");
}
function normaliserContenu(texte) {
  return texte.toUpperCase().replace(/[\s./\-]/g, "");
}
async function creerFiche({ cin, extra, uploadedAt, fichier }) {
  compteurContenu;
  const texte = contenuFiche(cin, extra);
  const storedName = `t100-${crypto.randomUUID()}.pdf`;
  if (fichier) {
    fs.mkdirSync(path.join(ROOT, "storage", "payslips"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "storage", "payslips", storedName), Buffer.from("PDF-FICTIF"));
  }
  const data = cryptoBd.chiffrerObjet("Payslip", {
    fileName: `Bulletin_${(cin ?? "sansCIN").replace(/\s/g, "")}_${compteurContenu}.pdf`,
    storedName,
    fileSize: 20000 + compteurContenu,
    content: texte,
    normalizedContent: normaliserContenu(texte),
    cin: cin ?? null,
    employeeName: `EMPLOYE ${compteurContenu}`,
    period: "du 01/08/26 au 31/08/26",
    netSalary: "1050,250",
    matricule: null,
    pageNumber: 1,
    uploadedAt,
  });
  return prisma.payslip.create({ data });
}

/* PDF minimal VALIDE (texte extractible) pour l'upload réel */
function pdfMinimal(lignes) {
  const flux =
    "BT /F1 12 Tf 50 700 Td " +
    lignes.map((l) => `(${String(l).replace(/[()\\]/g, "")}) Tj 0 -20 Td`).join(" ") + " ET";
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n" +
      `4 0 obj\n<< /Length ${Buffer.byteLength(flux, "utf8")} >>\nstream\n${flux}\nendstream\nendobj\n` +
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "utf8"
  );
}

/* ----------------------------- scénarios --------------------------------- */
const CIN_A = "09123456001"; // 135 fiches — scénario EXACT de l'utilisateur (> 100)
const CIN_B = "08765432";    // présent UNIQUEMENT dans le contenu de 2 fiches multi-employés
const CIN_C = "98765432";    // 1 fiche
const CIN_D = "11223344";    // 3 fiches
const CIN_E = "A123456";     // 5 fiches (alphanumérique)
const N_A = 135;

(async () => {
  let admin = null;
  let portail = null;
  let errAdmin = "";
  let errPortail = "";
  try {
    /* ---------------- P0 : serveurs + compte IT + login ---------------- */
    console.log("=== P0 : serveurs + login IT ===");
    if (!(await portLibre(PORT_ADMIN)) || !(await portLibre(PORT_PORTAIL))) {
      throw new Error(`port ${PORT_ADMIN}/${PORT_PORTAIL} déjà occupé — tuer le serveur de test orphelin avant de relancer`);
    }
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT_ADMIN), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => { errAdmin = (errAdmin + c).slice(-40000); });
    await attendreServeur(`${ADMIN}/login`);

    portail = spawn(process.execPath, [PORTAIL], {
      cwd: ROOT,
      env: { ...process.env, PORTAL_PORT: String(PORT_PORTAIL), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET, STORAGE_DIR: path.join(ROOT, "storage", "payslips") },
      stdio: ["ignore", "ignore", "pipe"],
    });
    portail.stderr.on("data", (c) => { errPortail = (errPortail + c).slice(-40000); });
    await attendreServeur(PORTAIL_URL + "/login");
    await attendre(1000);

    // Idempotence : base de test dédiée → remise à zéro des artefacts
    await prisma.payslipCinToken.deleteMany({});
    await prisma.payslip.deleteMany({});
    await prisma.portalAccess.deleteMany({});
    await prisma.user.deleteMany({});

    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT,
        name: "IT Nombre Portail (Task 100)",
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
    const adminGet = (u) => httpGet(ADMIN + u, auth);

    // Accès portail ACTIFS pour les CIN de test (comme créés par l'admin RH)
    for (const cin of [CIN_A, CIN_B, CIN_C, CIN_D, CIN_E, "44556677"]) {
      await prisma.portalAccess.create({
        data: {
          cin: cryptoBd.chiffrerChamp(cin, true),
          passwordHash: cryptoBd.chiffrerChamp(hashPassword("Portail2026!t100"), false),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          isActive: true,
        },
      });
    }
    const portailGet = (cin, u) => httpGet(PORTAIL_URL + u, { Cookie: `portail_session=${jetonPortail(cin)}` });

    /* ------------- P1 : données NON indexées (repli historique) -------- */
    console.log("=== P1 : 146 fiches NON indexées — parité admin/portail ===");
    const t0 = new Date("2026-09-01T08:00:00Z").getTime();
    for (let i = 0; i < N_A; i++) await creerFiche({ cin: CIN_A, uploadedAt: new Date(t0 + i * 1000) });
    // 2 fiches MULTI-EMPLOYÉS : champ cin = 22223333, contenu contient AUSSI CIN_B
    for (let i = 0; i < 2; i++) await creerFiche({ cin: "22223333", extra: `CIN: ${CIN_B}`, uploadedAt: new Date(t0 + (200 + i) * 1000) });
    await creerFiche({ cin: CIN_C, uploadedAt: new Date(t0 + 300 * 1000) });
    for (let i = 0; i < 3; i++) await creerFiche({ cin: CIN_D, uploadedAt: new Date(t0 + (310 + i) * 1000) });
    for (let i = 0; i < 5; i++) await creerFiche({ cin: CIN_E, uploadedAt: new Date(t0 + (320 + i) * 1000) });
    // bruit : fiches sans CIN
    for (let i = 0; i < 3; i++) await creerFiche({ cin: null, uploadedAt: new Date(t0 + (330 + i) * 1000) });
    const totalFiches = await prisma.payslip.count();
    const restantes = await prisma.payslip.count({ where: { cinIndexedAt: null } });
    console.log(`  base = ${totalFiches} fiches, non indexées = ${restantes}`);

    // Scénario utilisateur : 135 fiches du même CIN, chemin repli
    const dA1 = JSON.parse((await adminGet(`/api/payslips?cin=${CIN_A}`)).body);
    verdict("P1.adminRepliCIN_A", dA1.total === N_A && dA1.items.length === 100 && dA1.totalPages === 2, `admin total=${dA1.total}, page1=${dA1.items.length} items`);
    const mA1 = JSON.parse((await portailGet(CIN_A, "/api/my-fiches")).body);
    verdict("P1.portailRepliCIN_A", mA1.total === N_A && mA1.items.length === N_A, `portail total=${mA1.total}, items=${mA1.items.length} (ANCIEN code : 100 — le bug signalé)`);
    const dD1 = JSON.parse((await adminGet(`/api/payslips?cin=${CIN_D}`)).body);
    const mD1 = JSON.parse((await portailGet(CIN_D, "/api/my-fiches")).body);
    verdict("P1.pariteCIN_D", dD1.total === 3 && mD1.total === 3 && mD1.items.length === 3, `admin=${dD1.total}, portail=${mD1.total}`);

    /* ------------- P2 : indexation par la VRAIE route API --------------- */
    console.log("=== P2 : indexation API (POST /api/payslips/indexation) ===");
    let tours = 0;
    for (;;) {
      const r = JSON.parse((await httpRequest("POST", ADMIN + "/api/payslips/indexation", { headers: auth, body: "{}" })).body);
      tours++;
      if (r.termine || tours >= 10) break;
      await attendre(300);
    }
    const etat = JSON.parse((await adminGet("/api/payslips/indexation")).body);
    verdict("P2.indexation", etat.restants === 0 && etat.termine === true, `restants=${etat.restants}, termine=${etat.termine} (${tours} tour(s))`);

    /* ------------- P3 : chemin INDEXÉ — parité stricte ------------------ */
    console.log("=== P3 : parité des TOTAUX admin/portail (chemin indexé) ===");
    const dA = JSON.parse((await adminGet(`/api/payslips?cin=${CIN_A}&page=1&limit=100`)).body);
    verdict("P3.adminCIN_A", dA.total === N_A && dA.items.length === 100 && dA.totalPages === 2 && dA.page === 1, `admin total=${dA.total}, page 1/2 = ${dA.items.length} items`);
    const dA2 = JSON.parse((await adminGet(`/api/payslips?cin=${CIN_A}&page=2&limit=100`)).body);
    const idsP1 = new Set(dA.items.map((x) => x.id));
    verdict("P3.adminPage2", dA2.items.length === N_A - 100 && dA2.items.every((x) => !idsP1.has(x.id)), `page 2 = ${dA2.items.length} items sans chevauchement`);
    const mA = JSON.parse((await portailGet(CIN_A, "/api/my-fiches")).body);
    verdict("P3.portailCIN_A", mA.total === N_A && mA.items.length === N_A, `portail total=${mA.total}, items=${mA.items.length} ← LE CORRECTIF (100 avant)`);

    // Parité pour TOUS les scénarios
    const cas = [
      [CIN_A, N_A], [CIN_B, 2], [CIN_C, 1], [CIN_D, 3], [CIN_E, 5],
    ];
    for (const [cin, attendu] of cas) {
      const d = JSON.parse((await adminGet(`/api/payslips?cin=${encodeURIComponent(cin)}`)).body);
      const m = JSON.parse((await portailGet(cin, "/api/my-fiches")).body);
      verdict(
        `P3.parite.${cin}`,
        d.total === attendu && m.total === attendu && m.items.length === attendu,
        `attendu=${attendu} → admin=${d.total}, portail=${m.total}/${m.items.length}`
      );
    }

    // CIN_B : correspondance PAR LE CONTENU uniquement (fiches multi-employés)
    const mB = JSON.parse((await portailGet(CIN_B, "/api/my-fiches")).body);
    verdict("P3.contenuSeul", mB.items.length === 2, `CIN ${CIN_B} dans le contenu de fiches multi-employés → portail = ${mB.items.length}`);

    // Tri identique : la plus récente d'abord (parité admin page 1)
    const premierAdmin = dA.items[0]?.id;
    const premierPortail = mA.items[0]?.id;
    verdict("P3.triIdentique", premierAdmin === premierPortail, `1re fiche admin=${premierAdmin}, portail=${premierPortail}`);

    // Champs nécessaires à l'affichage du portail
    const it0 = mA.items[0] || {};
    verdict("P3.formeItems", ["id", "fileName", "period", "fileSize", "uploadedAt"].every((k) => k in it0), `champs présents: ${Object.keys(it0).join(", ")}`);

    /* ------------- P4 : upload réel → indexé auto → portail ------------- */
    console.log("=== P4 : upload réel (middleware) + portail ===");
    const PDF_UP = pdfMinimal(["BULLETIN DE PAIE", `CIN: 44556677`, "NET A PAYER: 1 050,250 TND"]);
    const boundary = "----t100" + Date.now();
    const corps = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename=" Bulletin_44556677.pdf "\r\nContent-Type: application/pdf\r\n\r\n`, "utf8"),
      PDF_UP,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const up = await httpRequest("POST", ADMIN + "/api/payslips/upload", {
      headers: { ...auth, "Content-Type": "multipart/form-data; boundary=" + boundary },
      body: corps,
    });
    let upData = null; try { upData = JSON.parse(up.body); } catch {}
    const upOk = up.status === 200 && upData?.results?.[0]?.status === "SUCCESS";
    if (!upOk) {
      console.log("  [debug upload] status=", up.status, " body=", (up.body || "").slice(0, 400));
      console.log("  [debug stderr admin]", errAdmin.slice(-800));
    }
    const dU = JSON.parse((await adminGet("/api/payslips?cin=44556677")).body);
    const mU = JSON.parse((await portailGet("44556677", "/api/my-fiches")).body);
    verdict("P4.uploadPortail", upOk && dU.total === 1 && mU.total === 1 && mU.items.length === 1, `upload=${upOk}, admin=${dU.total}, portail=${mU.total} (indexé dès l'import)`);

    /* ------------- P5 : non-régression ---------------------------------- */
    console.log("=== P5 : non-régression ===");
    const sansSession = await httpGet(PORTAIL_URL + "/api/my-fiches");
    verdict("P5.sansSession401", sansSession.status === 401, `/api/my-fiches sans session → ${sansSession.status}`);
    const etranger = await portailGet(CIN_A, `/api/search?cin=${CIN_C}`);
    verdict("P5.cinEtranger403", etranger.status === 403, `/api/search?cin=${CIN_C} avec session ${CIN_A} → ${etranger.status}`);
    const page = await httpGet(PORTAIL_URL + "/");
    verdict("P5.pagePortail", page.status === 200, `GET / → ${page.status}`);
    const monCin = JSON.parse((await portailGet(CIN_A, "/api/my-fiches")).body);
    verdict("P5.cinSession", monCin.cin === CIN_A && monCin.exact === true && monCin.total === monCin.items.length, `cin=${monCin.cin ? "présent" : "absent"}, exact=${monCin.exact}, total=${monCin.total}`);
  } catch (e) {
    console.error("[ERREUR HARNAIS]", e);
    if (errAdmin) console.error("[admin stderr]", errAdmin.slice(-2000));
    if (errPortail) console.error("[portail stderr]", errPortail.slice(-2000));
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    try { await prisma.$disconnect(); } catch {}
    for (const p of [admin, portail]) {
      if (p) { try { p.kill("SIGTERM"); } catch {} }
    }
    await attendre(1500);
    for (const p of [admin, portail]) { if (p) { try { p.kill("SIGKILL"); } catch {} } }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n===== TASK 100 : ${ok}/${resultats.length} PASS =====`);
    resultats.forEach((r) => { if (!r.ok) console.log(`  ECHEC ${r.id}`); });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
