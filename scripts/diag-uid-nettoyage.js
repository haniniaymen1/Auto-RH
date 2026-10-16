#!/usr/bin/env node
// Diagnostic + nettoyage par UID DIRECT (fiable) des réponses de test.
// Usage : node diag-uid-nettoyage.js [liste|nettoie]
const { ImapFlow } = require("imapflow");
const MODE = process.argv[2] || "liste";
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
    const dernier = statut.uidNext - 1;
    const debut = Math.max(1, dernier - 24); // 25 derniers UIDs
    let nettoyes = 0;
    for (let uid = debut; uid <= dernier; uid++) {
      const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      const sujet = String(msg.envelope.subject || "");
      const date = msg.envelope.date ? new Date(msg.envelope.date).toISOString().slice(5, 16) : "?";
      console.log("  [" + uid + "] " + date + " | " + sujet.slice(0, 85));
      if (MODE === "nettoie" && sujet.indexOf("DEM-2026-1500") >= 0) {
        await client.messageDelete(uid, { uid: true });
        nettoyes++;
        console.log("      ↑ SUPPRIMÉ");
      }
    }
    console.log("Mode=" + MODE + " | supprimés=" + nettoyes);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
