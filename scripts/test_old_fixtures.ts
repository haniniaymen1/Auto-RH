/** Non-régression des ANCIENS fichiers multi-format + OCR (fixtures historiques). */
import * as fs from "fs";
import {
  analyzePayslip,
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  normalizeText,
  groupMultiPayslips,
} from "../src/lib/payslip-extractor";
import { xlsxToSheetTexts, expandSheetTexts, docxToText, splitTextIntoCinBlocks, unzipArchive } from "../src/lib/payslip-office";
import { ocrImageAdaptive } from "../src/lib/payslip-ocr-adaptive";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${label} ${extra}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
}

async function virtualPages(texts: string[]) {
  return texts.map((t, i) => ({
    page: i + 1, text: t, normalizedText: normalizeText(t),
    cin: detectCin(t), employeeName: extractEmployeeName(t),
    period: extractPeriod(t), netSalary: extractNetSalary(t), matricule: extractMatricule(t),
  }));
}

async function main() {
  const F = "/home/z/my-project/scripts/fixtures_multi";

  console.log("[1] classeur_2_fiches.xlsx (2 feuilles, 2 fiches attendues)");
  {
    const { sheetTexts } = xlsxToSheetTexts(fs.readFileSync(`${F}/classeur_2_fiches.xlsx`));
    const expanded = expandSheetTexts(sheetTexts);
    const pages = await virtualPages(expanded);
    const groups = groupMultiPayslips(pages);
    console.log("   ", JSON.stringify({ texts: expanded.length, groups: groups?.length ?? null, g1: groups?.[0]?.cin, g2: groups?.[1]?.cin }));
    check("2 fiches groupées", !!groups && groups.length === 2, `(reçu: ${groups?.length})`);
    check("les 2 CIN distincts", new Set(groups?.map((g) => g.cin) ?? []).size === 2);
    check("noms détectés", !!groups?.[0]?.employeeName && !!groups?.[1]?.employeeName);
  }

  console.log("[2] classeur_1_fiche.xlsx (1 fiche, mono)");
  {
    const { sheetTexts } = xlsxToSheetTexts(fs.readFileSync(`${F}/classeur_1_fiche.xlsx`));
    const expanded = expandSheetTexts(sheetTexts);
    const pages = await virtualPages(expanded);
    const groups = groupMultiPayslips(pages);
    console.log("   ", JSON.stringify({ texts: expanded.length, groups: groups?.length ?? null, g1: groups?.[0] ? { cin: groups[0].cin, emp: groups[0].employeeName } : null }));
    check("pas de découpe multi (mono-fiche)", !groups || groups.length < 2);
    check("CIN détecté", !!pages[0]?.cin || !!groups?.[0]?.cin);
  }

  console.log("[3] fiche_word_1.docx + fiche_word_2.docx");
  {
    for (const f of ["fiche_word_1.docx", "fiche_word_2.docx"]) {
      const text = await docxToText(fs.readFileSync(`${F}/${f}`));
      const blocks = splitTextIntoCinBlocks(text);
      const pages = await virtualPages(blocks.length > 0 ? blocks : [text]);
      const groups = groupMultiPayslips(pages);
      const rec = groups?.[0] ?? pages[0];
      console.log(`    ${f}:`, JSON.stringify({ cin: rec?.cin, emp: rec?.employeeName, per: rec?.period }));
      check(`${f}: CIN détecté`, !!rec?.cin, `(reçu: ${rec?.cin})`);
      check(`${f}: nom détecté`, !!rec?.employeeName);
    }
  }

  console.log("[4] fiche_image.png (OCR)");
  {
    const t = await ocrImageAdaptive(fs.readFileSync(`${F}/fiche_image.png`));
    const d = { cin: detectCin(t), emp: extractEmployeeName(t), per: extractPeriod(t), net: extractNetSalary(t) };
    console.log("   ", JSON.stringify(d));
    check("CIN détecté", !!d.cin, `(reçu: ${d.cin})`);
    check("nom détecté", !!d.emp);
  }

  console.log("[5] archive_fiches.zip (contenu)");
  {
    const entries = unzipArchive(fs.readFileSync(`${F}/archive_fiches.zip`));
    console.log("    entrées:", entries.map((e) => e.baseName).join(", "));
    check("archive lisible avec entrées", entries.length >= 2, `(reçu: ${entries.length})`);
    // chaque PDF de l'archive doit s'analyser
    for (const e of entries.filter((x) => x.baseName.endsWith(".pdf"))) {
      const a = await analyzePayslip(e.data);
      check(`${e.baseName}: CIN`, !!a.cin, `(reçu: ${a.cin})`);
    }
  }

  console.log("[6] ocr_test_fiche.png (ancien spécimen OCR)");
  {
    const t = await ocrImageAdaptive(fs.readFileSync("/home/z/my-project/scripts/ocr_test_fiche.png"));
    const d = { cin: detectCin(t), emp: extractEmployeeName(t), per: extractPeriod(t), net: extractNetSalary(t), mat: extractMatricule(t) };
    console.log("   ", JSON.stringify(d));
    check("CIN détecté", !!d.cin, `(reçu: ${d.cin})`);
    check("période détectée", !!d.per);
    check("net détecté", !!d.net);
    // NOTE : le nom de CETTE vieille fiche n'était pas détecté par le code
    // historique non plus (l'OCR y trouve le CIN -> l'adaptatif renvoie la
    // passe historique telle quelle) — comportement conservé, pas une
    // régression. On vérifie seulement la non-disparition des champs acquis.
  }

  console.log(`\n===== RÉSULTAT: ${pass} OK / ${fail} ÉCHEC(S) =====`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("ERR:", e); process.exit(1); });
