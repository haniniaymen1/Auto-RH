/**
 * ============================================================================
 *  NOUVEAU (Task 224) — ORCHESTRATEUR « API DE CERTIFICATION ET SIGNATURE
 *  ÉLECTRONIQUE »
 * ============================================================================
 *
 *  Coordonne la signature électronique PAdES des documents du système selon la
 *  configuration singleton « signature-api » (rubrique « API de certification
 *  & signature » de l'onglet Paramètres) :
 *
 *    - mode LOCALE       : signature PAdES-B-B réalisée par le serveur avec
 *                          le certificat importé (src/lib/signature-pades.ts) ;
 *    - mode API_EXTERNE  : délégation à un service REST de signature
 *                          (URL test/production, Bearer/API-Key/Basic, secret
 *                          chiffré, réponse binaire ou JSON base64).
 *
 *  CONSERVATION : chaque document signé est conservé CHIFFRÉ
 *  (storage/signatures/documents/, AES-256-GCM — même discipline que les
 *  fiches) et enregistré dans SignatureApiDocument avec les métadonnées du
 *  certificat ASSOCIÉ (extraites du document signé, jamais saisies à la main)
 *  et le résultat de la VÉRIFICATION d'intégrité.
 *
 *  CACHE : le servage d'une même fiche (mêmes octets tamponnés) ne re-signe
 *  JAMAIS — la copie signée conservée est servie telle quelle (empreinte
 *  d'origine = SHA-256 du PDF AVANT signature). Un réimport/re-tamponnage
 *  change l'empreinte → nouvelle signature.
 *
 *  SÉCURITÉ : le secret API et les mots de passe du certificat sont chiffrés
 *  en base (carte SignatureApiConfig de db-crypto.ts) et ne sont JAMAIS
 *  renvoyés à l'interface ; les fichiers du coffre sont chiffrés sur disque
 *  (0600, dossier 0700) ; le coffre n'est déballé qu'en mémoire le temps de
 *  la signature (dossier de travail éphémère effacé).
 * ============================================================================
 */
import "server-only";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { decryptFromStorage, encryptForStorage } from "@/lib/storage-crypto";
import { getProjectRoot, resolveStoredFile } from "@/lib/storage-dir";
import {
  CoffreOuvert,
  MetadonneesCertificat,
  OptionsSignaturePades,
  ouvrirCertificat,
  signerPdfPades,
  verifierPdfPades,
  contientSignaturePades,
} from "@/lib/signature-pades";

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

export type ModeSignature = "LOCALE" | "API_EXTERNE";
export type TypeDocumentSigne = "FICHE_PAIE" | "REPONSE";

export interface ConfigSignatureApi {
  id: string;
  actif: boolean;
  mode: ModeSignature;
  environnement: string; // TEST | PRODUCTION
  signerFiches: boolean;
  signerReponses: boolean;
  raison: string;
  emplacement: string;
  contact: string;
  // certificat local
  certFormat: string;
  certFichierNom: string;
  certChemin: string;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideDu: Date | null;
  certValideAu: Date | null;
  certEmpreinte: string;
  certImportLe: Date | null;
  certCleChemin: string;
  certCleFichierNom: string;
  certCleType: string;
  certCleImportLe: Date | null;
  // API externe
  apiUrlTest: string;
  apiUrlProd: string;
  apiAuthType: string;
  apiAuthEntete: string;
  apiIdentifiant: string;
  apiEntetesSup: string;
  apiChampReponse: string;
  apiTimeoutMs: number;
  apiDernierTestLe: Date | null;
  apiDernierTestOk: boolean;
  apiDernierTestMessage: string;
  verifierAuto: boolean;
  updatedAt: Date;
}

/** Version SÉCURISÉE pour l'interface : aucun secret renvoyé. */
export interface ConfigPublique extends Omit<ConfigSignatureApi, "certChemin" | "certCleChemin"> {
  certMotDePasseEnregistre: boolean;
  certCleMotDePasseEnregistre: boolean;
  apiSecretEnregistre: boolean;
  apiUrlActive: string;
}

/* ------------------------------------------------------------------ */
/* Configuration singleton                                             */
/* ------------------------------------------------------------------ */

export const ID_CONFIG_SIGNATURE_API = "signature-api";

export async function lireConfigSignatureApi(): Promise<ConfigSignatureApi> {
  let ligne = await db.signatureApiConfig.findUnique({
    where: { id: ID_CONFIG_SIGNATURE_API },
  });
  if (!ligne) {
    ligne = await db.signatureApiConfig.create({ data: { id: ID_CONFIG_SIGNATURE_API } });
  }
  return ligne as unknown as ConfigSignatureApi;
}

/** URL ACTIVE selon l'environnement choisi (test → apiUrlTest, sinon prod). */
export function urlActive(cfg: ConfigSignatureApi): string {
  return (cfg.environnement === "PRODUCTION" ? cfg.apiUrlProd : cfg.apiUrlTest).trim();
}

/** Cache la configuration pour l'interface (aucun secret renvoyé). */
export function configPublique(cfg: ConfigSignatureApi): ConfigPublique {
  const { certChemin, certCleChemin, ...visible } = cfg as ConfigSignatureApi & {
    certMotDePasse?: string;
    certCleMotDePasse?: string;
    apiSecret?: string;
  };
  return {
    ...(visible as unknown as ConfigSignatureApi),
    certMotDePasseEnregistre: Boolean(cfg["certMotDePasse"]),
    certCleMotDePasseEnregistre: Boolean(cfg["certCleMotDePasse"]),
    apiSecretEnregistre: Boolean(cfg["apiSecret"]),
    apiUrlActive: urlActive(cfg),
  } as ConfigPublique;
}

