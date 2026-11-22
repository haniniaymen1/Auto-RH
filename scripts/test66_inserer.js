#!/usr/bin/env node
/**
 * Task 66 — préparation de la base DE TEST (copie) : insère trois accès
 * portail couvrant les TROIS styles de stockage du mot de passe :
 *  - TEST66NOUV : style NOUVEAU (Task 66) — hash de la forme NETTOYÉE
 *                 (sans tirets) d'un mot de passe initial affiché
 *                 « Kl84-Mn26-Pq79 » ; mustChangePassword = true ;
 *  - TEST66ANCI : style ANCIEN (Task 64/65) — hash de la forme AVEC tirets
 *                 « Hx72-Gt94-Ls61 » (compatibilité des accès déjà créés) ;
 *  - TEST66ESPA : mot de passe CHOISI contenant des espaces, stocké dans sa
 *                 forme nettoyée « MotDePasse66 », déjà consommé (session
 *                 directe, pas de changement exigé).
 * Usage : DATABASE_URL=file:<copie> node scripts/test66_inserer.js inserer
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

/** (Task 66) même nettoyage que scripts/portail-server.js */
function nettoyerMotDePasse(s) {
  return String(s == null ? "" : s).replace(/[\s-]/g, "");
}

(async () => {
  const operation = process.argv[2] || "inserer";
  if (operation === "inserer") {
    // Nettoyage préalable (idempotence)
    for (const cin of ["TEST66NOUV", "TEST66ANCI", "TEST66ESPA"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    // 1) Style NOUVEAU (Task 66) : hash SANS tirets, initial affiché AVEC tirets
    const initialAffiche = "Kl84-Mn26-Pq79";
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST66NOUV", true),
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse(nettoyerMotDePasse(initialAffiche)), false),
        mustChangePassword: true,
        passwordChangedAt: null,
        isActive: true,
      },
    });
    // 2) Style ANCIEN (Task 64/65) : hash AVEC tirets (accès créé avant Task 66)
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST66ANCI", true),
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse("Hx72-Gt94-Ls61"), false),
        mustChangePassword: true,
        passwordChangedAt: null,
        isActive: true,
      },
    });
    // 3) Mot de passe choisi AVEC espaces, stocké nettoyé, déjà actif
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST66ESPA", true),
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse(nettoyerMotDePasse("Mot De Passe 66")), false),
        mustChangePassword: false,
        passwordChangedAt: new Date(), // frais : pas de changement exigé
        isActive: true,
      },
    });
    console.log("3 accès de test insérés (TEST66NOUV nouveau style, TEST66ANCI ancien style, TEST66ESPA espaces).");
  } else if (operation === "nettoyer") {
    for (const cin of ["TEST66NOUV", "TEST66ANCI", "TEST66ESPA"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    console.log("Accès de test Task 66 supprimés.");
  } else {
    console.error("Usage: inserer | nettoyer");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
