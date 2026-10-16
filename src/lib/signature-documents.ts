/**
 * ============================================================================
 *  NOUVEAU (Task 225, v0.2.115) — SIGNATURE GÉNÉRIQUE DES DOCUMENTS IMPORTÉS
 * ============================================================================
 *
 *  DEMANDE : « tous les fichiers importés, notamment les fiches de paie ou
 *  les réponses aux demandes, doivent pouvoir être signés électroniquement
 *  avec le certificat chargé » — le mécanisme ne doit PAS être limité à un
 *  fichier ou à un type de document :
 *
 *    1. afficher les informations du certificat électronique chargé
 *       (ex. « Jean Dupont / MA SOCIETE SARL ») ;
 *    2. téléverser n'importe quel fichier pris en charge par le système ;
 *    3. signer AUTOMATIQUEMENT ce fichier avec le certificat chargé et sa
 *       clé privée associée ;
 *    4. générer le fichier signé électroniquement ;
 *    5. permettre le téléchargement du fichier signé ;
 *    6. conserver le document signé dans le système (registre + copie
 *       chiffrée — même discipline que la Task 224).
 *
 *  DEUX CHEMINS DE SIGNATURE selon la nature du fichier :
 *
 *    - PDF  → signature PAdES (ETSI EN 319 142, niveau B-B) INTÉGRÉE au
 *      document : le fichier téléchargé EST le document signé
 *      (src/lib/signature-pades.ts). Un PDF déjà porteur d'une signature
 *      cryptographique est REFUSÉ (le réenregistrement pdf-lib déplacerait
 *      les plages ByteRange et invaliderait la première signature) ;
 *    - AUTRES formats → signature PKCS#7/CMS DÉTACHÉE (openssl cms -sign,
 *      SHA-256) livrée en archive ZIP contenant : l'original INTACT,
 *      la signature « <nom>.p7s », et un LISEZ-MOI expliquant la vérification.
 *      L'original n'est jamais altéré (il n'existe pas de signature
 *      « intégrée » standard pour un .docx/.xlsx/… hors OOXML spécifique).
 *
 *  MODES : LOCALE (certificat importé + clé privée, OpenSSL 3) ou
 *  API_EXTERNE (délégation — PDF uniquement : un service REST de signature
 *  renvoie un PDF signé ; pour les autres formats, exiger le mode LOCALE).
 *
 *  SÉCURITÉ : aucun secret renvoyé ; conservation chiffrée AES-256-GCM
 *  (0600, dossier 0700) ; cache par empreinte SHA-256 (un même contenu
 *  n'est jamais re-signé) ; certificat ASSOCIÉ extrait du document signé.
 * ============================================================================
 */
import "server-only";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { encryptForStorage, decryptFromStorage } from "@/lib/storage-crypto";
import {
  dossierDocumentsSignes,
  lireConfigSignatureApi,
  ouvrirCoffreLocal,
  signerViaApiExterne,
  type ConfigSignatureApi,
} from "@/lib/signature-api";
import {
  contientSignaturePades,
  MetadonneesCertificat,
  opensslDisponible,
  signerPdfPades,
  verifierPdfPades,
  type CoffreOuvert,
  type OptionsSignaturePades,
} from "@/lib/signature-pades";
import { signerCmsPur, verifierCmsPur } from "@/lib/cms-pur";
import { getProjectRoot, resolveStoredFile } from "@/lib/storage-dir";

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

/** Nature de la signature produite. */
export type NatureSignature = "PADES_PDF" | "CMS_DETACHE_ZIP" | "CMS_DETACHE_SEUL";

export interface ContexteDocument {
  /** Nom original du fichier téléversé (sûr, sans chemin). */
  nomFichier: string;
  /** Référence libre affichée dans le registre (ex. « Fiche 03/2026 – CIN … »). */
  reference?: string;
  /** Qui signe (nom/identifiant de session — renseigné par la route). */
  signePar: string;
  /** Raison de signature (reprend la config si vide). */
  raison?: string;
}

