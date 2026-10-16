/* ============================================================================
 * TEST v0.2.185 — RÈGLE D'AFFICHAGE DU REFUS DANS LE PORTAIL EMPLOYÉ
 * ============================================================================
 * Demande utilisateur : « dans portail employe, pour toutes les demandes de
 * congé, d'attestation de salaire, d'attestation de travail, de parrainage et
 * d'autorisation, lorsque le statut d'une demande est refusé, afficher
 * uniquement la mention « Refusée » dans la zone de statut, sans afficher par
 * quel département ou manager ».
 *
 * Ce test vérifie (par EXTRACTION DE SOURCES + SIMULATIONS EXÉCUTÉES) :
 *   1. l'API employé (/api/mes-demandes) applique refusSansActeur : statut
 *      REFUSEE → libellé « Refusée », acteur (traitePar) et commentaire de
 *      traitement masqués, date de traitement conservée ;
 *   2. la règle couvre TOUS les types (congé, autorisation de sortie,
 *      attestation de travail, attestation de salaire, parrainage) et les
 *      trois origines de refus (MANAGER, RH, PARRAINAGE) ;
 *   3. les statuts NON refusés gardent leur affichage historique
 *      (Acceptée / Validée / Information requise / En attente) ;
 *   4. la règle v0.2.177 (décision masquée tant que la matrice deux étapes
 *      est incomplète) et la v0.2.184 (PJs visibles à toutes les étapes)
 *      restent STRICTEMENT inchangées ;
 *   5. le rendu client (badge, ligne « Statut final », notification) ne peut
 *      plus afficher d'acteur pour un refus ;
 *   6. les E-MAILS de décision (libellé raffiné « Refusée par le Manager » /
 *      « Refusée par les RH ») et le portail d'administration ne sont PAS
 *      affectés.
 * Usage : node test_v02185_affichage_refusee.js
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "portail-server.js");
const src = fs.readFileSync(SRC, "utf8");

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

// ---------------------------------------------------------------------------
section("1. Règle v0.2.185 dans l'API employé (sources)");
// ---------------------------------------------------------------------------
check("constante « refusSansActeur » présente (statut === REFUSEE)",
  src.indexOf('const refusSansActeur = d.statut === "REFUSEE";') > 0);
check("libellé du refus = « Refusée » SEULE mention (ternaire sans acteur)",
  /refusSansActeur\s*\n\s*\? "Refusée"\s*\n\s*: libelleStatutFinalDemande\(d\.statut, d\.refuseePar\)/.test(src));
check("acteur de traitement masqué pour un refus (traiteParVu = null)",
  src.indexOf("let traiteParVu = refusSansActeur ? null : (d.traitePar || null);") > 0);
check("commentaire de traitement masqué pour un refus (commentaireVu = \"\")",
  src.indexOf('let commentaireVu = refusSansActeur ? "" : (d.commentaire || "");') > 0);
check("date de traitement CONSERVÉE (traiteLeVu sans condition de refus)",
  src.indexOf("let traiteLeVu = d.traiteLe ? d.traiteLe.toISOString() : null;") > 0);
check("la règle s'applique à TOUS les types (aucune condition de type sur refusSansActeur)",
  /const refusSansActeur = d\.statut === "REFUSEE";\s*\n\s*let statutVu/.test(src));
check("commentaire v0.2.185 « RÈGLE D'AFFICHAGE DU REFUS » présent (API)",
  src.indexOf("(NOUVEAU v0.2.185 — DEMANDE UTILISATEUR) RÈGLE D'AFFICHAGE DU REFUS") > 0);
check("commentaire v0.2.185 présent côté rendu client (badge)",
  src.indexOf("(MODIFIÉ v0.2.185 — DEMANDE UTILISATEUR) RÈGLE D'AFFICHAGE DU REFUS :\n        // lorsque la demande est refusée") > 0);
check("champ statutLibelle documenté v0.2.185 (employé voit UNIQUEMENT « Refusée »)",
  src.indexOf("l'employé voit UNIQUEMENT\n          // la mention « Refusée »") > 0);

// ---------------------------------------------------------------------------
section("2. SIMULATION EXÉCUTÉE — les 5 types, les 3 origines de refus");
// ---------------------------------------------------------------------------
// Extraction du bloc réel de mapping (const refusSansActeur → commentaireVu).
const iDebut = src.indexOf("const refusSansActeur = d.statut === \"REFUSEE\";");
const iFin = src.indexOf('let commentaireVu = refusSansActeur ? "" : (d.commentaire || "");');
check("bloc de mapping v0.2.185 extractible", iDebut > 0 && iFin > iDebut);
if (iDebut > 0 && iFin > iDebut) {
  const bloc = src.slice(iDebut, iFin + 'let commentaireVu = refusSansActeur ? "" : (d.commentaire || "");'.length);
  // Jumelles locales (identiques au serveur) pour une simulation fidèle.
  const prelude = `
    const LIBELLES = { EN_ATTENTE: "En attente", ACCEPTEE: "Acceptée", REFUSEE: "Refusée", VALIDEE: "Validée", INFORMATION_REQUISE: "Information requise" };
    function libelleStatutFinalDemande(statut, refuseePar) {
      if (statut === "REFUSEE") {
        if (refuseePar === "MANAGER") return "Refusée par le Manager";
        if (refuseePar === "RH") return "Refusée par les RH";
      }
      return LIBELLES[statut] || String(statut || "");
    }
    function libelleDecisionEtapeDemande(v) {
      if (v === "ACCEPTEE") return "Acceptée";
      if (v === "REFUSEE") return "Refusée";
      return "En attente";
    }
  `;
  const fn = new Function("d", "deuxEtapesDem",
    prelude +
    "const decisionMasquee = deuxEtapesDem && d.statut === \"EN_ATTENTE\";\n" +
    bloc +
    "\nreturn { statutVu, statutLibelleVu, traiteParVu, traiteLeVu, commentaireVu, decisionMasquee };");

  const dateTraitement = new Date("2026-10-11T09:00:00Z");
  // (type, statut, refuseePar, traitePar, commentaire attendus)
  const cas = [
    { nom: "CONGÉ refusé par le manager", d: { statut: "REFUSEE", refuseePar: "MANAGER", traitePar: "Manager (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par le manager — décision immédiate et définitive (aucune transmission aux RH)." } },
    { nom: "CONGÉ refusé par les RH", d: { statut: "REFUSEE", refuseePar: "RH", traitePar: "Auto-RH (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par les RH — décision immédiate et définitive (réponse e-mail des RH)." } },
    { nom: "AUTORISATION DE SORTIE refusée par le manager", d: { statut: "REFUSEE", refuseePar: "MANAGER", traitePar: "Manager (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par le manager — décision immédiate et définitive." } },
    { nom: "ATTESTATION DE TRAVAIL refusée (RH)", d: { statut: "REFUSEE", refuseePar: "RH", traitePar: "Auto-RH (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par les RH — décision immédiate et définitive." } },
    { nom: "ATTESTATION DE SALAIRE refusée (RH)", d: { statut: "REFUSEE", refuseePar: "RH", traitePar: "Auto-RH (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par les RH — décision immédiate et définitive." } },
    { nom: "PARRAINAGE refusé (service dédié)", d: { statut: "REFUSEE", refuseePar: "PARRAINAGE", traitePar: "Service parrainage (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par le service chargé du parrainage — décision immédiate et définitive." } },
  ];
  for (const c of cas) {
    const r = fn(c.d, c.d.type === "CONGE" || c.d.type === "AUTORISATION_SORTIE");
    check(c.nom + " → libellé « Refusée » (sans acteur)", r.statutLibelleVu === "Refusée" && r.statutVu === "REFUSEE");
    check(c.nom + " → acteur de traitement masqué (null)", r.traiteParVu === null);
    check(c.nom + " → commentaire de refus masqué (vide)", r.commentaireVu === "");
    check(c.nom + " → date de traitement conservée", !!r.traiteLeVu);
  }

  // ----- Non-régression : les statuts NON refusés restent inchangés -----
  const rAcc = fn({ statut: "ACCEPTEE", refuseePar: null, traitePar: "Manager (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Validation à deux étapes complète : manager ET service RH ont accepté." }, true);
  check("Non-régression ACCEPTEE → libellé « Acceptée » inchangé", rAcc.statutLibelleVu === "Acceptée");
  check("Non-régression ACCEPTEE → acteur de traitement conservé", rAcc.traiteParVu === "Manager (réponse e-mail)");
  check("Non-régression ACCEPTEE → commentaire de traitement conservé", rAcc.commentaireVu.indexOf("Validation à deux étapes complète") === 0);

  const rVal = fn({ statut: "VALIDEE", refuseePar: null, traitePar: "Manager (réponse e-mail)", traiteLe: dateTraitement, commentaire: "" }, true);
  check("Non-régression VALIDEE → libellé « Validée » inchangé", rVal.statutLibelleVu === "Validée" && rVal.traiteParVu !== null);

  const rInfo = fn({ statut: "INFORMATION_REQUISE", refuseePar: null, traitePar: null, traiteLe: null, commentaire: "" }, true);
  check("Non-régression INFORMATION_REQUISE → libellé inchangé", rInfo.statutLibelleVu === "Information requise");

  const rAtt = fn({ statut: "EN_ATTENTE", refuseePar: null, traitePar: null, traiteLe: null, commentaire: "Acceptée par le manager — transmise automatiquement au service RH." }, true);
  check("Non-régression EN_ATTENTE (2 étapes) → « En attente » (v0.2.177)", rAtt.statutLibelleVu === "En attente" && rAtt.decisionMasquee === true);

  // REFUSEE même après révélation (matrice achevée) → « Refusée » sans acteur.
  const rRef2 = fn({ statut: "REFUSEE", refuseePar: "RH", traitePar: "Auto-RH (réponse e-mail)", traiteLe: dateTraitement, commentaire: "Refusée par les RH." }, true);
  check("REFUSEE (matrice achevée) → « Refusée » sans acteur (pas decisionMasquee)", rRef2.statutLibelleVu === "Refusée" && rRef2.decisionMasquee === false);
}

// ---------------------------------------------------------------------------
section("3. Rendu client — aucun acteur affichable pour un refus (sources)");
// ---------------------------------------------------------------------------
check("badge de statut rendu depuis statutLibelle (masqué côté serveur)",
  src.indexOf('\'<span class="statut statut-final st-\' + esc(d.statut) + \'"><span class="puce"></span>\' + esc(d.statutLibelle) + "</span>"') > 0);
check("ligne « Statut final » : acteur (« par … ») CONDITIONNEL à traitePar",
  src.indexOf('(d.traitePar ? " par " + esc(d.traitePar) : "")') > 0);
check("ligne « Statut final » rendue depuis statutLibelle (mention unique)",
  src.indexOf('<b>Statut final&nbsp;:</b> \' + esc(d.statutLibelle)') > 0);
check("commentaire de traitement rendu seulement si non vide (if (d.commentaire))",
  src.indexOf("if (d.commentaire) {") > 0 &&
  src.indexOf('<b>Commentaire du traitement :</b> \' + esc(d.commentaire)') > 0);
check("notification de changement rendue depuis statutLibelle (« est désormais : Refusée »)",
  src.indexOf('est désormais : " + it.statutLibelle') > 0);
check("barre d'étapes toujours absente (SUPPRIMÉ v0.2.178 — aucune décision par acteur affichée)",
  src.indexOf("var etapesHtml = \"\";") > 0);

// ---------------------------------------------------------------------------
section("4. E-mails et portail d'administration NON affectés (non-régression)");
// ---------------------------------------------------------------------------
check("libellé RAFFINÉ conservé pour les E-MAILS (« Refusée par le Manager »)",
  src.indexOf('if (refuseePar === "MANAGER") return "Refusée par le Manager";') > 0);
check("libellé RAFFINÉ conservé pour les E-MAILS (« Refusée par les RH »)",
  src.indexOf('if (refuseePar === "RH") return "Refusée par les RH";') > 0);
check("e-mail de décision congé/autorisation utilise toujours le libellé raffiné",
  src.indexOf("libelleStatutFinalDemande(statutApres, refuseePar)") > 0);
check("l'API employé n'expose PLUS le libellé raffiné pour REFUSEE (seule mention « Refusée »)",
  src.indexOf('refusSansActeur\n          ? "Refusée"') > 0);
check("champ refuseePar conservé en base (traçage interne + administration inchangés)",
  src.indexOf('maj.refuseePar = "MANAGER";') > 0 && src.indexOf('maj.refuseePar = "RH";') > 0);

// ---------------------------------------------------------------------------
section("5. Gardes v0.2.177 / v0.2.184 STRICTEMENT inchangées");
// ---------------------------------------------------------------------------
check("garde v0.2.177 intacte (deuxEtapesDem && statut EN_ATTENTE)",
  src.indexOf('const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";') > 0);
const iBloc = src.indexOf("if (decisionMasquee) {");
const jBloc = src.indexOf("\n        }", iBloc);
const blocMasque = iBloc > 0 && jBloc > iBloc ? src.slice(iBloc, jBloc) : "";
check("bloc decisionMasquee masque toujours statut/décisions/commentaire/acteur",
  blocMasque.indexOf('statutVu = "EN_ATTENTE"') >= 0 &&
  blocMasque.indexOf("decisionManagerVu = null") >= 0 &&
  blocMasque.indexOf("decisionRhVu = null") >= 0 &&
  blocMasque.indexOf('commentaireVu = "";') >= 0 &&
  blocMasque.indexOf("traiteParVu = null") >= 0);
check("v0.2.184 : PJs conservées pendant l'attente (aucun « documentsVu = [] »)",
  blocMasque.indexOf("documentsVu = []") < 0);
check("v0.2.185 ne touche PAS les documents : champ documents rendu sans condition de refus",
  /documents: documentsVu,/.test(src) && src.indexOf("refusSansActeur ? null : documentsVu") < 0);
check("bloc v0.2.184 « ÉTAPE INTERMÉDIAIRE » (notification neutre) intact",
  src.indexOf("(NOUVEAU v0.2.184 — DEMANDE UTILISATEUR) ÉTAPE INTERMÉDIAIRE") > 0);
check("règle v0.2.185 placée APRÈS le calcul decisionMasquee (priorité v0.2.177 conservée)",
  src.indexOf('const refusSansActeur = d.statut === "REFUSEE";') >
  src.indexOf('const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";'));

// ===========================================================================
console.log("\n" + "=".repeat(78));
console.log("RÉSULTAT : " + ok + " OK / " + fail + " FAIL");
console.log("=".repeat(78));
process.exit(fail ? 1 : 0);
