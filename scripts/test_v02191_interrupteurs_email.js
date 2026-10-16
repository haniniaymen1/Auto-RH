#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.191 — LES INTERRUPTHEURS « ENVOI PAR E-MAIL (RÉPONSE PDF EN
 * PIÈCE JOINTE) » FONCTIONNENT DANS LES DEUX SENS, SUR TOUTES LES VOIES
 * ============================================================================
 * Plaignant utilisateur : « les interrupteurs ne fonctionnent ni lorsqu'ils
 * sont activés ni lorsqu'ils sont désactivés ».
 *
 * CAUSES RACINES CORRIGÉES v0.2.191 :
 *   1. document-acceptation.js / chargerConfig : la configuration du panneau
 *      (ReponsePdfConfig) était IGNORÉE tant que la section n'était pas
 *      « engagée » (interrupteur de génération OFF — LE DÉFAUT — et aucun
 *      certificat dédié importé) → repli sur la config historique TOUS ON →
 *      les 4 interrupteurs e-mail restaient SANS EFFET sur TOUTES les
 *      décisions émises par l'administration (acceptation / refus signés).
 *   2. portail-server.js (voie e-mail congé/autorisation) : l'interrupteur
 *      MAÎTRE « Envoi automatique de l'e-mail » (emailActif) n'était pas
 *      consulté ; l'échec de lecture de la config était SILENCIEUX (défauts
 *      ON sans aucune trace — client Prisma ancien, base verrouillée…).
 *
 * CE TEST (RÉEL : vraie base pour ReponsePdfConfig, vrai module, vraie
 * fonction du portail extraite du source ; SEUL le transport SMTP est simulé) :
 *   Partie 1 — chargerConfig RÉEL : les 4 interrupteurs sont lus depuis la
 *              base MÊME section non engagée ; sans ligne → défauts historiques.
 *   Partie 2 — traiterAcceptationFinale RÉEL (document généré, e-mail simulé) :
 *              destinataires filtrés par chaque interrupteur (manager OFF,
 *              RH OFF, employé OFF → promotion, maître OFF → AUCUN envoi).
 *   Partie 3 — portail (code RÉEL extrait) : bloc décisionnel (drapeaux +
 *              emailActifDecision + diagnostic client Prisma ancien) et
 *              fonction envoyerEmailDecisionConge RÉELLE (À/Cc/AUCUN_
 *              DESTINATAIRE, promotion du premier Cc).
 * Sortie : code 0 si TOUT est OK.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "portail-server.js");
const MOD = path.join(__dirname, "document-acceptation.js");

/* ---------- chargement du .env de la racine (IDENTIQUE au portail) ---------- */
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
})();

const { PrismaClient } = require("@prisma/client");
const prismaReel = new PrismaClient({ log: ["error"] });
const acceptation = require(MOD);

let OK = 0;
let FAIL = 0;
function check(nom, cond) {
  if (cond) { OK++; console.log("  OK   - " + nom); }
  else { FAIL++; console.log("  FAIL - " + nom); }
}
function section(t) {
  console.log("\n" + "-".repeat(78) + "\n" + t + "\n" + "-".repeat(78));
}

const LIGNE = { id: "reponse-pdf" };
let snapshot = null;

async function ecrireLigne(data) {
  await prismaReel.reponsePdfConfig.upsert({
    where: LIGNE,
    update: data,
    create: Object.assign({ id: "reponse-pdf" }, data),
  });
}

/* Prisma HYBRIDE : ReponsePdfConfig = VRAIE base ; le reste = mocks mémoire. */
function prismaHybride(demande, sac) {
  return {
    reponsePdfConfig: prismaReel.reponsePdfConfig,
    signatureConfig: {
      findUnique: async () => null,
      create: async () => ({}),
    },
    signatureApiConfig: { findUnique: async () => null },
    demandeAdministrative: {
      findUnique: async () => Object.assign({}, demande),
      update: async ({ data }) => { sac.maj.push(data); return demande; },
    },
    documentDemande: {
      create: async ({ data }) => { sac.docs.push(data); return Object.assign({ id: "doc-" + sac.docs.length }, data); },
    },
    mailConfig: {
      findUnique: async () => ({ id: "smtp", rhEmail: "rh@entreprise.tn", from: "auto-rh@entreprise.tn" }),
    },
  };
}

