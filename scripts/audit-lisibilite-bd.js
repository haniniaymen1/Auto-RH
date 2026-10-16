/**
 * (Task 248) Audit de lisibilité des données chiffrées avec la clé actuelle.
 * Vérifie combien de lignes de chaque modèle sont déchiffrables.
 * Usage : node scripts/audit-lisibilite-bd.js
 */
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");

(function chargerEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  for (const ligne of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();
const cryptoBd = require("./lib-crypto-bd.js");
const { estChiffre, dechiffrerChamp } = cryptoBd;

const prisma = new PrismaClient();

function tenter(valeur) {
  if (valeur == null) return "null";
  if (!estChiffre(String(valeur))) return "clair";
  try {
    dechiffrerChamp(String(valeur));
    return "OK";
  } catch {
    return "ILLISIBLE";
  }
}

async function main() {
  // Échantillon de chaque champ sensible
  const payslips = await prisma.payslip.findMany({
    select: { id: true, employeeName: true, cin: true, normalizedContent: true },
    take: 3,
  });
  console.log("=== Payslip (échantillon 3) ===");
  for (const p of payslips) {
    console.log(
      `id=${p.id.slice(0, 8)} cin=${tenter(p.cin)} nom=${tenter(p.employeeName)} contenu=${p.normalizedContent ? "présent(" + p.normalizedContent.length + " car.)" : "absent"}`
    );
  }

  const acces = await prisma.portalAccess.findMany({
    select: { id: true, cin: true, email: true, nomPrenom: true, isActive: true },
    take: 5,
  });
  console.log(`=== PortalAccess (${acces.length} lignes max 5) ===`);
  for (const a of acces) {
    console.log(`id=${a.id.slice(0, 8)} cin=${tenter(a.cin)} email=${tenter(a.email)} nom=${tenter(a.nomPrenom)} actif=${a.isActive}`);
  }
  const totalAcces = await prisma.portalAccess.count();
  console.log(`PortalAccess total : ${totalAcces}`);

  const demandes = await prisma.demandeAdministrative.findMany({ select: { id: true, cin: true }, take: 3 });
  console.log(`=== DemandeAdministrative (échantillon) : ${demandes.length} ===`);
  for (const d of demandes) console.log(`cin=${tenter(d.cin)}`);

  const fiches = await prisma.payslip.count();
  console.log(`Payslip total : ${fiches}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
