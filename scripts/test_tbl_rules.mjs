// Test des nouvelles règles sur le texte OCR réel de Bh225 + cas annexes
process.env.NODE_ENV = "production";
import fs from "fs";
import {
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
} from "../src/lib/payslip-extractor.js";

const ocrText = fs.readFileSync("/home/z/my-project/scripts/ocr_t1800.txt", "utf8");

let pass = 0, fail = 0;
function check(label, got, expected) {
  const ok = got === expected;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "ÉCHEC"} ${label}: ${JSON.stringify(got)}${ok ? "" : "  (attendu: " + JSON.stringify(expected) + ")"}`);
}

console.log("=== Texte OCR réel (Bh225 / TUNIS CALL CENTER) ===");
check("CIN (CNSS exclu)", detectCin(ocrText), "12345678");
check("Employé (tableau)", extractEmployeeName(ocrText), "EMPLOYETEST");
check("Période (2 dates)", extractPeriod(ocrText), "du 01/08/26 au 31/08/26");
check("Net à payer (bordures |)", extractNetSalary(ocrText), "1593,851 DT");

console.log("\n=== Cas unitaires supplémentaires (non-régression des nouvelles règles) ===");
// CNSS seul sans autre 8 chiffres sur la ligne -> historique (1er candidat)
const t1 = "N° CNSS : 17775208 - 08\nSalaire de base 1 612,190 DT";
check("CNSS seul -> historique", detectCin(t1), "17775208");
// CIN isolé sans clé -> inchangé
const t2 = "CIN : 07451236";
check("CIN libellé isolé", detectCin(t2), "07451236");
// 8 chiffres isolé sans clé -> inchangé
const t3 = "Salaire Net à payer\n09876543";
check("8 chiffres isolé", detectCin(t3), "09876543");
// CNSS suivi du CIN -> CIN
const t4 = "17775208 - 08        12345678";
check("CNSS + CIN même ligne", detectCin(t4), "12345678");
// CNSS suivi d'un autre CNSS -> pas de candidat fiable -> 1er (historique)
const t5 = "17775208 - 08        12349876 - 15";
check("2 CNSS -> historique", detectCin(t5), "17775208");
// période : deux dates avec 1 espace
const t6 = "01/08/26 31/08/26";
check("Période 1 espace", extractPeriod(t6), "du 01/08/26 au 31/08/26");
// période : les anciens motifs restent prioritaires
const t7 = "Période du 01/09/2026 au 30/09/2026";
check("Période 'du...au' prioritaire", extractPeriod(t7), "du 01/09/2026 au 30/09/2026");
// nom tableau : nom séparé en 2 tokens
const t8 = "MATRICULE   NOMETPRENOM     FONCTION\n003879 | EMPLOYE TEST | Technicien";
check("Nom 2 tokens", extractEmployeeName(t8), "EMPLOYE TEST");
// nom tableau : libellé exclusion
const t9 = "NOMETPRENOM    FONCTION    CATEGORIE\n003879   Technicien en Informatique   B";
check("Nom exclut libellés", extractEmployeeName(t9), null);
// net : NETAPAYER collé
const t10 = "NETAPAYER        1593,851";
check("Net collé NETAPAYER", extractNetSalary(t10), "1593,851 DT");
// net : motif historique prioritaire
const t11 = "NET À PAYER : 2 500,000 DT";
check("Net historique", extractNetSalary(t11), "2 500,000 DT");

console.log(`\n=== TOTAL: ${pass} PASS / ${fail} ÉCHEC ===`);
process.exit(fail > 0 ? 1 : 0);
