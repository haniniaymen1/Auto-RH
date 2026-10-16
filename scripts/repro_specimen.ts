/**
 * Reproduction du problème "les données ne sont pas détectées"
 * avec les fichiers specimen envoyés par l'utilisateur.
 */
import * as fs from "fs";
import {
  analyzePayslip,
  analyzePayslipPages,
  groupMultiPayslips,
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  normalizeText,
} from "../src/lib/payslip-extractor";
import { xlsxToSheetTexts } from "../src/lib/payslip-office";

function show(label: string, r: any) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify({
    cin: r.cin, employeeName: r.employeeName, period: r.period,
    netSalary: r.netSalary, matricule: r.matricule, pages: r.pages, ocrUsed: r.ocrUsed,
  }));
}

async function main() {
  // 1. PDF texte (bulletins_specimen_50_PDF.zip)
  const pdf1 = fs.readFileSync("/home/z/my-project/upload/spec_pdf/pdf/bulletin_900001_BELHADJ_SANA.pdf");
  show("PDF (spec_pdf zip)", await analyzePayslip(pdf1));

  // 2. PNG (bulletins_specimen_50_PNG.zip) -> chemin OCR
  const png1 = fs.readFileSync("/home/z/my-project/upload/spec_png/png/bulletin_900001_BELHADJ_SANA.png");
  const { ocrImageBuffer } = await import("../src/lib/payslip-ocr");
  const ocrText = await ocrImageBuffer(png1);
  console.log("\n=== PNG OCR brut (bulletin_900001) — longueur:", ocrText.length, "===");
  console.log(JSON.stringify(ocrText.slice(0, 700)));
  console.log("--- détections sur texte OCR:");
  console.log(JSON.stringify({
    cin: detectCin(ocrText),
    employeeName: extractEmployeeName(ocrText),
    period: extractPeriod(ocrText),
    netSalary: extractNetSalary(ocrText),
    matricule: extractMatricule(ocrText),
  }));

  // 3. XLSX
  const xlsx1 = fs.readFileSync("/home/z/my-project/upload/bulletins_specimen_50.xlsx");
  const { sheetNames, sheetTexts } = xlsxToSheetTexts(xlsx1);
  console.log("\n=== XLSX feuilles:", sheetNames.length, "===");
  console.log("Feuille 1 (400 premiers chars):");
  console.log(JSON.stringify(sheetTexts[0].slice(0, 400)));
  console.log("--- détections feuille 1:");
  console.log(JSON.stringify({
    cin: detectCin(sheetTexts[0]),
    employeeName: extractEmployeeName(sheetTexts[0]),
    period: extractPeriod(sheetTexts[0]),
    netSalary: extractNetSalary(sheetTexts[0]),
    matricule: extractMatricule(sheetTexts[0]),
  }));

  // 4. PDF multi-fiches (50 bulletins)
  const multi = fs.readFileSync("/home/z/my-project/upload/bulletins_specimen_50.pdf");
  const { pages, pagePayslips } = await analyzePayslipPages(multi);
  console.log("\n=== PDF multi:", pages, "pages ===");
  const groups = groupMultiPayslips(pagePayslips);
  console.log("groupes:", groups ? groups.length : "null (mono-fiche historique)");
  console.log("page 1:", JSON.stringify({
    cin: pagePayslips[0].cin, emp: pagePayslips[0].employeeName,
    per: pagePayslips[0].period, net: pagePayslips[0].netSalary,
  }));
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e); process.exit(1); });
