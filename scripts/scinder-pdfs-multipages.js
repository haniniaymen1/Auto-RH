#!/usr/bin/env node
/**
 * ============================================================
 *  Auto-RH — SCINDAGE des PDF multi-fiches EXISTANTS (Task 23)
 * ============================================================
 *
 *  Les fiches importées AVANT le découpage automatique partagent un
 *  MÊME fichier PDF (plusieurs enregistrements -> un seul fichier) :
 *  en consultant « sa » fiche, un employé recevait donc le document
 *  COMPLET (fiches des autres incluses).
 *
 *  Ce script :
 *   1. repère les fichiers PDF référencés par PLUSIEURS fiches ;
 *   2. déchiffre le fichier (AES-256-GCM, format PAIESAGE1) ;
 *   3. DÉCOUPE le PDF en fiches individuelles (une par enregistrement,
 *      plages de pages déduites de sourcePage) via pdf-lib ;
 *   4. chiffre et écrit chaque fiche individuelle (nouveau storedName) ;
 *   5. met à jour chaque fiche (storedName, taille, pages, nom affiché
 *      « original (page N).pdf ») ;
 *   6. déplace l'original dans storage/payslips/_originaux/ (réversible :
 *      aucune donnée n'est supprimée).
 *
 *  Réversible : les originaux sont conservés dans _originaux/, les
 *  enregistrements modifiés sont listés dans la console.
 *
 *  Usage :
 *    node scripts/scinder-pdfs-multipages.js              -> SCINDER
 *    node scripts/scinder-pdfs-multipages.js --verifier   -> état seulement
 * ============================================================
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");
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

// ---------- Découpage d'une plage de pages ----------
async function extractRange(buffer, startPage, endPage) {
  const src = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pageCount = src.getPageCount();
  const from = Math.max(0, startPage - 1);
  const to = Math.min(pageCount, endPage) - 1;
  if (from > to || from >= pageCount) return null;
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    Array.from({ length: to - from + 1 }, (_, i) => from + i)
  );
  for (const p of copied) out.addPage(p);
  out.setTitle(`Fiche de paie — pages ${from + 1} à ${to + 1}`);
  out.setProducer("Auto-RH");
  out.setCreator("Auto-RH");
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

// ---------- Programme principal ----------
(async () => {
  console.log("\n============================================================");
  console.log(
    VERIFIER
      ? "  Auto-RH — VÉRIFICATION des PDF multi-fiches (Task 23)"
      : "  Auto-RH — SCINDAGE des PDF multi-fiches (Task 23)"
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

  // Groupement par storedName (PDF uniquement)
  const byStored = new Map();
  for (const r of all) {
    if (!String(r.storedName || "").toLowerCase().endsWith(".pdf")) continue;
    if (!byStored.has(r.storedName)) byStored.set(r.storedName, []);
    byStored.get(r.storedName).push(r);
  }
  const shared = [...byStored.entries()].filter(([, v]) => v.length > 1);

  console.log(
    `\n${all.length} fiche(s) analysée(s) — ${shared.length} fichier(s) PDF partagé(s) par plusieurs fiches.`
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
    console.log(`\n--- Fichier partagé : ${storedName}`);
    console.log(`    ${recs.length} fiche(s) : ${recs.map((r) => r.cin || "?").join(", ")}`);

    // Les fiches doivent avoir des sourcePage exploitables (triées, uniques)
    const sorted = [...recs].sort((a, b) => (a.sourcePage ?? 1e9) - (b.sourcePage ?? 1e9));
    const pages = sorted.map((r) => r.sourcePage);
    if (pages.some((p) => p == null || p < 1)) {
      console.log("    ⚠ IGNORÉ : une fiche n'a pas de page d'origine (sourcePage).");
      fichiersErreurs++;
      continue;
    }
    if (new Set(pages).size !== pages.length) {
      console.log("    ⚠ IGNORÉ : pages d'origine en doublon (données atypiques).");
      fichiersErreurs++;
      continue;
    }

    const filePath = findStoredFile(storedName);
    if (!filePath) {
      console.log("    ⚠ IGNORÉ : fichier introuvable sur le disque (dossiers examinés ci-dessus).");
      fichiersErreurs++;
      continue;
    }

    let pdfBuf;
    try {
      pdfBuf = decryptBuf(fs.readFileSync(filePath));
    } catch (e) {
      console.log("    ⚠ IGNORÉ : déchiffrement impossible (" + e.message + ").");
      console.log("      → Vérifiez AUTO_RH_STORAGE_KEY dans le .env (Task 21).");
      fichiersErreurs++;
      continue;
    }

    let nbPages = 0;
    try {
      const doc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true, updateMetadata: false });
      nbPages = doc.getPageCount();
    } catch (e) {
      console.log("    ⚠ IGNORÉ : PDF illisible par le découpeur (" + e.message + ").");
      fichiersErreurs++;
      continue;
    }
    console.log(`    ${nbPages} page(s) dans le PDF — plages : ` + sorted
      .map((r, i) => {
        const s = i === 0 ? 1 : r.sourcePage;
        const e = i + 1 < sorted.length ? sorted[i + 1].sourcePage - 1 : nbPages;
        return `${r.cin || "?"}=[${s}-${e}]`;
      })
      .join(" "));

    if (VERIFIER) continue;

    // Scindage réel : tout d'abord en mémoire, PUIS écriture (all-or-nothing)
    const baseName = sorted[0].fileName.replace(/\.pdf$/i, "");
    const splits = [];
    let ok = true;
    for (let i = 0; i < sorted.length; i++) {
      const start = i === 0 ? 1 : sorted[i].sourcePage;
      const end = i + 1 < sorted.length ? sorted[i + 1].sourcePage - 1 : nbPages;
      try {
        const buf = await extractRange(pdfBuf, start, end);
        if (!buf) { ok = false; break; }
        splits.push({ rec: sorted[i], start, end, buf });
      } catch (e) {
        console.log("    ⚠ Échec découpage pages " + start + "-" + end + " : " + e.message);
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
        const newStored = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
        fs.writeFileSync(path.join(dirOfFile, newStored), encryptBuf(s.buf));
        const displayPage =
          s.start === s.end ? `page ${s.start}` : `pages ${s.start}-${s.end}`;
        await db.payslip.update({
          where: { id: s.rec.id },
          data: {
            storedName: newStored,
            fileSize: s.buf.length,
            pageNumber: s.end - s.start + 1,
            fileName: `${baseName} (${displayPage}).pdf`,
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
  console.log(`Fichiers scindés : ${fichiersOK} — fiches mises à jour : ${fichesMisesAJour} — ignorés/erreurs : ${fichiersErreurs}`);
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
