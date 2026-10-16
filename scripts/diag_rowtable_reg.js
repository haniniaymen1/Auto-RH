/**
 * Vérification NON-RÉGRESSION Task 28 : le VRAI tableau « 1 bulletin par
 * ligne » (bulletins_specimen_50.xlsx, feuille « Bulletins » avec colonnes
 * Matricule | Nom | … | N° CNSS | N° CIN | … ) doit RESTER explosé en
 * 1 fragment par ligne (comportement historique inchangé).
 * Exécution : node --experimental-strip-types --import ./register-loader.mjs diag_rowtable_reg.js
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FILE = "/home/z/my-project/upload/bulletins_specimen_50.xlsx";

const office = await import("../src/lib/payslip-office.ts");
const extractor = await import("../src/lib/payslip-extractor.ts");

function xlsxToSheetTexts(buffer) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = [];
  const sheetTexts = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    sheetNames.push(name);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: "\t", blankrows: false });
    sheetTexts.push((csv || "").replace(/\r/g, "").trim());
  }
  return { sheetNames, sheetTexts };
}

const buffer = readFileSync(FILE);
const { sheetNames, sheetTexts } = xlsxToSheetTexts(buffer);
console.log("Feuilles :", sheetNames.length, JSON.stringify(sheetNames));

const expanded = office.expandSheetTexts(sheetTexts);
console.log("Expansion globale :", expanded.length, "fragments (attendu ≈ 50 bulletins étiquetés)");

const cins = expanded.map((t) => extractor.detectCin(t)).filter(Boolean);
const distinct = [...new Set(cins)];
console.log("CIN détectés :", cins.length, "| distincts :", distinct.length);
console.log("Échantillon :", JSON.stringify(distinct.slice(0, 5)));

const ok =
  expanded.length >= 51 && // 50 bulletins étiquetés + 1 feuille Parametres
  cins.length >= 50 &&
  distinct.length >= 50; // 50 employés -> 50 CIN DISTINCTS (format normalisé par detectCin)
console.log(ok ? "✅ NON-RÉGRESSION : le tableau par lignes reste explosé (1 fragment = 1 bulletin, CIN distincts)" : "❌ RÉGRESSION du tableau par lignes");
process.exit(ok ? 0 : 1);
