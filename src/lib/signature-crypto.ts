/**
 * ============================================================================
 *  NOUVEAU (Task 181) — IMPORT DE SIGNATURES ÉLECTRONIQUES MULTI-FORMATS
 * ============================================================================
 *
 *  Analyse et extraction du CERTIFICAT contenu dans les fichiers de signature
 *  électronique professionnels acceptés par la rubrique « Signature
 *  électronique & QR code » :
 *
 *    - PKCS#12 / PFX   (.p12, .pfx)        — coffre certificat + clé privée
 *                                            (mot de passe demandé à l'import)
 *    - PKCS#7 / CMS    (.pkcs7, .p7s,      — signature détachée (.p7s),
 *                       .p7m, .p7b, .p7c)    enveloppée (.p7m) ou chaîne de
 *                                            certificats (.p7b/.p7c/.pkcs7)
 *    - XML-DSig        (.xml, .ps7x)       — signature XML avec certificat
 *                                            X509Certificate embarqué
 *    - X.509           (.pem, .cer,        — certificat brut
 *                       .crt, .der)
 *
 *  SÉCURITÉ :
 *   - le fichier est validé par SON CONTENU (sniff DER / PEM / XML + analyse
 *     ASN.1 réelle), jamais par la seule extension ;
 *   - la clé privée éventuelle (.p12/.pfx) n'est JAMAIS extraite ni
 *     enregistrée en clair : seul le certificat public est lu pour ses
 *     métadonnées, et le fichier complet est chiffré au repos par l'API
 *     (storage/tampons/certificat-…, AES-256-GCM — même discipline que les
 *     fiches de paie) ;
 *   - aucune vérification de chaîne de confiance n'est exigée à l'import
 *     (un certificat auto-signé de démonstration est accepté) : l'objet de
 *     la fonction est de LIRE et d'IDENTIFIER le certificat fourni.
 * ============================================================================
 */
import * as forge from "node-forge";
import { spawn } from "child_process";

/** Extensions acceptées (« et tout autre format compatible »). */
export const EXTENSIONS_CERTIFICAT = [
  "p12",
  "pfx",
  "pkcs7",
  "p7b",
  "p7c",
  "p7s",
  "p7m",
  "xml",
  "ps7x",
  "pem",
  "cer",
  "crt",
  "der",
] as const;

