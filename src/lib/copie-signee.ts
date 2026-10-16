/**
 * ============================================================================
 *  NOUVEAU (Task 244) — COPIE SIGNÉE FIGÉE : PRÉSERVATION DE LA SIGNATURE
 *  D'ORIGINE DES FICHES DE PAIE (portails Employé et Administration)
 * ============================================================================
 *
 *  DEMANDE : « Lorsque la signature électronique est modifiée ou remplacée
 *  dans les paramètres du système, toutes les fiches de paie déjà signées,
 *  disponibles dans le Portail Employé et le Portail Administration, doivent
 *  conserver leur signature électronique d'origine. La nouvelle signature
 *  électronique doit être appliquée uniquement aux nouvelles fiches de paie
 *  générées après la modification. Les documents déjà signés ne doivent être
 *  ni modifiés ni signés à nouveau automatiquement dans les deux portails. »
 *
 *  AVANT (Task 118/224) : le tampon visuel ET la signature PAdES étaient
 *  réappliqués AU SERVAGE avec la configuration COURANTE — changer la
 *  signature dans les paramètres modifiait donc rétroactivement la signature
 *  de TOUTES les fiches à la prochaine consultation (portail employé,
 *  administration, vérification QR).
 *
 *  DÉSORMAIS : la PREMIÈRE signature posée sur une fiche est FIGÉE une fois
 *  pour toutes :
 *    - copie PAdES déjà conservée au registre (SignatureApiDocument, signée
 *      à l'import / au rattrapage / à un servage antérieur) → resservie
 *      TELLE QUELLE puis matérialisée en copie figée (indépendance vis-à-vis
 *      du registre, qui peut être purgé sans casser les fiches) ;
 *    - signature visuelle seule (tampon image/QR/mention/cachet sans PAdES,
 *      ou fiches image/Word/Excel) → rendue UNE FOIS avec la configuration
 *      active puis FIGÉE dans storage/copies-signees/.
 *
 *  Les trois points de service consultent D'ABORD la copie figée :
 *    1. /api/payslips/[id]/file        (administration — affichage/téléchargement)
 *    2. /api/payslips/qr/[id]/file     (vérification publique par QR code)
 *    3. scripts/portail-server.js      (portail employé — /api/payslip/:id/file,
 *                                       jumelle JS de cette lib)
 *  puis, à défaut, la copie PAdES conservée (PREMIÈRE signature — orderBy
 *  signeLe ASC), et seulement en dernier recours le pipeline historique
 *  (tampon + PAdES avec la configuration active) — dont le résultat est
 *  aussitôt figé. Une fiche sans AUCUNE signature (paramètres inactifs) est
 *  servie originale SANS figeage : elle pourra recevoir sa première signature
 *  plus tard ; dès qu'elle en reçoit une, elle est figée définitivement.
 *
 *  SÉCURITÉ : la copie figée est chiffrée AES-256-GCM sur le disque (0600,
 *  dossier 0700 — même discipline que les fiches et les copies PAdES), son
 *  intégrité est contrôlée par SHA-256 à chaque lecture, et le nom du fichier
 *  est dérivé de l'identifiant de la fiche (aucune traversal de chemin :
 *  tout séparateur est retiré). JAMAIS bloquant : toute erreur de lecture ou
 *  d'écriture replie sur le comportement antérieur (pipeline historique).
 * ============================================================================
 */
import "server-only";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { decryptFromStorage, encryptForStorage } from "@/lib/storage-crypto";
import { getProjectRoot } from "@/lib/storage-dir";
// dossierDocumentsSignes() : dossier des copies PAdES conservées au registre
// (storage/signatures/documents) — défini dans l'orchestrateur Task 224 ;
// aucune dépendance circulaire (signature-api.ts n'importe pas cette lib).
import { dossierDocumentsSignes } from "@/lib/signature-api";

/* ------------------------------------------------------------------ */
/* Dossier des copies figées                                           */
/* ------------------------------------------------------------------ */

/** Dossier des copies signées figées : <racine>/storage/copies-signees/
 * (créé au besoin, permissions 0700 — contenant chiffré 0600). */
export function dossierCopiesFigees(): string {
  return path.join(getProjectRoot(), "storage", "copies-signees");
}

function assurerDossier(): string {
  const dir = dossierCopiesFigees();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // systèmes sans permissions POSIX : sans effet
  }
  return dir;
}

