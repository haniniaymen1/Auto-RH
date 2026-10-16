#!/usr/bin/env node
/**
 * v0.2.181 — PREUVE UNITAIRE : « Pour les demandes d'attestation de travail,
 * d'attestation de salaire et de demande de parrainage, accepter ces
 * expressions » (demande utilisateur du 11/10/2026).
 *
 * LISTE EXACTE DEMANDÉE PAR L'UTILISATEUR :
 *   ACCEPTATION — écrire n'importe laquelle de ces formulations :
 *     « J'accepte votre demande » / « J'accepte »
 *     « OK », « D'accord », « Je valide », « J'approuve », « Je vous accorde »
 *     Le mot seul : « Acceptée », « Validée », « Approuvée », « Accordée »,
 *     « Délivrée »
 *   REFUS :
 *     « Je refuse », « Refus », « Non », « Désaccord », « Pas d'accord »,
 *     « Hors de question »
 *     Le mot seul : « Refusée »
 *     Et les négations naturelles : « Je ne valide pas », « Je n'accepte pas »,
 *     « Je ne peux pas accepter »
 *
 * Chaque expression est testée DANS LE CONTEXTE RÉEL de chaque type de
 * demande (objet « Re: AutoRH — Attestation de travail TRV-… (traitement
 * requis) », etc.), en réponse directe, dans l'OBJET seul, avec citation
 * Gmail de l'e-mail d'origine, et avec les tolérances réelles (casse,
 * accents, ponctuation, apostrophes courbes, texte autour).
 *
 * Sections :
 *   1. Les 12 expressions d'ACCEPTATION (exactes) × 3 types → VALIDATION
 *   2. Les 7 expressions de REFUS + 3 négations (exactes) × 3 types → REFUS
 *   3. Mots seuls dans l'OBJET seul (« Re: … — Acceptée », « Refusée », « OK »,
 *      « D'accord ») → décision (passe 2 : participesSujet v0.2.178)
 *   4. Réponse RÉELLE avec citation Gmail (l'« utile » l'emporte sur la
 *      citation, y compris quand la citation contient les DEUX consignes)
 *   5. Tolérances réelles : casse, accents, ponctuation, apostrophe courbe,
 *      texte autour (salutations / signature)
 *   6. Gardes anti-faux positifs (mots entiers, priorité refus, ambiguïté,
 *      « pas encore » = non décidé)
 *   7. BRANCHEMENT : TYPES_CLASSIFICATION_AUTO couvre les 3 types
 *      (portail-server.js)
 *   8. Garde-fous v0.2.179/v0.2.180 intacts (aucune réponse automatique PDF
 *      pour ces 3 types ; transmission des documents du RH v0.2.180)
 *
 * Aucune base de données : test pur du module + lecture source du serveur.
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const {
  classifierReponse,
  DECISIONS,
  MOTS_CLES_ACCEPTATION,
  MOTS_CLES_REFUS,
  NEGATIONS_REFUS,
  PARTICIPES_ACCEPTATION,
  PARTICIPES_REFUS,
} = require("./classification-reponses.js");

let OK = 0;
let KO = 0;
const echecs = [];
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log("  OK   " + label);
  } else {
    KO++;
    echecs.push(label + (detail ? " — " + detail : ""));
    console.log("  FAIL " + label + (detail ? " — " + detail : ""));
  }
}

// Objets RÉELS des e-mails envoyés par AutoRH (portail-server.js) :
//   création (attestations, parrainage) : « AutoRH — <libellé> <réf> (traitement requis) »
//   réponse du décideur : « Re: … »
const TYPES_TEST = [
  {
    type: "ATTESTATION_TRAVAIL",
    libelle: "Attestation de travail",
    reference: "TRV-2026-00417",
  },
  {
    type: "ATTESTATION_SALAIRE",
    libelle: "Attestation de salaire",
    reference: "SAL-2026-00418",
  },
  {
    type: "PARRAINAGE",
    libelle: "Demande de parrainage",
    reference: "PAR-2026-00419",
  },
];

function sujetReponse(t, suffixe) {
  return "Re: AutoRH — " + t.libelle + " " + t.reference + " (traitement requis)" + (suffixe ? " — " + suffixe : "");
}

/** Citation Gmail réaliste de l'e-mail de création (consigne incluse). */
function citationCreation(t) {
  return [
    "Le ven. 9 oct. 2026 à 09:12, AutoRH <rh3000@zohomail.com> a écrit :",
    "> Bonjour,",
    ">",
    "> Une nouvelle demande administrative nécessite votre traitement.",
    ">",
    ">   Référence unique           : " + t.reference,
    ">   Type de demande            : " + t.libelle,
    ">   Employé                    : Ben Salah Mohamed (CIN •••233)",
    ">   Date de la demande         : 09/10/2026 09:12",
    ">   Statut                     : En attente",
    ">",
    "> VALIDATION PAR E-MAIL : répondez directement à cet e-mail (« Répondre »)",
    "> en écrivant « Acceptée » pour VALIDER la demande, ou « Refusée » pour la",
    "> refuser. Votre réponse est rattachée automatiquement à la référence",
    "> " + t.reference + " — aucune autre manipulation nécessaire.",
  ].join("\n");
}

