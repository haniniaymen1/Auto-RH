/**
 * ============================================================================
 *  NOUVEAU (Task 224) — VÉRIFICATION D'UN DOCUMENT SIGNÉ CONSERVÉ
 * ============================================================================
 *
 *  POST /api/signature-api/documents/[id]/verifier
 *      → re-vérifie l'INTÉGRITÉ cryptographique de la copie conservée
 *        (reconstruction ByteRange + condensé CMS via OpenSSL), met à jour
 *        le registre (verifStatut/verifLe/verifMessage) et renvoie le rapport
 *        (integrité, signataire, validité du certificat).
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
import { verifierDocumentConserve } from "@/lib/signature-api";

export async function POST(
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
    const rapport = await verifierDocumentConserve(id);
    return NextResponse.json(rapport);
  } catch (error) {
    console.error("[SIGNATURE-API/VERIFIER]", error);
    return NextResponse.json({ error: "Erreur serveur pendant la vérification." }, { status: 500 });
  }
}
