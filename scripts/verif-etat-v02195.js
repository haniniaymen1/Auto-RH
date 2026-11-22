/**
 * Vérification d'état pour la preuve v0.2.195 :
 *  - comptes de test (RH / superadmin) présents ;
 *  - demandes de congé / autorisation à deux étapes disponibles pour le test
 *    navigateur (la carte « Décision Manager » n'existe que pour deuxEtapes).
 * Lecture seule — aucune modification de la base.
 */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const users = await db.user.findMany({
    select: { email: true, role: true },
    take: 20,
  });
  console.log("USERS:", JSON.stringify(users));

  const demandes = await db.demandeAdministrative
    .findMany({
      select: {
        id: true,
        reference: true,
        type: true,
        statut: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
    .catch((e) => {
      console.log("ERR demandes:", e.message);
      return [];
    });
  if (demandes) {
    console.log("DEMANDES (10 dernières):");
    for (const d of demandes) {
      console.log(
        ` - ${d.reference} type=${d.type} statut=${d.statut} créée=${d.createdAt?.toISOString?.() ?? d.createdAt}`
      );
    }
  }
  await db.$disconnect();
})();
