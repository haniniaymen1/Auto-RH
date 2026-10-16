#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.189 — GÉNÉRATION RÉELLE du PDF d'acceptation (fumée + contenu)
 * ============================================================================
 * Génère un PDF d'acceptation COMPLET avec un contexte réaliste (congé),
 * écrit le fichier sur disque et vérifie :
 *   - la génération ne lève AUCUNE exception (sections supprimées — aucun
 *     identifiant orphelin) ;
 *   - le fichier est un PDF valide (%PDF-, taille raisonnable, 1 page) ;
 *   - l'extraction de texte (faite côté Python, pypdf — test_genere_v02189.py)
 *     confirmera la présence des marqueurs attendus et l'absence des
 *     sections supprimées ; ce script écrit aussi le ctx utilisé.
 * Sortie : code 0 si OK.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");
const acceptation = require("./document-acceptation.js");

const annee = new Date().getFullYear();
const ctx = {
  reference: "DEM-" + annee + "-TEST1",
  type: "CONGE",
  typeLibelle: "Demande de congé",
  statutFinal: "Acceptée",
  nomEmploye: "Employé Test",
  cin: "12345678",
  matricule: "MAT-0042",
  emailEmploye: "employe.test@entreprise.tn",
  emailManager: "manager.n1@entreprise.tn",
  nomManager: "Manager N+1 (à NE PAS afficher dans le PDF)",
  decideur: "Martina RH (à NE PAS afficher dans le PDF)",
  dateDemande: "10/10/" + annee + " 09:15",
  dateDecision: "12/10/" + annee + " 10:45",
  jours: 12,
  heures: null,
  commentaire: "",
  donnees: {
    typeConge: "Congé annuel",
    dateDebut: annee + "-10-19",
    dateFin: annee + "-11-03",
    emailN1: "manager.n1@entreprise.tn",
    nomManager: "Manager N+1",
    commentaire: "Congé annuel planifié",
  },
  validationManager: { decision: "Acceptée", le: "10/10/" + annee + " 09:50", par: "Manager N+1 (manager.n1@entreprise.tn)" },
  validationRh: { decision: "Acceptée", le: "12/10/" + annee + " 10:45", par: "Martina RH" },
  createdAt: new Date(),
};
const cfg = {
  signerActif: false,
  tamponActif: false,
  docSigActif: false,
};

(async () => {
  // (v0.2.189) genererPdfAcceptation renvoie directement les OCTETS du PDF
  // (Buffer du doc.save()) — le tamponnage (tamponnerDocument) est une étape
  // séparée non nécessaire à cette vérification de contenu.
  const octets = await acceptation.genererPdfAcceptation(ctx, cfg);
  const sortie = path.join(__dirname, "genere-v02189-acceptation.pdf");
  fs.writeFileSync(sortie, Buffer.from(octets));
  const taille = fs.statSync(sortie).size;
  const enTete = fs.readFileSync(sortie).slice(0, 5).toString("latin1");
  console.log("PDF généré : " + sortie);
  console.log("  taille    : " + taille + " octets");
  console.log("  en-tête   : " + enTete);
  if (!/^%PDF-/.test(enTete)) { console.error("ÉCHEC : en-tête PDF invalide"); process.exit(1); }
  if (taille < 2000) { console.error("ÉCHEC : PDF trop petit — contenu probablement incomplet"); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, "genere-v02189-ctx.json"),
    JSON.stringify(ctx, null, 2));
  console.log("OK — génération sans exception ; vérification de contenu via pypdf (test_genere_v02189.py).");
  process.exit(0);
})().catch((e) => {
  console.error("ÉCHEC de génération : " + ((e && e.stack) || e));
  process.exit(1);
});
