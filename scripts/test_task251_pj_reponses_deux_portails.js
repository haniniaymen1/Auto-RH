#!/usr/bin/env node
"use strict";
/**
 * ============================================================================
 *  Task 251 — PIÈCES JOINTES DES RÉPONSES E-MAIL VISIBLES SUR LES DEUX PORTAILS
 * ============================================================================
 *  Demande utilisateur : « Lorsque RH ou manager répond sur un mail par refus
 *  ou acceptation et pièces jointes, les pièces jointes visualisées sur les
 *  deux portails » (administration :4000 ET portail employé :4001).
 *
 *  Principe (harnais Task 207 réutilisé — Gmail RÉEL) :
 *   - 2 demandes créées via le VRAI portail (congé EMPZOH001 → manager
 *     SMTPTest ; autorisation EMPZOH002 → manager rh3000@zoho) ;
 *   - réponses MANAGER par IMAP APPEND réel dans INBOX Gmail, avec PIÈCE
 *     JOINTE réelle (MIME multipart/mixed : PDF construit par le script,
 *     PNG embarqué) + formulation d'acceptation (« OK pour moi ») ;
 *   - réponses RH par VRAIS e-mails SMTP smtp.gmail.com (auto-adressés,
 *     In-Reply-To = Message-ID d'envoi), avec PIÈCE JOINTE réelle +
 *     formulation (« Je valide » / « Je refuse ») ;
 *   - le poller IMAP lit, importe les pièces (SHA-256, stockage chiffré),
 *     applique les décisions, transmet au RH ;
 *   - PREUVES : chaque pièce jointe est téléchargeable sur les DEUX portails
 *     avec le MÊME SHA-256 (octets d'origine == admin == portail employé) ;
 *     docSigne/docRefus également servis par les deux ; garde propriétaire
 *     (un autre employé ne peut PAS lire les documents d'autrui) ;
 *     interface portail : libellé « Pièce(s) jointe(s) transmise(s) avec la
 *     réponse (RH ou manager) » + boutons Visualiser/Télécharger présents.
 *
 *  Phases : prep → config → test → restore (IMAP OFF + flag \Seen restitué
 *  sur l'instantané — la boîte Gmail réelle de l'utilisateur est protégée).
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

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };

const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";
const SMTP_HOST = "smtp.gmail.com", SMTP_PORT = 465;
const IMAP_HOST = "imap.gmail.com", IMAP_PORT = 993;

const MGR_EMP1 = "smtp.test@autorh.tn";
const MGR_EMP2 = "rh3000@zohomail.com";
const MDP_PORTAIL = "Test-Zoho!2026";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const TMP = "/tmp/task251";
const ETAT = TMP + "/etat.json";
const SNAPSHOT_BOITE = TMP + "/boite-snapshot.json";
const JOURNAL = "logs/journal-emails.log";
const LIVRABLES = "download/task251-pj";

let ok = 0, fail = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  ✓ " + nom + (detail ? "  [" + detail + "]" : "")); }
  else { fail++; echecs.push(nom + (detail ? " — " + detail : "")); console.log("  ✗ " + nom + "  [" + (detail || "échec") + "]"); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dech = (v) => { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } };
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const relire = (ref) => db.demandeAdministrative.findUnique({ where: { reference: ref } });
function totpNow(base32) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/=+$/, "")) bits += alpha.indexOf(ch).toString(2).padStart(5, "0");
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.from(octets);
  const compteur = Buffer.alloc(8); compteur.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = crypto.createHmac("sha1", buf).update(compteur).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off + 1] << 16 | hmac[off + 2] << 8 | hmac[off + 3]) % 1000000;
  return String(code).padStart(6, "0");
}
function clientHttp(base) {
  let cookie = "";
  const appel = async (methode, chemin, corps) => {
    const r = await fetch(base + chemin, {
      method: methode, redirect: "manual",
      headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch {}
    return { status: r.status, json, buf, ct, headers: r.headers };
  };
  return {
    get: (c) => appel("GET", c), post: (c, b) => appel("POST", c, b), put: (c, b) => appel("PUT", c, b),
  };
}
async function avecImap(fn) {
  const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { return await fn(c); } finally { lock.release(); await c.logout().catch(() => {}); }
}
function ensemblesSequence(uids, tailleLot) {
  const tries = [...new Set(uids)].sort((a, b) => a - b); const lots = []; let courant = [];
  const pousser = () => { if (courant.length) lots.push(courant.join(",")); };
  for (const u of tries) { courant.push(u); if (courant.join(",").length >= (tailleLot || 4000)) { pousser(); courant = []; } }
  pousser(); return lots;
}
async function attendreStatut(ref, predicat, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && predicat(d)) return d;
    if (Date.now() - debut > (timeoutMs || 420000)) return d;
    await sleep(5000);
  }
}
async function attendreMessageId(ref, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && d.messageIdEnvoi) return d;
    if (Date.now() - debut > (timeoutMs || 60000)) return d;
    await sleep(3000);
  }
}
function journalDepuis(tISO, filtre) {
  try {
    return fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.horodatage && new Date(e.horodatage) >= new Date(tISO) && filtre(e));
  } catch { return []; }
}
function etatLire() { try { return JSON.parse(fs.readFileSync(ETAT, "utf8")); } catch { return {}; } }
function etatEcrire(obj) { fs.mkdirSync(TMP, { recursive: true }); fs.writeFileSync(ETAT, JSON.stringify(obj, null, 2)); }

/* ---------------- Constructeurs de pièces jointes RÉELLES ---------------- */
/** PDF 1 page VALIDE (xref correct — fichier ouvert par un lecteur réel). */
function pdfMinimal(titre) {
  const texte = titre.replace(/[()\\]/g, " ").slice(0, 90);
  const flux = "BT /F1 13 Tf 30 60 Td (" + texte + ") Tj ET";
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + flux.length + " >>\nstream\n" + flux + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objets.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return Buffer.from(pdf, "latin1");
}
/** PNG 1×1 réel (octets valides — signature PNG vérifiable). */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Réponse MANAGER : .eml MIME multipart/mixed (texte + pièces) → APPEND réel. */
async function appenderReponseManagerAvecPj({ de, nom, ref, type, texte, num, pjs }) {
  const sujet = "Re: AutoRH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref + " (traitement requis)";
  const frontiere = "BND251-" + num + "-" + Date.now();
  const parties = [
    "Message-ID: <task251-mgr-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: " + (nom ? '"' + nom.replace(/"/g, "'") + '" ' : "") + "<" + de + ">",
    "To: <" + GMAIL_USER + ">", "Subject: " + sujet, "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="' + frontiere + '"', "",
    "Ceci est un message multi-volumes au format MIME.", "--" + frontiere,
    'Content-Type: text/plain; charset=UTF-8', "Content-Transfer-Encoding: 8bit", "", texte, "",
  ];
  for (const pj of pjs) {
    parties.push("--" + frontiere,
      'Content-Type: ' + pj.typeMime + '; name="' + pj.nom + '"',
      'Content-Disposition: attachment; filename="' + pj.nom + '"',
      "Content-Transfer-Encoding: base64", "",
      pj.contenu.toString("base64").replace(/(.{76})/g, "$1\r\n"), "");
  }
  parties.push("--" + frontiere + "--", "");
  await avecImap(async (c) => c.append("INBOX", Buffer.from(parties.join("\r\n"), "utf8")));
  return sujet;
}
/** Réponse RH : VRAI e-mail SMTP (auto-adressé) AVEC pièces jointes. */
async function envoyerReponseRhAvecPj({ ref, type, texte, inReplyTo, pjs }) {
  const sujet = "Re: AutoRH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref;
  const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, connectionTimeout: 20000 });
  const info = await t.sendMail({
    from: '"Auto-RH Auto-RH (Task 251)" <' + GMAIL_USER + ">", to: GMAIL_USER, subject: sujet, text: texte,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
    attachments: pjs.map((p) => ({ filename: p.nom, content: p.contenu, contentType: p.typeMime })),
  });
  return { messageId: info.messageId, response: info.response, sujet };
}

