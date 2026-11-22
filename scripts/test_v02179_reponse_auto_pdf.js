#!/usr/bin/env node
/**
 * ============================================================================
 * v0.2.179 — DEMANDE UTILISATEUR : RÉPONSE AUTOMATIQUE PDF DÉSACTIVÉE pour
 * les demandes d'ATTESTATION DE TRAVAIL, d'ATTESTATION DE SALAIRE et de
 * PARRAINAGE (après décision acceptée OU refusée).
 *
 *   « Pour les demandes attestations salaire et travail et parrainage ici je
 *    parle après la décision accepté ou refusée n'envoie pas reponse
 *    automatique pdf »
 *
 * Conformité attendue de scripts/portail-server.js :
 *   §1  garde-fou sansReponseAutoPdf couvre les 3 types ;
 *   §2  la génération du PDF signé (docFinal) est conditionnée par
 *       !sansReponseAutoPdf → AUCUN PDF généré pour ces 3 types ;
 *   §3  la notification de décision à l'employé est court-circuitée pour ces
 *       3 types (branche « réponse automatique PDF DÉSACTIVÉE », trace
 *       journal reponseAutoPdf="desactivee") ;
 *   §4  simulation de la condition pour les 5 types de demandes :
 *       attestations + parrainage → true (désactivée) ;
 *       congé + autorisation → false (comportement inchangé, PDF conservé) ;
 *   §5  les SEULS appels traiterDocumentSigneAcceptation /
 *       traiterDocumentRefusDecision sont DANS le bloc protégé ;
 *   §6  la détection des décisions par e-mail reste ACTIVE pour les 3 types
 *       (PARRAINAGE dans TYPES_CLASSIFICATION_AUTO — les statuts continuent
 *       de se mettre à jour automatiquement, portail + administration) ;
 *   §7  transfert des pièces jointes v0.2.171 intact (branché sur la
 *       notification de décision — congé/autorisation seulement).
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const portail = fs.readFileSync(path.join(RACINE, "scripts/portail-server.js"), "utf8");
const classif = fs.readFileSync(path.join(RACINE, "scripts/classification-reponses.js"), "utf8");

let ok = 0, ko = 0;
function verif(nom, cond, detail) {
  if (cond) { ok++; console.log("  [OK]   " + nom); }
  else { ko++; console.log("  [FAIL] " + nom + (detail ? " — " + detail : "")); }
}

console.log("=== v0.2.179 — désactivation de la réponse automatique PDF ===\n");

// ---- §1 garde-fou présent et couvrant les 3 types ----
console.log("§1 Garde-fou sansReponseAutoPdf :");
const mDef = portail.match(
  /const\s+sansReponseAutoPdf\s*=\s*demande\.type\s*===\s*"([A-Z_]+)"\s*\|\|\s*\n?\s*demande\.type\s*===\s*"([A-Z_]+)"\s*\|\|\s*\n?\s*demande\.type\s*===\s*"([A-Z_]+)"/
);
verif("définition présente", !!mDef);
if (mDef) {
  const couverts = [mDef[1], mDef[2], mDef[3]].sort();
  verif("couvre ATTESTATION_SALAIRE, ATTESTATION_TRAVAIL, PARRAINAGE",
    JSON.stringify(couverts) === JSON.stringify(["ATTESTATION_SALAIRE", "ATTESTATION_TRAVAIL", "PARRAINAGE"]),
    "trouvé : " + couverts.join(", "));
}

// ---- §2 génération PDF protégée ----
console.log("\n§2 Génération du PDF signé protégée :");
const mBloc = portail.match(
  /if\s*\(decisionApplicable\s*&&\s*!sansReponseAutoPdf\s*&&\s*\(statutApres\s*===\s*"ACCEPTEE"\s*\|\|\s*statutApres\s*===\s*"REFUSEE"\)\)/
);
verif("bloc docFinal conditionné par !sansReponseAutoPdf", !!mBloc);

// ---- §3 notification court-circuitée + trace journal ----
console.log("\n§3 Notification de décision court-circuitée :");
const mMute = portail.match(
  /if\s*\(sansReponseAutoPdf\s*&&\s*\(statutApres\s*===\s*"ACCEPTEE"\s*\|\|\s*statutApres\s*===\s*"REFUSEE"\)\)[\s\S]{0,2200}?DÉSACTIVÉE/
);
verif("branche « réponse automatique PDF DÉSACTIVÉE » avant l'envoi", !!mMute);
verif("trace journal reponseAutoPdf = « desactivee »",
  /reponseAutoPdf:\s*decisionApplicable\s*&&\s*sansReponseAutoPdf[\s\S]{0,200}?\? "desactivee"/.test(portail));

// ---- §4 simulation de la condition pour les 5 types ----
console.log("\n§4 Simulation de la condition (5 types) :");
const sourceCondition = mDef
  ? mDef[0].replace(/^const\s+sansReponseAutoPdf\s*=\s*/, "").replace(/;$/, "")
  : null;
