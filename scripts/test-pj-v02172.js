#!/usr/bin/env node
/**
 * ============================================================================
 * TEST v0.2.172 — TRANSMISSION DES PIÈCES JOINTES DES RÉPONSES AU DEMANDEUR
 *
 *   Exigence (cahier des charges — certifiée sur code renommé Auto-RH v0.2.172) : quand le RH ou le manager répond
 *   « Acceptée » / « Refusée » AVEC une ou plusieurs pièces jointes, la
 *   réponse automatique envoyée au DEMANDEUR doit contenir :
 *     - le PDF de décision signé électroniquement (généré par le système) ;
 *     - TOUTES les pièces jointes fournies par le RH / le manager dans leur
 *       e-mail de réponse — AUCUNE pièce jointe ne doit être perdue, y
 *       compris celles reçues à l'étape 1 quand la décision finale vient de
 *       l'autre acteur (cumul + dédoublonnage des noms).
 *
 *   Scénarios (conditions réelles Gmail SMTP/IMAP + Zoho SMTP/IMAP) :
 *   C1. manager (Zoho) accepte AVEC 2 PJs (PDF + PNG) → RH (Gmail) accepte
 *       AVEC 1 PJ → e-mail final employé : PDF signé + 3 PJs (4 pièces).
 *   C2. RH (Gmail) refuse AVEC 1 PJ → refus immédiat : PDF de refus + 1 PJ.
 *   C3. RÉGRESSION : réponses SANS pièce jointe → e-mail avec le PDF signé
 *       SEUL (exactement 1 pièce jointe).
 *   C4. CUMUL + DÉDOUBLONNAGE : manager accepte AVEC « justificatif.pdf »,
 *       RH accepte AVEC « justificatif.pdf » (même nom, contenu différent) →
 *       l'e-mail final contient les DEUX (« justificatif-2.pdf » pour le
 *       second) + le PDF signé.
 *
 *   Boîte système/RH  : employe.test@autorh.tn (SMTP 465 / IMAP 993, poller 15 s)
 *   Boîte manager     : rh3000@zohomail.com    (smtp.zoho.com:465)
 *   Boîte employé     : rh3000@zohomail.com    (vérification IMAP des livraisons)
 *
 * Journalisation SYNCHRONE (fs.writeSync). Exécution AVANT-PLAN :
 *   node test-pj-v02171.js
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

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };
const CIN_TEST = "TS172PJ1721";
const REF = { c1: "DEM-2026-17211", c2: "DEM-2026-17212", c3: "DEM-2026-17213", c4: "DEM-2026-17214" };

let ok = 0, fail = 0;
const RUN_DEBUT = new Date(Date.now() - 20000); // e-mails ANTÉRIEURS ignorés (runs précédents)
const preuves = [];
function log(s) { try { fs.writeSync(1, s + "\n"); } catch (_) {} }
function check(nom, cond, detail) {
  if (cond) { ok++; log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; log("  FAIL " + nom + (detail ? " — " : "") + (detail || "")); }
  preuves.push({ nom, ok: !!cond, detail: String(detail || "") });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function h() { return new Date().toISOString().slice(11, 23); }
function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

/* ---------- petits fichiers de test (octets exacts vérifiés à l'arrivée) --- */
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 60>>stream\nBT /F1 10 Tf 20 60 Td (Piece jointe de test Auto-RH) Tj ET\nendstream\nendobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
  "trailer<</Root 1 0 R/Size 6>>\n%%EOF\n", "latin1");
const PNG_MIN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64");
const PDF_FAUX = Buffer.from("%PDF-1.4 (contenu different pour C4 - collision de nom)\n%%EOF\n", "latin1");
/** (v0.2.171) PDF UNIQUE par fichier de test — le système déduplique les
 *  pièces jointes par SHA-256 du CONTENU (conception v0.2.51) : deux pièces
 *  de test aux octets identiques ne seraient importées qu'UNE fois. Chaque
 *  pièce jointe simulée reçoit donc un contenu DISTINCT. */
function pdfUnique(marqueur) {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 220 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 80>>stream\nBT /F1 10 Tf 15 60 Td (" + marqueur + " " + Date.now() + ") Tj ET\nendstream\nendobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "trailer<</Root 1 0 R/Size 6>>\n%%EOF\n", "latin1");
}

