/**
 * DIAGNOSTIC Task 65bis — LECTURE SEULE (aucune écriture).
 *
 * But : comprendre pourquoi l'onglet « Accès portail » n'affiche qu'UN SEUL
 * CIN détecté alors que l'utilisateur a importé ses fiches.
 *
 * Le répertoire de l'API /api/payslips/employes lit UNIQUEMENT la colonne
 * Payslip.cin (remplie à l'import par l'extracteur). Si l'extraction a échoué
 * (ou fiches importées avant l'ajout de la détection), cin = null alors que
 * le CIN figure dans le TEXTE de la fiche (colonne content/normalizedContent).
 *
 * Ce script compte :
 *   - total de fiches, fiches avec cin non vide, fiches cin vide ;
 *   - pour les fiches cin vide : le contenu contient-il un CIN ?
 *     (recherche libellé « CIN : … » / « N° CIN » + groupes 8-9 chiffres
 *     isolés dans le contenu NORMALISÉ — approche volontairement large)
 *   - les PortalAccess existants (CIN saisis manuellement par le RH).
 *
 * Aucune donnée sensible n'est imprimée en clair : CIN masqués (3 premiers +
 * 2 derniers), noms masqués, contenus jamais imprimés.
 * Usage : node scripts/diag65_cins_reels.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { dechiffrerChamp } = require("./lib-crypto-bd.js");

// --- Clés : charger .env du projet (sans écraser l'environnement existant) ---
const RACINE = path.join(__dirname, "..");
const envPath = path.join(RACINE, ".env");
if (fs.existsSync(envPath)) {
  for (const ligne of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const db = new DatabaseSync(path.join(RACINE, "db", "custom.db"), { readOnly: true });

const masquerCin = (cin) => {
  const c = String(cin ?? "");
  if (c.length <= 5) return "•" + c.slice(-2);
  return c.slice(0, 3) + "••••" + c.slice(-2);
};
const masquerNom = (n) => {
  const s = String(n ?? "").trim();
  if (!s) return "(sans nom)";
  const parts = s.split(/\s+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + ".").join(" ");
};
const d = (v) => (v === null || v === undefined ? null : dechiffrerChamp(v));

// Normalisation identique à normalizeText (majuscules, sans espaces . / -)
const normaliser = (t) => String(t || "").toUpperCase().replace(/[\s.\/\-]/g, "");

// Scan LARGE d'un CIN potentiel dans le contenu :
// 1) libellé CIN suivi de chiffres (mêmes familles que l'extracteur)
// 2) groupe isolé de 8 chiffres (CIN classique) ou 9 chiffres (récent)
//    dans le contenu normalisé — borné par non-chiffres.
function candidatsDansContenu(content) {
  const trouves = new Set();
  if (!content) return trouves;
  // 1) libellés CIN (texte brut, avec séparateurs)
  const reLabel =
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/gi;
  let m;
  while ((m = reLabel.exec(content))) {
    const nettoye = m[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    if (/^\d{8}$/.test(nettoye) || /^\d{9}$/.test(nettoye)) trouves.add(nettoye);
    else if (/^[A-Z]{0,2}\d{5,8}$/.test(nettoye)) trouves.add(nettoye);
  }
  // 2) groupes isolés 8-9 chiffres dans le texte normalisé
  const norm = normaliser(content);
  let g;
  const reIso = /(?<![A-Z0-9])(\d{8,9})(?![0-9])/g;
  while ((g = reIso.exec(norm))) trouves.add(g[1]);
  return trouves;
}

const rows = db
  .prepare(
    "SELECT fileName, cin, employeeName, content, uploadedAt FROM Payslip ORDER BY uploadedAt DESC"
  )
  .all();

let avecCin = 0;
let sansCin = 0;
const cinsColonne = new Map(); // cin normalisé -> nb fiches
const cinsUniquementContenu = new Map(); // cin -> nb fiches où cin colonne vide
const echantillon = [];

for (const r of rows) {
  const cin = d(r.cin);
  const nom = d(r.employeeName);
  const contenu = d(r.content);
  const cinBrut = (cin ?? "").trim();
  if (cinBrut) {
    avecCin++;
    const cle = cinBrut.toUpperCase().replace(/[\s.\/\-]/g, "");
    cinsColonne.set(cle, (cinsColonne.get(cle) || 0) + 1);
  } else {
    sansCin++;
    const candidats = candidatsDansContenu(contenu);
    // Écarte les groupes qui ne sont pas plausibles comme CIN si un libellé
    // existe : on garde tout pour le diagnostic (comptage indicatif).
    for (const c of candidats) {
      cinsUniquementContenu.set(c, (cinsUniquementContenu.get(c) || 0) + 1);
    }
    if (echantillon.length < 12) {
      const f = d(r.fileName) ?? "?";
      echantillon.push({
        fichier: f.length > 46 ? f.slice(0, 24) + "…" + f.slice(-18) : f,
        nom: masquerNom(nom),
        taille: (contenu ?? "").length,
        libelleCin: /C\.?\s*I\.?\s*N\.?|CIN/i.test(contenu ?? "") ? "oui" : "non",
        candidats: Array.from(candidats).slice(0, 6).map(masquerCin),
      });
    }
  }
}

const pa = db.prepare("SELECT cin, createdAt FROM PortalAccess").all();
const acces = pa.map((a) => ({ cin: masquerCin(d(a.cin)), cree: a.createdAt }));

console.log("=== DIAGNOSTIC CIN (LECTURE SEULE) ===");
console.log(`Fiches de paie (Payslip) : ${rows.length}`);
console.log(`  - avec CIN dans la colonne cin      : ${avecCin}`);
console.log(`  - avec colonne cin VIDE             : ${sansCin}`);
console.log(`CIN distincts via colonne cin : ${cinsColonne.size}`);
for (const [k, v] of cinsColonne) console.log(`    colonne : ${masquerCin(k)} (${v} fiche(s))`);
console.log(
  `CIN supplémentaires trouvés UNIQUEMENT dans le contenu (colonne vide) : ${cinsUniquementContenu.size}`
);
const tri = Array.from(cinsUniquementContenu.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [k, v] of tri) console.log(`    contenu : ${masquerCin(k)} (${v} fiche(s))`);
console.log(`Accès portail existants : ${acces.length}`);
for (const a of acces) console.log(`    ${a.cin} (créé ${a.cree})`);
console.log("--- Échantillon fiches SANS CIN en colonne ---");
for (const e of echantillon) {
  console.log(
    `  ${e.fichier} | nom=${e.nom} | contenu=${e.taille}o | libellé CIN=${e.libelleCin} | candidats=${e.candidats.join(",") || "—"}`
  );
}
db.close();
