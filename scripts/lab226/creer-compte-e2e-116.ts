/* Recrée l'équivalent du script lab226 (perdu) : compte SUPERADMIN de test
 * temporaire « lab116 » + /tmp/lab116-compte.json { email, password }.
 * Utilise les fonctions de chiffrement EXACTES du projet (clés .env) —
 * l'app chiffre User.email (déterministe) et User.name (aléatoire) via le
 * middleware Prisma ; la création directe doit faire pareil.
 * Idempotent : le compte est réinitialisé s'il existe déjà. */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";
import { chiffrerChamp } from "../../src/lib/db-crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

(async () => {
  const prisma = new PrismaClient();
  const email = "lab116-e2e@autorh.local";
  const password = "Lab116-e2e-" + crypto.randomBytes(6).toString("hex");
  const data = {
    name: chiffrerChamp("Lab116 E2E", false) as string,
    email: chiffrerChamp(email, true) as string,
    passwordHash: hashPassword(password),
    role: "SUPERADMIN",
    isActive: true,
    passwordChangedAt: new Date(),
    passwordExpiresAt: null,
    activatedAt: new Date(),
  };
  const existant = await prisma.user.findFirst({
    where: { email: { startsWith: "encbd1" } },
  });
  // recherche du compte lab116 par déchiffrement (email chiffré déterministe
  // mais findUnique exige la valeur chiffrée exacte — même clé, donc même
  // valeur deterministe : findUnique marche directement)
  const meme = await prisma.user.findUnique({ where: { email: data.email } });
  if (meme) await prisma.user.update({ where: { id: meme.id }, data });
  else if (existant && existant.role === "SUPERADMIN" && existant.passwordHash.startsWith("scrypt:")) {
    // autre compte lab116 possible : on crée simplement le nôtre
    await prisma.user.create({ data });
  } else await prisma.user.create({ data });
  fs.writeFileSync("/tmp/lab116-compte.json", JSON.stringify({ email, password }));
  await prisma.$disconnect();
  console.log("compte lab116 prêt : " + email);
})().catch((e) => { console.error(e); process.exit(1); });