function pj(nom, contenu, type) {
  // (v0.2.171) chaque fichier envoyé est conservé pour la vérification
  // octet-exact et comme preuve téléchargeable.
  try {
    fs.mkdirSync("/tmp/pj-172-fichiers", { recursive: true });
    fs.writeFileSync("/tmp/pj-172-fichiers/" + nom, contenu);
  } catch (e) { /* preuve non bloquante */ }
  return { filename: nom, content: contenu, contentType: type };
}

/* ------------------------- clients IMAP ---------------------------------- */
function clientGmail() {
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false }, logger: false, connectionTimeout: 20000, greetingTimeout: 20000 });
  c.on("error", function () { /* jamais fatal (redétection au passage suivant) */ });
  return c;
}
function clientZoho() {
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false, connectionTimeout: 20000, greetingTimeout: 20000 });
  c.on("error", function () { /* jamais fatal */ });
  return c;
}

/* --------------------------- transports ---------------------------------- */
function smtpGmail() {
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } });
}
function smtpZoho() {
  return nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } });
}

/* ------------------------- connectivité explicite ------------------------ */
async function testConnectivite() {
  log("\n— 0 · Connectivité Gmail SMTP+IMAP / Zoho SMTP+IMAP —");
  try { await smtpGmail().verify(); check("SMTP smtp.gmail.com:465 — connexion + authentification", true, "verify() OK"); }
  catch (e) { check("SMTP smtp.gmail.com:465 — connexion + authentification", false, e.message.slice(0, 90)); }
  const c = clientGmail();
  try {
    await c.connect();
    const st = await c.status("INBOX", { messages: true, uidNext: true });
    check("IMAP imap.gmail.com:993 — connexion + INBOX", true, st.messages + " messages, uidNext=" + st.uidNext);
  } catch (e) { check("IMAP imap.gmail.com:993 — connexion + INBOX", false, e.message.slice(0, 90)); }
  finally { await c.logout().catch(() => {}); }
  try { await smtpZoho().verify(); check("SMTP smtp.zoho.com:465 (boîte manager)", true, "verify() OK"); }
  catch (e) { check("SMTP smtp.zoho.com:465 (boîte manager)", false, e.message.slice(0, 90)); }
  const cz = clientZoho();
  try {
    await cz.connect();
    const st = await cz.status("INBOX", { messages: true, uidNext: true });
    check("IMAP imap.zoho.com:993 — connexion + INBOX (boîte employé)", true, st.messages + " messages, uidNext=" + st.uidNext);
  } catch (e) { check("IMAP imap.zoho.com:993 — connexion + INBOX (boîte employé)", false, e.message.slice(0, 90)); }
  finally { await cz.logout().catch(() => {}); }
}

/* -------------------- nettoyage des réponses résiduelles ----------------- */
async function nettoyerInboxGmail() {
  let n = 0;
  try {
    const client = clientGmail();
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const statut = await client.status("INBOX", { uidNext: true });
      const dernier = statut.uidNext - 1;
      const fenetre = { uid: Math.max(1, dernier - 40) + ":" + dernier };
      for await (const msg of client.fetch(fenetre, { envelope: true })) {
        const sujet = String((msg.envelope && msg.envelope.subject) || "");
        if (sujet.indexOf("DEM-2026-172") >= 0) { await client.messageDelete(msg.uid, { uid: true }); n++; }
      }
    } finally { lock.release(); await client.logout().catch(() => {}); }
  } catch (e) { log("  (nettoyage INBOX Gmail ignoré : " + e.message.slice(0, 60) + ")"); }
  log("  Nettoyage INBOX Gmail : " + n + " message(s) de test résiduel(s) supprimé(s)");
}
async function purgerInboxGmailFin() {
  try {
    const client = clientGmail();
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let n = 0;
    try {
      const uids = await client.search({ since: new Date(Date.now() - 90 * 60000) });
      for (const uid of uids || []) {
        const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
        if (msg && msg.envelope && String(msg.envelope.subject || "").indexOf("DEM-2026-172") >= 0) {
          await client.messageDelete(uid, { uid: true }); n++;
        }
      }
    } finally { lock.release(); await client.logout().catch(() => {}); }
    log("  Purge finale INBOX Gmail : " + n + " message(s) de test supprimé(s)");
  } catch (e) { log("  (purge finale Gmail ignorée : " + e.message.slice(0, 60) + ")"); }
}