export function estExtensionCertificat(nom: string): boolean {
  const m = String(nom ?? "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return Boolean(m && (EXTENSIONS_CERTIFICAT as readonly string[]).includes(m[1]));
}

// ---------------------------------------------------------------------------
// (NOUVEAU Task 222) CLÉ PRIVÉE ASSOCIÉE — fichier séparé (.pem/.key/.der)
// ---------------------------------------------------------------------------

/**
 * Extensions acceptées pour un FICHIER DE CLÉ PRIVÉE importé séparément :
 *  - .pem/.key — PEM PKCS#1 (« RSA PRIVATE KEY »), PKCS#8 (« PRIVATE KEY »),
 *    PKCS#8 chiffré (« ENCRYPTED PRIVATE KEY ») ou clé chiffrée PEM historique
 *    (en-tête DEK-Info) ;
 *  - .der — mêmes structures en binaire.
 */
export const EXTENSIONS_CLE_PRIVEE = ["pem", "key", "der"] as const;

export function estExtensionClePrivee(nom: string): boolean {
  const m = String(nom ?? "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return Boolean(m && (EXTENSIONS_CLE_PRIVEE as readonly string[]).includes(m[1]));
}

/** Métadonnées publiques extraites d'une clé privée importée. */
export interface InfosClePrivee {
  /** « RSA » (pleinement pris en charge) ou « EC »/autre (stockée, non appariée). */
  type: string;
  /** Taille de la clé en bits (RSA uniquement, null sinon). */
  bits: number | null;
  /** Empreinte SHA-256 de la CLÉ PUBLIQUE (hex minuscules) — comparable entre
   * un certificat et une clé (identique quand ils vont ensemble). */
  empreintePublique: string;
  /** VRAI si le fichier est protégé par un mot de passe. */
  protegee: boolean;
  /** La clé privée forge (objet serveur — JAMAIS sérialisé vers l'interface). */
  cle: forge.pki.PrivateKey;
}

/** Métadonnées publiques extraites du certificat. */
export interface InfosCertificat {
  format: string; // PKCS#12 | PKCS#7 | XML-DSig | X.509
  sujet: string; // titulaire (CN, O, OU, C…)
  emetteur: string; // autorité de certification
  serie: string; // numéro de série (hex majuscules)
  valideDu: Date;
  valideAu: Date;
  empreinte: string; // SHA-256 du certificat (hex minuscules)
  nbCertificats: number; // nombre de certificats lus dans le conteneur
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/** Buffer Node → chaîne binaire forge (latin1). */
function versBinaire(octets: Buffer): string {
  return octets.toString("latin1");
}

/** Type de conteneur détecté par les premiers octets (jamais l'extension). */
type TypeContenu = "DER" | "PEM" | "XML" | "INCONNU";

function snifferContenu(octets: Buffer): TypeContenu {
  if (!octets || octets.length < 2) return "INCONNU";
  // ASN.1 SEQUENCE (30 xx / 30 8x …) : PKCS#7, PKCS#12, certificat DER —
  // forme courte (30 0x) comme forme longue (30 81/82…).
  if (octets[0] === 0x30) return "DER";
  const tete = octets.subarray(0, 64).toString("latin1").replace(/^\uFEFF/, "").trimStart();
  if (tete.startsWith("-----BEGIN")) return "PEM";
  if (tete.startsWith("<")) return "XML";
  return "INCONNU";
}

/** Champs « nom=valeur » lisible d'un nom distingué (sujet ou émetteur). */
function nomLisible(nom: forge.pki.Certificate["subject"]): string {
  return nom.attributes
    .map((a) => `${a.shortName || a.name}=${String(a.value)}`)
    .join(", ");
}

/**
 * (NOUVEAU Task 222) Empreinte SHA-256 (hex) de la CLÉ PUBLIQUE — dérivée du
 * DER SubjectPublicKeyInfo : une clé privée et le certificat correspondant
 * produisent LA MÊME empreinte (base technique de l'appariement affiché).
 */
export function empreintePubliqueForge(pubOuCert: forge.pki.PublicKey | forge.pki.Certificate): string {
  const pub = (pubOuCert as forge.pki.Certificate).publicKey ?? (pubOuCert as forge.pki.PublicKey);
  const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(pub as forge.pki.PublicKey)).data;
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

/** Empreinte SHA-256 (hex) des octets DER du certificat. */
function empreinteCertificat(cert: forge.pki.Certificate): string {
  const asn1 = forge.pki.certificateToAsn1(cert);
  const der = forge.asn1.toDer(asn1).data;
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

function infosDepuisCertificat(
  cert: forge.pki.Certificate,
  format: string,
  nbCertificats: number
): InfosCertificat {
  return {
    format,
    sujet: nomLisible(cert.subject),
    emetteur: nomLisible(cert.issuer),
    serie: String(cert.serialNumber || "").toUpperCase(),
    valideDu: new Date(cert.validity.notBefore.getTime()),
    valideAu: new Date(cert.validity.notAfter.getTime()),
    empreinte: empreinteCertificat(cert),
    nbCertificats,
  };
}

/** Premier certificat exploitable d'une liste (forge renvoie aussi des CRL…). */
function premierCertificat(liste: unknown[]): forge.pki.Certificate | null {
  for (const c of liste) {
    if (c && typeof c === "object" && "subject" in c && "validity" in c) {
      return c as forge.pki.Certificate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lecteurs par famille
// ---------------------------------------------------------------------------

/**
 * PKCS#12 (.p12/.pfx) : le mot de passe protège l'intégralité du coffre.
 *
 * (CORRECTIF Task 221 — « mot de passe correct rejeté à tort ») : l'ANCIENNE
 * version lisait `sacs.certBag` alors que `getBags({ bagType })` renvoie la
 * carte CLÉE PAR L'OID (« 1.2.840.113549.1.12.10.1.3 ») — jamais par le nom
 * d'OID de forge. Résultat : AUCUN certificat n'était jamais extrait d'aucun
 * coffre .p12/.pfx (même avec le BON mot de passe), et l'import ne réussissait
 * que par le repli `openssl` CLI — absent sur les postes Windows des
 * utilisateurs — d'où l'erreur systématique « mot de passe incorrect ou
 * fichier corrompu ». Le balayage DIRECT des safeBags décodés est conservé
 * en filet ultime (insensible à la forme de la carte renvoyée).
 */
function lirePkcs12(
  asn1: forge.asn1.Asn1,
  motDePasse: string | undefined
): { cert: forge.pki.Certificate; total: number } | null {
  // motDePasse undefined = coffre « sans mot de passe » : forge échoue sur le
  // MAC avec undefined (clé dérivée incohérente) — la chaîne vide est la
  // valeur correcte pour un coffre exporté sans mot de passe.
  const motsDePasse: (string | undefined)[] = motDePasse ? [motDePasse] : ["", undefined];
  for (const strict of [true, false]) {
    for (const essai of motsDePasse) {
      let p12: ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>;
      try {
        // forge accepte (asn1, password) OU (asn1, strict, password) — NB :
        // la chaîne vide EST un mot de passe valide (coffre exporté sans
        // protection) : on la distingue de undefined (mot de passe non saisi).
        p12 =
          essai !== undefined
            ? forge.pkcs12.pkcs12FromAsn1(asn1, strict, essai)
            : forge.pkcs12.pkcs12FromAsn1(asn1, strict);
      } catch {
        continue; // MAC refusé / structure refusée pour CET essai — on tente le suivant
      }
      const sacs = p12.getBags({ bagType: forge.pki.oids.certBag }) as unknown as Record<
        string,
        { cert?: forge.pki.Certificate }[] | undefined
      >;
      const bruts: { cert?: forge.pki.Certificate }[] = [
        ...(sacs[forge.pki.oids.certBag] ?? []), // forme DOCUMENTÉE : clé = OID
        ...((sacs as { certBag?: { cert?: forge.pki.Certificate }[] }).certBag ?? []), // repli historique (nom d'OID forge)
      ];
      const tous = bruts
        .map((b) => b.cert)
        .filter(Boolean) as forge.pki.Certificate[];
      // Filet ULTIME : balayage direct des sacs décodés (aucune hypothèse
      // sur la carte renvoyée par getBags).
      if (!tous.length) {
        for (const sc of p12.safeContents) {
          for (const b of sc.safeBags) {
            if (b.cert) tous.push(b.cert as forge.pki.Certificate);
          }
        }
      }
      const cert = premierCertificat(tous);
      if (cert) return { cert, total: tous.length };
    }
  }
  return null;
}

/**
 * (CORRECTIF Task 221) Diagnostic du MAC d'un coffre PKCS#12 : distingue un
 * mot de passe FAUX (MAC refusé) d'un problème de STRUCTURE (PFX indécodable).
 * Renvoie true (MAC vérifié — mot de passe correct), false (MAC refusé —
 * mot de passe incorrect) ou null (indéterminable : structure illisible ou
 * variantes MAC non supportées).
 */
function diagnosticMacPkcs12(
  asn1: forge.asn1.Asn1,
  motDePasse: string | undefined
): boolean | null {
  for (const essai of [motDePasse ?? "", motDePasse]) {
    for (const strict of [true, false]) {
      try {
        forge.pkcs12.pkcs12FromAsn1(asn1, strict, essai);
        return true; // le coffre s'ouvre : mot de passe correct
      } catch (e) {
        const msg = String((e as Error)?.message ?? "");
        if (msg.includes("MAC could not be verified")) return false; // MAC refusé
        // autre erreur (structure, chiffrement non supporté…) : essai suivant
      }
    }
  }
  return null;
}

/**
 * PKCS#7 / CMS (.pkcs7/.p7b/.p7c/.p7s/.p7m) : d'abord le lecteur intégré de
 * forge, puis un décodage manuel des certificats du SignedData (couvre les
 * fichiers « certificats seuls » et les variantes de producteurs).
 */
function lirePkcs7(
  asn1: forge.asn1.Asn1
): { cert: forge.pki.Certificate; total: number } | null {
  try {
    const msg = forge.pkcs7.messageFromAsn1(asn1);
    const certs = ((msg as { certificates?: unknown[] }).certificates ?? []) as unknown[];
    const cert = premierCertificat(certs);
    if (cert) return { cert, total: certs.length };
  } catch {
    /* repli manuel ci-dessous */
  }
  // ContentInfo : SEQUENCE { OID, [0] SignedData }
  try {
    const contenu = asn1.value?.[1];
    const interne = Array.isArray(contenu) ? contenu[0] : null;
    if (!interne || !Array.isArray(interne.value)) return null;
    // SignedData : SEQUENCE { version, digestAlgorithms, encapContentInfo,
    // [0] certificates, [1] crls, signerInfos } — on cherche le champ [0].
    for (const champ of interne.value as forge.asn1.Asn1[]) {
      if (
        champ.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
        champ.type === 0 &&
        Array.isArray(champ.value)
      ) {
        const certs: forge.pki.Certificate[] = [];
        for (const bloc of champ.value) {
          try {
            certs.push(forge.pki.certificateFromAsn1(bloc));
          } catch {
            /* élément non certificat (autre), ignoré */
          }
        }
        const cert = premierCertificat(certs);
        if (cert) return { cert, total: certs.length };
      }
    }
  } catch {
    /* non décodable */
  }
  return null;
}

/** Certificat X.509 seul (DER ou PEM). */
function lireX509(asn1: forge.asn1.Asn1): forge.pki.Certificate | null {
  try {
    return forge.pki.certificateFromAsn1(asn1);
  } catch {
    return null;
  }
}

/** Certificats embarqués dans un XML-DSig (.xml/.ps7x). */
function lireXmlDsigs(octets: Buffer): { cert: forge.pki.Certificate; total: number } | null {
  const texte = octets.toString("utf8");
  const certs: forge.pki.Certificate[] = [];
  const pousser = (base64: string) => {
    const brut = base64.replace(/\s+/g, "");
    if (brut.length < 100) return;
    try {
      const asn1 = forge.asn1.fromDer(Buffer.from(brut, "base64").toString("latin1"));
      const c = lireX509(asn1);
      if (c) certs.push(c);
    } catch {
      /* bloc non certificat, ignoré */
    }
  };
  // 1) éléments X509Certificate (tout préfixe d'espace de noms).
  const baliseX509 = /<[\w.:-]*X509Certificate\b[^>]*>([\s\S]*?)<\//g;
  let m: RegExpExecArray | null;
  while ((m = baliseX509.exec(texte)) !== null) pousser(m[1]);
  // 2) repli : tout contenu de balise ressemblant à un blob base64 long
  //    (couvre les enveloppes .ps7x embarquant un PKCS#7 encodé).
  if (!certs.length) {
    const blob = /<[^/!?][^>]*>([\sA-Za-z0-9+/=]{400,})<\/[^>]+>/g;
    while ((m = blob.exec(texte)) !== null) pousser(m[1]);
  }
  const cert = premierCertificat(certs);
  if (!cert) return null;
  return { cert, total: certs.length };
}

// ---------------------------------------------------------------------------
// Repli PKCS#12 moderne : node-forge ne sait pas déchiffrer les coffres
// PBES2/AES (défaut d'OpenSSL 3.x et des outillages récents) — quand un .p12
// refuse de s'ouvrir par forge, on tente le binaire « openssl » s'il existe
// sur le serveur (le mot de passe transite par une variable d'environnement
// du processus enfant, jamais dans la ligne de commande).
// ---------------------------------------------------------------------------

/**
 * Repli PKCS#12 moderne : node-forge ne sait pas déchiffrer TOUS les coffres
 * (PRF exotiques, scrypt…) — quand un .p12 refuse de s'ouvrir par forge, on
 * tente le binaire « openssl » s'il existe sur le serveur (le mot de passe
 * transite par une variable d'environnement du processus enfant, jamais dans
 * la ligne de commande).
 *
 * (MODIFIÉ Task 221) : la fonction renvoie désormais un DIAGNOSTIC
 * { certificat, motDePasseInvalide, binaireAbsent } au lieu d'un simple
 * certificat, afin de distinguer un mot de passe FAUX (signature « Mac verify
 * error » d'openssl) d'un coffre réellement illisible — et de ne PLUS blâmer
 * le mot de passe lorsque le fichier et le mot de passe sont valides mais que
 * le repli n'est tout simplement pas disponible (openssl absent sur Windows).
 */
interface RepliOpenssl {
  certificat: forge.pki.Certificate | null;
  /** openssl a explicitement refusé le mot de passe (« Mac verify error »). */
  motDePasseInvalide: boolean;
  /** le binaire openssl est absent (poste Windows typique). */
  binaireAbsent: boolean;
}

function tenterOpensslUneFois(
  octets: Buffer,
  motDePasse: string,
  optionsExtra: string[]
): Promise<{ sortie: string; erreur: string; motDePasseInvalide: boolean; binaireAbsent: boolean }> {
  return new Promise((resolution) => {
    let enfant;
    try {
      enfant = spawn(
        "openssl",
        // NB : pas d'option -inform (absente de certains builds restreints) —
        // openssl auto-détecte le DER sur l'entrée standard.
        ["pkcs12", "-passin", "env:AUTO_RH_P12_MDP", "-nokeys", ...optionsExtra],
        {
          env: { ...process.env, AUTO_RH_P12_MDP: motDePasse },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } catch {
      resolution({ sortie: "", erreur: "", motDePasseInvalide: false, binaireAbsent: true });
      return;
    }
    let sortie = "";
    let erreur = "";
    const minuterie = setTimeout(() => enfant.kill(), 10_000);
    enfant.stdout.on("data", (m: Buffer) => {
      sortie += m.toString("utf8");
    });
    enfant.stderr.on("data", (m: Buffer) => {
      erreur += m.toString("utf8");
    });
    enfant.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(minuterie);
      // ENOENT = binaire absent (Windows sans openssl installé) : signalé
      // SANS blâmer le mot de passe.
      resolution({
        sortie: "",
        erreur: String(e?.message ?? e),
        motDePasseInvalide: false,
        binaireAbsent: e?.code === "ENOENT",
      });
    });
    enfant.on("close", () => {
      clearTimeout(minuterie);
      resolution({
        sortie,
        erreur,
        // message canonique d'openssl pour un MAC refusé :
        motDePasseInvalide: /mac verify error|invalid password/i.test(erreur),
        binaireAbsent: false,
      });
    });
    enfant.stdin.on("error", () => {
      /* openssl absent : le close/error final décidera */
    });
    enfant.stdin.write(octets);
    enfant.stdin.end();
  });
}

async function lirePkcs12ViaOpenssl(
  octets: Buffer,
  motDePasse: string
): Promise<RepliOpenssl> {
  const vide = { certificat: null as forge.pki.Certificate | null, motDePasseInvalide: false, binaireAbsent: false };
  // 1ʳᵉ tentative : invocation standard.
  const premiere = await tenterOpensslUneFois(octets, motDePasse, []);
  if (premiere.binaireAbsent) {
    return { ...vide, binaireAbsent: true };
  }
  if (premiere.sortie.includes("BEGIN CERTIFICATE")) {
    try {
      return { ...vide, certificat: forge.pki.certificateFromPem(premiere.sortie) };
    } catch {
      /* PEM décodé mais certificat non exploitable → tentative -legacy */
    }
  } else if (premiere.motDePasseInvalide) {
    return { ...vide, motDePasseInvalide: true };
  }
  // 2ᵉ tentative : fournisseur « legacy » (coffres RC2 des anciens outils,
  // OpenSSL 3.x) — sans effet si l'option n'existe pas dans ce build.
  const seconde = await tenterOpensslUneFois(octets, motDePasse, ["-legacy"]);
  if (seconde.sortie.includes("BEGIN CERTIFICATE")) {
    try {
      return { ...vide, certificat: forge.pki.certificateFromPem(seconde.sortie) };
    } catch {
      return vide;
    }
  }
  return { ...vide, motDePasseInvalide: premiere.motDePasseInvalide || seconde.motDePasseInvalide };
}

// ---------------------------------------------------------------------------
// (NOUVEAU Task 222) CLÉS PRIVÉES : extraction du coffre, appariement, lecteur
// ---------------------------------------------------------------------------

/**
 * (NOUVEAU Task 222) Extrait la CLÉ PRIVÉE d'un coffre PKCS#12 (.p12/.pfx).
 * Même discipline que lirePkcs12 (Task 221) : essais strict=true/false ×
 * mot de passe saisi / chaîne vide / undefined, lecture des sacs CLÉE PAR
 * L'OID (keyBag + pkcs8ShroudedKeyBag) et filet ULTIME par balayage direct
 * des safeBags décodés. forge déchiffre le sac de clé avec le mot de passe
 * du coffre (bag.key). Renvoie null si le coffre reste fermé.
 */
export function extraireClePriveePkcs12(
  octets: Buffer,
  motDePasse?: string
): forge.pki.PrivateKey | null {
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(versBinaire(octets));
  } catch {
    return null;
  }
  const motsDePasse: (string | undefined)[] = motDePasse ? [motDePasse] : ["", undefined];
  for (const strict of [true, false]) {
    for (const essai of motsDePasse) {
      let p12: ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>;
      try {
        p12 =
          essai !== undefined
            ? forge.pkcs12.pkcs12FromAsn1(asn1, strict, essai)
            : forge.pkcs12.pkcs12FromAsn1(asn1, strict);
      } catch {
        continue; // MAC refusé pour CET essai — essai suivant
      }
      const cles: forge.pki.PrivateKey[] = [];
      for (const type of [forge.pki.oids.keyBag, forge.pki.oids.pkcs8ShroudedKeyBag]) {
        const sacs = p12.getBags({ bagType: type }) as unknown as Record<
          string,
          { key?: forge.pki.PrivateKey }[] | undefined
        >;
        for (const sac of sacs[type] ?? []) if (sac.key) cles.push(sac.key);
        const parNom = (sacs as { keyBag?: { key?: forge.pki.PrivateKey }[]; pkcs8ShroudedKeyBag?: { key?: forge.pki.PrivateKey }[] });
        for (const sac of parNom.keyBag ?? []) if (sac.key) cles.push(sac.key);
        for (const sac of parNom.pkcs8ShroudedKeyBag ?? []) if (sac.key) cles.push(sac.key);
      }
      // Filet ULTIME : balayage direct des sacs décodés (aucune hypothèse
      // sur la forme de la carte renvoyée par getBags — leçon Task 221).
      if (!cles.length) {
        for (const sc of p12.safeContents) {
          for (const b of sc.safeBags) {
            if (b.key) cles.push(b.key as forge.pki.PrivateKey);
          }
        }
      }
      if (cles.length) return cles[0];
    }
  }
  return null;
}

/**
 * (NOUVEAU Task 222) Appariement FONCTIONNEL clé privée ↔ certificat : la clé
 * signe un bloc de test, la clé publique du certificat vérifie la signature.
 * Une clé sans rapport LÈVE parfois (« Encryption block is invalid ») au lieu
 * de produire une vérification fausse — toute exception compte comme
 * non-appariement. Les clés non RSA ne sont pas appariées (undefined).
 */
export function cleCorrespondAuCertificat(
  cle: forge.pki.PrivateKey,
  cert: forge.pki.Certificate
): boolean | undefined {
  const pub = cert.publicKey as { verify?: unknown; n?: unknown } | undefined;
  if (!pub || !("n" in pub)) return undefined; // clés EC/autres : non appariées
  try {
    const md = forge.md.sha256.create();
    md.update("auto-rh-appariement-cle-certificat");
    const signature = (cle as forge.pki.rsa.PrivateKey).sign(md);
    return cert.publicKey.verify(md.digest().bytes(), signature) === true;
  } catch {
    return false; // déchiffrement incohérent = clé ≠ certificat
  }
}

/**
 * (NOUVEAU Task 222) Lecteur de FICHIER DE CLÉ PRIVÉE (.pem/.key/.der).
 * Familles prises en charge :
 *  - PEM PKCS#1 « RSA PRIVATE KEY » (clair ou chiffré historique DEK-Info) ;
 *  - PEM PKCS#8 « PRIVATE KEY » (clair) / « ENCRYPTED PRIVATE KEY » (chiffré) ;
 *  - DER PKCS#8 ou PKCS#1.
 * Lève une ERREUR (message français classé) si le fichier est illisible,
 * protégé sans mot de passe saisi, ou si le mot de passe est refusé.
 */
export async function parserClePrivee(
  nomFichier: string,
  octets: Buffer,
  motDePasse?: string
): Promise<InfosClePrivee> {
  if (!octets || octets.length < 16) {
    throw new Error("Fichier vide ou trop court pour contenir une clé privée.");
  }
  const type = snifferContenu(octets);

  // ---- PEM (.pem/.key texte) -------------------------------------------------
  if (type === "PEM") {
    const texte = octets.toString("utf8");
    const blocs = (() => {
      try {
        return forge.pem.decode(texte);
      } catch {
        return [];
      }
    })();
    const blocCle = blocs.find((b) =>
      ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY"].includes(b.type)
    );
    if (!blocCle) {
      throw new Error(
        "Fichier de clé privée illisible : aucun bloc « PRIVATE KEY », « RSA PRIVATE KEY » ou « ENCRYPTED PRIVATE KEY » reconnu."
      );
    }
    let cle: forge.pki.PrivateKey | null = null;
    let protegee = false;
    // 1) clés chiffrées : ENCRYPTED PRIVATE KEY (PKCS#8) ou RSA PRIVATE KEY
    //    avec en-tête DEK-Info → decryptRsaPrivateKey (null si mot de passe refusé).
    if (blocCle.type === "ENCRYPTED PRIVATE KEY" || blocCle.headers?.DEKInfo) {
      protegee = true;
      if (!motDePasse) {
        throw new Error("Clé privée protégée : saisissez le mot de passe de la clé privée.");
      }
      try {
        cle = forge.pki.decryptRsaPrivateKey(texte, motDePasse);
      } catch {
        cle = null;
      }
      if (!cle) {
        throw new Error(
          "Mot de passe de la clé privée incorrect : vérifiez le mot de passe du fichier de clé puis réessayez."
        );
      }
    } else {
      // 2) clés claires : PKCS#8 « PRIVATE KEY » ou PKCS#1 « RSA PRIVATE KEY ».
      try {
        cle = forge.pki.privateKeyFromPem(texte);
      } catch {
        cle = null;
      }
      if (!cle && motDePasse) {
        // certaines clés « claires » sont en réalité chiffrées sans DEK-Info
        // lisible : tenter le déchiffrement avec le mot de passe fourni.
        try {
          cle = forge.pki.decryptRsaPrivateKey(texte, motDePasse);
          protegee = Boolean(cle);
        } catch {
          cle = null;
        }
      }
      if (!cle) {
        throw new Error(
          "Fichier de clé privée illisible : structure PKCS#8/PKCS#1 attendue (fichier corrompu ou chiffrement non pris en charge)."
        );
      }
    }
    return decrireClePrivee(cle, protegee);
  }

  // ---- DER (.der/.key binaire) -----------------------------------------------
  if (type === "DER") {
    let asn1: forge.asn1.Asn1;
    try {
      asn1 = forge.asn1.fromDer(versBinaire(octets));
    } catch {
      throw new Error("Fichier binaire illisible : structure ASN.1 attendue introuvable.");
    }
    // PKCS#8 PrivateKeyInfo : SEQUENCE { INTEGER version, SEQUENCE algorithme,
    // OCTET STRING privateKey } — déballage puis lecture RSAPrivateKey.
    const derCle = (() => {
      try {
        const v = asn1.value;
        if (
          v?.length === 3 &&
          v[0].type === forge.asn1.Type.INTEGER &&
          v[1].type === forge.asn1.Type.SEQUENCE &&
          v[2].type === forge.asn1.Type.OCTET_STRING
        ) {
          return forge.asn1.fromDer(String(v[2].value));
        }
      } catch {
        /* pas un PrivateKeyInfo */
      }
      return null;
    })();
    for (const essai of [derCle, asn1]) {
      if (!essai) continue;
      try {
        const cle = forge.pki.privateKeyFromAsn1(essai);
        return decrireClePrivee(cle, false);
      } catch {
        /* essai suivant */
      }
    }
    throw new Error(
      "Fichier de clé privée illisible : structure PKCS#8 ou PKCS#1 attendue (fichier corrompu ou chiffrement non pris en charge)."
    );
  }

  throw new Error(
    "Type de fichier non reconnu pour une clé privée : déposez un fichier .pem, .key ou .der (PKCS#8 ou PKCS#1)."
  );
}

/** (NOUVEAU Task 222) Description publique d'une clé privée déjà décodée. */
function decrireClePrivee(cle: forge.pki.PrivateKey, protegee: boolean): InfosClePrivee {
  const rsa = cle as { n?: { bitLength?: () => number } };
  const estRsa = Boolean(rsa && rsa.n && typeof rsa.n.bitLength === "function");
  return {
    type: estRsa ? "RSA" : "clé asymétrique",
    bits: estRsa ? rsa.n!.bitLength!() : null,
    empreintePublique: empreintePubliqueForge(cle as forge.pki.PrivateKey),
    protegee,
    cle,
  };
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

/**
 * (NOUVEAU Task 222) Analyse un fichier de signature électronique et renvoie
 * l'OBJET certificat forge + son format — la matière première de l'appariement
 * clé ↔ certificat. Lève les MÊMES erreurs que parserSignatureElectronique.
 */
export async function extraireCertificatForge(
  nomFichier: string,
  octets: Buffer,
  motDePasse?: string
): Promise<{ cert: forge.pki.Certificate; format: string; total: number }> {
  if (!octets || octets.length < 10) {
    throw new Error("Fichier vide ou trop court pour contenir une signature électronique.");
  }
  const ext = (String(nomFichier ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
  const type = snifferContenu(octets);

  if (type === "XML") {
    const lu = lireXmlDsigs(octets);
    if (lu) return { cert: lu.cert, format: "XML-DSig", total: lu.total };
    throw new Error(
      "XML illisible : aucun certificat X509Certificate trouvé dans le document (XML-DSig attendu)."
    );
  }

  if (type === "PEM") {
    const pem = octets.toString("utf8");
    // Blocs CERTIFICATE du PEM.
    const blocs = (() => {
      try {
        return forge.pem.decode(pem).filter((b) => b.type === "CERTIFICATE");
      } catch {
        return [];
      }
    })();
    const certs: forge.pki.Certificate[] = [];
    for (const bloc of blocs) {
      // pem.decode() renvoie le corps binaire (DER) de chaque bloc.
      try {
        certs.push(forge.pki.certificateFromAsn1(forge.asn1.fromDer(bloc.body)));
      } catch {
        /* bloc illisible, ignoré */
      }
    }
    // PKCS#7 au format PEM (en-tête différent).
    if (!certs.length) {
      try {
        const msg = forge.pkcs7.messageFromPem(pem);
        const lu = premierCertificat(((msg as { certificates?: unknown[] }).certificates ?? []) as unknown[]);
        if (lu) return { cert: lu, format: "PKCS#7", total: 1 };
      } catch {
        /* pas un PKCS#7 PEM */
      }
    }
    const cert = premierCertificat(certs);
    if (cert) return { cert, format: "X.509", total: certs.length };
    throw new Error("PEM illisible : aucun bloc CERTIFICATE reconnu dans le fichier.");
  }

  if (type === "DER") {
    let asn1: forge.asn1.Asn1;
    try {
      asn1 = forge.asn1.fromDer(versBinaire(octets));
    } catch {
      throw new Error("Fichier binaire illisible : structure ASN.1 attendue introuvable.");
    }
    const estCoffreAnnonce = ["p12", "pfx"].includes(ext);
    // Le fichier RESSEMBLE-t-il à un coffre PKCS#12 ? PFX ::= SEQUENCE {
    // version INTEGER 3, authSafe ContentInfo, macData OPTIONAL } — un
    // ContentInfo PKCS#7 commence par un OID (1.2.840.113549.1.7.x) et un
    // certificat X.509 par version/serial : la version INTEGER = 3 est le
    // marqueur fiable d'un conteneur PKCS#12.
    const ressemblePkcs12 = (() => {
      try {
        const premier = asn1.value?.[0];
        const tampon = premier?.value as { length?: () => number; charCodeAt?: (i: number) => number } | undefined;
        return (
          premier?.type === forge.asn1.Type.INTEGER &&
          typeof tampon?.length === "function" &&
          tampon.length() === 1 &&
          typeof tampon.charCodeAt === "function" &&
          tampon.charCodeAt(0) === 3
        );
      } catch {
        return false;
      }
    })();
    // (MODIFIÉ v0.2.97 — CORRECTIF « exemples de signature et mots de passe
    // non acceptés ») l'ANCIENNE logique court-circuitait les lecteurs
    // PKCS#7 / X.509 dès qu'un mot de passe était fourni : un .p7s/.p7m/
    // .pkcs7/.cer importé AVEC un mot de passe saisi (champ rempli pour le
    // .p12 précédent, ou par précaution) était rejeté à tort avec le message
    // « Mot de passe PKCS#12 incorrect » — alors que le mot de passe n'a
    // AUCUNE influence sur ces formats. DÉSORMAIS : les trois familles sont
    // TOUJOURS essayées dans l'ordre PKCS#12 → PKCS#7 → X.509, quel que soit
    // le mot de passe ; l'erreur « mot de passe » n'est levée que lorsque le
    // fichier est RÉELLEMENT un coffre PKCS#12 (extension .p12/.pfx ou
    // structure PFX).
    // 1) PKCS#12 via forge (coffres PBE SHA-1/3DES historiques ET PBES2
    //    PKDF2/AES — node-forge ≥ 1.3).
    const p12 = lirePkcs12(asn1, motDePasse);
    if (p12) return { cert: p12.cert, format: "PKCS#12", total: p12.total };
    // 2) PKCS#7 / CMS — TOUJOURS essayé (le mot de passe ne le concerne pas).
    const p7 = lirePkcs7(asn1);
    if (p7) return { cert: p7.cert, format: "PKCS#7", total: p7.total };
    // 3) Certificat X.509 nu en DER (.cer/.crt/.der) — TOUJOURS essayé.
    const x509 = lireX509(asn1);
    if (x509) return { cert: x509, format: "X.509", total: 1 };
    // 4) Aucune famille lisible :
    //    - coffre PKCS#12 (annoncé par l'extension ou reconnu par sa
    //      structure) → repli PBES2 moderne via le binaire openssl (coffres
    //      que forge refuse : PRF exotique, scrypt…), puis erreur CLASSÉE :
    //      mot de passe incorrect SEULEMENT quand un des deux moteurs l'a
    //      explicitement refusé — jamais une erreur « mot de passe » quand le
    //      fichier et le mot de passe sont valides (Task 221) ;
    //    - sinon → erreur de FORMAT générique (sans fausse piste mot de
    //      passe — c'était la confusion signalée par les utilisateurs).
    if (estCoffreAnnonce || ressemblePkcs12) {
      const ossl = await lirePkcs12ViaOpenssl(octets, motDePasse ?? "");
      if (ossl.certificat) return { cert: ossl.certificat, format: "PKCS#12", total: 1 };
      const macForge = diagnosticMacPkcs12(asn1, motDePasse);
      if (ossl.motDePasseInvalide || macForge === false) {
        // SEUL cas « mot de passe incorrect » : refus EXPLICITE d'un moteur.
        throw new Error(
          motDePasse
            ? "Mot de passe PKCS#12 incorrect : vérifiez le mot de passe du certificat (.p12/.pfx) puis réessayez."
            : "Fichier PKCS#12 protégé : saisissez le mot de passe du certificat (.p12/.pfx)."
        );
      }
      if (!motDePasse) {
        throw new Error(
          "Fichier PKCS#12 protégé : saisissez le mot de passe du certificat (.p12/.pfx)."
        );
      }
      // Fichier ET mot de passe vraisemblablement corrects mais aucun
      // moteur n'a pu extraire le certificat : ne JAMAIS blâmer le mot de
      // passe (c'était l'erreur signalée par les utilisateurs).
      throw new Error(
        "Fichier PKCS#12 illisible : le coffre .p12/.pfx ne contient aucun certificat exploitable (fichier corrompu ou chiffrement non pris en charge par ce serveur)."
      );
    }
    if (motDePasse) {
      // mot de passe fourni mais le fichier n'est PAS un coffre : les
      // lecteurs ci-dessus ont déjà échoué → format réellement illisible.
      throw new Error(
        "Format de signature non reconnu (le mot de passe saisi ne s'applique qu'aux coffres .p12/.pfx) : PKCS#7, PKCS#12, XML-DSig ou certificat X.509 attendu."
      );
    }
    throw new Error(
      "Format de signature non reconnu : PKCS#7, PKCS#12, XML-DSig ou certificat X.509 attendu."
    );
  }

  throw new Error(
    "Type de fichier non reconnu : déposez un fichier .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx (ou .pem/.cer/.crt/.der/.p7b)."
  );
}

/**
 * (Task 222) Point d'entrée HISTORIQUE conservé : analyse un fichier de
 * signature électronique et renvoie les MÉTADONNÉES du certificat qu'il
 * contient. Délègue désormais à extraireCertificatForge (même analyse,
 * mêmes erreurs) — utile aux interfaces qui n'ont besoin que de l'affichage.
 */
export async function parserSignatureElectronique(
  nomFichier: string,
  octets: Buffer,
  motDePasse?: string
): Promise<InfosCertificat> {
  const extrait = await extraireCertificatForge(nomFichier, octets, motDePasse);
  return infosDepuisCertificat(extrait.cert, extrait.format, extrait.total);
}