async function restaurerLigne() {
  if (snapshot) {
    const copie = Object.assign({}, snapshot);
    delete copie.id;
    delete copie.updatedAt;
    await prismaReel.reponsePdfConfig.upsert({ where: LIGNE, update: copie, create: Object.assign({ id: "reponse-pdf" }, copie) });
  } else {
    // Aucun instantané (le panneau n'avait jamais été ouvert) : recrée une
    // ligne NEUTRE par défaut (tous ON — identique à l'auto-création du GET).
    await prismaReel.reponsePdfConfig.upsert({ where: LIGNE, update: {}, create: { id: "reponse-pdf" } }).catch(() => {});
  }
}

/* ========================================================================== */
async function partie1_chargerConfig() {
  section("1. chargerConfig RÉEL — interrupteurs e-mail appliqués MÊME section NON ENGAGÉE (correctif v0.2.191)");
  const prismaHy = prismaHybride({}, { maj: [], docs: [] });

  // 1.1 — section NON engagée (actif=false = DÉFAUT, aucun certificat) +
  //       Manager OFF dans le panneau → AVANT v0.2.191 : docEnvoyerManager=true (ignoré).
  await ecrireLigne({ actif: false, certChemin: "", emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: false });
  const c1 = await acceptation.chargerConfig(prismaHy);
  check("section non engagée → source « module-historique » (continuité visuels v0.2.148 conservée)",
    c1._sourceConfig === "module-historique");
  check("Manager OFF LU depuis le panneau (avant v0.2.191 : SANS EFFET)", c1.docEnvoyerManager === false);
  check("Employé ON conservé", c1.docEnvoyerEmploye === true);
  check("RH ON conservé", c1.docEnvoyerRh === true);
  check("Maître (emailActif) ON conservé", c1.docEmailActif === true);

  // 1.2 — section NON engagée + maître OFF
  await ecrireLigne({ emailActif: false });
  const c2 = await acceptation.chargerConfig(prismaHy);
  check("Maître OFF lu (docEmailActif=false — e-mails de décision désactivés côté administration)",
    c2.docEmailActif === false && c2.docEnvoyerManager === false);

  // 1.3 — section ENGAGÉE (actif=true) → voie dédiée (non-régression v0.2.144)
  await ecrireLigne({ actif: true, emailActif: true });
  const c3 = await acceptation.chargerConfig(prismaHy);
  check("section engagée → source « section-dediee » (non-régression)", c3._sourceConfig === "section-dediee");
  check("section engagée → Manager OFF toujours respecté", c3.docEnvoyerManager === false);

  // 1.4 — LIGNE ABSENTE (panneau jamais ouvert) → défauts historiques TOUS ON
  await prismaReel.reponsePdfConfig.delete({ where: LIGNE });
  const c4 = await acceptation.chargerConfig(prismaHy);
  check("sans ligne → défauts historiques tous ON (AUCUN changement pour les installations jamais configurées)",
    c4.docEnvoyerManager === true && c4.docEnvoyerEmploye === true && c4.docEnvoyerRh === true && c4.docEmailActif === true);
}

