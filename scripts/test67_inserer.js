#!/usr/bin/env node
/**
 * Task 67 — préparation de la base DE TEST (COPIE uniquement) : insère des
 * fiches simulant le cas réel « le répertoire n'affiche qu'un seul CIN alors
 * que les fiches importées en contiennent plusieurs ».
 *
 * Jeu de données (préfixe fichier test67-) — chaque fiche illustre UNE source
 * du répertoire enrichi /api/payslips/employes :
 *  F1  S1 colonne cin remplie (« 12 345 671 »)      -> 12345671 (Alia)
 *  F2  S2 détection ACTUELLE sur contenu (import ancien) -> 23456782 (Bilel)
 *  F2b S2 même CIN forme « sale » (23-456-782)      -> fusion fiches=2
 *  F3  S4 libellé élargi « Carte identité »         -> 34567893 (Chadia)
 *  F4  S4 « Carte nationale d'identité »            -> 45678904 (Dalia)
 *  F5  S5 nom de fichier bulletin_56789012_2024.pdf CONFIRMÉ dans le contenu
 *      (le contenu contient d'abord un N° CNSS « 17775208 - 08 » qui piège la
 *      détection simple)                            -> 56789012 (sans nom)
 *  F6  S2 règle « tableau » CIN récent à 9 chiffres -> 123456789 (Ezzedine)
 *  F7  NÉGATIF : montants SANS libellé CIN + nom de fichier « 20240912 »
 *      -> AUCUN CIN proposé (12845023 / 20240912 absents)
 *  F8  NÉGATIF : contenu vide (scan OCR échoué)     -> AUCUN CIN
 *
 * Chiffrement : FIDÈLE à l'application (src/lib/db.ts + db-crypto) — dans le
 * modèle Payslip, TOUS les champs sensibles sont chiffrés en ALEA (IV
 * aléatoire), y compris « cin ». Le nettoyage déchiffre donc fileName en
 * JavaScript (aucune recherche SQL possible sur un champ alea).
 *
 * Usage : DATABASE_URL=file:<copie> node scripts/test67_inserer.js inserer|nettoyer
 */
"use strict";
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const prisma = new PrismaClient({ log: ["error"] });

const FICHES = [
  {
    fileName: "test67-colonne-1.pdf",
    cin: "12 345 671", // forme « sale » volontaire dans la colonne
    nom: "Alia Trabelsi",
    contenu:
      "BULLETIN DE PAIE\nEmploye : Alia Trabelsi\nCIN : 12 345 671\nPeriode : 09/2026\nNet a payer : 5 200,00 MAD",
  },
  {
    fileName: "test67-contenu-1.pdf",
    cin: null, // import ancien : extraction CIN manquée
    nom: "Bilel Mansouri",
    contenu:
      "SOCIETE MODERNE\nBULLETIN DE PAIE\nC.I.N : 23 456 782\nEmploye : Bilel Mansouri\nPeriode : 08/2026\nNet a payer : 6 100,00 MAD",
  },
  {
    fileName: "test67-contenu-2-sale.pdf",
    cin: null,
    nom: "Bilel Mansouri",
    contenu:
      "SOCIETE MODERNE\nBULLETIN DE PAIE\nN° CIN : 23-456-782\nEmploye : Bilel Mansouri\nPeriode : 09/2026\nNet a payer : 6 100,00 MAD",
  },
  {
    fileName: "test67-libelle-elargi.pdf",
    cin: null,
    nom: "Chadia Nasser",
    contenu:
      "BULLETIN DE PAIE\nCarte identité n° 34 567 893\nEmploye : Chadia Nasser\nNet a payer : 4 900,00 MAD",
  },
  {
    fileName: "test67-carte-nationale.pdf",
    cin: null,
    nom: "Dalia Omrane",
    contenu:
      "REPUBLIQUE TUNISIENNE\nCarte nationale d'identité n° 45 678 904\nEmploye : Dalia Omrane\nNet a payer : 5 050,00 MAD",
  },
  {
    fileName: "test67-nomfichier-bulletin_56789012_2024.pdf",
    cin: null,
    nom: null, // fiche sans nom détecté → fin de liste
    contenu:
      "BULLETIN DE PAIE\nMatricule CNSS 17775208 - 08\nMATRICULE : 56789012\nPeriode : 09/2026\nNet a payer : 4 500,00 MAD",
  },
  {
    fileName: "test67-tableau-9chiffres.pdf",
    cin: null,
    nom: "Ezzedine Gharbi",
    contenu:
      "ETAT CIVIL ENF. A CHARGE N° CNSS N° CIN\nMarie(e) 2 17775208 - 04 123456789\nEmploye : Ezzedine Gharbi\nNet a payer : 7 300,00 MAD",
  },
  {
    // NÉGATIF : des MONTANTS sans libellé CIN + date dans le nom de fichier
    fileName: "test67-montant-NEG.pdf",
    cin: null,
    nom: "Fawzi Bersali",
    contenu:
      "BULLETIN DE PAIE\nEmploye : Fawzi Bersali\nNET A PAYER : 128 450,023 TND\nPRIME DE RENDEMENT : 6 500,000 MAD",
  },
  {
    // NÉGATIF : contenu vide (échec OCR sur un scan)
    fileName: "test67-scan-vide.pdf",
    cin: null,
    nom: "Ghada Yousfi",
    contenu: "",
  },
];

async function nettoyerFiches() {
  // fileName est chiffré ALEA → déchiffrement en JavaScript, puis suppression
  // par identifiants (aucun `startsWith` SQL possible).
  const lignes = await prisma.payslip.findMany({ select: { id: true, fileName: true } });
  const cibles = lignes
    .filter((l) => {
      try {
        return cryptoBd.dechiffrerChamp(l.fileName).startsWith("test67-");
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
      const normalise = f.contenu.toUpperCase().replace(/[\s./-]/g, "");
      await prisma.payslip.create({
        data: {
          fileName: cryptoBd.chiffrerChamp(f.fileName, false),
          storedName: f.fileName, // non chiffré (carte Payslip)
          fileSize: Math.max(f.contenu.length, 1),
          content: cryptoBd.chiffrerChamp(f.contenu, false),
          normalizedContent: cryptoBd.chiffrerChamp(normalise, false),
          cin: f.cin ? cryptoBd.chiffrerChamp(f.cin, false) : null, // ALEA comme l'application
          employeeName: f.nom ? cryptoBd.chiffrerChamp(f.nom, false) : null,
          period: cryptoBd.chiffrerChamp("09/2026", false),
          netSalary: cryptoBd.chiffrerChamp("4 500,00", false),
          matricule: null,
          pageNumber: 1,
          sourcePage: null,
        },
      });
    }
    console.log(
      "9 fiches de test insérées (F1 colonne, F2/F2b contenu fusionnés, F3/F4 libellés élargis, F5 nom de fichier, F6 tableau 9 chiffres, F7/F8 négatifs)."
    );
  } else if (operation === "nettoyer") {
    await nettoyerFiches();
    for (const cin of ["23456782", "56789012", "12 345 671"]) {
      try {
        await prisma.portalAccess.delete({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
      } catch {}
    }
    console.log("Fiches et accès de test Task 67 supprimés.");
  } else {
    console.error("Usage: inserer | nettoyer");
    process.exit(1);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
