// Task 19 — Test du regex EXACT copié depuis src/lib/payslip-extractor.ts (Task 14)
function normalizeQuery(query) {
  return query.toUpperCase().replace(/[\s.\/\-]/g, "");
}
function exactCinRegex(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(sep);
  return new RegExp(
    `(?<![A-Z0-9])(?<![0-9A-Z][ \\t./\\-])${escaped}(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])`
  );
}
function isExactCinInContent(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(content.toUpperCase()) : false;
}

const pdfContent = `DEMO CALL CENTER
Matricule CNSS : 000 000 - 00 (fictif)
BULLETIN DE PAIE SALAIRE
01/08/26 31/08/26
MATRICULE NOM ET PRENOM FONCTION CATEGORIE
900001 BELHADJ SANA Assistant Administratif
ETAT CIVIL ENF. A CHARGE N° CNSS N° CIN Droit acquis Solde Congés H/J Trav Sal. Base Th
Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 19,000 1709,279
N° Rubrique Nombre Base Taux Gains Retenues`;

for (const q of ["SPEC-0001", "SPEC0001", "900001"]) {
  const strict = isExactCinInContent(pdfContent, q);
  const re = exactCinRegex(q);
  const m = re ? re.exec(pdfContent.toUpperCase()) : null;
  console.log(`q=${JSON.stringify(q)} -> match: ${strict} | index: ${m ? m.index : -1}`);
}

// Gardes Task 14 à préserver
const t14 = "Total 26 542 351 fin";
console.log("Garde Task14 (542351 vs '26 542 351'):", isExactCinInContent(t14, "542351"), "(attendu false)");
console.log("Task14 (26542351 complet):", isExactCinInContent(t14, "26542351"), "(attendu true)");
console.log("CIN en début de ligne après autre nombre (001\\nSPEC-0001):",
  isExactCinInContent("SPECIMEN-001\nSPEC-0001 6,205", "SPEC-0001"), "(attendu true)");
