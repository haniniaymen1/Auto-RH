#!/usr/bin/env node
/* Task 173 — nettoyage vérifié de la préparation navigateur :
 * - supprime les comptes de démonstration (it-demo173 / rh-demo173) ;
 * - supprime la fiche + l'accès portail semés (TEST17302) ;
 * - remet la configuration SMTP à son état d'origine (hôte de test retiré).
 * Chaque suppression est VÉRIFIÉE. */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

async function main() {
  const idx = cryptoBd.chiffrerChamp("TEST17302", true);
  const dF = await db.payslip.deleteMany({ where: { fileName: "e2e-173-vue.pdf" } });
  const dA = await db.portalAccess.deleteMany({ where: { cin: idx } });
  console.log(`fiche semée supprimée : ${dF.count} (attendu 1)`);
  console.log(`accès semé supprimé   : ${dA.count} (attendu 1)`);

  // NB : User.email est chiffré DÉTERMINISTE en base — la recherche brute
  // doit chiffrer les adresses de la même façon (comme chiffrerWhere).
  const emails = ["it-demo173@test.local", "rh-demo173@test.local"].map(
    (e) => cryptoBd.chiffrerChamp(e, true)
  );
  const users = await db.user.findMany({ where: { email: { in: emails } } });
  for (const u of users) {
    await db.user.delete({ where: { id: u.id } });
    console.log("compte supprimé :", u.email);
  }

  // Configuration SMTP : l'E2E avait posé host=smtp.test.local sur une config
  // VIDE à l'origine — retour à l'état non configuré.
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  if (cfg && cfg.host === "smtp.test.local") {
    await db.mailConfig.update({
      where: { id: "smtp" },
      data: { host: "", port: 587, secure: false, username: null, from: "", imapActif: false, imapHost: "", imapUser: null },
    });
    console.log("config SMTP remise à l'état non configuré (hôte de test retiré)");
  } else {
    console.log("config SMTP : aucun hôte de test détecté (rien à faire)");
  }

  const nbUsers = await db.user.count();
  const nbFiches = await db.payslip.count({ where: { cinIndex: idx } });
  const nbAcces = await db.portalAccess.count({ where: { cin: idx } });
  console.log(`État final : users=${nbUsers} (attendu 1), fiches test=${nbFiches} (attendu 0), accès test=${nbAcces} (attendu 0)`);
  if (nbUsers !== 1 || nbFiches !== 0 || nbAcces !== 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
