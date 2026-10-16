#!/usr/bin/env node
/**
 * Semis / nettoyage VISUEL v0.2.177 — données de démonstration pour la
 * vérification navigateur de la confidentialité de la décision finale.
 *
 *   node scripts/seed_visuel_v02177.js semer      → sème accès + 2 demandes
 *   node scripts/seed_visuel_v02177.js nettoyer   → supprime tout
 *
 * Demandes semées (CIN TEST17702) :
 *   - DEM-2026-17711 CONGÉ « manager a accepté » (EN_ATTENTE) → MASQUÉ
 *   - DEM-2026-17712 CONGÉ « matrice complète » (ACCEPTEE, 2 documents) → RÉVÉLÉ
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

const CIN = "TEST17702";
const MDP = "Visuel-177!Pass";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL = "employe-visual-177@test.tn";

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function semer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP)),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(TOTP),
      nomPrenom: cryptoBd.chiffrerChamp("Ben Ali Sami"),
      email: cryptoBd.chiffrerChamp(EMAIL),
    },
  });
  const j = (n) => new Date(Date.now() - n * 3600000);
  const donnees = cryptoBd.chiffrerChamp(JSON.stringify({
    typeConge: "Congé annuel", du: "09/11/2026", au: "14/11/2026", responsableN1: "Mehdi Trabelsi",
  }));

  const d1 = await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-17711",
      type: "CONGE",
      cin: cinDet,
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees,
      employeEmail: cryptoBd.chiffrerChamp(EMAIL),
      decisionManager: "ACCEPTEE",
      decisionManagerLe: j(3),
      decisionManagerPar: "Manager (réponse e-mail)",
      commentaire: "Acceptée par le manager — transmise automatiquement au service RH pour validation.",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d1.id, nomFichier: "justificatif-manager.pdf", chemin: "pj-visual-177-manager.pdf",
      taille: 1234, typeMime: "application/pdf", empreinte: "sha-visual-177-m",
      recuDe: "manager.test@example.tn", recuLe: j(3),
    },
  });

  const d2 = await db.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-17712",
      type: "CONGE",
      cin: cinDet,
      statut: "ACCEPTEE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees,
      employeEmail: cryptoBd.chiffrerChamp(EMAIL),
      decisionManager: "ACCEPTEE",
      decisionManagerLe: j(30),
      decisionManagerPar: "Manager (réponse e-mail)",
      decisionRh: "ACCEPTEE",
      decisionRhLe: j(1),
      decisionRhPar: "Auto-RH (réponse e-mail)",
      traitePar: "Auto-RH (réponse e-mail)",
      traiteLe: j(1),
      commentaire: "Validation à deux étapes complète : manager ET service RH ont accepté.",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d2.id, nomFichier: "Acceptation_conge_DEM-2026-17712.pdf", chemin: "doc-visual-177-accepte.pdf",
      taille: 3792, typeMime: "application/pdf", empreinte: "sha-visual-177-a",
      recuDe: "Génération automatique (document signé)", recuLe: j(1),
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d2.id, nomFichier: "planning-equipe-novembre.pdf", chemin: "pj-visual-177-planning.pdf",
      taille: 2864, typeMime: "application/pdf", empreinte: "sha-visual-177-p",
      recuDe: "rh.test@example.tn", recuLe: j(1),
    },
  });
  console.log(`SEMÉ : CIN=${CIN} MDP=${MDP} TOTP=${TOTP} — 2 demandes (17711 masquée / 17712 révélée).`);
}

async function nettoyer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  const n = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  console.log(`NETTOYÉ : ${n.count} demande(s) supprimée(s) + accès supprimé.`);
}

(async () => {
  const mode = process.argv[2] || "semer";
  if (mode === "semer") await semer();
  else if (mode === "nettoyer") await nettoyer();
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
