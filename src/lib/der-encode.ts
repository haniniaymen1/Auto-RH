/**
 * ============================================================================
 *  NOUVEAU (Task 230) — OUTILS ASN.1 / DER EN PUR TYPESCRIPT (ZÉRO DÉPENDANCE)
 * ============================================================================
 *
 *  Encodage et décodage DER (X.690) au niveau élément TLV. Servent de base au
 *  moteur de signature CMS/PKCS#7 et au lecteur PKCS#12 SANS binaire openssl :
 *
 *    - lireTlv() : décode UN élément TLV (tag, longueur, contenu) ;
 *    - elements() : décode la LISTE des enfants d'un élément construit ;
 *    - derTlv() : encode un élément (tag + contenu → TLV complet) ;
 *    - constructeurs typés : SEQUENCE, SET, INTEGER, OID, OCTET STRING,
 *      UTCTime, NULL, tags contextuels ([0] implicite/explicite) ;
 *    - oidVersDer() / derVersOid() : encodage base-128 des OID.
 *
 *  AUCUNE dépendance externe, AUCUN import Node — module transpilable et
 *  testable de manière autonome (labo Task 230).
 * ============================================================================
 */

/** Classe universelle (0x00) / contextuelle (0x80) — bits 7-8 du tag.
 *  NB : tag & 0xC0 donne 0x80 pour la classe contextuelle (« 10 » en binaire),
 *  y compris pour les tags construits 0xA0+n. */
export const CLASSE_UNIVERSELLE = 0x00;
export const CLASSE_CONTEXTUELLE = 0x80;

/** Tags universels utilisés par CMS/PKCS#12. */
export const TAG_INTEGER = 0x02;
export const TAG_BIT_STRING = 0x03;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_UTF8 = 0x0c;
export const TAG_PRINTABLE = 0x13;
export const TAG_IA5 = 0x16;
export const TAG_UTC_TIME = 0x17;
export const TAG_GENERALIZED_TIME = 0x18;
export const TAG_SEQUENCE = 0x30;
export const TAG_SET = 0x31;

/** Un élément TLV décodé : tag brut, contenu, et l'ENCODAGE complet (corps). */
export interface Tlv {
  /** Octet de tag brut (classe + construit + numéro). */
  tag: number;
  /** Classe (0x00 universelle, 0x80 contextuelle…). */
  classe: number;
  /** Élément construit (contient des enfants) ? */
  construit: boolean;
  /** Numéro de tag sans les bits de classe/construction. */
  numero: number;
  /** Contenu (octets après l'en-tête de longueur). */
  contenu: Buffer;
  /** Encodage DER COMPLET (en-tête + contenu) — comparaisons brutes. */
  corps: Buffer;
}

/** Décode l'entier porté par un en-tête de longueur DER (max 4 octets). */
function lireLongueur(buf: Buffer, pos: number): { longueur: number; suivant: number } {
  const premier = buf[pos];
  if (premier < 0x80) return { longueur: premier, suivant: pos + 1 };
  const nb = premier & 0x7f;
  if (nb === 0 || nb > 4) throw new Error("Longueur DER non prise en charge (" + nb + " octets).");
  if (pos + 1 + nb > buf.length) throw new Error("Longueur DER tronquée.");
  let l = 0;
  for (let i = 0; i < nb; i++) l = l * 256 + buf[pos + 1 + i];
  return { longueur: l, suivant: pos + 1 + nb };
}

/**
 * Décode UN élément TLV à la position donnée. Lève si la structure est
 * tronquée (fichier corrompu) — jamais silencieusement.
 */
export function lireTlv(buf: Buffer, pos: number): { tlv: Tlv; suivant: number } {
  if (pos + 2 > buf.length) throw new Error("ASN.1 : élément tronqué (en-tête).");
  const tag = buf[pos];
  const { longueur, suivant } = lireLongueur(buf, pos + 1);
  if (suivant + longueur > buf.length) {
    throw new Error("ASN.1 : élément tronqué (contenu de " + longueur + " octets annoncé).");
  }
  const contenu = buf.subarray(suivant, suivant + longueur);
  return {
    tlv: {
      tag,
      classe: tag & 0xc0,
      construit: (tag & 0x20) !== 0,
      numero: tag & 0x1f,
      contenu,
      corps: buf.subarray(pos, suivant + longueur),
    },
    suivant: suivant + longueur,
  };
}

/** Décode la liste des enfants du CONTENU d'un élément construit. */
export function elements(contenu: Buffer): Tlv[] {
  const liste: Tlv[] = [];
  let pos = 0;
  while (pos < contenu.length) {
    const r = lireTlv(contenu, pos);
    liste.push(r.tlv);
    pos = r.suivant;
  }
  return liste;
}

/** Cherche un enfant par (classe, numéro) — undefined si absent. */
export function enfant(liste: Tlv[], classe: number, numero: number): Tlv | undefined {
  return liste.find((t) => t.classe === classe && t.numero === numero);
}

