#!/usr/bin/env node
/**
 * ============================================================
 *  Auto-RH — CHIFFRAGE / DÉCHIFFRAGE du dossier des fiches
 *  ET des documents des demandes
 *  (Task 21 — outil de migration, réversible ; MODIFIÉ v0.2.49 :
 *   couvre AUSSI storage/documents-demandes — mêmes règles que
 *   les fiches, à la demande de l'exploitation)
 *  (MODIFIÉ v0.2.59 : couvre AUSSI storage/tampons — les copies de
 *   contrôle des images de tampon importées (cachet/signature et QR
 *   fourni) sont désormais CHIFFRÉES comme les fiches, à la demande
 *   « storage/tampons illisible comme storage/payslips ». Les copies
 *   créées par la v0.2.59+ le sont déjà à l'écriture ; cet outil
 *   chiffre les copies plus anciennes restées en clair.)
 * ============================================================
 *
 *  Chiffre (AES-256-GCM, en-tête PAIESAGE1) tous les fichiers du
 *  dossier storage/payslips ET du dossier storage/documents-demandes
 *  ET du dossier storage/tampons
 *  (y compris les anciens emplacements .next/standalone/storage/…).
 *  Les fichiers DÉJÀ chiffrés sont détectés et ignorés (jamais
 *  double-chiffrés).
 *
 *  CLÉ : si .env ne contient ni AUTO_RH_STORAGE_KEY ni AUTH_SECRET,
 *  une clé ALÉATOIRE de 256 bits est générée et AJOUTÉE au .env
 *  (ligne additive — rien n'est modifié ni supprimé).
 *  ⚠ SANS LE .env, LES FICHIERS CHIFFRÉS SONT IRRÉCUPÉRABLES :
 *    SAUVEGARDEZ LE FICHIER .env !
 *
 *  Usage :
 *    node scripts/chiffrer-storage.js              -> CHIFFRER
 *    node scripts/chiffrer-storage.js --verifier   -> état seulement
 *    node scripts/chiffrer-storage.js --dechiffrer -> retour arrière
 * ============================================================
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const MODE = process.argv[2] || "--chiffrer";

// ---------- Chargement du .env (identique au portail) ----------
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

// ---------- Clé : génération additive si absente ----------
function ensureKey() {
  if (process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET) return;
  const key = crypto.randomBytes(32).toString("hex");
  const envPath = path.join(ROOT, ".env");
  fs.appendFileSync(
    envPath,
    "\n# Clé de chiffrement du dossier des fiches (Task 21) — NE PAS PERDRE\nAUTO_RH_STORAGE_KEY=" + key + "\n"
  );
  process.env.AUTO_RH_STORAGE_KEY = key;
  console.log("  [CLE] Nouvelle clé AUTO_RH_STORAGE_KEY générée et ajoutée au .env");
  console.log("  [CLE] ⚠ SAUVEGARDEZ le fichier .env : sans lui, les fiches chiffrées");
  console.log("        sont irrécupérables !");
}

// ---------- Constantes IDENTIQUES à storage-crypto.ts / portail-server.js ----------
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SALT = "autorh-storage-v1";
const key = () => crypto.scryptSync(process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env", SALT, 32);
const isEnc = (b) => b.length > MAGIC.length && b.subarray(0, MAGIC.length).equals(MAGIC);

function transformBuf(buf) {
  if (MODE === "--dechiffrer") {
    if (!isEnc(buf)) return { buf, changed: false };
    const n = buf.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
    const t = buf.subarray(MAGIC.length + NONCE_LEN, MAGIC.length + NONCE_LEN + TAG_LEN);
    const c = buf.subarray(MAGIC.length + NONCE_LEN + TAG_LEN);
    const d = crypto.createDecipheriv("aes-256-gcm", key(), n);
    d.setAuthTag(t);
    return { buf: Buffer.concat([d.update(c), d.final()]), changed: true };
  }
  // chiffrer (idempotent)
  if (isEnc(buf)) return { buf, changed: false };
  const nonce = crypto.randomBytes(NONCE_LEN);
  const c = crypto.createCipheriv("aes-256-gcm", key(), nonce);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return { buf: Buffer.concat([MAGIC, nonce, c.getAuthTag(), enc]), changed: true };
}

// ---------- Dossiers candidats (même logique que le site/portail) ----------
function rootFromDatabaseUrl() {
  const m = String(process.env.DATABASE_URL || "").match(/^file:(.+)[/\\]db[/\\][^/\\]+\.db\/?$/i);
  if (!m) return null;
  try { return path.resolve(m[1]); } catch { return null; }
}
const DB_ROOT = rootFromDatabaseUrl();
// (MODIFIÉ v0.2.49) les candidats FICHES sont construits comme avant ; les
// candidats DOCUMENTS sont le voisin « documents-demandes » de chaque
// candidat fiches — exactement la règle du portail
// (dossierEcritureDocumentsDemandes) et de l'administration
// (documentsDemandesReadCandidates de src/lib/storage-dir.ts).
const DIRS_FICHES = [...new Set(
  [
    process.env.STORAGE_DIR,
    process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR,
    path.join(ROOT, "storage", "payslips"),
    path.join(process.cwd(), "storage", "payslips"),
    DB_ROOT ? path.join(DB_ROOT, "storage", "payslips") : null,
    path.join(ROOT, ".next", "standalone", "storage", "payslips"),
    path.join(process.cwd(), ".next", "standalone", "storage", "payslips"),
  ].filter(Boolean)
)];
const DIRS_DOCUMENTS = [...new Set(
  DIRS_FICHES.map((d) => path.join(path.dirname(d), "documents-demandes"))
)];
// (NOUVEAU v0.2.59) les copies de contrôle des TAMPONS importés sont le
// voisin « tampons » de chaque candidat fiches — exactement la règle du
// dossier canonique getTamponsDir() de src/lib/storage-dir.ts.
const DIRS_TAMPONS = [...new Set(
  DIRS_FICHES.map((d) => path.join(path.dirname(d), "tampons"))
)];
const GROUPES = [
  ["fiches de paie (storage/payslips)", DIRS_FICHES],
  ["documents des demandes (storage/documents-demandes)", DIRS_DOCUMENTS],
  ["copies des tampons importés (storage/tampons)", DIRS_TAMPONS],
];

// ---------- Exécution ----------
const action = MODE === "--dechiffrer" ? "DÉCHIFFREMENT" : MODE === "--verifier" ? "VÉRIFICATION" : "CHIFFREMENT";
console.log("\n============================================================");
console.log("  Auto-RH — " + action + " des fiches, des documents");
console.log("  des demandes ET des tampons (AES-256-GCM)");
console.log("============================================================");

if (MODE !== "--verifier") ensureKey();

let total = 0, changed = 0, already = 0, errors = 0;
for (const [libelle, groupe] of GROUPES) {
  let present = false;
  for (const dir of groupe) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()); } catch { continue; }
    if (files.length === 0) continue;
    present = true;
    console.log("\n[" + libelle + "]");
    console.log("Dossier : " + dir + "  (" + files.length + " fichier(s))");
    for (const f of files) {
      total++;
      const p = path.join(dir, f);
      try {
        const raw = fs.readFileSync(p);
        const { buf, changed: ch } = transformBuf(raw);
        if (MODE === "--verifier") {
          if (isEnc(raw)) already++; else { changed++; }
          continue;
        }
        if (!ch) { already++; continue; }
        const tmp = p + ".tmp-enc";
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, p);
        changed++;
        if (changed % 25 === 0) console.log("  ... " + changed + " fichier(s) " + (MODE === "--dechiffrer" ? "déchiffré(s)" : "chiffré(s)"));
      } catch (e) {
        errors++;
        console.error("  [ERREUR] " + f + " : " + e.message);
        try { fs.unlinkSync(p + ".tmp-enc"); } catch {}
      }
    }
  }
  if (!present) console.log("\n[" + libelle + "]  aucun fichier (dossiers absents ou vides)");
}

console.log("\n------------------------------------------------------------");
console.log("  Fichiers examinés : " + total);
if (MODE === "--verifier") {
  console.log("  Chiffrés (en-tête PAIESAGE1) : " + already);
  console.log("  En clair (historiques)       : " + changed);
} else {
  console.log("  " + (MODE === "--dechiffrer" ? "Déchiffrés" : "Chiffrés") + " lors de cette exécution : " + changed);
  console.log("  Déjà dans l'état demandé (ignorés) : " + already);
}
console.log("  Erreurs : " + errors);
if (MODE === "--chiffrer" && changed > 0) {
  console.log("\n  ⚠ CONSEIL IMPORTANT : sauvegardez le fichier .env (clé secrète).");
  console.log("    Sans ce fichier, les fiches chiffrées ne peuvent plus être lues.");
}
console.log("============================================================\n");

// Contrôle final : un échantillon se relit correctement dans l'autre sens ?
if (MODE !== "--verifier" && changed > 0 && errors === 0) {
  try {
    for (const [, groupe] of GROUPES) {
      for (const dir of groupe) {
        const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
        if (!files.length) continue;
        const raw = fs.readFileSync(path.join(dir, files[0]));
        const n = MAGIC.length + NONCE_LEN + TAG_LEN;
        const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(MAGIC.length, MAGIC.length + NONCE_LEN));
        d.setAuthTag(raw.subarray(MAGIC.length + NONCE_LEN, n));
        const clear = Buffer.concat([d.update(raw.subarray(n)), d.final()]);
        console.log(
          "  [CONTROLE] Échantillon " + files[0] + " : déchiffrement OK (" +
          clear.length + " octets en clair, en-tête « " + clear.subarray(0, 4).toString("latin1") + " »)"
        );
        throw new Error("stop"); // sortie des deux boucles après 1er échantillon
      }
    }
  } catch (e) {
    if (e && e.message !== "stop") console.error("  [CONTROLE] ÉCHEC de relecture : " + e.message);
  }
}
process.exit(errors ? 1 : 0);
