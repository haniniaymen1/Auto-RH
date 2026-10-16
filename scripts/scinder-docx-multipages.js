#!/usr/bin/env node
/**
 * ============================================================
 *  Auto-RH — SCINDAGE des documents WORD multi-fiches EXISTANTS
 *  (Task 25 — miroir de scinder-pdfs-multipages.js / Task 23)
 * ============================================================
 *
 *  Les fiches importées AVANT la mise à jour « découpage auto »
 *  partagent un MÊME document Word : en consultant « sa » fiche,
 *  un employé recevait le document COMPLET (fiches des autres
 *  incluses).
 *
 *  Ce script :
 *   1. repère les documents .docx référencés par PLUSIEURS fiches ;
 *   2. déchiffre le fichier (AES-256-GCM, format PAIESAGE1) ;
 *   3. découpe le document en « pages » (sauts de page explicites,
 *      sauts de section, marqueurs de rendu Word, repli « début de
 *      CIN » — même logique que le découpage à l'import) ;
 *   4. localise le CIN de CHAQUE fiche dans les pages (CIN connu en
 *      base, aucune ré-détection) — plages [page_i .. page_{i+1}-1] ;
 *   5. extrait chaque plage dans un .docx AUTONOME (archive originale
 *      recopiée, seul word/document.xml est réécrit : styles, polices,
 *      tableaux, images et mise en page conservés) ;
 *   6. chiffre et écrit chaque fiche individuelle (nouveau storedName) ;
 *   7. met à jour chaque fiche (storedName, taille, pages, nom affiché
 *      « original (page N).docx ») ;
 *   8. déplace l'original dans storage/payslips/_originaux/ (réversible :
 *      aucune donnée n'est supprimée).
 *
 *  SÉCURITÉ all-or-nothing : si UN SEUL CIN est introuvable ou si une
 *  plage est impossible, le fichier est IGNORÉ sans aucune modification.
 *
 *  Usage :
 *    node scripts/scinder-docx-multipages.js              -> SCINDER
 *    node scripts/scinder-docx-multipages.js --verifier   -> état seulement
 * ============================================================
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
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

// ============================================================
// Découpage DOCX en pages (port JS du module docx-splitter.ts)
// ============================================================
const DOC_XML_PATH = "word/document.xml";
const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
const PARA_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
const PARA_SEG_RE =
  /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/?>/g;
const EXPLICIT_PAGE_BREAK_RE = /<w:br\b[^>]*type\s*=\s*["']page["']/;
const RENDERED_BREAK_RE = /<w:lastRenderedPageBreak\b/;
const SECT_PR_RE = /<w:sectPr[\s>]/;
const CIN_CANDIDATE_GLOBAL_RE =
  /(?:^|[^\dA-Za-z])(\d{8}|[A-Z]{1,2}\d{5,8})(?:[^\dA-Za-z]|$)/g;

function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function topLevelElements(bodyXml) {
  const out = [];
  const re = new RegExp(TAG_RE.source, "g");
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(bodyXml)) !== null) {
    const full = m[0];
    const closing = m[1] === "/";
    const selfClose = m[4] === "/";
    if (closing) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(bodyXml.slice(start, m.index + full.length));
        start = -1;
      }
      if (depth < 0) return null;
    } else if (!selfClose) {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  if (depth !== 0) return null;
  return out;
}

function elementLines(xml) {
  const lines = [];
  const re = new RegExp(PARA_RE.source, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1] || "";
    let text = "";
    const segRe = new RegExp(PARA_SEG_RE.source, "g");
    let seg;
    while ((seg = segRe.exec(inner)) !== null) {
      if (seg[1] !== undefined) text += decodeXmlEntities(seg[1]);
      else if (seg[0].startsWith("<w:tab")) text += "\t";
      else text += " ";
    }
    lines.push(text.trim());
  }
  return lines;
}

function classifyElement(xml) {
  const isParagraph = /^<w:p[\s/>]/.test(xml);
  return {
    xml,
    lines: elementLines(xml),
    isParagraph,
    hasExplicitPageBreak: EXPLICIT_PAGE_BREAK_RE.test(xml),
    hasRenderedBreak: RENDERED_BREAK_RE.test(xml),
    hasSectionBreak: isParagraph && SECT_PR_RE.test(xml),
    hasCinCandidate:
      isParagraph &&
      elementLines(xml).some((l) =>
        /(?:^|[^\dA-Za-z])(\d{8}|[A-Z]{1,2}\d{5,8})(?:[^\dA-Za-z]|$)/.test(l)
      ),
  };
}

function groupElementsIntoPages(elements) {
  const hasExplicit = elements.some(
    (e) => e.hasExplicitPageBreak || e.hasSectionBreak
  );
  const hasRendered = !hasExplicit && elements.some((e) => e.hasRenderedBreak);
  const groups = [];
  let current = [];
  const close = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  };
  if (hasExplicit) {
    for (const el of elements) {
      current.push(el);
      if (el.hasExplicitPageBreak || el.hasSectionBreak) close();
    }
    close();
  } else if (hasRendered) {
    for (const el of elements) {
      if (el.hasRenderedBreak && current.length > 0) close();
      current.push(el);
    }
    close();
  } else {
    for (const el of elements) {
      if (el.hasCinCandidate && current.length > 0) close();
      current.push(el);
    }
    close();
  }
  const pages = groups.filter((g) =>
    g.some((el) => el.lines.some((l) => l.length > 0))
  );
  return pages.length >= 2 ? pages : null;
}

async function parseDocx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const docEntry = zip.file(DOC_XML_PATH);
  if (!docEntry) return null;
  let xml;
  try {
    xml = await docEntry.async("string");
  } catch {
    return null;
  }
  const bodyOpen = xml.indexOf("<w:body>");
  const bodyClose = xml.lastIndexOf("</w:body>");
  if (bodyOpen < 0 || bodyClose <= bodyOpen) return null;
  const prefix = xml.slice(0, bodyOpen + "<w:body>".length);
  const suffix = xml.slice(bodyClose);
  const bodyXml = xml.slice(bodyOpen + "<w:body>".length, bodyClose);
  const rawElements = topLevelElements(bodyXml);
  if (!rawElements || rawElements.length === 0) return null;
  const elements = rawElements.map(classifyElement);
  let finalSectPr = null;
  if (
    elements.length > 0 &&
    /^<w:sectPr[\s>]/.test(elements[elements.length - 1].xml)
  ) {
    finalSectPr = elements[elements.length - 1].xml;
    elements.pop();
  }
  return { zip, prefix, suffix, elements, finalSectPr };
}

async function getDocxPages(buffer) {
  try {
    const parsed = await parseDocx(buffer);
    if (!parsed) return null;
    const grouped = groupElementsIntoPages(parsed.elements);
    if (!grouped) return null;
    return { parsed, pages: grouped };
  } catch {
    return null;
  }
}

async function extractDocxRange(parsed, grouped, startPage, endPage) {
  const from = Math.max(1, startPage) - 1;
  const to = Math.min(grouped.length, endPage) - 1;
  if (from > to || from >= grouped.length) return null;
  const rangeElements = grouped.slice(from, to + 1);
  let bodyContent = rangeElements
    .map((els) => els.map((e) => e.xml).join(""))
    .join("");
  let sectPrToUse = parsed.finalSectPr;
  const lastEl = [...rangeElements[rangeElements.length - 1]].pop();
  if (lastEl && lastEl.isParagraph && SECT_PR_RE.test(lastEl.xml)) {
    const m = lastEl.xml.match(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/);
    if (m) {
      sectPrToUse = m[0];
      const idx = bodyContent.lastIndexOf(m[0]);
      if (idx >= 0) {
        bodyContent =
          bodyContent.slice(0, idx) + bodyContent.slice(idx + m[0].length);
      }
    }
  }
  const newXml =
    parsed.prefix + bodyContent + (sectPrToUse || "") + parsed.suffix;
  const out = new JSZip();
  for (const name of Object.keys(parsed.zip.files)) {
    if (name === DOC_XML_PATH) continue;
    const entry = parsed.zip.files[name];
    if (entry.dir) continue;
    const data = await entry.async("nodebuffer");
    out.file(name, data, { compression: "DEFLATE" });
  }
  out.file(DOC_XML_PATH, newXml, { compression: "DEFLATE" });
  const result = await out.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return result.length > 0 ? result : null;
}

// ---------- Localisation du CIN de chaque fiche dans les pages ----------
function normalizeCin(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[\s.\-\/]/g, "")
    .trim();
}

// ---------- Programme principal ----------
(async () => {
  console.log("\n============================================================");
  console.log(
    VERIFIER
      ? "  Auto-RH — VÉRIFICATION des documents Word multi-fiches (Task 25)"
      : "  Auto-RH — SCINDAGE des documents Word multi-fiches (Task 25)"
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

  // Groupement par storedName (documents Word uniquement)
  const byStored = new Map();
  for (const r of all) {
    if (!String(r.storedName || "").toLowerCase().endsWith(".docx")) continue;
    if (!byStored.has(r.storedName)) byStored.set(r.storedName, []);
    byStored.get(r.storedName).push(r);
  }
  const shared = [...byStored.entries()].filter(([, v]) => v.length > 1);

  console.log(
    `\n${all.length} fiche(s) analysée(s) — ${shared.length} document(s) Word partagé(s) par plusieurs fiches.`
  );
  if (shared.length === 0) {
    console.log("Rien à scinder : chaque fiche possède déjà son propre fichier. ✔");
    await db.$disconnect();
    return;
  }

  let fichiersOK = 0;
  let fichesMisesAJour = 0;
  let fichiersErreurs = 0;
  const originauxDir = path.join(
    DIRS[0] || path.join(ROOT, "storage", "payslips"),
    "_originaux"
  );

  for (const [storedName, recs] of shared) {
    console.log(`\n--- Document partagé : ${storedName}`);
    console.log(
      `    ${recs.length} fiche(s) : ${recs.map((r) => r.cin || "?").join(", ")}`
    );

    const filePath = findStoredFile(storedName);
    if (!filePath) {
      console.log("    ⚠ IGNORÉ : fichier introuvable sur le disque.");
      fichiersErreurs++;
      continue;
    }

    let docxBuf;
    try {
      docxBuf = decryptBuf(fs.readFileSync(filePath));
    } catch (e) {
      console.log("    ⚠ IGNORÉ : déchiffrement impossible (" + e.message + ").");
      console.log("      → Vérifiez AUTO_RH_STORAGE_KEY dans le .env (Task 21).");
      fichiersErreurs++;
      continue;
    }

    const parsed = await getDocxPages(docxBuf);
    if (!parsed) {
      console.log("    ⚠ IGNORÉ : document Word illisible par le découpeur.");
      fichiersErreurs++;
      continue;
    }
    const { parsed: p, pages: grouped } = parsed;
    const pageTexts = grouped.map((els) =>
      els
        .flatMap((e) => e.lines)
        .filter((l) => l.length > 0)
        .join("\n")
    );
    console.log(`    ${grouped.length} page(s) reconnue(s) dans le document.`);

    // Localisation du CIN de chaque fiche (CIN connu en base — aucune
    // ré-détection), tri des fiches par page trouvée.
    const located = [];
    let locateFail = false;
    for (const r of recs) {
      const cin = normalizeCin(r.cin);
      if (cin.length < 4) {
        locateFail = true;
        console.log(`    ⚠ CIN inexplotable pour la fiche ${r.id} (${r.cin || "?"}).`);
        break;
      }
      let pageIdx = -1;
      for (let i = 0; i < pageTexts.length; i++) {
        if (normalizeCin(pageTexts[i]).includes(cin)) {
          pageIdx = i + 1;
          break;
        }
      }
      if (pageIdx < 0) {
        locateFail = true;
        console.log(`    ⚠ CIN ${r.cin} introuvable dans les pages du document.`);
        break;
      }
      located.push({ rec: r, page: pageIdx });
    }
    if (locateFail) {
      console.log("    ⚠ IGNORÉ (sécurité all-or-nothing) — AUCUNE modification.");
      fichiersErreurs++;
      continue;
    }
    located.sort((a, b) => a.page - b.page || (a.rec.sourcePage ?? 0) - (b.rec.sourcePage ?? 0));
    if (new Set(located.map((l) => l.page)).size !== located.length) {
      console.log("    ⚠ IGNORÉ : deux fiches sur la même page (données atypiques).");
      fichiersErreurs++;
      continue;
    }

    // Plages [page_i .. page_{i+1}-1] — la 1re démarre à la page 1
    // (préambule rattaché à la première fiche, comme à l'import).
    const total = grouped.length;
    const ranges = located.map((l, i) => {
      const s = i === 0 ? 1 : l.page;
      const e = i + 1 < located.length ? located[i + 1].page - 1 : total;
      return { start: Math.min(s, l.page), end: Math.max(l.page, e) };
    });
    console.log(
      "    Plages : " +
        located
          .map(
            (l, i) => `${l.rec.cin || "?"}=[${ranges[i].start}-${ranges[i].end}]`
          )
          .join(" ")
    );

    if (VERIFIER) continue;

    // Scindage réel : tout d'abord en mémoire, PUIS écriture (all-or-nothing)
    const baseName = String(recs[0].fileName || "fiche").replace(/\.docx$/i, "");
    const splits = [];
    let ok = true;
    for (let i = 0; i < located.length; i++) {
      const { start, end } = ranges[i];
      try {
        const buf = await extractDocxRange(p, grouped, start, end);
        if (!buf) {
          ok = false;
          break;
        }
        splits.push({ rec: located[i].rec, start, end, buf });
      } catch (e) {
        console.log(
          "    ⚠ Échec extraction pages " + start + "-" + end + " : " + e.message
        );
        ok = false;
        break;
      }
    }
    if (!ok || splits.length !== located.length) {
      console.log(
        "    ⚠ IGNORÉ : découpage incomplet — AUCUNE modification effectuée (sécurité all-or-nothing)."
      );
      fichiersErreurs++;
      continue;
    }

    // Écriture + mise à jour base
    const dirOfFile = path.dirname(filePath);
    let dbFail = false;
    for (const s of splits) {
      try {
        const newStored = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.docx`;
        fs.writeFileSync(path.join(dirOfFile, newStored), encryptBuf(s.buf));
        const displayPage =
          s.start === s.end ? `page ${s.start}` : `pages ${s.start}-${s.end}`;
        await db.payslip.update({
          where: { id: s.rec.id },
          data: {
            storedName: newStored,
            fileSize: s.buf.length,
            pageNumber: s.end - s.start + 1,
            fileName: `${baseName} (${displayPage}).docx`,
          },
        });
        fichesMisesAJour++;
        console.log(
          `    ✔ ${s.rec.cin || "?"} → ${newStored} (${s.buf.length} octets)`
        );
      } catch (e) {
        console.log(
          "    ⚠ ERREUR mise à jour fiche " + (s.rec.cin || s.rec.id) + " : " + e.message
        );
        dbFail = true;
        break;
      }
    }
    if (dbFail) {
      fichiersErreurs++;
      continue;
    }

    // Original déplacé (réversible) dans _originaux/
    try {
      fs.mkdirSync(originauxDir, { recursive: true });
      const dest = path.join(originauxDir, storedName);
      fs.renameSync(filePath, dest);
      console.log(`    ✔ Original déplacé vers _originaux/${storedName}`);
    } catch (e) {
      console.log(
        `    (original conservé sur place — déplacement impossible : ${e.message})`
      );
    }
    fichiersOK++;
  }

  console.log("\n============================================================");
  console.log(
    `Documents scindés : ${fichiersOK} — fiches mises à jour : ${fichesMisesAJour} — ignorés/erreurs : ${fichiersErreurs}`
  );
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
