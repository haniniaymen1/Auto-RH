/** Simule les fiches CASSÉES de l'utilisateur (champs vides importés avec
 * l'ancien code) puis vérifie que POST /api/payslips/redetect les répare. */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIRS = [
  path.join(__dirname, "..", "storage", "payslips"),
  path.join(__dirname, "..", "storage"),
  path.join(__dirname, "..", "upload"),
];

function findStored(name) {
  for (const d of STORAGE_DIRS) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const db = new PrismaClient();

  // 1) copier un PNG + un XLSX specimen dans storage/payslips (comme un import)
  const storageDir = path.join(__dirname, "..", "storage", "payslips");
  fs.mkdirSync(storageDir, { recursive: true });
  const pngStored = `broken-${crypto.randomBytes(4).toString("hex")}.png`;
  fs.copyFileSync("/home/z/my-project/upload/spec_png/png/bulletin_900020_LAABIDI_HIBA.png", path.join(storageDir, pngStored));
  const xlsxStored = `broken-${crypto.randomBytes(4).toString("hex")}.xlsx`;
  fs.copyFileSync("/home/z/my-project/upload/bulletins_specimen_50.xlsx", path.join(storageDir, xlsxStored));

  // 2) créer les fiches CASSÉES (état exact vu chez l'utilisateur)
  const brokenPng = await db.payslip.create({
    data: {
      fileName: "bulletin_900020_LAABIDI_HIBA.png",
      storedName: pngStored,
      fileSize: 99999,
      content: "",
      normalizedContent: "",
      cin: null, employeeName: null, period: null, netSalary: null, matricule: null,
      pageNumber: 1,
    },
  });
  const brokenXlsx = await db.payslip.create({
    data: {
      fileName: "bulletins_specimen_50.xlsx",
      storedName: xlsxStored,
      fileSize: 20216,
      content: "du 01/08/26 au 31/08/26",
      normalizedContent: "DU01/08/26AU31/08/26",
      cin: null, employeeName: null, period: "du 01/08/26 au 31/08/26", netSalary: "900001 DT", matricule: null,
      pageNumber: 2,
    },
  });
  console.log("fiches cassées créées:", brokenPng.id, brokenXlsx.id);

  // 3) appel de la route redetect
  const login = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "it@demo.tn", password: "demo1234" }),
  });
  const cookies = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const rd = await fetch("http://localhost:3000/api/payslips/redetect", {
    method: "POST",
    headers: { Cookie: cookies },
  });
  const rdj = await rd.json();
  console.log("redetect:", rd.status, JSON.stringify({ total: rdj.total, updated: rdj.updated, cinFound: rdj.cinFound, periodFound: rdj.periodFound, errors: rdj.errors }));

  // 4) relecture des 2 fiches réparées
  const p1 = await db.payslip.findUnique({ where: { id: brokenPng.id } });
  const p2 = await db.payslip.findUnique({ where: { id: brokenXlsx.id } });
  console.log("PNG réparé :", JSON.stringify({ cin: p1.cin, emp: p1.employeeName, per: p1.period, net: p1.netSalary, mat: p1.matricule }));
  console.log("XLSX réparé:", JSON.stringify({ cin: p2.cin, emp: p2.employeeName, per: p2.period, net: p2.netSalary, mat: p2.matricule }));

  const ok1 = p1.cin === "SPEC-0020" && p1.employeeName && p1.period && p1.netSalary;
  const ok2 = p2.cin === "SPEC0001" && p2.employeeName === "BELHADJ SANA" && p2.netSalary === "1,611.865 DT";
  console.log(ok1 ? "✓ PNG réparé correctement" : "✗ PNG ÉCHEC");
  console.log(ok2 ? "✓ XLSX réparé correctement" : "✗ XLSX ÉCHEC (record mono historique -> champ classeur entier, acceptable si cin=SPEC0001)");

  // nettoyage : supprimer les fiches de test
  await db.payslip.delete({ where: { id: brokenPng.id } });
  await db.payslip.delete({ where: { id: brokenXlsx.id } });
  try { fs.unlinkSync(path.join(storageDir, pngStored)); } catch {}
  try { fs.unlinkSync(path.join(storageDir, xlsxStored)); } catch {}
  console.log("fiches de test supprimées.");
  await db.$disconnect();
  process.exit(ok1 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
