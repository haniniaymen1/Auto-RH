#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.188 — REFUS (CONGÉ / AUTORISATION) : AUCUN PDF DE REFUS —
 * NOTIFICATION E-MAIL SANS PDF AVEC LES PIÈCES JOINTES DES DÉCIDEURS
 * ============================================================================
 * Demande utilisateur : « Pour les demandes de congé et d'autorisation, lorsque
 * le manager et/ou le service RH refuse la demande, ne pas générer ni envoyer
 * automatiquement de PDF de réponse de refus. À la place, le système doit
 * uniquement transmettre à l'employé, par e-mail de notification, les pièces
 * jointes ajoutées par le manager et/ou le service RH lors de leur réponse.
 * Si les deux intervenants ajoutent des pièces jointes, transmettre l'ensemble
 * des fichiers concernés à l'employé dans le mail de notification. Conserver
 * le statut final de la demande comme « Refusée » et les pièces jointes
 * envoyées par le manager et les RH dans le portail employé. Ne pas modifier
 * le fonctionnement des autres types de demandes. »
 *
 * Changements (v0.2.188) :
 *   - scripts/portail-server.js : la génération du document signé n'est plus
 *     déclenchée QUE pour une ACCEPTATION (congé / autorisation) — l'appel à
 *     traiterDocumentRefusDecision est SUPPRIMÉ de la voie automatique ; sur
 *     REFUS, docFinal = null → envoyerEmailDecisionConge reçoit
 *     pieceJointe = null : l'e-mail de notification de refus part SANS PDF,
 *     avec TOUTES les pièces jointes des décideurs (piecesReponses —
 *     mécanisme v0.2.171 conservé : réponse courante + antérieures, cumulées
 *     et dédupliquées) ;
 *   - ACCEPTATION congé/autorisation : PDF signé CONSERVÉ (v0.2.168) ;
 *   - attestations / parrainage : v0.2.179/180/182 strictement inchangées
 *     (aucune réponse automatique PDF) ;
 *   - parrainage : v0.2.187 conservée (aucune notification de refus RH) ;
 *   - portail employé : statut « Refusée » (v0.2.185) et pièces jointes
 *     visibles (v0.2.184) — inchangés ;
 *   - interface d'administration (reponse-pdf-panel.tsx) : description mise à
 *     jour (PDF sur ACCEPTATION ; refus → notification e-mail sans PDF).
 *
 * Ce test vérifie STATIQUEMENT les deux fichiers modifiés (conditions,
 * point d'appel supprimé, journal, panneau) et SIMULE la logique de la
 * condition de génération et du champ de journal pdfRefusDesactive.
 * Sortie : nombre de contrôles OK / FAIL ; code de sortie 1 si un FAIL.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const SRC = path.join(RACINE, "scripts/portail-server.js");
const PANEL = path.join(RACINE, "src/components/payslip/reponse-pdf-panel.tsx");

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

const src = fs.readFileSync(SRC, "utf8");
const panel = fs.readFileSync(PANEL, "utf8");

/* ========================================================================== */
console.log("\n=== TEST v0.2.188 — refus congé/autorisation : aucun PDF, notification avec pièces jointes ===");

// ---------------------------------------------------------------------------
section("1. Génération du document signé limitée à l'ACCEPTATION (sources)");
// ---------------------------------------------------------------------------
check("nouvelle condition : statutApres === \"ACCEPTEE\" SEUL dans le bloc docFinal",
  /if \(decisionApplicable && !sansReponseAutoPdf && statutApres === "ACCEPTEE"\) \{/.test(src));
check("ancienne condition ABSENTE : « (statutApres === \"ACCEPTEE\" || statutApres === \"REFUSEE\")\" ne précède plus declencheurDoc",
  src.indexOf('(statutApres === "ACCEPTEE" || statutApres === "REFUSEE")) {\n    const declencheurDoc') < 0);
check("traiterDocumentRefusDecision : AUCUN appel automatique restant (await ... demande.id)",
  (src.match(/await traiterDocumentRefusDecision\(/g) || []).length === 0);
check("traiterDocumentRefusDecision : la définition reste (fonction conservée, point d'appel supprimé)",
  src.indexOf("async function traiterDocumentRefusDecision(demandeId, declencheur, opts) {") > 0);
check("traiterDocumentSigneAcceptation : appel ACCEPTATION CONSERVÉ (v0.2.168 inchangée)",
  src.indexOf("await traiterDocumentSigneAcceptation(demande.id, declencheurDoc, { sansEmail: true })") > 0);
check("declencheurDoc simplifié (acceptation uniquement — plus de branche refus)",
  src.indexOf('const declencheurDoc = "Validation à deux étapes complète (réponse e-mail " +') > 0 &&
  src.indexOf('(refus reconnu)";') < 0);
check("commentaire v0.2.188 « REFUS (congé / autorisation) : AUCUN PDF de refus n'est plus GÉNÉRÉ ni ENVOYÉ » présent",
  src.indexOf("REFUS (congé /\n  // autorisation) : AUCUN PDF de refus n'est plus GÉNÉRÉ ni ENVOYÉ") > 0);
check("commentaire v0.2.188 « le document signé n'est généré QUE pour une ACCEPTATION » présent",
  src.indexOf("le document signé n'est généré\n  // QUE pour une ACCEPTATION") > 0);
check("docFinal typé « acceptation » seul (genre: \"acceptation\")",
  src.indexOf('let docFinal = null; // { genre: "acceptation", resultat, pieceJointe }') > 0);

// ---------------------------------------------------------------------------
section("2. SIMULATION de la condition de génération (extraite du source)");
// ---------------------------------------------------------------------------
const mDoc = src.match(/if \(decisionApplicable && !sansReponseAutoPdf && statutApres === "ACCEPTEE"\)/);
check("motif de la condition extractible", Boolean(mDoc));
let fnDoc = null;
try {
  const inner = mDoc ? mDoc[0].replace(/^if \(/, "").replace(/\)$/, "") : "";
  fnDoc = new Function("decisionApplicable", "sansReponseAutoPdf", "statutApres", "return " + inner + ";");
} catch (e) { fnDoc = null; }
check("fonction de condition construite", Boolean(fnDoc));
if (fnDoc) {
  check("SIMULATION — CONGE ACCEPTÉ → PDF signé GÉNÉRÉ (inchangé)",
    fnDoc(true, false, "ACCEPTEE") === true);
  check("SIMULATION — CONGE REFUSÉ (manager) → AUCUN PDF de refus",
    fnDoc(true, false, "REFUSEE") === false);
  check("SIMULATION — AUTORISATION_SORTIE REFUSÉE (RH) → AUCUN PDF de refus",
    fnDoc(true, false, "REFUSEE") === false);
  check("SIMULATION — ATTESTATION_TRAVAIL ACCEPTÉE → jamais de PDF (v0.2.179 conservée)",
    fnDoc(true, true, "ACCEPTEE") === false);
  check("SIMULATION — PARRAINAGE REFUSÉ → jamais de PDF (v0.2.179 conservée)",
    fnDoc(true, true, "REFUSEE") === false);
  check("SIMULATION — décision non applicable (réponse tardive) → jamais de PDF",
    fnDoc(false, false, "ACCEPTEE") === false);
}

// ---------------------------------------------------------------------------
section("3. Notification de refus SANS PDF + pièces jointes des décideurs");
// ---------------------------------------------------------------------------
check("branche décision finale intacte : ACCEPTEE || REFUSEE → envoyerEmailDecisionConge",
  /} else if \(statutApres === "ACCEPTEE" \|\| statutApres === "REFUSEE"\) \{/.test(src));
check("pieceJointe = docFinal.pieceJointe (null sur REFUS → e-mail SANS PDF)",
  src.indexOf("pieceJointe: docFinal && docFinal.pieceJointe ? docFinal.pieceJointe : null,") > 0);
check("piecesReponses = piecesReponsesEmploye (pièces jointes des décideurs transportées)",
  src.indexOf("piecesReponses: piecesReponsesEmploye,") > 0);
check("collecte v0.2.171 conservée : piecesJointesReponsesPourEmploye(demande, importes)",
  src.indexOf("piecesReponsesEmploye = await piecesJointesReponsesPourEmploye(demande, importes);") > 0);
check("trace console v0.2.188 « AUCUN PDF de refus généré ni envoyé » présente",
  src.indexOf("AUCUN PDF de refus généré ni envoyé (v0.2.188)") > 0);
check("trace console : nombre de pièces jointes transportées affiché",
  src.indexOf("pièce(s) jointe(s) du manager/RH (") > 0);
check("e-mail de décision : bloc « document officiel » conditionné par pjMessage (texte adapté sans PDF — variable par groupe v0.2.193)",
  src.indexOf('"Le document officiel signé électroniquement est JOINT à cet e-mail :"') > 0 &&
  /\.\.\.\(pjMessage \? \[/.test(src));
check("e-mail de décision : l'encadré HTML « Document officiel joint » conditionné par pjMessage",
  /\(pjMessage\s*\n\s*\? '<div style="background:#eff6ff/.test(src));
check("en-tête envoyerEmailDecisionConge documente la règle v0.2.188 (PDF sur acceptation uniquement)",
  src.indexOf("la pièce jointe PDF n'est plus\n  // fournie QUE pour une ACCEPTATION") > 0);
check("notification de refus TOUJOURS envoyée à TOUS les destinataires (MODIFIÉ v0.2.193 — ccDecision historique sans interrupteur)",
  src.indexOf("if (rhAdresse) liste.push(rhAdresse);") > 0 &&
  src.indexOf("if (destAttendu && destAttendu !== rhAdresse && liste.indexOf(destAttendu) < 0) liste.push(destAttendu);") > 0);

// ---------------------------------------------------------------------------
section("4. Journal — nouvelle traçabilité v0.2.188");
// ---------------------------------------------------------------------------
check("champ pdfRefusDesactive présent (« sans_pdf » sur refus congé/autorisation)",
  src.indexOf('pdfRefusDesactive: decisionApplicable && !sansReponseAutoPdf &&') > 0);
check("champ piecesJointesNotificationRefus présent (pièces transportées par la notification de refus)",
  src.indexOf("piecesJointesNotificationRefus:") > 0);
const mJournal = src.match(/pdfRefusDesactive: decisionApplicable && !sansReponseAutoPdf &&\s*\n\s*statutApres === "REFUSEE" \? "sans_pdf" : null,/);
check("expression du champ extractible", Boolean(mJournal));
if (mJournal) {
  const fnJ = new Function("decisionApplicable", "sansReponseAutoPdf", "statutApres",
    "return decisionApplicable && !sansReponseAutoPdf && statutApres === 'REFUSEE' ? 'sans_pdf' : null;");
  check("SIMULATION — CONGE REFUSÉ → journal pdfRefusDesactive = « sans_pdf »", fnJ(true, false, "REFUSEE") === "sans_pdf");
  check("SIMULATION — CONGE ACCEPTÉ → journal null (PDF signé normal)", fnJ(true, false, "ACCEPTEE") === null);
  check("SIMULATION — PARRAINAGE REFUSÉ → journal null (règle v0.2.179, pas cette règle)", fnJ(true, true, "REFUSEE") === null);
}

// ---------------------------------------------------------------------------
section("5. Panneau d'administration — description mise à jour");
// ---------------------------------------------------------------------------
check("description : « Après chaque ACCEPTATION d'une demande » (plus « (ou refus) »)",
  panel.indexOf("Après chaque ACCEPTATION d&apos;une demande") > 0 &&
  panel.indexOf("(ou refus)") < 0);
check("description : mention v0.2.188 « AUCUN PDF de refus n&apos;est généré ni envoyé »",
  panel.indexOf("(v0.2.188) En cas de REFUS d&apos;une demande de congé ou d&apos;autorisation de sortie, AUCUN PDF de") > 0);
check("description : « e-mail de notification de refus SANS PDF » mentionné",
  panel.indexOf("e-mail de notification de refus SANS PDF") > 0);
check("description : pièces jointes « visibles également dans « Mes demandes » » mentionné",
  panel.indexOf("visibles également") > 0);
check("interrupteur : précision « refus congé/autorisation : notification e-mail sans PDF, v0.2.188 »",
  panel.indexOf("refus congé/autorisation : notification e-mail sans PDF, v0.2.188") > 0);
check("v0.2.186 conservée : prop masquerCertificat + garde {!masquerCertificat && (",
  panel.indexOf("masquerCertificat = false,") > 0 && panel.indexOf("{!masquerCertificat && (") > 0);
check("titre de section inchangé : « Réponse automatique PDF par e-mail (congé / autorisation) »",
  panel.indexOf("Réponse automatique PDF par e-mail (congé / autorisation)") > 0);

// ---------------------------------------------------------------------------
section("6. Non-régression — règles antérieures strictement conservées");
// ---------------------------------------------------------------------------
check("v0.2.179 intacte : sansReponseAutoPdf (attestations + parrainage) inchangée",
  /const sansReponseAutoPdf = demande\.type === "ATTESTATION_TRAVAIL" \|\|\s*\n\s*demande\.type === "ATTESTATION_SALAIRE" \|\| demande\.type === "PARRAINAGE";/.test(src));
check("v0.2.180 intacte : envoyerEmailDecisionDocumentsRh (documents RH sans PDF)",
  src.indexOf("envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh, cfgMail, formulationAffichee)") > 0);
check("v0.2.184 intacte : notification intermédiaire conditionnée par !sansReponseAutoPdf",
  src.indexOf("if (!sansReponseAutoPdf && importes.length &&") > 0);
check("v0.2.185 intacte : libelleStatutFinalDemande (affichage « Refusée ») toujours utilisé",
  src.indexOf("libelleStatutFinalDemande(statutApres, refuseePar)") > 0);
check("v0.2.187 intacte : exclusion PARRAINAGE de la notification de refus RH",
  /if \(roleReponse === "manager" && !validation && demande\.type !== "PARRAINAGE"\) \{/.test(src));
check("matrice deux étapes intacte : calculerStatutFinalDeuxEtapes toujours appelée",
  src.indexOf("calculerStatutFinalDeuxEtapes(") > 0);
check("transmission RH après acceptation manager toujours présente (Task 181)",
  src.indexOf("transmissionRh = await envoyerEmailTransmissionRh(") > 0);
check("reponseAutoPdf (v0.2.179) journalisée inchangée",
  src.indexOf('reponseAutoPdf: decisionApplicable && sansReponseAutoPdf &&') > 0);
check("v0.2.171 intacte : déduplication des noms de pièces jointes (suffixe « -2 »)",
  src.indexOf('nom = base + "-" + n + ext;') > 0);

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("RÉSULTAT v0.2.188 : " + ok + " OK / " + fail + " FAIL");
console.log("=".repeat(78));
if (fail > 0) process.exit(1);
console.log("Tous les contrôles sont passés — refus congé/autorisation SANS PDF,");
console.log("notification e-mail avec pièces jointes des décideurs, autres règles intactes.");
