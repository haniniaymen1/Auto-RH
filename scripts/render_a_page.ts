/** Rend la 1re page du PDF A en PNG pour inspection visuelle. */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(
    readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812 (1).pdf")
  );
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log("pages:", doc.numPages);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx as any,
    viewport,
    canvas,
  } as any).promise;
  const out = "/home/z/my-project/scripts/render_A_page1.png";
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log("écrit:", out, canvas.width, "x", canvas.height);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
