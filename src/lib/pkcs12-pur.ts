/**
 * ============================================================================
 *  NOUVEAU (Task 230) — LECTEUR PKCS#12/PFX ET CLÉS PRIVÉES EN PUR NODE
 * ============================================================================
 *
 *  Ouverture des coffres PKCS#12 (.p12/.pfx) SANS le binaire openssl :
 *
 *    - KDF PKCS#12 (RFC 7292 annexe B) — ID 1 (clé), 2 (IV), 3 (MAC) ;
 *    - MAC du coffre : distingue un mot de passe FAUX (mac refusé) d'un
 *      fichier illisible (leçon des Tasks 221/222 — ne JAMAIS blâmer le mot
 *      de passe sans preuve) ;
 *    - PBES1 : pbeWithSHAAnd3-KeyTripleDES-CBC, pbeWithSHAAnd(128/40)BitRC2 ;
 *    - PBES2 (défaut OpenSSL 3.x) : PBKDF2 (hmacWithSHA1/224/256/384/512)
 *      + AES-128/192/256-CBC, des-ede3-cbc, rc2-cbc ;
 *    - authSafe « data » ET « encryptedData » (certificats chiffrés) ;
 *    - mot de passe BMPString (UTF-16BE + 2 NUL, même vide) ou UTF-8.
 *
 *  Plus la lecture des CLÉS PRIVÉES PEM/DER (PKCS#1, PKCS#8 clair/chiffré,
 *  SEC1) via crypto.createPrivateKey — pour remplacer `openssl pkey` :
 *
 *    lireClePriveePur(octets, motDePasse) → { pemPkcs8, type, bits, protegee }
 *
 *  Compatibilité validée contre `openssl pkcs12` (labo Task 230).
 * ============================================================================
 */
import crypto from "crypto";
import {
  CLASSE_CONTEXTUELLE,
  TAG_INTEGER,
  TAG_OCTET_STRING,
  TAG_SEQUENCE,
  Tlv,
  elements,
  enfant,
  entierDepuisTlv,
  lireTlv,
  derVersOid,
} from "./der-encode";
import { ErreurCms } from "./cms-pur";

/* OIDs PKCS#12 / PKCS#5 */
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_ENCRYPTED_DATA = "1.2.840.113549.1.7.6";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_KEY_BAG = "1.2.840.113549.1.12.10.1.1";
const OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_X509_CERT_TYPE = "1.2.840.113549.1.9.22.1";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const OID_HMAC_SHA1 = "1.2.840.113549.2.7";
const OID_HMAC_SHA224 = "1.2.840.113549.2.8";
const OID_HMAC_SHA256 = "1.2.840.113549.2.9";
const OID_HMAC_SHA384 = "1.2.840.113549.2.10";
const OID_HMAC_SHA512 = "1.2.840.113549.2.11";
const OID_PBE_SHA1_3DES = "1.2.840.113549.1.12.1.3";
const OID_PBE_SHA1_2DES = "1.2.840.113549.1.12.1.4";
const OID_PBE_SHA1_RC2_128 = "1.2.840.113549.1.12.1.5";
const OID_PBE_SHA1_RC2_40 = "1.2.840.113549.1.12.1.6";
const OID_DES_EDE3_CBC = "1.2.840.113549.3.7";
const OID_RC2_CBC = "1.2.840.113549.3.2";
const OID_AES_128_CBC = "2.16.840.1.101.3.4.1.2";
const OID_AES_192_CBC = "2.16.840.1.101.3.4.1.22";
const OID_AES_256_CBC = "2.16.840.1.101.3.4.1.42";

export class ErreurPkcs12 extends ErreurCms {}

/* ------------------------------------------------------------------ */
/* KDF PKCS#12 (RFC 7292 B.2)                                          */
/* ------------------------------------------------------------------ */

/** Mot de passe encodé BMPString (UTF-16BE) + 2 octets NUL (RFC 7292 B.1).
 *  Le mot de passe VIDE vaut quand même 2 octets NUL (OpenSSL asc2uni
 *  ajoute le terminateur même pour une chaîne vide) — sinon les coffres
 *  « sans mot de passe » refusent leur MAC. */
function motDePasseBmp(motDePasse: string): Buffer {
  if (!motDePasse) return Buffer.from([0, 0]);
  const octets = Buffer.from(motDePasse, "utf16le").swap16(); // UTF-16BE
  return Buffer.concat([octets, Buffer.from([0, 0])]);
}

