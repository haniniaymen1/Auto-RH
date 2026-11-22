/* Préparation vérification navigateur v0.2.131 : session RH + 2 accès de test.
 * Usage : node scripts/test_task248_navigateur_prep.js   (créer)
 *         node scripts/test_task248_navigateur_prep.js --nettoyer   (supprimer) */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const BASE = "http://127.0.0.1:4000";
const EMAIL = "diag131@test.local";
const MDP = "Diag-2026!131";
const CINA = "TESTBROWSER131A";
const CINB = "TESTBROWSER131B";
const NOMA = "Ben Salah Karim";
const NOMB = "Trabelsi Sonia";
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
async function main() {
  const p = new PrismaClient();
  const emailChiffre = bd.chiffrerChamp(EMAIL, true);
  const nettoyer = process.argv.includes("--nettoyer");
  // suppression des accès de test (par CIN chiffré : on repère par recherche
  // après déchiffrement via le client — la carte cin est chiffrée déterministe,
  // une lecture findMany déchiffrée est plus simple)
  const tous = await p.portalAccess.findMany({ select: { id: true, cin: true } });
  const cibles = tous.filter((a) => a.cin === CINA || a.cin === CINB).map((a) => a.id);
  if (cibles.length) {
    await p.portalAccess.deleteMany({ where: { id: { in: cibles } } });
    console.log("Accès de test existants supprimés :", cibles.length);
  }
  if (nettoyer) {
    await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
    console.log("Session de test supprimée. NETTOYAGE TERMINÉ.");
    await p.$disconnect();
    return;
  }
  // accès A : nom pré-rempli (affiché dans la liste déroulante)
  await p.portalAccess.create({
    data: { cin: CINA, nom: "Salah", prenom: "Karim", nomPrenom: NOMA, passwordHash: hashPassword("Init-2026!A1"), mustChangePassword: true, isActive: true },
  });
  await p.portalAccess.create({
    data: { cin: CINB, nom: "Trabelsi", prenom: "Sonia", nomPrenom: NOMB, passwordHash: hashPassword("Init-2026!B2"), mustChangePassword: true, isActive: true },
  });
  // session RH de test (passwordChangedAt posé → pas de forçage de changement)
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  await p.user.create({ data: { email: emailChiffre, name: "Diag 131", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
  console.log("PRÊT : accès " + CINA + " / " + CINB + " + session " + EMAIL + " créés.");
  await p.$disconnect();
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
