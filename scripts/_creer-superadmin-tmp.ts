import { db } from "../src/lib/db";
const EMAIL = "superadmin@autorh.local";
const MDP = "AutoRH-2026!Verif#1";
async function main() {
  const existant = await db.user.findUnique({ where: { email: EMAIL } });
  if (existant) { console.log("déjà présent"); return; }
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(MDP, salt, 64).toString("hex");
  await db.user.create({ data: {
    email: EMAIL, name: "Superadmin Temp", passwordHash: `scrypt:${salt}:${hash}`,
    role: "SUPERADMIN", isActive: true, passwordChangedAt: new Date(),
  }});
  console.log("SUPERADMIN temporaire créé");
  await db.$disconnect();
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
