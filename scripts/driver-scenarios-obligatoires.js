#!/usr/bin/env node
/**
 * ============================================================================
 * PILOTE PAR PHASES — TESTS OBLIGATOIRES VALIDATION À DEUX ÉTAPES (v0.2.173)
 * ----------------------------------------------------------------------------
 * Règles testées (demande utilisateur) :
 *   R1  RH accepte + manager pas encore → AUCUN PDF de décision envoyé,
 *       demande reste « En attente » (decisionRh tracé).
 *   R2  Manager accepte + RH pas encore → AUCUN PDF, demande « En attente »,
 *       décision manager tracée ET transmise au service RH.
 *   R3  RH ET manager ont accepté → PDF signé électroniquement envoyé
 *       AUTOMATIQUEMENT à l'employé.
 *   R4  Refus (manager OU RH) → réponse de refus IMMÉDIATE avec PDF signé,
 *       sans attendre l'autre responsable (refuseePar tracé).
 *   R5  BUG CORRIGÉ : quand le RH répond en PREMIER, la réponse ULTÉRIEURE
 *       du manager est prise en compte (decisionManager enregistré, statut
 *       mis à jour) — son statut ne reste plus « En attente ».
 *
 * Scénarios (conditions réelles Gmail/Zoho, poller IMAP 10 s) :
 *   S1  DEM-2026-17301 CONGÉ                — RH accepte D'ABORD, puis manager
 *       accepte → PDF signé (R1+R3+R5).
 *   S2  DEM-2026-17302 CONGÉ                — manager accepte D'ABORD, puis RH
 *       accepte → PDF signé (R2+R3).
 *   S3a DEM-2026-17303 AUTORISATION_SORTIE  — manager REFUSE avant que le RH
 *       ait répondu → refus immédiat + PDF (R4).
 *   S3b DEM-2026-17304 AUTORISATION_SORTIE  — RH REFUSE avant que le manager
 *       ait répondu → refus immédiat + PDF (R4).
 *
 * Usage : node driver-scenarios-obligatoires.js <connectivite|s1-rh|
 *   s1-manager|verif-s1|s2-manager|s2-rh|verif-s2|s3a|verif-s3a|s3b|verif-s3b>
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// Le CŒUR de réception est requis SANS serveur HTTP (garde require.main) ;
// le pilote fait tourner son PROPRE poller avec la fonction exportée.
const portail = require("./portail-server.js");

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };
const CIN_TEST = "TS173SCEN173";
const REF = { s1: "DEM-2026-17301", s2: "DEM-2026-17302", s3a: "DEM-2026-17303", s3b: "DEM-2026-17304" };
const ETAT_PATH = "/tmp/scen-oblig-etat.json";
const PREUVES_DIR = "/home/z/my-project/download/rapport-test-scenarios";
const BUDGET_MS = 7.6 * 60 * 1000;   // chaque phase ≤ 7,6 min (marge sous le plafond outil)

const ETAT = fs.existsSync(ETAT_PATH)
  ? JSON.parse(fs.readFileSync(ETAT_PATH, "utf8"))
  : { horizon: {}, ok: 0, fail: 0, preuves: [] };

let ok = ETAT.ok, fail = ETAT.fail;
function log(s) { try { fs.writeSync(1, s + "\n"); } catch (_) {} }
function check(nom, cond, detail) {
  if (cond) { ok++; log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; log("  FAIL " + nom + (detail ? " — " : "") + (detail || "")); }
  ETAT.preuves.push({ phase: process.argv[2], nom, ok: !!cond, detail: String(detail || "") });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function h() { return new Date().toISOString().slice(11, 23); }
const debut = Date.now();
function resterDuBudget(ms) { return Date.now() + ms < debut + BUDGET_MS; }

function sauverEtat() {
  ETAT.ok = ok; ETAT.fail = fail;
  fs.writeFileSync(ETAT_PATH, JSON.stringify(ETAT, null, 2));
}

/* ------------------------------ clients --------------------------------- */
function smtpZoho() {
  return nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } });
}
function smtpGmail() {
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } });
}
function clientZoho() {
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false, connectionTimeout: 20000, greetingTimeout: 20000 });
  c.on("error", function () {});
  return c;
}

/* --------------------------- envoi des réponses -------------------------- */
async function reponseManager(reference, messageIdEnvoi, texte) {
  await smtpZoho().sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — " + (reference.endsWith("3") ? "Autorisation de sortie" : "Congé") + " " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [" + h() + " ENVOI manager Zoho] " + reference + " — " + texte.slice(0, 40));
}
async function reponseRh(reference, messageIdEnvoi, texte) {
  await smtpGmail().sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — " + (reference.endsWith("3") ? "Autorisation de sortie" : "Congé") + " " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [" + h() + " ENVOI RH Gmail] " + reference + " — " + texte.slice(0, 40));
}

