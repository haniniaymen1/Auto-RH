#!/usr/bin/env node
/**
 * Task 64 — préparation de la base DE TEST (copie) : insère deux accès portail :
 *  - TEST64CIN      : accès « moderne » (mot de passe initial "Initial64x",
 *                     mustChangePassword = true, passwordChangedAt = null) ;
 *  - TEST64OTP      : accès « ancien OTP » (totpSecret présent, PAS de
 *                     passwordHash) pour tester le message de migration.
 * Usage : DATABASE_URL=file:<copie> node scripts/test64_inserer.js
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
  if (operation === "inserer") {
    // Nettoyage préalable (idempotence)
    for (const cin of ["TEST64CIN", "TEST64OTP", "TEST64EXPIRE"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST64CIN", true),
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse("Initial64x"), false),
        mustChangePassword: true,
        passwordChangedAt: null,
        isActive: true,
      },
    });
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST64OTP", true),
        totpSecret: cryptoBd.chiffrerChamp("JBSWY3DPEHPK3PXP", false), // ancien secret OTP (factice)
        passwordHash: null,
        isActive: true,
      },
    });
    await prisma.portalAccess.create({
      data: {
        cin: cryptoBd.chiffrerChamp("TEST64EXPIRE", true),
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse("AncienMotDePasse64"), false),
        mustChangePassword: false,
        passwordChangedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000), // expiré (16 jours)
        isActive: true,
      },
    });
    console.log("3 accès de test insérés (TEST64CIN initial, TEST64OTP ancien, TEST64EXPIRE expiré).");
  } else if (operation === "dater") {
    // Positionne passwordChangedAt de TEST64CIN à il y a 16 jours (expiration)
    await prisma.portalAccess.update({
      where: { cin: cryptoBd.chiffrerChamp("TEST64CIN", true) },
      data: { passwordChangedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000) },
    });
    console.log("TEST64CIN : passwordChangedAt reculé de 16 jours (expiré).");
  } else if (operation === "user") {
    // NOUVEAU (Task 64) : compte ADMIN de test (mot de passe EXPIRÉ : passwordChangedAt null)
    for (const email of ["test64@autorh.local"]) {
      try {
        const u = await prisma.user.findUnique({ where: { email: cryptoBd.chiffrerChamp(email, true) } });
        if (u) await prisma.user.delete({ where: { id: u.id } });
      } catch {}
    }
    await prisma.user.create({
      data: {
        email: cryptoBd.chiffrerChamp("test64@autorh.local", true),
        name: cryptoBd.chiffrerChamp("Test Task 64"),
        role: "IT",
        passwordHash: hacherMotDePasse("AncienMot64"),
        passwordChangedAt: null, // expiré → changement OBLIGATOIRE à la connexion
        isActive: true,
      },
    });
    console.log("Compte admin de test inséré (test64@autorh.local / AncienMot64, expiré).");
  } else if (operation === "nettoyer") {
    for (const cin of ["TEST64CIN", "TEST64OTP", "TEST64EXPIRE"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    console.log("Accès de test supprimés.");
  } else if (operation === "nettoyer-user") {
    try {
      const u = await prisma.user.findUnique({ where: { email: cryptoBd.chiffrerChamp("test64@autorh.local", true) } });
      if (u) await prisma.user.delete({ where: { id: u.id } });
      console.log("Compte admin de test supprimé.");
    } catch (e) {
      console.log("Compte admin de test déjà absent.");
    }
  } else {
    console.error("Usage: inserer | dater | nettoyer | user | nettoyer-user");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
