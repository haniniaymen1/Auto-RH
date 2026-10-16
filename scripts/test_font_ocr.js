/**
 * Expérience : rendu de texte sur canvas @napi-rs/canvas avec DIFFÉRENTES
 * polices -> OCR de chaque rendu -> on choisit la police la plus lisible.
 * (Diagnostic pour les échantillons de test multi-formats.)
 */
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const { createWorker } = require("tesseract.js");

const LINES = [
  "BULLETIN DE PAIE",
  "Société : DEMO SARL",
  "Nom et prénom : BEN SALAH Hana",
  "Matricule : MAT-5001",
  "C.I.N : 70077889",
  "Période de paie : 07/2026",
  "Salaire de base : 1 500,000",
  "Net à payer : 2 175,500",
];

const FONTS = [
  "bold 44px sans-serif",
  "bold 48px DejaVu Sans",
  "bold 48px Noto Sans SC",
  "bold 48px LXGW WenKai",
];

async function ocr(buf) {
  const worker = await createWorker("fra", 1, {
    langPath: "/home/z/my-project/ocr-data",
    gzip: false,
    logger: () => undefined,
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(buf);
  await worker.terminate();
  return (data.text || "").replace(/\r/g, "").trim();
}

(async () => {
  for (const font of FONTS) {
    const W = 1500;
    const H = 120 + LINES.length * 70;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000000";
    ctx.font = font;
    let y = 90;
    for (const line of LINES) {
      ctx.fillText(line, 60, y);
      y += 70;
    }
    const png = await canvas.encode("png");
    const txt = await ocr(png);
    const name = font.replace(/[^a-z0-9]+/gi, "_");
    fs.writeFileSync(path.join(__dirname, `font_test_${name}.png`), png);
    console.log("=== POLICE:", font, "===");
    console.log(txt.split("\n").slice(0, 12).join(" | "));
    console.log("");
  }
})();
