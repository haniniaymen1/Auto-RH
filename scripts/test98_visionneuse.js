/**
 * Task 98 — Test E2E du CORRECTIF VISIONNEUSE (X-Frame-Options DENY → SAMEORIGIN).
 * Adapté du harnais Task 97 (standalone niché, env explicites).
 *
 * Preuves attendues :
 *  V1  GET /login sans session → 200 + X-Frame-Options: SAMEORIGIN
 *  V2  GET / sans session → redirection /login (middleware intact)
 *  V3  GET /api/payslips/xxx/file sans session → 401 (protection intacte)
 *  V4  Login IT → 200 + cookie
 *  V5  Fiche PDF (chiffrée clé courante) → 200 application/pdf,
 *      X-Frame-Options: SAMEORIGIN (l'iframe de la visionneuse est autorisée),
 *      octets identiques, Content-Disposition inline
 *  V6  Fiche PNG (chiffrée clé courante) → 200 image/png + SAMEORIGIN,
 *      octets identiques (visionneuse image <img> inchangée)
 *  V7  GET / avec session → 200 + SAMEORIGIN (page hôte de l'iframe)
 *  V8  AUCUNE réponse testée ne porte X-Frame-Options: DENY
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task98_viewer/pristine";
const SERVER = path.join(
  ROOT, ".next", "standalone", "task98_viewer", "pristine", "server.js"
);
const PORT_ADMIN = 4203;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const STORAGE = path.join(ROOT, "storage", "payslips");

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));

/* SÉCURITÉ SANDBOX : le PrismaClient du HARNAIS doit viser la base du
 * sandbox — la session shell exporte DATABASE_URL (tronc live) que le
 * client hériterait sinon. (Le serveur spawné a déjà la sienne explicite.) */
process.env.DATABASE_URL = "file:" + path.join(ROOT, "db", "custom.db");

(function chargerEnv() {
  const fichier = path.join(ROOT, ".env");
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const MDP_IT = "It2026!secret";
const EMAIL_IT = "it-visionneuse-test@autorh.local";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/* même chiffrement de stockage que l'application (Task 21) */
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const SALT = "autorh-storage-v1";
function chiffrer(buf) {
  const cle = crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env",
    SALT, 32
  );
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cle, nonce);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ct]);
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout GET " + url)));
  });
}

async function attendreServeur(url, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try { await httpGet(url); return; } catch { await attendre(500); }
  }
  throw new Error("Serveur injoignable : " + url);
}

async function login(email, motDePasse) {
  const data = JSON.stringify({ email, password: motDePasse });
  return new Promise((resolve, reject) => {
    const u = new URL(ADMIN + "/api/auth/login");
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          let cookie = "";
          const sc = res.headers["set-cookie"];
          if (Array.isArray(sc))
            for (const c of sc) {
              const m = c.match(/auto_rh_session=([^;]+)/);
              if (m) cookie = m[1];
            }
          resolve({ status: res.statusCode, cookie, body: out });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout login")));
    req.write(data);
    req.end();
  });
}

const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}

async function creerFiche(prisma, { fileName, storedName, buffer }) {
  fs.mkdirSync(STORAGE, { recursive: true });
  fs.writeFileSync(path.join(STORAGE, storedName), buffer);
  const rec = await prisma.payslip.create({
    data: {
      fileName,
      storedName,
      fileSize: buffer.length,
      content: "FICHE TEST VISIONNEUSE CIN 123456789099",
      normalizedContent: "FICHETESTVISIONNEUSECIN123456789099",
      cin: "123456789099",
      employeeName: "Test Visionneuse",
      period: "du 01/08/26 au 31/08/26",
      pageNumber: 1,
    },
  });
  return rec.id;
}

