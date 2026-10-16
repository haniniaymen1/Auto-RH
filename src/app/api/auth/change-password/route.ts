/**
 * POST /api/auth/change-password — changement du mot de passe PROPRE au compte connecté.
 *
 * NOUVEAU (Task 64) — politique d'expiration 15 jours, TOUS les comptes
 * (RH, IT, superadministrateur) :
 *   - accessible même quand le mot de passe est expiré (c'est la SEULE action
 *     autorisée avec /api/auth/me et /api/auth/logout dans ce cas) ;
 *   - vérifie le mot de passe ACTUEL (jamais de changement sans preuve
 *     d'identité) ;
 *   - le nouveau mot de passe doit être différent de l'actuel (≥ 8 caractères) ;
 *   - met passwordChangedAt à NOW → le compteur des 15 jours repart de zéro ;
 *   - (MODIFIÉ Task 94) une NOUVELLE session est émise dans la réponse
 *     (rotation de session) : toutes les sessions antérieures sont invalidées
 *     immédiatement, et la session courante reste fluide pour l'interface.
 *
 * NOUVEAU (v0.2.129) : le nouveau mot de passe personnel est enregistré dans
 * l'HISTORIQUE du compte (PasswordHistory) — le SuperAdmin ne pourra jamais
 * réattribuer un mot de passe déjà choisi par l'utilisateur, et le nouvel
 * historique alimente le contrôle d'unicité des futures attributions.
 *
 * Body : { currentPassword: string, newPassword: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSessionToken,
  getSessionUser,
  hashPassword,
  MAX_AGE_SHORT,
  SESSION_COOKIE,
  unauthorized,
  verifyPassword,
} from "@/lib/auth";
import { erreurPolitiqueMotDePasse, isPasswordExpired } from "@/lib/password-policy";
// NOUVEAU (v0.2.129) : historique des mots de passe (non-réutilisation)
import { estMotDePasseInedit } from "@/lib/mot-de-passe-initial";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  try {
    const body = await request.json().catch(() => null);
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Veuillez saisir votre mot de passe actuel et le nouveau mot de passe." },
        { status: 400 }
      );
    }

    // 1) Le compte doit toujours exister et rester actif
    const user = await db.user.findUnique({ where: { id: me.id } });
    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: "Compte introuvable ou désactivé." },
        { status: 403 }
      );
    }

    // 2) Vérification du mot de passe ACTUEL (obligatoire, sans exception)
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json(
        { error: "Mot de passe actuel incorrect." },
        { status: 401 }
      );
    }

    // 3) Validation du nouveau mot de passe
    // (MODIFIÉ — politique de complexité) : 8 caractères minimum, avec
    // minuscule + majuscule + chiffre + symbole (src/lib/password-policy.ts).
    const erreurPolitique = erreurPolitiqueMotDePasse(newPassword);
    if (erreurPolitique) {
      return NextResponse.json({ error: erreurPolitique }, { status: 400 });
    }
    if (newPassword.length > 200) {
      return NextResponse.json(
        { error: "Mot de passe trop long (200 caractères maximum)." },
        { status: 400 }
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "Le nouveau mot de passe doit être DIFFÉRENT du mot de passe actuel." },
        { status: 400 }
      );
    }
    if (
      user.email &&
      newPassword.trim().toLowerCase() === String(user.email).split("@")[0].trim().toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Le nouveau mot de passe ne doit pas reprendre votre identifiant." },
        { status: 400 }
      );
    }
    // NOUVEAU (v0.2.129) : le nouveau mot de passe doit être différent de tous
    // les mots de passe précédemment attribués au compte (initial du
    // SuperAdmin, réinitialisations, choix personnels antérieurs).
    if (!(await estMotDePasseInedit(newPassword, user.id))) {
      return NextResponse.json(
        {
          error:
            "Ce mot de passe a déjà été utilisé pour ce compte : choisissez-en un différent.",
          code: "MOT_DE_PASSE_DEJA_UTILISE",
        },
        { status: 400 }
      );
    }

    // 4) Changement : nouveau hash + compteur des 15 jours remis à zéro
    const dateChangement = new Date();
    const nouveauHash = hashPassword(newPassword);
    await db.user.update({
      where: { id: me.id },
      data: {
        passwordHash: nouveauHash,
        // (Point 1) le changement repart sur 15 jours PLEINS : le forçage de
        // première connexion (IT/RH) s'éteint mécaniquement — la réponse
        // ci-dessous porte déjà mustChangePassword:false.
        passwordChangedAt: dateChangement,
        // (v0.2.129) sécurité : lève toute expiration courte restante
        passwordExpiresAt: null,
      },
    });
    // NOUVEAU (v0.2.129) : historise le mot de passe personnel choisi.
    await db.passwordHistory.create({
      data: { userId: me.id, hash: nouveauHash },
    });

    // (CORRECTIF SÉCURITÉ — Task 94) ROTATION DE SESSION : une NOUVELLE session
    // (nouvelle version pwv) est émise dans la réponse. Toutes les sessions
    // antérieures — émises avant le changement — deviennent inutilisables :
    // un cookie volé ne survit plus à un changement de mot de passe.
    const res = NextResponse.json({
      ok: true,
      message: "Mot de passe changé avec succès. Il sera à nouveau à changer dans 15 jours.",
      mustChangePassword: false,
    });
    res.cookies.set(SESSION_COOKIE, createSessionToken(me, MAX_AGE_SHORT, dateChangement.getTime()), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SHORT,
      secure: false, // site en http local ; passer à true derrière un proxy HTTPS
    });
    return res;
  } catch (error) {
    console.error("[CHANGE-PASSWORD] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors du changement de mot de passe." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/change-password — état du mot de passe du compte connecté.
 * Pratique pour l'interface (bandeau d'expiration, jours restants).
 */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { passwordChangedAt: true },
  });
  return Response.json({
    mustChangePassword: me.mustChangePassword === true,
    expired: isPasswordExpired(user?.passwordChangedAt),
    passwordChangedAt: user?.passwordChangedAt ?? null,
    maxAgeDays: 15,
  });
}
