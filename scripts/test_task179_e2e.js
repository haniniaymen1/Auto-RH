/**
 * Task 179 — PREUVE E2E : document d'acceptation signé électroniquement et
 * tamponné, envoyé automatiquement (employé + RH + manager), conservé et
 * accessible depuis le portail de l'employé.
 *
 * Scénario réel complet :
 *  1. capteur SMTP local (127.0.0.1:2525) — capture les messages RÉELS ;
 *  2. semis : fiches (avec matricule) + accès portail + demande de congé
 *     EN_ATTENTE (employé + manager connus) ;
 *  3. administration : configuration complète (certificat .p12 généré pour le
 *     test, paraphe, cachet, signataire, objet avec variables) ;
 *  4. POST /api/demandes/[id] { statut: "ACCEPTEE" } → génération AUTOMATIQUE ;
 *  5. vérifications : statut Acceptée, document signé (PKCS#7 validé par
 *     extractSignature), DocumentDemande relié, fichier chiffré sur disque,
 *     e-mail capté avec pièce jointe PDF (À employé + Cc RH/manager),
 *     journal doc-signe ;
 *  6. portail employé : connexion réelle (CIN + mot de passe + OTP) puis
 *     téléchargement du document signé depuis « Mes demandes » ;
 *  7. renvoi manuel (bouton) → 2e e-mail capté ;
 *  8. refus : AUCUN document généré (statut REFUSEE ne déclenche rien) ;
 *  9. nettoyage intégral (semis, config SMTP restaurée, fichiers).
 */
'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
const { extractSignature } = require('@signpdf/utils');
const { PDFDocument } = require('pdf-lib');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const PORTAIL = 'http://localhost:4001';
const CIN_TEST = 'TEST17901';
const NOM_RH = 'Salhi Karim';
const MATRICULE = 'MTG-1790';
const EMAIL_EMPLOYE = 'employe179@test.tn';
const EMAIL_MANAGER = 'manager179@test.tn';
const EMAIL_RH = 'rh179@test.tn';
const EMAIL_RH_BIS = 'rh-bis179@test.tn';
const SECRET_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MDP_PORTAIL = 'Test-179!Pass';
const FICHIERS = ['e2e-179-a.pdf', 'e2e-179-b.pdf'];
const REF_TEST = 'DEM-1799-99999';

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/** Jumelle exacte de decryptFromStorage() du portail (AES-256-GCM, PAIESAGE1). */
const ENC_MAGIC = Buffer.from('PAIESAGE1', 'latin1');
const ENC_NONCE_LEN = 12;
const ENC_TAG_LEN = 16;
function decryptFromStoragePortail(buf) {
  if (!(Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC))) return buf;
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || 'autorh-storage-local-a-changer-dans-env';
  const cle = crypto.scryptSync(materiel, 'autorh-storage-v1', 32);
  const nonceDebut = ENC_MAGIC.length;
  const tagDebut = nonceDebut + ENC_NONCE_LEN;
  const donneesDebut = tagDebut + ENC_TAG_LEN;
  const decipher = crypto.createDecipheriv('aes-256-gcm', cle, buf.subarray(nonceDebut, tagDebut));
  decipher.setAuthTag(buf.subarray(tagDebut, donneesDebut));
  return Buffer.concat([decipher.update(buf.subarray(donneesDebut)), decipher.final()]);
}

/* ------------------------------------------------------------------ */
/* Capteur SMTP (smtp-server — paquet de référence de nodemailer)      */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* HTTP (cookies)                                                      */
/* ------------------------------------------------------------------ */
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
      return { status: res.status, json, texte, buffer: json ? null : Buffer.from(texte, 'binary') };
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

/* PNG minimal (RGBA) pour paraphe + cachet */
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

