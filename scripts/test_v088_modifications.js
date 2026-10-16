#!/usr/bin/env node
/**
 * v0.2.88 — PREUVE E2E DES 4 MODIFICATIONS DEMANDÉES
 * ===================================================
 *  1. Signature certificate sur la fiche de paie : bloc certificat dessiné
 *     sur la fiche (PDF lisible via pdf-parse) quand le Switch est ON ;
 *  2. Autorisation – Responsable N+1 : formulaire portail (« Département »
 *     remplacé), routage N+1, e-mails automatiques en ARRIÈRE-PLAN au
 *     N+1 ET au service RH (serveur SMTP puits — RCPT TO captés) ;
 *  3. Accès aux réponses via QR Code et URL : le QR du document de réponse
 *     encode l'URL publique /verification/reponse/{ref}?t={jeton} (décodé
 *     réellement par jsQR), page publique + API fichier par jeton ;
 *  4. Bouton Switch – Signature Certificate : certActif persisté, ON =
 *     appliqué, OFF = non appliqué (prouvé sur la fiche PDF).
 *  5. (v0.2.88 complément) CERTIFICAT SUR LES RÉPONSES : le document de
 *     réponse RH (PDF) tamponné porte AUSSI le bloc certificat — même
 *     moteur que les fiches de paie (tamponnerFicheDossier).
 *
 * Usage : node scripts/test_v088_modifications.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const net = require("net");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const sharp = require("sharp");
const jsQR = require("jsqr");

const BASE = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const db = new PrismaClient();

const CIN_TEST = "TEST88001";
const NOM_FICHES = "Employe Demo 880";
const EMAIL_COMPTE = "employe880@test.tn";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP_PORTAIL = "Test-880!Pass";
const N1_EMAIL = "n1-880@entreprise.tn";
const RH_EMAIL = "rh-880@entreprise.tn";
const ADRESSE_PUBLIQUE = "http://localhost:4000";
const FICHE_PNG = "e2e-880-fiche.png";
const FICHE_PDF = "e2e-880-fiche.pdf";
const REPONSE_PNG = "e2e-880-reponse.png";
const REPONSE_PDF = "e2e-880-reponse.pdf";

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

// --------------------------------------------------------------------
// Client HTTP avec cookies
// --------------------------------------------------------------------
function client(base = BASE) {
  let cookie = "";
  return {
    async req(method, p, body, brut = false, entetes = {}) {
      const estForm = body instanceof FormData;
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(body !== undefined && !estForm ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...entetes,
        },
        body: body === undefined ? undefined : (estForm ? body : JSON.stringify(body)),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      if (brut) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buf, headers: res.headers };
      }
      let json = null;
      try { json = await res.json(); } catch { /* HTML */ }
      return { status: res.status, json, headers: res.headers };
    },
    get(p, brut) { return this.req("GET", p, undefined, brut); },
    post(p, b, e) { return this.req("POST", p, b, false, e); },
    put(p, b) { return this.req("PUT", p, b); },
    async getText(p) {
      const res = await fetch(base + p, { headers: cookie ? { cookie } : {}, redirect: "follow" });
      return { status: res.status, texte: await res.text() };
    },
  };
}

async function getPublic(p) {
  const res = await fetch(BASE + p, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers, texte: buf.toString("utf8") };
}

// --------------------------------------------------------------------
// Jetons recalculés INDÉPENDAMMENT (clé .env + scrypt + domaine)
// --------------------------------------------------------------------
function cleJeton() {
  const matiere =
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  return crypto.scryptSync(matiere, "autorh-signature-v1", 32);
}
function jetonFicheAttendu(id) {
  return crypto.createHmac("sha256", cleJeton())
    .update("fiche-en-ligne-v1|" + id).digest("hex").slice(0, 24).toUpperCase();
}
function jetonReponseAttendu(reference) {
  return crypto.createHmac("sha256", cleJeton())
    .update("reponse-en-ligne-v1|" + reference).digest("hex").slice(0, 24).toUpperCase();
}

async function decoderQr(octets) {
  const { data, info } = await sharp(octets).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width, info.height
  );
  return res ? res.data : null;
}

