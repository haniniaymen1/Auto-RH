#!/usr/bin/env node
/**
 * Task 65 — préparation de la base DE TEST (COPIE uniquement) : insère des
 * fiches de paie de test avec CIN + noms, dont un DOUBLON de CIN sous une
 * forme différente (espaces + minuscules) pour vérifier le dédoublonnage du
 * répertoire des employés (API /api/payslips/employes).
 *
 * Jeu de données :
 *  - TEST65CIN1  : 2 fiches « Karim El Alami »
 *  - TEST65 CIN1 : 1 fiche supplémentaire, même CIN sous forme « sale »
 *                  (minuscules + espace) → doit fusionner avec TEST65CIN1
 *  - TEST65CIN2  : 1 fiche « Fatima Zahra Benali »
 *  - TEST65CIN9  : 1 fiche SANS nom d'employé détecté
 *
 * Chiffrement : FIDÈLE à l'application (src/lib/db.ts + db-crypto) — dans le
 * modèle Payslip, TOUS les champs sensibles sont chiffrés en ALEA (IV
 * aléatoire), y compris « cin ». Le nettoyage déchiffre donc fileName en
 * JavaScript (aucune recherche SQL possible sur un champ alea).
 *
 * Usage : DATABASE_URL=file:<copie> node scripts/test65_inserer.js inserer|nettoyer
 */
"use strict";
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const prisma = new PrismaClient({ log: ["error"] });

const FICHES = [
  {
    fileName: "test65-fiche-karim-1.pdf",
    cin: "TEST65CIN1",
    nom: "Karim El Alami",
    periode: "08/2026",
    net: "5 234,50",
  },
  {
    fileName: "test65-fiche-karim-2.pdf",
    cin: "TEST65CIN1",
    nom: "Karim El Alami",
    periode: "09/2026",
    net: "5 234,50",
  },
  {
    // MÊME CIN sous forme « sale » : espaces + minuscules (dédoublonnage)
    fileName: "test65-fiche-karim-3-sale.pdf",
    cin: "test65 cin1",
    nom: "Karim El Alami",
    periode: "07/2026",
    net: "5 100,00",
  },
  {
    fileName: "test65-fiche-fatima-1.pdf",
    cin: "TEST65CIN2",
    nom: "Fatima Zahra Benali",
    periode: "09/2026",
    net: "6 410,00",
  },
  {
    fileName: "test65-fiche-sansnom-1.pdf",
    cin: "TEST65CIN9",
    nom: null,
    periode: "09/2026",
    net: "3 900,00",
  },
];

async function nettoyerFiches() {
  // fileName est chiffré ALEA → déchiffrement en JavaScript, puis suppression
  // par identifiants (aucun `startsWith` SQL possible).
  const lignes = await prisma.payslip.findMany({ select: { id: true, fileName: true } });
  const cibles = lignes
    .filter((l) => {
      try {
        return cryptoBd.dechiffrerChamp(l.fileName).startsWith("test65-");
      } catch {
        return false;
      }
    })
    .map((l) => l.id);
  if (cibles.length) {
    await prisma.payslip.deleteMany({ where: { id: { in: cibles } } });
  }
}

(async () => {
  const operation = process.argv[2] || "inserer";
  if (operation === "inserer") {
    await nettoyerFiches();
    for (const f of FICHES) {
      const texte =
        "BULLETIN DE PAIE\nEmploye : " + (f.nom ?? "(non detecte)") +
        "\nCIN : " + f.cin + "\nPeriode : " + f.periode +
        "\nNet a payer : " + f.net + " MAD";
      const normalise = texte.toUpperCase().replace(/[\s./-]/g, "");
      await prisma.payslip.create({
        data: {
          fileName: cryptoBd.chiffrerChamp(f.fileName, false),
          storedName: f.fileName, // non chiffré (carte Payslip)
          fileSize: texte.length,
          content: cryptoBd.chiffrerChamp(texte, false),
          normalizedContent: cryptoBd.chiffrerChamp(normalise, false),
          cin: cryptoBd.chiffrerChamp(f.cin, false), // ALEA comme l'application
          employeeName: f.nom ? cryptoBd.chiffrerChamp(f.nom, false) : null,
          period: cryptoBd.chiffrerChamp(f.periode, false),
          netSalary: cryptoBd.chiffrerChamp(f.net, false),
          matricule: null,
          pageNumber: 1,
          sourcePage: null,
        },
      });
    }
    console.log("5 fiches de test insérées (TEST65CIN1 ×3 dont 1 « sale », TEST65CIN2, TEST65CIN9 sans nom).");
  } else if (operation === "nettoyer") {
    await nettoyerFiches();
    for (const cin of ["TEST65CIN1", "TEST65CIN2", "TEST65CIN9"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    console.log("Fiches et accès de test Task 65 supprimés.");
  } else {
    console.error("Usage: inserer | nettoyer");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
