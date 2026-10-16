/**
 * ============================================================================
 * Task 102 — « SMTP serveur personnalisé : le bouton “Sécurité de la
 * connexion” double le champ “Port” — le supprimer » — harnais E2E.
 * ============================================================================
 * CORRECTIF testé (0.2.30) : le bouton (interrupteur STARTTLS/plain) est
 * SUPPRIMÉ de l'interface ; la sécurité est DÉDUITE du port par
 * secureDepuisPort() (src/lib/mailer.ts) : 465 → SSL/TLS direct (secure:true),
 * tout autre port → STARTTLS/plain (secure:false). L'API PUT ignore le champ
 * « secure » reçu de l'interface (rétrocompatibilité silencieuse).
 *
 * Preuves attendues (bac à sable, base dédiée, FAUX serveur SMTP local) :
 *   P0  serveur standalone 4306 + compte IT + login
 *   P1  PUT port 587 + « secure:true » (ancien champ d'interface) → le champ
 *       est IGNORÉ : GET = secure:false (dérivé du port)
 *   P2  PUT port 465 + « secure:false » → GET = secure:true (dérivé)
 *   P3  PUT port 25 → GET = secure:false
 *   P4  ENVOI RÉEL via faux SMTP en clair sur le port 1925 (>0 succès, le
 *       message est reçu ; journal : succes:true, secure:false) — la réussite
 *       d'un envoi EN CLAIR prouve que le transport N'a PAS tenté de TLS
 *   P5  ENVOI sur le MÊME faux serveur SMTP en clair mais sur le PORT 465 :
 *       le faux serveur détecte le ClientHello TLS (0x16) et coupe → l'envoi
 *       ÉCHOUE. Si la dérivation était cassée (secure:false sur 465), l'envoi
 *       en clair RÉUSSIRAIT — l'échec prouve que le transport a bien tenté
 *       SSL/TLS direct sur 465. Journal : succes:false, secure:true.
 *   P6  non-régression validations : hôte obligatoire 400, port invalide 400,
 *       401 sans session, destinataire de test invalide 400
 *   P7  politique RH : GET mail-config → { configuree } uniquement (Task 13)
 *   P8  UI compilée : « Sécurité réglée automatiquement » présent ;
 *       « mail-secure » et « Sécurité de la connexion » ABSENTS (bouton retiré)
 *   P9  non-régression globale : /login 200, / sans session 307, forme GET
 *       complète (config + defauts)
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = "/home/z/my-project/task102_smtp/app";
const SERVER = path.join(ROOT, ".next", "standalone", "task102_smtp", "app", "server.js");
const PORT_ADMIN = 4306;
const PORT_SMTP = 1925;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const DB = path.join(ROOT, "db", "custom.db");
const JOURNAL = path.join(ROOT, "logs", "journal-emails.log");
const SECRET = "t102-secret-test-harnais"; // AUTH_SECRET = AUTO_RH_STORAGE_KEY (leçon Task 100)

process.env.DATABASE_URL = "file:" + DB; // AVANT tout require Prisma (leçon Task 98)
process.env.AUTO_RH_STORAGE_KEY = SECRET;
process.env.AUTH_SECRET = SECRET;
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

const EMAIL_IT = "it-smtp-secu@autorh.local";
const MDP_IT = "It2026!t102";
const EMAIL_RH = "rh-smtp-secu@autorh.local";
const MDP_RH = "Rh2026!t102";

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
    req.setTimeout(120000, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (data) req.write(data);
    req.end();
  });
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

/* --------------------- FAUX SERVEUR SMTP LOCAL ---------------------------- */
/** mode "plain" : SMTP en clair simple. mode "detectTLS" : si le premier octet
 *  du client est 0x16 (ClientHello TLS) → coupe la connexion (simule un
 *  serveur SSL/TLS attendu face à un flux TLS ; un flux SMTP en clair passe). */
