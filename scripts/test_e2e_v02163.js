#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E v0.2.163 — RÉPONSES E-MAIL → MISE À JOUR DES STATUTS (< 60 s)
 * ============================================================================
 * Reproduit EXACTEMENT le scénario utilisateur : une demande est créée sur le
 * portail, le destinataire (manager/RH) RÉPOND par e-mail, le statut doit
 * passer de « En attente » à « Acceptée » / « Refusée » en MOINS DE 60 SECONDES
 * — sans aucune intervention manuelle — et être visible dans les DEUX
 * interfaces (admin :4000 ET portail :4001).
 *
 * Les réponses sont RÉELLES :
 *   - réponses MANAGER : .eml réaliste APPENDÉ dans INBOX Gmail (comme un
 *     client de messagerie qui dépose un message) ;
 *   - réponse RH : VRAI e-mail envoyé via smtp.gmail.com (auto-adressé — la
 *     boîte RH répond depuis le système ; Gmail la place dans « Envoyés » et
 *     la marque LUE dans INBOX → captée par le scan « Envoyés » du poller).
 *
 * CAS (les 4 types, acceptation ET refus) :
 *   T1 ATTESTATION_TRAVAIL   → acceptation manager → ACCEPTEE    (< 60 s)
 *   T2 ATTESTATION_SALAIRE   → refus manager       → REFUSEE     (< 60 s)
 *   T3 CONGE                 → acceptation manager (matrice 2 étapes :
 *                              décision manager tracée < 60 s, transmission
 *                              RH automatique) PUIS acceptation RH → ACCEPTEE
 *   T4 AUTORISATION_SORTIE   → refus manager       → REFUSEE (MANAGER) < 60 s
 *
 * Usage : node scripts/test_e2e_v02163.js
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
const nodemailer = require("nodemailer");

/* ---- Serveurs locaux ---- */
const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };

/* ---- GMAIL RÉEL (config utilisateur — identique à la production) ---- */
const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

/* ---- Fixtures du scénario (compte employé test réel du portail) ---- */
const MGR_EMP1 = "smtp.test@autorh.tn";   // destinataire (manager) des demandes
const MDP_PORTAIL = "Test-Zoho!2026";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const CIN_EMPLOYE = "EMPZOH001";
const DELAI_MAX_MS = 60000; // exigence utilisateur : < 60 s

let ok = 0, fail = 0;
const echecs = [];
const mesures = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; echecs.push(nom + (detail ? " — " + detail : "")); console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
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
      headers: {
        ...(corps === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null;
    try { json = JSON.parse(texte); } catch {}
    return { status: res.status, json, texte };
  };
  return { req, post: (p, c) => req("POST", p, c), put: (p, c) => req("PUT", p, c), get: (p) => req("GET", p) };
}
async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }

/* ---- Réponse MANAGER : .eml réaliste + IMAP APPEND RÉEL dans INBOX ---- */
async function appenderReponseManager({ ref, sujetBase, texte, num, de }) {
  const sujet = "Re: " + sujetBase;
  const eml = [
    "Message-ID: <v02163-mgr-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: \"RH Test (Manager)\" <" + (de || MGR_EMP1) + ">",
    "To: <" + GMAIL_USER + ">",
    "Subject: " + sujet,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    texte,
    "",
  ].join("\r\n");
  const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { await c.append("INBOX", Buffer.from(eml, "utf8")); } finally { lock.release(); await c.logout().catch(() => {}); }
  return sujet;
}
/* ---- Réponse RH : VRAI e-mail envoyé via smtp.gmail.com (auto-adressé) ---- */
async function envoyerReponseRh({ sujetBase, texte }) {
  const t = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP },
    tls: { rejectUnauthorized: false }, connectionTimeout: 20000,
  });
  const info = await t.sendMail({
    from: '"Auto-RH Auto-RH" <' + GMAIL_USER + ">",
    to: GMAIL_USER,
    subject: "Re: " + sujetBase,
    text: texte,
  });
  return { messageId: info.messageId, response: info.response };
}
/** Attente active d'un état de demande (poll DB, toutes les 2 s) + mesure. */
async function attendreStatut(ref, predicat, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && predicat(d)) {
      const delai = Date.now() - t0;
      mesures.push({ ref, label, delaiMs: delai });
      return { d, delai };
    }
    if (Date.now() - t0 > (timeoutMs || DELAI_MAX_MS)) return { d, delai: null };
    await sleep(2000);
  }
}
/** Retrouve le sujet d'envoi exact de la demande dans le journal e-mail. */
function sujetEnvoiDepuisJournal(ref) {
  try {
    const lignes = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/).filter(Boolean);
    for (let i = lignes.length - 1; i >= 0; i--) {
      let e = null;
      try { e = JSON.parse(lignes[i]); } catch {}
      if (e && e.sujet && String(e.sujet).indexOf(ref) >= 0 && /traitement requis/.test(String(e.sujet))) return String(e.sujet);
    }
  } catch {}
  return null;
}

