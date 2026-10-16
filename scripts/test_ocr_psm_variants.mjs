// Teste des variantes OCR (PSM 6/11/12, échelle de rendu supérieure) pour
// trouver la lecture la plus fiable de cette fiche "TUNIS CALL CENTER".
import fs from "fs";
import { createRequire } from "module";
const require2 = createRequire("/home/z/my-project/package.json");

const {
  renderPdfPagesToPng,
  terminateOcrWorker,
} = await import("/home/z/my-project/src/lib/payslip-ocr.ts");

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";
const TARGETS = ["149654358", "amine trablesi", "aminetrablesi", "003879", "17775208"];

function report(label, text) {
  const low = text.toLowerCase().replace(/\s+/g, " ");
  const hits = {};
  for (const t of TARGETS) hits[t] = low.includes(t);
  return { label, hits, text };
}

async function ocrWithPsm(image, psm) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("fra", 1, {
    langPath: "/home/z/my-project/ocr-data",
    gzip: false,
    logger: () => undefined,
    errorHandler: () => undefined,
  });
  await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(image);
  await worker.terminate();
  return (data?.text || "").replace(/\r/g, "").trim();
}

async function main() {
  const buffer = fs.readFileSync(pdfPath);
  const images = await renderPdfPagesToPng(buffer);
  const img = images[0];
  console.log("Image rendue:", img.length, "bytes");

  const results = [];
  for (const psm of ["3", "4", "6", "11"]) {
    try {
      const t = await ocrWithPsm(img, psm);
      results.push(report(`PSM ${psm} (rendu standard)`, t));
    } catch (e) {
      console.error(`PSM ${psm} échec:`, e.message);
    }
  }

  for (const r of results) {
    const score = Object.values(r.hits).filter(Boolean).length;
    console.log(`\n### ${r.label} — score ${score}/${TARGETS.length}`);
    console.log("   ", JSON.stringify(r.hits));
  }

  // Affiche le début du meilleur (priorité: nom avec espace > CIN)
  const best = [...results].sort((a, b) => {
    const sa = (a.hits["amine trablesi"] ? 10 : 0) + (a.hits["149654358"] ? 5 : 0) + (a.hits["003879"] ? 2 : 0);
    const sb = (b.hits["amine trablesi"] ? 10 : 0) + (b.hits["149654358"] ? 5 : 0) + (b.hits["003879"] ? 2 : 0);
    return sb - sa;
  })[0];
  console.log(`\n===== MEILLEUR: ${best.label} =====`);
  console.log(best.text.slice(0, 1500));

  await terminateOcrWorker();
  fs.writeFileSync("/home/z/my-project/scripts/ocr_variant_best.txt", best.text);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
