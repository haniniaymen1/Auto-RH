/** Debug S11 : une fiche + fichier, appel redetect, détails complets. */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task99_pagination/base";
const SERVER = path.join(ROOT, ".next", "standalone", "task99_pagination", "base", "server.js");
const PORT = 4207;
const ADMIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, "db", "custom.db");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
process.env.DATABASE_URL = "file:" + DB;
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();
const STORAGE = path.join(ROOT, "storage", "payslips");

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
  });
}
function httpPost(url, headers = {}, body = "{}") {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(body, "utf8");
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}
async function attendreServeur(url) {
  for (let i = 0; i < 90; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
  throw new Error("serveur injoignable");
}

(async () => {
  let admin = null;
  try {
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    admin.stderr.on("data", (c) => (err = (err + c).slice(-8000)));
    await attendreServeur(`${ADMIN}/login`);
    await attendre(1000);

    // compte IT — (re)créé systématiquement pour ce débogage
    const EMAIL = "it-debug-s11@autorh.local";
    await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL,
        name: "Debug S11",
        passwordHash: "scrypt:aaaaaaaaaaaaaaaa:" + crypto.scryptSync("It2026!debug", "aaaaaaaaaaaaaaaa", 64).toString("hex"),
        role: "IT",
        isActive: true,
        passwordChangedAt: new Date(),
      }),
    });
    const login = await httpPost(`${ADMIN}/api/auth/login`, {}, JSON.stringify({ email: EMAIL, password: "It2026!debug" }));
    let cookie = "";
    const sc = login.headers["set-cookie"] || [];
    for (const c of sc) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
    console.log("login:", login.status, cookie ? "ok" : "PAS DE COOKIE");
    if (!cookie) throw new Error("login impossible: " + login.body.slice(0, 200));
    const auth = { Cookie: `auto_rh_session=${cookie}` };

    // une fiche avec fichier
    const flux = "BT /F1 12 Tf 50 700 Td (BULLETIN DE PAIE) Tj 0 -20 Td (CIN: 12345678) Tj 0 -20 Td (NET: 1000 TND) Tj ET";
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length " + Buffer.byteLength(flux) + " >>\nstream\n" + flux + "\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8");
    const storedName = "t99-debug-" + crypto.randomUUID() + ".pdf";
    fs.mkdirSync(STORAGE, { recursive: true });
    fs.writeFileSync(path.join(STORAGE, storedName), pdf);
    const rec = await prisma.payslip.create({
      data: cryptoBd.chiffrerObjet("Payslip", {
        fileName: "Debug_S11.pdf",
        storedName,
        fileSize: pdf.length,
        content: "BULLETIN DE PAIE CIN: 12345678",
        normalizedContent: "BULLETINDEPAIECIN:12345678",
        cin: null,
        employeeName: null,
        period: null,
        netSalary: null,
        matricule: null,
        pageNumber: 1,
        uploadedAt: new Date(),
      }),
    });
    console.log("fiche créée:", rec.id, "fichier:", storedName, "existe:", fs.existsSync(path.join(STORAGE, storedName)));

    const rd = await httpPost(`${ADMIN}/api/payslips/redetect`, auth);
    console.log("redetect:", rd.status);
    const d = JSON.parse(rd.body);
    console.log("updated:", d.updated, "/", d.total, "errors:", d.errors);
    const detailCible = (d.details || []).find((x) => x.fileName === "Debug_S11.pdf");
    console.log("détail cible:", JSON.stringify(detailCible));
    const relue = cryptoBd.dechiffrerObjet("Payslip", await prisma.payslip.findUnique({ where: { id: rec.id } }));
    console.log("cin après redetect:", relue.cin);

    await prisma.payslip.delete({ where: { id: rec.id } });
    try { fs.unlinkSync(path.join(STORAGE, storedName)); } catch {}
  } catch (e) {
    console.error("[DEBUG ERREUR]", e);
  } finally {
    try { await prisma.$disconnect(); } catch {}
    if (admin) { try { admin.kill("SIGTERM"); } catch {} setTimeout(() => { try { admin.kill("SIGKILL"); } catch {} }, 2000).unref(); }
    setTimeout(() => process.exit(0), 800).unref();
  }
})();