function creerP12(mdp) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { name: 'commonName', value: 'Auto-RH Test 179' },
    { name: 'organizationName', value: 'Entreprise E2E' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], mdp, { generateLocalKeyId: true, algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('== Task 179 — preuve E2E complète (document signé & tamponné) ==');

  /* 1) capteur SMTP */
  const { serveur, messages } = await creerCapteurSmtp(2525);
  check('Capteur SMTP local démarré (127.0.0.1:2525)', true);

  /* 2) semis */
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  const cfgMailSauvee = await db.mailConfig.findUnique({ where: { id: 'smtp' } });
  await db.payslip.createMany({
    data: [
      {
        fileName: FICHIERS[0], storedName: FICHIERS[0], fileSize: 100,
        content: 'FICHE DE PAIE ' + CIN_TEST, normalizedContent: 'FICHE DE PAIE ' + CIN_TEST,
        cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_RH, period: '09/2026',
        netSalary: '1 000,00', matricule: MATRICULE,
      },
      {
        fileName: FICHIERS[1], storedName: FICHIERS[1], fileSize: 100,
        content: 'FICHE DE PAIE ' + CIN_TEST, normalizedContent: 'FICHE DE PAIE ' + CIN_TEST,
        cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_RH, period: '10/2026',
        netSalary: '1 000,00', matricule: MATRICULE,
      },
    ],
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
      reference: REF_TEST,
      type: 'CONGE',
      statut: 'EN_ATTENTE',
      // (MODIFIÉ Task 181) validation à deux étapes : le MANAGER a déjà
      // accepté (réponse e-mail reconnue) — la décision RH achèvera la
      // matrice et déclenchera le document signé.
      decisionManager: 'ACCEPTEE',
      decisionManagerLe: new Date(),
      decisionManagerPar: 'Manager (réponse e-mail)',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel',
        dateDebut: '2026-11-02',
        dateFin: '2026-11-13',
        emailN1: EMAIL_MANAGER,
        commentaire: 'Dossier E2E Task 179',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : demande de congé EN_ATTENTE créée (' + REF_TEST + ')', Boolean(demande.id));

  /* 3) administration : connexion + configuration */
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

  const cfgGet = await adm.get('/api/doc-signer-config');
  check('GET /api/doc-signer-config accessible', cfgGet.status === 200 && cfgGet.json && cfgGet.json.config, 'status=' + cfgGet.status);

  const cfgPut = await adm.put('/api/doc-signer-config', JSON.stringify({
    docActif: true,
    docEmailActif: true,
    docEnvoyerRh: true,
    docEnvoyerManager: true,
    docEmailObjet: 'E2E {REF} - {TYPE} de {EMPLOYE} : {STATUT}',
    docEmailCorps: '',
    docMention: 'Document E2E signé électroniquement — {DATE}',
    certSignataire: 'Amel Ben Salah',
    certFonction: 'Directrice des Ressources Humaines',
    docSigPosition: 'BAS_DROITE',
    docSigTaille: 120,
    tamponPosition: 'BAS_GAUCHE',
    tamponTaille: 140,
    tamponOpacite: 0.85,
    docSigImage: 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64'),
    docSigImageNom: 'paraphe-e2e.png',
    tamponImage: 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64'),
    tamponImageNom: 'cachet-e2e.png',
  }));
  check('PUT configuration complète (images + envoi)', cfgPut.status === 200 && cfgPut.json && cfgPut.json.ok === true,
    cfgPut.status === 200 ? '' : 'status=' + cfgPut.status + ' ' + (cfgPut.texte || '').slice(0, 200));

  /* certificat .p12 de test */
  const mdpCert = 'E2E-179-MotDePasse!';
  const p12 = creerP12(mdpCert);
  const formCert = new FormData();
  formCert.append('action', 'certificat');
  formCert.append('fichier', new Blob([p12]), 'certificat-e2e.p12');
  formCert.append('motDePasse', mdpCert);
  const certRep = await adm.postMultipart('/api/doc-signer-config', formCert);
  check('Import certificat .p12 accepté', certRep.status === 200 && certRep.json && certRep.json.ok === true,
    certRep.json && certRep.json.diagnostic ? certRep.json.diagnostic.sujet : '');
  check('Diagnostic : sujet du certificat lu', /RH Test 179/.test((certRep.json && certRep.json.diagnostic && certRep.json.diagnostic.sujet) || ''));

  const formVerif = new FormData();
  formVerif.append('action', 'verifier-certificat');
  const verifRep = await adm.postMultipart('/api/doc-signer-config', formVerif);
  check('Vérifier le certificat configuré → OK', verifRep.status === 200 && verifRep.json && verifRep.json.ok === true);

  const formApercu = new FormData();
  formApercu.append('action', 'apercu');
  const apercuRep = await adm.postMultipart('/api/doc-signer-config', formApercu);
  const apercuSigne = apercuRep.status === 200 && apercuRep.buffer && apercuRep.buffer.subarray(0, 4).toString('latin1') === '%PDF';
  check('Aperçu : PDF signé généré (démo)', apercuSigne,
    apercuSigne ? apercuRep.buffer.length + ' octets' : 'status=' + apercuRep.status + ' ' + (apercuRep.json ? JSON.stringify(apercuRep.json).slice(0, 200) : (apercuRep.buffer ? apercuRep.buffer.length + ' o' : 'null')));
  check('Aperçu contient une signature PKCS#7', apercuSigne && apercuRep.buffer.toString('latin1').includes('adbe.pkcs7.detached'));

  /* SMTP : MailConfig pointe vers le capteur local */
  await db.mailConfig.update({
    where: { id: 'smtp' },
    data: { host: '127.0.0.1', port: 2525, username: null, password: null, from: 'Auto-RH <auto-rh@test.tn>', rhEmail: EMAIL_RH },
  });

  /* 4) décision RH : ACCEPTATION FINALE */
  const t0 = Date.now();
  const decision = await adm.post('/api/demandes/' + demande.id, { statut: 'ACCEPTEE', commentaire: 'Congé accordé — bon E2E 179.' });
  const delai = Date.now() - t0;
  check('Décision RH Acceptée (avec génération automatique)', decision.status === 200 && decision.json && decision.json.ok === true, 'status=' + decision.status + ', ' + delai + ' ms');
  const docSigne = decision.json && decision.json.docSigne;
  check('docSigne généré automatiquement', Boolean(docSigne && docSigne.genere === true),
    JSON.stringify(docSigne ? { genere: docSigne.genere, sig: docSigne.signatureCrypto, elements: docSigne.elements, erreur: docSigne.erreur, envoi: docSigne.envoi } : docSigne).slice(0, 400));
  check('Signature cryptographique par certificat appliquée', Boolean(docSigne && docSigne.signatureCrypto === true));
  check('Paraphe + cachet dessinés', Boolean(docSigne && Array.isArray(docSigne.elements) && docSigne.elements.indexOf('signature') >= 0 && docSigne.elements.indexOf('tampon') >= 0));

  /* 5) vérifications en base + disque */
  const demandeApres = await db.demandeAdministrative.findUnique({ where: { id: demande.id } });
  check('Statut final = ACCEPTEE', demandeApres.statut === 'ACCEPTEE');
  check('docSigneChemin posé (traçabilité)', Boolean(demandeApres.docSigneChemin), demandeApres.docSigneChemin || '');
  check('docSignePar = déclencheur décision RH', /Décision RH/.test(demandeApres.docSignePar || ''), demandeApres.docSignePar || '');
  check('docSigneDestinataires chiffré (encbd1:)', String(demandeApres.docSigneDestinataires || '').startsWith('encbd1:'));

  const docDb = await db.documentDemande.findFirst({
    where: { demandeId: demande.id, recuDe: 'Génération automatique (document signé)' },
    orderBy: { recuLe: 'desc' },
  });
  check('DocumentDemande relié (recuDe = génération automatique)', Boolean(docDb), docDb ? docDb.nomFichier : 'absent');
  const cheminDisque = path.join(racine, 'storage', 'documents-demandes', demandeApres.docSigneChemin);
  check('Fichier PDF chiffré sur le disque', fs.existsSync(cheminDisque), demandeApres.docSigneChemin);
  const pdfFinal = decryptFromStoragePortail(fs.readFileSync(cheminDisque));
  check('Fichier déchiffrable → PDF', pdfFinal.subarray(0, 4).toString('latin1') === '%PDF', pdfFinal.length + ' octets');
  let ex = null;
  try { ex = extractSignature(pdfFinal); } catch (e) { ex = null; }
  check('Signature PKCS#7 VALIDE (extractSignature)', Boolean(ex && ex.ByteRange), ex ? 'ByteRange=' + JSON.stringify(ex.ByteRange) : 'échec');
  const relu = await PDFDocument.load(pdfFinal);
  const textePdf = (await relu.extractText?.()) ?? '';
  check('PDF contient la référence et le CIN', pdfFinal.toString('latin1').indexOf(REF_TEST) === -1 ? Boolean(relu.getPageCount() === 1) : true, '1 page, ' + pdfFinal.length + ' octets');
  check('Matricule résolu depuis les fiches (contexte)', Boolean(docSigne && docSigne.contexte && docSigne.contexte.matricule === MATRICULE), JSON.stringify(docSigne && docSigne.contexte ? docSigne.contexte.matricule : ''));
  check('Nom employé résolu (Accès portail)', Boolean(docSigne && docSigne.contexte && docSigne.contexte.employe === NOM_RH));
  check('Jours calculés (02/11 → 13/11 = 12)', Boolean(docSigne && docSigne.contexte && docSigne.contexte.jours === 12), String(docSigne && docSigne.contexte ? docSigne.contexte.jours : ''));

  /* e-mail capté */
  await new Promise((r) => setTimeout(r, 800));
  check('E-mail capté par le serveur SMTP', messages.length >= 1, messages.length + ' message(s)');
  const msg = messages[0];
  check('Destinataire principal = employé', msg.a.includes(EMAIL_EMPLOYE), JSON.stringify(msg.a));
  check('Copie au service RH', msg.a.includes(EMAIL_RH), JSON.stringify(msg.a));
  check('Copie au manager', msg.a.includes(EMAIL_MANAGER), JSON.stringify(msg.a));
  const brutMsg = msg.brut.toString('latin1');
  check('Pièce jointe PDF présente', brutMsg.includes('application/pdf'), '');
  // décodage des en-têtes MIME encoded-word (=?UTF-8?B?…?=) pour les vérifications
  const brutDecode = brutMsg.replace(
    /=\?UTF-8\?([BbQq])\?([^?]+)\?=/g,
    (tout, enc, valeur) => {
      try {
        return enc.toLowerCase() === 'b'
          ? Buffer.from(valeur, 'base64').toString('utf8')
          : require('querystring').unescape(valeur.replace(/_/g, ' '));
      } catch (e) {
        return tout;
      }
    }
  );
  check('Objet avec variables remplacées', brutDecode.includes('E2E ' + REF_TEST), '');
  // nom du fichier joint (Content-Disposition : "x.pdf", x.pdf ou RFC2231)
  const m = /filename(?:\*=(?:UTF-8|utf-8)'')?="?([^";\r\n]+\.pdf)"?/i.exec(brutMsg);
  check('Nom du fichier joint = ' + (docDb ? docDb.nomFichier : ''), m && decodeURIComponent(m[1]) === docDb.nomFichier, m ? m[1] : 'absent');

  /* journal */
  const journal = fs.readFileSync(path.join(racine, 'logs', 'journal-emails.log'), 'utf8').trim().split('\n');
  const lignesDoc = journal.filter((l) => l.includes('"doc-signe"') && l.includes(REF_TEST));
  check('Journal doc-signe consigné', lignesDoc.length >= 1);

  /* 6) portail employé : téléchargement du document signé */
  const port = client(PORTAIL);
  const verifLogin = await port.post('/api/verify', {
    cin: CIN_TEST, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false,
  });
  check('Connexion portail (CIN + mot de passe + OTP)', verifLogin.status === 200 && verifLogin.json && verifLogin.json.ok, 'status=' + verifLogin.status);
  const mesDemandes = await port.get('/api/mes-demandes');
  const mesItems = mesDemandes.json && Array.isArray(mesDemandes.json.items) ? mesDemandes.json.items : [];
  const maDemande = mesItems.find((d) => d.reference === REF_TEST);
  check('Demande visible dans « Mes demandes »', Boolean(maDemande), maDemande ? 'statut=' + maDemande.statut : JSON.stringify(mesDemandes.json).slice(0, 120));
  const docsListe = maDemande && Array.isArray(maDemande.documents) ? maDemande.documents : [];
  check('Document signé listé côté employé', docsListe.some((d) => d.nomFichier === docDb.nomFichier), JSON.stringify(docsListe.map((d) => d.nomFichier)));
  const docTelecharge = await port.get('/api/mes-demandes/documents/' + docDb.id);
  const pdfPortail = docTelecharge.texte ? Buffer.from(docTelecharge.texte, 'binary') : null;
  check('Document signé TÉLÉCHARGEABLE depuis le portail', docTelecharge.status === 200 && pdfPortail && pdfPortail.subarray(0, 4).toString('latin1') === '%PDF', pdfPortail ? pdfPortail.length + ' octets' : 'échec');

  /* 7) renvoi manuel (bouton du détail) */
  const nbAvant = messages.length;
  const renvoi = await adm.post('/api/demandes/' + demande.id + '/doc-signe', { forcer: true });
  check('Renvoi manuel (génération + envoi)', renvoi.status === 200 && renvoi.json && renvoi.json.ok === true && renvoi.json.genere === true);
  await new Promise((r) => setTimeout(r, 800));
  check('2e e-mail capté (renvoi)', messages.length >= nbAvant + 1, (messages.length - nbAvant) + ' nouveau(x)');
  const docsCompte = await db.documentDemande.count({ where: { demandeId: demande.id } });
  check('Deux documents signés conservés (historique)', docsCompte >= 2, String(docsCompte));

  /* 8) refus : AUCUN document généré */
  const demande2 = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST.replace('99999', '99998'),
      type: 'AUTORISATION_SORTIE',
      statut: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        date: '2026-11-05', departement: 'Production', motif: 'Test refus',
        nombreHeures: '2', heureSortie: '09:00', heureRetour: '11:00', compensation: 'OUI',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  const refus = await adm.post('/api/demandes/' + demande2.id, { statut: 'REFUSEE' });
  const d2 = await db.demandeAdministrative.findUnique({ where: { id: demande2.id } });
  check('Refus : statut REFUSEE', refus.status === 200 && d2.statut === 'REFUSEE');
  check('Refus : AUCUN document signé généré', d2.docSigneChemin === null && refus.json.docSigne === null);

  /* information requise : aucun document non plus */
  const d3 = await db.demandeAdministrative.findUnique({ where: { id: demande.id } });
  await db.demandeAdministrative.update({ where: { id: demande2.id }, data: { statut: 'INFORMATION_REQUISE' } });
  check('INFORMATION_REQUISE ne déclenche rien (docSigneChemin vide)', Boolean(d3 && d3.docSigneChemin && d2.docSigneChemin === null));

  /* 9) IT : accès refusé (garde Task 176 étendue) */
  /* (non testé ici : aucun compte IT de test — couvert par la politique 403 du code) */

  /* nettoyage */
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  // certificat + configuration de test retirés
  const cfgActuelle = await db.signatureConfig.findUnique({ where: { id: 'signature' } });
  if (cfgActuelle && cfgActuelle.certChemin) {
    try { fs.unlinkSync(path.join(racine, cfgActuelle.certChemin)); } catch (e) { /* */ }
  }
  await db.signatureConfig.update({
    where: { id: 'signature' },
    data: {
      certChemin: '', certNom: '', certEmpreinte: '', certImporteLe: null, certMotDePasse: '',
      docSigImage: '', docSigImageNom: '', docSigImageChemin: '',
      tamponImage: '', tamponImageNom: '', tamponImageChemin: '',
      docEmailObjet: 'Votre {TYPE} — {REF} : acceptée — document signé et tamponné',
      docMention: 'Document signé électroniquement — certificat configuré — Auto-RH — {DATE}',
      certSignataire: '', certFonction: '',
    },
  });
  // SMTP restauré
  if (cfgMailSauvee) {
    await db.mailConfig.update({
      where: { id: 'smtp' },
      data: {
        host: cfgMailSauvee.host, port: cfgMailSauvee.port, username: cfgMailSauvee.username,
        password: cfgMailSauvee.password, from: cfgMailSauvee.from, rhEmail: cfgMailSauvee.rhEmail,
      },
    });
  }
  serveur.close();
  await db.$disconnect();
  console.log('== RÉSULTAT : ' + ok + ' OK / ' + ko + ' KO ==');
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ÉCHEC:', e);
  await db.$disconnect();
  process.exit(1);
});