export interface ResultatDocumentSigne {
  ok: boolean;
  message: string;
  /** Document signé à télécharger (PAdES : le PDF signé ; autre : le ZIP). */
  contenu: Buffer | null;
  nature: NatureSignature | null;
  /** Nom de fichier conseillé pour le téléchargement. */
  nomFichierSigne: string;
  typeMime: string;
  documentId: string;
  certificat: {
    sujet: string;
    titulaire: string;
    organisation: string;
    emetteur: string;
    serie: string;
    empreinte: string;
    valideDu: Date | null;
    valideAu: Date | null;
  } | null;
  verification: { statut: "VALIDE" | "INVALIDE" | "NON_VERIFIE"; message: string };
  /** Copie déjà signée servie (cache) — le contenu est le même qu'à l'origine. */
  dejaSigne: boolean;
  /** NOUVEAU (v0.2.124) : fiches de paie LIÉES à cette signature — quand le
   * PDF signé manuellement correspond (octets identiques) à une fiche de paie
   * déjà importée, la signature est rattachée à la fiche : le portail employé
   * affiche alors le badge « Signée électroniquement » et sert la copie signée. */
  fichesLiees: Array<{ id: string; reference: string }>;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

/** Nom de fichier sûr : sans chemin, sans caractères de contrôle, borné. */
export function nomFichierSur(nom: string): string {
  const base = String(nom || "document")
    .replace(/[\r\n\t\0]/g, " ")
    .replace(/[\/\\]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  return (base || "document").slice(0, 180);
}

/** Découpe « CN=Jean Dupont, O=MA SOCIETE SARL » → titulaire + organisation. */
export function sujetVersTitulaire(sujet: string): { titulaire: string; organisation: string } {
  const champ = (nom: string): string => {
    const m = new RegExp("(?:^|,)\\s*" + nom + "\\s*=\\s*([^,]+)", "i").exec(sujet || "");
    return m ? m[1].trim() : "";
  };
  return { titulaire: champ("CN"), organisation: champ("O") };
}

/** Le buffer est-il un PDF (en-tête %PDF, tolérance BOM/espaces initiaux) ? */
export function estPdf(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  const debut = buf.subarray(0, 1024).toString("latin1");
  return /%PDF-\d/.test(debut);
}

/* ------------------------------------------------------------------ */
/* NOUVEAU (v0.2.124) — LIAISON « SIGNATURE MANUELLE ↔ FICHE DE PAIE »  */
/* ------------------------------------------------------------------ */
/*  DEMANDE : « j'ai importé des fiches de paie, puis j'ai effectué la   */
/*  signature électronique via l'API Certification & Signature — mais    */
/*  dans le portail employé les fiches restent affichées comme non       */
/*  signées ».                                                           */
/*                                                                       */
/*  CAUSE : la signature manuelle (POST /api/signature-api/signer)       */
/*  enregistrait la copie signée avec type=« AUTRE », sourceId=          */
/*  « TELEVERSE » — JAMAIS reliée à la fiche de paie. Le portail, lui,   */
/*  ne regarde que le registre type=« FICHE_PAIE », sourceId=id fiche    */
/*  (Task 231) pour afficher le badge et servir la copie signée.         */
/*                                                                       */
/*  CORRECTIF : après chaque signature manuelle RÉUSSIE d'un PDF, si le  */
/*  contenu original est IDENTIQUE octet pour octet (SHA-256) au fichier */
/*  stocké d'une fiche de paie déjà importée, une entrée de registre     */
/*  type=« FICHE_PAIE » est créée pour CHAQUE fiche concernée (un PDF    */
/*  multi-fiches produit plusieurs fiches partageant le même fichier) —  */
/*  la copie signée conservée sert alors au portail, badge compris.      */
/*  Identifiant robuste : empreinte SHA-256 du DÉCHIFFRÉ stocké — le     */
/*  nom et la taille ne servent qu'à réduire les candidats (jamais à     */
/*  décider seuls : aucun faux positif possible).                        */
/* ------------------------------------------------------------------ */

interface FicheALier {
  id: string;
  reference: string;
  nomFichier: string;
}

/** Retrouve les fiches de paie dont le fichier stocké (déchiffré) est
 * STRICTEMENT identique au contenu signé — fiches déjà pourvues d'une copie
 * signée exclues (aucune écrasement : la première signature conserve). */
async function rechercherFichesCorrespondantes(
  contenu: Buffer,
  empreinteOrigine: string,
  nomSur: string
): Promise<FicheALier[]> {
  try {
    // -- Candidats : d'abord le même nom + même taille (cas standard : le RH
    //    re-signe le fichier source exact) ; sinon même taille parmi les PDF
    //    (cas d'une copie renommée). La vérification finale reste le SHA-256
    //    du contenu DÉCHIFFRÉ : le nom et la taille ne font que réduire.
    let candidats = await db.payslip.findMany({
      where: { fileName: nomSur, fileSize: contenu.length },
      select: { id: true, storedName: true, fileName: true, matricule: true, period: true },
      take: 50,
    });
    if (candidats.length === 0) {
      candidats = await db.payslip.findMany({
        where: { fileSize: contenu.length, storedName: { endsWith: ".pdf" } },
        orderBy: { uploadedAt: "desc" },
        select: { id: true, storedName: true, fileName: true, matricule: true, period: true },
        take: 150,
      });
    }
    if (candidats.length === 0) return [];

    // -- Comparaison par empreinte (déchiffrement du stocké) : on garde les
    //    storedName dont le contenu clair est IDENTIQUE au PDF signé.
    const stockesIdentiques = new Set<string>();
    const vus = new Set<string>();
    for (const c of candidats) {
      if (!c.storedName || vus.has(c.storedName)) continue;
      vus.add(c.storedName);
      const chemin = resolveStoredFile(c.storedName);
      if (!chemin) continue;
      try {
        const clair = decryptFromStorage(fs.readFileSync(chemin));
        if (clair.length === contenu.length && sha256Hex(clair) === empreinteOrigine) {
          stockesIdentiques.add(c.storedName);
        }
      } catch {
        // fichier illisible (clé changée…) : candidat ignoré, jamais bloquant
      }
    }
    if (stockesIdentiques.size === 0) return [];

    // -- TOUTES les fiches partageant ces fichiers (PDF multi-fiches) qui ne
    //    possèdent PAS déjà une copie signée conservée au registre.
    const fiches = await db.payslip.findMany({
      where: { storedName: { in: [...stockesIdentiques] } },
      select: { id: true, fileName: true, matricule: true, period: true },
    });
    const dejaLiees = await db.signatureApiDocument.findMany({
      where: { type: "FICHE_PAIE", sourceId: { in: fiches.map((f) => f.id) }, chemin: { not: "" } },
      select: { sourceId: true },
    });
    const exclus = new Set(dejaLiees.map((l) => l.sourceId));
    return fiches
      .filter((f) => !exclus.has(f.id))
      .map((f) => ({
        id: f.id,
        reference: [f.matricule, f.period].filter(Boolean).join(" — ") || f.id,
        nomFichier: f.fileName || nomSur,
      }));
  } catch (e) {
    console.error("[SIGNATURE-DOCUMENT] Recherche fiches correspondantes impossible (non bloquant):", e);
    return [];
  }
}

/** Crée les entrées de registre « FICHE_PAIE » reliant la copie signée
 * conservée à chaque fiche trouvée — retourne les fiches réellement liées.
 * JAMAIS bloquant : un échec de liaison n'affecte pas la signature rendue. */
async function lierCopieSigneeAuxFiches(
  fiches: FicheALier[],
  cheminCopie: string,
  commun: {
    mode: string;
    environnement: string;
    empreinteOrigine: string;
    signePar: string;
    certificat: {
      sujet: string;
      emetteur: string;
      serie: string;
      empreinte: string;
      valideDu: Date | null;
      valideAu: Date | null;
    };
    verif: { statut: "VALIDE" | "INVALIDE" | "NON_VERIFIE"; message: string };
  }
): Promise<Array<{ id: string; reference: string }>> {
  const liees: Array<{ id: string; reference: string }> = [];
  for (const f of fiches) {
    try {
      await db.signatureApiDocument.create({
        data: {
          type: "FICHE_PAIE",
          sourceId: f.id,
          reference: f.reference.slice(0, 200),
          nomFichier: f.nomFichier.slice(0, 200),
          mode: commun.mode,
          environnement: commun.environnement,
          chemin: cheminCopie,
          tailleOctets: 0, // recalculé inutile : la copie est celle du document signé
          certSujet: commun.certificat.sujet,
          certEmetteur: commun.certificat.emetteur,
          certSerie: commun.certificat.serie,
          certEmpreinte: commun.certificat.empreinte,
          certValideDu: commun.certificat.valideDu,
          certValideAu: commun.certificat.valideAu,
          verifStatut: commun.verif.statut,
          verifLe: commun.verif.statut === "NON_VERIFIE" ? null : new Date(),
          verifMessage: commun.verif.message.slice(0, 500),
          signePar: commun.signePar,
          empreinteOrigine: commun.empreinteOrigine,
        },
      });
      liees.push({ id: f.id, reference: f.reference });
      console.log(
        "[SIGNATURE-DOCUMENT] Fiche de paie " + f.id + " (« " + f.reference + " ») LIÉE à la signature manuelle — badge portail actif."
      );
    } catch (e) {
      console.error("[SIGNATURE-DOCUMENT] Liaison fiche " + f.id + " impossible (non bloquant):", e);
    }
  }
  return liees;
}

async function dossierPrive(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.chmod(dir, 0o700);
  } catch {
    // systèmes sans permissions POSIX : sans effet
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ------------------------------------------------------------------ */
/* OpenSSL (copie locale — mêmes disciplines que signature-pades.ts)   */
/* ------------------------------------------------------------------ */

function executerOpenssl(
  args: string[],
  entreeStdin: string | Buffer = ""
): Promise<{ sortie: Buffer; erreur: string }> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process") as typeof import("child_process");
    // (MODIFIÉ Task 230) binaire résolu par variable d'env si fournie —
    // le moteur PUR ci-dessous rend ce repli ACCESSOIRE.
    const binaire = process.env.AUTO_RH_OPENSSL_BIN || "openssl";
    const proc = spawn(binaire, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let sortie = Buffer.alloc(0);
    let erreur = "";
    proc.stdout.on("data", (d: Buffer) => {
      sortie = Buffer.concat([sortie, d]);
    });
    proc.stderr.on("data", (d: Buffer) => {
      erreur += d.toString("utf8");
    });
    proc.on("error", (e: Error) =>
      reject(
        new Error(
          "OpenSSL est indisponible sur le serveur — la signature locale exige openssl dans le PATH. Détail : " +
            e.message
        )
      )
    );
    proc.on("close", (code) => {
      if (code === 0) resolve({ sortie, erreur });
      else
        reject(
          new Error(
            "Erreur OpenSSL (code " + code + ") : " + erreur.trim().split("\n").slice(-3).join(" — ")
          )
        );
    });
    if (entreeStdin) proc.stdin.write(entreeStdin);
    proc.stdin.end();
  });
}

/* ------------------------------------------------------------------ */
/* Signature PKCS#7/CMS DÉTACHÉE (formats non PDF)                     */
/* ------------------------------------------------------------------ */

/**
 * Produit une signature PKCS#7/CMS détachée (DER) du contenu, avec le
 * certificat + clé privée du coffre ouvert. Le contenu original n'est
 * JAMAIS modifié.
 */
export async function signerCmsDetache(
  contenu: Buffer,
  coffre: CoffreOuvert
): Promise<{ signature: Buffer }> {
  // (MODIFIÉ Task 230) MOTEUR PUR : construction RFC 5652 par cms-pur.ts —
  // aucun fichier temporaire, aucun spawn, aucune dépendance openssl.
  try {
    const signature = signerCmsPur(contenu, coffre.certPem, coffre.clePem, coffre.chainePem);
    if (!signature.length) {
      throw new Error("La signature PKCS#7 produite est vide (erreur interne).");
    }
    return { signature };
  } catch (e) {
    const messagePur = String((e as Error).message || e);
    // Repli openssl UNIQUEMENT si le binaire existe (clés exotiques).
    if (!opensslDisponible()) {
      throw new Error(
        "Signature PKCS#7 impossible : " +
          messagePur +
          " (le moteur intégré gère les clés RSA et EC — aucun openssl requis)."
      );
    }
    const base = path.join(getDossierTravail(), "s-" + crypto.randomBytes(6).toString("hex"));
    await fs.promises.mkdir(base, { recursive: true, mode: 0o700 });
    try {
      const fCert = path.join(base, "cert.pem");
      const fCle = path.join(base, "cle.pem");
      const fDonnees = path.join(base, "donnees.bin");
      const fSig = path.join(base, "signature.p7s");
      const fChain = path.join(base, "chain.pem");
      await fs.promises.writeFile(fCert, coffre.certPem, { mode: 0o600 });
      await fs.promises.writeFile(fCle, coffre.clePem, { mode: 0o600 });
      await fs.promises.writeFile(fDonnees, contenu, { mode: 0o600 });
      if (coffre.chainePem) await fs.promises.writeFile(fChain, coffre.chainePem, { mode: 0o600 });
      const args = [
        "cms", "-sign", "-binary", "-nosmimecap", "-outform", "DER", "-md", "sha256",
        "-signer", fCert, "-inkey", fCle, "-in", fDonnees, "-out", fSig,
      ];
      if (coffre.chainePem) args.push("-certfile", fChain);
      await executerOpenssl(args);
      const signature = await fs.promises.readFile(fSig);
      if (!signature.length) {
        throw new Error("La signature PKCS#7 produite est vide (erreur interne).");
      }
      return { signature };
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function getDossierTravail(): string {
  return path.join(getProjectRoot(), "storage", "signatures", "travail");
}

/**
 * Vérifie une signature PKCS#7/CMS détachée par rapport au contenu original.
 * Ne lève jamais : rapport honnête.
 */
export async function verifierCmsDetache(
  contenu: Buffer,
  signature: Buffer
): Promise<{ integrite: boolean; signataire: string; message: string }> {
  // (MODIFIÉ Task 230) MOTEUR PUR D'ABORD : condensé + signature vérifiés
  // avec le certificat EMBARQUÉ, sans openssl, sans fichiers temporaires.
  const rapport = verifierCmsPur(contenu, signature);
  if (rapport.integrite) {
    return {
      integrite: true,
      signataire: rapport.signataire,
      message:
        "Signature PKCS#7 intègre : le contenu n'a été modifié d'aucune manière depuis sa signature" +
        (rapport.signataire ? " par « " + rapport.signataire + " »" : "") +
        "." +
        (rapport.certificatValide
          ? ""
          : rapport.valideAu && new Date() > rapport.valideAu
            ? " — ATTENTION : le certificat du signataire est expiré (la signature reste intègre)."
            : ""),
    };
  }
  // Repli openssl si le lecteur pur n'a pas pu DÉCODER la signature (CMS de
  // producteurs exotiques) et que le binaire existe. Un verdict
  // cryptographique « document modifié » reste définitif.
  if (/illisible/i.test(rapport.message) && opensslDisponible()) {
    const base = path.join(getDossierTravail(), "v-" + crypto.randomBytes(6).toString("hex"));
    await fs.promises.mkdir(base, { recursive: true, mode: 0o700 });
    try {
      const fDonnees = path.join(base, "donnees.bin");
      const fSig = path.join(base, "signature.p7s");
      const fSignataire = path.join(base, "signataire.pem");
      await fs.promises.writeFile(fDonnees, contenu, { mode: 0o600 });
      await fs.promises.writeFile(fSig, signature, { mode: 0o600 });
      try {
        await executerOpenssl([
          "cms", "-verify", "-binary", "-inform", "DER", "-purpose", "any",
          // (CORRIGÉ Task 226) « -noverify » : intégrité TOUJOURS vérifiée.
          "-noverify", "-content", fDonnees, "-in", fSig, "-signer", fSignataire,
        ]);
      } catch (e) {
        return {
          integrite: false,
          signataire: "",
          message:
            "Signature PKCS#7 INVALIDE : le contenu ne correspond plus à la signature (altération). Détail : " +
            String((e as Error).message || e).replace(/^Erreur OpenSSL \(code \d+\) : /, "").slice(0, 200),
        };
      }
      let signataire = "";
      try {
        const pem = await fs.promises.readFile(fSignataire, "utf8");
        const cert = new crypto.X509Certificate(pem);
        signataire = cert.subject.split("\n").map((s) => s.trim()).filter(Boolean).join(", ");
      } catch {
        // certificat non lisible : l'intégrité reste acquise
      }
      return {
        integrite: true,
        signataire,
        message:
          "Signature PKCS#7 intègre : le contenu n'a été modifié d'aucune manière depuis sa signature" +
          (signataire ? " par « " + signataire + " »" : "") +
          ".",
      };
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true }).catch(() => {});
    }
  }
  return {
    integrite: false,
    signataire: "",
    message: rapport.message || "Signature PKCS#7 INVALIDE : vérification cryptographique échouée.",
  };
}

/* ------------------------------------------------------------------ */
/* Archive ZIP « fichier signé » (formats non PDF)                     */
/* ------------------------------------------------------------------ */

function lisezMoiVerification(
  nomOriginal: string,
  nomSignature: string,
  certificat: MetadonneesCertificat
): string {
  const date = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  return [
    "SIGNATURE ÉLECTRONIQUE PKCS#7/CMS DÉTACHÉE — AutoRH",
    "========================================================",
    "",
    "Contenu de cette archive :",
    "  - " + nomOriginal + "   : le document ORIGINAL, rigoureusement intact ;",
    "  - " + nomSignature + "  : la signature cryptographique (PKCS#7/CMS DER, SHA-256) ;",
    "  - ce fichier d'aide.",
    "",
    "Le document original n'a PAS été modifié : pour un format autre que PDF,",
    "la signature « intégrée » n'existe pas dans les standards ; le couple",
    "(original + .p7s) constitue la preuve cryptographique.",
    "",
    "Vérifier l'intégrité (avec OpenSSL installé) :",
    '  openssl cms -verify -binary -inform DER -purpose any -noverify \\',
    "    -in \"" + nomSignature + "\" -content \"" + nomOriginal + "\"",
    "",
    "Le certificat du signataire est embarqué dans la signature :",
    "  Signataire : " + (certificat.sujet || "—"),
    "  Émetteur   : " + (certificat.emetteur || "—"),
    "  N° série   : " + (certificat.serie || "—"),
    "  Empreinte  : " + (certificat.empreinte || "—"),
    "  Validité   : du " + (certificat.valideDu ? certificat.valideDu.toISOString().slice(0, 10) : "—") +
      " au " + (certificat.valideAu ? certificat.valideAu.toISOString().slice(0, 10) : "—"),
    "",
    "Signé le " + date + " par AutoRH (signature électronique des documents importés).",
  ].join("\n");
}

/** Archive ZIP : original + .p7s + LISEZ-MOI. Fallback : null si jszip absent. */
async function archiveZipSignee(
  original: Buffer,
  nomOriginal: string,
  signature: Buffer,
  nomSignature: string,
  certificat: MetadonneesCertificat
): Promise<Buffer | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require("jszip") as typeof import("jszip");
    const zip = new JSZip();
    zip.file(nomOriginal, original);
    zip.file(nomSignature, signature);
    zip.file("VERIFICATION.txt", lisezMoiVerification(nomOriginal, nomSignature, certificat));
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    return null; // jszip indisponible : la route livrera le .p7s seul
  }
}

