/**
 * PATCH  /api/users/[id] — activer / désactiver un compte.
 * DELETE /api/users/[id] — supprimer définitivement un compte.
 *
 * (MODIFIÉ Task 34) Réservé au rôle IT ET au superadministrateur :
 * - l'IT conserve ses capacités historiques (non-suppressif) ;
 * - le SUPERADMIN a les mêmes pouvoirs ici, plus des routes dédiées
 *   (/api/users/[id]/password et /api/users/[id]/role) ;
 * - NOUVEAU garde-fou : impossible de désactiver ou supprimer le DERNIER
 *   compte SUPERADMIN actif (sinon plus personne ne peut administrer) ;
 * - impossible d'agir sur son propre compte (déjà en place, conservé).
 *
 * (MODIFIÉ Task 172) : le rôle IT ne pouvait gérer que les comptes IT.
 *
 * (MODIFIÉ Task 173 — « Permissions du rôle IT » + « Rôle RH ») : la
 * gestion des comptes devient SUPERADMINISTRATEUR UNIQUEMENT :
 *  - l'IT ne peut plus créer, modifier, supprimer, activer ni désactiver
 *    AUCUN compte, ni modifier les rôles ou permissions — sa seule
 *    faculté restante est la CONSULTATION de la liste (GET /api/users) ;
 *  - le RH n'a AUCUN droit de gestion des comptes utilisateurs (création,
 *    modification, activation/désactivation, suppression, rôles).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  motDePasseExpire,
  estSuperadmin,
  forbidden,
  forbiddenSuperadmin,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
// NOUVEAU (v0.2.129) : détection « mot de passe initial expiré »
import { desactiveParExpiration } from "@/lib/mot-de-passe-initial";

export const runtime = "nodejs";

/** NOUVEAU (Task 34) : la cible est-elle le dernier superadmin actif ? */
async function estDernierSuperadminActif(idCible: string): Promise<boolean> {
  const cible = await db.user.findUnique({ where: { id: idCible } });
  if (!cible || cible.role !== "SUPERADMIN" || !cible.isActive) return false;
  const nbActifs = await db.user.count({
    where: { role: "SUPERADMIN", isActive: true },
  });
  return nbActifs <= 1;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (me.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 173) : la gestion des comptes est superadministrateur
  // uniquement (contrôle renforcé ci-dessous après la résolution de la cible).
  if (!estSuperadmin(me)) return forbidden();

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const isActive = Boolean(body?.isActive);

  // (MODIFIÉ Task 173) : gestion des comptes — superadministrateur uniquement
  // (l'IT et le RH n'ont AUCUN droit de modification).
  if (!estSuperadmin(me)) return forbiddenSuperadmin();

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }
  if (id === me.id && !isActive) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas désactiver votre propre compte." },
      { status: 400 }
    );
  }
  // NOUVEAU (Task 34) : protège le dernier superadministrateur actif
  if (!isActive && (await estDernierSuperadminActif(id))) {
    return NextResponse.json(
      {
        error:
          "Impossible : ce compte est le dernier superadministrateur actif. Créez ou activez d'abord un autre compte superadministrateur (CREER-SUPERADMIN-WINDOWS.bat).",
      },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------------
  // NOUVEAU (v0.2.129 — demande utilisateur) : le compte dont le délai
  // d'activation de 15 minutes a expiré ne peut PAS être simplement
  // réactivé (l'ancien mot de passe n'est plus accepté) — le SuperAdmin
  // doit passer par la RÉACTIVATION, qui génère un NOUVEAU mot de passe
  // initial unique et l'envoie par e-mail (bouton « Réactiver »).
  // ------------------------------------------------------------------
  if (isActive && desactiveParExpiration(existing)) {
    return NextResponse.json(
      {
        error:
          "Réactivation simple impossible : le délai d'activation de 15 minutes est dépassé et l'ancien mot de passe n'est plus accepté. Utilisez le bouton « Réactiver » pour générer un NOUVEAU mot de passe initial (unique) et l'envoyer par e-mail.",
        code: "REACTIVATION_PAR_NOUVEAU_MDP_OBLIGATOIRE",
      },
      { status: 400 }
    );
  }

  const user = await db.user.update({
    where: { id },
    data: { isActive },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  return NextResponse.json({ user });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (me.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 173) : la gestion des comptes est superadministrateur
  // uniquement (contrôle renforcé ci-dessous après la résolution de la cible).
  if (!estSuperadmin(me)) return forbidden();

  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte." },
      { status: 400 }
    );
  }

  // (MODIFIÉ Task 173) : gestion des comptes — superadministrateur uniquement
  // (l'IT et le RH n'ont AUCUN droit de suppression).
  if (!estSuperadmin(me)) return forbiddenSuperadmin();

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  // NOUVEAU (Task 34) : protège le dernier superadministrateur actif
  if (await estDernierSuperadminActif(id)) {
    return NextResponse.json(
      {
        error:
          "Impossible : ce compte est le dernier superadministrateur actif. Créez d'abord un autre compte superadministrateur (CREER-SUPERADMIN-WINDOWS.bat).",
      },
      { status: 400 }
    );
  }

  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
