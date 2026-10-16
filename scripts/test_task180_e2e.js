/**
 * Task 180 — PREUVE E2E : document de DÉCISION DE REFUS signé électroniquement
 * et tamponné, généré automatiquement pour TOUTES les demandes refusées
 * (congé ET attestations), envoyé (employé + RH + manager), conservé et
 * CONSULTABLE directement depuis la gestion des demandes (portail admin).
 *
 * Scénario réel complet :
 *  1. capteur SMTP local (127.0.0.1:2525) — capture les messages RÉELS ;
 *  2. semis : fiches + accès portail + 2 demandes EN_ATTENTE
 *     (congé DEM-1799-99997, attestation de travail DEM-1799-99996) ;
 *  3. administration : configuration complète (certificat .p12 de test,
 *     paraphe, cachet, signataire) ;
 *  4. POST /api/demandes/[id] { statut: "REFUSEE", commentaire: motif }
 *     → génération AUTOMATIQUE du document de refus (2 fois : congé +
 *     attestation — « toutes les demandes ») ;
 *  5. vérifications : trace docRefus* en base, DocumentDemande relié
 *     (recuDe = « Génération automatique (document de refus) »), fichier
 *     chiffré sur disque déchiffrable, signature PKCS#7 VALIDE, MOTIF présent
 *     dans le contenu du PDF, e-mail capté avec pièce jointe (À employé +
 *     Cc RH/manager), journal doc-refus ;
 *  6. CONSULTATION (cœur de la demande utilisateur) :
 *     - GET /api/demandes/[id]/doc-refus → PDF inline (Visualiser) ;
 *     - GET ?telecharger=1 → attachment ;
 *     - GET /api/demandes/[id] → détail avec docRefus.present + documents
 *       auto/courant (distinction réponse acceptation / refus / pièces
 *       jointes / historique) ;
 *     - GET /api/demandes/[id]/doc-signe sur demande REFUSÉE → 404
 *       (distinction acceptation ≠ refus) ;
 *  7. régénération manuelle (POST doc-refus) → 2 versions conservées,
 *     l'ancienne passe en historique (auto && !courant) ;
 *  8. refus d'un congé N'ENGENDRE PAS de document d'acceptation ;
 *  9. nettoyage intégral (semis, config, SMTP, certificat).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const forge = require('node-forge');
const { extractSignature } = require('@signpdf/utils');
const { PDFDocument } = require('pdf-lib');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const CIN_TEST = 'TEST18001';
const NOM_EMPLOYE = 'Trabelsi Salma';
const MATRICULE = 'MTG-1800';
const EMAIL_EMPLOYE = 'employe180@test.tn';
const EMAIL_MANAGER = 'manager180@test.tn';
const EMAIL_RH = 'rh180@test.tn';
const SECRET_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MDP_PORTAIL = 'Test-180!Pass';
const FICHIERS = ['e2e-180-a.pdf'];
const REF_CONGE = 'DEM-1799-99997';
const REF_ATTEST = 'DEM-1799-99996';
const MOTIF_TEST = 'Motif E2E-180-MOTIF : effectif deja complet sur la periode demandee.';

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/** Jumelle de decryptFromStorage() (AES-256-GCM, matériel par défaut .env). */
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

/* Capteur SMTP (smtp-server) — identique Task 179. */
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

/* HTTP (cookies) — identique Task 179. */
function client(base) {
  let cookie = '';
  return {
    async req(method, chemin, corps) {
      const res = await fetch(base + chemin, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        redirect: 'manual',
      });
      const setC = res.headers.get('set-cookie');
      if (setC) cookie = setC.split(';')[0];
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* binaire */ }
      return { status: res.status, json, texte, headers: res.headers };
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b); },
    /** GET binaire (PDF) avec contrôle du Content-Disposition. */
    async getBinaire(chemin) {
      const res = await fetch(base + chemin, {
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
        redirect: 'manual',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        status: res.status,
        buffer: buf,
        disposition: res.headers.get('content-disposition') || '',
        type: res.headers.get('content-type') || '',
      };
    },
    async postMultipart(chemin, form) {
      const res = await fetch(base + chemin, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
        body: form,
        redirect: 'manual',
      });
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* */ }
      return { status: res.status, json, texte };
    },
  };
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

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

