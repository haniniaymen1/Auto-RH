/**
 * Task 99 (re-vérification) — diagnostic cinIndex : les empreintes du script
 * direct correspondent-elles à celles du serveur ? Les fiches de même CIN
 * partagent-elles la même empreinte (déterminisme) ?
 * FORCÉ: DATABASE_URL = sandbox task99 (jamais le tronc).
 */
const path = require("path");
const ROOT = "/home/z/my-project/task99_pagination/base";
process.env.DATABASE_URL = "file:" + path.join(ROOT, "db", "custom.db");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

(async () => {
  try {
    // 1) Les 150 fiches « fréquentes » (CIN 55554444, employé EMPLOYE FREQUENT)
    const freq = await prisma.payslip.findMany({
      where: { storedName: { startsWith: "t99-bulk-" } },
      select: { id: true, cin: true, cinIndex: true, cinIndexedAt: true },
      take: 300,
    });
    // findMany ne déchiffre pas : déchiffrons pour identifier les fréquentes
    const dec = freq
      .map((r) => ({ id: r.id, cin: cryptoBd.dechiffrerChamp(r.cin), cinIndex: r.cinIndex, at: r.cinIndexedAt }))
      .filter((r) => r.cin === "55554444")
      .slice(0, 5);
    console.log("fiches fréquentes trouvées (échantillon):", dec.length);
    const empSet = new Set(dec.map((d) => d.cinIndex));
    console.log("cinIndex DISTINCTS parmi l'échantillon fréquent:", empSet.size);
    for (const d of dec) console.log("  id", d.id, "cinIndex prefix:", String(d.cinIndex).slice(0, 12), "indexé le:", d.at?.toISOString?.());

    // 2) Fiche E1 (indexée PAR LE SERVEUR pendant S11/redetect)
    const e1 = await prisma.payslip.findFirst({
      where: {
        NOT: { storedName: { startsWith: "t99-bulk-" } },
        storedName: { startsWith: "t99-" },
      },
      select: { id: true, cin: true, cinIndex: true, cinIndexedAt: true },
    });
    if (e1) {
      console.log("E1 (indexée par serveur): cin déchiffré =", cryptoBd.dechiffrerChamp(e1.cin));
      console.log("  cinIndex prefix:", String(e1.cinIndex).slice(0, 12), "indexé le:", e1.cinIndexedAt?.toISOString?.());
    }

    // 3) L'empreinte QUE CALCULERAIT le serveur pour la requête 55554444
    const empServeur = cryptoBd.chiffrerChamp("55554444", true);
    console.log("empreinte serveur attendue pour « 55554444 »:", empServeur.slice(0, 12), "…");
    const match = await prisma.payslip.count({ where: { cinIndex: empServeur } });
    console.log("fiches dont cinIndex == empreinte serveur:", match);

    // 4) Répartition globale des cinIndex (doublons attendus vs constatés)
    const total = await prisma.payslip.count();
    const avecIndex = await prisma.payslip.count({ where: { cinIndex: { not: "" } } });
    console.log(`total=${total}, cinIndex non vides=${avecIndex}`);
  } catch (e) {
    console.error("[DIAG ERREUR]", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
  }
})();
