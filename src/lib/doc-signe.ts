/**
 * ============================================================================
 *  NOUVEAU (Task 179) — ADMINISTRATION : INTÉGRATION DU DOCUMENT D'ACCEPTATION
 *  SIGNÉ ÉLECTRONIQUEMENT ET TAMPONNÉ (côté serveur 4000, Next.js)
 * ============================================================================
 *  Wrapper TypeScript autour du module partagé scripts/document-acceptation.js
 *  (jumelle du portail employé 4001 — même moteur). Fournit au module :
 *   - dechiffrerChamp / chiffrerChamp (carte db-crypto — côté administration le
 *     middleware de src/lib/db.ts chiffre à l'écriture : chiffrerChamp est
 *     volontairement NON fourni au module pour éviter tout double chiffrement) ;
 *   - encryptForStorage (AES-256-GCM disque) ;
 *   - lireFichierStocke (lecture DÉCHIFFRÉE d'un chemin stocké — certificat) ;
 *   - dossierDocumentsDemandes (même dossier que les réponses RH → servie par
 *     les routes existantes : détail RH + « Mes demandes » du portail) ;
 *   - resoudreIdentite (nom = Accès portail « Nom et prénom » → nom de
 *     référence des fiches de paie → champs du formulaire ; matricule = fiche
 *     la plus récente du CIN) ;
 *   - envoyerMail (transport SMTP de lireConfigMail — MailConfig) ;
 *   - journaliser (logs/journal-emails.log, action "doc-signe").
 *
 *  Points d'appel (déclencheurs de l'acceptation FINALE) :
 *   - POST /api/demandes/[id]          (décision RH → ACCEPTEE) ;
 *   - POST /api/demandes/[id]/repondre (document importé → ACCEPTEE) ;
 *   - POST /api/demandes/[id]/doc-signe (génération / renvoi manuel, force) ;
 *   - /api/doc-signer-config           (aperçu, test d'envoi, certificat).
 * ============================================================================
 */
import path from "path";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { dechiffrerChamp } from "@/lib/db-crypto";
import { encryptForStorage, decryptFromStorage } from "@/lib/storage-crypto";
import { getStorageDir } from "@/lib/storage-dir";
import {
  transporteurDepuisConfig,
  journaliserEnvoi,
  // (CORRECTIF v0.2.201) : import du type EntreeJournalMail pour typer
  // proprement le spread dans les callbacks `journaliser` ci-dessous.
  type EntreeJournalMail,
} from "@/lib/mailer";
import { nomEmployeDepuisFiches } from "@/lib/demandes";

/* Module partagé (JavaScript pur) — typage minimal volontaire. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type ModuleDoc = any;
let _mod: ModuleDoc | null = null;

async function moduleDoc(): Promise<ModuleDoc> {
  if (!_mod) {
    _mod = await import("../../scripts/document-acceptation.js");
  }
  return _mod;
}

/* ------------------------------------------------------------------ */
/* Outils fournis au module                                            */
/* ------------------------------------------------------------------ */

/** Chemin ABSOLU d'un fichier stocké : les chemins relatifs (ex.
 *  « storage/signature-certificat/certificat-….p12 ») sont résolus depuis la
 *  RACINE du projet — getStorageDir() pointe sur storage/payslips, son
 *  grand-parent est la racine (repli : racine du répertoire de travail). */
function cheminAbsolu(cheminRelatif: string): string {
  if (path.isAbsolute(cheminRelatif)) return cheminRelatif;
  const racine = path.dirname(path.dirname(getStorageDir())); // parent de storage/
  return path.isAbsolute(racine)
    ? path.join(racine, cheminRelatif)
    : path.join(process.cwd(), cheminRelatif);
}

/** Lecture DÉCHIFFRÉE d'un fichier stocké (certificat .p12 chiffré disque). */
async function lireFichierStocke(cheminRelatif: string): Promise<Buffer | null> {
  try {
    const brut = await readFile(cheminAbsolu(cheminRelatif));
    return decryptFromStorage(brut);
  } catch {
    return null;
  }
}