/** Répète `sel` jusqu'à atteindre un multiple de v. */
function remplirAuMultiple(donnees: Buffer, v: number): Buffer {
  if (!donnees.length) return Buffer.alloc(0);
  const blocs = Math.ceil(donnees.length / v) || 1;
  const sortie = Buffer.alloc(blocs * v);
  for (let i = 0; i < sortie.length; i++) sortie[i] = donnees[i % donnees.length];
  return sortie;
}

/**
 * Dérivation PKCS#12 : id 1 = clé de chiffrement, 2 = IV, 3 = clé MAC.
 * hashAlgo : « sha1 » (historique) ou « sha256 »… (MAC modernes).
 */
export function kdfPkcs12(
  motDePasse: string,
  sel: Buffer,
  id: number,
  longueur: number,
  hashAlgo: string,
  iterations: number
): Buffer {
  const v = 64; // taille de bloc des condensés SHA-1/SHA-2
  const D = Buffer.alloc(v, id);
  const mdp = motDePasseBmp(motDePasse);
  const S = remplirAuMultiple(sel, v);
  const P = remplirAuMultiple(mdp, v);
  let I = Buffer.concat([S, P]);
  const sortie: Buffer[] = [];
  let produit = 0;
  while (produit < longueur) {
    let A = crypto.createHash(hashAlgo).update(Buffer.concat([D, I])).digest();
    for (let i = 1; i < iterations; i++) A = crypto.createHash(hashAlgo).update(A).digest();
    sortie.push(A);
    produit += A.length;
    // I ← blocs de v octets incrémentés de B = A complété à v octets (mod 2^(8v))
    if (produit < longueur) {
      const B = remplirAuMultiple(A, v).subarray(0, v);
      for (let i = 0; i < I.length; i += v) {
        const bloc = I.subarray(i, i + v);
        let retenue = 1;
        for (let j = v - 1; j >= 0; j--) {
          const x = bloc[j] + B[j] + retenue;
          bloc[j] = x & 0xff;
          retenue = x > 0xff ? 1 : 0;
        }
      }
    }
  }
  return Buffer.concat(sortie).subarray(0, longueur);
}

/* ------------------------------------------------------------------ */
/* Déchiffrement PBE                                                   */
/* ------------------------------------------------------------------ */

/** PBES1 : pbeWithSHAAnd3-KeyTripleDES-CBC / RC2 (KDF PKCS#12 direct). */
function dechiffrerPbes1(
  oid: string,
  parametres: Tlv[],
  chiffre: Buffer,
  motDePasse: string
): Buffer {
  const p = parametres;
  if (p.length < 2) throw new ErreurPkcs12("Paramètres PBES1 illisibles.");
  const sel = p[0].contenu;
  const iterations = Math.max(1, entierDepuisTlv(p[1]));
  // PBES1 : le KDF PKCS#12 exige l'encodage BMPString (RFC 7292 B.1).
  if (oid === OID_PBE_SHA1_3DES || oid === OID_PBE_SHA1_2DES) {
    const cle = kdfPkcs12(motDePasse, sel, 1, 24, "sha1", iterations);
    const iv = kdfPkcs12(motDePasse, sel, 2, 8, "sha1", iterations);
    const d = crypto.createDecipheriv("des-ede3-cbc", cle, iv);
    return Buffer.concat([d.update(chiffre), d.final()]);
  }
  if (oid === OID_PBE_SHA1_RC2_128 || oid === OID_PBE_SHA1_RC2_40) {
    const bits = oid === OID_PBE_SHA1_RC2_40 ? 40 : 128;
    const cle = kdfPkcs12(motDePasse, sel, 1, Math.ceil(bits / 8) || 5, "sha1", iterations);
    const iv = kdfPkcs12(motDePasse, sel, 2, 8, "sha1", iterations);
    try {
      const d = crypto.createDecipheriv("rc2-cbc", cle, iv);
      return Buffer.concat([d.update(chiffre), d.final()]);
    } catch {
      throw new ErreurPkcs12(
        "Le coffre utilise RC2 (chiffrement historique) que ce serveur ne peut pas déchiffrer : réexportez le .p12 avec 3DES ou AES."
      );
    }
  }
  throw new ErreurPkcs12("Algorithme PBES1 non pris en charge (« " + oid + " »).");
}

const PRF: Record<string, string> = {
  [OID_HMAC_SHA1]: "sha1",
  [OID_HMAC_SHA224]: "sha224",
  [OID_HMAC_SHA256]: "sha256",
  [OID_HMAC_SHA384]: "sha384",
  [OID_HMAC_SHA512]: "sha512",
};

/* OIDs de CONDENSÉS simples — le DigestInfo du macData d'OpenSSL porte
 * « sha256 » (2.16.840.1.101.3.4.2.1), pas « hmacWithSHA256 ». */
