import zlib from "zlib";

/**
 * ============================================================
 *  AutoRH — Validation STRUCTURELLE des fiches image
 *  (Task 15bis-2 — « l'aperçu d'une fiche PNG affiche une
 *   image cassée » : cause restée muette malgré Task 15bis)
 * ============================================================
 *
 *  PROBLÈME : le correctif Task 15bis détecte le type par la
 *  SIGNATURE (4 premiers octets). Un fichier TRONQUÉ (import ou
 *  copie interrompu — signature PNG présente, données coupées)
 *  ou CORROMPU (octets de données abîmés) est donc servi en
 *  image/png : le navigateur ne peut pas le décoder et affiche
 *  une ICÔNE D'IMAGE CASSÉE sans AUCUN message.
 *
 *  SOLUTION : valider la structure COMPLÈTE avant de servir :
 *   PNG  — parcours des chunks (longueur + type + CRC) :
 *            . troncature détectée (chunk interrompu, IEND absent)
 *            . données d'image (IDAT) vérifiées par décompression
 *              zlib réelle (Adler-32) — un échec = image corrompue ;
 *            . en-tête IHDR contrôlé (dimensions et combinaisons
 *              profondeur/couleur valides) ;
 *            . un CRC de chunk invalide reste TOLÉRÉ (consigné au
 *              journal) : les navigateurs affichent quand même
 *              l'image si les données IDAT se décompressent —
 *              aucun comportement rendu antérieur n'est retiré.
 *   JPEG — le marqueur de fin EOI (FF D9) doit figurer en queue
 *              de fichier (tout encodeur l'écrit en dernier) ;
 *              son absence = fichier tronqué.
 *
 *  AUCUN FAUX POSITIF : une image valide (décompression IDAT OK,
 *  IEND/EOI présents) passe TOUJOURS — l'aperçu ne peut pas se
 *  dégrader pour des fiches qui s'affichaient déjà.
 * ============================================================
 */

export interface VerdictImage {
  ok: boolean;
  /** Message explicite en français quand ok === false. */
  raison?: string;
  /** Détails techniques pour le journal serveur. */
  detail?: string;
}

/** Profondeur de recherche du marqueur EOI JPEG en fin de fichier. */
const EOI_FENETRE = 32;
/** Au-delà de cette taille décompressée estimée, la vérification IDAT
 *  est sautée (fiches de paie réalistes : quelques Mo au maximum). */
const LIMITE_DECOMPRESSION = 256 * 1024 * 1024;

/* ----------------------------- CRC32 ----------------------------- */

let TABLE_CRC32: Uint32Array | null = null;

function tableCrc32(): Uint32Array {
  if (!TABLE_CRC32) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    TABLE_CRC32 = t;
  }
  return TABLE_CRC32;
}

function crc32(buf: Buffer): number {
  const t = tableCrc32();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------ PNG ------------------------------ */

/** Combinaisons valides profondeur de bits / type de couleur (spéc. PNG). */
const PNG_PROFONDEURS_VALIDES: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16], // niveaux de gris
  2: [8, 16], // RVB
  3: [1, 2, 4, 8], // palette
  4: [8, 16], // niveaux de gris + alpha
  6: [8, 16], // RVBA
};

function bitsParPixel(typeCouleur: number, profondeur: number): number {
  switch (typeCouleur) {
    case 0:
      return profondeur;
    case 2:
      return profondeur * 3;
    case 3:
      return profondeur;
    case 4:
      return profondeur * 2;
    case 6:
      return profondeur * 4;
    default:
      return 0;
  }
}

