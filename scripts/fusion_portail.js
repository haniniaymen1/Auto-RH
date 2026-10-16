#!/usr/bin/env node
/* FUSION du portail (scripts/portail-server.js) :
 * BASE = v0.2.138 (la plus riche : AutoRH, Task 231, v0.2.94 mails dédiés,
 *        v0.2.132 managerInfo, v0.2.88/108/110 libValidationN1, Task 197…)
 * AJOUTS = blocs Tasks 178/179/180/181 extraits du miroir (v0.2.141) :
 *   1. require classification-reponses + TYPES_CLASSIFICATION_AUTO + jumelles
 *      deux étapes (calculerStatutFinalDeuxEtapes / libelleStatutFinalDemande)
 *      + extraireTexteMessage
 *   2. envoyerEmailDecisionConge (Task 178/181) + moteur document acceptation
 *      (Task 179) + envoyerEmailTransmissionRh / envoyerEmailRefusManagerRh
 *      (Task 181) + document-refus / optionsMoteurDocument /
 *      traiterDocumentSigneAcceptation / traiterDocumentRefusDecision (Task 180)
 *   3. traiterMessageRecu : version FUSIONNÉE (classification Task 178/181 pour
 *      congé+autorisation ; libValidationN1 138 pour les autres types)
 *   4. LIBELLES_STATUT_DEMANDE : + VALIDEE (Task 178)
 *   5. CSS .st-VALIDEE
 *   6. /api/mes-demandes : libellé final raffiné (Task 181)
 */
const fs = require('fs');

const base = fs.readFileSync('/tmp/my-project/fusion-securite/portail-server-138.js', 'utf8').split('\n');
const miroir = fs.readFileSync('/tmp/my-project/scripts/portail-server.js', 'utf8').split('\n');

// ---------- extraits du miroir ----------
function segmentMiroir(ancreDebut, ancreFin) {
  const i = miroir.findIndex(l => l.includes(ancreDebut));
  if (i < 0) throw new Error('ancre miroir introuvable : ' + ancreDebut);
  const j = miroir.findIndex((l, k) => k >= i && l.includes(ancreFin));
  if (j < 0) throw new Error('fin miroir introuvable : ' + ancreFin);
  return miroir.slice(i, j);
}

// Bloc 1 : du commentaire Task 178 (classification) à la fin d'extraireTexteMessage
const bloc1 = segmentMiroir(
  '// (NOUVEAU Task 178) — CLASSIFICATION AUTOMATIQUE DES RÉPONSES : module',
  '/** Verrou : un seul passage IMAP à la fois'
);
// Bloc 2 : du commentaire Task 178 (notification décision) à la fin de traiterDocumentRefusDecision
const bloc2 = segmentMiroir(
  '(NOUVEAU Task 178) — NOTIFICATION DE DÉCISION AUTOMATIQUE À L\'EMPLOYÉ.',
  'async function traiterMessageRecu(parsed) {'
);
// l'ancre de début est au MILIEU d'un commentaire JSDoc : remonter au « /** » d'ouverture
{
  const i = miroir.findIndex(l => l.includes("(NOUVEAU Task 178) — NOTIFICATION DE DÉCISION AUTOMATIQUE"));
  let k = i;
  while (k > 0 && miroir[k].trim() !== '/**') k--;
  const j = miroir.findIndex((l, kk) => kk >= i && l.includes('async function traiterMessageRecu(parsed) {'));
  if (k > 0 && j > 0) bloc2.splice(0, bloc2.length, ...miroir.slice(k, j));
}

// ---------- insertion 1 : après PLAFOND_MESSAGES_PAR_PASSAGE ----------
let iPlafond = base.findIndex(l => l.includes('const PLAFOND_MESSAGES_PAR_PASSAGE = 50;'));
if (iPlafond < 0) throw new Error('PLAFOND introuvable dans 138');
// l'ancre réelle du 138 est suivie de « /** Verrou… » — on insère le bloc 1 AVANT ce commentaire
let iVerrou = base.findIndex((l, k) => k > iPlafond && l.includes('/** Verrou : un seul passage IMAP'));
if (iVerrou < 0) throw new Error('Verrou introuvable dans 138');
base.splice(iVerrou, 0, ...bloc1, '');
console.log('Bloc 1 inséré : ' + bloc1.length + ' lignes (jumelles + classification)');

