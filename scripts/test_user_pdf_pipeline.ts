// Test complet du pipeline sur le PDF problematique de l'utilisateur
import fs from "fs";
import path from "path";
import { analyzePayslip } from "../src/lib/payslip-extractor";

async function main() {
  const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";
  const buffer = fs.readFileSync(pdfPath);
  console.log("=== analysePayslip sur:", path.basename(pdfPath), "===");
  const t0 = Date.now();
  const result = await analyzePayslip(buffer);
  console.log("Temps:", ((Date.now() - t0) / 1000).toFixed(1), "s");
  console.log("--- ocrUsed:", result.ocrUsed, "| pages:", result.pages);
  console.log("--- cin:", JSON.stringify(result.cin));
  console.log("--- employeeName:", JSON.stringify(result.employeeName));
  console.log("--- period:", JSON.stringify(result.period));
  console.log("--- netSalary:", JSON.stringify(result.netSalary));
  console.log("--- matricule:", JSON.stringify(result.matricule));
  console.log("--- text length:", result.text.length);
  console.log("=== TEXTE OCR (premiers 2500 chars) ===");
  console.log(result.text.slice(0, 2500));
  process.exit(0);
}

main().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