/* ------------------------- réponses avec PJs ----------------------------- */
async function reponseManager(reference, messageIdEnvoi, texte, piecesJointes) {
  const info = await smtpZoho().sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
    ...(piecesJointes && piecesJointes.length ? { attachments: piecesJointes } : {}),
  });
  log("    [" + h() + " ENVOI manager Zoho] " + reference + (piecesJointes && piecesJointes.length ? " + " + piecesJointes.length + " PJ" : "") + " → " + info.messageId);
}
async function reponseRh(reference, messageIdEnvoi, texte, piecesJointes) {
  const info = await smtpGmail().sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
    ...(piecesJointes && piecesJointes.length ? { attachments: piecesJointes } : {}),
  });
  log("    [" + h() + " ENVOI RH Gmail] " + reference + (piecesJointes && piecesJointes.length ? " + " + piecesJointes.length + " PJ" : "") + " → " + info.messageId);
}

/* ------------------------- attentes base --------------------------------- */
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

/* ---------------- vérification de la livraison (Zoho) -------------------- */
/** Retrouve l'e-mail de décision (sujet contient ref + acceptée/refusée) et
 *  compare CHAQUE pièce jointe attendue : présence, taille et SHA-256 exacts. */
async function verifierLivraisonZoho(reference, decide, attendues, depuisMinutes) {
  const sujetContient = (decide === "acceptee" ? "acceptée : " : "refusée : ") + reference;
  // (v0.2.171) la livraison Gmail→Zoho peut prendre 2 à 4 minutes :
  // 20 tentatives espacées de 30 s ≈ 10-12 min de patience (latence
  // de livraison Gmail→Zoho observée : 1 à 10 min), connexions incluses.
  for (let tentative = 1; tentative <= 20; tentative++) {
    try {
      const client = clientZoho();
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      let trouve = null;
      try {
        const uids = await client.search({ since: new Date(Date.now() - (depuisMinutes || 40) * 60000) });
        for (const uid of (uids || []).slice(-40).reverse()) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          // (v0.2.171) e-mail ANCIEN (runs précédents, même sujet) → ignoré :
          // seule la livraison de CE run est examinée.
          const dateMsg = msg.envelope.date ? new Date(msg.envelope.date) : null;
          if (dateMsg && dateMsg < RUN_DEBUT) continue;
          if (String(msg.envelope.subject || "").indexOf(sujetContient) >= 0) {
            const parsed = await simpleParser(msg.source);
            // (v0.2.171) preuve : les pièces reçues sont copiées dans
            // download/task-172-pj/ (préfixe portail-) pour vérification.
            try {
              fs.mkdirSync("/home/z/my-project/download/task-172-pj", { recursive: true });
              for (const piece of parsed.attachments || []) {
                fs.writeFileSync("/home/z/my-project/download/task-172-pj/portail-" + reference.slice(-5) + "-" + piece.filename, piece.content);
              }
            } catch (e) { /* preuve non bloquante */ }
            trouve = { uid, sujet: String(msg.envelope.subject || ""), de: parsed.from && parsed.from.text, cc: parsed.cc && parsed.cc.text, pieces: parsed.attachments || [] };
            break;
          }
        }
      } finally { lock.release(); await client.logout().catch(() => {}); }
      return trouve;
    } catch (e) {
      log("      (vérif Zoho tentative " + tentative + " : " + e.message.slice(0, 80) + ")");
      if (tentative === 20) return null;
      await sleep(30000);
    }
  }
  return null;
}

