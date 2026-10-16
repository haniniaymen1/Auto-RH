/**
 * ============================================================================
 *  NOUVEAU (v0.2.129 — demande utilisateur) — FLAG « MANAGER » D'UN COMPTE
 * ============================================================================
 *  POST /api/users/[id]/manager — RÉSERVÉ AU SUPERADMINISTRATEUR.
 *
 *  Complète la case à cocher « Manager » du formulaire de création : permet
 *  aussi de marquer / démarquer un compte EXISTANT comme « Manager » (il
 *  apparaît alors automatiquement dans la liste déroulante « Manager
 *  responsable » des prochains comptes créés — « la liste déroulante doit se
 *  remplir automatiquement au fur et à mesure que les managers sont
 *  sélectionnés via la case à cocher »).
 *
 *  Body : { isManager: boolean, managerId?: string | null }
 *   - isManager  : coche/décoche le statut « Manager » du compte ;
 *   - managerId  : (optionnel) change le manager responsable du compte
 *                  (doit être un compte actif ; null = aucun).
 * ============================================================================
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  if (me.mustChangePassword) return motDePasseExpire();
  if (!estSuperadmin(me)) return forbiddenSuperadmin();

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const cible = await db.user.findUnique({ where: { id } });
  if (!cible) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const data: { isManager?: boolean; managerId?: string | null } = {};

  // 1) Basculer le statut « Manager » (case à cocher).
  if (body && "isManager" in body) {
    data.isManager = Boolean(body.isManager);
  }

  // 2) (Optionnel) changer le manager responsable du compte.
  if (body && "managerId" in body) {
    const brut = String(body.managerId ?? "").trim();
    if (!brut) {
      data.managerId = null;
    } else if (brut === id) {
      return NextResponse.json(
        { error: "Un compte ne peut pas être son propre manager responsable." },
        { status: 400 }
      );
    } else {
      const manager = await db.user.findUnique({ where: { id: brut } });
      if (!manager || !manager.isActive) {
        return NextResponse.json(
          { error: "Manager responsable introuvable ou désactivé." },
          { status: 400 }
        );
      }
      data.managerId = manager.id;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Aucune modification demandée (isManager / managerId attendus)." },
      { status: 400 }
    );
  }

  const user = await db.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      isManager: true,
      managerId: true,
      manager: { select: { id: true, name: true, email: true } },
    },
  });
  return NextResponse.json({
    user,
    message: data.isManager === true
      ? `${user.name} est désormais un manager : le compte apparaît dans la liste déroulante « Manager responsable » du formulaire de création.`
      : data.isManager === false
        ? `${user.name} n'est plus marqué « Manager » (retiré de la liste déroulante).`
        : "Manager responsable mis à jour.",
  });
}
