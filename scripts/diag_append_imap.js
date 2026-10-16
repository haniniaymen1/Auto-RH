#!/usr/bin/env node
/* Diagnostic APPEND IMAP Zoho — erreur détaillée + variantes. */
process.chdir(__dirname + "/..");
const { ImapFlow } = require("imapflow");

const IMAP_HOST = "imap.zoho.com";
const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";

function messageBrut(sujet, texte) {
  const entetes = [
    "From: RH Test <smtp.test@autorh.tn>",
    "To: AutoRH <" + ZOHO_USER + ">",
    "Subject: " + sujet,
    "Date: " + new Date().toUTCString(),
    "Message-ID: <diag-append-" + Date.now() + "@reponse.test>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return entetes.join("\r\n") + "\r\n\r\n" + texte + "\r\n";
}

async function main() {
  const c = new ImapFlow({
    host: IMAP_HOST, port: 993, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS },
    tls: { rejectUnauthorized: false },
    logger: (arg) => { const t = typeof arg === "string" ? arg : (arg && (arg.err || arg.msg || JSON.stringify(arg))); if (t && /APPEND|BAD|NO|C:|S:/i.test(String(t))) console.log("PROTO:", String(t).slice(0, 300)); },
  });
  await c.connect();
  console.log("connecté");
  const lock = await c.getMailboxLock("INBOX");
  console.log("lock INBOX obtenu");
  // Variante D : message RÉALISTE (accents UTF-8) SANS option date
  try {
    const brut = messageBrut("Re: AutoRH - Demande de conge DEM-2026-00003 (traitement requis)", "Bonjour,\r\n\r\nCongé accepté — d'accord pour la période demandée.\r\n\r\nCordialement,\r\nRH Test");
    const r = await c.append("INBOX", Buffer.from(brut, "utf8"));
    console.log("D append réaliste sans {date} →", JSON.stringify(r).slice(0, 120));
  } catch (e) {
    console.log("D ERREUR:", e.message, "| response:", e.response, "| text:", e.responseText);
  }
  // Variante E : avec flags vides
  try {
    const brut2 = messageBrut("Re: AutoRH - Demande de conge DEM-2026-00003 (traitement requis)", "Second test.");
    const r = await c.append("INBOX", Buffer.from(brut2, "utf8"), { flags: [] });
    console.log("E append {flags:[]} →", JSON.stringify(r).slice(0, 120));
  } catch (e) {
    console.log("E ERREUR:", e.message, "| response:", e.response, "| text:", e.responseText);
  }
  lock.release();
  await c.logout();
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e.message, e.response || ""); process.exit(1); });
