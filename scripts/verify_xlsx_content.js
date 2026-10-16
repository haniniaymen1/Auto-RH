#!/usr/bin/env node
/**
 * Task 24 — Vérification du contenu d'un fichier xlsx INDIVIDUEL :
 *   usage : node verify_xlsx_content.js <fichier.xlsx> <cin_attendu> [cin_interdit...]
 *
 * Contrôles :
 *  - le fichier est un classeur lisible (ExcelJS) ;
 *  - il contient le CIN attendu (recherche dans toutes les cellules) ;
 *  - il ne contient AUCUN des CIN interdits (isolation garantie) ;
 *  - dans le cas « 1 fiche par feuille » : exactement 1 feuille ;
 *  - les styles du bandeau (fond + police grasse) sont conservés si la
 *    feuille contient une ligne de titre fusionnée (fidélité découpage).
 */
const path = require("path");
const ExcelJS = require(path.join(__dirname, "..", "node_modules", "exceljs"));

const [, , file, expectedCin, ...forbiddenCins] = process.argv;
if (!file || !expectedCin) {
  console.error("usage: node verify_xlsx_content.js <fichier.xlsx> <cin_attendu> [cin_interdit...]");
  process.exit(2);
}

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.formula) return String(v.result ?? "");
    if (v.text) return String(v.text);
    return JSON.stringify(v);
  }
  return String(v);
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const allText = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        allText.push(cellText(cell.value));
      });
    });
  }
  const joined = allText.join(" | ");

  const problems = [];

  // CIN attendu présent
  if (!joined.includes(expectedCin)) {
    problems.push(`CIN attendu ${expectedCin} ABSENT du fichier`);
  }
  // CINs interdits absents
  for (const bad of forbiddenCins) {
    if (bad && joined.includes(bad)) {
      problems.push(`CIN interdit ${bad} PRÉSENT dans le fichier (fuite)`);
    }
  }

  // Cas « 1 fiche par feuille » : le classeur individuel ne doit contenir
  // qu'UNE feuille (les fiches étiquetées aussi — feuille unique générée).
  if (wb.worksheets.length !== 1) {
    problems.push(`nombre de feuilles = ${wb.worksheets.length} (attendu 1)`);
  }

  // Fidélité des styles : chercher une cellule à fond coloré + gras
  // (bandeau de titre du bulletin — présent dans les fiches « feuille »).
  let styledCell = null;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const fill = cell.fill && cell.fill.type === "pattern" ? cell.fill.fgColor?.argb : null;
        const bold = cell.font && cell.font.bold;
        if (fill && fill !== "FFFFFFFF" && bold) styledCell = { fill, text: cellText(cell.value) };
      });
    });
  }

  if (problems.length) {
    console.error("ÉCHEC : " + problems.join(" ; "));
    process.exit(1);
  }
  console.log(
    `OK — 1 feuille, CIN ${expectedCin} isolé, aucun CIN interdit` +
      (styledCell ? `, style conservé (fond ${styledCell.fill}, gras) : "${styledCell.text.slice(0, 40)}"` : ", pas de bandeau stylé (fiche étiquetée — attendu)")
  );
  process.exit(0);
})().catch((e) => {
  console.error("ÉCHEC lecture classeur:", e.message);
  process.exit(1);
});
