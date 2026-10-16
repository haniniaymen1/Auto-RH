#!/usr/bin/env node
/**
 * ============================================================================
 * v0.2.180 — DEMANDE UTILISATEUR : GESTION DES PIÈCES JOINTES DANS LES
 * DEMANDES D'ATTESTATION DE SALAIRE ET DE TRAVAIL (et parrainage)
 *
 *   « Est-ce que le service RH peut, lors du traitement d'une demande
 *    d'attestation de salaire ou de travail, joindre des documents à leur
 *    décision ? L'employé pourra-t-il ensuite recevoir ces pièces jointes
 *    avec la décision finale (demande acceptée ou refusée) ? »
 *
 * Comportement attendu de scripts/portail-server.js :
 *   §1  fonction envoyerEmailDecisionDocumentsRh présente (e-mail de décision
 *       à l'employé avec les documents du RH EN PIÈCES JOINTES) ;
 *   §2  aucun PDF auto-généré dans cet envoi (règle v0.2.179 conservée) ;
 *   §3  branchement : décision reconnue (ACCEPTEE/REFUSEE) pour les types
 *       sansReponseAutoPdf → agrégation des pièces (réponse courante +
 *       antérieures) → SI pièces : envoi ; SANS pièces : aucun e-mail ;
 *   §4  pièces jointes agrégées des réponses courante ET antérieures
 *       (piecesJointesReponsesPourEmploye — aucune pièce perdue) ;
 *   §5  trace journal documentsRhTransmis + action dédiée
 *       « demande-decision-documents-rh » ;
 *   §6  e-mail marqué SYSTÈME (X-Auto-RH-Systeme — Garde 2, jamais
 *       reclassé comme réponse) ;
 *   §7  portail employé : les pièces restent consultables/téléchargeables
 *       (endpoints /api/mes-demandes) ;
 *   §8  congé/autorisation : flux inchangé (envoyerEmailDecisionConge +
 *       PDF signé + transfert des pièces v0.2.171) ;
 *   §9  garde-fou v0.2.179 intact (génération PDF protégée).
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const portail = fs.readFileSync(path.join(RACINE, "scripts/portail-server.js"), "utf8");

let ok = 0, ko = 0;
function verif(nom, cond, detail) {
  if (cond) { ok++; console.log("  [OK]   " + nom); }
  else { ko++; console.log("  [FAIL] " + nom + (detail ? " — " + detail : "")); }
}
function extraireFonction(source, nomFonction) {
  const debut = source.indexOf("async function " + nomFonction + "(");
  if (debut < 0) return null;
  let profondeur = 0, i = source.indexOf("{", debut);
  const debutCorps = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") profondeur++;
    else if (source[i] === "}") { profondeur--; if (profondeur === 0) break; }
  }
  return source.slice(debut, i + 1);
}

console.log("=== v0.2.180 — pièces jointes du RH avec la décision (attestations + parrainage) ===\n");

// ---- §1 fonction dédiée ----
console.log("§1 Fonction envoyerEmailDecisionDocumentsRh :");
const fTrans = extraireFonction(portail, "envoyerEmailDecisionDocumentsRh");
verif("fonction définie", !!fTrans);
if (fTrans) {
  verif("objet e-mail avec décision + « documents joints »",
    fTrans.includes("statutLabel + \" — documents joints\""),
    "objet : « AutoRH — Votre demande : {type} {ref} — {décision} — documents joints »");
  verif("pièces jointes attachées (attachments: pieces)", fTrans.includes("attachments: pieces"));
  verif("en-tête système Garde 2 (X-Auto-RH-Systeme)", fTrans.includes('"X-Auto-RH-Systeme": "decision-documents-rh"'));
  verif("couleur bannière selon décision (acceptée verte / refusée rouge)",
    fTrans.includes('acceptee ? "16a34a" : "b91c1c"'));
  verif("renvoie la liste des documents transmis", fTrans.includes("documents: listeDocs.map"));
}

// ---- §2-3 branchement ----
console.log("\n§2 Branchement dans le flux de décision :");
const mBranche = portail.match(
  /if\s*\(sansReponseAutoPdf\s*&&\s*\(statutApres\s*===\s*"ACCEPTEE"\s*\|\|\s*statutApres\s*===\s*"REFUSEE"\)\)\s*\{([\s\S]*?)\n    \} else if \(statutApres === "ACCEPTEE"/
);
verif("branche sansReponseAutoPdf présente", !!mBranche);
if (mBranche) {
  const b = mBranche[1];
  verif("agrégation piecesJointesReponsesPourEmploye(demande, importes)",
    b.includes("piecesJointesReponsesPourEmploye(demande, importes)"));
  verif("envoi UNIQUEMENT si pièces (if piecesRh.length)", b.includes("if (piecesRh.length) {"));
  verif("appelle envoyerEmailDecisionDocumentsRh",
    b.includes("envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh, cfgMail, formulationAffichee)"));
  verif("trace console avec compteur de documents", b.includes("document(s) du RH transmis à l'employé"));
}

// ---- §4 agrégation courantes + antérieures ----
console.log("\n§4 Agrégation des pièces (courantes + antérieures) :");
const fAgg = extraireFonction(portail, "piecesJointesReponsesPourEmploye");
verif("piecesJointesReponsesPourEmploye inclut les pièces antérieures",
  !!fAgg && fAgg.includes("recuDe: { contains: \"@\" }") && fAgg.includes("for (const d of importes || []) candidats.push(d)"));

// ---- §5 trace journal ----
console.log("\n§5 Journalisation :");
verif("champ documentsRhTransmis", /documentsRhTransmis:\s*notification && Array\.isArray\(notification\.documents\)/.test(portail));
verif("action dédiée demande-decision-documents-rh", portail.includes('action: "demande-decision-documents-rh"'));

// ---- §6/§7 portail employé ----
console.log("\n§6-7 Portail employé (consultation des pièces) :");
verif("route /api/mes-demandes présente", portail.includes("api/mes-demandes"));
verif("route documents /api/mes-demandes/documents présente",
  portail.includes("mes-demandes/documents") || fs.existsSync(path.join(RACINE, "src/app/api/mes-demandes/documents")));

// ---- §8 congé/autorisation inchangés ----
console.log("\n§8 Congé / autorisation inchangés :");
const nbDecisionConge = (portail.match(/await envoyerEmailDecisionConge\(/g) || []).length;
verif("envoyerEmailDecisionConge : 1 appel (flux congé/autorisation)", nbDecisionConge === 1,
  "trouvés : " + nbDecisionConge);
verif("transfert des pièces v0.2.171 branché sur l'e-mail de décision",
  portail.indexOf("piecesJointesReponsesPourEmploye(demande, importes)") < portail.indexOf("await envoyerEmailDecisionConge("));

// ---- §9 garde-fou v0.2.179 intact ----
console.log("\n§9 Garde-fou v0.2.179 (aucun PDF auto) intact :");
verif("génération PDF toujours protégée par !sansReponseAutoPdf",
  portail.includes("if (decisionApplicable && !sansReponseAutoPdf &&"));
const nbDocSigne = (portail.match(/await traiterDocumentSigneAcceptation\(/g) || []).length;
const nbDocRefus = (portail.match(/await traiterDocumentRefusDecision\(/g) || []).length;
verif("1 seul appel de chaque moteur de PDF (dans le bloc protégé)", nbDocSigne === 1 && nbDocRefus === 1);
verif("trace reponseAutoPdf = « desactivee » conservée",
  /reponseAutoPdf:\s*decisionApplicable && sansReponseAutoPdf/.test(portail));

// ---- Résumé ----
console.log("\n=== RÉSULTAT : " + ok + " OK / " + ko + " FAIL ===");
process.exit(ko ? 1 : 0);
