/**
 * DEMO : lire la base SQLite db/custom.db en lecture seule (node:sqlite natif).
 * Usage : node scripts/lire-base-demo.js
 */
"use strict";
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("/home/z/my-project/db/custom.db", { readOnly: true });

// 1) Liste des tables + nombre de lignes
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

console.log("=== TABLES ===");
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n;
  console.log(`  ${t.name.padEnd(15)} ${n} ligne(s)`);
}

// 2) Comptes utilisateurs (champs sensibles chiffrés Task 32)
console.log("\n=== User (extrait, champs chiffrés visibles tels quels) ===");
for (const u of db.prepare("SELECT id, email, name, role, isActive FROM User LIMIT 5").all()) {
  const email = String(u.email).slice(0, 42) + (String(u.email).length > 42 ? "…" : "");
  console.log(`  role=${u.role}  actif=${u.isActive}  email=${email}`);
}

// 3) Fiches de paie (champs sensibles chiffrés)
console.log("\n=== Payslip (3 premiers, tronqués) ===");
for (const p of db.prepare("SELECT fileName, cin, employeeName, period, netSalary, pageNumber, fileSize FROM Payslip LIMIT 3").all()) {
  const cut = (v) => (v == null ? "null" : String(v).slice(0, 30) + (String(v).length > 30 ? "…" : ""));
  console.log(`  fichier=${cut(p.fileName)}  pages=${p.pageNumber}  taille=${p.fileSize}o`);
  console.log(`    cin=${cut(p.cin)}  nom=${cut(p.employeeName)}  période=${cut(p.period)}  net=${cut(p.netSalary)}`);
}

// 4) Accès portail OTP
console.log("\n=== PortalAccess ===");
const pa = db.prepare("SELECT COUNT(*) AS n FROM PortalAccess").get().n;
console.log(`  ${pa} CIN autorisé(s) au portail`);

db.close();
console.log("\nOK — lecture terminée (aucune modification).");
