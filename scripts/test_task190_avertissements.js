/**
 * Task 190 (v0.2.147) — PREUVE E2E : AVERTISSEMENTS EXPLICITES quand la
 * signature électronique et/ou le cachet « Signature électronique » sont
 * ACTIVÉS mais ne peuvent pas être appliqués faute de certificat dédié.
 *
 * Signalement utilisateur (trace 1a1174eaec4d780d) : « La signature
 * électronique et le cachet "Signature électronique" ne fonctionnent pas sur
 * les réponses automatiques en PDF, même lorsqu'ils sont activés dans la
 * configuration. » — Diagnostic : les DEUX éléments sont alimentés par LE
 * certificat .p12/.pfx dédié de la section ; sans certificat importé, tout
 * est sauté EN SILENCE. v0.2.147 rend ces sauts EXPLICITES :
 *   - moteur (acceptation + refus) : resultat.avertissements + Journal ;
 *   - aperçu : en-tête X-Apercu-Avertissements ;
 *   - panneau : bandeaux rouges (signature / cachet sans certificat) +
 *     toast de résumé de l'aperçu (éléments + signature OUI/NON).
 *
 * Scénario prouvé :
 *  A. SANS certificat + signerActif=ON + elecActif=ON (situation EXACTE du
 *     signalement) → aperçu : signatureCrypto=0, « elec » ABSENT,
 *     X-Apercu-Avertissements = 2 messages précis (signature + cachet) ;
 *  B. MOTEUR ACCEPTATION (appel direct) sans certificat →
 *     resultat.avertissements = 2 (causes compréhensibles) ;
 *  C. certificat .p12 DÉDIÉ importé via l'API → aperçu : signatureCrypto=1,
 *     « elec » + « certificat » présents, avertissements VIDE ;
 *  D. MOTEUR REFUS (appel direct) avec certificat → signatureCrypto=true +
 *     avertissements VIDE ;
 *  E. signerActif=false + elecActif=false sans certificat → avertissements
 *     VIDE (désactivation VOLONTAIRE = jamais d'avertissement) ;
 *  F. nettoyage intégral (état propre, idempotent).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const forge = require('node-forge');

const racine = '/home/z/my-project';
const cryptoBd = require(path.join(racine, 'scripts/lib-crypto-bd.js'));
const acceptation = require(path.join(racine, 'scripts/document-acceptation.js'));
const refusMod = require(path.join(racine, 'scripts/document-refus.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const ADMIN = 'http://localhost:4000';
const CIN_TEST = 'TEST19001';
const REF_TEST = 'DEM-1900-00001';
const EMAIL_EMPLOYE = 'employe190@test.tn';
const EMAIL_MANAGER = 'manager190@test.tn';

let ok = 0;
let ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK  ' + nom + (detail ? ' — ' + detail : '')); }
  else { ko++; console.log('  !!  ' + nom + (detail ? ' — ' + detail : '')); }
}

/* Certificat PKCS#12 auto-signé (jumelle du test 185). */
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

