// Diagnostic complet : instance Path2D partagée + rendu
process.env.NODE_ENV = "production";
import fs from "fs";

const pdfPath = process.argv[2] || "/home/z/my-project/upload/user_slips/fiche_de_paie_01.pdf";

const napi = await import("@napi-rs/canvas");
console.log("[1] napi.Path2D:", typeof napi.Path2D);

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
console.log("[2] après import pdf.mjs — globalThis.Path2D:", typeof globalThis.Path2D);
console.log("[2] même référence que napi.Path2D ?", globalThis.Path2D === napi.Path2D);
console.log("[2] globalThis.DOMMatrix === napi.DOMMatrix ?", globalThis.DOMMatrix === napi.DOMMatrix);

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
console.log("[3] pages:", doc.numPages);
const page = await doc.getPage(1);
const base = page.getViewport({ scale: 1 });
const scale = Math.min(4, Math.max(1.5, 1800 / (base.width || 595)));
const viewport = page.getViewport({ scale });
console.log("[4] viewport:", Math.ceil(viewport.width), "x", Math.ceil(viewport.height), "scale:", scale.toFixed(2));

const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, canvas.width, canvas.height);
console.log("[5] render...");
try {
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  console.log("[5] render OK");
} catch (e) {
  console.error("[5] RENDER ERREUR:", e?.name, e?.code, e?.message?.slice(0, 200));
  throw e;
}
const png = await canvas.encode("png");
console.log("[6] PNG:", png.length, "octets");
fs.writeFileSync("/home/z/my-project/scripts/diag_p1.png", Buffer.from(png));
process.exit(0);
