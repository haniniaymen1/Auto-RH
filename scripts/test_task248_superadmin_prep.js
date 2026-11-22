/* Session superadmin temporaire pour la vérification navigateur v0.2.131.
 * Usage : node scripts/test_task248_superadmin_prep.js [--nettoyer] */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const EMAIL = "diag131sa@test.local";
const MDP = "Diag-2026!SA";
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
async function main() {
  const p = new PrismaClient();
  const emailChiffre = bd.chiffrerChamp(EMAIL, true);
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  if (process.argv.includes("--nettoyer")) {
    console.log("Session superadmin de test supprimée.");
    await p.$disconnect();
    return;
  }
  await p.user.create({ data: { email: emailChiffre, name: "Diag SA", passwordHash: hashPassword(MDP), role: "SUPERADMIN", isActive: true, passwordChangedAt: new Date() } });
  console.log("Session superadmin prête : " + EMAIL);
  await p.$disconnect();
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
