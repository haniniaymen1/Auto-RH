#!/usr/bin/env node
/* Fusion du schéma Prisma : base v0.2.138 + blocs Tasks 179/180/181 (miroir).
 * Le modèle DemandeAdministrative du miroir contient les 3 blocs de champs
 * (docSigne, docRefus, decisionManager / decisionRh / refuseePar) entre la
 * ligne messageIdEnvoi et createdAt. On extrait ce segment du miroir et on
 * l'insère dans le schéma 138 (référence complète) au même endroit.
 */
const fs = require('fs');

const src138 = fs.readFileSync('/tmp/my-project/fusion-securite/schema-138.prisma', 'utf8').split('\n');
const miroir = fs.readFileSync('/tmp/my-project/prisma/schema.prisma', 'utf8').split('\n');

// 1) extraire du MIROIR le segment « tasks » : du commentaire Task 179 (ligne
//    suivant messageIdEnvoi) jusqu'à refuseePar inclus
const iMessageIdM = miroir.findIndex(l => l.trim().startsWith('messageIdEnvoi'));
if (iMessageIdM < 0) throw new Error('messageIdEnvoi introuvable dans le miroir');
const iRefuseeParM = miroir.findIndex(l => l.trim().startsWith('refuseePar'));
if (iRefuseeParM < 0) throw new Error('refuseePar introuvable dans le miroir');
const segment = miroir.slice(iMessageIdM + 1, iRefuseeParM + 1);
if (!segment.some(l => l.includes('decisionManager')) || !segment.some(l => l.includes('docSigneChemin')) || !segment.some(l => l.includes('docRefusChemin')))
  throw new Error('segment tasks incomplet : ' + segment.length + ' lignes');

// 2) insérer dans le schéma 138 après messageIdEnvoi DU MODÈLE DemandeAdministrative
const iModel138 = src138.findIndex(l => l.trim() === 'model DemandeAdministrative {');
if (iModel138 < 0) throw new Error('modèle DemandeAdministrative introuvable dans 138');
let iMessageId138 = -1;
for (let i = iModel138; i < Math.min(iModel138 + 40, src138.length); i++) {
  if (src138[i].trim().startsWith('messageIdEnvoi')) { iMessageId138 = i; break; }
}
if (iMessageId138 < 0) throw new Error('messageIdEnvoi introuvable dans le modèle 138');

const fusionne = [
  ...src138.slice(0, iMessageId138 + 1),
  ...segment,
  ...src138.slice(iMessageId138 + 1),
];
fs.writeFileSync('/home/z/my-project/prisma/schema.prisma', fusionne.join('\n'));
console.log('Schéma fusionné : ' + fusionne.length + ' lignes (' + segment.length + ' lignes tasks insérées après la ligne ' + (iMessageId138 + 1) + ' de la base 138)');
console.log('Vérifications : decisionManager=' + (fusionne.join('\n').match(/decisionManager/g) || []).length +
  ' ; docSigneChemin=' + (fusionne.join('\n').match(/docSigneChemin/g) || []).length +
  ' ; docRefusChemin=' + (fusionne.join('\n').match(/docRefusChemin/g) || []).length +
  ' ; PasswordHistory=' + (fusionne.join('\n').match(/model PasswordHistory/g) || []).length +
  ' ; SignatureApiConfig=' + (fusionne.join('\n').match(/model SignatureApiConfig/g) || []).length);
