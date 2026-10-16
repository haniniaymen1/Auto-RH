#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E RÉEL v0.2.168 — SCÉNARIOS B2 + B3 (avant-plan, logs synchrones)
 *
 *   B2 — manager (Zoho) accepte D'ABORD, puis le RH (Gmail) → ACCEPTEE + PDF
 *        signé livré dans la boîte employé (Zoho).
 *   B3 — manager (Zoho) REFUSE avant le RH → REFUSEE IMMÉDIATE + PDF de refus
 *        livré ; la réponse TARDIVE du RH est ignorée (refus définitif).
 *
 * B1 (RH d'abord, puis manager) a été validé séparément :
 *   - decisionRh=ACCEPTEE 21:29:40, decisionManager=ACCEPTEE 21:29:59,
 *     statut final ACCEPTEE, doc=Acceptation_conge_DEM-2026-15001.pdf ;
 *   - e-mail de décision reçu dans Zoho 21:29:55 avec PDF %PDF authentique.
 *
 * Journalisation : fs.writeSync(1, …) — SYNCHRONE, survit aux tuages.
 * Nettoyage préalable : réponses de test résiduelles NON LUES dans INBOX
 * (recherche par UIDs récents + enveloppe — les recherches Gmail par sujet
 * échouent sur les sujets accentués).
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
const CIN_TEST = "TS168REEL1";
const REF_B2 = "DEM-2026-15002";
const REF_B3 = "DEM-2026-15003";

let ok = 0, fail = 0;
function log(s) { try { fs.writeSync(1, s + "\n"); } catch (_) { /* stdout fermé */ } }
function check(nom, cond, detail) {
  if (cond) { ok++; log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; log("  FAIL " + nom + (detail ? " — " + detail : "")); }
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
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [ENVOI RH Gmail] " + reference + " → " + info.messageId);
}
async function reponseManager(reference, messageIdEnvoi, texte) {
  const t = smtpZoho();
  const info = await t.sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [ENVOI manager Zoho] " + reference + " → " + info.messageId);
}

async function attendreStatut(reference, predicateur, delaiMs) {
  const fin = Date.now() + (delaiMs || 90000);
  let derniere = null;
  while (Date.now() < fin) {
    await sleep(5000);
    derniere = await db.demandeAdministrative.findFirst({ where: { reference } });
    if (derniere && predicateur(derniere)) return derniere;
    log("      …attente " + reference + " : statut=" + (derniere && derniere.statut) + " mgr=" + (derniere && derniere.decisionManager) + " rh=" + (derniere && derniere.decisionRh));
  }
  return derniere;
}

async function verifierLivraisonZoho(sujetContient, depuisMinutes) {
  for (let tentative = 1; tentative <= 2; tentative++) {
    try {
      const client = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false });
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      let trouve = null;
      try {
        const uids = await client.search({ since: new Date(Date.now() - (depuisMinutes || 30) * 60000) });
        const cibles = (uids || []).slice(-25).reverse();
        for (const uid of cibles) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          const sujet = String(msg.envelope.subject || "");
          if (sujet.indexOf(sujetContient) >= 0) {
            const parsed = await simpleParser(msg.source);
            const pj = (parsed.attachments || []).find((a) => (a.contentType || "").indexOf("pdf") >= 0);
            trouve = { sujet, de: parsed.from && parsed.from.text, cc: parsed.cc && parsed.cc.text, pjNom: pj ? pj.filename : null, pjOk: pj ? pj.content.subarray(0, 4).toString() === "%PDF" : false, pjTaille: pj ? pj.content.length : 0 };
            break;
          }
        }
      } finally { lock.release(); await client.logout().catch(() => {}); }
      return trouve;
    } catch (e) {
      log("      (vérif Zoho tentative " + tentative + " échouée : " + e.message.slice(0, 80) + ")");
      if (tentative === 2) return null;
      await sleep(8000);
    }
  }
  return null;
}

/** Supprime de INBOX (derniers UIDs) les réponses de test résiduelles. */
async function nettoyerInbox() {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let nettoyes = 0;
  try {
    const statut = await client.status("INBOX", { messages: true, uidNext: true });
    const dernier = statut.uidNext - 1;
    const debut = Math.max(1, dernier - 60);
    for (let uid = debut; uid <= dernier; uid++) {
      const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      const sujet = String(msg.envelope.subject || "");
      if (sujet.indexOf("DEM-2026-1500") >= 0) {
        await client.messageDelete(uid, { uid: true });
        nettoyes++;
      }
    }
  } finally { lock.release(); await client.logout().catch(() => {}); }
  log("  Nettoyage INBOX : " + nettoyes + " message(s) de test supprimé(s)");
}

