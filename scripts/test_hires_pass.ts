/** Task 15 — test passe hi-res (2x + PSM4) sur le PNG pdf2png */
import { readFileSync } from "fs";
import { ocrImageBuffer, ocrImageBufferPsm4, upscaleImageBuffer2x } from "../src/lib/payslip-ocr";

async function main() {
  const p = "/home/z/my-project/upload/pdf2png_extracted/Docs From Bh225_260914145812 (1)/Docs From Bh225_260914145812 (1)-1.png";
  const buffer = readFileSync(p);
  const upscaled = await upscaleImageBuffer2x(buffer);
  console.log("upscaled:", upscaled.length, "bytes");
  const second = await ocrImageBufferPsm4(upscaled);
  console.log("=== HI-RES PSM4 (lignes en-tête) ===");
  console.log(second.split("\n").slice(0, 14).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(2); });
