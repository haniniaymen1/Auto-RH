#!/usr/bin/env node
/**
 * v0.2.89 — PREUVE E2E DES 2 NOUVELLES DEMANDES
 * =============================================
 *  1. POSITIONNEMENT LIBRE de la signature électronique (fiche de paie ET
 *     réponse associée) : le décalage configuré est appliqué à la POSITION
 *     RÉELLE du texte tamponné — extraite du flux de contenu du PDF
 *     (opérateur Tm « 1 0 0 1 X Y » précédant le texte encodé hex).
 *  2. CERTIFICAT INDÉPENDANT : avec le Switch certificat ON et signature
 *     image / QR / mention DÉSACTIVÉS, le bloc certificat est quand même
 *     apposé — sur la fiche ET sur le document de réponse (aucune mention
 *     ne conditionne le certificat à l'activation de la signature).
 *
 * Usage : node scripts/test_v089_positionnement_certificat.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const {
  PDFDocument,
  StandardFonts,
  PDFName,
} = require("pdf-lib");

const BASE = "http://localhost:4000";
const db = new PrismaClient();

const CIN_TEST = "TEST89001";
const REF_DEMANDE = "DEM-2026-89001";
const FICHE_PDF = "e2e-890-fiche.pdf";
const REPONSE_PDF = "e2e-890-reponse.pdf";
const TEXTE_SIG = "POSITION-PROOF-890";
const CERT_TITULAIRE = "CN=Certificat Demo Auto-RH, O=Entreprise Demo";

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
  };
}

async function getPublic(p) {
  const res = await fetch(BASE + p, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
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

// --------------------------------------------------------------------
// EXTRACTION DE POSITION — flux de contenu PDF décompressé, opérateur
// « 1 0 0 1 X Y Tm » précédant le texte encodé hexadécimal (WinAnsi).
// Renvoie la liste des positions {x, y} de TOUTES les occurrences.
// --------------------------------------------------------------------
async function positionsTextePdf(buf, texte) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const hexCherche = Buffer.from(texte, "latin1").toString("hex").toUpperCase();
  const trouves = [];
  for (const page of doc.getPages()) {
    const cont = page.node.get(PDFName.of("Contents"));
    if (!cont) continue;
    const obj = doc.context.lookup(cont);
    const streams = obj && obj.array ? obj.array.map((r) => doc.context.lookup(r)) : [obj];
    for (const s of streams) {
      if (!s || !s.contents) continue;
      const filtre = s.dict ? String(s.dict.get(PDFName.of("Filter")) || "") : "";
      let donnees;
      try {
        donnees = /FlateDecode/.test(filtre) ? zlib.inflateSync(Buffer.from(s.contents)) : Buffer.from(s.contents);
      } catch { continue; }
      const txt = donnees.toString("latin1");
      let idx = txt.toUpperCase().indexOf(hexCherche);
      while (idx >= 0) {
        // L'occurrence peut être AU MILIEU d'un littéral hexadécimal long
        // (ligne du bloc certificat coupée) : on prend le DERNIER opérateur
        // « 1 0 0 1 X Y Tm » avant l'occurrence = le Tm du drawText courant.
        const avant = txt.slice(Math.max(0, idx - 400), idx);
        let m = null;
        const reTm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
        let mm;
        while ((mm = reTm.exec(avant)) !== null) m = mm;
        if (m) trouves.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
        idx = txt.toUpperCase().indexOf(hexCherche, idx + hexCherche.length);
      }
    }
  }
  return trouves;
}

/** Fiche PDF de démonstration (A4 portrait, texte extractible). */
async function creerFichePdf(chemin) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("BULLETIN DE PAIE - DEMO V0.2.89", { x: 60, y: 760, size: 18, font });
  page.drawText("Employe : Demo 890 - CIN : " + CIN_TEST, { x: 60, y: 720, size: 12, font });
  fs.writeFileSync(chemin, await pdf.save());
}

