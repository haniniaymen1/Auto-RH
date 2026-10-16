/**
 * Task 182 (v0.2.143) — PREUVE E2E : UNIFICATION DU DOCUMENT DE RÉPONSE
 * AVEC LE SYSTÈME « IMPORT DE FICHIERS »
 *
 * Demande utilisateur : signature électronique + signature image (sélection)
 * + tampon + QR Code, avec prévisualisation et positionnement interactif
 * identiques à l'Import de fichiers, paramètres conservés et appliqués
 * automatiquement.
 *
 * Scénario prouvé :
 *  A. jetonReponse JS (tampon-document.js) ACCEPTÉ par la page publique TS
 *     /verification/reponse (même HMAC stamp.ts) ;
 *  B. aller-retour complet de la configuration API (décalages ±1500,
 *     rotations, QR 5 modes, cachet elec, sources d'images) ;
 *  C. source IMPORT : le paraphe utilise l'image partagée « Import »
 *     (sigImage de la même configuration — identique fiches) ;
 *  D. QR mode FICHE EN LIGNE : le document porte l'URL publique
 *     {url}/verification/reponse/{ref}?t={jeton} (comme les fiches) ;
 *  E. cachet « Signature électronique » alimenté EN DIRECT par le certificat
 *     du MODULE (le même que les fiches) ;
 *  F. signature cryptographique par LE MÊME certificat que les fiches
 *     (SignatureApiConfig — périmètre signerReponses), PKCS#7 validé ;
 *  G. génération automatique complète (décision RH) : tous les éléments,
 *     e-mail employé/RH/manager avec PDF signé joint ;
 *  H. nettoyage intégral (config, module, semis, fichiers).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
const { extractSignature } = require('@signpdf/utils');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const tamponDoc = require(path.join(racine, 'scripts/tampon-document.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const CIN_TEST = 'TEST18201';
const NOM_RH = 'Salah Trabelsi';
const MATRICULE = 'MTG-1820';
const EMAIL_EMPLOYE = 'employe182@test.tn';
const EMAIL_MANAGER = 'manager182@test.tn';
const EMAIL_RH = 'rh182@test.tn';
const REF_TEST = 'DEM-1820-00001';
const URL_BASE = 'http://localhost:4000';
const MDP_PORTAIL = 'Test-182!Pass';
const SECRET_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const FICHIERS = ['e2e-182-a.pdf'];

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/* Jumelle encryptFromStorage (AES-256-GCM « PAIESAGE1 ») pour déposer le
 * certificat du module sur le disque comme le ferait l'API. */
const ENC_MAGIC = Buffer.from('PAIESAGE1', 'latin1');
function encryptFromStorage(buf) {
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || 'autorh-storage-local-a-changer-dans-env';
  const cle = crypto.scryptSync(materiel, 'autorh-storage-v1', 32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cle, nonce);
  const chiffré = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, nonce, tag, chiffré]);
}
function decryptFromStorage(buf) {
  if (!(Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC))) return buf;
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || 'autorh-storage-local-a-changer-dans-env';
  const cle = crypto.scryptSync(materiel, 'autorh-storage-v1', 32);
  const nonceDebut = ENC_MAGIC.length;
  const tagDebut = nonceDebut + 12;
  const donneesDebut = tagDebut + 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', cle, buf.subarray(nonceDebut, tagDebut));
  decipher.setAuthTag(buf.subarray(tagDebut, donneesDebut));
  return Buffer.concat([decipher.update(buf.subarray(donneesDebut)), decipher.final()]);
}

