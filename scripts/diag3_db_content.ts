/** Diagnostic 3 : lit le contenu EXACT stocké en base pour A et B (ce que le détecteur a vu). */
import { PrismaClient } from "@prisma/client";
import {
  detectCin,
  detectCinFromTableContext,
  lineHasCnssKeyAfter,
  extractEmployeeName,
  isHeaderGarbageName,
} from "../src/lib/payslip-extractor";

const p = new PrismaClient();

async function show(label: string, fileName: string) {
  const rec = await p.payslip.findFirst({
    where: { fileName },
    orderBy: { uploadedAt: "desc" },
  });
  if (!rec) return console.log(label, "introuvable");
  const t = rec.content || "";
  console.log(`\n=================== ${label} (${fileName}) ===================`);
  console.log("cin stocké      :", rec.cin, "| nom stocké :", JSON.stringify(rec.employeeName));
  console.log("detectCin(content)   :", detectCin(t));
  console.log("tableContext(content):", detectCinFromTableContext(t));
  if (rec.cin) console.log("cnssKeyAfter(content, cin):", lineHasCnssKeyAfter(t, rec.cin));
  console.log("nom(content)         :", JSON.stringify(extractEmployeeName(t)));
  console.log("garbageName?         :", isHeaderGarbageName(rec.employeeName));
  const lines = t.split("\n");
  console.log(`---- ${lines.length} lignes ; zones clés ----`);
  lines.forEach((l, i) => {
    if (/CIN|CNSS|NOM|MATRICULE|PRENOM|CIVIL|CHARGE|COTES|12345678|177752|149654/i.test(l)) {
      console.log(`  [${i}] ${JSON.stringify(l)}`);
    }
  });
}

async function main() {
  await show("A", "Docs From Bh225_260914145812 (1).pdf");
  await show("B", "Docs From Bh225_260914145812 (1)-1.png");
  await p.$disconnect();
}
main();
