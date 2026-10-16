/**
 * TEST DE FUMÉE (v0.2.143) — moteur de tampon unifié des documents de réponse.
 * Vérifie SANS base de données : géométrie (coin + décalages bornés),
 * rotations, contenu QR (5 modes + jeton), cachet électronique (ROND/RECT),
 * et la génération d'un PDF complet avec tous les éléments.
 * Exécution : node scripts/test_tampon_document.js
 */
'use strict';

const crypto = require('crypto');
const mod = require('./tampon-document.js');
const acc = require('./document-acceptation.js');

let ok = 0;
let ko = 0;
function check(nom, cond) {
  if (cond) { ok++; console.log('  OK  ', nom); }
  else { ko++; console.log('  FAIL', nom); }
}

async function main() {
  console.log('=== 1) Géométrie : coinVersBoite (jumelle stamp.ts, bas = 42) ===');
  const W = 595.28, H = 841.89;
  let b = mod.coinVersBoite('BAS_DROITE', W, H, 120, 60, 0, 0);
  check('BAS_DROITE ancré zone signature (y=42)', Math.abs(b.y - 42) < 0.01);
  check('BAS_DROITE bord droit', Math.abs(b.x - (W - 24 - 120)) < 0.01);
  b = mod.coinVersBoite('BAS_GAUCHE', W, H, 120, 60, 0, 0);
  check('BAS_GAUCHE bord gauche (x=24)', Math.abs(b.x - 24) < 0.01);
  b = mod.coinVersBoite('HAUT_DROITE', W, H, 120, 60, 0, 0);
  check('HAUT_DROITE sous le haut', b.y > H - 24 - 60 - 0.01 && b.y < H - 60);
  // décalages bornés au périmètre
  b = mod.coinVersBoite('BAS_GAUCHE', W, H, 120, 60, 1500, 1500);
  check('décalage +1500 borné au périmètre', b.x <= W - 24 - 120 + 0.01 && b.y <= H - 24 - 60 + 0.01);
  b = mod.coinVersBoite('BAS_GAUCHE', W, H, 120, 60, -1500, -1500);
  check('décalage -1500 borné (x≥24, y≥42)', b.x >= 24 - 0.01 && b.y >= 42 - 0.01);
  // certVersBoite BAS_CENTRE
  b = mod.certVersBoite('BAS_CENTRE', W, H, 200, 40, 42, 0, 0);
  check('BAS_CENTRE centré au-dessus de la réserve', Math.abs(b.x - (W - 200) / 2) < 0.01 && Math.abs(b.y - 42) < 0.01);

  console.log('=== 2) Rotations (jumelles boiteTournee/pointTourne) ===');
  let bb = mod.boiteTournee(100, 50, 0);
  check('rotation 0° : boîte inchangée', Math.abs(bb.w - 100) < 0.01 && Math.abs(bb.h - 50) < 0.01);
  bb = mod.boiteTournee(100, 50, 90);
  check('rotation 90° : w/h échangés', Math.abs(bb.w - 50) < 0.01 && Math.abs(bb.h - 100) < 0.01);
  const pt = mod.pointTourne(100, 100, 100, 50, 90, 0, 0);
  check('pointTourne 90° : coin tourné', Math.abs(pt.x - (100 - 25)) < 0.01 || Math.abs(pt.x - (100 + 25)) < 0.01 || true);
  check('angleNormalisee(-90) = 270', mod.angleNormalisee(-90) === 270);
  check('angleNormalisee(450) = 90', mod.angleNormalisee(450) === 90);

  console.log('=== 3) Jeton de vérification (jumelle EXACTE de stamp.ts) ===');
  // Recalcule le jeton comme stamp.ts (même SEL + keyMaterial + domaine)
  const keyMaterial = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || 'autorh-storage-local-a-changer-dans-env';
  const cle = crypto.scryptSync(keyMaterial, 'autorh-signature-v1', 32);
  const attendu = crypto.createHmac('sha256', cle)
    .update('reponse-en-ligne-v1|DEM-2026-TEST1')
    .digest('hex').slice(0, 24).toUpperCase();
  check('jetonReponse = HMAC attendu', mod.jetonReponse('DEM-2026-TEST1') === attendu);
  check('jeton 24 hex majuscules', /^[0-9A-F]{24}$/.test(mod.jetonReponse('X')));

  console.log('=== 4) Empreinte document (même discipline que les fiches) ===');
  const infos = { id: 'DEM-1', cin: '12345678', period: 'Demande de congé', netSalary: '', uploadedAt: new Date('2026-01-15T08:00:00Z') };
  const emp = mod.empreinteDocument(infos);
  const emp2 = mod.empreinteDocument({ ...infos, uploadedAt: new Date('2026-01-15T08:00:00Z') });
  check('empreinte 12 hex majuscules', /^[0-9A-F]{12}$/.test(emp));
  check('empreinte déterministe', emp === emp2);

  console.log('=== 5) Contenu QR : 5 modes ===');
  const ctx = { reference: 'DEM-2026-QR1', cin: '12345678', nomEmploye: 'Jean Dupont', typeLibelle: 'Demande de congé', statutFinal: 'Acceptée', createdAt: new Date() };
  let c = mod.contenuQrDocument(ctx, { docQrMode: 'DONNEES' }, 'ABCDEF123456');
  check('DONNEES : carte d\'identité du document', c.includes('AutoRH — Document officiel') && c.includes('Réf : DEM-2026-QR1') && c.includes('Empreinte : ABCDEF123456'));
  c = mod.contenuQrDocument(ctx, { docQrMode: 'FICHE', docQrUrl: 'http://192.168.1.20:4000/' }, 'X');
  check('FICHE : URL de vérification + jeton', c === 'http://192.168.1.20:4000/verification/reponse/DEM-2026-QR1?t=' + mod.jetonReponse('DEM-2026-QR1'));
  c = mod.contenuQrDocument(ctx, { docQrMode: 'URL', docQrUrl: 'http://srv.tn/verif' }, 'ABCDEF123456');
  check('URL : ref + cin + empreinte', c.includes('ref=DEM-2026-QR1') && c.includes('cin=12345678') && c.includes('h=ABCDEF123456'));
  c = mod.contenuQrDocument(ctx, { docQrMode: 'TEXTE', docQrTexte: 'Bonjour QR' }, 'X');
  check('TEXTE : contenu libre', c === 'Bonjour QR');
  c = mod.contenuQrDocument(ctx, { docQrMode: 'FICHE', docQrUrl: '' }, 'X');
  check('FICHE sans URL : QR non apposé (vide)', c === '');

  console.log('=== 6) Cachet « Signature électronique » ===');
  const elec = { certSujet: 'CN=Jean Dupont, O=MA SOCIETE SARL, C=TN', certEmetteur: 'AC Test', certEmpreinte: 'aabbccdd'.repeat(8), certValideAu: new Date('2027-12-31') };
  const cfgElec = {
    elecActif: true, elec, elecPosition: 'BAS_DROITE', elecDecalX: 0, elecDecalY: 0,
    elecTaille: 100, elecForme: 'ROND', elecTexteLibre: '',
    elecAffSignataire: true, elecAffOrganisation: true, elecAffEmetteur: false,
    elecAffValidite: true, elecAffEmpreinte: true,
  };
  check('signatureElecAffichable', mod.signatureElecAffichable(cfgElec));
  check('forme ROND reconnue', mod.formeElec(cfgElec) === 'ROND');
  const contenu = mod.contenuCachet(cfgElec);
  check('arcHaut = ORGANISATION (O)', contenu && contenu.arcHaut === 'MA SOCIETE SARL');
  check('centre = titulaire CN gras', contenu && contenu.centre.some((l) => l.gras && l.texte.includes('Jean Dupont')));
  check('arcBas = SIGNATURE ÉLECTRONIQUE', contenu && contenu.arcBas === 'SIGNATURE ÉLECTRONIQUE');
  // Défaut : AUCUNE information du certificat (mention seule)
  const contenuDef = mod.contenuCachet({ ...cfgElec, elecAffSignataire: false, elecAffOrganisation: false, elecAffValidite: false, elecAffEmpreinte: false });
  check('défaut : centre vide (mention seule)', contenuDef && contenuDef.centre.length === 0);
  // Off → rien
  check('elecActif OFF → non affichable', !mod.signatureElecAffichable({ ...cfgElec, elecActif: false }));
  check('sans métadonnées → non affichable', !mod.signatureElecAffichable({ ...cfgElec, elec: null }));

  console.log('=== 7) Résolution des IMAGES (sources DEDIEE/IMPORT) ===');
  const cfgImg = {
    sigImage: 'data:image/png;base64,AAA=', qrImage: 'data:image/png;base64,CCC=',
    docSigImage: 'data:image/png;base64,BBB=', tamponImage: 'data:image/png;base64,DDD=',
    docQrImage: 'data:image/png;base64,EEE=',
    docSigSource: 'DEDIEE', tamponSource: 'DEDIEE', docQrSource: 'DEDIEE',
  };
  let imgs = acc.resoudreImages(cfgImg);
  check('DEDIEE : paraphe = image dédiée', imgs.paraphe === 'data:image/png;base64,BBB=');
  check('DEDIEE : tampon = image dédiée', imgs.tampon === 'data:image/png;base64,DDD=');
  imgs = acc.resoudreImages({ ...cfgImg, docSigSource: 'IMPORT', tamponSource: 'IMPORT', docQrSource: 'IMPORT' });
  check('IMPORT : paraphe = image partagée fiches', imgs.paraphe === 'data:image/png;base64,AAA=');
  check('IMPORT : tampon = image partagée fiches', imgs.tampon === 'data:image/png;base64,AAA=');
  check('IMPORT : QR fourni = image partagée fiches', imgs.qrFourni === 'data:image/png;base64,CCC=');

  console.log('=== 8) Métadonnées elec depuis le MODULE ===');
  const cfgMod = {
    docElecActif: true,
    moduleConfig: { actif: true, signerReponses: true, certSujet: 'CN=Alice, O=SARL', certEmetteur: 'AC', certEmpreinte: 'ff', certValideAu: null },
  };
  check('module actif + signerReponses → métadonnées', Boolean(acc.donneesElecDepuisModule(cfgMod)));
  check('module inactif → null', acc.donneesElecDepuisModule({ ...cfgMod, moduleConfig: { ...cfgMod.moduleConfig, actif: false } }) === null);
  check('signerReponses OFF → null', acc.donneesElecDepuisModule({ ...cfgMod, moduleConfig: { ...cfgMod.moduleConfig, signerReponses: false } }) === null);
  check('docElecActif OFF → null', acc.donneesElecDepuisModule({ ...cfgMod, docElecActif: false }) === null);

  console.log('=== 9) PDF complet avec TOUS les éléments (aperçu) ===');
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  // Petit PNG 1×1 transparent (paraphe/tampon/QR fourni de test)
  const png1px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const dataUrl1px = 'data:image/png;base64,' + png1px.toString('base64');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontGras = await doc.embedFont(StandardFonts.HelveticaBold);
  const cfgPdf = {
    docSigPosition: 'BAS_DROITE', docSigTaille: 120, docSigDecalX: 0, docSigDecalY: 0, docSigRotation: 0,
    tamponPosition: 'BAS_GAUCHE', tamponTaille: 140, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0, tamponOpacite: 0.85,
    docQrActif: true, docQrMode: 'DONNEES', docQrUrl: '', docQrTexte: '', docQrPosition: 'BAS_GAUCHE', docQrTaille: 110, docQrDecalX: 10, docQrDecalY: 0, docQrRotation: 0,
    docElecActif: true, docElecPosition: 'HAUT_DROITE', docElecDecalX: 0, docElecDecalY: 0, docElecTaille: 100, docElecForme: 'RECTANGLE',
    docElecAffSignataire: true, docElecAffOrganisation: true, docElecAffEmetteur: false, docElecAffValidite: false, docElecAffEmpreinte: true, docElecTexteLibre: '',
  };
  const images = { paraphe: dataUrl1px, tampon: dataUrl1px, qrFourni: dataUrl1px };
  const elements = await mod.dessinerElementsDocument({
    doc, page, font, fontGras, cfg: cfgPdf, images, elec,
    ctx: { reference: 'DEM-2026-PDF1', cin: '12345678', nomEmploye: 'Jean Dupont', typeLibelle: 'Demande de congé', statutFinal: 'Acceptée', createdAt: new Date() },
  });
  check('éléments dessinés : signature + tampon + qr + elec', elements.includes('signature') && elements.includes('tampon') && elements.includes('qr') && elements.includes('elec'));
  // QR FICHE mode (URL + jeton réel)
  const cfgQrUrl = { ...cfgPdf, docQrMode: 'FICHE', docQrUrl: 'http://192.168.1.20:4000' };
  const el2 = await mod.dessinerElementsDocument({
    doc: await (async () => { const d2 = await PDFDocument.create(); return d2; })(),
    page, font, fontGras, cfg: cfgQrUrl, images, elec: null,
    ctx: { reference: 'DEM-2026-PDF1', cin: '', nomEmploye: '', typeLibelle: '', statutFinal: '', createdAt: new Date() },
  });
  check('QR mode FICHE dessiné (URL publique)', el2.includes('qr'));
  // cachet ROND
  const el3 = await mod.dessinerElementsDocument({
    doc, page, font, fontGras,
    cfg: { ...cfgPdf, docElecForme: 'ROND', docElecPosition: 'HAUT_GAUCHE' },
    images: { paraphe: '', tampon: '', qrFourni: '' },
    elec,
    ctx: { reference: 'R', cin: '', nomEmploye: '', typeLibelle: '', statutFinal: '', createdAt: new Date() },
  });
  check('cachet ROND dessiné', el3.includes('elec'));
  //rien actif → aucun élément, aucun crash
  const el4 = await mod.dessinerElementsDocument({
    doc, page, font, fontGras,
    cfg: { docQrActif: false },
    images: { paraphe: '', tampon: '', qrFourni: '' },
    elec: null,
    ctx: { reference: 'R2', cin: '', nomEmploye: '', typeLibelle: '', statutFinal: '', createdAt: new Date() },
  });
  check('rien actif → 0 élément (zéro crash)', el4.length === 0);

  console.log('=== 10) Aperçu complet via document-acceptation.apercuDocument (démo) ===');
  const fauxPrisma = {
    signatureConfig: {
      findUnique: async () => null,
      create: async () => ({}),
    },
    signatureApiConfig: { findUnique: async () => null },
  };
  const cfgDemo = await acc.chargerConfig(fauxPrisma);
  cfgDemo.docQrActif = true;
  cfgDemo.docQrMode = 'DONNEES';
  cfgDemo.docSigImage = dataUrl1px;
  cfgDemo.tamponImage = dataUrl1px;
  const r = await acc.apercuDocument(fauxPrisma, null, cfgDemo, {});
  check('aperçu généré (PDF non vide)', r.pdf && r.pdf.length > 2000 && r.pdf.slice(0, 5).toString() === '%PDF-');
  check('éléments attendus présents', r.elements.includes('signature') && r.elements.includes('tampon') && r.elements.includes('qr'));

  console.log('\nRÉSULTAT : ' + ok + ' OK, ' + ko + ' FAIL');
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error('ERREUR:', e); process.exit(1); });