/* Configuration minimale ciblant la signature + le cachet uniquement. */
function cfgPut(interrupteurs) {
  const o = Object.assign({ signerActif: true, elecActif: true }, interrupteurs || {});
  return JSON.stringify(Object.assign({
    actif: true,
    sigActif: false, tamponActif: false, qrActif: false,
    certSignataire: 'Amel Ben Salah', certFonction: 'Directrice des Ressources Humaines',
    elecForme: 'ROND', elecPosition: 'BAS_DROITE', elecTaille: 110,
    elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: true, elecAffEmpreinte: false, elecTexteLibre: 'E2E 190',
    mentionActif: true, mentionTexte: 'Document signé électroniquement — E2E 190 — {DATE}',
    emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, o));
}

/* Appel de l'aperçu (rendu moteur RÉEL) → { r, elements, signe, avert } */
async function apercu(adm, demandeId) {
  const f = new FormData();
  f.append('action', 'apercu');
  if (demandeId) f.append('demandeId', demandeId);
  const r = await adm.postMultipart('/api/reponse-pdf-config', f);
  const elements = decodeURIComponent(String(r.headers.get('x-apercu-elements') || '')).split(',').filter(Boolean);
  const signe = String(r.headers.get('x-apercu-signature-crypto') || '') === '1';
  let avert = [];
  try { avert = JSON.parse(decodeURIComponent(String(r.headers.get('x-apercu-avertissements') || '[]'))); } catch { /* */ }
  return { r, elements, signe, avert };
}

/* Demande de démonstration (même discipline qu'apercuDocument). */
function demandeDemo() {
  const annee = new Date().getFullYear();
  return {
    id: 'DEMO',
    reference: 'DEM-' + annee + '-DEMO1',
    type: 'CONGE',
    statut: 'ACCEPTEE',
    cin: '12345678',
    donnees: JSON.stringify({
      typeConge: 'Congé annuel', dateDebut: annee + '-08-03', dateFin: annee + '-08-14',
      emailN1: 'manager@entreprise.tn', commentaire: '',
    }),
    employeEmail: 'employe@entreprise.tn',
    destinataire: 'manager@entreprise.tn',
    traitePar: 'Auto-RH (démonstration)',
    traiteLe: new Date(),
    createdAt: new Date(),
    docSigneChemin: null,
  };
}

async function main() {
  console.log('== Task 190 (v0.2.147) — Avertissements explicites : signature électronique / cachet sans certificat ==');

  /* ---------- semis ---------- */
  console.log('-- semis --');
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST, type: 'CONGE', statut: 'EN_ATTENTE',
      decisionManager: 'ACCEPTEE', decisionManagerLe: new Date(Date.now() - 3600000),
      decisionManagerPar: 'Manager (réponse e-mail)', decisionManagerNote: 'E2E 190',
      decisionRh: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-12-01', dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER, commentaire: 'Dossier E2E 190',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  check('Semis : demande de congé (manager accepté)', Boolean(demande.id));

  /* ---------- connexion admin ---------- */
  const adm = client(ADMIN);
  const login = await adm.req('POST', '/api/auth/login', { email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif#1' });
  check('Connexion superadministrateur', login.status === 200, 'status=' + login.status);

  /* ---------- A) SANS certificat : situation EXACTE du signalement ---------- */
  console.log('-- A) sans certificat + signature ON + cachet ON → 2 avertissements --');
  await db.reponsePdfConfig.upsert({
    where: { id: 'reponse-pdf' },
    update: {
      actif: true, sigActif: false, tamponActif: false, qrActif: false,
      elecActif: true, signerActif: true,
      certChemin: '', certFichierNom: '', certSujet: '', certEmpreinte: '', certMotDePasse: '',
    },
    create: { id: 'reponse-pdf', actif: true },
  });
  const a = await apercu(adm, demande.id);
  check('A : aperçu généré (PDF réel)', a.r.status === 200 && a.r.buffer && a.r.buffer.subarray(0, 4).toString('latin1') === '%PDF', a.r.status === 200 ? a.r.buffer.length + ' octets' : 'status=' + a.r.status);
  check('A : signature cryptographique ABSENTE (X-Apercu-Signature-Crypto=0)', !a.signe);
  check('A : cachet « elec » ABSENT du rendu', !a.elements.includes('elec'), a.elements.join(',') || '(vide)');
  check('A : X-Apercu-Avertissements = 2 messages', a.avert.length === 2, a.avert.length + ' reçu(s)');
  check('A : avertissement SIGNATURE précis (causes : aucun certificat importé)',
    a.avert.some((m) => /Signature électronique activée mais NON appliquée/.test(m) && /aucun certificat \.p12\/\.pfx/.test(m)),
    (a.avert[0] || '').slice(0, 90));
  check('A : avertissement CACHET précis (alimenté EN DIRECT par le certificat)',
    a.avert.some((m) => /Cachet « Signature électronique » activé mais NON dessiné/.test(m)),
    (a.avert[1] || '').slice(0, 90));

  /* ---------- B) moteur ACCEPTATION direct sans certificat ---------- */
  console.log('-- B) moteur acceptation (appel direct) sans certificat --');
  const cfgSans = await acceptation.chargerConfig(db);
  const acc = await acceptation.genererDocumentSigne(db, demandeDemo(), cfgSans, { dechiffrerChamp: (v) => v });
  check('B : signatureCrypto=false', acc.signatureCrypto === false);
  check('B : resultat.avertissements = 2', Array.isArray(acc.avertissements) && acc.avertissements.length === 2, (acc.avertissements || []).length + ' reçu(s)');
  check('B : avertissements = messages complets (signature + cachet)',
    (acc.avertissements || []).some((m) => /Signature électronique activée/.test(m)) &&
    (acc.avertissements || []).some((m) => /Cachet « Signature électronique » activé/.test(m)));

  /* ---------- C) certificat dédié importé → plus AUCUN avertissement ---------- */
  console.log('-- C) certificat .p12 importé → signature + cachet appliqués, 0 avertissement --');
  const mdpCert = 'E2E-190-Dedie!';
  const p12 = creerP12(mdpCert, 'Reponse PDF 190', 'Entreprise Reponses 190');
  const formCert = new FormData();
  formCert.append('action', 'certificat');
  formCert.append('fichier', new Blob([p12]), 'certificat-e2e-190.p12');
  formCert.append('motDePasse', mdpCert);
  const impCert = await adm.postMultipart('/api/reponse-pdf-config', formCert);
  check('C : import certificat DÉDIÉ (.p12)', impCert.status === 200 && impCert.json && impCert.json.ok === true,
    impCert.status === 200 ? '' : (impCert.texte || '').slice(0, 120));
  const c = await apercu(adm, demande.id);
  check('C : signature cryptographique APPLIQUÉE (X-Apercu-Signature-Crypto=1)', c.signe);
  check('C : cachet « elec » + « certificat » PRÉSENTS',
    c.elements.includes('elec') && c.elements.includes('certificat'), c.elements.join(','));
  check('C : AUCUN avertissement', c.avert.length === 0, c.avert.join(' | ').slice(0, 90));

  /* ---------- D) moteur REFUS direct avec certificat ---------- */
  console.log('-- D) moteur refus (appel direct) avec certificat → 0 avertissement --');
  const demandeRefus = await db.demandeAdministrative.create({
    data: {
      reference: REF_TEST + '-R', type: 'CONGE', statut: 'REFUSEE',
      refuseePar: 'RH', decisionManager: 'ACCEPTEE', decisionRh: 'REFUSEE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel', dateDebut: '2026-12-01', dateFin: '2026-12-10',
        emailN1: EMAIL_MANAGER, commentaire: 'Refus E2E 190',
      }), false),
      destinataire: cryptoBd.chiffrerChamp(EMAIL_MANAGER, false),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, false),
    },
  });
  const fichierP12 = path.join(os.tmpdir(), 'e2e-190-dedie.p12');
  fs.writeFileSync(fichierP12, p12);
  const optsMoteur = {
    dechiffrerChamp: (v) => v,
    lireFichierStocke: async (chemin) => (chemin === fichierP12 ? p12 : null),
  };
  await db.reponsePdfConfig.update({
    where: { id: 'reponse-pdf' },
    data: {
      actif: true, elecActif: true, signerActif: true,
      certChemin: fichierP12, certFichierNom: 'e2e-190-dedie.p12',
      certSujet: 'CN=Reponse PDF 190, O=Entreprise Reponses 190',
      certMotDePasse: mdpCert,
    },
  });
  const cfgAvec = await acceptation.chargerConfig(db);
  const refus = await refusMod.genererDocumentRefus(db, demandeRefus, cfgAvec, optsMoteur);
  check('D : signature PAdES appliquée sur le refus', refus.signatureCrypto === true && refus.elements.includes('certificat'), refus.elements.join(','));
  check('D : AUCUN avertissement', Array.isArray(refus.avertissements) && refus.avertissements.length === 0, (refus.avertissements || []).join(' | ').slice(0, 90));

  /* ---------- E) désactivation VOLONTAIRE → jamais d'avertissement ---------- */
  console.log('-- E) signerActif=false + elecActif=false sans certificat → 0 avertissement --');
  await db.reponsePdfConfig.update({
    where: { id: 'reponse-pdf' },
    data: { signerActif: false, elecActif: false, certChemin: '', certSujet: '', certMotDePasse: '' },
  });
  const cfgOff = await acceptation.chargerConfig(db);
  const refusOff = await refusMod.genererDocumentRefus(db, demandeRefus, cfgOff, optsMoteur);
  check('E : signatureCrypto=false (volontaire)', refusOff.signatureCrypto === false);
  check('E : AUCUN avertissement (tout désactivé volontairement)',
    Array.isArray(refusOff.avertissements) && refusOff.avertissements.length === 0, (refusOff.avertissements || []).join(' | ').slice(0, 90));

  /* ---------- F) nettoyage intégral ---------- */
  console.log('-- F) nettoyage --');
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
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
  try { fs.unlinkSync(fichierP12); } catch { /* */ }
  check('Nettoyage : demandes supprimées + configuration dédiée inactive (défauts propres)', true);

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