/**
 * Identité de l'employé pour le document :
 *  1. « Nom et prénom » posé par le RH dans l'onglet Accès portail
 *     (PortalAccess.nomPrenom, chiffré — même source que les formulaires) ;
 *  2. nom de référence des fiches de paie (nomEmployeDepuisFiches) ;
 *  3. champs du formulaire (prenom/nom) — demandes antérieures ;
 *  matricule : fiche la plus récente du même CIN (champ chiffré).
 */
async function resoudreIdentite(
  _prisma: unknown,
  cin: string,
  donnees: Record<string, unknown>
): Promise<{ nom: string; matricule: string }> {
  let nom = "";
  let matricule = "";
  try {
    const q = String(cin || "").trim();
    if (q) {
      const acces = await db.portalAccess.findUnique({ where: { cin: q } });
      if (acces?.nomPrenom) {
        const np = String(dechiffrerChamp(acces.nomPrenom) || "").trim();
        if (np) nom = np;
      }
      if (!nom) {
        const depuisFiches = await nomEmployeDepuisFiches(q);
        if (depuisFiches) nom = depuisFiches;
      }
      if (!matricule) {
        const { chiffrerChamp } = await import("@/lib/db-crypto");
        const idx = chiffrerChamp(q, true);
        if (idx) {
          const fiche = await db.payslip.findFirst({
            where: { cinIndex: idx },
            orderBy: { uploadedAt: "desc" },
            select: { matricule: true },
          });
          if (fiche?.matricule) {
            matricule = String(dechiffrerChamp(fiche.matricule) || "").trim();
          }
        }
      }
    }
  } catch {
    // jamais bloquant — replis : champs du formulaire (fait par le module)
  }
  if (!nom) {
    const f = donnees || {};
    nom = [f.prenom, f.nom].filter(Boolean).join(" ").trim() ||
      String(f.nom || "").trim() || String(f.nomParrain || "").trim() || "";
  }
  return { nom, matricule };
}

/** Expéditeur du message via le SMTP configuré (lève ErreurMail si absent). */
async function envoyerMail(message: Record<string, unknown>): Promise<{ messageId: string; response: string }> {
  const { transport } = await transporteurDepuisConfig();
  const info = await transport.sendMail(message as never);
  return { messageId: info.messageId || "", response: info.response || "" };
}

/** Dossier des documents de demande (écriture du PDF signé). */
function dossierDocumentsDemandes(): string {
  return path.join(path.dirname(getStorageDir()), "documents-demandes");
}

/* ------------------------------------------------------------------ */
/* API du wrapper                                                      */
/* ------------------------------------------------------------------ */

export const TYPES_DOCUMENT_SIGNE = ["CONGE", "AUTORISATION_SORTIE"];
export const STATUTS_ACCEPTES = ["ACCEPTEE", "VALIDEE"];

export function estDocumentSigConcerne(type: string, statut: string): boolean {
  return (
    TYPES_DOCUMENT_SIGNE.indexOf(type) >= 0 &&
    STATUTS_ACCEPTES.indexOf(statut) >= 0
  );
}

/* ------------------------------------------------------------------ */
/* (NOUVEAU Task 180) DOCUMENT DE REFUS SIGNÉ & TAMPONNÉ               */
/* ------------------------------------------------------------------ */
/*  Jumeau du document d'acceptation : généré AUTOMATIQUEMENT quand la
 *  demande devient REFUSÉE — TOUS les types (congé, autorisation,
 *  attestation de travail, attestation de salaire, parrainage). Même
 *  moteur (scripts/document-refus.js, module partagé avec le portail),
 *  même certificat / tampon / paramètres d'envoi. */

/** Appel des déclencheurs du REFUS : après une décision REFUSÉE (RH ou
 *  réponse e-mail reconnue). JAMAIS bloquant — résultat (ou erreur) renvoyé. */
