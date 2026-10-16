/** Diagnostic Task 178 — déchiffre l'e-mail du compte superadmin avec la clé
 *  ACTUELLE (.env) et compare le chiffré déterministe attendu. Lecture seule. */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const PREFIXE_DET = "encbd1d:";
const PREFIXE_ALEA = "encbd1:";
const SEL_CLE_DET = "autorh-db-deterministe-v1";
const SEL_CLE_ALEA = "autorh-db-aleatoire-v1";
const secret =
  process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env";

function cles() {
  const det = crypto.scryptSync(secret, SEL_CLE_DET, 32);
  const alea = crypto.scryptSync(secret, SEL_CLE_ALEA, 32);
  return { det, alea };
}

function dechiffrer(valeur) {
  if (typeof valeur !== "string") return null;
  const det = valeur.startsWith(PREFIXE_DET);
  if (!det && !valeur.startsWith(PREFIXE_ALEA)) return valeur;
  const parties = valeur.split(":");
  // encbd1d:<iv base64>:<tag base64>:<données base64>
  const iv = Buffer.from(parties[1], "base64");
  const tag = Buffer.from(parties[2], "base64");
  const donnees = Buffer.from(parties.slice(3).join(":"), "base64");
  const k = cles();
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", det ? k.det : k.alea, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(donnees), d.final()]).toString("utf8");
  } catch (e) {
    return "!! ECHEC DECHIFFREMENT (" + e.message.slice(0, 60) + ")";
  }
}

db.user.findMany().then(async (us) => {
  console.log("Secret utilisé :", secret.slice(0, 8) + "… (len=" + secret.length + ")");
  for (const u of us) {
    console.log("email déchiffré :", dechiffrer(u.email));
    console.log("nom déchiffré   :", dechiffrer(u.name));
  }
  await db.$disconnect();
});
