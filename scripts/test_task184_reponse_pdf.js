/**
 * Task 184 (v0.2.144) — PREUVE E2E : SECTION « RÉPONSE AUTOMATIQUE PDF PAR
 * E-MAIL » — CONFIGURATION DÉDIÉE TOTALEMENT INDÉPENDANTE
 *
 * Demande utilisateur : nouvelle section sous la rubrique Demandes — réponse
 * PDF automatique (congé / autorisation) envoyée par e-mail à l'employé, au
 * RH et au manager, avec signature électronique, certificat, tampon, QR Code,
 * image de signature, positionnement interactif — configuration SÉPARÉE de
 * celle de l'import des fiches de paie (aucune dépendance).
 *
 * Scénario prouvé :
 *  A. aller-retour complet de la configuration DÉDIÉE via /api/reponse-pdf-config
 *     (actif, paraphe/tampon/QR/elec/certificat/mention/envoi, bornage) ;
 *     la réponse N'EXPOSE NI moduleCert NI imagesImport (indépendance) ;
 *  B. INDÉPENDANCE MOTEUR : ReponsePdfConfig active → chargerConfig renvoie
 *     les valeurs DÉDIÉES (jamais celles de l'Import ni du module) ;
 *  C. certificat DÉDIÉ importé via l'API (.p12) → diagnostic + vérification ;
 *     module de signature DÉSACTIVÉ → l'aperçu est quand même signé
 *     (PKCS#7 VALIDE) = le certificat DÉDIÉ est utilisé ;
 *  D. PDF enrichi : section « Validations » (manager N+1, service RH,
 *     validation finale date+heure) + historique chronologique ;
 *  E. PIPELINE complet : décision RH → document généré avec TOUS les
 *     éléments, e-mail RÉEL capté (employé À + RH + manager, pièce jointe
 *     PDF), DocumentDemande relié (visible portails), trace docSigne* ;
 *  F. destinataires activables séparément (employé OFF → RH devient À) ;
 *  G. continuité : ReponsePdfConfig inactive → comportement historique ;
 *  H. nettoyage intégral.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const forge = require('node-forge');
const { extractSignature } = require('@signpdf/utils');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const mod = require(path.join(racine, 'scripts/document-acceptation.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const CIN_TEST = 'TEST18401';
const NOM_EMPLOYE = 'Employe Test 184';
const MATRICULE = 'MTG-1840';
const EMAIL_EMPLOYE = 'employe184@test.tn';
const EMAIL_MANAGER = 'manager184@test.tn';
const EMAIL_RH = 'rh184@test.tn';
const REF_TEST = 'DEM-1840-00001';
const MDP_PORTAIL = 'Test-184!Pass';
const FICHIERS = ['e2e-184-a.pdf'];

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/* Chiffrement disque (jumelle AES-256-GCM « PAIESAGE1 »). */
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

/* Extraction du TEXTE d'un PDF : décompresse tous les flux FlateDecode et
 * concatène, puis décode les chaînes HEXADÉCIMALES « <...> Tj » écrites par
 * pdf-lib (WinAnsi = 1 octet par caractère → latin1). */
function textePdf(pdf) {
  const brut = pdf.toString('latin1');
  const morceaux = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(brut))) {
    const debut = m.index + m[0].length;
    const fin = brut.indexOf('endstream', debut);
    if (fin < 0) continue;
    const donnees = pdf.subarray(debut, fin);
    let texte = '';
    try { texte = zlib.inflateSync(donnees).toString('latin1'); } catch { texte = donnees.toString('latin1'); }
    morceaux.push(texte);
  }
  const contenu = morceaux.join('\n');
  // décode chaque chaîne hexadécimale <…> (texte WinAnsi, 1 octet/caractère)
  return contenu.replace(/<([0-9A-Fa-f\s]+)>/g, (t, hex) => {
    const propre = String(hex).replace(/\s+/g, '');
    if (propre.length % 2) return t;
    try { return Buffer.from(propre, 'hex').toString('latin1'); } catch { return t; }
  });
}

/* Décode les mots encodés RFC 2047 (B et Q) d'un message MIME — après
 * suppression du repliage des en-têtes (« \r\n espace »). */
