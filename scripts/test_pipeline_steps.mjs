// Reproduit l'ordre EXACT du pipeline analyzePayslip pour isoler le crash
process.env.NODE_ENV = "production";
import fs from "fs";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812.pdf";
const buffer = fs.readFileSync(pdfPath);

console.log("[A] extractPdfText (pdf-parse)...");
const { extractPdfText } = await import("../src/lib/payslip-extractor.js");
const { text, pages } = await extractPdfText(buffer);
console.log("[A] OK — texte:", JSON.stringify(text.slice(0, 40)), "pages:", pages);

console.log("[B] renderPdfPagesToPng (pdf.js + canvas adopté)...");
const { renderPdfPagesToPng, ocrImageBuffer } = await import("../src/lib/payslip-ocr.js");
const images = await renderPdfPagesToPng(buffer);
console.log("[B] OK —", images.length, "page(s):", images.map((b) => b.length).join(","));

console.log("[C] OCR...");
const ocrText = await ocrImageBuffer(images[0]);
console.log("[C] OK — texte OCR:", ocrText.length, "caractères");

console.log("[D] détection...");
const { detectCin, extractEmployeeName, extractPeriod, extractNetSalary } = await import("../src/lib/payslip-extractor.js");
console.log("    CIN:", detectCin(ocrText));
console.log("    Employé:", extractEmployeeName(ocrText));
console.log("    Période:", extractPeriod(ocrText));
console.log("    Net:", extractNetSalary(ocrText));
console.log("[D] TERMINÉ SANS CRASH");
process.exit(0);