/* ------------------------------------------------------------------ */
/* Encodage                                                            */
/* ------------------------------------------------------------------ */

/** Encode un élément complet : tag + longueur DER + contenu. */
export function derTlv(tag: number, contenu: Buffer): Buffer {
  const l = contenu.length;
  if (l < 0x80) return Buffer.concat([Buffer.from([tag, l]), contenu]);
  const octets: number[] = [];
  let n = l;
  while (n > 0) {
    octets.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.concat([Buffer.from([tag, 0x80 | octets.length]), Buffer.from(octets), contenu]);
}

/** SEQUENCE (0x30) à partir d'enfants déjà encodés. */
export function derSequence(...enfants: Buffer[]): Buffer {
  return derTlv(TAG_SEQUENCE, Buffer.concat(enfants));
}

/** SET OF (0x31). Le tri DER (X.690 11.6) est À CHARGE DE L'APPELANT quand
 *  il importe (attributs signés, digestAlgorithms) — via trierSet(). */
export function derSet(...enfants: Buffer[]): Buffer {
  return derTlv(TAG_SET, Buffer.concat(enfants));
}

/** Encodage base-128 d'un OID pointillé (« 1.2.840.113549.1.7.2 »). */
export function oidVersDer(oid: string): Buffer {
  const parties = oid.split(".").map((p) => parseInt(p, 10));
  if (parties.length < 2 || isNaN(parties[0]) || isNaN(parties[1])) {
    throw new Error("OID invalide : " + oid);
  }
  const octets: number[] = [parties[0] * 40 + parties[1]];
  for (let i = 2; i < parties.length; i++) {
    let v = parties[i];
    const bloc: number[] = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      bloc.unshift(0x80 | (v & 0x7f));
      v >>= 7;
    }
    octets.push(...bloc);
  }
  return derTlv(TAG_OID, Buffer.from(octets));
}

/** Décode un OID DER en forme pointillée. */
export function derVersOid(tlv: Tlv): string {
  const b = tlv.contenu;
  if (!b.length) return "";
  const parties: number[] = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if ((b[i] & 0x80) === 0) {
      parties.push(v);
      v = 0;
    }
  }
  return parties.join(".");
}

/** INTEGER depuis un entier JS (petites valeurs : version, itérations…). */
export function derEntier(valeur: number): Buffer {
  if (valeur === 0) return derTlv(TAG_INTEGER, Buffer.from([0]));
  const octets: number[] = [];
  let n = valeur;
  while (n > 0) {
    octets.unshift(n & 0xff);
    n >>= 8;
  }
  if (octets[0] & 0x80) octets.unshift(0); // entier positif : bit de poids fort
  return derTlv(TAG_INTEGER, Buffer.from(octets));
}

/** OCTET STRING. */
export function derOctets(donnees: Buffer): Buffer {
  return derTlv(TAG_OCTET_STRING, donnees);
}

/** NULL. */
export function derNull(): Buffer {
  return derTlv(TAG_NULL, Buffer.alloc(0));
}

/** UTCTime ASN.1 (« AAMMJJhhmmssZ », années 1950-2049). */
export function derUtcTime(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, "0");
  const texte =
    p(date.getUTCFullYear() % 100) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    "Z";
  return derTlv(TAG_UTC_TIME, Buffer.from(texte, "latin1"));
}

/** Tag contextuel [n] IMPLICIT sur construit / EXPLICITE (0xA0+n). */
export function derCtx(numero: number, contenu: Buffer): Buffer {
  return derTlv(0xa0 | (numero & 0x1f), contenu);
}

/** Tag contextuel [n] IMPLICIT PRIMITIF (0x80+n). */
export function derCtxPrimitif(numero: number, contenu: Buffer): Buffer {
  return derTlv(0x80 | (numero & 0x1f), contenu);
}

/** AlgorithmIdentifier ::= SEQUENCE { type OID, paramètres ANY OPTIONAL }. */
export function derAlgo(oid: string, parametres?: Buffer): Buffer {
  return parametres === undefined
    ? derSequence(oidVersDer(oid))
    : derSequence(oidVersDer(oid), parametres);
}

/** Tri DER d'un SET OF : comparaison LEXICOGRAPHIQUE des encodages (X.690
 *  11.6) — obligatoire pour les attributs signés et digestAlgorithms. */
export function trierSet(encodages: Buffer[]): Buffer[] {
  return encodages.slice().sort((a, b) => Buffer.compare(a, b));
}

/** Lecture d'un INTEGER comme nombre JS (jusqu'à ~6 octets utiles). */
export function entierDepuisTlv(tlv: Tlv): number {
  let v = 0;
  for (const o of tlv.contenu) v = v * 256 + o;
  return v;
}

/** Contenu d'un élément lu comme texte latin1 (blocs PEM, chaînes…). */
export function texteDepuisTlv(tlv: Tlv): string {
  return tlv.contenu.toString("latin1");
}
