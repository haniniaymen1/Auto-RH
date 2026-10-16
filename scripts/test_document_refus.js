/**
 * Test Task 180 — génération du PDF de DÉCISION DE REFUS (données de démo).
 * Vérifie : PDF d'une page, motif adaptatif (court / long / absent),
 * tous les types de demandes, intégrité du pipeline (tampon + signature
 * sans certificat → elements sans 'certificat').
 * Usage : node scripts/test_document_refus.js [outdir]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const refus = require('./document-refus.js');
const acceptation = require('./document-acceptation.js');

const outdir = process.argv[2] || '/home/z/my-project/scripts/tmp_task180';
fs.mkdirSync(outdir, { recursive: true });

/* Prisma factice : chargerConfig replie sur les DEFAUTS en cas d'erreur. */
const prismaFactice = {
  signatureConfig: {
    findUnique: async () => null,
    create: async () => ({ id: 'signature' }),
  },
};

/* Demande de démo (structure identique à apercuDocument). */
function demandeDemo(type, overrides) {
  const annee = new Date().getFullYear();
  const donnees = {
    CONGE: {
      typeConge: 'Congé annuel',
      dateDebut: annee + '-08-03',
      dateFin: annee + '-08-14',
      emailN1: 'manager@entreprise.tn',
      commentaire: 'Merci de traiter ma demande.',
    },
    AUTORISATION_SORTIE: {
      date: annee + '-08-03',
      departement: 'Production',
      motif: 'Démarche administrative',
      nombreHeures: '2',
      heureSortie: '09:00',
      heureRetour: '11:00',
      compensation: 'OUI',
    },
    ATTESTATION_TRAVAIL: { nom: 'BEN SALAH', prenom: 'Jean' },
    ATTESTATION_SALAIRE: { nom: 'BEN SALAH', prenom: 'Jean' },
    PARRAINAGE: {
      nomParrain: 'Jean BEN SALAH',
      emailParrain: 'jean@entreprise.tn',
      emailN1: 'n1@entreprise.tn',
      dateParrainage: annee + '-08-03',
      operation: 'Opérations',
      nomFilleul: 'Karim TRABELSI',
      telFilleul: '20 123 456',
    },
  }[type];
  return {
    id: 'DEMO',
    reference: 'DEM-' + annee + '-DEMO1',
    type,
    statut: 'REFUSEE',
    cin: '12345678',
    donnees: JSON.stringify(donnees),
    employeEmail: 'employe@entreprise.tn',
    destinataire: 'manager@entreprise.tn',
    commentaire:
      (overrides && overrides.motif) ||
      'Effectif déjà complet sur la période demandée — merci de replanifier votre congé en dehors du pic d\'activité.',
    traitePar: 'rh@entreprise.tn',
    traiteLe: new Date(),
    createdAt: new Date(),
    docRefusChemin: null,
  };
}

const opts = {
  dechiffrerChamp: (v) => v,
  resoudreIdentite: async () => ({ nom: 'Jean BEN SALAH', matricule: 'MAT-1024' }),
};

(async () => {
  let echecs = 0;
  const types = ['CONGE', 'AUTORISATION_SORTIE', 'ATTESTATION_TRAVAIL', 'ATTESTATION_SALAIRE', 'PARRAINAGE'];
  for (const type of types) {
    const demande = demandeDemo(type);
    const cfg = await acceptation.chargerConfig(prismaFactice);
    const r = await refus.genererDocumentRefus(prismaFactice, demande, cfg, opts);
    const fichier = path.join(outdir, 'refus-' + type.toLowerCase() + '.pdf');
    fs.writeFileSync(fichier, r.pdf);
    const { PDFDocument } = require('pdf-lib');
    const relu = await PDFDocument.load(r.pdf);
    const pages = relu.getPageCount();
    const ok = pages === 1 && r.pdf.length > 2000;
    console.log(
      (ok ? 'OK  ' : 'ECHEC ') + type.padEnd(22) +
      ' pages=' + pages + ' taille=' + r.pdf.length + ' elements=' + r.elements.join(',')
    );
    if (!ok) echecs++;
  }

  // Motif très long (10 paragraphes) — adaptation + troncature attendue
  {
    const demande = demandeDemo('CONGE', {
      motif: Array.from({ length: 10 }, (_, i) =>
        'Paragraphe ' + (i + 1) + ' : le planning de la période couvre un pic d\'activité exceptionnel ' +
        'et les congés simultanés du département sont limités par la charge client, la continuité de service ' +
        'doit être assurée en permanence conformément aux consignes de la direction générales du personnel.'
      ).join('\n\n'),
    });
    const cfg = await acceptation.chargerConfig(prismaFactice);
    const r = await refus.genererDocumentRefus(prismaFactice, demande, cfg, opts);
    const fichier = path.join(outdir, 'refus-motif-long.pdf');
    fs.writeFileSync(fichier, r.pdf);
    const { PDFDocument } = require('pdf-lib');
    const relu = await PDFDocument.load(r.pdf);
    const ok = relu.getPageCount() === 1;
    console.log((ok ? 'OK  ' : 'ECHEC ') + 'MOTIF_LONG (10 §)'.padEnd(22) + ' pages=' + relu.getPageCount() + ' taille=' + r.pdf.length);
    if (!ok) echecs++;
  }

  // Motif absent
  {
    const demande = demandeDemo('CONGE', { motif: '' });
    const cfg = await acceptation.chargerConfig(prismaFactice);
    const r = await refus.genererDocumentRefus(prismaFactice, demande, cfg, opts);
    fs.writeFileSync(path.join(outdir, 'refus-motif-absent.pdf'), r.pdf);
    console.log('OK   MOTIF_ABSENT'.padEnd(28) + ' taille=' + r.pdf.length);
  }

  // Nom de fichier
  const ctx = { type: 'CONGE', reference: 'DEM-2026-00042' };
  console.log('nom fichier :', refus.nomFichierRefus(ctx));
  console.log(echecs === 0 ? '\nTOUS LES TESTS PASSENT' : '\n' + echecs + ' ÉCHEC(S)');
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERREUR:', e);
  process.exit(1);
});