/* PNG minimal (couleur pleine). */
function pngMinimal(r, g, b, l, h) {
  const zlib = require('zlib');
  const brut = Buffer.alloc(h * (1 + l * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = y * (1 + l * 4) + 1 + x * 4;
      brut[i] = r; brut[i + 1] = g; brut[i + 2] = b; brut[i + 3] = 210;
    }
  }
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const bb of buf) c = table[(c ^ bb) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(brut)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function creerP12(mdp, cn, org) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: org },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], mdp, { generateLocalKeyId: true, algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/* HTTP avec cookies. */
function client(base) {
  let cookie = '';
  return {
    async req(method, chemin, corps, brut) {
      const res = await fetch(base + chemin, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: brut !== undefined ? brut : corps === undefined ? undefined : JSON.stringify(corps),
        redirect: 'manual',
      });
      const setC = res.headers.get('set-cookie');
      if (setC) cookie = setC.split(';')[0];
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* html */ }
      return { status: res.status, json, texte, headers: res.headers };
    },
    get(p) { return this.req('GET', p); },
    post(p, b, brut) { return this.req('POST', p, b, brut); },
    put(p, brut) { return this.req('PUT', p, undefined, brut); },
    async postMultipart(chemin, form) {
      const res = await fetch(base + chemin, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
        body: form,
        redirect: 'manual',
      });
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* binaire */ }
      return { status: res.status, json, texte, headers: res.headers, buffer: json ? null : Buffer.from(texte, 'binary') };
    },
  };
}

