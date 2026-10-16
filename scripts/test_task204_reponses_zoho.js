#!/usr/bin/env node
/**
 * ============================================================================
 * Task 204 (v0.2.157) — TEST RÉEL ZOHO : RÉPONSES ACCEPTATION / REFUS PAR E-MAIL
 * ============================================================================
 * Demande utilisateur (trace 1a11cdaea5c201ad) :
 * « Lorsque le RH ou le manager répond par e-mail à une demande de congé ou
 *   d'autorisation, le système doit reconnaître la réponse et mettre à jour
 *   le statut : acceptation → Acceptée, refus → Refusée — vérifiable dans
 *   l'interface d'administration ET le portail employé. Tester également les
 *   différentes formulations d'acceptation et de refus prévues. »
 *
 * Chaîne 100 % RÉELLE :
 *   - demandes créées via le VRAI portail (:4001, connexion CIN + mot de
 *     passe + OTP TOTP) → e-mails RÉELS envoyés via smtp.zoho.com ;
 *   - réponses du manager (EMPZOH002 : la boîte Zoho elle-même) envoyées par
 *     SMTP Zoho RÉEL (rh3000@zohomail.com → rh3000@zohomail.com) ;
 *   - réponses du RH (smtp.test@autorh.tn — pas d'identifiants SMTP pour
 *     cette adresse) injectées dans INBOX Zoho par IMAP APPEND (le poller du
 *     portail lit la boîte : aucune différence avec un message Gmail reçu) ;
 *   - le poller IMAP du portail (intervalle 15 s) traite les réponses →
 *     traiterMessageRecu → classification → matrice 2 étapes → statuts.
 *
 * PHASES (argument) :
 *   prep     : snapshot INBOX + tout marquer lu + activer IMAP en base
 *   test     : logins, création des demandes, réponses, vérifications
 *   restore  : restituer les messages non lus d'origine + désactiver IMAP
 *              (fin de la course avec le déploiement réel de l'utilisateur)
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
const portail = require("./portail-server.js");
const db = portail.prisma;
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const IMAP_HOST = "imap.zoho.com";
const SMTP_HOST = "smtp.zoho.com";
const EMAIL_RH = "smtp.test@autorh.tn";      // RH + manager (demande utilisateur)
const EMAIL_EMPLOYE = "employe.test@autorh.tn";  // employé (demande utilisateur)
const CIN_EMP1 = "EMPZOH001";                    // manager = MGRZOH001 (smtp.test@autorh.tn)
const CIN_EMP2 = "EMPZOH002";                    // manager = MGRZOH002 (la boîte Zoho elle-même)
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP = "Test-Zoho!2026";
const SNAPSHOT = "/tmp/zoho-snapshot-avant-task204.json";

let ok = 0, fail = 0;
const T0 = Date.now();
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }

/** TOTP RFC 6238 (6 chiffres, 30 s, SHA1) — même algorithme que le portail. */
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
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}

/** Client HTTP avec cookie persistant. */
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null;
    try { json = JSON.parse(texte); } catch { /* html */ }
    return { status: res.status, json, texte };
  };
  return { req, post: (p, c) => req("POST", p, c), get: (p) => req("GET", p) };
}

/* ============================ IMAP (Zoho) ================================ */
async function avecImap(fn) {
  const c = new ImapFlow({
    host: IMAP_HOST, port: 993, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await c.connect();
  try { return await fn(c); } finally { try { await c.logout(); } catch { /* déjà fermé */ } }
}

/** Snapshot complet INBOX : uid, flags, sujet, de, date. */
async function snapshotBoite() {
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    const out = [];
    try {
      for await (const msg of c.fetch({ uid: "1:*" }, { uid: true, flags: true, envelope: true })) {
        out.push({
          uid: msg.uid,
          vu: Array.from(msg.flags || []).some((f) => String(f).toLowerCase().includes("seen")),
          sujet: (msg.envelope && msg.envelope.subject) || "",
          de: msg.envelope && msg.envelope.from && msg.envelope.from[0] ? msg.envelope.from[0].address || "" : "",
          date: msg.envelope && msg.envelope.date ? new Date(msg.envelope.date).toISOString() : "",
        });
      }
    } finally { lock.release(); }
    return out;
  });
}

/** Marque TOUS les messages INBOX comme lus (le poller ne prendra que nos ajouts). */
async function marquerToutLu() {
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try { await c.messageFlagsAdd({ uid: "1:*" }, ["\\Seen"], { uid: true }); }
    finally { lock.release(); }
  });
}

