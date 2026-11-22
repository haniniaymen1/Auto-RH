/**
 * test104_specimen.js — (Task 104) Reproduction unitaire avec le VRAI code
 * 0.2.30 : analyse du PDF « 20_fiches_de_paie_specimen.pdf » page par page
 * (extractPdfPageTexts via pdf-parse 2.4.5, même lib que l'app) puis
 * groupMultiPayslips — pour voir POURQUOI le fichier n'est pas découpé.
 */
const fs = require("fs");
const path = require("path");
const ex = require(path.join("/home/z/my-project/task99_smtp/harness", "dist", "payslip-extractor.js"));

(async () => {
  const buffer = fs.readFileSync("/home/z/my-project/upload/20_fiches_de_paie_specimen.pdf");

  const { pages, pageTexts } = await ex.extractPdfPageTexts(buffer);
  console.log("pages detectees:", pages, "| pageTexts:", pageTexts.length);
  console.log("---- Extrait page 1 (pdf-parse, 500 car) ----");
  console.log(pageTexts[0].slice(0, 500));
  console.log("---- Extrait page 2 (pdf-parse, 300 car) ----");
  console.log(pageTexts[1].slice(0, 300));

  const { pagePayslips } = await ex.analyzePayslipPages(buffer);
  console.log("\n---- Par page (code reel 0.2.30) ----");
  for (const p of pagePayslips) {
    console.log(
      `p${String(p.page).padStart(2)}  cin=${p.cin}  nom=${JSON.stringify(p.employeeName)}  mat=${JSON.stringify(p.matricule)}  periode=${JSON.stringify(p.period)}  net=${JSON.stringify(p.netSalary)}  ocr=${p.ocrUsed}`
    );
  }

  const groups = ex.groupMultiPayslips(pagePayslips);
  console.log("\ngroupMultiPayslips ->", groups ? groups.length + " groupe(s)" : "null (mono-fiche historique)");
  if (groups) {
    for (const g of groups) console.log(`  groupe pages ${g.page}+ cin=${g.cin} nom=${JSON.stringify(g.employeeName)}`);
  }
})().catch((e) => { console.error("ERREUR:", e); process.exit(2); });
