#!/usr/bin/env node
/**
 * ============================================================================
 * TEST SCÉNARIO UTILISATEUR — v0.2.193 (preuve dédiée)
 * ============================================================================
 * Question utilisateur : « Est-ce que vous avez testé le scénario suivant :
 * lorsqu'un responsable RH et/ou un manager répond par e-mail à une demande de
 * congé ou d'autorisation en l'acceptant, alors que l'interrupteur du manager
 * est désactivé, est-ce que le manager reçoit quand même un e-mail de
 * notification contenant les pièces jointes ? »
 *
 * CE TEST REPRODUIT LE SCÉNARIO EXACT avec le code RÉEL du portail :
 *   1) les interrupteurs sont LUS dans la VRAIE base (ReponsePdfConfig :
 *      Envoi automatique=ON, Employé=ON, RH=ON, Manager=OFF) par le BLOC
 *      DÉCISIONNEL RÉEL extrait de traiterMessageRecu (avecPdfDecision +
 *      ccDecision) ;
 *   2) la FONCTION RÉELLE envoyerEmailDecisionConge est appelée avec les
 *      options EXACTES du site d'appel réel (pieceJointe = PDF signé,
 *      piecesReponses = pièces jointes fournies par le manager ET/OU le RH
 *      dans LEURS réponses e-mail, cc, rh, manager, avecPdf) ;
 *   3) assertions : le manager reçoit QUAND MÊME la notification, AVEC les
 *      pièces jointes des décideurs, SANS le PDF signé (l'interrupteur ne
 *      gouverne plus que la réponse PDF) ; l'employé et le RH reçoivent la
 *      notification AVEC le PDF.
 *
 * Scénarios couverts (le « et/ou » de la question) :
 *   S1 — congé : manager accepte (étape 1, pièce jointe) PUIS RH accepte
 *        (étape 2, pièce jointe) → décision finale. Manager OFF.
 *   S2 — autorisation de sortie : même chaîne, pièces du manager seules.
 *   S3 — RH accepte en premier, manager achève (matrice inverse). Manager OFF.
 *   S4 — demande adressée DIRECTEMENT au RH (aucun manager) : réponse RH
 *        seule = décision unique. Interrupteur manager OFF (sans objet).
 *   S5 — symétrique : interrupteur RH OFF (manager ON) → le RH reçoit quand
 *        même la notification (avec pièces, sans PDF).
 *   S6 — interrupteur MAÎTRE OFF + manager OFF : UN SEUL message à tout le
 *        monde, avec les pièces, SANS le PDF (personne n'est exclu).
 *   S7 — REFUS (congé) avec interrupteur manager OFF : aucun PDF n'existe →
 *        UN message à tous, AVEC les pièces (interrupteurs sans effet).
 *
 * Sortie : code 0 si TOUT est OK.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "portail-server.js");

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

/* ========================================================================== */
/* EXTRACTIONS RÉELLES du source du portail                                    */
/* ========================================================================== */
const src = fs.readFileSync(SRC, "utf8");

/* 1) BLOC DÉCISIONNEL RÉEL de traiterMessageRecu : lecture des interrupteurs
 *    (ReponsePdfConfig) → drapeaux avecPdfDecision + ccDecision historique. */
const mBloc = src.match(/let cfgReponsePdfDec = null;[\s\S]*?const ccDecision = \(function \(\) \{[\s\S]*?\}\)\(\);/);
if (!mBloc) {
  console.error("BLOC DÉCISIONNEL INTROUVABLE dans portail-server.js — test impossible.");
  process.exit(1);
}
const fabriqueBloc = new Function(
  "prisma", "console", "rhAdresse", "destAttendu", "demande",
  "return (async () => {\n" + mBloc[0] +
  "\nreturn { emailActifDecision, envoyerEmployeDecision, envoyerRhDecision, envoyerManagerDecision, avecPdfDecision, ccDecision };\n})();"
);

