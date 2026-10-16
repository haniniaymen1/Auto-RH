#!/usr/bin/env node
/**
 * Task 25 — construction de FIXTURES DOCX multi-fiches pour les tests :
 *  - fiche_word_multipages.docx   : 3 fiches séparées par <w:br w:type="page"/>
 *    (convention Word : paragraphe de saut vide entre les fiches),
 *    contient tableaux + styles pour vérifier la fidélité ;
 *  - fiche_word_sans_saut.docx    : 2 fiches SANS aucun saut de page
 *    (repli « candidat CIN ») ;
 *  - fiche_word_rendered.docx     : 2 fiches séparées par
 *    <w:lastRenderedPageBreak/> (marqueur de rendu Word) ;
 *  - fiche_word_sections.docx     : 2 fiches séparées par des sauts de
 *    SECTION (<w:pPr><w:sectPr>) avec mise en page spécifique.
 * Chaque fiche porte un CIN distinct (70055667 / 70066778 / 70077889).
 */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const OUT_DIR = path.join(__dirname, "fixtures_docx");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:body>";

const TAIL = "</w:body></w:document>";

// Mise en page finale (A4, marges standard) — présente dans les fixtures
// à sauts de page / rendu (dernier enfant du body).
const FINAL_SECTPR =
  "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>" +
  "<w:pgMar w:top=\"1417\" w:right=\"1417\" w:bottom=\"1417\" w:left=\"1417\" " +
  "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>";

function p(text, opts = {}) {
  if (text === "") return "<w:p/>";
  return `<w:p><w:r>${opts.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function pageBreakPara() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function payslipParas(name, cin, matricule, period, net, withTable) {
  const lines = [
    p("BULLETIN DE PAIE", { bold: true }),
    p("Société : DEMO SARL"),
    p(`Nom et prénom : ${name}`),
    p(`Matricule : ${matricule}`),
    p(`C.I.N : ${cin}`),
    p(`Période de paie : ${period}`),
  ];
  if (withTable) {
    // tableau de rémunération (2 colonnes) — fidélité à vérifier
    const row = (a, b) =>
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>${p(a)}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>${p(b)}</w:tc></w:tr>`;
    const tbl =
      "<w:tbl><w:tblPr><w:tblW w:w=\"9638\" w:type=\"dxa\"/>" +
      '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>' +
      '<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>' +
      '<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' +
      row("Rubrique", "Montant") +
      row("Salaire de base", "1 500,000") +
      row("Prime de rendement", "250,000") +
      row("CNSS", "81,000") +
      row("Impôt sur le revenu", "118,250") +
      "</w:tbl>";
    lines.push(tbl);
  }
  lines.push(p(`Net à payer : ${net}`));
  return lines.join("");
}

function docXml(body) {
  return HEAD + body + TAIL;
}

async function buildZip(docXmlStr, outName, extraEntries = []) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  for (const [name, content] of extraEntries) {
    zip.file(name, content);
  }
  zip.file("word/document.xml", docXmlStr);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(path.join(OUT_DIR, outName), buf);
  console.log(`OK ${outName} (${buf.length} octets)`);
}

(async () => {
  // 1) 3 fiches + sauts de page explicites + tableau sur la fiche 2
  // NB : matricules SANS jeton « LETTRES-CHIFFRES » (règle 6 de detectCin,
  // dernier recours, capte les formats du type MAT-4001 sur les blocs sans
  // ligne CIN) — « 4001 » pur reste neutre pour TOUTES les règles.
  const withBreaks =
    payslipParas("JAZIRI Leila", "70055667", "4001", "05/2026", "2 320,000", false) +
    pageBreakPara() +
    payslipParas("CHOUIKHA Rachid", "70066778", "4002", "06/2026", "2 320,000", true) +
    pageBreakPara() +
    payslipParas("EMPLOYE Test", "70077889", "4003", "07/2026", "2 320,000", false);
  await buildZip(docXml(withBreaks + FINAL_SECTPR), "fiche_word_multipages.docx");

  // 2) 2 fiches SANS saut (repli candidat CIN)
  const noBreak =
    payslipParas("JAZIRI Leila", "70055667", "4001", "05/2026", "2 320,000", false) +
    p("") +
    payslipParas("CHOUIKHA Rachid", "70066778", "4002", "06/2026", "2 320,000", false);
  await buildZip(docXml(noBreak + FINAL_SECTPR), "fiche_word_sans_saut.docx");

  // 3) 2 fiches + <w:lastRenderedPageBreak/> (marqueur de rendu)
  const rendered =
    payslipParas("JAZIRI Leila", "70055667", "4001", "05/2026", "2 320,000", false) +
    '<w:p><w:r><w:lastRenderedPageBreak/><w:t xml:space="preserve">BULLETIN DE PAIE</w:t></w:r></w:p>' +
    p("Société : DEMO SARL") +
    p("Nom et prénom : CHOUIKHA Rachid") +
    p("Matricule : 4002") +
    p("C.I.N : 70066778") +
    p("Période de paie : 06/2026") +
    p("Net à payer : 2 320,000");
  await buildZip(docXml(rendered + FINAL_SECTPR), "fiche_word_rendered.docx");

  // 4) 2 fiches + sauts de SECTION (chaque fiche = 1 section avec sectPr)
  const SECT1 =
    "<w:p><w:pPr><w:sectPr>" +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:gutter="0"/>' +
    "</w:sectPr></w:pPr></w:p>";
  const sections =
    payslipParas("JAZIRI Leila", "70055667", "4001", "05/2026", "2 320,000", false) +
    SECT1 +
    payslipParas("CHOUIKHA Rachid", "70066778", "4002", "06/2026", "2 320,000", false);
  await buildZip(docXml(sections + FINAL_SECTPR), "fiche_word_sections.docx");

  // 5) fiche UNIQUE avec saut de page final (ne doit PAS être découpée)
  const single =
    payslipParas("JAZIRI Leila", "70055667", "4001", "05/2026", "2 320,000", false) +
    pageBreakPara();
  await buildZip(docXml(single + FINAL_SECTPR), "fiche_word_unique.docx");

  console.log("Fixtures écrites dans", OUT_DIR);
})();
