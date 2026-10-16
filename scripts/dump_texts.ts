import * as fs from "fs";

async function main() {
  // Full OCR text of the PNG
  const png1 = fs.readFileSync("/home/z/my-project/upload/spec_png/png/bulletin_900001_BELHADJ_SANA.png");
  const { ocrImageBuffer } = await import("../src/lib/payslip-ocr");
  const ocrText = await ocrImageBuffer(png1);
  console.log("=== FULL PNG OCR ===");
  console.log(ocrText);

  // Full PDF text page 1
  const { PDFParse } = await import("pdf-parse");
  const p1 = fs.readFileSync("/home/z/my-project/upload/spec_pdf/pdf/bulletin_900001_BELHADJ_SANA.pdf");
  const d = new PDFParse({ data: p1 });
  const r = await d.getText();
  console.log("\n=== FULL PDF TEXT (spec_pdf) ===");
  console.log(r.text);
  await d.destroy();

  // XLSX sheet 2
  const { xlsxToSheetTexts } = await import("../src/lib/payslip-office");
  const x = xlsxToSheetTexts(fs.readFileSync("/home/z/my-project/upload/bulletins_specimen_50.xlsx"));
  console.log("\n=== XLSX sheets:", x.sheetNames, "===");
  console.log("--- Sheet 2 (first 900 chars):");
  console.log(x.sheetTexts[1]?.slice(0, 900));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
