#!/usr/bin/env node
/**
 * Task 24 — Génération des classeurs Excel de TEST :
 *  1. fiches_excel_multi.xlsx   : 3 feuilles = 3 fiches de paie
 *     (styles : fusion, fonds, bordures, largeurs — pour vérifier la
 *      fidélité du découpage), CIN 87000024 / 87000025 / 87000026 ;
 *  2. bulletins_excel_table.xlsx : 1 feuille « 1 bulletin par LIGNE »
 *     (3 employés), CIN 88000061 / 88000062 / 88000063 ;
 *  3. fiche_excel_simple.xlsx   : 1 feuille = 1 fiche (CIN 89000077)
 *     — chemin HISTORIQUE mono-fiche (ne doit pas être découpé).
 */
const path = require("path");
const ExcelJS = require(path.join(__dirname, "..", "node_modules", "exceljs"));

const TEST_DIR = path.join(__dirname, "..", "test-data");

const hair = { bottom: { style: "hair", color: { argb: "FF999999" } } };

/** Fiche de paie stylisée sur UNE feuille. */
function addPayslipSheet(wb, { nom, cin, matricule, fonction, base, net, mois }) {
  const ws = wb.addWorksheet(`Fiche ${matricule}`, {
    properties: { tabColor: { argb: "FF10B981" } },
  });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;

  // Bandeau titre fusionné + style (fidélité du découpage à vérifier)
  ws.mergeCells("A1:D1");
  const t1 = ws.getCell("A1");
  t1.value = "SOCIÉTÉ TEST SARL — BULLETIN DE PAIE";
  t1.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  t1.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;

  ws.mergeCells("A2:D2");
  const t2 = ws.getCell("A2");
  t2.value = `Période de paie : ${mois}`;
  t2.font = { italic: true, size: 11 };
  t2.alignment = { horizontal: "center" };

  const rows = [
    ["Matricule", matricule],
    ["Nom et prénom", nom],
    ["Fonction", fonction],
    ["N° CIN", cin],
    ["N° CNSS", "17775208 - 08"],
  ];
  let r = 4;
  for (const [label, value] of rows) {
    const a = ws.getCell(r, 1);
    a.value = label;
    a.font = { bold: true };
    a.border = hair;
    const b = ws.getCell(r, 2);
    b.value = value;
    b.border = hair;
    r++;
  }

  // petit tableau de rémunération (plusieurs colonnes)
  r++;
  const head = ws.getRow(r);
  head.values = ["Rubrique", "Nombre", "Base", "Montant"];
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    c.border = hair;
  });
  r++;
  ws.getCell(r, 1).value = "Salaire de base";
  ws.getCell(r, 4).value = base;
  r++;
  ws.getCell(r, 1).value = "Prime de transport";
  ws.getCell(r, 4).value = 120;
  r++;
  ws.getCell(r, 1).value = "CNSS (9,18%)";
  ws.getCell(r, 4).value = -Math.round(base * 0.0918 * 1000) / 1000;
  r += 2;
  const netCell = ws.getCell(r, 4);
  netCell.value = net;
  netCell.font = { bold: true, color: { argb: "FFB91C1C" } };
  const netLabel = ws.getCell(r, 1);
  netLabel.value = "NET À PAYER";
  netLabel.font = { bold: true };
}

(async () => {
  // ---------- 1) classeur MULTI-FEUILLES (3 fiches) ----------
  const wb1 = new ExcelJS.Workbook();
  wb1.creator = "Sage Export";
  addPayslipSheet(wb1, {
    nom: "BEN ALI Mohamed", cin: "87000024", matricule: "MAT-2401",
    fonction: "Technicien", base: 3500, net: 3052.5, mois: "Août 2026",
  });
  addPayslipSheet(wb1, {
    nom: "TRABELSI Fatma", cin: "87000025", matricule: "MAT-2402",
    fonction: "Comptable", base: 4200, net: 3621.4, mois: "Août 2026",
  });
  addPayslipSheet(wb1, {
    nom: "GHARBI Ali", cin: "87000026", matricule: "MAT-2403",
    fonction: "Chauffeur", base: 2900, net: 2560.7, mois: "Août 2026",
  });
  await wb1.xlsx.writeFile(path.join(TEST_DIR, "fiches_excel_multi.xlsx"));

  // ---------- 2) feuille « 1 bulletin par LIGNE » (3 employés) ----------
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("Bulletins");
  const header = [
    "Matricule", "Nom et prénom", "Fonction", "N° CIN",
    "Salaire de base", "Net à payer", "Période",
  ];
  const head = ws2.getRow(1);
  head.values = header;
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  const data = [
    ["MAT-8801", "JELASSI Sonia", "Chef de projet", "88000061", 5200, 4400.35, "Août 2026"],
    ["MAT-8802", "MANSOURI Karim", "Développeur", "88000062", 4600, 3925.8, "Août 2026"],
    ["MAT-8803", "HADDAD Leila", "Assistante RH", "88000063", 3100, 2710.25, "Août 2026"],
  ];
  data.forEach((row, i) => {
    ws2.getRow(i + 2).values = row;
  });
  ws2.columns = header.map(() => ({ width: 20 }));
  await wb2.xlsx.writeFile(path.join(TEST_DIR, "bulletins_excel_table.xlsx"));

  // ---------- 3) classeur MONO-FICHE (chemin historique) ----------
  const wb3 = new ExcelJS.Workbook();
  addPayslipSheet(wb3, {
    nom: "SAIDI Hélder", cin: "89000077", matricule: "MAT-8900",
    fonction: "Gardien", base: 1800, net: 1655.2, mois: "Août 2026",
  });
  await wb3.xlsx.writeFile(path.join(TEST_DIR, "fiche_excel_simple.xlsx"));

  console.log("Classeurs de test générés dans test-data/ :");
  console.log(" - fiches_excel_multi.xlsx (3 feuilles, CIN 87000024/25/26)");
  console.log(" - bulletins_excel_table.xlsx (1 bulletin par ligne, CIN 88000061/62/63)");
  console.log(" - fiche_excel_simple.xlsx (mono-fiche, CIN 89000077)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
