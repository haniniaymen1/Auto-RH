/** Test hors-ligne des correctifs « detection fausse » (avant rebuild). */
import { readFileSync } from "fs";
import {
  extractPdfPageTexts,
  extractEmployeeName,
  detectCin,
  detectCinFromTableContext,
  lineHasCnssKeyAfter,
  arbitrateCinWithTableContext,
  isNameFromHeaderLine,
  isHeaderGarbageName,
} from "../src/lib/payslip-extractor";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + ` [${label}]` + (detail ? ` — ${detail}` : ""));
  ok ? pass++ : fail++;
}

async function main() {
  // ---------- 1. Specimen (texte PDF) : nom ≠ fonction ----------
  const spec = readFileSync("/home/z/my-project/upload/bulletins_specimen_50 (1).pdf");
  const { pageTexts } = await extractPdfPageTexts(spec);
  const expected = ["BELHADJ SANA", "TRABELSI HAMZA", "BEN SALAH YOSRA", "GHARBI AMIRA", "MEJRI OUSSAMA", "CHAABANE MAROUANE"];
  pageTexts.slice(0, 6).forEach((t, i) => {
    check(`specimen page ${i + 1} nom`, extractEmployeeName(t) === expected[i],
      `obtenu=${JSON.stringify(extractEmployeeName(t))} attendu=${expected[i]}`);
  });

  // Fiche Task 12 (« Amine trablesi » casse mixte) — non-régression :
  const t12 = "MATRICULE  NOM ET PRENOM  FONCTION  CATEGORIE\n003879  Amine trablesi  Technicien en Informatique";
  check("casse mixte « Amine trablesi »", extractEmployeeName(t12) === "Amine trablesi",
    JSON.stringify(extractEmployeeName(t12)));
  // Cas historic « HANINI AYMEN » (tout collé majuscules) :
  const tHan = "MATRICULE NOMETPRENOM FONCTION CATEGORIE\n[0087 | HANINIAYMEN :ç— | Technicien en Informatique";
  const hanName = extractEmployeeName(tHan);
  check("majuscules collées HANINIAYMEN", !!hanName && hanName.replace(/\s/g, "").toUpperCase() === "HANINIAYMEN",
    JSON.stringify(hanName));

  // ---------- 1bis. Bande hi-res réelle du PDF A (HANINI AYMEN) ----------
  const hiResA = "CO MATRICULE      PTS       NOM ET PRENOM       TES       7 FONCTION         1 CATEGORIE\n| 008678 |       HANINI AYMEN               _00000| Telle Informatique         000)\n| \"AT Cu  NPA CHARGE  LE  N° CNSS  N° CIN    Droitacquis";
  check("hi-res A : nom = HANINI AYMEN", extractEmployeeName(hiResA) === "HANINI AYMEN",
    JSON.stringify(extractEmployeeName(hiResA)));
  // Fragment d'en-tête seul (sans ligne de valeurs) : pas de nom inventé
  const headerOnly = "MATRICULE  NOM ET PRENOM  FONCTION  CATEGORIE";
  check("en-tête seul -> pas de nom", extractEmployeeName(headerOnly) === null,
    JSON.stringify(extractEmployeeName(headerOnly)));

  // ---------- 2. Arbitrage CIN sur le contenu réel de B (PNG) ----------
  const recB = await p.payslip.findFirst({ where: { fileName: "Docs From Bh225_260914145812 (1)-1.png" }, orderBy: { uploadedAt: "desc" } });
  if (recB) {
    const cinB = arbitrateCinWithTableContext(detectCin(recB.content), recB.content);
    check("B arbitrage CIN -> 149654358", cinB === "149654358", `obtenu=${cinB}`);
    check("B cnssKeyAfter(17775208) vrai", lineHasCnssKeyAfter(recB.content, "17775208") === true);
  } else { fail++; console.log("FAIL [B] record introuvable"); }

  // ---------- 3. A : nom « COTES » vient d'une ligne d'en-tête ----------
  const recA = await p.payslip.findFirst({ where: { fileName: "Docs From Bh225_260914145812 (1).pdf" }, orderBy: { uploadedAt: "desc" } });
  if (recA) {
    check("A isNameFromHeaderLine('COTES') vrai",
      isNameFromHeaderLine(recA.content, "COTES") === true);
    check("A isHeaderGarbageName('COTES') faux (d'où le bug)", isHeaderGarbageName("COTES") === false);
    check("A tableContext = 11374934 (OCR de la 1re passe)", detectCinFromTableContext(recA.content) === "11374934",
      String(detectCinFromTableContext(recA.content)));
  } else { fail++; console.log("FAIL [A] record introuvable"); }

  await p.$disconnect();
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
}
main();
