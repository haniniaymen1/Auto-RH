import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  analyzePayslip,
  analyzePayslipPages,
  groupMultiPayslips,
  // NOUVEAU (ajouté) : MÊMES règles de détection pour les images PNG/JPG
  detectCin,
  // NOUVEAU (ajouté SANS modifier les imports ci-dessus) : arbitrage CIN
  // N° CNSS vs N° CIN — mêmes règles que analyzePayslip, appliquées aux
  // images (« le numero de cin faux » : l'OCR lit le N° CNSS « 17775208
  // - 08 » alors que le vrai CIN est sous la colonne « N° CIN »).
  arbitrateCinWithTableContext,
  // NOUVEAU (Task 15) : arbitrage du NOM — mêmes helpers que analyzePayslip
  isHeaderGarbageName,
  isNameFromHeaderLine,
  nameHasStrayFragments,
  normalizeText,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  // NOUVEAU (ajouté, type uniquement) : pages virtuelles pour XLSX / DOCX
  type PagePayslip,
} from "@/lib/payslip-extractor";
import { getSessionUser, refusIT, unauthorized } from "@/lib/auth";
import { getStorageDir, assurerDossierPrive } from "@/lib/storage-dir";
// NOUVEAU (Task 109) : vérification d'authenticité des CIN détectés + taux de
// fiabilité / d'erreur calculés APRÈS l'importation (demande utilisateur :
// « le nombre de CIN corrects (vrais) et de numéros CIN incorrects (faux) »).
import {
  resumeFiabilite,
  ligneFiabilite,
} from "@/lib/cin-validation";
import type { FiabiliteCin } from "@/lib/types";
// NOUVEAU (v0.2.50) : détection automatique des erreurs / incohérences dans
// le nom et le prénom à l'importation (comparaison aux fiches du même CIN +
// contrôles de format) — signalée dans les résultats et sur chaque fiche.
import { detecterAnomaliesNomsImports } from "@/lib/nom-anomalies-serveur";
// NOUVEAU (ajouté sans modifier l'existant) : OCR direct des images PNG/JPG
import { ocrImageBuffer } from "@/lib/payslip-ocr";
// NOUVEAU (ajouté) : OCR ADAPTATIF des images (passe haute lisibilité
// 2x + PSM 4 quand la passe historique ne trouve pas les champs clés)
import { ocrImageAdaptive } from "@/lib/payslip-ocr-adaptive";
// NOUVEAU (Task 15) : variante « en parties » — texte combiné + partie
// hi-res séparée, pour l'arbitrage du nom (même logique que analyzePayslip).
import { ocrImageAdaptiveParts } from "@/lib/payslip-ocr-adaptive";
// NOUVEAU (ajouté sans modifier l'existant) : archives ZIP + Excel + Word
import {
  unzipArchive,
  fileExtension,
  xlsxToSheetTexts,
  docxToText,
  splitTextIntoCinBlocks,
  // NOUVEAU (ajouté) : découpe « 1 bulletin par LIGNE » des feuilles Excel
  expandSheetTexts,
  ZIP_ALLOWED_EXTENSIONS,
  ZIP_MAX_DEPTH,
  ZIP_MAX_ENTRIES,
  type ZipEntry,
} from "@/lib/payslip-office";
// NOUVEAU (Task 23, additif) : unlink ajouté — après découpage réussi d'un
// PDF multi-fiches, l'original complet n'est plus référencé par aucune fiche.
import { writeFile, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";
// (NOUVEAU Task 21, additif) chiffrement AES-256 du stockage : le buffer
// est chiffré juste avant l'écriture disque ; les lectures passent par
// decryptFromStorage dans les routes de service. Fichiers anciens compatibles.
import { encryptForStorage } from "@/lib/storage-crypto";
// NOUVEAU (v0.2.116) : signature électronique AUTOMATIQUE des fiches de
// paie PDF dès l'IMPORTATION — même chaîne que le servage (tampon éventuel
// → signature PAdES → copie conservée chiffrée + registre), de sorte que
// la copie conservée à l'import est re-servie telle quelle au
// téléchargement (cache par empreinte — jamais de double signature).
// JAMAIS bloquant : en cas d'échec, l'import se poursuit et la fiche reste
// signable au servage (discipline Task 224).
import {
  signerFicheApresImport,
  suffixeMessageSignatureImport,
  suffixeMessageSignaturesMultiples,
  type ResultatSignatureImport,
} from "@/lib/signature-api";
// NOUVEAU (Task 23, additif) : découpage PHYSIQUE des PDF multi-fiches —
// chaque fiche reçoit son PROPRE fichier PDF (affectation par CIN), l'employé
// ne récupère donc plus le document complet mais UNIQUEMENT ses pages.
import { splitPdfIntoRanges } from "@/lib/pdf-splitter";
// NOUVEAU (Task 24, additif) : découpage PHYSIQUE des CLASSEURS EXCEL
// multi-fiches — même principe : chaque fiche reçoit son PROPRE fichier
// Excel (« 1 feuille = 1 fiche » copiée haute fidélité ; feuilles « 1
// bulletin par LIGNE » : une fiche étiquetée est générée par employé).
import {
  getExcelSheetInfos,
  extractExcelSheetRange,
  buildLabeledExcel,
  type LabeledPair,
} from "@/lib/excel-splitter";
// NOUVEAU (Task 25, additif) : découpage PHYSIQUE des DOCUMENTS WORD
// multi-fiches — même principe que le PDF (Task 23) et l'Excel (Task 24) :
// chaque fiche reçoit son PROPRE fichier Word (« 1 page = 1 fiche »
// recopiée haute fidélité : styles, tableaux, images, mise en page).
import {
  getDocxPageGroups,
  extractDocxPageRange,
  countDistinctCinCandidates,
} from "@/lib/docx-splitter";

export const runtime = "nodejs";
export const maxDuration = 300;

// (CORRECTIF Task 101) Limite de taille du CORPS DE LA REQUÊTE d'import —
// doit rester ALIGNÉE avec experimental.proxyClientMaxBodySize (next.config.ts,
// « 500mb »). Au-delà, le middleware tronquerait le corps (comportement Next
// 16.3) : on refuse AVANT avec un message explicite (413) plutôt que de laisser
// échouer l'analyse multipart avec le message générique « Requête invalide ».
const MAX_UPLOAD_BODY_MB = 500;
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BODY_MB * 1024 * 1024;

// CORRECTIF : dossier canonique <racine>/storage/payslips, indépendant du
// répertoire courant (le build standalone force process.chdir(.next/standalone)).
// Voir src/lib/storage-dir.ts ; l'ancien calcul cwd reste utilisé en dernier
// recours par getStorageDir() si la racine ne peut pas être déterminée.

export interface UploadResult {
  fileName: string;
  status: "SUCCESS" | "ERROR";
  message: string;
  id?: string;
  cin?: string | null;
  employeeName?: string | null;
  period?: string | null;
  netSalary?: string | null;
  matricule?: string | null;
  fileSize?: number;
  // NOUVEAU : nombre de fiches créées quand le PDF contient PLUSIEURS
  // fiches de paie (1 enregistrement par fiche détectée).
  created?: number;
  // NOUVEAU : détail des fiches détectées dans un PDF multi-fiches.
  // (MODIFIÉ v0.2.50) `id` = identifiant de l'enregistrement créé (sert à la
  // détection des anomalies nom/prénom) et `anomalies` = textes des
  // incohérences détectées pour CETTE fiche (vide/absent = cohérente).
  items?: Array<{
    page: number;
    id?: string;
    cin: string | null;
    employeeName: string | null;
    period: string | null;
    netSalary: string | null;
    anomalies?: string[];
  }>;
  // NOUVEAU (Task 109) : vérification des CIN de CE fichier (présente quand
  // au moins une fiche a été créée) — vrais / faux / non détectés + taux.
  fiabilite?: FiabiliteCin;
  // NOUVEAU (ajouté sans modifier l'existant) : résultat DÉTAILLÉ de chaque
  // fichier contenu dans une ARCHIVE ZIP (1 entrée par fichier du ZIP).
  entryResults?: UploadResult[];
  // NOUVEAU (v0.2.50) : anomalies nom/prénom détectées pour CE fichier
  // (concatène les anomalies de toutes les fiches créées par le fichier,
  // ZIP compris — textes lisibles prêts à afficher).
  anomalies?: string[];
}

/**
 * NOUVEAU (Task 109) : collecte les CIN de TOUTES les fiches créées par un
 * ensemble de résultats d'import, en parcourant RÉCURSIVEMENT les archives
 * ZIP (entryResults) et les fichiers multi-fiches (items[]). Un élément du
 * tableau retourné = une fiche importée (string = son CIN, null = aucun CIN
 * détecté). Les fichiers en ERREUR ne créent aucune fiche : ignorés.
 */
function collecterCins(results: UploadResult[]): Array<string | null> {
  const cins: Array<string | null> = [];
  for (const r of results) {
    if (r.entryResults && r.entryResults.length > 0) {
      cins.push(...collecterCins(r.entryResults));
      continue;
    }
    if (r.status !== "SUCCESS") continue; // aucun fichier créé
    if (r.items && r.items.length > 0) {
      // Multi-fiches (PDF / Excel / Word découpés) : 1 entrée par fiche.
      for (const it of r.items) cins.push(it.cin ?? null);
    } else {
      // Mono-fiche (comportement historique) : result.cin.
      cins.push(r.cin ?? null);
    }
  }
  return cins;
}

/**
 * NOUVEAU (v0.2.50) : collecte les IDs des fiches CRÉÉES par un ensemble de
 * résultats (récursif : ZIP → entryResults, multi-fiches → items[].id,
 * mono-fiche → result.id). Sert à la passe de détection des anomalies
 * nom / prénom.
 */
function collecterIdsCrees(results: UploadResult[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    if (r.entryResults && r.entryResults.length > 0) {
      ids.push(...collecterIdsCrees(r.entryResults));
      continue;
    }
    if (r.status !== "SUCCESS") continue;
    if (r.id) ids.push(r.id);
    if (r.items) {
      for (const it of r.items) if (it.id) ids.push(it.id);
    }
  }
  return ids;
}

/**
 * NOUVEAU (v0.2.50) : rattache les anomalies détectées (carte id → textes)
 * aux résultats de l'import : item.anomalies pour chaque fiche d'un
 * multi-fiches, result.anomalies (dédupliqué) pour le fichier lui-même —
 * RÉCURSIF pour les archives ZIP. Renvoie la liste des textes du résultat.
 */
function rattacherAnomalies(
  r: UploadResult,
  parId: Record<string, string[]>
): string[] {
  if (r.entryResults && r.entryResults.length > 0) {
    const acc: string[] = [];
    for (const sous of r.entryResults) {
      acc.push(...rattacherAnomalies(sous, parId));
    }
    if (acc.length) r.anomalies = Array.from(new Set(acc));
    return acc;
  }
  const acc: string[] = [];
  if (r.status !== "SUCCESS") return acc;
  if (r.id && parId[r.id]) acc.push(...parId[r.id]);
  if (r.items) {
    for (const it of r.items) {
      if (it.id && parId[it.id]) {
        it.anomalies = parId[it.id];
        acc.push(...parId[it.id]);
      }
    }
  }
  if (acc.length) r.anomalies = Array.from(new Set(acc));
  return acc;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 172) : le rôle IT ne peut PAS importer de fiches de paie —
  // garde serveur (l'onglet Importer est aussi masqué dans l'interface).
  if (user.role === "IT") return refusIT("l'importation de fiches de paie");
  // (Robustesse) un POST sans formulaire multipart valide (ex. corps vide)
  // faisait planter request.formData() et renvoyer une erreur 500 : on
  // renvoie désormais un refus propre 400.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    // (CORRECTIF Task 101) la cause réelle était silencieusement avalée :
    // depuis next 16.3 (experimental.proxyClientMaxBodySize, défaut 10 Mo),
    // un corps couvert par le middleware et DÉPASSANT la limite est
    // tronqué -> « Failed to parse body as FormData ». La limite est
    // désormais relevée à 500 Mo (next.config.ts) et contrôlée juste
    // ci-dessous ; on journalise quand même la cause pour le diagnostic.
    console.error("[UPLOAD] Lecture du formulaire multipart impossible:", e);
    return NextResponse.json(
      { error: "Requête invalide : envoyez un formulaire multipart contenant des fichiers PDF." },
      { status: 400 }
    );
  }
  // (CORRECTIF Task 101) garde-fou explicite au-delà de la limite configurée
  // dans next.config.ts (experimental.proxyClientMaxBodySize) : au-delà, le
  // corps serait tronqué par le middleware et le message générique ci-dessus
  // serait trompeur — on refuse AVANT avec une cause claire (413).
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_UPLOAD_BODY_BYTES
  ) {
    return NextResponse.json(
      {
        error: `Fichier trop volumineux : la taille totale envoyée (${Math.round(
          contentLength / (1024 * 1024)
        )} Mo) dépasse la limite de ${MAX_UPLOAD_BODY_MB} Mo. Fractionnez l'envoi (ex. plusieurs ZIP plus petits).`,
      },
      { status: 413 }
    );
  }
  try {
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "Aucun fichier reçu. Veuillez sélectionner des PDF de fiches de paie." },
        { status: 400 }
      );
    }

    await assurerDossierPrive(getStorageDir());

    const results: UploadResult[] = [];
    // NOUVEAU (v0.2.50) : lignes de journal créées par CE lot (id + résultat)
    // — le message est complété après la détection des anomalies nom/prénom.
    const journaux: Array<{ result: UploadResult; id: string; message: string }> = [];

    for (const entry of files) {
      if (!(entry instanceof File)) continue;
      const result = await processFile(entry);
      results.push(result);

      // NOUVEAU (Task 109) : vérification des CIN de CE fichier (vrais /
      // faux / non détectés + taux), jointe à la réponse et au journal des
      // imports — « chaque opération écrit une trace vérifiable ».
      const fiabiliteFichier = resumeFiabilite(collecterCins([result]));
      if (fiabiliteFichier.total > 0) result.fiabilite = fiabiliteFichier;

      const ligneJournal = await db.importLog.create({
        data: {
          fileName: result.fileName,
          status: result.status,
          // (Task 109) le journal conserve la synthèse de fiabilité : les
          // taux réels de l'installation restent relisibles a posteriori.
          message:
            fiabiliteFichier.total > 0
              ? `${result.message} — ${ligneFiabilite(fiabiliteFichier)}`
              : result.message,
          cinDetected: result.cin ?? null,
          fileSize: result.fileSize ?? 0,
        },
      });
      journaux.push({
        result,
        id: ligneJournal.id,
        message: fiabiliteFichier.total > 0
          ? `${result.message} — ${ligneFiabilite(fiabiliteFichier)}`
          : result.message,
      });
    }

    const successCount = results.filter((r) => r.status === "SUCCESS").length;
    // NOUVEAU (Task 109) : taux de fiabilité / d'erreur de TOUTES les fiches
    // créées par cette requête (tous fichiers confondus, ZIP compris).
    const fiabilite = resumeFiabilite(collecterCins(results));

    // NOUVEAU (v0.2.50) — DÉTECTION AUTOMATIQUE DES ERREURS / INCOHÉRENCES
    // NOM & PRÉNOM (demande utilisateur). Exécutée APRÈS la création de
    // TOUTES les fiches du lot : chaque nom extrait est comparé aux autres
    // fiches du même CIN (historique + même lot) et passe des contrôles de
    // format. JAMAIS bloquante : un échec de détection n'affecte pas
    // l'import (les fiches restent créées).
    let anomaliesNoms = 0;
    try {
      const detection = await detecterAnomaliesNomsImports(
        collecterIdsCrees(results)
      );
      anomaliesNoms = detection.total;
      for (const r of results) rattacherAnomalies(r, detection.parId);
      // Signalement dans le JOURNAL des imports : le message de chaque
      // fichier concerné est complété (traçabilité a posteriori).
      for (const j of journaux) {
        const anoms = j.result.anomalies ?? [];
        if (!anoms.length) continue;
        const complement =
          anoms.length === 1
            ? ` — Anomalie nom/prénom : ${anoms[0].replace(/\n/g, " ")}`
            : ` — ${anoms.length} anomalies nom/prénom détectées (dont : ${anoms[0].replace(/\n/g, " ")})`;
        try {
          await db.importLog.update({
            where: { id: j.id },
            data: { message: j.message + complement },
          });
        } catch (e) {
          console.error("[UPLOAD] complément journal impossible:", e);
        }
      }
    } catch (e) {
      console.error("[UPLOAD] détection anomalies nom/prénom impossible:", e);
    }

    return NextResponse.json({
      processed: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
      ...(fiabilite.total > 0 ? { fiabilite } : {}),
      // NOUVEAU (v0.2.50) : nombre de fiches porteuses d'au moins une
      // anomalie nom / prénom dans CE lot (affiché dans l'interface).
      anomaliesNoms,
    });
  } catch (error) {
    console.error("[UPLOAD] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de l'import des fiches de paie." },
      { status: 500 }
    );
  }
}

