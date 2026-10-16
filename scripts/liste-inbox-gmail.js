#!/usr/bin/env node
// Liste les 12 derniers messages INBOX Gmail (sujet + date) pour vérification.
const { ImapFlow } = require("imapflow");
const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };

(async () => {
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL.user, pass: GMAIL.pass },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const statut = await client.status("INBOX", { messages: true, uidNext: true });
    console.log("INBOX : " + statut.messages + " messages | uidNext=" + statut.uidNext);
    const uids = await client.search({ all: true });
    const derniers = (uids || []).slice(-12);
    for (const uid of derniers) {
      const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      console.log("  [" + uid + "] " + new Date(msg.envelope.date).toISOString().slice(5, 16) + " | " + String(msg.envelope.subject || "").slice(0, 80));
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
