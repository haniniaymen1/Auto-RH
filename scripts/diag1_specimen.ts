/** Diagnostic 1 : specimen 50 — pourquoi le nom = FONCTION sur certaines pages. */
import { readFileSync } from "fs";
import {
  extractPdfPageTexts,
  extractEmployeeName,
} from "../src/lib/payslip-extractor";

async function main() {
  const spec = readFileSync("/home/z/my-project/upload/bulletins_specimen_50 (1).pdf");
  const { pageTexts } = await extractPdfPageTexts(spec);
  console.log("### pages =", pageTexts.length);
  for (const [i, text] of pageTexts.slice(0, 6).entries()) {
    console.log(`\n----- PAGE ${i + 1} (nom=${JSON.stringify(extractEmployeeName(text))}) -----`);
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => /NOM/i.test(l));
    console.log(lines.slice(Math.max(0, idx - 3), idx + 5).map((l) => "  | " + JSON.stringify(l)).join("\n"));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
