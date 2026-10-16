/**
 * Trace de la décision de trySplitExcelIntoIndividualFiles pour le classeur
 * « 1 bulletin par LIGNE » (bulletins_specimen_50.xlsx) — réplique FIDÈLE
 * des étapes 0 à 6 de la route (route.ts) pour identifier le garde qui
 * renvoie null. Objectif : prouver que le comportement est PRÉEXISTANT
 * (identique avant/après le garde Task 28, qui ne concerne pas ce fichier
 * car son en-tête possède une colonne N° CIN).
 * Exécution : node --experimental-strip-types --import ./register-loader.mjs diag_split_rowtable_trace.js
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FILE = "/home/z/my-project/upload/bulletins_specimen_50.xlsx";
const office = await import("../src/lib/payslip-office.ts");
const extractor = await import("../src/lib/payslip-extractor.ts");
const splitter = await import("../src/lib/excel-splitter.ts");

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

// Étape 0 : alignement
const infos = await splitter.getExcelSheetInfos(buffer);
console.log("Étape 0 : infos =", infos ? infos.length : "null", "/ sheetNames =", sheetNames.length,
  infos && infos.length === sheetNames.length ? "OK" : "-> NULL (repli)");

// Étape 1 : pages virtuelles PAR FEUILLE
const perSheetPages = [];
const sheetOfPage = [];
let totalPages = 0;
for (let s = 0; s < sheetTexts.length; s++) {
  const texts = office.expandSheetTexts([sheetTexts[s]]);
  const pages = texts.map((t, k) => ({
    page: totalPages + k + 1,
    text: t,
    normalizedText: extractor.normalizeText(t),
    cin: extractor.detectCin(t),
    employeeName: extractor.extractEmployeeName(t),
    period: extractor.extractPeriod(t),
    netSalary: extractor.extractNetSalary(t),
    matricule: extractor.extractMatricule(t),
  }));
  for (let k = 0; k < pages.length; k++) sheetOfPage.push(s);
  totalPages += pages.length;
  perSheetPages.push(pages);
  console.log(`Étape 1 : feuille ${s} (${sheetNames[s]}) -> ${pages.length} page(s), CIN:`, pages.slice(0, 3).map((p) => p.cin));
}
console.log("Total pages :", totalPages);

// Étape 2 : sanité
const globalExpanded = office.expandSheetTexts(sheetTexts);
console.log("Étape 2 : global =", globalExpanded.length, globalExpanded.length === totalPages ? "OK" : "-> NULL");

// Étape 3 : groupes
const pagePayslips = perSheetPages.flat();
const groups = extractor.groupMultiPayslips(pagePayslips);
console.log("Étape 3 : groupes =", groups ? groups.length : "null");
if (groups) groups.slice(0, 3).forEach((g) => console.log(`   groupe page=${g.page} cin=${JSON.stringify(g.cin)}`));

// Étape 4 : plages
if (groups && groups.length >= 2) {
  const ranges = groups.map((g, i) => {
    const start = i === 0 ? 1 : g.page;
    const end = i + 1 < groups.length ? groups[i + 1].page - 1 : totalPages;
    return { startPage: Math.min(start, g.page), endPage: Math.max(g.page, end) };
  });
  console.log("Étape 4 : plage 1er groupe =", JSON.stringify(ranges[0]),
    "-> feuilles", Array.from(new Set(sheetOfPage.slice(ranges[0].startPage - 1, ranges[0].endPage))));
  const isRowTableSheet = perSheetPages.map((p) => p.length > 1);
  console.log("isRowTableSheet =", isRowTableSheet);
  const firstSheets = Array.from(new Set(sheetOfPage.slice(ranges[0].startPage - 1, ranges[0].endPage)));
  console.log("=> 1er groupe couvre une feuille tableau + annexe -> garde CONFIDENTIALITÉ (repli historique) :",
    firstSheets.some((s) => isRowTableSheet[s]) ? "OUI -> null (PRÉEXISTANT)" : "non");
}
