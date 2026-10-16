#!/usr/bin/env node
/**
 * ============================================================================
 * v0.2.178 — PREUVE E2E RÉELLE « Parrainage : acceptation et refus par e-mail »
 * ============================================================================
 * (demande utilisateur : le destinataire de la demande de parrainage répond
 * par acceptation/refus avec le MÊME mécanisme de détection que le congé et
 * l'autorisation — mêmes expressions — mise à jour automatique des statuts +
 * réponse automatique avec le PDF correspondant ; et : masquage du bloc
 * encadré en vert (barre d'étapes Manager→RH) pour congé/autorisation).
 *
 * Conditions RÉELLES (comme la campagne v0.2.173) :
 *   - Gmail employe.test@autorh.tn  = boîte système (SMTP d'envoi + IMAP
 *     pollé toutes les 15 s par le portail réel démarré sur 4001) ;
 *   - Zoho rh3000@zohomail.com      = ADRESSE DÉDIÉE du parrainage (réponses)
 *     ET boîte de notification de l'employé (réceptions des décisions/PDF) ;
 *   - certificat de test éphémère → PDF d'acceptation/refus SIGNÉS.
 *
 * Scénarios :
 *   S1  D1 parrainage → réponse Zoho « J'accepte votre demande » → statut
 *       « Acceptée » IMMÉDIAT (une seule étape), decisionManager=ACCEPTEE,
 *       traitePar « Service parrainage (réponse e-mail) », AUCUNE transmission
 *       RH, e-mail de décision reçu dans Zoho AVEC le PDF d'acceptation signé ;
 *   S2  D2 → réponse Zoho « Refusée » → statut « Refusée » IMMÉDIAT,
 *       refuseePar=PARRAINAGE (affiché « Refusée » partout), e-mail de refus
 *       reçu avec le PDF de refus signé ;
 *   S3  D3 → réponse depuis la boîte RH (Gmail) « D'accord » → décision RH =
 *       autorité finale (voie attestations conservée) → « Acceptée » ;
 *   S4  gardes (module) : expéditeur non autorisé → IGNORÉ ; réponse ambiguë
 *       → AUCUN changement ; consigne « VALIDATION PAR E-MAIL » présente dans
 *       l'e-mail de création du parrainage ;
 *   S5  portail employé : statuts visibles immédiatement (une seule étape),
 *       page /demandes SANS la barre d'étapes (cadre vert) et avec la note
 *       v0.2.177 intacte.
 *
 * Nettoyage complet vérifié (demandes, documents, accès, config, certificat).
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const forge = require("node-forge");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };

const CIN_TEST = "TEST17801";
const MDP_PORTAIL = "Test-178!Pass";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL_EMPLOYE = ZOHO.user; // notifications employé lues dans Zoho
const PORTAIL = process.env.PORTAIL_BASE || "http://localhost:4001";
const CERT_REL = "storage/cert-test-v02178.p12";
const CERT_PASS = "Test-178-cert!";

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log("  OK   " + label); }
  else { KO++; console.log("  FAIL " + label + (detail ? " — " + detail : "")); }
}
function h() { return new Date().toLocaleTimeString("fr-FR"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) {
    const v = A.indexOf(c.toUpperCase());
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const cpt = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(cpt / 2 ** 32), 0);
  buf.writeUInt32BE(cpt >>> 0, 4);
  const mac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = mac[mac.length - 1] & 0xf;
  return String((((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1e6).padStart(6, "0");
}
function hashScrypt(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + crypto.scryptSync(p, salt, 64).toString("hex");
}
function smtpZoho() {
  return nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } });
}
function smtpGmail() {
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } });
}
function clientZoho() {
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false, connectionTimeout: 20000, greetingTimeout: 20000 });
  // JAMAIS laisser un event 'error' non intercepté tuer le processus de test
  c.on("error", () => {});
  return c;
}

/** Cherche dans Zoho un message dont le sujet contient `contient` (depuis t0). */
async function emailZoho(contient, t0, attendreMs = 90000) {
  const fin = Date.now() + attendreMs;
  while (Date.now() < fin) {
    const c = clientZoho();
    try {
      await c.connect();
      try {
        await c.mailboxOpen("INBOX");
        const since = new Date(t0.getTime() - 60000);
        for await (const msg of c.fetch({ since }, { envelope: true, source: true })) {
          const sujet = (msg.envelope && msg.envelope.subject) || "";
          if (sujet.indexOf(contient) >= 0 && new Date(msg.envelope.date || since) >= since) {
            return { sujet, date: msg.envelope.date, source: msg.source };
          }
        }
      } finally { await c.logout().catch(() => {}); }
    } catch (e) { console.log(`    [${h()}] Zoho IMAP : ` + String(e.message || e).slice(0, 60)); }
    await sleep(10000);
  }
  return null;
}

