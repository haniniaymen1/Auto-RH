#!/usr/bin/env node
/**
 * v0.2.92 — PREUVE E2E DES 3 DEMANDES UTILISATEUR
 * ================================================
 *  1. DEMANDES / RÉPONSES — MODE MANUEL :
 *     - déplacement LIBRE des éléments (décalages sig/QR ±1500 pt) — preuve
 *       par DIFFÉRENCE de positions rendues sur les documents de réponse ;
 *     - CASE À COCHER du certificat de signature (comme QR / signature) :
 *       ON = bloc certificat apposé, OFF = jamais ;
 *     - POSITIONNEMENT LIBRE du certificat (position 5 choix + décalages +
 *       échelle certTaille) sur le document de réponse.
 *  2. IMPORT (configuration globale) :
 *     - POSITIONNEMENT LIBRE du QR code (qrDecalX/Y) — preuve par différence
 *       des positions des images (opérateur cm avant /Img Do) ;
 *     - POSITIONNEMENT LIBRE du certificat (certPosition / certDecalX/Y /
 *       certTaille) — positions ET taille de police extraites du flux PDF ;
 *     - NON-RÉGRESSION : BAS_CENTRE (défaut) = rendu historique centré.
 *  3. PARRAINAGE :
 *     - le formulaire du portail n'a PLUS le champ « e-mail N+1 » ;
 *     - POST sans emailN1 → 201 (repli ancien client : champ IGNORÉ) ;
 *     - e-mail de traitement automatique à l'adresse DÉDIÉE (parrainageEmail) ;
 *     - CONFIRMATION automatique au DEMANDEUR (PortalAccess.email — colonne
 *       « E-mail d'accès ») — captés par un SMTP puits réel.
 *
 * Usage : node scripts/test_v092_positionnement_parrainage.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const net = require("net");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PDFDocument, StandardFonts, PDFName } = require("pdf-lib");

const BASE = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const db = new PrismaClient();

const CIN_TEST = "TEST92001";
const FICHE_PDF = "e2e-920-fiche.pdf";
const TEXTE_SIG = "MANUEL-PROOF-920";
const CERT_TITULAIRE = "CN=Certificat Demo Auto-RH, O=Entreprise Demo";
const EMAIL_PARRAINAGE = "parrainage920@entreprise.tn";
const EMAIL_DEMANDEUR = "employe920@test.tn";
const EMAIL_RH = "rh920@entreprise.tn";

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
    cookie() { return cookie; },
    async req(method, p, body, brut, entetes = {}) {
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...entetes,
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      if (brut) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buf };
      }
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* html */ }
      return { status: res.status, json, texte };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
  };
}

