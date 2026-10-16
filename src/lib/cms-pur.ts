/**
 * ============================================================================
 *  NOUVEAU (Task 230) — SIGNATURE CMS / PKCS#7 DÉTACHÉE EN PUR NODE
 * ============================================================================
 *
 *  Construction et VÉRIFICATION de signatures CMS/PKCS#7 détachées (RFC 5652)
 *  SANS le binaire openssl — crypto Node natif + encodeur DER interne
 *  (der-encode.ts). Raison d'être : les serveurs de déploiement (Windows RH
 *  notamment) n'ont PAS openssl dans le PATH — l'ancien moteur levait
 *  « spawn ENOENT » à chaque import/signature.
 *
 *    signerCmsPur(données, certPEM, cléPEM, chaînePEM?) → CMS DER
 *      - attributs signés conformes (contentType, signingTime, messageDigest) ;
 *      - RSA (PKCS#1 v1.5) et EC (ECDSA DER) via crypto.sign() ;
 *      - certificat signataire + chaîne embarqués ([0] IMPLICIT SET).
 *
 *    verifierCmsPur(données, cmsDer) → rapport d'intégrité + métadonnées
 *      - condensé du contenu = attribut messageDigest ;
 *      - signature des attributs vérifiée avec la clé publique du certificat
 *        EMBARQUÉ (aucune chaîne de confiance exigée — certificats
 *        d'entreprise auto-signés acceptés, discipline du projet) ;
 *      - SHA-1/224/256/384/512 reconnus.
 *
 *  Compatibilité validée contre `openssl cms -sign/-verify` (labo Task 230) :
 *  un CMS produit ICI est vérifiable par openssl, et réciproquement.
 * ============================================================================
 */
import crypto from "crypto";
import {
  CLASSE_CONTEXTUELLE,
  TAG_INTEGER,
  TAG_SEQUENCE,
  TAG_SET,
  derCtx,
  derEntier,
  derNull,
  derOctets,
  derSequence,
  derSet,
  derTlv,
  derUtcTime,
  elements,
  enfant,
  lireTlv,
  oidVersDer,
  derVersOid,
  trierSet,
} from "./der-encode";

/* OIDs RFC 5652 / RFC 4055 / ANSI X9.62 */
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SHA1 = "1.3.14.3.2.26";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SHA384 = "2.16.840.1.101.3.4.2.2";
const OID_SHA512 = "2.16.840.1.101.3.4.2.3";
const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_ECDSA_SHA384 = "1.2.840.10045.4.3.3";
const OID_ECDSA_SHA512 = "1.2.840.10045.4.3.4";
const OID_ATTR_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_ATTR_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_ATTR_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";

export class ErreurCms extends Error {}

/* ------------------------------------------------------------------ */
/* Extraction des éléments BRUTS d'un certificat X.509 (DER)           */
/* ------------------------------------------------------------------ */

export interface IdentiteCertificat {
  /** TLV complet de l'émetteur (Name) — pour IssuerAndSerialNumber / sid. */
  emetteurBrut: Buffer;
  /** TLV complet du numéro de série (INTEGER) — pour le sid. */
  serieBrute: Buffer;
  /** Valeur du numéro de série en hexadécimal (avec 0 initial conservé). */
  serieHex: string;
}

/** Parse un certificat X.509 DER et renvoie émetteur + série EN BRUT. */
export function identiteCertificatDer(der: Buffer): IdentiteCertificat {
  const racine = elements(der);
  if (!racine.length || !racine[0].construit) {
    throw new ErreurCms("Certificat X.509 illisible (SEQUENCE attendue).");
  }
  const tbs = elements(racine[0].contenu)[0];
  if (!tbs) throw new ErreurCms("Certificat X.509 illisible (TBSCertificate absent).");
  const champs = elements(tbs.contenu);
  let i = 0;
  // version [0] EXPLICIT optionnelle
  if (champs[i] && champs[i].classe === CLASSE_CONTEXTUELLE && champs[i].numero === 0) i++;
  const serieBrute = champs[i];
  if (!serieBrute || serieBrute.tag !== TAG_INTEGER) {
    throw new ErreurCms("Certificat X.509 illisible (numéro de série attendu).");
  }
  // signature AlgorithmIdentifier, puis émetteur
  const emetteurBrut = champs[i + 2];
  if (!emetteurBrut) throw new ErreurCms("Certificat X.509 illisible (émetteur attendu).");
  const serieHex = Buffer.from(serieBrute.contenu).toString("hex").toUpperCase();
  return { emetteurBrut: Buffer.from(emetteurBrut.corps), serieBrute: Buffer.from(serieBrute.corps), serieHex };
}

