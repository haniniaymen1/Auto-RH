#!/usr/bin/env node
/* Diagnostic boîte Zoho : derniers messages INBOX + SPAM */
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };

async function scanner(boite) {
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock(boite);
  try {
    const st = await c.status(boite, { messages: true, uidNext: true });
    console.log("== " + boite + " : " + st.messages + " messages, uidNext=" + st.uidNext);
    const uids = await c.search({ since: new Date(Date.now() - 60 * 60000) });
    for (const uid of (uids || []).slice(-12)) {
      const msg = await c.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg) continue;
      const sujet = String((msg.envelope && msg.envelope.subject) || "(sans)");
      let de = "", nPJ = 0, pjNoms = "";
      try {
        const p = await simpleParser(msg.source);
        de = p.from && p.from.text;
        nPJ = (p.attachments || []).length;
        pjNoms = (p.attachments || []).map(a => a.filename).join(", ");
      } catch (e) {}
      console.log("  uid=" + uid + " | " + sujet.slice(0, 80) + " | de=" + de + " | PJ=" + nPJ + (pjNoms ? " (" + pjNoms + ")" : ""));
    }
  } finally { lock.release(); await c.logout().catch(() => {}); }
}

(async () => {
  for (const b of ["INBOX", "Spam", "Junk"]) {
    try { await scanner(b); } catch (e) { console.log("== " + b + " : indisponible (" + e.message.slice(0, 60) + ")"); }
  }
})();
