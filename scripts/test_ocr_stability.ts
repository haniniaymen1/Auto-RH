// Stabilité OCR : ocrPdfPages (worker partagé) vs worker frais PSM3
// — 2 exécutions chacune dans des processus séparés.
import fs from "fs";
import {
  renderPdfPagesToPng,
  ocrImageBuffer,
  terminateOcrWorker,
} from "../src/lib/payslip-ocr";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";
const RUN = process.argv[2] || "1";

async function main() {
  const buffer = fs.readFileSync(pdfPath);
  const images = await renderPdfPagesToPng(buffer);

  // A) via ocrImageBuffer (worker partagé du module, PSM par défaut)
  const t1 = await ocrImageBuffer(images[0]);

  // B) worker frais explicite PSM3
  const { createWorker, PSM } = await import("tesseract.js");
  const w = await createWorker("fra", 1, {
    langPath: "/home/z/my-project/ocr-data",
    gzip: false,
    logger: () => undefined,
    errorHandler: () => undefined,
  });
  // (CORRECTIF v0.2.201) : `tessedit_pageseg_mode` attend une valeur de
  // l'enum `PSM` (pas une string brute "3"). On utilise `PSM.AUTO` qui
  // correspond à `'3'` — comportement runtime IDENTIQUE.
  await w.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.AUTO });
  const t2 = (await w.recognize(images[0])).data.text.replace(/\r/g, "").trim();
  await w.terminate();

  const sig = (t: string) =>
    JSON.stringify({
      cin_ok: t.includes("149654358"),
      nom_ok: t.toLowerCase().includes("amine trablesi"),
      mat_ok: t.includes("003879"),
      len: t.length,
    });

  console.log(`RUN ${RUN}] ocrImageBuffer (module):`, sig(t1));
  console.log(`RUN ${RUN}] worker frais PSM3       :`, sig(t2));
  fs.writeFileSync(`/home/z/my-project/scripts/stab_module_${RUN}.txt`, t1);
  fs.writeFileSync(`/home/z/my-project/scripts/stab_psm3_${RUN}.txt`, t2);

  await terminateOcrWorker();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