/* ========================================================================== */
async function partie2_traiterAcceptationFinale() {
  section("2. traiterAcceptationFinale RÉEL — notification TOUJOURS envoyée, PDF par interrupteur (v0.2.193)");
  const demande = {
    id: "demo-191",
    reference: "DEM-2026-0191",
    type: "CONGE",
    statut: "ACCEPTEE",
    cin: "12345678",
    employeEmail: "employe.test@entreprise.tn",
    destinataire: "manager.n1@entreprise.tn",
    donnees: JSON.stringify({ prenom: "Employé", nom: "Test", typeConge: "Congé annuel", joursOuvres: 12 }),
    docSigneChemin: null,
    createdAt: new Date(),
  };
  const sac = { maj: [], docs: [] };
  const dossier = fs.mkdtempSync(path.join(ROOT, "storage", "test-191-"));
  const messages = [];
  const opts = {
    dechiffrerChamp: (v) => v,
    encryptForStorage: (b) => b,
    lireFichierStocke: (p) => fs.readFileSync(p),
    dossierDocumentsDemandes: dossier,
    envoyerMail: async (msg) => { messages.push(msg); return { messageId: "m-" + messages.length, response: "250 OK" }; },
    journaliser: () => {},
    declencheur: "Test v0.2.191",
  };
  const PDF_JOINT = (m) => m && Array.isArray(m.attachments) && m.attachments.length === 1 && m.attachments[0].contentType === "application/pdf";
  try {
    // A — Manager OFF → DEUX messages : (employé+RH AVEC PDF) + (manager SANS PDF)
    await ecrireLigne({ actif: false, certChemin: "", emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: false });
    messages.length = 0;
    let r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("A — document signé généré", r.genere === true);
    check("A — manager OFF : DEUX e-mails (le manager reçoit QUAND MÊME la notification — v0.2.193)", messages.length === 2);
    check("A — message 1 : À employé, Cc RH, AVEC PDF",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" && JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn"]) && PDF_JOINT(messages[0]));
    check("A — message 2 : À manager, SANS PDF",
      messages[1] && messages[1].to === "manager.n1@entreprise.tn" && !messages[1].attachments);

    // B — RH OFF en plus → (employé AVEC PDF seul) + (RH à, manager Cc, SANS PDF)
    await ecrireLigne({ envoyerRh: false });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("B — RH+manager OFF : DEUX e-mails", messages.length === 2);
    check("B — message 1 : À employé SEUL, AVEC PDF",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" && PDF_JOINT(messages[0]) && (!messages[0].cc || messages[0].cc.length === 0));
    check("B — message 2 : À RH (promu), Cc manager, SANS PDF",
      messages[1] && messages[1].to === "rh@entreprise.tn" && JSON.stringify(messages[1].cc) === JSON.stringify(["manager.n1@entreprise.tn"]) && !messages[1].attachments);

    // C — Employé OFF (RH + manager revenus ON) → RH promu « À » AVEC PDF + employé notifié SANS PDF
    await ecrireLigne({ envoyerEmploye: false, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("C — employé OFF : DEUX e-mails (l'employé reçoit QUAND MÊME la notification)", messages.length === 2);
    check("C — message 1 : À RH (promu), Cc manager, AVEC PDF",
      messages[0] && messages[0].to === "rh@entreprise.tn" && JSON.stringify(messages[0].cc) === JSON.stringify(["manager.n1@entreprise.tn"]) && PDF_JOINT(messages[0]));
    check("C — message 2 : À employé, SANS PDF", messages[1] && messages[1].to === "employe.test@entreprise.tn" && !messages[1].attachments);

    // D — MAÎTRE OFF → UN SEUL message SANS PDF à tout le monde (v0.2.193 : plus de suppression d'envoi)
    await ecrireLigne({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("D — maître OFF : UN e-mail de notification (envoi JAMAIS supprimé — v0.2.193)", messages.length === 1);
    check("D — maître OFF : À employé, Cc RH + manager, SANS PDF",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) &&
      !messages[0].attachments);
    check("D — résultat : reponsePdfDesactive=true (le maître coupe le PDF, pas la notification)",
      Boolean(r.envoi && r.envoi.reponsePdfDesactive === true));

    // E — tous ON → comportement historique (À employé, Cc RH + manager, PDF)
    await ecrireLigne({ emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("E — tous ON : À employé", messages.length === 1 && messages[0].to === "employe.test@entreprise.tn");
    check("E — tous ON : Cc RH + manager",
      JSON.stringify(messages[0] && messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));
    check("E — tous ON : PDF signé JOINT (historique v0.2.168 conservé)", PDF_JOINT(messages[0]));
  } finally {
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

/* ========================================================================== */
async function partie3_portailCodeReel() {
  section("3. Portail (code RÉEL extrait du source) — voie e-mail : maître OFF, drapeaux, diagnostics");
  const src = fs.readFileSync(SRC, "utf8");

  // 3.1 — présences v0.2.191 ADAPTÉES v0.2.193
  check("emailActifDecision consulté (maître — gouverne le PDF avec les 3 interrupteurs)",
    src.indexOf("const emailActifDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.emailActif === false);") > 0);
  check("garde client Prisma ancien (diagnostic EXPLICITE, plus de lecture silencieuse)",
    src.indexOf("modèle ReponsePdfConfig absent du client Prisma") > 0);
  check("journal « ENVOI_DESACTIVE » SUPPRIMÉ (v0.2.193 — le maître ne coupe plus l'e-mail)", src.indexOf('code: "ENVOI_DESACTIVE"') < 0);
  check("trace console des interrupteurs LUS à chaque décision", src.indexOf("interrupteurs lus : Envoi automatique=") > 0);
  check("drapeaux EFFECTIFS avecPdfDecision (v0.2.193)", src.indexOf("const avecPdfDecision = {") > 0);

  // 3.2 — bloc décisionnel RÉEL (lecture config + drapeaux + avecPdf + ccDecision)
  const mBloc = src.match(/let cfgReponsePdfDec = null;[\s\S]*?const ccDecision = \(function \(\) \{[\s\S]*?\}\)\(\);/);
  check("bloc décisionnel extractible (lecture + emailActifDecision + avecPdfDecision + ccDecision)", Boolean(mBloc));
  if (mBloc) {
    // Le bloc contient des « await » → enveloppé dans une IIFE async (la
    // fabrique renvoie donc une PROMISE — les appelants await déjà).
    const fabrique = new Function(
      "prisma", "console", "rhAdresse", "destAttendu", "demande",
      "return (async () => {\n" + mBloc[0] +
      "\nreturn { emailActifDecision, envoyerEmployeDecision, envoyerRhDecision, envoyerManagerDecision, avecPdfDecision, ccDecision };\n})();"
    );
    const refDemo = { reference: "DEM-2026-0191" };
    // a — maître OFF + manager OFF → avecPdf tous false ; ccDecision HISTORIQUE COMPLET
    const prismaA = { reponsePdfConfig: { findUnique: async () => ({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: false }) } };
    const consoleA = { log: () => {}, warn: () => {} };
    const rA = await fabrique(prismaA, consoleA, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("maître OFF → emailActifDecision=false", rA.emailActifDecision === false);
    check("manager OFF → envoyerManagerDecision=false", rA.envoyerManagerDecision === false);
    check("maître OFF + manager OFF → avecPdf { employe:false, rh:false, manager:false } (v0.2.193)",
      rA.avecPdfDecision.employe === false && rA.avecPdfDecision.rh === false && rA.avecPdfDecision.manager === false);
    check("maître OFF + manager OFF → ccDecision = [RH, manager] (notification toujours — v0.2.193)",
      JSON.stringify(rA.ccDecision) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));

    // b — config absente → tous ON + cc historique
    const rB = await fabrique({ reponsePdfConfig: { findUnique: async () => null } }, { log: () => {}, warn: () => {} }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("config absente → tous activés (défauts)",
      rB.emailActifDecision && rB.envoyerEmployeDecision && rB.envoyerRhDecision && rB.envoyerManagerDecision);
    check("config absente → ccDecision [RH, manager] (historique)",
      JSON.stringify(rB.ccDecision) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));

    // c — client Prisma ancien (modèle absent) → AVERTISSEMENT + défauts ON
    const warns = [];
    const rC = await fabrique({}, { log: () => {}, warn: (w) => warns.push(String(w)) }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("client Prisma ancien → défauts ON (jamais bloquant)",
      rC.emailActifDecision && rC.envoyerEmployeDecision && rC.envoyerRhDecision && rC.envoyerManagerDecision);
    check("client Prisma ancien → UN avertissement explicite (mention ReponsePdfConfig + prisma generate)",
      warns.length === 1 && /ReponsePdfConfig/.test(warns[0]) && /prisma generate/.test(warns[0]));

    // d — RH OFF → avecPdf.rh=false MAIS le RH RESTE dans ccDecision (v0.2.193)
    const rD = await fabrique(
      { reponsePdfConfig: { findUnique: async () => ({ emailActif: true, envoyerEmploye: false, envoyerRh: false, envoyerManager: true }) } },
      { log: () => {}, warn: () => {} }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("RH OFF → avecPdf.rh=false MAIS ccDecision CONTIENT le RH (notification toujours)",
      rD.avecPdfDecision.rh === false && rD.ccDecision.indexOf("rh@entreprise.tn") >= 0);
  }

  // 3.3 — fonction envoyerEmailDecisionConge RÉELLE (transport SMTP simulé)
  const i0 = src.indexOf("async function envoyerEmailDecisionConge");
  const i1 = src.indexOf("\n}\n", i0);
  check("fonction envoyerEmailDecisionConge extractible", i0 > 0 && i1 > i0);
  if (i0 > 0 && i1 > i0) {
    // i1 = index du « \n » PRÉCÉDANT l'accolade fermante de colonne 0 →
    // il faut inclure i1 (« \n ») ET i1+1 (« } ») : slice(i0, i1 + 2).
    const srcFn = src.slice(i0, i1 + 2);
    const journaux = [];
    const envois = [];
    const fabriqueFn = new Function(
      "cryptoBd", "journaliserEnvoiDemandes", "nodemailerDemandes", "expediteurEffectifDemandes",
      "libelleStatutFinalDemande", "libelleTypeDemande", "masquerCinDemande", "echappeEmailDemande",
      "formaterTailleDocument", "nomEmployeDepuisFiches",
      srcFn + "\nreturn envoyerEmailDecisionConge;"
    );
    const envoyerEmailDecisionConge = fabriqueFn(
      { dechiffrerChamp: (v) => v },
      (e) => journaux.push(e),
      { createTransport: () => ({ sendMail: async (msg) => { envois.push(msg); return { messageId: "mid-1", response: "250 OK" }; } }) },
      (cfg) => "auto-rh@entreprise.tn",
      (s) => s,
      (t) => ({ CONGE: "Demande de congé" }[t] || t),
      (c) => c,
      (v) => v,
      (n) => (n / 1024).toFixed(1) + " Ko",
      async () => "Employé Test",
    );
    const demande = {
      reference: "DEM-2026-0191",
      type: "CONGE",
      employeEmail: "employe.test@entreprise.tn",
      donnees: JSON.stringify({ prenom: "Employé", nom: "Test" }),
      cin: "12345678",
    };
    const cfgMail = { host: "smtp.test.tn", port: 587 };
    const pj191 = { filename: "DEM-2026-0191-SIGNE.pdf", content: Buffer.from("%PDF-fictif-191"), contentType: "application/pdf" };
    const APJ191 = (m) => m && Array.isArray(m.attachments) && m.attachments.some((a) => a.contentType === "application/pdf");

    // a — tous ON + PDF → 1 envoi (employé, Cc RH+manager, attachment)
    journaux.length = 0; envois.length = 0;
    let r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj191, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: true, rh: true, manager: true } });
    check("fonction réelle — tous ON : À employé, Cc RH+manager, PDF joint (historique)",
      r.envoye && envois.length === 1 && envois[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) && APJ191(envois[0]));

    // b — manager OFF + PDF → 2 envois : (employé/Cc RH avec PDF) + (manager sans PDF)
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj191, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: true, rh: true, manager: false } });
    check("fonction réelle — manager OFF : 2 envois (le manager reçoit QUAND MÊME la notification — v0.2.193)",
      r.envoye && envois.length === 2);
    check("fonction réelle — manager OFF : envoi 1 À employé / Cc RH / AVEC PDF",
      envois[0] && envois[0].to === "employe.test@entreprise.tn" && JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn"]) && APJ191(envois[0]));
    check("fonction réelle — manager OFF : envoi 2 À manager / SANS PDF",
      envois[1] && envois[1].to === "manager.n1@entreprise.tn" && !envois[1].attachments);

    // c — maître OFF (avecPdf tous false) → 1 envoi SANS PDF à tout le monde
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj191, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: false, rh: false, manager: false } });
    check("fonction réelle — maître OFF : 1 envoi À employé, Cc RH+manager, SANS PDF (v0.2.193)",
      r.envoye && envois.length === 1 && envois[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) && !envois[0].attachments);

    // d — aucune adresse connue → AUCUN_DESTINATAIRE (jamais bloquant)
    journaux.length = 0; envois.length = 0;
    const demandeSansMail = Object.assign({}, demande, { employeEmail: null });
    r = await envoyerEmailDecisionConge(demandeSansMail, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj191, rh: "", manager: "", avecPdf: { employe: true, rh: true, manager: true } });
    check("fonction réelle — aucune adresse connue → AUCUN envoi, journal AUCUN_DESTINATAIRE",
      !r.envoye && envois.length === 0 && journaux.length === 1 && journaux[0].code === "AUCUN_DESTINATAIRE");
  }
}

/* ========================================================================== */
(async () => {
  console.log("=== TEST v0.2.191 — interrupteurs « Envoi par e-mail (réponse PDF) » effectifs dans les DEUX sens ===");
  snapshot = await prismaReel.reponsePdfConfig.findUnique({ where: LIGNE });
  try {
    await partie1_chargerConfig();
    await partie2_traiterAcceptationFinale();
    await partie3_portailCodeReel();
  } finally {
    await restaurerLigne();
    await prismaReel.$disconnect();
  }
  console.log("\n" + "=".repeat(78));
  console.log("RÉSULTAT : " + OK + " OK / " + FAIL + " FAIL");
  console.log("=".repeat(78));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error("ÉCHEC DU TEST : " + ((e && e.stack) || e));
  process.exit(1);
});