const OID_SHA1 = "1.3.14.3.2.26";
const OID_SHA224 = "2.16.840.1.101.3.4.2.4";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SHA384 = "2.16.840.1.101.3.4.2.2";
const OID_SHA512 = "2.16.840.1.101.3.4.2.3";

/** Table MAC : HMAC-OIDs ET OIDs de condensés simples. */
const MAC_PRF: Record<string, string> = {
  ...PRF,
  [OID_SHA1]: "sha1",
  [OID_SHA224]: "sha224",
  [OID_SHA256]: "sha256",
  [OID_SHA384]: "sha384",
  [OID_SHA512]: "sha512",
};

const CHIFFREMENTS: Record<string, { cle: number; iv: number; type: string }> = {
  [OID_AES_128_CBC]: { cle: 16, iv: 16, type: "aes-128-cbc" },
  [OID_AES_192_CBC]: { cle: 24, iv: 16, type: "aes-192-cbc" },
  [OID_AES_256_CBC]: { cle: 32, iv: 16, type: "aes-256-cbc" },
  [OID_DES_EDE3_CBC]: { cle: 24, iv: 8, type: "des-ede3-cbc" },
  [OID_RC2_CBC]: { cle: 16, iv: 8, type: "rc2-cbc" },
};

/** PBES2 : PBKDF2 (prf variable) + AES-CBC / 3DES / RC2 (défaut OpenSSL 3). */
function dechiffrerPbes2(
  parametres: Tlv[],
  chiffre: Buffer,
  motDePasse: string,
  motDePasseUtf8: string
): Buffer {
  // parameters ::= SEQUENCE { keyDerivationFunc, encryptionScheme }
  const kdf = elements(parametres[0].contenu);
  const schema = elements(parametres[1].contenu);
  if (kdf.length < 2 || schema.length < 2) throw new ErreurPkcs12("Paramètres PBES2 illisibles.");
  const oidKdf = derVersOid(kdf[0]);
  if (oidKdf !== OID_PBKDF2) {
    throw new ErreurPkcs12("Dérivation de clé non prise en charge (« " + oidKdf + " »).");
  }
  const pKdf = elements(kdf[1].contenu);
  if (pKdf.length < 2) throw new ErreurPkcs12("Paramètres PBKDF2 illisibles.");
  const sel = pKdf[0].contenu;
  const iterations = Math.max(1, entierDepuisTlv(pKdf[1]));
  // Champs OPTIONNELS à distinguer PAR TYPE (OpenSSL omet keyLength quand il
  // égale la longueur de clé du chiffrement) : INTEGER = keyLength, SEQUENCE
  // = prf (hmacWithSHA1/224/256/384/512).
  let longueurCle = 0;
  let prf = "sha1"; // RFC 8018 : hmacWithSHA1 par défaut
  for (const champ of pKdf.slice(2)) {
    if (champ.tag === TAG_INTEGER) longueurCle = entierDepuisTlv(champ);
    else if (champ.tag === TAG_SEQUENCE) {
      const algosPrf = elements(champ.contenu);
      if (algosPrf.length) prf = PRF[derVersOid(algosPrf[0])] || "sha1";
    }
  }
  const oidChiffrement = derVersOid(schema[0]);
  const spec = CHIFFREMENTS[oidChiffrement];
  if (!spec) {
    throw new ErreurPkcs12("Chiffrement PBES2 non pris en charge (« " + oidChiffrement + " »).");
  }
  if (!longueurCle || longueurCle <= 0) longueurCle = spec.cle;
  const iv = schema[1].contenu;

  // PBES2 dans PKCS#12 : OpenSSL passe le mot de passe UTF-8 à PBKDF2 —
  // repli BMPString pour les producteurs qui l'encodent.
  const essais = [
    { mdp: motDePasseUtf8, codec: "UTF-8" },
    { mdp: motDePasse, codec: "BMPString" },
  ];
  let derniere: unknown = null;
  for (const essai of essais) {
    try {
      const cle = crypto.pbkdf2Sync(essai.mdp, sel, iterations, longueurCle, prf);
      const d = crypto.createDecipheriv(spec.type, cle, iv);
      return Buffer.concat([d.update(chiffre), d.final()]);
    } catch (e) {
      derniere = e;
    }
  }
  if (
    derniere instanceof Error &&
    /unsupported|unknown cipher|invalid \(key|iv\) length|invalid key|invalid iv/i.test(derniere.message) &&
    spec.type === "rc2-cbc"
  ) {
    throw new ErreurPkcs12(
      "Le coffre utilise RC2 (chiffrement historique) que ce serveur ne peut pas déchiffrer : réexportez le .p12 avec AES-256 (« openssl pkcs12 -keypbe AES-256-CBC -certpbe AES-256-CBC »)."
    );
  }
  throw derniere instanceof Error ? derniere : new ErreurPkcs12("Déchiffrement PBES2 impossible.");
}

