#!/usr/bin/env node
/**
 * ============================================================================
 * TEST FINAL — GMAIL SMTP + IMAP — WORKFLOW À DEUX NIVEAUX (v0.2.168)
 *
 *   0. Connectivité : SMTP smtp.gmail.com:465 (auth + vérification) et IMAP
 *      imap.gmail.com:993 (auth + INBOX + statut) — vérification EXPLICITE.
 *   B1. RH (Gmail) accepte D'ABORD, puis le manager (Zoho) → ACCEPTEE + PDF.
 *   B2. manager (Zoho) accepte D'ABORD, puis le RH (Gmail) → ACCEPTEE + PDF.
 *   B3. manager (Zoho) REFUSE avant le RH → REFUSEE immédiate + PDF de refus ;
 *       la réponse tardive du RH est ignorée.
 *
 *   Boîte système/RH  : employe.test@autorh.tn (SMTP 465 / IMAP 993, poller 15 s)
 *   Boîte manager     : rh3000@zohomail.com    (smtp.zoho.com:465)
 *   Boîte employé     : rh3000@zohomail.com    (vérification IMAP des livraisons)
 *
 * Journalisation SYNCHRONE (fs.writeSync) — survit aux interruptions.
 * Exécution AVANT-PLAN recommandée : node test-final-gmail-smtp-imap.js
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
const REF = { b1: "DEM-2026-15001", b2: "DEM-2026-15002", b3: "DEM-2026-15003" };

let ok = 0, fail = 0;
const preuves = [];
function log(s) { try { fs.writeSync(1, s + "\n"); } catch (_) {} }
function check(nom, cond, detail) {
  if (cond) { ok++; log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; log("  FAIL " + nom + (detail ? " — " + detail : "")); }
  preuves.push({ nom, ok: !!cond, detail: detail || "" });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function h() { return new Date().toISOString().slice(11, 23); }

function smtpGmail() {
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } });
}
function smtpZoho() {
  return nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } });
}

/* ============ 0. CONNECTIVITÉ EXPLICITE SMTP + IMAP GMAIL ============ */
async function testConnectivite() {
  log("\n— 0 · Connectivité Gmail SMTP + IMAP —");
  // SMTP : vérification de la configuration (connexion + authentification)
  const t = smtpGmail();
  try {
    await t.verify();
    check("SMTP smtp.gmail.com:465 — connexion + authentification", true, "verify() OK");
  } catch (e) {
    check("SMTP smtp.gmail.com:465 — connexion + authentification", false, e.message.slice(0, 90));
  }
  // IMAP : connexion + ouverture INBOX + statut
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false }, logger: false });
  try {
    await c.connect();
    const st = await c.status("INBOX", { messages: true, uidNext: true });
    check("IMAP imap.gmail.com:993 — connexion + INBOX", true, st.messages + " messages, uidNext=" + st.uidNext);
  } catch (e) {
    check("IMAP imap.gmail.com:993 — connexion + INBOX", false, e.message.slice(0, 90));
  } finally { await c.logout().catch(() => {}); }
  // SMTP Zoho (boîte manager — envoi réel des réponses manager)
  const tz = smtpZoho();
  try {
    await tz.verify();
    check("SMTP smtp.zoho.com:465 (boîte manager) — connexion + authentification", true, "verify() OK");
  } catch (e) {
    check("SMTP smtp.zoho.com:465 (boîte manager)", false, e.message.slice(0, 90));
  }
}

/* ============ Nettoyage : réponses de test résiduelles dans INBOX ======= */
async function nettoyerInbox() {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let n = 0;
  try {
    const statut = await client.status("INBOX", { uidNext: true });
    const dernier = statut.uidNext - 1;
    for (let uid = Math.max(1, dernier - 60); uid <= dernier; uid++) {
      const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      if (String(msg.envelope.subject || "").indexOf("DEM-2026-1500") >= 0) {
        await client.messageDelete(uid, { uid: true }); n++;
      }
    }
  } finally { lock.release(); await client.logout().catch(() => {}); }
  log("  Nettoyage INBOX : " + n + " message(s) de test résiduel(s) supprimé(s)");
}

async function reponseRh(reference, messageIdEnvoi, texte) {
  const t = smtpGmail();
  const info = await t.sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [" + h() + " ENVOI RH Gmail→SMTP] " + reference + " → " + info.messageId);
}
async function reponseManager(reference, messageIdEnvoi, texte) {
  const t = smtpZoho();
  const info = await t.sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
  });
  log("    [" + h() + " ENVOI manager Zoho→SMTP] " + reference + " → " + info.messageId);
}

