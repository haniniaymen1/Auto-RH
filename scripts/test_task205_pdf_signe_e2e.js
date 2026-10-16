#!/usr/bin/env node
/**
 * ============================================================================
 * Task 205 (v0.2.157) — TEST RÉEL ZOHO : RÉPONSE AUTOMATIQUE PAR E-MAIL AVEC
 * GÉNÉRATION D'UN PDF SIGNÉ ÉLECTRONIQUEMENT (congé / autorisation)
 * ============================================================================
 * Demande utilisateur (trace 1a11d0d9b629c401) :
 * « Refaire les tests précédents en activant la fonctionnalité de réponse
 *   automatique par e-mail avec génération d'un PDF signé électroniquement.
 *   1. créer une demande de congé ou d'autorisation ;
 *   2. vérifier le statut initial « En attente » ;
 *   3. activer la réponse automatique avec PDF signé électroniquement ;
 *   4. faire répondre le manager ou le RH par e-mail (acceptation puis refus) ;
 *   5. vérifier la mise à jour « En attente » → « Acceptée » / « Refusée » ;
 *   6. vérifier que le PDF de réponse automatique est généré et envoyé ;
 *   7. vérifier le contenu du PDF (demande, employé, manager/RH, statut) ;
 *   8. vérifier signature électronique + cachet + QR code visibles ;
 *   9. vérifier la disponibilité du PDF signé dans l'administration ET le
 *      portail employé ;
 *  10. vérifier la cohérence statut + document dans les deux interfaces. »
 *
 * Chaîne 100 % RÉELLE (héritée de la Task 204) :
 *   - demandes créées via le VRAI portail (:4001, CIN + mot de passe + OTP
 *     TOTP) → e-mails de demande RÉELS via smtp.zoho.com ;
 *   - réponses du MANAGER (EMPZOH002 : la boîte Zoho elle-même) envoyées par
 *     SMTP Zoho RÉEL (rh3000@zohomail.com → rh3000@zohomail.com) ;
 *   - réponses du RH (smtp.test@autorh.tn) injectées dans INBOX Zoho par
 *     IMAP APPEND (le poller du portail les lit comme un vrai message) ;
 *   - poller IMAP du portail (15 s) → traiterMessageRecu → matrice 2 étapes
 *     → statuts + génération AUTOMATIQUE du PDF (section « Réponse
 *     automatique PDF par e-mail » ACTIVÉE) : paraphe + cachet + QR code +
 *     cachet « Signature électronique » + mention légale + SIGNATURE PAdES
 *     par certificat dédié (.p12 importé via l'API d'administration) ;
 *   - envoi automatique du PDF signé (employé À + RH + manager Cc) via Zoho.
 *
 * PHASES (argument unique) :
 *   prep    : snapshot INBOX + tout marquer lu + activer IMAP en base
 *             (puis REDÉMARRER le portail avec AUTO_RH_IMAP_INTERVALLE=15)
 *   config  : ACTIVATION de la fonctionnalité via l'API d'administration
 *             RÉELLE (:4000, compte superadmin) — import certificat .p12
 *             (POST multipart action=certificat), configuration complète de
 *             la section (PUT /api/reponse-pdf-config), diagnostics
 *   test    : connexions, 4 demandes, statuts initiaux, vagues de réponses,
 *             vérifications complètes (statuts + PDF + interfaces)
 *   resume  : reprise (demandes déjà créées — fichier d'état /tmp)
 *   restore : restituer les non lus d'origine + désactiver IMAP
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { execSync } = require("child_process");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new (require("@prisma/client").PrismaClient)();
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const IMAP_HOST = "imap.zoho.com";
const SMTP_HOST = "smtp.zoho.com";
const EMAIL_RH = "smtp.test@autorh.tn";      // RH (boîte rhEmail de la config)
const EMAIL_EMPLOYE = "employe.test@autorh.tn";  // employé
const CIN_EMP = "EMPZOH002";                     // manager = la boîte Zoho elle-même
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP = "Test-Zoho!2026";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" }; // compte SUPERADMIN de laboratoire (comme Task 204)
const TMP = "/tmp/task205";
const ETAT = "/tmp/task205-etat.json";
const SNAPSHOT = "/tmp/zoho-snapshot-avant-task205.json";
const MDP_CERT = "Auto-RH-Task205!Cert";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

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

/** Client HTTP avec cookie persistant (JSON ou multipart). */
function client(base) {
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
    if ((res.headers.get("content-type") || "").includes("json")) {
      try { json = JSON.parse(texte); } catch { /* vide */ }
    }
    return { status: res.status, json, texte, octets: json ? null : tampon };
  };
  return {
    req, post: (p, c) => req("POST", p, c), put: (p, c) => req("PUT", p, c),
    get: (p) => req("GET", p),
  };
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

async function marquerToutLu() {
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try { await c.messageFlagsAdd({ uid: "1:*" }, ["\\Seen"], { uid: true }); }
    finally { lock.release(); }
  });
}

async function restituerNonLus(snapshot) {
  const uidsNonLus = snapshot.filter((m) => !m.vu).map((m) => m.uid);
  if (!uidsNonLus.length) return 0;
  return avecImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    let n = 0;
    try {
      for (const uid of uidsNonLus) {
        try { await c.messageFlagsRemove({ uid: String(uid) }, ["\\Seen"], { uid: true }); n++; }
        catch { /* message supprimé entre-temps */ }
      }
    } finally { lock.release(); }
    return n;
  });
}

/** APPEND d'une réponse RFC822 dans INBOX — SANS options (Zoho « CLIENTBUG »). */
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
    try { await c.append("INBOX", Buffer.from(brut, "utf8")); }
    finally { lock.release(); }
  });
}

/** RÉEL : réponse envoyée via SMTP Zoho (de la boîte vers elle-même). */
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

async function attendreStatuts(attentes, maxMs) {
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

/** Journal des envois (logs/journal-emails.log) — dernières lignes filtrées. */
function journalLignes(filtre) {
  const chemin = "logs/journal-emails.log";
  if (!fs.existsSync(chemin)) return [];
  const lignes = fs.readFileSync(chemin, "utf8").split(/\r?\n/).filter(Boolean);
  return lignes.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).filter((e) => (!filtre || filtre(e)));
}

