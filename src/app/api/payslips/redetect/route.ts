import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  analyzePayslip,
  analyzePayslipPages,
  groupMultiPayslips,
} from "@/lib/payslip-extractor";
// NOUVEAU (ajouté SANS modifier les imports historiques ci-dessus) :
// ré-analyse multi-format (PDF historique + images PNG/JPG, Excel, Word)
import { reanalyzeStoredFile } from "@/lib/payslip-reanalyze";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
import { resolveStoredFile } from "@/lib/storage-dir";
import { readFile } from "fs/promises";
// (NOUVEAU Task 21, additif) déchiffrement à la volée avant ré-analyse :
// OCR / parse ont besoin du contenu EN CLAIR ; fichiers historiques intacts.
import { decryptFromStorage } from "@/lib/storage-crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

// CORRECTIF : les PDF sont lus via une recherche multi-dossiers (racine du
// projet, cwd historique, ancien emplacement standalone). Voir storage-dir.ts.

export interface RedetectResult {
  fileName: string;
  status: "OK" | "ERROR";
  cin: string | null;
  period: string | null;
  message: string;
}

/**
 * POST /api/payslips/redetect
 *
 * NOUVEAU : relance la détection (CIN, période, employé, net, matricule,
 * contenu normalisé) sur TOUTES les fiches DÉJÀ importées, en relisant les
 * PDF stockés sur le serveur. Aucune fiche n'est supprimée, aucun fichier
 * n'est modifié : seules les métadonnées détectées sont actualisées.
 *
 * Utile après une mise à jour de l'extracteur (nouveaux formats de CIN ou de
 * période pris en charge : "26 542 351", "9593-1034", "Période de paie :
 * Avril 2026", …) pour corriger les fiches importées avant la mise à jour.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : maintenance des fiches refusée au rôle IT.
  if (user.role === "IT") return refusIT("la redétection du contenu des fiches");
  try {
    const rows = await db.payslip.findMany({ orderBy: { uploadedAt: "asc" } });

    let updated = 0;
    let cinFound = 0;
    let periodFound = 0;
    let errors = 0;
    const details: RedetectResult[] = [];

    for (const r of rows) {
      try {
        const filePath = resolveStoredFile(r.storedName);
        if (!filePath) throw new Error("PDF introuvable dans les dossiers de stockage");
        // (Task 21) déchiffre si chiffré, sinon fichier historique tel quel
        const buffer = decryptFromStorage(await readFile(filePath));

        // NOUVEAU (ajouté SANS modifier le chemin historique ci-dessous) :
        // fiche importée depuis une IMAGE (PNG/JPG), un CLASSEUR Excel ou un
        // document Word -> ré-analyse par le lecteur adapté au format (la
        // redétection historique ne savait relire que les PDF). La fiche est
        // mise à jour avec les NOUVELLES règles, sans être recréée.
        const extLower = (r.storedName || r.fileName || "")
          .toLowerCase()
          .match(/\.([a-z0-9]+)$/)?.[1];
        if (extLower && extLower !== "pdf") {
          const re = await reanalyzeStoredFile(r.fileName, buffer, r.sourcePage);
          if (re && re.text && re.text.trim()) {
            await db.payslip.update({
              where: { id: r.id },
              data: {
                content: re.text,
                normalizedContent: re.normalizedText,
                cin: re.cin,
                employeeName: re.employeeName,
                period: re.period,
                netSalary: re.netSalary,
                matricule: re.matricule,
              },
            });
            updated++;
            if (re.cin) cinFound++;
            if (re.period) periodFound++;
            details.push({
              fileName: r.fileName,
              status: "OK",
              cin: re.cin,
              period: re.period,
              message: `Fiche ${extLower.toUpperCase()} relue — CIN : ${re.cin ?? "—"}${
                re.period ? ` — Période : ${re.period}` : ""
              }`,
            });
          } else {
            details.push({
              fileName: r.fileName,
              status: "OK",
              cin: r.cin,
              period: r.period,
              message: `Fichier ${extLower.toUpperCase()} illisible ou page introuvable — fiche inchangée.`,
            });
          }
          continue;
        }

        // NOUVEAU (ajouté SANS modifier le chemin historique) : fiche issue
        // d'un PDF multi-fiches (sourcePage renseigné) → on relit UNIQUEMENT
        // sa page pour ne pas écraser son CIN/période par ceux de la page 1.
        if (r.sourcePage != null) {
          const { pagePayslips } = await analyzePayslipPages(buffer);
          const groups = groupMultiPayslips(pagePayslips);
          const group = groups?.find((g) => g.page === r.sourcePage);
          if (group) {
            await db.payslip.update({
              where: { id: r.id },
              data: {
                content: group.text,
                normalizedContent: group.normalizedText,
                cin: group.cin,
                employeeName: group.employeeName,
                period: group.period,
                netSalary: group.netSalary,
                matricule: group.matricule,
              },
            });
            updated++;
            if (group.cin) cinFound++;
            if (group.period) periodFound++;
            details.push({
              fileName: r.fileName,
              status: "OK",
              cin: group.cin,
              period: group.period,
              message: `Fiche multi-pages (page ${r.sourcePage}) — CIN : ${group.cin ?? "—"}${
                group.period ? ` — Période : ${group.period}` : ""
              }`,
            });
          } else {
            // le PDF a changé de structure → fiche laissée inchangée
            details.push({
              fileName: r.fileName,
              status: "OK",
              cin: r.cin,
              period: r.period,
              message: `Page ${r.sourcePage} introuvable dans le PDF — fiche inchangée.`,
            });
          }
          continue;
        }

        const analysis = await analyzePayslip(buffer);

        if (!analysis.text || analysis.text.trim().length === 0) {
          errors++;
          details.push({
            fileName: r.fileName,
            status: "ERROR",
            cin: r.cin,
            period: r.period,
            message: "PDF sans texte extractible — fiche inchangée.",
          });
          continue;
        }

        await db.payslip.update({
          where: { id: r.id },
          data: {
            content: analysis.text,
            normalizedContent: analysis.normalizedText,
            pageNumber: analysis.pages,
            cin: analysis.cin,
            employeeName: analysis.employeeName,
            period: analysis.period,
            netSalary: analysis.netSalary,
            matricule: analysis.matricule,
          },
        });

        updated++;
        if (analysis.cin) cinFound++;
        if (analysis.period) periodFound++;
        details.push({
          fileName: r.fileName,
          status: "OK",
          cin: analysis.cin,
          period: analysis.period,
          message: analysis.cin
            ? `CIN : ${analysis.cin}${analysis.period ? ` — Période : ${analysis.period}` : ""}`
            : "Aucun CIN détecté dans le contenu.",
        });
      } catch (e) {
        errors++;
        // (Task 99) la cause RÉELLE est incluse : sans elle, un défaut de
        // lecture (fichier absent, PDF illisible, extraction impossible)
        // était indiscernable et indéboguable.
        details.push({
          fileName: r.fileName,
          status: "ERROR",
          cin: r.cin,
          period: r.period,
          message:
            "Lecture du PDF impossible (fichier déplacé ou corrompu ?)" +
            " — " +
            (e instanceof Error ? e.message : String(e)),
        });
      }
    }

    return NextResponse.json({
      total: rows.length,
      updated,
      cinFound,
      periodFound,
      errors,
      details,
    });
  } catch (error) {
    console.error("[REDETECT] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la redétection des fiches de paie." },
      { status: 500 }
    );
  }
}