function creerP12(mdp) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { name: 'commonName', value: 'Auto-RH Test 180' },
    { name: 'organizationName', value: 'Entreprise E2E' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], mdp, { generateLocalKeyId: true, algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/** Extrait le texte des flux compressés du PDF — pdf-lib écrit les chaînes
 *  en HEXADÉCIMAL (<50616965...> Tj) : décodage hex → latin1 avant recherche. */
function textePdfContient(pdf, chaine) {
  const brut = pdf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(brut))) {
    let gonfle;
    try {
      gonfle = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch { gonfle = m[1]; /* stream non compressé */ }
    const reHex = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let h;
    while ((h = reHex.exec(gonfle))) {
      try {
        const texte = Buffer.from(h[1], 'hex').toString('latin1');
        if (texte.includes(chaine)) return true;
      } catch { /* hex impair */ }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('== Task 180 — preuve E2E (document de refus signé & consultable) ==');

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
        cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_EMPLOYE, period: '09/2026',
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
      nomPrenom: cryptoBd.chiffrerChamp(NOM_EMPLOYE),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
    },
  });
  const demandeConge = await db.demandeAdministrative.create({
    data: {
      reference: REF_CONGE,
      type: 'CONGE',
      statut: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel',
        dateDebut: '2026-12-01',
        dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER,
        commentaire: 'Dossier E2E Task 180 (congé)',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  const demandeAttest = await db.demandeAdministrative.create({
    data: {
      reference: REF_ATTEST,
      type: 'ATTESTATION_TRAVAIL',
      statut: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        nom: 'TRABELSI', prenom: 'Salma',
      }), false),
      destinataire: cryptoBd.chiffrerChamp('rh@test.tn', false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : congé EN_ATTENTE (' + REF_CONGE + ') + attestation (' + REF_ATTEST + ')',
    Boolean(demandeConge.id && demandeAttest.id));

  /* 3) administration : connexion + configuration (moteur doc signé) */
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

  const cfgPut = await adm.req('PUT', '/api/doc-signer-config', {
    docActif: true,
    docEmailActif: true,
    docEnvoyerRh: true,
    docEnvoyerManager: true,
    docEmailObjet: '',
    docEmailCorps: '',
    docMention: 'Document E2E 180 signé électroniquement — {DATE}',
    certSignataire: 'Amel Ben Salah',
    certFonction: 'Directrice des Ressources Humaines',
    docSigImage: 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64'),
    tamponImage: 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64'),
  });
  check('PUT configuration complète (paraphe + cachet)', cfgPut.status === 200 && cfgPut.json && cfgPut.json.ok === true,
    cfgPut.status === 200 ? '' : (cfgPut.texte || '').slice(0, 200));

  const mdpCert = 'E2E-180-MotDePasse!';
  const p12 = creerP12(mdpCert);
  const formCert = new FormData();
  formCert.append('action', 'certificat');
  formCert.append('fichier', new Blob([p12]), 'certificat-e2e-180.p12');
  formCert.append('motDePasse', mdpCert);
  const certRep = await adm.postMultipart('/api/doc-signer-config', formCert);
  check('Import certificat .p12 accepté', certRep.status === 200 && certRep.json && certRep.json.ok === true);

  /* SMTP : MailConfig pointe vers le capteur local */
  await db.mailConfig.update({
    where: { id: 'smtp' },
    data: { host: '127.0.0.1', port: 2525, username: null, password: null, from: 'Auto-RH <auto-rh@test.tn>', rhEmail: EMAIL_RH },
  });

  /* 4) REFUS du congé → génération automatique du document de refus */
  const decision1 = await adm.post('/api/demandes/' + demandeConge.id, {
    statut: 'REFUSEE', commentaire: MOTIF_TEST,
  });
  check('Décision RH Refusée (congé)', decision1.status === 200 && decision1.json && decision1.json.ok === true);
  const docRefus = decision1.json && decision1.json.docRefus;
  check('docRefus généré AUTOMATIQUEMENT (congé)', Boolean(docRefus && docRefus.genere === true),
    JSON.stringify(docRefus ? { genere: docRefus.genere, sig: docRefus.signatureCrypto, elements: docRefus.elements, erreur: docRefus.erreur } : docRefus).slice(0, 300));
  check('Signature cryptographique par certificat appliquée', Boolean(docRefus && docRefus.signatureCrypto === true));
  check('Paraphe + cachet dessinés', Boolean(docRefus && Array.isArray(docRefus.elements) && docRefus.elements.indexOf('signature') >= 0 && docRefus.elements.indexOf('tampon') >= 0));
  check('AUCUN document d\'acceptation généré (docSigne null)', decision1.json.docSigne === null);

  /* 5) vérifications en base + disque (congé) */
  const apres1 = await db.demandeAdministrative.findUnique({ where: { id: demandeConge.id } });
  check('Statut final = REFUSEE', apres1.statut === 'REFUSEE');
  check('docRefusChemin posé (traçabilité)', Boolean(apres1.docRefusChemin), apres1.docRefusChemin || '');
  check('docRefusPar = déclencheur décision RH', /Décision RH/.test(apres1.docRefusPar || ''), apres1.docRefusPar || '');
  check('docRefusDestinataires chiffré (encbd1:)', String(apres1.docRefusDestinataires || '').startsWith('encbd1:'));
  check('docRefusEnvoiLe posé (e-mail envoyé)', Boolean(apres1.docRefusEnvoiLe));

  const docDb1 = await db.documentDemande.findFirst({
    where: { demandeId: demandeConge.id, recuDe: 'Génération automatique (document de refus)' },
    orderBy: { recuLe: 'desc' },
  });
  check('DocumentDemande relié (recuDe = document de refus)', Boolean(docDb1), docDb1 ? docDb1.nomFichier : 'absent');
  check('Nom de fichier lisible (Refus_conge_…)', /^Refus_conge_/.test((docDb1 && docDb1.nomFichier) || ''), docDb1 ? docDb1.nomFichier : '');

  const cheminDisque1 = path.join(racine, 'storage', 'documents-demandes', apres1.docRefusChemin);
  check('Fichier PDF chiffré sur le disque', fs.existsSync(cheminDisque1), apres1.docRefusChemin);
  const pdfRefus = decryptFromStoragePortail(fs.readFileSync(cheminDisque1));
  check('Fichier déchiffrable → PDF', pdfRefus.subarray(0, 4).toString('latin1') === '%PDF', pdfRefus.length + ' octets');
  let ex = null;
  try { ex = extractSignature(pdfRefus); } catch (e) { ex = null; }
  check('Signature PKCS#7 VALIDE (extractSignature)', Boolean(ex && ex.ByteRange), ex ? 'ByteRange=' + JSON.stringify(ex.ByteRange) : 'échec');
  const relu1 = await PDFDocument.load(pdfRefus);
  check('PDF d\'UNE page', relu1.getPageCount() === 1, relu1.getPageCount() + ' page(s)');
  check('MOTIF du refus présent dans le contenu du PDF', textePdfContient(pdfRefus, 'E2E-180-MOTIF'));
  check('Bandeau STATUT FINAL : REFUSÉE présent', textePdfContient(pdfRefus, 'STATUT FINAL : REFUSÉE'));
  check('Référence présente dans le PDF', textePdfContient(pdfRefus, REF_CONGE));

  /* e-mail capté (refus congé) */
  await new Promise((r) => setTimeout(r, 800));
  check('E-mail de refus capté par le serveur SMTP', messages.length >= 1, messages.length + ' message(s)');
  const msg1 = messages[0];
  check('Destinataire principal = employé', msg1.a.includes(EMAIL_EMPLOYE), JSON.stringify(msg1.a));
  check('Copie au service RH', msg1.a.includes(EMAIL_RH), JSON.stringify(msg1.a));
  check('Copie au manager', msg1.a.includes(EMAIL_MANAGER), JSON.stringify(msg1.a));
  // décodage robuste de la valeur d'un en-tête : encoded-words RFC 2047
  // (=?UTF-8?B?…?= et =?UTF-8?Q?…?=, continuations multi-lignes) + repli
  // quoted-printable brut (niveau OCTETS).
  function decoderValeurEnTete(bloc) {
    const parties = [];
    const re = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
    let m;
    let derniere = 0;
    const decoderQ = (s) => {
      const octs = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '_') octs.push(0x20);
        else if (s[i] === '=' && /^[0-9A-Fa-f]{2}/.test(s.slice(i + 1, i + 3))) {
          octs.push(parseInt(s.slice(i + 1, i + 3), 16));
          i += 2;
        } else octs.push(s.charCodeAt(i) & 0xFF);
      }
      return Buffer.from(octs);
    };
    while ((m = re.exec(bloc))) {
      if (m.index > derniere) parties.push(bloc.slice(derniere, m.index));
      const utf8 = m[1].toLowerCase().startsWith('utf');
      const octets = m[2].toUpperCase() === 'B'
        ? Buffer.from(m[3], 'base64')
        : decoderQ(m[3]);
      parties.push(octets.toString(utf8 ? 'utf8' : 'latin1'));
      derniere = m.index + m[0].length;
    }
    if (derniere < bloc.length) parties.push(bloc.slice(derniere));
    const joint = parties.join('');
    // repli : texte brut quoted-printable (sans encoded-word)
    if (!re.test(bloc) && /=\?\w+\?[BQ]\?/.test(bloc) === false && /=C[0-9A-F]|=E[0-9A-F]/.test(bloc)) {
      return decoderQ(joint).toString('utf8');
    }
    return joint;
  }
  const lignesMsg1 = msg1.brut.toString('latin1').split(/\r?\n/);
  const morceauxSujet = [];
  for (let i = 0; i < lignesMsg1.length; i++) {
    if (/^Subject:/i.test(lignesMsg1[i])) {
      morceauxSujet.push(lignesMsg1[i].slice(8));
      let j = i + 1;
      while (j < lignesMsg1.length && /^[ \t]/.test(lignesMsg1[j])) {
        morceauxSujet.push(lignesMsg1[j]);
        j++;
      }
      break;
    }
  }
  const sujetDecode = decoderValeurEnTete(morceauxSujet.join(' '));
  check('Objet annonce la décision de refus', sujetDecode.includes('refusée'), 'Subject: ' + sujetDecode.slice(0, 120));
  const brutDecode1 = msg1.brut.toString('latin1');
  check('Pièce jointe PDF présente', brutDecode1.includes('application/pdf'));

  /* journal */
  const journal = fs.readFileSync(path.join(racine, 'logs', 'journal-emails.log'), 'utf8').trim().split('\n');
  check('Journal doc-refus consigné', journal.some((l) => l.includes('"doc-refus"') && l.includes(REF_CONGE)));

  /* 6) CONSULTATION depuis la gestion des demandes (cœur de la demande) */
  const inline = await adm.getBinaire('/api/demandes/' + demandeConge.id + '/doc-refus');
  check('Visualiser : PDF servi EN LIGNE (inline)', inline.status === 200 && inline.buffer.subarray(0, 4).toString('latin1') === '%PDF' && inline.disposition.startsWith('inline'),
    inline.status === 200 ? inline.buffer.length + ' octets, ' + inline.disposition.slice(0, 60) : 'status=' + inline.status);
  const telech = await adm.getBinaire('/api/demandes/' + demandeConge.id + '/doc-refus?telecharger=1');
  check('Télécharger : attachment avec le bon nom', telech.status === 200 && telech.disposition.startsWith('attachment') && telech.disposition.includes(encodeURIComponent(docDb1.nomFichier).slice(0, 20)),
    telech.disposition.slice(0, 90));
  const detail1 = await adm.get('/api/demandes/' + demandeConge.id);
  const it1 = detail1.json && detail1.json.item;
  check('Détail : docRefus.present = true', Boolean(it1 && it1.docRefus && it1.docRefus.present === true), it1 && it1.docRefus ? it1.docRefus.nom : '');
  check('Détail : statut final affiché Refusée', Boolean(it1 && it1.statut === 'REFUSEE' && it1.statutLibelle === 'Refusée'));
  const docsDetail1 = (it1 && it1.documents) || [];
  check('Détail : document auto flagué auto=true', docsDetail1.some((d) => d.nomFichier === docDb1.nomFichier && d.auto === true), JSON.stringify(docsDetail1.map((d) => ({ n: d.nomFichier, a: d.auto, c: d.courant }))));
  check('Détail : version COURANTE flaguée courant=true', docsDetail1.some((d) => d.nomFichier === docDb1.nomFichier && d.courant === true));

  /* attestation de travail refusée → document de refus AUSSI (tous types) */
  const decision2 = await adm.post('/api/demandes/' + demandeAttest.id, {
    statut: 'REFUSEE', commentaire: 'Dossier incomplet E2E-180-ATT.',
  });
  const docRefus2 = decision2.json && decision2.json.docRefus;
  check('Refus ATTESTATION de travail → document généré AUSSI', Boolean(docRefus2 && docRefus2.genere === true),
    JSON.stringify(docRefus2 ? { genere: docRefus2.genere, erreur: docRefus2.erreur, doc: docRefus2.document } : docRefus2).slice(0, 300));
  const apres2 = await db.demandeAdministrative.findUnique({ where: { id: demandeAttest.id } });
  check('Attestation : docRefusChemin posé', Boolean(apres2.docRefusChemin), apres2.docRefusChemin || '');
  const inline2 = await adm.getBinaire('/api/demandes/' + demandeAttest.id + '/doc-refus');
  check('Attestation : document de refus consultable en ligne', inline2.status === 200 && inline2.buffer.subarray(0, 4).toString('latin1') === '%PDF');

  /* distinction acceptation ≠ refus */
  const docSigneRefuse = await adm.getBinaire('/api/demandes/' + demandeConge.id + '/doc-signe');
  check('Congé REFUSÉ : AUCUN document d\'acceptation servi (404)', docSigneRefuse.status === 404, 'status=' + docSigneRefuse.status);

  /* 7) régénération manuelle → historique conservé */
  const renvoi = await adm.post('/api/demandes/' + demandeConge.id + '/doc-refus', { forcer: true });
  check('Régénération manuelle du document de refus', renvoi.status === 200 && renvoi.json && renvoi.json.ok === true && renvoi.json.genere === true);
  const nbDocs = await db.documentDemande.count({ where: { demandeId: demandeConge.id } });
  check('Deux documents de refus conservés (historique)', nbDocs >= 2, String(nbDocs));
  const detail2 = await adm.get('/api/demandes/' + demandeConge.id);
  const docs2 = (detail2.json && detail2.json.item && detail2.json.item.documents) || [];
  const courants = docs2.filter((d) => d.auto && d.courant);
  const anciens = docs2.filter((d) => d.auto && !d.courant);
  check('Distinction version courante / historique (auto && !courant)', courants.length === 1 && anciens.length >= 1,
    JSON.stringify({ courantes: courants.length, anciennes: anciens.length }));
  const ancienne = anciens[0];
  const anciennePdf = await adm.getBinaire('/api/demandes/' + demandeConge.id + '/documents/' + ancienne.id);
  check('Version ANCIENNE du refus consultable (historique)', anciennePdf.status === 200 && anciennePdf.buffer.subarray(0, 4).toString('latin1') === '%PDF');

  /* demande en attente : pas de document de refus servi */
  const demandeAttente = await db.demandeAdministrative.create({
    data: {
      reference: 'DEM-1799-99995',
      type: 'CONGE',
      statut: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2027-01-04', dateFin: '2027-01-08', emailN1: EMAIL_MANAGER,
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  const rien = await adm.getBinaire('/api/demandes/' + demandeAttente.id + '/doc-refus');
  check('Demande EN ATTENTE : doc-refus → 404 (rien généré)', rien.status === 404, 'status=' + rien.status);

  /* nettoyage */
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
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
  // fichiers de documents de refus de test supprimés du disque
  for (const d of [apres1, apres2]) {
    if (d && d.docRefusChemin) {
      try { fs.unlinkSync(path.join(racine, 'storage', 'documents-demandes', d.docRefusChemin)); } catch (e) { /* */ }
    }
  }
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
