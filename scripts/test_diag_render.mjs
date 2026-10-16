// Diagnostic : canvas seul, pdfjs seul, puis combinaison
process.env.NODE_ENV = "production";
import fs from "fs";

const which = process.argv[2] || "canvas";

if (which === "canvas") {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(1800, 2600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = "30px sans-serif";
  ctx.fillText("TEST CIN 07451236", 100, 200);
  const png = await canvas.encode("png");
  console.log("canvas OK:", png.length, "octets");
  process.exit(0);
}

if (which === "pdfjs-render") {
  const pdfPath = process.argv[3] || "/home/z/my-project/upload/Docs From Bh225_260914145812.pdf";
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  console.log("pages:", doc.numPages);
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  console.log("viewport base:", base.width, "x", base.height);
  const scale = Math.min(4, Math.max(1.5, 1800 / (base.width || 595)));
  console.log("scale:", scale);
  const viewport = page.getViewport({ scale });
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  console.log("render en cours... canvas", canvas.width, "x", canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  console.log("render OK");
  const png = await canvas.encode("png");
  console.log("png:", png.length, "octets");
  fs.writeFileSync("/home/z/my-project/scripts/test_render_out.png", Buffer.from(png));
  process.exit(0);
}
process.exit(0);
