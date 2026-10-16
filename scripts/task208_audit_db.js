#!/usr/bin/env node
// Task 208 — audit brut de la base : chaque champ sensible testé contre
// l'ancienne matière (repli public), la NOUVELLE clé (.env) — verdict par ligne.
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const ROOT = "/home/z/my-project";
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const NOUVELLE = (env.match(/^AUTO_RH_STORAGE_KEY=(.+)$/m) || [])[1].trim();
const ANCIENNE = "autorh-storage-local-a-changer-dans-env";

const SELS = { alea: "autorh-db-aleatoire-v1", det: "autorh-db-deterministe-v1" };
const cles = {};
for (const [nom, sel] of Object.entries(SELS)) {
  cles[nom] = {
    nouvelle: crypto.scryptSync(NOUVELLE, sel, 32),
    ancienne: crypto.scryptSync(ANCIENNE, sel, 32),
  };
}
function testValeur(v, genre) {
  if (v === null || v === undefined || v === "") return "vide";
  const det = v.startsWith("encbd1d:");
  const aleatoire = v.startsWith("encbd1:");
  if (!det && !aleatoire) return "clair";
  const genre2 = det ? "det" : "alea";
  const parties = v.split(":");
  const iv = Buffer.from(parties[1], "base64");
  const tag = Buffer.from(parties[2], "base64");
  const donnees = Buffer.from(parties.slice(3).join(":"), "base64");
  for (const [nom, k] of Object.entries(cles[genre2])) {
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
      d.setAuthTag(tag);
      Buffer.concat([d.update(donnees), d.final()]);
      return nom; // "nouvelle" | "ancienne"
    } catch {}
  }
  return "PERDUE";
}
function champsDe(m) {
  const c = {
    Payslip: { det: [], alea: ["cin","fileName","content","normalizedContent","employeeName","period","netSalary","matricule","anomalieNom"] },
    PortalAccess: { det: ["cin"], alea: ["totpSecret","passwordHash","initialPasswordEnc","mailEnvoyeA","email","nomPrenom"] },
    User: { det: ["email"], alea: ["name"] },
    ImportLog: { det: [], alea: ["cinDetected","fileName","message"] },
    MailConfig: { det: [], alea: ["username","password","imapUser","imapPassword"] },
    DemandeAdministrative: { det: ["cin"], alea: ["donnees","destinataire","employeEmail"] },
    SignatureConfig: { det: [], alea: ["certMotDePasse"] },
    SignatureConfigReponse: { det: [], alea: ["certMotDePasse"] },
  }[m];
  return [...c.det.map((x) => [x, true]), ...c.alea.map((x) => [x, false])];
}
async function main() {
  for (const [modele, delegate] of [
    ["User", "user"], ["ImportLog", "importLog"], ["MailConfig", "mailConfig"],
    ["SignatureConfig", "signatureConfig"], ["SignatureConfigReponse", "signatureConfigReponse"],
  ]) {
    const lignes = await db[delegate].findMany();
    if (!lignes.length) { console.log(`\n[${modele}] 0 ligne`); continue; }
    console.log(`\n[${modele}] ${lignes.length} ligne(s)`);
    for (const l of lignes) {
      const ident = String(l.id ?? l.reference ?? "?").slice(0, 20);
      for (const [champ] of champsDe(modele)) {
        if (l[champ] === undefined) continue;
        const verdict = testValeur(l[champ]);
        if (verdict !== "vide") console.log(`  ${ident} . ${champ} : ${verdict}`);
      }
    }
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
