#!/usr/bin/env node
/* Inspection des dossiers Zoho : où sont passés les messages ? */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { ImapFlow } = require("imapflow");

(async () => {
  const client = new ImapFlow({
    host: "imap.zoho.com", port: 993, secure: true,
    auth: { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  const dossiers = await client.list();
  console.log("DOSSIERS:", dossiers.map((d) => d.path).join(", "));
  for (const chemin of ["INBOX", "Spam", "Junk", "Sent"]) {
    try {
      const lock = await client.getMailboxLock(chemin);
      try {
        const boite = client.mailbox;
        const total = boite.exists;
        const nonLus = await client.search({ seen: false }, { uid: true });
        console.log("\n== " + chemin + " : " + total + " message(s), " + (Array.isArray(nonLus) ? nonLus.length : 0) + " non lu(s)");
        const uids = await client.search({ since: new Date(Date.now() - 7200000) }, { uid: true });
        const retenus = (Array.isArray(uids) ? uids : []).slice(-12);
        for (const uid of retenus) {
          const msg = await client.fetchOne(String(uid), { envelope: true, flags: true }, { uid: true });
          if (!msg) continue;
          const env = msg.envelope || {};
          const de = env.from && env.from[0] ? env.from[0].address : "?";
          const vu = (msg.flags || new Set()).has("\\Seen") ? "lu" : "NON LU";
          console.log("   [" + vu + "] de " + de + " | " + (env.subject || "(sans sujet)").slice(0, 80));
        }
      } finally { lock.release(); }
    } catch (e) { console.log("\n== " + chemin + " : inaccessible (" + (e.message || e) + ")"); }
  }
  await client.logout();
})().catch((e) => { console.error("ERREUR:", e.message || e); process.exit(1); });