/* ------------------------------------------------------------------ */
/* Dossiers de conservation                                            */
/* ------------------------------------------------------------------ */

export function dossierSignatures(): string {
  return path.join(getProjectRoot(), "storage", "signatures");
}

export function dossierDocumentsSignes(): string {
  return path.join(dossierSignatures(), "documents");
}

async function assurerDossierPrive(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.chmod(dir, 0o700);
  } catch {
    // systèmes sans permissions POSIX : sans effet
  }
}

/* ------------------------------------------------------------------ */
/* Coffre du certificat LOCAL                                          */
/* ------------------------------------------------------------------ */

async function lireFichierChiffre(cheminRelatif: string): Promise<Buffer> {
  // (CORRIGÉ Task 230 — cause du « 500 ponctuel » du POST /documents/{id}/
  // verifier documenté en Task 227) les copies des documents signés sont
  // écrites dans le SOUS-DOSSIER « documents » (dossierDocumentsSignes),
  // mais la lecture historique ne résolvait que storage/signatures/<nom> :
  // ENOENT systématique pour TOUTE vérification d'une copie conservée.
  // Résolution robuste : les deux emplacements possibles, certificats
  // (racine) comme copies conservées (documents/).
  const nom = path.basename(cheminRelatif);
  const candidats = [
    path.join(dossierSignatures(), nom),
    path.join(dossierDocumentsSignes(), nom),
  ];
  let derniere: unknown = null;
  for (const absolu of candidats) {
    try {
      const brut = await fs.promises.readFile(absolu);
      return decryptFromStorage(brut);
    } catch (e) {
      derniere = e;
    }
  }
  throw derniere instanceof Error
    ? derniere
    : new Error("Fichier chiffré introuvable : " + nom);
}

/**
 * Déballe le coffre du certificat local (déchiffre les fichiers, ouvre le
 * certificat + la clé privée). Jette une erreur française claire en cas de
 * problème (mot de passe, fichier manquant, paire incohérente).
 */
export async function ouvrirCoffreLocal(cfg: ConfigSignatureApi): Promise<CoffreOuvert> {
  if (!cfg.certChemin) {
    throw new Error(
      "Aucun certificat importé : importez le certificat de signature (.p12/.pfx, ou certificat + clé privée) dans la rubrique « API de certification & signature » avant de signer."
    );
  }
  const donneesCertificat = await lireFichierChiffre(cfg.certChemin);
  let donneesCle: Buffer | null = null;
  if (cfg.certCleChemin) {
    donneesCle = await lireFichierChiffre(cfg.certCleChemin);
  }
  return ouvrirCertificat({
    donneesCertificat,
    motDePasse: cfg["certMotDePasse"] || "",
    donneesCle,
    motDePasseCle: cfg["certCleMotDePasse"] || "",
  });
}

/* ------------------------------------------------------------------ */
/* CLIENT API EXTERNE                                                  */
/* ------------------------------------------------------------------ */

function entetesApi(cfg: ConfigSignatureApi, secret: string): Record<string, string> {
  const entetes: Record<string, string> = {};
  const type = cfg.apiAuthType || "BEARER";
  if (type === "BEARER" && secret) {
    entetes["Authorization"] = "Bearer " + secret;
  } else if (type === "API_KEY" && secret) {
    entetes[cfg.apiAuthEntete || "X-API-Key"] = secret;
  } else if (type === "BASIC") {
    entetes["Authorization"] =
      "Basic " + Buffer.from((cfg.apiIdentifiant || "") + ":" + (secret || "")).toString("base64");
  }
  // En-têtes additionnels JSON {"X-Client":"AutoRH", ...}
  if (cfg.apiEntetesSup) {
    try {
      const sup = JSON.parse(cfg.apiEntetesSup) as Record<string, string>;
      for (const [k, v] of Object.entries(sup)) {
        if (typeof v === "string") entetes[k] = v;
      }
    } catch {
      throw new Error(
        "En-têtes additionnels invalides : la valeur doit être un objet JSON (ex. {\"X-Client\":\"AutoRH\"})."
      );
    }
  }
  return entetes;
}