async function attendreStatut(reference, predicateur, delaiMs, motif) {
  const fin = Date.now() + (delaiMs || 100000);
  let derniere = null;
  while (Date.now() < fin) {
    await sleep(4000);
    derniere = await db.demandeAdministrative.findFirst({ where: { reference } });
    if (derniere && predicateur(derniere)) return derniere;
    log("      …attente " + motif + " : statut=" + (derniere && derniere.statut) + " mgr=" + (derniere && derniere.decisionManager) + " rh=" + (derniere && derniere.decisionRh));
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
        // recherche large puis filtrage côté application (sujets accentués peu fiables en SEARCH IMAP)
        const uids = await client.search({ since: new Date(Date.now() - (depuisMinutes || 30) * 60000) });
        for (const uid of (uids || []).slice(-30).reverse()) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          const sujet = String(msg.envelope.subject || "");
          if (sujet.indexOf(sujetContient) >= 0) {
            const parsed = await simpleParser(msg.source);
            const pj = (parsed.attachments || []).find((a) => (a.contentType || "").indexOf("pdf") >= 0);
            trouve = { uid, sujet, de: parsed.from && parsed.from.text, cc: parsed.cc && parsed.cc.text, pjNom: pj ? pj.filename : null, pjOk: pj ? pj.content.subarray(0, 4).toString() === "%PDF" : false, pjTaille: pj ? pj.content.length : 0, date: msg.envelope.date };
            break;
          }
        }
      } finally { lock.release(); await client.logout().catch(() => {}); }
      return trouve;
    } catch (e) {
      log("      (vérif Zoho tentative " + tentative + " : " + e.message.slice(0, 80) + ")");
      if (tentative === 2) return null;
      await sleep(8000);
    }
  }
  return null;
}

