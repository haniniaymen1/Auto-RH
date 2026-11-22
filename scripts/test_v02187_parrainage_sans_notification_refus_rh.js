/* ============================================================================
 * TEST v0.2.187 — PARRAINAGE : AUCUNE NOTIFICATION DE REFUS AU SERVICE RH
 * ============================================================================
 * Demande utilisateur : « Dans la demande de parrainage, après le refus du
 * responsable, aucun e-mail de notification de refus ne doit être envoyé au
 * service RH. »
 *
 * Ce test vérifie (par EXTRACTION DE SOURCES + SIMULATIONS EXÉCUTÉES) :
 *   1. la condition d'envoi de envoyerEmailRefusManagerRh exclut désormais
 *      demande.type === "PARRAINAGE" (point d'appel UNIQUE — l.9184) ;
 *   2. SIMULATIONS de la condition extraite : parrainage + refus du
 *      responsable → PAS de notification RH ; congé / autorisation + refus
 *      du manager → notification CONSERVÉE (Task 181) ;
 *   3. le flux parrainage reste inchangé par ailleurs : décision unique
 *      v0.2.178 (refuseePar = « PARRAINAGE »), sans réponse automatique PDF
 *      v0.2.179, documents du responsable transmis à l'employé v0.2.180/182,
 *      notification intermédiaire v0.2.184 hors parrainage ;
 *   4. la garde de rôle est inchangée (roleReponse === "manager" &&
 *      !validation) et la transmission RH après acceptation manager
 *      (v0.2.171) reste intacte ;
 *   5. le journal conserve le champ notificationRhRefus (parrainage →
 *      « absente »).
 * Usage : node test_v02187_parrainage_sans_notification_refus_rh.js
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "portail-server.js");
const src = fs.readFileSync(SRC, "utf8");

let ok = 0, fail = 0, numSection = 0;
function check(libelle, condition) {
  if (condition) { ok++; console.log("  OK  - " + libelle); }
  else { fail++; console.log("  FAIL- " + libelle); }
}
function section(titre) {
  numSection++;
  console.log("\n[" + numSection + "] " + titre);
  console.log("-".repeat(78));
}

// ---------------------------------------------------------------------------
section("1. Exclusion du PARRAINAGE dans la condition d'envoi (sources)");
// ---------------------------------------------------------------------------
check("condition modifiée présente : roleReponse === \"manager\" && !validation && demande.type !== \"PARRAINAGE\"",
  /if \(roleReponse === "manager" && !validation && demande\.type !== "PARRAINAGE"\) \{/.test(src));
check("appel envoyerEmailRefusManagerRh toujours présent (congé / autorisation)",
  src.indexOf("envoyerEmailRefusManagerRh(demande, cfgMail, formulationAffichee)") > 0);
check("point d'appel UNIQUE (aucun autre envoi de la notification de refus)",
  (src.match(/await envoyerEmailRefusManagerRh\(/g) || []).length === 1);
check("commentaire v0.2.187 « PARRAINAGE — AUCUNE NOTIFICATION DE REFUS AU SERVICE RH » présent",
  src.indexOf("(MODIFIÉ v0.2.187 — DEMANDE UTILISATEUR) PARRAINAGE — AUCUNE NOTIFICATION") > 0);
check("en-tête de envoyerEmailRefusManagerRh documente l'exclusion v0.2.187",
  src.indexOf("cette notification n'est PLUS\n *  envoyée pour le PARRAINAGE") > 0);
check("le refus parrainage reste enregistré : refuseePar = « PARRAINAGE » (v0.2.178 intact)",
  src.indexOf('if (!validationParrainage) maj.refuseePar = "PARRAINAGE";') > 0);
check("garde de rôle inchangée en amont (roleReponse === \"manager\" && validation && statutApres !== \"ACCEPTEE\")",
  src.indexOf('roleReponse === "manager" && validation && statutApres !== "ACCEPTEE"') > 0);

// ---------------------------------------------------------------------------
section("2. SIMULATION de la condition extraite du source");
// ---------------------------------------------------------------------------
const mCond = src.match(/if \(roleReponse === "manager" && !validation && demande\.type !== "PARRAINAGE"\)/);
check("motif de la condition extractible", Boolean(mCond));
let fnCond = null;
try {
  const inner = mCond ? mCond[0].replace(/^if \(/, "").replace(/\)$/, "") : "";
  fnCond = new Function("roleReponse", "validation", "demande", "return " + inner + ";");
} catch (e) { fnCond = null; }
check("fonction de condition construite", Boolean(fnCond));
if (fnCond) {
  const par = { type: "PARRAINAGE" };
  const con = { type: "CONGE" };
  const aut = { type: "AUTORISATION_SORTIE" };
  check("SIMULATION — PARRAINAGE, réponse du responsable, REFUS → PAS de notification RH",
    fnCond("manager", false, par) === false);
  check("SIMULATION — CONGE, refus du manager → notification RH CONSERVÉE (Task 181)",
    fnCond("manager", false, con) === true);
  check("SIMULATION — AUTORISATION_SORTIE, refus du manager → notification RH CONSERVÉE",
    fnCond("manager", false, aut) === true);
  check("SIMULATION — PARRAINAGE, ACCEPTATION du responsable → jamais de notification (validation=true, inchangé)",
    fnCond("manager", true, par) === false);
  check("SIMULATION — PARRAINAGE, réponse depuis la boîte RH (roleReponse=rh) → jamais de notification (garde de rôle, inchangé)",
    fnCond("rh", false, par) === false);
  check("SIMULATION — CONGE, manager accepte (validation=true) → pas de notification de refus (transmission RH à la place)",
    fnCond("manager", true, con) === false);
}

// ---------------------------------------------------------------------------
section("3. Flux parrainage strictement inchangé par ailleurs");
// ---------------------------------------------------------------------------
check("branche décision unique PARRAINAGE (v0.2.178) toujours présente",
  src.indexOf("decisionApplicable &&\n    roleReponse === \"manager\" &&\n    demande.type === \"PARRAINAGE\"") > 0);
check("traçage de la décision parrainage : « Service parrainage (réponse e-mail) »",
  src.indexOf('maj.decisionManagerPar = "Service parrainage (réponse e-mail)";') > 0);
check("commentaire de refus parrainage inchangé (décision immédiate et définitive)",
  src.indexOf("Refusée par le service chargé du parrainage — décision immédiate et définitive") > 0);
check("v0.2.179 intacte : PARRAINAGE dans sansReponseAutoPdf (aucun PDF auto)",
  /const sansReponseAutoPdf = demande\.type === "ATTESTATION_TRAVAIL" \|\|\s*\n\s*demande\.type === "ATTESTATION_SALAIRE" \|\| demande\.type === "PARRAINAGE";/.test(src));
check("v0.2.180/182 intactes : documents transmis à l'employé (envoyerEmailDecisionDocumentsRh)",
  src.indexOf("envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh, cfgMail, formulationAffichee)") > 0);
check("v0.2.184 intacte : notification intermédiaire conditionnée par !sansReponseAutoPdf (jamais parrainage)",
  src.indexOf("if (!sansReponseAutoPdf && importes.length &&") > 0);
check("routage parrainage intact : adresse dédiée parrainageEmail (destinatairePourDemande)",
  src.indexOf("parrainageEmail") > 0);

// ---------------------------------------------------------------------------
section("4. Non-régression congé / autorisation (Task 181)");
// ---------------------------------------------------------------------------
check("bloc v0.2.184 toujours placé AVANT la notification de refus (ordre des branches)",
  src.indexOf('cfgMail, "etape-intermediaire")') <
  src.indexOf("envoyerEmailRefusManagerRh(demande, cfgMail, formulationAffichee)"));
check("notification de refus placée après le bloc décision finale (structure if/else if conservée)",
  src.indexOf('statutApres === "ACCEPTEE" || statutApres === "REFUSEE"') <
  src.indexOf('demande.type !== "PARRAINAGE"'));
check("matrice deux étapes intacte : calculerStatutFinalDeuxEtapes toujours appelée",
  src.indexOf("calculerStatutFinalDeuxEtapes(") > 0);
check("transmission RH après acceptation manager toujours présente (v0.2.171)",
  src.indexOf("transmissionRh = await envoyerEmailTransmissionRh(") > 0);
check("documentation Task 181 conservée (refus immédiat et définitif — information RH)",
  src.indexOf("NOTIFICATION DU SERVICE RH après REFUS DU MANAGER") > 0);

// ---------------------------------------------------------------------------
section("5. Journal de traitement");
// ---------------------------------------------------------------------------
check("champ journal notificationRhRefus conservé (parrainage → « absente »)",
  src.indexOf("notificationRhRefus: notificationRhRefus && notificationRhRefus.envoye ? \"envoyee\"") > 0);
check("champ journal transmissionRh conservé",
  src.indexOf("transmissionRh: transmissionRh && transmissionRh.envoye ? \"envoyee\"") > 0);
check("journal action « demande-refus-manager-rh » conservé dans la fonction",
  src.indexOf('action: "demande-refus-manager-rh"') > 0);

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("RÉSULTAT v0.2.187 : " + ok + " OK / " + fail + " FAIL");
console.log("=".repeat(78));
process.exit(fail ? 1 : 0);