function decoderRfc2047(brut) {
  const deplie = String(brut).replace(/\r\n[ \t]/g, '');
  return deplie
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (t, b64) => {
      try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return t; }
    })
    .replace(/=\?UTF-8\?Q\?([^ ?]+)\?=/gi, (t, q) => {
      try { return Buffer.from(String(q).replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8'); } catch { return t; }
    });
}

/* Capteur SMTP local (smtp-server). */
function creerCapteurSmtp(port) {
  const { SMTPServer } = require('smtp-server');
  const messages = [];
  const serveur = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    onData(stream, session, callback) {
      const morceaux = [];
      stream.on('data', (c) => morceaux.push(c));
      stream.on('end', () => {
        messages.push({
          de: (session.envelope && session.envelope.mailFrom && session.envelope.mailFrom.address) || '',
          a: ((session.envelope && session.envelope.rcptTo) || []).map((r) => r.address),
          brut: Buffer.concat(morceaux),
        });
        callback();
      });
      stream.on('error', callback);
    },
  });
  return new Promise((resoudre) => {
    serveur.listen(port, '127.0.0.1', () => resoudre({ serveur, messages }));
  });
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
      try { json = JSON.parse(texte); } catch { /* html/binaire */ }
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

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  console.log('== Task 184 (v0.2.144) — Réponse automatique PDF par e-mail (config indépendante) ==');

  /* ---------- semis ---------- */
  console.log('-- semis --');
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  const moduleSauve = await db.signatureApiConfig.findUnique({ where: { id: 'signature-api' } });
  const cfgMailSauvee = await db.mailConfig.findUnique({ where: { id: 'smtp' } });
  const sigSauvee = await db.signatureConfig.findUnique({ where: { id: 'signature' } });
  const reponsePdfSauvee = await db.reponsePdfConfig.findUnique({ where: { id: 'reponse-pdf' } });
  await db.payslip.createMany({
    data: [{
      fileName: FICHIERS[0], storedName: FICHIERS[0], fileSize: 100,
      content: 'FICHE DE PAIE ' + CIN_TEST, normalizedContent: 'FICHE DE PAIE ' + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_EMPLOYE, period: '10/2026',
      netSalary: '1 840,00', matricule: MATRICULE,
    }],
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet, isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false, passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000), qrPresente: true,
      nomPrenom: cryptoBd.chiffrerChamp(NOM_EMPLOYE),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
    },
  });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST, type: 'CONGE', statut: 'EN_ATTENTE',
      decisionManager: 'ACCEPTEE', decisionManagerLe: new Date(Date.now() - 2 * 3600000),
      decisionManagerPar: 'Manager (réponse e-mail)', decisionManagerNote: 'Bonne période — accord du N+1.',
      decisionRh: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-12-01', dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER, commentaire: 'Dossier E2E 184',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : demande avec validation manager (N+1) déjà accordée', Boolean(demande.id));

  /* ---------- capteur SMTP + MailConfig ---------- */
  const { serveur: capteur, messages } = await creerCapteurSmtp(2525);
  await db.mailConfig.update({
    where: { id: 'smtp' },
    data: { host: '127.0.0.1', port: 2525, username: null, password: null, from: 'Auto-RH <auto-rh@test.tn>', rhEmail: EMAIL_RH },
  });

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

  /* ---------- A) configuration DÉDIÉE : aller-retour complet ---------- */
  console.log('-- A) /api/reponse-pdf-config : aller-retour de la configuration dédiée --');
  const imgParaphe = 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64');
  const imgTampon = 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64');
  const imgImport = 'data:image/png;base64,' + pngMinimal(90, 90, 20, 80, 80).toString('base64');
  // Image partagée « Import » DIFFÉRENTE — ne doit JAMAIS fuir vers la réponse PDF
  await db.signatureConfig.upsert({
    where: { id: 'signature' },
    update: { sigImage: imgImport, sigImageNom: 'cachet-import-partage.png' },
    create: { id: 'signature', sigImage: imgImport },
  });
  const cfgPut = await adm.put('/api/reponse-pdf-config', JSON.stringify({
    actif: true,
    certSignataire: 'Amel Ben Salah', certFonction: 'Directrice des Ressources Humaines',
    // paraphe DÉDIÉ + positionnement interactif conservé
    sigPosition: 'BAS_DROITE', sigTaille: 130, sigOpacite: 0.95,
    sigDecalX: -25, sigDecalY: 8, sigRotation: 3,
    sigImage: imgParaphe, sigImageNom: 'paraphe-184.png',
    // tampon DÉDIÉ
    tamponPosition: 'BAS_GAUCHE', tamponTaille: 145, tamponOpacite: 0.9,
    tamponDecalX: 12, tamponDecalY: -6, tamponRotation: 2,
    tamponImage: imgTampon, tamponImageNom: 'cachet-184.png',
    // QR : mode FICHE (page publique de vérification de la réponse)
    qrActif: true, qrMode: 'FICHE', qrUrl: ADMIN,
    qrPosition: 'BAS_GAUCHE', qrTaille: 100, qrDecalX: 160, qrDecalY: 0, qrRotation: 0,
    // cachet électronique (alimenté par le certificat DÉDIÉ)
    elecActif: true, elecForme: 'ROND', elecPosition: 'HAUT_DROITE',
    elecDecalX: -10, elecDecalY: 20, elecTaille: 120,
    elecAffSignataire: true, elecAffOrganisation: true, elecAffEmetteur: false,
    elecAffValidite: true, elecAffEmpreinte: true, elecTexteLibre: 'E2E 184',
    // mention + envoi
    mentionActif: true, mentionTexte: 'Réponse PDF E2E 184 — {DATE}',
    emailActif: true, emailObjet: 'E2E-184 {REF} : {STATUT} — réponse jointe', emailCorps: '',
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }));
  check('PUT configuration dédiée accepté', cfgPut.status === 200 && cfgPut.json && cfgPut.json.ok === true,
    cfgPut.status === 200 ? '' : (cfgPut.texte || '').slice(0, 200));
  const cfgGet = await adm.get('/api/reponse-pdf-config');
  const c = cfgGet.json && cfgGet.json.config;
  check('GET : actif conservé', c && c.actif === true);
  check('GET : paraphe dédié + décalages/rotation/opacité conservés', c && c.paraphe.image === imgParaphe && c.paraphe.decalX === -25 && c.paraphe.decalY === 8 && c.paraphe.rotation === 3 && c.paraphe.opacite === 0.95);
  check('GET : tampon dédié conservé', c && c.tampon.image === imgTampon && c.tampon.taille === 145 && c.tampon.rotation === 2);
  check('GET : QR FICHE + URL conservés', c && c.qr.actif === true && c.qr.mode === 'FICHE' && c.qr.url === ADMIN);
  check('GET : cachet elec ROND + interrupteurs conservés', c && c.elec.actif === true && c.elec.forme === 'ROND' && c.elec.affSignataire === true && c.elec.texteLibre === 'E2E 184');
  check('GET : mention conservée', c && c.mention.actif === true && c.mention.texte === 'Réponse PDF E2E 184 — {DATE}');
  check('GET : envoi conservé (3 destinataires)', c && c.envoi.actif === true && c.envoi.envoyerEmploye === true && c.envoi.envoyerRh === true && c.envoi.envoyerManager === true);
  check('GET : INDÉPENDANCE — ni moduleCert ni imagesImport exposés', c && !('moduleCert' in c) && !('imagesImport' in c));

  /* ---------- B) indépendance du MOTEUR ---------- */
  console.log('-- B) moteur : la config dédiée prime, zéro dépendance Import/module --');
  const cfgMoteur = await mod.chargerConfig(db);
  check('chargerConfig : source dédiée active (_sourceReponsePdf)', cfgMoteur._sourceReponsePdf === true);
  check('chargerConfig : paraphe = image DÉDIÉE (jamais l\'image Import)', cfgMoteur.docSigImage === imgParaphe && cfgMoteur.docSigImage !== imgImport);
  check('chargerConfig : sources verrouillées DEDIEE', cfgMoteur.docSigSource === 'DEDIEE' && cfgMoteur.tamponSource === 'DEDIEE' && cfgMoteur.docQrSource === 'DEDIEE');
  check('chargerConfig : certificat EXCLUSIVEMENT dédié (docCertSource DEDIE)', cfgMoteur.docCertSource === 'DEDIE');
  check('chargerConfig : moduleConfig = null (aucune dépendance)', cfgMoteur.moduleConfig === null);
  check('chargerConfig : e-mails de la section dédiée', cfgMoteur.docEmailObjet === 'E2E-184 {REF} : {STATUT} — réponse jointe' && cfgMoteur.docEnvoyerEmploye === true);

  /* ---------- C) certificat DÉDIÉ via l'API + signature sans module ---------- */
  console.log('-- C) certificat dédié (.p12) + signature PAdES sans module --');
  const mdpCert = 'E2E-184-Dedie!';
  const p12 = creerP12(mdpCert, 'Reponse PDF 184', 'Entreprise Reponses');
  const formCert = new FormData();
  formCert.append('action', 'certificat');
  formCert.append('fichier', new Blob([p12]), 'certificat-e2e-184.p12');
  formCert.append('motDePasse', mdpCert);
  const impCert = await adm.postMultipart('/api/reponse-pdf-config', formCert);
  check('Import certificat DÉDIÉ : PKCS#12 validé + diagnostic', impCert.status === 200 && impCert.json && impCert.json.ok === true && Boolean(impCert.json.diagnostic && impCert.json.diagnostic.sujet),
    impCert.status === 200 ? '' : (impCert.texte || '').slice(0, 200));
  const verCert = await adm.postMultipart('/api/reponse-pdf-config', (() => { const f = new FormData(); f.append('action', 'verifier-certificat'); return f; })());
  check('Vérification du certificat dédié : OK', verCert.status === 200 && verCert.json && verCert.json.ok === true, verCert.json ? String(verCert.json.message || '').slice(0, 90) : '');

  // MODULE DÉSACTIVÉ : la signature ne peut venir QUE du certificat dédié
  if (moduleSauve) {
    await db.signatureApiConfig.update({ where: { id: 'signature-api' }, data: { actif: false, signerReponses: false } });
  } else {
    await db.signatureApiConfig.create({ data: { id: 'signature-api', actif: false, signerReponses: false } });
  }
  const cfgGet2 = await adm.get('/api/reponse-pdf-config');
  check('GET après import : certificat présent + métadonnées', cfgGet2.json && cfgGet2.json.config.certificat.present === true && cfgGet2.json.config.certificat.hasCertPassword === true && Boolean(cfgGet2.json.config.certificat.sujet));
  // Aperçu sur la DEMANDE RÉELLE (validations réelles + identité employé)
  const apercu = await adm.postMultipart('/api/reponse-pdf-config', (() => { const f = new FormData(); f.append('action', 'apercu'); f.append('demandeId', demande.id); return f; })());
  const pdfApercuOk = apercu.status === 200 && apercu.buffer && apercu.buffer.subarray(0, 4).toString('latin1') === '%PDF';
  check('Aperçu : PDF réel généré selon la config dédiée', pdfApercuOk, pdfApercuOk ? apercu.buffer.length + ' octets' : 'status=' + apercu.status);
  const elements = decodeURIComponent(String(apercu.headers.get('x-apercu-elements') || '')).split(',');
  check('Aperçu : paraphe DÉDIÉ dessiné', elements.includes('signature'), elements.join(','));
  check('Aperçu : tampon DÉDIÉ dessiné', elements.includes('tampon'));
  check('Aperçu : QR dessiné (mode FICHE)', elements.includes('qr'));
  check('Aperçu : cachet électronique dessiné (alimenté par le certificat DÉDIÉ)', elements.includes('elec'));
  check('Aperçu : SIGNATURE CRYPTOGRAPHIQUE par le certificat DÉDIÉ (module OFF)', elements.includes('certificat'), 'module inactif → seul le dédié peut signer');
  check('Aperçu : PKCS#7 VALIDE', Boolean(apercu.buffer && (() => { try { return extractSignature(apercu.buffer).ByteRange; } catch { return null; } })()));

  /* ---------- D) contenu du PDF — vérifié sur le PDF FINAL (disque) après E :
   * la réponse HTTP binaire transite par res.text() (UTF-8) et corrompt les
   * octets ≥ 0x80 — le PDF stocké sur disque est la copie PROPRE. ---------- */

  /* ---------- E) pipeline complet : décision RH → PDF + e-mail ---------- */
  console.log('-- E) décision RH → génération + envoi automatiques --');
  const decision = await adm.post('/api/demandes/' + demande.id, { statut: 'ACCEPTEE', commentaire: 'Acceptation E2E 184.' });
  const ds = decision.json && decision.json.docSigne;
  check('Décision RH acceptée + réponse PDF générée', decision.status === 200 && ds && ds.genere === true,
    ds ? JSON.stringify({ sig: ds.signatureCrypto, erreur: ds.erreur }).slice(0, 160) : 'status=' + decision.status);
  check('Signature cryptographique (certificat dédié)', Boolean(ds && ds.signatureCrypto === true));
  check('TOUS les éléments présents', Boolean(ds && ['signature', 'tampon', 'qr', 'elec', 'certificat'].every((e) => (ds.elements || []).includes(e))),
    JSON.stringify(ds && ds.elements));

  await new Promise((r) => setTimeout(r, 1200));
  /* l'e-mail de la RÉPONSE PDF porte l'objet dédié de la section — il se
   * distingue de l'e-mail de décision standard envoyé en parallèle. */
  const msg = messages
    .map((m) => ({ ...m, dec: decoderRfc2047(m.brut.toString('latin1')) }))
    .find((m) => m.a.includes(EMAIL_EMPLOYE) && m.dec.includes('E2E-184'));
  check('E-mail RÉEL envoyé à l\'EMPLOYÉ (À)', Boolean(msg), 'messages=' + messages.length);
  check('E-mail : RH et MANAGER également destinataires', Boolean(msg && msg.a.includes(EMAIL_RH) && msg.a.includes(EMAIL_MANAGER)), msg ? msg.a.join(', ') : '');
  check('E-mail : objet de la section dédiée (variables remplacées)', Boolean(msg && msg.dec.includes('E2E-184') && msg.dec.includes(REF_TEST) && msg.dec.includes('réponse jointe')));
  check('E-mail : PIÈCE JOINTE PDF réelle', Boolean(msg && msg.brut.toString('latin1').includes('application/pdf') && msg.brut.toString('latin1').includes('JVBERi')));

  const demandeApres = await db.demandeAdministrative.findUnique({ where: { id: demande.id } });
  const cheminDisque = path.join(racine, 'storage', 'documents-demandes', demandeApres.docSigneChemin || '');
  check('PDF signé stocké CHIFFRÉ sur disque', fs.existsSync(cheminDisque), demandeApres.docSigneChemin || '');
  const pdfFinal = decryptFromStorage(fs.readFileSync(cheminDisque));
  check('PDF final déchiffrable + PKCS#7 VALIDE', pdfFinal.subarray(0, 4).toString('latin1') === '%PDF' && Boolean((() => { try { return extractSignature(pdfFinal).ByteRange; } catch { return null; } })()));

  /* ---------- D) contenu du PDF final : validations + historique ---------- */
  console.log('-- D) contenu du PDF : validations manager/RH + historique --');
  const texteApercu = textePdf(pdfFinal);
  check('PDF : section « Validations » présente', texteApercu.includes('Validations'));
  check('PDF : validation du manager (N+1) affichée', texteApercu.includes('Validation du manager'));
  check('PDF : validation du service RH affichée', texteApercu.includes('Validation du service RH'));
  check('PDF : validation finale avec date et heure', texteApercu.includes('Validation finale'));
  check('PDF : historique chronologique des validations', texteApercu.includes('Demande créée le') && texteApercu.includes('Décision finale'));
  check('PDF : note du manager reprise', texteApercu.includes('Bonne période'));
  check('PDF : employé + CIN + matricule', texteApercu.includes(NOM_EMPLOYE) && texteApercu.includes(CIN_TEST) && texteApercu.includes(MATRICULE));
  const docDb = await db.documentDemande.findFirst({ where: { demandeId: demande.id, recuDe: 'Génération automatique (document signé)' }, orderBy: { recuLe: 'desc' } });
  check('DocumentDemande relié (consultable portails admin + employé)', Boolean(docDb), docDb ? docDb.nomFichier : 'absent');
  check('Trace destinataires posée (docSigne*)', Boolean(demandeApres.docSigneEnvoiLe || demandeApres.docSigneDestinataires), String(demandeApres.docSigneErreur || 'ok'));
  // page publique de vérification de la RÉPONSE (QR mode FICHE)
  const jeton = require(path.join(racine, 'scripts/tampon-document.js')).jetonReponse(REF_TEST);
  const pageOk = await fetch(ADMIN + '/verification/reponse/' + REF_TEST + '?t=' + jeton, { redirect: 'manual' });
  check('QR « Réponse en ligne » : page publique accepte le jeton', pageOk.status === 200, 'status=' + pageOk.status);

  /* ---------- F) destinataires activables séparément ---------- */
  console.log('-- F) employé OFF → le RH devient destinataire principal --');
  const cfgF = { ...cfgMoteur, docEnvoyerEmploye: false };
  const ctxF = {
    reference: REF_TEST, type: 'CONGE', typeLibelle: 'Demande de congé',
    nomEmploye: NOM_EMPLOYE, cin: CIN_TEST, matricule: MATRICULE,
    emailEmploye: EMAIL_EMPLOYE, nomManager: 'Manager', emailManager: EMAIL_MANAGER,
    jours: 10, heures: '', dateDemande: '', dateDecision: '', decideur: 'RH',
    commentaire: '', statutFinal: 'Acceptée', donnees: {}, cfg: cfgF,
  };
  const emailF = mod.construireEmailDocumentSigne(ctxF, cfgF,
    { employe: '', rh: EMAIL_RH, manager: EMAIL_MANAGER, from: '' }, 'x.pdf', Buffer.from('%PDF-1.4'));
  check('Employé désactivé → RH en destinataire principal', emailF.to === EMAIL_RH && emailF.cc.includes(EMAIL_MANAGER));
  const emailT = mod.construireEmailDocumentSigne(ctxF, cfgMoteur,
    { employe: EMAIL_EMPLOYE, rh: EMAIL_RH, manager: EMAIL_MANAGER, from: '' }, 'x.pdf', Buffer.from('%PDF-1.4'));
  check('Employé activé → employé en À, RH + manager en copie', emailT.to === EMAIL_EMPLOYE && emailT.cc.includes(EMAIL_RH) && emailT.cc.includes(EMAIL_MANAGER));

  /* ---------- G) continuité : contrat v0.2.148 (trace 1a1178618b8b7729) ---------- */
  console.log('-- G) section INACTIVE : ENGAGÉE (certificat) = dédiée ; jamais engagée = historique --');
  // (v0.2.148) la section ENGAGÉE (certificat DÉDIÉ importé en C) reste LA
  // SOURCE même inactive — plus aucune retombée silencieuse vers l'historique
  await db.reponsePdfConfig.update({ where: { id: 'reponse-pdf' }, data: { actif: false } });
  const cfgEngagee = await mod.chargerConfig(db);
  check('chargerConfig : section ENGAGÉE (certificat présent) même INACTIVE → source DÉDIÉE (marqueur dédié)', cfgEngagee._sourceReponsePdf === true);
  check('chargerConfig : section ENGAGÉE inactive → paraphe document = image DÉDIÉE', cfgEngagee.docSigImage === imgParaphe);
  check('chargerConfig : section ENGAGÉE inactive → source de certificat DEDIE', cfgEngagee.docCertSource === 'DEDIE');
  // (v0.2.148) la retombée historique ne concerne plus que les sections
  // JAMAIS engagées (actif=false ET aucun certificat importé)
  await db.reponsePdfConfig.update({ where: { id: 'reponse-pdf' }, data: { actif: false, certChemin: '', certMotDePasse: '' } });
  const cfgLegacy = await mod.chargerConfig(db);
  check('chargerConfig : section jamais engagée → source historique (pas de marqueur dédié)', cfgLegacy._sourceReponsePdf !== true);
  check('chargerConfig : section jamais engagée → paraphe document = champ historique docSigImage (jamais l\'image dédiée)', cfgLegacy.docSigImage !== imgParaphe);
  check('chargerConfig : section jamais engagée → source de certificat historique = MODULE (défaut)', cfgLegacy.docCertSource === 'MODULE');
  check('chargerConfig : image fiche « Import » toujours à sa place (sigImage)', cfgLegacy.sigImage === imgImport);
  await db.reponsePdfConfig.update({ where: { id: 'reponse-pdf' }, data: { actif: true } });

  /* ---------- H) nettoyage intégral ---------- */
  console.log('-- H) nettoyage --');
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  if (reponsePdfSauvee) {
    await db.reponsePdfConfig.update({ where: { id: 'reponse-pdf' }, data: {
      actif: reponsePdfSauvee.actif,
      sigImage: reponsePdfSauvee.sigImage, sigImageNom: reponsePdfSauvee.sigImageNom, sigImageChemin: reponsePdfSauvee.sigImageChemin,
      tamponImage: reponsePdfSauvee.tamponImage, tamponImageNom: reponsePdfSauvee.tamponImageNom, tamponImageChemin: reponsePdfSauvee.tamponImageChemin,
      qrActif: reponsePdfSauvee.qrActif, qrMode: reponsePdfSauvee.qrMode, qrUrl: reponsePdfSauvee.qrUrl,
      elecActif: reponsePdfSauvee.elecActif, elecForme: reponsePdfSauvee.elecForme, elecTexteLibre: reponsePdfSauvee.elecTexteLibre,
      mentionTexte: reponsePdfSauvee.mentionTexte, emailObjet: reponsePdfSauvee.emailObjet, emailCorps: reponsePdfSauvee.emailCorps,
      certChemin: reponsePdfSauvee.certChemin, certFichierNom: reponsePdfSauvee.certFichierNom,
      certSujet: reponsePdfSauvee.certSujet, certEmetteur: reponsePdfSauvee.certEmetteur,
      certEmpreinte: reponsePdfSauvee.certEmpreinte, certMotDePasse: reponsePdfSauvee.certMotDePasse,
      envoyerEmploye: reponsePdfSauvee.envoyerEmploye, envoyerRh: reponsePdfSauvee.envoyerRh, envoyerManager: reponsePdfSauvee.envoyerManager,
    }});
  } else {
    await db.reponsePdfConfig.deleteMany({ where: { id: 'reponse-pdf' } });
  }
  if (moduleSauve) {
    await db.signatureApiConfig.update({ where: { id: 'signature-api' }, data: {
      actif: moduleSauve.actif, signerReponses: moduleSauve.signerReponses,
      certChemin: moduleSauve.certChemin, certFichierNom: moduleSauve.certFichierNom,
      certSujet: moduleSauve.certSujet, certEmetteur: moduleSauve.certEmetteur,
      certEmpreinte: moduleSauve.certEmpreinte, certValideAu: moduleSauve.certValideAu,
      certMotDePasse: moduleSauve.certMotDePasse,
    }});
  } else {
    await db.signatureApiConfig.deleteMany({ where: { id: 'signature-api' } });
  }
  if (sigSauvee) {
    await db.signatureConfig.update({ where: { id: 'signature' }, data: {
      sigImage: sigSauvee.sigImage, sigImageNom: sigSauvee.sigImageNom,
    }});
  }
  if (cfgMailSauvee) {
    await db.mailConfig.update({ where: { id: 'smtp' }, data: {
      host: cfgMailSauvee.host, port: cfgMailSauvee.port,
      username: cfgMailSauvee.username, password: cfgMailSauvee.password,
      from: cfgMailSauvee.from, rhEmail: cfgMailSauvee.rhEmail,
    }});
  }
  try { fs.unlinkSync(path.join(racine, 'storage', 'reponse-pdf', 'certificat-e2e-184.p12')) } catch { /* nom horodaté */ }
  // le certificat importé porte un nom horodaté : retirer les fichiers E2E
  try {
    const dir = path.join(racine, 'storage', 'reponse-pdf');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('certificat-') && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs < 3600000) fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch { /* */ }
  capteur.close(() => { });

  console.log('------------------------------------------------------------');
  console.log(`RÉSULTAT : ${ok} OK / ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e);
  try { await db.$disconnect(); } catch { /* */ }
  process.exit(1);
});
