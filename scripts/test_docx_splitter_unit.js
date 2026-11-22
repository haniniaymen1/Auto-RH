#!/usr/bin/env node
/**
 * Task 25 — tests UNITAIRES du docx-splitter (module compilé).
 * Vérifie sur les 5 fixtures :
 *  - nombre de pages détectées ;
 *  - texte de chaque page (CIN isolé par page) ;
 *  - extraction de plages -> .docx autonome (relecture par jszip :
 *    document.xml réduit, autres entrées conservées) ;
 *  - fidélité : le tableau de la fiche 2 reste présent dans son fichier.
 */
const path = require("path");
const fs = require("fs");
const {
  getDocxPageGroups,
  extractDocxPageRange,
  countDistinctCinCandidates,
} = require(path.join(__dirname, ".compiled", "docx-splitter.js"));
const JSZip = require("jszip");

const DIR = path.join(__dirname, "fixtures_docx");
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "OK " : "ÉCHEC"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

(async () => {
  const read = (n) => fs.readFileSync(path.join(DIR, n));

  // ---------- fixture 1 : sauts de page explicites ----------
  {
    const buf = read("fiche_word_multipages.docx");
    const split = await getDocxPageGroups(buf);
    check("multipages : 3 pages", split && split.pages.length === 3,
      split ? `${split.pages.length} pages` : "null");
    if (split && split.pages.length === 3) {
      check("page 1 contient 70055667", split.pages[0].text.includes("70055667"));
      check("page 1 ne contient PAS 70066778", !split.pages[0].text.includes("70066778"));
      check("page 2 contient 70066778", split.pages[1].text.includes("70066778"));
      check("page 2 contient le tableau (Rubrique)",
        split.pages[1].text.includes("Rubrique"));
      check("page 3 contient 70077889", split.pages[2].text.includes("70077889"));
      check("page 2 ne contient PAS 70055667", !split.pages[1].text.includes("70055667"));

      // extraction de la page 2 -> fichier autonome
      const single = await extractDocxPageRange(buf, 2, 2);
      check("extraction page 2 : buffer non nul", !!single && single.length > 0);
      if (single) {
        const z = await JSZip.loadAsync(single);
        const doc = await z.file("word/document.xml").async("string");
        check("fichier page 2 : 1 seul bulletin (CHOUIKHA)",
          doc.includes("70066778") && !doc.includes("70055667") && !doc.includes("70077889"));
        check("fichier page 2 : tableau conservé", doc.includes("<w:tbl>"));
        check("fichier page 2 : mise en page conservée", doc.includes("<w:sectPr"));
        check("fichier page 2 : [Content_Types].xml conservé",
          !!z.file("[Content_Types].xml"));
        check("fichier page 2 : document.xml balancé",
          (doc.match(/<w:p\b/g) || []).length === (doc.match(/<\/w:p>/g) || []).length);
        // le fichier est relisible par le splitter lui-même = 1 page
        const re = await getDocxPageGroups(single);
        check("fichier page 2 : relisible, non re-découpable",
          re === null || re.pages.length < 2, re ? `${re.pages.length} page(s)` : "null (<2)");
      }
      // extraction 1-3 -> document complet équivalent
      const all = await extractDocxPageRange(buf, 1, 3);
      check("extraction 1-3 : non nulle", !!all);
    }
  }

  // ---------- fixture 2 : sans saut (repli CIN candidat) ----------
  // Miroir EXACT de splitTextIntoCinBlocks : le préambule avant le 1er
  // CIN forme un 1er bloc (sans CIN), chaque CIN ouvre un bloc ->
  // 3 pages ; groupMultiPayslips (route) ramènera ensuite 2 groupes
  // (plages [1-2] et [3-3], préambule rattaché à la 1re fiche).
  {
    const split = await getDocxPageGroups(read("fiche_word_sans_saut.docx"));
    check("sans_saut : 3 pages (miroir splitTextIntoCinBlocks)",
      split && split.pages.length === 3,
      split ? `${split.pages.length} pages` : "null");
    if (split && split.pages.length === 3) {
      check("sans_saut page 1 : préambule SANS CIN",
        !split.pages[0].text.includes("70055667") &&
        !split.pages[0].text.includes("70066778"));
      check("sans_saut page 2 : CIN 1 (sans CIN 2)",
        split.pages[1].text.includes("70055667") &&
        !split.pages[1].text.includes("70066778"));
      check("sans_saut page 3 : CIN 2 (sans CIN 1)",
        split.pages[2].text.includes("70066778") &&
        !split.pages[2].text.includes("70055667"));
      // extraction [2-3] : fiche A autonome (préambule + contenu A)
      const buf = read("fiche_word_sans_saut.docx");
      const a = await extractDocxPageRange(buf, 1, 2);
      check("sans_saut : extraction [1-2] ok", !!a);
      if (a) {
        const z = await JSZip.loadAsync(a);
        const doc = await z.file("word/document.xml").async("string");
        check("sans_saut [1-2] : CIN 1 présent, CIN 2 absent",
          doc.includes("70055667") && !doc.includes("70066778"));
      }
      const b = await extractDocxPageRange(buf, 3, 3);
      check("sans_saut : extraction [3-3] ok", !!b);
      if (b) {
        const z = await JSZip.loadAsync(b);
        const doc = await z.file("word/document.xml").async("string");
        check("sans_saut [3-3] : CIN 2 présent, CIN 1 absent",
          doc.includes("70066778") && !doc.includes("70055667"));
      }
    }
  }

  // ---------- fixture 3 : marqueur de rendu ----------
  {
    const split = await getDocxPageGroups(read("fiche_word_rendered.docx"));
    check("rendered : 2 pages", split && split.pages.length === 2,
      split ? `${split.pages.length} pages` : "null");
    if (split && split.pages.length === 2) {
      check("rendered page 1 : CIN 1 uniquement",
        split.pages[0].text.includes("70055667") &&
        !split.pages[0].text.includes("70066778"));
      check("rendered page 2 : commence par BULLETIN (marqueur en tête)",
        split.pages[1].text.includes("70066778") &&
        !split.pages[1].text.includes("70055667"));
    }
  }

  // ---------- fixture 4 : sauts de section ----------
  {
    const buf = read("fiche_word_sections.docx");
    const split = await getDocxPageGroups(buf);
    check("sections : 2 pages", split && split.pages.length === 2,
      split ? `${split.pages.length} pages` : "null");
    if (split && split.pages.length === 2) {
      const single = await extractDocxPageRange(buf, 1, 1);
      check("sections : extraction page 1", !!single);
      if (single) {
        const z = await JSZip.loadAsync(single);
        const doc = await z.file("word/document.xml").async("string");
        check("sections page 1 : CIN 1 seul",
          doc.includes("70055667") && !doc.includes("70066778"));
        check("sections page 1 : sectPr de la section utilisé (pas de doublon)",
          (doc.match(/<w:sectPr[\s>]/g) || []).length === 1,
          `${(doc.match(/<w:sectPr[\s>]/g) || []).length} sectPr`);
      }
    }
  }

  // ---------- fixture 5 : fiche unique ----------
  {
    const split = await getDocxPageGroups(read("fiche_word_unique.docx"));
    check("unique : null (non découpable)", split === null);
    const single = await extractDocxPageRange(read("fiche_word_unique.docx"), 1, 1);
    check("unique : extraction refusée", single === null);
  }

  // ---------- plage invalide ----------
  {
    const buf = read("fiche_word_multipages.docx");
    check("plage 0-2 refusée", (await extractDocxPageRange(buf, 0, 2)) === null);
    check("plage 3-2 refusée", (await extractDocxPageRange(buf, 3, 2)) === null);
    check("plage 99-100 refusée", (await extractDocxPageRange(buf, 99, 100)) === null);
  }

  // ---------- compteur de candidats CIN (garde de confidentialité) ----------
  {
    check("candidats : 1 CIN + matricule alphanumérique = 1",
      countDistinctCinCandidates(
        "BULLETIN DE PAIE\nSociété : DEMO SARL\nNom : JAZIRI Leila\nMatricule : MAT-4001\nC.I.N : 70055667\nNet à payer : 2 320,000"
      ) === 1);
    check("candidats : CIN + N° CNSS avec clé = 1",
      countDistinctCinCandidates(
        "N° CNSS : 17775208 - 08\nC.I.N : 70055667"
      ) === 1);
    check("candidats : montant décimal 8 chiffres ignoré",
      countDistinctCinCandidates("Salaire : 12500000,000\nC.I.N : 70055667") === 1);
    check("candidats : 2 CIN différents = 2 (garde -> repli)",
      countDistinctCinCandidates("C.I.N : 70055667\nC.I.N : 70066778") === 2);
    check("candidats : 0 sur texte sans CIN",
      countDistinctCinCandidates("Salaire de base : 1 500,000\nPériode : 05/2026") === 0);
  }

  console.log(failures === 0 ? "\nTOUS LES TESTS OK" : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