function sujetReponse(ref, type) {
  const lib = type === "CONGE" ? "Demande de conge" : "Autorisation de sortie";
  return "Re: AutoRH - " + lib + " " + ref + " (traitement requis)";
}

/* ================== GÉNÉRATION CERTIFICAT + IMAGES ======================= */

/** Certificat PKCS#12 auto-signé (openssl) — titulaire Auto-RH Auto-RH. */
function genererCertificat() {
  fs.mkdirSync(TMP, { recursive: true });
  const cle = TMP + "/cert-rh.key";
  const crt = TMP + "/cert-rh.crt";
  const p12 = TMP + "/cert-rh.p12";
  const pem = TMP + "/cert-rh.pem";
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${cle}" -out "${crt}" -days 730 ` +
    `-subj "/CN=Auto-RH Auto-RH/O=Auto-RH/OU=Validation des demandes/emailAddress=rh@autorh.local" 2>/dev/null`);
  execSync(`openssl pkcs12 -export -inkey "${cle}" -in "${crt}" -name "Auto-RH Auto-RH" -out "${p12}" -passout pass:${MDP_CERT} 2>/dev/null`);
  // certificat public (vérification openssl smime)
  execSync(`openssl pkcs12 -in "${p12}" -passin pass:${MDP_CERT} -nokeys -clcerts -out "${pem}" 2>/dev/null`);
  return { p12, pem, octets: fs.readFileSync(p12) };
}