async function getPublic(p) {
  const res = await fetch(BASE + p, { redirect: "manual" });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

function cleJeton() {
  const secret =
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  return crypto.scryptSync(secret, "autorh-signature-v1", 32);
}
function jetonFicheAttendu(id) {
  return crypto
    .createHmac("sha256", cleJeton())
    .update("fiche-en-ligne-v1|" + id)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

// --------------------------------------------------------------------
// Extraction de positions dans le flux de contenu PDF
// --------------------------------------------------------------------
async function fluxPages(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const sorties = [];
  for (const page of doc.getPages()) {
    const cont = page.node.get(PDFName.of("Contents"));
    if (!cont) continue;
    const obj = doc.context.lookup(cont);
    const streams = obj && obj.array ? obj.array.map((r) => doc.context.lookup(r)) : [obj];
    for (const s of streams) {
      if (!s || !s.contents) continue;
      const filtre = s.dict ? String(s.dict.get(PDFName.of("Filter")) || "") : "";
      try {
        sorties.push(/FlateDecode/.test(filtre) ? zlib.inflateSync(Buffer.from(s.contents)).toString("latin1") : s.contents.toString("latin1"));
      } catch { /* ignore */ }
    }
  }
  return sorties;
}

/** Positions + taille de police d'un texte (Tf/Tm précédant le littéral hex). */
async function positionsTextePdf(buf, texte) {
  const hexCherche = Buffer.from(texte, "latin1").toString("hex").toUpperCase();
  const trouves = [];
  for (const txt of await fluxPages(buf)) {
    let idx = txt.toUpperCase().indexOf(hexCherche);
    while (idx >= 0) {
      const avant = txt.slice(Math.max(0, idx - 400), idx);
      let mTm = null;
      let mTf = null;
      let mm;
      const reTm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
      while ((mm = reTm.exec(avant)) !== null) mTm = mm;
      const reTf = /\/([A-Za-z0-9-]+) ([\d.]+) Tf/g;
      while ((mm = reTf.exec(avant)) !== null) mTf = mm;
      if (mTm) trouves.push({ x: parseFloat(mTm[1]), y: parseFloat(mTm[2]), taille: mTf ? parseFloat(mTf[2]) : 0 });
      idx = txt.toUpperCase().indexOf(hexCherche, idx + hexCherche.length);
    }
  }
  return trouves;
}

/** Positions des IMAGES (QR) — la TRANSLATION `1 0 0 1 X Y cm` NON NULLE
 * précédant l'opérateur /… Do (pdf-lib : q → translation → échelle → Do). */
async function positionsImagePdf(buf) {
  const trouves = [];
  for (const txt of await fluxPages(buf)) {
    const reDo = /\/[\w-]+ Do/g;
    let mDo;
    while ((mDo = reDo.exec(txt)) !== null) {
      const avant = txt.slice(Math.max(0, mDo.index - 500), mDo.index);
      const reCm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/g;
      let mm;
      let pos = null;
      while ((mm = reCm.exec(avant)) !== null) {
        const x = parseFloat(mm[1]);
        const y = parseFloat(mm[2]);
        if (x !== 0 || y !== 0) pos = { x, y };
      }
      if (pos) trouves.push(pos);
    }
  }
  return trouves;
}

async function textePdf(buf) {
  const { PDFParse } = require("pdf-parse");
  const p = new PDFParse({ data: new Uint8Array(buf) });
  try {
    return (await p.getText()).text || "";
  } finally {
    try { await p.destroy(); } catch { /* noop */ }
  }
}

/** Fiche PDF de démonstration (A4 portrait). */
async function creerFichePdf(chemin) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("BULLETIN DE PAIE - DEMO V0.2.92", { x: 60, y: 760, size: 18, font });
  page.drawText("Employe : Demo 920 - CIN : " + CIN_TEST, { x: 60, y: 720, size: 12, font });
  fs.writeFileSync(chemin, await pdf.save());
}

/** Document de RÉPONSE (variante = dé-duplication par empreinte). */
async function creerReponsePdf(chemin, variante = 1) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(`REPONSE DU SERVICE RH - DOCUMENT OFFICIEL (V${variante})`, { x: 60, y: 760, size: 16, font });
  fs.writeFileSync(chemin, await pdf.save());
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

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

// --------------------------------------------------------------------
// SMTP puits (capture RCPT TO — preuve réelle des destinataires)
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
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resoudre) => serveur.listen(port, () => resoudre({ serveur, rcpts })));
}

/** TOTP RFC 6238 (portail). */
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