/** Déchiffre un EncryptedPrivateKeyInfo → PKCS#8 clair. */
function dechiffrerCleShroudee(
  tlv: Tlv,
  motDePasse: string,
  motDePasseUtf8: string
): Buffer {
  // bagValue [0] EXPLICIT → EncryptedPrivateKeyInfo ::= SEQUENCE {
  // algorithmIdentifier, encryptedData OCTET STRING } — déplier le [0].
  const epki = elements(tlv.contenu)[0];
  const champs = epki ? elements(epki.contenu) : [];
  if (champs.length < 2) throw new ErreurPkcs12("Clé chiffrée illisible (structure).");
  const algo = elements(champs[0].contenu);
  if (algo.length < 2) throw new ErreurPkcs12("Algorithme de chiffrement illisible.");
  const oid = derVersOid(algo[0]);
  const chiffre = champs[1].contenu;
  if (oid === OID_PBES2) {
    return dechiffrerPbes2(elements(algo[1].contenu), chiffre, motDePasse, motDePasseUtf8);
  }
  if ([OID_PBE_SHA1_3DES, OID_PBE_SHA1_2DES, OID_PBE_SHA1_RC2_128, OID_PBE_SHA1_RC2_40].includes(oid)) {
    return dechiffrerPbes1(oid, elements(algo[1].contenu), chiffre, motDePasse);
  }
  throw new ErreurPkcs12(
    "Chiffrement du coffre non pris en charge (« " + oid + " ») : réexportez le .p12 en PBES2/AES ou 3DES."
  );
}

/* ------------------------------------------------------------------ */
/* MAC du coffre                                                       */
/* ------------------------------------------------------------------ */

/**
 * Vérifie le MAC du coffre (macData — 3ᵉ champ PFX, SEQUENCE simple
 * conformément au RFC 7292 ; certains producteurs emploient [0] IMPLICIT).
 * true = mot de passe CORRECT ; false = REFUSÉ ; null = pas de macData.
 */
