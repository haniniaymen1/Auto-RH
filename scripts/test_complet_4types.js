#!/usr/bin/env node
/* ============================================================================
 * TEST COMPLET 4 TYPES × ACCEPTATION/REFUS — v0.2.166 (réponses QUOTÉES)
 * ============================================================================
 * CORRECTION TESTÉE — les réponses Gmail RÉELLES citent l'e-mail original
 * (consigne « Acceptée »/« Refusée » des demandes congé/autorisation, listes
 * ACCEPTER/REFUSER de la transmission RH, « Compensation : Non » du
 * formulaire) → AMBIGUE → statut restait « En attente » (v0.2.165 et avant).
 * Cette campagne APPENDE/ENVOIE des réponses avec le TEXTE RÉEL CITÉ
 * (extrait de la boîte IMAP), exactement comme un client Gmail/Outlook.
 *
 * 8 scénarios RÉELS (Gmail) :
 *   CONGE-A  : manager « OK pour moi » (APPEND INBOX + citation RÉELLE)
 *              PUIS RH « Congé accepté » (SMTP réel + citation transmission)
 *              → ACCEPTEE (matrice 2 étapes)
 *   CONGE-R  : manager « je refuse » (APPEND + citation) → REFUSEE
 *   AUTOR-A  : manager « OK pour moi » (APPEND + citation) PUIS RH « J'accepte »
 *              (SMTP + citation transmission) → ACCEPTEE
 *   AUTOR-R  : manager « NON — je refuse » (APPEND + citation) → REFUSEE
 *   AT-A     : RH (SMTP auto-adressé + citation) « J'accepte … » → ACCEPTEE
 *   AT-R     : manager (APPEND + citation) « Je refuse … » → REFUSEE
 *   AS-A     : RH (SMTP auto-adressé + citation) « J'accepte … » → ACCEPTEE
 *   AS-R     : manager (APPEND + citation) « Je refuse … » → REFUSEE
 *
 * PHASES (résulmable, état dans /tmp/test02166/etat.json) :
 *   preparer | sujets | vague-a | vague-b1 | vague-b2 | vague-c1 | vague-c2
 *   | verifier | nettoyer | rapport
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new (require("@prisma/client").PrismaClient)();
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };
const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";
const MGR_EMP1 = "smtp.test@autorh.tn";
const MDP_PORTAIL = "Test-Zoho!2026";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const CIN_EMPLOYE = "EMPZOH001";
const DELAI_MAX_MS = 60000;
const ETAT_DIR = "/tmp/test02166";
const ETAT_FICHIER = ETAT_DIR + "/etat.json";

const SCENARIOS = [
  { cle: "CONGE-A", type: "CONGE", corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2027-03-01", dateFin: "2027-03-05", commentaire: "Test complet v0.2.165" }, mgrTexte: "OK pour moi, à valider par les RH.", rhTexte: "Congé accepté, bonne préparation.", statutFinal: "ACCEPTEE", deuxEtapes: true },
  { cle: "CONGE-R", type: "CONGE", corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2027-03-10", dateFin: "2027-03-12", commentaire: "Test complet v0.2.165" }, mgrTexte: "Je refuse cette demande.", rhTexte: null, statutFinal: "REFUSEE" },
  { cle: "AUTOR-A", type: "AUTORISATION_SORTIE", corps: { type: "AUTORISATION_SORTIE", date: "2027-03-02", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" }, mgrTexte: "OK pour moi, à valider par les RH.", rhTexte: "J'accepte votre demande d'autorisation.", statutFinal: "ACCEPTEE", deuxEtapes: true },
  { cle: "AUTOR-R", type: "AUTORISATION_SORTIE", corps: { type: "AUTORISATION_SORTIE", date: "2027-03-03", motif: "Rendez-vous médical", nombreHeures: "1", heureSortie: "10:00", heureRetour: "11:00", compensation: "NON" }, mgrTexte: "NON — je refuse cette autorisation.", rhTexte: null, statutFinal: "REFUSEE" },
  { cle: "AT-A", type: "ATTESTATION_TRAVAIL", corps: { type: "ATTESTATION_TRAVAIL" }, mgrTexte: null, rhTexte: "J'accepte votre demande d'attestation de travail.", statutFinal: "ACCEPTEE" },
  { cle: "AT-R", type: "ATTESTATION_TRAVAIL", corps: { type: "ATTESTATION_TRAVAIL" }, mgrTexte: "Je refuse cette demande d'attestation de travail.", rhTexte: null, statutFinal: "REFUSEE" },
  { cle: "AS-A", type: "ATTESTATION_SALAIRE", corps: { type: "ATTESTATION_SALAIRE" }, mgrTexte: null, rhTexte: "J'accepte votre demande d'attestation de salaire.", statutFinal: "ACCEPTEE" },
  { cle: "AS-R", type: "ATTESTATION_SALAIRE", corps: { type: "ATTESTATION_SALAIRE" }, mgrTexte: "Je refuse cette demande d'attestation de salaire.", rhTexte: null, statutFinal: "REFUSEE" },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) { const v = A.indexOf(c.toUpperCase()); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}
function clientHttp(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { ...(corps === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null; try { json = JSON.parse(texte); } catch {}
    return { status: res.status, json, texte };
  };
  return { req, post: (p, c) => req("POST", p, c), get: (p) => req("GET", p) };
}
async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }
function sujetEnvoiDepuisJournal(ref) {
  try {
    const lignes = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/).filter(Boolean);
    for (let i = lignes.length - 1; i >= 0; i--) {
      let e = null; try { e = JSON.parse(lignes[i]); } catch {}
      if (e && e.sujet && String(e.sujet).indexOf(ref) >= 0 && /traitement requis/.test(String(e.sujet))) return String(e.sujet);
    }
  } catch {}
  return null;
}
function chargerEtat() { try { return JSON.parse(fs.readFileSync(ETAT_FICHIER, "utf8")); } catch { return null; } }
function sauverEtat(e) { fs.mkdirSync(ETAT_DIR, { recursive: true }); fs.writeFileSync(ETAT_FICHIER, JSON.stringify(e, null, 1)); }
function journal(e, msg) { e.journal = e.journal || []; const ligne = new Date().toISOString() + " | " + msg; e.journal.push(ligne); console.log("  " + ligne); sauverEtat(e); }

/* (v0.2.166) Recherche le DERNIER e-mail de INBOX dont le sujet contient
 * `contient`, et retourne son corps texte brut RÉEL (pour citer exactement
 * ce qu'un client Gmail/Outlook citerait). Retourne null si introuvable. */
