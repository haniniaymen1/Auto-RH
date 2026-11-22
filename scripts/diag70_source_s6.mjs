/**
 * Task 70 — diagnostic de la nouvelle source S6 (valeursCinLigneSuivante) :
 * compare les CIN trouvés par S1-S5 SEULS et par S1-S6 sur les fiches réelles
 * de la COPIE, et affiche les lignes de texte à l'origine des détections
 * SUPPLÉMENTAIRES (vérification anti-faux-positifs).
 *
 * Utilise le VRAI code TypeScript (hook de résolution .ts) + lecture SQLite
 * directe + déchiffrement lib-crypto-bd (comme diag65_cins_reels.js).
 *
 * Usage : DATABASE_URL=file:<copie> node scripts/diag70_source_s6.mjs
 */
import { register } from "node:module";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

register("./ts-resolve-hook.mjs", import.meta.url);
const require2 = createRequire(import.meta.url);
const { dechiffrerChamp } = require2("./lib-crypto-bd.js");
const {
  detectCin,
  detectCinFromTableContext,
  isExactCinInContent,
  valeursCinLigneSuivante,
} = await import("../src/lib/payslip-extractor.ts");

// (Task 67, S4/S5 — copies fidèles du route.ts, qui ne les exporte pas)
function scanLibellesCin(texte) {
  const trouves = [];
  if (!texte) return trouves;
  const re =
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+(?:NATIONALE\s+)?(?:D[' ]\s*)?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/gi;
  for (const m of texte.matchAll(re)) {
    const nettoye = m[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    if (/^\d{8}$/.test(nettoye) || /^\d{9}$/.test(nettoye)) trouves.push(nettoye);
    else if (/^[A-Z]{0,2}\d{5,8}$/.test(nettoye)) trouves.push(nettoye);
  }
  return trouves;
}
function jetonsCinNomFichier(nomFichier) {
  const jetons = [];
  if (!nomFichier) return jetons;
  for (const m of nomFichier.matchAll(/(?<!\d)(\d{8,9})(?!\d)/g)) {
    const tok = m[1];
    if (/^(?:19|20)\d{6}$/.test(tok)) continue;
    if (/^(?:19|20)\d{7}$/.test(tok)) continue;
    jetons.push(tok);
  }
  return jetons;
}

// Racine + .env (pour la clé de déchiffrement)
const RACINE = path.join(import.meta.dirname ?? ".", "..");
for (const ligne of fs.readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const dbChemin = process.env.DATABASE_URL?.replace(/^file:/, "").replace(/\?.*$/, "")
  ?? path.join(RACINE, "db", "custom.db");
const db = new DatabaseSync(dbChemin);
const rows = db.prepare(`SELECT "fileName", "cin", "content" FROM Payslip`).all();
console.log(`Fiches : ${rows.length} — base : ${dbChemin}`);

const norm = (x) => (x ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
const anciens = new Set();
const nouveaux = new Set();
const preuves = new Map();

for (const r of rows) {
  const contenu = dechiffrerChamp(r.content) ?? "";
  const colCin = dechiffrerChamp(r.cin) ?? "";
  const formes = [];
  if (colCin.trim()) formes.push(colCin.trim());
  const d1 = detectCin(contenu);
  if (d1) formes.push(d1);
  const d2 = detectCinFromTableContext(contenu);
  if (d2) formes.push(d2);
  for (const c of scanLibellesCin(contenu)) formes.push(c);
  for (const tok of jetonsCinNomFichier(r.fileName ?? "")) {
    if (isExactCinInContent(contenu, tok)) formes.push(tok);
  }
  const setOld = new Set(formes.map(norm).filter(Boolean));
  for (const c of setOld) anciens.add(c);
  for (const c of setOld) nouveaux.add(c);
  for (const c of valeursCinLigneSuivante(contenu)) {
    const cle = norm(c);
    if (!cle) continue;
    if (!setOld.has(cle) && !preuves.has(cle)) {
      const lignes = contenu.split("\n").map((l) => l.trim());
      let idx = -1;
      for (let i = 0; i < lignes.length; i++) {
        if (/(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+(?:NATIONALE\s+)?D'?\s*IDENTIT)/i.test(lignes[i])) {
          for (let j = i + 1; j <= i + 2 && j < lignes.length; j++) {
            if (!lignes[j]) continue;
            const nettoye = lignes[j].replace(/\([^)]*\)/g, " ")
              .replace(/^(?:ID|CIN)\s*[:\-]?\s+/i, "")
              .toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (nettoye === c) { idx = i; break; }
          }
          if (idx >= 0) break;
        }
      }
      preuves.set(cle, {
        fichier: dechiffrerChamp(r.fileName) ?? r.fileName,
        libelle: idx >= 0 ? lignes[idx] : "(introuvable)",
        valeur: idx >= 0 ? (lignes[idx + 1] ?? lignes[idx + 2] ?? "") : "(introuvable)",
      });
    }
    nouveaux.add(cle);
  }
}

console.log(`CIN S1-S5 : ${anciens.size} — CIN S1-S6 : ${nouveaux.size}`);
const ajoutes = [...nouveaux].filter((c) => !anciens.has(c));
console.log(`AJOUTÉS PAR S6 (${ajoutes.length}) :`);
for (const c of ajoutes) {
  const p = preuves.get(c) ?? {};
  console.log(`  • ${c}`);
  console.log(`    fichier : ${p.fichier}`);
  console.log(`    libellé : « ${p.libelle} »`);
  console.log(`    valeur  : « ${p.valeur} »`);
}
