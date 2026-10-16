import crypto from "crypto";

/**
 * ============================================================
 *  AutoRH — Chiffrement AES-256-GCM du stockage des fiches
 *  (Task 21 — 100 % additif, aucun comportement antérieur retiré)
 * ============================================================
 *
 *  OBJECTIF : les fiches importées (storage/payslips/) ne sont
 *  plus lisibles « en clair » sur le disque. Chaque fichier est
 *  chiffré À L'ÉCRITURE (import) et déchiffré À LA VOLÉE à la
 *  lecture par les seuls points de service authentifiés
 *  (administration RH/IT + portail employé OTP).
 *
 *  FORMAT DU FICHIER CHIFFRÉ (auto-descriptif) :
 *    [PAIESAGE1]  8 octets  — en-tête magique
 *    [nonce]     12 octets  — IV aléatoire unique par fichier
 *    [tag]       16 octets  — tag d'authenticité GCM
 *    [ciphertext]           — le document (PDF/PNG/XLSX/DOCX…)
 *
 *  COMPATIBILITÉ HISTORIQUE : les fichiers anciens (non chiffrés,
 *  sans en-tête PAIESAGE1) restent lus tels quels — aucune fiche
 *  existante n'est cassée si le chiffrement est désactivé.
 *
 *  CLÉ : variable d'environnement AUTO_RH_STORAGE_KEY (générée
 *  automatiquement et ajoutée au .env par scripts/chiffrer-storage.js).
 *  Dérivation : scrypt(sel fixe « autorh-storage-v1 », 32 octets).
 *
 *  ⚠ SANS LE FICHIER .env (AUTO_RH_STORAGE_KEY), LES FICHES
 *    CHIFFRÉES SONT MATHÉMATIQUEMENT IRRÉCUPÉRABLES : sauvegardez .env !
 * ============================================================
 */

/** En-tête magique des fichiers chiffrés (8 octets, ASCII). */
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SALT = "autorh-storage-v1";

/** Matière secrète : AUTO_RH_STORAGE_KEY, sinon AUTH_SECRET, sinon défaut partagé. */
function keyMaterial(): string {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

/** Clé AES-256 dérivée (scrypt, sel fixe applicatif). */
function storageKey(): Buffer {
  return crypto.scryptSync(keyMaterial(), SALT, 32);
}

/**
 * Chiffrement ACTIF ? (repli historique possible avec
 * AUTO_RH_STORAGE_DISABLE=1 — les nouveaux imports restent alors
 * en clair, et les fichiers chiffrés restent déchiffrés à la lecture.)
 */
export function storageEncryptionEnabled(): boolean {
  return process.env.AUTO_RH_STORAGE_DISABLE !== "1";
}

/** Le buffer commence-t-il par l'en-tête d'un fichier chiffré ? */
export function isEncryptedBuffer(buf: Buffer): boolean {
  return buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/**
 * Chiffre un buffer pour le stockage disque. IDEMPOTENT : un buffer
 * déjà chiffré est renvoyé tel quel (jamais double-chiffré).
 * Si le chiffrement est désactivé (AUTO_RH_STORAGE_DISABLE=1),
 * le buffer est renvoyé tel quel (comportement historique conservé).
 */
export function encryptForStorage(buf: Buffer): Buffer {
  if (!storageEncryptionEnabled() || isEncryptedBuffer(buf)) return buf;
  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", storageKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, nonce, tag, ciphertext]);
}

/**
 * Déchiffre un buffer lu depuis le disque. Les fichiers historiques
 * (non chiffrés) sont renvoyés TELS QUELS — compatibilité totale.
 * Lève une erreur si le fichier est chiffré mais la clé est mauvaise
 * (tag GCM invalide) — ne JAMAIS servir du contenu altéré.
 */
export function decryptFromStorage(buf: Buffer): Buffer {
  if (!isEncryptedBuffer(buf)) return buf; // fichier historique en clair
  const nonceStart = MAGIC.length;
  const tagStart = nonceStart + NONCE_LEN;
  const dataStart = tagStart + TAG_LEN;
  const nonce = buf.subarray(nonceStart, tagStart);
  const tag = buf.subarray(tagStart, dataStart);
  const ciphertext = buf.subarray(dataStart);
  const decipher = crypto.createDecipheriv("aes-256-gcm", storageKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
