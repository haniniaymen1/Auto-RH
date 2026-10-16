/** Diagnostic 2 : textes OCR bruts (passe normale SEULE, sans hi-res) de A et B. */
import { readFileSync } from "fs";
import { ocrPdfPages, ocrImageBuffer } from "../src/lib/payslip-ocr";
import {
  detectCin,
  detectCinFromTableContext,
  lineHasCnssKeyAfter,
  extractEmployeeName,
} from "../src/lib/payslip-extractor";

async function main() {
  const bufA = readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812 (1).pdf");
  let t0 = Date.now();
  const pagesA = await ocrPdfPages(bufA);
  const textA = pagesA.filter(Boolean).join("\n");
  console.log(`### A OCR (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${textA.length} car.`);
  console.log("detectCin(A)          :", detectCin(textA));
  console.log("tableContext(A)       :", detectCinFromTableContext(textA));
  console.log("cnssKeyAfter(A,12345678)?", textA.includes("12345678") ? lineHasCnssKeyAfter(textA, "12345678") : "absent du texte");
  console.log("nom(A)                :", JSON.stringify(extractEmployeeName(textA)));
  console.log("---- TEXTE A (lignes 1-45) ----");
  console.log(textA.split("\n").slice(0, 45).map((l) => "  | " + JSON.stringify(l)).join("\n"));

  const bufB = readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.png");
  t0 = Date.now();
  const rB = await ocrImageBuffer(bufB);
  const textB = typeof rB === "string" ? rB : (rB as any)?.text ?? "";
  console.log(`\n### B OCR (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${textB.length} car.`);
  console.log("detectCin(B)          :", detectCin(textB));
  console.log("tableContext(B)       :", detectCinFromTableContext(textB));
  console.log("cnssKeyAfter(B,17775208)?", lineHasCnssKeyAfter(textB, "17775208"));
  console.log("nom(B)                :", JSON.stringify(extractEmployeeName(textB)));
  console.log("---- TEXTE B (lignes 1-45) ----");
  console.log(textB.split("\n").slice(0, 45).map((l) => "  | " + JSON.stringify(l)).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
