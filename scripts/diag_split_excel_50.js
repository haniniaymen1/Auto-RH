/**
 * DIAGNOSTIC Task 28 : « les 50 pages dans le fichier excel n'est pas séparé »
 * Fichier réel : upload/Bulletins_de_paie_50_exemples (4) (1).xlsx
 *
 * Reproduit EXACTEMENT le pipeline de la route d'upload (chemin Excel) :
 *   1. xlsxToSheetTexts (payslip-office.ts)
 *   2. expandSheetTexts par feuille (comme trySplitExcelIntoIndividualFiles)
 *   3. detectCin + arbitrateCinWithTableContext (payslip-extractor.ts)
 *   4. groupMultiPayslips
 * et affiche POURQUOI le découpage ne se déclenche pas.
 *
 * Exécution : node --experimental-strip-types scripts/diag_split_excel_50.js
 * (Node 24 : strip-types natif, imports TS directs)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FILE = "/home/z/my-project/upload/Bulletins_de_paie_50_exemples (4) (1).xlsx";

// --- imports des VRAIES fonctions du projet ---
const office = await import("../src/lib/payslip-office.ts");
const extractor = await import("../src/lib/payslip-extractor.ts");

// Réplique FIDÈLE de xlsxToSheetTexts (payslip-office.ts) — cette fonction
// utilise require("xlsx") incompatible avec le mode ESM du diagnostic.
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
console.log("=== 1) xlsxToSheetTexts ===");
const { sheetNames, sheetTexts } = xlsxToSheetTexts(buffer);
console.log("Feuilles :", sheetNames.length, "| textes :", sheetTexts.length);

console.log("\n=== 2) detectCin PAR FEUILLE (avec arbitrage tableau, comme la route) ===");
const cins = [];
for (let i = 0; i < sheetTexts.length; i++) {
  const t = sheetTexts[i];
  const raw = extractor.detectCin(t);
  const arb = extractor.arbitrateCinWithTableContext(raw, t);
  cins.push(arb);
  if (i < 6 || i === sheetTexts.length - 1) {
    console.log(
      `feuille ${i + 1} (${sheetNames[i]}) : detectCin=${JSON.stringify(raw)} -> arbitré=${JSON.stringify(arb)}`
    );
  }
}
const distinct = [...new Set(cins.map((c) => c || "null"))];
console.log("CIN distincts sur", cins.length, "feuilles :", distinct.length, JSON.stringify(distinct.slice(0, 10)));

console.log("\n=== 3) expandSheetTexts PAR FEUILLE (comme le splitter) ===");
let totalPages = 0;
const pageCins = [];
for (let s = 0; s < sheetTexts.length; s++) {
  const texts = office.expandSheetTexts([sheetTexts[s]]);
  totalPages += texts.length;
  for (const t of texts) pageCins.push(extractor.detectCin(t));
}
console.log("Pages virtuelles totales :", totalPages, "(attendu 50 si 1 feuille = 1 page)");

console.log("\n=== 4) expandSheetTexts GLOBAL (sanité du splitter) ===");
const globalExpanded = office.expandSheetTexts(sheetTexts);
console.log("Expansion globale :", globalExpanded.length, "pages — alignement :", globalExpanded.length === totalPages ? "OK" : "**ÉCART -> repli historique**");

console.log("\n=== 5) groupMultiPayslips (comme le splitter) ===");
// reconstruction fidèle de perSheetPages
const perSheetPages = [];
let page = 0;
for (let s = 0; s < sheetTexts.length; s++) {
  const texts = office.expandSheetTexts([sheetTexts[s]]);
  const pages = texts.map((t, k) => ({
    page: ++page,
    text: t,
    normalizedText: extractor.normalizeText(t),
    cin: extractor.detectCin(t),
    employeeName: extractor.extractEmployeeName(t),
    period: extractor.extractPeriod(t),
    netSalary: extractor.extractNetSalary(t),
    matricule: extractor.extractMatricule(t),
  }));
  perSheetPages.push(pages);
}
const flat = perSheetPages.flat();
const groups = extractor.groupMultiPayslips(flat);
console.log("groupes :", groups ? groups.length : "null", "-> décision splitter :", groups && groups.length >= 2 ? "DÉCOUPAGE" : "**NULL -> repli mono-fiche (fichier NON découpé)**");
if (groups) {
  groups.slice(0, 5).forEach((g) => console.log(`  groupe page ${g.page} cin=${JSON.stringify(g.cin)} nom=${JSON.stringify(g.employeeName)}`));
}

console.log("\n=== 6) getExcelSheetInfos (garde d'alignement du splitter) ===");
const { getExcelSheetInfos } = await import("../src/lib/excel-splitter.ts");
const infos = await getExcelSheetInfos(buffer);
console.log("infos :", infos ? infos.length : "null", "| sheetNames :", sheetNames.length, "->", infos && infos.length === sheetNames.length ? "OK" : "**ÉCART -> repli historique**");