/* ------------------------------------------------------------------ */
/* SIGNATURE                                                           */
/* ------------------------------------------------------------------ */

function algosDepuisCle(cle: crypto.KeyObject): { digest: string; algoSig: Buffer } {
  const type = cle.asymmetricKeyType;
  if (type === "rsa") {
    return { digest: "sha256", algoSig: derSequence(oidVersDer(OID_RSA_ENCRYPTION), derNull()) };
  }
  if (type === "ec") {
    const courbe = (cle.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve || "";
    if (courbe === "secp384r1") {
      return { digest: "sha384", algoSig: derSequence(oidVersDer(OID_ECDSA_SHA384)) };
    }
    if (courbe === "secp521r1") {
      return { digest: "sha512", algoSig: derSequence(oidVersDer(OID_ECDSA_SHA512)) };
    }
    return { digest: "sha256", algoSig: derSequence(oidVersDer(OID_ECDSA_SHA256)) };
  }
  throw new ErreurCms(
    "Type de clé privée non pris en charge pour la signature CMS (« " +
      String(type) +
      " ») : utilisez une clé RSA ou EC (courbes P-256/P-384/P-521)."
  );
}

function oidCondense(digest: string): string {
  return digest === "sha1" ? OID_SHA1 : digest === "sha384" ? OID_SHA384 : digest === "sha512" ? OID_SHA512 : OID_SHA256;
}

/**
 * Construit un CMS/PKCS#7 DÉTACHÉ (DER) sur les données, avec attributs
 * signés conformes. Clé RSA ou EC. Zéro appel système externe.
 */
export function signerCmsPur(
  donnees: Buffer,
  certPem: string,
  clePem: string,
  chainePem?: string
): Buffer {
  let cle: crypto.KeyObject;
  let cert: crypto.X509Certificate;
  try {
    cle = crypto.createPrivateKey(clePem);
  } catch (e) {
    throw new ErreurCms("Clé privée illisible pour la signature CMS : " + String((e as Error).message || e));
  }
  try {
    cert = new crypto.X509Certificate(certPem);
  } catch (e) {
    throw new ErreurCms("Certificat illisible pour la signature CMS : " + String((e as Error).message || e));
  }
  const { digest, algoSig } = algosDepuisCle(cle);
  const identite = identiteCertificatDer(cert.raw);

  // ---- Attributs signés (SET OF Attribute, tri DER) -------------------
  const condense = crypto.createHash(digest).update(donnees).digest();
  const attrs = trierSet([
    derSequence(oidVersDer(OID_ATTR_CONTENT_TYPE), derSet(oidVersDer(OID_DATA))),
    derSequence(oidVersDer(OID_ATTR_SIGNING_TIME), derSet(derUtcTime(new Date()))),
    derSequence(oidVersDer(OID_ATTR_MESSAGE_DIGEST), derSet(derOctets(condense))),
  ]);
  const attrsSet = derSet(...attrs);
  // Signature sur le DER du SET (RFC 5652 §11.4 — le tag IMPLICIT [0] n'est
  // PAS utilisé pour le calcul).
  const signature = crypto.sign(digest, attrsSet, cle);

  // ---- SignerInfo ------------------------------------------------------
  const sid = derSequence(identite.emetteurBrut, identite.serieBrute);
  const signerInfo = derSequence(
    derEntier(1),
    sid,
    derSequence(oidVersDer(oidCondense(digest)), derNull()),
    derCtx(0, Buffer.concat(attrs)), // [0] IMPLICIT signedAttrs
    algoSig,
    derOctets(signature)
  );

  // ---- Certificats embarqués (signataire + chaîne) ---------------------
  const certs: Buffer[] = [Buffer.from(cert.raw)];
  if (chainePem) {
    for (const bloc of chainePem.split(/-----END CERTIFICATE-----/)) {
      const pem = bloc.trim();
      if (!pem) continue;
      try {
        const c = new crypto.X509Certificate(pem + "\n-----END CERTIFICATE-----");
        certs.push(Buffer.from(c.raw));
      } catch {
        /* maillon illisible : ignoré (la signature reste VALIDE) */
      }
    }
  }

  // ---- SignedData + ContentInfo ---------------------------------------
  const signedData = derSequence(
    derEntier(1),
    derSet(derSequence(oidVersDer(oidCondense(digest)), derNull())),
    derSequence(oidVersDer(OID_DATA)), // encapContentInfo DÉTACHÉ (pas d'eContent)
    derCtx(0, Buffer.concat(certs)), // [0] IMPLICIT SET OF Certificate
    derSet(signerInfo)
  );
  return derSequence(oidVersDer(OID_SIGNED_DATA), derCtx(0, signedData));
}

/* ------------------------------------------------------------------ */
/* VÉRIFICATION                                                        */
/* ------------------------------------------------------------------ */

const ALGOS_CONDENSE: Record<string, string> = {
  "1.3.14.3.2.26": "sha1",
  "2.16.840.1.101.3.4.2.4": "sha224",
  "2.16.840.1.101.3.4.2.1": "sha256",
  "2.16.840.1.101.3.4.2.2": "sha384",
  "2.16.840.1.101.3.4.2.3": "sha512",
};

export interface RapportCms {
  integrite: boolean;
  signataire: string;
  emetteur: string;
  serie: string;
  empreinte: string; // SHA-256 du certificat signataire (hex, sans deux-points)
  valideDu: Date | null;
  valideAu: Date | null;
  certificatValide: boolean;
  algorithmeCle: string;
  message: string;
}

/** Formatage « CN=Jean Dupont, O=MA SOCIETE SARL » depuis X509Certificate. */
function nomLisible(nom: string): string {
  return nom
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

function decrireCle(cert: crypto.X509Certificate): string {
  try {
    const cle = crypto.createPublicKey(cert.publicKey);
    if (cle.asymmetricKeyType === "rsa") {
      const bits = (cle.asymmetricKeyDetails as { modulusLength?: number } | undefined)?.modulusLength;
      return bits ? "RSA " + bits + " bits" : "RSA";
    }
    if (cle.asymmetricKeyType === "ec") {
      const courbe = (cle.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve;
      return courbe ? "EC " + courbe : "EC";
    }
    if (cle.asymmetricKeyType === "ed25519") return "Ed25519";
    return String(cle.asymmetricKeyType || "");
  } catch {
    return "";
  }
}

/** Sujet/émetteur lisibles + validité d'un certificat (rapport). */
function rapportDepuisCert(cert: crypto.X509Certificate, integrite: boolean, message: string): RapportCms {
  const maintenant = new Date();
  const valideDu = new Date(cert.validFrom);
  const valideAu = new Date(cert.validTo);
  const certificatValide =
    !isNaN(valideDu.getTime()) && !isNaN(valideAu.getTime()) && maintenant >= valideDu && maintenant <= valideAu;
  let messageFinal = message;
  if (integrite) {
    if (isNaN(valideAu.getTime()) || maintenant > valideAu) {
      messageFinal +=
        " — ATTENTION : le certificat du signataire est EXPIRÉ depuis le " +
        (isNaN(valideAu.getTime()) ? "?" : valideAu.toISOString().slice(0, 10)) +
        " (la signature reste cryptographiquement intègre).";
    } else if (maintenant < valideDu) {
      messageFinal +=
        " — ATTENTION : le certificat du signataire n'est pas encore valide (débute le " +
        valideDu.toISOString().slice(0, 10) +
        ").";
    }
  }
  return {
    integrite,
    signataire: nomLisible(cert.subject),
    emetteur: nomLisible(cert.issuer),
    serie: cert.serialNumber.toUpperCase(),
    empreinte: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
    valideDu: isNaN(valideDu.getTime()) ? null : valideDu,
    valideAu: isNaN(valideAu.getTime()) ? null : valideAu,
    certificatValide,
    algorithmeCle: decrireCle(cert),
    message: messageFinal,
  };
}

/** Lit la taille réelle d'un CMS DER (retire le bourrage du hex /Contents). */
export function tailleCmsDer(octets: Buffer): number {
  if (octets.length < 2 || octets[0] !== 0x30) return octets.length;
  const second = octets[1];
  if (second < 0x80) return Math.min(2 + second, octets.length);
  const nb = second & 0x7f;
  if (nb === 0 || nb > 4 || octets.length < 2 + nb) return octets.length;
  let longueur = 0;
  for (let i = 0; i < nb; i++) longueur = longueur * 256 + octets[2 + i];
  return Math.min(2 + nb + longueur, octets.length);
}

/**
 * Vérifie une signature CMS DÉTACHÉE contre les données. Ne lève JAMAIS :
 * renvoie toujours un rapport (integrite=false + message en cas de doute).
 */
export function verifierCmsPur(donnees: Buffer, cmsDer: Buffer): RapportCms {
  const vide = (message: string): RapportCms => ({
    integrite: false,
    signataire: "",
    emetteur: "",
    serie: "",
    empreinte: "",
    valideDu: null,
    valideAu: null,
    certificatValide: false,
    algorithmeCle: "",
    message,
  });
  try {
    const racine = elements(cmsDer);
    if (!racine.length) return vide("Signature CMS illisible (structure absente).");
    const ci = racine[0];
    const enfantsCi = elements(ci.contenu);
    if (!enfantsCi.length) return vide("Signature CMS illisible (ContentInfo vide).");
    const oidContenu = derVersOid(enfantsCi[0]);
    if (oidContenu !== OID_SIGNED_DATA) {
      return vide("Signature CMS illisible (type « " + oidContenu + " » au lieu de signedData).");
    }
    const enveloppe = enfant(enfantsCi, CLASSE_CONTEXTUELLE, 0);
    if (!enveloppe) return vide("Signature CMS illisible (contenu signedData absent).");
    // NB : le content de ContentInfo est [0] EXPLICIT → son contenu contient
    // l'ENCODAGE COMPLET du SignedData (TLV SEQUENCE) à déplier une fois.
    const sdTlv = elements(enveloppe.contenu)[0];
    if (!sdTlv || sdTlv.tag !== TAG_SEQUENCE) return vide("Signature CMS illisible (SignedData absent).");
    const champsSd = elements(sdTlv.contenu);
    if (!champsSd.length) return vide("Signature CMS illisible (SignedData vide).");

    // certificates : [0] IMPLICIT SET OF Certificate
    const champCerts = enfant(champsSd, CLASSE_CONTEXTUELLE, 0);
    const certs: crypto.X509Certificate[] = [];
    if (champCerts) {
      let pos = 0;
      while (pos < champCerts.contenu.length) {
        const r = lireTlv(champCerts.contenu, pos);
        try {
          certs.push(new crypto.X509Certificate(Buffer.from(r.tlv.corps)));
        } catch {
          /* élément non certificat, ignoré */
        }
        pos = r.suivant;
      }
    }

    // signerInfos : SET OF SignerInfo (dernier champ)
    const signerInfos = champsSd[champsSd.length - 1];
    if (!signerInfos || signerInfos.tag !== TAG_SET) {
      return vide("Signature CMS illisible (signerInfos absent).");
    }
    const infos = elements(signerInfos.contenu);
    if (!infos.length) return vide("Signature CMS sans signataire.");

    // On vérifie TOUS les signataires (le premier KO fait échouer l'ensemble).
    let dernierRapport: RapportCms | null = null;
    for (const info of infos) {
      const champs = elements(info.contenu);
      if (champs.length < 5) return vide("SignerInfo incomplet (structure CMS altérée).");
      const sid = champs[1];
      const enfantsSid = elements(sid.contenu);
      const emetteurSid = enfantsSid[0];
      const serieSid = enfantsSid[1];
      if (!emetteurSid || !serieSid) return vide("SignerInfo illisible (identifiant signataire).");

      // Certificat du signataire = correspondance émetteur BRUT + série BRUT
      let cert: crypto.X509Certificate | null = null;
      for (const c of certs) {
        const identite = identiteCertificatDer(c.raw);
        if (
          Buffer.compare(identite.emetteurBrut, Buffer.from(emetteurSid.corps)) === 0 &&
          Buffer.compare(identite.serieBrute, Buffer.from(serieSid.corps)) === 0
        ) {
          cert = c;
          break;
        }
      }
      if (!cert && certs.length === 1) cert = certs[0]; // repli : certificat unique
      if (!cert) {
        return vide(
          "Certificat du signataire absent de la signature : impossible de vérifier l'intégrité."
        );
      }

      // Algorithme de condensé
      const champDigest = champs[2];
      const algosDigest = elements(champDigest.contenu);
      const oidDigest = algosDigest.length ? derVersOid(algosDigest[0]) : "";
      const nomDigest = ALGOS_CONDENSE[oidDigest];
      if (!nomDigest) {
        return vide("Algorithme de condensé non pris en charge (« " + (oidDigest || "?") + " »).");
      }

      // Attributs signés [0] IMPLICIT (optionnels) + signature
      let attrsSet: Buffer | null = null;
      let condenseEmbarque: Buffer | null = null;
      let indexChamp = 3;
      const champAttrs = champs[indexChamp];
      if (champAttrs && champAttrs.classe === CLASSE_CONTEXTUELLE && champAttrs.numero === 0) {
        attrsSet = Buffer.from(champAttrs.corps);
        // messageDigest = attribute { OID messageDigest, SET { OCTET STRING } }
        for (const attrTlv of elements(champAttrs.contenu)) {
          const enfantsAttr = elements(attrTlv.contenu);
          if (enfantsAttr.length >= 2 && derVersOid(enfantsAttr[0]) === OID_ATTR_MESSAGE_DIGEST) {
            const valeurs = elements(enfantsAttr[1].contenu);
            if (valeurs.length) condenseEmbarque = Buffer.from(valeurs[0].contenu);
          }
        }
        indexChamp++;
      }

      const champAlgoSig = champs[indexChamp];
      const champSignature = champs[indexChamp + 1];
      if (!champAlgoSig || !champSignature) return vide("SignerInfo incomplet (signature absente).");
      const signature = champSignature.contenu;

      // 1) Condensé du contenu = attribut messageDigest (quand présent)
      const condenseCalcule = crypto.createHash(nomDigest).update(donnees).digest();
      if (condenseEmbarque) {
        if (
          condenseEmbarque.length !== condenseCalcule.length ||
          !crypto.timingSafeEqual(condenseEmbarque, condenseCalcule)
        ) {
          return rapportDepuisCert(
            cert,
            false,
            "Signature INVALIDE : le document a été modifié depuis sa signature (le condensé du contenu ne correspond plus)."
          );
        }
      }

      // 2) Signature cryptographique
      let verifie: boolean;
      if (attrsSet) {
        // RFC 5652 : signature sur le DER du SET OF Attributes (re-trié DER).
        const reEncode = derSet(
          ...trierSet(elements(champAttrs.contenu).map((a) => Buffer.from(a.corps)))
        );
        verifie = crypto.verify(nomDigest, reEncode, cert.publicKey, signature);
      } else {
        verifie = crypto.verify(nomDigest, donnees, cert.publicKey, signature);
      }
      if (!verifie) {
        return rapportDepuisCert(
          cert,
          false,
          "Signature INVALIDE : la vérification cryptographique a échoué (document modifié ou signature d'un autre certificat)."
        );
      }
      dernierRapport = rapportDepuisCert(
        cert,
        true,
        "Signature intègre : le document n'a été modifié d'aucune manière depuis sa signature par « " +
          nomLisible(cert.subject) +
          " »."
      );
    }
    return dernierRapport ?? vide("Signature CMS sans signataire vérifiable.");
  } catch (e) {
    return vide("Signature CMS illisible : " + String((e as Error).message || e).slice(0, 300));
  }
}

/** Est-ce que ce buffer ressemble à un CMS DER (ContentInfo signedData) ? */
export function ressembleCmsDer(octets: Buffer): boolean {
  try {
    const r = lireTlv(octets, 0);
    if (r.tlv.tag !== TAG_SEQUENCE) return false;
    const enfants = elements(r.tlv.contenu);
    return enfants.length >= 2 && derVersOid(enfants[0]) === OID_SIGNED_DATA;
  } catch {
    return false;
  }
}