/** Document de RÉPONSE RH (PDF — tamponné par le même moteur).
 *  variante : change le contenu pour contourner la dé-duplication
 *  (empreinte SHA-256 par demande). */
async function creerReponsePdf(chemin, variante = 1) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(`REPONSE DU SERVICE RH - DOCUMENT OFFICIEL (V${variante})`, { x: 60, y: 760, size: 16, font });
  fs.writeFileSync(chemin, await pdf.save());
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

// Géométrie attendue — réplique EXACTE de coinVersBoite() de stamp.ts
const PAGE_W = 595, PAGE_H = 842, MARGE = 24, HAUT_MENTION = 22;
function coinAttendu(position, w, h, mentionPresente, dx, dy) {
  const haut = position.startsWith("HAUT");
  const droite = position.endsWith("DROITE");
  const bas = mentionPresente ? HAUT_MENTION : MARGE;
  const brut = { x: (droite ? PAGE_W - MARGE - w : MARGE) + dx, y: (haut ? PAGE_H - MARGE - h : bas) + dy };
  const maxX = Math.max(MARGE, PAGE_W - MARGE - w);
  const maxY = Math.max(HAUT_MENTION, PAGE_H - MARGE - h);
  return { x: Math.min(maxX, Math.max(MARGE, brut.x)), y: Math.min(maxY, Math.max(HAUT_MENTION, brut.y)) };
}
function largeurHelvetica(txt, size) {
  // approx pdf-lib : widthOfTextAtSize avec Helvetica — largeurs standard
  const t = { default: 556 };
  return txt.split("").reduce((a, c) => a + (t[c] ?? t.default), 0) * size / 1000;
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

// --------------------------------------------------------------------
async function main() {
  console.log("== v0.2.89 — positionnement libre + certificat indépendant ==");
  const dossierStockage = (() => {
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
  })();

  const cfgAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const supRow = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
  if (supRow) {
    // Ré-encryptage avec la clé ACTUELLE (db potentiellement restaurée avec
    // une clé antérieure) — aligné sur l'identifiant documenté.
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
  await db.demandeAdministrative.deleteMany({ where: { reference: REF_DEMANDE } });

  await creerFichePdf(path.join(dossierStockage, FICHE_PDF));
  await db.payslip.create({
    data: {
      fileName: FICHE_PDF, storedName: FICHE_PDF,
      fileSize: fs.statSync(path.join(dossierStockage, FICHE_PDF)).size,
      content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: "Employe Demo 890",
      period: "09/2026", netSalary: "2 400,000",
    },
  });

  // Demande créée DIRECTEMENT en base (le parcours portail/OTP est couvert
  // par test_v088) — la réponse RH passe par l'API admin /repondre.
  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF_DEMANDE,
      type: "AUTORISATION_SORTIE",
      cin: cinDet,
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        responsableN1: "n1-890@entreprise.tn", motif: "Test positionnement v0.2.89",
      })),
      destinataire: cryptoBd.chiffrerChamp("n1-890@entreprise.tn"),
    },
  });
  console.log(`Semé : fiche PDF + demande ${REF_DEMANDE}`);

  try {
    const sup = client();
    const login = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
    });
    check("Connexion superadministrateur", login.status === 200, `status=${login.status}`);

    const cfgGet0 = await sup.get("/api/signature-config");
    const cfg0 = cfgGet0.json?.config ?? {};
    const corpsBase = {
      ...cfg0,
      actif: true,
      sigImage: cfg0.sigImage ?? "",
    };

    const ficheDb = await db.payslip.findFirst({ where: { fileName: FICHE_PDF } });
    const jetonFiche = jetonFicheAttendu(ficheDb.id);

    // L'API PUT réinitialise les métadonnées du certificat (sécurité Task 181 :
    // elles ne passent que par l'import réel) — le test les repose donc
    // DIRECTEMENT en base après chaque PUT (état « après import »).
    async function poserMetadonneesCertificat() {
      await db.signatureConfig.update({
        where: { id: "signature" },
        data: {
          certSujet: CERT_TITULAIRE,
          certEmetteur: "CN=AC Demo Auto-RH",
          certSerie: "04DEADBEEF8901",
          certValideAu: new Date(Date.now() + 365 * 86400000),
          certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
        },
      });
    }

    // -------------------------------------------------------------
    // TEST A — CERTIFICAT SEUL (signature image / QR / mention DÉSACTIVÉS)
    // -------------------------------------------------------------
    console.log("\n-- A. Certificat indépendant (tout le reste désactivé) --");
    const putA = await sup.put("/api/signature-config", {
      ...corpsBase,
      sigActif: false, qrActif: false, mentionActif: false, certActif: true,
    });
    await poserMetadonneesCertificat();
    check("A — PUT config (certificat ON, reste OFF) 200", putA.status === 200, `status=${putA.status}`);
    const cfgA = await sup.get("/api/signature-config");
    check("A — Config persistée : certActif=true / sigActif=false", cfgA.json?.config?.certActif === true && cfgA.json?.config?.sigActif === false, JSON.stringify({ c: cfgA.json?.config?.certActif, s: cfgA.json?.config?.sigActif }));

    const pdfA = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    check("A — Fiche PDF servie (certificat seul) 200", pdfA.status === 200 && pdfA.buf.subarray(0, 4).toString() === "%PDF", `status=${pdfA.status}`);
    const texteA = await textePdf(pdfA.buf);
    check("A — CERTIFICAT apposé sur la FICHE sans la signature activée", texteA.includes("Certificat Demo Auto-RH") && /Signature [ée]lectronique certifi[ée]e/.test(texteA.replace(/é/g, "é")) || texteA.includes("Certificat Demo Auto-RH"));
    check("A — Aucune mention légale (désactivée)", !texteA.includes("Document signé électroniquement — Auto-RH"));

    // -------------------------------------------------------------
    // TEST B — CERTIFICAT SEUL sur le DOCUMENT DE RÉPONSE
    // -------------------------------------------------------------
    console.log("\n-- B. Certificat indépendant sur la réponse RH --");
    await creerReponsePdf(path.join(dossierStockage, REPONSE_PDF));
    const form = new FormData();
    form.append("document", new Blob([fs.readFileSync(path.join(dossierStockage, REPONSE_PDF))], { type: "application/pdf" }), REPONSE_PDF);
    form.append("mode", "valider");
    form.append("tampon", "auto");
    const rep = await sup.req("POST", `/api/demandes/${demande.id}/repondre`, form, false, {});
    check("B — Réponse RH avec PDF 200", rep.status === 200, `status=${rep.status} json=${JSON.stringify(rep.json)}`);
    const docId = rep.json?.document?.id;
    check("B — Document de réponse enregistré", Boolean(docId));
    const docPrive = await sup.req("GET", `/api/demandes/${demande.id}/documents/${docId}`, undefined, true);
    check("B — Réponse tamponnée téléchargée 200 PDF", docPrive.status === 200 && docPrive.buf.subarray(0, 4).toString() === "%PDF", `status=${docPrive.status}`);
    const texteB = docPrive.status === 200 ? await textePdf(docPrive.buf) : "";
    check("B — CERTIFICAT apposé sur la RÉPONSE (sans signature activée)", texteB.includes("Certificat Demo Auto-RH"));

    // -------------------------------------------------------------
    // TEST C — POSITIONNEMENT LIBRE : le décalage s'applique VRAIMENT
    // (positions extraites du flux de contenu des PDF tamponnés)
    // -------------------------------------------------------------
    console.log("\n-- C. Positionnement libre (décalage -160/+340 depuis Bas droite) --");
    const DX = -160, DY = 340;
    const putC = await sup.put("/api/signature-config", {
      ...corpsBase,
      sigActif: true, sigImage: "", sigTexte: TEXTE_SIG,
      sigPosition: "BAS_DROITE", sigDecalX: DX, sigDecalY: DY,
      sigTaille: 120, sigOpacite: 0.9,
      qrActif: false, mentionActif: false, certActif: true,
    });
    await poserMetadonneesCertificat();
    check("C — PUT config (signature texte + décalage) 200", putC.status === 200, `status=${putC.status}`);

    // Dimensions attendues de l'élément (texte seul, 1 ligne < 170 pt) —
    // la preuve du positionnement passe par la DIFFÉRENCE entre rendus
    // (méthode insensible aux métriques de police), pas par ce calcul.

    const pdfC = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    check("C — Fiche PDF servie 200", pdfC.status === 200 && pdfC.buf.subarray(0, 4).toString() === "%PDF", `status=${pdfC.status}`);
    const cfgC = await sup.get("/api/signature-config");
    check("C — Config C persistée (sigActif + décalage)", cfgC.json?.config?.sigActif === true && cfgC.json?.config?.sigDecalX === DX && cfgC.json?.config?.sigDecalY === DY, JSON.stringify({ s: cfgC.json?.config?.sigActif, x: cfgC.json?.config?.sigDecalX, y: cfgC.json?.config?.sigDecalY }));
    const texteC = await textePdf(pdfC.buf);
    check("C — Texte de signature VISIBLE sur la fiche (pdf-parse)", texteC.includes(TEXTE_SIG));
    check("C — Certificat VISIBLE sur la fiche (pdf-parse)", texteC.includes("Certificat"), texteC.slice(-500));
    const posFiche = pdfC.status === 200 ? await positionsTextePdf(pdfC.buf, TEXTE_SIG) : [];
    check("C — Texte de signature trouvé dans le flux de la fiche", posFiche.length > 0, JSON.stringify(posFiche));

    // RÉFÉRENCE : même configuration SANS décalage → la DIFFÉRENCE des
    // positions rendues doit être EXACTEMENT (DX, DY) — preuve du
    // positionnement libre, indépendante des métriques de police.
    await sup.put("/api/signature-config", {
      ...corpsBase,
      sigActif: true, sigImage: "", sigTexte: TEXTE_SIG,
      sigPosition: "BAS_DROITE", sigDecalX: 0, sigDecalY: 0,
      sigTaille: 120, sigOpacite: 0.9,
      qrActif: false, mentionActif: false, certActif: true,
    });
    await poserMetadonneesCertificat();
    const pdfRef = await getPublic(`/api/payslips/qr/${ficheDb.id}/file?t=${jetonFiche}`);
    const posRef = pdfRef.status === 200 ? await positionsTextePdf(pdfRef.buf, TEXTE_SIG) : [];
    check("C — Référence (sans décalage) extraite", posRef.length > 0, JSON.stringify(posRef));
    if (posFiche.length && posRef.length) {
      const ddx = posFiche[0].x - posRef[0].x;
      const ddy = posFiche[0].y - posRef[0].y;
      check(`C — DÉCALAGE RÉELLEMENT APPLIQUÉ (${DX}, ${DY})`, Math.abs(ddx - DX) < 1 && Math.abs(ddy - DY) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
      check("C — Position LIBRE (pas un coin par défaut)", Math.abs(ddx - DX) < 1 && Math.abs(ddy - DY) < 1 && Math.abs(DX) > 50 && Math.abs(DY) > 50);
    }
    // Remettre la config décalée pour la réponse ci-dessous
    await sup.put("/api/signature-config", {
      ...corpsBase,
      sigActif: true, sigImage: "", sigTexte: TEXTE_SIG,
      sigPosition: "BAS_DROITE", sigDecalX: DX, sigDecalY: DY,
      sigTaille: 120, sigOpacite: 0.9,
      qrActif: false, mentionActif: false, certActif: true,
    });
    await poserMetadonneesCertificat();
    // pdfC a été rendu avec certificat + signature + décalage (config C) —
    // le bloc certificat y est donc présent, centré en pied de page (le
    // fragment « certifiée » tient sur la PREMIÈRE ligne du bloc, jamais
    // coupée — « é » = 0xE9 en WinAnsi, même octet en latin1).
    const posCertFiche = pdfC.status === 200 ? await positionsTextePdf(pdfC.buf, "certifi\u00e9e") : [];
    check("C — Bloc certificat présent et CENTRÉ (position distincte)", posCertFiche.length > 0 && posCertFiche[0].x > MARGE, JSON.stringify(posCertFiche));

    // MÊME positionnement sur la RÉPONSE associée (document DIFFÉRENT — la
    // dé-duplication par empreinte refuse un contenu identique)
    await creerReponsePdf(path.join(dossierStockage, REPONSE_PDF), 2);
    const form2 = new FormData();
    form2.append("document", new Blob([fs.readFileSync(path.join(dossierStockage, REPONSE_PDF))], { type: "application/pdf" }), REPONSE_PDF);
    form2.append("mode", "valider");
    form2.append("tampon", "auto");
    const rep2 = await sup.req("POST", `/api/demandes/${demande.id}/repondre`, form2, false, {});
    const doc2 = rep2.json?.document?.id;
    const doc2Prive = doc2 ? await sup.req("GET", `/api/demandes/${demande.id}/documents/${doc2}`, undefined, true) : { status: 0, buf: Buffer.alloc(0) };
    check("C — Réponse (config C) tamponnée téléchargée", doc2Prive.status === 200 && doc2Prive.buf.subarray(0, 4).toString() === "%PDF", `status=${doc2Prive.status}`);
    const posRep = doc2Prive.status === 200 ? await positionsTextePdf(doc2Prive.buf, TEXTE_SIG) : [];
    check("C — Texte de signature trouvé dans la RÉPONSE", posRep.length > 0, JSON.stringify(posRep));
    if (posRep.length && posFiche.length) {
      const p = posRep[0];
      check("C — MÊME position sur la réponse (même moteur, même config)", Math.abs(p.x - posFiche[0].x) < 0.5 && Math.abs(p.y - posFiche[0].y) < 0.5, `réponse (${p.x}, ${p.y}) vs fiche (${posFiche[0].x}, ${posFiche[0].y})`);
    }

    // L'UI porte le nouvel aperçu interactif (bundle client servi)
    const pageHome = await fetch(BASE + "/login").then((r) => r.text()).catch(() => "");
    check("D — Application servie (HTML de connexion 200)", pageHome.includes("<!DOCTYPE html>") || pageHome.includes("<!doctype html>"));
  } finally {
    // -------------------------------------------------------------
    // Nettoyage complet
    // -------------------------------------------------------------
    try {
      await db.demandeAdministrative.deleteMany({ where: { reference: REF_DEMANDE } });
      await db.payslip.deleteMany({ where: { fileName: FICHE_PDF } });
      for (const fn of [FICHE_PDF, REPONSE_PDF]) {
        const p = path.join(dossierStockage, fn);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      try {
        for (const f of fs.readdirSync(path.join(path.dirname(dossierStockage), "documents-demandes"))) {
          if (f.startsWith(REF_DEMANDE + "-")) fs.unlinkSync(path.join(path.dirname(dossierStockage), "documents-demandes", f));
        }
      } catch { /* noop */ }
      if (cfgAvant) {
        const d = {
          actif: cfgAvant.actif, sigActif: cfgAvant.sigActif, qrActif: cfgAvant.qrActif,
          qrMode: cfgAvant.qrMode, qrUrl: cfgAvant.qrUrl, mentionActif: cfgAvant.mentionActif,
          certActif: cfgAvant.certActif,
          certSujet: cfgAvant.certSujet, certEmetteur: cfgAvant.certEmetteur,
          certSerie: cfgAvant.certSerie, certValideAu: cfgAvant.certValideAu,
          certEmpreinte: cfgAvant.certEmpreinte,
        };
        await db.signatureConfig.update({ where: { id: "signature" }, data: d });
      }
      console.log("\nNettoyage effectué (fiche, demande, documents, config restaurée).");
    } catch (e) {
      console.error("Nettoyage partiel:", e.message);
    }
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
