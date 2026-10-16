/**
 * ============================================================================
 *  NOUVEAU (Task 224) — REGISTRE DES DOCUMENTS SIGNÉS
 * ============================================================================
 *
 *  GET /api/signature-api/documents?type=FICHE_PAIE|REPONSE&limit=50
 *      → liste du registre (métadonnées publiques : type, référence, mode,
 *        environnement, certificat associé, statut de vérification, dates).
 *      Rôles : IT / SUPERADMIN.
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

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json({ documents: [] });
    }
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const limite = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const documents = await db.signatureApiDocument.findMany({
      where: type === "FICHE_PAIE" || type === "REPONSE" ? { type } : undefined,
      orderBy: { signeLe: "desc" },
      take: limite,
      select: {
        id: true,
        type: true,
        sourceId: true,
        reference: true,
        nomFichier: true,
        mode: true,
        environnement: true,
        tailleOctets: true,
        certSujet: true,
        certEmetteur: true,
        certSerie: true,
        certEmpreinte: true,
        certValideDu: true,
        certValideAu: true,
        verifStatut: true,
        verifLe: true,
        verifMessage: true,
        signeLe: true,
        signePar: true,
      },
    });
    return NextResponse.json({ documents });
  } catch (error) {
    console.error("[SIGNATURE-API/DOCUMENTS] Liste:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
