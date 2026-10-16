/**
 * ============================================================================
 *  NOUVEAU (Task 224) — MOTEUR DE SIGNATURE ÉLECTRONIQUE PAdES (PDF)
 * ============================================================================
 *
 *  Signature cryptographique de documents PDF au format PAdES (ETSI EN 319
 *  142 / niveau B-B) réalisée LOCALEMENT par le serveur, sans dépendance
 *  externe obligatoire :
 *
 *    - lecture du coffre PKCS#12 / PFX (.p12, .pfx) via OpenSSL 3 CLI —
 *      supporte TOUS les algorithmes modernes (PBES2 / PBKDF2 / AES-128/256)
 *      contrairement à node-forge qui échoue sur les coffres générés par les
 *      versions récentes d'OpenSSL (« mot de passe incorrect » alors qu'il
 *      est bon) ;
 *    - feuille et chaîne extraites DÉTERMINISTEMENT (-clcerts / -cacerts),
 *      indépendamment de l'ordre de sérialisation du coffre ;
 *    - insertion d'un champ de signature (AcroForm + widget rect nul =
 *      signature invisible) et d'un dictionnaire /Sig /SubFilter
 *      adbe.pkcs7.detached avec /ByteRange et /Contents à gabarit fixe ;
 *    - SÉQUENCE PAdES CORRECTE (MODIFIÉ Task 224) : le ByteRange est
 *      FINALISÉ DANS LE BUFFER AVANT le calcul du condensé — la version
 *      antérieure signait le document portant encore les MARQUEURS de
 *      gabarit, donc la vérification de notre propre signature échouait
 *      systématiquement (« Signature INVALIDE ») ; les valeurs sont
 *      réinjectées par REMPLACEMENT SÉQUENTIEL des marqueurs (les
 *      séparateurs réels de pdf-lib sont conservés, la longueur du fichier
 *      ne change jamais) ;
 *    - signature CMS/PKCS#7 détachée SHA-256 par OpenSSL 3 (`cms -sign`) —
 *      le mot de passe du COFFRE passe par STDIN (jamais en argv) et la clé
 *      est déchiffrée avant la signature : AUCUN -passin superflu (un
 *      `-passin stdin` sur clé sans mot de passe fait échouer openssl avec
 *      « Error reading password from BIO ») ;
 *    - VÉRIFICATION : reconstruction des plages ByteRange, condensé CMS via
 *      `cms -verify`, extraction du certificat signataire (sujet, émetteur,
 *      série, validité, empreinte SHA-256).
 *
 *  DISCIPLINE DE SÉCURITÉ : fichiers temporaires dans un dossier de travail
 *  privé 0700 (storage/signatures/travail/), SUPPRIMÉS en finally ; mots de
 *  passe jamais en ligne de commande ; aucun appel réseau pour la signature
 *  locale.
 * ============================================================================
 */
import "server-only";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import { decryptFromStorage } from "@/lib/storage-crypto";
import { getProjectRoot } from "@/lib/storage-dir";
import {
  RapportCms,
  signerCmsPur,
  verifierCmsPur,
} from "@/lib/cms-pur";
import {
  certificatsPkcs7Der,
  choisirFeuille,
  lireClePriveePur,
  ouvrirPkcs12Pur,
  type CoffrePur,
} from "@/lib/pkcs12-pur";

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

export interface MetadonneesCertificat {
  sujet: string;
  emetteur: string;
  serie: string;
  valideDu: Date | null;
  valideAu: Date | null;
  empreinte: string; // SHA-256 hex (sans espaces)
  algorithmeCle: string; // « RSA 2048 bits », « EC prime256v1 », « Ed25519 »…
}

export interface CoffreOuvert {
  certPem: string; // certificat SIGNATAIRE (feuille)
  chainePem: string; // éventuels certificats d'AC (PEM concaténés)
  clePem: string; // clé privée SANS mot de passe (usage éphémère uniquement)
  metadonnees: MetadonneesCertificat;
}

export interface OptionsSignaturePades {
  raison: string;
  emplacement: string;
  contact: string;
  nomSignataire: string;
  nomChamp?: string;
}

export interface RapportVerification {
  integrite: boolean;
  signataire: string;
  emetteur: string;
  serie: string;
  empreinte: string;
  valideDu: Date | null;
  valideAu: Date | null;
  certificatValide: boolean;
  message: string;
}

export class ErreurOpenssl extends Error {}

/* ------------------------------------------------------------------ */
/* Dossier de travail éphémère (privé 0700, effacé en finally)         */
/* ------------------------------------------------------------------ */

async function dossierTravail(): Promise<string> {
  const base = path.join(getProjectRoot(), "storage", "signatures", "travail");
  await fs.promises.mkdir(base, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.chmod(base, 0o700);
  } catch {
    // systèmes sans permissions POSIX : sans effet
  }
  return fs.promises.mkdtemp(path.join(base, "s-"));
}

/* ------------------------------------------------------------------ */
/* Exécution OpenSSL (REPLI) — secrets par STDIN, jamais en argv       */
/*                                                                     */
/* (MODIFIÉ Task 230) openssl CLI n'est PLUS JAMAIS obligatoire : le    */
/* moteur PUR (cms-pur.ts / pkcs12-pur.ts, crypto Node natif) couvre    */
/* l'import des coffres .p12/.pfx, des clés PEM/DER et la signature     */
/* CMS/PAdES. Le binaire n'est sollicité qu'en repli, résolu par un     */
/* chemin absolu si le PATH ne le contient pas (postes Windows,         */
/* services sans PATH complet — « spawn ENOENT » historique).           */
/* ------------------------------------------------------------------ */

