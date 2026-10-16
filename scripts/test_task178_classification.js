#!/usr/bin/env node
/**
 * Task 178 — PREUVE UNITAIRE de la classification automatique des réponses
 * e-mail (scripts/classification-reponses.js).
 *
 * Couvre :
 *   1. LES 21 FORMULATIONS D'ACCEPTATION du cahier des charges (exactes)
 *      → VALIDATION ;
 *   2. LES 21 FORMULATIONS DE REFUS du cahier des charges (exactes) → REFUS ;
 *   3. LES VARIANTES (casse, accents, ponctuation, apostrophes courbes,
 *      texte autour — salutations/signature, sujet seul, corps seul)
 *      → même décision ;
 *   4. LA PRIORITÉ REFUS : les négations (« non approuvée », « n'a pas été
 *      validée »…) ne doivent JAMAIS devenir des validations ;
 *   5. LES MOTS-CLÉS COURTS sur mots entiers : « OK », « NON », « Refus »,
 *      « Désaccord », « Je valide », « Je refuse », « D'accord »,
 *      « J'accorde » — et l'ABSENCE de faux positifs (« notification » ne
 *      déclenche pas « NON », « okapi » pas « OK », « refusée » ne déclenche
 *      pas le mot-clé « Refus » sans formulation complète…) ;
 *   6. L'AMBIGUÏTÉ : acceptation + refus mélangés → AMBIGUE (aucune
 *      décision) ;
 *   7. LE NON-RECONNU : texte neutre → NON_RECONNU (la demande doit rester
 *      « En attente »).
 *
 * Aucune base de données : test pur du module.
 */

process.chdir(__dirname + "/..");

const { normaliserTexte, classifierReponse, FORMULATIONS_ACCEPTATION, FORMULATIONS_REFUS, DECISIONS } = require("./classification-reponses.js");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log("  OK   " + label);
  } else {
    KO++;
    console.log("  FAIL " + label + (detail ? " — " + detail : ""));
  }
}

console.log("=== 1) Les " + FORMULATIONS_ACCEPTATION.length + " formulations d'acceptation (exactes) ===");
for (const f of FORMULATIONS_ACCEPTATION) {
  const r = classifierReponse(f, "");
  check("« " + f + " » → VALIDATION", r.decision === DECISIONS.VALIDATION, "reçu " + r.decision);
}
// Sujet OU corps — la formulation est reconnue quel que soit l'emplacement
{
  const r1 = classifierReponse("Re: Demande de congé — DEM-2026-00042", "Bonjour,\n\nCongé accepté.\n\nCordialement,\nLe manager");
  check("acceptation dans le CORPS (texte autour) → VALIDATION", r1.decision === DECISIONS.VALIDATION && r1.formulations[0] === "Congé accepté", JSON.stringify(r1.formulations));
  const r2 = classifierReponse("Congé validé", "Bonjour, veuillez trouver ci-joint…");
  check("acceptation dans le SUJET → VALIDATION", r2.decision === DECISIONS.VALIDATION);
}

console.log("=== 2) Les " + FORMULATIONS_REFUS.length + " formulations de refus (exactes) ===");
for (const f of FORMULATIONS_REFUS) {
  const r = classifierReponse(f, "");
  check("« " + f + " » → REFUS", r.decision === DECISIONS.REFUS, "reçu " + r.decision);
}

console.log("=== 3) Variantes (casse / accents / ponctuation / apostrophes / contexte) ===");
const variantesAcceptation = [
  ["CONGÉ ACCEPTÉ", ""],
  ["congé validé !!", ""],
  ["Votre demande de congé a été approuvée.", "Cordialement."],
  ["Bonjour,", "Votre demande de congé a été validée.\nBonne journée."],
  ["Re: DEM-2026-00042", "D’accord pour le congé demandé."], // apostrophe courbe
  ["", "J'ACCORDE le congé demandé."],
  ["", "Ok"],
  ["", "OK, merci de préparer l'attestation."],
  ["", "Je valide — bonne route."],
  ["Validation de votre demande de congé (voir pièce jointe)", ""],
  ["", "Confirmation de validation de la demande de congé n° DEM-2026-00042."],
  ["", "Votre congé a été accepté par le service."],
];
for (const [s, c] of variantesAcceptation) {
  const r = classifierReponse(s, c);
  check("« " + (s || c).slice(0, 55).replace(/\n/g, " ") + "… » → VALIDATION", r.decision === DECISIONS.VALIDATION, "reçu " + r.decision);
}
const variantesRefus = [
  ["Congé REFUSÉ", ""],
  ["demande de congé rejetée…", ""],
  ["Re: Demande de congé — DEM-2026-00042", "Bonjour,\n\nJe refuse. Les effectifs sont déjà complets sur cette période.\n\nCordialement."],
  ["", "Après vérification : DÉSACCORD."],
  ["", "Refus — merci de votre compréhension."],
  ["Notification de refus de votre congé", ""],
];
for (const [s, c] of variantesRefus) {
  const r = classifierReponse(s, c);
  check("« " + (s || c).slice(0, 55).replace(/\n/g, " ") + "… » → REFUS", r.decision === DECISIONS.REFUS, "reçu " + r.decision);
}

