#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.186 — MASQUER « SIGNATURE ÉLECTRONIQUE — CERTIFICAT DÉDIÉ » POUR
 * LE RÔLE RH (section « Réponse automatique PDF par e-mail (congé / autorisation) »)
 * ============================================================================
 * Demande utilisateur : « Dans le rôle RH, masquer juste la partie « Signature
 * électronique — certificat dédié » dans la section « Réponse automatique PDF
 * par e-mail (congé / autorisation) ».
 *
 * Changement (interface d'administration, onglet Demandes) :
 *   - src/components/payslip/reponse-pdf-panel.tsx : NOUVELLE prop
 *     `masquerCertificat` (défaut false) — quand elle est vraie, le BLOC
 *     « Signature électronique — certificat dédié à cette section » (import
 *     .p12/.pfx, mot de passe, interrupteur de signature, nom et fonction du
 *     signataire) n'est PLUS rendu ; l'avertissement du cachet « Signature
 *     électronique » (certificat absent) renvoie alors vers le
 *     superadministrateur au lieu de proposer l'import ;
 *   - src/components/payslip/demandes-tab.tsx : `masquerCertificat={role === "RH"}`
 *     — le RH ne voit PLUS le bloc, le SUPERADMIN le conserve ENTIÉR ;
 *   - AUCUN changement de configuration ni d'API : la configuration enregistrée
 *     (interrupteur signer, certificat importé) s'applique aux réponses
 *     générées quelle que soit la personne qui consulte la section ; un
 *     enregistrement fait depuis la vue RH réécrit les valeurs du certificat
 *     TELLES QUE CHARGÉES (corpsEnregistrement).
 *
 * Ce test vérifie statiquement les DEUX fichiers modifiés (structure du JSX,
 * câblage du rôle, contenu préservé pour le superadministrateur) et SIMULE la
 * logique de décision (prop par rôle + ternaire de l'avertissement).
 * Sortie : nombre de contrôles OK / FAIL ; code de sortie 1 si un FAIL.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const PANEL = path.join(RACINE, "src/components/payslip/reponse-pdf-panel.tsx");
const DEMANDES = path.join(RACINE, "src/components/payslip/demandes-tab.tsx");
const PAGE = path.join(RACINE, "src/app/page.tsx");
const VOISIN = path.join(RACINE, "src/components/payslip/signature-panel-reponses.tsx");

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log(`  [OK]   ${nom}`); }
  else { fail++; console.log(`  [FAIL] ${nom}${detail ? " — " + detail : ""}`); }
}
function sect(titre) { console.log(`\n== ${titre} ==`); }

const panel = fs.readFileSync(PANEL, "utf8");
const demandes = fs.readFileSync(DEMANDES, "utf8");
const page = fs.readFileSync(PAGE, "utf8");
const voisin = fs.readFileSync(VOISIN, "utf8");

/* ========================================================================== */
console.log("\n=== TEST v0.2.186 — masquage du bloc certificat dédié (rôle RH) ===");

/* ---------- 1. Panneau : prop et garde ---------- */
sect("1. reponse-pdf-panel.tsx — prop masquerCertificat et garde de rendu");
check("P1  prop `masquerCertificat = false` (défaut) dans la signature",
      panel.includes("masquerCertificat = false,"));
check("P2  type de la prop `masquerCertificat?: boolean`",
      panel.includes("masquerCertificat?: boolean;"));
check("P3  commentaire v0.2.186 dans la signature (RH masqué, SUPERADMIN conserve)",
      panel.includes("(v0.2.186) MASQUER le bloc « Signature électronique — certificat dédié »"));
