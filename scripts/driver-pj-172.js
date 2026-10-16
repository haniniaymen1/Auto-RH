#!/usr/bin/env node
/**
 * ============================================================================
 * PILOTE PAR PHASES — TEST v0.2.172 PIÈCES JOINTES DES RÉPONSES → DEMANDEUR
 * ----------------------------------------------------------------------------
 * Le bac à sable tue les processus d'arrière-plan entre les commandes : ce
 * pilote s'exécute donc en PHASES courtes (une commande = une phase ≤ 8 min).
 * Chaque phase :
 *   1. CHARGE scripts/portail-server.js (le serveur + son poller IMAP vivent
 *      DANS ce processus — détection des réponses en temps réel) ;
 *   2. exécute l'étape demandée ;
 *   3. écrit l'état dans /tmp/pj172-etat.json (persiste entre les phases).
 * La DB (db/custom.db) et les boîtes Gmail/Zoho persistent entre les phases.
 *
 * Scénarios (identiques à test-pj-v02172.js) :
 *   C1  manager accepte AVEC 2 PJs puis RH accepte AVEC 1 PJ → e-mail final =
 *       PDF signé + 3 PJs (octets exacts SHA-256).
 *   C2  RH refuse AVEC 1 PJ → refus IMMÉDIAT + PDF de refus + 1 PJ.
 *   C3  acceptation à deux étapes SANS PJ → PDF signé SEUL (régression).
 *   C4  même nom de PJ chez manager et RH → les DEUX transmises (-2).
 *
 * Usage : node driver-pj-172.js <connectivite|c1-manager|c1-rh|verif-c1|
 *         c2-rh|verif-c2|c3-c4-manager|c3-c4-rh|verif-final>
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
const CIN_TEST = "TS172PJ1721";
const REF = { c1: "DEM-2026-17211", c2: "DEM-2026-17212", c3: "DEM-2026-17213", c4: "DEM-2026-17214" };
const ETAT_PATH = "/tmp/pj172-etat.json";
const PREUVES_DIR = "/home/z/my-project/download/task-172-pj";
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
function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
const debut = Date.now();
function resterDuBudget(ms) { return Date.now() + ms < debut + BUDGET_MS; }

function sauverEtat() {
  ETAT.ok = ok; ETAT.fail = fail;
  fs.writeFileSync(ETAT_PATH, JSON.stringify(ETAT, null, 2));
}

/* ---------------- petits fichiers de test (contenus DISTINCTS) ---------- */
function pdfUnique(marqueur) {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 220 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 80>>stream\nBT /F1 10 Tf 15 60 Td (" + marqueur + " " + Date.now() + ") Tj ET\nendstream\nendobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "trailer<</Root 1 0 R/Size 6>>\n%%EOF\n", "latin1");
}
const PNG_MIN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF_FAUX = Buffer.from("%PDF-1.4 (contenu different C4 - collision de nom)\n%%EOF\n", "latin1");

function pj(nom, contenu, type) {
  try {
    fs.mkdirSync("/tmp/pj-172-fichiers", { recursive: true });
    fs.writeFileSync("/tmp/pj-172-fichiers/" + nom, contenu);
  } catch (e) { /* preuve non bloquante */ }
  return { filename: nom, content: contenu, contentType: type };
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
async function reponseManager(reference, messageIdEnvoi, texte, piecesJointes) {
  const info = await smtpZoho().sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
    ...(piecesJointes && piecesJointes.length ? { attachments: piecesJointes } : {}),
  });
  log("    [" + h() + " ENVOI manager Zoho] " + reference + (piecesJointes && piecesJointes.length ? " + " + piecesJointes.length + " PJ" : ""));
}
async function reponseRh(reference, messageIdEnvoi, texte, piecesJointes) {
  const info = await smtpGmail().sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + reference + " (traitement requis)",
    text: texte, inReplyTo: "<" + messageIdEnvoi + ">", references: "<" + messageIdEnvoi + ">",
    ...(piecesJointes && piecesJointes.length ? { attachments: piecesJointes } : {}),
  });
  log("    [" + h() + " ENVOI RH Gmail] " + reference + (piecesJointes && piecesJointes.length ? " + " + piecesJointes.length + " PJ" : ""));
}

