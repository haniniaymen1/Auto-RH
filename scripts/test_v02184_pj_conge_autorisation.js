#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.184 — PIÈCES JOINTES DU MANAGER / DES RH AVEC LES RÉPONSES
 * CONGÉ / AUTORISATION DE SORTIE (demande utilisateur du 11/10/2026)
 * ============================================================================
 * Demande : « Lorsque le manager et/ou les RH répond à une demande
 * d'autorisation ou de congé avec des pièces jointes, toutes les pièces
 * jointes existantes doivent être visibles et consultables. Après l'envoi de
 * la réponse, l'employé reçoit automatiquement les pièces jointes avec la
 * réponse automatique. »
 *
 * CE QUI CHANGE (v0.2.184) :
 *   1) PORTAIL EMPLOYÉ — les pièces jointes ne sont PLUS masquées pendant la
 *      validation à deux étapes (le bloc decisionMasquee ne vide plus
 *      documentsVu) : TOUTES les pièces jointes existantes (origine + reçues
 *      avec les réponses du manager et/ou des RH) restent VISIBLES et
 *      CONSULTABLES (Visualiser / Télécharger) à CHAQUE étape. La règle
 *      v0.2.177 reste appliquée à la DÉCISION seule (statut final, décisions
 *      par acteur, commentaire, date/acteur de traitement).
 *   2) ÉTAPE INTERMÉDIAIRE — quand le manager OU les RH répondent avec des
 *      pièces jointes alors que la matrice n'est PAS achevée (statut encore
 *      EN_ATTENTE), l'employé reçoit AUTOMATIQUEMENT les documents avec la
 *      notification neutre « document disponible » (formulation SANS acteur
 *      ni décision, pièce(s) jointe(s) à l'e-mail).
 *   3) DÉCISION FINALE — INCHANGÉ (v0.2.171) : TOUTES les pièces jointes
 *      existantes (courante + antérieures, dédoublonnées) partent avec la
 *      réponse automatique et le PDF signé.
 *
 * Sections :
 *   1. API employé — PJs visibles à toutes les étapes (sources)
 *   2. Bloc décisionMasquee — SIMULATION EXÉCUTÉE (PJs conservées, décision masquée)
 *   3. Étape intermédiaire — déclenchement (sources + SIMULATION EXÉCUTÉE)
 *   4. Formulation neutre « document disponible » (contexte étape-intermediaire)
 *   5. Chemin FINAL inchangé — v0.2.171 (toutes les PJs + PDF signé)
 *   6. Non-régression — gardes v0.2.179/180/181/182 + classification
 *   7. Journal & traçabilité
 *
 * Exécution : node scripts/test_v02184_pj_conge_autorisation.js
 * ============================================================================
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..");
const SRC = path.join(RACINE, "scripts", "portail-server.js");
const SRC_CLASSIF = path.join(RACINE, "scripts", "classification-reponses.js");

const src = fs.readFileSync(SRC, "utf8");
const classif = fs.readFileSync(SRC_CLASSIF, "utf8");

let ok = 0, fails = 0;
function check(nom, cond) {
  if (cond) { ok++; console.log("  [OK] " + nom); }
  else { fails++; console.log("  [FAIL] " + nom); }
}
function section(titre) {
  console.log("\n=== " + titre + " ===");
}

// ---------------------------------------------------------------------------
section("1. API employé — pièces jointes VISIBLES à toutes les étapes (sources)");
// ---------------------------------------------------------------------------
// Le bloc decisionMasquee ne vide PLUS documentsVu (v0.2.184).
const iBloc = src.indexOf("if (decisionMasquee) {");
check("bloc decisionMasquee présent dans l'API employé", iBloc > 0);
const jBloc = src.indexOf("\n        }", iBloc);
const blocMasque = iBloc > 0 && jBloc > iBloc ? src.slice(iBloc, jBloc) : "";
check("bloc decisionMasquee NE vide PLUS documentsVu (aucun « documentsVu = [] »)",
  blocMasque.length > 0 && blocMasque.indexOf("documentsVu = []") < 0);
check("commentaire v0.2.184 « documentsVu est CONSERVÉ » présent",
  blocMasque.indexOf("documentsVu est CONSERVÉ") >= 0);
// La décision SEULE reste masquée (règle v0.2.177 strictement conservée).
check("statut final toujours masqué pendant l'attente (statutVu = EN_ATTENTE)",
  blocMasque.indexOf('statutVu = "EN_ATTENTE"') >= 0);
check("décision manager toujours masquée (decisionManagerVu = null)",
  blocMasque.indexOf("decisionManagerVu = null") >= 0);
check("décision RH toujours masquée (decisionRhVu = null)",
  blocMasque.indexOf("decisionRhVu = null") >= 0);