let CHEMIN_OPENSSL: string | null | undefined;

/** Résout le binaire openssl : AUTO_RH_OPENSSL_BIN, puis PATH, puis
 *  emplacements standard Linux/macOS et installations Windows typiques. */
function resoudreBinaireOpenssl(): string | null {
  if (CHEMIN_OPENSSL !== undefined) return CHEMIN_OPENSSL;
  const candidats: string[] = [];
  if (process.env.AUTO_RH_OPENSSL_BIN) candidats.push(process.env.AUTO_RH_OPENSSL_BIN);
  candidats.push("openssl");
  candidats.push(
    "/usr/bin/openssl",
    "/usr/local/bin/openssl",
    "/bin/openssl",
    "/opt/homebrew/bin/openssl",
    "/opt/local/bin/openssl",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe"
  );
  for (const candidat of candidats) {
    try {
      const r = spawnSync(candidat, ["version"], { timeout: 5000, windowsHide: true });
      if (r.status === 0) {
        CHEMIN_OPENSSL = candidat;
        return candidat;
      }
    } catch {
      /* candidat suivant */
    }
  }
  CHEMIN_OPENSSL = null;
  return null;
}

/** openssl est-il disponible ? (les moteurs PURS rendent cette réponse
 *  ACCESSOIRE — l'application fonctionne intégralement sans openssl.) */
export function opensslDisponible(): boolean {
  return resoudreBinaireOpenssl() !== null;
}

function executerOpenssl(
  args: string[],
  entreeStdin: string | Buffer = ""
): Promise<{ sortie: Buffer; erreur: string }> {
  return new Promise((resolve, reject) => {
    const binaire = resoudreBinaireOpenssl();
    if (!binaire) {
      reject(
        new ErreurOpenssl(
          "Le binaire openssl n'est pas disponible sur ce serveur. CE N'EST PLUS BLOQUANT : le moteur de signature intégré (Task 230) gère .p12/.pfx, PEM/DER et PAdES sans openssl ; ce repli n'était utile qu'à un format exotique."
        )
      );
      return;
    }
    const proc = spawn(binaire, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" }, // dates en anglais (parsing)
    });
    let sortie = Buffer.alloc(0);
    let erreur = "";
    proc.stdout.on("data", (d: Buffer) => {
      sortie = Buffer.concat([sortie, d]);
    });
    proc.stderr.on("data", (d: Buffer) => {
      erreur += d.toString("utf8");
    });
    proc.on("error", (e) =>
      reject(
        new ErreurOpenssl(
          "OpenSSL est indisponible sur le serveur — la signature locale de documents exige openssl dans le PATH. Détail : " +
            e.message
        )
      )
    );
    proc.on("close", (code) => {
      if (code === 0) resolve({ sortie, erreur });
      else
        reject(
          new ErreurOpenssl(
            "Erreur OpenSSL (code " + code + ") : " + erreur.trim().split("\n").slice(-3).join(" — ")
          )
        );
    });
    if (entreeStdin) proc.stdin.write(entreeStdin);
    proc.stdin.end();
  });
}

/* ------------------------------------------------------------------ */
/* Lecture des PEM (blocs individuels)                                 */
/* ------------------------------------------------------------------ */

const MARQUE_CERT = "-----BEGIN CERTIFICATE-----";
const MARQUE_FIN_CERT = "-----END CERTIFICATE-----";
const RE_CLE_PRIVEE = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/;

function blocsCertificats(pem: string): string[] {
  const blocs: string[] = [];
  let i = pem.indexOf(MARQUE_CERT);
  while (i !== -1) {
    const fin = pem.indexOf(MARQUE_FIN_CERT, i);
    if (fin === -1) break;
    blocs.push(pem.slice(i, fin + MARQUE_FIN_CERT.length) + "\n");
    i = pem.indexOf(MARQUE_CERT, fin);
  }
  return blocs;
}

function blocClePrivee(pem: string): string {
  const m = RE_CLE_PRIVEE.exec(pem);
  return m ? m[0] + "\n" : "";
}

/* ------------------------------------------------------------------ */
/* Métadonnées d'un certificat PEM                                     */
/* ------------------------------------------------------------------ */

async function metadonneesDepuisPem(certPem: string): Promise<MetadonneesCertificat> {
  // (MODIFIÉ Task 230) lecture via crypto.X509Certificate — AUCUN spawn :
  // fonctionne sur tous les serveurs (Windows inclus) sans openssl.
  let cert: crypto.X509Certificate;
  try {
    cert = new crypto.X509Certificate(certPem);
  } catch (e) {
    throw new ErreurOpenssl(
      "Certificat illisible : le fichier ne contient pas un certificat X.509 valide. Détail : " +
        String((e as Error).message || e).slice(0, 200)
    );
  }
  const lisible = (nom: string): string =>
    nom
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");

  // Type de clé (RSA avec taille, EC avec courbe, Ed25519…)
  let algorithmeCle = "";
  try {
    const cle = crypto.createPublicKey(cert.publicKey);
    const details = cle.asymmetricKeyDetails as
      | { modulusLength?: number; namedCurve?: string }
      | undefined;
    if (cle.asymmetricKeyType === "rsa") {
      algorithmeCle = details?.modulusLength ? "RSA " + details.modulusLength + " bits" : "RSA";
    } else if (cle.asymmetricKeyType === "ec") {
      algorithmeCle = details?.namedCurve ? "EC " + details.namedCurve : "EC";
    } else if (cle.asymmetricKeyType === "ed25519") {
      algorithmeCle = "Ed25519";
    }
  } catch {
    algorithmeCle = "";
  }

  const valideDu = new Date(cert.validFrom);
  const valideAu = new Date(cert.validTo);
  return {
    sujet: lisible(cert.subject),
    emetteur: lisible(cert.issuer),
    serie: cert.serialNumber.toUpperCase().replace(/[^0-9A-F]/g, ""),
    valideDu: isNaN(valideDu.getTime()) ? null : valideDu,
    valideAu: isNaN(valideAu.getTime()) ? null : valideAu,
    empreinte: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
    algorithmeCle,
  };
}

