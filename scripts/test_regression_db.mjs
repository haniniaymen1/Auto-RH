// Régression complète : nouvelles règles vs DB (CIN, nom, période, net)
process.env.NODE_ENV = "production";
import fs from "fs";
import path from "path";
import {
  extractPdfText,
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
} from "../src/lib/payslip-extractor.js";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DIRS = [
  "/home/z/my-project/upload/user_slips",
  "/home/z/my-project/upload/zip2_extracted",
  "/home/z/my-project/upload/new_slips",
];

async function main() {
  // référence DB : fileName -> { cin, employeeName, period, netSalary }
  const rows = await db.payslip.findMany({
    select: { fileName: true, storedName: true, cin: true, employeeName: true, period: true, netSalary: true, content: true },
  });
  // map par storedName (fichier physique) pour éviter les doublons de fileName
  const byStored = new Map(rows.map((r) => [r.storedName, r]));

  let total = 0, changed = 0;
  for (const dir of DIRS) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".pdf")) continue;
      const filePath = path.join(dir, f);
      // retrouver la ligne DB par fileName (le storedName diffère)
      const dbRow = rows.find((r) => r.fileName === f);
      if (!dbRow) { console.log(`(non importé) ${f}`); continue; }
      total++;
      const { text } = await extractPdfText(fs.readFileSync(filePath));
      const now = {
        cin: detectCin(text),
        employeeName: extractEmployeeName(text),
        period: extractPeriod(text),
        netSalary: extractNetSalary(text),
        matricule: extractMatricule(text),
      };
      const diffs = [];
      for (const k of ["cin", "employeeName", "period", "netSalary", "matricule"]) {
        const dbVal = dbRow[k] ?? null;
        const nowVal = now[k] ?? null;
        if (dbVal !== nowVal) diffs.push(`${k}: DB=${JSON.stringify(dbVal)} -> NEW=${JSON.stringify(nowVal)}`);
      }
      if (diffs.length) {
        changed++;
        console.log(`⚠ ${f}`);
        for (const d of diffs) console.log(`   ${d}`);
      }
    }
  }
  console.log(`\n=== ${total} fiches comparées, ${changed} avec différences ===`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
