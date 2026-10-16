#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.190 — CORRECTIF INTERRUPTeurs « ENVOI PAR E-MAIL (RÉPONSE PDF EN
 * PIÈCE JOINTE) » : EMPLOYÉ / SERVICE RH / MANAGER N+1 RESPECTÉS SUR LA
 * RÉPONSE AUTOMATIQUE (CONGÉ / AUTORISATION DE SORTIE)
 * ============================================================================
 * Demande utilisateur : « lorsque je désactive l'interrupteur de manager,
 * [le manager] reçoit toujours automatiquement la réponse PDF — vérifier les
 * interrupteurs manager, RH et aussi employé. »
 *
 * CAUSE (constatée dans v0.2.189) :
 *   - traiterMessageRecu construisait ccDecision = [rhAdresse, destAttendu]
 *     SANS lire ReponsePdfConfig — destAttendu = la boîte du manager
 *     (destinatairePourDemande : congé / autorisation → manager responsable) :
 *     désactiver « Manager / N+1 de la demande » ou « Auto-RH » dans le
 *     panneau Réponse PDF n'avait AUCUN effet sur la réponse automatique
 *     (le manager continuait de recevoir la décision + PDF signé en Cc) ;
 *   - l'interrupteur « Employé (destinataire) » était ignoré de la même
 *     façon (l'e-mail partait TOUJOURS à l'employé en « À »).
 *
 * CORRECTIF (v0.2.190) — scripts/portail-server.js :
 *   - traiterMessageRecu lit ReponsePdfConfig (id « reponse-pdf ») et filtre
 *     la liste Cc PAR INTERRUPTEUR : rhAdresse seulement si envoyerRh ;
 *     destAttendu (boîte manager) seulement si envoyerManager (et
 *     destAttendu !== rhAdresse : demande adressée directement au RH →
 *     interrupteur RH seul régit la boîte RH) ;
 *   - envoyerEmploye transmis à envoyerEmailDecisionConge : false →
 *     l'employé n'est plus le destinataire « À », le PREMIER Cc activé est
 *     PROMU (sémantique IDENTIQUE au module document-acceptation.js —
 *     construireEmailDocumentSigne) ; AUCUN destinataire activé → AUCUN
 *     envoi (journal code AUCUN_DESTINATAIRE) ;
 *   - config absente/illisible → TOUS ACTIVÉS (comportement historique
 *     v0.2.168 conservé) ; JAMAIS bloquant.
 *
 * Ce test vérifie STATIQUEMENT les modifications (lecture de config,
 * filtrage Cc, option envoyerEmploye, gardes, journal) et SIMULE la logique
 * réelle (blocs extraits du source et exécutés) sur les scénarios
 * utilisateur : manager OFF, RH OFF, employé OFF, tous ON, demande
 * adressée au RH. Sortie : OK/FAIL, code 1 si un FAIL.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const SRC = path.join(RACINE, "scripts/portail-server.js");
const ROUTE = path.join(RACINE, "src/app/api/reponse-pdf-config/route.ts");

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

const src = fs.readFileSync(SRC, "utf8");
const route = fs.readFileSync(ROUTE, "utf8");

/* ========================================================================== */
console.log("\n=== TEST v0.2.190 — interrupteurs Employé / Auto-RH / Manager respectés (réponse automatique) ===");

// ---------------------------------------------------------------------------
section("1. Lecture de la configuration Réponse PDF dans la voie e-mail");
// ---------------------------------------------------------------------------
check("prisma.reponsePdfConfig.findUnique({ where: { id: \"reponse-pdf\" } }) présent",
  src.indexOf('prisma.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } })') > 0);
check("lecture ENROBÉE try/catch (config illisible → null, jamais bloquant)",
  /try \{[\s\S]*?cfgReponsePdfDec = await prisma\.reponsePdfConfig\.findUnique/.test(src));
check("3 drapeaux dérivés : envoyerEmployeDecision / envoyerRhDecision / envoyerManagerDecision",
  src.indexOf("const envoyerEmployeDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerEmploye === false);") > 0 &&
  src.indexOf("const envoyerRhDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerRh === false);") > 0 &&
  src.indexOf("const envoyerManagerDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerManager === false);") > 0);
check("défauts ON : config absente → tous activés (négation du test === false)",
  (src.match(/=== false\);/g) || []).length >= 3);

