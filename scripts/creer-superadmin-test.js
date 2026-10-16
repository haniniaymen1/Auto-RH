// Crée/met à jour le compte superadministrateur de test (DB du répertoire travail).
// ⚠ User.email = champ DÉTERMINISTE (chiffré) + User.name = ALEA (chiffré) —
// le middleware src/lib/db.ts chiffre les where.email de la même façon au login.
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
  const email = "superadmin@autorh.local";
  // recherche par la forme CHIFFRÉE déterministe (comme le ferait le middleware)
  const emailChiffre = cryptoBd.chiffrerChamp(email, true);
  let existant = await db.user.findFirst({ where: { email: emailChiffre } });
  const data = {
    email: emailChiffre,
    name: cryptoBd.chiffrerChamp("SuperAdmin E2E"),
    // (User.passwordHash = scrypt EN CLAIR — verifyPassword lit stored.split(":"))
    passwordHash: hashScrypt("AutoRH-2026!Verif#1"),
    role: "SUPERADMIN",
    isActive: true,
    passwordChangedAt: new Date(),
  };
  if (existant) await db.user.update({ where: { id: existant.id }, data });
  else await db.user.create({ data });
  console.log("Superadmin prêt (email chiffré déterministe) :", email);
  await db.$disconnect();
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
