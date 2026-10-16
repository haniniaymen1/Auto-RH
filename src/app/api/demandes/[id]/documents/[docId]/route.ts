/**
 * ============================================================================
 *  NOUVEAU (Task 122) — TÉLÉCHARGEMENT D'UN DOCUMENT TRANSMIS PAR LE RH
 * ============================================================================
 *  GET /api/demandes/[id]/documents/[docId]?telecharger=1
 *   → sert le fichier joint par le service RH à sa réponse e-mail (importé
 *     automatiquement par le portail employé 4001, stocké CHIFFRÉ dans
 *     storage/documents-demandes/, même mécanisme AES-256-GCM que les fiches).
 *
 *  Utilisé par le panneau « Demandes administratives » (RH/IT/SUPERADMIN) :
 *  le RH vérifie ce que la réception automatique a associé à la demande —
 *  l'employé, lui, télécharge par le portail (4001,
 *  /api/mes-demandes/documents/<id>, limité au propriétaire du CIN).
 *
 *  Accès : RH et SUPERADMIN — IT REFUSÉ (403 FONCTIONNALITE_NON_AUTORISEE_IT,
 *  v0.2.100 : matrice des rôles, « Téléchargement des documents de réponse »
 *  = Non ; avant : IT admis côté serveur sans interface exposée). Mot de
 *  passe expiré → 403. Garde anti-traversée sur le nom
 *  stocké (resolveStoredDocument — src/lib/storage-dir.ts).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSessionUser, motDePasseExpire, refusIT, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptFromStorage } from "@/lib/storage-crypto";
import { resolveStoredDocument } from "@/lib/storage-dir";

export const runtime = "nodejs";

/** Type MIME servi selon l'extension du nom stocké. */
function mimeDepuisExtension(ext: string): string {
  switch (String(ext || "").toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (NOUVEAU v0.2.100 — matrice des rôles) « Téléchargement des documents de
  // réponse » = Non pour l'IT : refus PROPRE côté serveur (avant : l'IT était
  // admis ici alors qu'aucune interface ne lui est exposée).
  if (session.role === "IT") {
    return refusIT("le téléchargement des documents de réponse");
  }
  try {
    const { id, docId } = await params;
    // Le document doit appartenir À LA DEMANDE demandée (pas seulement exister).
    const doc = await db.documentDemande.findUnique({
      where: { id: docId },
      include: { demande: { select: { id: true, reference: true, type: true } } },
    });
    if (!doc || doc.demandeId !== id) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }
    const filePath = resolveStoredDocument(doc.chemin);
    if (!filePath) {
      console.error("[DEMANDES] document introuvable sur le disque :", doc.chemin);
      return NextResponse.json(
        { error: "Fichier introuvable sur le serveur (storage/documents-demandes)." },
        { status: 404 }
      );
    }
    let data: Buffer;
    try {
      data = decryptFromStorage(await readFile(filePath));
    } catch {
      return NextResponse.json(
        { error: "Document illisible : la clé de chiffrement (AUTO_RH_STORAGE_KEY) ne correspond pas à celle utilisée lors du chiffrement." },
        { status: 500 }
      );
    }
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    const ext = path.extname(doc.chemin).replace(".", "").toLowerCase();
    const typeMime = doc.typeMime || mimeDepuisExtension(ext);
    const safeName = doc.nomFichier.replace(/["\\\r\n]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": typeMime,
        "Content-Length": String(data.length),
        "Content-Disposition":
          (telecharger ? "attachment" : "inline") +
          '; filename="' + safeName + '"' +
          "; filename*=UTF-8''" + encodeURIComponent(doc.nomFichier),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[DEMANDES] Document:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
