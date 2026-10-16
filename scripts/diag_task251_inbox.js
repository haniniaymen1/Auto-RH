"use strict";
/** Diagnostic Task 251 v2 : re-search + téléchargement par flux (download). */
const { ImapFlow } = require("imapflow");
const fs = require("fs");

async function lireTout(stream) {
  const lots = [];
  for await (const morceau of stream) lots.push(morceau);
  return Buffer.concat(lots);
}

(async () => {
  const c = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try {
    fs.mkdirSync("/tmp/task251/inbox", { recursive: true });
    for (const ref of ["DEM-2026-00052", "DEM-2026-00053"]) {
      const uids = (await c.search({ subject: ref }, { uid: true })) || [];
      console.log("== " + ref + " : uids=" + uids.join(","));
      for (const uid of uids) {
        try {
          const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
          const source = msg && msg.source;
          fs.writeFileSync("/tmp/task251/inbox/" + uid + ".eml", source);
          const entetes = source.toString("utf8").split(/\r?\n\r?\n/)[0] || "";
          const ligne = (nom) => (entetes.match(new RegExp("^" + nom + ":\\s*(.*)$", "mi")) || [])[1] || "(aucun)";
          const compensation = (source.toString("utf8").match(/compensation[^\r\n]*/i) || [])[0];
          console.log("  uid=" + uid + " (" + source.length + " o) " + ligne("Subject").slice(0, 65));
          console.log("     MID=" + ligne("Message-ID").slice(0, 58) + " | From=" + ligne("From").slice(0, 45) + " | To=" + ligne("To").slice(0, 40));
          console.log("     In-Reply-To=" + ligne("In-Reply-To").slice(0, 55) + " | X-P=" + (entetes.match(/^X-Auto-RH-[^:]+:/gmi) || ["-"]).join(","));
          if (compensation) console.log("     >> " + compensation.slice(0, 70));
        } catch (e) { console.log("  uid=" + uid + " : ERREUR " + String(e.message).slice(0, 60)); }
      }
    }
  } finally { lock.release(); await c.logout().catch(() => {}); }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