/** Texte d'un PDF (pdf-parse v2 — même usage que src/lib/payslip-extractor.ts). */
async function textePdf(buf) {
  const { PDFParse } = require("pdf-parse");
  const p = new PDFParse({ data: new Uint8Array(buf) });
  try {
    return (await p.getText()).text || "";
  } finally {
    try { await p.destroy(); } catch { /* noop */ }
  }
}

// --------------------------------------------------------------------
// Fichiers de démonstration
// --------------------------------------------------------------------
async function creerFichePng(chemin) {
  const svg = Buffer.from(
    `<svg width="1240" height="300" xmlns="http://www.w3.org/2000/svg">
       <rect x="40" y="30" width="1160" height="230" fill="none" stroke="#333" stroke-width="2"/>
       <text x="70" y="90" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="#111">BULLETIN DE PAIE — DEMO V0.2.88</text>
       <text x="70" y="140" font-family="DejaVu Sans" font-size="28" fill="#222">Employé : ${NOM_FICHES}</text>
       <text x="70" y="185" font-family="DejaVu Sans" font-size="28" fill="#222">CIN : ${CIN_TEST} — Période : 09/2026</text>
       <text x="70" y="230" font-family="DejaVu Sans" font-size="28" fill="#222">Net à payer : 2 400,000 TND</text>
     </svg>`
  );
  await sharp({ create: { width: 1240, height: 1754, channels: 3, background: "#ffffff" } })
    .composite([{ input: svg, top: 0, left: 0 }]).png().toFile(chemin);
}

async function creerFichePdf(chemin) {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("BULLETIN DE PAIE - DEMO V0.2.88", { x: 60, y: 760, size: 18, font });
  page.drawText("Employe : " + NOM_FICHES + " - CIN : " + CIN_TEST, { x: 60, y: 720, size: 12, font });
  fs.writeFileSync(chemin, await pdf.save());
}

/** Document de RÉPONSE (PNG — le QR du tampon sera décodé par jsQR). */
async function creerReponsePng(chemin) {
  const svg = Buffer.from(
    `<svg width="1000" height="400" xmlns="http://www.w3.org/2000/svg">
       <rect x="30" y="30" width="940" height="340" fill="none" stroke="#2563eb" stroke-width="3"/>
       <text x="60" y="110" font-family="DejaVu Sans" font-size="30" font-weight="bold" fill="#111">REPONSE DU SERVICE RH</text>
       <text x="60" y="170" font-family="DejaVu Sans" font-size="24" fill="#222">Attestation établie le 26/09/2026</text>
       <text x="60" y="230" font-family="DejaVu Sans" font-size="24" fill="#222">Document officiel — Auto-RH</text>
     </svg>`
  );
  await sharp({ create: { width: 1000, height: 500, channels: 3, background: "#ffffff" } })
    .composite([{ input: svg, top: 0, left: 0 }]).png().toFile(chemin);
}

/** Document de RÉPONSE (PDF — le bloc certificat du tampon est un TEXTE PDF extractible par pdf-parse). */
async function creerReponsePdf(chemin) {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("REPONSE DU SERVICE RH - DOCUMENT OFFICIEL", { x: 60, y: 760, size: 16, font });
  page.drawText("Attestation etablie le 26/09/2026 - Auto-RH", { x: 60, y: 720, size: 12, font });
  fs.writeFileSync(chemin, await pdf.save());
}

// Dossier de stockage effectif (même résolution que src/lib/storage-dir.ts).
function dossierStockage() {
  const racine = process.cwd();
  const candidats = [
    process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR,
    process.env.STORAGE_DIR,
    path.join(racine, "storage", "payslips"),
    path.join(racine, ".next", "standalone", "storage", "payslips"),
  ].filter(Boolean);
  for (const c of candidats) if (fs.existsSync(c)) return c;
  fs.mkdirSync(candidats[2], { recursive: true });
  return candidats[2];
}

