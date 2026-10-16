#!/usr/bin/env node
/* Rejoue traiterMessageRecu sur les 4 .eml sauvés pour voir le retour exact. */
process.chdir(__dirname + "/..");
const fs = require("fs");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const simpleParser = require("mailparser").simpleParser;

(async () => {
  for (const ref of ["DEM-2026-00011", "DEM-2026-00013", "DEM-2026-00017", "DEM-2026-00018"]) {
    const chemin = "/tmp/reply-" + ref + ".eml";
    const brut = fs.readFileSync(chemin);
    const parsed = await simpleParser(brut);
    const r = await portail.traiterMessageRecu(parsed);
    console.log(ref, "→", JSON.stringify(r).slice(0, 300));
  }
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
