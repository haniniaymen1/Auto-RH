// Validation hors ligne du correctif extractMatricule (Task 160)
// sur le TEXTE RÉEL produit par pdf-parse (le même que celui du serveur)
const { PDFParse } = require("pdf-parse");
const fs = require("fs");

// --- réplique exacte des helpers du fichier source (pour test hors build) ---
const LIBELLES_VERTICAUX = new Set([
  "MATRICULE", "NOM ET PRENOM", "NOM ET PRENOMS", "NOM", "NOMS",
  "PRENOM", "PRENOMS", "FONCTION", "EMPLOI", "POSTE", "CATEGORIE",
  "SERVICE", "DEPARTEMENT", "ETAT CIVIL", "SITUATION FAMILIALE",
  "ENF A CHARGE", "ENFANT A CHARGE", "ENFANTS A CHARGE",
  "CNSS", "N CNSS", "NO CNSS", "NUM CNSS",
  "CIN", "N CIN", "NO CIN", "NUM CIN",
  "DATE EMBAUCHE", "DATE D EMBAUCHE",
]);
const normaliserLibelleVert = (l) =>
  l.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
   .replace(/[.°'’]/g, " ").replace(/\s+/g, " ").trim();
const LIBELLES_TRIES_LONGUEUR = Array.from(LIBELLES_VERTICAUX).sort((a, b) => b.length - a.length);
function ligneDeLibelles(ligne) {
  let reste = normaliserLibelleVert(ligne);
  if (!reste) return null;
  const trouves = [];
  while (reste.length) {
    reste = reste.replace(/^[ \t]+/, "");
    if (!reste) break;
    const candidat = LIBELLES_TRIES_LONGUEUR.find((lb) => reste === lb || reste.startsWith(lb + " "));
    if (!candidat) return null;
    trouves.push(candidat);
    reste = reste.slice(candidat.length);
  }
  return trouves.length >= 2 ? trouves : null;
}

// --- extractMatricule : règles 2-3 inchangées + fallback MODIFIÉ (Task 160) ---
function extractMatricule(text) {
  const lineStart = text.match(
    /(?:^|\n)[ \t]*MATRICULE(?!\s+FISCAL)(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i
  );
  if (lineStart && /\d/.test(lineStart[1])) return lineStart[1].trim();
  const m = text.match(/MATRICULE(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i);
  if (m && /\d/.test(m[1])) return m[1].trim();

  const MAT_HEADER = /(?:^|[^\dA-ZÀ-Þ])MATRICULE(?:[^\dA-ZÀ-Þ]|$)/i;
  const linesM = text.split("\n");
  for (let i = 0; i < linesM.length; i++) {
    if (!MAT_HEADER.test(linesM[i])) continue;
    for (let j = i + 1; j <= i + 5 && j < linesM.length; j++) {
      const valueLine = linesM[j].trim();
      if (!valueLine) continue;
      if (ligneDeLibelles(valueLine)) continue; // ligne de libellés -> sauter
      const vm = valueLine.match(
        /^(?:(?![\dA-Za-zÀ-ÿ]).)*?(\d{3,8})(?![\d.,])(?![ \t]*[-/][ \t]*\d{1,2}(?:[^\d]|$))/
      );
      if (vm) return vm[1];
      break;
    }
  }
  return null;
}

(async () => {
  // Corpus A : la structure du lien TransferNow (FICHE 3879)
  const bufA = fs.readFileSync("/home/z/my-project/tmp-transfernow/transfer_20260924GsjEuUV5/FICHE_3879_TEST_EMPLOYE_2026.PDF");
  // Corpus B : 20 employés, même structure (fiches_paie_1000)
  const bufB = fs.readFileSync("/home/z/my-project/tmp-testgen/corpus_20_employes.pdf");
  const cas = [
    ["Corpus A p1 (attendu 003879)", bufA, "003879"],
    ["Corpus B p1 (attendu 294452)", bufB, "294452"],
  ];
  let ok = 0;
  for (const [label, buf, attendu] of cas) {
    const parser = new PDFParse({ data: buf });
    const r = await parser.getText();
    const t = r.pages[0].text || r.text;
    const obtenu = extractMatricule(t);
    console.log(`${obtenu === attendu ? "OK " : "KO "} ${label} -> ${obtenu}`);
    if (obtenu === attendu) ok++;
    await parser.destroy();
  }
  // Cas de garde : CNSS avec clé ne doit JAMAIS devenir un matricule
  const garde = extractMatricule("MATRICULE NOM ET PRENOM FONCTION\nETAT CIVIL ENF. A CHARGE N° CNSS N° CIN\nCélibataire 0 28843385 - 97 80012134");
  console.log(`${garde === null ? "OK " : "KO "} garde CNSS+clé -> ${garde} (attendu null)`);
  if (garde === null) ok++;
  console.log(`\n${ok}/3 validations`);
  process.exit(ok === 3 ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
