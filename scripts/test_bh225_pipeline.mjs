// Test pipeline complet analyzePayslip sur le PDF Bh225 (PNG->PDF)
process.env.NODE_ENV = "production";
import fs from "fs";
import { analyzePayslip } from "../src/lib/payslip-extractor.js";

async function main() {
  const buffer = fs.readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812.pdf");
  const t0 = Date.now();
  const result = await analyzePayslip(buffer);
  const dt = Date.now() - t0;
  console.log("=== Durée:", dt, "ms ===");
  console.log("ocrUsed:", result.ocrUsed);
  console.log("pages:", result.pages);
  console.log("cin:", result.cin);
  console.log("employeeName:", result.employeeName);
  console.log("period:", result.period);
  console.log("netSalary:", result.netSalary);
  console.log("matricule:", result.matricule);
  console.log("=== TEXT (1000 premiers) ===");
  console.log((result.text || "").slice(0, 1000));
  console.log("=== FIN TEXT (longueur totale:", (result.text||"").length, ") ===");
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERREUR:", e); process.exit(1); });