/** Attend en base que `cond(demande)` soit vrai (poller portail 15 s). */
async function attendreStatut(ref, cond, attendreMs = 120000) {
  const fin = Date.now() + attendreMs;
  let derniere = null;
  while (Date.now() < fin) {
    derniere = await db.demandeAdministrative.findUnique({ where: { reference: ref } });
    if (derniere && cond(derniere)) return derniere;
    await sleep(5000);
  }
  return derniere;
}

/** Génère un certificat PKCS#12 auto-signé éphémère (PDF signés de test). */
function creerCertificat(chemin, motDePasse) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = "01" + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - 3600000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: "commonName", value: "Auto-RH Test v0.2.178" }, { name: "organizationName", value: "Auto-RH" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, cert, motDePasse, { algorithm: "3des" });
  fs.writeFileSync(chemin, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
}

// ---- État restauré en fin de campagne --------------------------------------
let cfgAvant = null, sigAvant = null;
let serveur = null;

async function preparer() {
  // Config routage parrainage → Zoho (boîte dédiée de test)
  cfgAvant = await db.mailConfig.findFirst();
  await db.mailConfig.update({ where: { id: cfgAvant.id }, data: { parrainageEmail: cryptoBd.chiffrerChamp(ZOHO.user) } });
  // Certificat éphémère pour la signature des PDF de décision
  creerCertificat(CERT_REL, CERT_PASS);
  sigAvant = await db.signatureApiConfig.findFirst();
  await db.signatureApiConfig.update({
    where: { id: sigAvant.id },
    data: { certChemin: CERT_REL, certMotDePasse: cryptoBd.chiffrerChamp(CERT_PASS) },
  });
  // Accès portail de l'employé (parrain) + fiche de rattrapage (comme v0.2.177)
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: "e2e-178-a.pdf" } });
  await db.payslip.create({
    data: {
      fileName: "e2e-178-a.pdf", storedName: "e2e-178-a.pdf", fileSize: 100,
      content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: "Parrain Test 178", period: "10/2026", netSalary: "1 000,00",
    },
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet, isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false, passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000), qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      nomPrenom: cryptoBd.chiffrerChamp("Parrain Test 178"),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
    },
  });
  console.log("Semé : accès portail " + CIN_TEST + " (notifications → Zoho) + routage parrainage → Zoho + certificat de test.");
}

