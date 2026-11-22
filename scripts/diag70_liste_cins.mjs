/** Liste les CIN distincts de la colonne Payslip.cin (COPIE ou base démo). */
import { register } from "node:module";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
register("./ts-resolve-hook.mjs", import.meta.url);
const req = createRequire(import.meta.url);
const { dechiffrerChamp } = req("./lib-crypto-bd.js");
const chemin = process.env.DB_CHEMIN || "db/custom.db";
const db = new DatabaseSync(chemin);
const rows = db.prepare('SELECT "fileName", "cin" FROM Payslip').all();
const norm = (x) => (x ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
const set = new Set();
for (const r of rows) {
  const c = norm(dechiffrerChamp(r.cin) ?? "");
  if (c) set.add(c);
}
console.log(`Fiches : ${rows.length} — CIN colonne distincts : ${set.size} (${chemin})`);
console.log([...set].join(", "));
