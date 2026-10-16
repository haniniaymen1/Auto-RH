/**
 * Donnée de TEST éphémère pour la preuve E2E « bouton Créer l'accès » :
 * crée (ou supprime) UNE fiche de paie fictive portant un CIN de test.
 * Le tableau pré-rempli de l'onglet « Accès portail » en déduit une ligne
 * « Accès non créé » sur laquelle l'E2E clique le bouton réparé.
 *
 *   npx tsx scripts/e2e-donnee-creer-acces.ts creer
 *   npx tsx scripts/e2e-donnee-creer-acces.ts supprimer
 *
 * Le middleware de chiffrement (src/lib/db.ts) traite automatiquement les
 * champs sensibles (cin, content, cinIndex) comme à l'import réel.
 */
import { db } from "../src/lib/db";

const CIN_TEST = "99988877";
const FICHIER = "e2e-creer-acces-test.pdf";

async function main() {
  const action = process.argv[2] ?? "creer";
  if (action === "supprimer-id") {
    // fileName est chiffré à IV aléatoire : le where ne matche pas après
    // création → suppression par ID (valeur retournée par « creer »).
    const id = process.argv[3] ?? "";
    const supprime = await db.payslip.deleteMany({ where: { id } });
    console.log(`Fiche de test supprimée par id : ${supprime.count}`);
    return;
  }
  if (action === "supprimer") {
    const supprime = await db.payslip.deleteMany({ where: { fileName: FICHIER } });
    // sécurité : aucun accès résiduel au CIN de test
    const acces = await db.portalAccess.deleteMany({ where: { cin: CIN_TEST } }).catch(() => null);
    console.log(`Fiche(s) de test supprimée(s) : ${supprime.count}` + (acces ? ` ; accès test : ${acces.count}` : ""));
  } else {
    const existant = await db.payslip.findFirst({ where: { fileName: FICHIER } });
    if (existant) {
      console.log("Fiche de test déjà présente (id " + existant.id + ").");
      return;
    }
    const contenu = `BULLETIN DE PAIE\nNom : EMPLOYE TEST E2E\nCIN : ${CIN_TEST}\nMatricule : MT${CIN_TEST}\nPériode : 09/2026\nNet à payer : 1 000,00 TND`;
    const fiche = await db.payslip.create({
      data: {
        fileName: FICHIER,
        storedName: FICHIER,
        fileSize: contenu.length,
        content: contenu,
        normalizedContent: contenu.replace(/\s+/g, "").toUpperCase(),
        cin: CIN_TEST,
        employeeName: "EMPLOYE TEST E2E",
        period: "09/2026",
        netSalary: "1 000,00",
        matricule: "MT" + CIN_TEST,
        pageNumber: 1,
      },
    });
    console.log(`Fiche de test créée (id ${fiche.id}, CIN ${CIN_TEST}).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
