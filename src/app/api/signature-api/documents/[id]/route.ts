/**
 * ============================================================================
 *  NOUVEAU (Task 224) — DOCUMENT SIGNÉ : TÉLÉCHARGEMENT + SUPPRESSION
 * ============================================================================
 *
 *  GET  /api/signature-api/documents/[id]           → PDF signé (inline)
 *  GET  /api/signature-api/documents/[id]?telecharger=1 → pièce jointe
 *  DELETE /api/signature-api/documents/[id]         → retire du registre
 *          (la copie chiffrée conservée est supprimée ; le document SOURCE
 *           — fiche de paie / demande — n'est JAMAIS touché)
 *
 *  Rôles : IT / SUPERADMIN.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { supprimerDocumentConserve } from "@/lib/signature-api";
import { decryptFromStorage } from "@/lib/storage-crypto";
import { dossierDocumentsSignes } from "@/lib/signature-api";
import fs from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    const { id } = await params;
    const ligne = await db.signatureApiDocument.findUnique({ where: { id } });
    if (!ligne?.chemin) {
      return NextResponse.json({ error: "Document signé introuvable." }, { status: 404 });
    }
    const absolu = path.join(dossierDocumentsSignes(), path.basename(ligne.chemin));
    const brut = await fs.promises.readFile(absolu);
    const pdf = decryptFromStorage(brut);
    const nom = (ligne.nomFichier || "document-signe.pdf").replace(/["\\\r\n]/g, "_");
    const telecharger = new URL(request.url).searchParams.get("telecharger") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${nom}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[SIGNATURE-API/DOCUMENT] Lecture:", error);
    return NextResponse.json(
      { error: "Copie signée illisible (clé de chiffrement changée ?). Supprimez-la puis re-scrutez le document." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    const { id } = await params;
    const ok = await supprimerDocumentConserve(id);
    if (!ok) return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Document signé retiré du registre." });
  } catch (error) {
    console.error("[SIGNATURE-API/DOCUMENT] Suppression:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