/** Paraphe (signature image) — SVG → PNG via sharp. */
async function genererParaphe() {
  const sharp = require("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="130">
  <rect width="360" height="130" fill="white"/>
  <g fill="none" stroke="#1d4ed8" stroke-width="2.6" stroke-linecap="round">
    <path d="M40 88 C 60 30, 96 26, 104 62 C 110 88, 84 100, 70 84 C 58 70, 84 44, 118 52"/>
    <path d="M128 66 C 138 46, 152 46, 156 60 C 160 74, 150 84, 142 76 C 136 68, 148 56, 166 60"/>
    <path d="M176 62 C 186 44, 200 46, 202 60 C 204 76, 190 86, 184 74"/>
    <path d="M212 58 C 224 46, 240 50, 236 64 C 232 78, 216 82, 214 70 C 212 60, 228 52, 244 58"/>
    <path d="M254 56 C 268 46, 284 50, 280 66 C 276 82, 258 86, 260 70"/>
    <path d="M292 52 C 300 60, 304 76, 298 88"/>
  </g>
  <text x="180" y="118" font-family="DejaVu Sans" font-size="15" font-style="italic" fill="#1d4ed8" text-anchor="middle">RH Test</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { octets: png, dataUrl: "data:image/png;base64," + png.toString("base64") };
}

/** Cachet (tampon de l'établissement) — SVG → PNG via sharp. */
async function genererCachet() {
  const sharp = require("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">
  <rect width="260" height="260" fill="white"/>
  <g fill="none" stroke="#b91c1c">
    <circle cx="130" cy="130" r="112" stroke-width="7"/>
    <circle cx="130" cy="130" r="94" stroke-width="2.5"/>
  </g>
  <text x="130" y="86" font-family="DejaVu Sans" font-weight="bold" font-size="26" fill="#b91c1c" text-anchor="middle">SERVICE RH</text>
  <text x="130" y="120" font-family="DejaVu Sans" font-size="17" fill="#b91c1c" text-anchor="middle">SERVICE RH</text>
  <text x="130" y="150" font-family="DejaVu Sans" font-size="14" fill="#b91c1c" text-anchor="middle">Ressources Humaines</text>
  <text x="130" y="178" font-family="DejaVu Sans" font-size="13" fill="#b91c1c" text-anchor="middle">Document validé</text>
  <line x1="60" y1="196" x2="200" y2="196" stroke="#b91c1c" stroke-width="2"/>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { octets: png, dataUrl: "data:image/png;base64," + png.toString("base64") };
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
  console.log("\n  → REDÉMARRER le portail avec AUTO_RH_IMAP_INTERVALLE=15 puis lancer : node scripts/test_task205_pdf_signe_e2e.js config");
  await db.$disconnect();
  process.exit(0);
}

/* ======================================================================== */
/* PHASE config : ACTIVATION de la fonctionnalité (API admin RÉELLE)         */
/* ======================================================================== */
async function phaseConfig() {
  console.log("== PHASE CONFIG — activation « Réponse automatique PDF par e-mail » via l'administration ==");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion INTERFACE D'ADMINISTRATION (:4000, superadmin)", login.status === 200, "status=" + login.status);
  if (login.status !== 200) { await db.$disconnect(); process.exit(1); }

  /* ---- état AVANT (la section ne doit pas encore être engagée) ---- */
  const avant = await adm.get("/api/reponse-pdf-config");
  check("GET /api/reponse-pdf-config lisible (rôle RH/superadmin)", avant.status === 200 && avant.json && avant.json.config,
    avant.status === 200 ? "actif=" + avant.json.config.actif + ", certificat présent=" + avant.json.config.certificat.present : "status=" + avant.status);

  /* ---- 1) certificat dédié : génération + IMPORT via l'API (multipart) ---- */
  const cert = genererCertificat();
  check("Certificat PKCS#12 généré (openssl, RSA 2048, 730 jours)", cert.octets.length > 500, (cert.octets.length / 1024).toFixed(1) + " Ko");
  const fd = new FormData();
  fd.append("action", "certificat");
  fd.append("fichier", new Blob([cert.octets], { type: "application/x-pkcs12" }), "certificat-rh-auto-rh.p12");
  fd.append("motDePasse", MDP_CERT);
  const imp = await adm.req("POST", "/api/reponse-pdf-config", fd);
  check("IMPORT du certificat dédié (POST multipart action=certificat)", imp.status === 200 && imp.json && imp.json.ok,
    imp.status === 200 ? "sujet=" + (imp.json.diagnostic && imp.json.diagnostic.sujet) : "status=" + imp.status + " " + JSON.stringify(imp.json || imp.texte || {}).slice(0, 160));
  if (imp.json && imp.json.diagnostic) {
    const d = imp.json.diagnostic;
    check("Diagnostic PKCS#12 (sujet/émetteur/validité lu par le serveur)", Boolean(d.sujet) && Boolean(d.emetteur) && !d.expire,
      "valide du " + d.valideDu + " au " + d.valideAu);
  }

  /* ---- 2) images paraphe + cachet (SVG → PNG) ---- */
  const paraphe = await genererParaphe();
  const cachet = await genererCachet();
  check("Image PARAPHE générée (PNG, via sharp)", paraphe.octets.length > 800, (paraphe.octets.length / 1024).toFixed(1) + " Ko");
  check("Image CACHET générée (PNG, via sharp)", cachet.octets.length > 800, (cachet.octets.length / 1024).toFixed(1) + " Ko");

  /* ---- 3) configuration COMPLÈTE de la section (PUT) ---- */
  const put = await adm.put("/api/reponse-pdf-config", {
    actif: true,
    // interrupteurs indépendants (v0.2.145)
    sigActif: true, tamponActif: true, signerActif: true,
    // paraphe
    sigImage: paraphe.dataUrl, sigImageNom: "paraphe-rh.png",
    sigPosition: "BAS_DROITE", sigTaille: 130,
    // cachet
    tamponImage: cachet.dataUrl, tamponImageNom: "cachet-auto-rh.png",
    tamponPosition: "BAS_GAUCHE", tamponTaille: 150,
    // QR code (mode DONNEES : empreinte + référence encodées)
    qrActif: true, qrMode: "DONNEES", qrPosition: "BAS_GAUCHE", qrTaille: 110,
    // bloc certificat + cachet « Signature électronique »
    certActif: true, certPosition: "BAS_CENTRE",
    certSignataire: "RH Test", certFonction: "Responsable RH",
    certMotDePasse: MDP_CERT,
    elecActif: true, elecPosition: "BAS_DROITE", elecTaille: 100, elecForme: "RECTANGLE",
    elecAffSignataire: true, elecAffOrganisation: true, elecAffEmetteur: true,
    elecAffValidite: true, elecAffEmpreinte: true,
    // mention légale
    mentionActif: true, mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
    // envoi e-mail automatique
    emailActif: true,
    emailObjet: "Votre {TYPE} — {REF} : {STATUT} — réponse PDF signée jointe",
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  });
  check("PUT /api/reponse-pdf-config (section ACTIVÉE : actif + paraphe + cachet + QR + cachet électronique + mention + envoi)", put.status === 200 && put.json && put.json.ok,
    "status=" + put.status + " " + JSON.stringify(put.json || put.texte || {}).slice(0, 160));

  /* ---- 4) diagnostic du certificat configuré ---- */
  const fdv = new FormData();
  fdv.append("action", "verifier-certificat");
  const verif = await adm.req("POST", "/api/reponse-pdf-config", fdv);
  check("Diagnostic du certificat DÉDIÉ configuré (verifier-certificat)", verif.status === 200 && verif.json && verif.json.ok,
    verif.json && verif.json.message ? verif.json.message : "status=" + verif.status);

  /* ---- 5) relecture GET : la section est ENGAGÉE ---- */
  const apres = await adm.get("/api/reponse-pdf-config");
  const c = apres.json && apres.json.config;
  check("Section engagée (actif=true, certificat présent, mot de passe enregistré)",
    Boolean(c) && c.actif === true && c.certificat.present === true && c.certificat.hasCertPassword === true,
    c ? "empreinte=" + String(c.certificat.empreinte).slice(0, 16) + "…" : "");
  check("Images enregistrées (paraphe + cachet)", Boolean(c && c.paraphe.presente) && Boolean(c && c.tampon.presente));
  check("QR actif (mode " + (c && c.qr.mode) + ") + cachet électronique actif + mention active",
    Boolean(c && c.qr.actif) && Boolean(c && c.elec.actif) && Boolean(c && c.mention.actif));
  check("Envoi e-mail activé (employé + RH + manager)", Boolean(c && c.envoi.actif) && c.envoi.envoyerEmploye === true && c.envoi.envoyerRh === true && c.envoi.envoyerManager === true,
    "rhEmail=" + (c && c.envoi.rhEmail));

  /* ---- 6) contrôle BD : ReponsePdfConfig devient LA source de vérité ---- */
  const rpc = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
  check("BD : ligne ReponsePdfConfig engagée (actif OU certificat) → prioritaire sur le module historique",
    Boolean(rpc) && (rpc.actif || Boolean(rpc.certChemin)),
    rpc ? "certChemin=" + rpc.certChemin + ", certSujet=" + rpc.certSujet : "");
  check("BD : fichier du certificat stocké CHIFFRÉ (storage/reponse-pdf/)", rpc && /^storage\/reponse-pdf\/certificat-.*\.p12$/.test(rpc.certChemin || "") && fs.existsSync(rpc.certChemin));

  /* ---- état du test (pour la phase test) ---- */
  fs.writeFileSync(ETAT, JSON.stringify({ certPem: cert.pem, certP12: cert.p12, certMdp: MDP_CERT }, null, 2));
  console.log("\n  → Lancer : node scripts/test_task205_pdf_signe_e2e.js test");
  await db.$disconnect();
  process.exit(0);
}

/* ======================================================================== */
/* PHASE test : scénario complet + VÉRIFICATIONS PDF                         */
/* ======================================================================== */
const CONGE_BODY = { typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-11", commentaire: "Dossier Task 205 (PDF signé)" };
const AUTOR_BODY = { date: "2026-12-10", motif: "Démarche administrative Task 205", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" };

/** Les 4 cas = congé/autorisation × acceptation/refus — TOUS employé
 *  EMPZOH002 (manager = la boîte Zoho : réponses manager en SMTP RÉEL,
 *  réponses RH en IMAP APPEND From smtp.test@autorh.tn). */
function construireCas(reprise) {
  const etat = reprise && fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : null;
  const base = [
    { cle: "D1", type: "CONGE", note: "congé — MATRICE 2 ÉTAPES : manager accepte (SMTP réel) → transmission RH → RH accepte (APPEND) → ACCEPTEE + PDF d'acceptation signé",
      form1: "Je valide cette demande de congé.", form2: "Je valide également au niveau du service RH.",
      final: "ACCEPTEE", doc: "acceptation" },
    { cle: "D2", type: "CONGE", note: "congé — REFUS du MANAGER (SMTP réel) → REFUSÉE par le Manager + PDF de refus",
      form1: "Je refuse cette demande de congé.", final: "REFUSEE", refuseePar: "MANAGER", doc: "refus" },
    { cle: "D3", type: "AUTORISATION_SORTIE", note: "autorisation — MATRICE 2 ÉTAPES : manager accepte (SMTP réel) → RH accepte (APPEND) → ACCEPTEE + PDF signé",
      form1: "OK pour cette autorisation.", form2: "D'accord, validée par le service RH.",
      final: "ACCEPTEE", doc: "acceptation" },
    { cle: "D4", type: "AUTORISATION_SORTIE", note: "autorisation — REFUS des RH (APPEND) → REFUSÉE par les RH + PDF de refus",
      form1: "Je refuse cette autorisation de sortie.", final: "REFUSEE", refuseePar: "RH", doc: "refus" },
  ];
  if (etat && etat.cas) {
    for (const c of base) {
      const ancien = etat.cas.find((x) => x.cle === c.cle);
      if (ancien) Object.assign(c, ancien);
    }
  }
  return base;
}

async function sauverEtat(cas, extra) {
  let etat = {};
  try { etat = JSON.parse(fs.readFileSync(ETAT, "utf8")); } catch { /* */ }
  etat.cas = cas.map((c) => ({ cle: c.cle, ref: c.ref || null, messageId: c.messageId || null,
    form1: c.form1, form2: c.form2, final: c.final, refuseePar: c.refuseePar || null, doc: c.doc }));
  Object.assign(etat, extra || {});
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 2));
}

/** Déchiffre un fichier stocké (documents-demandes) — RÉPLICATION LOCALE de
 *  decryptFromStorage() du portail (AES-256-GCM, en-tête PAIESAGE1, nonce 12,
 *  tag 16, clé scrypt(AUTO_RH_STORAGE_KEY|AUTH_SECRET, autorh-storage-v1)).
 *  (require("./portail-server.js") est INTERDIT ici : il démarrerait un 2e serveur.) */
const ENC_MAGIC = Buffer.from("PAIESAGE1", "utf8");
const ENC_SALT = "autorh-storage-v1";
function decryptFromStorage(buf) {
  if (!(Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length + 12 + 16 && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC))) return buf;
  const cle = crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env",
    ENC_SALT, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", cle, buf.subarray(ENC_MAGIC.length, ENC_MAGIC.length + 12));
  decipher.setAuthTag(buf.subarray(ENC_MAGIC.length + 12, ENC_MAGIC.length + 12 + 16));
  return Buffer.concat([decipher.update(buf.subarray(ENC_MAGIC.length + 28)), decipher.final()]);
}
function dechiffrerFichierStocke(chemin) {
  return decryptFromStorage(fs.readFileSync(chemin));
}

/** Extrait la signature PKCS#7 d'un PDF signé (@signpdf) : ByteRange + /Contents. */
function extraireSignaturePdf(pdf) {
  const s = pdf.toString("latin1");
  const mBr = s.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!mBr) return null;
  const b1 = +mBr[1], l1 = +mBr[2], b2 = +mBr[3], l2 = +mBr[4];
  // (corrigé Task 205) le hex de /Contents occupe le TROU de la signature
  // (entre la fin de la 1re plage et le début de la 2e) — chercher DANS ce trou
  const mCont = s.slice(Math.max(0, b1 + l1 - 250), b2 + 50).match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
  if (!mCont) return null;
  return { b1, l1, b2, l2, contenuHex: mCont[1] };
}

