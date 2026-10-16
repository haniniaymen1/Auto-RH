#!/usr/bin/env node
/**
 * ============================================================================
 * Task 200 (v0.2.155) — STATUT FINAL VISIBLE + MISE À JOUR AUTOMATIQUE
 * « Dans le portail employé, afficher le statut final de chaque demande
 * (Congé, Autorisation, etc.) après son traitement par le RH ou le manager.
 * Le statut doit être mis à jour automatiquement et afficher clairement :
 * En attente, Acceptée ou Refusée. »
 *
 * §1  libellés d'étape (manager / RH) : ACCEPTEE → Acceptée, REFUSEE →
 *     Refusée, null/EN_ATTENTE → En attente ;
 * §2  libellés du STATUT FINAL (tous les statuts, refus raffinés) ;
 * §3  rendu de la page /demandes : badge « statut-final » + puce, étapes
 *     Manager → RH pour les demandes à deux étapes (CONGE/AUTORISATION),
 *     ligne « Statut final » dans le détail, absence d'étapes pour les
 *     demandes à une étape (attestations, parrainage) ;
 * §4  empreinte de fraîcheur : détection d'un changement de statut /
 *     décision / document entre deux contrôles automatiques ;
 * §5  la page embarque le polling 30 s + visibilitychange + bouton
 *     « Actualiser maintenant » (vérif. verif_task200_page_demandes.js).
 *
 * AUCUN accès base : portail-server.js requis comme module (aucun port),
 * fonctions de rendu extraites du template DEMANDES_HTML.
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const assert = require("assert");

const portail = require("./portail-server.js");
let ok = 0;

/* ---------- §1 libellés d'étape ---------- */
assert.strictEqual(portail.libelleDecisionEtapeDemande("ACCEPTEE"), "Acceptée");
assert.strictEqual(portail.libelleDecisionEtapeDemande("REFUSEE"), "Refusée");
assert.strictEqual(portail.libelleDecisionEtapeDemande("EN_ATTENTE"), "En attente");
assert.strictEqual(portail.libelleDecisionEtapeDemande(null), "En attente");
assert.strictEqual(portail.libelleDecisionEtapeDemande(undefined), "En attente");
console.log("§1 OK — libellés d'étape (Acceptée / Refusée / En attente)"); ok++;

/* ---------- §2 libellés du statut final ---------- */
assert.strictEqual(portail.libelleStatutFinalDemande("EN_ATTENTE", null), "En attente");
assert.strictEqual(portail.libelleStatutFinalDemande("ACCEPTEE", null), "Acceptée");
assert.strictEqual(portailleSafe("VALIDEE"), "Validée");
assert.strictEqual(portail.libelleStatutFinalDemande("REFUSEE", "MANAGER"), "Refusée par le Manager");
assert.strictEqual(portail.libelleStatutFinalDemande("REFUSEE", "RH"), "Refusée par les RH");
assert.strictEqual(portail.libelleStatutFinalDemande("REFUSEE", null), "Refusée");
assert.strictEqual(portail.libelleStatutFinalDemande("INFORMATION_REQUISE", null), "Information requise");
console.log("§2 OK — statut final (En attente / Acceptée / Validée / Refusée par le Manager / par les RH / Information requise)"); ok++;
function portailleSafe(s) { return portail.libelleStatutFinalDemande(s, null); }

