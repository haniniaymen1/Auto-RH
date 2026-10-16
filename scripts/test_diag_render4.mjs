// Diagnostic v4 : compare require CJS (comme payslip-ocr.ts) vs global
process.env.NODE_ENV = "production";
import fs from "fs";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const napi = requireCjs("@napi-rs/canvas");
console.log("[1] napi(CJS).Path2D:", typeof napi.Path2D);

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
console.log("[2] globalThis.Path2D === napi(CJS).Path2D ?", globalThis.Path2D === napi.Path2D);
console.log("[2] globalThis.DOMMatrix === napi(CJS).DOMMatrix ?", globalThis.DOMMatrix === napi.DOMMatrix);

const pdfPath = process.argv[2] || "/home/z/my-project/upload/user_slips/fiche_de_paie_01.pdf";
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
const page = await doc.getPage(1);
const base = page.getViewport({ scale: 1 });
const scale = Math.min(4, Math.max(1.5, 1800 / (base.width || 595)));
const viewport = page.getViewport({ scale });

const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, canvas.width, canvas.height);
console.log("[3] render avec napi(CJS) canvas...");
try {
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  console.log("[3] RENDER OK");
  const png = await canvas.encode("png");
  console.log("[4] PNG:", png.length, "octets");
} catch (e) {
  console.error("[3] ERREUR:", e?.message?.slice(0, 150));
  process.exit(1);
}
process.exit(0);