console.log("=== 4) Priorité REFUS (négations jamais interprétées comme acceptation) ===");
const piegesRefus = [
  ["Demande de congé non approuvée", "contain approuvée"],
  ["Demande de congé non validée", "contain validée"],
  ["Demande de congé non acceptée", "contain acceptée"],
  ["Votre demande de congé n'a pas été approuvée", "contain approuvée"],
  ["Votre demande de congé n'a pas été validée", "contain validée"],
  ["", "Bonjour, votre demande de congé n'a pas été validée. Cordialement."],
  ["", "Congé refusé par le manager — demande de congé refusée."],
];
for (const [s, c] of piegesRefus) {
  const r = classifierReponse(s, c);
  check("« " + (s || c).slice(0, 55).replace(/\n/g, " ") + "… » → REFUS (pas VALIDATION/AMBIGUE)", r.decision === DECISIONS.REFUS, "reçu " + r.decision);
}

console.log("=== 5) Mots-clés courts : mots entiers, aucun faux positif ===");
const motsCles = [
  ["OK", "VALIDATION"], ["Ok.", "VALIDATION"], ["ok pour moi", "VALIDATION"],
  ["D'accord", "VALIDATION"], ["d’accord pour les dates", "VALIDATION"],
  ["J'accorde", "VALIDATION"], ["Je valide", "VALIDATION"],
  ["NON", "REFUS"], ["Non.", "REFUS"], ["non, impossible cette semaine", "REFUS"],
  ["Je refuse", "REFUS"], ["Refus", "REFUS"], ["Désaccord", "REFUS"],
  ["pas d'accord", "REFUS"], ["je ne suis pas d'accord avec ces dates", "REFUS"],
];
for (const [t, attendu] of motsCles) {
  const r = classifierReponse(t, "");
  check("« " + t + " » → " + attendu, r.decision === attendu, "reçu " + r.decision);
}
const fauxPositifs = [
  // « notification » ne contient PAS le mot entier « non »
  ["Notification automatique — ne pas répondre", "NON_RECONNU"],
  // « renoté » / « anonyme » / « minoration » : aucun mot entier « non »
  ["Dossier renoté anonyme", "NON_RECONNU"],
  // « okapi » ne contient pas le mot entier « ok »
  ["Visite du parc okapi", "NON_RECONNU"],
  // « accordéon » ne contient pas « d accord » ni « j accorde »
  ["Cours d'accordéon reporté", "NON_RECONNU"],
  // « refusée » seule (sans formulation complète) : le mot-clé « Refus » est
  // un MOT ENTIER — « refusée » ne le déclenche pas, et aucune formulation
  // complète ne matche.
  // (MODIFIÉ v0.2.178 — demande utilisateur « parrainage : mêmes expressions
  // que le congé, y compris LE MOT SEUL : Acceptée, Validée, …, Refusée »)
  // le mot seul dans l'OBJET est DÉSORMAIS reconnu (passe 2, garde
  // anti-transmission intégrée : « … acceptée par le manager … » reste
  // exclu) → REFUS. Avant v0.2.178 : NON_RECONNU (la demande restait en
  // attente, un humain tranchait — comportement du cahier des charges 3.e).
  ["Réponse : refusée", "REFUS"],
];
for (const [t, attendu] of fauxPositifs) {
  const r = classifierReponse(t, "");
  check("« " + t + " » → " + attendu + " (aucun faux positif)", r.decision === attendu, "reçu " + r.decision);
}

console.log("=== 6) Ambiguïté (acceptation ET refus) → AMBIGUE, aucune décision ===");
const ambigus = [
  ["", "Congé accepté… finalement je refuse, les effectifs sont complets."],
  ["Re: Demande de congé — DEM-2026-00042", "Le manager précédent a écrit « Congé accepté » mais je confirme : NON."],
  ["", "OK pour la première semaine, NON pour la seconde."],
];
for (const [s, c] of ambigus) {
  const r = classifierReponse(s, c);
  check("« " + (s || c).slice(0, 55).replace(/\n/g, " ") + "… » → AMBIGUE", r.decision === DECISIONS.AMBIGUE && !r.decisive, "reçu " + r.decision);
}

console.log("=== 7) Non reconnu (demande reste « En attente ») ===");
const neutres = [
  ["", "Bien reçu, je reviens vers vous rapidement."],
  ["", "Merci de compléter le formulaire avec les dates exactes."],
  ["", "Je suis en déplacement cette semaine, je regarde dès mon retour."],
  ["", ""],
];
for (const [s, c] of neutres) {
  const r = classifierReponse(s, c);
  check("« " + (s || c).slice(0, 55).replace(/\n/g, " ") + "… » → NON_RECONNU", r.decision === DECISIONS.NON_RECONNU && !r.decisive, "reçu " + r.decision);
}

console.log("=== 8) Normalisation (outil) ===");
check("accents/casse/ponctuation/apostrophes", normaliserTexte("D'ACCORD, l'employé a été noté : ok!") === "d accord l employe a ete note ok");
check("emoji/symboles → espaces", normaliserTexte("Congé validé 🎉✅") === "conge valide");

console.log("");
console.log("RÉSULTAT : " + OK + " OK, " + KO + " FAIL");
process.exit(KO ? 1 : 0);
