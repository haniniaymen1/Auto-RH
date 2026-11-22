/**
 * Task 99 — vérification pivot : crypto script == crypto serveur ?
 * E1 a été indexée PAR LE SERVEUR (redetect S11, middleware db.ts).
 * Si chiffrerChamp("12345678", true) (script) == cinIndex d'E1 (serveur),
 * alors secret+algorithme sont identiques et seul le script direct est buggé.
 */
const path = require("path");
const ROOT = "/home/z/my-project/task99_pagination/base";
process.env.DATABASE_URL = "file:" + path.join(ROOT, "db", "custom.db");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

(async () => {
  try {
    const e1 = await prisma.payslip.findFirst({
      where: { storedName: { startsWith: "t99-" }, AND: [{ storedName: { not: { startsWith: "t99-bulk-" } } }] },
      select: { id: true, cinIndex: true },
    });
    const empreinteScript = cryptoBd.chiffrerChamp("12345678", true);
    console.log("cinIndex E1 (serveur) :", String(e1.cinIndex).slice(0, 16), "…");
    console.log("empreinte script      :", String(empreinteScript).slice(0, 16), "…");
    console.log("IDENTIQUES ?", e1.cinIndex === empreinteScript ? "OUI — crypto identique script/serveur" : "NON — secret différent !");
    const n = await prisma.payslip.count({ where: { cinIndex: empreinteScript } });
    console.log("fiches avec cette empreinte (E1+droit E4 attendues… selon indexation):", n);
  } catch (e) {
    console.error("[ERREUR]", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
  }
})();
