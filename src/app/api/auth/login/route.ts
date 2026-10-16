/**
 * POST /api/auth/login — connexion d'un utilisateur autorisé (RH / IT / SUPERADMIN).
 * Body : { email, password, remember?: boolean }
 *
 * NOUVEAU (Task 64) : POLITIQUE D'EXPIRATION — 15 JOURS, TOUS LES COMPTES.
 * Si le mot de passe est expiré (passwordChangedAt null ou > 15 jours), la
 * connexion aboutit MAIS :
 *   - la session créée ne dure que 15 minutes (le temps de changer le mot
 *     de passe) ;
 *   - la réponse porte mustChangePassword: true → l'interface affiche
 *     immédiatement l'écran de changement NON CONTOURNABLE ;
 *   - toutes les autres API répondent 403 tant que le changement n'est pas fait.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSessionToken,
  MAX_AGE_LONG,
  MAX_AGE_MOT_DE_PASSE_EXPIRE,
  MAX_AGE_SHORT,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { isPasswordExpired } from "@/lib/password-policy";
// NOUVEAU (Task 208) : journal de sécurité des authentifications — chaque
// échec / verrouillage / succès est tracé dans logs/auth-securite.log.
import { journalAuth } from "@/lib/auth-journal";

export const runtime = "nodejs";

/* ---------------------------------------------------------------- */
/* (CORRECTIF SÉCURITÉ — Task 94) Anti force-brute sur la connexion  */
/*                                                                   */
/* La connexion était la seule porte restée sans protection (l'ancien*/
/* code d'inscription avait la sienne) : un attaquant pouvait tester */
/* des mots de passe à volonté (force brute en ligne). Même mécanisme*/
/* de fenêtre glissante en mémoire, bornée, par adresse IP.          */
/* 10 échecs / 10 minutes → 429.                                     */
/* ---------------------------------------------------------------- */
const CONNEXIONS_ECHECS = new Map<string, number[]>();
const CONNEXION_FENETRE_MS = 10 * 60 * 1000; // 10 minutes
const CONNEXION_MAX_ECHECS = 10; // 10 échecs de mot de passe par fenêtre

function ipClient(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "local";
}

function echecConnexionRecents(ip: string): number {
  const now = Date.now();
  const liste = (CONNEXIONS_ECHECS.get(ip) ?? []).filter(
    (t) => now - t < CONNEXION_FENETRE_MS
  );
  CONNEXIONS_ECHECS.set(ip, liste);
  // ménage périodique (mémoire bornée, comme le portail OTP)
  if (CONNEXIONS_ECHECS.size > 1000) {
    for (const [k, v] of CONNEXIONS_ECHECS) {
      if (!v.some((t) => now - t < CONNEXION_FENETRE_MS)) {
        CONNEXIONS_ECHECS.delete(k);
      }
    }
  }
  return liste.length;
}