check("commentaire de traitement toujours masqué (commentaireVu = \"\")",
  blocMasque.indexOf('commentaireVu = "";') >= 0);
check("date/acteur de traitement toujours masqués (traiteParVu/traiteLeVu = null)",
  blocMasque.indexOf("traiteParVu = null") >= 0 && blocMasque.indexOf("traiteLeVu = null") >= 0);
check("garde v0.2.177 inchangée (deuxEtapesDem && statut EN_ATTENTE)",
  src.indexOf('const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";') > 0);
check("liste documents employé inclut recuDe (expéditeur affiché)",
  src.indexOf("recuDe: doc.recuDe || \"\",") > 0);
check("commentaire HTML « RÉTABLI v0.2.184 » présent (visibles à toutes les étapes)",
  src.indexOf("(RÉTABLI v0.2.184 — demande utilisateur)") > 0);

// ---------------------------------------------------------------------------
section("2. Bloc décisionMasquee — SIMULATION EXÉCUTÉE (PJs conservées, décision masquée)");
// ---------------------------------------------------------------------------
try {
  const corps = blocMasque.slice("if (decisionMasquee) {".length);
  const prelude = `
    let statutVu = "ACCEPTEE", statutLibelleVu = "Acceptée";
    let decisionManagerVu = "ACCEPTEE", decisionManagerLibVu = "Acceptée";
    let decisionRhVu = "EN_ATTENTE_RH", decisionRhLibVu = "En attente";
    let traiteParVu = "Manager", traiteLeVu = new Date();
    let commentaireVu = "Acceptée par le manager — transmise automatiquement au service RH";
    const documentsVu = [
      { id: "doc1", nomFichier: "certificat-manager.pdf", recuDe: "manager@entreprise.tn" },
      { id: "doc2", nomFichier: "justificatif-rh.pdf", recuDe: "rh@entreprise.tn" },
      { id: "doc3", nomFichier: "piece-origine-employe.pdf", recuDe: "" },
    ];
  `;
  const fn = new Function("decisionMasquee",
    prelude + "if (decisionMasquee) {" + corps + "\n        }" +
    "return { statutVu, statutLibelleVu, decisionManagerVu, decisionRhVu, traiteParVu, commentaireVu, nbDocs: documentsVu.length, docs: documentsVu };");
  const r = fn(true); // congé / autorisation EN_ATTENTE → décision masquée
  check("SIMULATION — statut révélé = « EN_ATTENTE » (décision masquée)",
    r.statutVu === "EN_ATTENTE" && r.statutLibelleVu === "En attente");
  check("SIMULATION — décision manager masquée (null)", r.decisionManagerVu === null);
  check("SIMULATION — décision RH masquée (null)", r.decisionRhVu === null);
  check("SIMULATION — commentaire masqué (vide)", r.commentaireVu === "");
  check("SIMULATION — acteur/date de traitement masqués (null)",
    r.traiteParVu === null);
  check("SIMULATION — TOUTES les pièces jointes CONSERVÉES (3/3 — v0.2.184)",
    r.nbDocs === 3);
  check("SIMULATION — PJs des deux décideurs présentes (manager + RH)",
    r.docs.some(function (d) { return d.recuDe === "manager@entreprise.tn"; }) &&
    r.docs.some(function (d) { return d.recuDe === "rh@entreprise.tn"; }));
  check("SIMULATION — pièce d'origine de l'employé conservée",
    r.docs.some(function (d) { return d.id === "doc3"; }));
  const r2 = fn(false); // statut final → tout révélé
  check("SIMULATION — statut final inchangé (ACCEPTEE révélé)",
    r2.statutVu === "ACCEPTEE" && r2.decisionManagerVu === "ACCEPTEE" && r2.nbDocs === 3);
} catch (e) {
  check("SIMULATION du bloc decisionMasquee exécutée sans erreur : " + e.message, false);
}

// ---------------------------------------------------------------------------
section("3. Étape intermédiaire — notification automatique (sources + SIMULATION)");
// ---------------------------------------------------------------------------
check("bloc v0.2.184 « ÉTAPE INTERMÉDIAIRE » présent (commentaire)",
  src.indexOf("(NOUVEAU v0.2.184 — DEMANDE UTILISATEUR) ÉTAPE INTERMÉDIAIRE") > 0);
const mCond = src.match(/if \(!sansReponseAutoPdf && importes\.length &&\s*\n\s*statutApres !== "ACCEPTEE" && statutApres !== "REFUSEE"\)/);
check("condition d'envoi présente (!sansReponseAutoPdf && importes.length && statut non final)",
  Boolean(mCond));