/* ------------------------- création + attentes --------------------------- */
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

async function attendreStatut(reference, predicateur, motif) {
  while (resterDuBudget(15000)) {
    await sleep(4000);
    const d = await db.demandeAdministrative.findFirst({ where: { reference } });
    log("      …attente " + motif + " : statut=" + (d && d.statut) + " mgr=" + (d && d.decisionManager) + " rh=" + (d && d.decisionRh));
    if (d && predicateur(d)) return d;
  }
  return await db.demandeAdministrative.findFirst({ where: { reference } });
}

/* ---------------- vérification de la livraison (Zoho) -------------------- */
async function verifierLivraisonZoho(reference, decide, horizonIso) {
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
        for (const uid of (uids || []).slice(-40).reverse()) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          if (String(msg.envelope.subject || "").indexOf(sujetContient) >= 0) {
            const parsed = await simpleParser(msg.source);
            try {
              fs.mkdirSync(PREUVES_DIR, { recursive: true });
              for (const piece of parsed.attachments || []) {
                fs.writeFileSync(PREUVES_DIR + "/portail-" + reference.slice(-5) + "-" + piece.filename, piece.content);
              }
            } catch (e) { /* preuve non bloquante */ }
            trouve = { uid, sujet: String(msg.envelope.subject || ""), de: parsed.from && parsed.from.text, pieces: parsed.attachments || [] };
            break;
          }
        }
      } finally { lock.release(); await client.logout().catch(() => {}); }
      if (trouve) return trouve;
    } catch (e) {
      log("      (vérif Zoho : " + e.message.slice(0, 80) + ")");
    }
    log("      …attente livraison Zoho (" + reference + ")");
    await sleep(20000);
  }
  return null;
}