async function nettoyer() {
  try {
    if (serveur) { try { serveur.kill("SIGTERM"); } catch {} }
    const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
    const dems = await db.demandeAdministrative.findMany({ where: { cin: cinDet }, select: { reference: true } });
    const suppr = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
    await db.portalAccess.deleteMany({ where: { cin: cinDet } });
    await db.payslip.deleteMany({ where: { fileName: "e2e-178-a.pdf" } });
    // Documents de décision générés pendant la campagne
    for (const d of dems) {
      for (const motif of ["Acceptation_parrainage_" + d.reference, "Refus_parrainage_" + d.reference]) {
        for (const f of fs.readdirSync("storage/documents-demandes")) {
          if (f.indexOf(motif) === 0) { try { fs.unlinkSync("storage/documents-demandes/" + f); } catch {} }
        }
      }
    }
    if (cfgAvant) await db.mailConfig.update({ where: { id: cfgAvant.id }, data: { parrainageEmail: cfgAvant.parrainageEmail } });
    if (sigAvant) await db.signatureApiConfig.update({
      where: { id: sigAvant.id },
      data: { certChemin: sigAvant.certChemin, certMotDePasse: sigAvant.certMotDePasse },
    });
    try { fs.unlinkSync(CERT_REL); } catch {}
    console.log(`Nettoyage : ${suppr.count} demande(s) supprimée(s), accès/fiche/config/certificat restaurés.`);
  } catch (e) { console.log("Nettoyage (avertissement) : " + e.message); }
}

/** Connexion portail UNE SEULE FOIS (anti-rejeu OTP : une fenêtre = un code)
 *  — la session est réutilisée pour TOUTES les créations et la lecture. */
async function connecterPortail() {
  const res = await fetch(PORTAIL + "/api/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cin: CIN_TEST, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  if (res.status !== 200) throw new Error("connexion portail: " + res.status);
  return cookie;
}

/** Crée une demande de parrainage via l'API RÉELLE du portail (session fournie). */
async function creerDemandeParrainage(cookie, j) {
  const rep = await fetch(PORTAIL + "/api/demandes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      type: "PARRAINAGE",
      dateParrainage: "2026-11-02",
      operation: "Opération Test 178",
      nomFilleul: "Filleul Test 178",
      telFilleul: "12 345 678",
    }),
  });
  const json = await rep.json();
  if (rep.status !== 201) throw new Error("création demande: " + rep.status + " " + JSON.stringify(json).slice(0, 120));
  j("demande créée via l'API portail : " + json.reference + " (destinataire : " + json.destinataire + ")");
  return json;
}

/** Répond à une demande DEPUIS Zoho (boîte dédiée parrainage) — In-Reply-To. */
async function repondreZoho(ref, texte) {
  const dem = await db.demandeAdministrative.findUnique({ where: { reference: ref }, select: { messageIdEnvoi: true } });
  const irt = dem && dem.messageIdEnvoi ? "<" + dem.messageIdEnvoi.replace(/[<>]/g, "") + ">" : undefined;
  await smtpZoho().sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Demande de parrainage " + ref + " (traitement requis)",
    text: texte,
    ...(irt ? { inReplyTo: irt, references: irt } : {}),
  });
  console.log(`    [${h()} RÉPONSE Zoho] ${ref} — « ${texte.slice(0, 40)} »`);
}
/** Répond DEPUIS la boîte RH (Gmail). */
async function repondreGmail(ref, texte) {
  const dem = await db.demandeAdministrative.findUnique({ where: { reference: ref }, select: { messageIdEnvoi: true } });
  const irt = dem && dem.messageIdEnvoi ? "<" + dem.messageIdEnvoi.replace(/[<>]/g, "") + ">" : undefined;
  await smtpGmail().sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Demande de parrainage " + ref + " (traitement requis)",
    text: texte,
    ...(irt ? { inReplyTo: irt, references: irt } : {}),
  });
  console.log(`    [${h()} RÉPONSE RH Gmail] ${ref} — « ${texte.slice(0, 40)} »`);
}

/**
 * Hygiène de campagne : les anciens messages de test non lus dans Gmail
 * (sujets DEM-… / AutoRH / Auto-RH — générés par les campagnes
 * antérieures) sont marqués LUS. Une demande réutilisant une référence après
 * nettoyage de la base pourrait sinon matcher un VIEUX message resté non lu.
 * Les e-mails personnels (offres d'emploi, alertes…) ne sont PAS touchés.
 */
