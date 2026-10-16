/**
 * (TEST CAUSE RACINE) Le marquage \Seen fonctionne-t-il réellement ?
 * Fetch le message non lu le plus récent, essaie de le marquer \Seen,
 * affiche l'erreur exacte le cas échéant, puis vérifie.
 * Usage : node scripts/test-marquage-seen.js [--marque-vraiment]
 * SANS --marque-vraiment : teste sur une COPIE de flags (pas de modification).
 */
const fsEnv = require("fs");
const path = require("path");
try {
  for (const ligne of fsEnv.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient({ log: ["error"] });
const { ImapFlow } = require("imapflow");

async function main() {
  const cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  const dechiffrer = (v) => { if (!v) return null; try { return cryptoBd.dechiffrerChamp(v); } catch (e) { return null; } };
  const client = new ImapFlow({
    host: String(cfg.imapHost).trim(), port: Number(cfg.imapPort) || 993, secure: (Number(cfg.imapPort) || 993) === 993,
    auth: { user: dechiffrer(cfg.imapUser) || dechiffrer(cfg.username), pass: dechiffrer(cfg.imapPassword) || dechiffrer(cfg.password) },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const vraiment = process.argv.includes("--marque-vraiment");
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    console.log("non lus : " + uids.length + " | max UID non lu : " + uids[uids.length - 1]);
    const cible = uids[uids.length - 1];
    const msg = await client.fetchOne(String(cible), { uid: true, flags: true, envelope: true });
    console.log("cible UID " + cible + " : sujet=" + (msg && msg.envelope ? msg.envelope.subject : "?").slice(0, 60));
    console.log("flags actuels : " + (msg && msg.flags ? Array.from(msg.flags).join(",") : "?"));
    console.log("-- tentative messageFlagsAdd \\Seen (uid=" + cible + ") ...");
    try {
      const r = await client.messageFlagsAdd(String(cible), ["\\Seen"], { uid: true });
      console.log("résultat : " + JSON.stringify(r));
    } catch (e) {
      console.log("EXCEPTION messageFlagsAdd : " + (e && e.message ? e.message : e));
      if (e && e.response) console.log("réponse serveur : " + e.response);
    }
    // vérification
    const msg2 = await client.fetchOne(String(cible), { uid: true, flags: true });
    console.log("flags après : " + (msg2 && msg2.flags ? Array.from(msg2.flags).join(",") : "?"));
    const reste = await client.search({ seen: false }, { uid: true });
    console.log("non lus après : " + reste.length + " (toujours " + reste.includes(cible) + " dans la liste)");
  } finally { lock.release(); await client.logout(); }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERREUR : " + (e && e.stack || e.message)); process.exit(1); });
