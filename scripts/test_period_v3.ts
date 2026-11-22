/**
 * Test V3 extractPeriod :
 *  1) 20 NOUVELLES fiches (upload/zip2_extracted) — Période doit être détectée
 *  2) RÉGRESSION : anciens PDF (user_slips + new_slips specimen) — périodes
 *     toujours détectées (anciens motifs conservés)
 */
import { PDFParse } from "pdf-parse";
import fs from "fs";
import path from "path";
import { extractPeriod, extractEmployeeName, extractNetSalary, detectCin } from "../src/lib/payslip-extractor";

async function textOf(pdfPath: string): Promise<string> {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const doc = await parser.getText();
  const t = doc.text;
  await parser.destroy();
  return t;
}

(async () => {
  let pass = 0, fail = 0;

  // ---------- 1) Nouvelles fiches (zip2) ----------
  const dirNew = "/home/z/my-project/upload/zip2_extracted";
  const news = fs.readdirSync(dirNew).filter((f) => f.endsWith(".pdf")).sort();
  console.log("=".repeat(76));
  console.log("1) NOUVELLES FICHES (20_fiches_de_paie_separees (2).zip)");
  for (const f of news) {
    const t = await textOf(path.join(dirNew, f));
    const per = extractPeriod(t);
    const cin = detectCin(t);
    const nom = extractEmployeeName(t);
    const net = extractNetSalary(t);
    const ok = !!per;
    if (ok) pass++; else fail++;
    console.log(
      (ok ? "PASS" : "FAIL") + " | " + f.slice(0, 36).padEnd(36) +
      " | P: " + (per || "—").toString().slice(0, 34).padEnd(34) +
      " | CIN: " + (cin || "—") + " | N: " + (nom ? "ok" : "—") + " | Net: " + (net ? "ok" : "—")
    );
  }

  // ---------- 2) Régression anciens PDF ----------
  console.log("=".repeat(76));
  console.log("2) RÉGRESSION — anciens PDF (périodes NE DOIVENT PAS disparaître)");
  const groups: Array<[string, string[]]> = [
    ["user_slips (fiche_de_paie_01..20)", fs.readdirSync("/home/z/my-project/upload/user_slips").filter(f => f.endsWith(".pdf")).sort().map(f => "/home/z/my-project/upload/user_slips/" + f)],
    ["new_slips (specimen 01..20)", fs.readdirSync("/home/z/my-project/upload/new_slips").filter(f => f.endsWith(".pdf")).sort().map(f => "/home/z/my-project/upload/new_slips/" + f)],
  ];
  for (const [label, files] of groups) {
    let gPass = 0;
    for (const p of files) {
      const t = await textOf(p);
      const per = extractPeriod(t);
      if (per) { gPass++; pass++; } else { fail++; console.log("FAIL | " + path.basename(p) + " => période LOST"); }
    }
    console.log(`${label}: ${gPass}/${files.length} périodes détectées`);
  }

  console.log("=".repeat(76));
  console.log(`RÉSULTAT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
