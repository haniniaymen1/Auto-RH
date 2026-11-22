/**
 * Test OCR (Node PUR — même environnement d'exécution que le serveur
 * standalone Next.js, contrairement à tsx qui casse le worker pdf.js) :
 *
 *  1. Rend une VRAIE fiche PDF (Jean Dupont, CIN 18504751) en PNG
 *     (même pipeline que src/lib/payslip-ocr.ts : pdfjs + @napi-rs/canvas CJS).
 *  2. OCR du PNG (tesseract.js, fra.traineddata local ocr-data/).
 *  3. Re-emballe le PNG en PDF image avec sharp (= conversion "PNG -> PDF").
 *  4. Vérifie que pdf-parse n'y trouve AUCUN texte (le problème signalé).
 *  5. (L'intégration complète analyzePayslip est validée ensuite via le
 *     serveur HTTP : scripts/test_ocr_http.py)
 */
const { createRequire } = require("node:module");
const path = require("path");
const fs = require("fs");
const req = createRequire(__filename);
const ROOT = path.join(__dirname, "..");

async function main() {
  // Chargement EXACTEMENT comme src/lib/payslip-ocr.ts (CJS, une seule
  // instance de @napi-rs/canvas partagée avec pdf.js)
  const napi = req("@napi-rs/canvas");
  if (!globalThis.Path2D) globalThis.Path2D = napi.Path2D;
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = napi.DOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = napi.ImageData;

  const srcPdf = path.join(
    ROOT, "upload", "zip2_extracted", "fiche_de_paie_01_Jean_Dupont.pdf"
  );
  const buffer = fs.readFileSync(srcPdf);

  // ---- 1. Rendu PDF -> PNG (pipeline OCR) ----
  console.log("=== 1. Rendu de la fiche en PNG (pipeline OCR) ===");
  const pdfjs = await req("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const doc = await pdfjs.getDocument({
    data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
  }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1.5, 1800 / (base.width || 595)));
  const viewport = page.getViewport({ scale });
  const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const png = await canvas.encode("png");
  fs.writeFileSync(path.join(__dirname, "ocr_test_fiche.png"), png);
  console.log("PNG généré:", Math.round(png.length / 1024), "Ko —", canvas.width, "x", canvas.height);
  await doc.destroy().catch(() => undefined);

  // ---- 2. OCR du PNG (tesseract, données locales) ----
  console.log("=== 2. OCR du PNG (tesseract.js, fra local) ===");
  const { createWorker } = req("tesseract.js");
  const t0 = Date.now();
  const worker = await createWorker("fra", 1, {
    langPath: path.join(ROOT, "ocr-data"),
    gzip: false,
    logger: () => undefined,
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  const { data: ocrData } = await worker.recognize(png);
  const ocrText = (ocrData.text || "").replace(/\r/g, "").trim();
  console.log(`OCR terminé en ${((Date.now() - t0) / 1000).toFixed(1)}s — ${ocrText.length} caractères`);
  console.log("Extrait:", JSON.stringify(ocrText.slice(0, 220)));
  await worker.terminate();

  // ---- 3. PNG -> PDF = la conversion faite par l'utilisateur ----
  // (sharp ne sait PAS écrire de PDF ; on utilise Pillow, exactement comme
  //  les outils de conversion "PNG to PDF" utilisés par les utilisateurs)
  console.log("=== 3. Conversion PNG -> PDF (Pillow) ===");
  const outPdf = path.join(__dirname, "ocr_test_fiche_image.pdf");
  const { execFileSync } = require("child_process");
  execFileSync("python3", [
    "-c",
    "import sys; from PIL import Image; im = Image.open(sys.argv[1]); im = im.convert('RGB'); im.save(sys.argv[2], 'PDF', resolution=180.0)",
    path.join(__dirname, "ocr_test_fiche.png"),
    outPdf,
  ]);
  const imgPdfBuffer = fs.readFileSync(outPdf);
  console.log("PDF image généré:", Math.round(imgPdfBuffer.length / 1024), "Ko");

  // ---- 4. pdf-parse sur le PDF image : AUCUN texte attendu ----
  console.log("=== 4. Texte extractible du PDF image (le problème initial) ===");
  const { PDFParse } = req("pdf-parse");
  const parser = new PDFParse({ data: imgPdfBuffer });
  const parsed = await parser.getText();
  await parser.destroy().catch(() => undefined);
  const rawText = (parsed.text || "").trim();
  console.log("Texte pdf-parse:", JSON.stringify(rawText.slice(0, 80)), `(${rawText.length} car.)`);
  const wasEmpty = rawText.length < 40;
  console.log(wasEmpty ? "OK : PDF sans texte — l'OCR est NÉCESSAIRE (cas corrigé)" : "ATTENTION : du texte trouvé");

  // ---- Verdict ----
  console.log("\n=== VERDICT ===");
  const okRender = png.length > 10000;
  const okOcr = ocrText.includes("18504751") || ocrText.replace(/\s/g, "").includes("18504751");
  const okImagePdfEmpty = wasEmpty;
  console.log("Rendu PDF -> PNG:", okRender ? "PASS" : "FAIL");
  console.log("OCR français lit le CIN 18504751:", okOcr ? "PASS" : "FAIL");
  console.log("PDF image bien SANS texte (besoin d'OCR confirmé):", okImagePdfEmpty ? "PASS" : "FAIL");
  if (!okRender || !okOcr || !okImagePdfEmpty) process.exit(1);
  console.log("\n-> Fichiers de test prêts pour l'upload HTTP :");
  console.log("   " + outPdf + "  (PDF image)");
  console.log("   " + path.join(__dirname, "ocr_test_fiche.png") + "  (PNG direct)");
}

main().catch((e) => { console.error("TEST ÉCHOUÉ:", e); process.exit(1); });