check("P4  garde de rendu `{!masquerCertificat && (` présente (UNE seule)",
      (panel.match(/\{!masquerCertificat && \(/g) || []).length === 1);
check("P5  fragment `<>` ouvert par la garde",
      /\{!masquerCertificat && \(\n          <>\n/.test(panel));
check("P6  fragment refermé `</>` + `)}` après le bloc certificat",
      panel.includes("        </div>\n          </>\n        )}\n\n        {/* ---------- SIGNATURE IMAGE (paraphe) ---------- */}"));
check("P7  en-tête du fichier documente le changement v0.2.186",
      panel.includes("(v0.2.186 — demande « Dans le rôle RH, masquer juste la partie « Signature"));

// Ordre structurel : fin de l'aperçu interactif < garde < bloc certificat < fin du fragment < paraphe
const iApercuFin = panel.indexOf('libelleFiche="A4 — réponse PDF"');
const iGarde = panel.indexOf("{!masquerCertificat && (");
const iBlocTitre = panel.indexOf(">Signature électronique — certificat dédié à cette section</span>");
const iFinFragment = panel.indexOf("        </div>\n          </>\n        )}");
const iParaphe = panel.indexOf("{/* ---------- SIGNATURE IMAGE (paraphe) ---------- */}");
check("P8  ordre JSX : aperçu interactif AVANT la garde", iApercuFin >= 0 && iGarde > iApercuFin);
check("P9  ordre JSX : garde AVANT le bloc certificat dédié", iGarde >= 0 && iBlocTitre > iGarde);
check("P10 ordre JSX : bloc certificat AVANT la fermeture du fragment", iBlocTitre >= 0 && iFinFragment > iBlocTitre);
check("P11 ordre JSX : fermeture du fragment AVANT la section paraphe", iFinFragment >= 0 && iParaphe > iFinFragment);
check("P12 SEULE la partie « certificat dédié » est sous la garde (le paraphe reste visible)",
      iParaphe >= 0 && panel.indexOf("{!masquerCertificat && (", iGarde + 1) === -1);

/* ---------- 2. Contenu du bloc conservé (SUPERADMIN) ---------- */
sect("2. Le bloc certificat dédié reste COMPLET dans le code (vue SUPERADMIN)");
const blocPanel = [
  "SIGNATURE ÉLECTRONIQUE — CERTIFICAT DÉDIÉ",
  'aria-label="Activer ou désactiver la signature électronique"',
  "Ce certificat est PROPRE aux réponses PDF des demandes",
  "Signature électronique DÉSACTIVÉE : le PDF de réponse sera généré SANS signature",
  "Signature électronique ACTIVÉE mais AUCUN certificat importé",
  'accept=".p12,.pfx"',
  'placeholder="Mot de passe du certificat"',
  "Importer le certificat",
  "Nom du signataire (bloc « Fait le… »)",
  "Fonction du signataire",
  'placeholder="Directeur des Ressources Humaines"',
  "/> Vérifier",
  "/> Retirer",
];
blocPanel.forEach((s, i) =>
  check(`P13.${i + 1} élément du bloc conservé : ${s.slice(0, 58)}`, panel.includes(s)));

/* ---------- 3. Cachet : avertissement adapté au rôle ---------- */
sect("3. Avertissement du cachet « Signature électronique » (certificat absent)");
const iTernaire = panel.indexOf("{masquerCertificat\n                ?");
check("P14 ternaire de l'avertissement présent (une seule occurrence)",
      iTernaire >= 0 && (panel.match(/\{masquerCertificat\n/g) || []).length === 1);
check("P15 branche RH : renvoi vers le superadministrateur",
      panel.includes('" Le certificat dédié est géré par le superadministrateur — contactez-le pour l\'importer ou ajuster le cachet."'));
check("P16 branche SUPERADMIN : consigne d'import conservée",
      panel.includes('" Importez le .p12 / .pfx dans la section « Signature électronique — certificat dédié » ci-dessus."'));
check("P17 l'avertissement reste dans le bloc cachet (APRÈS sa ligne d'alimentation EN DIRECT)",
      iTernaire > panel.indexOf("Alimenté EN DIRECT par le certificat DÉDIÉ de cette section"));
check("P18 le texte fixe de l'avertissement ne propose PLUS l'import hors ternaire",
      !/sans certificat, AUCUN cachet ne sera dessiné sur les réponses\.\s*Importez/.test(panel));

/* ---------- 4. demandes-tab.tsx : câblage du rôle ---------- */
sect("4. demandes-tab.tsx — masquerCertificat={role === \"RH\"}");
check("D1  <ReponsePdfPanel masquerCertificat={role === \"RH\"} /> présent",
      demandes.includes('<ReponsePdfPanel masquerCertificat={role === "RH"} />'));
check("D2  aucun <ReponsePdfPanel /> sans props restant",
      !/<ReponsePdfPanel\s*\/>/.test(demandes));
check("D3  UNE seule instanciation de ReponsePdfPanel",
      (demandes.match(/<ReponsePdfPanel/g) || []).length === 1);
check("D4  commentaire v0.2.186 présent (RH masqué, SUPERADMIN conserve)",
      demandes.includes("(v0.2.186) Rôle RH : le bloc « Signature électronique — certificat"));
check("D5  import du panneau inchangé",
      demandes.includes('import { ReponsePdfPanel } from "@/components/payslip/reponse-pdf-panel";'));
check("D6  DemandesTab reçoit toujours le rôle depuis page.tsx",
      page.includes('<DemandesTab role={me?.role ?? "RH"} />'));
check("D7  onglet Demandes toujours réservé aux non-IT (garde interface)",
      page.includes('me?.role !== "IT"') && page.includes('value="demandes"'));

/* ---------- 5. Non-régression du panneau (autres sections intactes) ---------- */
sect("5. Les AUTRES parties de la section restent visibles (RH comme SUPERADMIN)");
[
  'Réponse automatique PDF par e-mail (congé / autorisation)',
  "Génération et envoi automatiques de la réponse PDF",
  "Génération automatique DÉSACTIVÉE : AUCUNE réponse PDF ne sera générée",
  "Positionnement interactif sur l&apos;aperçu du document",
  "Signature sous forme d&apos;image (paraphe)",
  "Tampon (cachet de l&apos;établissement)",
  "QR Code de vérification / consultation",
  "Cachet « Signature électronique »",
  "Mention légale",
  "Envoi par e-mail (réponse PDF en pièce jointe)",
  "Enregistrer la configuration",
].forEach((s, i) => check(`P19.${i + 1} section conservée : ${s.slice(0, 58)}`, panel.includes(s)));

sect("6. Le certificat continue d'être APPLIQUÉ même masqué (configuration/serveur)");
check("P20 corpsEnregistrement réécrit signerActif (valeur chargée du serveur)",
      panel.includes("signerActif: cfg.certificat.signer,"));
check("P21 corpsEnregistrement réécrit certSignataire / certFonction (valeurs chargées)",
      panel.includes("certSignataire: cfg.certificat.signataire,") &&
      panel.includes("certFonction: cfg.certificat.fonction,"));
check("P22 l'état cfg.certificat est TOUJOURS chargé (GET) même pour le RH",
      panel.includes("setCfg(d.config);"));
check("P23 l'aperçu alimente toujours le cachet (cfgAperçu elec inchangé)",
      panel.includes("elecAffEmpreinte: cfg.elec.affEmpreinte,"));
check("D8 le voisin SignaturePanelReponses n'est pas affecté (import inchangé)",
      demandes.includes('import { SignaturePanelReponses } from "@/components/payslip/signature-panel-reponses";'));
check("D9 aucun bloc « certificat dédié » ajouté au voisin",
      !voisin.includes("certificat dédié à cette section"));

/* ---------- 7. SIMULATIONS de la logique ---------- */
sect("7. SIMULATIONS de la logique (prop par rôle + avertissement du cachet)");
const masquerPourRole = (role) => role === "RH";
[["RH", true], ["SUPERADMIN", false], ["IT", false]].forEach(([r, attendu]) =>
  check(`S1  masquerCertificat pour le rôle ${r} → ${attendu}`, masquerPourRole(r) === attendu));

const MSG_RH = " Le certificat dédié est géré par le superadministrateur — contactez-le pour l'importer ou ajuster le cachet.";
const MSG_SA = " Importez le .p12 / .pfx dans la section « Signature électronique — certificat dédié » ci-dessus.";
const avertissement = (masquer) => (masquer ? MSG_RH : MSG_SA);
check("S2 avertissement (RH) : renvoi au superadministrateur, aucune incitation à importer",
      avertissement(true) === MSG_RH && !avertissement(true).includes("Importez le .p12"));
check("S3 avertissement (SUPERADMIN) : consigne d'import inchangée",
      avertissement(false) === MSG_SA && avertissement(false).includes("ci-dessus."));
check("S4 le bloc certificat est rendu ssi masquerCertificat === false (SUPERADMIN)",
      (!masquerPourRole("SUPERADMIN")) === true && (masquerPourRole("RH")) === true);

/* ---------- Résultat ---------- */
console.log(`\n=== RÉSULTAT : ${ok} OK / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
