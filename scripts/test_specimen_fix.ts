/**
 * Validation des correctifs "données non détectées" sur les fichiers specimen.
 * 1. PDF texte (spec_pdf)      -> CIN SPEC-0001 attendu
 * 2. PNG (spec_png) via OCR    -> tous champs attendus
 * 3. XLSX (1 bulletin/ligne)   -> 50 fiches attendues
 * 4. PDF multi-fiches 50 pages -> 50 groupes attendus
 */
import * as fs from "fs";
import {
  analyzePayslip,
  analyzePayslipPages,
  groupMultiPayslips,
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  normalizeText,
} from "../src/lib/payslip-extractor";
import { xlsxToSheetTexts, expandSheetTexts } from "../src/lib/payslip-office";
import { ocrImageAdaptive } from "../src/lib/payslip-ocr-adaptive";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${label} ${extra}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
}

async function main() {
  // ---- 1. PDF texte ----
  console.log("\n[1] PDF texte (bulletins_specimen_50_PDF.zip)");
  const pdf1 = fs.readFileSync("/home/z/my-project/upload/spec_pdf/pdf/bulletin_900001_BELHADJ_SANA.pdf");
  const a1 = await analyzePayslip(pdf1);
  console.log("   ", JSON.stringify({ cin: a1.cin, emp: a1.employeeName, per: a1.period, net: a1.netSalary }));
  check("CIN = SPEC-0001", a1.cin === "SPEC-0001", `(reçu: ${a1.cin})`);
  check("Nom = BELHADJ SANA", a1.employeeName === "BELHADJ SANA");
  check("Période détectée", !!a1.period && a1.period.includes("01/08/26"));
  check("Net détecté", !!a1.netSalary);

  // ---- 2. PNG via OCR adaptatif ----
  console.log("\n[2] PNG (bulletins_specimen_50_PNG.zip) — OCR adaptatif");
  const png1 = fs.readFileSync("/home/z/my-project/upload/spec_png/png/bulletin_900001_BELHADJ_SANA.png");
  const t2 = await ocrImageAdaptive(png1);
  const d2 = { cin: detectCin(t2), emp: extractEmployeeName(t2), per: extractPeriod(t2), net: extractNetSalary(t2), mat: extractMatricule(t2) };
  console.log("   ", JSON.stringify(d2));
  check("CIN = SPEC-0001", d2.cin === "SPEC-0001", `(reçu: ${d2.cin})`);
  check("Nom = BELHADJ SANA", d2.emp === "BELHADJ SANA", `(reçu: ${d2.emp})`);
  check("Période détectée", !!d2.per && d2.per.includes("01/08/26"));
  check("Net détecté", !!d2.net);
  check("Matricule = 900001", d2.mat === "900001", `(reçu: ${d2.mat})`);

  // chemin PDF image (analyzePayslip sur un PDF-image : test via ocrPdfPages
  // -> couvert par le test 4 et l'E2E)

  // ---- 3. XLSX ----
  console.log("\n[3] XLSX (bulletins_specimen_50.xlsx) — découpe par ligne");
  const xb = fs.readFileSync("/home/z/my-project/upload/bulletins_specimen_50.xlsx");
  const { sheetTexts } = xlsxToSheetTexts(xb);
  const expanded = expandSheetTexts(sheetTexts);
  console.log(`    feuilles: ${sheetTexts.length} -> textes étendus: ${expanded.length}`);
  check("51 textes étendus (1 feuille paramètres inchangée + 50 bulletins)", expanded.length === 51, `(reçu: ${expanded.length})`);
  const r1 = expanded[1];
  const d3 = { cin: detectCin(r1), emp: extractEmployeeName(r1), per: extractPeriod(r1), net: extractNetSalary(r1), mat: extractMatricule(r1) };
  console.log("    ligne 1:", JSON.stringify(d3));
  check("Ligne 1: CIN = SPEC0001", d3.cin === "SPEC0001", `(reçu: ${d3.cin})`);
  check("Ligne 1: Nom = BELHADJ SANA", d3.emp === "BELHADJ SANA", `(reçu: ${d3.emp})`);
  check("Ligne 1: Période = du 01/08/26 au 31/08/26", d3.per === "du 01/08/26 au 31/08/26", `(reçu: ${d3.per})`);
  check("Ligne 1: Net = 1,611.865 DT", d3.net === "1,611.865 DT", `(reçu: ${d3.net})`);
  check("Ligne 1: Matricule = 900001", d3.mat === "900001", `(reçu: ${d3.mat})`);
  const r50 = expanded[50];
  console.log("    ligne 50:", JSON.stringify({ cin: detectCin(r50), emp: extractEmployeeName(r50) }));
  check("Ligne 50: CIN = SPEC0050", detectCin(r50) === "SPEC0050", `(reçu: ${detectCin(r50)})`);
  check("50 bulletins: CINs tous distincts", new Set(expanded.slice(1).map(detectCin)).size === 50);

  // grouping comme dans la route
  const pages3 = expanded.map((t, i) => ({
    page: i + 1, text: t, normalizedText: normalizeText(t),
    cin: detectCin(t), employeeName: extractEmployeeName(t),
    period: extractPeriod(t), netSalary: extractNetSalary(t), matricule: extractMatricule(t),
  }));
  const g3 = groupMultiPayslips(pages3);
  check("groupMultiPayslips -> 50 groupes", !!g3 && g3.length === 50, `(reçu: ${g3?.length})`);

  // ---- 4. PDF multi-fiches 50 pages ----
  console.log("\n[4] PDF multi-fiches (bulletins_specimen_50.pdf)");
  const multi = fs.readFileSync("/home/z/my-project/upload/bulletins_specimen_50.pdf");
  const { pages, pagePayslips } = await analyzePayslipPages(multi);
  const groups = groupMultiPayslips(pagePayslips);
  console.log(`    pages: ${pages}, groupes: ${groups?.length ?? "null"}`);
  check("50 groupes", !!groups && groups.length === 50, `(reçu: ${groups?.length})`);
  const g1 = groups?.[0], g50 = groups?.[groups!.length - 1];
  console.log("    groupe 1 :", JSON.stringify({ pg: g1?.page, cin: g1?.cin, emp: g1?.employeeName, per: g1?.period, net: g1?.netSalary }));
  console.log("    groupe 50:", JSON.stringify({ pg: g50?.page, cin: g50?.cin, emp: g50?.employeeName }));
  check("Groupe 1 = SPEC-0001 / BELHADJ SANA", g1?.cin === "SPEC-0001" && g1?.employeeName === "BELHADJ SANA");
  check("Groupe 50 = SPEC-0050", g50?.cin === "SPEC-0050", `(reçu: ${g50?.cin})`);
  check("CINs tous distincts", new Set(groups!.map(g => g.cin)).size === 50);

  console.log(`\n===== RÉSULTAT: ${pass} OK / ${fail} ÉCHEC(S) =====`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("ERR:", e); process.exit(1); });
