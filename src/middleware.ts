/**
 * Middleware AutoRH — aucune page ni API accessible sans session.
 *
 * - Pages (/, etc.) : redirection vers /login si aucun cookie de session.
 * - API (hors /api/auth/*) : réponse 401 JSON si aucun cookie de session.
 * - La VALIDATION complète (signature, expiration, compte actif en base)
 *   est faite dans chaque API via getSessionUser() — ici on ne teste que
 *   la présence du cookie pour une navigation fluide.
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "auto_rh_session";

// Routes accessibles sans session (historique).
const ROUTES_PUBLIQUES_SESSION = [
  "login",
  "api/auth",
  "api/download-scripts",
  "api/download-scripts-leger",
  "api/download-readme",
  "api/download-matrice",
  "api/download-routage",
  "api/download-formation",
  "verification",
  "api/payslips/qr",
  "api/demandes/qr",
];

function estRoutePubliqueSession(pathname: string): boolean {
  return ROUTES_PUBLIQUES_SESSION.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  // API protégée (sauf auth et routes publiques) : 401 JSON, pas de redirection
  if (pathname.startsWith("/api/")) {
    if (estRoutePubliqueSession(pathname) || hasSession) {
      return NextResponse.next();
    }
    return Response.json(
      { error: "Accès refusé : veuillez vous connecter." },
      { status: 401 }
    );
  }

  // Page protégée : redirection vers la connexion
  if (!hasSession && !estRoutePubliqueSession(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|fiche-icon.svg|fiche-icon.png|logo-trailmix.png|icon-trailmix-192.png|apple-touch-icon.png|robots.txt|login|api/auth|api/download-scripts|api/download-scripts-leger|api/download-readme|api/download-matrice|api/download-routage|api/download-formation|verification|api/payslips/qr|api/demandes/qr).*)",
  ],
};