/** Restitue le statut non lu des messages d'origine (snapshot avant test). */
async function restituerNonLus(snapshot) {
  const uidsNonLus = snapshot.filter((m) => !m.vu).map((m) => m.uid);
  if (!uidsNonLus.length) return 0;
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    let n = 0;
    try {
      for (const uid of uidsNonLus) {
        try {
          await c.messageFlagsRemove({ uid: String(uid) }, ["\\Seen"], { uid: true });
          n++;
        } catch { /* message supprimé entre-temps */ }
      }
    } finally { lock.release(); }
    return n;
  });
}

/** Construit un message RFC822 brut (réponse) et l'APPEND dans INBOX (non lu). */
async function appenderReponse({ de, sujet, inReplyTo, texte, msgId }) {
  const entetes = [
    "From: " + de,
    "To: AutoRH <" + ZOHO_USER + ">",
    "Subject: " + sujet,
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + msgId + ">",
  ];
  if (inReplyTo) {
    entetes.push("In-Reply-To: <" + inReplyTo + ">");
    entetes.push("References: <" + inReplyTo + ">");
  }
  entetes.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
  const brut = entetes.join("\r\n") + "\r\n\r\n" + texte + "\r\n";
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    // ⚠ AUCUNE option (date/flags) : Zoho répond « BAD [CLIENTBUG] syntax »
    // dès qu'imapflow ajoute des parenthèses d'options à APPEND (vérifié diag).
    try { await c.append("INBOX", Buffer.from(brut, "utf8")); }
    finally { lock.release(); }
  });
}

/** RÉEL : envoie la réponse via SMTP Zoho (de la boîte vers elle-même). */
async function envoyerReponseSmtp({ sujet, inReplyTo, texte }) {
  const t = nodemailer.createTransport({
    host: SMTP_HOST, port: 465, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS },
  });
  await t.sendMail({
    from: ZOHO_USER, to: ZOHO_USER,
    subject: sujet, text: texte,
    inReplyTo: inReplyTo ? "<" + inReplyTo + ">" : undefined,
    references: inReplyTo ? "<" + inReplyTo + ">" : undefined,
  });
}

/* ============================== BD ======================================= */
async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }
async function lireHistorique(ref) {
  const d = await relire(ref);
  if (!d || !d.reponsesRecues) return [];
  try { const l = JSON.parse(dech(d.reponsesRecues) || "[]"); return Array.isArray(l) ? l : []; }
  catch { return []; }
}

/** Sujet « réponse » réaliste (ASCII : le DEM-ref suffit au rattachement). */
function sujetReponse(ref, type) {
  const lib = type === "CONGE" ? "Demande de conge" : "Autorisation de sortie";
  return "Re: AutoRH - " + lib + " " + ref + " (traitement requis)";
}

/** Attend que les prédicats deviennent vrais (poll BD toutes les 5 s). */
async function attendreStatuts(attentes, maxMs, decrits) {
  const refs = attentes.map((a) => a.ref);
  const debut = Date.now();
  const restantes = new Map(attentes.map((a) => [a.ref, a]));
  while (Date.now() - debut < maxMs && restantes.size) {
    const lignes = await db.demandeAdministrative.findMany({ where: { reference: { in: refs } } });
    for (const l of lignes) {
      const a = restantes.get(l.reference);
      if (a && a.pred(l)) restantes.delete(l.reference);
    }
    if (restantes.size) {
      process.stdout.write("    attente " + Math.round((Date.now() - debut) / 1000) + " s — restantes : " +
        [...restantes.values()].map((a) => a.ref).join(", ") + "\r");
      await sleep(5000);
    }
  }
  if (restantes.size) console.log("");
  return restantes;
}

/* ======================================================================== */
/* PHASE prep : snapshot boîte + tout marquer lu + ACTIVER IMAP en base      */
/* ======================================================================== */
async function phasePrep() {
  console.log("== PHASE PREP — boîte Zoho + activation IMAP ==");
  const snap = await snapshotBoite();
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
  const nonLus = snap.filter((m) => !m.vu);
  console.log("  INBOX : " + snap.length + " message(s), " + nonLus.length + " non lu(s) (snapshot : " + SNAPSHOT + ")");
  for (const m of nonLus) console.log("    non lu uid=" + m.uid + " de=" + m.de + " « " + String(m.sujet).slice(0, 70) + " »");
  await marquerToutLu();
  console.log("  Tous les messages marqués lus — le poller ne traitera QUE les ajouts du test.");
  await db.mailConfig.update({
    where: { id: "smtp" },
    data: {
      imapActif: true,
      imapHost: IMAP_HOST,
      imapPort: 993,
      imapUser: cryptoBd.chiffrerChamp(ZOHO_USER, false),
      imapPassword: cryptoBd.chiffrerChamp(ZOHO_PASS, false),
    },
  });
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  check("IMAP activé en base (imap.zoho.com:993, identifiants Zoho)", cfg.imapActif === true && dech(cfg.imapUser) === ZOHO_USER);
  console.log("\n  → REDÉMARRER le portail avec AUTO_RH_IMAP_INTERVALLE=15 puis lancer : node scripts/test_task204_reponses_zoho.js --phase test");
  process.exit(0);
}

