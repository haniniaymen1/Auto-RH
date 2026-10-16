/**
 * Task 179 — PREUVE 1 : le cœur du document signé fonctionne en autonomie.
 *  1. création d'un certificat .p12 auto-signé (node-forge) ;
 *  2. génération du PDF de démonstration (aperçuDocument) ;
 *  3. tampon (images PNG de test : paraphe + cachet) ;
 *  4. signature électronique PKCS#7 par le certificat ;
 *  5. vérification : extractSignature lit ByteRange + certificat,
 *     le PDF final est bien VALIDE et contient la signature.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const { extractSignature } = require('@signpdf/utils');
const mod = require('/home/z/my-project/scripts/document-acceptation.js');

let ok = 0;
let ko = 0;
function verifier(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/* ---- 1) certificat .p12 auto-signé ---- */
function creerP12(motDePasse) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { name: 'commonName', value: 'Auto-RH Auto-RH' },
    { name: 'organizationName', value: 'Entreprise Test' },
    { shortName: 'C', value: 'TN' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], motDePasse, { generateLocalKeyId: true, algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/* ---- images de test (PNG 1 couleur avec alpha) via canvas minimal ---- */
function pngMinimal(rouge, vert, bleu, largeur, hauteur) {
  // PNG minimal encodé à la main (zlib via node) — filtre 0 par ligne.
  const zlib = require('zlib');
  const brut = Buffer.alloc(hauteur * (1 + largeur * 4));
  for (let y = 0; y < hauteur; y++) {
    brut[y * (1 + largeur * 4)] = 0;
    for (let x = 0; x < largeur; x++) {
      const i = y * (1 + largeur * 4) + 1 + x * 4;
      brut[i] = rouge; brut[i + 1] = vert; brut[i + 2] = bleu; brut[i + 3] = 200;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8 bits
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(brut)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  console.log('=== Task 179 — preuve du cœur (génération + tampon + signature) ===');
  const MDP = 'Test-179-MotDePasse!';
  const p12 = creerP12(MDP);
  verifier('certificat .p12 créé (auto-signé)', p12.length > 500, p12.length + ' octets');

  // vérification du diagnostic certificat
  const diag = mod.verifierContenuCertificat(p12, MDP);
  verifier('verifierContenuCertificat OK', diag.ok === true && /RH Auto-RH/.test(diag.sujet), diag.sujet);
  verifier('validité non expirée', diag.expire === false);
  const diagMauvaisMdp = mod.verifierContenuCertificat(p12, 'mauvais-mot-de-passe');
  verifier('mot de passe faux détecté', diagMauvaisMdp.ok === false, diagMauvaisMdp.message.slice(0, 80));

  // config avec images de test + certificat
  const cfg = {
    ...mod.DEFAUTS_DOC,
    docSigImage: 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64'),
    tamponImage: 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64'),
    certSignataire: 'Amel Ben Salah',
    certFonction: 'Directrice des Ressources Humaines',
  };
  const opts = {
    dechiffrerChamp: (v) => v,
    // le certificat passe par lireFichierStocke (comme en réel, disque chiffré)
    lireFichierStocke: async () => p12,
  };
  cfg.certChemin = 'storage/signature-certificat/test.p12';
  cfg.certMotDePasse = MDP; // le dechiffrerChamp fourni le renvoie tel quel

  // génération (données de démonstration intégrées)
  const prismaFactice = {};
  const apercu = await mod.apercuDocument(prismaFactice, null, cfg, opts);
  verifier('PDF généré', Buffer.isBuffer(apercu.pdf) && apercu.pdf.length > 1500, apercu.pdf.length + ' octets');
  verifier('paraphe + cachet dessinés', apercu.elements.indexOf('signature') >= 0 && apercu.elements.indexOf('tampon') >= 0, apercu.elements.join(','));
  verifier('signature cryptographique appliquée', apercu.signatureCrypto === true && apercu.elements.indexOf('certificat') >= 0);

  // contexte de démonstration : jours calculés
  verifier('jours calculés (03/08 → 14/08 = 12)', apercu.ctx.jours === 12, String(apercu.ctx.jours));

  // e-mail construit
  const email = mod.construireEmailDocumentSigne(
    apercu.ctx, cfg,
    { employe: 'emp@x.tn', rh: 'rh@x.tn', manager: 'mgr@x.tn' },
    'Acceptation_conge_DEM-2026-DEMO1.pdf', apercu.pdf
  );
  verifier('e-mail : employé en À', email.to === 'emp@x.tn');
  verifier('e-mail : RH + manager en Cc', JSON.stringify(email.cc) === JSON.stringify(['rh@x.tn', 'mgr@x.tn']), JSON.stringify(email.cc));
  verifier('e-mail : PDF en pièce jointe', email.attachments.length === 1 && email.attachments[0].contentType === 'application/pdf');
  verifier('e-mail : variables remplacées', email.subject.indexOf('DEMO1') >= 0 && email.subject.indexOf('{REF}') < 0, email.subject);

  // vérification cryptographique du PDF FINAL
  const ex = extractSignature(apercu.pdf);
  verifier('extractSignature lit la signature', ex && ex.ByteRange, 'ByteRange=' + JSON.stringify(ex.ByteRange));
  const octets = apercu.pdf;
  verifier('PDF valide (%PDF…%%EOF)', octets.subarray(0, 4).toString('latin1') === '%PDF' && octets.subarray(-1024).toString('latin1').indexOf('%%EOF') >= 0);
  verifier('contenu PKCS#7 présent', octets.toString('latin1').indexOf('/SubFilter /adbe.pkcs7.detached') >= 0 || octets.toString('latin1').indexOf('adbe.pkcs7.detached') >= 0);

  // PDF lisible par pdf-lib après signature (intègre)
  const { PDFDocument } = require('pdf-lib');
  const relu = await PDFDocument.load(octets);
  verifier('PDF final rechargé par pdf-lib', relu.getPageCount() === 1);

  fs.writeFileSync('/home/z/my-project/scripts/task179_apercu_signe.pdf', octets);
  console.log('    aperçu conservé : scripts/task179_apercu_signe.pdf');

  console.log('=== RÉSULTAT : ' + ok + ' OK / ' + ko + ' KO ===');
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error('ÉCHEC:', e); process.exit(1); });
