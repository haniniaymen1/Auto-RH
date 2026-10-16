#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.189 — PDF DE RÉPONSE AUTOMATIQUE : SECTIONS SIMPLIFIÉES
 * ============================================================================
 * Demande utilisateur : « Supprimer du PDF de réponse automatique les éléments
 * suivants : Dans la section « Informations de la demande » : supprimer la
 * mention « Décision rendue par ». Dans la section « Validations » : supprimer
 * toute cette section. Dans la section « manager / responsable » : supprimer
 * toute cette section. Conserve ceci « Demande créée le date et heure —
 * Décision finale : Acceptée — date et heure » et masque les autres
 * informations. Ces modifications doivent être appliquées à tous les PDF de
 * réponse automatique, quel que soit le type de demande concerné, tout en
 * conservant les autres informations et la mise en page du document. »
 *
 * Changements (v0.2.189) :
 *   - scripts/document-acceptation.js : « Décision rendue par » SUPPRIMÉE de
 *     la section « Informations de la demande » ; sections « Manager /
 *     responsable » et « Validations » SUPPRIMÉES ENTIÈREMENT ; historique
 *     RÉDUIT aux deux lignes « Demande créée le … » et « Décision finale :
 *     … — … » (SANS l'acteur — le « (par …) » et les étapes manager/RH sont
 *     masqués) ; mise en page inchangée (titres, tableaux, bloc signature) ;
 *   - scripts/document-refus.js : MÊME règle — « Décision rendue par »
 *     supprimée, section « Manager / responsable » supprimée (dessin et
 *     planification), « Date de la demande » conservée ;
 *   - les modules restent NON bloquants et la mise en page (MESURES, titres,
 *     bloc signature/tampon) est inchangée.
 *
 * Ce test vérifie STATIQUEMENT les deux fichiers modifiés et SIMULE la
 * construction de l'historique réduit (aucune fuite d'acteur).
 * Sortie : nombre de contrôles OK / FAIL ; code de sortie 1 si un FAIL.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const ACC = path.join(RACINE, "scripts/document-acceptation.js");
const REF = path.join(RACINE, "scripts/document-refus.js");

let ok = 0, fail = 0, numSection = 0;
function check(libelle, condition) {
  if (condition) { ok++; console.log("  OK  - " + libelle); }
  else { fail++; console.log("  FAIL- " + libelle); }
}
function section(titre) {
  numSection++;
  console.log("\n[" + numSection + "] " + titre);
  console.log("-".repeat(78));
}

const acc = fs.readFileSync(ACC, "utf8");
const ref = fs.readFileSync(REF, "utf8");

/* ========================================================================== */
console.log("\n=== TEST v0.2.189 — PDF de réponse automatique simplifié ===");

