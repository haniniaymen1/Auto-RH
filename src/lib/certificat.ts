/**
 * ============================================================================
 *  NOUVEAU (Task 181) — ANALYSE DES FICHIERS DE SIGNATURE ÉLECTRONIQUE
 *  (import multi-formats dans la rubrique « Signature électronique & QR code »)
 * ============================================================================
 *
 *  DEMANDE : pouvoir importer une signature électronique dans différents
 *  formats, notamment .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx « ainsi que
 *  tout autre format de signature électronique compatible ».
 *
 *  PRINCIPE — le FORMAT est détecté par le CONTENU (octets de signature /
 *  structure ASN.1), jamais par l'extension du fichier :
 *
 *   - PKCS#12 / PFX   (.p12, .pfx, .pdx…)  : conteneur ASN.1 DER regroupant
 *     certificat(s) et clé privée chiffrée → certificats extraits ; une clé
 *     privée PRÉSENTE est SIGNALÉE mais JAMAIS extraite ni conservée ;
 *   - PKCS#7 / CMS    (.p7s, .p7m, .p7b, .pkcs7, .ps7x, .spc…) : signé (DER
 *     ou PEM « -----BEGIN PKCS7----- ») → certificats embarqués extraits ;
 *   - X.509 brut      (.cer, .crt, .pem, .der, .cat…) : certificat DER ou PEM
 *     « -----BEGIN CERTIFICATE----- » ;
 *   - XML-DSig / XAdES (.xml) : enveloppe XML — le/les certificats
 *     <X509Certificate> (base64 DER) sont extraits, quelle que soit la
 *     structure (XAdES-BES, XMLDSig, ds:Signature…) ;
 *   - JWS / JWT       (.jws, .jwt) : en-tête compact JSON avec x5c (RFC 7515)
 *     → chaîne de certificats extraite ;
 *   - conteneur ZIP   (.zip, .p7x, .ps7x zippé, OOXML signé…) : chaque entrée
 *     est essayée (PKCS#7, X.509, XML) — premier certificat trouvé retenu.
 *
 *  SÉCURITÉ :
 *   - aucun calcul cryptographique sensible : on lit, on extrait le
 *     certificat PUBLIC, on n'exécute rien ;
 *   - la clé privée d'un PKCS#12 (même donnée avec mot de passe) n'est pas
 *     dérivée de façon réversible — seul l'indicateur booléen est renvoyé ;
 *   - empreinte SHA-256 du certificat recalculée sur son DER canonique
 *     (forge.pki.certificateToAsn1) — stable quel que soit le conteneur.
 *
 *  Aucune dépendance native : node-forge (JS pur) — compatible build
 *  standalone Windows.
 * ============================================================================
 */
import crypto from "crypto";
import * as forge from "node-forge";

/** Résultat d'analyse réussie (certificat public extrait). */
export interface CertificatExtrait {
  ok: true;
  /** Libellé lisible du format détecté (ex. « PKCS#12 (.p12 / .pfx) »). */
  format: string;
  /** Famille normalisée : P12 | PKCS7 | X509 | XMLDSIG | JWS | ZIP. */
  famille: string;
  /** Sujet complet « CN=…, O=… ». */
  sujet: string;
  /** Nom commun (CN) du sujet — champ affiché principal. */
  sujetCN: string;
  /** Émetteur complet « CN=…, O=… ». */
  emetteur: string;
  emetteurCN: string;
  /** Numéro de série (hexadécimal MAJUSCULES). */
  serial: string;
  /** Début / fin de validité (dates du certificat). */
  valideDu: Date;
  valideAu: Date;
  /** Empreinte SHA-256 du DER canonique (hex MAJUSCULES). */
  empreinte: string;
  /** Certificat public canonique, DER encodé en base64 (stocké en base). */
  certDerB64: string;
  /** Nombre de certificats contenus dans le fichier importé. */
  nbCertificats: number;
  /** Une clé privée était présente dans le conteneur (signalée, non extraite). */
  clePriveePresente: boolean;
  /** Extension conseillée pour la copie de contrôle (p12, p7s, cer, xml…). */
  extension: string;
}

