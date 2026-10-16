#!/usr/bin/env node
/* Sonde état BD : MailConfig, comptes PortalAccess, dernières demandes. */
process.chdir(__dirname + "/..");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;

function essai(v, det) {
  try { return cryptoBd.dechiffrerChamp(v, det) || null; } catch (e) { return "⟨illisible⟩"; }
}

async function main() {
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  console.log("== MailConfig ==");
  if (cfg) {
    console.log(" host:", cfg.host, "port:", cfg.port, "secure:", cfg.secure);
    console.log(" from:", cfg.from);
    console.log(" username(clair?):", cfg.username ? String(cfg.username).slice(0, 30) : null);
    console.log(" username(déchiffré):", cfg.username ? essai(cfg.username) : null);
    console.log(" rhEmail:", cfg.rhEmail, "| itEmail:", cfg.itEmail);
    console.log(" attTravail:", cfg.attestationTravailEmail, "| attSalaire:", cfg.attestationSalaireEmail);
    console.log(" conge:", cfg.congeEmail, "| autorisation:", cfg.autorisationEmail);
    console.log(" imapActif:", cfg.imapActif, "imapHost:", cfg.imapHost, "imapPort:", cfg.imapPort);
    console.log(" imapUser(déchiffré):", cfg.imapUser ? essai(cfg.imapUser) : null);
  } else console.log(" (absente)");

  console.log("\n== PortalAccess ==");
  const accs = await db.portalAccess.findMany({ take: 20, orderBy: { createdAt: "desc" } });
  for (const a of accs) {
    const cin = essai(a.cin, true);
    const email = a.email ? essai(a.email) : null;
    console.log(" -", String(cin).slice(0, 20), "| email:", String(email).slice(0, 40),
      "| actif:", a.isActive, "| mdp:", a.passwordHash ? "oui" : "non",
      "| lastLogin:", a.lastLoginAt ? a.lastLoginAt.toISOString().slice(0, 10) : "—",
      "| managerId:", a.managerId ? "oui" : "non",
      "| nomPrenom:", a.nomPrenom ? String(essai(a.nomPrenom)).slice(0, 25) : "—");
  }
  console.log(" total:", await db.portalAccess.count());

  console.log("\n== Dernières demandes ==");
  const dems = await db.demandeAdministrative.findMany({
    take: 10, orderBy: { createdAt: "desc" },
    select: { reference: true, type: true, statut: true, createdAt: true, messageIdEnvoi: true },
  });
  for (const d of dems) console.log(" -", d.reference, d.type, d.statut, d.createdAt.toISOString().slice(0, 16),
    d.messageIdEnvoi ? "msgId:oui" : "msgId:—");
  console.log(" total:", await db.demandeAdministrative.count());
  process.exit(0);
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
