/**
 * (Task 248) Lecture des comptes User avec déchiffrement de l'email.
 * Utilisé pour diagnostiquer l'échec de login après écrasement du .env.
 * Usage : node scripts/lire-comptes-user.js
 */
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");

// Charge le .env racine manuellement (dotenv non installé)
(function chargerEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  for (const ligne of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();
const cryptoBd = require("./lib-crypto-bd.js");

const prisma = new PrismaClient();

async function main() {
  const comptes = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  console.log(`Comptes trouvés : ${comptes.length}`);
  for (const c of comptes) {
    let emailLisible = "(indéchiffrable)";
    try {
      emailLisible = cryptoBd.dechiffrerChamp(c.email);
    } catch (e) {
      emailLisible = `(indéchiffrable : ${e.message.slice(0, 60)})`;
    }
    console.log(`- role=${c.role} actif=${c.isActive} créé=${c.createdAt?.toISOString?.() ?? c.createdAt}`);
    console.log(`  email chiffré : ${String(c.email).slice(0, 40)}…`);
    console.log(`  email clair   : ${emailLisible}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