/** Nom de fichier DÉTERMINISTE de la copie figée d'une fiche. */
function nomCopieFigee(payslipId: string): string {
  return "copie-" + String(payslipId).replace(/[^A-Za-z0-9_-]/g, "");
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export interface RecCopieFigee {
  id: string;
  copieSigneeNom?: string | null;
  copieSigneeEmpreinte?: string | null;
}

/** Renvoie la copie signée FIGÉE de la fiche (déchiffrée, intégrité
 * vérifiée), ou null si elle n'existe pas / est illisible (repli pipeline).
 * JAMAIS bloquant. */
export async function lireCopieFigee(
  rec: RecCopieFigee
): Promise<Buffer | null> {
  try {
    const nom = String(rec.copieSigneeNom || "").replace(/[\\\/]/g, "");
    if (!nom) return null;
    const p = path.join(assurerDossier(), nom);
    let brut: Buffer;
    try {
      brut = await fs.promises.readFile(p);
    } catch {
      return null; // absente (fiche jamais signée) — cas nominal
    }
    const data = decryptFromStorage(brut);
    if (!data || data.length === 0) {
      console.error("[COPIE-SIGNEE] Copie figée vide:", rec.id, nom);
      return null;
    }
    if (rec.copieSigneeEmpreinte) {
      const h = crypto.createHash("sha256").update(data).digest("hex");
      if (h !== rec.copieSigneeEmpreinte) {
        console.error(
          "[COPIE-SIGNEE] Intégrité de la copie figée REFUSÉE (empreinte différente) —",
          rec.id, "— repli sur le pipeline (refigeage réparateur)."
        );
        return null;
      }
    }
    return data;
  } catch (e) {
    console.error(
      "[COPIE-SIGNEE] Lecture de la copie figée impossible (non bloquant):",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Figage                                                              */
/* ------------------------------------------------------------------ */

/** FIGE définitivement les octets servis comme signature d'origine de la
 * fiche (PREMIER figeage gagnant — les appels suivants sont ignorés).
 * nature : "PADES" (document cryptographiquement signé) | "TAMPON"
 * (signature visuelle seule). JAMAIS bloquant : renvoie false sans
 * interrompre le servage en cas d'erreur disque/base. */
export async function figerCopieSignee(
  payslipId: string,
  data: Buffer,
  nature: "PADES" | "TAMPON"
): Promise<boolean> {
  try {
    if (!data || data.length === 0) return false;
    // Premier figeage gagnant : une fiche déjà figée n'est JAMAIS réécrite
    // (c'est la garantie « signature d'origine préservée »).
    const deja = await db.payslip.findUnique({
      where: { id: payslipId },
      select: { copieSigneeNom: true },
    });
    if (deja?.copieSigneeNom) return false;
    const dir = assurerDossier();
    const nom = nomCopieFigee(payslipId);
    const cible = path.join(dir, nom);
    // Écriture en fichier temporaire + renommage atomique (deux serveurs —
    // administration 4000 et portail 4001 — peuvent figer la même fiche en
    // parallèle ; les jumelles produisent les mêmes octets, le dernier
    // renommage est donc sans effet sur le contenu attendu).
    const tmp = cible + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, encryptForStorage(data), { mode: 0o600 });
    fs.renameSync(tmp, cible);
    try {
      fs.chmodSync(cible, 0o600);
    } catch {
      // sans effet si POSIX absent
    }
    const empreinte = crypto.createHash("sha256").update(data).digest("hex");
    await db.payslip.updateMany({
      where: { id: payslipId, copieSigneeNom: null },
      data: {
        copieSigneeNom: nom,
        copieSigneeEmpreinte: empreinte,
        copieSigneeNature: nature,
        copieSigneeLe: new Date(),
      },
    });
    console.log(
      "[COPIE-SIGNEE] Signature d'origine FIGÉE pour la fiche",
      payslipId, "(" + nature + ", " + data.length + " octets) — toute",
      "modification ultérieure de la configuration n'y touchera plus."
    );
    return true;
  } catch (e) {
    console.error(
      "[COPIE-SIGNEE] Figage impossible (non bloquant):",
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Copie PAdES conservée (registre) — résolution                       */
/* ------------------------------------------------------------------ */

/** Résout le chemin DISQUE d'une copie PAdES conservée au registre
 * (SignatureApiDocument.chemin — nom relatif du dossier documents/).
 * Renvoie null si introuvable. JAMAIS bloquant. */
export function resoudreCopieConservee(chemin: string): string | null {
  try {
    const nom = path.basename(String(chemin || "")).replace(/[\\\/]/g, "");
    if (!nom) return null;
    const p = path.join(dossierDocumentsSignes(), nom);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // absent — null ci-dessous
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Suppression (cycle de vie d'une fiche)                              */
/* ------------------------------------------------------------------ */

/** Supprime la copie figée d'une fiche (nom dérivé de l'identifiant —
 * appelé à la SUPPRESSION de la fiche ; best effort). */
export async function supprimerCopieFigee(payslipId: string): Promise<void> {
  try {
    const nom = nomCopieFigee(payslipId);
    await fs.promises
      .unlink(path.join(dossierCopiesFigees(), nom))
      .catch(() => {});
    // nettoyage d'un éventuel temporaire orphelin
    const dir = dossierCopiesFigees();
    try {
      const restes = await fs.promises.readdir(dir);
      for (const r of restes) {
        if (r.startsWith(nom + ".tmp-")) {
          await fs.promises
            .unlink(path.join(dir, r))
            .catch(() => {});
        }
      }
    } catch {
      // dossier absent — rien à nettoyer
    }
  } catch (e) {
    console.error(
      "[COPIE-SIGNEE] Suppression de la copie figée impossible (non bloquant):",
      e instanceof Error ? e.message : e
    );
  }
}
