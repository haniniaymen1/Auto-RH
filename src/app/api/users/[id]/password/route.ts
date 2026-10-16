/**
 * NOUVEAU (Task 34) : POST /api/users/[id]/password
 * Réinitialise le mot de passe d'un compte — RÉSERVÉ AU SUPERADMINISTRATEUR.
 * Body : { password: string } (politique de complexité : 8 caractères minimum,
 * avec minuscule + majuscule + chiffre + symbole — src/lib/password-policy.ts).
 * Le mot de passe est haché avec le MÊME schéma scrypt que l'inscription
 * (format « scrypt:salt:hash ») — voir hashPassword() de src/lib/auth.ts.
 * Utilité : compte bloqué, mot de passe oublié, départ d'un employé.
 *
 * NOUVEAU (v0.2.129 — demande utilisateur) :
 *  - NON-RÉUTILISATION : le mot de passe saisi doit être DIFFÉRENT de tous
 *    les mots de passe précédemment attribués à ce compte (hash actuel +
 *    historique PasswordHistory) — « le SuperAdmin ne doit pas pouvoir
 *    réutiliser un ancien mot de passe pour ce même compte » ;
 *  - le nouveau hash est enregistré dans l'historique du compte ;
 *  - pour un compte IT/RH, le mot de passe réinitialisé redevient un MOT DE
 *    PASSE INITIAL soumis au délai de 15 minutes (passwordExpiresAt =
 *    now + 15 min, activatedAt = null) : passé ce délai sans connexion, le
 *    compte est automatiquement désactivé et devra être réactivé (bouton
 *    « Réactiver » = nouveau mot de passe unique envoyé par e-mail).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  motDePasseExpire,
  estSuperadmin,
  forbiddenSuperadmin,
  getSessionUser,
  hashPassword,
  unauthorized,
} from "@/lib/auth";
import { erreurPolitiqueMotDePasse, PASSWORD_MAX_AGE_DAYS } from "@/lib/password-policy";
// NOUVEAU (v0.2.129) : unicité vs historique + validité 15 min du mot de passe initial
import {
  estMotDePasseInedit,
  expirationInitialeDepuisMaintenant,
} from "@/lib/mot-de-passe-initial";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (me.mustChangePassword) return motDePasseExpire();
  if (!estSuperadmin(me)) return forbiddenSuperadmin();

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? "");

  // (MODIFIÉ — politique de complexité) : 8 caractères minimum, avec
  // minuscule + majuscule + chiffre + symbole (src/lib/password-policy.ts).
  const erreurPolitique = erreurPolitiqueMotDePasse(password);
  if (erreurPolitique) {
    return NextResponse.json({ error: erreurPolitique }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json(
      { error: "Mot de passe trop long (200 caractères maximum)." },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  // ------------------------------------------------------------------
  // NOUVEAU (v0.2.129 — demande utilisateur) : NON-RÉUTILISATION — le mot
  // de passe saisi doit être différent de TOUS les mots de passe déjà
  // attribués à ce compte (mot de passe actuel inclus).
  // ------------------------------------------------------------------
  if (!(await estMotDePasseInedit(password, existing.id))) {
    return NextResponse.json(
      {
        error:
          "Mot de passe refusé : il a déjà été attribué à ce compte. Le SuperAdmin ne peut pas réutiliser un ancien mot de passe — choisissez-en un différent.",
        code: "MOT_DE_PASSE_DEJA_UTILISE",
      },
      { status: 400 }
    );
  }

  const estCompteInitial = existing.role === "IT" || existing.role === "RH";
  const nouveauHash = hashPassword(password);

  // (MODIFIÉ Task 64) : la réinitialisation définit AUSSI passwordChangedAt =
  // NOW → le nouveau mot de passe repart pour 15 jours complets. La personne
  // concernée devra donc le re-changer dans 15 jours (politique uniforme).
  // (MODIFIÉ — demande utilisateur, point 1) : pour un compte IT ou RH, le
  // mot de passe posé par le SuperAdmin est PROVISOIRE — OBLIGATOIREMENT
  // changé à la prochaine connexion. Mécanisme : passwordChangedAt est
  // ANTIDATÉ au-delà des 15 jours → mustChangePassword=true au login suivant
  // (écran de changement non contournable + toutes les autres API en 403
  // tant que l'utilisateur n'a pas défini son propre mot de passe).
  // (MODIFIÉ v0.2.129) : pour un compte IT/RH, le mot de passe réinitialisé
  // redevient un MOT DE PASSE INITIAL VALABLE 15 MINUTES (passwordExpiresAt,
  // activatedAt=null) — sans connexion dans le délai : désactivation
  // automatique (balayage + contrôle au login), réactivation par le
  // SuperAdmin uniquement (nouveau mot de passe unique par e-mail).
  await db.user.update({
    where: { id },
    data: {
      passwordHash: nouveauHash,
      passwordChangedAt: estCompteInitial
        ? new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000)
        : new Date(),
      ...(estCompteInitial
        ? {
            passwordExpiresAt: expirationInitialeDepuisMaintenant(),
            activatedAt: null,
            isActive: true,
          }
        : {}),
    },
  });

  // NOUVEAU (v0.2.129) : le mot de passe réinitialisé entre dans l'HISTOIRE
  // du compte (il ne pourra plus jamais être réattribué).
  await db.passwordHistory.create({
    data: { userId: existing.id, hash: nouveauHash },
  });

  return NextResponse.json({
    ok: true,
    message:
      `Mot de passe réinitialisé pour ${existing.name} — l'ancien mot de passe ne fonctionne plus.` +
      (estCompteInitial
        ? " Ce mot de passe initial est VALABLE 15 MINUTES : sans connexion dans ce délai, le compte sera automatiquement désactivé. Il devra choisir son propre mot de passe à la première connexion."
        : ""),
  });
}