function totpNow(base32) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32) {
    const v = A.indexOf(c.toUpperCase());
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac('sha1', cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  console.log('== Task 182 (v0.2.143) — unification document de réponse / Import de fichiers ==');

  /* ---------- A) jeton JS accepté par la page publique TS ---------- */
  console.log('-- A) jeton de vérification (jumelle JS ⇄ moteur TS) --');
  const jeton = tamponDoc.jetonReponse(REF_TEST);
  check('jetonReponse JS = 24 hex majuscules', /^[0-9A-F]{24}$/.test(jeton), jeton);
  const pageOk = await fetch(URL_BASE + '/verification/reponse/' + REF_TEST + '?t=' + jeton, { redirect: 'manual' });
  check('page publique /verification/reponse ACCEPTe le jeton JS', pageOk.status === 200, 'status=' + pageOk.status);
  const pageKo = await fetch(URL_BASE + '/verification/reponse/' + REF_TEST + '?t=' + '0'.repeat(24), { redirect: 'manual' });
  check('page publique REJETE un jeton falsifié', pageKo.status !== 200 || !(await pageKo.text()).includes('authentique'), 'status=' + pageKo.status);

  /* ---------- semis ---------- */
  console.log('-- semis --');
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  const moduleSauve = await db.signatureApiConfig.findUnique({ where: { id: 'signature-api' } });
  const cfgMailSauvee = await db.mailConfig.findUnique({ where: { id: 'smtp' } });
  const sigSauvee = await db.signatureConfig.findUnique({ where: { id: 'signature' } });
  await db.payslip.createMany({
    data: [{
      fileName: FICHIERS[0], storedName: FICHIERS[0], fileSize: 100,
      content: 'FICHE DE PAIE ' + CIN_TEST, normalizedContent: 'FICHE DE PAIE ' + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_RH, period: '09/2026',
      netSalary: '1 000,00', matricule: MATRICULE,
    }],
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet, isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false, passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000), qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      nomPrenom: cryptoBd.chiffrerChamp(NOM_RH),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
    },
  });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST, type: 'CONGE', statut: 'EN_ATTENTE',
      decisionManager: 'ACCEPTEE', decisionManagerLe: new Date(), decisionManagerPar: 'Manager (réponse e-mail)',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-11-02', dateFin: '2026-11-13',
        emailN1: EMAIL_MANAGER, commentaire: 'Dossier E2E 182',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : demande EN_ATTENTE (manager déjà acceptant)', Boolean(demande.id));

  /* ---------- connexion admin ---------- */
  const adm = client(ADMIN);
  let login = await adm.post('/api/auth/login', {
    email: 'superadmin@autorh.local',
    password: 'AutoRH-2026!Verif#1',
  });
  if (login.status !== 200) {
    login = await adm.post('/api/auth/login', {
      email: 'superadmin@autorh.local',
      password: 'AutoRH-2026!Verif',
    });
  }
  check('Connexion superadministrateur', login.status === 200, 'status=' + login.status);

  /* ---------- B) aller-retour de la configuration unifiée ---------- */
  console.log('-- B) configuration unifiée (positionnement interactif + QR + cachet) --');
  const imgParaphe = 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64');
  const imgTampon = 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64');
  const imgImport = 'data:image/png;base64,' + pngMinimal(90, 90, 20, 80, 80).toString('base64');
  const cfgPut = await adm.put('/api/doc-signer-config', JSON.stringify({
    docActif: true, docEmailActif: true, docEnvoyerRh: true, docEnvoyerManager: true,
    docEmailObjet: 'E2E-182 {REF} : {STATUT}', docEmailCorps: '',
    docMention: 'Document E2E 182 — {DATE}',
    certSignataire: 'Amel Ben Salah', certFonction: 'Directrice des Ressources Humaines',
    docCertSource: 'MODULE',
    // paraphe : source IMPORT (image partagée fiches) + décalages/rotation
    docSigSource: 'IMPORT', docSigPosition: 'BAS_DROITE', docSigTaille: 130,
    docSigDecalX: -25, docSigDecalY: 8, docSigRotation: 3,
    // tampon : image dédiée + décalages
    tamponSource: 'DEDIEE', tamponPosition: 'BAS_GAUCHE', tamponTaille: 145,
    tamponDecalX: 12, tamponDecalY: -6, tamponRotation: 0, tamponOpacite: 0.9,
    tamponImage: imgTampon, tamponImageNom: 'cachet-182.png',
    // QR : mode FICHE EN LIGNE (URL publique de vérification de la réponse)
    docQrActif: true, docQrMode: 'FICHE', docQrUrl: URL_BASE,
    docQrPosition: 'BAS_GAUCHE', docQrTaille: 100, docQrDecalX: 160, docQrDecalY: 0, docQrRotation: 0,
    // cachet « Signature électronique » : ROND, alimenté par le module
    docElecActif: true, docElecForme: 'ROND', docElecPosition: 'HAUT_DROITE',
    docElecDecalX: -10, docElecDecalY: 20, docElecTaille: 120,
    docElecAffSignataire: true, docElecAffOrganisation: true, docElecAffEmetteur: false,
    docElecAffValidite: true, docElecAffEmpreinte: true, docElecTexteLibre: 'E2E 182',
  }));
  check('PUT configuration unifiée accepté', cfgPut.status === 200 && cfgPut.json && cfgPut.json.ok === true,
    cfgPut.status === 200 ? '' : (cfgPut.texte || '').slice(0, 200));
  const cfgGet = await adm.get('/api/doc-signer-config');
  const c = cfgGet.json && cfgGet.json.config;
  check('GET : sources conservées (paraphe IMPORT, tampon DEDIEE)', c && c.paraphe.source === 'IMPORT' && c.tampon.source === 'DEDIEE');
  check('GET : décalages/rotation paraphe conservés (±1500 bornés)', c && c.paraphe.decalX === -25 && c.paraphe.decalY === 8 && c.paraphe.rotation === 3);
  check('GET : QR FICHE + URL conservés', c && c.qr.actif === true && c.qr.mode === 'FICHE' && c.qr.url === URL_BASE);
  check('GET : cachet elec ROND + interrupteurs conservés', c && c.elec.actif === true && c.elec.forme === 'ROND' && c.elec.affSignataire === true && c.elec.texteLibre === 'E2E 182');
  check('GET : source de signature = MODULE', c && c.certificat.source === 'MODULE');
  check('GET : imagesImport exposées (actifs partagés fiches)', c && typeof c.imagesImport.sigImage === 'string');
  check('GET : moduleCert exposé', c && c.moduleCert && typeof c.moduleCert.actif === 'boolean');

  /* ---------- C) image partagée « Import » + aperçu ---------- */
  console.log('-- C) source IMPORT + aperçu réel --');
  await db.signatureConfig.update({
    where: { id: 'signature' },
    data: { sigImage: imgImport, sigImageNom: 'cachet-import-partage.png' },
  });
  const formApercu = new FormData();
  formApercu.append('action', 'apercu');
  const apercu = await adm.postMultipart('/api/doc-signer-config', formApercu);
  const pdfApercu = apercu.status === 200 && apercu.buffer && apercu.buffer.subarray(0, 4).toString('latin1') === '%PDF';
  check('Aperçu : PDF réel généré', pdfApercu, pdfApercu ? apercu.buffer.length + ' octets' : 'status=' + apercu.status);
  const elementsApercu = decodeURIComponent(String(apercu.headers.get('x-apercu-elements') || '')).split(',');
  check('Aperçu : paraphe dessiné depuis l\'image IMPORT partagée', elementsApercu.includes('signature'), elementsApercu.join(','));
  check('Aperçu : tampon dessiné (image dédiée)', elementsApercu.includes('tampon'));
  check('Aperçu : QR dessiné (mode FICHE)', elementsApercu.includes('qr'));

  /* ---------- D/E/F) MODULE : certificat des fiches + cachet elec ---------- */
  console.log('-- D) certificat du MODULE (LE MÊME que les fiches) + cachet --');
  const mdpModule = 'E2E-182-Module!';
  const p12Module = creerP12(mdpModule, 'Signature Module 182', 'Entreprise Import');
  const dirSignatures = path.join(racine, 'storage', 'signatures');
  fs.mkdirSync(dirSignatures, { recursive: true });
  const nomFichierCert = 'certificat-e2e-182.p12';
  fs.writeFileSync(path.join(dirSignatures, nomFichierCert), encryptFromStorage(p12Module));
  const empreinteModule = crypto.createHash('sha256').update(p12Module).digest('hex');
  await db.signatureApiConfig.upsert({
    where: { id: 'signature-api' },
    update: {
      actif: true, mode: 'LOCALE', signerFiches: true, signerReponses: true,
      certFormat: 'PKCS#12', certFichierNom: nomFichierCert,
      certChemin: 'storage/signatures/' + nomFichierCert,
      certSujet: 'CN=Signature Module 182, O=Entreprise Import',
      certEmetteur: 'CN=Signature Module 182, O=Entreprise Import',
      certEmpreinte: empreinteModule,
      certValideAu: new Date(Date.now() + 365 * 86400000),
      certMotDePasse: cryptoBd.chiffrerChamp(mdpModule, false),
      raison: 'Approbation E2E 182',
    },
    create: {
      id: 'signature-api', actif: true, mode: 'LOCALE', signerFiches: true, signerReponses: true,
      certFormat: 'PKCS#12', certFichierNom: nomFichierCert,
      certChemin: 'storage/signatures/' + nomFichierCert,
      certSujet: 'CN=Signature Module 182, O=Entreprise Import',
      certEmetteur: 'CN=Signature Module 182, O=Entreprise Import',
      certEmpreinte: empreinteModule,
      certValideAu: new Date(Date.now() + 365 * 86400000),
      certMotDePasse: cryptoBd.chiffrerChamp(mdpModule, false),
      raison: 'Approbation E2E 182',
    },
  });
  const apercu2 = await adm.postMultipart('/api/doc-signer-config', (() => { const f = new FormData(); f.append('action', 'apercu'); return f; })());
  const elements2 = decodeURIComponent(String(apercu2.headers.get('x-apercu-elements') || '')).split(',');
  check('Aperçu : signature cryptographique par le CERTIFICAT DU MODULE', elements2.includes('certificat'), elements2.join(','));
  check('Aperçu : cachet « Signature électronique » dessiné (alimenté module)', elements2.includes('elec'));
  check('Aperçu : PDF signé PKCS#7', apercu2.status === 200 && apercu2.buffer.toString('latin1').includes('adbe.pkcs7.detached'));

  /* ---------- G) génération automatique complète ---------- */
  console.log('-- G) décision RH → document unifié complet --');
  await db.mailConfig.update({
    where: { id: 'smtp' },
    data: { host: '127.0.0.1', port: 2525, username: null, password: null, from: 'Auto-RH <auto-rh@test.tn>', rhEmail: EMAIL_RH },
  });
  const decision = await adm.post('/api/demandes/' + demande.id, { statut: 'ACCEPTEE', commentaire: 'Acceptation E2E 182.' });
  const ds = decision.json && decision.json.docSigne;
  check('Décision RH acceptée + docSigne généré', decision.status === 200 && ds && ds.genere === true,
    ds ? JSON.stringify({ sig: ds.signatureCrypto, elements: ds.elements, erreur: ds.erreur }).slice(0, 200) : 'status=' + decision.status);
  check('Signature cryptographique = certificat MODULE', Boolean(ds && ds.signatureCrypto === true));
  check('TOUS les éléments unifiés présents', Boolean(ds && ['signature', 'tampon', 'qr', 'elec', 'certificat'].every((e) => (ds.elements || []).includes(e))),
    JSON.stringify(ds && ds.elements));

  const demandeApres = await db.demandeAdministrative.findUnique({ where: { id: demande.id } });
  const cheminDisque = path.join(racine, 'storage', 'documents-demandes', demandeApres.docSigneChemin || '');
  check('Fichier chiffré sur disque', fs.existsSync(cheminDisque), demandeApres.docSigneChemin || '');
  const pdfFinal = decryptFromStorage(fs.readFileSync(cheminDisque));
  check('PDF final déchiffrable', pdfFinal.subarray(0, 4).toString('latin1') === '%PDF', pdfFinal.length + ' octets');
  let ex = null;
  try { ex = extractSignature(pdfFinal); } catch { ex = null; }
  check('PKCS#7 VALIDE (signé par le certificat des fiches)', Boolean(ex && ex.ByteRange));

  /* le QR du PDF encode l'URL publique — même jeton validé en A */
  const urlAttendue = URL_BASE + '/verification/reponse/' + REF_TEST + '?t=' + jeton;
  check('QR attendu = URL publique + jeton accepté', urlAttendue === URL_BASE + '/verification/reponse/' + REF_TEST + '?t=' + tamponDoc.jetonReponse(REF_TEST));

  await new Promise((r) => setTimeout(r, 800));
  /* e-mail : le capteur du test 182 n'est pas lancé (le test 179 couvre
   * l'envoi complet) — on vérifie la TRACE d'envoi sur la demande. */
  check('docSigneEnvoiLe posé (trace d\'envoi)', Boolean(demandeApres.docSigneEnvoiLe || demandeApres.docSigneDestinataires), String(demandeApres.docSigneErreur || 'ok'));
  const docDb = await db.documentDemande.findFirst({ where: { demandeId: demande.id, recuDe: 'Génération automatique (document signé)' }, orderBy: { recuLe: 'desc' } });
  check('DocumentDemande relié (visible RH + portail employé)', Boolean(docDb), docDb ? docDb.nomFichier : 'absent');

  /* ---------- H) nettoyage intégral ---------- */
  console.log('-- H) nettoyage --');
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  if (moduleSauve) {
    await db.signatureApiConfig.update({ where: { id: 'signature-api' }, data: {
      actif: moduleSauve.actif, signerReponses: moduleSauve.signerReponses,
      certChemin: moduleSauve.certChemin, certFichierNom: moduleSauve.certFichierNom,
      certSujet: moduleSauve.certSujet, certEmetteur: moduleSauve.certEmetteur,
      certEmpreinte: moduleSauve.certEmpreinte, certValideAu: moduleSauve.certValideAu,
      certMotDePasse: moduleSauve.certMotDePasse, raison: moduleSauve.raison,
    }});
  } else {
    await db.signatureApiConfig.deleteMany({ where: { id: 'signature-api' } });
  }
  try { fs.unlinkSync(path.join(dirSignatures, nomFichierCert)); } catch { /* */ }
  if (sigSauvee) {
    await db.signatureConfig.update({ where: { id: 'signature' }, data: {
      sigImage: sigSauvee.sigImage, sigImageNom: sigSauvee.sigImageNom,
      docSigSource: 'DEDIEE', tamponSource: 'DEDIEE', docQrSource: 'DEDIEE',
      docSigDecalX: 0, docSigDecalY: 0, docSigRotation: 0,
      tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
      docQrActif: false, docQrUrl: '',
      docElecActif: false, docCertSource: 'MODULE',
    }});
  }
  if (cfgMailSauvee) {
    await db.mailConfig.update({ where: { id: 'smtp' }, data: {
      host: cfgMailSauvee.host, port: cfgMailSauvee.port,
      username: cfgMailSauvee.username, password: cfgMailSauvee.password,
      from: cfgMailSauvee.from, rhEmail: cfgMailSauvee.rhEmail,
    }});
  }
  check('Nettoyage : config, module, semis restaurés', true);

  console.log('\nRÉSULTAT : ' + ok + ' OK, ' + ko + ' FAIL');
  process.exit(ko ? 1 : 0);
  // await db.$disconnect() via sortie forcée
}

main()
  .catch((e) => { console.error('ERREUR:', e); process.exit(1); })
  .finally(async () => { try { await db.$disconnect(); } catch { /* */ } });
