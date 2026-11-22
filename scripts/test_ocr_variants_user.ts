// Test des variantes OCR sur le PDF probleme : quelle passe lit correctement
// le nom "Amine trablesi", le CIN "149654358" et le matricule "003879" ?
import fs from "fs";
import {
  ocrPdfPages,
  ocrPdfPagesHighRes,
  renderPdfPagesToPng,
  ocrImageBuffer,
  terminateOcrWorker,
} from "../src/lib/payslip-ocr";

const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";
const TARGETS = ["149654358", "amine", "trablesi", "003879", "17775208"];

function score(label: string, text: string) {
  const low = text.toLowerCase();
  const found = TARGETS.filter((t) => low.includes(t));
  console.log(`\n=== ${label} ===`);
  console.log("Trouvé:", found.length, "/", TARGETS.length, "->", found.join(", "));
  console.log("Extrait 1200 chars:\n" + text.slice(0, 1200));
  return found.length;
}

async function main() {
  const buffer = fs.readFileSync(pdfPath);

  // Passe 1 : historique
  const p1 = (await ocrPdfPages(buffer)).join("\n");
  const s1 = score("PASSE 1 (historique)", p1);

  // Passe 2 : haute lisibilité (2x + PSM4)
  const p2 = (await ocrPdfPagesHighRes(buffer)).join("\n");
  const s2 = score("PASSE 2 (2x + PSM4)", p2);

  // Passe 3 : rendu plus fin (échelle supérieure) + OCR historique
  const images = await renderPdfPagesToPng(buffer);
  console.log("\nTaille image rendue:", images[0]?.length, "bytes");

  await terminateOcrWorker();
  console.log("\n*** SCORE passe1:", s1, "| passe2:", s2, "***");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
