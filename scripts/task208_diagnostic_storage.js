#!/usr/bin/env node
// Task 208 — diagnostic de l'état du stockage après la 1re passe
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "/home/z/my-project";
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const isEnc = (b) => b.length > MAGIC.length && b.subarray(0, MAGIC.length).equals(MAGIC);
const cle = (mat) => crypto.scryptSync(mat, "autorh-storage-v1", 32);
const essai = (buf, k) => {
  try {
    const n = buf.subarray(8, 20), t = buf.subarray(20, 36), c = buf.subarray(36);
    const d = crypto.createDecipheriv("aes-256-gcm", k, n);
    d.setAuthTag(t);
    Buffer.concat([d.update(c), d.final()]);
    return true;
  } catch { return false; }
};

const MATIERES = {
  "repli-public": "autorh-storage-local-a-changer-dans-env",
};
try {
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const m1 = env.match(/^AUTH_SECRET=(.+)$/m), m2 = env.match(/^AUTO_RH_STORAGE_KEY=(.+)$/m);
  if (m1) MATIERES["AUTH_SECRET(.env)"] = m1[1].trim();
  if (m2) MATIERES["AUTO_RH_STORAGE_KEY(.env)"] = m2[1].trim();
} catch {}
// Dérivation UNE SEULE FOIS (scrypt ≈ 100 ms — jamais par fichier)
const CLES = {};
for (const [nom, mat] of Object.entries(MATIERES)) CLES[nom] = cle(mat);

const DIRS = [
  "storage/payslips", "storage/tampons", "storage/documents-demandes",
  ".next/standalone/storage/payslips", ".next/standalone/storage/tampons",
  ".next/standalone/storage/documents-demandes",
];

for (const d of DIRS) {
  const full = path.join(ROOT, d);
  let files = [];
  try { files = fs.readdirSync(full).filter((f) => fs.statSync(path.join(full, f)).isFile()); } catch { continue; }
  let plain = 0, enc = 0, okParCle = {}, koParCle = {}, exemplesKo = [];
  for (const f of files) {
    const b = fs.readFileSync(path.join(full, f));
    if (!isEnc(b)) { plain++; continue; }
    enc++;
    let reussi = false;
    for (const [nom] of Object.entries(CLES)) {
      if (essai(b, CLES[nom])) {
        okParCle[nom] = (okParCle[nom] || 0) + 1; reussi = true; break;
      }
    }
    if (!reussi) {
      koParCle["inconnue"] = (koParCle["inconnue"] || 0) + 1;
      if (exemplesKo.length < 3) exemplesKo.push(f + " (" + b.length + " o)");
    }
  }
  console.log(`\n[${d}] fichiers=${files.length} enClair=${plain} chiffrés=${enc}`);
  for (const [k, v] of Object.entries(okParCle)) console.log(`   déchiffrables avec « ${k} » : ${v}`);
  if (koParCle.inconnue) {
    console.log(`   ILLISIBLES avec toutes les matières testées : ${koParCle.inconnue}`);
    for (const e of exemplesKo) console.log(`      ex. ${e}`);
  }
}
console.log("\nMatières testées :", Object.keys(MATIERES).join(", "));