/** Résultat d'analyse en échec — message en français destiné à l'utilisateur. */
export interface CertificatRefuse {
  ok: false;
  erreur: string;
}

export type ResultatAnalyse = CertificatExtrait | CertificatRefuse;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

/** Date en JJ/MM/AAAA (mention tamponnée — jamais l'heure). */
function dateCourte(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * (NOUVEAU Task 181) Répare le décodage des VALEURS de noms X.500 lues
 * depuis le DER : node-forge renvoie les octets bruts — un CN encodé
 * UTF-8 (standard OpenSSL/la plupart des autorités) s'afficherait
 * « SociÃ©tÃ© » et un BMPString (UTF-16BE, standard Windows) avec des NUL
 * intercalés. Deux réparations SÛRES (validées par aller-retour) :
 *  - UTF-16BE : octets impairs porteurs, pairs à zéro → décodage UTF-16 ;
 *  - UTF-8 : les octets forment une séquence UTF-8 STRICTEMENT valide
 *    (re-encodage identique, aucun U+FFFD) → décodage.
 * Sinon la valeur brute est conservée telle quelle.
 */
function repareTexteDer(v: string): string {
  const brut = String(v ?? "");
  if (!brut) return brut;
  try {
    if (brut.charCodeAt(0) === 0 && brut.length >= 2 && brut.length % 2 === 0) {
      // BMPString probable (UTF-16BE — Windows) : « \0S\0o\0c… »
      const buf = Buffer.from(brut, "latin1");
      let utf16 = true;
      for (let i = 0; i < buf.length; i += 2) {
        if (buf[i] !== 0) {
          utf16 = false;
          break;
        }
      }
      if (utf16) {
        const texte = buf.swap16().toString("utf16le").replace(/\u0000+$/, "");
        if (texte && !texte.includes("\uFFFD")) return texte;
      }
    }
    if (/[^\x00-\x7F]/.test(brut)) {
      const octets = Buffer.from(brut, "latin1");
      const texte = octets.toString("utf8");
      if (!texte.includes("\uFFFD") && Buffer.from(texte, "utf8").equals(octets)) {
        return texte;
      }
    }
  } catch {
    // jamais bloquant : valeur brute conservée
  }
  return brut;
}

/** Construit « CN=…, O=… » lisible depuis un nom X.500 forge. */
function nomLisible(nom: forge.pki.CertificateField[] | undefined): string {
  if (!nom || !nom.length) return "";
  return nom
    .map((a) => `${a.shortName || a.name}=${repareTexteDer(String(a.value ?? "")).trim()}`)
    .join(", ");
}

/** Extrait le CN (ou le premier champ disponible) d'un nom X.500. */
function champCN(nom: forge.pki.CertificateField[] | undefined): string {
  if (!nom || !nom.length) return "";
  const cn = nom.find((a) => a.shortName === "CN" || a.name === "commonName");
  if (cn) return repareTexteDer(String(cn.value ?? "")).trim();
  return repareTexteDer(String(nom[0].value ?? "")).trim();
}

/** Convertit des octets Buffer en buffer binaire forge (latin1). */
function forgeBuffer(octets: Buffer): forge.util.ByteStringBuffer {
  return forge.util.createBuffer(octets.toString("latin1"));
}

/** Certificat forge → DER canonique (Buffer) + empreinte SHA-256. */
function derCanonique(cert: forge.pki.Certificate): { der: Buffer; empreinte: string } {
  const asn1 = forge.pki.certificateToAsn1(cert);
  const der = Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
  const empreinte = crypto.createHash("sha256").update(der).digest("hex").toUpperCase();
  return { der, empreinte };
}

/**
 * Choisit le certificat « principal » d'un conteneur : le premier certificat
 * NON autorité de certification (le certificat du signataire), sinon le
 * premier trouvé. Les fichiers peuvent embarquer toute la chaîne.
 */
function choisirPrincipal(certs: forge.pki.Certificate[]): forge.pki.Certificate | null {
  if (!certs.length) return null;
  const nonCa = certs.find((c) => {
    try {
      const bc = c.getExtension("basicConstraints") as unknown as { cA?: boolean } | undefined;
      return !bc || !bc.cA;
    } catch {
      return true;
    }
  });
  return nonCa ?? certs[0];
}

/** Fabrique le résultat final à partir du certificat principal choisi. */
function fabriquerResultat(
  certs: forge.pki.Certificate[],
  format: string,
  famille: string,
  extension: string,
  clePriveePresente: boolean
): ResultatAnalyse {
  const principal = choisirPrincipal(certs);
  if (!principal) {
    return {
      ok: false,
      erreur:
        "Aucun certificat X.509 trouvé dans ce fichier. Le fichier est reconnu mais ne contient pas de certificat exploitable.",
    };
  }
  const { der, empreinte } = derCanonique(principal);
  const sujet = nomLisible(principal.subject.attributes);
  const emetteur = nomLisible(principal.issuer.attributes);
  return {
    ok: true,
    format,
    famille,
    sujet,
    sujetCN: champCN(principal.subject.attributes),
    emetteur,
    emetteurCN: champCN(principal.issuer.attributes),
    serial: String(principal.serialNumber ?? "").toUpperCase(),
    valideDu: principal.validity.notBefore,
    valideAu: principal.validity.notAfter,
    empreinte,
    certDerB64: der.toString("base64"),
    nbCertificats: certs.length,
    clePriveePresente,
    extension,
  };
}

/* ------------------------------------------------------------------ */
/* Décodeurs par famille                                               */
/* ------------------------------------------------------------------ */

/**
 * Tente d'interpréter un DER comme : PKCS#12 → PKCS#7 → X.509.
 *  - resultat : null si aucune lecture n'aboutit (pas ASN.1 DER exploitable) ;
 *  - erreurPfx : message dédié quand le fichier RESSEMBLait à un PKCS#12
 *    protégé par mot de passe (manquant ou faux) — prioritaire sur le
 *    message générique « format non reconnu ».
 */
interface SortieDer {
  resultat: ResultatAnalyse | null;
  erreurPfx?: string;
}

function lireDer(octets: Buffer, motDePasse: string): SortieDer {
  const sortie: SortieDer = { resultat: null };
  if (!octets.length || octets[0] !== 0x30) return sortie;
  const second = octets[1];
  if (!(second & 0x80)) return sortie; // pas une SEQUENCE DER plausibles
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(forgeBuffer(octets));
  } catch {
    return sortie;
  }

  // 1) PKCS#12 / PFX (.p12 / .pfx)
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, motDePasse || "");
    const sacs = p12.getBags({ bagType: forge.pki.oids.certBag });
    const sacsCerts = sacs[forge.pki.oids.certBag] ?? [];
    const certs: forge.pki.Certificate[] = [];
    for (const sac of sacsCerts) {
      if (sac.cert) certs.push(sac.cert);
    }
    // clé privée présente ? (keyBag non chiffrée OU pkcs8ShroudedKeyBag)
    let clePrivee = false;
    for (const type of [forge.pki.oids.keyBag, forge.pki.oids.pkcs8ShroudedKeyBag]) {
      try {
        const sacsCles = p12.getBags({ bagType: type })[type] ?? [];
        if (sacsCles.some((s) => Boolean(s.key))) clePrivee = true;
      } catch {
        // clé illisible (mot de passe) : on reste factuel, pas de signal faux
      }
    }
    if (certs.length) {
      sortie.resultat = fabriquerResultat(
        certs,
        "PKCS#12 (.p12 / .pfx)",
        "P12",
        "p12",
        clePrivee
      );
      return sortie;
    }
    // conteneur PKCS#12 valide mais sans certificat → arrêt avec message
    sortie.resultat = {
      ok: false,
      erreur:
        "Ce conteneur PKCS#12 ne contient aucun certificat (clé seule). Exportez un .p12 incluant le certificat, ou importez le certificat seul (.cer).",
    };
    return sortie;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // PFX protégé : les erreurs de déchiffrement remontent ici — mémorisées
    // sans court-circuiter l'essai PKCS#7 / X.509 qui suit.
    if (
      /password|decrypt|mac|encrypt|invalid|pkcs12/i.test(msg) &&
      octets.length > 8
    ) {
      sortie.erreurPfx =
        "Fichier PKCS#12 protégé : mot de passe absent ou incorrect. Précisez le mot de passe du fichier (ou exportez un certificat sans mot de passe).";
    }
  }

  // 2) PKCS#7 / CMS (.p7s / .p7m / .p7b / .pkcs7 / .ps7x)
  try {
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      type?: string;
      certificates?: forge.pki.Certificate[];
    };
    const type = String(p7.type ?? "");
    const certs: forge.pki.Certificate[] = Array.isArray(p7.certificates)
      ? p7.certificates
      : [];
    if (certs.length) {
      sortie.resultat = fabriquerResultat(
        certs,
        "PKCS#7 / CMS (signature .p7s / .p7m / .pkcs7 / .ps7x)",
        "PKCS7",
        "p7s",
        false
      );
      return sortie;
    }
    if (type === forge.pki.oids.envelopedData) {
      sortie.resultat = {
        ok: false,
        erreur:
          "PKCS#7 « envelopedData » chiffré : il ne contient aucun certificat lisible sans la clé du destinataire. Importez le certificat du signataire (.p7s signé ou .cer).",
      };
      return sortie;
    }
    sortie.resultat = {
      ok: false,
      erreur:
        "Fichier PKCS#7 reconnu mais sans certificat embarqué. Importez la signature avec certificat (.p7s incluant la chaîne) ou le certificat seul (.cer).",
    };
    return sortie;
  } catch {
    // pas un PKCS#7 — suite
  }

  // 3) Certificat X.509 brut (.cer / .crt / .der)
  try {
    const cert = forge.pki.certificateFromAsn1(asn1);
    sortie.resultat = fabriquerResultat(
      [cert],
      "Certificat X.509 (.cer / .crt / .der)",
      "X509",
      "cer",
      false
    );
    return sortie;
  } catch {
    sortie.resultat = null; // aucune des trois familles — la détection continue
    return sortie;
  }
}

