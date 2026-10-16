#!/usr/bin/env node
// Diagnostic : cherche les réponses de test dans INBOX, SPAM et [Gmail]/Spam.
const { ImapFlow } = require("imapflow");
const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };

(async () => {
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL.user, pass: GMAIL.pass },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  for (const boite of ["INBOX", "[Gmail]/Spam", "Junk"]) {
    try {
      const lock = await client.getMailboxLock(boite);
      try {
        const uids = await client.search({ subject: "DEM-2026-1500" });
        console.log(boite + " : " + (uids || []).length + " message(s) DEM-2026-1500*");
        for (const uid of uids || []) {
          const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
          if (msg && msg.envelope) {
            console.log("   [" + uid + "] " + String(msg.envelope.subject || "").slice(0, 75) + " | de=" + (msg.envelope.from && msg.envelope.from[0] ? msg.envelope.from[0].address : "?"));
          }
        }
        const statut = await client.status(boite, { messages: true });
        console.log("   (boîte : " + statut.messages + " messages au total)");
      } finally { lock.release(); }
    } catch (e) { console.log(boite + " : introuvable (" + e.message.slice(0, 60) + ")"); }
  }
  await client.logout().catch(() => {});
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
