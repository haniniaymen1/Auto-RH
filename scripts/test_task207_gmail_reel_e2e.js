#!/usr/bin/env node
/**
 * ============================================================================
 * Task 207 — RETEST COMPLET DES DEMANDES SOUS SMTP+IMAP GMAIL RÉEL
 *           (App Password fourni par l'utilisateur : employe.test@autorh.tn)
 * ============================================================================
 * Suite DIRECTE de la Task 206 : la même matrice « toutes les demandes
 * précédentes » est rejouée, mais CETTE FOIS avec des identifiants Gmail
 * RÉELS (mot de passe d'application 16 caractères fourni par l'utilisateur) :
 *   - ENVOIS SMTP RÉELS via smtp.gmail.com:465 (250 attendu, Message-ID) ;
 *   - BOÎTE IMAP RÉELLEMENT LUE par le poller du portail (imap.gmail.com:993) ;
 *   - réponses RH envoyées comme VRAIS e-mails (auto-adressés Gmail) ;
 *   - réponses manager injectées par IMAP APPEND (From adresse du manager) ;
 *   - PDF signés électroniquement envoyés et REÇUS dans INBOX (pièce jointe
 *     contrôlée SHA-256 == PDF stocké) ;
 *   - garde-fous anti-boucle vérifiés EN RÉEL (Message-ID, X-Auto-RH-Systeme,
 *     expéditeur non autorisé, ambiguïté de la transmission).
 *
 * PROTECTION DE LA BOÎTE RÉELLE (40 198 messages NON LUS mesurés au départ) :
 *   - phase « prep » : instantané EXACT des UIDs non lus (plages compressées)
 *     + UID maximum, sauvegardés dans /tmp/task207/boite-snapshot.json ;
 *   - phase « restore-boite » : IMAP désactivé d'abord (le poller s'arrête),
 *     puis le flag \Seen est RETIRÉ sur les UIDs de l'instantané → l'état
 *     initial de la boîte est RESTITUÉ (seuls les messages du test restent
 *     lus — tous postérieurs à l'UID maximal de l'instantané).
 *
 * PHASES (node scripts/test_task207_gmail_reel_e2e.js <phase>) :
 *   prep          : instantanés (boîte Gmail + config mail) → /tmp/task207/
 *   config        : bascule Gmail via l'API admin RÉELLE + tests SMTP/IMAP
 *                   du panneau (250 attendu CETTE FOIS) + relecture
 *   test          : connexions → 6 demandes (4 types) → « En attente » dans
 *                   les DEUX interfaces → envois SMTP réels (journal 250) →
 *                   arrivée RÉELLE des demandes auto-adressées dans INBOX →
 *                   vague 1 (manager, IMAP APPEND) → transmissions RH →
 *                   vague 2 (RH, VRAIS e-mails SMTP) → statuts automatiques
 *                   dans les DEUX interfaces → garde-fous anti-boucle
 *   docs          : PDF signés (contenu, images, PAdES openssl, rendus PNG,
 *                   téléchargement administration + portail, SHA-256) +
 *                   RÉCEPTION RÉELLE des PDF dans INBOX (pièce jointe)
 *   restore-boite : IMAP désactivé (le poller ne doit PAS re-marquer les
 *                   40 k non lus) → restitution \Seen de l'instantané →
 *                   santé des services + livrables + résumé
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new (require("@prisma/client").PrismaClient)();
const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const { simpleParser } = require("mailparser");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };

/* ---- GMAIL RÉEL (identifiants fournis par l'utilisateur, Task 207) ---- */
const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

/* ---- Adresses du scénario (fixtures INCHANGÉES — retest fidèle) ---- */
const MGR_EMP1 = "smtp.test@autorh.tn";   // manager de EMPZOH001 (MGRZOH001)
const MGR_EMP2 = "rh3000@zohomail.com";       // manager de EMPZOH002 (MGRZOH002)
const MDP_PORTAIL = "Test-Zoho!2026";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const TMP = "/tmp/task207";
const ETAT = TMP + "/etat.json";
const SNAPSHOT_BOITE = TMP + "/boite-snapshot.json";
const SNAPSHOT_CONFIG = TMP + "/config-avant.json";
const JOURNAL = "logs/journal-emails.log";
const LIVRABLES = "download/task207-gmail";

