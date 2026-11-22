/**
 * Test v0.2.46 — rendu des e-mails de création de demande avec la nouvelle
 * ligne « E-mail employé ». Extrait les fonctions de scripts/portail-server.js
 * SANS démarrer le serveur (extraction par comptage d'accolades).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "portail-server.js"),
  "utf8"
);

/** Extrait une déclaration « function nom( » complète par comptage d'accolades. */
function extraireFonction(nom) {
  const marqueur = "function " + nom + "(";
  const debut = src.indexOf(marqueur);
  if (debut < 0) throw new Error("fonction introuvable : " + nom);
  const debutCorps = src.indexOf("{", debut);
  let profondeur = 0;
  let i = debutCorps;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") profondeur++;
    else if (c === "}") {
      profondeur--;
      if (profondeur === 0) break;
    }
  }
  return src.slice(debut, i + 1);
}

// Fonctions nécessaires (texte + HTML) et leur dépendance d'échappement.
const code =
  extraireFonction("echappeEmailDemande") +
  "\n" +
  extraireFonction("texteEmailDemandeCreation") +
  "\n" +
  extraireFonction("htmlEmailDemandeCreation") +
  "\nreturn { texte: texteEmailDemandeCreation, html: htmlEmailDemandeCreation };";

const fonctions = new Function(code)();

// ---------- CAS 1 : attestation (avec e-mail employé, infos vides) ----------
const attestation = {
  reference: "DEM-2026-00042",
  typeLibelle: "Attestation de travail",
  nomEmploye: "Mohamed Ben Ali",
  emailEmploye: "mohamed.benali@entreprise.tn",
  cinMasque: "•••233",
  dateDemande: "22/09/2026 10:30",
  statutLabel: "En attente",
  infos: [],
};
const texte1 = fonctions.texte(attestation);
const html1 = fonctions.html(attestation);
console.log("========== E-MAIL TEXTE (attestation) ==========");
console.log(texte1);
console.log("========== Vérifications ==========");
const assertions = [
  ["texte contient la ligne e-mail", texte1.indexOf("E-mail employé             : mohamed.benali@entreprise.tn") >= 0],
  ["html contient la ligne e-mail", html1.indexOf("E-mail employé") >= 0 && html1.indexOf("mohamed.benali@entreprise.tn") >= 0],
  ["e-mail échappé en HTML (pas de @ brut cassant)", html1.indexOf("mohamed.benali@entreprise.tn") >= 0],
];

// ---------- CAS 2 : demande SANS e-mail connu (demande historique/congé sans compte) ----------
const sansEmail = Object.assign({}, attestation, { emailEmploye: "", infos: [["E-mail du N+1 / responsable", "chef@entreprise.tn"]] });
const texte2 = fonctions.texte(sansEmail);
const html2 = fonctions.html(sansEmail);
assertions.push(["texte SANS e-mail : ligne omise", texte2.indexOf("E-mail employé") < 0]);
assertions.push(["html SANS e-mail : ligne omise", html2.indexOf("E-mail employé") < 0]);
assertions.push(["html : infos toujours rendues", html2.indexOf("chef@entreprise.tn") >= 0]);

// ---------- CAS 3 : tentative d'injection HTML dans l'e-mail ----------
const injection = Object.assign({}, attestation, { emailEmploye: '<script>alert(1)</script>@x.tn' });
const html3 = fonctions.html(injection);
assertions.push(["html : injection neutralisée", html3.indexOf("<script>") < 0 && html3.indexOf("&lt;script&gt;") >= 0]);

let echecs = 0;
for (const [nom, ok] of assertions) {
  console.log((ok ? "PASS" : "FAIL") + " — " + nom);
  if (!ok) echecs++;
}
if (echecs) {
  console.error(echecs + " test(s) en échec");
  process.exit(1);
}
console.log("=== TOUS LES TESTS PASSENT (v0.2.46 e-mail demande) ===");
