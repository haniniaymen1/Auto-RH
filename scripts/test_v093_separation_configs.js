#!/usr/bin/env node
/**
 * v0.2.93 — PREUVE E2E DE LA SÉPARATION DES CONFIGURATIONS
 * =========================================================
 *  Demande utilisateur :
 *   1. SÉPARER la configuration du QR Code, de la signature électronique et
 *      du certificat de signature électronique entre les deux sections
 *      « Import » et « Demandes / Réponses » — chaque section dispose de sa
 *      PROPRE configuration et de SES PROPRES paramètres de positionnement.
 *   2. APERÇU A4 INTERACTIF dans la section « Demandes / Réponses » : les
 *      trois éléments (QR, signature, certificat) positionnables librement
 *      et indépendamment, curseurs synchronisés en temps réel.
 *
 *  Preuves (API + rendu PDF/PNG réel) :
 *   A. API scope=reponse : lecture (source import/reponse), enregistrement
 *      ISOLÉ (la configuration Import reste INTACTE), mode FICHE exclu.
 *   B. Réponse en mode AUTOMATIQUE : la configuration RÉPONSES s'applique
 *      (texte de signature propre, position HAUT, certificat ON alors que
 *      le Switch global est OFF, QR encodant l'URL de vérification issue de
 *      l'adresse de la CONFIGURATION RÉPONSES — décodage jsQR réel).
 *   C. FICHE DE PAIE : la configuration IMPORT s'applique toujours (aperçu
 *      tampon : texte de signature global en BAS, certificat ABSENT alors
 *      que la configuration réponses l'active) — séparation prouvée dans
 *      les DEUX sens.
 *   D. Aperçu « document de réponse » (POST scope=reponse) : PDF synthétique
 *      tamponné avec la configuration réponses du formulaire.
 *   E. CONTINUITÉ : ligne réponses supprimée → le mode Automatique retombe
 *      sur la configuration Import (comportement historique exact).
 *
 * Usage : node scripts/test_v093_separation_configs.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const sharp = require("sharp");
const jsQR = require("jsqr");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PDFDocument, StandardFonts, PDFName } = require("pdf-lib");

const BASE = "http://localhost:4000";
const db = new PrismaClient();

const REF_DEMANDE = "DEM-2026-93001";
const CIN_TEST = "TEST93001";
const TEXTE_SIG_REPONSES = "SIGNATURE-REPONSES-930";
const TEXTE_SIG_GLOBALE = "SIGNATURE-GLOBALE-930";
const CERT_TITULAIRE = "CN=Certificat Demo Auto-RH, O=Entreprise Demo";
const QR_URL_REPONSES = "http://rep-config-930.example";

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

function cleJeton() {
  const secret =
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  return crypto.scryptSync(secret, "autorh-signature-v1", 32);
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
// Extraction de positions dans le flux de contenu PDF (jumelles v092)
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

async function positionsTextePdf(buf, texte) {
  const hexCherche = Buffer.from(texte, "latin1").toString("hex").toUpperCase();
  const trouves = [];
  for (const txt of await fluxPages(buf)) {
    let idx = txt.toUpperCase().indexOf(hexCherche);
    while (idx >= 0) {
      const avant = txt.slice(Math.max(0, idx - 400), idx);
      let mTm = null;
      let mm;
      const reTm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
      while ((mm = reTm.exec(avant)) !== null) mTm = mm;
      if (mTm) trouves.push({ x: parseFloat(mTm[1]), y: parseFloat(mTm[2]) });
      idx = txt.toUpperCase().indexOf(hexCherche, idx + hexCherche.length);
    }
  }
  return trouves;
}

// --------------------------------------------------------------------
// Fichiers de démonstration
// --------------------------------------------------------------------
async function creerReponsePdf(chemin, variante = 1) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(`REPONSE DU SERVICE RH - DOCUMENT OFFICIEL (V${variante})`, { x: 60, y: 760, size: 16, font });
  fs.writeFileSync(chemin, await pdf.save());
}

async function creerReponsePng(chemin, variante = 1) {
  const svg = Buffer.from(
    `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
      <rect width="1240" height="1754" fill="#ffffff"/>
      <text x="80" y="140" font-size="42" font-family="sans-serif" fill="#111111">REPONSE RH PNG (V${variante})</text>
      <text x="80" y="220" font-size="28" font-family="sans-serif" fill="#333333">Document officiel - Auto-RH</text>
    </svg>`
  );
  fs.writeFileSync(chemin, await sharp(svg).png().toBuffer());
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
async function main() {
  console.log("== v0.2.93 — séparation des configurations Import / Demandes-Réponses ==");
  const dossier = dossierStockage();

  const cfgAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });
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
  // État initial propre : AUCUNE configuration réponses enregistrée.
  await db.signatureConfigReponse.deleteMany({}).catch(() => {});

  try {
    const sup = client();
    const login = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
    });
    check("Connexion superadministrateur", login.status === 200, `status=${login.status}`);

    // Métadonnées du certificat « importé » posées en base (état après import
    // — le bloc certificat n'est dessiné que si certSujet + empreinte existent).
    await db.signatureConfig.update({
      where: { id: "signature" },
      data: {
        certSujet: CERT_TITULAIRE,
        certEmetteur: "CN=AC Demo Auto-RH",
        certSerie: "04DEADBEEF9301",
        certValideAu: new Date(Date.now() + 365 * 86400000),
        certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
      },
    }).catch(async () => {
      await db.signatureConfig.create({ data: {
        id: "signature", actif: true,
        certSujet: CERT_TITULAIRE,
        certEmetteur: "CN=AC Demo Auto-RH",
        certSerie: "04DEADBEEF9301",
        certValideAu: new Date(Date.now() + 365 * 86400000),
        certEmpreinte: "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
      } });
    });

    // Configuration « Import » de référence (inerte : les éléments sont OFF,
    // certActif OFF — seules les métadonnées du certificat sont présentes).
    // TOUS les champs de positionnement sont remis à ZÉRO explicitement : le
    // spread de cfg0 ne doit PAS transporter des décalages/rotations
    // résiduels d'exécutions antérieures (rendre la preuve déterministe).
    const cfg0 = (await sup.get("/api/signature-config")).json?.config ?? {};
    const corpsImport = { ...cfg0, actif: false, sigActif: false, qrActif: false,
      mentionActif: false, certActif: false, sigTexte: "", qrUrl: "",
      sigPosition: "BAS_DROITE", qrPosition: "BAS_GAUCHE",
      sigTaille: 120, qrTaille: 110, sigOpacite: 0.9,
      sigDecalX: 0, sigDecalY: 0, qrDecalX: 0, qrDecalY: 0,
      sigRotation: 0, qrRotation: 0,
      certPosition: "BAS_CENTRE", certDecalX: 0, certDecalY: 0, certTaille: 100 };
    delete corpsImport.certFichier;
    const put0 = await sup.put("/api/signature-config", corpsImport);
    check("Configuration Import remise à l'état inerte", put0.status === 200, `status=${put0.status}`);

    // =============================================================
    console.log("\n-- A. API scope=reponse : lecture + enregistrement ISOLÉ --");
    // =============================================================
    const getRep0 = await sup.get("/api/signature-config?scope=reponse");
    check("A — GET scope=reponse : 200", getRep0.status === 200, `status=${getRep0.status}`);
    check("A — GET scope=reponse : source=import (ligne pas encore enregistrée)", getRep0.json?.source === "import", JSON.stringify(getRep0.json?.source));
    check("A — GET scope=reponse : valeurs affichées = copie de la configuration Import (continuité)",
      getRep0.json?.config?.sigPosition === (cfg0.sigPosition || "BAS_DROITE"),
      `sigPosition=${getRep0.json?.config?.sigPosition}`);
    check("A — GET scope=reponse : actifs partagés présents (métadonnées certificat)",
      (getRep0.json?.config?.certSujet || "").includes("Certificat Demo Auto-RH"), JSON.stringify(getRep0.json?.config?.certSujet));

    // Enregistrement d'une configuration RÉPONSES volontairement TRÈS différente
    const cfgReponses = {
      scope: "reponse",
      actif: true,
      sigActif: true, sigTexte: TEXTE_SIG_REPONSES, sigPosition: "HAUT_GAUCHE",
      sigTaille: 120, sigOpacite: 0.9, sigDecalX: 0, sigDecalY: 0, sigRotation: 0,
      qrActif: true, qrMode: "URL", qrUrl: QR_URL_REPONSES, qrTexte: "",
      qrPosition: "BAS_DROITE", qrTaille: 110, qrDecalX: 0, qrDecalY: 0, qrRotation: 0,
      mentionActif: false, mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
      certActif: true, certPosition: "BAS_DROITE", certDecalX: 0, certDecalY: 0, certTaille: 100,
    };
    const putRep = await sup.put("/api/signature-config", cfgReponses);
    check("A — PUT scope=reponse : 200 + source=reponse", putRep.status === 200 && putRep.json?.source === "reponse", `status=${putRep.status} json=${JSON.stringify(putRep.json?.source)}`);

    const getRep1 = await sup.get("/api/signature-config?scope=reponse");
    const rep1 = getRep1.json?.config ?? {};
    check("A — PUT persisté : sigPosition=HAUT_GAUCHE + sigTexte réponses",
      rep1.sigPosition === "HAUT_GAUCHE" && rep1.sigTexte === TEXTE_SIG_REPONSES,
      `sigPosition=${rep1.sigPosition} sigTexte=${rep1.sigTexte}`);
    check("A — PUT persisté : qrMode=URL + qrUrl réponses", rep1.qrMode === "URL" && rep1.qrUrl === QR_URL_REPONSES, JSON.stringify({ m: rep1.qrMode, u: rep1.qrUrl }));
    check("A — PUT persisté : certActif=ON (réponses)", rep1.certActif === true, JSON.stringify(rep1.certActif));

    // SÉPARATION : la configuration Import est RESTÉE INTACTE
    const cfgApres = (await sup.get("/api/signature-config")).json?.config ?? {};
    check("A — SÉPARATION : configuration Import INTACTE (sigTexte, sigPosition, qrUrl, certActif)",
      cfgApres.sigTexte === "" && cfgApres.sigPosition === (cfg0.sigPosition || "BAS_DROITE") &&
      cfgApres.qrUrl === "" && cfgApres.certActif === false,
      JSON.stringify({ t: cfgApres.sigTexte, p: cfgApres.sigPosition, u: cfgApres.qrUrl, c: cfgApres.certActif }));
    check("A — SÉPARATION : les deux lignes coexistent en base (id distincts)",
      Boolean(await db.signatureConfig.findUnique({ where: { id: "signature" } })) &&
      Boolean(await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } })));

    // Mode FICHE exclu des réponses (spécifique aux fiches de paie)
    const putFiche = await sup.put("/api/signature-config", { ...cfgReponses, qrMode: "FICHE" });
    check("A — Mode FICHE refusé pour les réponses → retombe sur DONNEES/choix valides",
      putFiche.status === 200 && putFiche.json?.config?.qrMode === "DONNEES",
      `qrMode=${putFiche.json?.config?.qrMode}`);
    // (on remet l'état URL pour les sections suivantes)
    await sup.put("/api/signature-config", cfgReponses);

    // =============================================================
    console.log("\n-- B. RÉPONSE mode AUTOMATIQUE = configuration RÉPONSES --");
    // =============================================================
    await db.demandeAdministrative.deleteMany({ where: { reference: REF_DEMANDE } });
    const demande = await db.demandeAdministrative.create({
      data: {
        reference: REF_DEMANDE,
        type: "AUTORISATION_SORTIE",
        cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
        donnees: cryptoBd.chiffrerChamp(JSON.stringify({ motif: "Test v0.2.93" })),
        destinataire: cryptoBd.chiffrerChamp("rh-930@entreprise.tn"),
      },
    });

    async function apercuAutoBinaire(nomFichier, variante) {
      await creerReponsePdf(path.join(dossier, nomFichier), variante);
      const form = new FormData();
      form.append("document", new Blob([fs.readFileSync(path.join(dossier, nomFichier))], { type: "application/pdf" }), nomFichier);
      form.append("mode", "apercu");
      form.append("tampon", "auto");
      const res = await fetch(`${BASE}/api/demandes/${demande.id}/repondre`, {
        method: "POST",
        headers: { Cookie: sup.cookie() },
        body: form,
      });
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
    }

    const rAuto = await apercuAutoBinaire("e2e-930-auto.pdf", 1);
    check("B — Aperçu réponse (auto) 200 PDF", rAuto.status === 200 && rAuto.buf.subarray(0, 4).toString() === "%PDF", `status=${rAuto.status}`);
    const tAuto = rAuto.status === 200 ? await textePdf(rAuto.buf) : "";
    check("B — TEXTE DE SIGNATURE RÉPONSES apposé (config réponses)", tAuto.includes(TEXTE_SIG_REPONSES), tAuto.slice(0, 200));
    check("B — AUCUN texte de signature de la config Import sur la réponse", !tAuto.includes(TEXTE_SIG_GLOBALE));

    const posSig = rAuto.status === 200 ? await positionsTextePdf(rAuto.buf, TEXTE_SIG_REPONSES) : [];
    check("B — POSITION RÉPONSES appliquée (HAUT_GAUCHE : texte au-dessus de y=700)",
      posSig.length > 0 && posSig[0].y > 700, JSON.stringify(posSig));
    check("B — CERTIFICAT apposé sur la réponse (certActif réponses ON)", tAuto.includes("Certificat Demo Auto-RH"));

    // QR de la réponse = URL de vérification issue de la CONFIGURATION RÉPONSES
    const nomPng = "e2e-930-auto.png";
    await creerReponsePng(path.join(dossier, nomPng), 2);
    const formPng = new FormData();
    formPng.append("document", new Blob([fs.readFileSync(path.join(dossier, nomPng))], { type: "image/png" }), nomPng);
    formPng.append("mode", "apercu");
    formPng.append("tampon", "auto");
    const rPng = await fetch(`${BASE}/api/demandes/${demande.id}/repondre`, {
      method: "POST", headers: { Cookie: sup.cookie() }, body: formPng,
    });
    const bufPng = Buffer.from(await rPng.arrayBuffer());
    check("B — Aperçu réponse PNG (auto) 200", rPng.status === 200 && bufPng.subarray(1, 4).toString() === "PNG", `status=${rPng.status}`);
    const urlAttendue = QR_URL_REPONSES + "/verification/reponse/" + REF_DEMANDE + "?t=" + jetonReponseAttendu(REF_DEMANDE);
    const qrLu = rPng.status === 200 ? await decoderQr(bufPng) : null;
    check("B — QR DÉCODÉ = URL de vérification de la CONFIGURATION RÉPONSES (jeton HMAC inclus)",
      qrLu === urlAttendue, `lu=${qrLu} attendu=${urlAttendue}`);

    // =============================================================
    console.log("\n-- C. FICHE DE PAIE = configuration IMPORT (séparation inverse) --");
    // =============================================================
    const corpsFiche = { ...corpsImport, actif: true, sigActif: true, sigTexte: TEXTE_SIG_GLOBALE,
      sigPosition: "BAS_DROITE", mentionActif: false, certActif: false };
    const putF = await sup.put("/api/signature-config", corpsFiche);
    check("C — Configuration Import reconfigurée (signature texte BAS_DROITE, certificat OFF)", putF.status === 200, `status=${putF.status}`);

    const rApercuFiche = await sup.req("POST", "/api/signature-config", {
      action: "apercu", ...corpsFiche, sigImage: cfgApres.sigImage ?? "",
    }, true);
    check("C — Aperçu fiche (config Import) 200 PDF", rApercuFiche.status === 200 && rApercuFiche.buf.subarray(0, 4).toString() === "%PDF", `status=${rApercuFiche.status}`);
    const tFiche = rApercuFiche.status === 200 ? await textePdf(rApercuFiche.buf) : "";
    check("C — TEXTE DE SIGNATURE IMPORT apposé sur la fiche", tFiche.includes(TEXTE_SIG_GLOBALE));
    check("C — AUCUN texte de signature RÉPONSES sur la fiche", !tFiche.includes(TEXTE_SIG_REPONSES));
    const posFiche = rApercuFiche.status === 200 ? await positionsTextePdf(rApercuFiche.buf, TEXTE_SIG_GLOBALE) : [];
    check("C — Texte de signature IMPORT positionné : occurrence extraite", posFiche.length > 0, JSON.stringify(posFiche));
    // Position par DIFFÉRENCE (robuste aux transformations constantes du
    // moteur) : décalage vertical +200 pt de la configuration Import →
    // le texte rendu descend exactement de 200 pt.
    const putC2 = await sup.put("/api/signature-config", { ...corpsFiche, sigDecalY: 200 });
    check("C — Décalage vertical +200 pt enregistré (config Import)", putC2.status === 200, `status=${putC2.status}`);
    const rApercuFiche2 = await sup.req("POST", "/api/signature-config", {
      action: "apercu", ...{ ...corpsFiche, sigDecalY: 200 }, sigImage: cfgApres.sigImage ?? "",
    }, true);
    const posFiche2 = rApercuFiche2.status === 200 ? await positionsTextePdf(rApercuFiche2.buf, TEXTE_SIG_GLOBALE) : [];
    check("C — Occurrence décalée extraite", posFiche2.length > 0, JSON.stringify(posFiche2));
    if (posFiche.length && posFiche2.length) {
      const ddx = posFiche2[0].x - posFiche[0].x;
      const ddy = posFiche2[0].y - posFiche[0].y;
      check("C — POSITION IMPORT APPLIQUÉE (décalage +200 pt restitué par différence, BAS_DROITE)",
        Math.abs(ddx) < 1 && Math.abs(ddy - 200) < 1, `delta rendu (${ddx.toFixed(1)}, ${ddy.toFixed(1)})`);
      // et la position de DÉPART reste dans la moitié BASSE de la page
      // (BAS_DROITE — la réponse réponses, elle, est en HAUT : y>700 en B).
      check("C — Le texte IMPORT reste dans la zone basse (y < 400 avant décalage)",
        posFiche[0].y < 400, `y=${posFiche[0].y}`);
    }
    check("C — SÉPARATION INVERSE : certificat ABSENT de la fiche (certActif Import OFF) alors que la config réponses l'active",
      !tFiche.includes("Certificat Demo Auto-RH"));

    // =============================================================
    console.log("\n-- D. APERÇU « document de réponse » (POST scope=reponse) --");
    // =============================================================
    const rApercuRep = await sup.req("POST", "/api/signature-config", {
      action: "apercu", scope: "reponse", ...cfgReponses,
    }, true);
    check("D — Aperçu réponse 200 PDF", rApercuRep.status === 200 && rApercuRep.buf.subarray(0, 4).toString() === "%PDF", `status=${rApercuRep.status}`);
    const tApercuRep = rApercuRep.status === 200 ? await textePdf(rApercuRep.buf) : "";
    check("D — PDF = document de réponse d'exemple (référence DEM-2026-00042)", tApercuRep.includes("DEM-2026-00042"), tApercuRep.slice(0, 160));
    check("D — Tamponné avec la configuration réponses (texte signature + certificat)",
      tApercuRep.includes(TEXTE_SIG_REPONSES) && tApercuRep.includes("Certificat Demo Auto-RH"));

    // =============================================================
    console.log("\n-- E. CONTINUITÉ : ligne réponses supprimée → repli Import --");
    // =============================================================
    await db.signatureConfigReponse.deleteMany({});
    const rRepli = await apercuAutoBinaire("e2e-930-repli.pdf", 3);
    check("E — Aperçu réponse (auto, SANS config réponses) 200", rRepli.status === 200, `status=${rRepli.status}`);
    const tRepli = rRepli.status === 200 ? await textePdf(rRepli.buf) : "";
    check("E — REPLI HISTORIQUE : la réponse utilise la configuration IMPORT (texte signature global)",
      tRepli.includes(TEXTE_SIG_GLOBALE) && !tRepli.includes(TEXTE_SIG_REPONSES), tRepli.slice(0, 200));
    // (le certificat reste OFF dans la config Import → absent — cohérent)

  } finally {
    // -------------------------------------------------------------
    // Nettoyage complet
    // -------------------------------------------------------------
    try {
      await db.demandeAdministrative.deleteMany({ where: { reference: REF_DEMANDE } });
      await db.signatureConfigReponse.deleteMany({}).catch(() => {});
      for (const f of fs.readdirSync(dossier)) {
        if (f.startsWith("e2e-930-")) fs.unlinkSync(path.join(dossier, f));
      }
      const dd = path.join(path.dirname(dossier), "documents-demandes");
      if (fs.existsSync(dd)) {
        for (const f of fs.readdirSync(dd)) {
          if (f.startsWith(REF_DEMANDE + "-")) fs.unlinkSync(path.join(dd, f));
        }
      }
      if (cfgAvant) {
        // Restauration COMPLÈTE des champs éditables (y compris positionnement
        // et textes — sinon des résidus polluent les exécutions suivantes).
        await db.signatureConfig.update({ where: { id: "signature" }, data: {
          actif: cfgAvant.actif, sigActif: cfgAvant.sigActif,
          sigTexte: cfgAvant.sigTexte, sigPosition: cfgAvant.sigPosition,
          sigTaille: cfgAvant.sigTaille, sigOpacite: cfgAvant.sigOpacite,
          sigDecalX: cfgAvant.sigDecalX, sigDecalY: cfgAvant.sigDecalY,
          sigRotation: cfgAvant.sigRotation,
          qrActif: cfgAvant.qrActif, qrMode: cfgAvant.qrMode, qrUrl: cfgAvant.qrUrl,
          qrTexte: cfgAvant.qrTexte, qrPosition: cfgAvant.qrPosition,
          qrTaille: cfgAvant.qrTaille, qrDecalX: cfgAvant.qrDecalX,
          qrDecalY: cfgAvant.qrDecalY, qrRotation: cfgAvant.qrRotation,
          mentionActif: cfgAvant.mentionActif, mentionTexte: cfgAvant.mentionTexte,
          certActif: cfgAvant.certActif, certPosition: cfgAvant.certPosition ?? "BAS_CENTRE",
          certDecalX: cfgAvant.certDecalX ?? 0, certDecalY: cfgAvant.certDecalY ?? 0,
          certTaille: cfgAvant.certTaille ?? 100,
        } });
      }
      if (repAvant) {
        // (état antérieur restauré si le test a tourné sur une base déjà configurée)
        const r = repAvant;
        await db.signatureConfigReponse.upsert({
          where: { id: "signature-reponse" },
          update: {
            actif: r.actif, sigActif: r.sigActif, sigTexte: r.sigTexte, sigPosition: r.sigPosition,
            sigTaille: r.sigTaille, sigOpacite: r.sigOpacite, qrActif: r.qrActif, qrMode: r.qrMode,
            qrUrl: r.qrUrl, qrTexte: r.qrTexte, qrPosition: r.qrPosition, qrTaille: r.qrTaille,
            sigDecalX: r.sigDecalX, sigDecalY: r.sigDecalY, qrDecalX: r.qrDecalX, qrDecalY: r.qrDecalY,
            sigRotation: r.sigRotation, qrRotation: r.qrRotation, mentionActif: r.mentionActif,
            mentionTexte: r.mentionTexte, certActif: r.certActif, certPosition: r.certPosition,
            certDecalX: r.certDecalX, certDecalY: r.certDecalY, certTaille: r.certTaille,
          },
          create: { id: "signature-reponse", ...r },
        });
      }
      console.log("\nNettoyage effectué (demande, documents, configs restaurées).");
    } catch (e) {
      console.error("Nettoyage partiel:", e.message);
    }
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
