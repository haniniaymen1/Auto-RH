#!/usr/bin/env bash
# Task 24 — Test fonctionnel du script de migration scinder-excel-multipages.js
set -e
cd /home/z/my-project

echo "=== 1) Mode --verifier sur base sans fichier partagé ==="
node scripts/scinder-excel-multipages.js --verifier

echo ""
echo "=== 2) Simulation d'un classeur partagé 'pré-mise-à-jour' (3 fiches -> 1 fichier) ==="
node -e '
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

// crypto identique (Task 21)
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const SALT = "autorh-storage-v1";
const key = () => crypto.scryptSync(
  process.env.AUTO_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env",
  SALT, 32);
function encryptBuf(buf) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), nonce);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, nonce, c.getAuthTag(), enc]);
}

// .env chargé manuellement
const envPath = ".env";
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["'"'"']|["'"'"']$/g, "").trim();
  }
}

const db = new PrismaClient();
(async () => {
  const storedName = `migration-test-${Date.now()}.xlsx`;
  const buf = fs.readFileSync("test-data/fiches_excel_multi.xlsx");
  fs.writeFileSync(path.join("storage", "payslips", storedName), encryptBuf(buf));
  const recs = [
    { cin: "87000024", fileName: "fiches_excel_multi.xlsx", sourcePage: 1 },
    { cin: "87000025", fileName: "fiches_excel_multi.xlsx", sourcePage: 2 },
    { cin: "87000026", fileName: "fiches_excel_multi.xlsx", sourcePage: 3 },
  ];
  for (const r of recs) {
    await db.payslip.create({ data: {
      fileName: r.fileName, storedName, fileSize: buf.length,
      content: "N° CIN " + r.cin, normalizedContent: "NCIN" + r.cin,
      cin: r.cin, employeeName: "Test Migration", period: "Août 2026",
      netSalary: "1000", matricule: "MAT-TEST", pageNumber: 3, sourcePage: r.sourcePage,
    }});
  }
  console.log("STATE:" + storedName);
  await db.$disconnect();
})();
'

SHARED=$(node -e '
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const rows = await db.payslip.findMany({ where: { cin: { in: ["87000024","87000025","87000026"] } } });
  console.log(rows[0].storedName);
  await db.$disconnect();
})();')
echo "Classeur partagé simulé : $SHARED"

echo ""
echo "=== 3) Vérification avant scindage ==="
node scripts/scinder-excel-multipages.js --verifier

echo ""
echo "=== 4) SCINDAGE ==="
node scripts/scinder-excel-multipages.js

echo ""
echo "=== 5) Vérification après scindage ==="
node -e '
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const rows = await db.payslip.findMany({ where: { cin: { in: ["87000024","87000025","87000026"] } }, orderBy: { cin: "asc" } });
  const stored = rows.map(r => r.storedName);
  const distinct = new Set(stored).size === 3;
  const xlsx = stored.every(s => s.endsWith(".xlsx"));
  const names = rows.map(r => r.fileName).every(n => n.includes("(feuille "));
  const sizes = rows.map(r => r.fileSize);
  const small = sizes.every(s => s < 9169);
  console.log("storedName distincts:", distinct);
  console.log("extension .xlsx:", xlsx);
  console.log("noms suffixés (feuille N):", names, rows.map(r => r.fileName).join(" ; "));
  console.log("tailles individuelles:", sizes.join(","), "->", small ? "OK" : "KO");
  if (!(distinct && xlsx && names && small)) process.exit(1);
  await db.$disconnect();
})();'

echo ""
echo "=== 6) Isolation du contenu (fiche 87000025 servie) ==="
node -e '
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const envPath = ".env";
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["'"'"']|["'"'"']$/g, "").trim();
  }
}
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const key = () => crypto.scryptSync(
  process.env.AUTO_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env",
  "autorh-storage-v1", 32);
function decryptBuf(buf) {
  if (!buf.subarray(0, 9).equals(MAGIC)) return buf;
  const n = buf.subarray(9, 21); const t = buf.subarray(21, 37); const c = buf.subarray(37);
  const d = crypto.createDecipheriv("aes-256-gcm", key(), n); d.setAuthTag(t);
  return Buffer.concat([d.update(c), d.final()]);
}
const db = new PrismaClient();
(async () => {
  const rec = await db.payslip.findFirst({ where: { cin: "87000025" } });
  const data = decryptBuf(fs.readFileSync(path.join("storage", "payslips", rec.storedName)));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  let text = "";
  for (const ws of wb.worksheets) ws.eachRow({includeEmpty:true}, row => row.eachCell({includeEmpty:true}, c => { text += " " + (typeof c.value === "object" ? JSON.stringify(c.value) : c.value); }));
  const hasOwn = text.includes("87000025");
  const noLeak = !text.includes("87000024") && !text.includes("87000026");
  console.log("feuilles:", wb.worksheets.length, "| CIN propre:", hasOwn, "| fuite:", !noLeak ? "OUI !!!" : "non");
  if (wb.worksheets.length !== 1 || !hasOwn || !noLeak) process.exit(1);
  await db.$disconnect();
})();'

echo ""
echo "=== 7) Original conservé dans _originaux ==="
ls storage/payslips/_originaux/ | tail -3

echo ""
echo "=== 8) Nettoyage du test de migration ==="
node -e '
const fs = require("fs"); const path = require("path");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const rows = await db.payslip.findMany({ where: { cin: { in: ["87000024","87000025","87000026"] } } });
  for (const r of rows) {
    try { fs.unlinkSync(path.join("storage", "payslips", r.storedName)); } catch {}
    await db.payslip.delete({ where: { id: r.id } });
  }
  // original de test retiré de _originaux
  const dir = path.join("storage", "payslips", "_originaux");
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith("migration-test-")) fs.unlinkSync(path.join(dir, f));
  }
  console.log("Nettoyage:", rows.length, "fiches de migration supprimées");
  await db.$disconnect();
})();'

echo ""
echo "TEST MIGRATION TERMINÉ"
