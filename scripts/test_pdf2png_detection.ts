/**
 * Task 15 — Vérification "false information detected" sur le PNG de pdf2png.zip
 * Réplique le NOUVEAU chemin image de upload/route.ts (ocrImageAdaptiveParts
 * + arbitrage CIN + arbitrage NOM) sans écrire en base.
 */
import { readFileSync } from "fs";
import { ocrImageAdaptiveParts } from "../src/lib/payslip-ocr-adaptive";
import {
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  arbitrateCinWithTableContext,
  isHeaderGarbageName,
  isNameFromHeaderLine,
  nameHasStrayFragments,
} from "../src/lib/payslip-extractor";

async function main() {
  const p = "/home/z/my-project/upload/pdf2png_extracted/Docs From Bh225_260914145812 (1)/Docs From Bh225_260914145812 (1)-1.png";
  const buffer = readFileSync(p);
  console.log("Fichier:", p, `(${(buffer.length / 1024).toFixed(0)} Ko)`);

  const { text: ocrText, hiResText } = await ocrImageAdaptiveParts(buffer);
  console.log("Texte combiné:", ocrText.length, "car. | hi-res:", hiResText ? hiResText.length : "aucune");

  const cinRaw = detectCin(ocrText);
  const cin = arbitrateCinWithTableContext(cinRaw, ocrText);
  let employeeName = extractEmployeeName(ocrText);
  const nameSuspect =
    isHeaderGarbageName(employeeName) ||
    isNameFromHeaderLine(ocrText, employeeName) ||
    nameHasStrayFragments(ocrText, employeeName);
  if (hiResText && nameSuspect) {
    const hiName = extractEmployeeName(hiResText);
    if (hiName && !isHeaderGarbageName(hiName)) employeeName = hiName;
  }
  const period = extractPeriod(ocrText);
  const net = extractNetSalary(ocrText);
  const mat = extractMatricule(ocrText);

  console.log("\n=== RÉSULTATS DETECTION (pipeline image complet) ===");
  console.log("CIN brut   :", cinRaw);
  console.log("CIN arbitré:", cin);
  console.log("Nom brut   :", extractEmployeeName(ocrText), "| suspect:", nameSuspect);
  console.log("Nom FINAL  :", employeeName);
  console.log("Période    :", period);
  console.log("Net à payer:", net);
  console.log("Matricule  :", mat);

  const okCin = cin === "12345678";
  const okName = (employeeName || "").toUpperCase().replace(/\s/g, "").includes("EMPLOYE") &&
                 (employeeName || "").toUpperCase().includes("TEST");
  const okPeriod = !!period && period.includes("01/08/26");
  const okNet = (net || "").startsWith("1593");
  console.log("\n=== VERDICT ===");
  console.log(okCin ? "✅ CIN correct (12345678)" : "❌ CIN FAUX");
  console.log(okName ? "✅ Nom correct (EMPLOYE TEST)" : `❌ NOM FAUX: ${employeeName}`);
  console.log(okPeriod ? "✅ Période correcte" : "❌ Période FAUSSE");
  console.log(okNet ? "✅ Net correct" : "❌ Net FAUX");
  process.exit(okCin && okName && okPeriod && okNet ? 0 : 1);
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(2);
});