/* ---------- §3 rendu de la page /demandes ---------- */
const src = fs.readFileSync("scripts/portail-server.js", "utf8");
const d0 = src.indexOf("const DEMANDES_HTML = `");
const d1 = src.indexOf("`;", d0);
const html = src.slice(d0, d1).replace(/\\`/g, "`").replace(/\\\$\{/g, "${");
/** extrait UNE fonction (nom) du code source par équilibre d'accolades */
function extraireFonction(code, nom) {
  const debut = code.indexOf("function " + nom + "(");
  if (debut < 0) throw new Error("fonction introuvable : " + nom);
  let i = code.indexOf("{", debut), profondeur = 0, fin = -1;
  for (; i < code.length; i++) {
    if (code[i] === "{") profondeur++;
    else if (code[i] === "}") { profondeur--; if (!profondeur) { fin = i + 1; break; } }
  }
  if (fin < 0) throw new Error("accolades déséquilibrées : " + nom);
  return code.slice(debut, fin);
}
const codeFonctions =
  extraireFonction(html, "esc") + "\n" +
  extraireFonction(html, "fmtDate") + "\n" +
  extraireFonction(html, "rendreDemandes") + "\n";
const liste = { innerHTML: "", querySelectorAll: () => [] };
const document = { getElementById: () => null };
const apiUrl = (p) => "http://localhost:4001" + p;
// esc et fmtDate sont fournis par les fonctions extraites de la page (eval)
eval(codeFonctions);

// Demande à UNE étape acceptée
rendreDemandes([{
  id: "d1", reference: "DEM-2026-00001", type: "ATTESTATION_TRAVAIL",
  typeLibelle: "Attestation de travail", statut: "ACCEPTEE",
  statutLibelle: "Acceptée", deuxEtapes: false,
  decisionManager: null, decisionManagerLibelle: "En attente",
  decisionRh: "ACCEPTEE", decisionRhLibelle: "Acceptée",
  traiteLe: "2026-10-08T09:00:00.000Z", traitePar: "RH (saisie)",
  createdAt: "2026-10-07T08:00:00.000Z", commentaire: "",
  donnees: {}, documents: [],
}]);
assert(liste.innerHTML.indexOf('statut statut-final st-ACCEPTEE') >= 0, "badge statut-final ACCEPTEE absent");
assert(liste.innerHTML.indexOf('<span class="puce"></span>Acceptée') >= 0, "puce + libellé Absent");
assert(liste.innerHTML.indexOf("d-etapes") < 0, "étapes affichées à tort pour une demande à une étape");
assert(liste.innerHTML.indexOf("<b>Statut final&nbsp;:</b> Acceptée") >= 0, "ligne Statut final absente");
assert(liste.innerHTML.indexOf("décision rendue le") >= 0 && liste.innerHTML.indexOf("par RH (saisie)") >= 0, "date/acteur de décision absents");
console.log("§3a OK — une étape : badge final + ligne Statut final, sans encadré d'étapes"); ok++;

// Demande à DEUX étapes : manager accepté, RH en attente
liste.innerHTML = "";
rendreDemandes([{
  id: "d2", reference: "DEM-2026-00002", type: "CONGE",
  typeLibelle: "Demande de congé", statut: "EN_ATTENTE",
  statutLibelle: "En attente", deuxEtapes: true,
  decisionManager: "ACCEPTEE", decisionManagerLibelle: "Acceptée",
  decisionRh: null, decisionRhLibelle: "En attente",
  traiteLe: null, traitePar: null,
  createdAt: "2026-10-07T08:00:00.000Z", commentaire: "", donnees: {}, documents: [],
}]);
assert(liste.innerHTML.indexOf('statut statut-final st-EN_ATTENTE') >= 0, "badge EN_ATTENTE absent");
assert(liste.innerHTML.indexOf("1. Manager&nbsp;:") >= 0 && liste.innerHTML.indexOf('st-ACCEPTEE">Acceptée') >= 0, "étape manager non rendue");
assert(liste.innerHTML.indexOf("2. Auto-RH&nbsp;:") >= 0 && liste.innerHTML.indexOf('st-EN_ATTENTE">En attente') >= 0, "étape RH non rendue");
assert(liste.innerHTML.indexOf("&rarr;") >= 0, "flèche entre étapes absente");
assert(liste.innerHTML.indexOf("en cours de traitement") >= 0, "mention « en cours de traitement » absente");
console.log("§3b OK — deux étapes : fil Manager (Acceptée) → RH (En attente) visible sans dépliage"); ok++;

// Demande refusée par le manager
liste.innerHTML = "";
rendreDemandes([{
  id: "d3", reference: "DEM-2026-00003", type: "AUTORISATION_SORTIE",
  typeLibelle: "Autorisation de sortie", statut: "REFUSEE",
  statutLibelle: "Refusée par le Manager", deuxEtapes: true,
  decisionManager: "REFUSEE", decisionManagerLibelle: "Refusée",
  decisionRh: null, decisionRhLibelle: "En attente",
  traiteLe: "2026-10-08T10:00:00.000Z", traitePar: "Manager (réponse e-mail)",
  createdAt: "2026-10-07T08:00:00.000Z", commentaire: "", donnees: {}, documents: [],
}]);
assert(liste.innerHTML.indexOf('st-REFUSEE"><span class="puce"></span>Refusée par le Manager') >= 0, "libellé raffiné de refus absent du badge");
assert(liste.innerHTML.indexOf('st-REFUSEE">Refusée') >= 0, "étape manager refusée non rendue");
console.log("§3c OK — refus manager : « Refusée par le Manager » affiché en badge final + étape"); ok++;

/* ---------- §4 empreinte de fraîcheur (changement détecté) ---------- */
const e0 = src.indexOf("function empreinteDemandes(items)");
const e1 = src.indexOf("function demarrerRafraichissementStatut()", e0);
assert(e0 > 0 && e1 > e0, "empreinteDemandes introuvable");
const empreinteDemandes = eval("(" + src.slice(e0, e1).replace(/\s*$/, "") .replace(/function empreinteDemandes/, "function") + ")");
const avant = empreinteDemandes([{ id: "x", statut: "EN_ATTENTE", decisionManager: "ACCEPTEE", decisionRh: "", traiteLe: "", documents: [1] }]);
const apres = empreinteDemandes([{ id: "x", statut: "ACCEPTEE", decisionManager: "ACCEPTEE", decisionRh: "", traiteLe: "", documents: [1] }]);
const pareil = empreinteDemandes([{ id: "x", statut: "EN_ATTENTE", decisionManager: "ACCEPTEE", decisionRh: "", traiteLe: "", documents: [1] }]);
assert.notStrictEqual(avant, apres, "changement de statut NON détecté par l'empreinte");
assert.strictEqual(avant, pareil, "état identique détecté à tort comme changé");
console.log("§4 OK — empreinte : changement de statut détecté, état stable ignoré"); ok++;

/* ---------- §5 polling présent dans la page ---------- */
assert(src.indexOf("setInterval(function () {\n      if (document.visibilityState === \"visible\") chargerMesDemandes(true);") >= 0, "polling 30 s absent");
assert(src.indexOf('document.addEventListener("visibilitychange"') >= 0, "visibilitychange absent");
assert(src.indexOf('getElementById("btn-actualiser")') >= 0, "bouton Actualiser absent");
assert(src.indexOf("demarrerRafraichissementStatut();") >= 0, "démarrage du minuteur absent");
console.log("§5 OK — polling 30 s + visibilité + bouton « Actualiser maintenant »"); ok++;

console.log("\nRESULTAT : " + ok + " sections OK — Task 200 validé.");
process.exit(0);