async function marquerAnciensMessagesLus() {
  for (let essai = 0; essai < 2; essai++) {
    const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false }, logger: false });
    c.on("error", () => {});
    let n = 0;
    try {
      const lock = await c.getMailboxLock("INBOX");
      try {
        const cherche = await c.search({ seen: false }, { uid: true });
        const uids = (cherche || []).slice(-400); // les plus récents d'abord
        if (!uids.length) { lock.release(); try { await c.logout(); } catch {} break; }
        const cibles = [];
        for await (const msg of c.fetch(uids, { envelope: true, uid: true })) {
          const s = (msg.envelope && msg.envelope.subject) || "";
          if (/DEM-\d{4}-\d{5}|AutoRH|Auto-RH/i.test(s)) cibles.push(msg.uid);
        }
        if (cibles.length) { await c.messageFlagsAdd(cibles, ["\\Seen"], { uid: true }); n = cibles.length; }
      } finally { lock.release(); }
      try { await c.logout(); } catch {}
      console.log("    [" + h() + "] Hygiène : " + n + " ancien(s) message(s) de test marqué(s) lu(s) dans Gmail.");
      break;
    } catch (e) {
      try { await c.logout(); } catch {}
      console.log("    (hygiène Gmail essai " + (essai + 1) + " : " + String(e.message || e).slice(0, 60) + ")");
      await sleep(5000);
    }
  }
}

