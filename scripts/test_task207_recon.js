// Task 207 — RECON : état DB (employés, managers, MailConfig, ReponsePdfConfig)
// + sonde IMAP Gmail (nb de messages NON LUS — évaluation des effets de bord du poller)
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return "?"; } }
function masq(s) { if (!s) return "(vide)"; return s.length <= 4 ? "*".repeat(s.length) : s.slice(0, 2) + "***" + s.slice(-2) + " (" + s.length + " car.)"; }

async function reconDb() {
  const db = new (require("@prisma/client").PrismaClient)();
  console.log("=== PORTAL ACCESS (comptes de test EMPZOH*) ===");
  const accs = await db.portalAccess.findMany({});
  const cibles = [];
  for (const a of accs) {
    const cin = dech(a.cin);
    if (/EMPZOH/i.test(cin)) cibles.push({ a, cin });
  }
  for (const { a, cin } of cibles) {
    console.log("  CIN=" + cin + " | id=" + a.id + " | email=" + dech(a.email) +
      " | managerId=" + (a.managerId || "(aucun)") + " | mailEnvoyeA=" + dech(a.mailEnvoyeA));
  }
  console.log("\n=== MANAGERS (PortalAccess liés) ===");
  const mgrIds = cibles.map((c) => c.a.managerId).filter(Boolean);
  for (const mid of mgrIds) {
    const m = await db.portalAccess.findUnique({ where: { id: mid } });
    if (m) console.log("  id=" + m.id + " | CIN=" + dech(m.cin) + " | nom=" + dech(m.nomPrenom || m.nom) +
      " | email=" + dech(m.email) + " | mailEnvoyeA=" + dech(m.mailEnvoyeA));
    else console.log("  id=" + mid + " (introuvable)");
  }
  console.log("\n=== MAILCONFIG ACTUELLE ===");
  const cfg = await db.mailConfig.findFirst({ orderBy: { id: "desc" } });
  if (cfg) {
    console.log(JSON.stringify({
      host: cfg.host, port: cfg.port, username: cfg.username, password: masq(dech(cfg.password)),
      rhEmail: cfg.rhEmail, imapActif: cfg.imapActif, imapHost: cfg.imapHost,
      imapUsername: cfg.imapUsername, imapPassword: masq(dech(cfg.imapPassword)),
      attestationTravailEmail: cfg.attestationTravailEmail, attestationSalaireEmail: cfg.attestationSalaireEmail,
      congeEmail: cfg.congeEmail, autorisationEmail: cfg.autorisationEmail, parrainageEmail: cfg.parrainageEmail,
    }, null, 2));
  }
  console.log("\n=== REPONSEPDFCONFIG ===");
  const rpc = await db.reponsePdfConfig.findFirst({ orderBy: { id: "desc" } });
  if (rpc) {
    console.log(JSON.stringify({
      actif: rpc.actif, sigActif: rpc.sigActif, tamponActif: rpc.tamponActif,
      signerActif: rpc.signerActif, qrMode: rpc.qrMode, elecActif: rpc.elecActif,
      envoiEmploye: rpc.envoiEmploye, envoiRh: rpc.envoiRh, envoiManager: rpc.envoiManager,
      certificatPresent: !!rpc.certificatChemin,
    }, null, 2));
  } else console.log("  (absente)");
  console.log("\n=== DERNIÈRES DEMANDES (références Task 205/206 encore présentes ?) ===");
  const dems = await db.demandeAdministrative.findMany({
    orderBy: { id: "desc" }, take: 6,
    select: { reference: true, type: true, statut: true, cin: true },
  });
  for (const d of dems) console.log("  " + d.reference + " | " + d.type + " | " + d.statut + " | CIN=" + dech(d.cin));
  await db.$disconnect();
}

async function sondeImap() {
  console.log("\n=== SONDE IMAP GMAIL (employe.test@autorh.tn) — messages NON LUS ===");
  const { ImapFlow } = require("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" },
    logger: false, tls: { rejectUnauthorized: false },
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const st = client.mailbox;
    const unseen = await client.search({ seen: false }, { uid: true });
    const nb = Array.isArray(unseen) ? unseen.length : 0;
    console.log("  exists=" + st.exists + " | NON LUS=" + nb);
    if (nb > 0 && nb <= 20) {
      for await (const msg of client.fetch(unseen, { envelope: true, uid: true })) {
        console.log("    UNSEEN uid=" + msg.uid + " de=" + (msg.envelope.from || []).map((f) => f.address).join(",") +
          " sujet=" + JSON.stringify(String(msg.envelope.subject || "").slice(0, 70)));
      }
    }
    return { exists: st.exists, nonLus: nb };
  } finally {
    lock.release();
    await client.logout();
  }
}

(async () => {
  await reconDb();
  const r = await sondeImap();
  console.log("\n→ Effet de bord poller : " + r.nonLus + " message(s) réels seront traités/marqués LUS (nouveau venu d'abord, slice(-50))");
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e.message || e); process.exit(1); });
