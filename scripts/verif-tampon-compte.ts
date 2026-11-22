/**
 * (v0.2.137 — vérification toast tampon « Signature électronique »)
 * Crée un compte de TEST éphémère SUPERADMIN pour la vérification E2E
 * (le panneau tampon exige RH/SUPERADMIN, la config du module de signature
 * exige IT/SUPERADMIN — un seul compte SUPERADMIN couvre les deux), puis
 * le supprime. Utilise la couche db du projet (middleware de chiffrement
 * automatique des champs sensibles).
 *
 *   npx tsx scripts/verif-tampon-compte.ts creer
 *   npx tsx scripts/verif-tampon-compte.ts supprimer
 */
import { db } from "../src/lib/db";

const EMAIL = "e2e-tampon@servicerh.local";
const MOT_DE_PASSE = "E2eTampon!2026";

async function main() {
  const action = process.argv[2] ?? "creer";
  if (action === "supprimer") {
    const supprime = await db.user.deleteMany({ where: { email: EMAIL } });
    console.log(`Compte(s) de test supprimé(s) : ${supprime.count}`);
  } else {
    // création (le middleware chiffre l'email de façon déterministe)
    const existant = await db.user.findUnique({ where: { email: EMAIL } });
    if (existant) {
      console.log("Compte de test déjà présent.");
    } else {
      // hash scrypt identique à src/lib/auth.ts (hashPassword)
      const crypto = await import("crypto");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(MOT_DE_PASSE, salt, 64).toString("hex");
      await db.user.create({
        data: {
          email: EMAIL,
          name: "Test E2E Tampon",
          passwordHash: `scrypt:${salt}:${hash}`,
          role: "SUPERADMIN",
          isActive: true,
          passwordChangedAt: new Date(), // évite la session 15 min « à changer »
        },
      });
      console.log("Compte de test créé :", EMAIL);
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
