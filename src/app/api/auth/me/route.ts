/**
 * GET /api/auth/me — informations de l'utilisateur connecté.
 * Répond 401 si la session est absente, expirée ou si le compte a été désactivé.
 */
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Non connecté." }, { status: 401 });
  }
  return Response.json({ user });
}