/** Lit un chemin pointé (« data.file ») dans un objet JSON quelconque. */
function valeurPointee(objet: unknown, chemin: string): unknown {
  let courant: unknown = objet;
  for (const segment of chemin.split(".").filter(Boolean)) {
    if (courant && typeof courant === "object" && segment in (courant as Record<string, unknown>)) {
      courant = (courant as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return courant;
}

async function corpsVersPdf(
  reponse: Response,
  champReponse: string
): Promise<Buffer> {
  const type = (reponse.headers.get("content-type") || "").toLowerCase();
  if (type.includes("pdf") || type.includes("octet-stream") || type === "") {
    const buf = Buffer.from(await reponse.arrayBuffer());
    if (buf.length > 4 && buf.subarray(0, 4).toString("latin1") === "%PDF") return buf;
    throw new Error(
      "L'API a répondu " + reponse.status + " mais le contenu renvoyé n'est pas un PDF (type " + (type || "inconnu") + ")."
    );
  }
  // JSON : chercher le PDF (champ configuré ou champs usuels)
  const json = (await reponse.json().catch(() => null)) as unknown;
  const chemins = champReponse
    ? [champReponse]
    : ["data.file", "data.pdf", "data.signedFile", "data.signedPdf", "file", "pdf", "signedFile", "signedPdf", "content", "document"];
  for (const chemin of chemins) {
    const v = valeurPointee(json, chemin);
    if (typeof v === "string" && v.length > 100) {
      const buf = Buffer.from(v, "base64");
      if (buf.subarray(0, 4).toString("latin1") === "%PDF") return buf;
    }
  }
  throw new Error(
    "L'API a répondu en JSON mais aucun PDF signé n'a été trouvé" +
      (champReponse ? " au champ « " + champReponse + " »" : "") +
      ". Configurez le champ de réponse (ex. data.signedFile) ou vérifiez la documentation du fournisseur."
  );
}

/**
 * Appelle l'API externe de signature avec le PDF à signer.
 * (NOUVEAU Task 224) multipart/form-data, champ « file » + auth configurée.
 */
export async function signerViaApiExterne(
  pdf: Buffer,
  nomFichier: string,
  cfg: ConfigSignatureApi
): Promise<Buffer> {
  const url = urlActive(cfg);
  if (!url) {
    throw new Error(
      "Aucune URL d'API configurée pour l'environnement " +
        (cfg.environnement === "PRODUCTION" ? "PRODUCTION" : "TEST") +
        " : renseignez l'URL du service de signature dans la configuration."
    );
  }
  const secret = cfg["apiSecret"] || "";
  const entetes = entetesApi(cfg, secret);
  const formulaire = new FormData();
  formulaire.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), nomFichier || "document.pdf");
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), Math.max(5000, cfg.apiTimeoutMs || 30000));
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: "POST",
      headers: entetes,
      body: formulaire,
      signal: controleur.signal,
    });
  } catch (e) {
    clearTimeout(minuteur);
    const message = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(message)) {
      throw new Error(
        "L'API de signature n'a pas répondu dans le délai imparti (" + (cfg.apiTimeoutMs || 30000) + " ms) : " + url
      );
    }
    throw new Error("Connexion à l'API de signature impossible (" + message + ") : " + url);
  }
  clearTimeout(minuteur);
  if (!reponse.ok) {
    let detail = "";
    try {
      detail = (await reponse.text()).slice(0, 300);
    } catch {
      // corps illisible : détail vide
    }
    throw new Error(
      "L'API de signature a répondu " + reponse.status + " " + reponse.statusText + (detail ? " — " + detail : "")
    );
  }
  return corpsVersPdf(reponse, cfg.apiChampReponse || "");
}

// NOUVEAU (v0.2.116) : réplique du tampon du servage pour la signature
// AUTOMATIQUE des fiches de paie PDF dès l'IMPORTATION (même empreinte
// garantie → la copie conservée à l'import est re-servie telle quelle au
// téléchargement, sans nouvelle signature — cache par empreinte).
import {
  tamponnerFicheDossier,
  tamponActif,
  typeFichierTamporable,
  type InfosFiche,
  type ConfigTampon,
} from "@/lib/stamp";

/* ------------------------------------------------------------------ */
/* (NOUVEAU v0.2.119) — ÉLÉMENT « SIGNATURE ÉLECTRONIQUE » DU TAMPON   */
/* ------------------------------------------------------------------ */

/**
 * NOUVEAU (v0.2.119) — injecte les MÉTADONNÉES PUBLIQUES du certificat du
 * module de signature (SignatureApiConfig, onglet « Paramètres ») dans la
 * configuration du tampon, pour alimenter le cachet « Signature
 * électronique » dessiné par stamp.ts (bloc ENCADRÉ : titulaire, organisation,
 * émetteur, validité, empreinte SHA-256). Le contenu est lu EN DIRECT à
 * chaque apposition — il n'est JAMAIS stocké en base : la suppression/le
 * remplacement du certificat dans le module se reflète immédiatement dans
 * le tampon.
 *
 * RÈGLE DE COHÉRENCE (garantie du produit) : un document portant le cachet
 * « Signature électronique » est toujours RÉELLEMENT signé — la signature
 * PAdES est appliquée JUSTE APRÈS le tamponnage, sur ces mêmes octets (le
 * cachet est donc couvert par elle). Conditions d'apposition :
 *   - le Switch elecActif du tampon est ON ;
 *   - le module de signature est ACTIF et couvre le PÉRIMÈTRE concerné
 *     (FICHES → signerFiches, REPONSES → signerReponses) ;
 *   - le mode est LOCALE avec un CERTIFICAT chargé (certSujet renseigné).
 *     En mode API_EXTERNE le certificat effectif n'est connu qu'APRÈS la
 *     signature (extrait du document renvoyé par le fournisseur) : le cachet
 *     n'est volontairement PAS apposé (jamais trompeur).
 *
 * Jamais bloquant : en cas d'erreur, la configuration est renvoyée inchangée
 * (le cachet est simplement absent, comportement antérieur inchangé).
 *
 * Jumelle APERÇU : la même fonction est utilisée par /api/signature-config
 * (POST action=apercu) pour prévisualiser le cachet fidèlement.
 */
// (CORRECTIF v0.2.201) : `completerConfigTamponAvecElec` RENVOIE un objet
// `Partial<ConfigTampon>` AVEC une propriété supplémentaire `elec` quand
// la signature électronique est couverte (certificat chargé + mode LOCALE
// + périmètre couvert). Le type de retour DOIT donc inclure cette pro-
// priété optionnelle — sinon les appelants qui lisent `cfgJugee.elec`
// (signature-config/route.ts, ligne ~1011) déclenchent TS2339.
export interface ElecCouvert {
  certSujet: string | null;
  certEmetteur: string | null;
  certEmpreinte: string | null;
  certValideAu: Date | null;
}

