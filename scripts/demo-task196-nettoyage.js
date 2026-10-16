#!/usr/bin/env node
/** Task 196 — NETTOYAGE de la demande de démonstration (DEM-2026-13299). */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;

async function main() {
  const demandes = await db.demandeAdministrative.findMany({
    where: { reference: { startsWith: "DEM-2026-132" } },
    select: { id: true, reference: true },
  });
  for (const d of demandes) {
    const docs = await db.documentDemande.findMany({ where: { demandeId: d.id } });
    for (const doc of docs) {
      for (const base of ["storage/documents-demandes/" + doc.chemin, doc.chemin]) {
        try { fs.unlinkSync(base); break; } catch { /* suivant */ }
      }
    }
    await db.documentDemande.deleteMany({ where: { demandeId: d.id } });
    await db.demandeAdministrative.delete({ where: { id: d.id } }).catch(() => { });
    console.log("supprimée : " + d.reference + " (" + docs.length + " document(s))");
  }
  const reste = await db.demandeAdministrative.count({ where: { reference: { startsWith: "DEM-2026-132" } } });
  console.log("restantes : " + reste);
  process.exit(reste === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
