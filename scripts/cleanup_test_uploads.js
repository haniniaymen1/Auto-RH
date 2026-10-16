/**
 * Nettoyage après tests E2E : supprime les fiches créées par
 * scripts/test_storage_fix.py (les 6 PDF les plus récents de
 * storage/payslips, correspondant à des doublons d'upload de test).
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const ROOT = path.join(__dirname, "..");
const STORAGE = path.join(ROOT, "storage", "payslips");
const db = new PrismaClient();

(async () => {
  const files = fs
    .readdirSync(STORAGE)
    .map((f) => ({ f, t: fs.statSync(path.join(STORAGE, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 6)
    .map((x) => x.f);
  console.log("Doublons à supprimer :", files);
  let deleted = 0;
  for (const storedName of files) {
    const rec = await db.payslip.findFirst({ where: { storedName } });
    if (rec) {
      await db.payslip.delete({ where: { id: rec.id } });
      fs.unlinkSync(path.join(STORAGE, storedName));
      deleted++;
    }
  }
  console.log(`Supprimé : ${deleted} fiches de test`);
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