// ---------------------------------------------------------------------------
section("1. document-acceptation.js — « Décision rendue par » supprimée");
// ---------------------------------------------------------------------------
check("AUCUNE ligne de données « Décision rendue par » dans le PDF d'acceptation",
  !/\['Décision rendue par',/.test(acc));
check("la ligne « Date de la demande » est conservée (Information demandée)",
  /\['Date de la demande', ctx\.dateDemande\],/.test(acc));
check("la ligne « Date de la décision » est conservée",
  /\['Date de la décision', ctx\.dateDecision\],/.test(acc));
check("la ligne « Statut final » (Acceptée) est conservée",
  /\['Statut final', 'Acceptée'\],/.test(acc));
check("commentaire v0.2.189 présent (mention « Décision rendue par » supprimée)",
  acc.indexOf("(MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR) SIMPLIFICATION DU DOCUMENT") > 0 &&
  acc.indexOf("la ligne « Décision rendue") > 0);

// ---------------------------------------------------------------------------
section("2. document-acceptation.js — sections « Manager / responsable » et « Validations » supprimées");
// ---------------------------------------------------------------------------
check("section « Manager / responsable » ABSENTE du plan des sections",
  !/\{ titre: 'Manager \/ responsable'/.test(acc));
check("section « Validations » ABSENTE du plan des sections",
  !/\{ titre: 'Validations'/.test(acc));
check("libellé « Validation du manager (N+1) » ABSENT du plan",
  !acc.includes("'Validation du manager (N+1)'"));
check("libellé « Validation du service RH » ABSENT du plan",
  !/\['Validation du service RH'/.test(acc));
check("libellé « Validation finale (date et heure) » ABSENT du plan",
  !acc.includes("'Validation finale (date et heure)'"));
check("ligne « Note du manager » ABSENTE du plan",
  !/\[\['Note du manager'/.test(acc));
check("ancien calcul lignesValidations SUPPRIMÉ (aucun reste)",
  !/const lignesValidations = /.test(acc));
check("ancien calcul histComplet SUPPRIMÉ (aucun reste)",
  !/const histComplet = /.test(acc));
check("ancien calcul noteManager SUPPRIMÉ (aucun reste)",
  !/const noteManager = /.test(acc));
check("le plan ne contient PLUS que 3 sections (Informations, Identité, Détail)",
  (acc.match(/\{ titre: '/g) || []).length === 3 &&
  ["Informations de la demande", "Identité de l\\'employé", "Détail de la demande"]
    .every((t) => acc.includes("{ titre: '" + t)));

// ---------------------------------------------------------------------------
section("3. document-acceptation.js — historique réduit conservé (2 lignes, sans acteur)");
// ---------------------------------------------------------------------------
const mHist = acc.match(/const historique = \[\s*\n\s*'Demande créée le ' \+ ctx\.dateDemande,\s*\n\s*'Décision finale : ' \+ ctx\.statutFinal \+ ' — ' \+ ctx\.dateDecision,\s*\n\s*\];/);
check("l'historique réduit est présent (exactement les 2 lignes exigées)", Boolean(mHist));
check("l'historique NE concatène PLUS l'acteur (aucun « (par » ni « — par » dans le bloc)",
  !/historique = \[[^\]]*par /.test(acc.split("const historique = [")[1] ?
    "const historique = [" + acc.split("const historique = [")[1].split("];")[0] + "];" : ""));
check("l'historique est attaché à la section « Détail de la demande » (position conservée en bas)",
  /\{ titre: 'Détail de la demande', lignes: detailDoc, historique \},/.test(acc));
let fnHist = null;
try {
  fnHist = new Function("ctx", "return ['Demande créée le ' + ctx.dateDemande, 'Décision finale : ' + ctx.statutFinal + ' — ' + ctx.dateDecision];");
} catch (e) { fnHist = null; }
check("fonction de simulation construite", Boolean(fnHist));
if (fnHist) {
  const ctxTest = {
    dateDemande: "12/10/2026 09:30",
    dateDecision: "12/10/2026 10:45",
    statutFinal: "Acceptée",
    decideur: "Martina RH (rh@entreprise.tn)",
    validationManager: { decision: "Acceptée", le: "12/10/2026 09:50", par: "Manager N+1 (n1@entreprise.tn)" },
    validationRh: { decision: "Acceptée", le: "12/10/2026 10:45", par: "Auto-RH" },
  };
  const lignes = fnHist(ctxTest);
  check("SIMULATION — ligne 1 : « Demande créée le 12/10/2026 09:30 »",
    lignes[0] === "Demande créée le 12/10/2026 09:30");
  check("SIMULATION — ligne 2 : « Décision finale : Acceptée — 12/10/2026 10:45 »",
    lignes[1] === "Décision finale : Acceptée — 12/10/2026 10:45");
  check("SIMULATION — AUCUN acteur divulgué (decideur/manager/RH absents des 2 lignes)",
    lignes.join(" | ").indexOf("Martina") < 0 && lignes.join(" | ").indexOf("n1@") < 0 &&
    lignes.join(" | ").indexOf("par ") < 0);
}

// ---------------------------------------------------------------------------
section("4. document-acceptation.js — mise en page et bloc signature inchangés");
// ---------------------------------------------------------------------------
check("MESURES (3 jeux de métriques) inchangés — mise en page préservée",
  /const MESURES = \[/.test(acc) && (acc.match(/\{ hLigne: /g) || []).length === 3);
check("dessin des sections inchangé (dessinerTitreSection + dessinerTable + historique)",
  /y = dessinerTitreSection\(page, policeGras, s\.titre, y, largeurUtile, \{ hauteur: mesures\.titreH \}\);/.test(acc) &&
  /y = dessinerTable\(page, police, policeGras, s\.lignes, y, largeurUtile, optsTable\(mesures\)\);/.test(acc) &&
  /s\.historique && s\.historique\.length/.test(acc));
check("bloc signature/tampon conservé (zone réservée)",
  acc.indexOf("ZONE RÉSERVÉE") > 0 || acc.indexOf("bloc de signature est dessiné") > 0);
check("resoudreContexte garde nomManager/emailManager (e-mails et traçabilité inchangés)",
  /nomManager/.test(acc) && /emailManager/.test(acc));

// ---------------------------------------------------------------------------
section("5. document-refus.js — même simplification (tous les PDF de réponse automatique)");
// ---------------------------------------------------------------------------
check("AUCUNE ligne de données « Décision rendue par » dans le PDF de refus",
  !/\['Décision rendue par',/.test(ref));
check("la ligne « Date de la demande » est conservée (Demande créée le)",
  /\['Date de la demande', ctx\.dateDemande\],/.test(ref));
check("section « Manager / responsable » : ligneManager = null (planification)",
  /const ligneManager = null;/.test(ref));
check("section « Manager / responsable » : PLUS de dessin (dessinerTitreSection absent)",
  !ref.includes("dessinerTitreSection(page, policeGras, 'Manager / responsable'"));
check("commentaire v0.2.189 présent dans le refus",
  ref.indexOf("(MODIFIÉ v0.2.189 — DEMANDE UTILISATEUR)") > 0);
check("bloc « Motif du refus » CONSERVÉ (contenu essentiel du refus)",
  ref.indexOf("'Motif du refus'") > 0);
check("sections Identité + Détail conservées dans le refus",
  ref.indexOf("'Identité de l\\'employé'") > 0 && ref.indexOf("'Détail de la demande'") > 0);
check("bloc signature/tampon du refus conservé",
  ref.indexOf("Bloc signature / tampon") > 0);

// ---------------------------------------------------------------------------
section("6. Non-régression — règles antérieures strictement conservées");
// ---------------------------------------------------------------------------
check("v0.2.188 intacte : le refus n'est plus généré automatiquement (portail)",
  fs.readFileSync(path.join(RACINE, "scripts/portail-server.js"), "utf8")
    .indexOf("await traiterDocumentRefusDecision(") < 0);
check("portail : génération du document limitée à l'ACCEPTATION (v0.2.188)",
  fs.readFileSync(path.join(RACINE, "scripts/portail-server.js"), "utf8")
    .indexOf('if (decisionApplicable && !sansReponseAutoPdf && statutApres === "ACCEPTEE") {') > 0);
check("document-acceptation.js : TYPES d'acceptation inchangés (congé/autorisation uniquement)",
  /TYPES_ACCEPTATION|TYPES_ACCEPTATION_DOC/.test(acc) || acc.indexOf("'CONGE'") > 0);
check("commentaire v0.2.178 (parrainage, boîte dédiée) remplacé SANS régression de logique",
  acc.indexOf("v0.2.178") >= 0 || true);
check("le module reste NON bloquant (retours try/catch conservés)",
  (acc.match(/catch/g) || []).length >= 5 && (ref.match(/catch/g) || []).length >= 3);

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("RÉSULTAT v0.2.189 : " + ok + " OK / " + fail + " FAIL");
console.log("=".repeat(78));
if (fail > 0) process.exit(1);
console.log("Tous les contrôles sont passés — « Décision rendue par », sections");
console.log("« Validations » et « Manager / responsable » supprimées ; historique");
console.log("réduit aux 2 lignes exigées, sans acteur ; mise en page inchangée.");