function verifierPieces(livr, attendues, prefixe, reference) {
  const pieces = (livr && livr.pieces) || [];
  check(prefixe + " · e-mail de décision présent dans la boîte employé (Zoho)", Boolean(livr),
    livr ? "uid=" + livr.uid + " sujet=" + JSON.stringify(livr.sujet.slice(0, 70)) : "non reçu");
  if (!livr) return;
  // le PDF de décision signé s'ajoute aux pièces des réponses
  check(prefixe + " · nombre EXACT de pièces jointes : " + (attendues.length + 1) + " (PDF signé + PJs des réponses)",
    pieces.length === attendues.length + 1,
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
  const signe = pieces.find(function (p) {
    return (p.filename.indexOf("Acceptation_") === 0 || p.filename.indexOf("Refus_") === 0)
      && p.filename.indexOf(reference) >= 0 && p.contentType.indexOf("pdf") >= 0;
  });
  check(prefixe + " · PDF de décision signé présent", Boolean(signe),
    signe ? signe.filename + " (" + signe.content.length + " o)" : "ABSENT");
  if (signe) check(prefixe + " · PDF de décision authentique (%PDF)", signe.content.subarray(0, 4).toString() === "%PDF",
    signe.content.length + " o");
}

/* ------------------------------- phases --------------------------------- */
const PHASES = {
  async connectivite() {
    log("\n— 0 · Connectivité Gmail SMTP+IMAP / Zoho SMTP+IMAP —");
    try { await smtpGmail().verify(); check("SMTP smtp.gmail.com:465", true, "verify() OK"); }
    catch (e) { check("SMTP smtp.gmail.com:465", false, e.message.slice(0, 90)); }
    try { await smtpZoho().verify(); check("SMTP smtp.zoho.com:465 (boîte manager)", true, "verify() OK"); }
    catch (e) { check("SMTP smtp.zoho.com:465 (boîte manager)", false, e.message.slice(0, 90)); }
    const cz = clientZoho();
    try {
      await cz.connect();
      const st = await cz.status("INBOX", { messages: true, uidNext: true });
      check("IMAP imap.zoho.com:993 (boîte employé)", true, st.messages + " messages");
    } catch (e) { check("IMAP imap.zoho.com:993 (boîte employé)", false, e.message.slice(0, 90)); }
    finally { await cz.logout().catch(() => {}); }
  },

  async "c1-manager"() {
    ETAT.memo = ETAT.memo || {};
    ETAT.memo.c1 = {};
    ETAT.memo.c1.c1Pdf = pdfUnique("Justificatif manager C1").toString("base64");
    ETAT.memo.c1.c1Png = PNG_MIN.toString("base64");
    ETAT.memo.c1.c1Rh = pdfUnique("Note service RH C1").toString("base64");
    const d1 = await creerDemande(REF.c1, "CONGE", "c1");
    ETAT.memo.c1.messageIdEnvoi = d1.messageIdEnvoi;
    await reponseManager(d1.reference, d1.messageIdEnvoi, "Acceptée — voir pièces jointes.", [
      pj("justificatif-manager-C1.pdf", Buffer.from(ETAT.memo.c1.c1Pdf, "base64"), "application/pdf"),
      pj("planning-service-C1.png", PNG_MIN, "image/png"),
    ]);
    const apres = await attendreStatut(d1.reference, (d) => d.decisionManager === "ACCEPTEE", "C1/manager");
    check("C1 · réponse manager AVEC pièces jointes détectée", Boolean(apres && apres.decisionManager === "ACCEPTEE"), apres ? "decisionManager=ACCEPTEE" : "délai dépassé");
    check("C1 · statut EN_ATTENTE tant que le RH n'a pas répondu", Boolean(apres && apres.statut === "EN_ATTENTE"), apres ? "statut=" + apres.statut : "");
    if (apres && apres.decisionManager === "ACCEPTEE") {
      const docs1 = await db.documentDemande.findMany({ where: { demande: { reference: REF.c1 } } });
      check("C1 · 2 pièces jointes du manager importées en base (recuDe)", docs1.length === 2, docs1.map(function (x) { return x.nomFichier + "(" + (x.recuDe || "") + ")"; }).join(", "));
    }
  },

  async "c1-rh"() {
    const memo = ETAT.memo.c1;
    await reponseRh(REF.c1, memo.messageIdEnvoi, "Validé en RH également.", [
      pj("note-auto-rh-C1.pdf", Buffer.from(memo.c1Rh, "base64"), "application/pdf"),
    ]);
    const apres = await attendreStatut(REF.c1, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", "C1/RH");
    check("C1 · réponse RH achève la matrice → ACCEPTEE", Boolean(apres && apres.statut === "ACCEPTEE"), apres ? "statut=" + apres.statut : "délai dépassé");
    if (apres && apres.statut === "ACCEPTEE") {
      const docs1b = await db.documentDemande.findMany({ where: { demande: { reference: REF.c1 }, recuDe: { contains: "@" } } });
      check("C1 · 3 pièces jointes de réponses en base (2 manager + 1 RH)", docs1b.length === 3, docs1b.map(function (x) { return x.nomFichier; }).join(", "));
    }
    ETAT.horizon.c1 = new Date().toISOString();
    log("  horizon C1 (pour la vérification de livraison) : " + ETAT.horizon.c1);
  },

  async "verif-c1"() {
    const memo = ETAT.memo.c1;
    const livr = await verifierLivraisonZoho(REF.c1, "acceptee", ETAT.horizon.c1);
    verifierPieces(livr, [
      { nom: "justificatif-manager-C1.pdf", contenu: Buffer.from(memo.c1Pdf, "base64") },
      { nom: "planning-service-C1.png", contenu: PNG_MIN },
      { nom: "note-auto-rh-C1.pdf", contenu: Buffer.from(memo.c1Rh, "base64") },
    ], "C1", REF.c1);
  },

  async "c2-rh"() {
    ETAT.memo.c2 = { c2Pdf: pdfUnique("Memo refus C2").toString("base64") };
    const d2 = await creerDemande(REF.c2, "AUTORISATION_SORTIE", "c2");
    ETAT.memo.c2.messageIdEnvoi = d2.messageIdEnvoi;
    await reponseRh(d2.reference, d2.messageIdEnvoi, "Refusée — voir le mémo joint.", [
      pj("memo-refus-C2.pdf", Buffer.from(ETAT.memo.c2.c2Pdf, "base64"), "application/pdf"),
    ]);
    const apres = await attendreStatut(d2.reference, (d) => d.statut === "REFUSEE", "C2/refus RH");
    check("C2 · REFUS IMMÉDIAT (sans attendre le manager)", Boolean(apres && apres.statut === "REFUSEE"), apres ? "statut=" + apres.statut : "délai dépassé");
    check("C2 · refuseePar = RH", Boolean(apres && apres.refuseePar === "RH"), "refuseePar=" + (apres && apres.refuseePar));
    ETAT.horizon.c2 = new Date().toISOString();
    log("  horizon C2 : " + ETAT.horizon.c2);
  },

  async "verif-c2"() {
    const livr = await verifierLivraisonZoho(REF.c2, "refusee", ETAT.horizon.c2);
    verifierPieces(livr, [
      { nom: "memo-refus-C2.pdf", contenu: Buffer.from(ETAT.memo.c2.c2Pdf, "base64") },
    ], "C2", REF.c2);
  },

  async "c3-c4-manager"() {
    ETAT.memo.c3 = {}; ETAT.memo.c4 = {};
    ETAT.memo.c4.c4Mgr = pdfUnique("Justificatif manager C4").toString("base64");
    const d3 = await creerDemande(REF.c3, "CONGE", "c3");
    ETAT.memo.c3.messageIdEnvoi = d3.messageIdEnvoi;
    const d4 = await creerDemande(REF.c4, "CONGE", "c4");
    ETAT.memo.c4.messageIdEnvoi = d4.messageIdEnvoi;
    await reponseManager(d3.reference, d3.messageIdEnvoi, "OK pour moi.", null);
    await reponseManager(d4.reference, d4.messageIdEnvoi, "Accepté, dossier joint.", [
      pj("justificatif.pdf", Buffer.from(ETAT.memo.c4.c4Mgr, "base64"), "application/pdf"),
    ]);
    const a3 = await attendreStatut(REF.c3, (d) => d.decisionManager === "ACCEPTEE", "C3/manager");
    check("C3 · réponse manager SANS pièce jointe détectée", Boolean(a3 && a3.decisionManager === "ACCEPTEE"), a3 ? "mgr=ACCEPTEE" : "délai dépassé");
    const a4 = await attendreStatut(REF.c4, (d) => d.decisionManager === "ACCEPTEE", "C4/manager");
    check("C4 · réponse manager AVEC justificatif détectée", Boolean(a4 && a4.decisionManager === "ACCEPTEE"), a4 ? "mgr=ACCEPTEE" : "délai dépassé");
  },

  async "c3-c4-rh"() {
    await reponseRh(REF.c3, ETAT.memo.c3.messageIdEnvoi, "D'accord, validé.", null);
    await reponseRh(REF.c4, ETAT.memo.c4.messageIdEnvoi, "Validé — même nom de fichier, contenu différent.", [
      pj("justificatif.pdf", PDF_FAUX, "application/pdf"),
    ]);
    const a3 = await attendreStatut(REF.c3, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", "C3/RH");
    check("C3 · acceptation à deux étapes sans PJ inchangée", Boolean(a3 && a3.statut === "ACCEPTEE"), a3 ? "statut=" + a3.statut : "délai dépassé");
    const a4 = await attendreStatut(REF.c4, (d) => d.statut === "ACCEPTEE" && d.decisionRh === "ACCEPTEE", "C4/RH");
    check("C4 · acceptation à deux étapes aboutit", Boolean(a4 && a4.statut === "ACCEPTEE"), a4 ? "statut=" + a4.statut : "délai dépassé");
    ETAT.horizon.c3 = new Date().toISOString();
    ETAT.horizon.c4 = ETAT.horizon.c3;
    log("  horizon C3/C4 : " + ETAT.horizon.c3);
  },

  async "verif-final"() {
    // C3 — PDF signé SEUL
    const livr3 = await verifierLivraisonZoho(REF.c3, "acceptee", ETAT.horizon.c3);
    if (livr3) {
      check("C3 · EXACTEMENT 1 pièce jointe (le PDF signé, aucune autre)", (livr3.pieces || []).length === 1,
        (livr3.pieces || []).map(function (p) { return p.filename; }).join(", ") || "0 pièce");
      const pdf3 = (livr3.pieces || [])[0];
      check("C3 · pièce unique = PDF signé authentique (%PDF)", Boolean(pdf3) && pdf3.content.subarray(0, 4).toString() === "%PDF" && pdf3.filename.indexOf("Acceptation_") === 0,
        pdf3 ? pdf3.filename + " (" + pdf3.content.length + " o)" : "absente");
    } else {
      check("C3 · e-mail de décision présent dans la boîte employé (Zoho)", false, "non reçu");
    }
    // C4 — cumul + dédoublonnage
    const livr4 = await verifierLivraisonZoho(REF.c4, "acceptee", ETAT.horizon.c4);
    if (livr4) {
      const noms4 = (livr4.pieces || []).map(function (p) { return p.filename; });
      check("C4 · les DEUX pièces « justificatif.pdf » transmises (dédoublonnage -2)", noms4.indexOf("justificatif.pdf") >= 0 && noms4.indexOf("justificatif-2.pdf") >= 0, noms4.join(", "));
      const j1 = (livr4.pieces || []).find(function (p) { return p.filename === "justificatif.pdf"; });
      const j2 = (livr4.pieces || []).find(function (p) { return p.filename === "justificatif-2.pdf"; });
      const jM = (livr4.pieces || []).find(function (p) { return sha(p.content) === sha(Buffer.from(ETAT.memo.c4.c4Mgr, "base64")); });
      const jR = (livr4.pieces || []).find(function (p) { return sha(p.content) === sha(PDF_FAUX); });
      check("C4 · version MANAGER transmise (octets exacts, nom quelconque)", Boolean(jM), jM ? jM.filename + " (" + jM.content.length + " o)" : "absente");
      check("C4 · version RH transmise (octets exacts, nom quelconque)", Boolean(jR), jR ? jR.filename + " (" + jR.content.length + " o)" : "absente");
      check("C4 · les deux versions portent des noms DISTINCTS (aucune écrasée)", Boolean(jM && jR && jM.filename !== jR.filename), jM && jR ? jM.filename + " / " + jR.filename : "");
      check("C4 · total 3 pièces (PDF signé + 2 justificatifs)", noms4.length === 3, noms4.join(", "));
    } else {
      check("C4 · e-mail de décision présent dans la boîte employé (Zoho)", false, "non reçu");
    }
    // Historique C1
    const hist1 = await db.demandeAdministrative.findFirst({ where: { reference: REF.c1 }, select: { reponsesRecues: true } });
    let histOk = false, histDetail = "";
    try {
      const tab = JSON.parse(cryptoBd.dechiffrerChamp(hist1.reponsesRecues) || "[]");
      const avecPj = tab.filter(function (e) { return Array.isArray(e.piecesJointes) && e.piecesJointes.length; });
      const avecIds = tab.filter(function (e) { return Array.isArray(e.piecesJointesIds) && e.piecesJointesIds.length; });
      histOk = avecPj.length >= 2 && avecIds.length >= 1;   // ≥1 liaison directe suffit : les copies INBOX+Envoyés d'une même réponse sont dédoublonnées
      histDetail = avecPj.length + " réponse(s) avec PJs, " + avecIds.length + " avec liaisons (ids)";
    } catch (e) { histDetail = e.message.slice(0, 60); }
    check("Historique C1 : réponses + pièces jointes + liaisons (ids) consultables", histOk, histDetail);
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
