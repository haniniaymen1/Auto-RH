#!/usr/bin/env node
/* Fusion db-crypto.ts : base v0.2.138 (la plus riche : PortalAccess complet,
 * sections SignatureConfig v0.2.99 / SignatureConfigReponse / SignatureApiConfig
 * Task 224) + carte DemandeAdministrative étendue du miroir (Task 179/180 :
 * docSigneDestinataires, docRefusDestinataires).
 */
const fs = require('fs');

const base = fs.readFileSync('/tmp/my-project/fusion-securite/db-crypto-138.ts', 'utf8');
const miroir = fs.readFileSync('/tmp/my-project/src/lib/db-crypto.ts', 'utf8');

// 1) extraire du miroir le bloc DemandeAdministrative (du commentaire Task 179
//    au couple final) — délimité par « (MODIFIÉ Task 179) » et l'accolade
const debutM = miroir.indexOf('    // (MODIFIÉ Task 179) docSigneDestinataires');
if (debutM < 0) throw new Error('bloc Task 179 introuvable dans le miroir');
const finM = miroir.indexOf('},', debutM);
const blocDemandeM = miroir.slice(debutM, finM + 2); // « }, » inclus
if (!blocDemandeM.includes('docSigneDestinataires') || !blocDemandeM.includes('docRefusDestinataires'))
  throw new Error('bloc DemandeAdministrative du miroir incomplet');

// 2) dans la base 138, remplacer la carte DemandeAdministrative (une ligne alea)
const regexBase = /  DemandeAdministrative: \{\n    det: \["cin"\],\n    alea: \["donnees", "destinataire", "employeEmail"\],\n  \},/;
if (!regexBase.test(base)) throw new Error('carte DemandeAdministrative 138 introuvable (regex)');
const fusionne = base.replace(regexBase, blocDemandeM);

fs.writeFileSync('/home/z/my-project/src/lib/db-crypto.ts', fusionne);
const verif = (fusionne.match(/docRefusDestinataires/g) || []).length;
const verif2 = (fusionne.match(/SignatureApiConfig/g) || []).length;
const verif3 = (fusionne.match(/"nom", "prenom", "matricule"/g) || []).length;
console.log('db-crypto fusionné : docRefusDestinataires=' + verif + ' ; SignatureApiConfig=' + verif2 + ' ; PortalAccess complet=' + verif3);