/* ------------------------------------------------------------------ */
/* Ouverture d'un coffre / jeu certificat + clé                        */
/* ------------------------------------------------------------------ */

export interface SourceCertificat {
  /** Contenu du fichier certificat/coffre (DÉJÀ déchiffré du stockage). */
  donneesCertificat: Buffer;
  /** Mot de passe du coffre PKCS#12 (peut être vide). */
  motDePasse?: string;
  /** Contenu du fichier de clé privée séparé (si le certificat est nu). */
  donneesCle?: Buffer | null;
  /** Mot de passe de la clé privée séparée. */
  motDePasseCle?: string;
}

async function lireCleSeparee(
  donneesCle: Buffer,
  motDePasseCle: string,
  travail: string
): Promise<string> {
  // (MODIFIÉ Task 230) MOTEUR PUR — `openssl pkey` n'est plus requis :
  // crypto.createPrivateKey lit PEM (PKCS#1, PKCS#8 clair/chiffré, SEC1,
  // clé historique DEK-Info) et DER, avec mot de passe.
  try {
    const lu = lireClePriveePur(donneesCle, motDePasseCle);
    return lu.pemPkcs8;
  } catch (e) {
    const messagePur = String((e as Error).message || e);
    // Repli openssl UNIQUEMENT si le binaire existe (formats exotiques que
    // Node refuse) — sinon l'erreur pur classée en français est renvoyée.
    if (opensslDisponible()) {
      const fCle = path.join(travail, "cle-separee.key");
      await fs.promises.writeFile(fCle, donneesCle, { mode: 0o600 });
      const apercu = donneesCle.subarray(0, 512).toString("latin1");
      const chiffree = /ENCRYPTED|Proc-Type: 4,ENCRYPTED/.test(apercu);
      try {
        if (chiffree) {
          const r = await executerOpenssl(["pkey", "-in", fCle, "-passin", "stdin"], motDePasseCle);
          return r.sortie.toString("utf8");
        }
        const r = await executerOpenssl(["pkey", "-in", fCle]);
        return r.sortie.toString("utf8");
      } catch (e2) {
        const detail = String((e2 as Error).message || e2);
        if (/bad decrypt|invalid password|wrong password/i.test(detail)) {
          throw new ErreurOpenssl(
            "Mot de passe de la clé privée incorrect : la clé n'a pas pu être déverrouillée."
          );
        }
        throw new ErreurOpenssl(messagePur);
      }
    }
    throw new ErreurOpenssl(messagePur);
  }
}

/** La clé privée correspond-elle au certificat ? (comparaison SPKI — PUR) */
async function verifierPaireCertCle(
  certPem: string,
  clePem: string,
  travail: string
): Promise<void> {
  try {
    // (MODIFIÉ Task 230) comparaison des SubjectPublicKeyInfo DER via
    // crypto — aucun spawn, RSA et EC couverts.
    const cert = new crypto.X509Certificate(certPem);
    const cle = crypto.createPrivateKey(clePem);
    const spkiCert = cert.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const spkiCle = crypto.createPublicKey(cle).export({ type: "spki", format: "der" }) as Buffer;
    if (Buffer.compare(spkiCert, spkiCle) !== 0) {
      throw new ErreurOpenssl(
        "La clé privée fournie ne correspond PAS au certificat : le couple certificat/clé est incohérent. Importez le coffre (.p12/.pfx) qui contient les deux, ou la clé privée du MÊME certificat."
      );
    }
  } catch (e) {
    if (e instanceof ErreurOpenssl) throw e;
    // le contrôle de cohérence ne bloque jamais un couple exotique mais valide
  }
}

/**
 * Ouvre un certificat (PKCS#12/PFX, PEM, DER, PKCS#7) + sa clé privée
 * (incluse dans le coffre ou fournie séparément). Erreurs FRANÇAISES
 * classées : mot de passe incorrect, fichier illisible, clé absente,
 * paire incohérente.
 */