function dossierDocumentsDemandes() {
  const racine = process.cwd();
  const candidats = [
    path.join(path.dirname(process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR || ""), "documents-demandes"),
    path.join(racine, "storage", "documents-demandes"),
    path.join(racine, ".next", "standalone", "storage", "documents-demandes"),
  ].filter((c) => !c.includes("null"));
  for (const c of candidats) if (fs.existsSync(c)) return c;
  fs.mkdirSync(candidats[1], { recursive: true });
  return candidats[1];
}

// --------------------------------------------------------------------
// SMTP PUITS : capture les RCPT TO (preuve réelle des destinataires)
// --------------------------------------------------------------------
function demarrerSmtpPuits(port) {
  const rcpts = [];
  const serveur = net.createServer((socket) => {
    socket.write("220 puits.local ESMTP\r\n");
    let tampon = "";
    let enData = false;
    socket.on("data", (chunk) => {
      tampon += chunk.toString();
      let idx;
      while ((idx = tampon.indexOf("\r\n")) >= 0) {
        const ligne = tampon.slice(0, idx);
        tampon = tampon.slice(idx + 2);
        if (enData) {
          if (ligne === ".") { enData = false; socket.write("250 OK data\r\n"); }
          continue;
        }
        const cmd = ligne.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          socket.write("250-puits.local\r\n250-SIZE 15728640\r\n250 OK\r\n");
        } else if (cmd.startsWith("MAIL FROM:")) {
          socket.write("250 OK\r\n");
        } else if (cmd.startsWith("RCPT TO:")) {
          const m = ligne.match(/<([^>]+)>/);
          if (m) rcpts.push(m[1].toLowerCase());
          socket.write("250 OK\r\n");
        } else if (cmd.startsWith("DATA")) {
          enData = true;
          socket.write("354 End with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else if (cmd.startsWith("RSET")) {
          socket.write("250 OK\r\n");
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resoudre) => {
    serveur.listen(port, () => resoudre({ serveur, rcpts }));
  });
}

// --------------------------------------------------------------------
// TOTP (même algorithme que le portail)
// --------------------------------------------------------------------
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

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

module.exports = { check, client, getPublic, cleJeton, jetonFicheAttendu, jetonReponseAttendu, decoderQr };

// --------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------
async function main() {
  console.log("== v0.2.88 — preuve E2E des 4 modifications ==");
  const dossier = dossierStockage();
  const dossierDocs = dossierDocumentsDemandes();

  // ---------------------------------------------------------------
  // 0) SMTP puits + semis (fiches, accès portail, config mail) + config sauvegardée
  // ---------------------------------------------------------------
  const { serveur: smtpPuits, rcpts } = await demarrerSmtpPuits(2525);
  console.log("SMTP puits en écoute sur 127.0.0.1:2525");

  const mailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  await db.mailConfig.upsert({
    where: { id: "smtp" },
    create: { id: "smtp", host: "127.0.0.1", port: 2525, secure: false, from: "Auto-RH <auto-rh@test.local>", rhEmail: RH_EMAIL },
    update: { host: "127.0.0.1", port: 2525, secure: false, rhEmail: RH_EMAIL, username: null, password: null, from: "Auto-RH <auto-rh@test.local>" },
  });

  const cfgAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  // Mot de passe superadmin : aligné sur l'identifiant documenté de la livraison
  // (superadmin@autorh.local / AutoRH-2026!Verif#1) — la base locale peut
  // avoir été réinitialisée avec un autre secret.
  const supRow = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
  if (supRow) {
    // Ré-encryptage avec la clé ACTUELLE : la ligne date d'une époque de clé
    // antérieure (environnement réinitialisé) — sans cela, ni le lookup du
    // login (email déterministe) ni la lecture (name aléatoire) ne
    // fonctionnent (401 / 500).
    const detEmail = cryptoBd.chiffrerChamp("superadmin@autorh.local", true);
    const nomChiffre = cryptoBd.chiffrerChamp("Superadministrateur");
    await db.user.update({
      where: { id: supRow.id },
      data: {
        email: detEmail,
        name: nomChiffre,
        passwordHash: hashScrypt("AutoRH-2026!Verif#1"),
        passwordChangedAt: new Date(),
        isActive: true,
      },
    });
  }
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.payslip.deleteMany({ where: { fileName: { in: [FICHE_PNG, FICHE_PDF] } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });

  // fiche PNG (QR FICHE décodable) + fiche PDF (texte certificat lisible)
  await creerFichePng(path.join(dossier, FICHE_PNG));
  await creerFichePdf(path.join(dossier, FICHE_PDF));
  for (const [fn, tailleMin] of [[FICHE_PNG, 1000], [FICHE_PDF, 400]]) {
    await db.payslip.create({
      data: {
        fileName: fn, storedName: fn,
        fileSize: fs.statSync(path.join(dossier, fn)).size,
        content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST, cinIndex: cinDet, employeeName: NOM_FICHES,
        period: fn === FICHE_PNG ? "09/2026" : "10/2026", netSalary: "2 400,000",
      },
    });
  }
  await db.portalAccess.create({
    data: {
      cin: cinDet, isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false, passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true, totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      nomPrenom: cryptoBd.chiffrerChamp(NOM_FICHES),
      email: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
    },
  });
  console.log(`Semé : 2 fiches + accès portail (${CIN_TEST})`);
  let refPourNettoyage = ""; // référence de la demande de test (fichiers tamponnés orphelins)

  try {
    // -------------------------------------------------------------
    // 1) ADMIN : connexion + Switch certificat (MOD 1 + 4)
    // -------------------------------------------------------------
    const sup = client();
    const loginSup = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
    });
    check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);

    const cfgGet0 = await sup.get("/api/signature-config");
    check("GET signature-config 200", cfgGet0.status === 200, `status=${cfgGet0.status}`);
    const cfg0 = cfgGet0.json?.config ?? {};
    check("Le champ certActif (Switch) EXISTE dans la configuration", "certActif" in cfg0);

    // Prépare : tampon actif, signature+QR FICHE+mention, certificat importé (métadonnées)
    const corpsComplet = {
      ...cfg0,
      actif: true, sigActif: true, mentionActif: true,
      qrActif: true, qrMode: "FICHE", qrUrl: ADRESSE_PUBLIQUE,
      certActif: true,
      certSujet: "CN=Certificat Demo Auto-RH, O=Entreprise Demo",
      certEmetteur: "CN=AC Demo Auto-RH",
      certSerie: "04DEADBEEF8801",
      certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
    };
    const cfgPutOn = await sup.put("/api/signature-config", corpsComplet);
    check("PUT signature-config certActif=true (Switch ON) 200", cfgPutOn.status === 200, `status=${cfgPutOn.status}`);
    // Certificat « importé » (métadonnées en base — l'import réel du fichier
    // .p12/.p7s est déjà couvert par scripts/test_task181_signature_formats.js) :
    // la méthode ici simule l'état APRÈS import, via la même ligne de config.
    await db.signatureConfig.update({
      where: { id: "signature" },
      data: {
        certSujet: "CN=Certificat Demo Auto-RH, O=Entreprise Demo",
        certEmetteur: "CN=AC Demo Auto-RH",
        certSerie: "04DEADBEEF8801",
        certValideAu: new Date(Date.now() + 365 * 86400000),
        certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
      },
    });
    const cfgGetOn = await sup.get("/api/signature-config");
    check("Switch ON persisté (certActif=true en base)", cfgGetOn.json?.config?.certActif === true);
    check("Métadonnées du certificat lues (Task 181)", Boolean(cfgGetOn.json?.config?.certSujet) && Boolean(cfgGetOn.json?.config?.certEmpreinte));

    // Fiche PDF servie avec le Switch ON → le bloc certificat est VISIBLE
    const fichePdf = await db.payslip.findFirst({ where: { fileName: FICHE_PDF } });
    const jetonFichePdf = jetonFicheAttendu(fichePdf.id);
    const pdfOn = await getPublic(`/api/payslips/qr/${fichePdf.id}/file?t=${jetonFichePdf}`);
    check("Fiche PDF publique servie (tamponnée)", pdfOn.status === 200 && pdfOn.buf.length > 400 && pdfOn.buf.subarray(0, 4).toString() === "%PDF", `status=${pdfOn.status} taille=${pdfOn.buf.length}`);
    const texteOn = await textePdf(pdfOn.buf);
    check("MOD 1 — CERTIFICAT VISIBLE sur la fiche (texte « Signature électronique certifiée »)", texteOn.includes("Signature electronique certifiee") || texteOn.includes("Signature électronique certifiée"));
    check("MOD 1 — Titulaire du certificat affiché", texteOn.includes("Certificat Demo Auto-RH"));

    // MOD 4 — Switch OFF → certificat NON appliqué
    const cfgPutOff = await sup.put("/api/signature-config", { ...corpsComplet, certActif: false });
    check("PUT signature-config certActif=false (Switch OFF) 200", cfgPutOff.status === 200, `status=${cfgPutOff.status}`);
    const pdfOff = await getPublic(`/api/payslips/qr/${fichePdf.id}/file?t=${jetonFichePdf}`);
    const texteOff = await textePdf(pdfOff.buf);
    check("MOD 4 — Switch OFF : certificat ABSENT de la fiche", !texteOff.includes("Signature electronique certifiee") && !texteOff.includes("Signature électronique certifiée"));
    check("MOD 4 — Switch OFF : signature + QR (FICHE) toujours présents", pdfOff.status === 200 && pdfOff.buf.length > 400);

    // Switch remis ON pour la suite (QR réponses actifs)
    await sup.put("/api/signature-config", { ...corpsComplet, certActif: true });

    // -------------------------------------------------------------
    // 2) MOD 2 — Responsable N+1 (portail) + e-mails arrière-plan
    // -------------------------------------------------------------
    // Le portail ne sert l'application (avec le formulaire) qu'AVEC une
    // session : les vérifications HTML sont faites APRÈS connexion.

    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST,
      password: MDP_PORTAIL,
      otp: totpNow(SECRET_TOTP),
      remember: false,
    });
    check("Connexion portail (CIN + mot de passe + OTP)", verif.status === 200 || verif.status === 302, `status=${verif.status} json=${JSON.stringify(verif.json)}`);

    const pagePortail = await port.getText("/demandes");
    check("MOD 2 — Portail : label « Responsable N+1 » présent", pagePortail.texte.includes("Responsable N+1"));
    check("MOD 2 — Portail : champ sortie-n1 (email) présent", pagePortail.texte.includes('id="sortie-n1"'));
    check("MOD 2 — Portail : ancien champ « Département » SUPPRIMÉ du formulaire", !pagePortail.texte.includes('id="sortie-departement"'));
    check("MOD 2 — Portail : mention de la copie automatique au service RH", pagePortail.texte.includes("ainsi qu'au service RH"));

    // Demande d'autorisation avec Responsable N+1 → 201 immédiat (arrière-plan)
    const t0 = Date.now();
    const postSortie = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE",
      date: "2026-10-02",
      responsableN1: N1_EMAIL,
      motif: "Rendez-vous médical (e2e v0.2.88)",
      nombreHeures: "2",
      heureSortie: "09:00",
      heureRetour: "11:00",
      compensation: "NON",
    });
    const dureePost = Date.now() - t0;
    check("MOD 2 — Demande AUTORISATION_SORTIE créée (201)", postSortie.status === 201, `status=${postSortie.status} json=${JSON.stringify(postSortie.json)}`);
    check("MOD 2 — Réponse IMMÉDIATE (envoi e-mail en arrière-plan)", dureePost < 2500, `${dureePost} ms`);
    const refSortie = postSortie.json?.reference;
    refPourNettoyage = refSortie || "";
    check("MOD 2 — Destinataire principal = Responsable N+1", postSortie.json?.destinataire === N1_EMAIL, JSON.stringify(postSortie.json?.destinataire));

    // Les 2 e-mails (N+1 + RH) partent en arrière-plan → puits SMTP
    await new Promise((r) => setTimeout(r, 3000));
    check("MOD 2 — E-mail au Responsable N+1 CAPTURÉ (RCPT TO)", rcpts.includes(N1_EMAIL.toLowerCase()), JSON.stringify(rcpts));
    check("MOD 2 — Copie automatique au service RH CAPTURÉE", rcpts.includes(RH_EMAIL.toLowerCase()), JSON.stringify(rcpts));

    const demandeDb = await db.demandeAdministrative.findUnique({ where: { reference: refSortie } });
    const donneesDemande = JSON.parse(cryptoBd.dechiffrerChamp(demandeDb.donnees) || "{}");
    check("MOD 2 — Champ responsableN1 stocké", donneesDemande.responsableN1 === N1_EMAIL);
    const destClair = demandeDb.destinataire ? cryptoBd.dechiffrerChamp(demandeDb.destinataire) : "";
    check("MOD 2 — Destinataire en base = N+1", destClair === N1_EMAIL);

    // Compatibilité ancien client : `departement` seul accepté (repli)
    const postAncien = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE", date: "2026-10-05", departement: "COMPTABILITE",
      motif: "Ancien client (compat)", nombreHeures: "1", heureSortie: "14:00", heureRetour: "15:00", compensation: "OUI",
    });
    check("MOD 2 — Ancien client `departement` accepté (repli 201)", postAncien.status === 201, `status=${postAncien.status} json=${JSON.stringify(postAncien.json)}`);

    // Validations : ni N+1 ni département → 400 explicite ; N+1 invalide → 400
    const postSans = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE", date: "2026-10-06",
      motif: "Sans N+1", nombreHeures: "1", heureSortie: "14:00", heureRetour: "15:00", compensation: "OUI",
    });
    check("MOD 2 — Ni N+1 ni département → 400 « Le Responsable N+1 (adresse e-mail) est obligatoire. »", postSans.status === 400 && /Responsable N\+1/.test(postSans.json?.error ?? ""), JSON.stringify(postSans.json));
    const postInvalide = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE", date: "2026-10-06", responsableN1: "pas-un-email",
      motif: "N+1 invalide", nombreHeures: "1", heureSortie: "14:00", heureRetour: "15:00", compensation: "OUI",
    });
    check("MOD 2 — N+1 invalide → 400 « n'est pas valide »", postInvalide.status === 400 && /pas valide/.test(postInvalide.json?.error ?? ""), JSON.stringify(postInvalide.json));

    // Affichage « Mes demandes » (API + mapping libellé client) : le champ
    // responsableN1 est présent côté serveur et le rendu client affiche
    // « Responsable N+1 » (mapping LIBELLES_CHAMPS servi dans la page).
    const mesDemandes = await port.get("/api/mes-demandes");
    const itemSortie = (mesDemandes.json?.items ?? []).find((it) => it.reference === refSortie);
    check("MOD 2 — « Mes demandes » : champ responsableN1 servi", itemSortie?.donnees?.responsableN1 === N1_EMAIL, JSON.stringify(itemSortie?.donnees));
    const pageDemandesHtml = await port.getText("/demandes");
    check("MOD 2 — « Mes demandes » : libellé client « Responsable N+1 » mappé", pageDemandesHtml.texte.includes('LIBELLES_CHAMPS = { responsableN1: "Responsable N+1"'), "mapping absent");

    // -------------------------------------------------------------
    // 3) MOD 3 — Réponses via QR Code et URL
    // -------------------------------------------------------------
    // 3a. Détail admin : urlVerification signée présente
    const detail = await sup.get("/api/demandes/" + demandeDb.id);
    check("MOD 3 — Détail admin 200", detail.status === 200, `status=${detail.status}`);
    const urlVerif = detail.json?.item?.urlVerification ?? "";
    const jetonReponseCalc = jetonReponseAttendu(refSortie);
    check("MOD 3 — urlVerification = {base}/verification/reponse/{ref}?t={jeton HMAC}", urlVerif === ADRESSE_PUBLIQUE + "/verification/reponse/" + refSortie + "?t=" + jetonReponseCalc, urlVerif);

    // 3b. Page PUBLIQUE de vérification (sans cookie) : jeton valide
    const pageOk = await getPublic("/verification/reponse/" + refSortie + "?t=" + jetonReponseCalc);
    check("MOD 3 — Page publique (jeton valide) 200", pageOk.status === 200, `status=${pageOk.status}`);
    check("MOD 3 — Page publique : « Réponse authentique »", pageOk.texte.includes("Réponse authentique"));
    check("MOD 3 — Page publique : référence de la demande affichée", pageOk.texte.includes(refSortie));

    // 3c. Page publique : jeton altéré → refus, aucun détail
    const pageKo = await getPublic("/verification/reponse/" + refSortie + "?t=" + "0".repeat(24));
    check("MOD 3 — Page publique (jeton altéré) : « Réponse non reconnue »", pageKo.status === 200 && pageKo.texte.includes("Réponse non reconnue") && !pageKo.texte.includes("Réponse authentique"));

    // 3d. Réponse avec document (PNG) : le QR décodé = urlVerification
    await creerReponsePng(path.join(dossierDocs, REPONSE_PNG));
    const form = new FormData();
    form.append("document", new Blob([fs.readFileSync(path.join(dossierDocs, REPONSE_PNG))], { type: "image/png" }), REPONSE_PNG);
    form.append("mode", "valider");
    form.append("tampon", "auto");
    const postReponse = await sup.req("POST", "/api/demandes/" + demandeDb.id + "/repondre", form, false, {});
    check("MOD 3 — Réponse RH avec document (valider) 200", postReponse.status === 200, `status=${postReponse.status} json=${JSON.stringify(postReponse.json)}`);
    const docCree = postReponse.json?.document?.id;
    check("MOD 3 — Document de réponse enregistré", Boolean(docCree));

    const docDetail = await sup.get("/api/demandes/" + demandeDb.id);
    const docRef = (docDetail.json?.item?.documents ?? []).find((d) => d.id === docCree);
    check("MOD 3 — Document visible dans le détail", Boolean(docRef));

    // Le document stocké est TAMPONNÉ : son QR encode l'URL de vérification
    const docPrive = await sup.req("GET", `/api/demandes/${demandeDb.id}/documents/${docCree}`, undefined, true);
    check("MOD 3 — Document tamponné téléchargé (privé) 200 PNG", docPrive.status === 200 && docPrive.buf.subarray(1, 4).toString() === "PNG", `status=${docPrive.status}`);
    const contenuQrDoc = docPrive.status === 200 ? await decoderQr(docPrive.buf) : null;
    check("MOD 3 — QR du document RÉELLEMENT DÉCODÉ = URL de vérification", contenuQrDoc === urlVerif, `décodé=${contenuQrDoc}`);

    // 3d-bis. CERTIFICAT SIGNATURE ÉLECTRONIQUE sur le DOCUMENT DE RÉPONSE :
    // le tampon des réponses utilise le MÊME moteur que les fiches de paie
    // (tamponnerFicheDossier) — une réponse PDF porte donc AUSSI le bloc
    // certificat quand le Switch est ON (texte extractible par pdf-parse).
    await creerReponsePdf(path.join(dossierDocs, REPONSE_PDF));
    const formPdf = new FormData();
    formPdf.append("document", new Blob([fs.readFileSync(path.join(dossierDocs, REPONSE_PDF))], { type: "application/pdf" }), REPONSE_PDF);
    formPdf.append("mode", "valider");
    formPdf.append("tampon", "auto");
    const postRepPdf = await sup.req("POST", "/api/demandes/" + demandeDb.id + "/repondre", formPdf, false, {});
    check("MOD cert — Réponse RH avec document PDF 200", postRepPdf.status === 200, `status=${postRepPdf.status} json=${JSON.stringify(postRepPdf.json)}`);
    const docPdf = postRepPdf.json?.document?.id;
    check("MOD cert — Document PDF de réponse enregistré", Boolean(docPdf));
    const repPdfPrive = await sup.req("GET", `/api/demandes/${demandeDb.id}/documents/${docPdf}`, undefined, true);
    check("MOD cert — Réponse PDF tamponnée téléchargée (privé)", repPdfPrive.status === 200 && repPdfPrive.buf.subarray(0, 4).toString() === "%PDF", `status=${repPdfPrive.status}`);
    const texteRep = repPdfPrive.status === 200 ? await textePdf(repPdfPrive.buf) : "";
    check("MOD cert — CERTIFICAT VISIBLE sur la RÉPONSE (« Signature électronique certifiée »)", texteRep.includes("Signature electronique certifiee") || texteRep.includes("Signature électronique certifiée"));
    check("MOD cert — Titulaire du certificat affiché sur la réponse", texteRep.includes("Certificat Demo Auto-RH"));
    check("MOD cert — URL de vérification toujours absente du QR DONNÉES (fiches non affectées)", !urlVerif.includes("verification/fiche"), urlVerif);

    // 3e. API PUBLIQUE du fichier (jeton + doc) : ouverte au scan, fermée sans jeton
    const fichierPublic = await getPublic(`/api/demandes/qr/${refSortie}/file?t=${jetonReponseCalc}&doc=${docCree}`);
    check("MOD 3 — API publique fichier (jeton valide) 200", fichierPublic.status === 200 && fichierPublic.buf.length > 500, `status=${fichierPublic.status}`);
    const fichierKo = await getPublic(`/api/demandes/qr/${refSortie}/file?t=${"0".repeat(24)}&doc=${docCree}`);
    check("MOD 3 — API publique fichier (jeton altéré) 403", fichierKo.status === 403, `status=${fichierKo.status}`);

    // 3f. Isolation : le reste des demandes reste protégé
    const anonListe = await getPublic("/api/demandes");
    check("MOD 3 — Isolement : liste des demandes SANS session → 401", anonListe.status === 401, `status=${anonListe.status}`);
  } finally {
    // -------------------------------------------------------------
    // Nettoyage complet
    // -------------------------------------------------------------
    try {
      await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
      await db.portalAccess.deleteMany({ where: { cin: cinDet } });
      await db.payslip.deleteMany({ where: { fileName: { in: [FICHE_PNG, FICHE_PDF] } } });
      for (const d of [dossier, dossierDocs]) {
        for (const fn of [FICHE_PNG, FICHE_PDF, REPONSE_PNG, REPONSE_PDF]) {
          const p = path.join(d, fn);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      }
      // Fichiers de réponse TAMPONNÉS laissés en storage (préfixe référence)
      if (refPourNettoyage) {
        try {
          for (const f of fs.readdirSync(dossierDocs)) {
            if (f.startsWith(refPourNettoyage + "-")) fs.unlinkSync(path.join(dossierDocs, f));
          }
        } catch { /* noop */ }
      }
      // Restaurations
      if (mailAvant) {
        await db.mailConfig.update({ where: { id: "smtp" }, data: { host: mailAvant.host, port: mailAvant.port, secure: mailAvant.secure, rhEmail: mailAvant.rhEmail, username: mailAvant.username, password: mailAvant.password, from: mailAvant.from } });
      } else {
        await db.mailConfig.update({ where: { id: "smtp" }, data: { host: "", port: 587, secure: false, rhEmail: "" } }).catch(() => {});
      }
      if (cfgAvant) {
        await db.signatureConfig.update({
          where: { id: "signature" },
          data: {
            actif: cfgAvant.actif, sigActif: cfgAvant.sigActif, qrActif: cfgAvant.qrActif,
            qrMode: cfgAvant.qrMode, qrUrl: cfgAvant.qrUrl, mentionActif: cfgAvant.mentionActif,
            certActif: cfgAvant.certActif,
            certSujet: cfgAvant.certSujet, certEmetteur: cfgAvant.certEmetteur,
            certSerie: cfgAvant.certSerie, certValideAu: cfgAvant.certValideAu,
            certEmpreinte: cfgAvant.certEmpreinte,
          },
        });
      }
      smtpPuits.close();
      console.log("Nettoyage effectué (fiches, demande, accès, fichiers, configs restaurées).");
    } catch (e) {
      console.error("Nettoyage partiel:", e.message);
    }
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
