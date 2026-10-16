#!/usr/bin/env node
"use strict";
/**
 * (Task 261 — v0.2.142) Tests UNITAIRES de la reconnaissance des formulations
 * d'acceptation / refus dans les réponses e-mail (scripts/lib-analyse-decision.js).
 *
 * Couverture :
 *   1. TOUTES les formulations officielles d'ACCEPTATION (liste utilisateur)
 *      → "accepter" — testées comme SUJET puis comme CORPS ;
 *   2. TOUTES les formulations officielles de REFUS (liste utilisateur)
 *      → "refuser" — idem ;
 *   3. variantes de casse / accents / ponctuation ;
 *   4. réponses avec CITATIONS (le fil repris ne déclenche rien) ;
 *   5. négations et formulations piégées ;
 *   6. ambiguïtés et réponses sans décision → null (statut inchangé).
 * Sortie : "OK X/Y" ; code retour 1 au moindre écart.
 */
const path = require("path");
const {
  analyserDecisionTexte: analyserDecisionTexte,
  analyserDecisionDetaillee: analyserDecisionDetaillee,
  retirerCitations: retirerCitations,
} = require("./lib-analyse-decision.js");

let ok = 0, ko = 0;
function verif(libelle, actuel, attendu) {
  if (actuel === attendu) { ok++; console.log("  [OK] " + libelle); }
  else { ko++; console.log("  [ECHEC] " + libelle + " — attendu " + JSON.stringify(attendu) + ", obtenu " + JSON.stringify(actuel)); }
}

// ---------- 1) Formulations officielles d'ACCEPTATION ----------
const ACCEPTATIONS = [
  "Demande de congé acceptée",
  "Congé accepté",
  "Congé validé",
  "Demande de congé validée",
  "Demande de congé approuvée",
  "Congé approuvé",
  "Demande de congé accordée",
  "Congé accordé",
  "Votre demande de congé a été acceptée",
  "Votre demande de congé a été validée",
  "Votre demande de congé a été approuvée",
  "Votre congé a été accepté",
  "Votre congé a été validé",
  "Validation de votre demande de congé",
  "Validation de la demande de congé",
  "Validation du congé",
  "Confirmation de validation de la demande de congé",
  "OK",
  "J'accorde",
  "Je valide",
  "D'accord",
];

// ---------- 2) Formulations officielles de REFUS ----------
const REFUS = [
  "Demande de congé refusée",
  "Congé refusé",
  "Demande de congé rejetée",
  "Congé rejeté",
  "Demande de congé non approuvée",
  "Demande de congé non validée",
  "Demande de congé non acceptée",
  "Demande de congé refusée par le manager",
  "Votre demande de congé a été refusée",
  "Votre demande de congé a été rejetée",
  "Votre demande de congé n'a pas été approuvée",
  "Votre demande de congé n'a pas été validée",
  "Refus de votre demande de congé",
  "Notification de refus de votre congé",
  "Refus de la demande de congé",
  "Refus du congé",
  "Notification de refus de la demande de congé",
  "NON",
  "Je refuse",
  "Refus",
  "Désaccord",
];

console.log("=== 1) Formulations d'acceptation (sujet seul puis corps seul) ===");
for (const f of ACCEPTATIONS) {
  verif("[sujet]  " + f, analyserDecisionTexte(f, ""), "accepter");
  verif("[corps]  " + f, analyserDecisionTexte("Re: Auto-RH — Demande DEM-2026-00001", f), "accepter");
}

console.log("=== 2) Formulations de refus (sujet seul puis corps seul) ===");
for (const f of REFUS) {
  verif("[sujet]  " + f, analyserDecisionTexte(f, ""), "refuser");
  verif("[corps]  " + f, analyserDecisionTexte("Re: Auto-RH — Demande DEM-2026-00001", f), "refuser");
}