check("appel envoyerEmailDocumentDisponible avec contexte « etape-intermediaire »",
  src.indexOf('envoyerEmailDocumentDisponible(\n          demande, importes, statutApres, cfgMail, "etape-intermediaire")') > 0 ||
  src.indexOf('"etape-intermediaire")') > 0);
check("marqueur notificationEtapeIntermediaire positionné dans le bloc",
  src.indexOf("notificationEtapeIntermediaire = true;") > 0);
check("bloc placé APRÈS la transmission RH (l'employé ET les RH notifiés)",
  src.indexOf("transmissionRh = await envoyerEmailTransmissionRh(") <
  src.indexOf('cfgMail, "etape-intermediaire")'));
check("bloc placé AVANT la notification de refus manager (ordre des branches)",
  src.indexOf('cfgMail, "etape-intermediaire")') <
  src.indexOf("envoyerEmailRefusManagerRh(demande, cfgMail"));
// SIMULATION de la condition extraite du source
try {
  const inner = mCond ? mCond[0].replace(/^if \(/, "").replace(/\)$/, "") : "";
  const fnCond = new Function("sansReponseAutoPdf", "importes", "statutApres",
    "return " + inner + ";");
  const pjs = [{ nomFichier: "doc-manager.pdf" }];
  check("SIMULATION — congé, manager accepte avec PJs (EN_ATTENTE) → notification envoyée",
    fnCond(false, pjs, "EN_ATTENTE") === true);
  check("SIMULATION — congé, RH accepte en premier avec PJs (EN_ATTENTE) → notification envoyée",
    fnCond(false, pjs, "EN_ATTENTE") === true);
  check("SIMULATION — congé, décision FINALE (ACCEPTEE) → PAS de notification intermédiaire",
    fnCond(false, pjs, "ACCEPTEE") === false);
  check("SIMULATION — congé, refus final (REFUSEE) → PAS de notification intermédiaire",
    fnCond(false, pjs, "REFUSEE") === false);
  check("SIMULATION — attestation/parrainage (sansReponseAutoPdf) → JAMAIS (garde v0.2.179)",
    fnCond(true, pjs, "EN_ATTENTE") === false);
  check("SIMULATION — réponse SANS pièce jointe → aucune notification (falsy)",
    !fnCond(false, [], "EN_ATTENTE"));
} catch (e) {
  check("SIMULATION de la condition exécutée sans erreur : " + e.message, false);
}

// ---------------------------------------------------------------------------
section("4. Formulation NEUTRE « document disponible » (contexte étape-intermediaire)");
// ---------------------------------------------------------------------------
check("signature à 5 paramètres (contexte)",
  src.indexOf("async function envoyerEmailDocumentDisponible(demande, docs, statutApres, cfg, contexte) {") > 0);
check("detection du contexte (« etape-intermediaire »)",
  src.indexOf('const etapeIntermediaire = contexte === "etape-intermediaire";') > 0);
check("libellé neutre « Document(s) transmis avec la réponse à votre demande »",
  src.indexOf('"Document(s) transmis avec la réponse à votre demande"') > 0);
check("phrase neutre « Elle poursuit son circuit de validation habituel. » (aucun acteur, aucune décision)",
  src.indexOf("Elle poursuit son circuit de validation habituel.") > 0);
check("formulation historique « service RH » conservée pour les autres cas",
  src.indexOf('"Document(s) transmis par le service RH"') > 0);
check("formulation parrainage v0.2.182 conservée (prioritaire)",
  src.indexOf('"Document(s) transmis par le responsable de votre demande"') > 0 &&
  src.indexOf("Votre demande de parrainage a reçu une réponse : elle a été traitée par le responsable concerné.") > 0);
check("les documents restent JOINTS à l'e-mail (piecesJointesDepuisDocumentsDemande)",
  src.indexOf("const jointes = piecesJointesDepuisDocumentsDemande(docs);") > 0);
check("statut affiché = libellé du statut (« En attente » à l'étape intermédiaire — neutre)",
  src.indexOf('"  Statut                     : " + statutLabel,') > 0);

// ---------------------------------------------------------------------------
section("5. Chemin FINAL INCHANGÉ — v0.2.171 (toutes les PJs + PDF signé)");
// ---------------------------------------------------------------------------
check("agrégation piecesJointesReponsesPourEmploye AVANT l'e-mail de décision",
  src.indexOf("piecesReponsesEmploye = await piecesJointesReponsesPourEmploye(demande, importes);") > 0);
check("agrégation des réponses ANTÉRIEURES (recuDe contient @)",
  src.indexOf('where: { demandeId: demande.id, recuDe: { contains: "@" } },') > 0);
check("PJs passées à l'e-mail de décision (opts.piecesReponses)",
  src.indexOf("piecesReponses: piecesReponsesEmploye,") > 0);
