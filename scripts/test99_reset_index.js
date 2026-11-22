/**
 * Task 99 — RESET de l'indexation (bac à sable) : supprime tous les jetons et
 * remet cinIndex/nomIndex/cinIndexedAt à zéro pour ré-indexer avec le script
 * direct CORRIGÉ (déchiffrement avant empreinte).
 * FORCÉ: DATABASE_URL = sandbox task99 (jamais le tronc).
 */
const path = require("path");
const ROOT = "/home/z/my-project/task99_pagination/base";
process.env.DATABASE_URL = "file:" + path.join(ROOT, "db", "custom.db");
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

(async () => {
  try {
    const t0 = Date.now();
    const jetons = await prisma.payslipCinToken.deleteMany({});
    console.log(`jetons supprimés: ${jetons.count.toLocaleString("fr-FR")}`);
    const maj = await prisma.payslip.updateMany({
      data: { cinIndex: "", nomIndex: "", cinIndexedAt: null },
    });
    console.log(`fiches réinitialisées: ${maj.count.toLocaleString("fr-FR")} (${Math.round((Date.now() - t0) / 1000)} s)`);
    const restants = await prisma.payslip.count({ where: { cinIndexedAt: null } });
    console.log(`restants à indexer: ${restants.toLocaleString("fr-FR")}`);
  } catch (e) {
    console.error("[RESET ERREUR]", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
  }
})();