/** PEM : blocs CERTIFICATE et PKCS7 mélangés. */
function lirePem(octets: Buffer): ResultatAnalyse | null {
  const texte = octets.toString("utf8");
  const certs: forge.pki.Certificate[] = [];
  let clePrivee = false;
  let contientPkcs7 = false;
  for (const bloc of texte.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g) ?? []) {
    const type = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(bloc)?.[1] ?? "";
    try {
      if (type === "CERTIFICATE" || type === "TRUSTED CERTIFICATE" || type === "X509 CERTIFICATE") {
        certs.push(forge.pki.certificateFromPem(bloc));
      } else if (type === "PKCS7" || type === "PKCS7 SIGNED DATA") {
        contientPkcs7 = true;
        const p7 = forge.pkcs7.messageFromPem(bloc) as unknown as {
          certificates?: forge.pki.Certificate[];
        };
        if (Array.isArray(p7.certificates)) certs.push(...p7.certificates);
      } else if (/PRIVATE KEY/.test(type)) {
        clePrivee = true; // signalé seulement — JAMAIS extraite
      }
    } catch {
      // bloc illisible : ignoré (les autres blocs peuvent être bons)
    }
  }
  if (certs.length) {
    const format = contientPkcs7
      ? "PKCS#7 / CMS PEM (.p7s / .pkcs7)"
      : clePrivee
        ? "Certificat(s) X.509 PEM (avec clé privée adjacente — non conservée)"
        : "Certificat(s) X.509 PEM (.pem / .cer)";
    return fabriquerResultat(certs, format, contientPkcs7 ? "PKCS7" : "X509", "cer", clePrivee);
  }
  // PEM PKCS7 sans certificat extractible
  if (/-----BEGIN PKCS7/.test(texte)) {
    return {
      ok: false,
      erreur:
        "Bloc PKCS7 PEM sans certificat extractible. Importez la signature avec sa chaîne de certificats ou le certificat seul.",
    };
  }
  return null;
}

