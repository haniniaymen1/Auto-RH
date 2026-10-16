/** Task 110 — DocsFromBh225 : pages identiques (copies) ou distinctes ? */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ROOT = "/home/z/my-project/task104_specimen/app";

async function main() {
  const pdfjs = await import("file://" + path.join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"));
  const { createCanvas } = require(path.join(ROOT, "node_modules", "@napi-rs", "canvas"));
  const f = "/home/z/my-project/upload/DocsFromBh225_260914145812_200_copies.pdf";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), isEvalSupported: false, disableFontFace: true }).promise;
  const hashes = [];
  for (const p of [1, 2, 3, 50, 100, 150, 200]) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 0.3 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const png = await canvas.encode("png");
    hashes.push({ p, h: crypto.createHash("sha1").update(png).digest("hex").slice(0, 10) });
    page.cleanup();
  }
  console.log("empreintes (scale 0.3) :", hashes.map((x) => `p${x.p}=${x.h}`).join("  "));
  const uniques = new Set(hashes.map((x) => x.h));
  console.log(uniques.size === 1 ? "=> TOUTES IDENTIQUES (copies → OCR dédupliqué, traitement rapide)" : `=> ${uniques.size}/${hashes.length} DISTINCTES (pages différentes → OCR par page, traitement long)`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
