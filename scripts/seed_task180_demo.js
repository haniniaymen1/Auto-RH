/**
 * Task 180 — Semis d'une demande de DÉMONSTRATION refusée (pour la capture
 * d'écran de la section « Réponse & documents de la décision »).
 * Usage : node scripts/seed_task180_demo.js [--nettoyer]
 */
'use strict';
const path = require('path');
const cryptoBd = require(path.join(__dirname, 'lib-crypto-bd.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const CIN = '10990778';
const REF = 'DEM-2026-DEMO1';

(async () => {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  if (process.argv.includes('--nettoyer')) {
    await db.demandeAdministrative.deleteMany({ where: { reference: REF } });
    console.log('Demande démo supprimée.');
    await db.$disconnect();
    return;
  }
  const existante = await db.demandeAdministrative.findUnique({ where: { reference: REF } });
  if (existante) {
    console.log('Déjà présente :', REF, existante.statut, 'docRefus:', existante.docRefusChemin);
    await db.$disconnect();
    return;
  }
  const d = await db.demandeAdministrative.create({
    data: {
      reference: REF,
      type: 'CONGE',
      statut: 'EN_ATTENTE',
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: 'Congé annuel',
        dateDebut: '2026-12-01',
        dateFin: '2026-12-12',
        emailN1: 'manager.demo@entreprise.tn',
        commentaire: 'Demande de démonstration Task 180.',
      }), false),
      destinataire: cryptoBd.chiffrerChamp('manager.demo@entreprise.tn', false),
      employeEmail: cryptoBd.chiffrerChamp('employe.demo@entreprise.tn', false),
    },
  });
  console.log('Créée :', d.reference, d.id);
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