/* ------------------------- création + attentes --------------------------- */
async function creerDemande(reference, type, tag) {
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2027-05-11", dateFin: "2027-05-20", commentaire: "Test scénarios obligatoires " + tag }
    : { nom: "Employé Test Scénarios", date: "2027-05-13", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  const d = await db.demandeAdministrative.create({
    data: {
      reference, type, statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: "scen-oblig-" + tag + "-" + Date.now() + "@auto-rh.test",
    },
  });
  log("  [" + h() + "] Demande " + reference + " (" + type + ") créée — EN_ATTENTE");
  return d;
}

async function attendreStatut(reference, predicateur, motif) {
  while (resterDuBudget(15000)) {
    await sleep(4000);
    const d = await db.demandeAdministrative.findFirst({ where: { reference } });
    log("      …attente " + motif + " : statut=" + (d && d.statut) + " mgr=" + (d && d.decisionManager) + " rh=" + (d && d.decisionRh));
    if (d && predicateur(d)) return d;
  }
  return await db.demandeAdministrative.findFirst({ where: { reference } });
}

/* ------- vérification de la boîte employé (Zoho) : décision PDF -------- */
async function chercherEmailDecision(reference, decide, horizonIso, exigerAbsent) {
  const sujetContient = (decide === "acceptee" ? "acceptée : " : "refusée : ") + reference;
  const depuis = new Date(new Date(horizonIso).getTime() - 3 * 60000);
  while (resterDuBudget(30000)) {
    try {
      const client = clientZoho();
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      let trouve = null;
      try {
        const uids = await client.search({ since: depuis });
        for (const uid of (uids || []).slice(-60).reverse()) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          if (String(msg.envelope.subject || "").indexOf(sujetContient) >= 0) {
            const parsed = await simpleParser(msg.source);
            try {
              fs.mkdirSync(PREUVES_DIR, { recursive: true });
              for (const piece of parsed.attachments || []) {
                fs.writeFileSync(PREUVES_DIR + "/" + reference.slice(-5) + "-" + piece.filename, piece.content);
              }
            } catch (e) { /* preuve non bloquante */ }
            trouve = { uid, sujet: String(msg.envelope.subject || ""), de: parsed.from && parsed.from.text, pieces: parsed.attachments || [] };
            break;
          }
        }
      } finally { lock.release(); await client.logout().catch(() => {}); }
      if (trouve) return trouve;
      if (exigerAbsent) return null;
    } catch (e) {
      log("      (vérif Zoho : " + e.message.slice(0, 80) + ")");
      if (exigerAbsent) return null;
    }
    if (exigerAbsent) return null;
    log("      …attente livraison Zoho (" + reference + ")");
    await sleep(20000);
  }
  return null;
}

