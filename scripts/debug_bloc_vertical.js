// Debug hors ligne : blocLibellesVerticaux sur le texte réel de FICHE_3879 p.1
const fs = require("fs");

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

const libellesMultiSurLigne = (ligne) => {
  const morceaux = ligne.split(/\s{2,}/).map((m) => normaliserLibelleVert(m)).filter(Boolean);
  if (morceaux.length < 2) return [];
  return morceaux.every((m) => LIBELLES_VERTICAUX.has(m)) ? morceaux : [];
};

function blocLibellesVerticaux(text) {
  const res = new Map();
  if (!text) return res;
  const lignes = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lignes.length; i++) {
    if (!LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[i])) &&
        libellesMultiSurLigne(lignes[i]).length < 2) continue;
    let j = i;
    const labels = [];
    while (j < lignes.length) {
      if (LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[j]))) {
        labels.push(normaliserLibelleVert(lignes[j])); j++; continue;
      }
      const multi = libellesMultiSurLigne(lignes[j]);
      if (multi.length >= 2) { labels.push(...multi); j++; continue; }
      break;
    }
    if (labels.length < 2) { i = j - 1; continue; }
    const valeurs = [];
    let k = j;
    while (k < lignes.length && valeurs.length < labels.length &&
           !LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[k]))) {
      const multi = libellesMultiSurLigne(lignes[k]); // NB: version debug — le vrai code ne fait pas ça ici
      valeurs.push(lignes[k]); k++;
    }
    for (let v = 0; v < labels.length && v < valeurs.length; v++)
      if (!res.has(labels[v])) res.set(labels[v], valeurs[v]);
    i = k - 1;
  }
  return res;
}

// Texte page 1 exact (pdf-parse devrait ressembler à PyMuPDF)
const doc = JSON.parse(fs.readFileSync("/home/z/my-project/tmp-testgen/debug_page1.json", "utf8"));
console.log("=== LIGNES (représentation exacte) ===");
doc.lignes.forEach((l, i) => console.log(`${String(i).padStart(2)}: "${l}"`));

const bloc = blocLibellesVerticaux(doc.texte);
console.log("\n=== BLOC VERTICAL ===");
for (const [k, v] of bloc) console.log(`  ${k} -> "${v}"`);
const mat = bloc.get("MATRICULE");
console.log(`\nMATRICULE brut -> "${mat}" | match /^\\d{3,10}$/ : ${mat && /^\d{3,10}$/.test(mat.trim())}`);
