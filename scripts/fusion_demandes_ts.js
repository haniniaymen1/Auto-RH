#!/usr/bin/env node
/* Fusion demandes.ts : base v0.2.138 + ajouts Tasks 178/181 du miroir.
 *  1) STATUTS_DEMANDE : + commentaire Task 178 et + "VALIDEE"
 *  2) LIBELLES_STATUT : + VALIDEE: "Validée"
 *  3) bloc Task 181 (matrice deux étapes) entre LIBELLES_STATUT et STATUTS_TRAITABLES
 * Tout le reste de la base 138 est conservé (destinataireNotificationDemande
 * v0.2.125, commentaires v0.2.132, typeAvecNPlusUn obsolète…).
 */
const fs = require('fs');

const base = fs.readFileSync('/tmp/my-project/fusion-securite/demandes-138.ts', 'utf8');
const miroir = fs.readFileSync('/tmp/my-project/src/lib/demandes.ts', 'utf8');
let out = base;

// ---- 1) commentaire Task 178 + VALIDEE dans STATUTS_DEMANDE
const regexStatuts = /\/\*\* Statuts de traitement \(valeurs stockées en base\)\. \*\/\nexport const STATUTS_DEMANDE = \[\n  "EN_ATTENTE",\n  "ACCEPTEE",\n  "REFUSEE",\n  "INFORMATION_REQUISE",\n\] as const;/;
if (!regexStatuts.test(out)) throw new Error('STATUTS_DEMANDE 138 introuvable');
const remplacementStatuts =
  '// (MODIFIÉ Task 178) — VALIDEE : statut posé AUTOMATIQUEMENT quand la\n' +
  '// réponse e-mail du manager d\'une demande de congé est reconnue comme une\n' +
  '// validation (cahier des charges « reconnaissance des formulations\n' +
  '// d\'acceptation/refus »). ACCEPTEE reste le statut posé manuellement par le\n' +
  '// RH depuis l\'administration.\n' +
  'export const STATUTS_DEMANDE = [\n  "EN_ATTENTE",\n  "ACCEPTEE",\n  "REFUSEE",\n  "VALIDEE",\n  "INFORMATION_REQUISE",\n] as const;';
out = out.replace(regexStatuts, remplacementStatuts);

// ---- 2) VALIDEE: "Validée" dans LIBELLES_STATUT
const regexLib = /export const LIBELLES_STATUT: Record<string, string> = \{\n  EN_ATTENTE: "En attente",\n  ACCEPTEE: "Acceptée",\n  REFUSEE: "Refusée",\n  INFORMATION_REQUISE: "Information requise",\n\};/;
if (!regexLib.test(out)) throw new Error('LIBELLES_STATUT 138 introuvable');
out = out.replace(regexLib,
  'export const LIBELLES_STATUT: Record<string, string> = {\n  EN_ATTENTE: "En attente",\n  ACCEPTEE: "Acceptée",\n  REFUSEE: "Refusée",\n  VALIDEE: "Validée",\n  INFORMATION_REQUISE: "Information requise",\n};');

// ---- 3) bloc Task 181 extrait du miroir (du commentaire encadré à libelleDecision)
const debutBlocM = miroir.indexOf('/* ==========================================================================\n * NOUVEAU (Task 181)');
if (debutBlocM < 0) throw new Error('bloc Task 181 introuvable dans le miroir');
const marqueurFin = 'export function libelleDecision(d: string | null | undefined): string {\n  if (d === "ACCEPTEE") return "Acceptée";\n  if (d === "REFUSEE") return "Refusée";\n  return "En attente";\n}';
const finBlocM = miroir.indexOf(marqueurFin, debutBlocM);
if (finBlocM < 0) throw new Error('fin du bloc Task 181 introuvable dans le miroir');
const blocTask181 = miroir.slice(debutBlocM, finBlocM + marqueurFin.length);

// insertion dans la base 138 : juste après le « }; » de LIBELLES_STATUT (qui
// contient désormais VALIDEE) et avant « /** Statuts que le RH/IT peut poser »
const ancre = 'VALIDEE: "Validée",\n  INFORMATION_REQUISE: "Information requise",\n};';
if (!out.includes(ancre)) throw new Error('ancre LIBELLES_STATUT introuvable');
out = out.replace(ancre, ancre + '\n\n' + blocTask181 + '\n');

fs.writeFileSync('/home/z/my-project/src/lib/demandes.ts', out);
console.log('demandes.ts fusionné :');
console.log('  VALIDEE=' + (out.match(/VALIDEE/g) || []).length);
console.log('  statutFinalDepuisDecisions=' + (out.match(/statutFinalDepuisDecisions/g) || []).length);
console.log('  libelleStatutFinal=' + (out.match(/libelleStatutFinal/g) || []).length);
console.log('  destinataireNotificationDemande (138 conservé)=' + (out.match(/destinataireNotificationDemande/g) || []).length);
console.log('  lignes=' + out.split('\n').length);