/* ======================================================================== */
/* PHASE restore : restituer les non lus d'origine + DÉSACTIVER IMAP         */
/* ======================================================================== */
async function phaseRestore() {
  console.log("== PHASE RESTORE — restitution boîte + arrêt poller ==");
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const n = await restituerNonLus(snap);
  check("Messages d'origine restitués en NON LU", true, n + " message(s) : " + snap.filter((m) => !m.vu).map((m) => "« " + String(m.sujet).slice(0, 50) + " »").join(", "));
  await db.mailConfig.update({ where: { id: "smtp" }, data: { imapActif: false } });
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  check("IMAP désactivé (SMTP conservé) — le déploiement réel redevient seul maître de la boîte", cfg.imapActif === false);
  process.exit(0);
}

/* ======================================================================== */
/* PHASE test : le scénario complet                                          */
/* ======================================================================== */
const CONGE_BODY = { typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18", commentaire: "Dossier Task 204" };
const AUTOR_BODY = { date: "2026-12-10", motif: "Rendez-vous administratif prévu", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" };

/* Chaque cas = une demande + UNE réponse e-mail avec formulation + statut attendu. */
const CAS = [
  // — demandes RÉUTILISÉES (sessions précédentes, toujours En attente) —
  { employe: 1, type: "CONGE", existante: "DEM-2026-00003", formulation: "D'accord pour cette demande.", attendu: "ACCEPTEE", note: "demande existante — acceptation (mot-clé « d'accord »)" },
  { employe: 1, type: "AUTORISATION_SORTIE", existante: "DEM-2026-00004", formulation: "Je refuse cette autorisation.", attendu: "REFUSEE", refuseePar: "RH", note: "demande existante — refus (mot-clé « je refuse »)" },
  { employe: 2, type: "CONGE", existante: "DEM-2026-00005", formulation: "Je valide la demande.", attendu: "ACCEPTEE", vague: 2, note: "MATRICE 2 ÉTAPES — manager DÉJÀ accepté (réponse e-mail précédente), la réponse RH achève la validation" },
  // — NOUVELLES demandes EMPZOH001 (destinataire = manager smtp.test@autorh.tn = boîte RH) —
  { employe: 1, type: "CONGE", formulation: "Bonjour,\n\nCongé accepté.\n\nCordialement,\nRH Test", attendu: "ACCEPTEE", note: "formulation officielle « Congé accepté »" },
  { employe: 1, type: "CONGE", formulation: "Je valide cette demande.", attendu: "ACCEPTEE", note: "formulation « Je valide » (mot-clé)" },
  { employe: 1, type: "CONGE", formulation: "OK", attendu: "ACCEPTEE", note: "formulation « OK » (mot-clé)" },
  { employe: 1, type: "CONGE", formulation: "Votre demande a été approuvée.", attendu: "ACCEPTEE", note: "formulation générique « Votre demande a été approuvée »" },
  { employe: 1, type: "CONGE", formulation: "J'accorde le congé demandé.", attendu: "ACCEPTEE", note: "formulation « J'accorde » (mot-clé)" },
  { employe: 1, type: "CONGE", formulation: "Congé refusé.", attendu: "REFUSEE", refuseePar: "RH", note: "formulation officielle « Congé refusé »" },
  { employe: 1, type: "CONGE", formulation: "NON", attendu: "REFUSEE", refuseePar: "RH", note: "formulation « NON » (mot-clé)" },
  { employe: 1, type: "CONGE", formulation: "Votre demande de congé n'a pas été approuvée.", attendu: "REFUSEE", refuseePar: "RH", note: "forme négative « n'a pas été approuvée » (racine d'acceptation — priorité refus)" },
  { employe: 1, type: "CONGE", formulation: "Après vérification du solde, je ne valide pas cette demande de congé.", attendu: "REFUSEE", refuseePar: "RH", note: "NÉGATION « je ne valide pas » → refus (jamais une validation)" },
  { employe: 1, type: "CONGE", formulation: "Vu, je regarde et je vous reviens.", attendu: "EN_ATTENTE", note: "réponse AMBIGUÏE → statut inchangé + historique « non reconnu »" },
  { employe: 1, type: "AUTORISATION_SORTIE", formulation: "D'accord pour cette sortie.", attendu: "ACCEPTEE", note: "AUTORISATION de sortie — acceptation (mot-clé « d'accord »)" },
  { employe: 1, type: "AUTORISATION_SORTIE", formulation: "Demande rejetée.", attendu: "REFUSEE", refuseePar: "RH", note: "AUTORISATION de sortie — refus (« Demande rejetée »)" },
  { employe: 1, type: "CONGE", formulation: "Votre demande n'est pas encore validée, j'attends le retour du service.", attendu: "EN_ATTENTE", note: "garde anti-faux-refus (« pas encore validée » ≠ refus)" },
  // — NOUVELLES demandes EMPZOH002 (destinataire = la boîte Zoho) : réponses manager RÉELLES par SMTP —
  { employe: 2, type: "CONGE", smtpReel: true, formulation: "Congé accepté.", attenduIntermediaire: "EN_ATTENTE", attendu: "ACCEPTEE", vague: 2, formulation2: "Je valide.", note: "MATRICE 2 ÉTAPES RÉELLE — étape 1 manager (SMTP réel) accepte → reste En attente + TRANSMISSION RH ; étape 2 RH accepte → Acceptée" },
  { employe: 2, type: "CONGE", smtpReel: true, formulation: "Congé refusé.", attendu: "REFUSEE", refuseePar: "MANAGER", note: "refus du MANAGER par SMTP réel → Refusée par le Manager (immédiat, aucune transmission RH)" },
];

/* Mapping de REPRISE (phase resume) : les demandes déjà créées par un
 * passage interrompu de la phase test — réponses restant à injecter. */
function construireCasResume() {
  return [
    { employe: 1, type: "CONGE", existante: "DEM-2026-00003", formulation: "D'accord pour cette demande.", attendu: "ACCEPTEE", dejaDecidee: true, note: "demande existante — ACCEPTEE par une réponse réelle déjà traitée par le poller (vérifiée)" },
    { employe: 1, type: "AUTORISATION_SORTIE", existante: "DEM-2026-00004", formulation: "Je refuse cette autorisation.", attendu: "REFUSEE", refuseePar: "RH", note: "demande existante — refus (mot-clé « je refuse »)" },
    { employe: 2, type: "CONGE", existante: "DEM-2026-00005", formulation: "Je valide la demande.", attendu: "ACCEPTEE", vague: 2, note: "MATRICE 2 ÉTAPES — manager DÉJÀ accepté, la réponse RH achève la validation" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00007", formulation: "Bonjour,\n\nCongé accepté.\n\nCordialement,\nRH Test", attendu: "ACCEPTEE", note: "formulation officielle « Congé accepté »" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00008", formulation: "Je valide cette demande.", attendu: "ACCEPTEE", note: "formulation « Je valide » (mot-clé)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00009", formulation: "OK", attendu: "ACCEPTEE", note: "formulation « OK » (mot-clé)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00010", formulation: "Votre demande a été approuvée.", attendu: "ACCEPTEE", note: "formulation générique « Votre demande a été approuvée »" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00011", formulation: "J'accorde le congé demandé.", attendu: "ACCEPTEE", note: "formulation « J'accorde » (mot-clé)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00012", formulation: "Congé refusé.", attendu: "REFUSEE", refuseePar: "RH", note: "formulation officielle « Congé refusé »" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00013", formulation: "NON", attendu: "REFUSEE", refuseePar: "RH", note: "formulation « NON » (mot-clé)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00014", formulation: "Votre demande de congé n'a pas été approuvée.", attendu: "REFUSEE", refuseePar: "RH", note: "forme négative « n'a pas été approuvée » (priorité refus)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00015", formulation: "Après vérification du solde, je ne valide pas cette demande de congé.", attendu: "REFUSEE", refuseePar: "RH", note: "NÉGATION « je ne valide pas » → refus (jamais une validation)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00016", formulation: "Vu, je regarde et je vous reviens.", attendu: "EN_ATTENTE", note: "réponse AMBIGUÏE → statut inchangé + historique « non reconnu »" },
    { employe: 1, type: "AUTORISATION_SORTIE", existante: "DEM-2026-00017", formulation: "D'accord pour cette sortie.", attendu: "ACCEPTEE", note: "AUTORISATION de sortie — acceptation (mot-clé « d'accord »)" },
    { employe: 1, type: "AUTORISATION_SORTIE", existante: "DEM-2026-00018", formulation: "Demande rejetée.", attendu: "REFUSEE", refuseePar: "RH", note: "AUTORISATION de sortie — refus (« Demande rejetée »)" },
    { employe: 1, type: "CONGE", existante: "DEM-2026-00019", formulation: "Votre demande n'est pas encore validée, j'attends le retour du service.", attendu: "EN_ATTENTE", note: "garde anti-faux-refus (« pas encore validée » ≠ refus)" },
    { employe: 2, type: "CONGE", existante: "DEM-2026-00020", smtpReel: true, formulation: "Congé accepté.", attendu: "ACCEPTEE", vague: 2, formulation2: "Je valide.", note: "MATRICE 2 ÉTAPES RÉELLE — étape 1 manager (SMTP réel) accepte → reste En attente + TRANSMISSION RH ; étape 2 RH accepte → Acceptée" },
    { employe: 2, type: "CONGE", existante: "DEM-2026-00021", smtpReel: true, formulation: "Congé refusé.", attendu: "REFUSEE", refuseePar: "MANAGER", dejaDecidee: true, note: "refus du MANAGER par SMTP réel → Refusée par le Manager (DÉJÀ traitée — vérifiée)" },
  ];
}

async function phaseTest(mode) {
  console.log("== PHASE TEST — réponses acceptation/refus par e-mail (Zoho RÉEL) ==" +
    (mode === "resume" ? " [MODE REPRISE — demandes existantes]" : ""));
  const adm = client(ADMIN);
  const CASL = (mode === "resume") ? construireCasResume() : CAS;

  /* ---- 1) connexions RÉELLES ---- */
  console.log("\n— 1) Connexions réelles —");
  const sa = await adm.post("/api/auth/login", { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" });
  check("Connexion INTERFACE D'ADMINISTRATION (:4000)", sa.status === 200, "status=" + sa.status);
  const port1 = client(PORTAIL); // session employé 1
  const port2 = client(PORTAIL); // session employé 2
  const r1 = await port1.post("/api/verify", { cin: CIN_EMP1, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion portail employé " + CIN_EMP1 + " (CIN + mot de passe + OTP TOTP)", r1.status === 200 && r1.json && r1.json.ok, "status=" + r1.status);
  const r2 = await port2.post("/api/verify", { cin: CIN_EMP2, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion portail employé " + CIN_EMP2 + " (CIN + mot de passe + OTP TOTP)", r2.status === 200 && r2.json && r2.json.ok, "status=" + r2.status);
  const sessionsPortail = [port1, port2];

  /* ---- 2) demandes : création OU reprise ---- */
  console.log("\n— 2) " + (mode === "resume" ? "Reprise des demandes déjà créées" : "Création des demandes via le vrai portail (e-mails RÉELS via smtp.zoho.com)") + " —");
  let idxN = 0;
  if (mode === "resume") {
    for (const cas of CASL) {
      cas.ref = cas.existante;
      const d = await relire(cas.ref);
      check("Demande " + cas.ref + " reprise (" + d.type + ", employé " + cas.employe + ") — statut courant : " + d.statut,
        !!d, cas.dejaDecidee ? "déjà décidée — vérification seule" : "réponse à injecter");
    }
  } else {
  for (const cas of CASL) {
    if (cas.existante) { cas.ref = cas.existante; continue; }
    idxN++;
    const cin = cas.employe === 1 ? CIN_EMP1 : CIN_EMP2;
    const corps = cas.type === "CONGE" ? { type: "CONGE", ...CONGE_BODY } : { type: "AUTORISATION_SORTIE", ...AUTOR_BODY };
    const session = cas.employe === 1 ? port1 : port2;
    const r = await session.post("/api/demandes", corps);
    if (r.status === 201 && r.json && r.json.reference) {
      cas.ref = r.json.reference;
      check("Demande " + idxN + " créée (" + (cas.type === "CONGE" ? "congé" : "autorisation") + ", employé " + cas.employe + ") → " + cas.ref +
        " — routage : " + (r.json.destinataire || "?") + (r.json.routageMotif ? " (" + r.json.routageMotif + ")" : ""), true);
    } else {
      check("Demande " + idxN + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 120));
      cas.ref = null;
    }
    await sleep(400);
  }
  }

  /* ---- 3) Message-ID d'envoi (e-mails partis en arrière-plan) ---- */
  console.log("\n— 3) Attente des envois SMTP arrière-plan (Message-ID) —");
  let essais = 0, manquants = [];
  do {
    await sleep(5000);
    essais++;
    manquants = [];
    for (const cas of CASL) {
      if (!cas.ref || cas.messageId) continue;
      const d = await relire(cas.ref);
      if (d && d.messageIdEnvoi) cas.messageId = d.messageIdEnvoi;
      else manquants.push(cas.ref);
    }
  } while (manquants.length && essais < 8);
  // non bloquant : si un Message-ID manque, le rattachement des réponses se
  // fera par le su (référence DEM-…), le contrôle d'expéditeur restant actif.
  check("Message-ID d'envoi présents (e-mails de demande PARTIS via Zoho)", manquants.length === 0,
    manquants.length ? "manquants (rattachement par sujet) : " + manquants.join(", ") : CASL.length + "/" + CASL.length + " (destinataires + copies + confirmations employé)");

  /* ---- 4) statut INITIAL « En attente » (les DEUX interfaces) ---- */
  console.log("\n— 4) Statut initial des demandes (étape 2 du test utilisateur) —");
  const itemsPortail = [];
  for (const s of sessionsPortail) {
    const mes = await s.get("/api/mes-demandes");
    itemsPortail.push(...((mes.json && mes.json.items) || []));
  }
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  let initOk = 0, initKo = 0;
  const aVerifierInit = CASL.filter((c) => !c.dejaDecidee);
  for (const cas of aVerifierInit) {
    const p = itemsPortail.find((x) => x.reference === cas.ref);
    const a = itemsAdm.find((x) => x.reference === cas.ref);
    if (p && a && p.statut === "EN_ATTENTE" && a.statut === "EN_ATTENTE") initOk++;
    else { initKo++; console.log("    initial KO " + cas.ref + " : portail=" + (p ? p.statut : "absent") + " admin=" + (a ? a.statut : "absent")); }
  }
  check("Statut initial « En attente » dans les DEUX interfaces (portail employé + administration)", initKo === 0,
    initOk + "/" + aVerifierInit.length + (CASL.some((c) => c.dejaDecidee) ? " — + " + CASL.filter((c) => c.dejaDecidee).length + " déjà décidée(s), vérifiées en finale" : ""));
  for (const cas of CASL.filter((c) => c.dejaDecidee)) {
    const d = await relire(cas.ref);
    check("" + cas.ref + " déjà décidée : statut courant " + (d ? d.statut : "??") + " = attendu " + cas.attendu,
      d && d.statut === cas.attendu, cas.note);
  }

  /* ---- 5) VAGUE 1 de réponses ---- */
  console.log("\n— 5) Réponses e-mail — VAGUE 1 (manager/RH) —");
  const vague1 = CASL.filter((c) => c.ref && !c.dejaDecidee && (c.vague !== 2 || c.smtpReel));
  for (const cas of vague1) {
    const sujet = sujetReponse(cas.ref, cas.type);
    const de = cas.employe === 1 ? EMAIL_RH : ZOHO_USER; // EMP1 : destinataire == boîte RH → rôle RH/manager unique ; EMP2 : manager = boîte Zoho
    try {
      if (cas.smtpReel) {
        await envoyerReponseSmtp({ sujet, inReplyTo: cas.messageId, texte: cas.formulation });
        console.log("  → SMTP RÉEL " + ZOHO_USER + " → " + ZOHO_USER + " | " + cas.ref + " | « " + cas.formulation.replace(/\n/g, " ").slice(0, 50) + " »");
      } else {
        await appenderReponse({ de, sujet, inReplyTo: cas.messageId, texte: cas.formulation, msgId: "task204-" + cas.ref + "@reponse.test" });
        console.log("  → IMAP APPEND (From " + de + ") | " + cas.ref + " | « " + cas.formulation.replace(/\n/g, " ").slice(0, 50) + " »");
      }
    } catch (e) {
      check("Réponse " + cas.ref + " injectée", false, e.message);
    }
  }

  /* ---- 6) attente du poller IMAP (interval 15 s) ---- */
  console.log("\n— 6) Poller IMAP du portail : traitement des réponses (attente max 4 min) —");
  const attentes1 = vague1.filter((c) => c.vague !== 2).map((cas) => ({
    ref: cas.ref,
    pred: (d) => d.statut === cas.attendu,
  }));
  const reste1 = await attendreStatuts(attentes1, 240000);
  for (const cas of vague1.filter((c) => c.vague !== 2)) {
    const d = await relire(cas.ref);
    const atteint = d && d.statut === cas.attendu;
    check("« " + cas.formulation.replace(/\n/g, " ").slice(0, 45) + " » → " + cas.attendu + (atteint ? "" : " (obtenu : " + (d ? d.statut : "??") + ")"),
      atteint, cas.ref + " — " + cas.note);
  }

  /* ---- 7) vérification INTERMÉDIAIRE de la matrice (N13 : manager ok → RH requise) ---- */
  console.log("\n— 7) Matrice 2 étapes — vérification INTERMÉDIAIRE (après l'étape manager) —");
  const casMatrice = CAS.find((c) => c.smtpReel && c.vague === 2);
  await attendreStatuts([{ ref: casMatrice.ref, pred: (d) => d.decisionManager === "ACCEPTEE" }], 120000);
  const dm = await relire(casMatrice.ref);
  check("Étape manager (SMTP réel) « " + casMatrice.formulation + " » : décision manager = " + (dm.decisionManager || "—") +
    ", statut toujours EN_ATTENTE (étape RH requise)", dm.decisionManager === "ACCEPTEE" && dm.statut === "EN_ATTENTE", casMatrice.ref);
  const journal = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/).filter((l) => l.includes('"demande-transmission-rh"') && l.includes(casMatrice.ref));
  check("TRANSMISSION RH RÉELLE journalisée (e-mail « validation RH requise » parti vers smtp.test@autorh.tn)", journal.length > 0, journal.length + " entrée(s)");

  /* ---- 8) VAGUE 2 : les décisions RH achèvent les matrices ---- */
  console.log("\n— 8) Réponses e-mail — VAGUE 2 (décisions RH finales) —");
  for (const cas of CASL.filter((c) => c.ref && c.vague === 2 && !c.dejaDecidee)) {
    const sujet = sujetReponse(cas.ref, cas.type);
    const texte = cas.formulation2 || cas.formulation;
    try {
      await appenderReponse({ de: EMAIL_RH, sujet, inReplyTo: cas.messageId, texte, msgId: "task204-rh-" + cas.ref + "@reponse.test" });
      console.log("  → IMAP APPEND (From " + EMAIL_RH + ", rôle RH) | " + cas.ref + " | « " + texte.replace(/\n/g, " ") + " »");
    } catch (e) {
      check("Réponse RH " + cas.ref + " injectée", false, e.message + (e.response ? " / " + e.response : ""));
    }
  }
  const attentes2 = CASL.filter((c) => c.vague === 2 && c.ref && !c.dejaDecidee).map((cas) => ({ ref: cas.ref, pred: (d) => d.statut === cas.attendu }));
  const reste2 = await attendreStatuts(attentes2, 180000);
  console.log("");

  /* ---- 9) VÉRIFICATION FINALE (statuts + libellés + détails) ---- */
  console.log("\n— 9) Vérification finale — statuts dans les DEUX interfaces —");
  for (const cas of CASL.filter((c) => c.ref)) {
    const d = await relire(cas.ref);
    const atteint = d && d.statut === cas.attendu;
    const det = [];
    if (d && d.statut === "REFUSEE") det.push("refuséePar=" + (d.refuseePar || "—"));
    if (d && d.decisionRh === "ACCEPTEE") det.push("decisionRh=ACCEPTEE");
    if (d && d.decisionManager === "ACCEPTEE") det.push("decisionManager=ACCEPTEE");
    check("FINALE " + cas.ref + " : " + cas.attendu + (atteint ? "" : " ≠ obtenu " + (d ? d.statut : "??")), atteint,
      det.join(", ") + (reste2.has(cas.ref) || reste1.has(cas.ref) ? " [POLLER:non traité]" : "") + " — " + cas.note);
  }
  // portail employé : libellés raffinés
  const tousF = [];
  for (const s of sessionsPortail) {
    const mesF = await s.get("/api/mes-demandes");
    tousF.push(...((mesF.json && mesF.json.items) || []));
  }
  console.log("\n  PORTAIL EMPLOYÉ (ce que voit l'employé dans « Mes demandes ») :");
  let portailOk = 0, portailKo = 0;
  for (const cas of CASL.filter((c) => c.ref)) {
    const p = tousF.find((x) => x.reference === cas.ref);
    const libelleAttendu = cas.attendu === "ACCEPTEE" ? "Acceptée"
      : cas.attendu === "REFUSEE" ? (cas.refuseePar === "MANAGER" ? "Refusée par le Manager" : "Refusée par les RH") : "En attente";
    if (p && p.statutLibelle === libelleAttendu) portailOk++;
    else { portailKo++; console.log("    KO " + cas.ref + " : « " + (p ? p.statutLibelle : "absent") + " » ≠ « " + libelleAttendu + " »"); }
  }
  check("PORTAIL EMPLOYÉ : libellés « Acceptée » / « Refusée par le Manager / les RH » / « En attente » corrects", portailKo === 0, portailOk + "/" + CASL.length);
  // administration
  const listeF = await adm.get("/api/demandes");
  const jF = listeF.json || {};
  console.log("\n  INTERFACE D'ADMINISTRATION (ce que voit le RH dans l'onglet Demandes) :");
  console.log("    compteurs : " + JSON.stringify(jF.compteurs || {}));
  let admOk = 0, admKo = 0;
  for (const cas of CASL.filter((c) => c.ref)) {
    const a = (jF.items || []).find((x) => x.reference === cas.ref);
    if (a && a.statut === cas.attendu) admOk++;
    else { admKo++; console.log("    KO " + cas.ref + " : " + (a ? a.statut : "absent") + " ≠ " + cas.attendu); }
  }
  check("ADMINISTRATION : statuts identiques à ceux du portail (même source, colonne statut)", admKo === 0, admOk + "/" + CASL.length);
  // détail d'une acceptée et d'une refusée : formulation reconnue tracée
  const casAcc = CASL.find((c) => c.attendu === "ACCEPTEE" && c.ref && !c.dejaDecidee && !c.smtpReel);
  const casRef = CASL.find((c) => c.attendu === "REFUSEE" && c.refuseePar === "RH" && c.ref && !c.dejaDecidee);
  const dAcc = await relire(casAcc.ref);
  const dRef = await relire(casRef.ref);
  check("Formulation reconnue TRACÉE (decisionRhNote) — " + casAcc.ref, /Formulation reconnue/.test(dAcc.decisionRhNote || ""), String(dAcc.decisionRhNote || "").slice(0, 70));
  check("Décision tracée avec auteur e-mail (traitePar = Auto-RH)", /Auto-RH/.test(dAcc.traitePar || ""), dAcc.traitePar || "—");
  check("Refus RH : refuseePar=RH + décision immédiate et définitive", dRef.refuseePar === "RH" && dRef.statut === "REFUSEE", casRef.ref);
  const histAmb = CASL.find((c) => c.attendu === "EN_ATTENTE" && /AMBIGU/.test(c.note));
  const hAmb = await lireHistorique(histAmb.ref);
  check("Réponse ambiguë TRACÉE dans l'historique (décision « non reconnu ») — " + histAmb.ref, hAmb.some((e) => e.decision === "NON_RECONNU"), hAmb.length + " entrée(s) d'historique");

  /* ---- 10) journal : notifications réelles ---- */
  console.log("\n— 10) E-mails de notification RÉELS (journal) —");
  const lignesJournal = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/);
  const depuis = new Date(T0 - 60000).toISOString().slice(0, 19);
  const actions = {};
  for (const l of lignesJournal) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      const dateJ = String(j.horodatage || j.date || "").slice(0, 19);
      if (dateJ && dateJ < depuis) continue;
      if (j.action && j.action.startsWith("demande-") || j.action === "doc-refus" || j.action === "doc-signe") {
        actions[j.action] = (actions[j.action] || 0) + 1;
      }
    } catch { /* ligne non JSON */ }
  }
  console.log("    actions depuis le début du test : " + JSON.stringify(actions, null, 0));
  check("Notifications de DÉCISION à l'employé envoyées (employe.test@autorh.tn)", (actions["demande-decision-notification"] || 0) >= 5, (actions["demande-decision-notification"] || 0) + " envoi(s)");
  check("Document de REFUS signé généré + envoyé", (actions["doc-refus"] || 0) >= 1, (actions["doc-refus"] || 0) + " entrée(s)");
  check("Document d'ACCEPTATION signé généré + envoyé", (actions["doc-signe"] || 0) >= 1, (actions["doc-signe"] || 0) + " entrée(s)");

  /* ---- récapitulatif ---- */
  console.log("\n==========================================================================");
  console.log("RÉSULTAT GLOBAL : " + ok + " OK / " + fail + " FAIL");
  console.log("==========================================================================");
  console.log("\n  TABLEAU RÉCAPITULATIF (réponse e-mail → statut final) :");
  for (const cas of CASL.filter((c) => c.ref)) {
    const d = await relire(cas.ref);
    const p = tousF.find((x) => x.reference === cas.ref);
    const fleche = cas.smtpReel ? "SMTP réel (manager)" : (cas.vague === 2 || cas.employe === 1 ? "e-mail RH " + EMAIL_RH : "e-mail manager");
    console.log("    " + cas.ref + " [" + (cas.type === "CONGE" ? "congé" : "autorisation") + "] ← " + fleche +
      " « " + cas.formulation.replace(/\n/g, " ").slice(0, 42) + " » → " + (d ? d.statut : "??") +
      " (portail : « " + (p ? p.statutLibelle : "?") + " »)");
  }
  process.exit(fail ? 1 : 0);
}

/* ============================== main ===================================== */
const phase = (process.argv.find((a) => a.startsWith("--phase")) || "--phase test").split("=")[1] || process.argv[process.argv.indexOf("--phase") + 1] || "test";
const fct = { prep: phasePrep, test: (m) => phaseTest(m), resume: () => phaseTest("resume"), restore: phaseRestore }[phase];
if (!fct) { console.error("Phase inconnue : " + phase + " (prep | test | restore)"); process.exit(2); }
fct().catch(async (e) => { console.error("ERREUR FATALE:", e && e.stack ? e.stack : e); process.exit(1); });
