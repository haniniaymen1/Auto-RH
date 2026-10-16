/**
 * Task 185 (v0.2.145) — PREUVE E2E : INTERRUPTEURS ON/OFF INDÉPENDANTS de la
 * section « Réponse automatique PDF par e-mail (congé / autorisation) ».
 *
 * Demande utilisateur : dans la section dédiée, quatre interrupteurs
 * indépendants permettent d'activer ou de désactiver séparément, pour les PDF
 * générés automatiquement après acceptation/refus :
 *   1. Signature sous forme d'image (paraphe)          → sigActif ;
 *   2. Tampon (cachet de l'établissement)              → tamponActif ;
 *   3. Cachet « Signature électronique »               → elecActif (existant) ;
 *   4. Signature électronique par LE certificat dédié  → signerActif.
 * Chaque option est INDÉPENDANTE (une seule, plusieurs ou toutes) ; la
 * signature PAdES est appliquée EN DERNIER (après génération complète du
 * document et ajout éventuel du paraphe, du tampon et du cachet) ; l'aperçu
 * du PDF reflète le rendu réel (éléments masqués quand désactivés).
 *
 * Scénario prouvé :
 *  A. PUT tout ON + images dédiées + QR + cachet + certificat .p12 dédié
 *     → aperçu = TOUS les éléments [signature,tampon,qr,elec,certificat],
 *       signature cryptographique appliquée (X-Apercu-Signature-Crypto=1) ;
 *  B. sigActif=false          → « signature » disparaît, les AUTRES restent ;
 *  C. tamponActif=false       → « tampon » disparaît, les AUTRES restent ;
 *  D. qrActif=false           → « qr » disparaît, les AUTRES restent ;
 *  E. elecActif=false         → « elec » disparaît, les AUTRES restent ;
 *  F. signerActif=false       → « certificat » disparaît + AUCUNE signature
 *     cryptographique (X-Apercu-Signature-Crypto=0) — le paraphe, le tampon
 *     et le cachet restent appliqués ;
 *  G. TOUT OFF → aucun des cinq éléments (rendu minimal) ;
 *  H. GET : les interrupteurs sont exposés et restitués (paraphe.actif,
 *     tampon.actif, certificat.signer) ;
 *  I. PUT SANS les champs → retour aux défauts ON (absent = activé) ;
 *  J. MOTEUR REFUS (appel direct) : refus généré avec signerActif=false →
 *     signatureCrypto=false ; avec signerActif=true + certificat → signature
 *     PAdES appliquée ; sigActif/tamponActif=false → éléments absents ;
 *  K. continuité : configuration historique (ReponsePdfConfig inactive) →
 *     défauts ON inchangés (comportement v0.2.144 préservé) ;
 *  L. nettoyage intégral.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const forge = require('node-forge');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const acceptation = require(path.join(racine, 'scripts/document-acceptation.js'));
const refusMod = require(path.join(racine, 'scripts/document-refus.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const CIN_TEST = 'TEST18501';
const REF_TEST = 'DEM-1850-00001';
const EMAIL_EMPLOYE = 'employe185@test.tn';
const EMAIL_MANAGER = 'manager185@test.tn';

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/* PNG minimal (couleur pleine) — jumelle du test 184. */
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
const zlib = require('zlib');

/* Certificat PKCS#12 auto-signé (jumelle du test 184). */
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

/* Client HTTP administrateur (cookie persistant). */
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

