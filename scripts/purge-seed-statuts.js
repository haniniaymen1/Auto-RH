#!/usr/bin/env node
/** (v0.2.141) Purge du seed visuel : demandes + compte RH de test + VACUUM. */
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient();
(async () => {
  const d = await prisma.demandeAdministrative.deleteMany({});
  const u = await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-visuel@test.local", true) } });
  await prisma.$queryRawUnsafe("VACUUM");
  console.log(JSON.stringify({ demandesSupprimees: d.count, utilisateursSupprimes: u.count, demandesRestantes: await prisma.demandeAdministrative.count() }));
  await prisma.$disconnect();
})().catch((e) => { console.error("ERREUR:", e && e.message); process.exit(1); });
