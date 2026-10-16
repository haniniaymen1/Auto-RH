// Compare la qualité OCR à 3 échelles de rendu
process.env.NODE_ENV = "production";
import fs from "fs";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812.pdf";
const targets = [1800, 2600, 3200];

const { ocrImageBuffer } = await import("../src/lib/payslip-ocr.js");

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { createRequire } = await import("node:module");
const reqCjs = createRequire(import.meta.url);
const pdfjsEntry = reqCjs.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const napi = createRequire(pdfjsEntry)("@napi-rs/canvas");

const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
const page = await doc.getPage(1);
const base = page.getViewport({ scale: 1 });

for (const target of targets) {
  const scale = Math.min(4, Math.max(1.5, target / (base.width || 595)));
  const viewport = page.getViewport({ scale });
  const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const png = await canvas.encode("png");
  const t0 = Date.now();
  const text = await ocrImageBuffer(Buffer.from(png));
  const dt = Date.now() - t0;
  const checks = {
    "N° CIN label": /N[°o0]?\s*CIN/i.test(text),
    "NOM ET PRENOM": /NOM\s*ET\s*PRENOM|NOMETPRENOM/i.test(text),
    "matricule 003879": /003879/.test(text),
    "CIN 12345678": /12345678/.test(text),
    "CNSS 17775208": /17775208/.test(text),
    "EMPLOYE TEST espace": /EMPLOYE\s+TEST/i.test(text),
    "dates 01/08/26+31/08/26": /01\/08\/26/.test(text) && /31\/08\/26/.test(text),
    "net 1593,851": /1593,851/.test(text),
  };
  console.log(`=== cible ${target}px (scale ${scale.toFixed(2)}, PNG ${png.length}o, OCR ${dt}ms, texte ${text.length}c) ===`);
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "OK " : "-- "} ${k}`);
  fs.writeFileSync(`/home/z/my-project/scripts/ocr_t${target}.txt`, text);
  page.cleanup();
}
process.exit(0);
