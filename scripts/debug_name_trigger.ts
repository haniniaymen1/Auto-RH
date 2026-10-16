// Debug : pourquoi la passe hi-res s'est-elle déclenchée ?
import fs from "fs";
import {
  ocrPdfPages,
  terminateOcrWorker,
} from "../src/lib/payslip-ocr";
import {
  detectCin,
  extractEmployeeName,
  extractPeriod,
  isHeaderGarbageName,
} from "../src/lib/payslip-extractor";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";

async function main() {
  const buffer = fs.readFileSync(pdfPath);
  const pages = await ocrPdfPages(buffer);
  const psm3Text = pages.filter(Boolean).join("\n").trim();
  console.log("PSM3 len:", psm3Text.length);
  console.log("cin:", detectCin(psm3Text));
  const name = extractEmployeeName(psm3Text);
  console.log("name:", JSON.stringify(name));
  console.log("name isGarbage:", isHeaderGarbageName(name));
  console.log("period:", extractPeriod(psm3Text));
  fs.writeFileSync("/home/z/my-project/scripts/psm3_text_dump.txt", psm3Text);

  // Ligne d'en-tête NOM et ligne suivante
  const lines = psm3Text.split("\n");
  lines.forEach((l, idx) => {
    if (/NOM[ \t]*(?:ET[ \t]*)?(?:PR[EÉ]NOMS?|PREN[O0]MS?)/i.test(l)) {
      console.log(`\nHEADER ligne ${idx}:`, JSON.stringify(l));
      console.log(`  i+1:`, JSON.stringify(lines[idx + 1]));
      console.log(`  i+2:`, JSON.stringify(lines[idx + 2]));
    }
  });
  // Garde "NOM ... :"
  console.log("\nGarde ':' présente ?", !!psm3Text.match(/NOM[ \t]*(?:ET[ \t]*)?(?:PR[EÉ]NOMS?)[ \t]*[:=]/));

  await terminateOcrWorker();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