console.log("=== 3) Variantes de casse / accents / ponctuation / politesse ===");
const variantesAcc = [
  "CONGÉ ACCEPTÉ",
  "c'est validé !",
  "Très bien, demande de congé VALIDÉE.",
  "Bonjour, votre demande de congé a été acceptée. Bon séjour.",
  "Merci. Congé accordé du 3 au 7 mars.",
  "Ok pour moi",
  "OK, j'accorde le congé demandé",
  "D'accord pour les dates",
  "C'est approuvé",
  "Je t'accorde ce congé", // « t'accorde » → « t accorde »
  "La demande est acceptée sans réserve",
  "Validation effectuée",
  "Nous vous informons que votre congé a été accordé",
];
for (const f of variantesAcc) verif("[acc]    " + f, analyserDecisionTexte("", f), "accepter");
const variantesRef = [
  "CONGÉ REFUSÉ",
  "Désaccord total",
  "Bonjour, je suis en désaccord avec cette demande.",
  "C'est refusé.",
  "Je ne peux pas : congé rejeté",
  "Demande NON VALIDÉE",
  "Votre congé a été refusé, désolé.",
  "Refusé pour cause d'effectif insuffisant",
  "Je refuse cette demande",
  "Non",
  "N'on ? non.", // « non » seul deux fois
];
for (const f of variantesRef) verif("[ref]    " + f, analyserDecisionTexte("", f), "refuser");

console.log("=== 4) Citations : le fil repris ne déclenche JAMAIS la décision ===");
const sujetOrigine = "Re: Auto-RH — Demande DEM-2026-00001 : traitement requis";
const citationComplete =
  "Accepté, bon séjour.\n\n" +
  "----- Message d'origine -----\n" +
  "De : paie@test.local\n" +
  "Objet : Demande DEM-2026-00001 : traitement requis\n\n" +
  "Pour traiter cette demande, utilisez les liens ci-dessous :\n" +
  "  • Accepter : http://portail/decision?ref=DEM-2026-00001&jeton=aaa\n" +
  "  • Refuser : http://portail/decision?ref=DEM-2026-00001&jeton=bbb\n" +
  "(Remplacez le sujet du message par « Accepté » ou « Refusé »…)";
verif("[cite]   acceptation tapée + fil cité (Accepter/Refuser)", analyserDecisionTexte(sujetOrigine, citationComplete), "accepter");
const citationRefus =
  "Refusé, période chargée.\n\n" +
  "----- Original message -----\n" +
  "From: paie@test.local\n" +
  "Accepter : http://portail/decision?ref=DEM-2026-00001\n" +
  "Refuser : http://portail/decision?ref=DEM-2026-00001";
verif("[cite]   refus tapé + fil cité", analyserDecisionTexte(sujetOrigine, citationRefus), "refuser");
const citationGt =
  "Je valide la demande\n" +
  "> Le 12/03/2026, Auto-RH a écrit :\n" +
  "> Demande de congé refusée si justificatif absent…\n" +
  "> Refuser la demande";
verif("[cite]   lignes « > » citées ignorées", analyserDecisionTexte(sujetOrigine, citationGt), "accepter");
const citationEcrit =
  "Congé accordé\n" +
  "Le 12/03/2026 à 09:00, Auto-RH a écrit :\n" +
  "Refuser si l'effectif est insuffisant, Accepter sinon";
verif("[cite]   « … a écrit : » coupe le fil", analyserDecisionTexte(sujetOrigine, citationEcrit), "accepter");
// sujet seul décisif même avec un corps 100 % cité contradictoire
verif("[cite]   sujet décisif « Accepté » + corps entièrement cité avec Refuser",
  analyserDecisionTexte("Accepté", citationRefus.replace("Refusé, période chargée.\n\n", "")), "accepter");