/* 2) FONCTION RÉELLE envoyerEmailDecisionConge (transport SMTP simulé). */
const i0 = src.indexOf("async function envoyerEmailDecisionConge");
const i1 = src.indexOf("\n}\n", i0);
if (i0 < 0 || i1 <= i0) {
  console.error("FONCTION envoyerEmailDecisionConge INTROUVABLE — test impossible.");
  process.exit(1);
}
const srcFn = src.slice(i0, i1 + 2);
function fabriqueFonction(envois, journaux) {
  const fabrique = new Function(
    "cryptoBd", "journaliserEnvoiDemandes", "nodemailerDemandes", "expediteurEffectifDemandes",
    "libelleStatutFinalDemande", "libelleTypeDemande", "masquerCinDemande", "echappeEmailDemande",
    "formaterTailleDocument", "nomEmployeDepuisFiches",
    srcFn + "\nreturn envoyerEmailDecisionConge;"
  );
  return fabrique(
    { dechiffrerChamp: (v) => v },
    (e) => journaux.push(e),
    { createTransport: () => ({ sendMail: async (msg) => { envois.push(msg); return { messageId: "mid-" + envois.length, response: "250 OK" }; } }) },
    () => "auto-rh@entreprise.tn",
    (s) => s,
    (t) => ({ CONGE: "Demande de congé", AUTORISATION_SORTIE: "Autorisation de sortie" }[t] || t),
    (c) => c,
    (v) => v,
    (n) => (n / 1024).toFixed(1) + " Ko",
    async () => "Employé Test",
  );
}

/* 3) SITE D'APPEL RÉEL : options EXACTES telles que construites par
 *    traiterMessageRecu (copie du code de la branche décision finale). */
async function appelReel(fn, demande, statutApres, formulations, importes, cfgMail,
  avecPdfDecision, ccDecision, rhAdresse, destAttendu, pjSignee, piecesReponsesEmploye) {
  return fn(
    demande, statutApres, formulations, importes, cfgMail, demande.refuseePar || null,
    {
      pieceJointe: pjSignee,
      piecesReponses: piecesReponsesEmploye,
      cc: ccDecision,
      rh: rhAdresse,
      manager: destAttendu && destAttendu !== rhAdresse ? destAttendu : "",
      avecPdf: avecPdfDecision,
      documentSigneNom: pjSignee ? pjSignee.filename : "",
    }
  );
}

/* ---------- helpers de scénario ---------- */
const EMPLOYE = "employe.test@entreprise.tn";
const RH = "rh@entreprise.tn";
const MANAGER = "manager.n1@entreprise.tn";
const CFG_MAIL = { host: "smtp.test.tn", port: 587 };

function demandeDemo(type, reference) {
  return {
    reference: reference,
    type: type,
    statut: "ACCEPTEE",
    employeEmail: EMPLOYE,
    destinataire: MANAGER,
    donnees: JSON.stringify({ prenom: "Employé", nom: "Test" }),
    cin: "12345678",
    refuseePar: null,
  };
}

const PJ_SIGNEE = (ref) => ({
  filename: ref.toLowerCase() + "-signe.pdf",
  content: Buffer.from("%PDF-1.4 fictif " + ref),
  contentType: "application/pdf",
});
const PJ_MANAGER = (nom) => ({ filename: nom, content: Buffer.from("piece manager " + nom), contentType: "application/pdf" });
const PJ_RH = (nom) => ({ filename: nom, content: Buffer.from("piece rh " + nom), contentType: "application/pdf" });

const A_PDF = (m) => m && Array.isArray(m.attachments) && m.attachments.some((a) => a.contentType === "application/pdf" && /-signe\.pdf$/i.test(a.filename));
const A_PIECE = (m, nom) => m && Array.isArray(m.attachments) && m.attachments.some((a) => a.filename === nom);