export async function completerConfigTamponAvecElec(
  cfg: Partial<ConfigTampon> | null | undefined,
  perimetre: "FICHES" | "REPONSES"
): Promise<Partial<ConfigTampon> & { elec?: ElecCouvert }> {
  // (CORRECTIF v0.2.201) : `Partial<ConfigTampon>` est assignable à
  // `Partial<ConfigTampon> & { elec?: ElecCouvert }` (intersection avec
  // propriété optionnelle), mais TypeScript est strict et exige un cast
  // explicite. On utilise un type alias pour la lisibilité.
  type Retour = Partial<ConfigTampon> & { elec?: ElecCouvert };
  try {
    if (!cfg) return {} as Retour;
    if (!cfg.elecActif) return cfg as Retour;
    const cfgSig = await lireConfigSignatureApi();
    const couvert =
      cfgSig.actif &&
      cfgSig.mode === "LOCALE" &&
      String(cfgSig.certSujet ?? "").trim() &&
      (perimetre === "FICHES" ? cfgSig.signerFiches : cfgSig.signerReponses);
    if (!couvert) return cfg as Retour;
    return {
      ...cfg,
      elec: {
        certSujet: cfgSig.certSujet,
        certEmetteur: cfgSig.certEmetteur,
        certEmpreinte: cfgSig.certEmpreinte,
        certValideAu: cfgSig.certValideAu,
      },
    };
  } catch (e) {
    console.error(
      "[SIGNATURE-ELEC-TAMPON] Injection des métadonnées du certificat impossible (cachet non apposé):",
      e
    );
    return (cfg ?? {}) as Retour;
  }
}

/* ------------------------------------------------------------------ */
/* SIGNATURE + CONSERVATION + VÉRIFICATION                             */
/* ------------------------------------------------------------------ */

/**
 * NOUVEAU (v0.2.116) — SIGNATURE ÉLECTRONIQUE AUTOMATIQUE D'UNE FICHE DE
 * PAIE PDF DÈS L'IMPORTATION (demande utilisateur : « lorsque j'importe
 * fiches de paie automatique signé »).
 *
 * Réplique EXACTEMENT la chaîne du servage (tampon éventuel → signature
 * PAdES → conservation chiffrée + registre) afin que l'empreinte du
 * contenu signé à l'importation soit IDENTIQUE à celle du servage : la
 * copie conservée à l'import est alors RESENTIE TELLE QUELLE au
 * téléchargement (cache par empreinte — une seule signature, une seule
 * entrée de registre par fiche et par contenu).
 *
 * - JAMAIS bloquant : tout échec est journalisé et renvoyé sous forme de
 *   message ; l'importation se poursuit (la fiche reste signable au
 *   servage, discipline Task 224).
 * - PDF uniquement : le moteur PAdES est propre aux PDF — les fiches
 *   image/Excel/Word importées restent servables telles quelles (elles
 *   restent signables manuellement depuis l'onglet Signature).
 */
export interface ResultatSignatureImport {
  tente: boolean; // module actif + couvre les fiches + contenu PDF
  ok: boolean; // signature réussie (ou copie conservée resservie)
  dejaSigne: boolean; // copie conservée déjà existante réutilisée
  message: string; // message français (vide si tente = false)
  documentId?: string; // registre : copie conservée
}

