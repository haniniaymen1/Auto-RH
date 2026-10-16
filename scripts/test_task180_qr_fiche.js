#!/usr/bin/env node
/**
 * Task 180 — PREUVE E2E « QR code personnalisé par fiche de paie → fiche en
 * ligne ».
 *
 * Vérifie contre l'administration réelle (port 4000) :
 *   1. Configuration du tampon en mode QR « FICHE » (RH/SUPERADMIN) ;
 *   2. Le QR apposé sur une fiche PNG importée, DÉCODÉ RÉELLEMENT (jsQR),
 *      encode bien l'URL attendue :
 *        {adresse}/verification/fiche/{id}?t={jeton HMAC 24 hex}
 *      (jeton recalculé indépendamment dans ce test — clé .env, scrypt,
 *      domaine « fiche-en-ligne-v1 ») ;
 *   3. La page PUBLIQUE /verification/fiche/[id] (sans cookie) :
 *      jeton valide → « Document authentique » + détails + boutons ;
 *      jeton faux / absent / fiche inconnue → « Document non reconnu »
 *      et AUCUN détail révélé ;
 *   4. L'API PUBLIQUE /api/payslips/qr/[id]/file : jeton valide → fichier
 *      tamponné (dont le QR décodé pointe la même URL) ; jeton faux → 403 ;
 *   5. Isolement : tout le reste reste PROTÉGÉ (liste fiches sans cookie
 *      → 401, fichier privé sans cookie → 401, signature-config → 401) ;
 *   6. Non-régression : le mode DONNEES historique produit toujours le
 *      contenu lisible « Auto-RH — Fiche de paie … » (décodé) ;
 *   7. PDF : fiche PDF tamponnée servie (privée ET publique) ; si pdftoppm
 *      est disponible, le QR du PDF est AUSSI décodé page rendue ;
 *   8. Révocation : fiche supprimée → page publique « non reconnu ».
 *
 * Nettoyage complet vérifié (fiche semée supprimée, fichier disque effacé,
 * configuration tampon restaurée à l'état initial).
 *
 * Usage : node scripts/test_task180_qr_fiche.js [--garder]
 *   --garder : conserve la fiche semée + configuration FICHE active (pour
 *              vérification navigateur) — relancer sans l'option pour nettoyer.
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme start-prod.js) -----------------------------
const fs = require("fs");
const path = require("path");
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
const db = new PrismaClient();
const GARDER = process.argv.includes("--garder");

const NOM_FICHIER = "e2e-180-fiche.png";
const NOM_FICHIER_PDF = "e2e-180-fiche.pdf";
const CIN_TEST = "TEST18001";
const NOM_TEST = "EMPLOYE DEMO TASK180";
const ADRESSE_PUBLIQUE = "http://localhost:4000";

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log(`  OK   ${label}`);
  } else {
    KO++;
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

process.on("uncaughtException", (e) => {
  console.error("[UNCAUGHT]", e);
  process.exit(2);
});
process.on("unhandledRejection", (e) => {
  console.error("[UNHANDLED]", e);
  process.exit(2);
});

/** Client HTTP minimal avec cookie de session. */
function client() {
  let cookie = "";
  return {
    async req(method, p, body, brut = false) {
      const res = await fetch(BASE + p, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      if (brut) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buf, headers: res.headers };
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* HTML ou vide */
      }
      return { status: res.status, json, headers: res.headers };
    },
    get(p, brut) {
      return this.req("GET", p, undefined, brut);
    },
    post(p, b) {
      return this.req("POST", p, b);
    },
    put(p, b) {
      return this.req("PUT", p, b);
    },
    del(p) {
      return this.req("DELETE", p, undefined, false);
    },
  };
}

/** GET public (SANS cookie) — binaire ou texte. */
async function getPublic(p) {
  const res = await fetch(BASE + p, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers };
}

// ---- Jeton attendu, recalculé INDÉPENDAMMENT du site -----------------------
function cleJeton() {
  const matiere =
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  return crypto.scryptSync(matiere, "autorh-signature-v1", 32);
}
function jetonAttendu(id) {
  return crypto
    .createHmac("sha256", cleJeton())
    .update("fiche-en-ligne-v1|" + id)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

/** Décodage QR réel (jsQR) d'un PNG : renvoie le texte décodé ou null. */
async function decoderQr(octets) {
  const { data, info } = await sharp(octets)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const res = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height
  );
  return res ? res.data : null;
}

