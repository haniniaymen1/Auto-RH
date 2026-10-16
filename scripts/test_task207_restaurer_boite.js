// Task 207 — Restauration rapide de l'état « non lu » de la boîte Gmail
// (UNE SEULE connexion IMAP pour les 58 ensembles de séquence de l'instantané).
process.chdir(__dirname + "/..");
const fs = require("fs");
const { ImapFlow } = require("imapflow");
const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";

(async () => {
  const snap = JSON.parse(fs.readFileSync("/tmp/task207/boite-snapshot.json", "utf8"));
  console.log("Instantané : " + snap.nonLus + " UIDs en " + snap.lots.length + " ensemble(s)");
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  let uidsTraites = 0, lotsOk = 0, lotsKo = 0;
  try {
    for (const lot of snap.lots) {
      for (let tentative = 0; tentative < 3; tentative++) {
        try { await c.messageFlagsRemove(lot, ["\\Seen"], { uid: true }); lotsOk++; break; }
        catch (e) {
          if (tentative === 2) { lotsKo++; console.log("  lot KO : " + String(e.message || e).slice(0, 60)); }
          else await new Promise((r) => setTimeout(r, 2000));
        }
      }
      uidsTraites += lot.split(",").length;
      if (uidsTraites % 5000 < 800) console.log("  " + uidsTraites + "/" + snap.nonLus);
    }
    const st = c.mailbox;
    const u = (await c.search({ seen: false }, { uid: true })) || [];
    console.log("FINAL : exists=" + st.exists + " | NON LUS=" + u.length + " (initial=" + snap.nonLus + ")");
    console.log("lots OK=" + lotsOk + " KO=" + lotsKo);
  } finally {
    lock.release();
    await c.logout().catch(() => { });
  }
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e.message || e); process.exit(1); });