/* ============================== CAS DE TEST ============================== */
const CAS = [
  {
    cle: "P1-conge-pj", cin: "EMPZOH001", type: "CONGE", destAttendu: MGR_EMP1, mgr: MGR_EMP1,
    corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2027-02-08", dateFin: "2027-02-12", commentaire: "Dossier Task 251 (pièces jointes des réponses, deux portails)" },
    pjManager: { nom: "justificatif-manager-P1.pdf", typeMime: "application/pdf" },
    texteManager: "OK pour moi, à valider par les RH. Vous trouverez le justificatif signé en pièce jointe.",
    pjRh: { nom: "planning-service-P1.png", typeMime: "image/png" },
    texteRh: "Je valide cette demande de congé. Le planning est joint pour information.",
    final: (d) => d.statut === "ACCEPTEE" && !!d.docSigneChemin, docGenere: "docSigne",
  },
  {
    cle: "P2-autor-pj", cin: "EMPZOH002", type: "AUTORISATION_SORTIE", destAttendu: MGR_EMP2, mgr: MGR_EMP2,
    corps: { type: "AUTORISATION_SORTIE", date: "2027-02-10", motif: "Démarche Task 251 (pièces jointes, deux portails)", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" },
    pjManager: { nom: "convocation-manager-P2.pdf", typeMime: "application/pdf" },
    texteManager: "OK pour moi, dossier complet en pièce jointe, à valider par les RH.",
    pjRh: { nom: "note-refus-P2.pdf", typeMime: "application/pdf" },
    texteRh: "Je refuse cette autorisation pour cette période, la note explicative est jointe.",
    final: (d) => d.statut === "REFUSEE" && d.refuseePar === "RH" && !!d.docRefusChemin, docGenere: "docRefus",
  },
];

module.exports = { CAS, check, sleep, dech, sha256, relire, totpNow, clientHttp, avecImap, ensemblesSequence, attendreStatut, attendreMessageId, journalDepuis, etatLire, etatEcrire, pdfMinimal, PNG_1PX, appenderReponseManagerAvecPj, envoyerReponseRhAvecPj, db, TMP, SNAPSHOT_BOITE, JOURNAL, LIVRABLES, PORTAIL, ADMIN, SUPERADMIN, GMAIL_USER, GMAIL_APP, SMTP_HOST, SMTP_PORT, IMAP_HOST, IMAP_PORT, MGR_EMP1, MGR_EMP2, MDP_PORTAIL, SECRET_TOTP, getOK: () => ok, getFail: () => fail, getEchecs: () => echecs };

/* Les phases (prep/config/test/restore) sont dans test_task251_phases.js. */
if (require.main === module) {
  const phase = process.argv[2] || "usage";
  const phases = require("./test_task251_phases.js");
  if (phases[phase]) phases[phase]();
  else { console.log("Usage : node scripts/test_task251_pj_reponses_deux_portails.js [prep|config|test|restore]"); db.$disconnect(); process.exit(2); }
}
