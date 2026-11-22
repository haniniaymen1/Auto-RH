/**
 * Test OCR : image brute vs 2x upscale vs 2x + gris normalisé
 * sur la zone d'en-tête du bulletin specimen.
 */
const sharp = require("sharp");
const fs = require("fs");
const { createWorker } = require("tesseract.js");

async function ocr(worker, label, buf) {
  const { data } = await worker.recognize(buf);
  const t = (data.text || "").replace(/\r/g, "").trim();
  console.log(`\n########## ${label} (${t.length} chars) ##########`);
  console.log(t.slice(0, 900));
  return t;
}

async function main() {
  const src = "/home/z/my-project/upload/spec_png/png/bulletin_900001_BELHADJ_SANA.png";
  const img = sharp(src);
  const meta = await img.metadata();

  // variante A : 2x upscale
  const up2 = await sharp(src).resize(meta.width * 2, meta.height * 2, { kernel: "lanczos3" }).png().toBuffer();
  // variante B : 2x + grayscale + normalisation contraste
  const up2g = await sharp(src).resize(meta.width * 2, meta.height * 2, { kernel: "lanczos3" }).grayscale().normalise().png().toBuffer();

  const worker = await createWorker("fra", 1, {
    langPath: "/home/z/my-project/ocr-data",
    gzip: false,
    logger: () => undefined,
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });

  await ocr(worker, "A: 2x upscale", up2);
  await ocr(worker, "B: 2x + gris + normalise", up2g);
  await worker.terminate();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