async function processFile(file: File): Promise<UploadResult> {
  const fileName = file.name;
  const fileSize = file.size;

  try {
    if (fileSize === 0) {
      return { fileName, status: "ERROR", message: "Fichier vide." };
    }
    // Taille illimitée : aucun contrôle de taille, le fichier est traité tel quel.

    const buffer = Buffer.from(await file.arrayBuffer());
    return await processBuffer(fileName, buffer, fileSize, 0, file.type || "");
  } catch (error) {
    console.error(`[UPLOAD] Erreur fichier ${fileName}:`, error);
    return {
      fileName,
      status: "ERROR",
      message: "Échec du traitement du PDF (fichier corrompu ?).",
      fileSize,
    };
  }
}

/**
 * Traitement d'UN fichier (buffer déjà lu).
 *
 * NOUVEAU (refactor sans changement de comportement) : la fonction
 * historique processFile() délègue désormais à processBuffer() — cela
 * permet de traiter de la MÊME façon les fichiers d'une ARCHIVE ZIP
 * (chaque entrée du ZIP repasse par cette fonction). Les chemins PDF,
 * image PNG/JPG, PDF multi-fiches et OCR restent STRICTEMENT identiques.
 *
 * NOUVEAUX formats acceptés (ajoutés sans retirer les anciens) :
 *   - .zip  -> archive contenant plusieurs fiches (PDF, PNG/JPG, XLSX,
 *              DOCX, ou ZIP imbriqué — profondeur max 2) ;
 *   - .xlsx / .xlsm / .xls -> classeur Excel (1 fiche par feuille ou
 *              découpe automatique si plusieurs CIN) ;
 *   - .docx -> document Word (1 fiche, ou découpe si plusieurs CIN).
 */
