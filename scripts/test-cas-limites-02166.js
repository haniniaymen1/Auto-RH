#!/usr/bin/env node
/* TESTS LIMITES v0.2.166 — participes seuls, Outlook, négations, gardes. */
"use strict";
const c = require(__dirname + "/classification-reponses.js");
let echecs = 0;
function verifier(nom, sujet, corps, attendu) {
  const r = c.classifierReponse(sujet, corps);
  const ok = r.decision === attendu;
  if (!ok) echecs++;
  console.log((ok ? "✓" : "✗ ÉCHEC") + " | " + nom + " → " + r.decision + (ok ? "" : " (attendu " + attendu + ")"));
  return ok;
}
const S_DEM = "Re: AutoRH — Congé DEM-2026-00071 (traitement requis)";
const S_TRANS = "Re: Auto-RH — Congé DEM-2026-00071 acceptée par le manager — validation RH requise";

console.log("== Participes seuls (consigne respectée à la lettre) ==");
verifier("« Acceptée » seul", S_DEM, "Acceptée", "VALIDATION");
verifier("« Refusée » seul", S_DEM, "Refusée", "REFUS");
verifier("« Validée » seul", S_DEM, "Validée", "VALIDATION");
verifier("« Accepté » seul (masculin)", S_DEM, "Accepté", "VALIDATION");
verifier("« Approuvée » seul", S_DEM, "Approuvée", "VALIDATION");
verifier("« Rejetée » seul", S_DEM, "Rejetée", "REFUS");

console.log("== Le sujet NE décide JAMAIS (participes) ==");
verifier("sujet transmission + corps neutre", S_TRANS, "Merci de traiter rapidement.", "NON_RECONNU");
verifier("RH refuse + sujet « acceptée par le manager »", S_TRANS, "Refusée", "REFUS");

console.log("== Négations / gardes anti-faux ==");
verifier("« pas validée »", S_DEM, "La demande n'est pas validée pour le moment.", "REFUS");
verifier("« pas encore validée » (pas encore = attente)", S_DEM, "Toujours pas validée, je vois.", "NON_RECONNU");
verifier("« pas acceptée »", S_DEM, "Elle n'est pas acceptée.", "REFUS");
verifier("« je ne valide pas »", S_DEM, "Je ne valide pas cette demande.", "REFUS");
verifier("corps neutre sans citation", S_DEM, "Bien reçu, je regarde dès que possible.", "NON_RECONNU");
verifier("« validé » précédé de « pas »", S_DEM, "Ce n'est pas validé.", "REFUS");

console.log("== Formats Outlook / multi-quotations ==");
verifier("Outlook block FR + acceptation",
  "RE: AutoRH — Autorisation de sortie DEM-2026-00073 (traitement requis)",
  "D'accord pour cette sortie.\n\nDe : AutoRH Auto-RH <employe.test@autorh.tn>\nEnvoyé : jeudi 9 octobre 2026 14:05\nÀ : Manager <smtp.test@autorh.tn>\nObjet : AutoRH — Autorisation de sortie DEM-2026-00073 (traitement requis)\n\nVALIDATION PAR E-MAIL : répondez « Acceptée » ou « Refusée »…\nCompensation des heures : Non — heures non compensées",
  "VALIDATION");
verifier("Outlook + refus explicite",
  "RE: AutoRH — Congé DEM-2026-00072 (traitement requis)",
  "Je refuse cette demande.\n\nDe : AutoRH Auto-RH <employe.test@autorh.tn>\nEnvoyé : jeudi 9 octobre 2026 14:05\nObjet : AutoRH — Congé DEM-2026-00072 (traitement requis)\n\n« Acceptée » pour VALIDER, ou « Refusée » pour la refuser.",
  "REFUS");
verifier("séparateur « ----- Message d'origine ----- »",
  S_DEM, "OK pour moi.\n\n----- Message d'origine -----\nDe : AutoRH\n« Acceptée » ou « Refusée » pour la refuser.", "VALIDATION");
verifier("thread long : réponse récente + anciens messages quotés",
  S_TRANS, "Je refuse, effectifs insuffisants.\n\nLe 9 oct. 2026, RH a écrit :\n> J'accepte la demande.\n>\n> Le 8 oct., manager a écrit :\n> > OK pour moi.",
  "REFUS");

console.log("== Formulations historiques intactes (non-régression) ==");
verifier("« Congé accepté »", S_DEM, "Congé accepté.", "VALIDATION");
verifier("« Je valide »", S_DEM, "Je valide.", "VALIDATION");
verifier("« D'accord »", S_DEM, "D'accord, avec plaisir.", "VALIDATION");
verifier("« OK »", S_DEM, "OK", "VALIDATION");
verifier("« Je refuse »", S_DEM, "Je refuse.", "REFUS");
verifier("« NON »", S_DEM, "NON", "REFUS");
verifier("« Désaccord »", S_DEM, "Je suis en désaccord avec cette demande.", "REFUS");
verifier("attestation « J'accepte votre demande d'attestation de travail »",
  "Re: AutoRH — Attestation de travail DEM-2026-00075 (traitement requis)",
  "J'accepte votre demande d'attestation de travail.", "VALIDATION");

console.log(echecs === 0 ? "\n=== TOUS LES TESTS PASSENT ===" : "\n=== " + echecs + " ÉCHEC(S) ===");
process.exit(echecs === 0 ? 0 : 1);
