#!/usr/bin/env node
"use strict";
/** Task 251 — restauration \Seen REPRISABLE (le sandbox tue les longs runs).
 *  Usage : node scripts/task251_restaurer_seen.js [lotsParPassage]
 *  Progression : /tmp/task251/restore-progress.json (lots déjà traités). */
process.chdir(__dirname + "/..");
const fs = require("fs");
const { ImapFlow } = require("imapflow");

const SNAPSHOT = "/tmp/task251/boite-snapshot.json";
const PROGRES = "/tmp/task251/restore-progress.json";

async function avecImap(fn) {
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { return await fn(c); } finally { lock.release(); await c.logout().catch(() => {}); }
}

(async () => {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const parPassage = parseInt(process.argv[2] || "10", 10);
  const prog = fs.existsSync(PROGRES) ? JSON.parse(fs.readFileSync(PROGRES, "utf8")) : { faits: [], echecs: [] };
  const faits = new Set(prog.faits);
  const restants = snap.lots.map((_, i) => i).filter((i) => !faits.has(i));
  console.log("Lots : " + snap.lots.length + " | déjà restaurés : " + faits.size + " | restants : " + restants.length + " (traitement de " + Math.min(parPassage, restants.length) + ")");

  let ok = 0, ko = 0;
  for (const idx of restants.slice(0, parPassage)) {
    const lot = snap.lots[idx];
    try {
      await avecImap(async (cl) => { await cl.messageFlagsRemove(lot, ["\\Seen"], { uid: true }); });
      faits.add(idx); prog.faits = [...faits]; ok++;
    } catch (e) {
      ko++; prog.echecs.push({ idx, erreur: String(e.message || e).slice(0, 60) });
      console.log("  lot " + idx + " EN ÉCHEC : " + String(e.message || e).slice(0, 60));
    }
    fs.writeFileSync(PROGRES, JSON.stringify(prog, null, 2));
    process.stdout.write("  " + faits.size + "/" + snap.lots.length + " lots\r");
  }
  console.log("\nPassage terminé : +" + ok + " OK, " + ko + " échec(s) — " + faits.size + "/" + snap.lots.length + " lots restaurés.");

  if (faits.size >= snap.lots.length) {
    const fin = await avecImap(async (cl) => (await cl.search({ seen: false }, { uid: true }) || []).length);
    console.log("Vérification finale : " + fin + " non lus (snapshot initial : " + snap.nonLus + ") → " + (fin >= snap.nonLus ? "BOÎTE RESTITUÉE ✓" : "INFÉRIEUR AU SNAPSHOT — relancer"));
  } else {
    console.log("→ Relancer : node scripts/task251_restaurer_seen.js");
  }
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