export async function signerFicheApresImport(
  contenu: Buffer,
  ctx: {
    ficheId: string;
    reference: string;
    nomFichier: string;
    employeeName?: string | null;
    cin?: string | null;
    period?: string | null;
    netSalary?: string | null;
    uploadedAt?: Date | string | null;
    // NOUVEAU (v0.2.122) : origine de la signature tracée au registre —
    // "système (import fiche de paie)" par défaut (comportement historique
    // inchangé) ; le rattrapage à l'activation du module utilise sa propre
    // mention pour une traçabilité fidèle.
    signePar?: string;
    // NOUVEAU (v0.2.124) : RATTRAPAGE MANUEL (bouton du panneau « API de
    // certification & signature ») — l'IT/Superadmin demande EXPLICITEMENT
    // la signature des fiches déjà importées : l'option « Fiches de paie »
    // (signerFiches — couverture des NOUVELLES fiches à l'import/servage)
    // n'est PAS exigée. Le module doit rester ACTIF (certificat disponible) :
    // c'est la seule condition conservée.
    ignorerCouverture?: boolean;
  }
): Promise<ResultatSignatureImport> {
  const echec = (message: string): ResultatSignatureImport => ({
    tente: true,
    ok: false,
    dejaSigne: false,
    message,
  });
  try {
    const cfg = await lireConfigSignatureApi();
    // (v0.2.124) le rattrapage MANUEL passe l'option ignorerCouverture : il
    // exige uniquement le module ACTIF (l'option signerFiches ne couvre que
    // les fiches NOUVELLES — import/servage — pas ce rattrapage explicite).
    if (!cfg.actif || (!cfg.signerFiches && !ctx.ignorerCouverture)) {
      return { tente: false, ok: false, dejaSigne: false, message: "" };
    }
    // PDF uniquement (le moteur PAdES est propre au PDF)
    if (
      contenu.length < 5 ||
      contenu.subarray(0, 5).toString("latin1") !== "%PDF-"
    ) {
      return { tente: false, ok: false, dejaSigne: false, message: "" };
    }
    // Réplique du servage : tampon éventuel AVANT signature (même empreinte
    // garantie → la copie conservée à l'import est servie telle quelle au
    // téléchargement). En cas d'échec du tampon, signature sur l'original.
    let donnees = contenu;
    try {
      const typeTampon = typeFichierTamporable("application/pdf");
      if (typeTampon) {
        // (NOUVEAU v0.2.119) injection des métadonnées du certificat du
        // module AVANT l'évaluation du tampon : le cachet « Signature
        // électronique » (elecActif ON) est dessiné puis COUVERT par la
        // signature PAdES appliquée juste après (signerEtConserver).
        const cfgTampon = await completerConfigTamponAvecElec(
          await db.signatureConfig.findUnique({ where: { id: "signature" } }),
          "FICHES"
        );
        if (tamponActif(cfgTampon)) {
          const infos: InfosFiche = {
            id: ctx.ficheId,
            employeeName: ctx.employeeName ?? null,
            cin: ctx.cin ?? null,
            period: ctx.period ?? null,
            netSalary: ctx.netSalary ?? null,
            uploadedAt: ctx.uploadedAt ?? new Date(),
          };
          donnees = await tamponnerFicheDossier(
            contenu,
            infos,
            cfgTampon as never,
            typeTampon
          );
        }
      }
    } catch (e) {
      console.error(
        "[SIGNATURE-IMPORT] Tampon non appliqué (signature sur original):",
        e
      );
      donnees = contenu;
    }
    const resultat = await signerEtConserver(donnees, {
      type: "FICHE_PAIE",
      sourceId: ctx.ficheId,
      reference: ctx.reference,
      nomFichier: ctx.nomFichier,
      signePar: ctx.signePar || "système (import fiche de paie)",
    });
    if (resultat.ok && resultat.pdf) {
      console.log(
        "[SIGNATURE-IMPORT] Fiche " +
          ctx.ficheId +
          " signée" +
          (resultat.dejaSigne ? " (copie conservée)" : "") +
          " — " +
          resultat.message
      );
      return {
        tente: true,
        ok: true,
        dejaSigne: !!resultat.dejaSigne,
        message: resultat.message,
        documentId: resultat.documentId,
      };
    }
    console.error(
      "[SIGNATURE-IMPORT] Signature refusée pour",
      ctx.ficheId,
      ":",
      resultat.message
    );
    return echec(resultat.message);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(
      "[SIGNATURE-IMPORT] Erreur (non bloquant) pour",
      ctx.ficheId,
      ":",
      e
    );
    return echec(message);
  }
}

/** Suffixe de message d'import pour UNE fiche (résultat de la signature). */
export function suffixeMessageSignatureImport(
  r: ResultatSignatureImport
): string {
  if (!r.tente) return "";
  if (r.ok) return " — Fiche signée électroniquement (PAdES).";
  return " — Signature électronique impossible : " + r.message;
}

/** Suffixe de message d'import pour un PDF divisé en PLUSIEURS fiches. */
export function suffixeMessageSignaturesMultiples(
  rs: ResultatSignatureImport[]
): string {
  const tentes = rs.filter((x) => x.tente);
  if (tentes.length === 0) return "";
  const ok = tentes.filter((x) => x.ok).length;
  const ko = tentes.length - ok;
  if (ko === 0) {
    return ` — ${ok} fiche(s) signée(s) électroniquement (PAdES).`;
  }
  return ` — Signature électronique : ${ok} fiche(s) signée(s), ${ko} en échec (voir journaux du serveur).`;
}

/* ------------------------------------------------------------------ */
/* RATTRAPAGE AUTOMATIQUE — SIGNATURE DES FICHES DÉJÀ IMPORTÉES        */
/* ------------------------------------------------------------------ */

export interface ResultatRattrapageFiches {
  lance: boolean; // module actif + couvre les fiches
  examinees: number; // fiches PDF trouvées en base
  dejaSignees: number; // copie signée déjà présente au registre
  signees: number; // signées PAR CE rattrapage
  echecs: number; // échecs non bloquants (voir journaux)
  message: string; // résumé français (vide si lance = false)
}

/**
 * NOUVEAU (v0.2.122) — RATTRAPAGE AUTOMATIQUE À L'ACTIVATION DU MODULE.
 *
 * Demande utilisateur : « Toutes les fiches de paie mises à disposition dans
 * le portail employé doivent être signées électroniquement automatiquement
 * lorsque l'option de API de certification & signature électronique est
 * activée dans la configuration. La signature doit être appliquée
 * automatiquement à chaque fiche de paie lors de son importation, avant sa
 * mise à disposition dans le portail employé. »
 *
 * La signature à l'IMPORTATION existe depuis v0.2.116, mais les fiches
 * importées AVANT l'activation du module (ou dont la signature d'import
 * avait échoué — jamais bloquant) restaient servies au portail SANS copie
 * signée. Ce rattrapage boucle le dispositif : dès que le module est
 * activé (PUT de la configuration avec actif = true et signerFiches =
 * true), TOUTES les fiches PDF déjà en base reçoivent la MÊME chaîne que
 * l'import (tampon éventuel → signature PAdES → copie conservée chiffrée +
 * registre). Le portail (Task 231) sert ensuite cette copie signée à
 * l'employé — badge « Signée électroniquement ».
 *
 * - CHAÎNE IDENTIQUE à signerFicheApresImport (réutilisée telle quelle) :
 *   l'empreinte du contenu signé au rattrapage est celle du servage.
 * - CACHE : les fiches déjà signées (registre, une seule requête) sont
 *   IGNORÉES — jamais de double signature.
 * - NON BLOQUANT : toute erreur sur UNE fiche est journalisée et comptée
 *   sans interrompre le rattrapage ; l'activation de la configuration
 *   n'attend jamais la fin (fire-and-forget côté route).
 * - PDF uniquement : le moteur PAdES est propre aux PDF — les fiches
 *   image/Excel/Word ne sont pas concernées (comme à l'import).
 */
