/**
 * NOUVEAU (Task 34) : POST /api/users/[id]/role
 * Change le rôle d'un compte RH ↔ IT — RÉSERVÉ AU SUPERADMINISTRATEUR.
 * Body : { role: "RH" | "IT" }.
 *
 * Garde-fous :
 * - les comptes SUPERADMIN ne sont PAS modifiables ici (passage au
 *   superadministration ou retour RH/IT uniquement via le script
 *   scripts/creer-superadmin.js — décision volontairement verrouillée) ;
 * - impossible de changer son propre rôle (évite de se retirer les droits
 *   superadmin par accident) ;
 * - le rôle « SUPERADMIN » n'est pas attribuable via cette route.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  motDePasseExpire,
  estSuperadmin,
  forbiddenSuperadmin,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";

export const runtime = "nodejs";

const ROLES_ATTRIBUABLES = ["RH", "IT"] as const;

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
  const role = String(body?.role ?? "").trim().toUpperCase();

  if (!(ROLES_ATTRIBUABLES as readonly string[]).includes(role)) {
    return NextResponse.json(
      { error: "Rôle invalide : choisissez « RH » ou « IT »." },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }
  if (id === me.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas changer le rôle de votre propre compte." },
      { status: 400 }
    );
  }
  if (existing.role === "SUPERADMIN") {
    return NextResponse.json(
      {
        error:
          "Le rôle d'un compte superadministrateur ne se change pas ici : utilisez le script CREER-SUPERADMIN-WINDOWS.bat (option dédiée) après avoir créé un autre superadministrateur.",
      },
      { status: 400 }
    );
  }
  if (existing.role === role) {
    return NextResponse.json(
      { error: `Ce compte est déjà ${role === "IT" ? "informatique (IT)" : "RH"}.` },
      { status: 400 }
    );
  }

  const user = await db.user.update({
    where: { id },
    data: { role },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  return NextResponse.json({
    user,
    message: `Rôle mis à jour : ${user.name} est désormais ${role === "IT" ? "informatique (IT)" : "RH"}.`,
  });
}
