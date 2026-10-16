#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E RÉEL v0.2.168 — VALIDATION DOUBLE VIA GMAIL + ZOHO (boucle complète)
 *
 *   Boîte système/RH : employe.test@autorh.tn  (SMTP 465 + IMAP 993, poller
 *                      15 s du portail — réception RÉELLE des réponses)
 *   Boîte manager    : rh3000@zohomail.com     (smtp.zoho.com:465 — les
 *                      réponses du manager PARTENT RÉELLEMENT de Zoho)
 *   Employé          : rh3000@zohomail.com     (les réponses automatiques de
 *                      décision + PDF signé arrivent dans la boîte Zoho, où
 *                      elles sont vérifiées par IMAP : pièce jointe PDF %PDF)
 *
 * SCÉNARIO B1 — RH (Gmail) accepte D'ABORD, puis le manager (Zoho) → ACCEPTEE
 *               + PDF signé livré (le statut manager passe à ACCEPTEE : bug
 *               corrigé).
 * SCÉNARIO B2 — manager (Zoho) accepte D'ABORD, puis le RH (Gmail) → ACCEPTEE
 *               + PDF signé livré.
 * SCÉNARIO B3 — le manager (Zoho) REFUSE avant le RH → REFUSEE immédiate +
 *               PDF de refus livré ; la réponse tardive du RH est ignorée.
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };
const PORTAIL = "http://127.0.0.1:4001";
const CIN_TEST = "TS168REEL1";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function smtpGmail() {
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } });
}
function smtpZoho() {
  return nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } });
}

async function reponseRh(reference, messageIdEnvoi, texte) {
  const t = smtpGmail();
  const info = await t.sendMail({
    from: GMAIL.user,
    to: GMAIL.user, // auto-adressée — comme le RH réel qui répond depuis la boîte du système
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte,
    inReplyTo: "<" + messageIdEnvoi + ">",
    references: "<" + messageIdEnvoi + ">",
  });
  console.log("    [ENVOI RH Gmail] " + reference + " → messageId=" + info.messageId);
  return info;
}
async function reponseManager(reference, messageIdEnvoi, texte) {
  const t = smtpZoho();
  const info = await t.sendMail({
    from: ZOHO.user,
    to: GMAIL.user, // la demande était adressée au manager — il répond au système
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte,
    inReplyTo: "<" + messageIdEnvoi + ">",
    references: "<" + messageIdEnvoi + ">",
  });
  console.log("    [ENVOI manager Zoho] " + reference + " → messageId=" + info.messageId);
  return info;
}

/** Attend que la demande atteigne l'état attendu (poller IMAP 15 s côté portail). */
async function attendreStatut(reference, predicateur, delaiMs) {
  const fin = Date.now() + (delaiMs || 120000);
  let derniere = null;
  while (Date.now() < fin) {
    await sleep(5000);
    derniere = await db.demandeAdministrative.findFirst({ where: { reference } });
    if (derniere && predicateur(derniere)) return derniere;
  }
  return derniere;
}

