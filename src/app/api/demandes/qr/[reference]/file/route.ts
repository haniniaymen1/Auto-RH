/**
 * ============================================================================
 *  NOUVEAU (v0.2.88) — API PUBLIQUE DU FICHIER « RÉPONSE EN LIGNE » (QR code)
 * ============================================================================
 *
 *  GET /api/demandes/qr/[reference]/file?t=<jeton>&doc=<documentId>[&download=1]
 *
 *  Servage d'un document de réponse du service RH (PDF / image / DOC…, stocké
 *  CHIFFRÉ dans storage/documents-demandes/) à la personne qui vient de
 *  SCANNER le QR code apposé sur le document de réponse, via la page de
 *  vérification /verification/reponse/[reference]. Demande utilisateur :
 *  « Les réponses aux demandes doivent également être accessibles via le
 *  QR Code contient url comme les qr de fiche de paie principale du portail ».
 *
 *  SÉCURITÉ — cette API est PUBLIQUE (exemptée du middleware, aucune session)
 *  mais protégée par le JETON HMAC-SHA256 signé propre à la RÉFÉRENCE de la
 *  demande (jetonReponseValide() — comparaison en TEMPS CONSTANT) :
 *   - jeton absent, altéré ou d'une autre demande → 403, AUCUN contenu servi ;
 *   - le jeton n'ouvre QUE les documents de CETTE demande (aucun listage) ;
 *   - le document demandé doit APPARTENIR à la demande (docId vérifié) ;
 *   - supprimer la demande révoque mécaniquement le lien (404).
 *   → Toute la chaîne reste fermée : les API privées, la liste des demandes
 *     et les autres documents ne sont pas touchés par cette exception
 *     publique (middleware : seule la famille /api/demandes/qr est exclue).
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { decryptFromStorage } from "@/lib/storage-crypto";
import { resolveStoredDocument } from "@/lib/storage-dir";
import { jetonReponseValide } from "@/lib/stamp";

export const runtime = "nodejs";

/** Type MIME servi selon l'extension du nom stocké (jumelle de l'API privée). */
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
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const url = new URL(request.url);
    const jeton = url.searchParams.get("t");
    const docId = String(url.searchParams.get("doc") ?? "").trim();

    // ---- 1) JETON D'ABORD : rien (même l'existence de la demande) n'est
    //         révélé tant que le jeton signé n'est pas prouvé. ----
    const ref = String(reference ?? "").trim();
    if (
      !ref ||
      ref.length > 40 ||
      !/^[A-Za-z0-9_-]+$/.test(ref) ||
      !jetonReponseValide(ref, jeton)
    ) {
      return NextResponse.json(
        { error: "Lien de vérification invalide ou altéré (jeton refusé)." },
        { status: 403 }
      );
    }
    if (!docId || docId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(docId)) {
      return NextResponse.json(
        { error: "Lien de vérification invalide (document non précisé)." },
        { status: 403 }
      );
    }

    // ---- 2) Demande + document (le document doit appartenir À LA DEMANDE) ----
    const demande = await db.demandeAdministrative.findUnique({
      where: { reference: ref },
      select: { id: true, reference: true },
    });
    if (!demande) {
      return NextResponse.json(
        { error: "Demande introuvable : le QR code correspond à une réponse retirée du serveur." },
        { status: 404 }
      );
    }
    const doc = await db.documentDemande.findUnique({
      where: { id: docId },
      select: { id: true, demandeId: true, chemin: true, nomFichier: true, typeMime: true },
    });
    if (!doc || doc.demandeId !== demande.id) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }
    const filePath = resolveStoredDocument(doc.chemin);
    if (!filePath) {
      console.error("[DEMANDES/QR] document introuvable sur le disque :", doc.chemin);
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
    const telecharger = url.searchParams.get("download") === "1";
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
    console.error("[DEMANDES/QR] fichier:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
