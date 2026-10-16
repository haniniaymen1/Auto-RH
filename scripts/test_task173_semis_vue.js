#!/usr/bin/env node
/* Task 173 — préparation de la vérification navigateur :
 * sème 1 fiche + 1 accès portail (CIN TEST17302, nom « Ancien Nom »)
 * et crée les comptes de test IT / RH. Renvoie les identifiants.
 * (Le nettoyage est fait par test_task173_nettoyage.js.) */
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

const BASE = "http://localhost:4000";
const MDP = "Demo-173!Vue";

async function main() {
  const CIN = "TEST17302";
  const idx = cryptoBd.chiffrerChamp(CIN, true);
  await db.payslip.deleteMany({ where: { fileName: "e2e-173-vue.pdf" } });
  await db.portalAccess.deleteMany({ where: { cin: idx } });
  await db.payslip.create({
    data: {
      fileName: "e2e-173-vue.pdf",
      storedName: "e2e-173-vue.pdf",
      fileSize: 100,
      content: "FICHE DE PAIE " + CIN,
      normalizedContent: "FICHE DE PAIE " + CIN,
      cin: CIN,
      cinIndex: idx,
      employeeName: "Ancien Nom",
      period: "09/2026",
      netSalary: "1 234,56",
    },
  });
  await db.portalAccess.create({ data: { cin: idx, isActive: true } });
  console.log("Fiche + accès semés pour " + CIN);

  // Comptes de démonstration (créés via l'API, comme le ferait le superadmin)
  async function api(email) {
    const login = await fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const res = await fetch(BASE + "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: email.split("@")[0].toUpperCase(), email, password: MDP, role: email.startsWith("it-") ? "IT" : "RH" }),
    });
    console.log("Création", email, "→", res.status);
  }
  await api("it-demo173@test.local");
  await api("rh-demo173@test.local");
  console.log("MDP des deux comptes :", MDP);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
