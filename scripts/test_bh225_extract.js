// Test d'extraction du texte du PDF "Docs From Bh225"
const fs = require("fs");
const path = require("path");

async function main() {
  const { PDFParse } = require("pdf-parse");
  const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812.pdf";
  const dataBuffer = fs.readFileSync(pdfPath);
  console.log("=== Taille fichier:", dataBuffer.length, "octets ===");

  const parser = new PDFParse({ data: dataBuffer });
  try {
    const result = await parser.getText();
    const text = result.text || "";
    console.log("=== Longueur texte extrait:", text.length, "===");
    if (text.length === 0) {
      console.log(">>> TEXTE VIDE : PDF SANS COUCHE TEXTE (image pure) <<<");
    } else {
      console.log("=== Texte extrait (raw) ===");
      console.log(JSON.stringify(text.slice(0, 3000)));
      console.log("=== Fin (affiché 3000 premiers caractères) ===");
    }
    // Info pages
    const pages = result.pages || [];
    for (const p of pages) {
      console.log(`Page ${p.num}: ${p.numContentItems} éléments de contenu`);
    }
  } finally {
    await parser.destroy();
  }
}

main().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
