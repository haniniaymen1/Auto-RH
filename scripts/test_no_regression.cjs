/**
 * Test de NON-RÉGRESSION : ré-applique les NOUVELLES règles de détection sur
 * le contenu TEXTE déjà stocké de toutes les fiches de la base.
 * Garantie attendue :
 *   - un CIN déjà détecté NE CHANGE PAS et NE DISPARAÎT PAS ;
 *   - une période déjà détectée NE CHANGE PAS ;
 *   - un CIN/période null PEUT devenir détecté (amélioration voulue).
 */
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const { createRequire } = require("module");

async function main() {
  // import des TS via tsx (api register)
  const req = createRequire(path.join(__dirname, "..", "package.json"));
  const { detectCin, extractPeriod, extractEmployeeName, extractNetSalary, extractMatricule } =
    await import(path.join(__dirname, "..", "src", "lib", "payslip-extractor.ts"));

  const db = new PrismaClient();
  const rows = await db.payslip.findMany({
    select: { id: true, fileName: true, content: true, cin: true, period: true, employeeName: true, netSalary: true, matricule: true },
  });
  let same = 0, improved = 0, changed = 0, lost = 0;
  const problems = [];
  for (const r of rows) {
    const cin2 = detectCin(r.content || "");
    const per2 = extractPeriod(r.content || "");
    const emp2 = extractEmployeeName(r.content || "");
    const oldCin = r.cin ? String(r.cin).toUpperCase() : null;
    if (oldCin && !cin2) { lost++; problems.push(`CIN PERDU: ${r.fileName} [${oldCin}]`); }
    else if (oldCin && cin2 && cin2.toUpperCase() !== oldCin) { changed++; problems.push(`CIN CHANGÉ: ${r.fileName} [${oldCin}] -> [${cin2}]`); }
    else if (!oldCin && cin2) { improved++; }
    else same++;
    if (r.period && per2 && per2 !== r.period) { problems.push(`PÉRIODE CHANGÉE: ${r.fileName} [${r.period}] -> [${per2}]`); }
    if (r.period && !per2) { problems.push(`PÉRIODE PERDUE: ${r.fileName} [${r.period}]`); }
    void emp2; void extractNetSalary; void extractMatricule;
  }
  console.log(`Fiches analysées: ${rows.length}`);
  console.log(`  CIN identiques: ${same} | améliorés (null->CIN): ${improved} | changés: ${changed} | perdus: ${lost}`);
  if (problems.length) {
    console.log("\nPROBLÈMES:");
    for (const p of problems.slice(0, 20)) console.log("  -", p);
  } else {
    console.log("\nAUCUNE régression : tous les CIN/périodes existants sont conservés à l'identique.");
  }
  await db.$disconnect();
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
