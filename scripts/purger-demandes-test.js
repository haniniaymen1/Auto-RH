#!/usr/bin/env node
/* Purge des demandes administratives de TEST restées « En attente » (v0.2.164).
 *
 * CONTEXTE : lors des sessions de tests E2E (22 et 23h le 08-10, puis 11h-12h le 09-10),
 * plusieurs demandes de test ont été créées puis JAMAIS traitées (aucune réponse e-mail
 * ne leur a été adressée). Elles affichent légitimement « En attente » dans les portails
 * et encombrent la liste, donnant l'impression à tort que le traitement des réponses
 * e-mail ne fonctionne pas (la demande réellement répondue, DEM-2026-00002, est bien
 * « Acceptée » sur les DEUX interfaces).
 *
 * USAGE :
 *   node scripts/purger-demandes-test.js                 -> mode simulation (aucune suppression)
 *   node scripts/purger-demandes-test.js --confirmer     -> suppression réelle
 *   node scripts/purger-demandes-test.js --toutes-en-attente [--confirmer]
 *       -> cible TOUTES les demandes EN_ATTENTE (prudence : à n'utiliser qu'en environnement de test)
 *
 * Les documents liés sont supprimés en cascade (onDelete: Cascade, schema.prisma).
 */
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const CONFIRMER = process.argv.includes("--confirmer");
const TOUTES = process.argv.includes("--toutes-en-attente");

/* Demandes de test obsolètes identifiées le 2026-10-09 (jamais répondues par e-mail) */
const REFS_OBSOLETES = [
  "DEM-2026-00001", // ATTESTATION_TRAVAIL — 08-10 18:32 (phase de diagnostic)
  "DEM-2026-00016", // CONGE — 08-10 19:11
  "DEM-2026-00019", // CONGE — 08-10 19:11
  "DEM-2026-00034", // ATTESTATION_TRAVAIL — 08-10 21:03
  "DEM-2026-00035", // ATTESTATION_SALAIRE — 08-10 21:03
  "DEM-2026-00040", // ATTESTATION_TRAVAIL — 08-10 21:11
  "DEM-2026-00041", // ATTESTATION_SALAIRE — 08-10 21:11
  "DEM-2026-00046", // ATTESTATION_TRAVAIL — 08-10 21:53
  "DEM-2026-00047", // ATTESTATION_SALAIRE — 08-10 21:53
  "DEM-2026-00052", // ATTESTATION_TRAVAIL — 09-10 11:51 (itération E2E)
  "DEM-2026-00053", // ATTESTATION_SALAIRE — 09-10 11:51 (itération E2E)
  "DEM-2026-00055", // AUTORISATION_SORTIE — 09-10 11:51 (itération E2E)
  "DEM-2026-00056", // ATTESTATION_TRAVAIL — 09-10 12:02 (itération E2E)
  "DEM-2026-00057", // ATTESTATION_SALAIRE — 09-10 12:02 (itération E2E)
  "DEM-2026-00060", // ATTESTATION_TRAVAIL — 09-10 12:12 (itération E2E)
];

const prisma = new PrismaClient();

(async () => {
  const cibles = TOUTES
    ? await prisma.demandeAdministrative.findMany({ where: { statut: "EN_ATTENTE" }, orderBy: { reference: "asc" } })
    : await prisma.demandeAdministrative.findMany({ where: { reference: { in: REFS_OBSOLETES } }, orderBy: { reference: "asc" } });

  console.log(`Mode : ${CONFIRMER ? "SUPPRESSION RÉELLE" : "simulation (ajoutez --confirmer pour exécuter)"}`);
  console.log(`Critère : ${TOUTES ? "TOUTES les EN_ATTENTE" : "liste fixe de références de test obsolètes"}`);
  console.log(`Cibles trouvées : ${cibles.length}\n`);

  for (const d of cibles) {
    const nDocs = await prisma.documentDemande.count({ where: { demandeId: d.id } });
    console.log(`  ${d.reference} | ${d.type} | ${d.statut} | créée ${d.createdAt?.toISOString?.().slice(0, 16)} | ${nDocs} doc(s)`);
    if (CONFIRMER) {
      await prisma.demandeAdministrative.delete({ where: { id: d.id } }); // documents en cascade
    }
  }

  if (CONFIRMER && cibles.length) {
    const reste = await prisma.demandeAdministrative.count();
    const resteAtt = await prisma.demandeAdministrative.count({ where: { statut: "EN_ATTENTE" } });
    console.log(`\nSuppression effectuée. Restant : ${reste} demande(s), dont ${resteAtt} EN_ATTENTE.`);
  } else if (!CONFIRMER) {
    console.log(`\nSimulation terminée — relancez avec --confirmer pour supprimer réellement.`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
