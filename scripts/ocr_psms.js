/** Test PSM modes sur le PNG specimen (zone en-tête illisible pour OCR). */
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

async function main() {
  const src = "/home/z/my-project/upload/spec_png/png/bulletin_900001_BELHADJ_SANA.png";
  const meta = await sharp(src).metadata();
  const up2 = await sharp(src).resize(meta.width * 2, meta.height * 2, { kernel: "lanczos3" }).png().toBuffer();

  for (const psm of ["4", "6", "11", "12"]) {
    const worker = await createWorker("fra", 1, {
      langPath: "/home/z/my-project/ocr-data",
      gzip: false,
      logger: () => undefined,
    });
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(up2);
    const t = (data.text || "").replace(/\r/g, "").trim();
    const hasName = /BELHADJ/.test(t);
    const hasSpec = /SPEC/.test(t);
    const hasPeriod = /01\/08\/26/.test(t);
    console.log(`PSM ${psm}: ${t.length} chars | BELHADJ:${hasName} SPEC:${hasSpec} PERIODE:${hasPeriod}`);
    if (psm === "11" || psm === "6") {
      console.log("--- extrait ---");
      console.log(t.slice(0, 600));
    }
    await worker.terminate();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