async function creerDemande(reference, type, tag) {
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2027-03-01", dateFin: "2027-03-12", commentaire: "Test final v0.2.168 " + tag }
    : { nom: "Employé Test Final", date: "2027-03-03", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  const d = await db.demandeAdministrative.create({
    data: {
      reference, type, statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: "final168-" + tag + "-" + Date.now() + "@auto-rh.test",
    },
  });
  log("  [" + h() + "] Demande " + reference + " (" + type + ") créée — EN_ATTENTE");
  return d;
}

async function main() {
  log("== TEST FINAL — GMAIL SMTP + IMAP — VALIDATION À DEUX NIVEAUX v0.2.168 ==");
  log("== " + new Date().toISOString() + " ==");

  await testConnectivite();
  await nettoyerInbox();

  /* ================= B1 — RH d'abord, puis manager (congé) ============== */
  log("\n— B1 : le RH (Gmail) répond d'abord, puis le manager (Zoho) — congé —");
  const d1 = await creerDemande(REF.b1, "CONGE", "b1");
  await reponseRh(d1.reference, d1.messageIdEnvoi, "Acceptée");
  const apresRh1 = await attendreStatut(d1.reference, (d) => d.decisionRh === "ACCEPTEE", 100000, "B1/décision RH");
  check("B1 · réponse RH détectée par le poller IMAP (INBOX)", Boolean(apresRh1 && apresRh1.decisionRh === "ACCEPTEE"), apresRh1 ? "decisionRh=ACCEPTEE" : "délai dépassé");
  check("B1 · statut EN_ATTENTE (les 2 acceptations sont requises)", apresRh1 && apresRh1.statut === "EN_ATTENTE", apresRh1 ? "statut=" + apresRh1.statut : "");
  check("B1 · aucune décision manager à ce stade", apresRh1 && !apresRh1.decisionManager, "");

  await reponseManager(d1.reference, d1.messageIdEnvoi, "OK pour moi, bon congé.");
  const apresMgr1 = await attendreStatut(d1.reference, (d) => d.statut === "ACCEPTEE" && d.decisionManager === "ACCEPTEE", 100000, "B1/décision manager");
  check("B1 · réponse MANAGER prise en compte APRÈS le RH (bug corrigé)", Boolean(apresMgr1 && apresMgr1.decisionManager === "ACCEPTEE"), apresMgr1 ? "decisionManager=ACCEPTEE" : "délai dépassé");
  check("B1 · statut FINAL ACCEPTEE (matrice manager×RH complète)", apresMgr1 && apresMgr1.statut === "ACCEPTEE", apresMgr1 ? "statut=" + apresMgr1.statut : "");
  check("B1 · document signé généré (docSigneChemin)", Boolean(apresMgr1 && apresMgr1.docSigneChemin), apresMgr1 ? apresMgr1.docSigneNom : "");
  const livr1 = await verifierLivraisonZoho("acceptée : " + REF.b1, 30);
  check("B1 · réponse automatique + PDF reçus dans la boîte employé (Zoho)", Boolean(livr1), livr1 ? "uid=" + livr1.uid + " de=" + livr1.de : "non reçue");
  if (livr1) check("B1 · pièce jointe PDF signé authentique (%PDF)", livr1.pjOk && livr1.pjTaille > 2048, livr1.pjNom + " (" + livr1.pjTaille + " o)");

  /* ================= B2 — manager d'abord, puis RH (autorisation) ======= */
  log("\n— B2 : le manager (Zoho) répond d'abord, puis le RH (Gmail) — autorisation de sortie —");
  const d2 = await creerDemande(REF.b2, "AUTORISATION_SORTIE", "b2");
  await reponseManager(d2.reference, d2.messageIdEnvoi, "J'accepte cette sortie.");
  const apresMgr2 = await attendreStatut(d2.reference, (d) => d.decisionManager === "ACCEPTEE", 100000, "B2/décision manager");
  check("B2 · réponse manager détectée (IMAP)", Boolean(apresMgr2 && apresMgr2.decisionManager === "ACCEPTEE"), apresMgr2 ? "decisionManager=ACCEPTEE" : "délai dépassé");
  check("B2 · statut EN_ATTENTE (validation RH encore requise)", apresMgr2 && apresMgr2.statut === "EN_ATTENTE", apresMgr2 ? "statut=" + apresMgr2.statut : "");

  await reponseRh(d2.reference, d2.messageIdEnvoi, "Je valide.");
  const apresRh2 = await attendreStatut(d2.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 100000, "B2/décision RH");
  check("B2 · réponse RH détectée → statut FINAL ACCEPTEE", Boolean(apresRh2 && apresRh2.statut === "ACCEPTEE"), apresRh2 ? "statut=" + apresRh2.statut : "délai dépassé");
  check("B2 · document signé généré", Boolean(apresRh2 && apresRh2.docSigneChemin), apresRh2 ? apresRh2.docSigneNom : "");
  const livr2 = await verifierLivraisonZoho("acceptée : " + REF.b2, 30);
  check("B2 · réponse automatique + PDF reçus (Zoho)", Boolean(livr2), livr2 ? "uid=" + livr2.uid : "non reçue");
  if (livr2) check("B2 · pièce jointe PDF signé authentique (%PDF)", livr2.pjOk && livr2.pjTaille > 2048, livr2.pjNom + " (" + livr2.pjTaille + " o)");

  /* ================= B3 — manager refuse avant le RH (congé) ============ */
  log("\n— B3 : le manager (Zoho) REFUSE avant le RH — congé —");
  const d3 = await creerDemande(REF.b3, "CONGE", "b3");
  await reponseManager(d3.reference, d3.messageIdEnvoi, "Je refuse, période chargée.");
  const apresMgr3 = await attendreStatut(d3.reference, (d) => d.statut === "REFUSEE", 100000, "B3/refus manager");
  check("B3 · REFUS IMMÉDIAT (sans attendre la réponse du RH)", Boolean(apresMgr3 && apresMgr3.statut === "REFUSEE"), apresMgr3 ? "statut=REFUSEE" : "délai dépassé");
  check("B3 · refuseePar = MANAGER", apresMgr3 && apresMgr3.refuseePar === "MANAGER", "refuseePar=" + (apresMgr3 && apresMgr3.refuseePar));
  check("B3 · aucune décision RH enregistrée", apresMgr3 && !apresMgr3.decisionRh, "");
  check("B3 · document de refus signé généré (docRefusChemin)", Boolean(apresMgr3 && apresMgr3.docRefusChemin), apresMgr3 ? apresMgr3.docRefusNom : "");
  const livr3 = await verifierLivraisonZoho("refusée : " + REF.b3, 30);
  check("B3 · réponse de refus + PDF reçus dans la boîte employé (Zoho)", Boolean(livr3), livr3 ? "uid=" + livr3.uid : "non reçue");
  if (livr3) check("B3 · pièce jointe PDF de refus authentique (%PDF)", livr3.pjOk && livr3.pjTaille > 2048, livr3.pjNom + " (" + livr3.pjTaille + " o)");

  log("  … envoi de la réponse TARDIVE du RH (doit être ignorée) …");
  await reponseRh(d3.reference, d3.messageIdEnvoi, "Acceptée finalement.");
  await sleep(50000);
  const apresRh3 = await db.demandeAdministrative.findFirst({ where: { reference: d3.reference } });
  check("B3 · réponse tardive du RH ignorée (refus définitif maintenu)", apresRh3 && apresRh3.statut === "REFUSEE" && !apresRh3.decisionRh, "statut=" + (apresRh3 && apresRh3.statut) + " rh=" + (apresRh3 && apresRh3.decisionRh));

  /* ================= État final en base ================================= */
  log("\n— État final des 3 demandes de test en base —");
  const fin = await db.demandeAdministrative.findMany({
    where: { reference: { in: [REF.b1, REF.b2, REF.b3] } },
    select: { reference: true, type: true, statut: true, decisionManager: true, decisionRh: true, refuseePar: true, docSigneNom: true, docRefusNom: true },
    orderBy: { reference: "asc" },
  });
  for (const d of fin) {
    log("  " + d.reference + " | " + d.type + " | " + d.statut + " | mgr=" + (d.decisionManager || "—") + " | rh=" + (d.decisionRh || "—") + " | refuseePar=" + (d.refuseePar || "—") + " | doc=" + (d.docSigneNom || d.docRefusNom || "—"));
  }

  log("\n========================================");
  log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  log("  " + new Date().toISOString() + " — fin");
  log("========================================");
  fs.writeFileSync("/tmp/test-final-preuves.json", JSON.stringify({ date: new Date().toISOString(), ok, fail, preuves }, null, 2));
  log("Preuves écrites : /tmp/test-final-preuves.json");
  process.exitCode = fail ? 1 : 0;
  await db.$disconnect();
}

main().catch((e) => { log("ERREUR FATALE : " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join(" | ") : e)); process.exitCode = 1; });