async function processBuffer(
  fileName: string,
  buffer: Buffer,
  fileSize: number,
  depth: number,
  mimeType = ""
): Promise<UploadResult> {
  try {
    const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    const isPdf =
      mimeType === "application/pdf" || ext === "pdf"; // (historique, inchangé)
    // NOUVEAU (ajouté SANS modifier le chemin PDF historique) : les images
    // PNG / JPG sont acceptées DIRECTEMENT (plus besoin de convertir en PDF).
    // Elles sont lues par OCR (voir src/lib/payslip-ocr.ts).
    const isImage =
      ["png", "jpg", "jpeg"].includes(ext) ||
      ["image/png", "image/jpeg"].includes(mimeType); // (historique, inchangé)
    // NOUVEAU (ajouté) : archive ZIP + classeurs Excel + documents Word.
    const isZip =
      ext === "zip" ||
      ["application/zip", "application/x-zip-compressed"].includes(mimeType);
    const isXlsx =
      ["xlsx", "xlsm", "xls"].includes(ext) ||
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"].includes(mimeType);
    const isDocx =
      ext === "docx" ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (!isPdf && !isImage && !isZip && !isXlsx && !isDocx) {
      return { fileName, status: "ERROR", message: "Format non supporté : seuls les fichiers PDF, images PNG/JPG, archives ZIP, classeurs Excel (XLSX/XLS) et documents Word (DOCX) sont acceptés.", fileSize };
    }

    // Vérification basique de la signature PDF (PDF uniquement — les images
    // PNG/JPG n'ont pas de signature %PDF-)
    if (isPdf && buffer.subarray(0, 5).toString() !== "%PDF-") {
      return { fileName, status: "ERROR", message: "Fichier PDF invalide ou corrompu.", fileSize };
    }

    // ============================================================
    // NOUVEAU (chemin ajouté, tous les chemins historiques restent
    // inchangés) : ARCHIVE ZIP -> chaque fichier de l'archive est
    // traité individuellement par CE MÊME pipeline (PDF, PNG/JPG,
    // XLSX, DOCX, ZIP imbriqué — profondeur max 2).
    // ============================================================
    if (isZip) {
      if (depth >= ZIP_MAX_DEPTH) {
        return {
          fileName,
          status: "ERROR",
          message: `Archives trop imbriquées (maximum ${ZIP_MAX_DEPTH} niveaux de ZIP).`,
          fileSize,
        };
      }
      let entries: ZipEntry[] = [];
      try {
        entries = unzipArchive(buffer);
      } catch (e) {
        console.error(`[UPLOAD] ZIP illisible ${fileName}:`, e);
        return {
          fileName,
          status: "ERROR",
          message: "Archive ZIP illisible ou corrompue.",
          fileSize,
        };
      }
      const allowed = entries.filter((e) =>
        ZIP_ALLOWED_EXTENSIONS.includes(fileExtension(e.baseName))
      );
      if (allowed.length === 0) {
        return {
          fileName,
          status: "ERROR",
          message: "Aucun fichier exploitable dans l'archive (PDF, PNG/JPG, XLSX, DOCX attendus).",
          fileSize,
        };
      }
      const limited = allowed.slice(0, ZIP_MAX_ENTRIES);
      const entryResults: UploadResult[] = [];
      for (const e of limited) {
        try {
          entryResults.push(await processBuffer(e.baseName, e.data, e.size, depth + 1));
        } catch (e2) {
          console.error(`[UPLOAD] Échec entrée ZIP ${e.name}:`, e2);
          entryResults.push({
            fileName: e.baseName,
            status: "ERROR",
            message: "Échec du traitement de ce fichier de l'archive.",
            fileSize: e.size,
          });
        }
      }
      const okCount = entryResults.filter((r) => r.status === "SUCCESS").length;
      const slipsCreated = entryResults.reduce(
        (n, r) => n + (r.created ?? (r.status === "SUCCESS" ? 1 : 0)),
        0
      );
      return {
        fileName,
        status: okCount > 0 ? "SUCCESS" : "ERROR",
        message:
          okCount > 0
            ? `Archive traitée : ${slipsCreated} fiche(s) importée(s) depuis ${okCount} fichier(s) sur ${limited.length} contenu(s) dans le ZIP.`
            : "Aucun fichier de l'archive n'a pu être importé.",
        fileSize,
        created: okCount > 0 ? slipsCreated : undefined,
        entryResults,
      };
    }

    // ============================================================
    // Chemin historique : image PNG/JPG -> OCR direct -> 1 fiche = 1 image.
    // (INCHANGÉ, hormis l'OCR ADAPTATIF ci-dessous : la 1re passe reste
    // ocrImageBuffer ; si les champs clés manquent, une passe « haute
    // lisibilité » (2x + PSM 4) est AJOUTÉE par ocrImageAdaptive — voir
    // src/lib/payslip-ocr-adaptive.ts — sans modifier les règles.)
    // ============================================================
    if (isImage) {
      try {
        // MODIFIÉ (Task 15) : ocrImageAdaptiveParts au lieu de
        // ocrImageAdaptive — MÊME déroulement (passe historique puis
        // hi-res), mais la partie hi-res est aussi renvoyée séparément
        // afin d'appliquer l'ARBITRAGE DU NOM ci-dessous (cas « COTES » :
        // CIN correct mais nom = déchet de la bande d'en-tête).
        const { text: ocrTextAdaptive, hiResText } =
          await ocrImageAdaptiveParts(buffer);
        const ocrText = ocrTextAdaptive;
        if (!ocrText || ocrText.trim().length === 0) {
          return {
            fileName,
            status: "ERROR",
            message: "Aucun texte lisible dans l'image (OCR). Vérifiez la qualité / lisibilité de la fiche.",
            fileSize,
          };
        }
        const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext || "png"}`;
        const storageDir = getStorageDir();
        await assurerDossierPrive(storageDir);
        // (Task 21) écriture CHIFFRÉE AES-256-GCM — sinon comportement historique
        await writeFile(path.join(storageDir, storedName), encryptForStorage(buffer), { mode: 0o600 });

        // NOUVEAU (ajouté SANS modifier la détection historique au-dessus) :
        // même ARBITRAGE CIN que analyzePayslip — si le CIN capté est en
        // réalité un N° CNSS (clé « - 08 » sur la même ligne) et qu'un vrai
        // CIN est lisible sous l'en-tête « N° CIN », on le remplace.
        const cin = arbitrateCinWithTableContext(detectCin(ocrText), ocrText);
        // NOUVEAU (Task 15) : ARBITRAGE DU NOM — mêmes règles que
        // analyzePayslip : si le nom détecté est un garbage ou provient
        // d'une ligne d'en-tête, et que la partie hi-res en propose un
        // plausible, on garde le sien (texte stocké inchangé).
        let employeeName = extractEmployeeName(ocrText);
        if (
          hiResText &&
          (isHeaderGarbageName(employeeName) ||
            isNameFromHeaderLine(ocrText, employeeName) ||
            nameHasStrayFragments(ocrText, employeeName))
        ) {
          const hiName = extractEmployeeName(hiResText);
          if (hiName && !isHeaderGarbageName(hiName)) {
            employeeName = hiName;
          }
        }
        const periodDetected = extractPeriod(ocrText);
        const record = await db.payslip.create({
          data: {
            fileName,
            storedName,
            fileSize,
            content: ocrText,
            normalizedContent: normalizeText(ocrText),
            cin,
            employeeName,
            period: periodDetected,
            netSalary: extractNetSalary(ocrText),
            matricule: extractMatricule(ocrText),
            pageNumber: 1,
          },
        });
        return {
          fileName,
          status: "SUCCESS",
          message: cin
            ? `Import réussi (OCR) — CIN détecté : ${cin}`
            : "Import réussi (OCR) — aucun CIN détecté dans l'image.",
          id: record.id,
          cin,
          employeeName,
          period: periodDetected,
          netSalary: extractNetSalary(ocrText),
          matricule: extractMatricule(ocrText),
          fileSize,
        };
      } catch (e) {
        console.error(`[UPLOAD] Erreur OCR image ${fileName}:`, e);
        return {
          fileName,
          status: "ERROR",
          message: "Échec de la lecture OCR de l'image.",
          fileSize,
        };
      }
    }

    // ============================================================
    // NOUVEAU (chemin ajouté) : CLASSEUR EXCEL (.xlsx/.xlsm/.xls)
    // -> 1 texte par FEUILLE -> les MÊMES règles de détection
    // (CIN, employé, période, net, matricule) -> si ≥ 2 CIN
    // différents : 1 fiche par groupe (comme les PDF multi-fiches),
    // sinon 1 fiche pour tout le classeur.
    // ============================================================
    if (isXlsx) {
      try {
        const { sheetNames, sheetTexts } = xlsxToSheetTexts(buffer);
        if (!sheetTexts.some((t) => t.trim().length > 0)) {
          return {
            fileName,
            status: "ERROR",
            message: "Aucune donnée lisible dans le classeur Excel (feuilles vides ?).",
            fileSize,
          };
        }

        // Stockage du fichier original (extension conservée)
        const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext || "xlsx"}`;
        const storageDir = getStorageDir();
        await assurerDossierPrive(storageDir);
        // (Task 21) écriture CHIFFRÉE AES-256-GCM — sinon comportement historique
        await writeFile(path.join(storageDir, storedName), encryptForStorage(buffer), { mode: 0o600 });

        // ============================================================
        // NOUVEAU (Task 24, additif) : DÉCOUPAGE PHYSIQUE du classeur
        // Excel en fiches INDIVIDUELLES — même principe que le PDF
        // (Task 23) : chaque fiche reçoit son PROPRE fichier Excel
        // (affectation par CIN, écriture chiffrée AES-256-GCM) —
        // « quand j'importe le fichier Excel, tu divises le fichier par
        // fiche de paie et tu affectes chaque fiche à son employé, comme
        // ça l'employé récupère sa fiche au format Excel ».
        //
        // - SUCCÈS total (1 fichier individuel par fiche) : le résultat
        //   est renvoyé immédiatement, l'original complet est supprimé
        //   (plus référencé par aucun enregistrement).
        // - ÉCHEC (classeur illisible par le coupeur, structure atypique,
        //   une seule plage impossible…) : retour null → le code
        //   HISTORIQUE ci-dessous s'applique SANS AUCUN CHANGEMENT (les
        //   fiches partagent le fichier complet, comme avant).
        // ============================================================
        try {
          const splitResult = await trySplitExcelIntoIndividualFiles({
            fileName,
            buffer,
            sheetNames,
            sheetTexts,
            fileSize,
            storedName,
            storageDir,
          });
          if (splitResult) return splitResult;
        } catch (splitErr) {
          console.error("[UPLOAD] Découpage Excel impossible, repli fichier partagé:", splitErr);
        }

        // Pages virtuelles : chaque feuille = 1 « page » analysée avec les
        // MÊMES règles que les pages PDF (aucune règle modifiée).
        // NOUVEAU (ajouté SANS modifier la logique ci-dessous) : une feuille
        // « tableau » avec PLUSIEURS lignes (1 bulletin par ligne) est
        // découpée en 1 texte ÉTIQUETÉ par ligne — expandSheetTexts() — les
        // autres feuilles restent inchangées. Les MÊMES règles de détection
        // s'appliquent à chaque texte (CIN, employé, période, net, matricule).
        const expandedTexts = expandSheetTexts(sheetTexts);
        const pagePayslips: PagePayslip[] = expandedTexts.map((t, i) => ({
          page: i + 1,
          text: t,
          normalizedText: normalizeText(t),
          // MODIFIÉ (Task 27) : arbitrage avec le contexte de tableau
          // (MÊME règle que le chemin PDF/OCR) — corrige les bulletins
          // tunisiens à colonnes où le N° CNSS « 17700137 - 04 » était
          // retenu à la place du CIN (8 OU 9 chiffres). L'arbitrage ne
          // remplace JAMAIS un CIN qui n'est pas un N° CNSS.
          cin: arbitrateCinWithTableContext(detectCin(t), t),
          employeeName: extractEmployeeName(t),
          period: extractPeriod(t),
          netSalary: extractNetSalary(t),
          matricule: extractMatricule(t),
        }));

        try {
          const groups = groupMultiPayslips(pagePayslips);
          if (groups && groups.length >= 2) {
            const created: Array<{
              page: number;
              id?: string;
              cin: string | null;
              employeeName: string | null;
              period: string | null;
              netSalary: string | null;
            }> = [];
            let firstId: string | undefined;
            for (const g of groups) {
              const rec = await db.payslip.create({
                data: {
                  fileName,
                  storedName, // MÊME fichier physique pour toutes les fiches
                  fileSize,
                  content: g.text,
                  normalizedContent: g.normalizedText,
                  cin: g.cin,
                  employeeName: g.employeeName,
                  period: g.period,
                  netSalary: g.netSalary,
                  matricule: g.matricule,
                  pageNumber: pagePayslips.length,
                  sourcePage: g.page, // feuille (n°) de début de CETTE fiche
                },
              });
              if (!firstId) firstId = rec.id;
              created.push({
                page: g.page,
                id: rec.id,
                cin: g.cin,
                employeeName: g.employeeName,
                period: g.period,
                netSalary: g.netSalary,
              });
            }
            return {
              fileName,
              status: "SUCCESS",
              message: `${groups.length} fiches détectées dans ce classeur Excel (feuilles : ${sheetNames
                .slice(0, 10)
                .join(", ")}${sheetNames.length > 10 ? "…" : ""}) — ${groups.length} enregistrements créés.`,
              id: firstId,
              cin: groups[0].cin,
              employeeName: groups[0].employeeName,
              period: groups[0].period,
              netSalary: groups[0].netSalary,
              matricule: groups[0].matricule,
              fileSize,
              created: groups.length,
              items: created,
            };
          }
        } catch (multiErr) {
          console.error("[UPLOAD] Analyse multi-feuilles impossible, repli mono-fiche:", multiErr);
        }

        // Mono-fiche : 1 enregistrement pour TOUT le classeur
        const fullText = sheetTexts.filter(Boolean).join("\n");
        // NOUVEAU (Task 27) : arbitrage tableau — MÊME règle que PDF/OCR
        // (un N° CNSS « 17700137 - 04 » détecté comme CIN est remplacé par
        // le CIN lu sous l'en-tête « N° CIN » ; sinon valeur conservée).
        const fullCin = arbitrateCinWithTableContext(
          detectCin(fullText),
          fullText
        );
        const record = await db.payslip.create({
          data: {
            fileName,
            storedName,
            fileSize,
            content: fullText,
            normalizedContent: normalizeText(fullText),
            cin: fullCin,
            employeeName: extractEmployeeName(fullText),
            period: extractPeriod(fullText),
            netSalary: extractNetSalary(fullText),
            matricule: extractMatricule(fullText),
            pageNumber: sheetTexts.length,
          },
        });
        return {
          fileName,
          status: "SUCCESS",
          message: fullCin
            ? `Import réussi (Excel) — CIN détecté : ${fullCin}`
            : "Import réussi (Excel) — aucun CIN détecté dans le classeur.",
          id: record.id,
          cin: fullCin,
          employeeName: extractEmployeeName(fullText),
          period: extractPeriod(fullText),
          netSalary: extractNetSalary(fullText),
          matricule: extractMatricule(fullText),
          fileSize,
        };
      } catch (e) {
        console.error(`[UPLOAD] Erreur Excel ${fileName}:`, e);
        return {
          fileName,
          status: "ERROR",
          message: "Échec de la lecture du fichier Excel.",
          fileSize,
        };
      }
    }

    // ============================================================
    // NOUVEAU (chemin ajouté) : DOCUMENT WORD (.docx) -> texte brut
    // (mammoth) -> les MÊMES règles de détection. Si le document
    // contient PLUSIEURS fiches (≥ 2 CIN différents), le texte est
    // découpé (chaque CIN commence une nouvelle fiche).
    // ============================================================
    if (isDocx) {
      try {
        const text = await docxToText(buffer);
        if (!text || text.trim().length === 0) {
          return {
            fileName,
            status: "ERROR",
            message: "Aucun texte lisible dans le document Word.",
            fileSize,
          };
        }

        // Stockage du fichier original
        const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.docx`;
        const storageDir = getStorageDir();
        await assurerDossierPrive(storageDir);
        // (Task 21) écriture CHIFFRÉE AES-256-GCM — sinon comportement historique
        await writeFile(path.join(storageDir, storedName), encryptForStorage(buffer), { mode: 0o600 });

        // ============================================================
        // NOUVEAU (Task 25, additif) : DÉCOUPAGE PHYSIQUE du document
        // Word en fiches INDIVIDUELLES — même principe que le PDF
        // (Task 23) et l'Excel (Task 24) : « quand j'importe le fichier
        // DOCX, tu divises le fichier par fiche de paie et tu affectes
        // chaque fiche à son employé — clé = CIN — comme ça l'employé
        // récupère SA fiche au format Word ».
        //
        // - SUCCÈS total (1 fichier individuel par fiche) : le résultat
        //   est renvoyé immédiatement, l'original complet est supprimé
        //   (plus référencé par aucun enregistrement).
        // - ÉCHEC (document illisible par le coupeur, 2 CIN sur une même
        //   page, une seule plage impossible…) : retour null → le code
        //   HISTORIQUE ci-dessous s'applique SANS AUCUN CHANGEMENT (les
        //   fiches partagent le fichier complet, comme avant).
        // ============================================================
        try {
          const splitResult = await trySplitDocxIntoIndividualFiles({
            fileName,
            buffer,
            fileSize,
            storedName,
            storageDir,
          });
          if (splitResult) return splitResult;
        } catch (splitErr) {
          console.error("[UPLOAD] Découpage Word impossible, repli fichier partagé:", splitErr);
        }

        // Découpe en blocs (1 bloc par CIN candidat) puis regroupement
        // avec la MÊME logique que les PDF multi-fiches.
        const blocks = splitTextIntoCinBlocks(text);
        const pagePayslips: PagePayslip[] = (blocks.length > 0 ? blocks : [text]).map(
          (t, i) => ({
            page: i + 1,
            text: t,
            normalizedText: normalizeText(t),
            // MODIFIÉ (Task 27) : arbitrage tableau (MÊME règle que PDF/OCR)
            cin: arbitrateCinWithTableContext(detectCin(t), t),
            employeeName: extractEmployeeName(t),
            period: extractPeriod(t),
            netSalary: extractNetSalary(t),
            matricule: extractMatricule(t),
          })
        );

        try {
          const groups = groupMultiPayslips(pagePayslips);
          if (groups && groups.length >= 2) {
            const created: Array<{
              page: number;
              id?: string;
              cin: string | null;
              employeeName: string | null;
              period: string | null;
              netSalary: string | null;
            }> = [];
            let firstId: string | undefined;
            for (const g of groups) {
              const rec = await db.payslip.create({
                data: {
                  fileName,
                  storedName,
                  fileSize,
                  content: g.text,
                  normalizedContent: g.normalizedText,
                  cin: g.cin,
                  employeeName: g.employeeName,
                  period: g.period,
                  netSalary: g.netSalary,
                  matricule: g.matricule,
                  pageNumber: pagePayslips.length,
                  sourcePage: g.page,
                },
              });
              if (!firstId) firstId = rec.id;
              created.push({
                page: g.page,
                id: rec.id,
                cin: g.cin,
                employeeName: g.employeeName,
                period: g.period,
                netSalary: g.netSalary,
              });
            }
            return {
              fileName,
              status: "SUCCESS",
              message: `${groups.length} fiches détectées dans ce document Word — ${groups.length} enregistrements créés.`,
              id: firstId,
              cin: groups[0].cin,
              employeeName: groups[0].employeeName,
              period: groups[0].period,
              netSalary: groups[0].netSalary,
              matricule: groups[0].matricule,
              fileSize,
              created: groups.length,
              items: created,
            };
          }
        } catch (multiErr) {
          console.error("[UPLOAD] Analyse multi-fiches Word impossible, repli mono-fiche:", multiErr);
        }

        // Mono-fiche : 1 enregistrement pour tout le document
        // NOUVEAU (Task 27) : arbitrage tableau — un N° CNSS « 17700137 - 04 »
        // détecté comme CIN est remplacé par le CIN lu sous l'en-tête
        // « N° CIN » (y compris CIN à 9 chiffres) ; sinon valeur conservée.
        const monoCin = arbitrateCinWithTableContext(detectCin(text), text);
        const record = await db.payslip.create({
          data: {
            fileName,
            storedName,
            fileSize,
            content: text,
            normalizedContent: normalizeText(text),
            cin: monoCin,
            employeeName: extractEmployeeName(text),
            period: extractPeriod(text),
            netSalary: extractNetSalary(text),
            matricule: extractMatricule(text),
            pageNumber: 1,
          },
        });
        return {
          fileName,
          status: "SUCCESS",
          message: monoCin
            ? `Import réussi (Word) — CIN détecté : ${monoCin}`
            : "Import réussi (Word) — aucun CIN détecté dans le document.",
          id: record.id,
          cin: monoCin,
          employeeName: extractEmployeeName(text),
          period: extractPeriod(text),
          netSalary: extractNetSalary(text),
          matricule: extractMatricule(text),
          fileSize,
        };
      } catch (e) {
        console.error(`[UPLOAD] Erreur Word ${fileName}:`, e);
        return {
          fileName,
          status: "ERROR",
          message: "Échec de la lecture du document Word.",
          fileSize,
        };
      }
    }

    // Extraction du texte et détection des champs (chemin historique PDF —
    // inclut désormais le fallback OCR pour les PDF sans texte : PNG -> PDF,
    // scans ; voir analyzePayslip dans src/lib/payslip-extractor.ts)
    const analysis = await analyzePayslip(buffer);

    if (!analysis.text || analysis.text.trim().length === 0) {
      return {
        fileName,
        status: "ERROR",
        message: "Aucun texte extractible et OCR indisponible (PDF scanné en image illisible ?). La recherche par CIN nécessite un texte lisible.",
        fileSize,
      };
    }

    // Stockage du fichier sur disque (dossier canonique, voir storage-dir.ts)
    const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
    const storageDir = getStorageDir();
    await assurerDossierPrive(storageDir);
    // (Task 21) écriture CHIFFRÉE AES-256-GCM — sinon comportement historique
    // Task 209 : fichier créé en mode 0600 (propriétaire seul).
    await writeFile(path.join(storageDir, storedName), encryptForStorage(buffer), { mode: 0o600 });

    // NOUVEAU (ajouté SANS modifier le comportement historique) : PDF
    // multi-fiches — plusieurs fiches de paie dans UN SEUL fichier.
    // Chaque page est analysée avec les MÊMES règles (CIN, employé, période,
    // net, matricule). Si au moins 2 CIN DIFFÉRENTS sont détectés, une
    // enregistrement est créé PAR FICHE (pages consécutives du même CIN
    // regroupées). Sinon → comportement historique (1 PDF = 1 fiche).
    try {
      const { pages: nbPages, pagePayslips } = await analyzePayslipPages(buffer);
      const groups = groupMultiPayslips(pagePayslips);
      if (groups && groups.length >= 2) {
        // ============================================================
        // NOUVEAU (Task 23, additif) : DÉCOUPAGE PHYSIQUE du PDF en
        // fiches INDIVIDUELLES (demande utilisateur : « quand j'importe
        // le fichier PDF, tu divises le fichier par fiche de paie et tu
        // affectes chaque fiche à son employé — clé = CIN — comme ça
        // l'employé récupère SA fiche au format PDF »).
        //
        // - Chaque groupe (pages consécutives du même CIN) reçoit son
        //   PROPRE fichier PDF contenant uniquement SES pages, chiffré
        //   AES-256-GCM comme toute écriture du stockage.
        // - Les plages couvrent TOUTES les pages (1 -> nbPages) : une
        //   annexe sans CIN reste rattachée à la fiche qui la précède.
        // - ÉCHEC du découpage (PDF illisible par le coupeur) -> repli
        //   historique : les fiches partagent le fichier complet, comme
        //   avant — aucune régression possible.
        // - Après découpage réussi, l'original complet n'est référencé
        //   par aucun enregistrement : suppression best effort.
        // ============================================================
        const ranges = groups.map((g, i) => {
          const start = i === 0 ? 1 : g.page;
          const end =
            i + 1 < groups.length ? groups[i + 1].page - 1 : nbPages;
          return {
            startPage: Math.min(start, g.page),
            endPage: Math.max(g.page, end),
          };
        });
        let splitBuffers: Array<Buffer | null> | null = null;
        try {
          const split = await splitPdfIntoRanges(buffer, ranges);
          // repli GLOBAL si UNE SEULE plage échoue (état cohérent garanti)
          if (split.every((b) => b && b.length > 0)) splitBuffers = split;
        } catch (splitErr) {
          console.error("[UPLOAD] Découpage PDF impossible, repli fichier partagé:", splitErr);
        }
        const allSplit = !!splitBuffers;

        // NOUVEAU (v0.2.116) : résultats de la signature électronique
        // automatique à l'importation (une entrée par fiche PDF créée).
        const signaturesImport: ResultatSignatureImport[] = [];

        const created: Array<{
          page: number;
          id?: string;
          cin: string | null;
          employeeName: string | null;
          period: string | null;
          netSalary: string | null;
        }> = [];
        let firstId: string | undefined;
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const range = ranges[gi];
          const splitBuf =
            allSplit && splitBuffers ? splitBuffers[gi] ?? null : null;
          // Nom affiché : « original (page N).pdf » ou « (pages N-M).pdf »
          const baseName = fileName.replace(/\.pdf$/i, "");
          const displayPage =
            range.startPage === range.endPage
              ? `page ${range.startPage}`
              : `pages ${range.startPage}-${range.endPage}`;
          const splitFileName = `${baseName} (${displayPage}).pdf`;
          const recStoredName = splitBuf
            ? `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`
            : storedName; // repli : fichier original partagé (historique)
          if (splitBuf) {
            // écriture CHIFFRÉE AES-256-GCM (Task 21) du fichier individuel
            await writeFile(
              path.join(storageDir, recStoredName),
              encryptForStorage(splitBuf),
              { mode: 0o600 }
            );
          }
          const rec = await db.payslip.create({
            data: {
              fileName: splitBuf ? splitFileName : fileName,
              storedName: recStoredName,
              fileSize: splitBuf ? splitBuf.length : fileSize,
              content: g.text,
              normalizedContent: g.normalizedText,
              cin: g.cin,
              employeeName: g.employeeName,
              period: g.period,
              netSalary: g.netSalary,
              matricule: g.matricule,
              pageNumber: splitBuf
                ? range.endPage - range.startPage + 1
                : nbPages,
              sourcePage: g.page, // page de début de CETTE fiche (document original)
            },
          });
          // NOUVEAU (v0.2.116) : signature électronique AUTOMATIQUE de la
          // fiche dès l'importation — contenu signé = fichier individuel
          // (ou PDF original partagé en repli de découpage) ; la copie
          // conservée est ensuite re-servie telle quelle au téléchargement
          // (cache par empreinte). JAMAIS bloquant.
          signaturesImport.push(
            await signerFicheApresImport(splitBuf ?? buffer, {
              ficheId: rec.id,
              reference:
                [g.matricule, g.period].filter(Boolean).join(" — ") || rec.id,
              nomFichier: splitBuf ? splitFileName : fileName,
              employeeName: g.employeeName,
              cin: g.cin,
              period: g.period,
              netSalary: g.netSalary,
              uploadedAt: rec.uploadedAt,
            })
          );
          if (!firstId) firstId = rec.id;
          created.push({
            page: g.page,
            id: rec.id,
            cin: g.cin,
            employeeName: g.employeeName,
            period: g.period,
            netSalary: g.netSalary,
          });
        }
        // Toutes les fiches ont leur fichier individuel : l'original
        // complet n'est plus référencé — suppression best effort.
        if (allSplit) {
          try {
            await unlink(path.join(storageDir, storedName));
          } catch {
            // fichier déjà absent — ignorer
          }
        }
        return {
          fileName,
          status: "SUCCESS",
          message:
            (allSplit
              ? `${groups.length} fiches individuelles créées — le PDF a été divisé par fiche de paie (affectation par CIN, un PDF par employé).`
              : `${groups.length} fiches détectées dans ce PDF (pages ${groups
                  .map((g) => g.page)
                  .join(", ")}) — ${groups.length} enregistrements créés.`) +
            suffixeMessageSignaturesMultiples(signaturesImport),
          id: firstId,
          cin: groups[0].cin,
          fileSize,
          created: groups.length,
          items: created,
        };
      }
    } catch (multiErr) {
      console.error("[UPLOAD] Analyse multi-fiches impossible, repli mono-fiche:", multiErr);
      // en cas d'échec de l'analyse par page → comportement historique
    }

    // Enregistrement en base (comportement historique : 1 PDF = 1 fiche)
    const record = await db.payslip.create({
      data: {
        fileName,
        storedName,
        fileSize,
        content: analysis.text,
        normalizedContent: analysis.normalizedText,
        cin: analysis.cin,
        employeeName: analysis.employeeName,
        period: analysis.period,
        netSalary: analysis.netSalary,
        matricule: analysis.matricule,
        pageNumber: analysis.pages,
      },
    });

    // NOUVEAU (v0.2.116) : signature électronique AUTOMATIQUE de la fiche
    // dès l'importation — même chaîne que le servage (tampon éventuel →
    // signature PAdES → copie conservée chiffrée + registre) : la copie
    // conservée à l'import est re-servie telle quelle au téléchargement
    // (cache par empreinte). JAMAIS bloquant : en cas d'échec, la fiche
    // reste signable au servage (discipline Task 224).
    const sigImport = await signerFicheApresImport(buffer, {
      ficheId: record.id,
      reference:
        [analysis.matricule, analysis.period].filter(Boolean).join(" — ") ||
        record.id,
      nomFichier: fileName,
      employeeName: analysis.employeeName,
      cin: analysis.cin,
      period: analysis.period,
      netSalary: analysis.netSalary,
      uploadedAt: record.uploadedAt,
    });

    return {
      fileName,
      status: "SUCCESS",
      message:
        (analysis.cin
          ? `Import réussi — CIN détecté${analysis.ocrUsed ? " par OCR" : ""} : ${analysis.cin}`
          : "Import réussi — aucun CIN détecté dans le contenu du fichier.") +
        suffixeMessageSignatureImport(sigImport),
      id: record.id,
      cin: analysis.cin,
      employeeName: analysis.employeeName,
      period: analysis.period,
      netSalary: analysis.netSalary,
      matricule: analysis.matricule,
      fileSize,
    };
  } catch (error) {
    console.error(`[UPLOAD] Erreur fichier ${fileName}:`, error);
    return {
      fileName,
      status: "ERROR",
      message: "Échec du traitement du PDF (fichier corrompu ?).",
      fileSize,
    };
  }
}

/* ==================================================================== */
/* NOUVEAU (Task 24, additif) : découpage PHYSIQUE des classeurs Excel  */
/* multi-fiches en fiches INDIVIDUELLES.                                */
/*                                                                      */
/* Demande utilisateur : « quand j'importe le fichier Excel, tu divises */
/* le fichier par fiche de paie et tu affectes chaque fiche à son       */
/* employé (clé = CIN), comme ça l'employé récupère sa fiche au format  */
/* Excel ».                                                             */
/*                                                                      */
/* Principe (aligné sur le PDF Task 23) :                               */
/*  - les MÊMES règles de détection s'appliquent (expandSheetTexts est  */
/*    appelée PAR FEUILLE — la numérotation des pages virtuelles est    */
/*    IDENTIQUE à l'expansion globale, l'ordre des feuilles et le       */
/*    nombre de lignes de chaque tableau ne changent pas) ;             */
/*  - groupMultiPayslips() regroupe les pages virtuelles consécutives   */
/*    du même CIN (aucune règle de détection modifiée) ;                */
/*  - chaque groupe reçoit son PROPRE fichier, chiffré AES-256-GCM :    */
/*      • « 1 fiche par FEUILLE »  -> extraction de la/des feuille(s)   */
/*        du groupe dans un classeur autonome (fidélité maximale :      */
/*        styles, fusions, largeurs, images) ;                          */
/*      • « 1 bulletin par LIGNE » -> fiche ÉTIQUETÉE « Libellé :       */
/*        valeur » générée depuis le texte détecté (le bulletin est une */
/*        LIGNE du tableau : recopier la feuille entière emporterait    */
/*        les salaires des autres employés — interdit) ;                */
/*  - les feuilles SANS CIN (annexes) restent rattachées à la fiche     */
/*    qui les précède (mêmes plages que le PDF) ;                       */
/*  - après succès, l'original complet n'est plus référencé :           */
/*    suppression best effort ;                                         */
/*  - TOUS les cas non garantis (feuille tableau partiellement couverte,*/
/*    nombre de feuilles incohérent, échec d'une extraction) renvoient  */
/*    null : l'appelant poursuit avec le comportement HISTORIQUE        */
/*    (fichier complet partagé) — aucune régression possible.           */
/* ==================================================================== */

/** Arguments du découpage Excel (données déjà calculées par la route). */
interface ExcelSplitArgs {
  fileName: string;
  buffer: Buffer;
  /** Noms des feuilles (SheetJS — ordre physique). */
  sheetNames: string[];
  /** Texte de chaque feuille (SheetJS — même ordre que sheetNames). */
  sheetTexts: string[];
  fileSize: number;
  /** storedName du fichier original DÉJÀ écrit sur disque (chiffré) :
   * supprimé best effort après un découpage réussi. */
  storedName: string;
  storageDir: string;
}

/**
 * Tente de découper un classeur Excel multi-fiches en fiches individuelles.
 * Retourne un UploadResult si le découpage a COMPLÈTEMENT réussi (1 fichier
 * individuel + 1 enregistrement par fiche), sinon null → comportement
 * historique (fichier complet partagé entre les fiches).
 */
async function trySplitExcelIntoIndividualFiles(
  args: ExcelSplitArgs
): Promise<UploadResult | null> {
  const { fileName, buffer, sheetNames, sheetTexts, fileSize, storedName, storageDir } = args;

  // 0) Garde d'alignement : le classeur doit contenir le MÊME nombre de
  //    feuilles pour ExcelJS (découpeur) et SheetJS (détection). Un écart
  //    (feuille graphique, structure exotique) -> repli historique.
  const infos = await getExcelSheetInfos(buffer);
  if (!infos || infos.length === 0 || infos.length !== sheetNames.length) {
    return null;
  }

  // 1) Pages virtuelles PAR FEUILLE — même numérotation que l'expansion
  //    globale : l'ordre des feuilles est conservé et une feuille « 1
  //    bulletin par ligne » produit autant de pages qu'elle a de lignes.
  const perSheetPages: PagePayslip[][] = [];
  /** page virtuelle (1-based) -> index de feuille (0-based) */
  const sheetOfPage: number[] = [];
  let totalPages = 0;
  for (let s = 0; s < sheetTexts.length; s++) {
    const texts = expandSheetTexts([sheetTexts[s]]);
    const pages: PagePayslip[] = texts.map((t, k) => ({
      page: totalPages + k + 1,
      text: t,
      normalizedText: normalizeText(t),
      cin: detectCin(t),
      employeeName: extractEmployeeName(t),
      period: extractPeriod(t),
      netSalary: extractNetSalary(t),
      matricule: extractMatricule(t),
    }));
    for (let k = 0; k < pages.length; k++) sheetOfPage.push(s);
    totalPages += pages.length;
    perSheetPages.push(pages);
  }
  if (totalPages === 0) return null;

  // 2) Sanité : la numérotation doit coïncider avec l'expansion GLOBALE
  //    (celle du chemin historique — même nombre de pages virtuelles).
  const globalExpanded = expandSheetTexts(sheetTexts);
  if (globalExpanded.length !== totalPages) return null;

  // 3) Groupes = pages virtuelles consécutives du MÊME CIN (règles
  //    historiques, inchangées). Moins de 2 CIN différents : mono-fiche
  //    -> comportement historique (1 enregistrement pour tout le classeur).
  const pagePayslips: PagePayslip[] = perSheetPages.flat();
  const groups = groupMultiPayslips(pagePayslips);
  if (!groups || groups.length < 2) return null;

  // 4) Plages de pages virtuelles par groupe — annexes sans CIN rattachées
  //    à la fiche qui précède (MÊMES plages que le PDF Task 23).
  const ranges = groups.map((g, i) => {
    const start = i === 0 ? 1 : g.page;
    const end =
      i + 1 < groups.length ? groups[i + 1].page - 1 : totalPages;
    return {
      startPage: Math.min(start, g.page),
      endPage: Math.max(g.page, end),
    };
  });

  // 5) Feuilles « 1 bulletin par LIGNE » : une feuille qui produit
  //    PLUSIEURS pages virtuelles (≥ 2 lignes de données).
  const isRowTableSheet = perSheetPages.map((p) => p.length > 1);

  // 6) Plan de découpage par groupe : soit une PLAGE DE FEUILLES (1 fiche
  //    par feuille), soit une FICHE ÉTIQUETÉE (1 bulletin par ligne).
  type SplitPlan =
    | { kind: "sheets"; sheetStart: number; sheetEnd: number; group: PagePayslip }
    | { kind: "labeled"; sheetIndex: number; group: PagePayslip };
  const plan: SplitPlan[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const range = ranges[gi];
    const sheetIdxs = new Set<number>();
    for (let p = range.startPage; p <= range.endPage; p++) {
      const s = sheetOfPage[p - 1];
      if (s === undefined) return null; // structure inattendue -> repli
      sheetIdxs.add(s);
    }
    const sheetsArr = Array.from(sheetIdxs).sort((a, b) => a - b);

    // CAS « 1 bulletin par LIGNE » : toutes les pages du groupe
    // appartiennent à UNE MÊME feuille tableau -> fiche étiquetée.
    if (sheetsArr.length === 1 && isRowTableSheet[sheetsArr[0]]) {
      plan.push({ kind: "labeled", sheetIndex: sheetsArr[0], group: g });
      continue;
    }

    // Garde de CONFIDENTIALITÉ : une feuille tableau (PLUSIEURS employés
    // dans UNE feuille) ne doit JAMAIS être recopiée partiellement ni
    // entièrement dans un fichier individuel -> repli historique.
    if (sheetsArr.some((s) => isRowTableSheet[s])) return null;

    // CAS « 1 fiche par FEUILLE » : le groupe emporte ses feuilles ENTIÈRES
    // (annexes comprises, comme les plages de pages du PDF).
    plan.push({
      kind: "sheets",
      sheetStart: sheetsArr[0],
      sheetEnd: sheetsArr[sheetsArr.length - 1],
      group: g,
    });
  }

  // Garde anti-chevauchement : une feuille ne doit appartenir qu'à UN
  // groupe (sinon deux employés partageraient une feuille) -> repli.
  const owner = new Map<number, number>();
  for (let gi = 0; gi < plan.length; gi++) {
    const p = plan[gi];
    if (p.kind !== "sheets") continue;
    for (let s = p.sheetStart; s <= p.sheetEnd; s++) {
      if (owner.has(s)) return null;
      owner.set(s, gi);
    }
  }

  // 7) Production des fichiers individuels + enregistrements
  //    (identique au PDF : repli GLOBAL si UNE SEULE extraction échoue,
  //    état cohérent garanti — le chemin historique reprend la main).
  const baseName = fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  const created: Array<{
    page: number;
    id?: string;
    cin: string | null;
    employeeName: string | null;
    period: string | null;
    netSalary: string | null;
  }> = [];
  /** compteur de bulletins étiquetés par feuille (noms affichés uniques) */
  const labeledCounter = new Map<number, number>();
  let firstId: string | undefined;
  for (let gi = 0; gi < plan.length; gi++) {
    const p = plan[gi];
    const g = p.group;
    let splitBuf: Buffer | null = null;
    let splitFileName = fileName;
    let recPageNumber = 1;

    if (p.kind === "sheets") {
      splitBuf = await extractExcelSheetRange(
        buffer,
        p.sheetStart + 1,
        p.sheetEnd + 1
      );
      if (!splitBuf) return null; // repli GLOBAL (état cohérent garanti)
      const display =
        p.sheetStart === p.sheetEnd
          ? `feuille ${p.sheetStart + 1}`
          : `feuilles ${p.sheetStart + 1}-${p.sheetEnd + 1}`;
      splitFileName = `${baseName} (${display}).xlsx`;
      recPageNumber = p.sheetEnd - p.sheetStart + 1;
    } else {
      const rowNo = (labeledCounter.get(p.sheetIndex) || 0) + 1;
      labeledCounter.set(p.sheetIndex, rowNo);
      splitBuf = await buildLabeledExcel(
        `${fileName} — fiche de paie (feuille ${p.sheetIndex + 1})`,
        parseLabeledPairs(g.text)
      );
      if (!splitBuf) return null; // repli GLOBAL
      splitFileName = `${baseName} (feuille ${p.sheetIndex + 1}, ligne ${rowNo}).xlsx`;
      recPageNumber = 1;
    }

    // écriture CHIFFRÉE AES-256-GCM (Task 21) du fichier individuel —
    // extension TOUJOURS .xlsx (lisible partout, y compris depuis .xlsm)
    const recStoredName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.xlsx`;
    await writeFile(
      path.join(storageDir, recStoredName),
      encryptForStorage(splitBuf),
      { mode: 0o600 }
    );

    const rec = await db.payslip.create({
      data: {
        fileName: splitFileName,
        storedName: recStoredName,
        fileSize: splitBuf.length,
        content: g.text,
        normalizedContent: g.normalizedText,
        cin: g.cin,
        employeeName: g.employeeName,
        period: g.period,
        netSalary: g.netSalary,
        matricule: g.matricule,
        pageNumber: recPageNumber,
        sourcePage: g.page, // feuille/ligne de départ de CETTE fiche (classeur original)
      },
    });
    if (!firstId) firstId = rec.id;
    created.push({
      page: g.page,
      id: rec.id,
      cin: g.cin,
      employeeName: g.employeeName,
      period: g.period,
      netSalary: g.netSalary,
    });
  }

  // Toutes les fiches ont leur fichier individuel : l'original complet
  // n'est plus référencé — suppression best effort (comme le PDF Task 23).
  try {
    await unlink(path.join(storageDir, storedName));
  } catch {
    // fichier déjà absent — ignorer
  }

  return {
    fileName,
    status: "SUCCESS",
    message: `${groups.length} fiches individuelles créées — le classeur Excel a été divisé par fiche de paie (affectation par CIN, un fichier Excel par employé).`,
    id: firstId,
    cin: groups[0].cin,
    employeeName: groups[0].employeeName,
    period: groups[0].period,
    netSalary: groups[0].netSalary,
    matricule: groups[0].matricule,
    fileSize,
    created: groups.length,
    items: created,
  };
}

/**
 * Analyse le texte ÉTIQUETÉ d'un groupe (« Libellé : valeur » par ligne,
 * suivi des lignes de contexte — voir expandSheetTexts) en paires
 * libellé/valeur pour la génération de la fiche Excel étiquetée.
 * La séparation se fait sur la PREMIÈRE occurrence de « : » : une valeur
 * contenant elle-même « : » reste intacte.
 */
function parseLabeledPairs(text: string): LabeledPair[] {
  const pairs: LabeledPair[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.indexOf(" : ");
    if (sep > 0) {
      pairs.push({
        label: line.slice(0, sep).trim(),
        value: line.slice(sep + 3).trim(),
      });
    } else {
      // ligne de contexte (société, période de paie, mentions légales…)
      pairs.push({ label: line, value: "" });
    }
  }
  return pairs;
}

/* ==================================================================== */
/* NOUVEAU (Task 25, additif) : découpage PHYSIQUE des documents WORD   */
/* multi-fiches en fiches INDIVIDUELLES.                                */
/*                                                                      */
/* Demande utilisateur : « le fichier docx contient plusieurs pages,    */
/* chaque page contient une fiche de paie. Quand j'importe le fichier   */
/* DOCX, l'application le divise en fiches de paie individuelles et     */
/* affecte chaque fiche à l'employé correspondant (clé = CIN). Ainsi    */
/* l'employé récupère sa fiche de paie au format DOCX. »                */
/*                                                                      */
/* Principe (aligné sur le PDF Task 23 et l'Excel Task 24) :            */
/*  - les pages logiques du document sont reconnues par docx-splitter   */
/*    (sauts de page explicites, sauts de section, marqueurs de rendu   */
/*    Word, repli « début d'un nouveau CIN » — même règle que le        */
/*    découpage texte historique) ;                                     */
/*  - les MÊMES règles de détection s'appliquent à chaque page (CIN,    */
/*    employé, période, net, matricule — aucune règle modifiée) ;       */
/*  - groupMultiPayslips() regroupe les pages consécutives du même CIN  */
/*    (règles historiques, inchangées) ;                                */
/*  - chaque groupe reçoit son PROPRE fichier Word, chiffré             */
/*    AES-256-GCM, reconstruit par COPIE de l'archive originale         */
/*    (styles, polices, tableaux, images et mise en page conservés) ;   */
/*  - les pages SANS CIN (préambule, annexes) restent rattachées à la   */
/*    fiche qui les précède (mêmes plages que le PDF) ;                 */
/*  - garde de CONFIDENTIALITÉ : une page contenant PLUSIEURS CIN       */
/*    différents (2 fiches sans saut sur la même page) interdit le      */
/*    découpage -> repli historique (fichier complet partagé) ;         */
/*  - après succès, l'original complet n'est plus référencé :           */
/*    suppression best effort ;                                         */
/*  - TOUS les cas non garantis renvoient null : l'appelant poursuit    */
/*    avec le comportement HISTORIQUE — aucune régression possible.     */
/* ==================================================================== */

/** Arguments du découpage Word (données déjà calculées par la route). */
interface DocxSplitArgs {
  fileName: string;
  buffer: Buffer;
  fileSize: number;
  /** storedName du fichier original DÉJÀ écrit sur disque (chiffré) :
   * supprimé best effort après un découpage réussi. */
  storedName: string;
  storageDir: string;
}

/**
 * Tente de découper un document Word multi-fiches en fiches individuelles.
 * Retourne un UploadResult si le découpage a COMPLÈTEMENT réussi (1 fichier
 * individuel + 1 enregistrement par fiche), sinon null → comportement
 * historique (fichier complet partagé entre les fiches).
 */
async function trySplitDocxIntoIndividualFiles(
  args: DocxSplitArgs
): Promise<UploadResult | null> {
  const { fileName, buffer, fileSize, storedName, storageDir } = args;

  // 1) Pages logiques du document (sauts de page / sections / CIN).
  const split = await getDocxPageGroups(buffer);
  if (!split || split.pages.length < 2) return null;
  const pageTexts = split.pages.map((p) => p.text);
  if (!pageTexts.some((t) => t.trim().length > 0)) return null;

  // 2) Pages virtuelles — les MÊMES règles de détection que partout
  //    ailleurs (CIN, employé, période, net, matricule).
  const pagePayslips: PagePayslip[] = pageTexts.map((t, i) => ({
    page: i + 1,
    text: t,
    normalizedText: normalizeText(t),
    // MODIFIÉ (Task 27) : arbitrage tableau (MÊME règle que PDF/OCR) —
    // corrige les bulletins où le N° CNSS était retenu à la place du CIN
    // (y compris CIN tunisien récent à 9 chiffres sous l'en-tête « N° CIN »).
    cin: arbitrateCinWithTableContext(detectCin(t), t),
    employeeName: extractEmployeeName(t),
    period: extractPeriod(t),
    netSalary: extractNetSalary(t),
    matricule: extractMatricule(t),
  }));

  // 3) Garde de CONFIDENTIALITÉ : une page ne doit contenir qu'UN SEUL
  //    CIN différent (2 fiches sur une même page sans saut -> découpage
  //    physique impossible sans mélanger deux employés -> repli).
  //    Le comptage exclut les faux positifs historiques (N° CNSS avec clé
  //    « - 08 », montants décimaux) et les matricules alphanumériques que
  //    detectCin() peut relire comme CIN — seuls les VRAIS candidats CIN
  //    (même règle que le découpage texte historique) sont comptés.
  for (const p of pagePayslips) {
    if (countDistinctCinCandidates(p.text) >= 2) return null;
  }

  // 4) Groupes = pages consécutives du MÊME CIN (règles historiques).
  //    Moins de 2 CIN différents : mono-fiche -> comportement historique
  //    (1 enregistrement pour tout le document, non découpé).
  const groups = groupMultiPayslips(pagePayslips);
  if (!groups || groups.length < 2) return null;

  // 5) Plages de pages par groupe — pages sans CIN (préambule, annexes)
  //    rattachées à la fiche qui les précède (MÊMES plages que le PDF
  //    Task 23 : la 1re plage démarre toujours à la page 1).
  const totalPages = split.pages.length;
  const ranges = groups.map((g, i) => {
    const start = i === 0 ? 1 : g.page;
    const end =
      i + 1 < groups.length ? groups[i + 1].page - 1 : totalPages;
    return {
      startPage: Math.min(start, g.page),
      endPage: Math.max(g.page, end),
    };
  });

  // 6) Production des fichiers individuels + enregistrements
  //    (identique au PDF : repli GLOBAL si UNE SEULE extraction échoue,
  //    état cohérent garanti — le chemin historique reprend la main).
  const baseName = fileName.replace(/\.docx$/i, "");
  const created: Array<{
    page: number;
    id?: string;
    cin: string | null;
    employeeName: string | null;
    period: string | null;
    netSalary: string | null;
  }> = [];
  let firstId: string | undefined;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const range = ranges[gi];
    const splitBuf = await extractDocxPageRange(
      buffer,
      range.startPage,
      range.endPage
    );
    if (!splitBuf) return null; // repli GLOBAL (état cohérent garanti)

    // Nom affiché : « original (page N).docx » ou « (pages N-M).docx »
    const displayPage =
      range.startPage === range.endPage
        ? `page ${range.startPage}`
        : `pages ${range.startPage}-${range.endPage}`;
    const splitFileName = `${baseName} (${displayPage}).docx`;

    // écriture CHIFFRÉE AES-256-GCM (Task 21) du fichier individuel
    const recStoredName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.docx`;
    await writeFile(
      path.join(storageDir, recStoredName),
      encryptForStorage(splitBuf),
      { mode: 0o600 }
    );

    const rec = await db.payslip.create({
      data: {
        fileName: splitFileName,
        storedName: recStoredName,
        fileSize: splitBuf.length,
        content: g.text,
        normalizedContent: g.normalizedText,
        cin: g.cin,
        employeeName: g.employeeName,
        period: g.period,
        netSalary: g.netSalary,
        matricule: g.matricule,
        pageNumber: range.endPage - range.startPage + 1,
        sourcePage: g.page, // page de début de CETTE fiche (document original)
      },
    });
    if (!firstId) firstId = rec.id;
    created.push({
      page: g.page,
      id: rec.id,
      cin: g.cin,
      employeeName: g.employeeName,
      period: g.period,
      netSalary: g.netSalary,
    });
  }

  // Toutes les fiches ont leur fichier individuel : l'original complet
  // n'est plus référencé — suppression best effort (comme PDF/Excel).
  try {
    await unlink(path.join(storageDir, storedName));
  } catch {
    // fichier déjà absent — ignorer
  }

  return {
    fileName,
    status: "SUCCESS",
    message: `${groups.length} fiches individuelles créées — le document Word a été divisé par fiche de paie (affectation par CIN, un fichier Word par employé).`,
    id: firstId,
    cin: groups[0].cin,
    employeeName: groups[0].employeeName,
    period: groups[0].period,
    netSalary: groups[0].netSalary,
    matricule: groups[0].matricule,
    fileSize,
    created: groups.length,
    items: created,
  };
}
