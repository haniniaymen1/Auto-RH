#!/usr/bin/env node
/**
 * Task 92 — préparation de la base DE TEST (copie) pour la suite
 * « Send Mail » : insère un compte RH/IT et DEUX accès portail :
 *  - TEST92CIN1 : accès avec MOT DE PASSE INITIAL ENCORE VALABLE
 *                 (« Initial92x », mustChangePassword = true) + copie
 *                 chiffrée initialPasswordEnc — le bouton « Send Mail »
 *                 doit l'envoyer TEL QUEL ;
 *  - TEST92CIN2 : accès DÉJÀ PASSED au mot de passe personnel
 *                 (mustChangePassword = false, SANS initialPasswordEnc) —
 *                 « Send Mail » sans reset doit REFUSER (409) puis, avec
 *                 reset : true, GÉNÉRER un nouveau mot de passe initial.
 * Usage : DATABASE_URL=file:<copie> node scripts/test92_inserer.js
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

(async () => {
  const operation = process.argv[2] || "inserer";

  if (operation === "user") {
    // Compte RH/IT de test (mot de passe NON expiré) — idempotent.
    const email = "test92@autorh.local";
    try {
      await prisma.user.delete({ where: { email: cryptoBd.chiffrerChamp(email, true) } });
    } catch {}
    await prisma.user.create({
      data: {
        email: cryptoBd.chiffrerChamp(email, true),
        name: cryptoBd.chiffrerChamp("Testeur92", false),
        passwordHash: hacherMotDePasse("Test92Solide"),
        role: "RH",
        isActive: true,
        passwordChangedAt: new Date(),
      },
    });
    console.log("Utilisateur test92 cree.");
    await prisma.$disconnect();
    return;
  }

  // Nettoyage préalable (idempotence)
  for (const cin of ["TEST92CIN1", "TEST92CIN2"]) {
    try {
      await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
    } catch {}
  }
  // Accès avec mot de passe initial ENCORE VALABLE + copie chiffrée
  await prisma.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp("TEST92CIN1", true),
      passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse("Initial92x"), false),
      mustChangePassword: true,
      passwordChangedAt: null,
      initialPasswordEnc: cryptoBd.chiffrerChamp("Initial92x", false),
      isActive: true,
    },
  });
  // Accès déjà passé au mot de passe personnel (plus de mot de passe initial)
  await prisma.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp("TEST92CIN2", true),
      passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse("Propre92x"), false),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      initialPasswordEnc: null,
      isActive: true,
    },
  });
  console.log("Acces test92 crees.");
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
