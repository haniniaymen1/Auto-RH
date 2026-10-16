// Test d'extraction de texte avec pdf-parse v2
const { PDFParse } = require("pdf-parse");
const fs = require("fs");

async function main() {
  const file = "/home/z/my-project/test-data/payslips/Fiche_Paie_01_2025_EMP001.pdf";
  const buffer = fs.readFileSync(file);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  console.log("=== TEXTE EXTRAIT ===");
  console.log(result.text);
  console.log("=== PAGES ===", result.pages ? result.pages.length : 0);
  await parser.destroy();
}

main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