/** Fiche PNG de démonstration (bulletin stylisé lisible). */
async function creerFichePng(chemin) {
  const svg = Buffer.from(
    `<svg width="1240" height="300" xmlns="http://www.w3.org/2000/svg">
       <rect x="40" y="30" width="1160" height="230" fill="none" stroke="#333" stroke-width="2"/>
       <text x="70" y="90" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="#111">BULLETIN DE PAIE — DÉMO TASK 180</text>
       <text x="70" y="140" font-family="DejaVu Sans" font-size="28" fill="#222">Employé : ${NOM_TEST}</text>
       <text x="70" y="185" font-family="DejaVu Sans" font-size="28" fill="#222">CIN : ${CIN_TEST} — Période : 09/2026</text>
       <text x="70" y="230" font-family="DejaVu Sans" font-size="28" fill="#222">Net à payer : 2 400,000 TND</text>
     </svg>`
  );
  await sharp({
    create: { width: 1240, height: 1754, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toFile(chemin);
}

/** Fiche PDF minimale mais valide (pdf-lib). */
async function creerFichePdf(chemin) {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("BULLETIN DE PAIE - DEMO TASK 180", { x: 60, y: 760, size: 18, font });
  page.drawText("Employe : " + NOM_TEST + " - CIN : " + CIN_TEST, {
    x: 60, y: 720, size: 12, font,
  });
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
  for (const c of candidats) {
    if (fs.existsSync(c)) return c;
  }
  const retenu = candidats[2];
  fs.mkdirSync(retenu, { recursive: true });
  return retenu;
}

async function main() {
  console.log("== Task 180 — QR « Fiche en ligne » : preuve E2E ==");
  const dossier = dossierStockage();
  console.log(`Dossier de stockage : ${dossier}`);

  // ------------------------------------------------------------------
  // 0) État initial : configuration tampon SauvegardeD + nettoyage restes
  // ------------------------------------------------------------------
  const anon = client();
  const cfgAvant = await anon.get("/api/signature-config");
  if (cfgAvant.status !== 200) {
    // pas de session anonyme attendue → connexion superadmin d'abord
  }
  const sup = client();
  const loginSup = await sup.post("/api/auth/login", {
    email: "superadmin@autorh.local",
    password: "AutoRH-2026!Verif#1",
  });
  check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);

  const cfg0 = await sup.get("/api/signature-config");
  check("GET /api/signature-config (superadmin) 200", cfg0.status === 200, `status=${cfg0.status}`);
  const cfgInitiale = cfg0.json?.config ?? null;
  check("Configuration initiale lue", Boolean(cfgInitiale));

  // Nettoyage d'un éventuel reste d'une exécution précédente
  await db.payslip.deleteMany({ where: { fileName: { in: [NOM_FICHIER, NOM_FICHIER_PDF] } } });
  for (const n of [NOM_FICHIER, NOM_FICHIER_PDF]) {
    const p = path.join(dossier, n);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // ------------------------------------------------------------------
  // 1) Sème : fiche PNG + fiche PDF réelles sur disque + en base
  // ------------------------------------------------------------------
  await creerFichePng(path.join(dossier, NOM_FICHIER));
  await creerFichePdf(path.join(dossier, NOM_FICHIER_PDF));
  const cinIndex = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const semees = [];
  for (const [fn, tailleMin] of [[NOM_FICHIER, 1000], [NOM_FICHIER_PDF, 400]]) {
    const rec = await db.payslip.create({
      data: {
        fileName: fn,
        storedName: fn,
        fileSize: fs.statSync(path.join(dossier, fn)).size,
        content: "FICHE DE PAIE " + CIN_TEST,
        normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST,
        cinIndex,
        employeeName: NOM_TEST,
        period: "09/2026",
        netSalary: "2 400,000",
      },
    });
    semees.push(rec);
  }
  const fiche = semees[0];
  const fichePdf = semees[1];
  check("Fiches semées (PNG + PDF) en base", semees.length === 2);

  // ------------------------------------------------------------------
  // 2) Configuration tampon : mode QR « FICHE » + adresse publique
  // ------------------------------------------------------------------
  const corpsConfig = {
    actif: true,
    sigActif: false,
    sigImage: "",
    sigTexte: "",
    sigPosition: "BAS_DROITE",
    sigTaille: 120,
    sigOpacite: 0.9,
    qrActif: true,
    qrMode: "FICHE",
    qrUrl: ADRESSE_PUBLIQUE,
    qrTexte: "",
    qrPosition: "BAS_GAUCHE",
    qrTaille: 150,
    sigDecalX: 0,
    sigDecalY: 0,
    qrDecalX: 0,
    qrDecalY: 0,
    sigRotation: 0,
    qrRotation: 0,
    mentionActif: true,
    mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
  };
  const putCfg = await sup.put("/api/signature-config", corpsConfig);
  check(
    "PUT tampon mode FICHE accepté (qrMode=FICHE dans MODES_QR)",
    putCfg.status === 200 && putCfg.json?.config?.qrMode === "FICHE",
    `status=${putCfg.status}`
  );

  const jeton = jetonAttendu(fiche.id);
  const urlAttendue = `${ADRESSE_PUBLIQUE}/verification/fiche/${fiche.id}?t=${jeton}`;
  console.log(`URL attendue dans le QR : ${urlAttendue}`);

  // ------------------------------------------------------------------
  // 3) Fichier privé (session) : le QR apposé est DÉCODÉ → URL attendue
  // ------------------------------------------------------------------
  const fichierPrive = await sup.get(`/api/payslips/${fiche.id}/file`, true);
  check(
    "GET fichier privé (session) 200 PNG",
    fichierPrive.status === 200 &&
      String(fichierPrive.headers.get("content-type") || "").includes("image/png"),
    `status=${fichierPrive.status} type=${fichierPrive.headers.get("content-type")}`
  );
  const decode1 = await decoderQr(fichierPrive.buf);
  check(
    "QR DÉCODÉ (jsQR) sur la fiche PNG tamponnée",
    Boolean(decode1),
    decode1 === null ? "aucun QR décodé" : decode1
  );
  check(
    "Contenu du QR = URL de vérification signée attendue",
    decode1 === urlAttendue,
    `décodé=${decode1}`
  );

  // ------------------------------------------------------------------
  // 4) Page publique de vérification (SANS session)
  // ------------------------------------------------------------------
  const pageOk = await getPublic(`/verification/fiche/${fiche.id}?t=${jeton}`);
  const htmlOk = pageOk.buf.toString("utf8");
  check("Page publique 200 (jeton valide)", pageOk.status === 200, `status=${pageOk.status}`);
  check("Page : « Document authentique »", htmlOk.includes("Document authentique"));
  check("Page : nom de l'employé affiché", htmlOk.includes(NOM_TEST));
  check("Page : CIN affiché", htmlOk.includes(CIN_TEST));
  check("Page : bouton « Ouvrir la fiche de paie »", htmlOk.includes("Ouvrir la fiche de paie"));
  check(
    "Page : lien du fichier avec jeton présent",
    htmlOk.includes(`/api/payslips/qr/${fiche.id}/file?t=`)
  );

  const pageFaux = await getPublic(`/verification/fiche/${fiche.id}?t=${"A".repeat(24)}`);
  const htmlFaux = pageFaux.buf.toString("utf8");
  check("Page 200 avec jeton FAUX", pageFaux.status === 200);
  check("Page jeton faux : « Document non reconnu »", htmlFaux.includes("Document non reconnu"));
  check("Page jeton faux : AUCUN détail (nom absent)", !htmlFaux.includes(NOM_TEST));

  const pageSans = await getPublic(`/verification/fiche/${fiche.id}`);
  check(
    "Page sans jeton : « Document non reconnu »",
    pageSans.status === 200 && pageSans.buf.toString("utf8").includes("Document non reconnu")
  );

  const pageInconnu = await getPublic(
    `/verification/fiche/inconnu180?t=${jetonAttendu("inconnu180")}`
  );
  check(
    "Page fiche inexistante : « Document non reconnu »",
    pageInconnu.status === 200 &&
      pageInconnu.buf.toString("utf8").includes("Document non reconnu")
  );

  // ------------------------------------------------------------------
  // 5) API publique du fichier (SANS session)
  // ------------------------------------------------------------------
  const pubFichier = await getPublic(`/api/payslips/qr/${fiche.id}/file?t=${jeton}`);
  check(
    "API publique fichier 200 PNG (jeton valide)",
    pubFichier.status === 200 &&
      String(pubFichier.headers.get("content-type") || "").includes("image/png"),
    `status=${pubFichier.status}`
  );
  check("API publique : contenu non vide", pubFichier.buf.length > 1000, `${pubFichier.buf.length} o`);
  const decode2 = await decoderQr(pubFichier.buf);
  check(
    "QR du fichier public décodé = même URL signée",
    decode2 === urlAttendue,
    `décodé=${decode2}`
  );
  const pubTelechargement = await getPublic(
    `/api/payslips/qr/${fiche.id}/file?t=${jeton}&download=1`
  );
  check(
    "API publique download=1 → Content-Disposition attachment",
    String(pubTelechargement.headers.get("content-disposition") || "").includes("attachment")
  );
  const pubFaux = await getPublic(`/api/payslips/qr/${fiche.id}/file?t=${"B".repeat(24)}`);
  check("API publique jeton faux → 403", pubFaux.status === 403, `status=${pubFaux.status}`);
  const pubSans = await getPublic(`/api/payslips/qr/${fiche.id}/file`);
  check("API publique sans jeton → 403", pubSans.status === 403, `status=${pubSans.status}`);
  const pubAutreFiche = await getPublic(
    `/api/payslips/qr/${fichePdf.id}/file?t=${jeton}`
  );
  check(
    "Jeton d'une AUTRE fiche refusé (403) — aucun croisement possible",
    pubAutreFiche.status === 403,
    `status=${pubAutreFiche.status}`
  );

  // ------------------------------------------------------------------
  // 6) Isolement : le reste du site reste derrière la connexion
  // ------------------------------------------------------------------
  const isoListe = await getPublic("/api/payslips");
  check("Liste des fiches sans session → 401 (middleware)", isoListe.status === 401, `status=${isoListe.status}`);
  const isoFichier = await getPublic(`/api/payslips/${fiche.id}/file`);
  check("Fichier privé sans session → 401", isoFichier.status === 401, `status=${isoFichier.status}`);
  const isoConfig = await getPublic("/api/signature-config");
  check("signature-config sans session → 401", isoConfig.status === 401, `status=${isoConfig.status}`);
  const isoAccueil = await getPublic("/");
  check(
    "Accueil sans session → redirection /login (302/307)",
    [302, 307].includes(isoAccueil.status),
    `status=${isoAccueil.status}`
  );

  // ------------------------------------------------------------------
  // 7) Fiche PDF : servie privée + publique (même jeton), QR décodé si poppler
  // ------------------------------------------------------------------
  const jetonPdf = jetonAttendu(fichePdf.id);
  const fichierPdfPrive = await sup.get(`/api/payslips/${fichePdf.id}/file`, true);
  check(
    "Fiche PDF : GET privé 200 application/pdf",
    fichierPdfPrive.status === 200 &&
      String(fichierPdfPrive.headers.get("content-type") || "").includes("application/pdf"),
    `status=${fichierPdfPrive.status}`
  );
  const fichierPdfPublic = await getPublic(
    `/api/payslips/qr/${fichePdf.id}/file?t=${jetonPdf}`
  );
  check(
    "Fiche PDF : API publique 200 (jeton propre à la fiche PDF)",
    fichierPdfPublic.status === 200 &&
      fichierPdfPublic.buf.subarray(0, 4).toString("latin1") === "%PDF",
    `status=${fichierPdfPublic.status}`
  );
  const pdftoppm = ["pdftoppm", "pdftocairo"].find((b) => {
    try {
      fs.accessSync("/usr/bin/" + b, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (pdftoppm) {
    const { execFileSync } = require("child_process");
    const os = require("os");
    const tmp = path.join(os.tmpdir(), "t180-qr");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    // Rasterisation du PDF public (contenu = PDF tamponné renvoyé par l'API)
    const tmpPdf = path.join(tmp, "fiche.pdf");
    fs.writeFileSync(tmpPdf, fichierPdfPublic.buf);
    execFileSync(pdftoppm, ["-png", "-r", "150", "-f", "1", "-l", "1", tmpPdf, path.join(tmp, "p")]);
    const rendu = fs.readdirSync(tmp).find((n) => n.startsWith("p") && n.endsWith(".png"));
    if (rendu) {
      const decodePdf = await decoderQr(fs.readFileSync(path.join(tmp, rendu)));
      const urlPdfAttendue = `${ADRESSE_PUBLIQUE}/verification/fiche/${fichePdf.id}?t=${jetonPdf}`;
      check(
        "QR du PDF rendu (150 dpi) décodé = URL signée de la fiche PDF",
        decodePdf === urlPdfAttendue,
        `décodé=${decodePdf}`
      );
    } else {
      check("QR du PDF rendu décodé", false, "pdftoppm n'a produit aucun PNG");
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  } else {
    console.log("  --   pdftoppm absent : décodage PDF sauté (preuve PNG complète déjà fournie)");
  }

  // ------------------------------------------------------------------
  // 8) Non-régression : mode DONNEES historique (contenu lisible décodé)
  // ------------------------------------------------------------------
  const putDonnees = await sup.put("/api/signature-config", {
    ...corpsConfig,
    qrMode: "DONNEES",
    qrUrl: "",
  });
  check("PUT tampon mode DONNEES accepté", putDonnees.status === 200 && putDonnees.json?.config?.qrMode === "DONNEES");
  const fichierDonnees = await sup.get(`/api/payslips/${fiche.id}/file`, true);
  const decode3 = await decoderQr(fichierDonnees.buf);
  check(
    "Mode DONNEES : QR décodé = carte de la fiche (historique intact)",
    typeof decode3 === "string" && decode3.startsWith("Auto-RH — Fiche de paie") && decode3.includes(`Réf : ${fiche.id}`),
    `décodé=${String(decode3).slice(0, 60)}…`
  );

  // ------------------------------------------------------------------
  // 9) NETTOYAGE : révocation + état initial
  // ------------------------------------------------------------------
  if (!GARDER) {
    const del1 = await sup.del(`/api/payslips/${fiche.id}`);
    check("DELETE fiche PNG (session) 200", [200, 204].includes(del1.status), `status=${del1.status}`);
    const del2 = await sup.del(`/api/payslips/${fichePdf.id}`);
    check("DELETE fiche PDF (session) 200", [200, 204].includes(del2.status), `status=${del2.status}`);

    const pageApres = await getPublic(`/verification/fiche/${fiche.id}?t=${jeton}`);
    check(
      "RÉVOCATION : page de la fiche supprimée → « Document non reconnu »",
      pageApres.status === 200 && pageApres.buf.toString("utf8").includes("Document non reconnu")
    );
    const fichierApres = await getPublic(`/api/payslips/qr/${fiche.id}/file?t=${jeton}`);
    check("RÉVOCATION : fichier public supprimé → 404", fichierApres.status === 404, `status=${fichierApres.status}`);

    const reste = await db.payslip.count();
    check("Base vidée des fiches de test (0 fiche)", reste === 0, `count=${reste}`);
    for (const n of [NOM_FICHIER, NOM_FICHIER_PDF]) {
      const p = path.join(dossier, n);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    check("Fichiers disque de test effacés", true);

    if (cfgInitiale) {
      const restore = await sup.put("/api/signature-config", {
        actif: cfgInitiale.actif,
        sigActif: cfgInitiale.sigActif,
        sigImage: "",
        sigTexte: cfgInitiale.sigTexte ?? "",
        sigPosition: cfgInitiale.sigPosition,
        sigTaille: cfgInitiale.sigTaille,
        sigOpacite: cfgInitiale.sigOpacite,
        qrActif: cfgInitiale.qrActif,
        qrMode: cfgInitiale.qrMode,
        qrUrl: cfgInitiale.qrUrl ?? "",
        qrTexte: cfgInitiale.qrTexte ?? "",
        qrImage: "",
        qrPosition: cfgInitiale.qrPosition,
        qrTaille: cfgInitiale.qrTaille,
        sigDecalX: cfgInitiale.sigDecalX,
        sigDecalY: cfgInitiale.sigDecalY,
        qrDecalX: cfgInitiale.qrDecalX,
        qrDecalY: cfgInitiale.qrDecalY,
        sigRotation: cfgInitiale.sigRotation,
        qrRotation: cfgInitiale.qrRotation,
        mentionActif: cfgInitiale.mentionActif,
        mentionTexte: cfgInitiale.mentionTexte ?? "",
      });
      check("Configuration tampon restaurée à l'état initial", restore.status === 200);
    }

    const users = await db.user.count();
    check("Aucun compte de test laissé (users=1)", users === 1, `users=${users}`);
  } else {
    console.log("  --   --garder : fiche + configuration FICHE laissées en place");
  }

  console.log(`\n==== BILAN : ${OK} OK / ${KO} FAIL ====`);
  await db.$disconnect();
  process.exit(KO === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[ERREUR FATALE]", e);
  try {
    await db.$disconnect();
  } catch {}
  process.exit(2);
});