export async function signerToutesFichesExistantes(
  declencheur = "activation du module",
  // NOUVEAU (v0.2.124) — RATTRAPAGE MANUEL : quand opts.forcer = true (bouton
  // « Signer maintenant les fiches non signées » du panneau), la couverture
  // « Fiches de paie » (signerFiches) n'est PAS exigée : seul le module ACTIF
  // compte. Le rattrapage automatique à l'activation reste inchangé.
  opts?: { forcer?: boolean }
): Promise<ResultatRattrapageFiches> {
  const vide = (
    message = ""
  ): ResultatRattrapageFiches => ({
    lance: false,
    examinees: 0,
    dejaSignees: 0,
    signees: 0,
    echecs: 0,
    message,
  });
  try {
    const cfg = await lireConfigSignatureApi();
    // (v0.2.124) le rattrapage MANUEL (opts.forcer) ne demande PAS la
    // couverture « Fiches de paie » : seul le module ACTIF est exigé —
    // sinon le bouton serait inopérant exactement dans la situation
    // (signerFiches désactivé + fiches restées sans copie signée) où il
    // est utile. Le rattrapage automatique à l'activation garde ses règles.
    if (!cfg.actif || (!cfg.signerFiches && !opts?.forcer)) return vide();

    // Toutes les fiches de la base ; seules les fiches PDF sont signables
    // (le moteur PAdES est propre aux PDF — discipline de l'import v0.2.116).
    // (Task 244) la copie signée FIGÉE est aussi sélectionnée : une fiche
    // dont la signature d'origine est déjà posée (copie figée tampon/PAdES
    // servie aux portails) est DÉJÀ signée — elle n'est jamais re-signée.
    const fiches = await db.payslip.findMany({
      select: {
        id: true,
        storedName: true,
        fileName: true,
        employeeName: true,
        cin: true,
        period: true,
        netSalary: true,
        matricule: true,
        uploadedAt: true,
        copieSigneeNom: true,
      },
    });
    const pdfs = fiches.filter((f) =>
      String(f.storedName || "").toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) {
      return {
        lance: true,
        examinees: 0,
        dejaSignees: 0,
        signees: 0,
        echecs: 0,
        message: "Aucune fiche de paie PDF présente à signer.",
      };
    }

    // Registre : fiches DÉJÀ signées (une seule requête indexée) — jamais
    // de re-signature d'une fiche qui possède déjà sa copie conservée.
    // (Task 244) une fiche FIGÉE (signature d'origine déjà posée et servie)
    // est comptée DÉJÀ signée elle aussi : « les documents déjà signés ne
    // doivent être ni modifiés ni signés à nouveau automatiquement ».
    const signes = await db.signatureApiDocument.findMany({
      where: { type: "FICHE_PAIE", chemin: { not: "" } },
      select: { sourceId: true },
    });
    const dejaSignes = new Set(signes.map((s) => s.sourceId));

    let dejaSignees = 0;
    let signees = 0;
    let echecs = 0;
    for (const fiche of pdfs) {
      try {
        if (dejaSignes.has(fiche.id) || fiche.copieSigneeNom) {
          dejaSignees++;
          continue;
        }
        // Lecture + déchiffrement du fichier stocké (résolution robuste :
        // mêmes dossiers candidats que le servage — anciens emplacements
        // inclus). Fichier absent → échec non bloquant (compté, journalisé).
        const chemin = resolveStoredFile(fiche.storedName);
        if (!chemin) {
          echecs++;
          console.error(
            "[SIGNATURE-RATTRAPAGE] Fichier introuvable pour la fiche",
            fiche.id,
            "(" + fiche.storedName + ") — ignorée"
          );
          continue;
        }
        const contenu = decryptFromStorage(fs.readFileSync(chemin));
        const r = await signerFicheApresImport(contenu, {
          ficheId: fiche.id,
          reference:
            [fiche.matricule, fiche.period].filter(Boolean).join(" — ") ||
            fiche.id,
          nomFichier: fiche.fileName || fiche.storedName,
          employeeName: fiche.employeeName,
          cin: fiche.cin,
          period: fiche.period,
          netSalary: fiche.netSalary,
          uploadedAt: fiche.uploadedAt,
          signePar: "système (rattrapage — " + declencheur + ")",
          // (v0.2.124) rattrapage MANUEL : l'option « Fiches de paie » ne
          // couvre que les NOUVELLES fiches — ici la demande est explicite.
          ignorerCouverture: opts?.forcer === true,
        });
        if (r.ok) signees++;
        else echecs++;
      } catch (e) {
        echecs++;
        console.error(
          "[SIGNATURE-RATTRAPAGE] Erreur non bloquante sur la fiche",
          fiche.id,
          ":",
          e
        );
      }
    }
    const message =
      "Rattrapage terminé : " +
      signees +
      " fiche(s) signée(s)" +
      (dejaSignees ? ", " + dejaSignees + " déjà signée(s)" : "") +
      (echecs ? ", " + echecs + " en échec (voir journaux)" : "") +
      ".";
    console.log("[SIGNATURE-RATTRAPAGE] " + message);
    return {
      lance: true,
      examinees: pdfs.length,
      dejaSignees,
      signees,
      echecs,
      message,
    };
  } catch (e) {
    console.error("[SIGNATURE-RATTRAPAGE] Échec global (non bloquant):", e);
    return vide("Rattrapage impossible : " + (e instanceof Error ? e.message : String(e)));
  }
}