/* ---------- S1..S7 ---------- */
async function scenario(cfgInterrupteurs, opts) {
  /* cfgInterrupteurs : position ÉCRITE dans la VRAIE base pour ce scénario.
   * opts : { type, reference, rhAdresse, destAttendu, statutApres,
   *          pjSignee, pieces, formulations } */
  const o = opts || {};
  await ecrireLigne(cfgInterrupteurs);
  const bloc = await fabriqueBloc(
    prismaReel,                              // VRAIE base (ReponsePdfConfig)
    { log: () => {}, warn: () => {} },
    o.rhAdresse !== undefined ? o.rhAdresse : RH,
    o.destAttendu !== undefined ? o.destAttendu : MANAGER,
    { reference: o.reference || "DEM-SCENARIO" }
  );
  const envois = [];
  const journaux = [];
  const fn = fabriqueFonction(envois, journaux);
  const demande = demandeDemo(o.type || "CONGE", o.reference || "DEM-SCENARIO");
  const r = await appelReel(
    fn, demande, o.statutApres || "ACCEPTEE", o.formulations || [], [], CFG_MAIL,
    bloc.avecPdfDecision, bloc.ccDecision,
    o.rhAdresse !== undefined ? o.rhAdresse : RH,
    o.destAttendu !== undefined ? o.destAttendu : MANAGER,
    o.pjSignee || null, o.pieces || []
  );
  return { bloc, r, envois, journaux };
}

