/**
 * test104_groupes.js — (Task 104) Tests unitaires du correctif groupMultiPayslips.
 *
 * T1 : le fichier utilisateur « 20_fiches_de_paie_specimen.pdf » (VRAI PDF,
 *      analyse VRAIE) → 20 groupes (1 par employé) au lieu de null.
 * T2..T8 : régressions des règles historiques avec PagePayslip fabriqués
 *      (fonction pure) : continuation même personne (texte propre + bruit
 *      OCR), copies identiques (Task 101), même CIN non consécutif,
 *      repli matricule, aucun signal, en-tête répété complet.
 */
const path = require("path");
const fs = require("fs");
const ex = require(path.join("/home/z/my-project/task99_smtp/harness", "dist", "payslip-extractor.js"));

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail ? "  <- " + detail : "")); }
}

function pp(page, cin, name, mat, text) {
  const t = text || `contenu ${page}`;
  return {
    page, text: t, normalizedText: ex.normalizeText(t),
    cin, employeeName: name, period: null, netSalary: null, matricule: mat,
  };
}

(async () => {
  console.log("== T1 : fichier utilisateur (analyse réelle) ==");
  const buffer = fs.readFileSync("/home/z/my-project/upload/20_fiches_de_paie_specimen.pdf");
  const { pagePayslips } = await ex.analyzePayslipPages(buffer);
  const g1 = ex.groupMultiPayslips(pagePayslips);
  check("T1.1 groupes = 20 (avant correctif : null)", !!g1 && g1.length === 20, String(g1 && g1.length));
  if (g1) {
    check("T1.2 1 groupe = 1 page (20 plages 1-1)", g1.every((g, i) => g.page === i + 1));
    const noms = g1.map((g) => g.employeeName);
    check("T1.3 20 noms distincts", new Set(noms).size === 20, noms.join(" | ").slice(0, 120));
    check("T1.4 cin conservé = 07451236 partout", g1.every((g) => g.cin === "07451236"));
    check("T1.5 noms attendus p1/p2/p20", noms[0] === "Amine Ben Ali" && noms[1] === "Sami Trabelsi" && noms[19] === "Bilel Bouzid");
  }

  console.log("== T2 : fiche 2 pages, MÊME personne (nom propre) -> fusion = null ==");
  const t2 = ex.groupMultiPayslips([
    pp(1, "09593103", "Amine Ben Ali", "EMP-0001", "page1 salaire de base ..."),
    pp(2, "09593103", "Amine Ben Ali", "EMP-0001", "suite rubriques primes retenues ..."),
  ]);
  check("T2.1 null (1 fiche)", t2 === null);

  console.log("== T3 : même personne, nom bruité OCR (« A11 ») -> fusion = null ==");
  check("T3.1 similarité ≥ 0.75", ex.similariteBigrammes(
    ex.normaliserIdentite("Amine Ben Ali"), ex.normaliserIdentite("Amine Ben A11")) >= 0.75,
    String(ex.similariteBigrammes(ex.normaliserIdentite("Amine Ben Ali"), ex.normaliserIdentite("Amine Ben A11"))));
  const t3 = ex.groupMultiPayslips([
    pp(1, "09593103", "Amine Ben Ali", "EMP-0001", "page1 ..."),
    pp(2, "09593103", "Amine Ben A11", "EMP-0001", "suite differente ..."),
  ]);
  check("T3.2 null (1 fiche)", t3 === null);

  console.log("== T4 : copies STRICTEMENT identiques (Task 101) -> N fiches ==");
  const t4 = ex.groupMultiPayslips([
    pp(1, "07451236", "Amine Ben Ali", "EMP-0001", "FICHE IDENTIQUE NET 1000"),
    pp(2, "07451236", "Amine Ben Ali", "EMP-0001", "FICHE IDENTIQUE NET 1000"),
    pp(3, "07451236", "Amine Ben Ali", "EMP-0001", "FICHE IDENTIQUE NET 1000"),
  ]);
  check("T4.1 3 groupes (copies)", !!t4 && t4.length === 3, String(t4 && t4.length));

  console.log("== T5 : même CIN NON consécutif -> 2 fiches (historique) ==");
  const t5 = ex.groupMultiPayslips([
    pp(1, "11111111", "Ali Salah", "M-1", "bulletin mois 1"),
    pp(2, "22222222", "Sonia Amri", "M-2", "fiche autre employe"),
    pp(3, "11111111", "Ali Salah", "M-1", "bulletin mois 2"),
  ]);
  check("T5.1 3 groupes", !!t5 && t5.length === 3, String(t5 && t5.length));

  console.log("== T6 : pas de noms, matricules différents -> séparation (repli matricule) ==");
  const t6 = ex.groupMultiPayslips([
    pp(1, "07451236", null, "EMP-0001", "fiche A"),
    pp(2, "07451236", null, "EMP-0002", "fiche B"),
  ]);
  check("T6.1 2 groupes", !!t6 && t6.length === 2, String(t6 && t6.length));

  console.log("== T7 : aucun signal (sans nom ni matricule) -> fusion historique ==");
  const t7 = ex.groupMultiPayslips([
    pp(1, "07451236", null, null, "page 1"),
    pp(2, "07451236", null, null, "page 2 continuation"),
  ]);
  check("T7.1 null (1 fiche)", t7 === null);

  console.log("== T8 : 2 pages, en-tête répété complet (même nom + même matricule) ==");
  const t8 = ex.groupMultiPayslips([
    pp(1, "09593103", "Meriem Jaziri", "EMP-0004", "FICHE DE PAIE EMPLOYEUR ... salaire base"),
    pp(2, "09593103", "Meriem Jaziri", "EMP-0004", "FICHE DE PAIE EMPLOYEUR ... net a payer bas page 2"),
  ]);
  check("T8.1 null (1 fiche)", t8 === null);

  console.log("== T9 : meme personne noms identiques mais matricules diff -> fusion (noms décident) ==");
  const t9 = ex.groupMultiPayslips([
    pp(1, "07451236", "Sarra Brahmi", "EMP-0009", "page 1"),
    pp(2, "07451236", "Sarra Brahmi", "EMP-0009bis", "page 2 suite"),
  ]);
  check("T9.1 null (1 fiche)", t9 === null);

  console.log("\n===== RÉSULTAT : " + pass + " PASS, " + fail + " FAIL =====");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("ERREUR:", e); process.exit(2); });