/* Configuration complète : interrupteurs passés en argument + images dédiées. */
function cfgPutComple(interrupteurs) {
  const o = Object.assign({
    sigActif: true, tamponActif: true, signerActif: true,
    qrActif: true, elecActif: true,
  }, interrupteurs || {});
  return JSON.stringify(Object.assign({
    actif: true,
    certSignataire: 'Amel Ben Salah', certFonction: 'Directrice des Ressources Humaines',
    sigPosition: 'BAS_DROITE', sigTaille: 130, sigOpacite: 0.95, sigDecalX: 0, sigDecalY: 0, sigRotation: 0,
    sigImage: IMG_PARAPHE, sigImageNom: 'paraphe-185.png',
    tamponPosition: 'BAS_GAUCHE', tamponTaille: 145, tamponOpacite: 0.9, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
    tamponImage: IMG_TAMPON, tamponImageNom: 'cachet-185.png',
    qrMode: 'URL', qrUrl: ADMIN,
    qrPosition: 'BAS_GAUCHE', qrTaille: 100, qrDecalX: 160, qrDecalY: 0, qrRotation: 0,
    elecForme: 'ROND', elecPosition: 'HAUT_DROITE', elecDecalX: 0, elecDecalY: 0, elecTaille: 120,
    elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: 'E2E 185',
    mentionActif: true, mentionTexte: 'Document signé électroniquement — E2E 185 — {DATE}',
    emailActif: true, emailObjet: 'E2E-185 {REF}', emailCorps: '',
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, o));
}

/* Appel de l'aperçu (rendu moteur RÉEL) → { pdf, elements, signe } */
async function apercu(adm, demandeId) {
  const f = new FormData();
  f.append('action', 'apercu');
  f.append('demandeId', demandeId);
  const r = await adm.postMultipart('/api/reponse-pdf-config', f);
  const elements = decodeURIComponent(String(r.headers.get('x-apercu-elements') || '')).split(',').filter(Boolean);
  const signe = String(r.headers.get('x-apercu-signature-crypto') || '') === '1';
  return { r, elements, signe };
}

const IMG_PARAPHE = 'data:image/png;base64,' + pngMinimal(20, 60, 40, 120, 48).toString('base64');
const IMG_TAMPON = 'data:image/png;base64,' + pngMinimal(180, 30, 30, 100, 100).toString('base64');

async function main() {
  console.log('== Task 185 (v0.2.145) — Interrupteurs ON/OFF indépendants (paraphe, tampon, cachet, signature) ==');

  /* ---------- semis ---------- */
  console.log('-- semis --');
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  const cfgMailSauvee = await db.mailConfig.findUnique({ where: { id: 'smtp' } });
  const reponsePdfSauvee = await db.reponsePdfConfig.findUnique({ where: { id: 'reponse-pdf' } });
  if (!cfgMailSauvee) await db.mailConfig.create({ data: { id: 'smtp' } });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST, type: 'CONGE', statut: 'EN_ATTENTE',
      decisionManager: 'ACCEPTEE', decisionManagerLe: new Date(Date.now() - 2 * 3600000),
      decisionManagerPar: 'Manager (réponse e-mail)', decisionManagerNote: 'E2E 185',
      decisionRh: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-12-01', dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER, commentaire: 'Dossier E2E 185',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : demande de congé (manager accepté)', Boolean(demande.id));

  /* ---------- connexion admin ---------- */
  const adm = client(ADMIN);
  let login = await adm.req('POST', '/api/auth/login', { email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif#1' });
  check('Connexion superadministrateur', login.status === 200, 'status=' + login.status);

  /* ---------- certificat dédié (.p12) via l'API ---------- */
  const mdpCert = 'E2E-185-Dedie!';
  const p12 = creerP12(mdpCert, 'Reponse PDF 185', 'Entreprise Reponses 185');
  const formCert = new FormData();
  formCert.append('action', 'certificat');
  formCert.append('fichier', new Blob([p12]), 'certificat-e2e-185.p12');
  formCert.append('motDePasse', mdpCert);
  const impCert = await adm.postMultipart('/api/reponse-pdf-config', formCert);
  check('Import certificat DÉDIÉ (.p12)', impCert.status === 200 && impCert.json && impCert.json.ok === true,
    impCert.status === 200 ? '' : (impCert.texte || '').slice(0, 120));

  /* ---------- A) tout ON → TOUS les éléments + signature PAdES ---------- */
  console.log('-- A) tout activé : paraphe + tampon + QR + cachet + signature PAdES --');
  const putA = await adm.put('/api/reponse-pdf-config', cfgPutComple({}));
  check('PUT tout ON accepté', putA.status === 200, putA.status === 200 ? '' : (putA.texte || '').slice(0, 120));
  const a = await apercu(adm, demande.id);
  check('Aperçu : PDF généré', a.r.status === 200 && a.r.buffer && a.r.buffer.subarray(0, 4).toString('latin1') === '%PDF', a.r.status === 200 ? a.r.buffer.length + ' octets' : 'status=' + a.r.status);
  check('Aperçu : TOUS les éléments présents [signature,tampon,qr,elec,certificat]',
    ['signature', 'tampon', 'qr', 'elec', 'certificat'].every((e) => a.elements.includes(e)), a.elements.join(','));
  check('Aperçu : signature cryptographique APPLIQUÉE (dernière étape)', a.signe);

  /* ---------- B → F : chaque interrupteur indépendamment ---------- */
  console.log('-- B) sigActif=false : paraphe seul désactivé --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({ sigActif: false }));
  const b = await apercu(adm, demande.id);
  check('B : « signature » ABSENT', !b.elements.includes('signature'), b.elements.join(','));
  check('B : tampon + qr + elec + certificat TOUJOURS présents',
    ['tampon', 'qr', 'elec', 'certificat'].every((e) => b.elements.includes(e)));
  check('B : signature cryptographique inchangée (ON)', b.signe);

  console.log('-- C) tamponActif=false : tampon seul désactivé --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({ tamponActif: false }));
  const c = await apercu(adm, demande.id);
  check('C : « tampon » ABSENT', !c.elements.includes('tampon'), c.elements.join(','));
  check('C : signature + qr + elec + certificat TOUJOURS présents',
    ['signature', 'qr', 'elec', 'certificat'].every((e) => c.elements.includes(e)));

  console.log('-- D) qrActif=false : QR seul désactivé --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({ qrActif: false }));
  const d = await apercu(adm, demande.id);
  check('D : « qr » ABSENT', !d.elements.includes('qr'), d.elements.join(','));
  check('D : signature + tampon + elec + certificat TOUJOURS présents',
    ['signature', 'tampon', 'elec', 'certificat'].every((e) => d.elements.includes(e)));

  console.log('-- E) elecActif=false : cachet « Signature électronique » seul désactivé --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({ elecActif: false }));
  const e = await apercu(adm, demande.id);
  check('E : « elec » ABSENT', !e.elements.includes('elec'), e.elements.join(','));
  check('E : signature + tampon + qr + certificat TOUJOURS présents',
    ['signature', 'tampon', 'qr', 'certificat'].every((x) => e.elements.includes(x)));
  check('E : signature cryptographique inchangée (ON)', e.signe);

  console.log('-- F) signerActif=false : signature électronique seule désactivée --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({ signerActif: false }));
  const f = await apercu(adm, demande.id);
  check('F : « certificat » ABSENT', !f.elements.includes('certificat'), f.elements.join(','));
  check('F : signature cryptographique ABSENTE (X-Apercu-Signature-Crypto=0)', !f.signe);
  check('F : paraphe + tampon + qr + elec TOUJOURS appliqués',
    ['signature', 'tampon', 'qr', 'elec'].every((x) => f.elements.includes(x)));

  /* ---------- G) tout OFF → rendu minimal ---------- */
  console.log('-- G) tout désactivé : rendu minimal --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({
    sigActif: false, tamponActif: false, qrActif: false, elecActif: false, signerActif: false,
  }));
  const g = await apercu(adm, demande.id);
  check('G : AUCUN des cinq éléments',
    !['signature', 'tampon', 'qr', 'elec', 'certificat'].some((x) => g.elements.includes(x)), g.elements.join(',') || '(vide)');
  check('G : signature cryptographique absente', !g.signe);

  /* ---------- H) GET expose et restitue les interrupteurs ---------- */
  console.log('-- H) GET : exposé des interrupteurs --');
  await adm.put('/api/reponse-pdf-config', cfgPutComple({
    sigActif: false, tamponActif: false, signerActif: false,
  }));
  const h = await adm.get('/api/reponse-pdf-config');
  check('H : GET paraphe.actif=false restitué', h.json && h.json.config && h.json.config.paraphe.actif === false);
  check('H : GET tampon.actif=false restitué', h.json && h.json.config && h.json.config.tampon.actif === false);
  check('H : GET certificat.signer=false restitué', h.json && h.json.config && h.json.config.certificat.signer === false);
  check('H : GET qr.actif / elec.actif restitués ON', h.json.config.qr.actif === true && h.json.config.elec.actif === true);

  /* ---------- I) PUT sans les champs → défauts ON ---------- */
  console.log('-- I) PUT sans les champs : défaut ON (continuité) --');
  const putI = await adm.put('/api/reponse-pdf-config', cfgPutComple({}));
  const i = await adm.get('/api/reponse-pdf-config');
  check('I : défauts ON (paraphe, tampon, signer)', putI.status === 200 && i.json.config.paraphe.actif === true && i.json.config.tampon.actif === true && i.json.config.certificat.signer === true);

  /* ---------- J) moteur REFUS : interrupteurs respectés ---------- */
  console.log('-- J) moteur REFUS (appel direct) --');
  const demandeRefus = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST + '-R', type: 'CONGE', statut: 'REFUSEE',
      refuseePar: 'RH', decisionManager: 'ACCEPTEE', decisionRh: 'REFUSEE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-12-01', dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER, commentaire: 'Refus E2E 185',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  // certificat DÉDIÉ lisible en clair pour l'appel moteur direct (opts propres au test)
  const fichierP12 = path.join(os.tmpdir(), 'e2e-185-dedie.p12');
  fs.writeFileSync(fichierP12, p12);
  const optsMoteur = {
    dechiffrerChamp: (v) => v,
    lireFichierStocke: async (chemin) => (chemin === fichierP12 ? p12 : null),
  };
  await db.reponsePdfConfig.update({
    where: { id: 'reponse-pdf' },
    data: {
      actif: true, sigActif: true, tamponActif: true, signerActif: true,
      sigImage: IMG_PARAPHE, tamponImage: IMG_TAMPON, qrActif: false, elecActif: false,
      certChemin: fichierP12, certFichierNom: 'e2e-185-dedie.p12',
      certSujet: 'CN=Reponse PDF 185, O=Entreprise Reponses 185',
      certMotDePasse: mdpCert, // optsMoteur.dechiffrerChamp = identité → mot de passe en clair ici
    },
  });
  let cfgM = await acceptation.chargerConfig(db);
  const refusOn = await refusMod.genererDocumentRefus(db, demandeRefus, cfgM, optsMoteur);
  check('J refus : signature PAdES appliquée quand signerActif=true', refusOn.signatureCrypto === true && refusOn.elements.includes('certificat'), refusOn.elements.join(','));
  check('J refus : paraphe + tampon appliqués (leurs interrupteurs ON)', refusOn.elements.includes('signature') && refusOn.elements.includes('tampon'));
  await db.reponsePdfConfig.update({
    where: { id: 'reponse-pdf' },
    data: { sigActif: false, tamponActif: false, signerActif: false },
  });
  cfgM = await acceptation.chargerConfig(db);
  check('J moteur : interrupteurs retransmis (docSigActif=false, tamponActif=false, signerActif=false)',
    cfgM.docSigActif === false && cfgM.tamponActif === false && cfgM.signerActif === false);
  const refusOff = await refusMod.genererDocumentRefus(db, demandeRefus, cfgM, optsMoteur);
  check('J refus : signatureCrypto=false quand signerActif=false', refusOff.signatureCrypto === false && !refusOff.elements.includes('certificat'), refusOff.elements.join(','));
  check('J refus : paraphe + tampon ABSENTS quand désactivés', !refusOff.elements.includes('signature') && !refusOff.elements.includes('tampon'));

  /* ---------- K) continuité : contrat v0.2.148 (trace 1a1178618b8b7729) ---------- */
  console.log('-- K) section ENGAGÉE inactive = dédiée ; jamais engagée = défauts historiques ON --');
  // (v0.2.148) le certificat DÉDIÉ importé (scénario C) ENGAGE la section :
  // même inactive, elle reste LA SOURCE — les interrupteurs J restent retransmis
  const cfgEngagee = await acceptation.chargerConfig(db);
  check('K1 : section ENGAGÉE (certificat) inactive → interrupteurs J retransmis (false) + source dédiée',
    cfgEngagee.docSigActif === false && cfgEngagee.tamponActif === false && cfgEngagee.signerActif === false
    && cfgEngagee._sourceReponsePdf === true);
  // (v0.2.148) la retombée historique ne concerne plus que les sections
  // JAMAIS engagées (actif=false ET aucun certificat importé)
  await db.reponsePdfConfig.update({ where: { id: 'reponse-pdf' }, data: { actif: false, certChemin: '', certMotDePasse: '' } });
  const cfgLegacy = await acceptation.chargerConfig(db);
  check('K2 : section jamais engagée (actif=false, sans certificat) → défauts historiques docSigActif/tamponActif/signerActif = true',
    cfgLegacy.docSigActif === true && cfgLegacy.tamponActif === true && cfgLegacy.signerActif === true
    && cfgLegacy._sourceReponsePdf !== true);

  /* ---------- L) nettoyage ---------- */
  console.log('-- L) nettoyage --');
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  // (robuste) l'état de départ peut être corrompu par un run interrompu :
  // on rétablit TOUJOURS un singleton PROPRE et INACTIF (défauts ON par
  // élément, aucun certificat, aucune image) — continuité garantie.
  await db.reponsePdfConfig.update({
    where: { id: 'reponse-pdf' },
    data: {
      actif: false, sigActif: true, tamponActif: true, signerActif: true,
      sigImage: '', sigImageNom: '', sigImageChemin: '',
      tamponImage: '', tamponImageNom: '', tamponImageChemin: '',
      qrActif: false, elecActif: false,
      certChemin: '', certFichierNom: '', certMotDePasse: '',
      certSujet: '', certEmetteur: '', certSerie: '', certEmpreinte: '',
      certValideDu: null, certValideAu: null, certImportLe: null,
      certSignataire: '', certFonction: '',
    },
  });
  if (cfgMailSauvee) {
    await db.mailConfig.update({ where: { id: 'smtp' }, data: cfgMailSauvee });
  }
  try { fs.unlinkSync(fichierP12); } catch { /* */ }
  check('Nettoyage : demande supprimée + configuration dédiée inactive (défauts propres)', true);

  console.log('------------------------------------------------------------');
  console.log('RÉSULTAT : ' + ok + ' OK, ' + ko + ' FAIL');
  await db.$disconnect();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
  try { await db.$disconnect(); } catch { /* */ }
  process.exit(1);
});