function demarrerFauxSmtp(port, mode) {
  const recu = { messages: [], connexions: 0, tlsDetecte: 0 };
  const srv = net.createServer((sock) => {
    recu.connexions++;
    let buffer = Buffer.alloc(0);
    let enData = false;
    let message = [];
    const envoyer = (l) => sock.write(l + "\r\n");
    envoyer("220 faux-smtp.local ESMTP Auto-RH-test");
    sock.on("data", (d) => {
      buffer = Buffer.concat([buffer, d]);
      if (mode === "detectTLS" && buffer.length > 0 && buffer[0] === 0x16) {
        recu.tlsDetecte++;
        sock.destroy(); // handshake TLS impossible : le serveur est en clair
        return;
      }
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const ligne = buffer.slice(0, idx).toString("utf8");
        buffer = buffer.slice(idx + 2);
        if (enData) {
          if (ligne === ".") {
            enData = false;
            recu.messages.push(message.join("\n"));
            message = [];
            envoyer("250 OK message accepte");
          } else message.push(ligne.replace(/^\.\./, "."));
          continue;
        }
        const cmd = ligne.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-faux-smtp.local\r\n250-8BITMIME\r\n250-SIZE 10485760\r\n250 OK\r\n");
        else if (cmd.startsWith("HELO")) envoyer("250 faux-smtp.local");
        else if (cmd.startsWith("MAIL FROM")) envoyer("250 OK");
        else if (cmd.startsWith("RCPT TO")) envoyer("250 OK");
        else if (cmd.startsWith("DATA")) { enData = true; envoyer("354 finissez avec ."); }
        else if (cmd.startsWith("QUIT")) { envoyer("221 bye"); sock.end(); }
        else if (cmd.startsWith("RSET") || cmd.startsWith("NOOP")) envoyer("250 OK");
        else if (cmd.startsWith("STARTTLS")) envoyer("454 TLS non disponible ici");
        else envoyer("500 commande inconnue");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((res) => srv.listen(port, "127.0.0.1", () => res({ srv, recu })));
}

/* --------------------------- verdicts ------------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}
process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

function derniereLigneJournal() {
  try {
    const lignes = fs.readFileSync(JOURNAL, "utf8").trim().split("\n");
    return JSON.parse(lignes[lignes.length - 1]);
  } catch { return null; }
}

(async () => {
  let admin = null;
  let errAdmin = "";
  let fauxSmtp = null;
  try {
    /* ---------------- P0 : serveur + compte IT + login ---------------- */
    console.log("=== P0 : serveur standalone + login IT ===");
    if (!(await portLibre(PORT_ADMIN))) throw new Error(`port ${PORT_ADMIN} déjà occupé`);
    if (!(await portLibre(PORT_SMTP))) throw new Error(`port ${PORT_SMTP} déjà occupé`);
    if (fs.existsSync(JOURNAL)) fs.unlinkSync(JOURNAL);

    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT_ADMIN), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT, AUTH_SECRET: SECRET, AUTO_RH_STORAGE_KEY: SECRET },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => { errAdmin = (errAdmin + c).slice(-40000); });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(800);

    // Idempotence : base de test dédiée
    await prisma.mailConfig.deleteMany({});
    await prisma.user.deleteMany({});

    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT, name: "IT SMTP Secu (Task 102)", passwordHash: hashPassword(MDP_IT),
        role: "IT", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_RH, name: "RH SMTP Secu (Task 102)", passwordHash: hashPassword(MDP_RH),
        role: "RH", isActive: true, passwordChangedAt: new Date(),
      }),
    });
    const loginR = await httpRequest("POST", `${ADMIN}/api/auth/login`, { body: JSON.stringify({ email: EMAIL_IT, password: MDP_IT }) });
    let cookie = "";
    for (const c of loginR.headers["set-cookie"] || []) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
    verdict("P0.loginIT", loginR.status === 200 && Boolean(cookie), `login IT → ${loginR.status}`);
    const auth = { Cookie: `auto_rh_session=${cookie}` };
    const put = (corps) => httpRequest("PUT", `${ADMIN}/api/mail-config`, { headers: auth, body: JSON.stringify(corps) });
    const postTest = (dest) => httpRequest("POST", `${ADMIN}/api/mail-config`, { headers: auth, body: JSON.stringify({ action: "test", dest }) });

    /* -------- P1-P3 : dérivation secure = f(port), champ interface ignoré --- */
    console.log("=== P1-P3 : dérivation de la sécurité depuis le port ===");
    // P1 : port 587 + ancien champ secure:true (ce que renverrait l'ANCIENNE UI)
    let r = await put({ host: "127.0.0.1", port: 587, secure: true, username: "", password: "", from: "expediteur@test.local", serveurAdresse: "", sitePort: "", portailUrl: "" });
    let cfg = JSON.parse(r.body || "{}").config;
    verdict("P1.port587", r.status === 200 && cfg && cfg.port === 587 && cfg.secure === false,
      `PUT 587+secure:true → ${r.status}, GET secure=${cfg && cfg.secure} (attendu false)`);
    // P2 : port 465 + ancien champ secure:false
    r = await put({ host: "127.0.0.1", port: 465, secure: false, username: "", password: "", from: "expediteur@test.local", serveurAdresse: "", sitePort: "", portailUrl: "" });
    cfg = JSON.parse(r.body || "{}").config;
    verdict("P2.port465", r.status === 200 && cfg && cfg.port === 465 && cfg.secure === true,
      `PUT 465+secure:false → ${r.status}, GET secure=${cfg && cfg.secure} (attendu true)`);
    // P3 : port 25 (relais interne)
    r = await put({ host: "127.0.0.1", port: 25, username: "", password: "", from: "expediteur@test.local", serveurAdresse: "", sitePort: "", portailUrl: "" });
    cfg = JSON.parse(r.body || "{}").config;
    verdict("P3.port25", r.status === 200 && cfg && cfg.port === 25 && cfg.secure === false,
      `PUT 25 → ${r.status}, GET secure=${cfg && cfg.secure} (attendu false)`);

    /* -------- P4 : ENVOI RÉEL en clair sur port 1925 (secure:false) --------- */
    console.log("=== P4 : envoi réel SMTP en clair (port 1925) ===");
    fauxSmtp = await demarrerFauxSmtp(PORT_SMTP, "plain");
    r = await put({ host: "127.0.0.1", port: PORT_SMTP, username: "", password: "", from: "Auto-RH <expediteur@test.local>", serveurAdresse: "", sitePort: "", portailUrl: "http://127.0.0.1:4001" });
    verdict("P4.config1925", r.status === 200, `PUT port ${PORT_SMTP} → ${r.status}`);
    r = await postTest("employe-test@example.tn");
    const msg4 = fauxSmtp.recu.messages[fauxSmtp.recu.messages.length - 1] || "";
    const j4 = derniereLigneJournal();
    verdict("P4.envoiReussi", r.status === 200 && fauxSmtp.recu.messages.length >= 1 && msg4.includes("Subject:"),
      `POST test → ${r.status}, messages reçus=${fauxSmtp.recu.messages.length}, sujet présent=${msg4.includes("Subject:")}`);
    verdict("P4.journalSecureFalse", j4 && j4.succes === true && j4.secure === false && j4.port === PORT_SMTP,
      `journal: succes=${j4 && j4.succes}, secure=${j4 && j4.secure}, port=${j4 && j4.port}`);
    verdict("P4.tlsNonTente", fauxSmtp.recu.tlsDetecte === 0, `ClientHello TLS détectés=${fauxSmtp.recu.tlsDetecte} (attendu 0 : envoi en clair)`);

    /* -------- P5 : port 465 face au MÊME serveur en clair → échec TLS ------- */
    console.log("=== P5 : port 465 = SSL/TLS direct (le transport tente TLS) ===");
    await fauxSmtp.srv.close();
    const tlsFaux = await demarrerFauxSmtp(465, "detectTLS"); // MÊME serveur en clair, port 465
    fauxSmtp = tlsFaux;
    r = await put({ host: "127.0.0.1", port: 465, username: "", password: "", from: "expediteur@test.local", serveurAdresse: "", sitePort: "", portailUrl: "" });
    verdict("P5.config465", r.status === 200, `PUT port 465 → ${r.status}`);
    r = await postTest("employe-test@example.tn");
    const j5 = derniereLigneJournal();
    // L'envoi DOIT échouer : le transport tente un handshake TLS (ClientHello
    // 0x16) contre un serveur en clair qui coupe. Une dérivation cassée
    // (secure:false sur 465) aurait RÉUSSI en clair.
    verdict("P5.echecTLS", r.status === 502 && fauxSmtp.recu.tlsDetecte >= 1,
      `POST test → ${r.status} (attendu 502), ClientHello détectés=${fauxSmtp.recu.tlsDetecte} (attendu ≥1)`);
    verdict("P5.journalSecureTrue", j5 && j5.succes === false && j5.secure === true && j5.port === 465,
      `journal: succes=${j5 && j5.succes}, secure=${j5 && j5.secure}, port=${j5 && j5.port}`);

    /* -------- P6 : non-régression validations API --------------------------- */
    console.log("=== P6 : validations API ===");
    r = await put({ host: "", port: 587 });
    verdict("P6.hoteObligatoire", r.status === 400, `PUT sans hôte → ${r.status} (attendu 400)`);
    r = await put({ host: "127.0.0.1", port: 99999 });
    verdict("P6.portInvalide", r.status === 400, `PUT port 99999 → ${r.status} (attendu 400)`);
    r = await postTest("pas-un-email");
    verdict("P6.destInvalide", r.status === 400, `POST test dest invalide → ${r.status} (attendu 400)`);
    const sansSession = await httpGet(`${ADMIN}/api/mail-config`);
    verdict("P6.sansSession401", sansSession.status === 401, `GET sans session → ${sansSession.status} (attendu 401)`);

    /* -------- P7 : politique RH (Task 13 inchangée) ------------------------- */
    console.log("=== P7 : RH = configuree uniquement ===");
    const loginRH = await httpRequest("POST", `${ADMIN}/api/auth/login`, { body: JSON.stringify({ email: EMAIL_RH, password: MDP_RH }) });
    let cookieRH = "";
    for (const c of loginRH.headers["set-cookie"] || []) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookieRH = m[1];
    }
    r = await httpGet(`${ADMIN}/api/mail-config`, { Cookie: `auto_rh_session=${cookieRH}` });
    const cfgRH = JSON.parse(r.body || "{}").config || {};
    verdict("P7.rhConfigureeSeule", r.status === 200 && Object.keys(cfgRH).length === 1 && typeof cfgRH.configuree === "boolean",
      `GET RH → ${r.status}, clés=${JSON.stringify(Object.keys(cfgRH))} (attendu [configuree])`);

    /* -------- P8 : UI compilée — bouton supprimé ---------------------------- */
    console.log("=== P8 : UI compilée (chunks client) ===");
    const dirChunks = path.join(ROOT, ".next", "static", "chunks");
    let uiTout = "";
    const parcourir = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (e.name.endsWith(".js")) uiTout += fs.readFileSync(p, "utf8");
      }
    };
    parcourir(dirChunks);
    verdict("P8.hintPresent", uiTout.includes("Sécurité réglée automatiquement"),
      "indice « Sécurité réglée automatiquement » présent dans le bundle");
    verdict("P8.boutonAbsent", !uiTout.includes("mail-secure") && !uiTout.includes("Sécurité de la connexion"),
      "« mail-secure » et « Sécurité de la connexion » ABSENTS du bundle (bouton retiré)");

    /* -------- P9 : non-régression globale ----------------------------------- */
    console.log("=== P9 : non-régression globale ===");
    const pageLogin = await httpGet(`${ADMIN}/login`);
    verdict("P9.login200", pageLogin.status === 200, `GET /login → ${pageLogin.status}`);
    const racineSansSession = await httpGet(`${ADMIN}/`);
    verdict("P9.racine307", racineSansSession.status === 307, `GET / sans session → ${racineSansSession.status} (attendu 307)`);
    cfg = JSON.parse((await httpGet(`${ADMIN}/api/mail-config`, auth)).body || "{}");
    verdict("P9.formeGET", cfg.config && cfg.defauts && typeof cfg.config.hasPassword === "boolean" && cfg.config.configuree === true && cfg.config.port === 465,
      `forme complète (config+defauts), port=${cfg.config && cfg.config.port}, configuree=${cfg.config && cfg.config.configuree}`);

    /* ------------------------- verdict global ------------------------------- */
    const echecs = resultats.filter((x) => !x.ok);
    console.log("============================================================================");
    console.log(`RÉSULTAT : ${resultats.length - echecs.length}/${resultats.length} PASS${echecs.length ? " — ECHECS : " + echecs.map((e) => e.id).join(", ") : ""}`);
    process.exitCode = echecs.length ? 1 : 0;
  } catch (e) {
    console.error("[ERREUR HARNAIS]", e);
    if (errAdmin) console.error("--- stderr serveur (fin) ---\n" + errAdmin.slice(-3000));
    process.exitCode = 2;
  } finally {
    if (fauxSmtp) try { await fauxSmtp.srv.close(); } catch {}
    if (admin) try { admin.kill("SIGTERM"); } catch {}
    await attendre(300);
    try { await prisma.user.deleteMany({}); await prisma.mailConfig.deleteMany({}); } catch {}
    try { await prisma.$disconnect(); } catch {}
  }
})();