// --------------------------------------------------------------------
async function main() {
  console.log("== v0.2.92 — positionnement certificat/QR + parrainage ==");
  const dossier = dossierStockage();

  const cfgAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const mailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const supRow = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
  if (supRow) {
    await db.user.update({
      where: { id: supRow.id },
      data: {
        email: cryptoBd.chiffrerChamp("superadmin@autorh.local", true),
        name: cryptoBd.chiffrerChamp("Superadministrateur"),
        passwordHash: hashScrypt("AutoRH-2026!Verif#1"),
        passwordChangedAt: new Date(),
        isActive: true,
      },
    }).catch(() => {});
  }

  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.payslip.deleteMany({ where: { fileName: FICHE_PDF } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });

  await creerFichePdf(path.join(dossier, FICHE_PDF));
  await db.payslip.create({
    data: {
      fileName: FICHE_PDF, storedName: FICHE_PDF,
      fileSize: fs.statSync(path.join(dossier, FICHE_PDF)).size,
      content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: "Employe Demo 920",
      period: "09/2026", netSalary: "2 400,000",
    },
  });

  // Accès portail du demandeur (e-mail de notification = PortalAccess.email)
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Test-920!Pass")),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
      nomPrenom: cryptoBd.chiffrerChamp("Employe Demo 920"),
      email: cryptoBd.chiffrerChamp(EMAIL_DEMANDEUR),
    },
  });
  const ficheDb = await db.payslip.findFirst({ where: { fileName: FICHE_PDF } });
  const jetonFiche = jetonFicheAttendu(ficheDb.id);
  console.log(`Semé : fiche PDF + accès portail (${CIN_TEST}, ${EMAIL_DEMANDEUR})`);

  try {
    const sup = client();
    const login = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
    });
    check("Connexion superadministrateur", login.status === 200, `status=${login.status}`);

    const cfgGet0 = await sup.get("/api/signature-config");
    const cfg0 = cfgGet0.json?.config ?? {};
    const corpsBase = { ...cfg0, actif: true, sigImage: cfg0.sigImage ?? "", sigTexte: "" };
    delete corpsBase.certFichier; // ne JAMAIS toucher aux métadonnées du certificat

    // Pose les métadonnées du certificat DIRECTEMENT en base (état « après import »)
    await db.signatureConfig.update({
      where: { id: "signature" },
      data: {
        certSujet: CERT_TITULAIRE,
        certEmetteur: "CN=AC Demo Auto-RH",
        certSerie: "04DEADBEEF9201",
        certValideAu: new Date(Date.now() + 365 * 86400000),
        certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
      },
    }).catch(async () => {
      await db.signatureConfig.create({
        data: {
          id: "signature", actif: true,
          certSujet: CERT_TITULAIRE,
          certEmetteur: "CN=AC Demo Auto-RH",
          certSerie: "04DEADBEEF9201",
          certValideAu: new Date(Date.now() + 365 * 86400000),
          certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
        },
      });
    });

    // =============================================================
    console.log("\n-- A. IMPORT : positionnement LIBRE du certificat --");
    // =============================================================
    const DX = 150, DY = -100;
    const putA = await sup.put("/api/signature-config", {
      ...corpsBase,
      sigActif: false, qrActif: false, mentionActif: false, certActif: true,
      certPosition: "HAUT_GAUCHE", certDecalX: DX, certDecalY: DY, certTaille: 100,
    });
    check("A — PUT config (cert HAUT_GAUCHE, décalages) 200", putA.status === 200, `status=${putA.status}`);
    const cfgA = (await sup.get("/api/signature-config")).json?.config ?? {};
    check("A — Nouveaux champs PERSISTÉS (certPosition/certDecalX/Y/certTaille)",
      cfgA.certPosition === "HAUT_GAUCHE" && cfgA.certDecalX === DX && cfgA.certDecalY === DY && cfgA.certTaille === 100,
      JSON.stringify({ p: cfgA.certPosition, x: cfgA.certDecalX, y: cfgA.certDecalY, t: cfgA.certTaille }));

    const pdfA = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    check("A — Fiche PDF servie 200", pdfA.status === 200 && pdfA.buf.subarray(0, 4).toString() === "%PDF", `status=${pdfA.status}`);
    const texteA = pdfA.status === 200 ? await textePdf(pdfA.buf) : "";
    check("A — Bloc certificat présent sur la fiche", texteA.includes("Certificat Demo Auto-RH"));
    const posA = pdfA.status === 200 ? await positionsTextePdf(pdfA.buf, "certifi\u00e9e") : [];
    check("A — Position du certificat extraite du flux", posA.length > 0, JSON.stringify(posA));

    // RÉFÉRENCE : même position HAUT_GAUCHE sans décalage
    await sup.put("/api/signature-config", {
      ...corpsBase, sigActif: false, qrActif: false, mentionActif: false, certActif: true,
      certPosition: "HAUT_GAUCHE", certDecalX: 0, certDecalY: 0, certTaille: 100,
    });
    const pdfRef = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const posRef = pdfRef.status === 200 ? await positionsTextePdf(pdfRef.buf, "certifi\u00e9e") : [];
    check("A — Référence (sans décalage) extraite", posRef.length > 0, JSON.stringify(posRef));
    if (posA.length && posRef.length) {
      const ddx = posA[0].x - posRef[0].x;
      const ddy = posA[0].y - posRef[0].y;
      check(`A — DÉCALAGE CERTIFICAT RÉELLEMENT APPLIQUÉ (${DX}, ${DY})`,
        Math.abs(ddx - DX) < 1 && Math.abs(ddy - DY) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
    }

    // ÉCHELLE du bloc : certTaille 150 % → police 6,5 × 1,5 = 9,75 pt
    await sup.put("/api/signature-config", {
      ...corpsBase, sigActif: false, qrActif: false, mentionActif: false, certActif: true,
      certPosition: "HAUT_GAUCHE", certDecalX: 0, certDecalY: 0, certTaille: 150,
    });
    const pdfT = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const posT = pdfT.status === 200 ? await positionsTextePdf(pdfT.buf, "certifi\u00e9e") : [];
    check("A — certTaille 150 % → taille de police rendue 9,75 pt (6,5 × 1,5)",
      posT.length > 0 && Math.abs(posT[0].taille - 9.75) < 0.3, JSON.stringify(posT));

    // NON-RÉGRESSION : BAS_CENTRE (défaut) = bloc centré au-dessus du bord bas
    await sup.put("/api/signature-config", {
      ...corpsBase, sigActif: false, qrActif: false, mentionActif: false, certActif: true,
      certPosition: "BAS_CENTRE", certDecalX: 0, certDecalY: 0, certTaille: 100,
    });
    const pdfH = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const posH = pdfH.status === 200 ? await positionsTextePdf(pdfH.buf, "certifi\u00e9e") : [];
    check("H — BAS_CENTRE : bloc centré (x ≈ milieu page) et en pied de page (y ≈ 28)",
      posH.length > 0 && posH[0].x > 130 && posH[0].x < 180 && posH[0].y > 20 && posH[0].y < 40,
      JSON.stringify(posH));

    // =============================================================
    console.log("\n-- B. IMPORT : positionnement LIBRE du QR code --");
    // =============================================================
    const QX = 120, QY = 60;
    await sup.put("/api/signature-config", {
      ...corpsBase, sigActif: false, qrActif: true, qrMode: "DONNEES",
      qrDecalX: QX, qrDecalY: QY, mentionActif: false, certActif: false,
    });
    const pdfQ = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const imgQ = pdfQ.status === 200 ? await positionsImagePdf(pdfQ.buf) : [];
    check("B — Image du QR trouvée dans le flux (décalée)", imgQ.length > 0, JSON.stringify(imgQ));
    await sup.put("/api/signature-config", {
      ...corpsBase, sigActif: false, qrActif: true, qrMode: "DONNEES",
      qrDecalX: 0, qrDecalY: 0, mentionActif: false, certActif: false,
    });
    const pdfQ0 = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const imgQ0 = pdfQ0.status === 200 ? await positionsImagePdf(pdfQ0.buf) : [];
    check("B — Référence QR (sans décalage) extraite", imgQ0.length > 0, JSON.stringify(imgQ0));
    if (imgQ.length && imgQ0.length) {
      const ddx = imgQ[0].x - imgQ0[0].x;
      const ddy = imgQ[0].y - imgQ0[0].y;
      check(`B — DÉCALAGE QR RÉELLEMENT APPLIQUÉ (${QX}, ${QY})`,
        Math.abs(ddx - QX) < 1 && Math.abs(ddy - QY) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
    }

    // =============================================================
    console.log("\n-- C. RÉPONSES — MODE MANUEL (case certificat + positionnement) --");
    // =============================================================
    const demande = await db.demandeAdministrative.create({
      data: {
        reference: "DEM-2026-92001",
        type: "AUTORISATION_SORTIE",
        cin: cinDet,
        donnees: cryptoBd.chiffrerChamp(JSON.stringify({
          responsableN1: "n1-920@entreprise.tn", motif: "Test v0.2.92",
        })),
        destinataire: cryptoBd.chiffrerChamp("n1-920@entreprise.tn"),
      },
    });

    // Aperçu MANUEL : le PDF final est renvoyé en BINAIRE (mode=apercu) —
    // requête multipart directe avec le cookie de la session superadmin.
    async function apercuManuelBinaire(options, variante) {
      const nomF = `e2e-920-reponse-${variante}.pdf`;
      await creerReponsePdf(path.join(dossier, nomF), variante);
      const form = new FormData();
      form.append("document", new Blob([fs.readFileSync(path.join(dossier, nomF))], { type: "application/pdf" }), nomF);
      form.append("mode", "apercu");
      form.append("tampon", "manuel");
      form.append("options", JSON.stringify(options));
      const res = await fetch(`${BASE}/api/demandes/${demande.id}/repondre`, {
        method: "POST",
        headers: { Cookie: sup.cookie() },
        body: form,
      });
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
    }

    const optsCertOn = {
      sigActif: false, qrActif: false, mentionActif: false,
      certActif: true, certPosition: "HAUT_DROITE", certDecalX: 0, certDecalY: 0, certTaille: 150,
    };
    const r1 = await apercuManuelBinaire(optsCertOn, 11);
    check("C — Aperçu réponse (manuel, certificat ON) 200 PDF", r1.status === 200 && r1.buf.subarray(0, 4).toString() === "%PDF", `status=${r1.status}`);
    const t1 = r1.status === 200 ? await textePdf(r1.buf) : "";
    check("C — CASE CERTIFICAT ON : bloc certificat apposé sur la réponse", t1.includes("Certificat Demo Auto-RH"));
    const p1 = r1.status === 200 ? await positionsTextePdf(r1.buf, "certifi\u00e9e") : [];
    check("C — Certificat manuel : taille de police rendue 9,75 pt (échelle 150 %)",
      p1.length > 0 && Math.abs(p1[0].taille - 9.75) < 0.3, JSON.stringify(p1));

    // POSITIONNEMENT manuel du certificat (certTaille 100 → bloc ~273 pt,
    // décalages NON bornés) : différence (décalé − référence) = (-60, -40)
    const optsCertPos = {
      sigActif: false, qrActif: false, mentionActif: false,
      certActif: true, certPosition: "HAUT_DROITE", certDecalX: -60, certDecalY: -40, certTaille: 100,
    };
    const r3c = await apercuManuelBinaire(optsCertPos, 18);
    const p3c = r3c.status === 200 ? await positionsTextePdf(r3c.buf, "certifi\u00e9e") : [];
    check("C — Certificat manuel décalé : position extraite", p3c.length > 0, JSON.stringify(p3c));
    const r3d = await apercuManuelBinaire({ ...optsCertPos, certDecalX: 0, certDecalY: 0 }, 19);
    const p3d = r3d.status === 200 ? await positionsTextePdf(r3d.buf, "certifi\u00e9e") : [];
    check("C — Référence certificat manuel (sans décalage) extraite", p3d.length > 0, JSON.stringify(p3d));
    if (p3c.length && p3d.length) {
      const ddx = p3c[0].x - p3d[0].x;
      const ddy = p3c[0].y - p3d[0].y;
      check("C — POSITIONNEMENT CERTIFICAT MANUEL APPLIQUÉ (-60, -40)",
        Math.abs(ddx + 60) < 1 && Math.abs(ddy + 40) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
    }

    const optsCertOff = { ...optsCertOn, certActif: false };
    const r2 = await apercuManuelBinaire(optsCertOff, 12);
    const t2 = r2.status === 200 ? await textePdf(r2.buf) : "";
    check("C — CASE CERTIFICAT OFF : AUCUN bloc certificat", !t2.includes("Certificat Demo Auto-RH"));

    // Déplacement libre de la SIGNATURE en mode manuel (différence de positions)
    const optsSigD = {
      sigActif: true, sigImage: "", sigTexte: TEXTE_SIG, sigPosition: "BAS_DROITE",
      sigDecalX: -300, sigDecalY: 200, sigTaille: 120, sigOpacite: 0.9,
      qrActif: false, mentionActif: false, certActif: false,
    };
    const r3 = await apercuManuelBinaire(optsSigD, 13);
    const p3 = r3.status === 200 ? await positionsTextePdf(r3.buf, TEXTE_SIG) : [];
    check("C — Signature manuelle décalée : position extraite", p3.length > 0, JSON.stringify(p3));
    const optsSig0 = { ...optsSigD, sigDecalX: 0, sigDecalY: 0 };
    const r4 = await apercuManuelBinaire(optsSig0, 14);
    const p4 = r4.status === 200 ? await positionsTextePdf(r4.buf, TEXTE_SIG) : [];
    check("C — Référence signature manuelle (sans décalage) extraite", p4.length > 0, JSON.stringify(p4));
    if (p3.length && p4.length) {
      const ddx = p3[0].x - p4[0].x;
      const ddy = p3[0].y - p4[0].y;
      check("C — DÉPLACEMENT LIBRE MANUEL APPLIQUÉ (-300, +200)",
        Math.abs(ddx + 300) < 1 && Math.abs(ddy - 200) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
    }

    // Déplacement libre du QR en mode manuel (différence de positions image)
    const optsQrD = {
      sigActif: false, qrActif: true, qrPosition: "BAS_GAUCHE", qrDecalX: 90, qrDecalY: 40,
      qrTaille: 110, mentionActif: false, certActif: false,
    };
    const r5 = await apercuManuelBinaire(optsQrD, 15);
    const i5 = r5.status === 200 ? await positionsImagePdf(r5.buf) : [];
    const optsQr0 = { ...optsQrD, qrDecalX: 0, qrDecalY: 0 };
    const r6 = await apercuManuelBinaire(optsQr0, 16);
    const i6 = r6.status === 200 ? await positionsImagePdf(r6.buf) : [];
    check("C — QR manuel : images extraites (décalée + référence)", i5.length > 0 && i6.length > 0, JSON.stringify({ d: i5, r: i6 }));
    if (i5.length && i6.length) {
      const ddx = i5[0].x - i6[0].x;
      const ddy = i5[0].y - i6[0].y;
      check("C — DÉPLACEMENT QR MANUEL APPLIQUÉ (+90, +40)",
        Math.abs(ddx - 90) < 1 && Math.abs(ddy - 40) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
    }

    // =============================================================
    console.log("\n-- D. PARRAINAGE (formulaire sans N+1 + e-mails automatiques) --");
    // =============================================================
    const { serveur: smtpPuits, rcpts } = await demarrerSmtpPuits(2525);
    console.log("SMTP puits en écoute sur 127.0.0.1:2525");
    await db.mailConfig.upsert({
      where: { id: "smtp" },
      create: { id: "smtp", host: "127.0.0.1", port: 2525, secure: false, from: "Auto-RH <auto-rh@test.local>", rhEmail: EMAIL_RH, parrainageEmail: EMAIL_PARRAINAGE },
      update: { host: "127.0.0.1", port: 2525, secure: false, rhEmail: EMAIL_RH, parrainageEmail: EMAIL_PARRAINAGE, username: null, password: null, from: "Auto-RH <auto-rh@test.local>" },
    });

    // Page /demandes du portail : le champ N+1 du parrainage a DISPARU
    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST, password: "Test-920!Pass", otp: totpNow("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"), remember: false,
    });
    check("D — Connexion portail (CIN + mot de passe + OTP)", verif.status === 200 && verif.json?.ok, `status=${verif.status} ${JSON.stringify(verif.json)}`);
    const page = await port.get("/demandes");
    const html = page.texte || "";
    check("D — FORMULAIRE PARRAINAGE : champ « e-mail N+1 » SUPPRIMÉ",
      page.status === 200 && !html.includes('id="parr-n1"'));
    check("D — Formulaire parrainage présent (date/opération/filleul/téléphone)",
      html.includes('id="parr-date"') && html.includes('id="parr-operation"') && html.includes('id="parr-filleul"') && html.includes('id="parr-tel"'));
    check("D — Congé : champ N+1 CONSERVÉ (non-régression)",
      html.includes('id="conge-n1"'));

    // POST sans emailN1 → 201 + routage parrainageEmail
    const dem1 = await port.post("/api/demandes", {
      type: "PARRAINAGE",
      dateParrainage: "2026-09-25",
      operation: "Opération Test 920",
      nomFilleul: "Filleul Test 920",
      telFilleul: "+216 20 111 920",
    });
    check("D — POST parrainage SANS emailN1 → 201", dem1.status === 201, `status=${dem1.status} ${JSON.stringify(dem1.json)}`);
    check("D — Destinataire = adresse DÉDIÉE du parrainage", dem1.json?.destinataire === EMAIL_PARRAINAGE, JSON.stringify(dem1.json?.destinataire));

    // Ancien client : emailN1 envoyé → IGNORÉ (compatibilité)
    const dem2 = await port.post("/api/demandes", {
      type: "PARRAINAGE",
      emailN1: "ancien-n1@entreprise.tn",
      dateParrainage: "2026-09-26",
      operation: "Opération Test 920 bis",
      nomFilleul: "Filleul Test 920 bis",
      telFilleul: "+216 20 111 921",
    });
    check("D — Ancien client avec emailN1 → 201 (champ ignoré)", dem2.status === 201, `status=${dem2.status}`);

    // Vérification BASE : aucune emailN1 stockée, destinataire chiffré = dédiée
    await new Promise((r) => setTimeout(r, 2500)); // envois arrière-plan
    const rows = await db.demandeAdministrative.findMany({ where: { cin: cinDet, type: "PARRAINAGE" } });
    const sansN1 = rows.every((r) => {
      try {
        const d = JSON.parse(cryptoBd.dechiffrerChamp(r.donnees) || "{}");
        return !("emailN1" in d);
      } catch { return false; }
    });
    check("D — Base : AUCUN emailN1 stocké (demandes nouvelles)", sansN1 && rows.length >= 2, `rows=${rows.length}`);
    const destOk = rows.every((r) => {
      try { return cryptoBd.dechiffrerChamp(r.destinataire) === EMAIL_PARRAINAGE; } catch { return false; }
    });
    check("D — Base : destinataire (chiffré) = adresse dédiée pour TOUTES les demandes", destOk);

    // SMTP puits : e-mail de traitement (dédiée) + CONFIRMATION (demandeur)
    const compteurDediee = rcpts.filter((r) => r === EMAIL_PARRAINAGE).length;
    const compteurDemandeur = rcpts.filter((r) => r === EMAIL_DEMANDEUR).length;
    check(`D — SMTP : 2 e-mails de traitement partis à l'adresse dédiée (${EMAIL_PARRAINAGE})`, compteurDediee === 2, `reçus=${compteurDediee} tous=${JSON.stringify(rcpts)}`);
    check(`D — SMTP : 2 CONFIRMATIONS partis au DEMANDEUR (${EMAIL_DEMANDEUR})`, compteurDemandeur === 2, `reçus=${compteurDemandeur} tous=${JSON.stringify(rcpts)}`);

    smtpPuits.close();
  } finally {
    // -------------------------------------------------------------
    // Nettoyage complet
    // -------------------------------------------------------------
    try {
      await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
      await db.portalAccess.deleteMany({ where: { cin: cinDet } });
      await db.payslip.deleteMany({ where: { fileName: FICHE_PDF } });
      for (const f of fs.readdirSync(dossier)) {
        if (f.startsWith("e2e-920-")) fs.unlinkSync(path.join(dossier, f));
      }
      const dd = path.join(path.dirname(dossier), "documents-demandes");
      if (fs.existsSync(dd)) {
        for (const f of fs.readdirSync(dd)) {
          if (f.startsWith("DEM-2026-92001-")) fs.unlinkSync(path.join(dd, f));
        }
      }
      if (cfgAvant) {
        await db.signatureConfig.update({ where: { id: "signature" }, data: {
          actif: cfgAvant.actif, sigActif: cfgAvant.sigActif, qrActif: cfgAvant.qrActif,
          qrMode: cfgAvant.qrMode, qrUrl: cfgAvant.qrUrl, mentionActif: cfgAvant.mentionActif,
          certActif: cfgAvant.certActif, certPosition: cfgAvant.certPosition ?? "BAS_CENTRE",
          certDecalX: cfgAvant.certDecalX ?? 0, certDecalY: cfgAvant.certDecalY ?? 0,
          certTaille: cfgAvant.certTaille ?? 100,
        } });
      }
      if (mailAvant) {
        await db.mailConfig.update({ where: { id: "smtp" }, data: {
          host: mailAvant.host, port: mailAvant.port, secure: mailAvant.secure,
          rhEmail: mailAvant.rhEmail, parrainageEmail: mailAvant.parrainageEmail,
          responsablesMap: mailAvant.responsablesMap,
        } }).catch(() => {});
      }
      console.log("\nNettoyage effectué (fiche, demandes, accès, documents, config restaurée).");
    } catch (e) {
      console.error("Nettoyage partiel:", e.message);
    }
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