export interface ContexteSignature {
  type: TypeDocumentSigne;
  sourceId: string;
  reference: string;
  nomFichier: string;
  signePar: string;
}

export interface ResultatSignature {
  ok: boolean;
  pdf: Buffer | null;
  documentId?: string;
  dejaSigne?: boolean;
  message: string;
  verification?: { integrite: boolean; signataire: string; certificatValide: boolean };
}

/**
 * Signe un PDF (mode configuré), conserve la copie signée chiffrée, enregistre
 * le certificat associé et le résultat de vérification dans le registre.
 * CACHE : mêmes type + sourceId + empreinte d'origine → la copie déjà signée
 * est renvoyée telle quelle (jamais de re-signature d'un contenu identique).
 */
export async function signerEtConserver(
  pdf: Buffer,
  contexte: ContexteSignature
): Promise<ResultatSignature> {
  const empreinteOrigine = crypto.createHash("sha256").update(pdf).digest("hex");

  // ---- CACHE : contenu identique déjà signé ? ----
  const existant = await db.signatureApiDocument.findFirst({
    where: { type: contexte.type, sourceId: contexte.sourceId, empreinteOrigine },
    orderBy: { signeLe: "desc" },
  });
  if (existant?.chemin) {
    try {
      const copie = await lireFichierChiffre(existant.chemin);
      return {
        ok: true,
        pdf: copie,
        documentId: existant.id,
        dejaSigne: true,
        message: "Copie signée conservée servie (signature du " + existant.signeLe.toISOString() + ").",
      };
    } catch {
      // copie illisible (clé changée) : re-signature en dessous
    }
  }

  const cfg = await lireConfigSignatureApi();

  // ---- SIGNATURE selon le mode ----
  let signe: Buffer;
  let certificat: MetadonneesCertificat;
  if (cfg.mode === "API_EXTERNE") {
    signe = await signerViaApiExterne(pdf, contexte.nomFichier, cfg);
    // Le certificat associé est EXTRAIT du document signé (source de vérité)
    const rapport = await verifierPdfPades(signe);
    certificat = {
      sujet: rapport.signataire,
      emetteur: rapport.emetteur,
      serie: rapport.serie,
      valideDu: rapport.valideDu,
      valideAu: rapport.valideAu,
      empreinte: rapport.empreinte,
      algorithmeCle: "",
    };
    if (!rapport.integrite && contientSignaturePades(signe)) {
      // le fournisseur a répondu mais la signature est invalide : on refuse
      return { ok: false, pdf: null, message: "Signature renvoyée par l'API INVALIDE : " + rapport.message };
    }
  } else {
    const coffre = await ouvrirCoffreLocal(cfg);
    const options: OptionsSignaturePades = {
      raison: cfg.raison || "Approbation du document",
      emplacement: cfg.emplacement || "",
      contact: cfg.contact || "",
      nomSignataire: certificatNom(coffre),
      nomChamp: contexte.type === "FICHE_PAIE" ? "SignatureFichePaie" : "SignatureReponse",
    };
    const resultat = await signerPdfPades(pdf, coffre, options);
    signe = resultat.pdf;
    certificat = resultat.certificat;
  }

  // ---- VÉRIFICATION automatique du résultat ----
  let verifStatut = "NON_VERIFIE";
  let verifMessage = "";
  if (cfg.verifierAuto) {
    const rapport = await verifierPdfPades(signe);
    verifStatut = rapport.integrite ? "VALIDE" : "INVALIDE";
    verifMessage = rapport.message;
    if (!rapport.integrite) {
      return { ok: false, pdf: null, message: "Signature produite mais INVALIDE : " + rapport.message };
    }
  }

  // ---- CONSERVATION chiffrée + registre ----
  await assurerDossierPrive(dossierDocumentsSignes());
  const nomStocke =
    contexte.type.toLowerCase() +
    "-" +
    Date.now() +
    "-" +
    crypto.randomBytes(4).toString("hex") +
    "-" +
    empreinteOrigine.slice(0, 8) +
    ".pdf";
  await fs.promises.writeFile(
    path.join(dossierDocumentsSignes(), nomStocke),
    encryptForStorage(signe),
    { mode: 0o600 }
  );
  const enregistrement = await db.signatureApiDocument.create({
    data: {
      type: contexte.type,
      sourceId: contexte.sourceId,
      reference: contexte.reference,
      nomFichier: contexte.nomFichier,
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
      verifStatut,
      verifLe: verifStatut === "NON_VERIFIE" ? null : new Date(),
      verifMessage,
      signePar: contexte.signePar,
      empreinteOrigine,
    },
  });
  return {
    ok: true,
    pdf: signe,
    documentId: enregistrement.id,
    message:
      "Document signé électroniquement (" +
      (cfg.mode === "API_EXTERNE" ? "API externe" : "PAdES local") +
      ") par « " +
      (certificat.sujet || "certificat inconnu") +
      " ».",
    verification: { integrite: verifStatut === "VALIDE", signataire: certificat.sujet, certificatValide: true },
  };
}

function certificatNom(coffre: CoffreOuvert): string {
  const cn = /(?:^|,)\s*CN\s*=\s*([^,]+)/.exec(coffre.metadonnees.sujet);
  return cn ? cn[1].trim() : coffre.metadonnees.sujet || "Signataire";
}

