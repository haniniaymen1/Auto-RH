/**
 * ANALYSE Task 70 — LECTURE SEULE du dossier upload/analyse-cin (fiches de
 * l'utilisateur) : extrait le texte avec pdf-parse (MÊME moteur que l'import)
 * et affiche, pour chaque PDF :
 *   - les lignes contenant un libellé CIN (« CIN », « C.I.N », « Carte ») ;
 *   - les lignes contenant des jetons lettre(s)+chiffres (format marocain) ;
 *   - les 3 premières lignes du texte (contexte d'en-tête) ;
 *   - le résultat de la détection ACTUELLE (import du module compilé si dispo,
 *     sinon réimplémentation fidèle des 3 premières règles).
 * But : comprendre pourquoi « 1 CIN détecté » sur ces fiches.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const RACINE = "/home/z/my-project";
const DOSSIERS = ["z1", "z2", "z3"].map((d) => path.join(RACINE, "upload/analyse-cin", d));

const RE_LIBELLE = /C\.?\s*I\.?\s*N|CIN|CARTE\s+(?:NATIONALE\s+)?D'?\s*IDENTIT/i;
const RE_LETTRES_CHIFFRES = /(?<![A-Z0-9])[A-Z]{1,2}\s?\d{5,6}(?!\d)/g;
const RE_CHIFFRES = /(?<!\d)\d{6,10}(?!\d)/g;

async function analyser(fichier) {
  const buf = fs.readFileSync(fichier);
  const parser = new PDFParse({ data: buf });
  try {
    const res = await parser.getText();
    const text = (res.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
    return text;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

(async () => {
  for (const dossier of DOSSIERS) {
    if (!fs.existsSync(dossier)) continue;
    const pdfs = fs.readdirSync(dossier).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
    console.log(`\n######## ${path.basename(dossier)} : ${pdfs.length} PDF ########`);
    for (const pdf of pdfs.slice(0, 4)) {
      const fichier = path.join(dossier, pdf);
      let text = "";
      try {
        text = await analyser(fichier);
      } catch (e) {
        console.log(`\n--- ${pdf} : ERREUR extraction : ${e.message}`);
        continue;
      }
      if (!text.trim()) {
        console.log(`\n--- ${pdf} : TEXTE VIDE (scan image ?)`);
        continue;
      }
      const lignes = text.split("\n").map((l) => l.trim()).filter(Boolean);
      console.log(`\n--- ${pdf} : ${lignes.length} lignes non vides`);
      console.log("  [en-tête] " + lignes.slice(0, 5).join(" | ").slice(0, 220));
      for (const l of lignes) {
        if (RE_LIBELLE.test(l)) console.log("  [LIBELLÉ] " + l.slice(0, 200));
      }
      for (const l of lignes) {
        const m = [...l.matchAll(RE_LETTRES_CHIFFRES)];
        if (m.length) console.log("  [LETTRES+CH] " + l.slice(0, 200) + "   => " + m.map((x) => x[0]).join(", "));
      }
    }
  }
})();