async function fetcherTexteBoite(contient) {
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  try {
    await c.connect();
    const lock = await c.getMailboxLock("INBOX");
    let texte = null;
    try {
      const uids = (await c.search({ header: { subject: contient } }, { uid: true })) || [];
      if (uids.length) {
        const dernier = uids[uids.length - 1];
        const brut = await c.fetchOne(dernier, { source: true }, { uid: true });
        if (brut && brut.source) {
          const parsed = await simpleParser(brut.source);
          texte = (parsed.text || "").trim() || null;
        }
      }
    } finally { lock.release(); }
    await c.logout().catch(() => {});
    return texte;
  } catch { return null; }
}

/* (v0.2.166) Construit la CITATION Gmail FR d'un texte (préfixe « > »). */
function citer(corps) {
  return String(corps || "").split(/\r?\n/).map(function (l) { return l ? "> " + l : ">"; }).join("\n");
}
const ENTETE_CITATION = "Le " + new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "") + " à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ", AutoRH Auto-RH <" + GMAIL_USER + "> a écrit :";

async function appenderReponseManager({ sujetBase, texte, num, citation, inReplyTo }) {
  const sujet = "Re: " + sujetBase;
  const corps = texte + "\n\n" + ENTETE_CITATION + "\n" + citer(citation || "");
  const eml = [
    "Message-ID: <v02166-mgr-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: \"RH Test (Manager)\" <" + MGR_EMP1 + ">",
    "To: <" + GMAIL_USER + ">",
    ...(inReplyTo ? ["In-Reply-To: <" + inReplyTo + ">", "References: <" + inReplyTo + ">"] : []),
    "Subject: " + sujet,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    corps,
    "",
  ].join("\r\n");
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { await c.append("INBOX", Buffer.from(eml, "utf8")); } finally { lock.release(); await c.logout().catch(() => {}); }
}
async function envoyerReponseRh({ sujetBase, texte, citation }) {
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, connectionTimeout: 20000 });
  const corps = texte + (citation ? "\n\n" + ENTETE_CITATION + "\n" + citer(citation) : "");
  const info = await t.sendMail({ from: '"Auto-RH Auto-RH" <' + GMAIL_USER + ">", to: GMAIL_USER, subject: "Re: " + sujetBase, text: corps });
  return info.messageId;
}
async function attendreStatut(e, ref, predicat, label) {
  const t0 = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && predicat(d)) { const delai = Date.now() - t0; e.mesures.push({ ref, label, delaiMs: delai }); sauverEtat(e); return { d, delai }; }
    if (Date.now() - t0 > DELAI_MAX_MS) return { d, delai: null };
    await sleep(2000);
  }
}
async function connexionPortail() {
  const port = clientHttp(PORTAIL);
  let p1 = await port.post("/api/verify", { cin: CIN_EMPLOYE, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p1.status === 200 && p1.json && p1.json.ok)) { await sleep(21000); p1 = await port.post("/api/verify", { cin: CIN_EMPLOYE, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  if (!(p1.status === 200 && p1.json && p1.json.ok)) throw new Error("Connexion portail impossible");
  return port;
}
async function connexionAdmin() {
  const adm = clientHttp(ADMIN);
  const lg = await adm.post("/api/auth/login", SUPERADMIN);
  if (lg.status !== 200) throw new Error("Connexion admin impossible");
  return adm;
}

/* ---------------- PHASES ---------------- */
async function preparer() {
  const e = { version: "0.2.166 (réponses QUOTÉES réelles — correction citations Gmail)", demarre: new Date().toISOString(), scenarios: SCENARIOS.map((s) => ({ cle: s.cle, type: s.type, statutFinal: s.statutFinal, deuxEtapes: !!s.deuxEtapes, mgrTexte: s.mgrTexte, rhTexte: s.rhTexte })), mesures: [], journal: [], smtpRh: [], config: {} };
  console.log("— 0) Santé + configuration réelle —");
  const mc = await db.mailConfig.findFirst();
  e.config = { smtp: mc.host + ":" + mc.port + (mc.secure ? " (SSL)" : ""), from: mc.from, imap: mc.imapHost + ":" + mc.imapPort + (mc.imapSecure ? " (SSL)" : ""), imapActif: mc.imapActif, intervallePollerSec: process.env.AUTO_RH_IMAP_INTERVALLE || "(défaut)", routage: { conge: mc.congeEmail, autorisation: mc.autorisationEmail, attestationTravail: mc.attestationTravailEmail, attestationSalaire: mc.attestationSalaireEmail, rh: mc.rhEmail } };
  journal(e, "config SMTP=" + e.config.smtp + " IMAP=" + e.config.imap + " imapActif=" + e.config.imapActif + " intervalle=" + e.config.intervallePollerSec + "s");
  const pingA = await clientHttp(ADMIN).get("/api/auth/session");
  const pingP = await clientHttp(PORTAIL).get("/");
  journal(e, "services : admin=" + pingA.status + " portail=" + pingP.status);
  if (pingP.status !== 200) throw new Error("Portail :4001 indisponible");

  console.log("— 1) Connexions réelles —");
  const adm = await connexionAdmin(); journal(e, "connexion admin :4000 OK");
  const port = await connexionPortail(); journal(e, "connexion portail :4001 OK (CIN+TOTP)");

  console.log("— 2) Création des 8 demandes via le VRAI portail —");
  for (const s of e.scenarios) {
    const def = SCENARIOS.find((x) => x.cle === s.cle);
    const r = await port.post("/api/demandes", def.corps);
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    s.ref = ref || null;
    journal(e, "création " + s.cle + " → " + (ref || ("ÉCHEC status=" + r.status)));
    await sleep(700);
  }
  if (e.scenarios.some((s) => !s.ref)) { await db.$disconnect(); throw new Error("Création incomplète"); }

  console.log("— 3) Attente des envois SMTP réels (sujets) —");
  for (const s of e.scenarios) {
    let sujet = null; const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const d = await relire(s.ref);
      if (d && d.messageIdEnvoi) { sujet = sujetEnvoiDepuisJournal(s.ref); if (sujet) break; }
      await sleep(3000);
    }
    s.sujetBase = sujet || sujetEnvoiDepuisJournal(s.ref) || ("AutoRH — " + s.type + " " + s.ref + " (traitement requis)");
    journal(e, s.ref + " sujet d'envoi : " + s.sujetBase.slice(0, 80));
  }
  sauverEtat(e);
  console.log("PHASE preparer TERMINÉE — " + e.scenarios.length + " demandes créées.");
  await db.$disconnect();
}

async function sujets() {
  const e = chargerEtat(); if (!e) throw new Error("État absent — lancez d'abord preparer");
  for (const s of e.scenarios) {
    if (s.sujetBase) continue;
    let sujet = null; const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const d = await relire(s.ref);
      if (d && d.messageIdEnvoi) { sujet = sujetEnvoiDepuisJournal(s.ref); if (sujet) break; }
      await sleep(3000);
    }
    s.sujetBase = sujet || sujetEnvoiDepuisJournal(s.ref) || ("AutoRH — " + s.type + " " + s.ref + " (traitement requis)");
    journal(e, s.ref + " sujet complété : " + s.sujetBase.slice(0, 80));
    sauverEtat(e);
  }
  await db.$disconnect();
  console.log("PHASE sujets TERMINÉE");
}

async function vague(nomCles, mode) {
  const e = chargerEtat(); if (!e) throw new Error("État absent — lancez d'abord preparer");
  for (const [i, cle] of nomCles.entries()) {
    const s = e.scenarios.find((x) => x.cle === cle); const def = SCENARIOS.find((x) => x.cle === cle);
    if (mode === "manager") {
      // (v0.2.166) CITATION RÉELLE : le manager répond en citant l'e-mail de
      // la demande — on récupère son TEXTE RÉEL dans la boîte (copie auto-
      // adressée INBOX), exactement ce qu'un client Gmail citerait.
      const citationDemande = await fetcherTexteBoite(s.ref);
      const dEnvoi = await relire(s.ref);
      const inReplyTo = dEnvoi && dEnvoi.messageIdEnvoi ? String(dEnvoi.messageIdEnvoi) : null;
      journal(e, s.ref + " (" + cle + ") citation réelle récupérée : " + (citationDemande ? citationDemande.length + " car." : "INDISPONIBLE (repli sans citation)"));
      await appenderReponseManager({ sujetBase: s.sujetBase, texte: def.mgrTexte, num: i + 1 + (cle.charCodeAt(0) % 7), citation: citationDemande, inReplyTo: inReplyTo });
      journal(e, s.ref + " (" + cle + ") ← réponse manager APPENDÉE (QUOTÉE) : « " + def.mgrTexte + " »" + (inReplyTo ? " + In-Reply-To" : ""));
      await sleep(1500);
      if (def.deuxEtapes) {
        const { d, delai } = await attendreStatut(e, s.ref, (x) => x.decisionManager === "ACCEPTEE", "décision manager " + cle);
        s.mesureManagerMs = delai; s.apresManager = d && d.statut;
        journal(e, s.ref + " décision manager tracée : " + (d && d.decisionManager) + " en " + (delai === null ? "> 60 s (ÉCHEC)" : delai + " ms") + " | statut intermédiaire=" + (d && d.statut));
      } else {
        const { d, delai } = await attendreStatut(e, s.ref, (x) => x.statut === def.statutFinal, "statut final " + cle);
        s.mesureFinalMs = delai; s.statutObtenu = d && d.statut; s.traitePar = d && d.traitePar;
        journal(e, s.ref + " statut final : " + (d && d.statut) + " en " + (delai === null ? "> 60 s (ÉCHEC)" : delai + " ms"));
      }
    } else if (mode === "rh") {
      // (v0.2.166) CITATION RÉELLE de l'e-mail de TRANSMISSION RH (texte réel
      // dans INBOX — listes ACCEPTER/REFUSER incluses, comme Gmail le cite).
      let citationTrans = await fetcherTexteBoite("validation RH requise");
      if (citationTrans && citationTrans.indexOf(s.ref) < 0) citationTrans = await fetcherTexteBoite(s.ref);
      journal(e, s.ref + " (" + cle + ") citation transmission : " + (citationTrans ? citationTrans.length + " car." : "INDISPONIBLE"));
      const mid = await envoyerReponseRh({ sujetBase: s.sujetBase, texte: def.rhTexte, citation: citationTrans });
      e.smtpRh.push({ ref: s.ref, cle: cle, messageId: mid });
      journal(e, s.ref + " (" + cle + ") ← réponse RH envoyée via smtp.gmail.com (auto-adressée) mid=" + String(mid).slice(0, 60));
      await sleep(1500);
      const { d, delai } = await attendreStatut(e, s.ref, (x) => x.statut === def.statutFinal, "statut final RH " + cle);
      s.mesureFinalMs = delai; s.statutObtenu = d && d.statut; s.traitePar = d && d.traitePar; s.decisionRh = d && d.decisionRh;
      journal(e, s.ref + " statut final : " + (d && d.statut) + " en " + (delai === null ? "> 60 s (ÉCHEC)" : delai + " ms"));
    }
    sauverEtat(e);
  }
  await db.$disconnect();
  console.log("PHASE TERMINÉE (" + nomCles.join(", ") + " / " + mode + ")");
}

async function verifier() {
  const e = chargerEtat(); if (!e) throw new Error("État absent");
  const adm = await connexionAdmin();
  const port = await connexionPortail();
  const listeAdm = await adm.get("/api/demandes");
  const lignesAdm = (listeAdm.json && (listeAdm.json.items || listeAdm.json.demandes || listeAdm.json.d)) || [];
  const listePort = await port.get("/api/mes-demandes");
  const lignesPort = (listePort.json && listePort.json.items) || [];
  console.log("admin renvoie " + lignesAdm.length + " demandes | portail renvoie " + lignesPort.length);
  for (const s of e.scenarios) {
    const attendu = s.statutFinal;
    const a = lignesAdm.find((x) => x.reference === s.ref);
    const p = lignesPort.find((x) => x.reference === s.ref);
    s.verifAdmin = !!(a && a.statut === attendu);
    s.verifPortail = !!(p && (p.statut === attendu || (p.statutLibelle || "").match(/Accept/i && attendu === "ACCEPTEE" ? /Accept/i : /Refus/i)));
    s.statutAdminVu = a && a.statut; s.statutPortailVu = p && p.statut;
    s.libellePortailVu = p && p.statutLibelle;
    journal(e, s.ref + " (" + s.cle + ") interface admin=" + s.verifAdmin + " (" + s.statutAdminVu + ") | portail=" + s.verifPortail + " (" + s.statutPortailVu + " / " + s.libellePortailVu + ")");
  }
  sauverEtat(e);
  await db.$disconnect();
  console.log("PHASE verifier TERMINÉE");
}

async function nettoyer() {
  const etats = [];
  for (const nom of ["etat.json", "etat-campagne-1.json"]) {
    try { const e = JSON.parse(fs.readFileSync(ETAT_DIR + "/" + nom, "utf8")); if (e && e.scenarios) etats.push(e); } catch {}
  }
  if (!etats.length) return console.log("Aucun état à nettoyer");
  const e = etats[0];
  console.log("— Suppression des demandes de test (" + etats.length + " campagne(s)) —");
  for (const et of etats) {
    for (const s of et.scenarios) {
      if (!s.ref) continue;
      try { await db.demandeAdministrative.delete({ where: { reference: s.ref } }); journal(e, "supprimée " + s.ref); }
      catch (err) { journal(e, "suppression " + s.ref + " : " + err.message.slice(0, 80)); }
    }
  }
  console.log("— Purge des e-mails de test Gmail (INBOX + Envoyés) —");
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false, mailboxNormalize: false });
  await c.connect();
  let boiteSent = "[Gmail]/Messages envoyés";
  try {
    const lst = await c.list();
    const sent = lst.find((b) => b.specialUse === "\\Sent");
    if (sent) boiteSent = sent.path;
  } catch {}
  const boites = ["INBOX", boiteSent];
  for (const boite of boites) {
    try {
      const lock = await c.getMailboxLock(boite);
      try {
        const uids = new Set();
        for (const et of etats) {
          for (const s of et.scenarios) {
            if (!s.ref) continue;
            for (const uid of await c.search({ header: { subject: s.ref } }) || []) uids.add(uid);
          }
          for (const m of et.smtpRh || []) {
            const partie = String(m.messageId || "").replace(/[<>]/g, "").split("@")[0];
            if (partie) for (const uid of await c.search({ header: { "message-id": partie } }) || []) uids.add(uid);
          }
        }
        for (const uid of await c.search({ header: { "message-id": "v02166-" } }) || []) uids.add(uid);
        for (const uid of await c.search({ header: { "message-id": "v02165-" } }) || []) uids.add(uid);
        for (const uid of await c.search({ header: { subject: "Témoin survie v02165" } }) || []) uids.add(uid);
        if (uids.size) { await c.messageDelete([...uids], { uid: true }); journal(e, boite + " : " + uids.size + " message(s) de test supprimé(s)"); }
        else journal(e, boite + " : aucun message de test");
      } finally { lock.release(); }
    } catch (err) { journal(e, boite + " : " + err.message.slice(0, 80)); }
  }
  await c.logout().catch(() => {});
  const total = await db.demandeAdministrative.count();
  const att = await db.demandeAdministrative.count({ where: { statut: "EN_ATTENTE" } });
  journal(e, "état final base : " + total + " demande(s), " + att + " EN_ATTENTE");
  e.nettoyeLe = new Date().toISOString();
  sauverEtat(e);
  await db.$disconnect();
  console.log("PHASE nettoyer TERMINÉE — base : " + total + " demandes, " + att + " EN_ATTENTE");
}

