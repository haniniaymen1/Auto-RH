#!/usr/bin/env node
/**
 * (v0.2.141) Sème 4 demandes de DÉMONSTRATION (un par chemin de statut) pour
 * la vérification visuelle du portail administratif, + compte RH de test.
 * Les demandes sont créées DIRECTEMENT en base (pas d'e-mails) avec les
 * champs de décision appropriés — mode "seed visuel".
 * Purge intégrale par scripts/purge-seed-statuts.js après capture.
 */
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient();

(async () => {
  const annee = new Date().getFullYear();
  let n = (await prisma.demandeAdministrative.count()) + 1;
  const ref = () => `DEM-${annee}-${String(n++).padStart(5, "0")}`;

  const r1 = ref(); // A : acceptée complète (manager + RH)
  const r2 = ref(); // B : refusée par le manager
  const r3 = ref(); // C : refusée par les RH (après acceptation manager)
  const r4 = ref(); // D : en attente
  const now = new Date();
  const il2j = new Date(now.getTime() - 2 * 86400000);
  const il1j = new Date(now.getTime() - 86400000);

  await prisma.demandeAdministrative.create({ data: {
    reference: r1, type: "CONGE", cin: "12345678",
    statut: "ACCEPTEE",
    destinataire: cryptoBd.chiffrerChamp("manager@entreprise.tn", false),
    donnees: JSON.stringify({ typeConge: "Annuel", dateDebut: "2026-03-02", dateFin: "2026-03-06", emailN1: "manager@entreprise.tn", commentaire: "Congé annuel de printemps" }),
    employeEmail: cryptoBd.chiffrerChamp("nadia.bensalah@entreprise.tn", false),
    commentaire: "Décision du manager : OK bon voyage | Décision RH : Validé par le service RH",
    traitePar: "rh@entreprise.tn (RH — administration)", traiteLe: il1j,
    decisionManager: "ACCEPTEE", decisionManagerLe: il2j, decisionManagerPar: "manager@entreprise.tn (manager — réponse e-mail)", commentaireManager: "OK bon voyage, pensez à la passation",
    decisionRh: "ACCEPTEE", decisionRhLe: il1j, decisionRhPar: "rh@entreprise.tn (RH — administration)", commentaireRh: "Validé par le service RH",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: r2, type: "CONGE", cin: "87654321",
    statut: "REFUSEE",
    destinataire: cryptoBd.chiffrerChamp("manager@entreprise.tn", false),
    donnees: JSON.stringify({ typeConge: "Sans solde", dateDebut: "2026-04-10", dateFin: "2026-04-12", emailN1: "manager@entreprise.tn", commentaire: "" }),
    employeEmail: cryptoBd.chiffrerChamp("mohamed.ali@entreprise.tn", false),
    commentaire: "Décision du manager : Période de rush — reportez au mois suivant",
    traitePar: "manager@entreprise.tn (manager — réponse e-mail)", traiteLe: il1j,
    decisionManager: "REFUSEE", decisionManagerLe: il1j, decisionManagerPar: "manager@entreprise.tn (manager — réponse e-mail)", commentaireManager: "Période de rush — reportez au mois suivant",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: r3, type: "AUTORISATION_SORTIE", cin: "11223344",
    statut: "REFUSEE",
    destinataire: cryptoBd.chiffrerChamp("responsable.it@entreprise.tn", false),
    donnees: JSON.stringify({ date: "2026-03-16", nom: "Salma TRABELSI", departement: "INFORMATIQUE", motif: "Rendez-vous administratif", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" }),
    employeEmail: cryptoBd.chiffrerChamp("salma.trabelsi@entreprise.tn", false),
    commentaire: "Décision RH : Effectif insuffisant sur cette période",
    traitePar: "rh@entreprise.tn (RH — administration)", traiteLe: now,
    decisionManager: "ACCEPTEE", decisionManagerLe: il1j, decisionManagerPar: "responsable.it@entreprise.tn (manager — page de décision)", commentaireManager: "Accord du responsable",
    decisionRh: "REFUSEE", decisionRhLe: now, decisionRhPar: "rh@entreprise.tn (RH — administration)", commentaireRh: "Effectif insuffisant sur cette période",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: r4, type: "CONGE", cin: "44332211",
    statut: "EN_ATTENTE",
    destinataire: cryptoBd.chiffrerChamp("manager@entreprise.tn", false),
    donnees: JSON.stringify({ typeConge: "Exceptionnel", dateDebut: "2026-05-04", dateFin: "2026-05-05", emailN1: "manager@entreprise.tn", commentaire: "Mariage" }),
    employeEmail: cryptoBd.chiffrerChamp("karim.gharbi@entreprise.tn", false),
    traitePar: null, traiteLe: null,
  }});

  // compte RH de test pour la connexion navigateur
  const sel = crypto.randomBytes(8).toString("hex");
  const mdp = "SeedStatuts!2026x";
  const hash = "scrypt:" + sel + ":" + crypto.scryptSync(mdp, sel, 64).toString("hex");
  await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-visuel@test.local", true) } });
  await prisma.user.create({ data: cryptoBd.chiffrerObjet("User", {
    email: "rh-visuel@test.local", name: "RH Visuel", passwordHash: hash, role: "RH",
    isActive: true, passwordChangedAt: new Date(new Date().getTime() - 30 * 86400000),
  }) });

  console.log(JSON.stringify({ refs: [r1, r2, r3, r4], login: "rh-visuel@test.local", mdp }));
  await prisma.$disconnect();
})().catch((e) => { console.error("ERREUR:", e && e.message); process.exit(1); });
