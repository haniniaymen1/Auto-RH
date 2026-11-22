/**
 * ============================================================================
 *  NOUVEAU (Task 224) — TEST DE LA CONFIGURATION DE SIGNATURE
 * ============================================================================
 *
 *  POST /api/signature-api/test
 *      → teste la configuration ACTIVE :
 *          - mode LOCALE      : déballe le certificat, signe un PDF témoin,
 *                               VÉRIFIE la signature produite ;
 *          - mode API_EXTERNE : envoie le PDF témoin à l'URL de
 *                               l'environnement courant (TEST/PRODUCTION),
 *                               contrôle la réponse (PDF signé attendu).
 *      Le résultat (durée, diagnostic complet) est journalisé dans la
 *      configuration (apiDernierTest*) et affiché dans l'interface.
 *      Rôles : IT / SUPERADMIN.
 * ============================================================================
 */
import { NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { testerConfiguration } from "@/lib/signature-api";

export async function POST() {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json(
        { error: "Fonctionnalité réservée aux rôles IT et superadministrateur." },
        { status: 403 }
      );
    }
    const resultat = await testerConfiguration();
    return NextResponse.json(resultat, { status: resultat.ok ? 200 : 400 });
  } catch (error) {
    console.error("[SIGNATURE-API/TEST]", error);
    return NextResponse.json(
      { ok: false, message: "Erreur serveur pendant le test : " + String((error as Error).message || error) },
      { status: 500 }
    );
  }
}
