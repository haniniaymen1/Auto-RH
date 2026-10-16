/**
 * (v0.2.195) Création de DEMANDES DE TEST à deux étapes (congé + autorisation
 * de sortie) pour la preuve navigateur du masquage de la carte
 * « Décision Manager » pour le rôle RH.
 *
 * Les champs sensibles sont chiffrés EXACTEMENT comme le portail
 * (scripts/lib-crypto-bd.js — jumelle canonique de src/lib/db-crypto.ts) :
 *   - cin            : déterministe (encbd1d:…) — recherché par égalité ;
 *   - donnees / destinataire / employeEmail : IV aléatoire (encbd1:…).
 * La clé est dérivée du même secret (AUTO_RH_STORAGE_KEY, repli
 * AUTH_SECRET) chargé depuis le .env de la racine — l'application
 * d'administration le déchiffre donc de façon transparente.
 *
 * Idempotent : les demandes DEM-2026-00010 / DEM-2026-00011 sont
 * SUPPRIMÉES puis recréées (aucun doublon).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const cryptoBd = require("./lib-crypto-bd.js");

// Chargement du .env de la racine (même règle que scripts/start-prod.js).
for (const line of fs
  .readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const DEMANDES = [
  {
    reference: "DEM-2026-00010",
    type: "CONGE",
    cin: "123456050",
    destinataire: "employe.test@autorh.tn",
    employeEmail: "smtp.test@autorh.tn",
    donnees: {
      typeConge: "Congé annuel",
      dateDebut: "2026-10-20",
      dateFin: "2026-10-24",
      managerNom: "Manager Démo",
      commentaire: "Demande de démonstration (test v0.2.195).",
    },
  },
  {
    reference: "DEM-2026-00011",
    type: "AUTORISATION_SORTIE",
    cin: "123456051",
    destinataire: "employe.test@autorh.tn",
    employeEmail: "smtp.test@autorh.tn",
    donnees: {
      date: "2026-10-15",
      heureDebut: "14:00",
      heureFin: "16:00",
      motif: "Rendez-vous administratif (test v0.2.195).",
      managerNom: "Manager Démo",
    },
  },
];

(async () => {
  for (const d of DEMANDES) {
    await db.demandeAdministrative.deleteMany({ where: { reference: d.reference } });
    const cree = await db.demandeAdministrative.create({
      data: {
        reference: d.reference,
        type: d.type,
        cin: cryptoBd.chiffrerChamp(d.cin, true),
        statut: "EN_ATTENTE",
        destinataire: cryptoBd.chiffrerChamp(d.destinataire),
        donnees: cryptoBd.chiffrerChamp(JSON.stringify(d.donnees)),
        employeEmail: cryptoBd.chiffrerChamp(d.employeEmail),
      },
    });
    console.log(
      `[OK] ${cree.reference} (${cree.type}) id=${cree.id} statut=${cree.statut}`
    );
  }
  console.log("Clé : " + (process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY ? "AUTO_RH_STORAGE_KEY" : "AUTH_SECRET (repli)"));
  await db.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
