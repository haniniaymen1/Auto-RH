/**
 * (DIAGNOSTIC 2) Où sont passées les réponses du user ?
 * 1. INBOX : TOUS les messages reçus des 2 dernières heures (lus OU non lus)
 * 2. Base : dernières demandes DEM-2026-000xx (statut, destinataire déchiffré,
 *    messageIdEnvoi, reponsesRecues)
 * Usage : node scripts/diagnostic-reponses-perdues.js
 */
const fsEnv = require("fs");
const path = require("path");
const cheminEnv = path.join(__dirname, "..", ".env");
try {
  for (const ligne of fsEnv.readFileSync(cheminEnv, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}
process.env.AUTO_RH_STORAGE_DIR = path.join(__dirname, "..", "storage", "payslips");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient({ log: ["error"] });
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

async function lireConfigImap() {
  const cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!cfg || !cfg.imapActif || !cfg.imapHost) return null;
  const dechiffrer = (v) => { if (!v) return null; try { return cryptoBd.dechiffrerChamp(v); } catch (e) { return null; } };
  return { host: String(cfg.imapHost || "").trim(), port: Number(cfg.imapPort) || 993, secure: (Number(cfg.imapPort) || 993) === 993, user: dechiffrer(cfg.imapUser) || dechiffrer(cfg.username), pass: dechiffrer(cfg.imapPassword) || dechiffrer(cfg.password) };
}

async function main() {
  // --- 1) Base : dernières demandes ---
  console.log("=== DERNIÈRES DEMANDES (base) ===");
  const demandes = await prisma.demandeAdministrative.findMany({
    orderBy: { createdAt: "desc" }, take: 8,
    select: { reference: true, type: true, statut: true, destinataire: true, messageIdEnvoi: true, createdAt: true, reponsesRecues: true },
  });
  for (const d of demandes) {
    let dest = "";
    try { dest = d.destinataire ? cryptoBd.dechiffrerChamp(d.destinataire) : ""; } catch (e) { dest = "(chiffré?)"; }
    let nbRep = 0, reps = [];
    try {
      const brut = d.reponsesRecues ? cryptoBd.dechiffrerChamp(d.reponsesRecues) : null;
      const arr = brut ? JSON.parse(brut || "[]") : [];
      nbRep = arr.length;
      reps = arr.map((r) => r.de + " → " + (r.decision || "?") + " (" + (r.date || "?") + ")");
    } catch (e) {}
    console.log("  " + d.reference + " | " + d.type + " | " + d.statut + " | dest=" + dest + " | créé=" + (d.createdAt ? d.createdAt.toISOString() : "?") + " | midEnvoi=" + String(d.messageIdEnvoi || "").slice(0, 35) + " | réponses=" + nbRep);
    for (const r of reps) console.log("      ↳ " + r.slice(0, 120));
  }

  // --- 2) INBOX : messages des 2 dernières heures (tous) ---
  const cfg = await lireConfigImap();
  if (!cfg) { console.error("Config IMAP absente"); process.exit(1); }
  console.log("\n=== INBOX : messages des 2 dernières heures (lus + non lus) ===");
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, tls: { rejectUnauthorized: false }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const depuis = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const uids = await client.search({ since: depuis }, { uid: true });
    const list = Array.isArray(uids) ? uids : [];
    console.log("total : " + list.length);
    for (const uid of list.slice(-25)) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg) continue;
        const p = await simpleParser(msg.source);
        const vu = msg.flags && msg.flags.has("\\Seen") ? "LU" : "NON-LU";
        console.log("  UID " + uid + " [" + vu + "] " + (p.date || "?").toISOString() + " | de=" + ((p.from && p.from.value[0] && p.from.value[0].address) || "?") + " | sujet=" + String(p.subject || "").slice(0, 70) + " | mid=" + String(p.messageId || "").slice(0, 38));
      } catch (e) { console.log("  UID " + uid + " : err " + e.message); }
    }
  } finally { lock.release(); }
  await client.logout();
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERREUR : " + (e && e.message)); process.exit(1); });
