#!/usr/bin/env node
/**
 * ============================================================
 *  Auto-RH — SCINDAGE des CLASSEURS EXCEL multi-fiches EXISTANTS (Task 24)
 * ============================================================
 *
 *  Les fiches importées AVANT le découpage automatique partagent un
 *  MÊME classeur Excel (plusieurs enregistrements -> un seul fichier) :
 *  en consultant « sa » fiche, un employé recevait donc le classeur
 *  COMPLET (les fiches des autres employés incluses).
 *
 *  Ce script :
 *   1. repère les classeurs Excel (.xlsx/.xlsm/.xls) référencés par
 *      PLUSIEURS fiches ;
 *   2. déchiffre le classeur (AES-256-GCM, format PAIESAGE1) ;
 *   3. localise le CIN de chaque fiche dans les FEUILLES du classeur
 *      (le CIN est déjà connu en base — aucune ré-détection) ;
 *   4. DÉCOUPE le classeur : chaque fiche reçoit un classeur autonome
 *      contenant uniquement SES feuilles (haute fidélité : styles,
 *      fusions, largeurs, images — exceljs) ;
 *   5. chiffre et écrit chaque fiche individuelle (nouveau storedName) ;
 *   6. met à jour chaque fiche (storedName, taille, pages, nom affiché
 *      « original (feuille N).xlsx ») ;
 *   7. déplace l'original dans storage/payslips/_originaux/ (réversible :
 *      aucune donnée n'est supprimée).
 *
 *  CAS NON TRAITÉ (signalé clairement, fichier INTACT) : les classeurs
 *  « 1 bulletin par LIGNE » (plusieurs CIN dans la MÊME feuille) ne
 *  peuvent pas être découpés par feuille sans emporter les salaires des
 *  autres employés. Ils restent en l'état — réimportez ce classeur après
 *  la mise à jour : le site génère alors automatiquement une fiche
 *  Excel étiquetée individuelle par employé.
 *
 *  Usage :
 *    node scripts/scinder-excel-multipages.js              -> SCINDER
 *    node scripts/scinder-excel-multipages.js --verifier   -> état seulement
 * ============================================================
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const MODE = process.argv[2] || "--scinder";
const VERIFIER = MODE === "--verifier";
const ROOT = path.join(__dirname, "..");
const db = new PrismaClient();

// ---------- Chargement du .env (identique à chiffrer-storage.js) ----------
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
})();

// ---------- Chiffrement : constantes IDENTIQUES à storage-crypto.ts ----------
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SALT = "autorh-storage-v1";
const key = () =>
  crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
      process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env",
    SALT,
    32
  );
const isEnc = (b) =>
  b.length > MAGIC.length && b.subarray(0, MAGIC.length).equals(MAGIC);

function decryptBuf(buf) {
  if (!isEnc(buf)) return buf; // fichier ancien en clair — compatible
  const n = buf.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
  const t = buf.subarray(
    MAGIC.length + NONCE_LEN,
    MAGIC.length + NONCE_LEN + TAG_LEN
  );
  const c = buf.subarray(MAGIC.length + NONCE_LEN + TAG_LEN);
  const d = crypto.createDecipheriv("aes-256-gcm", key(), n);
  d.setAuthTag(t);
  return Buffer.concat([d.update(c), d.final()]);
}

function encryptBuf(buf) {
  if (isEnc(buf)) return buf;
  const nonce = crypto.randomBytes(NONCE_LEN);
  const c = crypto.createCipheriv("aes-256-gcm", key(), nonce);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, nonce, c.getAuthTag(), enc]);
}

// ---------- Dossiers candidats (même logique que le site/portail) ----------
function rootFromDatabaseUrl() {
  const m = String(process.env.DATABASE_URL || "").match(
    /^file:(.+)[/\\]db[/\\][^/\\]+\.db\/?$/i
  );
  if (!m) return null;
  try {
    return path.resolve(m[1]);
  } catch {
    return null;
  }
}
const DB_ROOT = rootFromDatabaseUrl();
const DIRS = [
  ...new Set(
    [
      process.env.STORAGE_DIR,
      process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR,
      path.join(ROOT, "storage", "payslips"),
      path.join(process.cwd(), "storage", "payslips"),
      DB_ROOT ? path.join(DB_ROOT, "storage", "payslips") : null,
      path.join(ROOT, ".next", "standalone", "storage", "payslips"),
      path.join(process.cwd(), ".next", "standalone", "storage", "payslips"),
    ].filter(Boolean)
  ),
];

function findStoredFile(storedName) {
  for (const dir of DIRS) {
    const p = path.join(dir, storedName);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------- Copie haute fidélité d'une feuille (même logique que le site) ----------
function copySheetInto(outWb, srcWb, ws) {
  const outWs = outWb.addWorksheet(ws.name || "Feuille", {
    properties: ws.properties ? JSON.parse(JSON.stringify(ws.properties)) : undefined,
    pageSetup: ws.pageSetup ? JSON.parse(JSON.stringify(ws.pageSetup)) : undefined,
    views: ws.views ? JSON.parse(JSON.stringify(ws.views)) : undefined,
  });
  try {
    if (ws.columns && ws.columns.length) {
      outWs.columns = ws.columns.map((c) => ({
        width: c.width,
        hidden: c.hidden,
        style: c.style ? JSON.parse(JSON.stringify(c.style)) : undefined,
      }));
    }
  } catch {}
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = outWs.getRow(rowNumber);
    try {
      if (row.height !== undefined) newRow.height = row.height;
      newRow.hidden = row.hidden;
    } catch {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      try {
        if (cell.style && Object.keys(cell.style).length) {
          newCell.style = JSON.parse(JSON.stringify(cell.style));
        }
      } catch {}
    });
  });
  try {
    const merges = ws.model && ws.model.merges;
    if (Array.isArray(merges)) {
      for (const m of merges) {
        try { outWs.mergeCells(m); } catch {}
      }
    }
  } catch {}
  try {
    const images = ws.getImages();
    const media = (srcWb.model && srcWb.model.media) || [];
    for (const img of images) {
      const m = media[img.imageId];
      if (!m || (!m.buffer && !m.base64)) continue;
      const ext = (m.extension || "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
      const newId = outWb.addImage({
        buffer: m.buffer,
        base64: m.base64,
        extension: ext,
      });
      outWs.addImage(newId, img.range);
    }
  } catch {}
  return outWs;
}

/** Texte de CHAQUE feuille (SheetJS, comme le site — xlsx en dépendance du site). */
function sheetTextsOf(buffer) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const names = [];
  const texts = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    names.push(name);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: "\t", blankrows: false });
    texts.push((csv || "").replace(/\r/g, ""));
  }
  return { names, texts };
}

