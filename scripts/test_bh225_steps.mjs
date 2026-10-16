// Test étape par étape : rendu pdf.js + canvas puis OCR
process.env.NODE_ENV = "production";
import fs from "fs";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812.pdf";

console.log("STEP 1: rendu PDF -> PNG");
const { renderPdfPagesToPng } = await import("../src/lib/payslip-ocr.js");
let images;
try {
  images = await renderPdfPagesToPng(fs.readFileSync(pdfPath));
  console.log("STEP 1 OK:", images.length, "page(s), tailles:", images.map((b) => b.length).join(", "));
} catch (e) {
  console.error("STEP 1 ÉCHEC:", e?.message || e);
  process.exit(1);
}

console.log("STEP 2: OCR de la page");
const { ocrImageBuffer } = await import("../src/lib/payslip-ocr.js");
try {
  const text = await ocrImageBuffer(images[0]);
  console.log("STEP 2 OK — longueur texte OCR:", text.length);
  console.log("=== TEXTE OCR ===");
  console.log(text);
  console.log("=== FIN ===");
} catch (e) {
  console.error("STEP 2 ÉCHEC:", e?.message || e);
  process.exit(1);
}
process.exit(0);
