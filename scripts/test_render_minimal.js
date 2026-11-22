/**
 * Test minimal : rendu pdfjs + @napi-rs/canvas en Node PUR (sans tsx).
 * Isole le problème "Value is none of these types String, Path".
 */
const { createRequire } = require("node:module");
const req = createRequire(__filename);
const napi = req("@napi-rs/canvas");
if (!globalThis.Path2D) globalThis.Path2D = napi.Path2D;
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = napi.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = napi.ImageData;

async function main() {
  const fs = require("fs");
  const buffer = fs.readFileSync(
    "/home/z/my-project/upload/zip2_extracted/fiche_de_paie_01_Jean_Dupont.pdf"
  );
  const pdfjs = await req("pdfjs-dist/legacy/build/pdf.mjs");
  console.log("workerSrc:", pdfjs.GlobalWorkerOptions.workerSrc || "(non défini)");
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  console.log("pages:", doc.numPages);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    console.log("RENDU OK —", canvas.width, "x", canvas.height);
  } catch (e) {
    console.error("RENDU ÉCHOUÉ:", e.message);
    process.exitCode = 1;
  }
  await doc.destroy().catch(() => undefined);
}
main().catch((e) => { console.error(e); process.exit(1); });