export async function ouvrirCertificat(src: SourceCertificat): Promise<CoffreOuvert> {
  const travail = await dossierTravail();
  try {
    const motDePasse = src.motDePasse ?? "";
    let certPem = "";
    let chainePem = "";
    let clePem = "";

    const estDer = src.donneesCertificat.length > 4 && src.donneesCertificat[0] === 0x30;
    const texte = src.donneesCertificat.subarray(0, 8192).toString("latin1");
    const estPemCert = texte.includes(MARQUE_CERT);
    const estPemCle = RE_CLE_PRIVEE.test(texte);

    if (estPemCert || estPemCle) {
      // ---- PEM : certificat et éventuellement clé dans le même fichier ----
      const fSource = path.join(travail, "source.pem");
      await fs.promises.writeFile(fSource, src.donneesCertificat, { mode: 0o600 });
      const lu = await fs.promises.readFile(fSource, "utf8");
      certPem = blocsCertificats(lu)[0] ?? "";
      chainePem = blocsCertificats(lu).slice(1).join("");
      clePem = blocClePrivee(lu);
      if (!clePem && src.donneesCle && src.donneesCle.length) {
        clePem = await lireCleSeparee(src.donneesCle, src.motDePasseCle ?? "", travail);
      }
    } else if (estDer) {
      // ---- DER : PKCS#12/PFX (30 82 …), PKCS#7 ou certificat X.509 nu ----
      // (MODIFIÉ Task 230) MOTEUR PUR D'ABORD : ouverture du coffre par
      // pkcs12-pur.ts (PBES1 3DES/RC2, PBES2 PBKDF2/AES — défaut OpenSSL 3 —,
      // MAC vérifié pour distinguer un mot de passe FAUX d'un fichier
      // illisible). `openssl pkcs12` n'est plus JAMAIS requis.
      let ouvertPur: CoffrePur | null = null;
      try {
        ouvertPur = ouvrirPkcs12Pur(src.donneesCertificat, motDePasse);
      } catch (e) {
        const msg = String((e as Error).message || e);
        if (msg.includes("MOT_DE_PASSE_INCORRECT")) {
          throw new ErreurOpenssl(
            "Mot de passe du coffre PKCS#12 incorrect : le fichier n'a pas pu être déverrouillé. Vérifiez le mot de passe du certificat (.p12/.pfx) et réessayez."
          );
        }
        /* structure refusée par le lecteur pur → tentatives suivantes */
      }
      if (ouvertPur && ouvertPur.certificats.length) {
        const choix = choisirFeuille(ouvertPur.certificats, ouvertPur.clePkcs8);
        if (choix.feuille.length) {
          const certFeuille = new crypto.X509Certificate(choix.feuille);
          certPem = certFeuille.toString();
          chainePem = choix.chaine
            .map((c) => {
              try {
                return new crypto.X509Certificate(c).toString();
              } catch {
                return "";
              }
            })
            .filter(Boolean)
            .join("\n");
          if (ouvertPur.clePkcs8) {
            const cle = crypto.createPrivateKey({ key: ouvertPur.clePkcs8, format: "der", type: "pkcs8" });
            clePem = cle.export({ type: "pkcs8", format: "pem" }).toString();
          }
        }
      } else if (!ouvertPur) {
        // PAS un coffre PKCS#12 exploitable par le lecteur pur :
        // 1) certificat X.509 DER nu (pur) ; 2) PKCS#7 DER (pur) ;
        // 3) repli openssl si le binaire existe (coffres exotiques).
        let x509Ok = false;
        try {
          const certNu = new crypto.X509Certificate(src.donneesCertificat);
          certPem = certNu.toString();
          x509Ok = true;
        } catch {
          /* pas un certificat nu */
        }
        if (!x509Ok) {
          const certs7 = certificatsPkcs7Der(src.donneesCertificat);
          if (certs7.length) {
            const certFeuille = new crypto.X509Certificate(certs7[0]);
            certPem = certFeuille.toString();
            chainePem = certs7
              .slice(1)
              .map((c) => {
                try {
                  return new crypto.X509Certificate(c).toString();
                } catch {
                  return "";
                }
              })
              .filter(Boolean)
              .join("\n");
            x509Ok = true;
          }
        }
        if (!x509Ok && opensslDisponible()) {
          const fCoffre = path.join(travail, "coffre.p12");
          await fs.promises.writeFile(fCoffre, src.donneesCertificat, { mode: 0o600 });
          let certsPem = "";
          try {
            const r = await executerOpenssl(
              ["pkcs12", "-in", fCoffre, "-passin", "stdin", "-nokeys", "-clcerts"],
              motDePasse
            );
            certsPem = r.sortie.toString("utf8");
          } catch (e) {
            const detail = String((e as Error).message || e);
            if (/bad decrypt|invalid password|Mac verify error|wrong password|unable to verify/i.test(detail)) {
              throw new ErreurOpenssl(
                "Mot de passe du coffre PKCS#12 incorrect : le fichier n'a pas pu être déverrouillé. Vérifiez le mot de passe du certificat (.p12/.pfx) et réessayez."
              );
            }
            try {
              const r2 = await executerOpenssl(["x509", "-inform", "DER", "-in", fCoffre, "-outform", "PEM"]);
              certsPem = r2.sortie.toString("utf8");
            } catch {
              try {
                const r3 = await executerOpenssl(["pkcs7", "-inform", "DER", "-in", fCoffre, "-print_certs"]);
                certsPem = r3.sortie.toString("utf8");
              } catch {
                throw new ErreurOpenssl(
                  "Fichier de certificat illisible : ni un coffre PKCS#12/.pfx valide, ni un certificat X.509/PKCS#7 reconnu. Détail : " + detail
                );
              }
            }
          }
          const blocs = blocsCertificats(certsPem);
          certPem = blocs[0] ?? "";
          chainePem = blocs.slice(1).join("");
          if (certPem) {
            try {
              const rca = await executerOpenssl(
                ["pkcs12", "-in", fCoffre, "-passin", "stdin", "-nokeys", "-cacerts"],
                motDePasse
              );
              chainePem = blocsCertificats(rca.sortie.toString("utf8")).join("");
            } catch {
              /* option -cacerts absente : repli conservé */
            }
          }
          if (certPem || blocs.length) {
            try {
              const rk = await executerOpenssl(
                ["pkcs12", "-in", fCoffre, "-passin", "stdin", "-nocerts", "-nodes"],
                motDePasse
              );
              clePem = blocClePrivee(rk.sortie.toString("utf8"));
            } catch {
              clePem = ""; // certificat public seul (ex. .cer DER) — clé séparée attendue
            }
          }
        }
        if (!certPem && !clePem) {
          const detailPur = ouvertPur ? "coffre sans certificat exploitable" : "structure non reconnue";
          throw new ErreurOpenssl(
            "Fichier de certificat illisible : ni un coffre PKCS#12/.pfx valide (avec certificat), ni un certificat X.509/PKCS#7 reconnu (" +
              detailPur +
              "). Formats acceptés : .p12/.pfx (certificat + clé), .pem/.cer/.crt/.der (certificat), .p7b/.p7c (chaîne)."
          );
        }
      }
      if (!clePem && src.donneesCle && src.donneesCle.length) {
        clePem = await lireCleSeparee(src.donneesCle, src.motDePasseCle ?? "", travail);
      }
    } else {
      throw new ErreurOpenssl(
        "Format de certificat non reconnu : fournissez un coffre PKCS#12 (.p12/.pfx), un certificat X.509 (.pem/.cer/.crt/.der) ou une signature PKCS#7 (.p7b/.p7c)."
      );
    }

    if (!certPem) {
      throw new ErreurOpenssl(
        "Aucun certificat exploitable n'a été trouvé dans le fichier fourni."
      );
    }
    if (!clePem) {
      throw new ErreurOpenssl(
        "Clé privée indisponible : importez le coffre complet (.p12/.pfx contenant certificat + clé privée), ou fournissez la clé privée associée (.pem/.key/.der) — elle est indispensable pour signer."
      );
    }

    // Paire cohérente ? (clé privée ↔ certificat, comparaison SPKI)
    await verifierPaireCertCle(certPem, clePem, travail);

    const metadonnees = await metadonneesDepuisPem(certPem);
    return { certPem, chainePem, clePem, metadonnees };
  } finally {
    await fs.promises.rm(travail, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* SIGNATURE PAdES                                                     */
/* ------------------------------------------------------------------ */

// Gabarit /Contents : 16 000 caractères hexadécimaux = 8 000 octets pour le
// CMS DER (RSA 4096 + chaîne complète ≈ 6 Ko). Les marqueurs /ByteRange sont
// des entiers de 15 chiffres ; la réinjection REMPLACE chaque marqueur par la
// valeur réelle complétée par des ESPACES (largeur constante → le fichier ne
// bouge pas, quels que soient les séparateurs réels de pdf-lib).
const GABARIT_HEX = 16_000;
const MARQUEUR = 999_999_999_999_999; // 15 chiffres (2⁵³ ≈ 9,007 × 10¹⁵)
const LARGEUR_CHIFFRE = 15;

function dateAsn1(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    "D:" +
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Signe un PDF en PAdES (B-B) : renvoie le buffer signé (CMS adbe.pkcs7.
 * detached SHA-256 couvrant tout le document, champ de signature invisible
 * ajouté en révision unique).
 *
 * SÉQUENCE (MODIFIÉ Task 224 — l'ordre était la cause du « Signature
 * INVALIDE » systématique) :
 *   1. PDF préparé avec gabarits (marqueurs ByteRange + hex plein Contents) ;
 *   2. localisation du gabarit /Contents APRÈS /ByteRange dans le buffer ;
 *   3. réinjection des VALEURS réelles du ByteRange par remplacement
 *      séquentiel des marqueurs (séparateurs réels conservés, longueur
 *      inchangée) → BUFFER FINAL ;
 *   4. données signées = buffer FINAL privé du hex de /Contents ;
 *   5. signature CMS (openssl, clé déchiffrée, aucun -passin) ;
 *   6. injection du hex de signature dans /Contents (gabarit conservé).
 */
export async function signerPdfPades(
  pdf: Buffer,
  coffre: CoffreOuvert,
  options: OptionsSignaturePades
): Promise<{ pdf: Buffer; certificat: MetadonneesCertificat }> {
  const travail = await dossierTravail();
  try {
    // ---- 1. Préparation du PDF avec le champ + gabarit de signature ----
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(pdf, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch {
      throw new ErreurOpenssl(
        "Ce PDF ne peut pas être signé : le document est protégé par un mot de passe ou sa structure est illisible. Utilisez la version non protégée du document."
      );
    }
    const ctx = doc.context;
    const nomChamp = (options.nomChamp || "SignatureElectronique").slice(0, 48);

    // Dictionnaire /Sig (gabarits : ByteRange 15 chiffres + Contents hex plein)
    const sigDict = ctx.obj({
      Type: PDFName.of("Sig"),
      Filter: PDFName.of("Adobe.PPKLite"),
      SubFilter: PDFName.of("adbe.pkcs7.detached"),
      ByteRange: ctx.obj([
        PDFNumber.of(0),
        PDFNumber.of(MARQUEUR),
        PDFNumber.of(MARQUEUR),
        PDFNumber.of(MARQUEUR),
      ]),
      Contents: PDFHexString.of("0".repeat(GABARIT_HEX)),
      M: PDFString.of(dateAsn1(new Date())),
      Reason: PDFHexString.fromText((options.raison || "").slice(0, 120)),
      Location: PDFHexString.fromText((options.emplacement || "").slice(0, 120)),
      ContactInfo: PDFString.of((options.contact || "").slice(0, 120)),
      Name: PDFHexString.fromText((options.nomSignataire || "").slice(0, 120)),
    });
    const sigRef = ctx.register(sigDict);

    // Champ de signature + widget invisible (rect nul, drapeaux 132 =
    // Print + Locked ; la signature n'occupe AUCUNE place visible)
    const champDict = ctx.obj({
      FT: PDFName.of("Sig"),
      T: PDFString.of(nomChamp),
      V: sigRef,
      Kids: ctx.obj([]),
    });
    const champRef = ctx.register(champDict);
    const widgetRef = ctx.register(
      ctx.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Widget"),
        Parent: champRef,
        Rect: ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
        F: PDFNumber.of(132),
      })
    );
    const champKids = champDict.get(PDFName.of("Kids"));
    if (champKids instanceof PDFArray) champKids.push(widgetRef);
    else champDict.set(PDFName.of("Kids"), ctx.obj([widgetRef]));

    // Widget rattaché à la 1re page (Annots) ; champ dans AcroForm.Fields
    const page = doc.getPage(0);
    const annotsExistant = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotsExistant) annotsExistant.push(widgetRef);
    else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));
    const acroExistant = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (!acroExistant) {
      const acro = ctx.obj({});
      doc.catalog.set(PDFName.of("AcroForm"), ctx.register(acro));
    }
    const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (!acro) {
      throw new ErreurOpenssl(
        "Ce PDF contient un AcroForm non standard : la signature automatique n'est pas possible. Utilisez le document original."
      );
    }
    acro.set(PDFName.of("SigFlags"), PDFNumber.of(3));
    const champsExistant = acro.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (champsExistant) champsExistant.push(champRef);
    else acro.set(PDFName.of("Fields"), ctx.obj([champRef]));

    // Sauvegarde CLASSIQUE (pas d'object streams : offsets stables, ByteRange fiable)
    const pdfPrepare = Buffer.from(
      await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
    );

    // ---- 2. Localisation du gabarit /Contents APRÈS /ByteRange ----
    const texte = pdfPrepare.toString("latin1");
    const re = new RegExp(
      "\\/ByteRange\\s*\\[\\s*0\\s+" +
        MARQUEUR +
        "\\s+" +
        MARQUEUR +
        "\\s+" +
        MARQUEUR +
        "\\s*\\]"
    );
    const mBr = re.exec(texte);
    if (!mBr) {
      throw new ErreurOpenssl(
        "Préparation PAdES : gabarit /ByteRange introuvable après sauvegarde (bug interne)."
      );
    }
    const posContents = texte.indexOf("/Contents", mBr.index);
    if (posContents === -1 || posContents > mBr.index + 4000) {
      throw new ErreurOpenssl("Préparation PAdES : gabarit /Contents introuvable (bug interne).");
    }
    // (MODIFIÉ Task 224) CONVENTION STANDARD PAdES : les délimiteurs < et >
    // du hex /Contents sont HORS des plages signées :
    //   ByteRange = [0, h0, h1+1, taille-h1-1]  (h0 = offset de '<', h1 = '>')
    //   données   = [0..h0) + [h1+1..taille)
    // L'ancienne découpe (départ à h0+1, 2ᵉ plage annoncée à h1+1 mais signée
    // depuis h1) rendait le condensé vérifié DIFFÉRENT de celui signé →
    // « Signature INVALIDE » systématique.
    const h0 = texte.indexOf("<", posContents); // offset du '<'
    const finHex = texte.indexOf(">", h0); // offset du '>'
    const debutHex = h0 + 1; // premier caractère hex (zone à remplacer)
    if (h0 === -1 || finHex === -1 || finHex - debutHex !== GABARIT_HEX) {
      throw new ErreurOpenssl(
        "Préparation PAdES : gabarit /Contents inattendu (" +
          (finHex - debutHex) +
          " caractères au lieu de " +
          GABARIT_HEX +
          ")."
      );
    }
    const taille = pdfPrepare.length;

    // ---- 3. RÉINJECTION des valeurs réelles du ByteRange D'ABORD ----
    // Remplacement séquentiel des trois marqueurs DANS le texte apparié :
    // les séparateurs réels (espaces/retours à la ligne de pdf-lib) sont
    // conservés tels quels → longueur du fichier STRICTEMENT inchangée.
    const valeursBr = [h0, finHex + 1, taille - finHex - 1];
    let indexBr = 0;
    const brReinjete = mBr[0].replace(
      new RegExp(String(MARQUEUR), "g"),
      () => String(valeursBr[indexBr++]).padEnd(LARGEUR_CHIFFRE, " ")
    );
    if (indexBr !== 3) {
      throw new ErreurOpenssl(
        "Préparation PAdES : " + indexBr + " marqueur(s) /ByteRange trouvé(s) au lieu de 3 (bug interne)."
      );
    }
    const pdfFinal = Buffer.concat([
      pdfPrepare.subarray(0, mBr.index),
      Buffer.from(brReinjete, "latin1"),
      pdfPrepare.subarray(mBr.index + mBr[0].length),
    ]);
    if (pdfFinal.length !== taille) {
      throw new ErreurOpenssl("Préparation PAdES : longueur après réinjection ByteRange incohérente (bug interne).");
    }

    // ---- 4. Données signées = buffer FINAL privé du couple [<hex>] ----
    // (délimiteurs < et > EXCLUS, convention ByteRange standard)
    const donnees = Buffer.concat([
      pdfFinal.subarray(0, h0),
      pdfFinal.subarray(finHex + 1),
    ]);

    // ---- 5. Signature CMS détachée SHA-256 — MOTEUR PUR (Task 230) ----
    // Construction RFC 5652 par cms-pur.ts (attributs signés contentType /
    // signingTime / messageDigest, RSA PKCS#1 v1.5 et ECDSA via crypto.sign) :
    // AUCUN fichier temporaire, AUCUN spawn, fonctionne sans openssl.
    let sigDer: Buffer;
    try {
      sigDer = signerCmsPur(donnees, coffre.certPem, coffre.clePem, coffre.chainePem);
    } catch (e) {
      // Repli openssl uniquement si le moteur pur refuse la clé (ex. Ed25519)
      // ET que le binaire existe sur ce serveur.
      if (opensslDisponible()) {
        const fCert = path.join(travail, "cert.pem");
        const fCle = path.join(travail, "cle.pem");
        const fChain = path.join(travail, "chain.pem");
        const fDonnees = path.join(travail, "donnees.bin");
        const fSig = path.join(travail, "signature.der");
        await fs.promises.writeFile(fCert, coffre.certPem, { mode: 0o600 });
        await fs.promises.writeFile(fCle, coffre.clePem, { mode: 0o600 });
        if (coffre.chainePem) await fs.promises.writeFile(fChain, coffre.chainePem, { mode: 0o600 });
        await fs.promises.writeFile(fDonnees, donnees, { mode: 0o600 });
        const args = [
          "cms", "-sign", "-binary", "-nosmimecap", "-outform", "DER", "-md", "sha256",
          "-signer", fCert, "-inkey", fCle, "-in", fDonnees, "-out", fSig,
        ];
        if (coffre.chainePem) args.push("-certfile", fChain);
        try {
          await executerOpenssl(args);
          sigDer = await fs.promises.readFile(fSig);
        } catch (e2) {
          throw new ErreurOpenssl(
            "Signature cryptographique impossible : " +
              String((e2 as Error).message || e2).replace(/^Erreur OpenSSL \(code \d+\) : /, "")
          );
        }
      } else {
        throw new ErreurOpenssl(
          "Signature cryptographique impossible : " +
            String((e as Error).message || e) +
            " (le moteur intégré gère les clés RSA et EC ; utilisez une clé RSA 2048+ ou EC P-256/P-384)."
        );
      }
    }

    // ---- 6. Injection du hex de signature dans /Contents ----
    const hexSig = sigDer.toString("hex");
    if (hexSig.length > GABARIT_HEX) {
      throw new ErreurOpenssl(
        "La signature cryptographique (" +
          Math.ceil(hexSig.length / 2) +
          " octets) dépasse la place réservée (" +
          GABARIT_HEX / 2 +
          " octets) : réduisez la chaîne de certificats du coffre."
      );
    }
    const hexFinal = hexSig + "0".repeat(GABARIT_HEX - hexSig.length);
    const signe = Buffer.concat([
      pdfFinal.subarray(0, debutHex),
      Buffer.from(hexFinal, "latin1"),
      pdfFinal.subarray(finHex),
    ]);
    if (signe.length !== taille) {
      throw new ErreurOpenssl("Injection signature : longueur finale incohérente (bug interne).");
    }
    return { pdf: signe, certificat: coffre.metadonnees };
  } finally {
    await fs.promises.rm(travail, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* VÉRIFICATION d'un PDF signé                                         */
/* ------------------------------------------------------------------ */

/** Lit la taille exacte d'un objet DER (retire le bourrage du hex). */
function tailleDer(octets: Buffer): number {
  if (octets.length < 2 || octets[0] !== 0x30) return octets.length;
  const second = octets[1];
  if (second < 0x80) return Math.min(2 + second, octets.length);
  const nbOctets = second & 0x7f;
  if (nbOctets === 0 || nbOctets > 4 || octets.length < 2 + nbOctets) return octets.length;
  let longueur = 0;
  for (let i = 0; i < nbOctets; i++) longueur = longueur * 256 + octets[2 + i];
  return Math.min(2 + nbOctets + longueur, octets.length);
}

const RE_DATE_X509 = /notBefore=(.+)\n?notAfter=(.+)/;

function fenetreDepuisSortie(texte: string): { du: Date | null; au: Date | null } {
  const m = RE_DATE_X509.exec(texte);
  const parse = (v: string): Date | null => {
    if (!v) return null;
    const d = new Date(v.trim().replace(/\s+/g, " "));
    return isNaN(d.getTime()) ? null : d;
  };
  return { du: m ? parse(m[1]) : null, au: m ? parse(m[2]) : null };
}

/**
 * Vérifie l'INTÉGRITÉ (reconstruction ByteRange + condensé CMS) d'un PDF
 * signé et extrait les métadonnées du certificat SIGNATAIRE embarqué.
 * Ne lève JAMAIS : renvoie toujours un rapport (integrite=false + message).
 */
export async function verifierPdfPades(pdf: Buffer): Promise<RapportVerification> {
  const vide: RapportVerification = {
    integrite: false,
    signataire: "",
    emetteur: "",
    serie: "",
    empreinte: "",
    valideDu: null,
    valideAu: null,
    certificatValide: false,
    message: "",
  };
  const travail = await dossierTravail();
  try {
    const texte = pdf.toString("latin1");
    const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    let m: RegExpExecArray | null;
    let dernier: RegExpExecArray | null = null;
    while ((m = re.exec(texte))) dernier = m;
    if (!dernier) {
      return {
        ...vide,
        message:
          "Aucune signature cryptographique trouvée : ce document n'a pas été signé (ou la signature a été retirée).",
      };
    }
    const [p1, l1, p2, l2] = dernier.slice(1).map(Number);
    const taille = pdf.length;
    if (p1 !== 0 || l1 <= 0 || p2 < l1 || p2 + l2 > taille || l2 <= 0) {
      return {
        ...vide,
        message:
          "La structure de la signature (/ByteRange) est incohérente : le document a été modifié ou corrompu après sa signature.",
      };
    }
    // (MODIFIÉ Task 224) convention standard : l1 = offset de '<', p2 =
    // offset juste après '>' — les DONNÉES signées excluent le couple [<hex>]
    const donnees = Buffer.concat([pdf.subarray(0, l1), pdf.subarray(p2, p2 + l2)]);
    // hex = caractères ENTRE les délimiteurs (l1+1 → p2-1) — l'ancienne
    // lecture incluait le '<' (caractère non hexadécimal) et Buffer.from
    // renvoyait un buffer VIDE → « Signature INVALIDE » systématique.
    const texteHex = texte.slice(l1 + 1, p2 - 1);
    if (texteHex.length % 2 !== 0) {
      return { ...vide, message: "Signature illisible (contenu hexadécimal impair)." };
    }
    const sigComplet = Buffer.from(texteHex, "hex");
    const sigDer = sigComplet.subarray(0, tailleDer(sigComplet));

    const fDonnees = path.join(travail, "donnees.bin");
    const fSig = path.join(travail, "signature.der");

    // Intégrité : le condensé signé (attribut message-digest du CMS) doit
    // correspondre aux octets reconstruits. La chaîne de confiance n'est PAS
    // exigée (certificats d'entreprise auto-signés acceptés) — la validité
    // temporelle du certificat est rapportée séparément.
    //
    // (MODIFIÉ Task 230) MOTEUR PUR D'ABORD — verifierCmsPur vérifie le
    // condensé ET la signature cryptographique des attributs avec la clé
    // publique du certificat EMBARQUÉ (RSA/EC, SHA-1 à SHA-512), sans spawn.
    let rapport: RapportCms = verifierCmsPur(donnees, sigDer);
    if (!rapport.integrite && opensslDisponible()) {
      // Repli openssl : utile pour les CMS de producteurs exotiques que le
      // lecteur pur ne décode pas (« illisible »), pas pour un verdict
      // cryptographique déjà établi (document modifié = verdict final).
      await fs.promises.writeFile(fDonnees, donnees, { mode: 0o600 });
      await fs.promises.writeFile(fSig, sigDer, { mode: 0o600 });
      const fSignataire = path.join(travail, "signataire.pem");
      // (CORRIGÉ Task 226) le drapeau correct est « -noverify » : la chaîne
      // du signataire n'est pas vérifiée MAIS le condensé signé (intégrité
      // du document) EST vérifié.
      try {
        await executerOpenssl([
          "cms", "-verify", "-binary", "-inform", "DER", "-purpose", "any",
          "-noverify", "-content", fDonnees, "-in", fSig, "-signer", fSignataire,
        ]);
      } catch (e) {
        return {
          ...vide,
          message:
            "Signature INVALIDE : le document a été modifié depuis sa signature (vérification du condensé cryptographique échouée). Détail : " +
            String((e as Error).message || e).replace(/^Erreur OpenSSL \(code \d+\) : /, ""),
        };
      }
      // Métadonnées du certificat signataire (openssl a écrit le PEM)
      let sujet = "";
      let emetteur = "";
      let serie = "";
      let empreinte = "";
      let fenetre: { du: Date | null; au: Date | null } = { du: null, au: null };
      try {
        const pem = await fs.promises.readFile(fSignataire, "utf8");
        const cert = new crypto.X509Certificate(pem);
        sujet = cert.subject.split("\n").map((s) => s.trim()).filter(Boolean).join(", ");
        emetteur = cert.issuer.split("\n").map((s) => s.trim()).filter(Boolean).join(", ");
        serie = cert.serialNumber.toUpperCase().replace(/[^0-9A-F]/g, "");
        empreinte = cert.fingerprint256.replace(/:/g, "").toLowerCase();
        fenetre = { du: new Date(cert.validFrom), au: new Date(cert.validTo) };
      } catch {
        // certificat non lisible : rapport partiel, l'intégrité reste acquise
      }
      const maintenant = new Date();
      const certificatValide =
        (!fenetre.du || maintenant >= fenetre.du) && (!fenetre.au || maintenant <= fenetre.au);
      return {
        integrite: true,
        signataire: sujet,
        emetteur,
        serie,
        empreinte,
        valideDu: fenetre.du && !isNaN(fenetre.du.getTime()) ? fenetre.du : null,
        valideAu: fenetre.au && !isNaN(fenetre.au.getTime()) ? fenetre.au : null,
        certificatValide,
        message:
          "Signature intègre : le document n'a été modifié d'aucune manière depuis sa signature par « " +
          (sujet || "certificat inconnu") +
          " ».",
      };
    }
    return {
      integrite: rapport.integrite,
      signataire: rapport.signataire,
      emetteur: rapport.emetteur,
      serie: rapport.serie,
      empreinte: rapport.empreinte,
      valideDu: rapport.valideDu,
      valideAu: rapport.valideAu,
      certificatValide: rapport.certificatValide,
      message: rapport.message,
    };
  } finally {
    await fs.promises.rm(travail, { recursive: true, force: true }).catch(() => {});
  }
}

/** Le PDF contient-il une signature cryptographique (/ByteRange) ? */
export function contientSignaturePades(pdf: Buffer): boolean {
  const motif = /\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/;
  return motif.test(pdf.toString("latin1").slice(0, 2_000_000)) ||
    motif.test(pdf.toString("latin1").slice(-2_000_000));
}

/** Déchiffre au vol un fichier du stockage (idempotent). */
export function dechiffrerFichierStocke(buf: Buffer): Buffer {
  try {
    return decryptFromStorage(buf);
  } catch {
    throw new ErreurOpenssl(
      "Le fichier de certificat stocké est illisible : la clé de chiffrement du serveur a changé. Réimportez le certificat."
    );
  }
}

/** Petit utilitaire réutilisé par l'orchestrateur : SHA-256 hex d'un buffer. */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