function enregistrerEchecConnexion(ip: string): void {
  const now = Date.now();
  const liste = (CONNEXIONS_ECHECS.get(ip) ?? []).filter(
    (t) => now - t < CONNEXION_FENETRE_MS
  );
  liste.push(now);
  CONNEXIONS_ECHECS.set(ip, liste);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const remember = Boolean(body?.remember);

    if (!email || !password) {
      return NextResponse.json(
        { error: "Veuillez saisir votre email et votre mot de passe." },
        { status: 400 }
      );
    }

    // (CORRECTIF SÉCURITÉ — Task 94) anti force-brute : trop d'échecs
    // récents depuis cette adresse IP ? → refus temporaire (429).
    const ip = ipClient(request);
    if (echecConnexionRecents(ip) >= CONNEXION_MAX_ECHECS) {
      // (Task 208) le verrouillage force-brute est journalisé.
      await journalAuth({ evenement: "verrouille", ip, email, detail: "anti force-brute Task 94" });
      return NextResponse.json(
        { error: "Trop de tentatives de connexion depuis votre poste. Réessayez dans quelques minutes." },
        { status: 429 }
      );
    }

    // (MODIFIÉ v0.2.129) : `let` — la variable est réassignée lors de
    // l'ACTIVATION du compte (première connexion dans le délai de 15 min).
    let user = await db.user.findUnique({ where: { email } });
    // Message identique « email ou mot de passe » pour ne pas révéler si l'email existe
    if (!user || !verifyPassword(password, user.passwordHash)) {
      enregistrerEchecConnexion(ip);
      // (Task 208) échec d'authentification journalisé.
      await journalAuth({ evenement: "echec", ip, email });
      return NextResponse.json(
        { error: "Email ou mot de passe incorrect." },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      // (Task 208) tentative sur un compte désactivé : journalisée aussi.
      await journalAuth({ evenement: "desactive", ip, email });
      // NOUVEAU (v0.2.129) : distingue la désactivation AUTOMATIQUE (délai
      // d'activation de 15 minutes dépassé) de la désactivation manuelle —
      // message adapté (l'ancien mot de passe n'est plus accepté ; seul le
      // SuperAdmin peut réactiver le compte avec un NOUVEAU mot de passe).
      const expireInitial =
        user.passwordExpiresAt !== null &&
        new Date(user.passwordExpiresAt).getTime() <= Date.now();
      if (expireInitial) {
        return NextResponse.json(
          {
            error:
              "Ce compte a été automatiquement désactivé : le délai de 15 minutes pour l'activer avec le mot de passe initial est dépassé. L'ancien mot de passe n'est plus accepté — contactez le superadministrateur pour recevoir un nouveau mot de passe.",
            code: "COMPTE_EXPIRE_INITIAL",
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "Ce compte a été désactivé. Contactez votre service informatique." },
        { status: 403 }
      );
    }

    // ------------------------------------------------------------------
    // NOUVEAU (v0.2.129 — demande utilisateur) : MOT DE PASSE INITIAL —
    // VALIDITÉ DE 15 MINUTES.
    //   - délai DÉPASSÉ sans connexion => le compte est désactivé
    //     IMMÉDIATEMENT ici (contrôle paresseux, complète le balayage
    //     automatique de src/instrumentation.ts) et l'ancien mot de passe
    //     n'est plus accepté ;
    //   - délai EN COURS => c'est l'ACTIVATION du compte : première connexion
    //     réussie, l'expiration courte est levée (passwordExpiresAt=null,
    //     activatedAt=now) — l'utilisateur devra ensuite définir son propre
    //     mot de passe (mustChangePassword, écran non contournable).
    // ------------------------------------------------------------------
    if (
      user.passwordExpiresAt !== null &&
      new Date(user.passwordExpiresAt).getTime() <= Date.now()
    ) {
      await db.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      await journalAuth({
        evenement: "desactivation-automatique",
        ip,
        email,
        role: user.role,
        detail:
          "Délai d'activation de 15 minutes dépassé (constaté au login) — compte désactivé automatiquement (v0.2.129)",
      });
      return NextResponse.json(
        {
          error:
            "Ce compte a été automatiquement désactivé : le délai de 15 minutes pour l'activer avec le mot de passe initial est dépassé. L'ancien mot de passe n'est plus accepté — contactez le superadministrateur pour recevoir un nouveau mot de passe.",
          code: "COMPTE_EXPIRE_INITIAL",
        },
        { status: 403 }
      );
    }
    if (user.passwordExpiresAt !== null) {
      // ACTIVATION du compte : première connexion réussie dans le délai.
      user = await db.user.update({
        where: { id: user.id },
        data: { activatedAt: new Date(), passwordExpiresAt: null },
      });
    }

    // NOUVEAU (Task 64) : expiration du mot de passe (15 jours, TOUS les comptes).
    // (Point 1) les comptes IT/RH créés ou réinitialisés par le SuperAdmin ont
    // passwordChangedAt ANTIDATÉ → expiration immédiate → écran de changement
    // forcé à la première connexion (aucune autre modification requise ici).
    const expire = isPasswordExpired(user.passwordChangedAt);

    const maxAge = expire
      ? MAX_AGE_MOT_DE_PASSE_EXPIRE // 15 min : uniquement le temps de changer le mot de passe
      : remember
        ? MAX_AGE_LONG
        : MAX_AGE_SHORT;
    const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role as "RH" | "IT" | "SUPERADMIN" }; // (MODIFIÉ Task 34)
    // (CORRECTIF SÉCURITÉ — Task 94) le jeton embarque la VERSION DE SESSION
    // (date du dernier changement de mot de passe) pour la révocation immédiate
    // des sessions antérieures à un changement/réinitialisation.
    const token = createSessionToken(
      sessionUser,
      maxAge,
      user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0
    );

    const res = NextResponse.json({
      user: expire ? { ...sessionUser, mustChangePassword: true } : sessionUser,
      // NOUVEAU (Task 64) : le front affiche l'écran de changement forcé
      mustChangePassword: expire,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge,
      // (MODIFIÉ Task 208) cookie « Secure » automatique derrière un proxy
      // HTTPS (x-forwarded-proto: https) ou forcé par AUTO_RH_FORCE_SECURE_COOKIES=1
      // — en HTTP local il reste false (un cookie Secure n'est JAMAIS envoyé
      // par les navigateurs sur http, la connexion casserait).
      secure:
        (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" ||
        process.env.AUTO_RH_FORCE_SECURE_COOKIES === "1",
    });
    // (Task 208) connexion réussie : journalisée (rôle en clair, jamais le mot de passe).
    await journalAuth({ evenement: "succes", ip, email, role: user.role });
    return res;
  } catch (error) {
    console.error("[LOGIN] Erreur:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la connexion." }, { status: 500 });
  }
}