async function main() {
  console.log("== v0.2.178 — parrainage : acceptation/refus par e-mail (E2E réel) ==");
  const t0 = new Date();
  await preparer();

  try {
    // ---- 0) connectivité --------------------------------------------------
    console.log("-- 0 · Connectivité");
    try { await smtpZoho().verify(); check("SMTP smtp.zoho.com:465 (boîte dédiée parrainage)", true, "verify() OK"); }
    catch (e) { check("SMTP smtp.zoho.com:465 (boîte dédiée parrainage)", false, e.message.slice(0, 80)); }
    const cz = clientZoho();
    try { const st = await cz.connect().then(() => cz.mailboxOpen("INBOX")); check("IMAP imap.zoho.com:993 (décisions employé + réponses)", true, st.exists + " messages"); await cz.logout().catch(() => {}); }
    catch (e) { check("IMAP imap.zoho.com:993 (décisions employé + réponses)", false, e.message.slice(0, 80)); }

    // ---- 1) portail réel ----------------------------------------------------
    console.log("-- 1 · Portail réel (4001, poller IMAP 15 s)");
    try { execSync("pkill -f portail-server.js", { stdio: "ignore" }); } catch {}
    await marquerAnciensMessagesLus();
    serveur = spawn("node", ["scripts/portail-server.js"], {
      env: Object.assign({}, process.env, { PORTAL_PORT: "4001", AUTO_RH_IMAP_INTERVALLE: "15" }),
      stdio: ["ignore", fs.openSync("/tmp/portail-178.log", "a"), fs.openSync("/tmp/portail-178.log", "a")],
      detached: false,
    });
    let up = false;
    for (let i = 0; i < 20 && !up; i++) { await sleep(1000); up = await fetch(PORTAIL + "/api/health").then((r) => r.ok).catch(() => false); }
    check("Portail démarré sur 4001 (health OK)", up);
    const cookie = await connecterPortail();

    // ---- 2) S1 : acceptation ------------------------------------------------
    console.log("-- 2 · S1 « J'accepte votre demande » (boîte dédiée Zoho)");
    const d1 = await creerDemandeParrainage(cookie, (m) => console.log("    " + m));
    const ref1 = d1.reference;
    const mailCreation = await emailZoho("parrainage " + ref1, t0, 90000);
    check("S1 · e-mail de création reçu dans la boîte DÉDIÉE (Zoho)", Boolean(mailCreation), mailCreation ? "" : "délai dépassé");
    check("S1 · consigne « VALIDATION PAR E-MAIL » présente dans l'e-mail de création",
      Boolean(mailCreation) && mailCreation.source.toString("utf8").indexOf("VALIDATION PAR E-MAIL") >= 0, "consigne absente");
    await repondreZoho(ref1, "J'accepte votre demande");
    const p1 = await attendreStatut(ref1, (d) => d.statut === "ACCEPTEE");
    check("S1 · statut « Acceptée » IMMÉDIAT (une seule étape, sans réponse RH)", Boolean(p1 && p1.statut === "ACCEPTEE"), p1 ? "statut=" + p1.statut : "délai dépassé");
    check("S1 · decisionManager = ACCEPTEE « Service parrainage (réponse e-mail) »",
      Boolean(p1 && p1.decisionManager === "ACCEPTEE" && String(p1.decisionManagerPar || "").indexOf("Service parrainage") >= 0),
      p1 ? p1.decisionManagerPar : "");
    check("S1 · traitePar = « Service parrainage (réponse e-mail) »", Boolean(p1 && String(p1.traitePar || "").indexOf("Service parrainage") >= 0), p1 ? p1.traitePar : "");
    check("S1 · refuseePar vide (pas un refus)", Boolean(p1 && !p1.refuseePar), p1 ? String(p1.refuseePar) : "");
    const j1t = fs.readFileSync("logs/journal-emails.log", "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((e) => e.reference === ref1 && e.action === "demande-decision-conge").pop();
    check("S1 · AUCUNE transmission aux RH (décision unique)", Boolean(j1t && j1t.transmissionRh === "absente"), j1t ? "transmissionRh=" + j1t.transmissionRh : "journal absent");
    const mail1 = await emailZoho("parrainage acceptée : " + ref1, t0, 120000);
    check("S1 · réponse automatique reçue dans la boîte de l'employé (Zoho)", Boolean(mail1), "délai dépassé");
    check("S1 · PDF d'ACCEPTATION signé joint à la réponse", Boolean(mail1) && mail1.source.toString("latin1").indexOf("Acceptation_parrainage_" + ref1) >= 0, "PDF absent");

    // ---- 3) S2 : refus ------------------------------------------------------
    console.log("-- 3 · S2 « Refusée » (boîte dédiée Zoho)");
    const t2 = new Date();
    const d2 = await creerDemandeParrainage(cookie, (m) => console.log("    " + m));
    const ref2 = d2.reference;
    await repondreZoho(ref2, "Refusée");
    const p2 = await attendreStatut(ref2, (d) => d.statut === "REFUSEE");
    check("S2 · statut « Refusée » IMMÉDIAT (refus = décision définitive)", Boolean(p2 && p2.statut === "REFUSEE"), p2 ? "statut=" + p2.statut : "délai dépassé");
    check("S2 · refuseePar = PARRAINAGE (affiché « Refusée » partout)", Boolean(p2 && p2.refuseePar === "PARRAINAGE"), p2 ? String(p2.refuseePar) : "");
    const mail2 = await emailZoho("parrainage refusée : " + ref2, t2, 120000);
    check("S2 · réponse automatique de REFUS reçue (Zoho)", Boolean(mail2), "délai dépassé");
    check("S2 · PDF de REFUS signé joint à la réponse", Boolean(mail2) && mail2.source.toString("latin1").indexOf("Refus_parrainage_" + ref2) >= 0, "PDF absent");

    // ---- 4) S3 : réponse depuis la boîte RH (Gmail) -------------------------
    console.log("-- 4 · S3 réponse RH (Gmail) « D'accord » — autorité finale (voie attestations)");
    const d3 = await creerDemandeParrainage(cookie, (m) => console.log("    " + m));
    const ref3 = d3.reference;
    await repondreGmail(ref3, "D'accord");
    const p3 = await attendreStatut(ref3, (d) => d.statut === "ACCEPTEE");
    check("S3 · statut « Acceptée » après réponse RH (décision RH = finale)", Boolean(p3 && p3.statut === "ACCEPTEE" && p3.decisionRh === "ACCEPTEE"), p3 ? "statut=" + p3.statut + " decisionRh=" + p3.decisionRh : "délai dépassé");

    // ---- 5) S4 : gardes (module, hors SMTP) ---------------------------------
    console.log("-- 5 · S4 gardes : expéditeur non autorisé + réponse ambiguë");
    const portail = require("./portail-server.js");
    const d4 = await db.demandeAdministrative.findUnique({ where: { reference: ref3 } });
    const avant4 = d4.statut;
    const r4 = await portail.traiterMessageRecu({
      subject: "RE: AutoRH — Demande de parrainage " + ref3 + " (traitement requis)",
      from: { value: [{ address: "intrus.nonautorise@example.tn" }] },
      text: "J'accepte votre demande", attachments: [],
    });
    check("S4 · réponse d'un expéditeur NON autorisé → IGNORÉE", r4 && r4.statut === "IGNORE", JSON.stringify(r4).slice(0, 90));
    const apres4 = await db.demandeAdministrative.findUnique({ where: { reference: ref3 } });
    check("S4 · statut inchangé après la réponse non autorisée", apres4.statut === avant4, avant4 + " → " + apres4.statut);
    const d5 = await creerDemandeParrainage(cookie, (m) => console.log("    " + m));
    const ref5 = d5.reference;
    const r5 = await portail.traiterMessageRecu({
      subject: "RE: AutoRH — Demande de parrainage " + ref5 + " (traitement requis)",
      from: { value: [{ address: ZOHO.user }] },
      text: "OK pour la première semaine, NON pour la seconde", attachments: [],
    });
    check("S4 · réponse AMBIGUË (acceptation ET refus) → ignorée, demande inchangée",
      r5 && r5.decision === "AMBIGUE" && r5.statut === "IGNORE",
      JSON.stringify({ decision: r5.decision, statut: r5.statut }));

    // ---- 6) S5 : portail employé --------------------------------------------
    console.log("-- 6 · S5 portail employé : statuts + cadre vert masqué");
    const liste = await fetch(PORTAIL + "/api/mes-demandes", { headers: { Cookie: cookie } }).then((r) => r.json());
    const items = liste.items || [];
    const i1 = items.find((x) => x.reference === ref1);
    const i2 = items.find((x) => x.reference === ref2);
    const i5 = items.find((x) => x.reference === ref5);
    check("S5 · D1 affichée « Acceptée » (une seule étape — visible immédiatement)", i1 && i1.statutLibelle === "Acceptée" && i1.decisionMasquee === false, i1 ? i1.statutLibelle : "absente");
    check("S5 · D2 affichée « Refusée » (libellé simple, pas « par le Manager »)", i2 && i2.statutLibelle === "Refusée", i2 ? i2.statutLibelle : "absente");
    check("S5 · D5 (ambiguë) reste « En attente »", i5 && i5.statutLibelle === "En attente" && i5.decisionMasquee === false, i5 ? i5.statutLibelle : "absente");
    const page = await fetch(PORTAIL + "/demandes", { headers: { Cookie: cookie } }).then((r) => r.text());
    check("S5 · page /demandes SANS la barre d'étapes (cadre vert masqué)", page.indexOf('class="d-etapes"') < 0, "barre encore rendue");
    check("S5 · note v0.2.177 toujours présente (congé/autorisation)", page.indexOf("Décision finale communiquée après les réponses du manager et du service RH") >= 0, "note absente");
    check("S5 · badge statut final toujours rendu", page.indexOf("statut-final") >= 0 && page.indexOf("st-ACCEPTEE") >= 0, "badge absent");
  } finally {
    await nettoyer();
    try { await db.$disconnect(); } catch {}
  }
  console.log(`\n== BILAN : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e && e.message ? e.message : e);
  await nettoyer();
  try { await db.$disconnect(); } catch {}
  process.exit(1);
});