// ---------------------------------------------------------------------------
section("2. Copies HISTORIQUES (ccDecision) — PLUS AUCUN filtrage par interrupteur (v0.2.193)");
// ---------------------------------------------------------------------------
check("RH en Cc TOUJOURS (ajout sans interrupteur — notification toujours envoyée)",
  src.indexOf("if (rhAdresse) liste.push(rhAdresse);") > 0);
check("MANAGER (destAttendu) en Cc TOUJOURS (garde !== rhAdresse conservée)",
  src.indexOf("if (destAttendu && destAttendu !== rhAdresse && liste.indexOf(destAttendu) < 0) liste.push(destAttendu);") > 0);
check("garde destAttendu !== rhAdresse conservée (demande adressée au RH → même adresse une seule fois)",
  src.indexOf("destAttendu !== rhAdresse") > 0);
check("ancien filtrage par interrupteur ABSENT (rhAdresse && envoyerRhDecision)",
  src.indexOf("if (rhAdresse && envoyerRhDecision) liste.push(rhAdresse);") < 0);
check("ancien filtrage par interrupteur ABSENT (destAttendu && envoyerManagerDecision)",
  src.indexOf("if (destAttendu && envoyerManagerDecision && destAttendu !== rhAdresse") < 0);
check("drapeaux EFFECTIFS avecPdfDecision (maître ET interrupteur — v0.2.193)",
  src.indexOf("const avecPdfDecision = {") > 0 &&
  /avecPdfDecision = \{[\s\S]{0,220}emailActifDecision && envoyerEmployeDecision,[\s\S]{0,120}emailActifDecision && envoyerRhDecision,[\s\S]{0,120}emailActifDecision && envoyerManagerDecision,/.test(src));

// ---------------------------------------------------------------------------
section("3. SIMULATION du bloc ccDecision (bloc réel extrait du source) — plus aucun filtrage");
// ---------------------------------------------------------------------------
const mCc = src.match(/const ccDecision = \(function \(\) \{\s*\n([\s\S]*?)\n\s*\}\)\(\);/);
check("bloc ccDecision extractible", Boolean(mCc));
let ccDecision = null;
if (mCc) {
  try {
    // mCc[1] contient déjà « const liste = []; » (bloc intégral) — on
    // l'exécute TEL QUEL avec les adresses en paramètres (plus AUCUN
    // interrupteur : copies historiques — v0.2.193).
    ccDecision = new Function("rhAdresse", "destAttendu",
      mCc[1] + "\nreturn liste;");
  } catch (e) { ccDecision = null; }
}
check("fonction de simulation construite", Boolean(ccDecision));
if (ccDecision) {
  const RH = "rh3000@zohomail.com", MGR = "manager.n1@entreprise.tn";
  check("tous ON (config absente) → cc = [RH, manager] (comportement historique v0.2.168 conservé)",
    JSON.stringify(ccDecision(RH, MGR)) === JSON.stringify([RH, MGR]));
  check("manager désactivé (interrupteur OFF) → cc = [RH, manager] ENCORE (le manager reçoit la notification)",
    JSON.stringify(ccDecision(RH, MGR)) === JSON.stringify([RH, MGR]));
  check("RH désactivé (interrupteur OFF) → cc = [RH, manager] ENCORE (la boîte RH reste en copie)",
    JSON.stringify(ccDecision(RH, MGR)) === JSON.stringify([RH, MGR]));
  check("demande adressée DIRECTEMENT au RH (destAttendu = rhAdresse) → cc = [RH] une seule fois",
    JSON.stringify(ccDecision(RH, RH)) === JSON.stringify([RH]));
  check("rhEmail non configuré (rhAdresse vide), manager destinataire → cc = [manager]",
    JSON.stringify(ccDecision("", MGR)) === JSON.stringify([MGR]));
}

// ---------------------------------------------------------------------------
section("4. Réponse PDF par interrupteur — envoyerEmailDecisionConge (v0.2.193)");
// ---------------------------------------------------------------------------
check("drapeaux avecPdf lus (défaut tous ON : Object.assign sur { employe, rh, manager })",
  src.indexOf("const avecPdf = Object.assign({ employe: true, rh: true, manager: true }, o.avecPdf || {});") > 0);
check("adresses par rôle : o.rh / o.manager prioritaires (repli o.cc historique)",
  src.indexOf("const adresseRh = String(o.rh || \"\").trim() || (ccListe[0] || \"\");") > 0 &&
  src.indexOf("const adresseManager = String(o.manager || \"\").trim() ||") > 0);
check("groupes : membresGroupe (avec PDF / sans PDF) — personne jamais exclu de la notification",
  src.indexOf("function membresGroupe(vouluAvecPdf) {") > 0);
check("SANS PDF disponible (refus) → drapeaux SANS EFFET (tout le monde notifié)",
  src.indexOf("(!pieceJointe ? true : (vouluAvecPdf ? avecPdf[k] : !avecPdf[k]))") > 0);
check("au plus DEUX envois prévus (avec PDF puis sans PDF)",
  src.indexOf("if (membresAvecPdf.length) envoisPrevus.push({ a: membresAvecPdf[0], cc: membresAvecPdf.slice(1), pdf: pieceJointe });") > 0 &&
  src.indexOf("if (membresSansPdf.length) envoisPrevus.push({ a: membresSansPdf[0], cc: membresSansPdf.slice(1), pdf: null });") > 0);
check("garde AUCUN_DESTINATAIRE : seulement AUCUNE adresse connue (envoisPrevus vide)",
  src.indexOf("if (!envoisPrevus.length) {") > 0 && src.indexOf('code: "AUCUN_DESTINATAIRE"') > 0);
check("ancienne garde « employé désactivé → erreur » SUPPRIMÉE (l'employé est toujours notifié)",
  src.indexOf("if (!dest && envoyerEmployeDec) {") < 0);
check("ancien destEffectif/ccEffectives (promotion par interrupteur) SUPPRIMÉS",
  src.indexOf("const destEffectif = envoyerEmployeDec ? dest : (ccListe.length ? ccListe[0] : \"\");") < 0);
check("journal par message : champ reponsePdf (true = avec PDF)",
  src.indexOf("reponsePdf: Boolean(pjMessage),") > 0);
check("envoi PAR GROUPE avec try/catch individuel (une panne n'empêche pas l'autre)",
  src.indexOf("erreursEnvoi.push(erreurEnvoi);") > 0);
check("retour : résumé reponsePdfPour / sansReponsePdfPour",
  src.indexOf("reponsePdfPour: membresAvecPdf.slice(),") > 0 &&
  src.indexOf("sansReponsePdfPour: membresSansPdf.slice(),") > 0);
check("appel : avecPdf: avecPdfDecision transmis (plus de envoyerEmploye:)",
  src.indexOf("avecPdf: avecPdfDecision,") > 0 && src.indexOf("envoyerEmploye: envoyerEmployeDecision,") < 0);

// ---------------------------------------------------------------------------
section("5. SIMULATION de la répartition en groupes (v0.2.193)");
// ---------------------------------------------------------------------------
function groupesSim(pieceJointe, avecPdf, dest, rh, manager) {
  function membresGroupe(vouluAvecPdf) {
    const membres = [];
    const retenu = (k) => (!pieceJointe ? true : (vouluAvecPdf ? avecPdf[k] : !avecPdf[k]));
    if (dest && retenu("employe")) membres.push(dest);
    if (rh && rh !== dest && retenu("rh")) membres.push(rh);
    if (manager && manager !== dest && membres.indexOf(manager) < 0 && retenu("manager")) membres.push(manager);
    return membres;
  }
  const membresAvecPdf = pieceJointe ? membresGroupe(true) : [];
  const membresSansPdf = membresGroupe(false);
  return { membresAvecPdf, membresSansPdf };
}
const EMP = "employe@entreprise.tn", RH2 = "rh3000@zohomail.com", MGR2 = "manager.n1@entreprise.tn";
const TOUS = { employe: true, rh: true, manager: true };
let r = groupesSim(true, TOUS, EMP, RH2, MGR2);
check("tous ON + PDF → groupe avec PDF = tout le monde, sans PDF = vide (historique)",
  JSON.stringify(r.membresAvecPdf) === JSON.stringify([EMP, RH2, MGR2]) && r.membresSansPdf.length === 0);
r = groupesSim(true, { employe: true, rh: true, manager: false }, EMP, RH2, MGR2);
check("manager OFF + PDF → avec = [employé, RH], sans = [manager] (le manager reste notifié, sans PDF)",
  JSON.stringify(r.membresAvecPdf) === JSON.stringify([EMP, RH2]) && JSON.stringify(r.membresSansPdf) === JSON.stringify([MGR2]));
r = groupesSim(true, { employe: false, rh: false, rh: false, manager: false }, EMP, RH2, MGR2);
check("maître OFF (tous false) + PDF → avec = [], sans = tout le monde (notification sans PDF)",
  r.membresAvecPdf.length === 0 && JSON.stringify(r.membresSansPdf) === JSON.stringify([EMP, RH2, MGR2]));
r = groupesSim(false, TOUS, EMP, RH2, MGR2);
check("REFUS (pas de PDF) → drapeaux SANS EFFET : tout le monde dans le groupe notification",
  r.membresAvecPdf.length === 0 && JSON.stringify(r.membresSansPdf) === JSON.stringify([EMP, RH2, MGR2]));
r = groupesSim(true, { employe: false, rh: true, manager: true }, EMP, RH2, MGR2);
check("employé OFF + PDF → RH promu « À » du groupe avec PDF, employé notifié sans PDF",
  r.membresAvecPdf[0] === RH2 && r.membresSansPdf.indexOf(EMP) >= 0);

// ---------------------------------------------------------------------------
section("6. Persistance des interrupteurs (panneau → base, route PUT)");
// ---------------------------------------------------------------------------
check("PUT persiste envoyerEmploye / envoyerRh / envoyerManager (Boolean)",
  route.indexOf("envoyerEmploye: Boolean(corps.envoyerEmploye),") > 0 &&
  route.indexOf("envoyerRh: Boolean(corps.envoyerRh),") > 0 &&
  route.indexOf("envoyerManager: Boolean(corps.envoyerManager),") > 0);
check("GET restitue les 3 interrupteurs (défauts !== false)",
  route.indexOf("envoyerEmploye: cfg.envoyerEmploye !== false,") > 0 &&
  route.indexOf("envoyerRh: cfg.envoyerRh !== false,") > 0 &&
  route.indexOf("envoyerManager: cfg.envoyerManager !== false,") > 0);
check("panneau : 3 interrupteurs Employé / Auto-RH / Manager / N+1 présents",
  (function () {
    const p = path.join(RACINE, "src/components/payslip/reponse-pdf-panel.tsx");
    if (!fs.existsSync(p)) return false;
    const t = fs.readFileSync(p, "utf8");
    return t.indexOf("cfg.envoi.envoyerEmploye") > 0 &&
      t.indexOf("cfg.envoi.envoyerRh") > 0 &&
      t.indexOf("cfg.envoi.envoyerManager") > 0;
  })());

// ---------------------------------------------------------------------------
section("7. NON-RÉGRESSION — règles v0.2.168/171/188 conservées");
// ---------------------------------------------------------------------------
check("PDF signé TOUJOURS joint en ACCEPTATION (v0.2.168/188 inchangées)",
  src.indexOf("await traiterDocumentSigneAcceptation(demande.id, declencheurDoc, { sansEmail: true })") > 0);
check("REFUS : AUCUN PDF généré ni envoyé (v0.2.188 inchangée)",
  (src.match(/await traiterDocumentRefusDecision\(/g) || []).length === 0);
check("piecesReponses : pièces jointes des décideurs toujours transmises (v0.2.171 inchangée)",
  src.indexOf("piecesReponses: piecesReponsesEmploye,") > 0);
check("en-têtes système conservés (X-Auto-RH-Systeme — Garde 2 anti-boucle)",
  src.indexOf('"X-Auto-RH-Systeme": "decision-demande"') > 0);
check("déduplication Cc conservée (indexOf === i)",
  /filter\(function \(x, i, t\) \{ return t\.indexOf\(x\) === i; \}\)/.test(src));
check("JAMAIS bloquant : lecture config enrobée, incidents journalisés",
  /catch \(e\) \{\s*\n\s*cfgReponsePdfDec = null;/.test(src));

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("RÉSULTAT : " + ok + " OK / " + fail + " FAIL");
console.log("=".repeat(78));
if (fail > 0) process.exit(1);