(async () => {
  console.log("=== SCÉNARIO UTILISATEUR — acceptation par réponse e-mail, interrupteur manager DÉSACTIVÉ : le manager reçoit-il quand même la notification AVEC les pièces jointes ? ===");
  snapshot = await prismaReel.reponsePdfConfig.findUnique({ where: LIGNE });

  try {
    /* Configuration de référence de la question : maître ON, employé ON,
     * RH ON, MANAGER OFF. */
    const CFG_MANAGER_OFF = { emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: false };

    /* ---------------- S1 — congé : manager (ét.1) PUIS RH (ét.2) ---------------- */
    section("S1 — CONGÉ : manager accepte (pièce) puis RH accepte (pièce) — Manager OFF");
    {
      const ref = "DEM-2026-0300";
      const s = await scenario(CFG_MANAGER_OFF, {
        type: "CONGE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_MANAGER("justificatif-manager.pdf"), PJ_RH("formulaire-rh.pdf")],
        formulations: ["J'accepte votre demande"],
      });
      check("S1 · interrupteurs LUS en base réelle : maître=ON, Employé=ON, RH=ON, Manager=OFF",
        s.bloc.emailActifDecision === true && s.bloc.avecPdfDecision.employe === true &&
        s.bloc.avecPdfDecision.rh === true && s.bloc.avecPdfDecision.manager === false);
      check("S1 · ccDecision HISTORIQUE = [RH, manager] (personne retiré)",
        JSON.stringify(s.bloc.ccDecision) === JSON.stringify([RH, MANAGER]));
      check("S1 · DEUX e-mails envoyés (notification toujours partielle par groupe PDF)",
        s.r.envoye === true && s.envois.length === 2);
      const m1 = s.envois[0], m2 = s.envois[1];
      check("S1 · message 1 : À employé, Cc RH, AVEC le PDF signé",
        m1 && m1.to === EMPLOYE && JSON.stringify(m1.cc) === JSON.stringify([RH]) && A_PDF(m1));
      check("S1 · message 1 : pièces des décideurs présentes (justificatif-manager + formulaire-rh)",
        A_PIECE(m1, "justificatif-manager.pdf") && A_PIECE(m1, "formulaire-rh.pdf"));
      check("S1 · LE MANAGER REÇOIT QUAND MÊME la notification (message 2 À manager.n1)",
        m2 && m2.to === MANAGER);
      check("S1 · la copie du manager CONTIENT LES PIÈCES JOINTES (justificatif-manager + formulaire-rh)",
        A_PIECE(m2, "justificatif-manager.pdf") && A_PIECE(m2, "formulaire-rh.pdf"));
      check("S1 · la copie du manager est SANS le PDF signé (interrupteur manager OFF → réponse PDF non jointe)",
        m2 && !A_PDF(m2));
      check("S1 · corps du message du manager : liste des pièces + « document officiel disponible dans Mes demandes »",
        m2 && m2.text.indexOf("justificatif-manager.pdf") >= 0 &&
        m2.text.indexOf("disponible dans la section « Mes demandes »") >= 0);
      check("S1 · objet identique pour les deux messages (même notification)",
        m1 && m2 && m1.subject === m2.subject);
      check("S1 · journaux : 2 envois, reponsePdf true (employé/RH) puis false (manager)",
        s.journaux.length === 2 && s.journaux[0].reponsePdf === true && s.journaux[1].reponsePdf === false &&
        s.journaux[1].dest === MANAGER);
    }

    /* ---------------- S2 — autorisation de sortie ---------------- */
    section("S2 — AUTORISATION DE SORTIE : mêmes réponses e-mail — Manager OFF");
    {
      const ref = "DEM-2026-0301";
      const s = await scenario(CFG_MANAGER_OFF, {
        type: "AUTORISATION_SORTIE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_MANAGER("ordre-mission-manager.pdf")],
      });
      check("S2 · DEUX e-mails : employé+RH (avec PDF) puis manager",
        s.r.envoye === true && s.envois.length === 2);
      const m2 = s.envois[1];
      check("S2 · le manager reçoit QUAND MÊME la notification de l'autorisation",
        m2 && m2.to === MANAGER && /Autorisation de sortie/.test(m2.subject));
      check("S2 · copie du manager AVEC la pièce du manager, SANS le PDF",
        A_PIECE(m2, "ordre-mission-manager.pdf") && !A_PDF(m2));
    }

    /* ---------------- S3 — RH d'abord, manager achève ---------------- */
    section("S3 — CONGÉ : RH accepte (ét.1) puis MANAGER achève la matrice — Manager OFF");
    {
      const ref = "DEM-2026-0302";
      const s = await scenario(CFG_MANAGER_OFF, {
        type: "CONGE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_RH("note-auto-rh.pdf"), PJ_MANAGER("planning-manager.pdf")],
      });
      check("S3 · le manager (qui a répondu en dernier) reçoit QUAND MÊME la notification",
        s.envois.length === 2 && s.envois[1].to === MANAGER);
      check("S3 · sa copie contient LES PIÈCES des DEUX décideurs (RH + manager), sans le PDF",
        A_PIECE(s.envois[1], "note-auto-rh.pdf") && A_PIECE(s.envois[1], "planning-manager.pdf") && !A_PDF(s.envois[1]));
      check("S3 · l'employé reçoit la notification AVEC le PDF signé",
        A_PDF(s.envois[0]) && s.envois[0].to === EMPLOYE);
    }

    /* ---------------- S4 — demande adressée directement au RH ---------------- */
    section("S4 — CONGÉ adressé DIRECTEMENT au RH (aucun manager) : réponse RH = décision unique — Manager OFF (sans objet)");
    {
      const ref = "DEM-2026-0303";
      const s = await scenario(CFG_MANAGER_OFF, {
        type: "CONGE", reference: ref,
        rhAdresse: RH, destAttendu: RH,          // même boîte : pas de manager
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_RH("certificat-rh.pdf")],
      });
      check("S4 · la notification part QUAND MÊME (l'interrupteur manager ne bloque RIEN)",
        s.r.envoye === true && s.envois.length >= 1);
      check("S4 · UN seul message (pas de boîte manager) : À employé, Cc RH, AVEC PDF + pièce RH",
        s.envois.length === 1 && s.envois[0].to === EMPLOYE &&
        JSON.stringify(s.envois[0].cc) === JSON.stringify([RH]) && A_PDF(s.envois[0]) &&
        A_PIECE(s.envois[0], "certificat-rh.pdf"));
    }

    /* ---------------- S5 — symétrique : RH OFF (manager ON) ---------------- */
    section("S5 — SYMÉTRIQUE : interrupteur RH désactivé (manager ON) — le RH reçoit quand même la notification");
    {
      const ref = "DEM-2026-0304";
      const s = await scenario({ emailActif: true, envoyerEmploye: true, envoyerRh: false, envoyerManager: true }, {
        type: "CONGE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_MANAGER("piece-manager.pdf")],
      });
      check("S5 · DEUX e-mails : employé+manager (avec PDF) puis RH",
        s.r.envoye === true && s.envois.length === 2);
      const m2 = s.envois[1];
      check("S5 · le RH reçoit QUAND MÊME sa copie : AVEC la pièce, SANS le PDF",
        m2 && m2.to === RH && A_PIECE(m2, "piece-manager.pdf") && !A_PDF(m2));
    }

    /* ---------------- S6 — maître OFF + manager OFF ---------------- */
    section("S6 — MAÎTRE OFF + manager OFF : UN SEUL message à tout le monde (pièces présentes, aucun PDF)");
    {
      const ref = "DEM-2026-0305";
      const s = await scenario({ emailActif: false, envoyerEmploye: true, envoyerRh: true, envoyerManager: false }, {
        type: "CONGE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_MANAGER("piece-manager.pdf"), PJ_RH("piece-rh.pdf")],
      });
      check("S6 · avecPdf tous false → UNE SEULE notification (personne exclu)",
        s.r.envoye === true && s.envois.length === 1);
      const m = s.envois[0];
      check("S6 · À employé, Cc RH + manager (copies historiques intactes)",
        m && m.to === EMPLOYE && JSON.stringify(m.cc) === JSON.stringify([RH, MANAGER]));
      check("S6 · AVEC les pièces des décideurs, SANS le PDF",
        A_PIECE(m, "piece-manager.pdf") && A_PIECE(m, "piece-rh.pdf") && !A_PDF(m));
    }

    /* ---------------- S7 — REFUS (aucun PDF) ---------------- */
    section("S7 — REFUS du congé (réponse e-mail manager) — Manager OFF : aucun PDF existe, tout le monde est notifié avec les pièces");
    {
      const ref = "DEM-2026-0306";
      const s = await scenario(CFG_MANAGER_OFF, {
        type: "CONGE", reference: ref,
        statutApres: "REFUSEE",
        pjSignee: null,                            // v0.2.188 : aucun PDF de refus
        pieces: [PJ_MANAGER("justificatif-manager.pdf")],
        formulations: ["Je refuse"],
      });
      check("S7 · UN SEUL message (aucun PDF → interrupteurs SANS effet)",
        s.r.envoye === true && s.envois.length === 1);
      const m = s.envois[0];
      check("S7 · À employé, Cc RH + manager — LE MANAGER REÇOIT le refus",
        m && m.to === EMPLOYE && JSON.stringify(m.cc) === JSON.stringify([RH, MANAGER]));
      check("S7 · message AVEC la pièce du manager (aucune pièce perdue), sans PDF",
        A_PIECE(m, "justificatif-manager.pdf") && !A_PDF(m));
      check("S7 · objet « refusée » et formulation reconnue mentionnée",
        /refusée/i.test(m.subject) && m.text.indexOf("Je refuse") >= 0);
    }

    /* ---------------- Non-régression rapide : tous ON ---------------- */
    section("S8 — CONTRÔLE : tous les interrupteurs ON → comportement historique (1 message, PDF pour tous)");
    {
      const ref = "DEM-2026-0307";
      const s = await scenario({ emailActif: true, envoyerEmploye: true, envoyerRh: true, envoyerManager: true }, {
        type: "CONGE", reference: ref,
        pjSignee: PJ_SIGNEE(ref),
        pieces: [PJ_MANAGER("piece-manager.pdf")],
      });
      check("S8 · UN message : À employé, Cc RH + manager, PDF + pièce présents",
        s.r.envoye === true && s.envois.length === 1 && s.envois[0].to === EMPLOYE &&
        JSON.stringify(s.envois[0].cc) === JSON.stringify([RH, MANAGER]) &&
        A_PDF(s.envois[0]) && A_PIECE(s.envois[0], "piece-manager.pdf"));
    }
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
