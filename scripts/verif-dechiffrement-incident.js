/**
 * Vérification post-incident 2026-09-23 : TOUTES les données sont-elles
 * déchiffrables avec le secret d'origine (repli par défaut partagé) ?
 * Contrôles : 1 champ aléatoire BD (Payslip.cin), 1 champ déterministe
 * (User.email), 1 fichier disque (PAIESAGE1 -> %PDF). Exit 0 = tout OK.
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dechiffrerChamp, estChiffre } = require("./lib-crypto-bd.js");

const ROOT = path.join(__dirname, "..");
let echecs = 0;
const ok = (n) => console.log("  [OK] " + n);
const ko = (n) => { console.log("  [ECHEC] " + n); echecs++; };

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  // 1. Champ aléatoire : Payslip.cin
  const fiche = await prisma.payslip.findFirst({ where: { cin: { not: "" } } });
  if (!fiche) { ko("aucune fiche en base"); return process.exit(1); }
  if (!estChiffre(fiche.cin)) { ko("Payslip.cin n'est pas chiffré en base"); }
  const cinClair = dechiffrerChamp(fiche.cin);
  const masque = String(cinClair).slice(0, 3) + "*** (" + String(cinClair).length + " car.)";
  if (cinClair && !String(cinClair).startsWith("encbd")) ok("Payslip.cin déchiffré : " + masque);
  else ko("Payslip.cin indéchiffrable");

  // 2. Champ déterministe : User.email
  const user = await prisma.user.findFirst();
  const emailClair = dechiffrerChamp(user.email);
  if (emailClair && String(emailClair).includes("@"))
    ok("User.email déchiffré (déterministe) : " + String(emailClair).slice(0, 2) + "***@***");
  else ko("User.email indéchiffrable");
  await prisma.$disconnect();

  // 3. Fichier disque : PAIESAGE1 -> document d'origine
  const MAGIC = Buffer.from("PAIESAGE1", "utf8");
  const fichier = path.join(ROOT, "storage", "payslips", fiche.storedName);
  if (!fs.existsSync(fichier)) { ko("fichier absent : " + fiche.storedName); return process.exit(1); }
  const buf = fs.readFileSync(fichier);
  if (!buf.subarray(0, 9).equals(MAGIC)) { ko("fichier sans en-tête PAIESAGE1"); return process.exit(1); }
  const cle = crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env",
    "autorh-storage-v1", 32
  );
  const d = crypto.createDecipheriv("aes-256-gcm", cle, buf.subarray(9, 21));
  d.setAuthTag(buf.subarray(21, 37));
  const clair = Buffer.concat([d.update(buf.subarray(37)), d.final()]);
  const entete = clair.subarray(0, 4).toString("latin1");
  if (entete === "%PDF") ok("Fichier " + fiche.storedName + " déchiffré : PDF valide (" + clair.length + " octets)");
  else ko("fichier déchiffré mais en-tête inattendu : " + entete);

  console.log(echecs ? "\nRÉSULTAT : " + echecs + " échec(s)" : "\nRÉSULTAT : TOUT OK — clé d'origine opérationnelle");
  process.exit(echecs ? 1 : 0);
}
main().catch((e) => { console.error("[ERREUR]", e.message); process.exit(1); });
