/**
 * Génère les échantillons de test MULTI-FORMATS (ZIP / XLSX / DOCX / PNG) :
 *   scripts/fixtures_multi/
 *     classeur_2_fiches.xlsx   — 2 feuilles = 2 employés (2 fiches attendues)
 *     classeur_1_fiche.xlsx    — 1 feuille = 1 employé
 *     fiche_word_1.docx        — 1 fiche
 *     fiche_word_2.docx        — 1 document contenant 2 fiches (2 CIN)
 *     fiche_image.png          — 1 fiche image (OCR)
 *     archive_fiches.zip       — ZIP mixte : XLSX 2 fiches + DOCX 2 fiches
 *                                + PNG + 1 PDF réel (upload/user_slips)
 *
 * Exécuter :  node scripts/make_multi_format_fixtures.js
 * (usage interne de test — fait partie des scripts de vérification)
 */
const fs = require("fs");
const path = require("path");
const { zipSync } = require("fflate");
const XLSX = require("xlsx");
const { createCanvas } = require("@napi-rs/canvas");

const OUT = path.join(__dirname, "fixtures_multi");
fs.mkdirSync(OUT, { recursive: true });

/* ---------- Contenu type d'une fiche (mêmes libellés que Sage) ---------- */
function ficheLines({ nom, matricule, cin, periode, net, soc }) {
  return [
    "BULLETIN DE PAIE",
    `Société : ${soc || "DEMO SARL"}`,
    `Nom et prénom : ${nom}`,
    `Matricule : ${matricule}`,
    `C.I.N : ${cin}`,
    `Période de paie : ${periode}`,
    "Salaire de base : 1 500,000",
    "Prime de rendement : 250,000",
    "CNSS : 81,000",
    "Impôt sur le revenu : 118,250",
    `Net à payer : ${net}`,
  ];
}

/* ------------------------- XLSX (classeurs) ------------------------------ */
function makeWorkbook(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, lines } of sheets) {
    const aoa = lines.map((l) => [l]); // 1 cellule par ligne (comme un texte)
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(OUT, fileName), buf);
  console.log("créé :", fileName, buf.length, "octets");
}

makeWorkbook("classeur_2_fiches.xlsx", [
  { name: "Fiche Janvier", lines: ficheLines({ nom: "BEN ALI Mohamed", matricule: "MAT-2001", cin: "70011223", periode: "01/2026", net: "2 450,750" }) },
  { name: "Fiche Février", lines: ficheLines({ nom: "TRABELSI Amel", matricule: "MAT-2002", cin: "70022334", periode: "02/2026", net: "2 100,000" }) },
]);

makeWorkbook("classeur_1_fiche.xlsx", [
  { name: "Fiche Mars", lines: ficheLines({ nom: "GHARBI Sonia", matricule: "MAT-2003", cin: "70033445", periode: "03/2026", net: "1 950,500" }) },
]);

/* ------------------------- DOCX (Word minimal) --------------------------- */
function makeDocx(fileName, fiches) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = [];
  for (let f = 0; f < fiches.length; f++) {
    if (f > 0) paras.push("<w:p><w:r><w:t></w:t></w:r></w:p>"); // séparateur
    for (const line of ficheLines(fiches[f])) {
      paras.push(
        `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
      );
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join(
    "\n"
  )}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zipped = zipSync({
    "[Content_Types].xml": Buffer.from(contentTypes),
    "_rels/.rels": Buffer.from(rels),
    "word/document.xml": Buffer.from(documentXml),
  });
  fs.writeFileSync(path.join(OUT, fileName), zipped);
  console.log("créé :", fileName, zipped.length, "octets");
}

makeDocx("fiche_word_1.docx", [
  { nom: "MANSOURI Karim", matricule: "MAT-3001", cin: "70044556", periode: "04/2026", net: "2 010,250" },
]);

makeDocx("fiche_word_2.docx", [
  { nom: "JAZIRI Leila", matricule: "MAT-4001", cin: "70055667", periode: "05/2026", net: "2 320,000" },
  { nom: "CHOUIKHA Rachid", matricule: "MAT-4002", cin: "70066778", periode: "06/2026", net: "1 880,750" },
]);

/* ------------------------- PNG (image OCR) ------------------------------- */
async function makePng() {
  const lines = ficheLines({
    nom: "BEN SALAH Hana",
    matricule: "MAT-5001",
    cin: "70077889",
    periode: "07/2026",
    net: "2 175,500",
  });
  const W = 1500;
  const H = 220 + lines.length * 70;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  // DejaVu Sans : police système rendue correctement par @napi-rs/canvas et
  // parfaitement lue par l'OCR (l'alias générique "sans-serif" produit un
  // rendu que Tesseract lit très mal — voir scripts/test_font_ocr.js).
  ctx.font = "bold 48px DejaVu Sans";
  let y = 100;
  for (const line of lines) {
    ctx.fillText(line, 60, y);
    y += 70;
  }
  const png = await canvas.encode("png");
  fs.writeFileSync(path.join(OUT, "fiche_image.png"), png);
  console.log("créé : fiche_image.png", png.length, "octets");
}

/* ------------------------- ZIP (archive mixte) --------------------------- */
function makeZip() {
  const pdfSrc = path.join(__dirname, "..", "upload", "user_slips", "fiche_de_paie_01.pdf");
  const entries = {
    "janvier/classeur_2_fiches.xlsx": fs.readFileSync(path.join(OUT, "classeur_2_fiches.xlsx")),
    "fevrier/fiche_word_2.docx": fs.readFileSync(path.join(OUT, "fiche_word_2.docx")),
    "mars/fiche_image.png": fs.readFileSync(path.join(OUT, "fiche_image.png")),
  };
  if (fs.existsSync(pdfSrc)) {
    entries["pdfs/fiche_de_paie_01.pdf"] = fs.readFileSync(pdfSrc);
  }
  const zipped = zipSync(entries);
  fs.writeFileSync(path.join(OUT, "archive_fiches.zip"), zipped);
  console.log("créé : archive_fiches.zip", zipped.length, "octets — entrées :", Object.keys(entries).join(", "));
}

(async () => {
  await makePng();
  makeZip();
  console.log("OK — échantillons dans", OUT);
})();
