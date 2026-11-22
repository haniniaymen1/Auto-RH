process.env.NODE_ENV = "production";
import fs from "fs";
const pdfPath = process.argv[2];
const { renderPdfPagesToPng } = await import("../src/lib/payslip-ocr.js");
console.log("render de:", pdfPath);
const images = await renderPdfPagesToPng(fs.readFileSync(pdfPath));
console.log("RENDU OK:", images.length, "page(s)");
for (const [i, img] of images.entries()) {
  fs.writeFileSync(`/home/z/my-project/scripts/diag_render_p${i + 1}.png`, img);
  console.log(`  page ${i + 1}: ${img.length} octets -> scripts/diag_render_p${i + 1}.png`);
}
process.exit(0);
