/**
 * Task 99 — INDEXATION DIRECTE (miroir EXACT de la logique de la route
 * POST /api/payslips/indexation, en accès base direct pour le bac à sable).
 * La route reste le chemin officiel de l'utilisateur (bouton UI) ; ce script
 * prouve la mécanique à l'échelle 240 000 et alimente les tests P4.
 *
 * Miroir strict de src/lib/payslip-index.ts (normalisation + extraction de
 * jetons + empreintes déterministes via scripts/lib-crypto-bd.js).
 */
const crypto = require("crypto");
const path = require("path");

const ROOT = "/home/z/my-project/task99_pagination/base";
process.env.DATABASE_URL = "file:" + path.join(ROOT, "db", "custom.db");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();

/* --- miroir de normaliserCin / extraireTokensCin (payslip-index.ts) --- */
function normaliserCin(v) {
  return String(v ?? "").toUpperCase().replace(/[\s./\-]/g, "");
}
const LONGUEUR_TOKEN_MIN = 6;
const LONGUEUR_TOKEN_MAX = 24;
const JETONS_MAX_PAR_FICHE = 400;
function extraireTokensCin(content) {
  const texte = String(content ?? "").toUpperCase();
  if (!texte) return [];
  const bruts = new Set();
  const reRuns = /[0-9A-Z]+(?:[ \t./-][0-9A-Z]+)*/g;
  const reChiffres = /[0-9]{6,}/g;
  const reAlnum = /[0-9A-Z]{6,}/g;
  let m;
  while ((m = reRuns.exec(texte)) !== null) {
    const run = m[0];
    if (bruts.size >= JETONS_MAX_PAR_FICHE) break;
    const colle = run.replace(/[ \t./-]/g, "");
    if (colle.length >= LONGUEUR_TOKEN_MIN && colle.length <= LONGUEUR_TOKEN_MAX) {
      const chiffres = (colle.match(/[0-9]/g) ?? []).length;
      if (chiffres >= 1 && chiffres * 2 >= colle.length) bruts.add(colle);
    }
    let c;
    reChiffres.lastIndex = 0;
    while ((c = reChiffres.exec(run)) !== null) {
      if (c[0].length <= LONGUEUR_TOKEN_MAX) bruts.add(c[0]);
    }
    let a;
    reAlnum.lastIndex = 0;
    while ((a = reAlnum.exec(run)) !== null) {
      if (a[0].length <= LONGUEUR_TOKEN_MAX && /[0-9]/.test(a[0])) bruts.add(a[0]);
    }
  }
  return Array.from(bruts).slice(0, JETONS_MAX_PAR_FICHE);
}
function indexJeton(t) {
  return t ? cryptoBd.chiffrerChamp(t, true) : null;
}
function indexCin(cin) {
  const n = normaliserCin(cin);
  return { cinIndex: n === "" ? "" : cryptoBd.chiffrerChamp(n, true), cinIndexedAt: new Date() };
}
function indexNom(nom) {
  const v = String(nom ?? "");
  return v === "" ? "" : cryptoBd.chiffrerChamp(v, true);
}

const TAILLE_LOT = 500;

(async () => {
  try {
    const t0 = Date.now();
    let traites = 0;
    for (;;) {
      const lot = await prisma.payslip.findMany({
        where: { cinIndexedAt: null },
        select: { id: true, cin: true, employeeName: true, content: true },
        take: TAILLE_LOT,
      });
      if (lot.length === 0) break;
      const ids = lot.map((f) => f.id);
      await prisma.payslipCinToken.deleteMany({ where: { payslipId: { in: ids } } });
      const jetons = [];
      const maj = [];
      for (const brut of lot) {
        // (correction) le PrismaClient BRUT renvoie les lignes CHIFFRÉES —
        // la route, elle, lit via db.ts qui déchiffre. Miroir exact exigé :
        // déchiffrer AVANT de calculer les empreintes, sinon cinIndex/nomIndex
        // et jetons indexent le texte chiffré (empreintes inexploitables).
        const fiche = cryptoBd.dechiffrerObjet("Payslip", brut);
        for (const token of extraireTokensCin(fiche.content)) {
          const empreinte = indexJeton(token);
          if (empreinte) jetons.push({ payslipId: fiche.id, token: empreinte });
        }
        const idx = indexCin(fiche.cin);
        maj.push({
          id: fiche.id,
          cinIndex: idx.cinIndex,
          cinIndexedAt: idx.cinIndexedAt,
          nomIndex: indexNom(fiche.employeeName),
        });
      }
      if (jetons.length) await prisma.payslipCinToken.createMany({ data: jetons });
      for (const m of maj) {
        await prisma.payslip.update({
          where: { id: m.id },
          data: { cinIndex: m.cinIndex, cinIndexedAt: m.cinIndexedAt, nomIndex: m.nomIndex },
        });
      }
      traites += lot.length;
      if (traites % 5000 < TAILLE_LOT) {
        const s = Math.round((Date.now() - t0) / 1000);
        console.log(`  [direct] ${traites.toLocaleString("fr-FR")} fiches indexées (${s} s, ${Math.round(traites / Math.max(1, s / 1000))}/s)`);
      }
      if (Date.now() - t0 > 480000) {
        console.log("[direct] budget 8 min atteint — relancer le script (idempotent)");
        break;
      }
    }
    const restants = await prisma.payslip.count({ where: { cinIndexedAt: null } });
    const tokens = await prisma.payslipCinToken.count();
    const s = Math.round((Date.now() - t0) / 1000);
    console.log(
      `DIRECT TERMINE: traites=${traites.toLocaleString("fr-FR")}, restants=${restants}, jetons=${tokens.toLocaleString("fr-FR")}, durée=${s} s`
    );
  } catch (e) {
    console.error("[DIRECT ERREUR]", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
  }
})();
