/**
 * Task 98 — Purge chirurgicale : supprimer l'utilisateur de test
 * it-visionneuse-test@autorh.local de la base du TRONC (live),
 * créé par erreur lors de la 1re exécution du harnais (DATABASE_URL
 * hérité de la session). Lecture déchiffrée, suppression ciblée par id.
 * AUCUNE autre table ni ligne n'est touchée.
 */
const path = require("path");
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
const ROOT = "/home/z/my-project/task98_viewer/pristine";
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const EMAIL = "it-visionneuse-test@autorh.local";

(async () => {
  const prisma = new PrismaClient();
  try {
    const tous = await prisma.user.findMany();
    const cibles = [];
    for (const u of tous) {
      try {
        const lisible = cryptoBd.dechiffrerObjet("User", u);
        if (lisible.email === EMAIL) cibles.push(u.id);
      } catch {
        /* ligne non déchiffrable (autre clé) — ignorée, jamais supprimée */
      }
    }
    if (!cibles.length) {
      console.log("Aucun utilisateur de test trouvé dans le tronc — rien à faire.");
    } else {
      const r = await prisma.user.deleteMany({ where: { id: { in: cibles } } });
      console.log(`Supprimé ${r.count} utilisateur(s) de test du tronc : ${cibles.join(", ")}`);
    }
    const restants = await prisma.user.count();
    console.log(`Utilisateurs restants dans le tronc : ${restants}`);
  } finally {
    await prisma.$disconnect();
  }
})();