function verifierPieces(livr, attendues, prefixe, reference) {
  // attendues : [{ nom, contenu, type }] — PDF signé identifié par préfixe/nom
  const pieces = (livr && livr.pieces) || [];
  check(prefixe + " · e-mail de décision présent dans la boîte employé (Zoho)", Boolean(livr),
    livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
  if (!livr) return;
  check(prefixe + " · nombre EXACT de pièces jointes : " + (attendues.length + 1) + " (PDF signé + PJs des réponses)", pieces.length === attendues.length + 1,
    "reçu " + pieces.length + " : " + pieces.map(function (p) { return p.filename; }).join(", "));
  for (const att of attendues) {
    const trouvee = pieces.find(function (p) { return p.filename === att.nom; });
    check(prefixe + " · PJ « " + att.nom + " » présente", Boolean(trouvee), trouvee ? trouvee.content.length + " o" : "ABSENTE");
    if (!trouvee) continue;
    check(prefixe + " · PJ « " + att.nom + " » taille exacte (" + att.contenu.length + " o)", trouvee.content.length === att.contenu.length,
      "reçu " + trouvee.content.length + " o");
    check(prefixe + " · PJ « " + att.nom + " » octets EXACTS (SHA-256)", sha(trouvee.content) === sha(att.contenu),
      sha(trouvee.content).slice(0, 12) + " vs " + sha(att.contenu).slice(0, 12));
  }
  // le PDF signé du système : première pièce %PDF dont le nom contient la référence
  const signe = pieces.find(function (p) {
    return (p.filename.indexOf("Acceptation_") === 0 || p.filename.indexOf("Refus_") === 0)
      && p.filename.indexOf(reference) >= 0 && p.contentType.indexOf("pdf") >= 0;
  });
  check(prefixe + " · PDF de décision signé présent (" + (decide === "acceptee" ? "Acceptation_" : "Refus_") + "…)", Boolean(signe),
    signe ? signe.filename + " (" + signe.content.length + " o)" : "ABSENT");
  if (signe) check(prefixe + " · PDF de décision authentique (%PDF)", signe.content.subarray(0, 4).toString() === "%PDF",
    signe.content.length + " o");
}

/* ------------------------- création de demandes -------------------------- */
async function creerDemande(reference, type, tag) {
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2027-04-01", dateFin: "2027-04-10", commentaire: "Test v0.2.172 pièces jointes " + tag }
    : { nom: "Employé Test PJ", date: "2027-04-06", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  const d = await db.demandeAdministrative.create({
    data: {
      reference, type, statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: "pj172-" + tag + "-" + Date.now() + "@auto-rh.test",
    },
  });
  log("  [" + h() + "] Demande " + reference + " (" + type + ") créée — EN_ATTENTE");
  return d;
}

/* ------------------------------- main ------------------------------------ */
async function main() {
  log("== TEST v0.2.172 — PIÈCES JOINTES DES RÉPONSES TRANSMISES AU DEMANDEUR ==");
  log("== " + new Date().toISOString() + " ==");

  await testConnectivite();
  // (v0.2.171) nettoyage Gmail SUPPRIMÉ : les réponses résiduelles d'anciens
  // runs ne sont PAS relues par le poller (threading par messageIdEnvoi
  // unique par run — elles apparaissent seulement en « ignorés »). La
  // connexion IMAP supplémentaire déclenchait une limitation Gmail
  // (boîte de 43 000+ messages) et bloquait le démarrage du test.

  /* ==== C1 — manager accepte AVEC 2 PJs, RH accepte AVEC 1 PJ (congé) === */
  log("\n— C1 : cumul des pièces jointes des DEUX décideurs (congé) —");
  const c1Pdf = pdfUnique("Justificatif manager C1"), c1Png = PNG_MIN, c1Rh = pdfUnique("Note service RH C1");
  const d1 = await creerDemande(REF.c1, "CONGE", "c1");
  await reponseManager(d1.reference, d1.messageIdEnvoi, "Acceptée — voir pièces jointes.", [
    pj("justificatif-manager-C1.pdf", c1Pdf, "application/pdf"),
    pj("planning-service-C1.png", c1Png, "image/png"),
  ]);
  const apresMgr1 = await attendreStatut(d1.reference, (d) => d.decisionManager === "ACCEPTEE", 100000, "C1/manager");
  check("C1 · réponse manager AVEC pièces jointes détectée", Boolean(apresMgr1 && apresMgr1.decisionManager === "ACCEPTEE"), apresMgr1 ? "decisionManager=ACCEPTEE" : "délai dépassé");
  check("C1 · statut EN_ATTENTE tant que le RH n'a pas répondu", apresMgr1 && apresMgr1.statut === "EN_ATTENTE", apresMgr1 ? "statut=" + apresMgr1.statut : "");
  const docs1 = await db.documentDemande.findMany({ where: { demande: { reference: REF.c1 } } });
  check("C1 · 2 pièces jointes du manager importées en base (recuDe)", docs1.length === 2, docs1.map(function (x) { return x.nomFichier + "(" + (x.recuDe || "") + ")"; }).join(", "));

  await reponseRh(d1.reference, d1.messageIdEnvoi, "Validé en RH également.", [
    pj("note-auto-rh-C1.pdf", c1Rh, "application/pdf"),
  ]);
  const apresRh1 = await attendreStatut(d1.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 100000, "C1/RH");
  check("C1 · réponse RH achève la matrice → ACCEPTEE", Boolean(apresRh1 && apresRh1.statut === "ACCEPTEE"), apresRh1 ? "statut=" + apresRh1.statut : "délai dépassé");
  const docs1b = await db.documentDemande.findMany({ where: { demande: { reference: REF.c1 }, recuDe: { contains: "@" } } });
  check("C1 · 3 pièces jointes de réponses en base (2 manager + 1 RH)", docs1b.length === 3, docs1b.map(function (x) { return x.nomFichier; }).join(", "));
  const livr1 = await verifierLivraisonZoho(REF.c1, "acceptee", 40);
  verifierPieces(livr1, [
    { nom: "justificatif-manager-C1.pdf", contenu: c1Pdf },
    { nom: "planning-service-C1.png", contenu: c1Png },
    { nom: "note-auto-rh-C1.pdf", contenu: c1Rh },
  ], "C1", REF.c1);

  /* ==== C2 — RH refuse AVEC 1 PJ (autorisation de sortie) =============== */
  log("\n— C2 : refus immédiat du RH AVEC pièce jointe (autorisation de sortie) —");
  const c2Pdf = pdfUnique("Memo refus C2");
  const d2 = await creerDemande(REF.c2, "AUTORISATION_SORTIE", "c2");
  await reponseRh(d2.reference, d2.messageIdEnvoi, "Refusée — voir le mémo joint.", [
    pj("memo-refus-C2.pdf", c2Pdf, "application/pdf"),
  ]);
  const apresRh2 = await attendreStatut(d2.reference, (d) => d.statut === "REFUSEE", 100000, "C2/refus RH");
  check("C2 · REFUS IMMÉDIAT (sans attendre le manager)", Boolean(apresRh2 && apresRh2.statut === "REFUSEE"), apresRh2 ? "statut=" + apresRh2.statut : "délai dépassé");
  check("C2 · refuseePar = RH", apresRh2 && apresRh2.refuseePar === "RH", "refuseePar=" + (apresRh2 && apresRh2.refuseePar));
  const livr2 = await verifierLivraisonZoho(REF.c2, "refusee", 40);
  verifierPieces(livr2, [
    { nom: "memo-refus-C2.pdf", contenu: c2Pdf },
  ], "C2", REF.c2);

  /* ==== C3 — RÉGRESSION : réponses SANS pièce jointe ==================== */
  log("\n— C3 : réponses sans pièce jointe → PDF signé SEUL (régression) —");
  const d3 = await creerDemande(REF.c3, "CONGE", "c3");
  await reponseManager(d3.reference, d3.messageIdEnvoi, "OK pour moi.", null);
  await attendreStatut(d3.reference, (d) => d.decisionManager === "ACCEPTEE", 100000, "C3/manager");
  await reponseRh(d3.reference, d3.messageIdEnvoi, "D'accord, validé.", null);
  const apresRh3 = await attendreStatut(d3.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 100000, "C3/RH");
  check("C3 · acceptation à deux étapes sans PJ inchangée", Boolean(apresRh3 && apresRh3.statut === "ACCEPTEE"), apresRh3 ? "statut=" + apresRh3.statut : "délai dépassé");
  const livr3 = await verifierLivraisonZoho(REF.c3, "acceptee", 40);
  if (livr3) {
    check("C3 · EXACTEMENT 1 pièce jointe (le PDF signé, aucune autre)", (livr3.pieces || []).length === 1,
      (livr3.pieces || []).map(function (p) { return p.filename; }).join(", ") || "0 pièce");
    const pdf3 = (livr3.pieces || [])[0];
    check("C3 · pièce unique = PDF signé authentique (%PDF)", Boolean(pdf3) && pdf3.content.subarray(0, 4).toString() === "%PDF" && pdf3.filename.indexOf("Acceptation_") === 0,
      pdf3 ? pdf3.filename + " (" + pdf3.content.length + " o)" : "absente");
  } else {
    check("C3 · e-mail de décision présent dans la boîte employé (Zoho)", false, "non reçu");
  }

  /* ==== C4 — CUMUL + DÉDOUBLONNAGE des noms ============================= */
  log("\n— C4 : même nom de PJ chez le manager et le RH → les DEUX transmises —");
  const d4 = await creerDemande(REF.c4, "CONGE", "c4");
  const c4Mgr = pdfUnique("Justificatif manager C4");
  await reponseManager(d4.reference, d4.messageIdEnvoi, "Accepté, dossier joint.", [
    pj("justificatif.pdf", c4Mgr, "application/pdf"),
  ]);
  await attendreStatut(d4.reference, (d) => d.decisionManager === "ACCEPTEE", 100000, "C4/manager");
  await reponseRh(d4.reference, d4.messageIdEnvoi, "Validé — même nom de fichier, contenu différent.", [
    pj("justificatif.pdf", PDF_FAUX, "application/pdf"),
  ]);
  const apresRh4 = await attendreStatut(d4.reference, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", 100000, "C4/RH");
  check("C4 · acceptation à deux étapes aboutit", Boolean(apresRh4 && apresRh4.statut === "ACCEPTEE"), apresRh4 ? "statut=" + apresRh4.statut : "délai dépassé");
  const livr4 = await verifierLivraisonZoho(REF.c4, "acceptee", 40);
  if (livr4) {
    const noms4 = (livr4.pieces || []).map(function (p) { return p.filename; });
    check("C4 · les DEUX pièces « justificatif.pdf » transmises (dédoublonnage -2)", noms4.indexOf("justificatif.pdf") >= 0 && noms4.indexOf("justificatif-2.pdf") >= 0,
      noms4.join(", "));
    const j1 = (livr4.pieces || []).find(function (p) { return p.filename === "justificatif.pdf"; });
    const j2 = (livr4.pieces || []).find(function (p) { return p.filename === "justificatif-2.pdf"; });
    check("C4 · justificatif.pdf  = version MANAGER (octets exacts)", Boolean(j1) && sha(j1.content) === sha(c4Mgr), j1 ? j1.content.length + " o" : "absente");
    check("C4 · justificatif-2.pdf = version RH (octets exacts)", Boolean(j2) && sha(j2.content) === sha(PDF_FAUX), j2 ? j2.content.length + " o" : "absente");
    check("C4 · total 3 pièces (PDF signé + 2 justificatifs)", noms4.length === 3, noms4.join(", "));
  } else {
    check("C4 · e-mail de décision présent dans la boîte employé (Zoho)", false, "non reçu");
  }

  /* ==== état final + historique ========================================= */
  log("\n— État final des 4 demandes de test en base —");
  const fin = await db.demandeAdministrative.findMany({
    where: { reference: { in: [REF.c1, REF.c2, REF.c3, REF.c4] } },
    select: { reference: true, statut: true, decisionManager: true, decisionRh: true, refuseePar: true, docSigneNom: true, docRefusNom: true },
    orderBy: { reference: "asc" },
  });
  for (const d of fin) {
    log("  " + d.reference + " | " + d.statut + " | mgr=" + (d.decisionManager || "—") + " | rh=" + (d.decisionRh || "—") + " | refuseePar=" + (d.refuseePar || "—") + " | doc=" + (d.docSigneNom || d.docRefusNom || "—"));
  }
  const hist1 = await db.demandeAdministrative.findFirst({ where: { reference: REF.c1 }, select: { reponsesRecues: true } });
  let histOk = false, histDetail = "";
  try {
    const tab = JSON.parse(cryptoBd.dechiffrerChamp(hist1.reponsesRecues) || "[]");
    const avecPj = tab.filter(function (e) { return Array.isArray(e.piecesJointes) && e.piecesJointes.length; });
    const avecIds = tab.filter(function (e) { return Array.isArray(e.piecesJointesIds) && e.piecesJointesIds.length; });
    histOk = avecPj.length >= 2 && avecIds.length >= 2;
    histDetail = avecPj.length + " réponse(s) avec PJs, " + avecIds.length + " avec liaisons directes (ids)";
  } catch (e) { histDetail = e.message.slice(0, 60); }
  check("Historique C1 : réponses + pièces jointes + liaisons (ids) consultables", histOk, histDetail);

  log("\n========================================");
  log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  log("  " + new Date().toISOString() + " — fin");
  log("========================================");
  fs.writeFileSync("/tmp/test-pj-172-preuves.json", JSON.stringify({ date: new Date().toISOString(), ok, fail, preuves }, null, 2));
  log("Preuves écrites : /tmp/test-pj-172-preuves.json");
  process.exitCode = fail ? 1 : 0;
  await db.$disconnect();
}

main().catch(async (e) => {
  log("ERREUR FATALE : " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join(" | ") : e));
  process.exitCode = 1;
  try { await db.$disconnect(); } catch (_) {}
});
