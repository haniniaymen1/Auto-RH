#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.193 — LES E-MAILS DE NOTIFICATION D'ACCEPTATION / DE REFUS SONT
 * TOUJOURS ENVOYÉS ; LES INTERRUPTEURS NE GOUVERNENT PLUS QUE LA RÉPONSE PDF
 * ============================================================================
 * Demande utilisateur : « Même si les interrupteurs sont activés ou
 * désactivés, les e-mails de notification d'acceptation ou de refus doivent
 * toujours être envoyés. Les interrupteurs doivent uniquement contrôler
 * l'envoi de la réponse automatique par PDF, sans modifier le fonctionnement
 * des notifications par e-mail. »
 *
 * NOUVELLE SÉMANTIQUE (3 voies corrigées) :
 *   - portail-server.js (voie e-mail congé/autorisation) : ccDecision
 *     HISTORIQUE (plus aucun filtrage par interrupteur), maître OFF ne
 *     supprime PLUS l'envoi (code ENVOI_DESACTIVE supprimé) ;
 *   - document-acceptation.js (administration — acceptation signée) :
 *     destinataires TOUJOURS complets ; PDF joint au seul groupe activé ;
 *   - document-refus.js (administration — refus signé) : jumelle.
 *   Les destinataires exclus de la réponse PDF reçoivent LA MÊME
 *   notification SANS le PDF (au plus deux messages : « avec PDF » puis
 *   « sans PDF »).
 *
 * CE TEST (RÉEL : vraie base ReponsePdfConfig, vrais modules — le transport
 * SMTP est le SEUL simulé) :
 *   Partie 1 — traiterAcceptationFinale RÉEL : 6 scénarios d'interrupteurs.
 *   Partie 2 — traiterRefus RÉEL : notification de refus toujours envoyée.
 *   Partie 3 — portail (code RÉEL extrait) : bloc décisionnel + fonction
 *              envoyerEmailDecisionConge RÉELLE (répartition 2 groupes).
 *   Partie 4 — panneau : descriptions mises à jour (sémantique visible).
 * Sortie : code 0 si TOUT est OK.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "portail-server.js");