/** Extrait les feuilles [start..end] (1-based inclusives) dans un classeur autonome. */
async function extractSheetRange(buffer, startSheet, endSheet) {
  const src = new ExcelJS.Workbook();
  await src.xlsx.load(buffer);
  const sheets = src.worksheets;
  if (!sheets.length) return null;
  const from = Math.max(0, startSheet - 1);
  const to = Math.min(sheets.length, endSheet) - 1;
  if (from > to || from >= sheets.length) return null;
  const out = new ExcelJS.Workbook();
  out.creator = "Auto-RH";
  out.lastModifiedBy = "Auto-RH";
  for (let i = from; i <= to; i++) copySheetInto(out, src, sheets[i]);
  if (!out.worksheets.length) return null;
  return Buffer.from(await out.xlsx.writeBuffer());
}

// ---------- Programme principal ----------
(async () => {
  console.log("\n============================================================");
  console.log(
    VERIFIER
      ? "  Auto-RH — VÉRIFICATION des classeurs Excel multi-fiches (Task 24)"
      : "  Auto-RH — SCINDAGE des classeurs Excel multi-fiches (Task 24)"
  );
  console.log("============================================================");
  console.log("Dossiers examinés :");
  for (const d of DIRS) console.log("  - " + d);

  const all = await db.payslip.findMany({
    select: {
      id: true,
      fileName: true,
      storedName: true,
      fileSize: true,
      sourcePage: true,
      cin: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "asc" },
  });

  // Groupement par storedName (classeurs Excel uniquement)
  const byStored = new Map();
  for (const r of all) {
    const ext = String(r.storedName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!ext || !["xlsx", "xlsm", "xls"].includes(ext[1])) continue;
    if (!byStored.has(r.storedName)) byStored.set(r.storedName, []);
    byStored.get(r.storedName).push(r);
  }
  const shared = [...byStored.entries()].filter(([, v]) => v.length > 1);

  console.log(
    `\n${all.length} fiche(s) analysée(s) — ${shared.length} classeur(s) Excel partagé(s) par plusieurs fiches.`
  );
  if (shared.length === 0) {
    console.log("Rien à scinder : chaque fiche possède déjà son propre fichier. ✔");
    await db.$disconnect();
    return;
  }

  let fichiersOK = 0;
  let fichesMisesAJour = 0;
  let fichiersErreurs = 0;
  const originauxDir = path.join(DIRS[0] || path.join(ROOT, "storage", "payslips"), "_originaux");

  for (const [storedName, recs] of shared) {
    console.log(`\n--- Classeur partagé : ${storedName}`);
    console.log(`    ${recs.length} fiche(s) : ${recs.map((r) => r.cin || "?").join(", ")}`);

    const withCin = recs.filter((r) => r.cin);
    if (withCin.length < 2) {
      console.log("    ⚠ IGNORÉ : moins de 2 fiches avec un CIN (structure atypique).");
      fichiersErreurs++;
      continue;
    }

    const filePath = findStoredFile(storedName);
    if (!filePath) {
      console.log("    ⚠ IGNORÉ : fichier introuvable sur le disque (dossiers examinés ci-dessus).");
      fichiersErreurs++;
      continue;
    }

    let xlsBuf;
    try {
      xlsBuf = decryptBuf(fs.readFileSync(filePath));
    } catch (e) {
      console.log("    ⚠ IGNORÉ : déchiffrement impossible (" + e.message + ").");
      console.log("      → Vérifiez AUTO_RH_STORAGE_KEY dans le .env (Task 21).");
      fichiersErreurs++;
      continue;
    }

    // Texte de chaque feuille (SheetJS) + nombre de feuilles (ExcelJS)
    let names, texts, nbSheets;
    try {
      ({ names, texts } = sheetTextsOf(xlsBuf));
      const probe = new ExcelJS.Workbook();
      // (l'ordre ExcelJS = ordre physique ; on vérifie la cohérence SheetJS)
      nbSheets = null;
      await probe.xlsx.load(xlsBuf).then((w) => {
        nbSheets = w.worksheets.length;
      });
    } catch (e) {
      console.log("    ⚠ IGNORÉ : classeur illisible par le découpeur (" + e.message + ").");
      fichiersErreurs++;
      continue;
    }
    if (nbSheets !== names.length) {
      console.log(`    ⚠ IGNORÉ : structure de feuilles atypique (ExcelJS=${nbSheets}, SheetJS=${names.length}).`);
      fichiersErreurs++;
      continue;
    }
    console.log(`    ${nbSheets} feuille(s) : ${names.join(" | ")}`);

    // Localisation du CIN de chaque fiche dans les feuilles
    // (tri par sourcePage pour refléter l'ordre d'import historique)
    const sorted = [...withCin].sort(
      (a, b) => (a.sourcePage ?? 1e9) - (b.sourcePage ?? 1e9)
    );
    const firstSheets = [];
    let locateFail = false;
    for (const r of sorted) {
      const cin = String(r.cin).toUpperCase();
      let found = -1;
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].toUpperCase().includes(cin)) { found = i + 1; break; }
      }
      if (found === -1 && r.sourcePage >= 1 && r.sourcePage <= nbSheets) {
        found = r.sourcePage; // repli : la feuille d'origine déclarée
      }
      if (found === -1) {
        console.log(`    ⚠ IGNORÉ : CIN ${cin} introuvable dans les feuilles du classeur.`);
        locateFail = true;
        break;
      }
      firstSheets.push(found);
    }
    if (locateFail) { fichiersErreurs++; continue; }

    // Plusieurs CIN dans la MÊME feuille = « 1 bulletin par ligne » :
    // impossible de couper par feuille sans emporter les autres salaires.
    if (new Set(firstSheets).size !== firstSheets.length) {
      console.log("    ⚠ IGNORÉ : plusieurs fiches dans la MÊME feuille (« 1 bulletin par ligne »).");
      console.log("      → Réimportez ce classeur après la mise à jour : le site génère");
      console.log("        automatiquement une fiche Excel ÉTIQUETÉE individuelle par employé.");
      fichiersErreurs++;
      continue;
    }
    const ordered = [...firstSheets].sort((a, b) => a - b);
    let orderBad = false;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i] <= ordered[i - 1]) { orderBad = true; break; }
    }
    if (orderBad) {
      console.log("    ⚠ IGNORÉ : ordre des feuilles incohérent (données atypiques).");
      fichiersErreurs++;
      continue;
    }

    console.log("    Plages : " + sorted
      .map((r, i) => {
        const s = firstSheets[i];
        const e = i + 1 < sorted.length ? firstSheets[i + 1] - 1 : nbSheets;
        return `${r.cin || "?"}=[feuilles ${s}-${e}]`;
      })
      .join(" "));

    if (VERIFIER) continue;

    // Scindage réel : tout d'abord en mémoire, PUIS écriture (all-or-nothing)
    const baseName = sorted[0].fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
    const splits = [];
    let ok = true;
    for (let i = 0; i < sorted.length; i++) {
      const start = firstSheets[i];
      const end = i + 1 < sorted.length ? firstSheets[i + 1] - 1 : nbSheets;
      try {
        const buf = await extractSheetRange(xlsBuf, start, end);
        if (!buf) { ok = false; break; }
        splits.push({ rec: sorted[i], start, end, buf });
      } catch (e) {
        console.log("    ⚠ Échec découpage feuilles " + start + "-" + end + " : " + e.message);
        ok = false;
        break;
      }
    }
    if (!ok || splits.length !== sorted.length) {
      console.log("    ⚠ IGNORÉ : découpage incomplet — AUCUNE modification effectuée (sécurité all-or-nothing).");
      fichiersErreurs++;
      continue;
    }

    // Écriture + mise à jour base
    const dirOfFile = path.dirname(filePath);
    let dbFail = false;
    for (const s of splits) {
      try {
        const newStored = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.xlsx`;
        fs.writeFileSync(path.join(dirOfFile, newStored), encryptBuf(s.buf));
        const display =
          s.start === s.end ? `feuille ${s.start}` : `feuilles ${s.start}-${s.end}`;
        await db.payslip.update({
          where: { id: s.rec.id },
          data: {
            storedName: newStored,
            fileSize: s.buf.length,
            pageNumber: s.end - s.start + 1,
            fileName: `${baseName} (${display}).xlsx`,
          },
        });
        fichesMisesAJour++;
        console.log(`    ✔ ${s.rec.cin || "?"} → ${newStored} (${s.buf.length} octets)`);
      } catch (e) {
        console.log("    ⚠ ERREUR mise à jour fiche " + (s.rec.cin || s.rec.id) + " : " + e.message);
        dbFail = true;
        break;
      }
    }
    if (dbFail) { fichiersErreurs++; continue; }

    // Original déplacé (réversible) dans _originaux/
    try {
      fs.mkdirSync(originauxDir, { recursive: true });
      const dest = path.join(originauxDir, storedName);
      fs.renameSync(filePath, dest);
      console.log(`    ✔ Original déplacé vers _originaux/${storedName}`);
    } catch (e) {
      console.log(`    (original conservé sur place — déplacement impossible : ${e.message})`);
    }
    fichiersOK++;
  }

  console.log("\n============================================================");
  console.log(`Classeurs scindés : ${fichiersOK} — fiches mises à jour : ${fichesMisesAJour} — ignorés/erreurs : ${fichiersErreurs}`);
  if (!VERIFIER && fichesMisesAJour > 0) {
    console.log("Les originaux sont conservés dans storage/payslips/_originaux/ (réversibilité).");
    console.log("Redémarrez le site et le portail pour prendre en compte les changements.");
  }
  console.log("============================================================\n");
  await db.$disconnect();
  process.exit(fichiersErreurs > 0 ? 2 : 0);
})().catch((e) => {
  console.error("ERREUR FATALE:", e);
  process.exit(1);
});