(async () => {
  let admin = null;
  let prisma = null;
  let errBuf = "";
  const fichesCrees = [];
  const fichiersCrees = [];
  try {
    const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
    prisma = new PrismaClient();
    const tous = await prisma.user.findMany();
    const aPurger = [];
    for (const u of tous) {
      const lisible = cryptoBd.dechiffrerObjet("User", u);
      if (lisible.email === EMAIL_IT) aPurger.push(u.id);
    }
    if (aPurger.length) await prisma.user.deleteMany({ where: { id: { in: aPurger } } });
    await prisma.user.createMany({
      data: [
        cryptoBd.chiffrerObjet("User", {
          email: EMAIL_IT,
          name: "IT Visionneuse Test (Task 98)",
          passwordHash: hashPassword(MDP_IT),
          role: "IT",
          isActive: true,
          passwordChangedAt: new Date(),
        }),
      ],
    });

    console.log("=== Démarrage site admin (port " + PORT_ADMIN + ") ===");
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT_ADMIN),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: "file:" + path.join(ROOT, "db", "custom.db"),
        AUTO_RH_ROOT: ROOT,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => (errBuf += c));
    await attendreServeur(`${ADMIN}/login`);
    await attendre(1500);

    /* V1 — page /login : en-tête SAMEORIGIN */
    const v1 = await httpGet(`${ADMIN}/login`);
    verdict(
      "V1",
      v1.status === 200 &&
        (v1.headers["x-frame-options"] || "") === "SAMEORIGIN",
      `/login → ${v1.status}, X-Frame-Options=${v1.headers["x-frame-options"]}`
    );

    /* V2 — middleware intact : / sans session → redirection /login */
    const v2 = await httpGet(`${ADMIN}/`);
    verdict(
      "V2",
      v2.status === 307 &&
        String(v2.headers["location"] || "").includes("/login"),
      `/ sans session → ${v2.status} vers ${v2.headers["location"]}`
    );

    /* V3 — API fiche sans session → 401 */
    const v3 = await httpGet(`${ADMIN}/api/payslips/quelconque-id/file`);
    verdict(
      "V3",
      v3.status === 401,
      `API fiche sans session → ${v3.status} (protection intacte)`
    );

    /* V4 — login IT */
    const it = await login(EMAIL_IT, MDP_IT);
    verdict(
      "V4",
      it.status === 200 && Boolean(it.cookie),
      `login IT → ${it.status}, cookie ${it.cookie ? "reçu" : "ABSENT"}`
    );
    if (!it.cookie) throw new Error("Login impossible — tests suivants annulés");
    const auth = { Cookie: `auto_rh_session=${it.cookie}` };

    /* V5 — fiche PDF : la preuve centrale du correctif */
    const nomPdf = `t98-${Date.now()}-bulletin.pdf`;
    fichiersCrees.push(nomPdf);
    const idPdf = await creerFiche(prisma, {
      fileName: "Bulletin_de_Paie_Test.pdf",
      storedName: nomPdf,
      buffer: chiffrer(PDF_MIN),
    });
    fichesCrees.push(idPdf);
    const v5 = await httpGet(`${ADMIN}/api/payslips/${idPdf}/file`, auth);
    verdict(
      "V5",
      v5.status === 200 &&
        (v5.headers["content-type"] || "").includes("application/pdf") &&
        (v5.headers["x-frame-options"] || "") === "SAMEORIGIN" &&
        v5.buffer.equals(PDF_MIN) &&
        String(v5.headers["content-disposition"] || "").startsWith("inline"),
      `fiche PDF → ${v5.status}, type=${v5.headers["content-type"]}, ` +
        `XFO=${v5.headers["x-frame-options"]}, octets identiques=${v5.buffer.equals(PDF_MIN)}, ` +
        `disposition=${String(v5.headers["content-disposition"] || "").split(";")[0]}`
    );

    /* V6 — fiche PNG */
    const nomPng = `t98-${Date.now()}-bulletin.png`;
    fichiersCrees.push(nomPng);
    const idPng = await creerFiche(prisma, {
      fileName: "Bulletin_de_Paie_Test.png",
      storedName: nomPng,
      buffer: chiffrer(PNG_1X1),
    });
    fichesCrees.push(idPng);
    const v6 = await httpGet(`${ADMIN}/api/payslips/${idPng}/file`, auth);
    verdict(
      "V6",
      v6.status === 200 &&
        (v6.headers["content-type"] || "").includes("image/png") &&
        (v6.headers["x-frame-options"] || "") === "SAMEORIGIN" &&
        v6.buffer.equals(PNG_1X1),
      `fiche PNG → ${v6.status}, type=${v6.headers["content-type"]}, ` +
        `XFO=${v6.headers["x-frame-options"]}, octets identiques=${v6.buffer.equals(PNG_1X1)}`
    );

    /* V7 — page hôte de la visionneuse (iframe même origine) */
    const v7 = await httpGet(`${ADMIN}/`, auth);
    verdict(
      "V7",
      v7.status === 200 && (v7.headers["x-frame-options"] || "") === "SAMEORIGIN",
      `/ avec session → ${v7.status}, X-Frame-Options=${v7.headers["x-frame-options"]}`
    );

    /* V8 — anti-clickjacking conservé : l'entête n'est plus DENY nulle part */
    const reps = [v1, v5, v6, v7];
    verdict(
      "V8",
      reps.every((r) => (r.headers["x-frame-options"] || "") !== "DENY"),
      `aucune réponse testée ne porte DENY (anti-clickjacking requalifié SAMEORIGIN)`
    );
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    if (admin && errBuf) console.error("[STDERR SERVEUR]", errBuf.slice(-2000));
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    if (prisma) {
      try {
        if (fichesCrees.length)
          await prisma.payslip.deleteMany({ where: { id: { in: fichesCrees } } });
        const tous = await prisma.user.findMany();
        const aPurger = [];
        for (const u of tous) {
          const lisible = cryptoBd.dechiffrerObjet("User", u);
          if (lisible.email === EMAIL_IT) aPurger.push(u.id);
        }
        if (aPurger.length) await prisma.user.deleteMany({ where: { id: { in: aPurger } } });
        await prisma.$disconnect();
      } catch {}
    }
    for (const nom of fichiersCrees) {
      try { fs.unlinkSync(path.join(STORAGE, nom)); } catch {}
    }
    if (admin) {
      try { admin.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { admin.kill("SIGKILL"); } catch {} }, 3000).unref();
    }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n===== BILAN TASK 98 : ${ok}/${resultats.length} PASS =====`);
    resultats.forEach((r) => { if (!r.ok) console.log(`  ECHEC ${r.id}`); });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
