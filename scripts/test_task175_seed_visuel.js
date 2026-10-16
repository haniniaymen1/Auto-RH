#!/usr/bin/env node
/** Task 175 — sème un accès portail de DÉMONSTRATION pour les captures d'écran
 *  des formulaires Congé / Autorisation de sortie / Parrainage sans champs
 *  redondants (identité récupérée automatiquement du Portail Administration). */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const crypto = require("crypto");
const db = new PrismaClient();

const CIN = "DEMO17501";
const NOM = "Ben Salah Mohamed";

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(mdp, salt, 64).toString("hex")}`;
}

(async () => {
  const cinDet = cryptoBd.chiffrerChamp(CIN, true);
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Demo-175!Pass")),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
      nomPrenom: cryptoBd.chiffrerChamp(NOM),
      email: cryptoBd.chiffrerChamp("employe.demo175@test.tn"),
      mailEnvoyeA: cryptoBd.chiffrerChamp("rh-envoi175@test.tn"),
      mailEnvoyeLe: new Date(Date.now() - 3600000),
    },
  });
  console.log("Accès démo semé :", CIN);
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