console.log("=== 5) Négations et formulations piégées ===");
verif("[neg]    « n'a pas été acceptée »", analyserDecisionTexte("", "Votre demande de congé n'a pas été acceptée"), "refuser");
verif("[neg]    « non approuvée »", analyserDecisionTexte("", "Demande de congé non approuvée"), "refuser");
verif("[neg]    « pas d'accord »", analyserDecisionTexte("", "Je ne suis pas d'accord avec ces dates"), "refuser");
verif("[neg]    « ne peut être validée »", analyserDecisionTexte("", "La demande ne peut être validée en l'état"), "refuser");
verif("[neg]    « pas encore été validée »", analyserDecisionTexte("", "La demande n'a pas encore été validée"), "refuser");
verif("[neg]    « pas du tout acceptée »", analyserDecisionTexte("", "Votre demande n'est pas du tout acceptée"), "refuser");
verif("[piege]  « personne ne valide » (pas de faux refus « ne »)", analyserDecisionTexte("", "Personne ne valide ici"), null);
verif("[piege]  « inacceptable » ne déclenche pas l'acceptation", analyserDecisionTexte("", "Ce comportement est inacceptable"), null);
verif("[piege]  « nonobstant » ne déclenche pas le refus", analyserDecisionTexte("", "Nonobstant les dates, la demande aboutira"), null);
verif("[piege]  « pas claire, mais j'accorde » (ponctuation bloque la négation)", analyserDecisionTexte("", "La période n'est pas claire, mais j'accorde le congé"), "accepter");
verif("[piege]  « non seulement validée mais aussi accordée » → ambigu", analyserDecisionTexte("", "Non seulement validée mais aussi accordée par le service"), null);

console.log("=== 6) Ambiguïtés et réponses sans décision → null (statut inchangé) ===");
const AMBIGUS_SANS_DECISION = [
  ["Bonjour", ""],
  ["Re: Auto-RH — Demande DEM-2026-00001", "Bonjour, je regarde et reviens vers vous."],
  ["", "Merci pour votre demande."],
  ["", "Bien reçu, je consulte l'agenda."],
  ["", "Pouvez-vous préciser les dates ?"],
  ["", "Demande reportée à la semaine prochaine."],
  ["", "accusé de réception"],
  ["", ""],
  ["", "OK ?"], // hmm « ok » y est — voir test suivant
];
// NB : « OK ? » contient bien le mot OK → acceptation attendue, retiré des cas nuls :
AMBIGUS_SANS_DECISION.pop();
for (const [s, c] of AMBIGUS_SANS_DECISION) verif("[null]   " + JSON.stringify(s + " / " + c), analyserDecisionTexte(s, c), null);
verif("[ambigu] « acceptée puis refusée » (les deux familles)", analyserDecisionTexte("", "La demande a été acceptée puis refusée finalement"), null);
verif("[ambigu] sujet accepte + corps refuse", analyserDecisionTexte("Accepté", "En fait je refuse finalement"), null);
verif("[ambigu] « pas d'accord avec le refus » (refus + acceptation niée)", analyserDecisionTexte("", "Je ne suis pas d'accord avec le refus annoncé"), null);
verif("[ambigu] « NON, j'accorde finalement »", analyserDecisionTexte("", "NON, j'accorde finalement le congé"), null);

console.log("=== 7) Détail : signaux et sources (traçabilité journal) ===");
const d1 = analyserDecisionDetaillee("Demande de congé validée", "");
verif("[detail] décision + source sujet", d1.decision === "accepter" && d1.source === "sujet", true);
const d2 = analyserDecisionDetaillee("", "Je refuse, période chargée");
verif("[detail] signal refus explicite + extrait", d2.decision === "refuser" && d2.signauxRefus.length >= 1 && /refus/i.test(JSON.stringify(d2.signauxRefus)), true);
const d3 = analyserDecisionDetaillee("", "Votre demande n'a pas été validée");
verif("[detail] acceptation niée tracée comme refus", d3.decision === "refuser" && /nié/.test(JSON.stringify(d3.signauxRefus)), true);
const d4 = analyserDecisionDetaillee("Re: DEM", "Bonjour");
verif("[detail] aucune formulation → null", d4.decision === null && d4.source && d4.source.indexOf("aucune") === 0, true);

console.log("=== 8) retirerCitations (module) ===");
verif("[outil]  lignes > retirées", retirerCitations("Bonjour\n> cité\nFin").indexOf("cité") < 0, true);
verif("[outil]  corps hors citation conservé", retirerCitations("D'accord\n> cité").indexOf("D accord") >= 0, true);

console.log("\n=== BILAN : " + ok + " OK / " + ko + " échec(s) ===");
process.exit(ko ? 1 : 0);