function verifierMacPfx(
  pfxChamps: Tlv[],
  authSafeDonnees: Buffer,
  motDePasse: string,
  motDePasseUtf8: string
): boolean | null {
  const candidat = pfxChamps[2];
  if (!candidat || (candidat.tag !== TAG_SEQUENCE && candidat.tag !== 0xa0)) return null;
  const macData = candidat;
  const champsMac = elements(macData.contenu);
  if (!champsMac.length) return null;
  // DigestInfo ::= SEQUENCE { digestAlgorithm, digest }
  const digestInfo = elements(champsMac[0].contenu);
  if (digestInfo.length < 2) return null;
  const algoMac = elements(digestInfo[0].contenu);
  if (!algoMac.length) return null;
  const prfMac = MAC_PRF[derVersOid(algoMac[0])] || "sha1";
  const macAttendu = digestInfo[1].contenu;
  let sel: Buffer = Buffer.alloc(0);
  let iterations = 1;
  if (champsMac.length >= 2) sel = Buffer.from(champsMac[1].contenu);
  if (champsMac.length >= 3) iterations = Math.max(1, entierDepuisTlv(champsMac[2]));
  const longueur =
    prfMac === "sha1" ? 20 : prfMac === "sha224" ? 28 : prfMac === "sha256" ? 32 : prfMac === "sha384" ? 48 : 64;
  const essais = [
    { mdp: motDePasse, codec: "BMPString" },
    { mdp: motDePasseUtf8, codec: "UTF-8" },
  ];
  for (const essai of essais) {
    const cle = kdfPkcs12(essai.mdp, sel, 3, longueur, prfMac, iterations);
    const calcule = crypto.createHmac(prfMac, cle).update(authSafeDonnees).digest();
    if (calcule.length === macAttendu.length && crypto.timingSafeEqual(calcule, macAttendu)) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Ouverture du coffre                                                 */
/* ------------------------------------------------------------------ */

export interface CoffrePur {
  /** Certificats X.509 DER — le SIGNATAIRE en premier. */
  certificats: Buffer[];
  /** Clé privée PKCS#8 DER (clair) — null si le coffre n'en contient pas. */
  clePkcs8: Buffer | null;
  /** true si le MAC a explicitement refusé le mot de passe. */
  motDePasseInvalide: boolean;
  /** true si un MAC était présent et vérifié. */
  macVerifie: boolean;
}

/** Décode UNE SafeContents (SEQUENCE OF SafeBag) et alimente le coffre. */
function lireSafeContents(donnees: Buffer, coffre: CoffrePur, motDePasse: string, motDePasseUtf8: string): void {
  for (const sac of elements(donnees)) {
    const champsSac = elements(sac.contenu);
    if (champsSac.length < 2) continue;
    const oidSac = derVersOid(champsSac[0]);
    const valeur = enfant(champsSac, CLASSE_CONTEXTUELLE, 0);
    if (!valeur) continue;
    if (oidSac === OID_CERT_BAG) {
      // bagValue [0] EXPLICIT → CertBag ::= SEQUENCE { certId OID, certValue
      // [0] EXPLICIT OCTET STRING } — le DER du certificat est le CONTENU
      // de l'octet string (deux dépliages [0]).
      const certBagTlv = elements(valeur.contenu)[0];
      const champsCert = certBagTlv ? elements(certBagTlv.contenu) : [];
      if (champsCert.length >= 2 && derVersOid(champsCert[0]) === OID_X509_CERT_TYPE) {
        const enveloppe = enfant(champsCert, CLASSE_CONTEXTUELLE, 0);
        if (enveloppe) {
          const interieur = elements(enveloppe.contenu);
          if (interieur.length && interieur[0].tag === TAG_OCTET_STRING) {
            coffre.certificats.push(Buffer.from(interieur[0].contenu) as Buffer);
          }
        }
      }
    } else if (oidSac === OID_KEY_BAG) {
      // PrivateKeyInfo (PKCS#8 clair) — [0] EXPLICIT → TLV SEQUENCE direct.
      const interieur = elements(valeur.contenu);
      if (interieur.length && interieur[0].tag === TAG_SEQUENCE) {
        coffre.clePkcs8 = Buffer.from(interieur[0].corps) as Buffer;
      }
    } else if (oidSac === OID_PKCS8_SHROUDED_KEY_BAG) {
      try {
        coffre.clePkcs8 = dechiffrerCleShroudee(valeur, motDePasse, motDePasseUtf8);
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (/non pris en charge|RC2|PBES1|PBES2|PBKDF2/i.test(msg)) throw e;
        // mot de passe/corruption : on continue (le MAC tranchera)
      }
    }
  }
}

/**
 * Décode l'AuthenticatedSafe (SEQUENCE OF ContentInfo — RFC 7292) :
 * chaque ContentInfo est soit « data » (SafeContents en clair), soit
 * « encryptedData » (SafeContents chiffrés — coffres -certpbe d'OpenSSL 3).
 */
function traiterAuthenticatedSafe(
  donnees: Buffer,
  coffre: CoffrePur,
  motDePasse: string,
  motDePasseUtf8: string
): void {
  // RFC 7292 : le contenu du data est le DER de l'AuthenticatedSafe
  // (SEQUENCE OF ContentInfo). Tolérance : ContentInfo directement concaténés
  // (sans la SEQUENCE enveloppe) chez certains producteurs.
  const premiere = elements(donnees);
  let liste: Tlv[];
  if (premiere.length === 1 && premiere[0].tag === TAG_SEQUENCE && premiere[0].construit) {
    liste = elements(premiere[0].contenu);
  } else {
    liste = premiere;
  }
  for (const info of liste) {
    const champsInfo = elements(info.contenu);
    if (champsInfo.length < 2) continue;
    const oidInfo = derVersOid(champsInfo[0]);
    const enveloppe = enfant(champsInfo, CLASSE_CONTEXTUELLE, 0);
    if (!enveloppe) continue;
    const premier = elements(enveloppe.contenu)[0];
    if (!premier) continue;
    if (oidInfo === OID_DATA && premier.tag === TAG_OCTET_STRING) {
      // [0] EXPLICIT → OCTET STRING → SafeContents (SEQUENCE OF SafeBag)
      const interieur = elements(premier.contenu)[0];
      if (interieur && interieur.tag === TAG_SEQUENCE) {
        lireSafeContents(interieur.contenu, coffre, motDePasse, motDePasseUtf8);
      }
    } else if (oidInfo === OID_ENCRYPTED_DATA) {
      // EncryptedData ::= SEQUENCE { version, EncryptedContentInfo }
      const champsEnc = elements(premier.contenu);
      if (champsEnc.length < 2) continue;
      const eci = elements(champsEnc[1].contenu);
      if (eci.length < 3) continue;
      const algo = elements(eci[1].contenu);
      if (algo.length < 2) continue;
      const oid = derVersOid(algo[0]);
      const chiffre = eci[2].contenu; // [0] IMPLICIT OCTET STRING
      try {
        const clair =
          oid === OID_PBES2
            ? dechiffrerPbes2(elements(algo[1].contenu), chiffre, motDePasse, motDePasseUtf8)
            : dechiffrerPbes1(oid, elements(algo[1].contenu), chiffre, motDePasse);
        const sc = elements(clair)[0];
        if (sc && sc.tag === TAG_SEQUENCE) {
          lireSafeContents(sc.contenu, coffre, motDePasse, motDePasseUtf8);
        }
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (/MOT_DE_PASSE_INCORRECT|non pris en charge|RC2/i.test(msg)) throw e;
        /* SafeContents chiffré illisible : les autres restent exploitables */
      }
    }
  }
}

/**
 * Ouvre un coffre PKCS#12/PFX SANS openssl. Lève ErreurPkcs12 avec un
 * message français classé (mot de passe incorrect SEULEMENT si le MAC
 * refuse — jamais sur une simple structure inattendue).
 */
export function ouvrirPkcs12Pur(octets: Buffer, motDePasse: string): CoffrePur {
  const coffre: CoffrePur = { certificats: [], clePkcs8: null, motDePasseInvalide: false, macVerifie: false };
  let racine: Tlv[];
  try {
    racine = elements(octets);
  } catch (e) {
    throw new ErreurPkcs12("Coffre PKCS#12 illisible : structure ASN.1 corrompue (" + String((e as Error).message || e) + ").");
  }
  if (!racine.length || racine[0].tag !== TAG_SEQUENCE) {
    throw new ErreurPkcs12("Coffre PKCS#12 illisible (SEQUENCE attendue).");
  }
  const pfxChamps = elements(racine[0].contenu);
  if (pfxChamps.length < 2) throw new ErreurPkcs12("Coffre PKCS#12 illisible (PFX incomplet).");
  const version = entierDepuisTlv(pfxChamps[0]);
  if (version !== 3) {
    throw new ErreurPkcs12("Coffre PKCS#12 de version non prise en charge (" + version + ") : version 3 attendue.");
  }
  // authSafe ContentInfo
  const authSafeInfo = elements(pfxChamps[1].contenu);
  if (authSafeInfo.length < 2) throw new ErreurPkcs12("Coffre PKCS#12 illisible (authSafe).");
  const oidAuthSafe = derVersOid(authSafeInfo[0]);
  const enveloppe = enfant(authSafeInfo, CLASSE_CONTEXTUELLE, 0);
  if (!enveloppe) throw new ErreurPkcs12("Coffre PKCS#12 illisible (contenu authSafe).");

  const motDePasseUtf8 = motDePasse;
  if (oidAuthSafe === OID_DATA) {
    // [0] EXPLICIT → OCTET STRING → AuthenticatedSafe (SEQUENCE OF ContentInfo)
    const interieur = elements(enveloppe.contenu);
    if (!interieur.length || interieur[0].tag !== TAG_OCTET_STRING) {
      throw new ErreurPkcs12("Coffre PKCS#12 illisible (données authSafe).");
    }
    const donnees = interieur[0].contenu;
    const verdictMac = verifierMacPfx(pfxChamps, Buffer.from(donnees), motDePasse, motDePasseUtf8);
    if (verdictMac === false) {
      coffre.motDePasseInvalide = true;
      throw new ErreurPkcs12("MOT_DE_PASSE_INCORRECT");
    }
    coffre.macVerifie = verdictMac === true;
    traiterAuthenticatedSafe(Buffer.from(donnees), coffre, motDePasse, motDePasseUtf8);
  } else if (oidAuthSafe === OID_ENCRYPTED_DATA) {
    // EncryptedData ::= SEQUENCE { version, EncryptedContentInfo }
    const interieur = elements(enveloppe.contenu);
    if (!interieur.length) throw new ErreurPkcs12("Coffre PKCS#12 illisible (EncryptedData).");
    const champsEnc = elements(interieur[0].contenu);
    if (champsEnc.length < 2) throw new ErreurPkcs12("Coffre PKCS#12 illisible (EncryptedContentInfo).");
    const eci = elements(champsEnc[1].contenu);
    if (eci.length < 3) throw new ErreurPkcs12("Coffre PKCS#12 illisible (EncryptedContentInfo).");
    const algo = elements(eci[1].contenu);
    if (algo.length < 2) throw new ErreurPkcs12("Coffre PKCS#12 illisible (algorithme authSafe).");
    const oid = derVersOid(algo[0]);
    const chiffre = eci[2].contenu;
    const clair =
      oid === OID_PBES2
        ? dechiffrerPbes2(elements(algo[1].contenu), chiffre, motDePasse, motDePasseUtf8)
        : dechiffrerPbes1(oid, elements(algo[1].contenu), chiffre, motDePasse);
    const verdictMac = verifierMacPfx(pfxChamps, Buffer.from(chiffre), motDePasse, motDePasseUtf8);
    if (verdictMac === false) {
      coffre.motDePasseInvalide = true;
      throw new ErreurPkcs12("MOT_DE_PASSE_INCORRECT");
    }
    coffre.macVerifie = verdictMac === true;
    traiterAuthenticatedSafe(clair, coffre, motDePasse, motDePasseUtf8);
  } else {
    throw new ErreurPkcs12("Coffre PKCS#12 illisible (type authSafe « " + oidAuthSafe + " »).");
  }
  return coffre;
}

/**
 * Sélection DÉTERMINISTE du certificat signataire : celui dont la clé
 * publique correspond à la clé privée du coffre (SPKI) ; sinon le premier.
 * Renvoie { feuille, chaine } en DER.
 */
export function choisirFeuille(
  certificats: Buffer[],
  clePkcs8: Buffer | null
): { feuille: Buffer; chaine: Buffer[] } {
  if (!certificats.length) return { feuille: Buffer.alloc(0), chaine: [] };
  if (clePkcs8) {
    try {
      const cle = crypto.createPrivateKey({ key: clePkcs8, format: "der", type: "pkcs8" });
      const spkiCle = crypto.createPublicKey(cle).export({ type: "spki", format: "der" }) as Buffer;
      for (const c of certificats) {
        try {
          const cert = new crypto.X509Certificate(c);
          const spkiCert = cert.publicKey.export({ type: "spki", format: "der" }) as Buffer;
          if (Buffer.compare(spkiCle, spkiCert) === 0) {
            return {
              feuille: c,
              chaine: certificats.filter((x) => Buffer.compare(x, c) !== 0),
            };
          }
        } catch {
          /* certificat illisible : ignoré */
        }
      }
    } catch {
      /* clé illisible : repli premier certificat */
    }
  }
  return { feuille: certificats[0], chaine: certificats.slice(1) };
}

/* ------------------------------------------------------------------ */
/* Clés privées PEM/DER (remplace `openssl pkey`)                      */
/* ------------------------------------------------------------------ */

export interface ClePriveePur {
  /** Clé privée DÉCHIFFRÉE en PEM PKCS#8 (usage éphémère uniquement). */
  pemPkcs8: string;
  /** « RSA 2048 bits », « EC (prime256v1) », « Ed25519 »… */
  type: string;
  bits: number | null;
  /** Le fichier était-il chiffré ? */
  protegee: boolean;
  keyObject: crypto.KeyObject;
}

const RE_BLOC_PEM = /-----BEGIN ([A-Z0-9 ]+)-----(?:[\s\S]*?)-----END \1-----/g;

function decrireCleNode(cle: crypto.KeyObject): { type: string; bits: number | null } {
  const details = cle.asymmetricKeyDetails as
    | { modulusLength?: number; namedCurve?: string }
    | undefined;
  switch (cle.asymmetricKeyType) {
    case "rsa":
    case "rsa-pss": {
      const bits = details?.modulusLength ?? null;
      return { type: bits ? "RSA " + bits + " bits" : "RSA", bits };
    }
    case "ec":
      return { type: details?.namedCurve ? "EC (" + details.namedCurve + ")" : "EC", bits: null };
    case "ed25519":
      return { type: "Ed25519", bits: null };
    case "ed448":
      return { type: "Ed448", bits: null };
    case "x25519":
      return { type: "X25519", bits: null };
    default:
      return { type: String(cle.asymmetricKeyType || "clé asymétrique"), bits: null };
  }
}

/**
 * Lit une clé privée PEM (PKCS#1 « RSA PRIVATE KEY », PKCS#8 « PRIVATE KEY »,
 * PKCS#8 chiffré « ENCRYPTED PRIVATE KEY », clé historique chiffrée avec
 * en-tête DEK-Info) ou DER (PKCS#8/PKCS#1/SEC1). Remplace `openssl pkey`.
 * Lève ErreurPkcs12 avec messages français classés.
 */
export function lireClePriveePur(
  octets: Buffer,
  motDePasse: string
): ClePriveePur {
  if (!octets || octets.length < 16) {
    throw new ErreurPkcs12("Fichier de clé privée vide ou trop court.");
  }
  const texte = octets.subarray(0, 4096).toString("latin1");
  const chiffreSuspect = /ENCRYPTED PRIVATE KEY|Proc-Type: 4,ENCRYPTED/.test(texte);
  const essais: Array<{ source: { key: Buffer; format: "pem" | "der"; type?: "pkcs1" | "pkcs8" | "sec1" }; protegee: boolean }> = [];

  if (texte.includes("-----BEGIN")) {
    RE_BLOC_PEM.lastIndex = 0;
    const types = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = RE_BLOC_PEM.exec(octets.toString("utf8")))) types.add(m[1]);
    const estCle = [...types].some((t) => /PRIVATE KEY$/.test(t));
    if (!estCle) {
      throw new ErreurPkcs12(
        "Fichier de clé privée illisible : aucun bloc « PRIVATE KEY », « RSA PRIVATE KEY », « EC PRIVATE KEY » ou « ENCRYPTED PRIVATE KEY » reconnu."
      );
    }
    // Fichier COMBINÉ (certificat + clé) : isoler le premier bloc de clé
    // privée pour que Node n'essaie pas de lire le certificat d'abord.
    let sourcePem = octets;
    if (types.size > 1) {
      const texteComplet = octets.toString("utf8");
      const bloc = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/.exec(texteComplet);
      if (bloc) sourcePem = Buffer.from(bloc[0], "utf8");
    }
    const protegee =
      types.has("ENCRYPTED PRIVATE KEY") || /Proc-Type: 4,ENCRYPTED/.test(sourcePem.toString("latin1"));
    essais.push({ source: { key: sourcePem, format: "pem" }, protegee });
  } else {
    // DER : PKCS#8 le plus courant ; PKCS#1/SEC1 en repli (Node détecte seul)
    essais.push({ source: { key: octets, format: "der", type: "pkcs8" }, protegee: false });
    essais.push({ source: { key: octets, format: "der" }, protegee: false });
  }

  for (const essai of essais) {
    try {
      const cle = crypto.createPrivateKey({ ...essai.source, passphrase: motDePasse || undefined });
      const pemPkcs8 = cle.export({ type: "pkcs8", format: "pem" }).toString();
      const desc = decrireCleNode(cle);
      return { pemPkcs8, type: desc.type, bits: desc.bits, protegee: essai.protegee || chiffreSuspect, keyObject: cle };
    } catch (e) {
      const msg = String((e as Error).message || e);
      if (essai === essais[essais.length - 1]) {
        if (/bad decrypt|bad password|MAC|unable to read|decoding|passphrase/i.test(msg) && (motDePasse || chiffreSuspect)) {
          throw new ErreurPkcs12(
            motDePasse
              ? "Mot de passe de la clé privée incorrect : la clé n'a pas pu être déverrouillée."
              : "Clé privée protégée : saisissez le mot de passe de la clé privée."
          );
        }
        throw new ErreurPkcs12(
          "Clé privée illisible : le fichier de clé fourni n'est pas une clé PEM/DER valide (PKCS#8, PKCS#1 ou SEC1 attendu). Détail : " +
            msg.slice(0, 200)
        );
      }
      /* essai suivant */
    }
  }
  throw new ErreurPkcs12("Clé privée illisible : structure PEM/DER non reconnue.");
}

