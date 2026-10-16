#!/usr/bin/env node
/* Task 205 — RETRIEVE + REJOUER les réponses restées non traitées (volées par
 * le poller du déploiement réel sur la même boîte Zoho). Cherche dans INBOX
 * les messages dont le sujet cite une référence DEM donnée, sauvegarde les
 * .eml et rejoue traiterMessageRecu (module portail en mode bibliothèque). */
process.chdir(__dirname + "/..");
const fs = require("fs");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const { simpleParser } = require("mailparser");
const { ImapFlow } = require("imapflow");

const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const REFS = process.argv.slice(2);
if (!REFS.length) { console.log("Usage : node scripts/test_task205_rejouer.js DEM-2026-00028 …"); process.exit(2); }

(async () => {
  for (const ref of REFS) {
    const c = new ImapFlow({
      host: "imap.zoho.com", port: 993, secure: true,
      auth: { user: ZOHO_USER, pass: ZOHO_PASS },
      tls: { rejectUnauthorized: false }, logger: false,
    });
    await c.connect();
    const trouves = [];
    try {
      const lock = await c.getMailboxLock("INBOX");
      try {
        for await (const msg of c.fetch({ subject: ref }, { uid: true, envelope: true, source: true })) {
          trouves.push({ uid: msg.uid, sujet: (msg.envelope && msg.envelope.subject) || "", source: msg.source });
        }
      } finally { lock.release(); }
    } finally { try { await c.logout(); } catch { /* */ } }
    console.log(ref + " : " + trouves.length + " message(s) dans INBOX");
    for (const m of trouves) {
      const chemin = "/tmp/task205-reply-" + ref + "-" + m.uid + ".eml";
      fs.writeFileSync(chemin, m.source);
      const parsed = await simpleParser(m.source);
      const idPropre = String(parsed.messageId || "").replace(/[<>]/g, "");
      const r = await portail.traiterMessageRecu(parsed);
      console.log("  uid=" + m.uid + " de=" + (parsed.from && parsed.from.value[0] ? parsed.from.value[0].address : "?")
        + " messageId=" + idPropre.slice(0, 50)
        + " sujet=" + JSON.stringify(m.sujet).slice(0, 70));
      console.log("  → traiterMessageRecu : " + JSON.stringify(r).slice(0, 400));
      console.log("  (.eml : " + chemin + ")");
    }
  }
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