function validerPng(buf: Buffer): VerdictImage {
  // Signature complète (8 octets)
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return {
      ok: false,
      raison:
        "signature PNG incomplète (les 8 premiers octets ne forment pas une signature PNG complète)",
    };
  }

  let pos = 8;
  let ihdrVu = false;
  let iendVu = false;
  const idat: Buffer[] = [];
  let largeur = 0;
  let hauteur = 0;
  let typeCouleur = 0;
  let profondeur = 0;
  let crcDefaillants = 0;

  while (pos + 8 <= buf.length) {
    const longueur = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    if (longueur > 0x7fffffff || pos + 12 + longueur > buf.length) {
      return {
        ok: false,
        raison:
          "fichier tronqué : la dernière section d'image (" +
          (type.trim() || "inconnue") +
          ") est interrompue en plein milieu (import ou copie interrompu, téléchargement incomplet)",
        detail: "chunk " + type.trim() + " attendu=" + longueur + " restant=" + (buf.length - pos - 8),
      };
    }
    const crcStocke = buf.readUInt32BE(pos + 8 + longueur);
    const crcCalcule = crc32(buf.subarray(pos + 4, pos + 8 + longueur));
    if (crcStocke !== crcCalcule) {
      // TOLÉRÉ : les navigateurs affichent l'image si les données se
      // décompressent ; consigné pour le diagnostic IT.
      crcDefaillants++;
    }

    if (!ihdrVu) {
      if (type !== "IHDR") {
        return {
          ok: false,
          raison:
            "image corrompue : la section d'en-tête IHDR attendue en premier est absente",
        };
      }
      if (longueur !== 13) {
        return { ok: false, raison: "image corrompue : en-tête IHDR de taille invalide" };
      }
      largeur = buf.readUInt32BE(pos + 8);
      hauteur = buf.readUInt32BE(pos + 12);
      profondeur = buf[pos + 16];
      typeCouleur = buf[pos + 17];
      if (largeur === 0 || hauteur === 0 || largeur > 100000 || hauteur > 100000) {
        return {
          ok: false,
          raison:
            "image corrompue : dimensions invalides (" + largeur + "×" + hauteur + ") dans l'en-tête IHDR",
        };
      }
      const okCombo = (PNG_PROFONDEURS_VALIDES[typeCouleur] || []).includes(profondeur);
      if (!okCombo) {
        return {
          ok: false,
          raison:
            "image corrompue : combinaison profondeur de bits/type de couleur invalide dans l'en-tête IHDR",
          detail: "profondeur=" + profondeur + " typeCouleur=" + typeCouleur,
        };
      }
      ihdrVu = true;
    }

    if (type === "IDAT" && longueur > 0) {
      idat.push(buf.subarray(pos + 8, pos + 8 + longueur));
    }

    pos += 12 + longueur;
    if (type === "IEND") {
      iendVu = true;
      break;
    }
  }

  if (!ihdrVu) {
    return { ok: false, raison: "image corrompue : en-tête IHDR absent" };
  }
  if (!iendVu) {
    return {
      ok: false,
      raison:
        "fichier tronqué : la fin de l'image (marqueur IEND) est absente — le fichier a été coupé avant sa fin (import ou copie interrompu, téléchargement incomplet)",
    };
  }

  // Vérification RÉELLE des données d'image : décompression du flux zlib
  // des sections IDAT (les octets doivent former un flux deflate valide
  // et complet — un octet abîmé ou manquant déclenche une erreur).
  if (idat.length > 0) {
    const bits = bitsParPixel(typeCouleur, profondeur);
    const octetsLigne = Math.ceil((largeur * bits) / 8);
    const attendu = hauteur * (octetsLigne + 1);
    if (attendu <= LIMITE_DECOMPRESSION) {
      try {
        const brut = Buffer.concat(idat);
        zlib.inflateSync(brut, { maxOutputLength: attendu + 4096 });
      } catch (e) {
        return {
          ok: false,
          raison:
            "données d'image corrompues ou incomplètes : le contenu compressé de l'image (sections IDAT) ne peut pas être décompressé (image endommagée, import interrompu ou fichier source déjà cassé)",
          detail:
            "inflate: " + (e instanceof Error ? e.message : String(e)) +
            (crcDefaillants ? " ; crc_defaillants=" + crcDefaillants : ""),
        };
      }
    }
  }

  return {
    ok: true,
    detail: crcDefaillants ? "crc_defaillants=" + crcDefaillants : undefined,
  };
}

/* ------------------------------ JPEG ----------------------------- */

function validerJpeg(buf: Buffer): VerdictImage {
  // Tout encodeur écrit le marqueur de fin EOI (FF D9) en TOUTE FIN de
  // fichier. Les encodages ajoutant un rembourrage éventuel sont tolérés
  // (recherche dans les derniers octets).
  const debut = Math.max(0, buf.length - EOI_FENETRE);
  const queue = buf.subarray(debut);
  for (let i = 0; i + 1 < queue.length; i++) {
    if (queue[i] === 0xff && queue[i + 1] === 0xd9) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    raison:
      "fichier tronqué : le marqueur de fin JPEG (EOI) est absent — le fichier a été coupé avant sa fin (import ou copie interrompu, téléchargement incomplet)",
  };
}

/* ---------------------------- Point d'entrée ---------------------- */

/**
 * Valide la STRUCTURE complète d'un fichier image (PNG ou JPEG) déjà
 * identifié par signature. Pour tout autre contenu (PDF…), renvoie ok.
 */
export function validerStructureImage(buf: Buffer): VerdictImage {
  if (!buf || buf.length < 8) {
    return { ok: false, raison: "fichier trop court pour contenir une image" };
  }
  if (buf.subarray(0, 4).toString("hex") === "89504e47") return validerPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return validerJpeg(buf);
  return { ok: true };
}
