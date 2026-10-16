#!/usr/bin/env node
/**
 * Task 181 — SEMIS DE DÉMONSTRATION de la validation à deux étapes
 * Manager → RH (pour la vérification visuelle dans l'administration).
 *
 *   node scripts/seed_task181_demo.js             → crée 4 demandes de démo
 *   node scripts/seed_task181_demo.js --nettoyer  → supprime les 4 demandes
 *
 * Demande 1 : congé accepté par le manager, RH pas encore décidé
 *             (M: Acceptée / RH: En attente / final: En attente) ;
 * Demande 2 : congé refusé par le manager
 *             (M: Refusée / RH: En attente / final: Refusée par le Manager) ;
 * Demande 3 : autorisation acceptée par le manager puis refusée par les RH
 *             (M: Acceptée / RH: Refusée / final: Refusée par les RH) ;
 * Demande 4 : congé accepté par le manager ET les RH
 *             (M: Acceptée / RH: Acceptée / final: Acceptée).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const prisma = portail.prisma;

const CIN = "TS18190011";
const REF_DEBUT = "DEM-2026-8100";

async function main() {
  const nettoyer = process.argv.includes("--nettoyer");
  const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
  const existantes = await prisma.demandeAdministrative.findMany({
    where: { reference: { startsWith: REF_DEBUT } },
    select: { id: true },
  });
  if (nettoyer) {
    await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF_DEBUT } } });
    console.log("Nettoyage OK — " + existantes.length + " demande(s) supprimée(s).");
    return;
  }
  if (existantes.length) {
    console.log(existantes.length + " demande(s) de démo déjà présentes — rien à faire.");
    return;
  }
  const base = {
    cin: cinIdx,
    destinataire: cryptoBd.chiffrerChamp("manager.demo181@test.local"),
    employeEmail: cryptoBd.chiffrerChamp("employe.demo181@test.local"),
  };
  const donneesConge = cryptoBd.chiffrerChamp(JSON.stringify({
    typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
    emailN1: "manager.demo181@test.local",
  }));
  const donneesSortie = cryptoBd.chiffrerChamp(JSON.stringify({
    date: "2026-12-02", nom: "Ben Salah Mohamed", departement: "INFORMATIQUE",
    motif: "Rendez-vous médical", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00",
    emailN1: "manager.demo181@test.local",
  }));
  const maintenant = new Date();
  await prisma.demandeAdministrative.create({ data: {
    reference: REF_DEBUT + "1", type: "CONGE", statut: "EN_ATTENTE",
    donnees: donneesConge, ...base,
    decisionManager: "ACCEPTEE", decisionManagerLe: maintenant,
    decisionManagerPar: "Manager (réponse e-mail)",
    decisionManagerNote: "Formulation reconnue : « Demande de congé acceptée ».",
    commentaire: "Acceptée par le manager (« Demande de congé acceptée ») — transmise automatiquement au service RH pour validation.",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: REF_DEBUT + "2", type: "CONGE", statut: "REFUSEE", refuseePar: "MANAGER",
    donnees: donneesConge, ...base,
    traitePar: "Manager (réponse e-mail)", traiteLe: maintenant,
    decisionManager: "REFUSEE", decisionManagerLe: maintenant,
    decisionManagerPar: "Manager (réponse e-mail)",
    decisionManagerNote: "Formulation reconnue : « Congé refusé ».",
    commentaire: "Refusée par le manager — décision immédiate et définitive (aucune transmission aux RH) — formulation reconnue : « Congé refusé ».",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: REF_DEBUT + "3", type: "AUTORISATION_SORTIE", statut: "REFUSEE", refuseePar: "RH",
    donnees: donneesSortie, ...base,
    traitePar: "rh@autorh.local", traiteLe: maintenant,
    decisionManager: "ACCEPTEE", decisionManagerLe: maintenant,
    decisionManagerPar: "Manager (réponse e-mail)",
    decisionManagerNote: "Formulation reconnue : « J'accorde ».",
    decisionRh: "REFUSEE", decisionRhLe: maintenant, decisionRhPar: "rh@autorh.local",
    commentaire: "Effectif insuffisant ce jour-là — autorisation refusée après validation du manager.",
  }});
  await prisma.demandeAdministrative.create({ data: {
    reference: REF_DEBUT + "4", type: "CONGE", statut: "ACCEPTEE",
    donnees: donneesConge, ...base,
    traitePar: "rh@autorh.local", traiteLe: maintenant,
    decisionManager: "ACCEPTEE", decisionManagerLe: maintenant,
    decisionManagerPar: "Manager (réponse e-mail)",
    decisionManagerNote: "Formulation reconnue : « Congé validé ».",
    decisionRh: "ACCEPTEE", decisionRhLe: maintenant, decisionRhPar: "rh@autorh.local",
  }});
  console.log("4 demandes de démonstration créées (références " + REF_DEBUT + "1 à " + REF_DEBUT + "4).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("ERREUR:", e); process.exit(1); });