export async function declencherDocumentRefus(
  demandeId: string,
  options?: { declencheur?: string; forcer?: boolean }
): Promise<Record<string, unknown>> {
  try {
    const mod = await import("../../scripts/document-refus.js");
    return await mod.traiterRefus(db, demandeId, {
      dechiffrerChamp,
      encryptForStorage,
      lireFichierStocke,
      dossierDocumentsDemandes: dossierDocumentsDemandes(),
      resoudreIdentite,
      envoyerMail,
      journaliser: (e: Record<string, unknown>) =>
        // (CORRECTIF v0.2.201) : `as never` n'est pas un type objet valide
        // pour le spread (TS2698). On remplace par `as Partial<EntreeJournalMail>`
        // puis on surcharge `action` — comportement runtime identique.
        // Le cast final passe par `unknown` car Partial<EntreeJournalMail> +
        // action pourrait ne pas recouvrir tous les champs obligatoires.
        journaliserEnvoi({ ...(e as Partial<EntreeJournalMail>), action: "doc-refus" } as unknown as EntreeJournalMail),
      declencheur: options?.declencheur || "Système",
      forcer: Boolean(options?.forcer),
    });
  } catch (e) {
    return { genere: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}

/** Appel des déclencheurs : après une acceptation FINALE. JAMAIS bloquant :
 *  le résultat (ou l'erreur) est renvoyé, l'appelant continue quoi qu'il arrive. */
export async function declencherDocumentSigne(
  demandeId: string,
  options?: { declencheur?: string; forcer?: boolean }
): Promise<Record<string, unknown>> {
  try {
    const mod = await moduleDoc();
    return await mod.traiterAcceptationFinale(db, demandeId, {
      dechiffrerChamp,
      encryptForStorage,
      lireFichierStocke,
      dossierDocumentsDemandes: dossierDocumentsDemandes(),
      resoudreIdentite,
      envoyerMail,
      journaliser: (e: Record<string, unknown>) =>
        journaliserEnvoi({ ...(e as Partial<EntreeJournalMail>), action: "doc-signe" } as unknown as EntreeJournalMail),
      declencheur: options?.declencheur || "Système",
      forcer: Boolean(options?.forcer),
    });
  } catch (e) {
    return { genere: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}

/** Config complète pour /api/doc-signer-config (module partagé). */
export async function chargerConfigDoc(): Promise<Record<string, any>> {
  const mod = await moduleDoc();
  return mod.chargerConfig(db);
}

/** Diagnostic du certificat (panneau) : lecture + lecture PKCS#12. */
export async function verifierCertificatDoc(): Promise<Record<string, any>> {
  const mod = await moduleDoc();
  const cfg = await mod.chargerConfig(db);
  if (!cfg.certChemin) {
    return { ok: false, message: "Aucun certificat importé." };
  }
  const certificat = await mod.lireCertificat(cfg, {
    dechiffrerChamp,
    lireFichierStocke,
  });
  if (!certificat) {
    return { ok: false, message: "Fichier du certificat introuvable ou illisible sur le serveur." };
  }
  const diag = mod.verifierContenuCertificat(certificat.octets, certificat.motDePasse);
  return { ...diag, nom: cfg.certNom, importeLe: cfg.certImporteLe || null, empreinte: cfg.certEmpreinte };
}

/** APERÇU du document (sans stockage ni envoi) — demande réelle ou démo. */
export async function apercuDocumentSigne(
  demandeId: string | null
): Promise<{ pdf: Buffer; signatureCrypto: boolean; elements: string[]; reference: string }> {
  const mod = await moduleDoc();
  const cfg = await mod.chargerConfig(db);
  const r = await mod.apercuDocument(db, demandeId, cfg, {
    dechiffrerChamp,
    lireFichierStocke,
    resoudreIdentite,
  });
  return {
    pdf: Buffer.from(r.pdf),
    signatureCrypto: Boolean(r.signatureCrypto),
    elements: r.elements || [],
    reference: r.ctx.reference,
  };
}
