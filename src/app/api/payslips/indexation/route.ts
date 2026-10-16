import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
// NOUVEAU (Task 99) : remplissage de l'index de recherche déterministe
// (cinIndex / nomIndex / jetons de contenu) pour les fiches créées AVANT la
// mise à jour — exécuté PAR LOTS, sans bloquer le service.
import { extraireTokensCin, indexCin, indexJeton, indexNom } from "@/lib/payslip-index";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";

export const runtime = "nodejs";

/** Taille d'un lot de fiches indexées par requête. */
const TAILLE_LOT = 100;
/** Budget de temps par requête (ms) : la requête enchaîne les lots puis
 * répond, pour rester très en dessous des délais d'attente HTTP. */
const BUDGET_MS = 8000;

/**
 * POST /api/payslips/indexation
 * Indexe les fiches pas encore indexées (cinIndexedAt null), par lots de
 * 100, dans la limite d'un budget de ~8 s par requête. Répond :
 *   { traites, restants, termine }
 * L'appelant (bouton « Indexer la base » ou script) répète l'appel tant
 * que termine = false. L'opération est IDEMPOTENTE : les fiches déjà
 * indexées ne sont jamais relues ; ré-exécuter ne change rien.
 *
 * (Task 99 — forme « plate » ) Chaque lot :
 *   1. lit 100 fiches non indexées (index cinIndexedAt, SANS tri — trier
 *      240 000 lignes à chaque lot saturait la mémoire de SQLite) ;
 *   2. supprime les jetons de ces fiches (UNE requête) ;
 *   3. insère TOUS les jetons du lot (UNE requête createMany) ;
 *   4. met à jour les colonnes d'index fiche par fiche (autocommit) —
 *      PAS de transaction interactive : à 240 000 fiches, les transactions
 *      imbriquées retenaient des centaines de Mo dans le moteur et
 *      déclenchaient l'OOM du conteneur (mesuré, corrigé).
 */
export async function POST(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : l'indexation sert la recherche par CIN — refusée au rôle IT.
  if (user.role === "IT") return refusIT("l'indexation de la base pour la recherche");
  const debut = Date.now();
  let traites = 0;
  try {
    for (;;) {
      const lot = await db.payslip.findMany({
        where: { cinIndexedAt: null },
        select: { id: true, cin: true, employeeName: true, content: true },
        take: TAILLE_LOT,
      });
      if (lot.length === 0) break;

      const ids = lot.map((f) => f.id);
      // 2) jetons existants supprimés (une seule requête pour le lot) —
      //    idempotent : les fiches non indexées n'en ont normalement pas.
      await db.payslipCinToken.deleteMany({
        where: { payslipId: { in: ids } },
      });
      // 3) tous les jetons du lot en UNE insertion groupée
      const jetons: { payslipId: string; token: string }[] = [];
      for (const fiche of lot) {
        for (const token of extraireTokensCin(
          fiche.content as string | null | undefined
        )) {
          const empreinte = indexJeton(token);
          if (empreinte) jetons.push({ payslipId: fiche.id, token: empreinte });
        }
      }
      if (jetons.length > 0) {
        await db.payslipCinToken.createMany({ data: jetons });
      }
      // 4) colonnes d'index, fiche par fiche (autocommit, mémoire plate)
      for (const fiche of lot) {
        const idx = indexCin(fiche.cin as string | null | undefined);
        await db.payslip.update({
          where: { id: fiche.id },
          data: {
            cinIndex: idx.cinIndex,
            cinIndexedAt: idx.cinIndexedAt,
            nomIndex: indexNom(fiche.employeeName as string | null | undefined),
          },
        });
      }
      traites += lot.length;
      if (Date.now() - debut >= BUDGET_MS) break;
    }

    const restants = await db.payslip.count({ where: { cinIndexedAt: null } });
    return NextResponse.json({
      traites,
      restants,
      termine: restants === 0,
      dureeMs: Date.now() - debut,
    });
  } catch (error) {
    console.error("[INDEXATION] Erreur:", error);
    return NextResponse.json(
      {
        error:
          "Erreur serveur pendant l'indexation. Elle reprendra proprement au prochain appel (opération idempotente).",
        traites,
      },
      { status: 500 }
    );
  }
}

/** GET /api/payslips/indexation — état de l'indexation (sans action). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : l'indexation sert la recherche par CIN — refusée au rôle IT.
  if (user.role === "IT") return refusIT("l'indexation de la base pour la recherche");
  try {
    const restants = await db.payslip.count({ where: { cinIndexedAt: null } });
    return NextResponse.json({ restants, termine: restants === 0 });
  } catch (error) {
    console.error("[INDEXATION/ETAT] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la lecture de l'état d'indexation." },
      { status: 500 }
    );
  }
}