const MOD_ACC = path.join(__dirname, "document-acceptation.js");
const MOD_REF = path.join(__dirname, "document-refus.js");
const PANEL = path.join(ROOT, "src", "components", "payslip", "reponse-pdf-panel.tsx");

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
const acceptation = require(MOD_ACC);
const refus = require(MOD_REF);

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
    await prismaReel.reponsePdfConfig.upsert({ where: LIGNE, update: {}, create: { id: "reponse-pdf" } }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Partie 1 — traiterAcceptationFinale RÉEL                            */
/* ------------------------------------------------------------------ */
async function partie1_acceptation() {
  section("1. traiterAcceptationFinale RÉEL — notification TOUJOURS envoyée, PDF par interrupteur");
  const demande = {
    id: "demo-193",
    reference: "DEM-2026-0193",
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
  const dossier = fs.mkdtempSync(path.join(ROOT, "storage", "test-193-"));
  const messages = [];
  const opts = {
    dechiffrerChamp: (v) => v,
    encryptForStorage: (b) => b,
    lireFichierStocke: (p) => fs.readFileSync(p),
    dossierDocumentsDemandes: dossier,
    envoyerMail: async (msg) => { messages.push(msg); return { messageId: "m-" + messages.length, response: "250 OK" }; },
    journaliser: () => {},
    declencheur: "Test v0.2.193",
  };
  const PDF_JOINT = (m) => m && Array.isArray(m.attachments) && m.attachments.length === 1 && m.attachments[0].contentType === "application/pdf";
  try {
    // A — tous ON (défaut) → 1 message avec PDF (historique inchangé)
    await ecrireLigne({ actif: false, certChemin: "", emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    let r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("A — document signé généré", r.genere === true);
    check("A — tous ON : UN SEUL e-mail (comportement historique conservé)", messages.length === 1);
    check("A — tous ON : À employé, Cc RH + manager",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));
    check("A — tous ON : PDF signé JOINT", PDF_JOINT(messages[0]));
    check("A — trace : reponsePdfPour = employé + RH + manager",
      JSON.stringify(r.envoi && r.envoi.reponsePdfPour) === JSON.stringify(["employe", "rh", "manager"]));

    // B — manager OFF → 2 messages : (employé+RH avec PDF) + (manager SANS PDF)
    await ecrireLigne({ emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: false });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("B — manager OFF : DEUX e-mails (notification toujours)", messages.length === 2);
    check("B — message 1 : À employé, Cc RH, AVEC PDF", messages[0] && messages[0].to === "employe.test@entreprise.tn" && JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn"]) && PDF_JOINT(messages[0]));
    check("B — message 2 : À manager, SANS PDF (notification seule)",
      messages[1] && messages[1].to === "manager.n1@entreprise.tn" && !messages[1].attachments);
    check("B — trace : sansReponsePdfPour = [manager]",
      JSON.stringify(r.envoi && r.envoi.sansReponsePdfPour) === JSON.stringify(["manager"]));

    // C — RH + manager OFF → 2 messages : (employé avec PDF) + (RH à, manager Cc, sans PDF)
    await ecrireLigne({ emailActif: true, envoyerEmploye: true, envoyerRh: false, envoyerManager: false });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("C — RH+manager OFF : DEUX e-mails", messages.length === 2);
    check("C — message 1 : À employé SEUL, AVEC PDF", messages[0] && messages[0].to === "employe.test@entreprise.tn" && PDF_JOINT(messages[0]) && (!messages[0].cc || messages[0].cc.length === 0));
    check("C — message 2 : À RH (promu), Cc manager, SANS PDF",
      messages[1] && messages[1].to === "rh@entreprise.tn" && JSON.stringify(messages[1].cc) === JSON.stringify(["manager.n1@entreprise.tn"]) && !messages[1].attachments);

    // D — employé OFF (RH + manager ON) → RH promu « À » avec PDF + employé notifié sans PDF
    await ecrireLigne({ emailActif: true, envoyerEmploye: false, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("D — employé OFF : DEUX e-mails (l'employé reçoit QUAND MÊME la notification)", messages.length === 2);
    check("D — message 1 : À RH (promu), Cc manager, AVEC PDF",
      messages[0] && messages[0].to === "rh@entreprise.tn" && JSON.stringify(messages[0].cc) === JSON.stringify(["manager.n1@entreprise.tn"]) && PDF_JOINT(messages[0]));
    check("D — message 2 : À employé, SANS PDF", messages[1] && messages[1].to === "employe.test@entreprise.tn" && !messages[1].attachments);

    // E — maître OFF → 1 message SANS PDF à tout le monde (notification toujours)
    await ecrireLigne({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("E — maître OFF : UN e-mail (plus AUCUNE suppression d'envoi)", messages.length === 1);
    check("E — maître OFF : À employé, Cc RH + manager, SANS PDF",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) &&
      !messages[0].attachments);
    check("E — maître OFF : reponsePdfDesactive=true (trace)", Boolean(r.envoi && r.envoi.reponsePdfDesactive === true));

    // F — ligne absente (panneau jamais ouvert) → défauts tous ON → historique
    await prismaReel.reponsePdfConfig.delete({ where: LIGNE });
    messages.length = 0;
    r = await acceptation.traiterAcceptationFinale(prismaHybride(demande, sac), demande.id, opts);
    check("F — config absente : 1 message avec PDF à employé + Cc RH/manager (historique)",
      messages.length === 1 && messages[0].to === "employe.test@entreprise.tn" && PDF_JOINT(messages[0]));
  } finally {
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

/* ------------------------------------------------------------------ */
/* Partie 2 — traiterRefus RÉEL                                        */
/* ------------------------------------------------------------------ */
async function partie2_refus() {
  section("2. traiterRefus RÉEL — notification de refus TOUJOURS envoyée, PDF par interrupteur");
  const demande = {
    id: "demo-193r",
    reference: "DEM-2026-0193R",
    type: "CONGE",
    statut: "REFUSEE",
    cin: "12345678",
    employeEmail: "employe.test@entreprise.tn",
    destinataire: "manager.n1@entreprise.tn",
    donnees: JSON.stringify({ prenom: "Employé", nom: "Test", typeConge: "Congé annuel", joursOuvres: 5 }),
    commentaire: "Refus : solde insuffisant pour la période demandée.",
    docRefusChemin: null,
    createdAt: new Date(),
  };
  const sac = { maj: [], docs: [] };
  const dossier = fs.mkdtempSync(path.join(ROOT, "storage", "test-193r-"));
  const messages = [];
  const opts = {
    dechiffrerChamp: (v) => v,
    encryptForStorage: (b) => b,
    lireFichierStocke: (p) => fs.readFileSync(p),
    dossierDocumentsDemandes: dossier,
    envoyerMail: async (msg) => { messages.push(msg); return { messageId: "r-" + messages.length, response: "250 OK" }; },
    journaliser: () => {},
    declencheur: "Test v0.2.193",
  };
  const PDF_JOINT = (m) => m && Array.isArray(m.attachments) && m.attachments.length === 1 && m.attachments[0].contentType === "application/pdf";
  try {
    // G — tous ON → 1 message avec le PDF de refus (historique)
    await ecrireLigne({ actif: false, certChemin: "", emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    let r = await refus.traiterRefus(prismaHybride(demande, sac), demande.id, opts);
    check("G — document de refus généré", r.genere === true);
    check("G — tous ON : UN e-mail, À employé, Cc RH + manager",
      messages.length === 1 && messages[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));
    check("G — tous ON : PDF de refus JOINT", PDF_JOINT(messages[0]));

    // H — manager OFF → 2 messages (notification du manager TOUJOURS envoyée)
    await ecrireLigne({ emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: false });
    messages.length = 0;
    r = await refus.traiterRefus(prismaHybride(demande, sac), demande.id, opts);
    check("H — manager OFF : DEUX e-mails (le manager reçoit QUAND MÊME le refus)", messages.length === 2);
    check("H — message 1 : À employé, Cc RH, AVEC PDF de refus",
      messages[0] && messages[0].to === "employe.test@entreprise.tn" && JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn"]) && PDF_JOINT(messages[0]));
    check("H — message 2 : À manager, SANS PDF", messages[1] && messages[1].to === "manager.n1@entreprise.tn" && !messages[1].attachments);

    // I — maître OFF → 1 message SANS PDF à tout le monde
    await ecrireLigne({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: true });
    messages.length = 0;
    r = await refus.traiterRefus(prismaHybride(demande, sac), demande.id, opts);
    check("I — maître OFF : UN e-mail de refus SANS PDF à employé + RH + manager",
      messages.length === 1 && messages[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(messages[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) &&
      !messages[0].attachments);
  } finally {
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) { /* */ }
  }
}

/* ------------------------------------------------------------------ */
/* Partie 3 — portail (code RÉEL extrait)                              */
/* ------------------------------------------------------------------ */
async function partie3_portail() {
  section("3. Portail (code RÉEL) — copies historiques, avecPdf, plus de suppression d'envoi");
  const src = fs.readFileSync(SRC, "utf8");

  // 3.1 — présences / absences v0.2.193
  check("drapeaux EFFECTIFS avecPdfDecision calculés (maître ET interrupteur)",
    src.indexOf("const avecPdfDecision = {") > 0);
  check("code « ENVOI_DESACTIVE » SUPPRIMÉ (le maître ne coupe plus l'e-mail)",
    src.indexOf('code: "ENVOI_DESACTIVE"') < 0);
  check("ccDecision HISTORIQUE — rhAdresse ajouté SANS condition d'interrupteur",
    /const ccDecision = \(function \(\) \{[\s\S]{0,400}if \(rhAdresse\) liste\.push\(rhAdresse\);/.test(src));
  check("trace console : « notification TOUJOURS envoyée »",
    src.indexOf("notification TOUJOURS envoyée") > 0);
  check("garde client Prisma ancien conservée (diagnostic explicite v0.2.191)",
    src.indexOf("modèle ReponsePdfConfig absent du client Prisma") > 0);

  // 3.2 — bloc décisionnel RÉEL (lecture config + drapeaux + avecPdf + ccDecision)
  const mBloc = src.match(/let cfgReponsePdfDec = null;[\s\S]*?const ccDecision = \(function \(\) \{[\s\S]*?\}\)\(\);/);
  check("bloc décisionnel extractible (lecture + avecPdfDecision + ccDecision)", Boolean(mBloc));
  if (mBloc) {
    const fabrique = new Function(
      "prisma", "console", "rhAdresse", "destAttendu", "demande",
      "return (async () => {\n" + mBloc[0] +
      "\nreturn { emailActifDecision, avecPdfDecision, ccDecision };\n})();"
    );
    const refDemo = { reference: "DEM-2026-0193" };
    // a — maître OFF + manager OFF → avecPdf tous false ; ccDecision COMPLET
    const prismaA = { reponsePdfConfig: { findUnique: async () => ({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: false }) } };
    const rA = await fabrique(prismaA, { log: () => {}, warn: () => {} }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("maître OFF + manager OFF → avecPdf { employe:false, rh:false, manager:false }",
      rA.avecPdfDecision && rA.avecPdfDecision.employe === false && rA.avecPdfDecision.rh === false && rA.avecPdfDecision.manager === false);
    check("maître OFF + manager OFF → ccDecision RESTE [RH, manager] (notification toujours)",
      JSON.stringify(rA.ccDecision) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));

    // b — tous ON → avecPdf tous true + ccDecision historique
    const rB = await fabrique({ reponsePdfConfig: { findUnique: async () => null } }, { log: () => {}, warn: () => {} }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("config absente → avecPdf tous true (défauts)",
      rB.avecPdfDecision.employe === true && rB.avecPdfDecision.rh === true && rB.avecPdfDecision.manager === true);
    check("config absente → ccDecision [RH, manager] (historique)",
      JSON.stringify(rB.ccDecision) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]));

    // c — client Prisma ancien → avertissement + défauts ON
    const warns = [];
    const rC = await fabrique({}, { log: () => {}, warn: (w) => warns.push(String(w)) }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("client Prisma ancien → défauts ON (jamais bloquant)",
      rC.avecPdfDecision.employe === true && rC.avecPdfDecision.manager === true);
    check("client Prisma ancien → UN avertissement explicite",
      warns.length === 1 && /ReponsePdfConfig/.test(warns[0]));

    // d — RH OFF seul → avecPdf.rh=false mais ccDecision CONTIENT le RH
    const rD = await fabrique(
      { reponsePdfConfig: { findUnique: async () => ({ emailActif: true, envoyerEmploye: true, envoyerRh: false, envoyerManager: true }) } },
      { log: () => {}, warn: () => {} }, "rh@entreprise.tn", "manager.n1@entreprise.tn", refDemo);
    check("RH OFF → avecPdf.rh=false MAIS ccDecision contient le RH (notification toujours)",
      rD.avecPdfDecision.rh === false && rD.ccDecision.indexOf("rh@entreprise.tn") >= 0);
  }

  // 3.3 — fonction envoyerEmailDecisionConge RÉELLE (transport SMTP simulé)
  const i0 = src.indexOf("async function envoyerEmailDecisionConge");
  const i1 = src.indexOf("\n}\n", i0);
  check("fonction envoyerEmailDecisionConge extractible", i0 > 0 && i1 > i0);
  if (i0 > 0 && i1 > i0) {
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
      { createTransport: () => ({ sendMail: async (msg) => { envois.push(msg); return { messageId: "mid-" + envois.length, response: "250 OK" }; } }) },
      (cfg) => "auto-rh@entreprise.tn",
      (s) => s,
      (t) => ({ CONGE: "Demande de congé" }[t] || t),
      (c) => c,
      (v) => v,
      (n) => (n / 1024).toFixed(1) + " Ko",
      async () => "Employé Test",
    );
    const demande = {
      reference: "DEM-2026-0193",
      type: "CONGE",
      employeEmail: "employe.test@entreprise.tn",
      donnees: JSON.stringify({ prenom: "Employé", nom: "Test" }),
      cin: "12345678",
    };
    const cfgMail = { host: "smtp.test.tn", port: 587 };
    const pj = { filename: "DEM-2026-0193-SIGNE.pdf", content: Buffer.from("%PDF-fictif"), contentType: "application/pdf" };
    const APJ = (m) => m && Array.isArray(m.attachments) && m.attachments.some((a) => a.contentType === "application/pdf");

    // L1 — tous ON + PDF → 1 envoi (employé, cc RH+manager, attachment)
    journaux.length = 0; envois.length = 0;
    let r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: true, rh: true, manager: true } });
    check("fonction réelle — tous ON : 1 envoi, À employé, Cc RH+manager, PDF joint",
      r.envoye && envois.length === 1 && envois[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) && APJ(envois[0]));

    // L2 — manager OFF + PDF → 2 envois : (employé/cc RH avec PDF) + (manager sans PDF)
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: true, rh: true, manager: false } });
    check("fonction réelle — manager OFF : 2 envois (notification toujours)",
      r.envoye && envois.length === 2);
    check("fonction réelle — manager OFF : envoi 1 À employé / Cc RH / AVEC PDF",
      envois[0] && envois[0].to === "employe.test@entreprise.tn" && JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn"]) && APJ(envois[0]));
    check("fonction réelle — manager OFF : envoi 2 À manager / SANS PDF",
      envois[1] && envois[1].to === "manager.n1@entreprise.tn" && !envois[1].attachments);
    check("fonction réelle — manager OFF : 2 journaux (reponsePdf true puis false)",
      journaux.length === 2 && journaux[0].reponsePdf === true && journaux[1].reponsePdf === false);

    // L3 — maître OFF (avecPdf tous false) + PDF → 1 envoi SANS PDF à tout le monde
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demande, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: false, rh: false, manager: false } });
    check("fonction réelle — maître OFF : 1 envoi À employé, Cc RH+manager, SANS PDF",
      r.envoye && envois.length === 1 && envois[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) && !envois[0].attachments);

    // L4 — REFUS (aucun PDF) : tout le monde reçoit LA notification (interrupteurs sans effet)
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demande, "REFUSEE", [], [], cfgMail, null,
      { pieceJointe: null, rh: "rh@entreprise.tn", manager: "manager.n1@entreprise.tn", avecPdf: { employe: true, rh: false, manager: false } });
    check("fonction réelle — refus sans PDF : 1 envoi à employé + Cc RH+manager (personne exclu)",
      r.envoye && envois.length === 1 && envois[0].to === "employe.test@entreprise.tn" &&
      JSON.stringify(envois[0].cc) === JSON.stringify(["rh@entreprise.tn", "manager.n1@entreprise.tn"]) && !envois[0].attachments);

    // L5 — aucune adresse connue → AUCUN_DESTINATAIRE (jamais bloquant)
    journaux.length = 0; envois.length = 0;
    const demandeSansMail = Object.assign({}, demande, { employeEmail: null });
    r = await envoyerEmailDecisionConge(demandeSansMail, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj, rh: "", manager: "", avecPdf: { employe: true, rh: true, manager: true } });
    check("fonction réelle — aucune adresse connue → AUCUN envoi + journal AUCUN_DESTINATAIRE",
      !r.envoye && envois.length === 0 && journaux.length === 1 && journaux[0].code === "AUCUN_DESTINATAIRE");

    // L6 — employé sans adresse MAIS copies connues → notification aux copies
    journaux.length = 0; envois.length = 0;
    r = await envoyerEmailDecisionConge(demandeSansMail, "ACCEPTEE", [], [], cfgMail, null,
      { pieceJointe: pj, rh: "rh@entreprise.tn", manager: "", avecPdf: { employe: true, rh: true, manager: true } });
    check("fonction réelle — employé sans adresse : notification part QUAND MÊME aux copies (RH promu « À », PDF joint)",
      r.envoye && envois.length === 1 && envois[0].to === "rh@entreprise.tn" && APJ(envois[0]));
  }
}

/* ------------------------------------------------------------------ */
/* Partie 4 — panneau (sémantique visible)                             */
/* ------------------------------------------------------------------ */
async function partie4_panneau() {
  section("4. Panneau — descriptions mises à jour (notifications toujours, PDF seulement)");
  const src = fs.readFileSync(PANEL, "utf8");
  check("maître : « e-mails de notification d'acceptation / de refus sont TOUJOURS envoyés »",
    src.indexOf("sont TOUJOURS envoyés") > 0);
  check("maître : « Désactivé, les notifications partent SANS le PDF »",
    src.indexOf("les notifications partent SANS le PDF") > 0);
  check("note : « ne retirent PLUS personne des e-mails de décision »",
    src.indexOf("ne retirent PLUS personne des e-mails de décision") > 0);
  check("note : « mais SANS la réponse PDF en pièce jointe »",
    src.indexOf("mais SANS la réponse PDF en pièce jointe") > 0);
}

/* ========================================================================== */
(async () => {
  console.log("=== TEST v0.2.193 — notifications TOUJOURS envoyées, interrupteurs = réponse PDF seulement ===");
  snapshot = await prismaReel.reponsePdfConfig.findUnique({ where: LIGNE });
  try {
    await partie1_acceptation();
    await partie2_refus();
    await partie3_portail();
    await partie4_panneau();
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
