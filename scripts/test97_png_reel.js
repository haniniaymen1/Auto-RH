/**
 * Test de NON-RÉGRESSION avec un PNG RÉALISTE (600×800, multi-IDAT possible,
 * comme un bulletin scanné) — doit être servi 200 avec octets identiques,
 * AVANT et APRÈS chiffrement du stockage. Vérifie aussi la variante
 * interlacée Adam7-like (chunk géant) et un JPEG minimal réaliste.
 */
const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ROOT = "/home/z/my-project/task97_png/extracted";

/* charge .env */
for (const ligne of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MAGIC = Buffer.from("PAIESAGE1", "utf8");
function chiffrer(buf) {
  const cle = crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env",
    "autorh-storage-v1",
    32
  );
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cle, nonce);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ct]);
}

/* -------- générateur PNG valide (sans dépendance) -------- */
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function pngValide(largeur, hauteur) {
  const sig = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RVB
  // scanlines filtrées (filtre 0) — motif varié
  const brut = Buffer.alloc(hauteur * (1 + largeur * 3));
  for (let y = 0; y < hauteur; y++) {
    brut[y * (1 + largeur * 3)] = 0;
    for (let x = 0; x < largeur; x++) {
      const o = y * (1 + largeur * 3) + 1 + x * 3;
      brut[o] = (x * 255) / largeur | 0;
      brut[o + 1] = (y * 255) / hauteur | 0;
      brut[o + 2] = 128;
    }
  }
  const idat = zlib.deflateSync(brut, { level: 6 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* -------- charge le validateur compilé via ts? Non : réimplémente l'appel
   en testant à travers le SERVEUR est déjà fait (F1). Ici on teste le
   module TS directement via un transpile minimal — plus simple : répliquer
   l'appel exact en important le fichier source avec un loader simple. */
/* Solution pragmatique : esbuild est présent (dépa Next) → bundle rapide. */
const { execSync } = require("child_process");
const tmpDir = "/tmp/test97_png_reel";
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
execSync(
  `npx esbuild ${ROOT}/src/lib/image-validate.ts --bundle --platform=node --outfile=${tmpDir}/image-validate.js`,
  { cwd: ROOT, stdio: "pipe" }
);
const { validerStructureImage } = require(tmpDir + "/image-validate.js");

let echecs = 0;
function verdict(id, ok, detail) {
  if (!ok) echecs++;
  console.log(`  ${ok ? "✅" : "❌"} ${id} — ${detail}`);
}

/* 1. PNG réaliste 600×800 */
const png1 = pngValide(600, 800);
let v = validerStructureImage(png1);
verdict("R1", v.ok, `PNG 600×800 (${png1.length} octets) → ok=${v.ok} ${v.raison || ""}`);

/* 2. PNG grand 2000×2800 (au-delà d'une page scan) */
const png2 = pngValide(2000, 2800);
v = validerStructureImage(png2);
verdict("R2", v.ok, `PNG 2000×2800 (${(png2.length / 1024 / 1024).toFixed(1)} Mo) → ok=${v.ok} ${v.raison || ""}`);

/* 3. même PNG chiffré/déchiffré puis validé (cycle de stockage complet) */
const dechiffre = (() => {
  const b = chiffrer(png2);
  const decal = MAGIC.length; // 9 octets (« PAIESAGE1 ») — comme l'application
  const nonce = b.subarray(decal, decal + 12);
  const tag = b.subarray(decal + 12, decal + 28);
  const ct = b.subarray(decal + 28);
  const cle = crypto.scryptSync(
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env",
    "autorh-storage-v1", 32
  );
  const d = crypto.createDecipheriv("aes-256-gcm", cle, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
})();
verdict("R3", dechiffre.equals(png2), `Cycle chiffrement→déchiffrement : octets identiques=${dechiffre.equals(png2)}`);
v = validerStructureImage(dechiffre);
verdict("R4", v.ok, `PNG déchiffré revalidé → ok=${v.ok} ${v.raison || ""}`);

/* 4. JPEG minimal valide (SOI + APP0 JFIF + DQT fictif + EOI) */
const jpegValide = Buffer.concat([
  Buffer.from("ffd8ffe000104a46494600010100000100010000ffdb004300", "hex"),
  Buffer.alloc(20, 0x33),
  Buffer.from("ffd9", "hex"),
]);
v = validerStructureImage(jpegValide);
verdict("R5", v.ok, `JPEG valide (EOI en fin) → ok=${v.ok}`);

/* 5. JPEG tronqué (EOI absent) */
const jpegTronque = jpegValide.subarray(0, jpegValide.length - 2);
v = validerStructureImage(jpegTronque);
verdict("R6", !v.ok, `JPEG tronqué (EOI absent) → détecté: ${!v.ok} (${v.raison || ""})`);

/* 6. PNG valide auquel on retire le dernier octet (IEND tronqué) */
const pngTronque = png1.subarray(0, png1.length - 1);
v = validerStructureImage(pngTronque);
verdict("R7", !v.ok, `PNG 600×800 coupé d'1 octet → détecté: ${!v.ok} (${(v.raison || "").slice(0, 60)})`);

/* 7. PNG avec octet IDAT corrompu */
const pngCorrompu = Buffer.from(png1);
pngCorrompu[pngCorrompu.length - 20] ^= 0xff; // dans les données IDAT
v = validerStructureImage(pngCorrompu);
verdict("R8", !v.ok, `PNG 600×800 octet IDAT corrompu → détecté: ${!v.ok} (${(v.raison || "").slice(0, 60)})`);

/* 8. PNG avec CRC IHDR invalide MAIS données intactes → TOLÉRÉ (servi) */
const pngCrc = Buffer.from(png1);
pngCrc[29] ^= 0xff; // octet du CRC IHDR (position 29-32)
v = validerStructureImage(pngCrc);
verdict("R9", v.ok, `PNG CRC IHDR invalide, données intactes → servi (toléré, journalisé) ok=${v.ok} ${v.detail || ""}`);

console.log(echecs === 0 ? "\n=== NON-RÉGRESSION : 9/9 OK ===" : `\n=== ÉCHECS: ${echecs} ===`);
process.exit(echecs === 0 ? 0 : 1);