/* ------------------------------- phases --------------------------------- */
const PHASES = {
  async connectivite() {
    log("\n— 0 · Connectivité Gmail SMTP+IMAP / Zoho SMTP+IMAP —");
    try { await smtpGmail().verify(); check("SMTP smtp.gmail.com:465 (boîte RH, réponse RH)", true, "verify() OK"); }
    catch (e) { check("SMTP smtp.gmail.com:465 (boîte RH, réponse RH)", false, e.message.slice(0, 90)); }
    try { await smtpZoho().verify(); check("SMTP smtp.zoho.com:465 (boîte manager/employé)", true, "verify() OK"); }
    catch (e) { check("SMTP smtp.zoho.com:465 (boîte manager/employé)", false, e.message.slice(0, 90)); }
    const cz = clientZoho();
    try {
      await cz.connect();
      const st = await cz.status("INBOX", { messages: true, uidNext: true });
      check("IMAP imap.zoho.com:993 (boîte employé — réception décisions)", true, st.messages + " messages");
    } catch (e) { check("IMAP imap.zoho.com:993 (boîte employé — réception décisions)", false, e.message.slice(0, 90)); }
    finally { await cz.logout().catch(() => {}); }
    try {
      const cfg = await db.mailConfig.findFirst({ where: { id: "smtp" } });
      check("Configuration IMAP de réception active (MailConfig)", Boolean(cfg && cfg.imapActif && cfg.imapHost),
        "imapHost=" + cfg.imapHost + " port=" + cfg.imapPort + " rhEmail=" + cfg.rhEmail);
    } catch (e) { check("Configuration IMAP de réception active (MailConfig)", false, e.message.slice(0, 80)); }
  },

  /* ===== S1 : RH répond EN PREMIER, puis le manager (R1+R3+R5) ===== */
  async "s1-rh"() {
    ETAT.memo = ETAT.memo || {};
    ETAT.memo.s1 = {};
    const d1 = await creerDemande(REF.s1, "CONGE", "s1");
    ETAT.memo.s1.messageIdEnvoi = d1.messageIdEnvoi;
    ETAT.horizon.s1debut = new Date().toISOString();
    // Le RH répond EN PREMIER : « Acceptée »
    await reponseRh(d1.reference, d1.messageIdEnvoi, "Acceptée");
    const apres = await attendreStatut(d1.reference, (d) => d.decisionRh === "ACCEPTEE", "S1/RH d'abord");
    check("S1 · réponse RH « Acceptée » détectée par le système", Boolean(apres && apres.decisionRh === "ACCEPTEE"),
      apres ? "decisionRh=" + apres.decisionRh : "délai dépassé");
    check("S1 · statut RESTE « En attente » tant que le manager n'a pas répondu (R1)",
      Boolean(apres && apres.statut === "EN_ATTENTE"), apres ? "statut=" + apres.statut : "");
    const com1 = apres && apres.commentaire ? apres.commentaire : "";
    check("S1 · traçabilité : commentaire indique l'attente du manager", com1.indexOf("en attente de la validation du manager") >= 0,
      JSON.stringify(com1.slice(0, 120)));
    // R1 : AUCUN e-mail de décision ne doit être arrivé chez l'employé
    const aucune = await chercherEmailDecision(REF.s1, "acceptee", ETAT.horizon.s1debut, true);
    check("S1 · AUCUN PDF de décision envoyé après la seule acceptation RH (R1)", aucune === null,
      aucune ? "e-mail TROUVÉ (anomalie) : " + aucune.sujet.slice(0, 60) : "aucun e-mail de décision dans la boîte employé");
  },

  async "s1-manager"() {
    // Le manager répond ENSUITE : « Acceptée » → la matrice s'achève (R3+R5)
    await reponseManager(REF.s1, ETAT.memo.s1.messageIdEnvoi, "Acceptée");
    const apres = await attendreStatut(REF.s1, (d) => d.statut === "ACCEPTEE" && d.decisionManager === "ACCEPTEE", "S1/manager ensuite");
    check("S1 · réponse manager ULTÉRIEURE prise en compte (BUG R5 corrigé)",
      Boolean(apres && apres.decisionManager === "ACCEPTEE"), apres ? "decisionManager=" + apres.decisionManager : "délai dépassé");
    check("S1 · décision FINALE « Acceptée » dès la réponse du manager (R3)",
      Boolean(apres && apres.statut === "ACCEPTEE"), apres ? "statut=" + apres.statut + " refuseePar=" + apres.refuseePar : "");
    if (apres && apres.statut === "ACCEPTEE") {
      const com1 = apres.commentaire || "";
      check("S1 · traçabilité : validation à deux étapes complète mentionnée", com1.indexOf("deux étapes") >= 0,
        JSON.stringify(com1.slice(0, 130)));
    }
    ETAT.horizon.s1 = new Date().toISOString();
    log("  horizon S1 (vérification livraison) : " + ETAT.horizon.s1);
    // Délai de grâce : laisser l'envoi SMTP de la notification se terminer
    // AVANT la sortie du processus (sinon l'e-mail part jamais — constat
    // 17304 : process.exit() tuait l'envoi en cours).
    log("  (délai de grâce 20 s pour l'envoi SMTP de la notification…)");
    await sleep(20000);
  },

  async "verif-s1"() {
    const livr = await chercherEmailDecision(REF.s1, "acceptee", ETAT.horizon.s1);
    check("S1 · e-mail de décision FINAL présent dans la boîte employé (Zoho)", Boolean(livr),
      livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
    if (!livr) return;
    const pieces = livr.pieces || [];
    check("S1 · EXACTEMENT 1 pièce jointe = le PDF de décision", pieces.length === 1,
      pieces.map(function (p) { return p.filename; }).join(", ") || "0 pièce");
    const pdf = pieces[0];
    if (pdf) {
      check("S1 · PDF « Acceptation_ » authentique (%PDF, non vide)", pdf.filename.indexOf("Acceptation_") === 0 && pdf.content.subarray(0, 4).toString() === "%PDF" && pdf.content.length > 1000,
        pdf.filename + " (" + pdf.content.length + " o)");
    }
  },

  /* ===== S2 : manager répond EN PREMIER, puis le RH (R2+R3) ===== */
  async "s2-manager"() {
    ETAT.memo.s2 = {};
    const d2 = await creerDemande(REF.s2, "CONGE", "s2");
    ETAT.memo.s2.messageIdEnvoi = d2.messageIdEnvoi;
    ETAT.horizon.s2debut = new Date().toISOString();
    await reponseManager(d2.reference, d2.messageIdEnvoi, "Acceptée");
    const apres = await attendreStatut(d2.reference, (d) => d.decisionManager === "ACCEPTEE", "S2/manager d'abord");
    check("S2 · réponse manager « Acceptée » détectée", Boolean(apres && apres.decisionManager === "ACCEPTEE"),
      apres ? "decisionManager=" + apres.decisionManager : "délai dépassé");
    check("S2 · statut RESTE « En attente » tant que le RH n'a pas répondu (R2)",
      Boolean(apres && apres.statut === "EN_ATTENTE"), apres ? "statut=" + apres.statut : "");
    const com2 = apres && apres.commentaire ? apres.commentaire : "";
    check("S2 · décision manager transmise au service RH (traçabilité)", com2.indexOf("transmise automatiquement au service RH") >= 0,
      JSON.stringify(com2.slice(0, 130)));
    const aucune = await chercherEmailDecision(REF.s2, "acceptee", ETAT.horizon.s2debut, true);
    check("S2 · AUCUN PDF de décision envoyé après la seule acceptation manager (R2)", aucune === null,
      aucune ? "e-mail TROUVÉ (anomalie) : " + aucune.sujet.slice(0, 60) : "aucun e-mail de décision dans la boîte employé");
  },

  async "s2-rh"() {
    await reponseRh(REF.s2, ETAT.memo.s2.messageIdEnvoi, "Acceptée");
    const apres = await attendreStatut(REF.s2, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", "S2/RH ensuite");
    check("S2 · réponse RH achève la matrice → « Acceptée » (R3)",
      Boolean(apres && apres.statut === "ACCEPTEE" && apres.decisionRh === "ACCEPTEE"),
      apres ? "statut=" + apres.statut + " decisionRh=" + apres.decisionRh : "délai dépassé");
    ETAT.horizon.s2 = new Date().toISOString();
    log("  horizon S2 : " + ETAT.horizon.s2);
    log("  (délai de grâce 20 s pour l'envoi SMTP de la notification…)");
    await sleep(20000);
  },

  async "verif-s2"() {
    const livr = await chercherEmailDecision(REF.s2, "acceptee", ETAT.horizon.s2);
    check("S2 · e-mail de décision FINAL présent dans la boîte employé (Zoho)", Boolean(livr),
      livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
    if (!livr) return;
    const pieces = livr.pieces || [];
    check("S2 · EXACTEMENT 1 pièce jointe = le PDF de décision", pieces.length === 1,
      pieces.map(function (p) { return p.filename; }).join(", ") || "0 pièce");
    const pdf = pieces[0];
    if (pdf) {
      check("S2 · PDF « Acceptation_ » authentique (%PDF, non vide)", pdf.filename.indexOf("Acceptation_") === 0 && pdf.content.subarray(0, 4).toString() === "%PDF" && pdf.content.length > 1000,
        pdf.filename + " (" + pdf.content.length + " o)");
    }
  },

  /* ===== S3a : le manager REFUSE avant que le RH ait répondu (R4) ===== */
  async "s3a"() {
    ETAT.memo.s3a = {};
    const d3 = await creerDemande(REF.s3a, "AUTORISATION_SORTIE", "s3a");
    ETAT.memo.s3a.messageIdEnvoi = d3.messageIdEnvoi;
    ETAT.horizon.s3a = new Date().toISOString();
    await reponseManager(d3.reference, d3.messageIdEnvoi, "Refusée");
    const apres = await attendreStatut(d3.reference, (d) => d.statut === "REFUSEE", "S3a/refus manager");
    check("S3a · REFUS manager détecté → REFUSEE IMMÉDIAT (sans attendre le RH, R4)",
      Boolean(apres && apres.statut === "REFUSEE"), apres ? "statut=" + apres.statut : "délai dépassé");
    check("S3a · refuseePar = MANAGER", Boolean(apres && apres.refuseePar === "MANAGER"),
      "refuseePar=" + (apres && apres.refuseePar));
    check("S3a · décision manager tracée (decisionManager=REFUSEE)",
      Boolean(apres && apres.decisionManager === "REFUSEE"), "decisionManager=" + (apres && apres.decisionManager));
    const com3 = apres && apres.commentaire ? apres.commentaire : "";
    check("S3a · traçabilité : refus immédiat et définitif mentionné", com3.indexOf("immédiate et définitive") >= 0,
      JSON.stringify(com3.slice(0, 120)));
    log("  (délai de grâce 20 s pour l'envoi SMTP de la notification de refus…)");
    await sleep(20000);
  },

  async "verif-s3a"() {
    const livr = await chercherEmailDecision(REF.s3a, "refusee", ETAT.horizon.s3a);
    check("S3a · e-mail de REFUS reçu IMMÉDIATEMENT dans la boîte employé (Zoho)", Boolean(livr),
      livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
    if (!livr) return;
    const pieces = livr.pieces || [];
    const pdf = pieces[0];
    if (pdf) {
      check("S3a · PDF de refus « Refus_ » authentique (%PDF)", pdf.filename.indexOf("Refus_") === 0 && pdf.content.subarray(0, 4).toString() === "%PDF",
        pdf.filename + " (" + pdf.content.length + " o)");
    } else {
      check("S3a · PDF de refus « Refus_ » authentique (%PDF)", false, "aucune pièce jointe");
    }
  },

  /* ===== S3b : le RH REFUSE avant que le manager ait répondu (R4) ===== */
  async "s3b"() {
    ETAT.memo.s3b = {};
    const d4 = await creerDemande(REF.s3b, "AUTORISATION_SORTIE", "s3b");
    ETAT.memo.s3b.messageIdEnvoi = d4.messageIdEnvoi;
    ETAT.horizon.s3b = new Date().toISOString();
    await reponseRh(d4.reference, d4.messageIdEnvoi, "Refusée");
    const apres = await attendreStatut(d4.reference, (d) => d.statut === "REFUSEE", "S3b/refus RH");
    check("S3b · REFUS RH détecté → REFUSEE IMMÉDIAT (sans attendre le manager, R4)",
      Boolean(apres && apres.statut === "REFUSEE"), apres ? "statut=" + apres.statut : "délai dépassé");
    check("S3b · refuseePar = RH", Boolean(apres && apres.refuseePar === "RH"),
      "refuseePar=" + (apres && apres.refuseePar));
    check("S3b · décision RH tracée (decisionRh=REFUSEE)",
      Boolean(apres && apres.decisionRh === "REFUSEE"), "decisionRh=" + (apres && apres.decisionRh));
    log("  (délai de grâce 20 s pour l'envoi SMTP de la notification de refus…)");
    await sleep(20000);
  },

  async "verif-s3b"() {
    const livr = await chercherEmailDecision(REF.s3b, "refusee", ETAT.horizon.s3b);
    check("S3b · e-mail de REFUS reçu IMMÉDIATEMENT dans la boîte employé (Zoho)", Boolean(livr),
      livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
    if (!livr) return;
    const pieces = livr.pieces || [];
    const pdf = pieces[0];
    if (pdf) {
      check("S3b · PDF de refus « Refus_ » authentique (%PDF)", pdf.filename.indexOf("Refus_") === 0 && pdf.content.subarray(0, 4).toString() === "%PDF",
        pdf.filename + " (" + pdf.content.length + " o)");
    } else {
      check("S3b · PDF de refus « Refus_ » authentique (%PDF)", false, "aucune pièce jointe");
    }
    // Nettoyage final des demandes de test (après toutes les vérifications)
    const refs = Object.values(REF);
    await db.demandeAdministrative.deleteMany({ where: { reference: { in: refs } } });
    log("  (nettoyage : " + refs.join(", ") + " supprimées de la base de test)");
  },
};

/* ------------------------------- main ------------------------------------ */
(async function main() {
  const phase = process.argv[2];
  log("== PHASE " + phase + " — " + new Date().toISOString() + " ==");
  if (!PHASES[phase]) { log("phase inconnue : " + phase); process.exit(2); }
  // Poller du pilote : le cœur de réception exporté scanne la boîte toutes les 10 s.
  const poller = setInterval(function () {
    portail.verifierBoiteDemandes().catch(function () {});
  }, 10 * 1000);
  try {
    await PHASES[phase]();
  } catch (e) {
    log("ERREUR PHASE : " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e));
    fail++;
  }
  sauverEtat();
  log("== PHASE " + phase + " terminée — cumul " + ok + " OK / " + fail + " FAIL ==");
  clearInterval(poller);
  try { await db.$disconnect(); } catch (_) {}
  process.exit(0);
})();