/* ------------------------------------------------------------------ */
/* PKCS#7 : extraction des certificats (.p7b/.p7c/.p7s sans openssl)   */
/* ------------------------------------------------------------------ */

/** Extrait les certificats X.509 DER d'un PKCS#7/CMS DER (champ [0] certs). */
export function certificatsPkcs7Der(octets: Buffer): Buffer[] {
  const sortie: Buffer[] = [];
  try {
    const racine = elements(octets);
    if (!racine.length || racine[0].tag !== TAG_SEQUENCE) return sortie;
    const champs = elements(racine[0].contenu);
    if (champs.length < 2) return sortie;
    const enveloppe = enfant(champs, CLASSE_CONTEXTUELLE, 0);
    if (!enveloppe) return sortie;
    // [0] EXPLICIT → TLV SignedData complet
    const sdTlv = elements(enveloppe.contenu)[0];
    if (!sdTlv || sdTlv.tag !== TAG_SEQUENCE) return sortie;
    const champCerts = enfant(elements(sdTlv.contenu), CLASSE_CONTEXTUELLE, 0);
    if (!champCerts) return sortie;
    let pos = 0;
    while (pos < champCerts.contenu.length) {
      const r = lireTlv(champCerts.contenu, pos);
      if (r.tlv.tag === TAG_SEQUENCE) sortie.push(Buffer.from(r.tlv.corps));
      pos = r.suivant;
    }
  } catch {
    /* illisible : liste vide */
  }
  return sortie;
}
