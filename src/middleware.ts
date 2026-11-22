/**
 * Middleware Auto RH — aucune page ni API accessible sans session.
 *
 * - Pages (/, etc.) : redirection vers /login si aucun cookie de session.
 * - API (hors /api/auth/*) : réponse 401 JSON si aucun cookie de session.
 * - La VALIDATION complète (signature, expiration, compte actif en base)
 *   est faite dans chaque API via getSessionUser() — ici on ne teste que
 *   la présence du cookie pour une navigation fluide.
 * - (NOUVEAU Task 180, v0.2.86) EXCEPTIONS PUBLIQUES du QR FICHE EN LIGNE :
 *   /verification/fiche/[id] (page de vérification ouverte par le scan du
 *   QR d'une fiche de paie) et /api/payslips/qr/[id]/file (fichier tamponné
 *   correspondant) sont accessibles SANS session — leur protection repose
 *   sur le JETON HMAC signé propre à chaque fiche (jetonFicheValide(),
 *   comparaison en temps constant) ; seules ces deux familles de routes
 *   sont concernées, tout le reste reste derrière la connexion.
 * - (NOUVEAU v0.2.88) EXCEPTIONS PUBLIQUES du QR « RÉPONSE EN LIGNE » :
 *   /verification/reponse/[reference] (page ouverte par le scan du QR d'un
 *   document de réponse RH) et /api/demandes/qr/[reference]/file (documents
 *   correspondants) — même discipline : protégées par le JETON HMAC de la
 *   RÉFÉRENCE (jetonReponseValide(), temps constant), rien d'autre n'est
 *   ouvert (les listes et les API privées des demandes restent protégées).
 * - (MODIFIÉ Task 193-b) EXCEPTION PUBLIQUE api/download-matrice (classeur
 *   Excel de la matrice des rôles, même logique que download-readme).
 * - (NOUVEAU Task 197) EXCEPTION PUBLIQUE api/download-routage (classeur
 *   Excel de la map de routage e-mail des demandes, même logique).
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "service_rh_session";

export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  // API protégée (sauf auth) : 401 JSON, pas de redirection
  if (pathname.startsWith("/api/")) {
    if (hasSession) return NextResponse.next();
    return Response.json(
      { error: "Accès refusé : veuillez vous connecter." },
      { status: 401 }
    );
  }

  // Page protégée : redirection vers la connexion
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // MODIFIÉ (Task 15) : fiche-icon.svg / fiche-icon.png AJOUTÉS aux
    // exclusions (favicon public, requis sur la page de connexion).
    // MODIFIÉ (Task 115) : logo Trailmix + favicons ajoutés aux exclusions
    // (logo-trailmix.png / favicon.ico / icon-trailmix-192.png /
    // apple-touch-icon.png — requis sur les pages publiques).
    // MODIFIÉ (Task 145) : api/download-readme AJOUTÉ (PDF public du
    // README technique, même logique que api/download-scripts).
    // MODIFIÉ (Task 180, v0.2.86) : verification + api/payslips/qr AJOUTÉS
    // aux exclusions — QR FICHE EN LIGNE : la page de vérification et le
    // fichier tamponné sont publics, protégés par le jeton HMAC de la fiche.
    // MODIFIÉ (v0.2.88) : api/demandes/qr AJOUTÉ — QR « RÉPONSE EN LIGNE » :
    // les documents de réponse servis par jeton HMAC de la référence
    // (la page /verification/reponse est couverte par « verification »).
    // MODIFIÉ (Task 193-b) : api/download-matrice AJOUTÉ (classeur Excel
    // public de la matrice des rôles, même logique que download-readme).
    // NOUVEAU (Task 197) : api/download-routage AJOUTÉ (classeur Excel
    // public de la map de routage e-mail des demandes).
    // NOUVEAU (Task 211, v0.2.104) : api/download-formation AJOUTÉ (PDF
    // public du support de formation du service RH, même logique que
    // download-readme — diffusion aux nouveaux arrivants sans compte).
    // NOUVEAU (Task 198, v0.2.153) : api/download-scripts-leger AJOUTÉ
    // (archive légère publique, même logique que api/download-scripts).
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|fiche-icon.svg|fiche-icon.png|logo-trailmix.png|icon-trailmix-192.png|apple-touch-icon.png|robots.txt|login|api/auth|api/download-scripts|api/download-scripts-leger|api/download-readme|api/download-matrice|api/download-routage|api/download-formation|verification|api/payslips/qr|api/demandes/qr).*)",
  ],
};
