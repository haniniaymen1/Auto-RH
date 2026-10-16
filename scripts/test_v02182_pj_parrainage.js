#!/usr/bin/env node
/**
 * ============================================================================
 * v0.2.182 — DEMANDE UTILISATEUR : GESTION DES PIÈCES JOINTES POUR LES
 * DEMANDES DE PARRAINAGE (transmission à l'employé avec la décision finale)
 *
 *   « Est-ce que le même principe peut être appliqué aux demandes de
 *    parrainage ? Pour les demandes de parrainage, le responsable concerné
 *    peut-il joindre des documents à sa décision finale, afin que l'employé
 *    les reçoive directement avec la réponse ? »
 *
 * Conformité attendue de scripts/portail-server.js :
 *   §1  le mécanisme v0.2.180 couvre le PARRAINAGE (garde sansReponseAutoPdf
 *       + agrégation des pièces + envoi conditionné à leur présence) ;
 *   §2  le chemin parrainage DÉDIÉ aboutit à ce mécanisme : réponse du
 *       destinataire de la boîte dédiée → rôle « manager » → branche
 *       PARRAINAGE (décision unique) → bloc de notification commun ;
 *   §3  envoyerEmailDecisionDocumentsRh : formulation adaptée au parrainage
 *       (« le responsable de votre demande ») — attestations inchangées
 *       (« le service RH ») ;
 *   §4  envoyerEmailDocumentDisponible (documents reçus SANS décision) :
 *       même adaptation parrainage, autres types inchangés ;
 *   §5  garde-fous conservés : AUCUN PDF auto (v0.2.179), AUCUN e-mail sans
 *       pièce jointe, notifications marquées SYSTÈME (Garde 2), journal
 *       documentsRhTransmis + reponseAutoPdf="desactivee" ;
 *   §6  non-régression : congé/autorisation (PDF signé + PJs v0.2.171),
 *       classification des expressions (v0.2.178/181) intacte ;
 *   §7  simulation : condition sansReponseAutoPdf exécutée pour les 5 types +
 *       formulations (auteur des documents) exécutées pour les 2 contextes.
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
function extraireFonction(source, nomFonction) {
  const debut = source.indexOf("async function " + nomFonction + "(");
  if (debut < 0) return null;
  let profondeur = 0, i = source.indexOf("{", debut);
  for (; i < source.length; i++) {
    if (source[i] === "{") profondeur++;
    else if (source[i] === "}") { profondeur--; if (profondeur === 0) break; }
  }
  return source.slice(debut, i + 1);
}

console.log("=== v0.2.182 — pièces jointes du responsable (parrainage) transmises à l'employé ===\n");

// ---- §1 couverture mécanique v0.2.180 pour le parrainage ----
console.log("§1 Le mécanisme « documents joints à la décision » couvre le PARRAINAGE :");
const mDef = portail.match(
  /const\s+sansReponseAutoPdf\s*=\s*demande\.type\s*===\s*"([A-Z_]+)"\s*\|\|\s*\n?\s*demande\.type\s*===\s*"([A-Z_]+)"\s*\|\|\s*\n?\s*demande\.type\s*===\s*"([A-Z_]+)"/
);
verif("garde sansReponseAutoPdf présent", !!mDef);
if (mDef) {
  const couverts = [mDef[1], mDef[2], mDef[3]].sort();
  verif("couvre ATTESTATION_SALAIRE, ATTESTATION_TRAVAIL, PARRAINAGE",
    JSON.stringify(couverts) === JSON.stringify(["ATTESTATION_SALAIRE", "ATTESTATION_TRAVAIL", "PARRAINAGE"]),
    "trouvé : " + couverts.join(", "));
}
const mBranche = portail.match(
  /if\s*\(sansReponseAutoPdf\s*&&\s*\(statutApres\s*===\s*"ACCEPTEE"\s*\|\|\s*statutApres\s*===\s*"REFUSEE"\)\)\s*\{([\s\S]*?)\n    \} else if \(statutApres === "ACCEPTEE"/
);
verif("branche décision+documents présente (sansReponseAutoPdf)", !!mBranche);
if (mBranche) {
  const b = mBranche[1];
  verif("agrégation des pièces (réponse courante + antérieures)",
    b.includes("piecesJointesReponsesPourEmploye(demande, importes)"));
  verif("envoi UNIQUEMENT si pièces jointes (if piecesRh.length)",
    b.includes("if (piecesRh.length) {"));
  verif("envoi de l'e-mail décision + documents (envoyerEmailDecisionDocumentsRh)",
    b.includes("envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh, cfgMail, formulationAffichee)"));
  verif("sans pièce : AUCUN e-mail (v0.2.179 inchangé)",
    b.includes("aucune pièce jointe, aucune réponse envoyée"));
}

// ---- §2 chemin parrainage dédié ----
console.log("\n§2 Chemin parrainage dédié (boîte dédiée → décision unique → transmission) :");
verif("branche PARRAINAGE (décision unique du destinataire de la boîte dédiée) présente",
  /decisionApplicable\s*&&\s*roleReponse\s*===\s*"manager"\s*&&\s*\n?\s*demande\.type\s*===\s*"PARRAINAGE"/.test(portail));
verif("décision unique enregistrée (decisionManagerPar = Service parrainage)",
  portail.includes('maj.decisionManagerPar = "Service parrainage (réponse e-mail)"'));
verif("refus tracé refuseePar = PARRAINAGE (libellé « Refusée » partout)",
  portail.includes('maj.refuseePar = "PARRAINAGE"'));
verif("rôle par défaut = manager (réponse du destinataire de la boîte dédiée)",
  portail.includes('let roleReponse = "manager"'));
verif("expéditeur = destinataire attendu → aucun garde bloquant (branche PARRAINAGE atteinte)",
  /if\s*\(destAttendu\s*&&\s*exp\s*!==\s*destAttendu\)/.test(portail));
verif("import des pièces jointes de la réponse (recuDe = expéditeur)",
  /recuDe:\s*exp,/.test(portail));
verif("pièces jointes agrégées AVANT l'e-mail de décision+documents",
  portail.indexOf("piecesJointesReponsesPourEmploye(demande, importes)") <
  portail.indexOf("envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh"));
verif("pièces antérieures incluses (aucune pièce perdue)",
  /recuDe:\s*\{\s*contains:\s*"@"\s*\}/.test(portail));

// ---- §3 formulation adaptée (décision + documents) ----
console.log("\n§3 Formulation adaptée au parrainage (envoyerEmailDecisionDocumentsRh) :");
const fDoc = extraireFonction(portail, "envoyerEmailDecisionDocumentsRh");
verif("fonction définie", !!fDoc);
if (fDoc) {
  verif("détection du type PARRAINAGE dans la fonction",
    fDoc.includes('const estParrainage = demande.type === "PARRAINAGE"'));
  verif("parrainage : auteur des documents = « Le responsable de votre demande »",
    fDoc.includes('? "Le responsable de votre demande"'));
  verif("attestations : auteur conservé = « Le service RH »",
    fDoc.includes(': "Le service RH";'));
  verif("parrainage : « Votre demande de parrainage a été traitée par le responsable concerné »",
    fDoc.includes("Votre demande de parrainage a été traitée par le responsable concerné"));
  verif("attestations : phrase historique conservée (service RH)",
    fDoc.includes("Votre demande administrative a été traitée par le service RH"));
  verif("l'auteur est injecté dans le CORPS TEXTE de l'e-mail",
    fDoc.includes('auteurDocuments + " vous transmet le(s) document(s) suivant(s) —"'));
  verif("l'auteur est injecté dans le CORPS HTML de l'e-mail",
    fDoc.includes('echappeEmailDemande(auteurDocuments) + " vous transmet le(s) document(s) suivant(s)'));
  verif("pièces jointes attachées à l'e-mail (attachments: pieces)",
    fDoc.includes("attachments: pieces"));
  verif("en-tête système Garde 2 (jamais reclassé comme réponse)",
    fDoc.includes('"X-Auto-RH-Systeme": "decision-documents-rh"'));
}

// ---- §4 formulation adaptée (documents SANS décision) ----
console.log("\n§4 Formulation adaptée au parrainage (envoyerEmailDocumentDisponible) :");
const fDispo = extraireFonction(portail, "envoyerEmailDocumentDisponible");
verif("fonction définie", !!fDispo);
if (fDispo) {
  verif("détection du type PARRAINAGE dans la fonction",
    fDispo.includes('const estParrainageDoc = demande.type === "PARRAINAGE"'));
  verif("parrainage : « Document(s) transmis par le responsable de votre demande »",
    fDispo.includes('? "Document(s) transmis par le responsable de votre demande"'));
  verif("autres types : « Document(s) transmis par le service RH » conservé",
    fDispo.includes(': "Document(s) transmis par le service RH"'));
  verif("parrainage : phrase « traitée par le responsable concerné »",
    fDispo.includes("Votre demande de parrainage a reçu une réponse : elle a été traitée par le responsable concerné."));
  verif("autres types : phrase historique conservée (service RH)",
    fDispo.includes("Votre demande administrative a reçu une réponse : elle a été traitée par le service RH."));
  verif("mention jointe alimentée par le transmetteur adapté",
    fDispo.includes("? transmetteurLabel + \" — JOINT(S) À CET E-MAIL :\""));
  verif("en-tête système Garde 2 (document-disponible)",
    fDispo.includes('"X-Auto-RH-Systeme": "document-disponible"'));
}

// ---- §5 garde-fous conservés ----
console.log("\n§5 Garde-fous conservés (v0.2.179 + v0.2.180) :");
verif("AUCUN PDF auto-généré pour parrainage/attestations (!sansReponseAutoPdf)",
  portail.includes("if (decisionApplicable && !sansReponseAutoPdf &&"));
const nbDocSigne = (portail.match(/await traiterDocumentSigneAcceptation\(/g) || []).length;
const nbDocRefus = (portail.match(/await traiterDocumentRefusDecision\(/g) || []).length;
verif("1 seul appel de chaque moteur de PDF (dans le bloc protégé)", nbDocSigne === 1 && nbDocRefus === 1);
verif("trace journal reponseAutoPdf = « desactivee » conservée",
  /reponseAutoPdf:\s*decisionApplicable && sansReponseAutoPdf/.test(portail));
verif("trace journal documentsRhTransmis conservée",
  /documentsRhTransmis:\s*notification && Array\.isArray\(notification\.documents\)/.test(portail));
verif("action dédiée demande-decision-documents-rh conservée",
  portail.includes('action: "demande-decision-documents-rh"'));

// ---- §6 non-régression ----
console.log("\n§6 Non-régression :");
const nbDecisionConge = (portail.match(/await envoyerEmailDecisionConge\(/g) || []).length;
verif("congé/autorisation : envoi de décision inchangé (1 appel)", nbDecisionConge === 1,
  "trouvés : " + nbDecisionConge);
verif("transfert des PJs v0.2.171 branché sur l'e-mail de décision congé/autorisation",
  portail.indexOf("piecesJointesReponsesPourEmploye(demande, importes)") <
  portail.indexOf("await envoyerEmailDecisionConge("));
const mTypesAuto = portail.match(/TYPES_CLASSIFICATION_AUTO\s*=\s*\[([^\]]*)\]/);
verif("TYPES_CLASSIFICATION_AUTO présent", !!mTypesAuto);
if (mTypesAuto) {
  for (const t of ["ATTESTATION_TRAVAIL", "ATTESTATION_SALAIRE", "PARRAINAGE", "CONGE", "AUTORISATION_SORTIE"]) {
    verif("classification automatique active pour " + t, mTypesAuto[1].includes('"' + t + '"'));
  }
}
const expressions = ["j'accepte votre demande", "d'accord", "hors de question", "je ne peux pas accepter"];
for (const e of expressions) {
  verif("classification : expression « " + e + " » toujours reconnue",
    classif.toLowerCase().includes(e));
}
verif("classification : garde sujet transmission intact",
  classif.includes("REGEX_SUJET_TRANSMISSION") && classif.includes("sujetPorteParticipe"));

// ---- §7 simulation ----
console.log("\n§7 Simulation des conditions extraites du code :");
if (mDef) {
  const sourceCondition = mDef[0].replace(/^const\s+sansReponseAutoPdf\s*=\s*/, "").replace(/;$/, "");
  const fCondition = new Function("demande", "return (" + sourceCondition + ");");
  const attendu = {
    ATTESTATION_TRAVAIL: true,
    ATTESTATION_SALAIRE: true,
    PARRAINAGE: true,
    CONGE: false,
    AUTORISATION_SORTIE: false,
  };
  for (const [type, attend] of Object.entries(attendu)) {
    const obtenu = fCondition({ type });
    verif(type + " → transmission décision+documents active = " + attend, obtenu === attend,
      "obtenu : " + obtenu);
  }
}
if (fDoc) {
  const mAuteur = fDoc.match(
    /const\s+auteurDocuments\s*=\s*estParrainage\s*\n?\s*\?\s*"([^"]+)"\s*\n?\s*:\s*"([^"]+)"/
  );
  verif("ternaire auteur des documents extractible", !!mAuteur);
  if (mAuteur) {
    const fAuteur = new Function("estParrainage", 'return estParrainage ? "' + mAuteur[1] + '" : "' + mAuteur[2] + '";');
    verif("PARRAINAGE → « " + mAuteur[1] + " »", fAuteur(true) === "Le responsable de votre demande",
      "obtenu : " + fAuteur(true));
    verif("ATTESTATION_* → « " + mAuteur[2] + " »", fAuteur(false) === "Le service RH",
      "obtenu : " + fAuteur(false));
  }
}
if (fDispo) {
  // (MODIFIÉ v0.2.184) le ternaire transmetteur est IMBRIQUÉ depuis la v0.2.184
  // (parrainage → étape intermédiaire congé/autorisation → défaut « service RH ») :
  // extraction des TROIS branches, comportement parrainage et défaut INCHANGÉS.
  const mTrans = fDispo.match(
    /const\s+transmetteurLabel\s*=\s*estParrainageDoc\s*\n?\s*\?\s*"([^"]+)"\s*\n?\s*:\s*\(etapeIntermediaire\s*\n?\s*\?\s*"([^"]+)"\s*\n?\s*:\s*"([^"]+)"\)/
  );
  verif("ternaire transmetteur extractible (v0.2.184 : 3 branches)", !!mTrans);
  if (mTrans) {
    const fTrans = new Function("estParrainageDoc", "etapeIntermediaire",
      'return estParrainageDoc ? "' + mTrans[1] + '" : (etapeIntermediaire ? "' + mTrans[2] + '" : "' + mTrans[3] + '");');
    verif("PARRAINAGE → « " + mTrans[1] + " »",
      fTrans(true, false) === "Document(s) transmis par le responsable de votre demande",
      "obtenu : " + fTrans(true, false));
    verif("congé/autorisation ÉTAPE INTERMÉDIAIRE (v0.2.184) → « " + mTrans[2] + " » (neutre)",
      fTrans(false, true) === "Document(s) transmis avec la réponse à votre demande",
      "obtenu : " + fTrans(false, true));
    verif("autres types → « " + mTrans[3] + " »",
      fTrans(false, false) === "Document(s) transmis par le service RH",
      "obtenu : " + fTrans(false, false));
  }
}

// ---- Résumé ----
console.log("\n=== RÉSULTAT : " + ok + " OK / " + ko + " FAIL ===");
process.exit(ko ? 1 : 0);
