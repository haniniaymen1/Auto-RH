// Teste prétraitements sharp + PSM pour améliorer l'OCR du scan fax
process.env.NODE_ENV = "production";
import fs from "fs";
import sharp from "sharp";

const srcPng = fs.readFileSync("/home/z/my-project/scripts/diag_render_p1.png"); // rendu 1800px Bh225

const { createWorker } = await import("tesseract.js");
const worker = await createWorker("fra", 1, {
  langPath: "/home/z/my-project/ocr-data",
  gzip: false,
  logger: () => undefined,
});
await worker.setParameters({ preserve_interword_spaces: "1" });

const variants = {
  "base (aucun)": (b) => Promise.resolve(b),
  "gray+norm+sharpen": (b) => sharp(b).grayscale().normalise().sharpen().png().toBuffer(),
  "gray+thresh150": (b) => sharp(b).grayscale().threshold(150).png().toBuffer(),
  "gray+norm 1.5x": (b) => sharp(b).grayscale().normalise().resize({ width: Math.round(1800 * 1.5), kernel: "lanczos3" }).png().toBuffer(),
};

const psmVariants = [null, "6", "4"];

for (const [name, fn] of Object.entries(variants)) {
  const buf = await fn(srcPng);
  for (const psm of psmVariants) {
    if (psm) await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
    else await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(buf);
    const text = (data.text || "").replace(/\r/g, "");
    const checks = {
      headerNomPren: /NOM\w*\s*(?:ET|E)?\s*PRE\w+/i.test(text),
      cin12345678: /12345678/.test(text),
      cnss17775208: /17775208/.test(text),
      matr003879: /003879/.test(text),
      employeTestSep: /EMPLOYE\s+TEST/i.test(text),
      dates: /01\/08\/26/.test(text) && /31\/08\/26/.test(text),
      net: /1593,851/.test(text),
    };
    const score = Object.values(checks).filter(Boolean).length;
    console.log(`[${score}/7] ${name} + PSM ${psm || "3"}` , JSON.stringify(checks));
  }
}
await worker.terminate();
process.exit(0);
