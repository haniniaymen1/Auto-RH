// Isole le parametre responsable : PSM3 explicite vs defaut tesseract.js
import fs from "fs";
import { renderPdfPagesToPng } from "../src/lib/payslip-ocr";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";

async function makeWorker(params) {
  const { createWorker } = await import("tesseract.js");
  const w = await createWorker("fra", 1, {
    langPath: "/home/z/my-project/ocr-data",
    gzip: false,
    logger: () => undefined,
    errorHandler: () => undefined,
  });
  if (params) await w.setParameters(params);
  return w;
}

const sig = (t) =>
  JSON.stringify({
    cin: t.includes("149654358"),
    nom: t.toLowerCase().includes("amine trablesi"),
    mat: t.includes("003879"),
    len: t.length,
  });

async function main() {
  const buffer = fs.readFileSync(pdfPath);
  const images = await renderPdfPagesToPng(buffer);
  const img = images[0];

  // C) clone EXACT du worker module : preserve_interword_spaces seul
  const wC = await makeWorker({ preserve_interword_spaces: "1" });
  const tC = (await wC.recognize(img)).data.text.replace(/\r/g, "").trim();
  await wC.terminate();
  console.log("C) preserve seul (clone module)      :", sig(tC));

  // D) PSM3 seul (sans preserve)
  const wD = await makeWorker({ tessedit_pageseg_mode: "3" });
  const tD = (await wD.recognize(img)).data.text.replace(/\r/g, "").trim();
  await wD.terminate();
  console.log("D) PSM3 seul (sans preserve)         :", sig(tD));

  // E) aucun setParameters
  const wE = await makeWorker(null);
  const tE = (await wE.recognize(img)).data.text.replace(/\r/g, "").trim();
  await wE.terminate();
  console.log("E) aucun parametre (defaut brut)     :", sig(tE));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
