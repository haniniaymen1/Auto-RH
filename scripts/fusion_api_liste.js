#!/usr/bin/env node
/* Fusion API demandes/route.ts (liste) : base v0.2.138 (matricules v0.2.107
 * conservés) + enrichissements Task 181 du miroir (imports élargis + bloc
 * deuxEtapes / decisionManager / decisionRh / refuseePar / statutFinalLibelle).
 */
const fs = require('fs');

const base = fs.readFileSync('/tmp/my-project/fusion-securite/api-demandes-138.ts', 'utf8');
let out = base;

// ---- 1) imports élargis (garder matriculesPourCins + normaliserCin de la 138)
const regexImports = /import \{ libelleStatut, libelleType, masquerCin, pairesInfosDemande, STATUTS_DEMANDE, TYPES_DEMANDE \} from "@\/lib\/demandes";\nimport \{ matriculesPourCins \} from "@\/lib\/matricule";\nimport \{ normaliserCin \} from "@\/lib\/payslip-index";/;
if (!regexImports.test(out)) throw new Error('imports 138 introuvables');
out = out.replace(regexImports,
  'import {\n' +
  '  libelleDecision,\n' +
  '  libelleStatut,\n' +
  '  libelleStatutFinal,\n' +
  '  libelleType,\n' +
  '  masquerCin,\n' +
  '  pairesInfosDemande,\n' +
  '  STATUTS_DEMANDE,\n' +
  '  TYPES_DEMANDE,\n' +
  '  typeDeuxEtapes,\n' +
  '} from "@/lib/demandes";\n' +
  'import { matriculesPourCins } from "@/lib/matricule";\n' +
  'import { normaliserCin } from "@/lib/payslip-index";');

// ---- 2) bloc deuxEtapes : inséré après statutLibelle dans le mapping
const ancre = '          statut: d.statut,\n          statutLibelle: libelleStatut(d.statut),\n          cin: d.cin,';
if (!out.includes(ancre)) throw new Error('ancre mapping liste introuvable');
const bloc =
  '          statut: d.statut,\n' +
  '          statutLibelle: libelleStatut(d.statut),\n' +
  '          // (NOUVEAU Task 181) validation à deux étapes Manager → RH :\n' +
  '          // décisions tracées + libellé raffiné du statut final\n' +
  '          // (« Refusée par le Manager » / « Refusée par les RH »).\n' +
  '          deuxEtapes: typeDeuxEtapes(d.type),\n' +
  '          decisionManager: d.decisionManager ?? null,\n' +
  '          decisionManagerLibelle: libelleDecision(d.decisionManager),\n' +
  '          decisionRh: d.decisionRh ?? null,\n' +
  '          decisionRhLibelle: libelleDecision(d.decisionRh),\n' +
  '          refuseePar: d.refuseePar ?? null,\n' +
  '          statutFinalLibelle: libelleStatutFinal(d.statut, d.refuseePar),\n' +
  '          cin: d.cin,';
out = out.replace(ancre, bloc);

fs.writeFileSync('/home/z/my-project/src/app/api/demandes/route.ts', out);
console.log('API demandes/route.ts fusionnée :');
console.log('  typeDeuxEtapes=' + (out.match(/typeDeuxEtapes/g) || []).length);
console.log('  matriculesPourCins (138 conservé)=' + (out.match(/matriculesPourCins/g) || []).length);
console.log('  statutFinalLibelle=' + (out.match(/statutFinalLibelle/g) || []).length);
