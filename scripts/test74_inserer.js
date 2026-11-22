#!/usr/bin/env node
/**
 * Task 74 (étendu Task 75) — jeu d'accès portail JETABLES pour les tests
 * OTP sur COPIE de la base :
 *  - TEST74EXPIRE : mot de passe « Expire74x », accès frais SANS changement
 *    exigé — sert aux preuves d'EXPIRATION du QR (portail TTL réduit) ;
 *  - TEST74ANNULE : mot de passe « Annule74x », accès frais SANS changement
 *    exigé — sert aux preuves d'ANNULATION après 5 mauvais codes.
 * Aucun de ces accès n'a de lastLoginAt : ils sont tous en « première
 * connexion » (Task 75 : le QR/OTP n'est exigé que là).
 *
 * (NOUVEAU Task 75) mode « lire <CIN> » : imprime une ligne JSON
 * LASTLOGIN={"cin":...,"lastLoginAt":...} — permet aux tests Python de
 * vérifier que le verrou « première connexion » est bien posé (ou pas).
 *
 * Usage : DATABASE_URL=file:<copie> node scripts/test74_inserer.js inserer|nettoyer|lire <CIN>
 */
"use strict";
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const prisma = new PrismaClient({ log: ["error"] });

function hacherMotDePasse(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

const ACCES = [
  { cin: "TEST74EXPIRE", motDePasse: "Expire74x" },
  { cin: "TEST74ANNULE", motDePasse: "Annule74x" },
  // (NOUVEAU Task 86) 3e accès jetable — preuves d'expiration du QR
  // (le secret de fenêtre meurt, le code de l'ancien scan est refusé).
  { cin: "TEST86MORT", motDePasse: "Mort86xk" },
];

(async () => {
  const operation = process.argv[2] || "inserer";
  if (operation === "inserer") {
    for (const a of ACCES) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(a.cin, true) } });
      } catch {}
    }
    for (const a of ACCES) {
      await prisma.portalAccess.create({
        data: {
          cin: cryptoBd.chiffrerChamp(a.cin, true),
          passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse(a.motDePasse), false),
          mustChangePassword: false,
          passwordChangedAt: new Date(), // frais : pas de changement exigé
          isActive: true,
        },
      });
    }
    console.log("3 accès de test insérés (TEST74EXPIRE, TEST74ANNULE, TEST86MORT) — premières connexions vierges.");
  } else if (operation === "nettoyer") {
    for (const a of ACCES) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(a.cin, true) } });
      } catch {}
    }
    console.log("Accès de test Task 74/86 supprimés.");
  } else if (operation === "lire") {
    const cin = String(process.argv[3] || "");
    const acc = await prisma.portalAccess.findUnique({
      where: { cin: cryptoBd.chiffrerChamp(cin, true) },
      // (MODIFIÉ Task 80) qrPresente + présence du secret TOTP lisibles
      // également (l'entête du fichier documente ce mode « lire »).
      // (MODIFIÉ Task 86) otpFenetreCreeA lisible (fenêtre du secret
      // d'inscription — null = secret scellé/définitif).
      select: { lastLoginAt: true, qrPresente: true, totpSecret: true, otpFenetreCreeA: true },
    });
    console.log(
      "LASTLOGIN=" +
        JSON.stringify({
          cin: cin,
          lastLoginAt: acc ? acc.lastLoginAt : "ABSENT",
          qrPresente: acc ? acc.qrPresente : "ABSENT",
          aSecret: acc ? Boolean(acc.totpSecret) : "ABSENT",
          otpFenetreCreeA: acc ? acc.otpFenetreCreeA : "ABSENT",
        })
    );
  } else {
    console.error("Usage: inserer | nettoyer | lire <CIN>");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