/* ------------------------------------------------------------------ */
/* ORCHESTRATION : signer n'importe quel fichier téléversé             */
/* ------------------------------------------------------------------ */

const TAILLE_MAX_SIGNER = 100_000_000; // 100 Mo — cohérent avec la mémoire serveur

export { TAILLE_MAX_SIGNER };

/**
 * Signe le fichier téléversé avec le certificat CHARGÉ (config singleton) :
 *   - PDF → PAdES intégré (le fichier signé est un PDF) ;
 *   - autre → PKCS#7/CMS détaché, livré en ZIP (original + signature).
 * Conserve la copie chiffrée + registre ; cache par empreinte d'origine.
 */
export async function signerDocumentTeleverse(
  contenu: Buffer,
  contexte: ContexteDocument
): Promise<ResultatDocumentSigne> {
  const nomSur = nomFichierSur(contexte.nomFichier);
  const reference = (contexte.reference || "Import manuel").slice(0, 200);
  const echec = (message: string): ResultatDocumentSigne => ({
    ok: false,
    message,
    contenu: null,
    nature: null,
    nomFichierSigne: "",
    typeMime: "application/octet-stream",
    documentId: "",
    certificat: null,
    verification: { statut: "NON_VERIFIE", message: "" },
    dejaSigne: false,
    fichesLiees: [],
  });

  if (!contenu || contenu.length === 0) {
    return echec("Aucun contenu à signer : le fichier est vide.");
  }
  if (contenu.length > TAILLE_MAX_SIGNER) {
    return echec(
      "Fichier trop volumineux pour la signature en ligne (" +
        Math.round(contenu.length / 1e6) + " Mo) : la limite est de " +
        Math.round(TAILLE_MAX_SIGNER / 1e6) + " Mo."
    );
  }

  const cfg = await lireConfigSignatureApi();
  if (!cfg.actif) {
    return echec(
      "Le module de signature électronique est désactivé : activez-le dans Paramètres → « API de certification & signature »."
    );
  }

  const empreinteOrigine = sha256Hex(contenu);
  const estUnPdf = estPdf(contenu);

  // ---- CACHE : un contenu identique déjà signé est servi tel quel ----
  const existant = await db.signatureApiDocument.findFirst({
    where: { empreinteOrigine, mode: cfg.mode, environnement: cfg.environnement },
    orderBy: { signeLe: "desc" },
  });
  if (existant?.chemin) {
    try {
      const brut = await fs.promises.readFile(path.join(dossierDocumentsSignes(), path.basename(existant.chemin)));
      const copie = decryptFromStorage(brut);
      // NOUVEAU (v0.2.124) — LIAISON DIFFÉRÉE : le contenu avait déjà été
      // signé AVANT la liaison automatique (signé « AUTRE » sans lien fiche).
      // Si ce contenu correspond à des fiches de paie déjà importées, les
      // entrées « FICHE_PAIE » sont créées MAINTENANT vers la copie conservée
      // existante : le statut du portail se met à jour sans re-signature.
      const fichesALier = estUnPdf
        ? await rechercherFichesCorrespondantes(contenu, empreinteOrigine, nomSur)
        : [];
      const lieesCache = fichesALier.length
        ? await lierCopieSigneeAuxFiches(fichesALier, existant.chemin, {
            mode: existant.mode,
            environnement: existant.environnement,
            empreinteOrigine,
            signePar: contexte.signePar,
            certificat: {
              sujet: existant.certSujet,
              emetteur: existant.certEmetteur,
              serie: existant.certSerie,
              empreinte: existant.certEmpreinte,
              valideDu: existant.certValideDu,
              valideAu: existant.certValideAu,
            },
            verif: {
              statut: (existant.verifStatut as "VALIDE" | "INVALIDE" | "NON_VERIFIE") || "NON_VERIFIE",
              message: existant.verifMessage || "",
            },
          })
        : [];
      return {
        ok: true,
        message:
          "Ce contenu avait déjà été signé avec la même configuration : la copie signée conservée a été servie (signature du " +
          existant.signeLe.toISOString().slice(0, 19).replace("T", " ") + ")." +
          messageFichesLiees(lieesCache),
        contenu: copie,
        nature: existant.chemin.endsWith(".pdf")
          ? "PADES_PDF"
          : existant.chemin.endsWith(".zip")
            ? "CMS_DETACHE_ZIP"
            : "CMS_DETACHE_SEUL",
        nomFichierSigne: nomSigne(nomSur, existant.chemin),
        typeMime: typeMimePour(existant.chemin),
        documentId: existant.id,
        certificat: certificatPublic({
          sujet: existant.certSujet,
          emetteur: existant.certEmetteur,
          serie: existant.certSerie,
          empreinte: existant.certEmpreinte,
          valideDu: existant.certValideDu,
          valideAu: existant.certValideAu,
        }),
        verification: {
          statut: (existant.verifStatut as "VALIDE" | "INVALIDE" | "NON_VERIFIE") || "NON_VERIFIE",
          message: existant.verifMessage || "",
        },
        dejaSigne: true,
        fichesLiees: lieesCache,
      };
    } catch {
      // copie illisible (clé de chiffrement changée) : re-signature ci-dessous
    }
  }

  // ---- SIGNATURE selon la nature du fichier et le mode configuré ----
  let signe: Buffer;
  let nature: NatureSignature;
  let certificat: MetadonneesCertificat;
  let extStocke: string;
  let verif: { statut: "VALIDE" | "INVALIDE" | "NON_VERIFIE"; message: string };

  if (estUnPdf) {
    if (contientSignaturePades(contenu)) {
      return echec(
        "Ce PDF contient déjà une signature cryptographique : le réenregistrer pour signer à nouveau déplacerait les plages signées et INVALIDERAIT la première signature. Importez le document original (non signé)."
      );
    }
    if (cfg.mode === "API_EXTERNE") {
      try {
        signe = await signerViaApiExterne(contenu, nomSur, cfg);
      } catch (e) {
        return echec("Signature via l'API externe impossible : " + String((e as Error).message || e));
      }
      const rapport = await verifierPdfPades(signe);
      if (!rapport.integrite && contientSignaturePades(signe)) {
        return echec("Le document renvoyé par l'API porte une signature INVALIDE : " + rapport.message);
      }
      certificat = {
        sujet: rapport.signataire,
        emetteur: rapport.emetteur,
        serie: rapport.serie,
        valideDu: rapport.valideDu,
        valideAu: rapport.valideAu,
        empreinte: rapport.empreinte,
        algorithmeCle: "",
      };
      verif = {
        statut: rapport.integrite ? "VALIDE" : (contientSignaturePades(signe) ? "INVALIDE" : "NON_VERIFIE"),
        message: rapport.message,
      };
      nature = "PADES_PDF";
      extStocke = ".pdf";
    } else {
      let coffre: CoffreOuvert;
      try {
        coffre = await ouvrirCoffreLocal(cfg);
      } catch (e) {
        return echec(String((e as Error).message || e));
      }
      const options: OptionsSignaturePades = {
        raison: (contexte.raison || cfg.raison || "Approbation du document importé").slice(0, 120),
        emplacement: cfg.emplacement || "",
        contact: cfg.contact || "",
        nomSignataire: cnDe(coffre.metadonnees.sujet),
        nomChamp: "SignatureDocumentImporte",
      };
      try {
        const resultat = await signerPdfPades(contenu, coffre, options);
        signe = resultat.pdf;
        certificat = resultat.certificat;
      } catch (e) {
        return echec("Signature PAdES impossible : " + String((e as Error).message || e));
      }
      verif = { statut: "NON_VERIFIE", message: "" };
      if (cfg.verifierAuto) {
        const rapport = await verifierPdfPades(signe);
        verif = { statut: rapport.integrite ? "VALIDE" : "INVALIDE", message: rapport.message };
        if (!rapport.integrite) {
          return echec("Signature produite mais INVALIDE (elle n'a PAS été conservée) : " + rapport.message);
        }
      }
      nature = "PADES_PDF";
      extStocke = ".pdf";
    }
  } else {
    // ---- formats NON PDF : PKCS#7/CMS détaché (mode LOCALE uniquement) ----
    if (cfg.mode === "API_EXTERNE") {
      return echec(
        "Le mode actuel délègue la signature à une API externe qui ne traite que les PDF. Pour signer « " +
          nomSur + " », basculez le module en mode LOCALE (certificat du serveur) dans Paramètres."
      );
    }
    let coffre: CoffreOuvert;
    try {
      coffre = await ouvrirCoffreLocal(cfg);
    } catch (e) {
      return echec(String((e as Error).message || e));
    }
    let signatureP7s: Buffer;
    try {
      const r = await signerCmsDetache(contenu, coffre);
      signatureP7s = r.signature;
    } catch (e) {
      return echec("Signature PKCS#7 impossible : " + String((e as Error).message || e));
    }
    certificat = coffre.metadonnees;
    const controle = await verifierCmsDetache(contenu, signatureP7s);
    if (!controle.integrite) {
      return echec("Signature produite mais INVALIDE (elle n'a PAS été conservée) : " + controle.message);
    }
    verif = { statut: "VALIDE", message: controle.message };
    const nomBase = nomSansExtension(nomSur);
    const nomSignature = nomBase + ".p7s";
    const zip = await archiveZipSignee(contenu, nomSur, signatureP7s, nomSignature, certificat);
    if (zip) {
      signe = zip;
      nature = "CMS_DETACHE_ZIP";
      extStocke = ".zip";
    } else {
      signe = signatureP7s;
      nature = "CMS_DETACHE_SEUL";
      extStocke = ".p7s";
    }
  }

  // ---- CONSERVATION chiffrée + registre (même discipline que Task 224) ----
  await dossierPrive(dossierDocumentsSignes());
  const nomStocke =
    "autre-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + empreinteOrigine.slice(0, 8) + extStocke;
  await fs.promises.writeFile(
    path.join(dossierDocumentsSignes(), nomStocke),
    encryptForStorage(signe),
    { mode: 0o600 }
  );

  const enregistrement = await db.signatureApiDocument.create({
    data: {
      type: "AUTRE",
      sourceId: "TELEVERSE",
      reference,
      nomFichier: nomSur,
      mode: cfg.mode,
      environnement: cfg.environnement,
      chemin: nomStocke,
      tailleOctets: signe.length,
      certSujet: certificat.sujet,
      certEmetteur: certificat.emetteur,
      certSerie: certificat.serie,
      certEmpreinte: certificat.empreinte,
      certValideDu: certificat.valideDu,
      certValideAu: certificat.valideAu,
      verifStatut: verif.statut,
      verifLe: verif.statut === "NON_VERIFIE" ? null : new Date(),
      verifMessage: verif.message.slice(0, 500),
      signePar: contexte.signePar,
      empreinteOrigine,
    },
  });

  const { titulaire, organisation } = sujetVersTitulaire(certificat.sujet);
  void titulaire;
  void organisation;

  // NOUVEAU (v0.2.124) — LIAISON AUTOMATIQUE À LA FICHE DE PAIE : si le PDF
  // signé manuellement EST le fichier d'une fiche déjà importée (octets
  // identiques), la copie signée est rattachée à la fiche — le portail
  // employé met à jour le statut (« Signée électroniquement ») et sert
  // désormais la copie signée. Jamais bloquant, aucun doublon (fiches déjà
  // signées exclues de la recherche).
  const fichesLiees = estUnPdf
    ? await lierCopieSigneeAuxFiches(
        await rechercherFichesCorrespondantes(contenu, empreinteOrigine, nomSur),
        nomStocke,
        {
          mode: cfg.mode,
          environnement: cfg.environnement,
          empreinteOrigine,
          signePar: contexte.signePar,
          certificat: {
            sujet: certificat.sujet,
            emetteur: certificat.emetteur,
            serie: certificat.serie,
            empreinte: certificat.empreinte,
            valideDu: certificat.valideDu,
            valideAu: certificat.valideAu,
          },
          verif,
        }
      )
    : [];

  return {
    ok: true,
    message:
      (nature === "PADES_PDF" ? "PDF signé électroniquement (PAdES)" : "Document signé électroniquement (PKCS#7/CMS détaché)") +
      " par « " + (certificat.sujet || "certificat inconnu") + " »." +
      (verif.statut === "VALIDE" ? " Intégrité vérifiée automatiquement." : "") +
      messageFichesLiees(fichesLiees),
    contenu: signe,
    nature,
    nomFichierSigne: nomSigne(nomSur, nomStocke),
    typeMime: typeMimePour(nomStocke),
    documentId: enregistrement.id,
    certificat: certificatPublic(certificat),
    verification: verif,
    dejaSigne: false,
    fichesLiees,
  };
}

