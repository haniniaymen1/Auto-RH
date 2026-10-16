// Test du nouvel extracteur sur les 20 fiches SPECIMEN (formats exotiques)
// Usage : npx tsx scripts/test_specimen_fields.ts [dossier_des_pdf]
import { PDFParse } from "pdf-parse";
import {
  detectCin,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
} from "../src/lib/payslip-extractor";
import fs from "fs";
import path from "path";

const DIR =
  process.argv[2] || path.join(__dirname, "test-data", "specimens");

async function getText(file: string): Promise<string> {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  try {
    const r = await parser.getText();
    return (r.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

// [n°, CIN compact attendu, période attendue, nom attendu, net attendu]
const EXPECT: Array<[number, string, string, string, string]> = [
  [1, "DEMO001234", "Janvier 2026", "Amine Ben Salem", "1 343,600"],
  [2, "DEMO123456", "du 01/02/2026 au 28/02/2026", "Sarra Trabelsi", "1 427,476"],
  [3, "XX003456", "03-2026", "Youssef Gharbi", "1 511,352"],
  [4, "FICTIF004567", "du 01.04.2026 au 30.04.2026", "Meriem Jlassi", "1 565,228"],
  [5, "000005678", "Mai / 2026", "Walid Hamdi", "1 479,104"],
  [6, "CINDEMO006789", "2026-06", "Ines Ayari", "1 562,980"],
  [7, "D007890", "Du 1er au 31 juillet 2026", "Fares Mabrouk", "1 616,856"],
  [8, "SPEC008901", "Aout 2026", "Rania Khelifi", "1 700,732"],
  [9, "DEMO009012", "09/2026", "Nader Chatti", "1 614,608"],
  [10, "FICTIF010123", "du 01-10-26 au 31-10-26", "Aya Bouazizi", "1 668,484"],
  [11, "XX011234", "Novembre deux mille vingt-six", "Mehdi Dridi", "1 752,360"],
  [12, "DEMO012345", "2026 / DEC", "Lina Saidi", "1 836,236"],
  [13, "013456DEMO", "Semaine 02 a 05 - Jan. 2027", "Karim Ben Amor", "1 720,112"],
  [14, "XX014567", "01/02/2027", "Nour Chaabane", "1 803,988"],
  [15, "INVALIDE015678", "Mars 2027", "Hichem Tlili", "1 887,864"],
  [16, "D016789", "Du 01 avr. au 30 avr. 2027", "Emna Hajri", "1 941,740"],
  [17, "SPECIMEN017890", "05.2027", "Sami Kammoun", "1 855,616"],
  [18, "XX018901", "Juin-27", "Marwa Karray", "1 939,492"],
  [19, "DEMO019012", "JUILLET 2027", "Bilel Zouari", "1 993,368"],
  [20, "FICTIF020123", "08/2027", "Asma Rekik", "2 077,244"],
];

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`Dossier introuvable : ${DIR}`);
    process.exit(1);
  }
  let bad = 0;
  console.log(`========== FICHES SPECIMEN (${DIR}) ==========`);
  for (const [n, expCin, expPer, expName, expNet] of EXPECT) {
    const f = path.join(DIR, `fiche_paie_${String(n).padStart(2, "0")}_specimen.pdf`);
    if (!fs.existsSync(f)) {
      console.log(`FAIL fiche ${n} — fichier absent : ${f}`);
      bad++;
      continue;
    }
    const t = await getText(f);
    const cin = detectCin(t);
    const per = extractPeriod(t);
    const name = extractEmployeeName(t);
    const net = extractNetSalary(t);
    const mat = extractMatricule(t);

    const okCin = cin === expCin;
    const okPer = (per || "").toLowerCase() === expPer.toLowerCase();
    const okName = (name || "") === expName;
    const okNet = (net || "").startsWith(expNet);
    const okMat = !!mat && /EMP-DEMO-\d{3}/.test(mat);

    if (okCin && okPer && okName && okNet && okMat) {
      console.log(`PASS fiche ${String(n).padStart(2, "0")} — CIN=${cin} | Période=${per} | ${name} | ${net}`);
    } else {
      bad++;
      console.log(`FAIL fiche ${String(n).padStart(2, "0")}`);
      if (!okCin) console.log(`   CIN     : obtenu="${cin}" attendu="${expCin}"`);
      if (!okPer) console.log(`   Période : obtenu="${per}" attendu="${expPer}"`);
      if (!okName) console.log(`   Nom     : obtenu="${name}" attendu="${expName}"`);
      if (!okNet) console.log(`   Net     : obtenu="${net}" attendu~="${expNet}"`);
      if (!okMat) console.log(`   Matricule: obtenu="${mat}" attendu~="EMP-DEMO-xxx"`);
    }
  }
  console.log("==============================================");
  console.log(bad === 0 ? "RESULT: 20/20 PASS" : `RESULT: ${20 - bad}/20 PASS, ${bad} FAIL`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
