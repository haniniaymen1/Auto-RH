#!/usr/bin/env node
/* Récupère les .eml des réponses task204 de la boîte Zoho pour diagnostic. */
const { ImapFlow } = require("imapflow");
const fs = require("fs");

(async () => {
  const c = new ImapFlow({
    host: "imap.zoho.com", port: 993, secure: true,
    auth: { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  // tous les messages (lus ou non) dont le sujet contient task204 / DEM
  const uids = await c.search({ seen: false }, { uid: true }).catch(() => []);
  const tous = await c.search({ all: true }, { uid: true }).catch(() => []);
  console.log("non lus:", (uids || []).length, "| total:", (tous || []).length);
  let n = 0;
  for (const uid of (tous || []).slice(-40)) {
    const m = await c.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
    const sujet = (m.envelope && m.envelope.subject) || "";
    if (/DEM-2026-00(011|013|017|018)/.test(sujet) && /task204/.test(m.source.toString("latin1"))) {
      fs.writeFileSync("/tmp/reply-" + sujet.match(/DEM-2026-\d+/)[0] + ".eml", m.source);
      console.log("sauvé:", sujet.slice(0, 75));
      n++;
    }
  }
  lock.release();
  await c.logout();
  console.log("total sauvés:", n);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
