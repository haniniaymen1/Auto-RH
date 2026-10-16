/* Diagnostic Task 193 — chevauchement signature/cachet ↔ contenu dans le PDF
 * de réponse automatique. Génère un document EXACTEMENT comme le moteur
 * (genererPdfAcceptation + tamponnerDocument) avec les DÉFAUTS de la section
 * dédiée : paraphe BAS_DROITE (120) + tampon BAS_GAUCHE (140) + cachet
 * « Signature électronique » RECTANGLE BAS_DROITE (100 %, toutes infos).
 * Rendu PNG (pdftoppm) + impression des boîtes englobantes calculées. */
process.env.AUTO_RH_STORAGE_KEY = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || 'autorh-storage-local-a-changer-dans-env';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const acceptation = require('./document-acceptation.js');

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

(async () => {
  const sortie = path.join(__dirname, 'tmp-apercu');
  fs.mkdirSync(sortie, { recursive: true });

  const ctx = {
    reference: 'DEM-2026-20001',
    type: 'CONGE',
    typeLibelle: 'Demande de congé',
    statutFinal: 'ACCEPTEE',
    dateDemande: '7 octobre 2026 à 09:15',
    dateDecision: '8 octobre 2026 à 10:30',
    decideur: 'Auto-RH (réponse e-mail)',
    nomEmploye: 'Ahmed Ben Salah',
    cin: '09512345',
    matricule: 'MAT-0452',
    emailEmploye: 'ahmed.bensalah@exemple.tn',
    nomManager: 'Mohamed Trabelsi',
    emailManager: 'mohamed.trabelsi@exemple.tn',
    jours: 5,
    typeConge: 'Congé annuel',
    dateDebut: '12/10/2026',
    dateFin: '16/10/2026',
    commentaire: '',
    heures: null,
    validationManager: { decision: 'ACCEPTEE', le: '7 oct. 2026 14:05', par: 'Mohamed Trabelsi' },
    validationRh: { decision: 'ACCEPTEE', le: '8 oct. 2026 10:30', par: 'Auto-RH (réponse e-mail)' },
    donnees: {
      typeConge: 'Congé annuel',
      dateDebut: '2026-10-12',
      dateFin: '2026-10-16',
    },
    cfg: null,
  };

  const cfg = {
    ...acceptation.DEFAUTS_DOC,
    // bloc « Fait le / signataire » réaliste (comme l'environnement réel)
    certSignataire: 'Le Directeur des Ressources Humaines',
    certFonction: 'Direction des Ressources Humaines — Auto-RH',
    mentionActif: true,
    docMention: 'Document généré et signé électroniquement le {DATE} — décision définitive valant autorisation.',
    // paraphe DÉDIÉ (défaut section : BAS_DROITE, 120)
    docSigActif: true,
    docSigImage: 'data:image/png;base64,' + pngMinimal(30, 60, 130, 360, 120).toString('base64'),
    docSigPosition: 'BAS_DROITE',
    docSigTaille: 120,
    docSigDecalX: 0, docSigDecalY: 0, docSigRotation: 0,
    // tampon DÉDIÉ (défaut section : BAS_GAUCHE, 140)
    tamponActif: true,
    tamponImage: 'data:image/png;base64,' + pngMinimal(170, 40, 40, 300, 300).toString('base64'),
    tamponPosition: 'BAS_GAUCHE',
    tamponTaille: 140,
    tamponOpacite: 0.85, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
    // cachet « Signature électronique » (défaut section : BAS_DROITE, 100 %, RECTANGLE)
    docElecActif: true,
    docElecPosition: 'BAS_DROITE',
    docElecDecalX: 0, docElecDecalY: 0,
    docElecTaille: 100,
    docElecForme: 'RECTANGLE',
    docElecAffSignataire: true,
    docElecAffOrganisation: true,
    docElecAffEmetteur: true,
    docElecAffValidite: true,
    docElecAffEmpreinte: true,
    elecTexteLibre: '',
    _sourceReponsePdf: true,
    certSujet: 'CN=Auto-RH RH,O=Societe Tunisie SA,C=TN',
    certEmetteur: 'CN=Auto-RH CA,O=Auto-RH,C=TN',
    certEmpreinte: 'A1B2C3D4E5F60718293A4B5C6D7E8F9011223344',
    certValideAu: new Date('2027-12-31T23:59:59Z'),
    signerActif: false, // diagnostic : cachet sans signature cryptographique
  };
  ctx.cfg = cfg;

  const pdfBase = await acceptation.genererPdfAcceptation(ctx, cfg);
  const { doc, elements } = await acceptation.tamponnerDocument(pdfBase, cfg, { ctx, demande: { reference: ctx.reference } });
  const pdfFinal = Buffer.from(await doc.save());
  fs.writeFileSync(path.join(sortie, 'diag_chevauchement.pdf'), pdfFinal);
  console.log('elements =', JSON.stringify(elements));

  // ---- Boîtes englobantes (calculées avec les JUMELLES de tampon-document) ----
  const stamp = require('./tampon-document.js');
  const W = 595.28, H = 841.89;
  // cachet rectangle : approxime geometrieCachetRectangle via l'échelle 1
  console.log('\nZones fixes du document (document-acceptation.js) :');
  console.log('  Table contenu : Y_MIN_CONTENU = 206 (le contenu ne descend jamais sous)');
  console.log('  Filet zone signature : y = 210');
  console.log('  Bloc « Fait le / signataire / fonction / note » : x = 311..541, y ≈ 118..188');
  console.log('  Mention légale : y = 30 (centrée) ; pied de page : y = 12');

  // pdftoppm pour inspection visuelle
  const { execSync } = require('child_process');
  try {
    execSync('pdftoppm -png -r 110 ' + path.join(sortie, 'diag_chevauchement.pdf') + ' ' + path.join(sortie, 'diag'), { stdio: 'pipe' });
    console.log('\nPNG rendu :', path.join(sortie, 'diag-1.png'));
  } catch (e) {
    console.log('pdftoppm échec :', e.message);
  }

  // ---- Mesure : le fichier est écrit, pdftoppm l'a rendu ----
  console.log('\nFichier écrit :', path.join(sortie, 'diag_chevauchement.pdf'), pdfFinal.length, 'octets');
})().catch((e) => { console.error('ERREUR:', e); process.exit(1); });