async function phaseTest(mode) {
  const reprise = mode === "resume";
  console.log("== PHASE TEST — réponse automatique + PDF signé (Zoho RÉEL)" + (reprise ? " [REPRISE]" : "") + " ==");
  const adm = client(ADMIN);
  const cas = construireCas(reprise);

  /* ---- 1) connexions RÉELLES ---- */
  console.log("\n— 1) Connexions réelles —");
  const loginAdm = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion INTERFACE D'ADMINISTRATION (:4000, superadmin)", loginAdm.status === 200, "status=" + loginAdm.status);
  const port = client(PORTAIL);
  const rP = await port.post("/api/verify", { cin: CIN_EMP, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion PORTAIL EMPLOYÉ (:4001, " + CIN_EMP + " — CIN + mot de passe + OTP TOTP)", rP.status === 200 && rP.json && rP.json.ok, "status=" + rP.status);

  /* ---- 2) création des demandes (via le VRAI portail) ---- */
  if (!reprise) {
    console.log("\n— 2) Création des 4 demandes via le portail (e-mails RÉELS via smtp.zoho.com) —");
    for (const c of cas) {
      const corps = c.type === "CONGE" ? { type: "CONGE", ...CONGE_BODY } : { type: "AUTORISATION_SORTIE", ...AUTOR_BODY };
      const r = await port.post("/api/demandes", corps);
      if (r.status === 201 && r.json && r.json.reference) {
        c.ref = r.json.reference;
        check("Demande " + c.cle + " créée (" + (c.type === "CONGE" ? "congé" : "autorisation") + ") → " + c.ref + " — destinataire : " + (r.json.destinataire || "?"), true);
      } else {
        check("Demande " + c.cle + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 160));
      }
      await sleep(400);
    }
    await sauverEtat(cas);
  } else {
    console.log("\n— 2) REPRISE des demandes déjà créées —");
    for (const c of cas) {
      const d = c.ref ? await relire(c.ref) : null;
      check("Demande " + c.cle + " reprise (" + c.ref + ") — statut courant : " + (d ? d.statut : "??"), Boolean(d), c.note);
    }
  }
  if (cas.some((c) => !c.ref)) { console.log("  Création incomplète — relancer en resume après correction."); await db.$disconnect(); process.exit(1); }

  /* ---- 3) Message-ID d'envoi ---- */
  console.log("\n— 3) Attente des envois SMTP arrière-plan (Message-ID) —");
  let essais = 0, manquants = [];
  do {
    await sleep(5000); essais++;
    manquants = [];
    for (const c of cas) {
      if (c.messageId) continue;
      const d = await relire(c.ref);
      if (d && d.messageIdEnvoi) c.messageId = d.messageIdEnvoi;
      else manquants.push(c.ref);
    }
  } while (manquants.length && essais < 8);
  check("Message-ID d'envoi présents (e-mails de demande PARTIS via Zoho)", manquants.length === 0,
    manquants.length ? "manquants (rattachement par sujet) : " + manquants.join(", ") : cas.length + "/" + cas.length);
  await sauverEtat(cas);

  /* ---- 4) statut INITIAL « En attente » (les DEUX interfaces) ---- */
  console.log("\n— 4) Statut initial « En attente » (étape 2 du scénario) —");
  const mes = await port.get("/api/mes-demandes");
  const itemsPortail = (mes.json && mes.json.items) || [];
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  const aVerifierInit = reprise ? cas.filter((x) => !fs.existsSync(ETAT + ".vague1")) : cas;
  for (const c of aVerifierInit) {
    const p = itemsPortail.find((x) => x.reference === c.ref);
    const a = itemsAdm.find((x) => x.reference === c.ref);
    check(c.cle + " (" + c.ref + ") « En attente » dans le PORTAIL EMPLOYÉ", p && p.statut === "EN_ATTENTE",
      p ? "portail=" + p.statut : "absent du portail");
    check(c.cle + " (" + c.ref + ") « En attente » dans l'ADMINISTRATION", a && a.statut === "EN_ATTENTE",
      a ? "admin=" + a.statut : "absent de l'admin");
  }

  /* ---- 5) VAGUE 1 : réponses du MANAGER (SMTP RÉEL) + refus RH ---- */
  if (!reprise || !fs.existsSync(ETAT + ".vague1")) {
    console.log("\n— 5) VAGUE 1 — réponses du manager (SMTP Zoho RÉEL rh3000→rh3000) + refus RH (APPEND) —");
    for (const c of cas) {
      try {
        if (c.doc === "refus" && c.refuseePar === "RH") {
          await appenderReponse({ de: EMAIL_RH, sujet: sujetReponse(c.ref, c.type), inReplyTo: c.messageId,
            texte: c.form1, msgId: "task205-" + c.cle + "-rh@reponse.test" });
          console.log("  → IMAP APPEND (From " + EMAIL_RH + " — RH) | " + c.cle + " " + c.ref + " | « " + c.form1 + " »");
        } else {
          await envoyerReponseSmtp({ sujet: sujetReponse(c.ref, c.type), inReplyTo: c.messageId, texte: c.form1 });
          console.log("  → SMTP RÉEL " + ZOHO_USER + " → " + ZOHO_USER + " (manager) | " + c.cle + " " + c.ref + " | « " + c.form1 + " »");
        }
      } catch (e) { check("Réponse " + c.cle + " injectée", false, e.message); }
      await sleep(1500);
    }
    fs.writeFileSync(ETAT + ".vague1", "fait");
  } else { console.log("\n— 5) VAGUE 1 déjà injectée (reprise) —"); }

  console.log("\n— 6) Poller IMAP (15 s) : étape 1 de la matrice + refus —");
  const attentes1 = [];
  for (const c of cas) {
    if (c.doc === "refus") attentes1.push({ ref: c.ref, pred: (d) => d.statut === "REFUSEE" });
    else attentes1.push({ ref: c.ref, pred: (d) => d.decisionManager === "ACCEPTEE" });
  }
  const reste1 = await attendreStatuts(attentes1, 240000);
  check("Toutes les réponses de la VAGUE 1 traitées par le poller", reste1.size === 0,
    reste1.size ? "non traitées : " + [...reste1.keys()].join(", ") : cas.length + "/" + cas.length);
  for (const c of cas) {
    const d = await relire(c.ref);
    if (c.doc === "refus") {
      check(c.cle + " " + c.ref + " → « Refusée » (par " + (d.refuseePar === "MANAGER" ? "le Manager" : "les RH") + ")",
        d.statut === "REFUSEE" && d.refuseePar === c.refuseePar, "statut=" + d.statut + ", refuseePar=" + d.refuseePar);
    } else {
      check(c.cle + " " + c.ref + " étape 1 : manager ACCEPTEE, demande toujours « En attente » (transmission RH)",
        d.decisionManager === "ACCEPTEE" && d.statut === "EN_ATTENTE", "decisionManager=" + d.decisionManager + ", statut=" + d.statut);
    }
  }
  await sauverEtat(cas, { vague1: "traitee" });

  /* ---- 7) VAGUE 2 : acceptations des RH (APPEND) ---- */
  if (!fs.existsSync(ETAT + ".vague2")) {
    console.log("\n— 7) VAGUE 2 — acceptations du RH (IMAP APPEND From " + EMAIL_RH + ") —");
    for (const c of cas.filter((x) => x.doc === "acceptation")) {
      try {
        await appenderReponse({ de: EMAIL_RH, sujet: sujetReponse(c.ref, c.type), inReplyTo: c.messageId,
          texte: c.form2, msgId: "task205-" + c.cle + "-rh2@reponse.test" });
        console.log("  → IMAP APPEND (From " + EMAIL_RH + " — RH) | " + c.cle + " " + c.ref + " | « " + c.form2 + " »");
      } catch (e) { check("Réponse " + c.cle + " injectée", false, e.message); }
      await sleep(1500);
    }
    fs.writeFileSync(ETAT + ".vague2", "fait");
  } else { console.log("\n— 7) VAGUE 2 déjà injectée (reprise) —"); }

  console.log("\n— 8) Poller IMAP : étape 2 de la matrice (décision FINALE + génération PDF) —");
  const attentes2 = cas.filter((x) => x.doc === "acceptation").map((c) => ({
    ref: c.ref,
    pred: (d) => d.statut === "ACCEPTEE" && Boolean(d.docSigneChemin),
  }));
  const reste2 = await attendreStatuts(attentes2, 240000);
  check("Décisions finales + PDF d'acceptation générés (docSigneChemin posé)", reste2.size === 0,
    reste2.size ? "manquants : " + [...reste2.keys()].join(", ") : "");
  for (const c of cas.filter((x) => x.doc === "acceptation")) {
    const d = await relire(c.ref);
    check(c.cle + " " + c.ref + " → « Acceptée » (matrice complète manager + RH)",
      d.statut === "ACCEPTEE", "statut=" + d.statut + ", decisionManager=" + d.decisionManager + ", decisionRh=" + d.decisionRh);
    check(c.cle + " " + c.ref + " PDF signé enregistré sur la demande (docSigneNom=" + d.docSigneNom + ")",
      Boolean(d.docSigneChemin) && Boolean(d.docSigneNom) && Boolean(d.docSigneLe));
  }
  await sauverEtat(cas, { vague2: "traitee" });
  console.log("\n  → Statuts finaux posés. Lancer : node scripts/test_task205_pdf_signe_e2e.js verifier");
  await db.$disconnect();
  process.exit(0);
}

/* ======================================================================== */
/* PHASE verifier : PDF générés + envoyés + contenu + signature + interfaces */
/* ======================================================================== */
async function phaseVerifier() {
  console.log("== PHASE VERIFIER — PDF signés : génération, envoi, contenu, signature, 2 interfaces ==");
  const adm = client(ADMIN);
  const loginAdm = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion administration (:4000)", loginAdm.status === 200, "status=" + loginAdm.status);
  const port = client(PORTAIL);
  await port.post("/api/verify", { cin: CIN_EMP, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });

  const cas = construireCas(true);
  fs.mkdirSync(TMP + "/pdfs", { recursive: true });
  let certPem = null;
  try { certPem = JSON.parse(fs.readFileSync(ETAT, "utf8")).certPem; } catch { /* */ }

  const resultats = [];
  for (const c of cas) {
    console.log("\n===== " + c.cle + " " + c.ref + " (" + (c.doc === "acceptation" ? "ACCEPTATION" : "REFUS") + ") =====");
    const d = await relire(c.ref);
    const cheminRel = c.doc === "acceptation" ? d.docSigneChemin : d.docRefusChemin;
    const nomDoc = c.doc === "acceptation" ? d.docSigneNom : d.docRefusNom;
    const par = c.doc === "acceptation" ? d.docSignePar : d.docRefusPar;
    const erreurDoc = c.doc === "acceptation" ? d.docSigneErreur : d.docRefusErreur;

    /* ---- 6) le PDF est généré et conservé ---- */
    check(c.cle + " PDF " + c.doc + " GÉNÉRÉ (docSigne*/docRefus* posés)", Boolean(cheminRel),
      cheminRel ? cheminRel + " (" + nomDoc + ", par : " + par + ")" : (erreurDoc || "absent"));
    const cheminAbs = "storage/documents-demandes/" + cheminRel;
    let pdf = null;
    if (cheminRel && fs.existsSync(cheminAbs)) {
      try { pdf = dechiffrerFichierStocke(cheminAbs); } catch (e) { pdf = null; console.log("  (déchiffrement KO : " + e.message + ")"); }
    }
    check(c.cle + " fichier stocké CHIFFRÉ lisible (AES-256-GCM → PDF valide)", pdf && pdf.slice(0, 5).toString() === "%PDF-",
      pdf ? (pdf.length / 1024).toFixed(1) + " Ko" : "illisible/absent");
    const docRow = await db.documentDemande.findFirst({ where: { chemin: cheminRel } });
    check(c.cle + " DocumentDemande lié (visible RH + portail)", Boolean(docRow),
      docRow ? docRow.nomFichier + ", recuDe=« " + docRow.recuDe + " »" : "absent");
    check(c.cle + " empreinte SHA-256 du DocumentDemande = empreinte réelle du fichier",
      docRow && pdf && docRow.empreinte === sha256(pdf));
    resultats.push({ c, d, docRow, pdf, nomDoc });

    /* ---- journal : génération + ENVOI e-mail automatique ---- */
    const entrees = journalLignes((e) => e.action === (c.doc === "acceptation" ? "doc-signe" : "doc-refus") && e.reference === c.ref);
    const succes = entrees.find((e) => e.succes === true);
    check(c.cle + " JOURNAL : entrée " + (c.doc === "acceptation" ? "doc-signe" : "doc-refus") + " succès (génération)", Boolean(succes),
      succes ? "elements=" + JSON.stringify(succes.elements) + " signatureCrypto=" + succes.signatureCrypto : (entrees[0] ? JSON.stringify(entrees[0]).slice(0, 160) : "absente"));
    check(c.cle + " JOURNAL : SIGNATURE CRYPTOGRAPHIQUE appliquée (signatureCrypto=true)", Boolean(succes && succes.signatureCrypto === true));
    check(c.cle + " JOURNAL : éléments du tampon appliqués (paraphe + cachet + QR + cachet électronique)",
      Boolean(succes && Array.isArray(succes.elements) && succes.elements.includes("signature") && succes.elements.includes("tampon") && succes.elements.includes("qr") && succes.elements.includes("elec")),
      succes ? "[" + (succes.elements || []).join(", ") + "]" : "");
    const avertissements = succes && succes.avertissements || [];
    check(c.cle + " JOURNAL : aucun avertissement (certificat complet)", avertissements.length === 0, avertissements.join(" | "));
    check(c.cle + " JOURNAL : e-mail automatique ENVOYÉ (envoi=envoye)", Boolean(succes && succes.envoi === "envoye"), succes ? "envoi=" + succes.envoi : "");
    const traceDest = c.doc === "acceptation" ? dech(d.docSigneDestinataires) : dech(d.docRefusDestinataires);
    let dests = {};
    try { dests = JSON.parse(traceDest || "{}"); } catch { /* */ }
    check(c.cle + " trace destinataires : employé À + RH/manager Cc",
      Boolean(dests.a) && Array.isArray(dests.cc) && dests.cc.length > 0,
      "À=" + dests.a + ", Cc=" + JSON.stringify(dests.cc || []));
    const envoiLe = c.doc === "acceptation" ? d.docSigneEnvoiLe : d.docRefusEnvoiLe;
    check(c.cle + " horodatage d'ENVOI posé sur la demande (docSigneEnvoiLe/docRefusEnvoiLe)", Boolean(envoiLe), envoiLe ? new Date(envoiLe).toISOString() : "absent");
  }

  /* ---- 7) CONTENU des PDF (pdftotext) ---- */
  console.log("\n— 7) CONTENU des PDF (pdftotext) —");
  for (const r of resultats) {
    const { c, pdf, d } = r;
    if (!pdf) continue;
    const cheminPdf = TMP + "/pdfs/" + c.cle + "-" + c.ref + ".pdf";
    fs.writeFileSync(cheminPdf, pdf);
    let texte = "";
    try { texte = execSync(`pdftotext "${cheminPdf}" - 2>/dev/null`).toString(); } catch { /* */ }
    r.cheminPdf = cheminPdf; r.texte = texte;
    const employeNom = (d.employeEmail && dech(d.employeEmail)) || "";
    const donnees = JSON.parse(cryptoBd.dechiffrerChamp(d.donnees) || "{}");
    const attendus = [
      ["référence de la demande", c.ref],
      ["type de document", c.doc === "acceptation" ? (c.type === "CONGE" ? "Demande de congé" : "Autorisation de sortie") : "DÉCISION DE REFUS"],
      ["statut final", c.doc === "acceptation" ? "Acceptée" : "Refusée"],
      ["CIN de l'employé", "EMPZOH002"],
      ["e-mail de l'employé", EMAIL_EMPLOYE],
      ["décideur (réponse e-mail)", "réponse e-mail"],
      ["mention légale signée", "Document signé électroniquement"],
    ];
    if (c.type === "CONGE") attendus.push(["type de congé", "Congé annuel"], ["date de début", "07/12/2026"], ["date de fin", "11/12/2026"]);
    else attendus.push(["motif", "Démarche administrative Task 205"], ["heures", "2"]);
    if (c.doc === "acceptation") {
      attendus.push(["validation MANAGER tracée", "Manager"]);
      if (c.refuseePar === null) attendus.push(["validation RH tracée (matrice complète)", "Auto-RH"]);
    } else {
      attendus.push(["origine du refus", c.refuseePar === "MANAGER" ? "Manager" : "RH"]);
    }
    for (const [libelle, needle] of attendus) {
      check(c.cle + " PDF contient " + libelle + " (« " + needle + " »)", texte.includes(needle));
    }
  }

  /* ---- 8) SIGNATURE ÉLECTRONIQUE (PAdES — vérification openssl) ---- */
  console.log("\n— 8) SIGNATURE ÉLECTRONIQUE (PKCS#7/CAdES détaché — vérification openssl) —");
  for (const r of resultats) {
    const { c, pdf, cheminPdf } = r;
    if (!pdf) continue;
    const sig = extraireSignaturePdf(pdf);
    check(c.cle + " PDF signé cryptographiquement (/ByteRange présent)", Boolean(sig));
    if (!sig) continue;
    const contenu = Buffer.concat([
      pdf.subarray(sig.b1, sig.b1 + sig.l1),
      pdf.subarray(sig.b2, sig.b2 + sig.l2),
    ]);
    const der = Buffer.from(sig.contenuHex, "hex");
    const cheminSig = TMP + "/pdfs/" + c.cle + "-signature.der";
    const cheminContenu = TMP + "/pdfs/" + c.cle + "-contenu.bin";
    fs.writeFileSync(cheminSig, der);
    fs.writeFileSync(cheminContenu, contenu);
    const couvreTout = sig.b1 === 0 && (sig.b2 + sig.l2) === pdf.length;
    check(c.cle + " ByteRange couvre TOUT le document (signature détachée intégrale)", couvreTout,
      "b1=0, l1=" + sig.l1 + ", fin=" + (sig.b2 + sig.l2) + "/" + pdf.length);
    if (!certPem || !fs.existsSync(certPem)) {
      check(c.cle + " openssl smime -verify", false, "certificat public absent (" + certPem + ")");
      continue;
    }
    let verdict = "";
    try {
      verdict = execSync(`openssl smime -verify -in "${cheminSig}" -inform DER -content "${cheminContenu}" -CAfile "${certPem}" -purpose any 2>&1`).toString();
    } catch (e) { verdict = String(e.stdout || "") + String(e.stderr || e.message || ""); }
    check(c.cle + " SIGNATURE PKCS#7 CRYPTOGRAPHIQUEMENT VALIDE (openssl smime -verify, certificat dédié)", verdict.includes("Verification successful"), verdict.trim().split(/\r?\n/).slice(-2).join(" | "));
  }

  /* ---- 9) RENDU VISUEL (pdftoppm → PNG) : paraphe, cachet, QR, cachet électronique ---- */
  console.log("\n— 9) RENDU VISUEL (pdftoppm 150 dpi, page 1) —");
  for (const r of resultats) {
    const { c, cheminPdf } = r;
    if (!cheminPdf) continue;
    const base = TMP + "/pdfs/" + c.cle + "-rendu";
    try {
      execSync(`pdftoppm -png -r 150 -f 1 -singlefile "${cheminPdf}" "${base}" 2>/dev/null`);
      r.pngRendu = base + ".png";
      check(c.cle + " rendu PNG généré (inspection visuelle paraphe/cachet/QR/cachet électronique)", fs.existsSync(r.pngRendu), r.pngRendu);
    } catch (e) { check(c.cle + " rendu PNG généré", false, e.message); }
  }

  /* ---- 10) les DEUX interfaces : statut + document cohérents ---- */
  console.log("\n— 10) COHÉRENCE des DEUX interfaces (statut + document) —");
  const mes = await port.get("/api/mes-demandes");
  const itemsPortail = (mes.json && mes.json.items) || [];
  for (const r of resultats) {
    const { c, d, docRow, pdf } = r;
    const det = await adm.get("/api/demandes/" + d.id);
    const dj = (det.json && det.json.item) || {};  // (corrigé) l'API renvoie { item: {…} }
    const p = itemsPortail.find((x) => x.reference === c.ref);
    /* administration */
    const traceAdmin = c.doc === "acceptation" ? dj.docSigne : dj.docRefus;
    check(c.cle + " ADMINISTRATION : statut final concordant (« " + (dj.statutFinalLibelle || dj.statut) + " » = " + c.final + ")",
      dj.statut === c.final, "statut=" + dj.statut + ", libellé=" + dj.statutFinalLibelle);
    check(c.cle + " ADMINISTRATION : document " + c.doc + " VISIBLE (docSigne/docRefus present=true, auto + courant)",
      Boolean(traceAdmin && traceAdmin.present) && (dj.documents || []).some((x) => x.auto && x.courant && x.nomFichier === r.nomDoc),
      traceAdmin ? "généré le " + traceAdmin.le + " — envoi le " + (traceAdmin.envoiLe || "—") : "absent");
    check(c.cle + " ADMINISTRATION : aucune erreur d'envoi tracée", Boolean(traceAdmin) && !traceAdmin.erreur, traceAdmin ? (traceAdmin.erreur || "aucune") : "");
    const docAdmin = (dj.documents || []).find((x) => x.auto && x.courant);
    if (docAdmin && pdf) {
      const dl = await adm.get("/api/demandes/" + d.id + "/documents/" + docAdmin.id);
      check(c.cle + " ADMINISTRATION : TÉLÉCHARGEMENT du PDF signé (HTTP 200, application/pdf)", dl.status === 200 && dl.octets && dl.octets.slice(0, 5).toString() === "%PDF-",
        dl.status + ", " + ((dl.octets || []).length / 1024).toFixed(1) + " Ko");
      check(c.cle + " ADMINISTRATION : le PDF servi = EXACTEMENT le PDF signé (SHA-256 identique)",
        dl.octets && pdf && sha256(dl.octets) === sha256(pdf));
    }
    /* portail employé */
    check(c.cle + " PORTAIL EMPLOYÉ : statut final concordant (« " + (p && p.statutLibelle) + " »)",
      p && p.statut === c.final, p ? "statut=" + p.statut + ", libellé=" + p.statutLibelle : "absent");
    const docPortail = p && (p.documents || []).find((x) => x.nomFichier === r.nomDoc);
    check(c.cle + " PORTAIL EMPLOYÉ : document signé listé dans « Mes demandes » (recuDe=« Génération automatique (document signé) »)",
      Boolean(docPortail), docPortail ? docPortail.tailleLisible + ", recuDe=« " + docPortail.recuDe + " »" : "absent");
    if (docPortail && pdf) {
      const dlp = await port.get("/api/mes-demandes/documents/" + docPortail.id);
      check(c.cle + " PORTAIL EMPLOYÉ : TÉLÉCHARGEMENT du PDF signé (HTTP 200, %PDF)", dlp.status === 200 && dlp.octets && dlp.octets.slice(0, 5).toString() === "%PDF-",
        dlp.status + ", " + ((dlp.octets || []).length / 1024).toFixed(1) + " Ko");
      check(c.cle + " PORTAIL EMPLOYÉ : le PDF servi = EXACTEMENT le PDF signé (SHA-256 identique)",
        dlp.octets && pdf && sha256(dlp.octets) === sha256(pdf));
    }
    /* cohérence croisée */
    check(c.cle + " COHÉRENCE : même document, mêmes statuts dans les DEUX interfaces",
      Boolean(docAdmin) && Boolean(docPortail) && dj.statut === (p && p.statut));
  }

  /* ---- récapitulatif ---- */
  console.log("\n=========================== RÉCAPITULATIF ===========================");
  console.log("  OK : " + ok + "   FAIL : " + fail);
  for (const r of resultats) {
    console.log("  " + r.c.cle + " " + r.c.ref + " (" + r.c.type + ") → " + (r.c.doc === "acceptation" ? "Acceptée" : "Refusée (par " + (r.c.refuseePar === "MANAGER" ? "le Manager" : "les RH") + ")") +
      " — PDF : " + (r.pdf ? (r.pdf.length / 1024).toFixed(1) + " Ko" : "ABSENT") + (r.pngRendu ? " — rendu : " + r.pngRendu : ""));
  }
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* PHASE restore : restituer les non lus d'origine + DÉSACTIVER IMAP         */
/* ======================================================================== */
async function phaseRestore() {
  console.log("== PHASE RESTORE — restitution boîte + arrêt poller ==");
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const n = await restituerNonLus(snap);
  check("Messages d'origine restitués en NON LU", true, n + " message(s)");
  await db.mailConfig.update({ where: { id: "smtp" }, data: { imapActif: false } });
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  check("IMAP désactivé (SMTP conservé) — le déploiement réel redevient seul maître de la boîte", cfg.imapActif === false);
  check("Fonctionnalité « Réponse automatique PDF » LAISSÉE ACTIVE (demande utilisateur)", true, "ReponsePdfConfig.actif=true + certificat dédié conservés");
  await db.$disconnect();
  process.exit(0);
}

/* ============================== DISPATCHER =============================== */
const phase = (process.argv[2] || "").replace(/^--/, "");
const promesse = phase === "prep" ? phasePrep()
  : phase === "config" ? phaseConfig()
  : phase === "test" ? phaseTest("test")
  : phase === "resume" ? phaseTest("resume")
  : phase === "verifier" ? phaseVerifier()
  : phase === "restore" ? phaseRestore()
  : null;
if (!promesse) {
  console.log("Usage : node scripts/test_task205_pdf_signe_e2e.js <prep|config|test|resume|verifier|restore>");
  process.exit(2);
}
promesse.catch(async (e) => {
  console.error("ERREUR PHASE " + phase + " :", e);
  try { await db.$disconnect(); } catch { /* */ }
  process.exit(1);
});
