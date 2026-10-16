// Test rapide du nouvel extracteur sur : fiches utilisateur + bulletins de régression
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

const USER_DIR = "/home/z/my-project/upload/user_slips";
const BULL_DIR = "/home/z/my-project/test-data/payslips";

async function getText(file: string): Promise<string> {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  try {
    const r = await parser.getText();
    return (r.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function main() {
  let bad = 0;

  console.log("========== FICHES UTILISATEUR (fiche_de_paie_01..20) ==========");
  const expectedUsers = [
    ["Amine Ben Ali", "1 300,863 DT", "EMP-0001"],
    ["Sami Trabelsi", "1 320,434 DT", "EMP-0002"],
    ["Yassine Hammami", "1 346,005 DT", "EMP-0003"],
    ["Meriem Jaziri", "1 370,576 DT", "EMP-0004"],
    ["Ines Gharbi", "1 419,148 DT", "EMP-0005"],
    ["Ahmed Mansouri", "1 458,718 DT", "EMP-0006"],
    ["Nour Khelifi", "1 478,289 DT", "EMP-0007"],
    ["Malek Saidi", "1 503,860 DT", "EMP-0008"],
    ["Sarra Brahmi", "1 528,431 DT", "EMP-0009"],
    ["Oussama Chaabane", "1 577,002 DT", "EMP-0010"],
    ["Hiba Mrad", "1 616,573 DT", "EMP-0011"],
    ["Fares Ayari", "1 636,144 DT", "EMP-0012"],
    ["Rania Ben Amor", "1 661,715 DT", "EMP-0013"],
    ["Seif Dridi", "1 686,286 DT", "EMP-0014"],
    ["Aya Karray", "1 734,857 DT", "EMP-0015"],
    ["Mohamed Tlili", "1 774,428 DT", "EMP-0016"],
    ["Lina Kammoun", "1 793,999 DT", "EMP-0017"],
    ["Wassim Mejri", "1 819,570 DT", "EMP-0018"],
    ["Mariem Ferchichi", "1 844,141 DT", "EMP-0019"],
    ["Bilel Bouzid", "1 892,712 DT", "EMP-0020"],
  ];
  for (let i = 1; i <= 20; i++) {
    const f = path.join(USER_DIR, `fiche_de_paie_${String(i).padStart(2, "0")}.pdf`);
    const t = await getText(f);
    const [expName, expNet, expMat] = expectedUsers[i - 1];
    const name = extractEmployeeName(t);
    const per = extractPeriod(t);
    const net = extractNetSalary(t);
    const mat = extractMatricule(t);
    const cin = detectCin(t);
    const ok =
      name === expName && net === expNet && mat === expMat && per === "Août 2026" && cin === "07451236";
    if (!ok) bad++;
    console.log(
      `${ok ? "PASS" : "ÉCHEC"} ${path.basename(f)} | nom=${name} | période=${per} | net=${net} | mat=${mat} | cin=${cin}`
    );
  }

  console.log("\n========== RÉGRESSION : 20 BULLETINS DE TEST ==========");
  const expectedBull: Array<[string, string | null, string, string]> = [
    ["Bulletin_Paie_01_Janvier2025.pdf", "BEN ALI Mohamed", "Janvier 2025", "1 760,050 DT"],
    ["Bulletin_Paie_02_Fevrier2025.pdf", "TRABELSI Amira", "02/2025", "2 336,118 DT"],
    ["Bulletin_Paie_03_Mars2026.pdf", "GHARBI Karim", "03/2026", "1 359,424 DT"],
    ["Bulletin_Paie_04_Avril2026.pdf", "JAZIRI Salma", "04/2026", "2 006,354 DT"],
    ["Bulletin_Paie_05_Mai2026.pdf", "MANSOURI Hédi", "du 01/05/26 au 31/05/26", "1 614,528 DT"],
    ["Bulletin_Paie_06_Juin2026.pdf", "CHAABANE Nadia", "Juin 2026", "2 494,422 DT"],
    ["Bulletin_Paie_07_Juillet2026.pdf", "BOUAZIZI Ali", "2026-07", "1 165,181 DT"],
    ["Bulletin_Paie_08_Aout2026.pdf", "DRIDI Samir", "Août 2026", "2 916,170 DT"],
    ["Bulletin_Paie_09_Septembre2026.pdf", "FERCHICHI Leila", "Septembre 2026", "2 067,675 DT"],
    ["Bulletin_Paie_10_Octobre2026.pdf", "GHANMI Youssef", "10/2026", "2 723,126 DT"],
    ["Bulletin_Paie_11_Novembre2026.pdf", "HAMDI Rim", "11/2026", "1 464,746 DT"],
    ["Bulletin_Paie_12_Decembre2026.pdf", "IBRAHIM Sofiene", "Décembre 2026", "2 546,944 DT"],
    ["Bulletin_Paie_13_Janvier2027.pdf", "JEDDI Mouna", "du 01/01/2027 au 31/01/2027", "1 306,163 DT"],
    ["Bulletin_Paie_14_Fevrier2027.pdf", "KAMMOUN Walid", "Février 2027", "1 821,371 DT"],
    ["Bulletin_Paie_15_Mars2027.pdf", "LOUATI Hanen", "Mars 2027", "2 261,458 DT"],
    ["Bulletin_Paie_16_Avril2027.pdf", "MEZLINI Fares", "04/2027", "1 557,467 DT"],
    ["Bulletin_Paie_17_Mai2027.pdf", "NACCACHE Dorra", "Mai 2027", "2 371,501 DT"],
    ["Bulletin_Paie_18_Juin2027.pdf", "OUALI Bechir", "du 01/06/2027 au 30/06/2027", "1 931,693 DT"],
    ["Bulletin_Paie_19_Juillet2027.pdf", "ZOUARI Ines", "Juillet 2027", "2 133,536 DT"],
    ["Bulletin_Paie_20_Aout2027.pdf", "BEN SALAH Rachid", "2027-08", "1 213,442 DT"],
  ];
  for (const [f, expName, expPer, expNet] of expectedBull) {
    const t = await getText(path.join(BULL_DIR, f));
    const name = extractEmployeeName(t);
    const per = extractPeriod(t);
    const net = extractNetSalary(t);
    const ok = name === expName && per === expPer && net === expNet;
    if (!ok) bad++;
    console.log(
      `${ok ? "PASS" : "ÉCHEC"} ${f} | nom=${name} (attendu ${expName}) | période=${per} (attendu ${expPer}) | net=${net} (attendu ${expNet})`
    );
  }

  console.log(
    bad === 0 ? "\n✔ 40/40 — tout est détecté, aucune régression" : `\n✘ ${bad} écart(s) à corriger`
  );
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