/** Re-vérifie un document conservé et met à jour le registre. */
export async function verifierDocumentConserve(id: string): Promise<{
  integrite: boolean;
  message: string;
  signataire: string;
  certificatValide: boolean;
}> {
  const ligne = await db.signatureApiDocument.findUnique({ where: { id } });
  if (!ligne?.chemin) {
    return { integrite: false, message: "Document introuvable dans le registre des signatures.", signataire: "", certificatValide: false };
  }
  const copie = await lireFichierChiffre(ligne.chemin);
  const rapport = await verifierPdfPades(copie);
  await db.signatureApiDocument.update({
    where: { id },
    data: {
      verifStatut: rapport.integrite ? "VALIDE" : "INVALIDE",
      verifLe: new Date(),
      verifMessage: rapport.message,
    },
  });
  return {
    integrite: rapport.integrite,
    message: rapport.message,
    signataire: rapport.signataire,
    certificatValide: rapport.certificatValide,
  };
}

/** Supprime un document du registre + sa copie conservée. */
export async function supprimerDocumentConserve(id: string): Promise<boolean> {
  const ligne = await db.signatureApiDocument.findUnique({ where: { id } });
  if (!ligne) return false;
  if (ligne.chemin) {
    await fs.promises
      .rm(path.join(dossierDocumentsSignes(), path.basename(ligne.chemin)), { force: true })
      .catch(() => {});
  }
  await db.signatureApiDocument.delete({ where: { id } });
  return true;
}

/* ------------------------------------------------------------------ */
/* TESTS (configuration + certificat)                                  */
/* ------------------------------------------------------------------ */

function pdfTemoin(): Buffer {
  // Petit PDF témoin 1 page généré par pdf-lib (dépendance du projet)
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 80]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF",
    "latin1"
  );
}

/** Résultat du test de configuration (mode LOCALE ou API_EXTERNE). */
export async function testerConfiguration(): Promise<{
  ok: boolean;
  message: string;
  detail: Record<string, unknown>;
}> {
  const cfg = await lireConfigSignatureApi();
  const debut = Date.now();
  if (cfg.mode === "API_EXTERNE") {
    try {
      const signe = await signerViaApiExterne(pdfTemoin(), "test-connexion.pdf", cfg);
      const duree = Date.now() - debut;
      const estPdf = signe.subarray(0, 4).toString("latin1") === "%PDF";
      await db.signatureApiConfig.update({
        where: { id: ID_CONFIG_SIGNATURE_API },
        data: {
          apiDernierTestLe: new Date(),
          apiDernierTestOk: estPdf,
          apiDernierTestMessage: estPdf
            ? "Connexion OK — PDF signé reçu (" + signe.length + " octets en " + duree + " ms)"
            : "Réponse inattendue (pas un PDF signé)",
        },
      });
      return {
        ok: estPdf,
        message: estPdf
          ? "Connexion à l'API réussie : un PDF signé de " + signe.length + " octets a été reçu en " + duree + " ms."
          : "L'API a répondu mais le contenu n'est pas un PDF signé.",
        detail: { dureeMs: duree, tailleOctets: signe.length },
      };
    } catch (e) {
      const message = String((e as Error).message || e);
      await db.signatureApiConfig.update({
        where: { id: ID_CONFIG_SIGNATURE_API },
        data: {
          apiDernierTestLe: new Date(),
          apiDernierTestOk: false,
          apiDernierTestMessage: message.slice(0, 500),
        },
      });
      return { ok: false, message, detail: { dureeMs: Date.now() - debut } };
    }
  }
  // ---- Mode LOCALE : déballer le coffre + signer le témoin + vérifier ----
  try {
    const coffre = await ouvrirCoffreLocal(cfg);
    const resultat = await signerPdfPades(pdfTemoin(), coffre, {
      raison: "Test de configuration",
      emplacement: "",
      contact: "",
      nomSignataire: certificatNom(coffre),
      nomChamp: "SignatureTest",
    });
    const rapport = await verifierPdfPades(resultat.pdf);
    const duree = Date.now() - debut;
    await db.signatureApiConfig.update({
      where: { id: ID_CONFIG_SIGNATURE_API },
      data: {
        apiDernierTestLe: new Date(),
        apiDernierTestOk: rapport.integrite,
        apiDernierTestMessage: rapport.integrite
          ? "Certificat opérationnel (« " + coffre.metadonnees.sujet + " ») — signature de test vérifiée en " + duree + " ms"
          : rapport.message.slice(0, 500),
      },
    });
    return {
      ok: rapport.integrite,
      message: rapport.integrite
        ? "Certificat opérationnel : « " + coffre.metadonnees.sujet + " » — un document de test a été signé et vérifié en " + duree + " ms."
        : rapport.message,
      detail: {
        dureeMs: duree,
        sujet: coffre.metadonnees.sujet,
        emetteur: coffre.metadonnees.emetteur,
        valideAu: coffre.metadonnees.valideAu,
        algorithmeCle: coffre.metadonnees.algorithmeCle,
      },
    };
  } catch (e) {
    const message = String((e as Error).message || e);
    await db.signatureApiConfig.update({
      where: { id: ID_CONFIG_SIGNATURE_API },
      data: {
        apiDernierTestLe: new Date(),
        apiDernierTestOk: false,
        apiDernierTestMessage: message.slice(0, 500),
      },
    });
    return { ok: false, message, detail: { dureeMs: Date.now() - debut } };
  }
}