/** Vérifie la boîte ZOHO : le dernier e-mail de décision (sujet) a-t-il un PDF ? */
async function verifierLivraisonZoho(sujetContient, depuisMinutes) {
  const client = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let trouve = null;
  try {
    const since = new Date(Date.now() - (depuisMinutes || 30) * 60000);
    const uids = await client.search({ since });
    const cibles = (uids || []).slice(-25).reverse(); // plus récents d'abord
    for (const uid of cibles) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      const sujet = String((msg.envelope.subject || ""));
      if (sujet.indexOf(sujetContient) >= 0) {
        const parsed = await simpleParser(msg.source);
        const pj = (parsed.attachments || []).find((a) => (a.contentType || "").indexOf("pdf") >= 0);
        trouve = { sujet, de: parsed.from && parsed.from.text, cc: parsed.cc && parsed.cc.text, pjNom: pj ? pj.filename : null, pjOk: pj ? pj.content.subarray(0, 4).toString() === "%PDF" : false, pjTaille: pj ? pj.content.length : 0 };
        break;
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return trouve;
}

async function creerDemande(reference, messageId, type) {
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2027-01-11", dateFin: "2027-01-22", commentaire: "Test réel v0.2.168" }
    : { nom: "Employé Test Réel", date: "2027-01-13", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  return db.demandeAdministrative.create({
    data: {
      reference,
      type,
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user), // manager = Zoho
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user), // employé = Zoho (vérification de réception)
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: messageId,
    },
  });
}

async function main() {
  console.log("== TEST E2E RÉEL v0.2.168 — GMAIL (RH/système) + ZOHO (manager) ==");

  // ---- 0) configuration mail RÉELLE dans la DB de test ----
  await db.mailConfig.upsert({
    where: { id: "smtp" },
    create: {
      id: "smtp",
      host: "smtp.gmail.com", port: 465,
      username: cryptoBd.chiffrerChamp(GMAIL.user),
      password: cryptoBd.chiffrerChamp(GMAIL.pass),
      from: "Auto-RH <" + GMAIL.user + ">",
      rhEmail: GMAIL.user,
      imapActif: true, imapHost: "imap.gmail.com", imapPort: 993,
      imapUser: cryptoBd.chiffrerChamp(GMAIL.user),
      imapPassword: cryptoBd.chiffrerChamp(GMAIL.pass),
    },
    update: {
      host: "smtp.gmail.com", port: 465,
      username: cryptoBd.chiffrerChamp(GMAIL.user),
      password: cryptoBd.chiffrerChamp(GMAIL.pass),
      from: "Auto-RH <" + GMAIL.user + ">",
      rhEmail: GMAIL.user,
      imapActif: true, imapHost: "imap.gmail.com", imapPort: 993,
      imapUser: cryptoBd.chiffrerChamp(GMAIL.user),
      imapPassword: cryptoBd.chiffrerChamp(GMAIL.pass),
    },
  });
  console.log("Config mail réelle : Gmail SMTP 465 + IMAP 993 (rhEmail = " + GMAIL.user + ")");
  console.log("⚠ Le portail 4001 doit être DÉMARRÉ (poller IMAP 15 s actif).\n");

  /* ======================================================================
   * B1 — RH d'abord, puis le manager (congé)
   * ==================================================================== */
  console.log("— B1 : RH répond d'abord, puis le manager (congé) —");
  const d1 = await creerDemande("DEM-2026-15001", "reel168-a-" + Date.now() + "@auto-rh.test", "CONGE");
  await reponseRh(d1.reference, d1.messageIdEnvoi, "Acceptée");
  const apresRh1 = await attendreStatut(d1.reference, (d) => d.decisionRh === "ACCEPTEE", 150000);
  check("B1 · réponse RH détectée par le poller IMAP", Boolean(apresRh1 && apresRh1.decisionRh === "ACCEPTEE"), apresRh1 ? "decisionRh=" + apresRh1.decisionRh : "délai dépassé");
  check("B1 · statut EN_ATTENTE (les 2 acceptations requises)", apresRh1 && apresRh1.statut === "EN_ATTENTE", apresRh1 ? "statut=" + apresRh1.statut : "");
  check("B1 · décision manager pas encore présente", apresRh1 && !apresRh1.decisionManager, "");

  await reponseManager(d1.reference, d1.messageIdEnvoi, "OK pour moi, bon congé.");
  const apresMgr1 = await attendreStatut(d1.reference, (d) => d.statut === "ACCEPTEE" && d.decisionManager === "ACCEPTEE", 150000);
  check("B1 · réponse MANAGER prise en compte (bug corrigé)", Boolean(apresMgr1 && apresMgr1.decisionManager === "ACCEPTEE"), apresMgr1 ? "decisionManager=" + apresMgr1.decisionManager : "délai dépassé");
  check("B1 · statut FINAL ACCEPTEE", apresMgr1 && apresMgr1.statut === "ACCEPTEE", apresMgr1 ? "statut=" + apresMgr1.statut : "");
  check("B1 · document signé généré (docSigneChemin)", Boolean(apresMgr1 && apresMgr1.docSigneChemin), apresMgr1 ? apresMgr1.docSigneNom : "");
  const livr1 = await verifierLivraisonZoho("acceptée : DEM-2026-15001", 40);
  check("B1 · réponse automatique reçue dans la boîte employé (Zoho)", Boolean(livr1), livr1 ? "de=" + livr1.de : "non reçue");
  if (livr1) {
    check("B1 · PDF signé en pièce jointe (authentique %PDF)", livr1.pjOk && livr1.pjTaille > 2048, livr1.pjNom + " (" + livr1.pjTaille + " o)");
    check("B1 · CC au manager/RH présent", Boolean(livr1.cc), livr1.cc || "");
  }

  /* ======================================================================
   * B2 — manager d'abord, puis le RH (autorisation de sortie)
   * ==================================================================== */
  console.log("\n— B2 : manager répond d'abord, puis le RH (autorisation de sortie) —");
  const d2 = await creerDemande("DEM-2026-15002", "reel168-b-" + Date.now() + "@auto-rh.test", "AUTORISATION_SORTIE");
  await reponseManager(d2.reference, d2.messageIdEnvoi, "J'accepte cette sortie.");
  const apresMgr2 = await attendreStatut(d2.reference, (d) => d.decisionManager === "ACCEPTEE", 150000);
  check("B2 · réponse manager détectée (IMAP)", Boolean(apresMgr2 && apresMgr2.decisionManager === "ACCEPTEE"), apresMgr2 ? "decisionManager=" + apresMgr2.decisionManager : "délai dépassé");
  check("B2 · statut EN_ATTENTE (validation RH requise)", apresMgr2 && apresMgr2.statut === "EN_ATTENTE", apresMgr2 ? "statut=" + apresMgr2.statut : "");

  await reponseRh(d2.reference, d2.messageIdEnvoi, "Je valide.");
  const apresRh2 = await attendreStatut(d2.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 150000);
  check("B2 · réponse RH détectée → FINAL ACCEPTEE", Boolean(apresRh2 && apresRh2.statut === "ACCEPTEE"), apresRh2 ? "statut=" + apresRh2.statut : "");
  check("B2 · document signé généré", Boolean(apresRh2 && apresRh2.docSigneChemin), apresRh2 ? apresRh2.docSigneNom : "");
  const livr2 = await verifierLivraisonZoho("acceptée : DEM-2026-15002", 40);
  check("B2 · réponse automatique reçue (Zoho)", Boolean(livr2), livr2 ? "de=" + livr2.de : "non reçue");
  if (livr2) {
    check("B2 · PDF signé en pièce jointe", livr2.pjOk && livr2.pjTaille > 2048, livr2.pjNom + " (" + livr2.pjTaille + " o)");
  }

  /* ======================================================================
   * B3 — le manager refuse avant le RH (congé)
   * ==================================================================== */
  console.log("\n— B3 : le manager refuse avant le RH (congé) —");
  const d3 = await creerDemande("DEM-2026-15003", "reel168-c-" + Date.now() + "@auto-rh.test", "CONGE");
  await reponseManager(d3.reference, d3.messageIdEnvoi, "Je refuse, période chargée.");
  const apresMgr3 = await attendreStatut(d3.reference, (d) => d.statut === "REFUSEE", 150000);
  check("B3 · REFUS IMMÉDIAT (sans attendre le RH)", Boolean(apresMgr3 && apresMgr3.statut === "REFUSEE"), apresMgr3 ? "statut=" + apresMgr3.statut : "");
  check("B3 · refuseePar = MANAGER", apresMgr3 && apresMgr3.refuseePar === "MANAGER", "refuseePar=" + (apresMgr3 && apresMgr3.refuseePar));
  check("B3 · document de refus signé généré", Boolean(apresMgr3 && apresMgr3.docRefusChemin), apresMgr3 ? apresMgr3.docRefusNom : "");
  const livr3 = await verifierLivraisonZoho("refusée : DEM-2026-15003", 40);
  check("B3 · réponse de refus reçue (Zoho)", Boolean(livr3), livr3 ? "de=" + livr3.de : "non reçue");
  if (livr3) {
    check("B3 · PDF de refus en pièce jointe", livr3.pjOk && livr3.pjTaille > 2048, livr3.pjNom + " (" + livr3.pjTaille + " o)");
  }

  await reponseRh(d3.reference, d3.messageIdEnvoi, "Acceptée finalement.");
  await sleep(40000); // deux cycles complets du poller
  const apresRh3 = await db.demandeAdministrative.findFirst({ where: { reference: d3.reference } });
  check("B3 · réponse tardive du RH ignorée (refus définitif)", apresRh3 && apresRh3.statut === "REFUSEE" && !apresRh3.decisionRh, "statut=" + (apresRh3 && apresRh3.statut));

  console.log("\n========================================");
  console.log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  console.log("========================================");
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE :", e); process.exit(1); });
