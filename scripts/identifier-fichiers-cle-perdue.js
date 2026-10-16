/**
 * Identification (lecture seule) des fichiers storage/payslips dont le
 * déchiffment échoue avec le secret actuellement disponible — c.-à-d. les
 * fichiers chiffrés avec la clé perdue (épinglage Task 136).
 * Sortie : liste + comptes. Ne modifie AUCUN fichier.
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "storage", "payslips");
const MAGIC = Buffer.from("PAIESAGE1", "utf8");

const cle = crypto.scryptSync(
  process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env",
  "autorh-storage-v1", 32
);

const fichiers = fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile());
let chiffres = 0, clairs = 0, perdus = [];
for (const f of fichiers) {
  const buf = fs.readFileSync(path.join(DIR, f));
  if (!buf.subarray(0, 9).equals(MAGIC)) { clairs++; continue; }
  chiffres++;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", cle, buf.subarray(9, 21));
    d.setAuthTag(buf.subarray(21, 37));
    Buffer.concat([d.update(buf.subarray(37)), d.final()]);
  } catch {
    perdus.push(f);
  }
}
console.log("Fichiers examinés      : " + fichiers.length);
console.log("Chiffrés (PAIESAGE1)   : " + chiffres);
console.log("En clair               : " + clairs);
console.log("Illisibles (clé perdue): " + perdus.length);
if (perdus.length) {
  const sortie = path.join(ROOT, "db", "fichiers-cle-perdue-" + new Date().toISOString().slice(0, 10) + ".txt");
  fs.writeFileSync(sortie, perdus.join("\n") + "\n");
  console.log("Liste écrite : " + sortie);
  console.log(perdus.slice(0, 10).join("\n") + (perdus.length > 10 ? "\n  … (+ " + (perdus.length - 10) + ")" : ""));
}