async function creerDemande(reference, type) {
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2027-02-01", dateFin: "2027-02-10", commentaire: "Test réel v0.2.168 B3" }
    : { nom: "Employé Test Réel", date: "2027-02-03", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  return db.demandeAdministrative.create({
    data: {
      reference, type, statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: (type === "CONGE" ? "reel168c-" : "reel168d-") + Date.now() + "@auto-rh.test",
    },
  });
}

async function main() {
  log("== TEST E2E RÉEL v0.2.168 — B2 + B3 (avant-plan) ==");
  log("== " + new Date().toISOString() + " — démarrage ==");

  await nettoyerInbox();

  /* ================= B2 — manager d'abord, puis RH (autorisation) ======= */
  log("\n— B2 : manager répond d'abord, puis le RH (autorisation de sortie) —");
  const d2 = await creerDemande(REF_B2, "AUTORISATION_SORTIE");
  log("  Demande " + d2.reference + " créée (EN_ATTENTE, msgId=" + d2.messageIdEnvoi + ")");
  await reponseManager(d2.reference, d2.messageIdEnvoi, "J'accepte cette sortie.");
  const apresMgr2 = await attendreStatut(d2.reference, (d) => d.decisionManager === "ACCEPTEE", 100000);
  check("B2 · réponse manager détectée par le poller IMAP", Boolean(apresMgr2 && apresMgr2.decisionManager === "ACCEPTEE"), apresMgr2 ? "decisionManager=" + apresMgr2.decisionManager : "délai dépassé");
  check("B2 · statut EN_ATTENTE (validation RH encore requise)", apresMgr2 && apresMgr2.statut === "EN_ATTENTE", apresMgr2 ? "statut=" + apresMgr2.statut : "");

  await reponseRh(d2.reference, d2.messageIdEnvoi, "Je valide.");
  const apresRh2 = await attendreStatut(d2.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 100000);
  check("B2 · réponse RH détectée → statut FINAL ACCEPTEE", Boolean(apresRh2 && apresRh2.statut === "ACCEPTEE"), apresRh2 ? "statut=" + apresRh2.statut + " rh=" + apresRh2.decisionRh : "délai dépassé");
  check("B2 · document signé généré (docSigneChemin)", Boolean(apresRh2 && apresRh2.docSigneChemin), apresRh2 ? apresRh2.docSigneNom : "");
  const livr2 = await verifierLivraisonZoho("acceptée : " + REF_B2, 30);
  check("B2 · réponse automatique reçue dans la boîte employé (Zoho)", Boolean(livr2), livr2 ? "de=" + livr2.de : "non reçue");
  if (livr2) {
    check("B2 · PDF signé en pièce jointe (%PDF authentique)", livr2.pjOk && livr2.pjTaille > 2048, livr2.pjNom + " (" + livr2.pjTaille + " o)");
  }

  /* ================= B3 — manager refuse avant le RH (congé) ============ */
  log("\n— B3 : le manager refuse avant le RH (congé) —");
  const d3 = await creerDemande(REF_B3, "CONGE");
  log("  Demande " + d3.reference + " créée (EN_ATTENTE, msgId=" + d3.messageIdEnvoi + ")");
  await reponseManager(d3.reference, d3.messageIdEnvoi, "Je refuse, période chargée.");
  const apresMgr3 = await attendreStatut(d3.reference, (d) => d.statut === "REFUSEE", 100000);
  check("B3 · REFUS IMMÉDIAT (sans attendre le RH)", Boolean(apresMgr3 && apresMgr3.statut === "REFUSEE"), apresMgr3 ? "statut=" + apresMgr3.statut : "délai dépassé");
  check("B3 · refuseePar = MANAGER", apresMgr3 && apresMgr3.refuseePar === "MANAGER", "refuseePar=" + (apresMgr3 && apresMgr3.refuseePar));
  check("B3 · décision RH absente (pas encore répondue)", apresMgr3 && !apresMgr3.decisionRh, "");
  check("B3 · document de refus signé généré (docRefusChemin)", Boolean(apresMgr3 && apresMgr3.docRefusChemin), apresMgr3 ? apresMgr3.docRefusNom : "");
  const livr3 = await verifierLivraisonZoho("refusée : " + REF_B3, 30);
  check("B3 · réponse de refus reçue dans la boîte employé (Zoho)", Boolean(livr3), livr3 ? "de=" + livr3.de : "non reçue");
  if (livr3) {
    check("B3 · PDF de refus en pièce jointe (%PDF authentique)", livr3.pjOk && livr3.pjTaille > 2048, livr3.pjNom + " (" + livr3.pjTaille + " o)");
  }

  log("  … envoi de la réponse TARDIVE du RH (doit être ignorée) …");
  await reponseRh(d3.reference, d3.messageIdEnvoi, "Acceptée finalement.");
  await sleep(50000); // 3 cycles complets du poller (15 s)
  const apresRh3 = await db.demandeAdministrative.findFirst({ where: { reference: d3.reference } });
  check("B3 · réponse tardive du RH ignorée (refus définitif maintenu)", apresRh3 && apresRh3.statut === "REFUSEE" && !apresRh3.decisionRh, "statut=" + (apresRh3 && apresRh3.statut) + " rh=" + (apresRh3 && apresRh3.decisionRh));

  log("\n========================================");
  log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  log("  " + new Date().toISOString() + " — fin");
  log("========================================");
  process.exitCode = fail ? 1 : 0;
  await db.$disconnect();
}

main().catch((e) => { log("ERREUR FATALE : " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join(" | ") : e)); process.exitCode = 1; });
