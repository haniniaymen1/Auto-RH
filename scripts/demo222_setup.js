/**
 * Démo éphémère Task 222 — une demande de congé « en attente » pour ouvrir
 * le dialogue de réponse dans le navigateur (méthode Task 220 : écriture
 * directe en base, champs sensibles chiffrés via lib-crypto-bd).
 * Nettoyage : scripts/demo222_teardown.js
 */
"use strict";
process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const CIN_DEMO = "09222444";

(async () => {
  // retrait d'un éventuel résidu
  await db.demandeAdministrative.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_DEMO, true) } });
  const dem = await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-00222",
      type: "CONGE",
      cin: cryptoBd.chiffrerChamp(CIN_DEMO, true),
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("superviseur-demo222@entreprise.tn", true),
      donnees: cryptoBd.chiffrerChamp(
        JSON.stringify({ dateDebut: "2026-10-05", dateFin: "2026-10-07", motif: "Démonstration Task 222" }),
        true
      ),
      employeEmail: cryptoBd.chiffrerChamp("employe-demo222@entreprise.tn", true),
      messageIdEnvoi: "demo-222@entreprise.tn",
    },
  });
  console.log("démo créée:", dem.reference, dem.id);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