/** XML-DSig / XAdES : extraction de tous les <X509Certificate>. */
function lireXml(octets: Buffer): ResultatAnalyse | null {
  const texte = octets.toString("utf8");
  if (!/<\s*[\w:.-]+[\s\S]/.test(texte.trimStart())) return null;
  const certs: forge.pki.Certificate[] = [];
  for (const m of texte.matchAll(/<\s*(?:[\w.-]+:)?X509Certificate[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?X509Certificate\s*>/gi)) {
    const b64 = m[1].replace(/\s+/g, "");
    try {
      const der = Buffer.from(b64, "base64");
      if (der.length < 32) continue;
      const asn1 = forge.asn1.fromDer(forgeBuffer(der));
      certs.push(forge.pki.certificateFromAsn1(asn1));
    } catch {
      // bloc illisible : suivant
    }
  }
  if (certs.length) {
    return fabriquerResultat(
      certs,
      "Signature XML numérique (XML-DSig / XAdES, .xml)",
      "XMLDSIG",
      "xml",
      false
    );
  }
  return {
    ok: false,
    erreur:
      "Fichier XML reconnu mais aucun certificat <X509Certificate> exploitable dedans (signature XML sans certificat embarqué ou référencée à l'extérieur).",
  };
}

/** JWS / JWT compact : header.x5c (RFC 7515). */
function lireJws(octets: Buffer): ResultatAnalyse | null {
  const texte = octets.toString("utf8").trim();
  const morceaux = texte.split(".");
  if (morceaux.length < 2 || !/^eyJ/.test(morceaux[0])) return null;
  try {
    const json = Buffer.from(
      morceaux[0].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const entete = JSON.parse(json) as { x5c?: string[] };
    const certs: forge.pki.Certificate[] = [];
    for (const b64 of entete.x5c ?? []) {
      const der = Buffer.from(b64, "base64");
      const asn1 = forge.asn1.fromDer(forgeBuffer(der));
      certs.push(forge.pki.certificateFromAsn1(asn1));
    }
    if (certs.length) {
      return fabriquerResultat(
        certs,
        "Jeton signé JWS / JWT (chaîne X.5c)",
        "JWS",
        "jws",
        false
      );
    }
  } catch {
    // pas un JWS exploitable
  }
  return null;
}

/** Conteneur ZIP : essaye chaque entrée (PKCS#7, X.509, XML). */
async function lireZip(octets: Buffer): Promise<ResultatAnalyse | null> {
  let JSZip: typeof import("jszip") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    JSZip = require("jszip") as typeof import("jszip");
  } catch {
    return null;
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(octets);
  } catch {
    return null;
  }
  const entrees = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .slice(0, 200);
  for (const chemin of entrees) {
    const contenu = await zip.files[chemin].async("nodebuffer").catch(() => null);
    if (!contenu || contenu.length < 32 || contenu.length > 4_000_000) continue;
    // PKCS#7 / X.509 DER
    const der = lireDer(contenu, "");
    if (der.resultat && der.resultat.ok) {
      return fabriquerResultat(
        // on repasse par la fabrique pour garder le libellé conteneur ZIP
        extraireCerts(der.resultat),
        `Conteneur ZIP — ${der.resultat.format} (entrée « ${chemin.slice(0, 80)} »)`,
        "ZIP",
        "zip",
        der.resultat.clePriveePresente
      );
    }
    // XML avec certificat
    const t = contenu.subarray(0, 4096).toString("utf8").trimStart();
    if (t.startsWith("<")) {
      const xml = lireXml(contenu);
      if (xml && xml.ok) {
        return fabriquerResultat(
          extraireCerts(xml),
          `Conteneur ZIP — ${xml.format} (entrée « ${chemin.slice(0, 80)} »)`,
          "ZIP",
          "zip",
          false
        );
      }
    }
  }
  return {
    ok: false,
    erreur:
      "Archive ZIP reconnue mais aucune signature ni certificat exploitable trouvé(e) à l'intérieur (.p7s, .cer, XML signé).",
  };
}

/** Re-parse le certificat canonique stocké dans un résultat réussi. */
function extraireCerts(info: CertificatExtrait): forge.pki.Certificate[] {
  try {
    const der = Buffer.from(info.certDerB64, "base64");
    const asn1 = forge.asn1.fromDer(forgeBuffer(der));
    const cert = forge.pki.certificateFromAsn1(asn1);
    return [cert];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                      */
/* ------------------------------------------------------------------ */

/** Taille MAX du fichier de signature accepté (octets décodés). */
export const TAILLE_FICHIER_CERT_MAX = 10_000_000;

/**
 * Analyse un fichier de signature électronique quel que soit son format.
 * La détection se fait par le CONTENU (jamais par l'extension) — un .ps7x
 * DER, un .xml, un ZIP renommé… sont traités correctement.
 *
 * @param octets      contenu brut du fichier
 * @param motDePasse  mot de passe éventuel du conteneur PKCS#12 (.p12/.pfx)
 */
export async function analyserFichierSignature(
  octets: Buffer,
  motDePasse = ""
): Promise<ResultatAnalyse> {
  if (!octets || octets.length < 12) {
    return {
      ok: false,
      erreur:
        "Fichier trop court ou vide : ce n'est pas un fichier de signature électronique exploitable.",
    };
  }
  if (octets.length > TAILLE_FICHIER_CERT_MAX) {
    return {
      ok: false,
      erreur: "Fichier trop volumineux (10 Mo maximum pour un fichier de signature).",
    };
  }

  const debut = octets.subarray(0, 4096);
  const texte = debut.toString("utf8");
  const propre = texte.replace(/^\uFEFF/, "").trimStart();

  // --- ZIP (PK\x03\x04 ou PK\x05\x06) — AVANT le texte (un ZIP peut contenir "<")
  if (octets.length >= 4 && octets[0] === 0x50 && octets[1] === 0x4b) {
    const r = await lireZip(octets);
    if (r) return r;
    return {
      ok: false,
      erreur:
        "Archive ZIP illisible ou sans signature/certificat exploitable. Formats acceptés : .p12, .pfx, .p7s, .p7m, .pkcs7, .ps7x, .cer, .crt, .pem, .der, XML signé, JWS.",
    };
  }

  // --- XML (XML-DSig / XAdES)
  if (propre.startsWith("<")) {
    const r = lireXml(octets);
    if (r) return r;
    return {
      ok: false,
      erreur:
        "Fichier XML reconnu, mais aucun certificat <X509Certificate> exploitable n'y a été trouvé.",
    };
  }

  // --- PEM
  if (propre.startsWith("-----BEGIN")) {
    const r = lirePem(octets);
    if (r) return r;
    return {
      ok: false,
      erreur:
        "Fichier PEM reconnu, mais aucun bloc CERTIFICATE ou PKCS7 exploitable n'y a été trouvé.",
    };
  }

  // --- JWS / JWT compact
  const jws = lireJws(octets);
  if (jws) return jws;

  // --- ASN.1 DER : PKCS#12 → PKCS#7 → X.509
  const der = lireDer(octets, motDePasse ?? "");
  if (der.resultat) return der.resultat;

  // Erreur dédiée si le fichier RESSEMBLAIT à un PFX chiffré (mot de passe)
  if (der.erreurPfx) return { ok: false, erreur: der.erreurPfx };

  return {
    ok: false,
    erreur:
      "Format de signature non reconnu. Formats acceptés : .p12, .pfx (PKCS#12), .p7s, .p7m, .p7b, .pkcs7, .ps7x (PKCS#7/CMS), .cer, .crt, .pem, .der (certificat X.509), .xml (XML-DSig/XAdES), .jws/.jwt (X.5c), archive ZIP contenant l'un de ces fichiers.",
  };
}

/**
 * Ligne de mention prête à tamponner sous les fiches de paie après import :
 * « Signé électroniquement — Certificat « CN » — Valable jusqu'au JJ/MM/AAAA — N° … ».
 * Longueur plafonnée pour tenir dans le bandeau du tampon (WinAnsi sûr :
 * la ligne passe ensuite par texteWinAnsi au moment du dessin).
 */
export function ligneMentionDepuisAnalyse(info: CertificatExtrait): string {
  const cn = (info.sujetCN || info.sujet || "Certificat électronique").trim();
  const cnCourt = cn.length > 60 ? cn.slice(0, 57) + "…" : cn;
  const serie = info.serial.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  const serieCourt = serie.length > 16 ? serie.slice(0, 16) + "…" : serie;
  return (
    "Signé électroniquement — Certificat « " +
    cnCourt +
    " » — Valable jusqu'au " +
    dateCourte(info.valideAu) +
    " — N° " +
    (serieCourt || "—")
  ).slice(0, 140);
}
