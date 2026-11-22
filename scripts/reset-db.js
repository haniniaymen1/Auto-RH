// Réinitialise la base (fiches + journal) et les fichiers stockés
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const STORAGE = path.join(process.cwd(), "storage", "payslips");

async function main() {
  const db = new PrismaClient();
  const files = await db.payslip.findMany({ select: { storedName: true } });
  for (const f of files) {
    try { fs.unlinkSync(path.join(STORAGE, f.storedName)); } catch {}
  }
  await db.payslip.deleteMany({});
  await db.importLog.deleteMany({});
  await db.$disconnect();
  console.log("Base réinitialisée —", files.length, "fichiers supprimés");
}

main().catch((e) => { console.error(e); process.exit(1); });