check("PDF signé joint à la réponse automatique (pieceJointe: docFinal)",
  src.indexOf("pieceJointe: docFinal && docFinal.pieceJointe ? docFinal.pieceJointe : null,") > 0);
check("génération PDF aux statuts FINAUX (MODIFIÉ v0.2.188 : acceptation seule — règle v0.2.188)",
  src.indexOf('if (decisionApplicable && !sansReponseAutoPdf && statutApres === "ACCEPTEE") {') > 0);
check("e-mail de décision : notification TOUJOURS envoyée à TOUS (MODIFIÉ v0.2.193 — ccDecision historique sans interrupteur)",
  src.indexOf("if (rhAdresse) liste.push(rhAdresse);") > 0 &&
  src.indexOf("if (destAttendu && destAttendu !== rhAdresse && liste.indexOf(destAttendu) < 0) liste.push(destAttendu);") > 0);
check("dédoublonnage des noms de fichiers (aucune pièce perdue/écrasée)",
  src.indexOf("const nomsPris = new Set();") > 0 &&
  src.indexOf("while (nomsPris.has(nom.toLowerCase())) {") > 0);
check("transmission RH intermédiaire conservée (documents du manager vers les RH)",
  src.indexOf("transmissionRh = await envoyerEmailTransmissionRh(demande, importes, cfgMail, formulationAffichee);") > 0);

// ---------------------------------------------------------------------------
section("6. Non-régression — gardes v0.2.179 / v0.2.180 / v0.2.181 / v0.2.182");
// ---------------------------------------------------------------------------
check("v0.2.179 — garde sansReponseAutoPdf (attestations + parrainage) intacte",
  src.indexOf('const sansReponseAutoPdf = demande.type === "ATTESTATION_TRAVAIL" ||') > 0 &&
  src.indexOf('demande.type === "ATTESTATION_SALAIRE" || demande.type === "PARRAINAGE";') > 0);
check("v0.2.179 — PDF protégé pour les 3 types (branche désactivée)",
  src.indexOf("réponse automatique PDF DÉSACTIVÉE (v0.2.179)") > 0);
check("v0.2.180 — e-mail décision+documents du RH intact (attestations/parrainage)",
  src.indexOf("async function envoyerEmailDecisionDocumentsRh(") > 0 &&
  src.indexOf("piecesRh = await piecesJointesReponsesPourEmploye(demande, importes);") > 0);
check("v0.2.180 — sans pièce jointe : AUCUN e-mail (règle conservée)",
  src.indexOf("if (piecesRh.length) {") > 0);
check("v0.2.181 — classification des expressions intacte (acceptation/refus/négations)",
  allIn(classif, ['"j accepte"', '"ok"', '"d accord"', '"je valide"', '"je refuse"',
    '"hors de question"', "je ne peux pas accepter", '"delivree"']));
check("v0.2.182 — formulations parrainage intactes (portail)",
  src.indexOf("Votre demande de parrainage a été traitée par le responsable concerné") > 0 &&
  src.indexOf('? "Le responsable de votre demande"') > 0);
check("branche NON-décision conservée (réponse ambiguë → document disponible, sans contexte)",
  src.indexOf("} else if (importes.length) {\n    notification = await envoyerEmailDocumentDisponible(demande, importes, statutApres, cfgMail);") > 0);
check("endpoint documents employé : propriétaire seul (CIN), aucune restriction de statut ajoutée",
  src.indexOf("Accès limité à vos propres documents.") > 0);

// ---------------------------------------------------------------------------
section("7. Journal & traçabilité");
// ---------------------------------------------------------------------------
check("champ journal notificationEtapeIntermediaire (preuve d'envoi à l'étape intermédiaire)",
  src.indexOf("notificationEtapeIntermediaire: notificationEtapeIntermediaire,") > 0);
check("champ journal piecesJointesReponses conservé (v0.2.171)",
  src.indexOf("piecesJointesReponses: notification && Array.isArray(notification.piecesReponses)") > 0);
check("champ journal documentsRhTransmis conservé (v0.2.180)",
  src.indexOf("documentsRhTransmis: notification && Array.isArray(notification.documents)") > 0);
check("champ journal reponseAutoPdf conservé (v0.2.179)",
  src.indexOf("reponseAutoPdf: decisionApplicable && sansReponseAutoPdf") > 0);
check("variable notificationEtapeIntermediaire déclarée (false par défaut)",
  src.indexOf("let notificationEtapeIntermediaire = false;") > 0);

// ---------------------------------------------------------------------------
console.log("\n==============================================");
console.log("RÉSULTAT v0.2.184 : " + ok + " OK / " + fails + " FAIL");
console.log("==============================================");
process.exit(fails ? 1 : 0);

function allIn(texte, mots) {
  return mots.every(function (m) { return texte.indexOf(m) >= 0; });
}
