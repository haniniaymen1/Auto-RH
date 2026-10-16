#!/usr/bin/env node
/* Équivalent du script lab226 (perdu) : compte SUPERADMIN de test temporaire
 * « lab116 » + /tmp/lab116-compte.json { email, password }.
 * CommonJS autonome (appellé par les tests E2E via execFileSync("node", …)).
 * Le chiffrement reproduit EXACTEMENT src/lib/db-crypto.ts (mêmes sels, même
 * secret par défaut — le .env ne définit pas AUTO_RH_STORAGE_KEY/AUTH_SECRET)
 * car l'app chiffre User.email (déterministe) et User.name (aléatoire) via son
 * middleware Prisma. Idempotent : le compte est réinitialisé s'il existe. */
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---- .env (comme start-prod.js) : sans écraser l'environnement existant ----
const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const PREFIXE_ALEA = "encbd1:";
const PREFIXE_DET = "encbd1d:";
const SEL_CLE_ALEA = "autorh-db-aleatoire-v1";
const SEL_CLE_DET = "autorh-db-deterministe-v1";
const SEL_CLE_MAC = "autorh-db-mac-v1";
const TAILLE_IV = 12;

function materielSecret() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}
let clesCache = null;
function cles() {
  if (!clesCache) {
    const secret = materielSecret();
    clesCache = {
      alea: crypto.scryptSync(secret, SEL_CLE_ALEA, 32),
      det: crypto.scryptSync(secret, SEL_CLE_DET, 32),
      mac: crypto.scryptSync(secret, SEL_CLE_MAC, 32),
    };
  }
  return clesCache;
}
function chiffrerChamp(valeur, deterministe) {
  if (valeur === null || valeur === undefined) return valeur;
  const texte = String(valeur);
  if (texte === "") return valeur;
  if (texte.startsWith(PREFIXE_ALEA) || texte.startsWith(PREFIXE_DET)) return valeur;
  const k = cles();
  const iv = deterministe
    ? crypto.createHmac("sha256", k.mac).update(texte, "utf8").digest().subarray(0, TAILLE_IV)
    : crypto.randomBytes(TAILLE_IV);
  const chiffre = crypto.createCipheriv("aes-256-gcm", deterministe ? k.det : k.alea, iv);
  const donnees = Buffer.concat([chiffre.update(texte, "utf8"), chiffre.final()]);
  const tag = chiffre.getAuthTag();
  return (
    (deterministe ? PREFIXE_DET : PREFIXE_ALEA) +
    iv.toString("base64") + ":" + tag.toString("base64") + ":" + donnees.toString("base64")
  );
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

(async () => {
  const prisma = new PrismaClient();
  const email = "lab-e2e-116@autorh.local";
  const password = "Lab116-e2e-" + crypto.randomBytes(6).toString("hex");
  const data = {
    name: chiffrerChamp("Lab116 E2E", false),
    email: chiffrerChamp(email, true),
    passwordHash: hashPassword(password),
    role: "SUPERADMIN",
    isActive: true,
    passwordChangedAt: new Date(),
    passwordExpiresAt: null,
    activatedAt: new Date(),
  };
  const existant = await prisma.user.findUnique({ where: { email: data.email } });
  if (existant) await prisma.user.update({ where: { id: existant.id }, data });
  else await prisma.user.create({ data });
  fs.writeFileSync("/tmp/lab116-compte.json", JSON.stringify({ email, password }));
  await prisma.$disconnect();
  console.log("compte lab116 prêt : " + email);
})().catch((e) => { console.error(e); process.exit(1); });