const fCondition = sourceCondition
  ? new Function("demande", "return (" + sourceCondition + ");")
  : null;
verif("condition extraite et compilable", typeof fCondition === "function");
if (fCondition) {
  const attendu = {
    ATTESTATION_TRAVAIL: true,
    ATTESTATION_SALAIRE: true,
    PARRAINAGE: true,
    CONGE: false,
    AUTORISATION_SORTIE: false,
  };
  for (const [type, attend] of Object.entries(attendu)) {
    const obtenu = fCondition({ type });
    verif(type + " → sansReponseAutoPdf=" + attend, obtenu === attend,
      "obtenu : " + obtenu);
  }
}

// ---- §5 uniques appels dans le bloc protégé ----
console.log("\n§5 Appels uniques des moteurs de documents :");
const nbAppelsAccept = (portail.match(/await\s+traiterDocumentSigneAcceptation\(/g) || []).length;
const nbAppelsRefus = (portail.match(/await\s+traiterDocumentRefusDecision\(/g) || []).length;
verif("traiterDocumentSigneAcceptation : 1 seul appel (bloc protégé)", nbAppelsAccept === 1,
  "trouvés : " + nbAppelsAccept);
verif("traiterDocumentRefusDecision : 1 seul appel (bloc protégé)", nbAppelsRefus === 1,
  "trouvés : " + nbAppelsRefus);
const avantDoc = portail.indexOf("!sansReponseAutoPdf &&");
const appelAccept = portail.indexOf("await traiterDocumentSigneAcceptation(");
verif("appel dans le bloc protégé (après le garde-fou)",
  avantDoc >= 0 && appelAccept > avantDoc);

// ---- §6 détection des décisions toujours active pour les 3 types ----
console.log("\n§6 Détection e-mail inchangée (statuts automatiques) :");
const mTypesAuto = portail.match(/TYPES_CLASSIFICATION_AUTO\s*=\s*\[([^\]]*)\]/);
verif("TYPES_CLASSIFICATION_AUTO présent", !!mTypesAuto);
if (mTypesAuto) {
  const types = mTypesAuto[1];
  for (const t of ["ATTESTATION_TRAVAIL", "ATTESTATION_SALAIRE", "PARRAINAGE", "CONGE", "AUTORISATION_SORTIE"]) {
    verif("classification automatique active pour " + t, types.includes('"' + t + '"'));
  }
}
verif("branche décision unique parrainage conservée",
  portail.includes("Service parrainage (réponse e-mail)")
  && portail.includes('maj.refuseePar = "PARRAINAGE"'));
verif("classificateur : participes + garde sujet intacts",
  classif.includes("sujetPorteParticipe") && classif.includes("REGEX_SUJET_TRANSMISSION"));

// ---- §7 transfert des pièces jointes v0.2.171 branché sur la notification ----
console.log("\n§7 Transfert des pièces jointes (congé/autorisation) intact :");
verif("piecesJointesReponsesPourEmploye appelée avant envoyerEmailDecisionConge",
  portail.indexOf("piecesJointesReponsesPourEmploye(demande, importes)") < portail.indexOf("await envoyerEmailDecisionConge(")
  && portail.includes("piecesReponses"));

// ---- Résumé ----
console.log("\n=== RÉSULTAT : " + ok + " OK / " + ko + " FAIL ===");
process.exit(ko ? 1 : 0);
