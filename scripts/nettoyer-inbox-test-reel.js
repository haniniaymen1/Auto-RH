#!/usr/bin/env node
// Nettoie la boîte Gmail système : supprime (→ corbeille) les réponses de test
// de la précédente exécution (sujets contenant DEM-2026-1500X) pour que le
// re-run du test réel parte d'un INBOX propre.
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
  let supprimes = 0, scannes = 0;
  try {
    // Recherche SERVEUR par sujet (rapide) — couvre DEM-2026-15001/15002/15003
    const uids = await client.search({ subject: "DEM-2026-1500" });
    console.log("Messages INBOX avec sujet DEM-2026-1500* :", (uids || []).length);
    for (const uid of uids || []) {
      const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
      const sujet = msg && msg.envelope ? String(msg.envelope.subject || "") : "?";
      await client.messageDelete(uid, { uid: true });
      supprimes++;
      console.log("  supprimé : [" + uid + "] " + sujet.slice(0, 90));
    }
    console.log("supprimés=" + supprimes);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
