#!/usr/bin/env node
// Sonde de progression du test réel v0.2.168 : état des demandes DEM-2026-1500X
process.chdir(__dirname + "/..");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  try {
    const dems = await db.demandeAdministrative.findMany({
      where: { reference: { in: ["DEM-2026-15001", "DEM-2026-15002", "DEM-2026-15003"] } },
      select: { reference: true, type: true, statut: true, decisionManager: true, decisionRh: true, refuseePar: true, docSigneNom: true, docRefusNom: true, updatedAt: true },
    });
    if (!dems.length) console.log("(aucune demande de test en base)");
    for (const d of dems) {
      console.log(
        d.reference + " | " + d.type + " | statut=" + d.statut +
        " | mgr=" + (d.decisionManager || "—") +
        " | rh=" + (d.decisionRh || "—") +
        " | refuseePar=" + (d.refuseePar || "—") +
        " | doc=" + (d.docSigneNom || d.docRefusNom || "—") +
        " | maj=" + (d.updatedAt ? new Date(d.updatedAt).toISOString() : "—")
      );
    }
  } catch (e) { console.error("ERREUR :", e.message); process.exit(1); }
  await db.$disconnect();
})();
