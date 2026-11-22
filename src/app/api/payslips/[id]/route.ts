import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { unlink } from "fs/promises";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
import { resolveStoredFile } from "@/lib/storage-dir";
// NOUVEAU (Task 244) : la copie signée FIGÉE (signature d'origine) est
// supprimée avec la fiche — aucun document signé orphelin ne subsiste.
import { supprimerCopieFigee } from "@/lib/copie-signee";

export const runtime = "nodejs";

// CORRECTIF : suppression du PDF dans le dossier où il se trouve réellement
// (plusieurs candidats : racine du projet, cwd historique, ancien emplacement
// standalone). Voir src/lib/storage-dir.ts.

/** GET /api/payslips/[id] — détail complet d'une fiche (avec le texte extrait). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : consultation des fiches refusée au rôle IT.
  if (user.role === "IT") return refusIT("la consultation du détail d'une fiche");
  try {
    const { id } = await params;
    const record = await db.payslip.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Fiche de paie introuvable." }, { status: 404 });
    }
    return NextResponse.json({
      id: record.id,
      fileName: record.fileName,
      fileSize: record.fileSize,
      cin: record.cin,
      employeeName: record.employeeName,
      period: record.period,
      netSalary: record.netSalary,
      matricule: record.matricule,
      pageNumber: record.pageNumber,
      uploadedAt: record.uploadedAt.toISOString(),
      content: record.content,
    });
  } catch (error) {
    console.error("[DETAIL] Erreur:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

/** DELETE /api/payslips/[id] — supprime la fiche (base + fichier PDF). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : suppression des fiches refusée au rôle IT.
  if (user.role === "IT") return refusIT("la suppression d'une fiche de paie");
  try {
    const { id } = await params;
    const record = await db.payslip.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Fiche de paie introuvable." }, { status: 404 });
    }

    await db.payslip.delete({ where: { id } });

    // NOUVEAU (Task 244) : suppression de la copie signée FIGÉE de la fiche
    // (best effort — nom dérivé de l'identifiant, aucune lecture préalable).
    try {
      await supprimerCopieFigee(id);
    } catch {
      // déjà absente — ignorer
    }

    // Suppression du fichier sur disque, où qu'il soit (best effort)
    // NOUVEAU (Task 23, garde additive) : un même fichier physique peut être
    // référencé par PLUSIEURS fiches (PDF multi-fiches importés avant le
    // découpage automatique, classeurs Excel multi-lignes, Word multi-CIN).
    // Le fichier n'est supprimé QUE si plus aucun enregistrement ne le
    // référence — supprimer une fiche ne casse plus les fiches sœurs.
    try {
      const siblings = await db.payslip.count({
        where: { storedName: record.storedName },
      });
      if (siblings === 0) {
        const filePath = resolveStoredFile(record.storedName);
        if (filePath) await unlink(filePath);
      }
    } catch {
      // fichier déjà absent — ignorer
    }

    return NextResponse.json({ ok: true, message: "Fiche de paie supprimée." });
  } catch (error) {
    console.error("[DELETE] Erreur:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression." }, { status: 500 });
  }
}