/* ------------------------------------------------------------------ */
/* Aides nommage / mime / certificat public                            */
/* ------------------------------------------------------------------ */

/** NOUVEAU (v0.2.124) — mention lisible des fiches de paie liées : le
 * téléverseur voit immédiatement que le portail employé va afficher le
 * badge « Signée électroniquement » (et servir la copie signée). */
function messageFichesLiees(liees: Array<{ id: string; reference: string }>): string {
  if (!liees.length) return "";
  if (liees.length === 1)
    return " Fiche de paie correspondante liée (« " + liees[0].reference + " ») : le statut « Signée électroniquement » est désormais visible dans le portail employé.";
  return (
    " " + liees.length + " fiches de paie correspondantes liées (" + liees.slice(0, 3).map((f) => "« " + f.reference + " »").join(", ") +
    (liees.length > 3 ? "…" : "") + ") : le statut « Signée électroniquement » est désormais visible dans le portail employé."
  );
}

function nomSansExtension(nom: string): string {
  return nom.replace(/\.[A-Za-z0-9]{1,12}$/, "") || nom;
}

function nomSigne(nomOriginal: string, cheminStocke: string): string {
  const ext = cheminStocke.endsWith(".pdf")
    ? ".pdf"
    : cheminStocke.endsWith(".zip")
      ? ".zip"
      : cheminStocke.endsWith(".p7s")
        ? ".p7s"
        : ".pdf";
  if (ext === ".pdf") return nomSansExtension(nomOriginal) + "-signe.pdf";
  if (ext === ".zip") return nomSansExtension(nomOriginal) + "-signe.zip";
  return nomSansExtension(nomOriginal) + "-signature.p7s";
}

function typeMimePour(chemin: string): string {
  if (chemin.endsWith(".pdf")) return "application/pdf";
  if (chemin.endsWith(".zip")) return "application/zip";
  if (chemin.endsWith(".p7s")) return "application/pkcs7-signature";
  return "application/octet-stream";
}

function cnDe(sujet: string): string {
  const { titulaire } = sujetVersTitulaire(sujet);
  return titulaire || sujet || "Signataire";
}

/**
 * Certificat public pour l'interface — accepte indifféremment les
 * métadonnées du moteur ou une ligne du registre (typage structurel).
 */
function certificatPublic(m: {
  sujet: string;
  emetteur: string;
  serie: string;
  empreinte: string;
  valideDu: Date | null;
  valideAu: Date | null;
}): ResultatDocumentSigne["certificat"] {
  const { titulaire, organisation } = sujetVersTitulaire(m.sujet);
  return {
    sujet: m.sujet,
    titulaire,
    organisation,
    emetteur: m.emetteur,
    serie: m.serie,
    empreinte: m.empreinte,
    valideDu: m.valideDu,
    valideAu: m.valideAu,
  };
}