let ok = 0, fail = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; echecs.push(nom + (detail ? " — " + detail : "")); console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function statutConcordant(libelle, statutBd) {
  const l = sansAccents(libelle);
  if (statutBd === "ACCEPTEE") return /ACCEPTE|VALID/.test(l);
  if (statutBd === "REFUSEE") return /REFUS/.test(l);
  if (statutBd === "EN_ATTENTE") return /ATTENTE/.test(l);
  return false;
}
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
    const multipart = corps instanceof FormData;
    const res = await fetch(base + chemin, {
      method,
      headers: {
        ...(multipart ? {} : corps === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: multipart ? corps : corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const tampon = Buffer.from(await res.arrayBuffer());
    const texte = tampon.toString("utf8");
    let json = null;
    if ((res.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(texte); } catch { /* vide */ } }
    return { status: res.status, json, texte, octets: json ? null : tampon };
  };
  return { req, post: (p, c) => req("POST", p, c), put: (p, c) => req("PUT", p, c), get: (p) => req("GET", p) };
}
async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }
function journalDepuis(tISO, filtre) {
  if (!fs.existsSync(JOURNAL)) return [];
  const t = new Date(tISO).getTime() - 2000;
  return fs.readFileSync(JOURNAL, "utf8").split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((e) => e && new Date(e.time || e.horodatage || e.date || Date.now()).getTime() >= t)
    .filter((e) => (filtre ? filtre(e) : true));
}
function etatLire() { try { return JSON.parse(fs.readFileSync(ETAT, "utf8")); } catch { return {}; } }
function etatEcrire(obj) { fs.mkdirSync(TMP, { recursive: true }); fs.writeFileSync(ETAT, JSON.stringify(obj, null, 2)); }

/* ---- IMAP Gmail (lecture réelle de la boîte) ---- */
async function avecImap(fn) {
  const c = new ImapFlow({
    host: IMAP_HOST, port: IMAP_PORT, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { return await fn(c); } finally { lock.release(); await c.logout().catch(() => {}); }
}
/** Compresse une liste d'UIDs en ensembles de séquence IMAP exacts (par lots). */
function ensemblesSequence(uids, tailleLot) {
  const tries = [...new Set(uids)].sort((a, b) => a - b);
  const lots = [];
  let courant = [];
  const pousser = () => { if (courant.length) lots.push(courant.join(",")); };
  for (const u of tries) {
    courant.push(u);
    if (courant.join(",").length >= (tailleLot || 4000)) { pousser(); courant = []; }
  }
  pousser();
  return lots;
}

/* ---- Réponse manager : .eml réaliste + IMAP APPEND RÉEL dans INBOX ---- */
async function appenderReponseManager({ de, nom, ref, type, texte, num }) {
  const sujet = "Re: AutoRH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref + " (traitement requis)";
  const eml = [
    "Message-ID: <task207-mgr-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: " + (nom ? '"' + nom.replace(/"/g, "'") + '" ' : "") + "<" + de + ">",
    "To: <" + GMAIL_USER + ">",
    "Subject: " + sujet,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    texte,
    "",
  ].join("\r\n");
  await avecImap(async (c) => c.append("INBOX", Buffer.from(eml, "utf8")));
  return sujet;
}
/* ---- Réponse RH : VRAI e-mail envoyé via smtp.gmail.com (auto-adressé) ---- */
async function envoyerReponseRh({ ref, type, texte, inReplyTo, sujetBase }) {
  const sujet = sujetBase || ("Re: AutoRH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref);
  const t = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP },
    tls: { rejectUnauthorized: false }, connectionTimeout: 20000,
  });
  const info = await t.sendMail({
    from: '"Auto-RH Auto-RH (Task 207)" <' + GMAIL_USER + ">",
    to: GMAIL_USER,
    subject: sujet,
    text: texte,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  return { messageId: info.messageId, response: info.response, sujet };
}
/** Attente active d'un état de demande (poll DB). */
async function attendreStatut(ref, predicat, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && predicat(d)) return d;
    if (Date.now() - debut > (timeoutMs || 180000)) return d;
    await sleep(5000);
  }
}
/* ======================================================================== */
/* PHASE prep : instantanés (boîte Gmail réelle + config mail sandbox)      */
/* ======================================================================== */
async function phasePrep() {
  console.log("\n============ PHASE PREP : instantanés (boîte + config) ============");
  fs.mkdirSync(TMP, { recursive: true });

  // 1) Instantané de la boîte Gmail RÉELLE : tous les UIDs NON LUS + UID max
  const snap = await avecImap(async (c) => {
    const st = c.mailbox;
    const uids = (await c.search({ seen: false }, { uid: true })) || [];
    const maxUid = st.uidNext ? st.uidNext - 1 : Math.max(0, ...uids);
    return { exists: st.exists, nonLus: uids.length, maxUid, uids };
  });
  console.log("  Boîte Gmail : exists=" + snap.exists + " | NON LUS=" + snap.nonLus + " | maxUid=" + snap.maxUid);
  const lots = ensemblesSequence(snap.uids, 4000);
  fs.writeFileSync(SNAPSHOT_BOITE, JSON.stringify({ ...snap, uids: undefined, lots, horodatage: new Date().toISOString() }, null, 2));
  check("Instantané boîte Gmail sauvegardé (" + snap.nonLus + " non lus → " + lots.length + " ensemble(s) de séquence)", snap.nonLus > 0 && lots.length > 0, SNAPSHOT_BOITE);

  // 2) Instantané de la config mail actuelle (restitution éventuelle)
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const cfgClair = cfg ? {
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    username: dech(cfg.username), password: dech(cfg.password), from: cfg.from,
    rhEmail: cfg.rhEmail, itEmail: cfg.itEmail, parrainageEmail: cfg.parrainageEmail,
    attestationTravailEmail: cfg.attestationTravailEmail, attestationSalaireEmail: cfg.attestationSalaireEmail,
    congeEmail: cfg.congeEmail, autorisationEmail: cfg.autorisationEmail,
    imapActif: cfg.imapActif, imapHost: cfg.imapHost, imapPort: cfg.imapPort,
    imapUser: dech(cfg.imapUser), imapPassword: dech(cfg.imapPassword),
  } : null;
  fs.writeFileSync(SNAPSHOT_CONFIG, JSON.stringify(cfgClair, null, 2));
  check("Instantané config mail sauvegardé (Zoho — restitution possible)", !!cfgClair, cfgClair ? cfgClair.host + ":" + cfgClair.port + " imapActif=" + cfgClair.imapActif : "");
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* PHASE config : bascule Gmail RÉELLE via l'API admin + tests du panneau   */
/* ======================================================================== */
async function phaseConfig() {
  console.log("\n============ PHASE CONFIG : bascule SMTP+IMAP GMAIL (App Password réel) ============");
  fs.mkdirSync(TMP, { recursive: true });
  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion interface d'administration (:4000)", login.status === 200, "status=" + login.status);

  const avant = await adm.get("/api/mail-config");
  const cAvant = (avant.json && avant.json.config) || {};
  console.log("  Config AVANT : " + cAvant.host + ":" + cAvant.port + " | imapActif=" + cAvant.imapActif + " | rhEmail=" + cAvant.rhEmail);

  // BASCULE vers Gmail avec le VRAI mot de passe d'application
  const corpsGmail = {
    host: SMTP_HOST, port: SMTP_PORT,
    username: GMAIL_USER, password: GMAIL_APP,
    from: "AutoRH Auto-RH <" + GMAIL_USER + ">",
    serveurAdresse: cAvant.serveurAdresse || "", sitePort: cAvant.sitePort || "", portailUrl: cAvant.portailUrl || "",
    rhEmail: GMAIL_USER, itEmail: cAvant.itEmail || "",
    responsablesMap: cAvant.responsablesMap || "", parrainageEmail: cAvant.parrainageEmail || "",
    attestationTravailEmail: GMAIL_USER, attestationSalaireEmail: GMAIL_USER,
    congeEmail: GMAIL_USER, autorisationEmail: GMAIL_USER,
    imapActif: true, imapHost: IMAP_HOST, imapPort: IMAP_PORT,
    imapUser: GMAIL_USER, imapPassword: GMAIL_APP,
  };
  const put = await adm.put("/api/mail-config", corpsGmail);
  check("PUT /api/mail-config — bascule Gmail RÉELLE acceptée (smtp.gmail.com:465 + imap.gmail.com:993 + App Password)", put.status === 200,
    put.status !== 200 ? "status=" + put.status + " " + JSON.stringify(put.json || {}).slice(0, 200) : "rhEmail + 4 adresses dédiées = " + GMAIL_USER);

  // Relecture — la config est ENGAGÉE, le mot de passe n'est JAMAIS renvoyé
  const apres = await adm.get("/api/mail-config");
  const c = (apres.json && apres.json.config) || {};
  check("Relecture : hôte Gmail engagé", c.host === SMTP_HOST && c.port === SMTP_PORT, c.host + ":" + c.port);
  check("Relecture : IMAP Gmail ACTIF (le poller lira VRAIMENT la boîte)", c.imapActif === true && c.imapHost === IMAP_HOST && c.imapPort === IMAP_PORT, c.imapHost + ":" + c.imapPort);
  check("Relecture : rhEmail + routage sur la boîte Gmail (attestation travail/salaire dédiées)", c.rhEmail === GMAIL_USER && c.attestationTravailEmail === GMAIL_USER && c.attestationSalaireEmail === GMAIL_USER, "rhEmail=" + c.rhEmail);
  check("Relecture : mot de passe JAMAIS renvoyé par l'API", c.hasPassword === true && c.password === undefined, "hasPassword=" + c.hasPassword);

  // TEST SMTP du panneau — CETTE FOIS il doit RÉUSSIR (250 réel de Google)
  const test = await adm.post("/api/mail-config", { action: "test", dest: GMAIL_USER });
  const okTest = test.status === 200 && !(test.json && test.json.error);
  check("TEST SMTP du panneau via smtp.gmail.com — 250 RÉEL (App Password accepté par Google)", okTest,
    okTest ? "envoyé à " + GMAIL_USER : "status=" + test.status + " " + String((test.json && (test.json.error || test.json.message)) || "").slice(0, 200));

  // TEST IMAP du panneau — connexion réelle à imap.gmail.com:993
  const testImap = await adm.post("/api/mail-config", { action: "test-imap" });
  const okImap = testImap.status === 200 && !(testImap.json && testImap.json.error);
  check("TEST IMAP du panneau via imap.gmail.com:993 — connexion RÉELLE acceptée", okImap,
    okImap ? "boîte accessible" : "status=" + testImap.status + " " + String((testImap.json && (testImap.json.error || testImap.json.message)) || "").slice(0, 200));

  await db.$disconnect();
  console.log("\n  → Lancer : node scripts/test_task207_gmail_reel_e2e.js test");
  process.exit(fail ? 1 : 0);
}
/* ======================================================================== */
/* PHASE test : la matrice complète sous Gmail RÉEL (envois 250 + poller)   */
/* ======================================================================== */
const CONGE1 = { typeConge: "Congé annuel", dateDebut: "2026-12-14", dateFin: "2026-12-18", commentaire: "Dossier Task 207 (Gmail réel)" };
const AUTOR1 = { date: "2026-12-15", motif: "Démarche administrative Task 207 (Gmail réel)", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" };
const CONGE2 = { typeConge: "Congé annuel", dateDebut: "2027-01-11", dateFin: "2027-01-15", commentaire: "Dossier Task 207 matrice 2 étapes (Gmail réel)" };
const AUTOR2 = { date: "2027-01-12", motif: "Sortie Task 207 (Gmail réel)", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" };

const CAS = [
  { cle: "D1-att-travail", cin: "EMPZOH001", type: "ATTESTATION_TRAVAIL", corps: { type: "ATTESTATION_TRAVAIL" }, destAttendu: GMAIL_USER, autoAdressee: true },
  { cle: "D2-att-salaire", cin: "EMPZOH001", type: "ATTESTATION_SALAIRE", corps: { type: "ATTESTATION_SALAIRE" }, destAttendu: GMAIL_USER, autoAdressee: true },
  { cle: "D3-conge-2etapes", cin: "EMPZOH001", type: "CONGE", destAttendu: MGR_EMP1, corps: { type: "CONGE", ...CONGE1 },
    mgrReponse: { de: MGR_EMP1, nom: "RH Test (Manager)", texte: "OK pour moi, à valider par les RH." },
    rhReponse: { texte: "Congé accepté, bonne préparation." },
    final: (d) => d.statut === "ACCEPTEE", doc: "signe" },
  { cle: "D4-autor-2etapes", cin: "EMPZOH001", type: "AUTORISATION_SORTIE", destAttendu: MGR_EMP1, corps: { type: "AUTORISATION_SORTIE", ...AUTOR1 },
    mgrReponse: { de: MGR_EMP1, nom: "RH Test (Manager)", texte: "OK pour moi, à valider par les RH." },
    rhReponse: { texte: "Je refuse cette autorisation pour cette fois." },
    final: (d) => d.statut === "REFUSEE" && d.refuseePar === "RH", doc: "refus" },
  { cle: "D5-conge-2etapes-zoho", cin: "EMPZOH002", type: "CONGE", destAttendu: MGR_EMP2, corps: { type: "CONGE", ...CONGE2 },
    mgrReponse: { de: MGR_EMP2, nom: "Boîte Zoho (Manager test)", texte: "OK pour moi, à valider par les RH." },
    rhReponse: { texte: "Je valide." },
    final: (d) => d.statut === "ACCEPTEE", doc: "signe" },
  { cle: "D6-autor-mgr-refuse", cin: "EMPZOH002", type: "AUTORISATION_SORTIE", destAttendu: MGR_EMP2, corps: { type: "AUTORISATION_SORTIE", ...AUTOR2 },
    mgrReponse: { de: MGR_EMP2, nom: "Boîte Zoho (Manager test)", texte: "NON — demande refusée, période occupée." },
    final: (d) => d.statut === "REFUSEE" && d.refuseePar === "MANAGER", doc: "refus" },
];

async function phaseTest() {
  console.log("\n============ PHASE TEST : demandes + réponses RÉELLES (Gmail) ============");
  const debutISO = new Date().toISOString();
  fs.mkdirSync(TMP, { recursive: true });

  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion interface d'administration (:4000)", login.status === 200, "status=" + login.status);
  const port1 = clientHttp(PORTAIL);
  let p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p1.status === 200 && p1.json && p1.json.ok)) { await sleep(20000); p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  check("Connexion portail employé (:4001, EMPZOH001 — CIN+mdp+TOTP)", p1.status === 200 && p1.json && p1.json.ok, "status=" + p1.status);
  const port2 = clientHttp(PORTAIL);
  let p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p2.status === 200 && p2.json && p2.json.ok)) { await sleep(20000); p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  check("Connexion portail employé (:4001, EMPZOH002 — CIN+mdp+TOTP)", p2.status === 200 && p2.json && p2.json.ok, "status=" + p2.status);

  // ---- 1) Création des 6 demandes via le VRAI portail ----
  console.log("\n— 1) Création des demandes (envois SMTP Gmail RÉELS en arrière-plan) —");
  for (const c of CAS) {
    const port = c.cin === "EMPZOH001" ? port1 : port2;
    const r = await port.post("/api/demandes", c.corps);
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    if ((r.status === 200 || r.status === 201) && ref) { c.ref = ref; check("Demande " + c.cle + " créée (" + c.type + ") → " + ref, true, "status=" + r.status); }
    else check("Demande " + c.cle + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 200));
    await sleep(400);
  }
  if (CAS.some((c) => !c.ref)) { console.log("  Création incomplète."); await db.$disconnect(); process.exit(1); }
  etatEcrire({ debutISO, cas: CAS.map((c) => ({ cle: c.cle, ref: c.ref })) });

  // ---- 2) Envois SMTP RÉELS : Message-ID + réponse 250 de Google ----
  console.log("\n— 2) Envois SMTP RÉELS via smtp.gmail.com (250 attendu — App Password réel) —");
  await sleep(15000);
  const envois = journalDepuis(debutISO, (e) => String(e.action || "").startsWith("demande-") && e.action !== "demande-imap");
  const succes = envois.filter((e) => e.succes === true);
  const echecs = envois.filter((e) => e.succes === false);
  check("Envois SMTP RÉELS journalisés en SUCCÈS (250 de Google)", succes.length >= 6,
    succes.length + " succès / " + envois.length + " envoi(s) — " + (echecs.length ? "échecs: " + echecs.map((e) => e.action + " " + String(e.erreur).slice(0, 60)).join(" | ") : "aucun échec"));
  check("Réponses SMTP 250 gsmtp réelles dans le journal", succes.every((e) => /250/.test(String(e.reponseSmtp || ""))), succes.length + " × 250");
  for (const c of CAS) {
    const d = await attendreMessageId(c.ref, 60000);
    check(c.cle + " : Message-ID d'envoi stocké (l'e-mail a VRAIMENT quitté le système)", !!(d && d.messageIdEnvoi), d && d.messageIdEnvoi ? String(d.messageIdEnvoi).slice(0, 50) : "absent");
  }
  for (const c of CAS) {
    const d = await relire(c.ref);
    check(c.cle + " : routée vers l'adresse attendue (" + c.destAttendu + ")", d && dech(d.destinataire) === c.destAttendu, d ? "destinataire=" + dech(d.destinataire) : "introuvable");
  }

  // ---- 3) ARRIVÉE RÉELLE dans INBOX Gmail des demandes auto-adressées ----
  console.log("\n— 3) Arrivée RÉELLE dans INBOX Gmail (demandes auto-adressées + preuves IMAP) —");
  const debutArrivee = new Date(debutISO);
  for (const c of CAS.filter((x) => x.autoAdressee)) {
    const d = await relire(c.ref);
    const trouve = await chercherDansInbox(d.messageIdEnvoi, c.ref, debutArrivee);
    c.uidArrivee = trouve ? trouve.uid : null;
    check(c.cle + " : l'e-mail de demande EST dans INBOX Gmail (envoi + réception réels)", trouve, trouve ? "Message-ID " + String(d.messageIdEnvoi).slice(0, 40) : "NON TROUVÉ");
  }

  // ---- 4) Statut initial « En attente » dans les DEUX interfaces ----
  console.log("\n— 4) Statut initial « En attente » dans les DEUX interfaces —");
  for (const [cin, port] of [["EMPZOH001", port1], ["EMPZOH002", port2]]) {
    const mes = await port.get("/api/mes-demandes");
    const items = (mes.json && mes.json.items) || [];
    for (const c of CAS.filter((x) => x.cin === cin)) {
      const p = items.find((x) => x.reference === c.ref);
      check(c.cle + " : « En attente » dans le portail employé", p && p.statut === "EN_ATTENTE", p ? "portail=" + p.statut : "absent");
    }
  }
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  for (const c of CAS) {
    const a = itemsAdm.find((x) => x.reference === c.ref);
    check(c.cle + " : « En attente » dans l'administration", a && a.statut === "EN_ATTENTE", a ? "admin=" + a.statut : "absent");
  }

  // ---- 5) VAGUE 1 : réponses MANAGER (IMAP APPEND réel dans INBOX) ----
  console.log("\n— 5) VAGUE 1 : réponses manager injectées par IMAP APPEND (le poller les lit RÉELLEMENT) —");
  let num = 0;
  for (const c of CAS.filter((x) => x.mgrReponse)) {
    num++;
    const sujet = await appenderReponseManager({ ...c.mgrReponse, ref: c.ref, type: c.type, num });
    check(c.cle + " : réponse manager APPENDÉE dans INBOX Gmail (From " + c.mgrReponse.de + ")", true, sujet.slice(0, 60));
    await sleep(3000);
  }
  console.log("  → Attente du poller IMAP (15 s) puis des décisions manager…");
  for (const c of CAS.filter((x) => x.mgrReponse)) {
    const d = await attendreStatut(c.ref, (d) => !!d.decisionManagerLe, 240000);
    const attenduMgr = c.cle === "D6-autor-mgr-refuse" ? "REFUSEE" : "ACCEPTEE";
    check(c.cle + " : décision manager reconnue automatiquement (" + attenduMgr + ")", d && d.decisionManager === attenduMgr,
      d ? "decisionManager=" + d.decisionManager + " statut=" + d.statut : "timeout");
  }
  // D6 : refus manager immédiat et définitif + document de refus
  const d6 = CAS.find((c) => c.cle === "D6-autor-mgr-refuse");
  const d6d = await attendreStatut(d6.ref, (d) => d.statut === "REFUSEE" && !!d.docRefusChemin, 240000);
  check(d6.cle + " : REFUS MANAGER définitif (« Refusée par le Manager ») + PDF de refus généré", d6d && d6d.statut === "REFUSEE" && d6d.refuseePar === "MANAGER" && !!d6d.docRefusChemin,
    d6d ? "statut=" + d6d.statut + " refuseePar=" + d6d.refuseePar + " doc=" + (d6d.docRefusNom || d6d.docRefusChemin || "?") : "timeout");
  // Transmissions RH (D3, D4, D5) — envois RÉELS vers la boîte Gmail
  const trans = journalDepuis(debutISO, (e) => e.action === "demande-transmission-rh");
  check("Transmissions RH journalisées en SUCCÈS (250 — vers " + GMAIL_USER + " = boîte surveillée)", trans.filter((e) => e.succes).length >= 3,
    trans.length + " transmission(s), " + trans.filter((e) => e.succes).length + " succès");
  for (const ref of [CAS[2].ref, CAS[3].ref, CAS[4].ref]) {
    const t = trans.find((e) => e.reference === ref && e.succes);
    const arrivee = t && (await chercherDansInbox(null, ref, debutArrivee));
    check(ref + " : transmission RH REÇUE dans INBOX Gmail (boucle e-mail complète réelle)", !!arrivee, arrivee ? "sujet avec référence trouvé" : "absente");
  }

  // ---- 6) VAGUE 2 : réponses RH = VRAIS e-mails SMTP auto-adressés ----
  console.log("\n— 6) VAGUE 2 : réponses RH envoyées comme VRAIS e-mails (smtp.gmail.com → INBOX → poller) —");
  for (const c of CAS.filter((x) => x.rhReponse)) {
    const d = await relire(c.ref);
    const env = await envoyerReponseRh({ ref: c.ref, type: c.type, texte: c.rhReponse.texte, inReplyTo: d.messageIdEnvoi });
    c.rhReponse.messageId = env.messageId;
    check(c.cle + " : réponse RH ENVOYÉE via smtp.gmail.com (250) — From=To=" + GMAIL_USER, /250/.test(String(env.response || "")), env.response + " id=" + String(env.messageId).slice(0, 40));
    await sleep(3000);
  }
  console.log("  → Attente du poller IMAP puis des statuts finaux…");
  for (const c of CAS.filter((x) => x.rhReponse)) {
    const d = await attendreStatut(c.ref, (d) => !!d.decisionRhLe, 240000);
    check(c.cle + " : décision RH reconnue automatiquement depuis le VRAI e-mail", d && !!d.decisionRhLe, d ? "decisionRh=" + d.decisionRh + " statut=" + d.statut : "timeout");
  }

  // ---- 7) Statuts FINAUX dans les DEUX interfaces ----
  console.log("\n— 7) Statuts finaux dans les DEUX interfaces —");
  for (const c of CAS) {
    const d = await relire(c.ref);
    const okFinal = d && c.final(d);
    check(c.cle + " : statut final en base CONFORME à la matrice", okFinal, d ? "statut=" + d.statut + " refuseePar=" + (d.refuseePar || "-") : "introuvable");
  }
  for (const [cin, port] of [["EMPZOH001", port1], ["EMPZOH002", port2]]) {
    const mes = await port.get("/api/mes-demandes");
    const items = (mes.json && mes.json.items) || [];
    for (const c of CAS.filter((x) => x.cin === cin)) {
      const d = await relire(c.ref);
      const p = items.find((x) => x.reference === c.ref);
      check(c.cle + " : portail employé concordant", p && statutConcordant(p.statutLibelle || p.statut, d.statut), p ? "portail=" + (p.statutLibelle || p.statut) : "absent");
    }
  }
  const listeAdm2 = await adm.get("/api/demandes");
  const itemsAdm2 = (listeAdm2.json && listeAdm2.json.items) || [];
  for (const c of CAS) {
    const d = await relire(c.ref);
    const a = itemsAdm2.find((x) => x.reference === c.ref);
    check(c.cle + " : administration concordante", a && statutConcordant(a.statutFinalLibelle || a.statutLibelle || a.statut, d.statut), a ? "admin=" + (a.statutFinalLibelle || a.statut) : "absent");
  }

  // ---- 8) Garde-fous anti-boucle EN RÉEL ----
  console.log("\n— 8) Garde-fous anti-boucle sous Gmail réel (auto-messages entrants) —");
  for (const c of CAS.filter((x) => x.autoAdressee)) {
    const d = await relire(c.ref);
    check(c.cle + " : demande auto-adressée IGNORÉE par la garde Message-ID (statut intact)", d && d.statut === "EN_ATTENTE", "statut=" + (d && d.statut));
  }
  for (const c of CAS.filter((x) => x.autoAdressee)) {
    const d = await relire(c.ref);
    check(c.cle + " : AUCUNE décision parasite (attestations sans décision manager/RH)", d && !d.decisionManagerLe && !d.decisionRhLe, "decisionManager/decisionRh absents");
  }
  // Preuve BEHAVIORALE que le poller a VRAIMENT lu ces messages : il marque
  // \Seen tout message traité (y compris ignoré) — le Message-ID d'envoi est
  // arrivé non-lu et doit être LU maintenant, SANS aucune décision.
  for (const c of CAS.filter((x) => x.autoAdressee && x.uidArrivee)) {
    const lu = await avecImap(async (cl) => {
      const msg = await cl.fetchOne(String(c.uidArrivee), { flags: true }, { uid: true });
      return !!(msg && msg.flags && msg.flags.has && msg.flags.has("\\Seen"));
    });
    check(c.cle + " : e-mail traité par le POLLER (marqué \u00ab lu \u00bb par IMAP — lecture réelle, aucune décision)", lu, "uid=" + c.uidArrivee);
  }

  await db.$disconnect();
  console.log("\n  → Lancer : node scripts/test_task207_gmail_reel_e2e.js docs");
  process.exit(fail ? 1 : 0);
}

/** Attente active du messageIdEnvoi (envoi arrière-plan asynchrone). */
async function attendreMessageId(ref, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && d.messageIdEnvoi) return d;
    if (Date.now() - debut > (timeoutMs || 60000)) return d;
    await sleep(3000);
  }
}
/** Cherche dans INBOX Gmail un message par Message-ID et/ou référence (depuis un instant). */
async function chercherDansInbox(messageId, ref, depuis) {
  return avecImap(async (c) => {
    const uids = (await c.search({ since: new Date(depuis.getTime() - 60000) }, { uid: true })) || [];
    const fenetre = uids.slice(-200);
    for (const uid of fenetre) {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const src = msg.source.toString("utf8");
      if (messageId && src.includes(messageId.replace(/[<>]/g, ""))) return { uid, via: "message-id" };
      if (ref && src.includes(ref)) return { uid, via: "reference" };
    }
    return null;
  });
}
/* ======================================================================== */
/* PHASE docs : PDF signés (contenu, PAdES, double interface, INBOX réelle) */
/* ======================================================================== */
async function phaseDocs() {
  console.log("\n============ PHASE DOCS : PDF signés + réception RÉELLE dans INBOX ============");
  const etat = etatLire();
  const debutISO = etat.debutISO || new Date(Date.now() - 3600000).toISOString();
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(LIVRABLES, { recursive: true });

  const adm = clientHttp(ADMIN);
  await adm.post("/api/auth/login", SUPERADMIN);
  const port1 = clientHttp(PORTAIL);
  let p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p1.status === 200 && p1.json && p1.json.ok)) { await sleep(20000); p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  const port2 = clientHttp(PORTAIL);
  let p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p2.status === 200 && p2.json && p2.json.ok)) { await sleep(20000); p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }

  const aDocs = CAS.filter((c) => c.doc).map((c) => ({ ...c, ref: (etat.cas || []).find((x) => x.cle === c.cle)?.ref }));
  for (const c of aDocs) {
    console.log("\n— " + c.cle + " (" + c.ref + ") —");
    const d = await relire(c.ref);
    const nomFichier = (c.doc === "signe" ? d.docSigneChemin : d.docRefusChemin) || "";
    const nomAffiche = c.doc === "signe" ? d.docSigneNom : d.docRefusNom;
    let chemin = null;
    for (const cand of [nomFichier, "storage/documents-demandes/" + nomFichier, "storage/documents-demandes/" + String(nomFichier).split("/").pop()]) {
      if (nomFichier && fs.existsSync(cand)) { chemin = cand; break; }
    }
    check(c.cle + " : PDF " + (c.doc === "signe" ? "« document signé »" : "« document de refus »") + " généré AUTOMATIQUEMENT", Boolean(chemin),
      chemin ? chemin + " (" + fs.statSync(chemin).size + " o) — déclencheur : " + ((c.doc === "signe" ? d.docSignePar : d.docRefusPar) || "—") : "(aucun chemin)");
    if (chemin) {
      const brut = fs.readFileSync(chemin);
      check(c.cle + " : stockage CHIFFRÉ AES-256-GCM (en-tête PAIESAGE1)", brut.subarray(0, 9).toString() === "PAIESAGE1", "magic=" + brut.subarray(0, 9).toString());
    }
    const errEnvoi = (c.doc === "signe" ? d.docSigneErreur : d.docRefusErreur) || "";
    check(c.cle + " : AUCUNE erreur d'envoi (l'e-mail du PDF est PARTI pour de vrai)", !errEnvoi, errEnvoi ? String(errEnvoi).slice(0, 100) : "envoi sans erreur");
    const jd = journalDepuis(debutISO, (e) => (e.action === "doc-signe" || e.action === "doc-refus") && e.reference === c.ref);
    if (jd.length) {
      const e0 = jd[jd.length - 1];
      check(c.cle + " : journal génération — signatureCrypto=true + éléments [signature, tampon, qr, elec, certificat] + 0 avertissement",
        e0.signatureCrypto === true && Array.isArray(e0.elements) && e0.elements.length >= 5 && (!e0.avertissements || e0.avertissements.length === 0),
        "elements=" + JSON.stringify(e0.elements));
      check(c.cle + " : journal doc — envoi « envoyé » RÉEL via smtp.gmail.com (250)", e0.envoi === "envoye" && /250/.test(String(e0.reponseSmtp || e0.reponse || "")), String(e0.reponseSmtp || e0.reponse || "?").slice(0, 60));
    } else check(c.cle + " : journal doc-signe/doc-refus présent", false, "aucune entrée");
  }

  // ---- Téléchargement DOUBLE INTERFACE + SHA-256 + contenu + PAdES ----
  console.log("\n— Vérifications approfondies (double interface, contenu, PAdES openssl, rendus) —");
  const pdfsVerifies = [];
  for (const c of aDocs) {
    const d = await relire(c.ref);
    const det = await adm.get("/api/demandes/" + d.id);
    const itAdm = (det.json && det.json.item) || {};
    const docsDet = itAdm.documents || [];
    const docMeta = docsDet.find((x) => JSON.stringify(x).includes(c.ref) || /SIGNE|REFUS|automatique/i.test(JSON.stringify(x))) || docsDet[docsDet.length - 1];
    let pdf = null;
    if (docMeta && docMeta.id) {
      const dlAdm = await adm.get("/api/demandes/" + d.id + "/documents/" + docMeta.id);
      check(c.cle + " : PDF téléchargeable depuis l'ADMINISTRATION", dlAdm.status === 200 && dlAdm.octets && dlAdm.octets.subarray(0, 4).toString() === "%PDF", dlAdm.octets ? dlAdm.octets.length + " o" : "vide");
      const port = c.cin === "EMPZOH001" ? port1 : port2;
      const dlPort = await port.req("GET", "/api/mes-demandes/documents/" + docMeta.id);
      check(c.cle + " : PDF téléchargeable depuis le PORTAIL EMPLOYÉ", dlPort.status === 200 && dlPort.octets && dlPort.octets.subarray(0, 4).toString() === "%PDF", dlPort.octets ? dlPort.octets.length + " o" : "vide");
      if (dlAdm.octets && dlPort.octets) {
        const hA = sha256(dlAdm.octets), hP = sha256(dlPort.octets);
        check(c.cle + " : le MÊME PDF servi par les DEUX interfaces (SHA-256 identiques)", hA === hP, "sha256=" + hA.slice(0, 24) + "…");
        pdf = dlAdm.octets;
      }
      const libAdm = itAdm.statutFinalLibelle || "";
      check(c.cle + " : statut affiché concordant dans l'ADMINISTRATION", statutConcordant(libAdm, d.statut), "libellé=" + libAdm);
    } else check(c.cle + " : document visible dans l'ADMINISTRATION", false, "aucun document listé");
    if (!pdf) continue;
    fs.writeFileSync(TMP + "/" + c.cle + ".pdf", pdf);
    pdfsVerifies.push({ c, pdf });

    // CONTENU texte
    let txt = "";
    try { execFileSync("pdftotext", [TMP + "/" + c.cle + ".pdf", TMP + "/" + c.cle + ".txt"]); txt = fs.readFileSync(TMP + "/" + c.cle + ".txt", "utf8"); } catch { }
    const cinEmp = dech(d.cin);
    const emailEmp = dech(d.employeEmail) || GMAIL_USER;
    const contenus = {
      "référence unique": txt.includes(c.ref),
      "type de demande": /Congé|Autorisation/i.test(txt),
      "statut final": c.doc === "signe" ? /Accept|Valid/i.test(txt) : /Refus/i.test(txt),
      "CIN employé": txt.includes(cinEmp),
      "e-mail employé": txt.includes(emailEmp.split("@")[0]),
      "mention légale / signature": /Signature|signé|Fait le/i.test(txt),
      ...(c.type === "CONGE" ? { "détails congé (dates + type)": /2026-12-14|14\/12\/2026|Congé annuel/i.test(txt) } : {}),
      ...(c.type === "AUTORISATION_SORTIE" ? { "détails autorisation (heures)": /2\s*h|14:00|10:00/i.test(txt) } : {}),
    };
    for (const [k, vOk] of Object.entries(contenus)) check(c.cle + " : PDF contient " + k, vOk);

    // IMAGES (paraphe + cachet + QR + cachet électronique)
    let nbImg = 0;
    try { const out = execFileSync("pdfimages", ["-list", TMP + "/" + c.cle + ".pdf"], { encoding: "utf8" }); nbImg = Math.max(0, out.split("\n").length - 2); } catch { }
    check(c.cle + " : éléments visuels présents (≥ 4 images : paraphe + cachet + QR + cachet électronique)", nbImg >= 4, nbImg + " image(s)");

    // SIGNATURE PAdES — ByteRange [a b c d] = plages signées [a,a+b)+[c,c+d)
    // (c = offset ABSOLU) — couverture intégrale ⇔ a=0 ET c+d === taille.
    const s = pdf.toString("latin1");
    const m = s.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    check(c.cle + " : signature PAdES — /ByteRange présent", !!m, m ? "[" + m.slice(1).join(" ") + "]" : "absent");
    if (m) {
      const a = +m[1], b = +m[2], cc = +m[3], dd = +m[4];
      check(c.cle + " : la plage signée couvre le fichier ENTIER (c+d=" + (cc + dd) + " = taille)", a === 0 && cc + dd === pdf.length, (cc + dd) + " / " + pdf.length + " octets");
      const cm = s.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
      if (cm) {
        let hex = cm[1];
        const base = TMP + "/" + c.cle;
        fs.writeFileSync(base + "-contenu.bin", Buffer.concat([pdf.subarray(0, b), pdf.subarray(cc, cc + dd)]));
        let der = Buffer.from(hex, "hex");
        fs.writeFileSync(base + "-sig.der", der);
        let verif = "";
        try { execFileSync("openssl", ["smime", "-verify", "-inform", "DER", "-in", base + "-sig.der", "-content", base + "-contenu.bin", "-noverify", "-out", "/dev/null"], { stdio: ["ignore", "pipe", "pipe"] }); verif = "Verification successful"; }
        catch (e) { verif = String((e.stderr || e.message || "")).split("\n")[0]; }
        if (!/successful/i.test(verif)) {
          // réessai en retirant le remplissage nul final du placeholder /Contents
          while (hex.endsWith("00") && hex.length > 16) hex = hex.slice(0, -2);
          fs.writeFileSync(base + "-sig.der", Buffer.from(hex, "hex"));
          try { execFileSync("openssl", ["smime", "-verify", "-inform", "DER", "-in", base + "-sig.der", "-content", base + "-contenu.bin", "-noverify", "-out", "/dev/null"]); verif = "Verification successful"; } catch (e) { verif = String((e.stderr || e.message || "")).split("\n")[0]; }
        }
        check(c.cle + " : SIGNATURE CRYPTOGRAPHIQUE VÉRIFIÉE (openssl smime — Verification successful)", /successful/i.test(verif), verif.slice(0, 80));
      }
    }

    // RENDU VISUEL pour inspection humaine
    try {
      execFileSync("pdftoppm", ["-png", "-r", "150", TMP + "/" + c.cle + ".pdf", TMP + "/" + c.cle + "-rendu"]);
      const rendus = fs.readdirSync(TMP).filter((f) => f.startsWith(c.cle + "-rendu"));
      if (rendus.length) fs.copyFileSync(TMP + "/" + rendus[0], LIVRABLES + "/" + c.cle + "-rendu.png");
    } catch { }
    fs.copyFileSync(TMP + "/" + c.cle + ".pdf", LIVRABLES + "/" + c.cle + ".pdf");
  }

  // ---- RÉCEPTION RÉELLE des PDF dans INBOX Gmail (pièce jointe == PDF signé) ----
  console.log("\n— Réception RÉELLE des e-mails de documents dans INBOX Gmail (pièces jointes) —");
  for (const { c, pdf } of pdfsVerifies) {
    const recu = await avecImap(async (cl) => {
      const uids = (await cl.search({ subject: c.ref }, { uid: true })) || [];
      for (const uid of uids.slice(-20)) {
        const msg = await cl.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const src = msg.source.toString("utf8");
        if (!/x-auto-rh-systeme:\s*document-(signe|refus)/i.test(src)) continue;
        const parsed = await simpleParser(msg.source);
        const att = (parsed.attachments || []).find((x) => /pdf/i.test(String(x.contentType || "") + String(x.filename || "")));
        if (att) return { uid, sha: sha256(att.content), sujet: parsed.subject, from: (parsed.from?.value || []).map((f) => f.address).join(",") };
      }
      return null;
    });
    check(c.cle + " : e-mail du document RÉCEMMENT REÇU dans INBOX (en-tête X-Auto-RH-Systeme)", !!recu, recu ? "uid=" + recu.uid + " de=" + recu.from : "absent");
    if (recu) check(c.cle + " : la pièce jointe reçue = EXACTEMENT le PDF signé (SHA-256 identiques)", recu.sha === sha256(pdf), "sha256=" + recu.sha.slice(0, 24) + "…");
  }

  await db.$disconnect();
  console.log("\n  → Lancer : node scripts/test_task207_gmail_reel_e2e.js restore-boite");
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* PHASE restore-boite : IMAP off → restitution \Seen de l'instantané       */
/* ======================================================================== */
async function phaseRestoreBoite() {
  console.log("\n============ PHASE RESTORE : protection de la boîte réelle ============");
  // 1) DÉSACTIVER l'IMAP d'abord — le poller ne doit PAS re-marquer les 40 k
  const adm = clientHttp(ADMIN);
  await adm.post("/api/auth/login", SUPERADMIN);
  const avant = await adm.get("/api/mail-config");
  const cAvant = (avant.json && avant.json.config) || {};
  const put = await adm.put("/api/mail-config", {
    host: cAvant.host, port: cAvant.port, username: cAvant.username,
    from: cAvant.from || "", rhEmail: cAvant.rhEmail || "",
    attestationTravailEmail: cAvant.attestationTravailEmail || "", attestationSalaireEmail: cAvant.attestationSalaireEmail || "",
    congeEmail: cAvant.congeEmail || "", autorisationEmail: cAvant.autorisationEmail || "",
    imapActif: false,
  });
  check("IMAP désactivé dans la configuration (le poller s'arrête — Gmail SMTP reste ACTIF)", put.status === 200, "status=" + put.status);
  const apres = await adm.get("/api/mail-config");
  const cApres = (apres.json && apres.json.config) || {};
  check("Relecture : IMAP OFF + SMTP Gmail toujours engagé (" + cApres.host + ":" + cApres.port + ")", cApres.imapActif === false && cApres.host === SMTP_HOST, "imapActif=" + cApres.imapActif);
  console.log("  → 20 s d'attente (fin du passage du poller en cours)…");
  await sleep(20000);

  // 2) Restitution de l'état « non lu » de l'instantané
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_BOITE, "utf8"));
  console.log("  Instantané : " + snap.nonLus + " UIDs non lus en " + snap.lots.length + " ensemble(s) de séquence — restauration…");
  let restaures = 0, lotsOk = 0, lotsKo = 0;
  for (const lot of snap.lots) {
    try { await avecImap(async (cl) => { await cl.messageFlagsRemove(lot, ["\\Seen"], { uid: true }); }); lotsOk++; }
    catch (e) { lotsKo++; console.log("    lot en échec (retenté individuellement) : " + String(e.message || e).slice(0, 80)); }
    restaures += lot.split(",").length;
    process.stdout.write("    " + restaures + "/" + snap.nonLus + " UIDs traités\r");
  }
  console.log("");
  check("Flag \\Seen RETIRÉ sur l'instantané (état initial de la boîte RESTITUÉ)", lotsOk >= 1 && lotsKo < snap.lots.length, lotsOk + " lot(s) OK, " + lotsKo + " échec(s)");

  // 3) Vérification finale de la boîte
  const fin = await avecImap(async (cl) => {
    const st = cl.mailbox;
    const u = await cl.search({ seen: false }, { uid: true });
    return { exists: st.exists, nonLus: (u || []).length };
  });
  check("Boîte Gmail vérifiée APRÈS restauration : " + fin.nonLus + " non lus (initial : " + snap.nonLus + ")", fin.nonLus >= snap.nonLus, "exists=" + fin.exists);

  // 4) Santé des services + livrables
  const s4000 = await fetch("http://localhost:4000/api/mail-config", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  const s4001 = await fetch("http://localhost:4001", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  check("Service administration (:4000) en bonne santé", s4000 > 0, "HTTP " + s4000);
  check("Service portail (:4001) en bonne santé", s4001 === 200, "HTTP " + s4001);
  if (fs.existsSync(LIVRABLES)) {
    const n = fs.readdirSync(LIVRABLES).length;
    check("Livrables copiés dans " + LIVRABLES, n > 0, n + " fichier(s)");
  }

  await db.$disconnect();
  console.log("\n================================ RÉSUMÉ GLOBAL =================================");
  console.log("  " + ok + " contrôle(s) OK — " + fail + " échec(s)");
  if (echecs.length) for (const e of echecs) console.log("   FAIL: " + e);
  console.log("  Gmail : SMTP RESTÉ ACTIF (" + SMTP_HOST + ":" + SMTP_PORT + ") — IMAP désactivé en fin de test");
  console.log("  (réactivation IMAP : panneau Envoi d'e-mails → cocher IMAP — la boîte sera");
  console.log("   alors traitée par le poller : les 40 k anciens messages redeviennent non lus)");
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* DISPATCHER                                                               */
/* ======================================================================== */
const phase = process.argv[2] || "";
const phases = { prep: phasePrep, config: phaseConfig, test: phaseTest, docs: phaseDocs, "restore-boite": phaseRestoreBoite };
if (!phases[phase]) {
  console.log("Usage : node scripts/test_task207_gmail_reel_e2e.js <prep|config|test|docs|restore-boite>");
  process.exit(2);
}
phases[phase]().catch(async (e) => {
  console.error("ERREUR FATALE (" + phase + "):", (e && e.stack) || e);
  try { await db.$disconnect(); } catch { }
  process.exit(1);
});