// ---------- insertion 2 : avant traiterMessageRecu ----------
// le bloc2 se termine juste avant « async function traiterMessageRecu(parsed) { » du miroir
// (déjà exclu par la borne fin) ; on l'insère avant la même fonction dans 138
let iTrait = base.findIndex((l, k) => k >= iVerrou && l.includes('async function traiterMessageRecu(parsed) {'));
if (iTrait < 0) throw new Error('traiterMessageRecu introuvable dans 138');
base.splice(iTrait, 0, ...bloc2, '');
console.log('Bloc 2 inséré : ' + bloc2.length + ' lignes (décision + transmission + moteurs docs)');

// ---------- remplacement 3 : la fonction traiterMessageRecu fusionnée ----------
const fonctionFusionnee = fs.readFileSync('/home/z/my-project/audit-versions/fusion/traiterMessageRecu-miroir.js', 'utf8');
// délimiter la fonction 138 : de « async function traiterMessageRecu(parsed) { »
// jusqu'à la ligne précédant le commentaire « (NOUVEAU 0.2.47) Traduit une erreur IMAP »
let debutF = -1, finF = -1;
for (let k = iTrait; k < base.length; k++) {
  if (base[k].includes('async function traiterMessageRecu(parsed) {')) { debutF = k; break; }
}
if (debutF < 0) throw new Error('début fonction 138 introuvable');
for (let k = debutF; k < base.length; k++) {
  if (base[k].includes('(NOUVEAU 0.2.47) Traduit une erreur IMAP')) { finF = k; break; }
}
if (finF < 0) throw new Error('fin fonction 138 introuvable');
// remonter jusqu'au « /** » du commentaire suivant (le /* ... */ messageImapLisible)
let debutCommentaireSuivant = finF - 1;
while (debutCommentaireSuivant > debutF && base[debutCommentaireSuivant].trim() !== '/**') debutCommentaireSuivant--;
// remplacer [debutF, debutCommentaireSuivant) par la fonction fusionnée
const remplace = base.slice(debutF, debutCommentaireSuivant);
base.splice(debutF, debutCommentaireSuivant - debutF, ...fonctionFusionnee.split('\n'));
console.log('traiterMessageRecu remplacée : ' + remplace.length + ' → ' + fonctionFusionnee.split('\n').length + ' lignes');

// ---------- 4 : LIBELLES_STATUT_DEMANDE + commentaire Task 178 ----------
let src = base.join('\n');
const ancienLib = `const LIBELLES_STATUT_DEMANDE = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  INFORMATION_REQUISE: "Information requise",
};`;
if (!src.includes(ancienLib)) throw new Error('LIBELLES_STATUT_DEMANDE 138 introuvable');
src = src.replace(ancienLib,
  '// (MODIFIÉ Task 178) — VALIDEE : statut posé AUTOMATIQUEMENT quand la\n' +
  '// réponse e-mail du manager est reconnue comme une VALIDATION (cahier des\n' +
  '// charges « reconnaissance des formulations d\'acceptation/refus »).\n' +
  'const LIBELLES_STATUT_DEMANDE = {\n' +
  '  EN_ATTENTE: "En attente",\n' +
  '  ACCEPTEE: "Acceptée",\n' +
  '  REFUSEE: "Refusée",\n' +
  '  VALIDEE: "Validée",\n' +
  '  INFORMATION_REQUISE: "Information requise",\n' +
  '};');

// ---------- 5 : CSS .st-VALIDEE ----------
const ancienCss = '  .st-REFUSEE { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }';
if (!src.includes(ancienCss)) throw new Error('CSS .st-REFUSEE introuvable');
src = src.replace(ancienCss,
  ancienCss + '\n' +
  '  /* (NOUVEAU Task 178) VALIDEE — validation automatique par réponse e-mail */\n' +
  '  .st-VALIDEE { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }');

// ---------- 6 : /api/mes-demandes libellé raffiné ----------
const ancienMd = '          statutLibelle: libelleStatutDemande(d.statut),';
if (!src.includes(ancienMd)) throw new Error('mes-demandes statutLibelle introuvable');
src = src.replace(ancienMd,
  '          // (MODIFIÉ Task 181) libellé raffiné : « Refusée par le Manager » /\n' +
  '          // « Refusée par les RH » selon l\'origine du refus.\n' +
  '          statutLibelle: libelleStatutFinalDemande(d.statut, d.refuseePar),');

fs.writeFileSync('/home/z/my-project/scripts/portail-server.js', src);
console.log('portail-server.js fusionné : ' + src.split('\n').length + ' lignes');
