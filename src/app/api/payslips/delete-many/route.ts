import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { unlink } from "fs/promises";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
import { resolveStoredFile } from "@/lib/storage-dir";

export const runtime = "nodejs";

/* ==================================================================== */
/* NOUVEAU (Task 29, additif) : SUPPRESSION MULTIPLE des fiches de paie */
/*                                                                      */
/* Demande utilisateur : « Ajouter suppression multiple » dans le       */
/* portail d'administration — cocher plusieurs fiches puis les          */
/* supprimer en UNE action.                                             */
/*                                                                      */
/* POST /api/payslips/delete-many   body : { ids: string[] }            */
/*   - MÊME logique que DELETE /api/payslips/[id] (inchangé) : pour     */
/*     chaque fiche -> suppression en base + suppression du fichier     */
/*     sur disque où qu'il soit (best effort, resolveStoredFile).        */
/*   - Une fiche introuvable ou en échec n'interrompt PAS les autres :  */
/*     le résultat détaille deleted / missing / failed.                 */
/*   - Garde : 1 à 1000 identifiants par appel.                         */
/* ==================================================================== */

/** Nombre maximal de fiches supprimables en un seul appel (sécurité). */
const MAX_IDS_PER_CALL = 1000;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : le rôle IT ne peut pas supprimer de fiches —
  // il n'a de toute façon ni liste ni recherche (garde serveur).
  if (user.role === "IT") return refusIT("la suppression de fiches de paie");

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return NextResponse.json(
      { error: "Liste d'identifiants invalide (ids doit être un tableau non vide)." },
      { status: 400 }
    );
  }
  const uniqueIds = Array.from(new Set(ids as string[]));
  if (uniqueIds.length > MAX_IDS_PER_CALL) {
    return NextResponse.json(
      { error: `Trop de fiches sélectionnées (${uniqueIds.length}) — maximum ${MAX_IDS_PER_CALL} par appel.` },
      { status: 400 }
    );
  }

  let deleted = 0;
  let missing = 0;
  let failed = 0;

  for (const id of uniqueIds) {
    try {
      const record = await db.payslip.findUnique({ where: { id } });
      if (!record) {
        missing += 1;
        continue;
      }
      await db.payslip.delete({ where: { id } });
      deleted += 1;
      // NOUVEAU (Task 244) : suppression de la copie signée FIGÉE de la
      // fiche (best effort — même discipline que le fichier stocké).
      try {
        const { supprimerCopieFigee } = await import("@/lib/copie-signee");
        await supprimerCopieFigee(id);
      } catch {
        // déjà absente — ignorer
      }
      // Suppression du fichier sur disque, où qu'il soit (best effort —
      // MÊME comportement que la suppression unitaire) ; si plusieurs
      // fiches partagent le même fichier (repli historique), le premier
      // unlink réussit, les suivants trouvent un fichier absent : ignoré.
      try {
        const filePath = resolveStoredFile(record.storedName);
        if (filePath) await unlink(filePath);
      } catch {
        // fichier déjà absent — ignorer
      }
    } catch (error) {
      console.error("[DELETE-MANY] Erreur fiche", id, error);
      failed += 1;
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    deleted,
    missing,
    failed,
    message:
      failed === 0
        ? `${deleted} fiche(s) supprimée(s).`
        : `${deleted} fiche(s) supprimée(s), ${failed} échec(s), ${missing} introuvable(s).`,
  });
}