async function rapport() {
  const e = chargerEtat(); if (!e) return console.log("Aucun état");
  console.log("=== RAPPORT ===");
  for (const s of e.scenarios) {
    console.log(JSON.stringify({ cle: s.cle, ref: s.ref, statutFinalAttendu: s.statutFinal, statutObtenu: s.statutObtenu || s.apresManager || null, mgrMs: s.mesureManagerMs || null, finalMs: s.mesureFinalMs || null, traitePar: s.traitePar || null, admin: s.verifAdmin, portail: s.verifPortail, statutAdminVu: s.statutAdminVu, statutPortailVu: s.statutPortailVu, libellePortailVu: s.libellePortailVu }));
  }
  console.log("mesures brutes:", JSON.stringify(e.mesures));
  console.log("config:", JSON.stringify(e.config));
}

const phase = process.argv[2];
(async () => {
  if (phase === "preparer") await preparer();
  else if (phase === "sujets") await sujets();
  else if (phase === "vague-a2") await vague(["AUTOR-R"], "manager");
  else if (phase === "vague-a") await vague(["CONGE-R", "AUTOR-R"], "manager");
  else if (phase === "vague-b1") await vague(["CONGE-A", "AUTOR-A"], "manager");
  else if (phase === "vague-b2") await vague(["CONGE-A", "AUTOR-A"], "rh");
  else if (phase === "vague-c1") await vague(["AT-R", "AS-R"], "manager");
  else if (phase === "vague-c2") await vague(["AT-A", "AS-A"], "rh");
  else if (phase === "verifier") await verifier();
  else if (phase === "nettoyer") await nettoyer();
  else if (phase === "rapport") await rapport();
  else { console.log("Phases : preparer | vague-a | vague-b1 | vague-b2 | vague-c1 | vague-c2 | verifier | nettoyer | rapport"); }
  process.exit(0);
})().catch((er) => { console.error("ERREUR FATALE (" + phase + ") : " + (er && er.stack || er)); process.exit(1); });