/** Citation Gmail réaliste du corps de TRANSMISSION (liste les DEUX consignes). */
function citationTransmission() {
  return [
    "Le ven. 9 oct. 2026 à 09:14, AutoRH <rh3000@zohomail.com> a écrit :",
    "> Bonjour,",
    ">",
    "> Traitez cette demande depuis l'administration (onglet Demandes) ou",
    "> répondez directement à CET E-MAIL (Répondre — ne pas modifier l'objet) :",
    ">   ACCEPTER  : « Congé accepté », « Je valide », « J'accorde », « D'accord », « OK »",
    ">   REFUSER   : « Congé refusé », « Je refuse », « Désaccord », « NON », « Refus »",
  ].join("\n");
}

// ============================================================================
console.log("=== v0.2.181 — Expressions d'acceptation / de refus pour attestations (travail / salaire) et parrainage ===\n");

// ---------------------------------------------------------------------------
console.log("=== 1) Les 12 expressions d'ACCEPTATION demandées (exactes) × 3 types ===");
const ACCEPTATIONS_DEMANDEES = [
  "J'accepte votre demande",
  "J'accepte",
  "OK",
  "D'accord",
  "Je valide",
  "J'approuve",
  "Je vous accorde",
  // mots seuls (participes — consigne officielle de l'e-mail)
  "Acceptée",
  "Validée",
  "Approuvée",
  "Accordée",
  "Délivrée",
];
for (const t of TYPES_TEST) {
  for (const f of ACCEPTATIONS_DEMANDEES) {
    const r = classifierReponse(sujetReponse(t), f);
    check(
      "[" + t.type + "] « " + f + " » (corps) → VALIDATION",
      r.decision === DECISIONS.VALIDATION,
      "reçu " + r.decision + " " + JSON.stringify(r.formulations)
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 2) Les 7 expressions de REFUS + 3 négations demandées (exactes) × 3 types ===");
const REFUS_DEMANDES = [
  "Je refuse",
  "Refus",
  "Non",
  "Désaccord",
  "Pas d'accord",
  "Hors de question",
  "Refusée",
];
const NEGATIONS_DEMANDEES = [
  "Je ne valide pas",
  "Je n'accepte pas",
  "Je ne peux pas accepter",
];
for (const t of TYPES_TEST) {
  for (const f of REFUS_DEMANDES) {
    const r = classifierReponse(sujetReponse(t), f);
    check(
      "[" + t.type + "] « " + f + " » (corps) → REFUS",
      r.decision === DECISIONS.REFUS,
      "reçu " + r.decision + " " + JSON.stringify(r.formulations)
    );
  }
  for (const f of NEGATIONS_DEMANDEES) {
    const r = classifierReponse(sujetReponse(t), f + " cette demande.");
    check(
      "[" + t.type + "] « " + f + " » (négation naturelle) → REFUS",
      r.decision === DECISIONS.REFUS,
      "reçu " + r.decision + " " + JSON.stringify(r.formulations)
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 3) Mots seuls dans l'OBJET seul (réponse Gmail « Re: … ») ===");
for (const t of TYPES_TEST) {
  for (const mot of ["Acceptée", "Validée", "Approuvée", "Accordée", "Délivrée"]) {
    const r = classifierReponse(sujetReponse(t, mot), "");
    check(
      "[" + t.type + "] objet seul « … — " + mot + " » → VALIDATION",
      r.decision === DECISIONS.VALIDATION,
      "reçu " + r.decision
    );
  }
  const rr = classifierReponse(sujetReponse(t, "Refusée"), "");
  check("[" + t.type + "] objet seul « … — Refusée » → REFUS", rr.decision === DECISIONS.REFUS, "reçu " + rr.decision);
  const rok = classifierReponse(sujetReponse(t, "OK"), "");
  check("[" + t.type + "] objet seul « … — OK » → VALIDATION", rok.decision === DECISIONS.VALIDATION, "reçu " + rok.decision);
  const rdac = classifierReponse(sujetReponse(t, "D'accord"), "");
  check("[" + t.type + "] objet seul « … — D'accord » → VALIDATION", rdac.decision === DECISIONS.VALIDATION, "reçu " + rdac.decision);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4) Réponse RÉELLE avec citation Gmail (l'utile l'emporte) ===");
for (const t of TYPES_TEST) {
  // réponse + citation de l'e-mail de CRÉATION (contient « Acceptée » ET
  // « Refusée » dans la consigne — le passe 2 ne classe QUE les mots du
  // décideur, la citation est écartée)
  const r1 = classifierReponse(sujetReponse(t), "J'accepte votre demande.\n\nCordialement,\nManager\n\n" + citationCreation(t));
  check("[" + t.type + "] « J'accepte votre demande » + citation création → VALIDATION", r1.decision === DECISIONS.VALIDATION, "reçu " + r1.decision);
  const r2 = classifierReponse(sujetReponse(t), "Refusée\n\n" + citationCreation(t));
  check("[" + t.type + "] « Refusée » + citation création → REFUS", r2.decision === DECISIONS.REFUS, "reçu " + r2.decision);
  // réponse courte + citation du corps de TRANSMISSION (contient les DEUX
  // listes ACCEPTER/REFUSER → passe 1 AMBIGUE, passe 2 sur l'utile décide)
  const r3 = classifierReponse(sujetReponse(t), "OK\n\n" + citationTransmission());
  check("[" + t.type + "] « OK » + citation transmission (2 listes) → VALIDATION", r3.decision === DECISIONS.VALIDATION, "reçu " + r3.decision);
  const r4 = classifierReponse(sujetReponse(t), "Je refuse\n\n" + citationTransmission());
  check("[" + t.type + "] « Je refuse » + citation transmission (2 listes) → REFUS", r4.decision === DECISIONS.REFUS, "reçu " + r4.decision);
  const r5 = classifierReponse(sujetReponse(t), "D'accord\n\n" + citationTransmission());
  check("[" + t.type + "] « D'accord » + citation transmission (2 listes) → VALIDATION", r5.decision === DECISIONS.VALIDATION, "reçu " + r5.decision);
  const r6 = classifierReponse(sujetReponse(t), "Non\n\n" + citationTransmission());
  check("[" + t.type + "] « Non » + citation transmission (2 listes) → REFUS", r6.decision === DECISIONS.REFUS, "reçu " + r6.decision);
}

// ---------------------------------------------------------------------------
console.log("\n=== 5) Tolérances réelles (casse, accents, ponctuation, apostrophes, texte autour) ===");
{
  const t = TYPES_TEST[0];
  const cas = [
    ["J'ACCEPTE VOTRE DEMANDE", DECISIONS.VALIDATION],
    ["j’accepte", DECISIONS.VALIDATION],                    // apostrophe courbe U+2019
    ["ok !", DECISIONS.VALIDATION],                          // ponctuation
    ["D’ACCORD", DECISIONS.VALIDATION],                      // apostrophe courbe + majuscules
    ["Je VALIDE", DECISIONS.VALIDATION],                     // casse mélangée
    ["je vous accorde.", DECISIONS.VALIDATION],              // point final
    ["Delivree", DECISIONS.VALIDATION],                      // sans accents
    ["Accordée !", DECISIONS.VALIDATION],
    ["Bonjour,\n\nValidée — bonne continuation.\n\nAuto-RH", DECISIONS.VALIDATION],
    ["HORS DE QUESTION", DECISIONS.REFUS],
    ["Je NE valide PAS cette demande", DECISIONS.REFUS],
    ["Désaccord total avec cette demande", DECISIONS.REFUS],
    ["je ne peux pas accepter", DECISIONS.REFUS],
  ];
  for (const [texte, attendu] of cas) {
    const r = classifierReponse(sujetReponse(t), texte);
    check("« " + texte.replace(/\n/g, " / ") + " » → " + attendu, r.decision === attendu, "reçu " + r.decision);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 6) Gardes anti-faux positifs (mots entiers, priorité refus, ambiguïté) ===");
{
  const t = TYPES_TEST[0];
  const gardes = [
    ["Notification de traitement envoyée", DECISIONS.NON_RECONNU, "« notification » ≠ « Non »"],
    ["Okapi du zoo", DECISIONS.NON_RECONNU, "« okapi » ≠ « OK »"],
    ["La demande n'a pas encore été validée", DECISIONS.NON_RECONNU, "« pas encore » = non décidé"],
    ["Je suis pas d'accord avec ce motif, désolé", DECISIONS.REFUS, "« pas d'accord » = refus (jamais une validation via « d accord »)"],
    ["J'accepte la demande", DECISIONS.VALIDATION, "acceptation simple"],
  ];
  for (const [texte, attendu, pourquoi] of gardes) {
    const r = classifierReponse(sujetReponse(t), texte);
    check(pourquoi + " → " + attendu, r.decision === attendu, "reçu " + r.decision);
  }
  // ambiguïté : acceptation ET refus dans les MÊMES mots du décideur →
  // AUCUNE décision automatique (la demande reste « En attente »)
  const amb = classifierReponse(sujetReponse(t), "J'accepte... non, finalement je refuse.");
  check("acceptation + refus mélangés → AMBIGUE (aucune décision)", amb.decision === DECISIONS.AMBIGUE, "reçu " + amb.decision);
  // le mot « Refus » ne matche pas « Refusée » (mots entiers distincts)
  check("MOTS_CLES_REFUS contient « refus » et « non » et « hors de question »",
    MOTS_CLES_REFUS.indexOf("refus") >= 0 && MOTS_CLES_REFUS.indexOf("non") >= 0 && MOTS_CLES_REFUS.indexOf("hors de question") >= 0,
    JSON.stringify(MOTS_CLES_REFUS));
  check("MOTS_CLES_ACCEPTATION contient « ok », « j accepte », « je valide », « d accord », « j approuve », « je vous accorde »",
    ["ok", "j accepte", "je valide", "d accord", "j approuve", "je vous accorde"].every(function (m) {
      return MOTS_CLES_ACCEPTATION.indexOf(m) >= 0;
    }), JSON.stringify(MOTS_CLES_ACCEPTATION));
  check("NÉGATIONS : « je ne valide pas », « je n accepte pas », « je ne peux pas accepter » reconnues",
    ["je ne valide pas", "je n accepte pas", "je ne peux pas accepter"].every(function (n) {
      return NEGATIONS_REFUS.some(function (x) { return x.normalise === n; });
    }), JSON.stringify(NEGATIONS_REFUS.map(function (x) { return x.normalise; })));
  check("PARTICIPES (mots seuls) : Acceptée/Validée/Approuvée/Accordée/Délivrée + Refusée",
    ["acceptee", "validee", "approuvee", "accordee", "delivree"].every(function (p) {
      return PARTICIPES_ACCEPTATION.indexOf(p) >= 0;
    }) && PARTICIPES_REFUS.indexOf("refusee") >= 0,
    JSON.stringify({ acc: PARTICIPES_ACCEPTATION, ref: PARTICIPES_REFUS }));
}

// ---------------------------------------------------------------------------
console.log("\n=== 7) BRANCHEMENT : classification active pour les 3 types (portail-server.js) ===");
{
  const src = fs.readFileSync(__dirname + "/portail-server.js", "utf8");
  const idx = src.indexOf("const TYPES_CLASSIFICATION_AUTO = [");
  check("TYPES_CLASSIFICATION_AUTO trouvé dans portail-server.js", idx > 0);
  const bloc = src.slice(idx, src.indexOf("];", idx) + 2);
  for (const tp of ["ATTESTATION_TRAVAIL", "ATTESTATION_SALAIRE", "PARRAINAGE"]) {
    check("TYPES_CLASSIFICATION_AUTO inclut " + tp, bloc.indexOf('"' + tp + '"') >= 0, bloc.replace(/\s+/g, " ").slice(0, 120));
  }
  // la classification s'applique à la réponse du destinataire, SANS pièce jointe
  check("Réponse SANS pièce jointe + décision reconnue = traitée (code Task 178 présent)",
    src.indexOf("classificationActive && classification && classification.decisive") >= 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8) Garde-fous v0.2.179 / v0.2.180 intacts (règles post-décision) ===");
{
  const src = fs.readFileSync(__dirname + "/portail-server.js", "utf8");
  const idx = src.indexOf("const sansReponseAutoPdf = demande.type");
  check("Garde-fou sansReponseAutoPdf présent", idx > 0);
  const bloc = src.slice(idx, idx + 400);
  for (const tp of ["ATTESTATION_TRAVAIL", "ATTESTATION_SALAIRE", "PARRAINAGE"]) {
    check("sansReponseAutoPdf couvre " + tp + " (AUCUNE réponse automatique PDF)", bloc.indexOf('"' + tp + '"') >= 0);
  }
  check("AUCUN PDF auto : docFinal conditionné par !sansReponseAutoPdf",
    src.indexOf("decisionApplicable && !sansReponseAutoPdf") >= 0);
  check("v0.2.180 : transmission des documents du RH à l'employé (envoyerEmailDecisionDocumentsRh)",
    src.indexOf("async function envoyerEmailDecisionDocumentsRh") >= 0);
  check("v0.2.180 : branchement dans la branche attestations/parrainage (decision-documents-rh)",
    src.indexOf("demande-decision-documents-rh") >= 0);
  check("Trace journal reponseAutoPdf=\"desactivee\" conservée",
    src.indexOf('"desactivee"') >= 0);
}

// ---------------------------------------------------------------------------
console.log("\n=================================================================");
console.log("RÉSULTAT : " + OK + " OK / " + KO + " FAIL");
if (KO) {
  console.log("\nÉCHECS :");
  for (const e of echecs) console.log("  - " + e);
  process.exit(1);
}
console.log("TOUTES les expressions demandées sont reconnues pour ATTESTATION_TRAVAIL, ATTESTATION_SALAIRE et PARRAINAGE.");
process.exit(0);
