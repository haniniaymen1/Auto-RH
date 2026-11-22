/**
 * Diagnostic « detection fausse » — dump des textes réels vus par l'extracteur.
 *  1. Pages 1-4 de bulletins_specimen_50 (1).pdf (chemin texte pdf-parse)
 *  2. OCR (canal normal + hi-res) de « Docs From Bh225_260914145812 (1).pdf »
 *  3. OCR direct de « Docs From Bh225_260914145812 (1)-1.png »
 * Puis exécute extractEmployeeName / detectCin / detectCinFromTableContext
 * sur chaque texte pour reproduire les détections fautives.
 */
import { readFileSync } from "fs";
import {
  extractPdfPageTexts,
  extractEmployeeName,
  detectCin,
  detectCinFromTableContext,
  analyzePayslip,
} from "../src/lib/payslip-extractor";
import { ocrImageBuffer } from "../src/lib/payslip-ocr";

async function main() {
  // ---------- 1. Specimen multi-fiches (texte) ----------
  const spec = readFileSync("/home/z/my-project/upload/bulletins_specimen_50 (1).pdf");
  const specParsed = await extractPdfPageTexts(spec);
  const pages = specParsed.pageTexts.map((text, i) => ({ page: i + 1, text }));
  console.log("### SPECIMEN : pages =", specParsed.pages);
  for (const p of pages.slice(0, 4)) {
    console.log(`\n----- PAGE ${p.page} (nom=${JSON.stringify(extractEmployeeName(p.text))}) -----`);
    const lines = p.text.split("\n");
    const idx = lines.findIndex((l) => /NOM/i.test(l));
    console.log(lines.slice(Math.max(0, idx - 2), idx + 5).map((l) => "  | " + l).join("\n"));
  }

  // ---------- 2. Docs (1).pdf — image PDF (OCR) ----------
  console.log("\n\n### DOCS (1).pdf (image) — analysePayslip complet :");
  const bufA = readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812 (1).pdf");
  const a = await analyzePayslip(bufA);
  console.log("  analyzePayslip:", JSON.stringify({
    cin: a.cin, employeeName: a.employeeName, period: a.period,
    netSalary: a.netSalary, matricule: a.matricule,
  }, null, 2));
  console.log("  --- texte OCR A (1000 premiers caractères) ---");
  console.log(a.text.slice(0, 1000).split("\n").map((l) => "  | " + l).join("\n"));

  // ---------- 3. PNG direct ----------
  console.log("\n\n### DOCS (1)-1.png — OCR direct :");
  const bufB = readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.png");
  const ocrB = await ocrImageBuffer(bufB);
  const tB = typeof ocrB === "string" ? ocrB : (ocrB as any)?.text ?? String(ocrB);
  console.log("  extractEmployeeName:", JSON.stringify(extractEmployeeName(tB)));
  console.log("  detectCin          :", JSON.stringify(detectCin(tB)));
  console.log("  detectCinFromTable :", JSON.stringify(detectCinFromTableContext(tB)));
  console.log("  --- texte OCR B (1200 premiers caractères) ---");
  console.log(tB.slice(0, 1200).split("\n").map((l) => "  | " + l).join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
