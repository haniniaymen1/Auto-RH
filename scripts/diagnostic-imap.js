/**
 * (DIAGNOSTIC v0.2.162) Lecture IMAP RÉELLE de la boîte :
 * 1. INBOX non lus : sujet / de / date / Message-ID / In-Reply-To (les 6 suspects)
 * 2. INBOX : total non lus (backlog)
 * 3. Boîte Envoyés : messages des 30 dernières minutes (où passent les réponses RH)
 * Usage : node scripts/diagnostic-imap.js
 */
process.env.AUTO_RH_STORAGE_DIR = require("path").join(__dirname, "..", "storage", "payslips");
// Chargement .env identique à portail-server.js (parsage manuel, sans écraser)
const fsEnv = require("fs");
const path = require("path");
const cheminEnv = path.join(__dirname, "..", ".env");
try {
  for (const ligne of fsEnv.readFileSync(cheminEnv, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (e) {}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient({ log: ["error"] });
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

async function lireConfigImap() {
  const cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!cfg || !cfg.imapActif || !cfg.imapHost) return null;
  const dechiffrer = (v) => {
    if (!v) return null;
    try { return cryptoBd.dechiffrerChamp(v); } catch (e) { return null; }
  };
  return {
    host: String(cfg.imapHost || "").trim(),
    port: Number(cfg.imapPort) || 993,
    secure: (Number(cfg.imapPort) || 993) === 993,
    user: dechiffrer(cfg.imapUser) || dechiffrer(cfg.username),
    pass: dechiffrer(cfg.imapPassword) || dechiffrer(cfg.password),
  };
}

async function main() {
  const cfg = await lireConfigImap();
  if (!cfg) { console.error("Config IMAP absente ou désactivée"); process.exit(1); }
  const { host, port, secure, user, pass } = cfg;
  console.log("IMAP : " + user + "@" + host + ":" + port + " (imapActif=OK)");
  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: false }, logger: false });
  await client.connect();
  console.log("== Connecté ==");

  // --- 1) INBOX : total non lus ---
  const lock = await client.getMailboxLock("INBOX");
  try {
    const nonLus = await client.search({ seen: false }, { uid: true });
    const uids = Array.isArray(nonLus) ? nonLus : [];
    console.log("\n[INBOX] total non lus : " + uids.length);
    // les 10 plus récents (fin de liste)
    const recents = uids.slice(-10);
    for (const uid of recents) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg) continue;
        const p = await simpleParser(msg.source);
        console.log("  UID " + uid + " | " + (p.date || "?").toISOString() + " | de=" + ((p.from && p.from.value[0] && p.from.value[0].address) || "?") + " | sujet=" + String(p.subject || "").slice(0, 80) + " | mid=" + String(p.messageId || "").slice(0, 40) + " | irt=" + String(p.inReplyTo || "").slice(0, 40));
      } catch (e) { console.log("  UID " + uid + " : erreur fetch " + e.message); }
    }
  } finally { lock.release(); }

  // --- 2) Envoyés : messages des 30 dernières minutes ---
  let cheminEnvoyes = "[Gmail]/Sent Mail";
  try {
    const liste = await client.list();
    const envoyee = (liste || []).find((m) => m && (m.specialUse === "\\Sent" || /\bsent\b|envoy/i.test(String(m.path || ""))));
    if (envoyee) cheminEnvoyes = envoyee.path;
  } catch (e) {}
  console.log("\n[ENVOYES] boîte : " + cheminEnvoyes);
  const lock2 = await client.getMailboxLock(cheminEnvoyes);
  try {
    const depuis = new Date(Date.now() - 30 * 60 * 1000);
    const uids = await client.search({ since: depuis }, { uid: true });
    const list = Array.isArray(uids) ? uids : [];
    console.log("[ENVOYES] messages des 30 dernières minutes : " + list.length);
    for (const uid of list.slice(-10)) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg) continue;
        const p = await simpleParser(msg.source);
        console.log("  UID " + uid + " | " + (p.date || "?").toISOString() + " | à=" + ((p.to && p.to.value[0] && p.to.value[0].address) || "?") + " | sujet=" + String(p.subject || "").slice(0, 80) + " | mid=" + String(p.messageId || "").slice(0, 40));
      } catch (e) { console.log("  UID " + uid + " : erreur fetch " + e.message); }
    }
  } finally { lock2.release(); }

  await client.logout();
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERREUR : " + (e && e.message)); process.exit(1); });
