/** Retire la demande de démonstration Task 222. */
"use strict";
process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const r = await db.demandeAdministrative.deleteMany({
    where: { cin: cryptoBd.chiffrerChamp("09222444", true) },
  });
  console.log("démo supprimée:", r.count);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
