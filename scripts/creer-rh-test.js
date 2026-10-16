// Crée/met à jour le compte RH de test (même mécanique que creer-superadmin-test.js).
"use strict";
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

(async () => {
  const email = "rh@autorh.local";
  const emailChiffre = cryptoBd.chiffrerChamp(email, true);
  let existant = await db.user.findFirst({ where: { email: emailChiffre } });
  const data = {
    email: emailChiffre,
    name: cryptoBd.chiffrerChamp("RH E2E"),
    passwordHash: hashScrypt("AutoRH-2026!Verif#1"),
    role: "RH",
    isActive: true,
    passwordChangedAt: new Date(),
  };
  if (existant) await db.user.update({ where: { id: existant.id }, data });
  else await db.user.create({ data });
  console.log("RH prêt :", email, "/ AutoRH-2026!Verif#1");
  await db.$disconnect();
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