async function main() {
  console.log("======================================================================");
  console.log(" TEST E2E v0.2.163 — réponses e-mail → statuts < 60 s (4 types)");
  console.log("======================================================================");

  /* ---- 0) Santé des services ---- */
  const pingA = await clientHttp(ADMIN).get("/api/auth/session");
  const pingP = await clientHttp(PORTAIL).get("/");
  check("Services en vie (admin :4000 + portail :4001)", pingA.status < 600 && pingP.status === 200, "admin=" + pingA.status + " portail=" + pingP.status);

  /* ---- 1) Connexions RÉELLES ---- */
  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion interface d'administration (:4000)", login.status === 200, "status=" + login.status);
  const port = clientHttp(PORTAIL);
  let p1 = await port.post("/api/verify", { cin: CIN_EMPLOYE, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p1.status === 200 && p1.json && p1.json.ok)) { await sleep(20000); p1 = await port.post("/api/verify", { cin: CIN_EMPLOYE, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  check("Connexion portail employé (:4001 — CIN + mot de passe + TOTP)", p1.status === 200 && p1.json && p1.json.ok, "status=" + p1.status);

  /* ---- 2) Création des 4 demandes via le VRAI portail ---- */
  const CAS = [
    { cle: "T1-att-travail-acceptee", corps: { type: "ATTESTATION_TRAVAIL" }, sujetRe: null, texte: "J'accepte votre demande. Document transmis.", statutAttendu: "ACCEPTEE" },
    { cle: "T2-att-salaire-refusee", corps: { type: "ATTESTATION_SALAIRE" }, sujetRe: null, texte: "Je refuse cette demande.", statutAttendu: "REFUSEE" },
    { cle: "T3-conge-2etapes", corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2027-02-01", dateFin: "2027-02-05", commentaire: "Test E2E v0.2.163" }, sujetRe: null, texte: "OK pour moi, à valider par les RH.", statutManager: "ACCEPTEE" },
    { cle: "T4-autor-refusee", corps: { type: "AUTORISATION_SORTIE", date: "2027-02-02", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" }, sujetRe: null, texte: "NON — je refuse cette autorisation.", statutAttendu: "REFUSEE" },
  ];
  console.log("\n— 1) Création des 4 demandes (envois SMTP Gmail réels en arrière-plan) —");
  for (const c of CAS) {
    const r = await port.post("/api/demandes", c.corps);
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    c.ref = ref || null;
    check("Demande " + c.cle + " créée", Boolean(ref), ref || ("status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 120)));
    await sleep(500);
  }
  if (CAS.some((c) => !c.ref)) { console.log("  Création incomplète — arrêt."); await db.$disconnect(); process.exit(1); }

  /* ---- 3) Attente des envois SMTP (Message-IDs réels en base) ---- */
  console.log("\n— 2) Attente des envois SMTP réels (sujets d'envoi) —");
  for (const c of CAS) {
    let sujet = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const d = await relire(c.ref);
      if (d && d.messageIdEnvoi) { sujet = sujetEnvoiDepuisJournal(c.ref) || null; if (sujet) break; }
      await sleep(3000);
    }
    if (!sujet) { const d = await relire(c.ref); sujet = sujetEnvoiDepuisJournal(c.ref); }
    c.sujetBase = sujet || (c.corps.type === "CONGE" ? "AutoRH — Demande de congé " + c.ref + " (traitement requis)"
      : c.corps.type === "AUTORISATION_SORTIE" ? "AutoRH — Autorisation de sortie " + c.ref + " (traitement requis)"
      : c.corps.type === "ATTESTATION_TRAVAIL" ? "AutoRH — Attestation de travail " + c.ref + " (traitement requis)"
      : "AutoRH — Attestation de salaire " + c.ref + " (traitement requis)");
    console.log("  " + c.ref + " → sujet : " + c.sujetBase.slice(0, 90));
  }

  /* ---- 4) VAGUE 1 : réponses MANAGER (APPEND IMAP RÉEL) + mesure < 60 s ---- */
  console.log("\n— 3) VAGUE 1 : réponses du destinataire (IMAP APPEND réelles dans INBOX Gmail) —");
  for (const [i, c] of CAS.entries()) {
    c.t0 = new Date();
    await appenderReponseManager({ ref: c.ref, sujetBase: c.sujetBase, texte: c.texte, num: i + 1 });
    console.log("  " + c.ref + " ← réponse APPENDÉE (" + c.texte.slice(0, 40) + ")");
    await sleep(1500);
  }
  console.log("\n— 4) Attente des mises à jour de statut (exigence : < 60 s) —");
  for (const c of CAS) {
    if (c.cle === "T3-conge-2etapes") {
      // matrice 2 étapes : la décision MANAGER doit être tracée < 60 s
      const { d, delai } = await attendreStatut(c.ref, (x) => x.decisionManager === "ACCEPTEE", DELAI_MAX_MS, "décision manager");
      check(c.cle + " : décision manager tracée < 60 s (transmission RH automatique)", Boolean(delai !== null && d && d.decisionManager === "ACCEPTEE"),
        delai === null ? "DÉPASSEMENT 60 s" : delai + " ms");
      check(c.cle + " : statut intermédiaire « En attente » (validation RH requise)", d && d.statut === "EN_ATTENTE", "statut=" + (d && d.statut));
      c.apresManager = d;
    } else {
      const { d, delai } = await attendreStatut(c.ref, (x) => x.statut === c.statutAttendu, DELAI_MAX_MS, "statut final");
      check(c.cle + " : statut → " + c.statutAttendu + " < 60 s", Boolean(delai !== null && d && d.statut === c.statutAttendu),
        delai === null ? "DÉPASSEMENT — statut actuel=" + (d && d.statut) : delai + " ms");
      c.apresManager = d;
    }
  }

  /* ---- 5) VAGUE 2 : réponse RH (VRAI e-mail SMTP auto-adressé) pour le congé ---- */
  console.log("\n— 5) VAGUE 2 : réponse RH (e-mail SMTP réel auto-adressé — scan « Envoyés ») —");
  const cConge = CAS[2];
  const t0Rh = new Date();
  const repRh = await envoyerReponseRh({ sujetBase: cConge.sujetBase, texte: "Congé accepté, bonne préparation." });
  check("Réponse RH envoyée via smtp.gmail.com (250 réel)", Boolean(repRh.messageId), "mid=" + String(repRh.messageId || "").slice(0, 50));
  const { d: dConge, delai: delaiRh } = await attendreStatut(cConge.ref, (x) => x.statut === "ACCEPTEE", DELAI_MAX_MS, "statut final RH");
  check(cConge.cle + " : statut final → ACCEPTEE < 60 s après réponse RH", Boolean(delaiRh !== null && dConge && dConge.statut === "ACCEPTEE"),
    delaiRh === null ? "DÉPASSEMENT — statut=" + (dConge && dConge.statut) : delaiRh + " ms");

  /* ---- 6) Vérification des DEUX interfaces ---- */
  console.log("\n— 6) Vérification des interfaces (admin :4000 + portail :4001) —");
  const listeAdm = await adm.get("/api/demandes");
  const lignesAdm = (listeAdm.json && (listeAdm.json.items || listeAdm.json.demandes || listeAdm.json.d)) || [];
  for (const c of CAS) {
    const attendu = c.cle === "T3-conge-2etapes" ? "ACCEPTEE" : c.statutAttendu;
    const dansAdm = lignesAdm.some((x) => x.reference === c.ref && x.statut === attendu);
    check("Interface admin (:4000) affiche " + c.ref + " = " + attendu, dansAdm,
      dansAdm ? "" : "trouvée=" + Boolean(lignesAdm.find((x) => x.reference === c.ref)));
  }
  const listePort = await port.get("/api/mes-demandes");
  const lignesPort = (listePort.json && (listePort.json.items || listePort.json.demandes)) || [];
  for (const c of CAS) {
    const attendu = c.cle === "T3-conge-2etapes" ? "ACCEPTEE" : c.statutAttendu;
    const dansPort = lignesPort.some((x) => x.reference === c.ref && (x.statut === attendu || statutConcordant(x.statutLibelle || x.libelle || "", attendu)));
    check("Interface portail (:4001) affiche " + c.ref + " = " + attendu, dansPort,
      dansPort ? "" : "trouvée=" + Boolean(lignesPort.find((x) => x.reference === c.ref)));
  }

  /* ---- 7) Résumé des délais ---- */
  console.log("\n— 7) MESURES DES DÉLAIS (exigence : < 60 000 ms) —");
  let maxDelai = 0;
  for (const m of mesures) {
    maxDelai = Math.max(maxDelai, m.delaiMs);
    console.log("  " + m.ref + " (" + m.label + ") : " + m.delaiMs + " ms " + (m.delaiMs < DELAI_MAX_MS ? "✓" : "✗ DÉPASSEMENT"));
  }
  check("TOUS les délais < 60 s", maxDelai > 0 && maxDelai < DELAI_MAX_MS, "max=" + maxDelai + " ms");

  console.log("\n======================================================================");
  console.log(" RÉSULTAT : " + ok + " OK / " + fail + " FAIL");
  if (echecs.length) { console.log(" Échecs :"); for (const e of echecs) console.log("   - " + e); }
  console.log("======================================================================");
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

function statutConcordant(libelle, statutBd) {
  const l = String(libelle || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (statutBd === "ACCEPTEE") return /ACCEPTE|VALID/.test(l);
  if (statutBd === "REFUSEE") return /REFUS/.test(l);
  if (statutBd === "EN_ATTENTE") return /ATTENTE/.test(l);
  return false;
}

main().catch((e) => { console.error("ERREUR FATALE : " + (e && e.stack || e)); process.exit(1); });
