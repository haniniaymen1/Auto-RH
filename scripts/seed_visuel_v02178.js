#!/usr/bin/env node
/**
 * Semis / nettoyage VISUEL v0.2.178 — vérification navigateur :
 *   - le CADRE VERT (barre d'étapes Manager → RH) n'apparaît PLUS ;
 *   - le badge du statut final, les pièces jointes et la note v0.2.177
 *     restent inchangés.
 *
 *   node scripts/seed_visuel_v02178.js semer      → sème accès + 3 demandes
 *   node scripts/seed_visuel_v02178.js nettoyer   → supprime tout
 *
 * Demandes semées (CIN TEST17802) :
 *   - DEM-2026-17811 CONGÉ matrice complète (ACCEPTEE, 2 documents) → révélé
 *   - DEM-2026-17812 CONGÉ « manager a accepté » (EN_ATTENTE) → masqué + note
 *   - DEM-2026-17813 PARRAINAGE accepté (réponse e-mail, 1 document) → révélé
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const crypto = require("crypto");
const db = new PrismaClient();

const CIN = "TEST17802";
const MDP = "Visuel-178!Pass";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL = "employe-visual-178@test.tn";

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + crypto.scryptSync(motDePasse, salt, 64).toString("hex");
}

function donneesConge() {
  return JSON.stringify({ typeConge: "Congé annuel", du: "01/11/2026", au: "05/11/2026", responsableN1: "Manager Test" });
}
function donneesParrainage() {
  return JSON.stringify({ nomParrain: "Parrain Test 178", emailParrain: EMAIL, dateParrainage: "2026-11-02", operation: "Opération Visuel 178", nomFilleul: "Filleul Visuel 178", telFilleul: "12 345 678" });
}

async function semer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.create({
    data: {
      cin: cinDet, isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP)),
      mustChangePassword: false, passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000), qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(TOTP),
      nomPrenom: cryptoBd.chiffrerChamp("Parrain Test 178"),
      email: cryptoBd.chiffrerChamp(EMAIL),
    },
  });
  const j = (n) => new Date(Date.now() - n * 3600000);

  const d1 = await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-17811", type: "CONGE", cin: cinDet, statut: "ACCEPTEE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL),
      decisionManager: "ACCEPTEE", decisionManagerLe: j(5), decisionManagerPar: "Manager (réponse e-mail)",
      decisionRh: "ACCEPTEE", decisionRhLe: j(1), decisionRhPar: "Auto-RH (réponse e-mail)",
      traitePar: "Auto-RH (réponse e-mail)", traiteLe: j(1),
      commentaire: "Validation à deux étapes complète : manager ET service RH ont accepté.",
    },
  });
  await db.documentDemande.create({
    data: { demandeId: d1.id, nomFichier: "Acceptation_conge_DEM-2026-17811.pdf", chemin: "doc-visuel-178-a.pdf", taille: 3792, typeMime: "application/pdf", empreinte: "sha-visuel-178-a", recuDe: "Génération automatique (document signé)", recuLe: j(1) },
  });
  await db.documentDemande.create({
    data: { demandeId: d1.id, nomFichier: "ordre-mission.pdf", chemin: "doc-visuel-178-b.pdf", taille: 3456, typeMime: "application/pdf", empreinte: "sha-visuel-178-b", recuDe: "rh.test@example.tn", recuLe: j(1) },
  });

  await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-17812", type: "CONGE", cin: cinDet, statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL),
      decisionManager: "ACCEPTEE", decisionManagerLe: j(3), decisionManagerPar: "Manager (réponse e-mail)",
      commentaire: "Acceptée par le manager — transmise automatiquement au service RH pour validation.",
    },
  });

  const d3 = await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-17813", type: "PARRAINAGE", cin: cinDet, statut: "ACCEPTEE",
      destinataire: cryptoBd.chiffrerChamp("parrainage.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesParrainage()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL),
      decisionManager: "ACCEPTEE", decisionManagerLe: j(2), decisionManagerPar: "Service parrainage (réponse e-mail)",
      decisionManagerNote: "Formulation reconnue : « J'accepte votre demande ». Décision unique du destinataire de la demande de parrainage (validation en une seule étape).",
      traitePar: "Service parrainage (réponse e-mail)", traiteLe: j(2),
      commentaire: "Acceptée par le service chargé du parrainage (réponse e-mail — formulation reconnue : « J'accepte votre demande ») — décision unique et définitive.",
    },
  });
  await db.documentDemande.create({
    data: { demandeId: d3.id, nomFichier: "Acceptation_parrainage_DEM-2026-17813.pdf", chemin: "doc-visuel-178-c.pdf", taille: 4011, typeMime: "application/pdf", empreinte: "sha-visuel-178-c", recuDe: "Génération automatique (document signé)", recuLe: j(2) },
  });
  console.log("Semé : accès portail " + CIN + " + 3 demandes (17811 congé révélé, 17812 congé masqué, 17813 parrainage accepté).");
}

async function nettoyer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  const suppr = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  console.log("Nettoyage : " + suppr.count + " demande(s) supprimée(s), accès supprimé.");
  await db.$disconnect();
}

(async () => {
  if (process.argv[2] === "semer") await semer();
  else if (process.argv[2] === "nettoyer") await nettoyer();
  else { console.log("usage: semer | nettoyer"); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
