import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeQuery, isExactCinInContent } from "@/lib/payslip-extractor";
// NOUVEAU (Task 99) : index de recherche déterministe (pagination serveur +
// recherche CIN côté serveur sur de gros volumes, jusqu'à 240 000 fiches).
import { indexJeton, normaliserCin } from "@/lib/payslip-index";
import { chiffrerChamp } from "@/lib/db-crypto";
import {
  motDePasseExpire,
  refusIT,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";

export const runtime = "nodejs";

export interface PayslipListItem {
  id: string;
  fileName: string;
  fileSize: number;
  cin: string | null;
  employeeName: string | null;
  period: string | null;
  netSalary: string | null;
  matricule: string | null;
  pageNumber: number;
  uploadedAt: string;
  snippet: string | null;
  matchedBy: "cin_content" | "cin_detected" | "none";
  // NOUVEAU (v0.2.50) : anomalies nom/prénom détectées à l'import (null = aucune)
  anomalieNom: string | null;
}

/* ------------------------------------------------------------------ */
/* (Task 99) Paramètres de pagination                                  */
/* ------------------------------------------------------------------ */
/** Limite PAR DÉFAUT : 100 fiches par page (demande administrateur). */
const LIMITE_DEFAUT = 100;
/** Plafond de sécurité : une page ne peut pas dépasser 1 000 fiches. */
const LIMITE_MAX = 1000;
/**
 * Plafond du REPLI par déchiffrement : au-delà de ce nombre de lignes à
 * déchiffrer, la recherche renvoie une instruction d'indexation (409) au
 * lieu de dégrader le serveur — c'est la protection qui garantit que la
 * « charge complète » de l'ancien algorithme ne peut plus revenir.
 */
const PLAFOND_DECHIFFREMENT = 20000;
/** Volume total au-delà duquel une requête trop courte est refusée. */
const SEUIL_COURT = 50000;

type LignePayslip = {
  id: string;
  fileName: unknown;
  fileSize: number;
  cin: unknown;
  employeeName: unknown;
  period: unknown;
  netSalary: unknown;
  matricule: unknown;
  pageNumber: number;
  uploadedAt: Date;
  content: unknown;
  normalizedContent: unknown;
  anomalieNom: unknown;
};

/** Champs de la LISTE (sans content/normalizedContent : colonnes lourdes). */
const CHAMPS_LISTE = {
  id: true,
  fileName: true,
  fileSize: true,
  cin: true,
  employeeName: true,
  period: true,
  netSalary: true,
  matricule: true,
  pageNumber: true,
  uploadedAt: true,
  anomalieNom: true, // (v0.2.50) pastille ⚠ incohérence nom/prénom
} as const;

/** Colonnes complètes nécessaires au filtre exact de la recherche. */
const CHAMPS_RECHERCHE = {
  id: true,
  fileName: true,
  fileSize: true,
  cin: true,
  employeeName: true,
  period: true,
  netSalary: true,
  matricule: true,
  pageNumber: true,
  uploadedAt: true,
  content: true,
  normalizedContent: true,
  anomalieNom: true, // (v0.2.50) pastille ⚠ incohérence nom/prénom
} as const;

/** Tri stable : uploadedAt DESC puis id DESC (les imports simultanés
 * partagent la même seconde — le second critère fige l'ordre des pages).
 *
 * (CORRECTIF v0.2.201) : le type `as const` rendait la constante `readonly`
 * — Prisma attend un tableau MUTABLE `PayslipOrderByWithRelationInput[]`.
 * On enlève `as const` et on type explicitement comme un tableau de unions
 * d'objets (uploadedAt OU id, pas un type union des DEUX à la fois). */
type CritereTri = { uploadedAt: "desc" } | { id: "desc" };
const TRI_STABLE: CritereTri[] = [
  { uploadedAt: "desc" },
  { id: "desc" },
];

function versItem(r: Record<string, unknown>): PayslipListItem {
  return {
    id: r.id as string,
    fileName: String(r.fileName ?? ""),
    fileSize: Number(r.fileSize ?? 0),
    cin: (r.cin as string | null) ?? null,
    employeeName: (r.employeeName as string | null) ?? null,
    period: (r.period as string | null) ?? null,
    netSalary: (r.netSalary as string | null) ?? null,
    matricule: (r.matricule as string | null) ?? null,
    pageNumber: Number(r.pageNumber ?? 1),
    uploadedAt: (r.uploadedAt as Date).toISOString(),
    // (Task 36, à la demande de l'administrateur) AUCUN extrait du contenu
    // des bulletins dans la réponse : snippet conservé à null pour
    // compatibilité de forme API.
    snippet: null,
    matchedBy: "none",
    // (v0.2.50) texte des anomalies nom/prénom (déjà déchiffré par le middleware)
    anomalieNom: (r.anomalieNom as string | null) ?? null,
  };
}

/**
 * GET /api/payslips?cin=XXXXXXXX&page=1&limit=100
 *
 * (REFONDU Task 99 — pagination serveur + recherche CIN côté serveur)
 *  - Sans `cin`  : page de la liste complète — page (défaut 1), limit
 *    (défaut 100, plafond 1000). Répond des MÉTADONNÉES de pagination
 *    (total, page, totalPages, hasMore) ; l'ancien paramètre `offset`
 *    reste honoré quand `page` est absent (rétrocompatibilité).
 *  - Avec `cin`  : recherche EXACTE du CIN SUR TOUTES LES FICHES (pas
 *    seulement la page affichée) :
 *      1. pré-filtre SQL via l'index déterministe (cinIndex + jetons de
 *         contenu chiffrés — voir src/lib/payslip-index.ts) : quelques
 *         lignes candidates quel que soit le volume ;
 *      2. les candidates sont déchiffrées puis ré-évaluées avec la MÊME
 *         règle exacte qu'avant (numéro COMPLET et IDENTIQUE, tolérance
 *         des espaces/points/tirets/slashs d'extraction) — résultat
 *         IDENTIQUE à l'ancien algorithme ;
 *      3. les fiches pas encore indexées (cinIndexedAt null) sont
 *         évaluées par le chemin historique (déchiffrement), dans la
 *         limite du plafond PLAFOND_DECHIFFREMENT — au-delà, la réponse
 *         409 invite à lancer l'indexation (POST /api/payslips/indexation
 *         ou bouton « Indexer la base »).
 *    Une requête de moins de 6 caractères sur une base volumineuse
 *    (> SEUIL_COURT fiches) est refusée 400 avec un message explicite :
 *    un pré-filtre par jetons de 3 à 5 caractères serait trop large.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (user.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : le rôle IT n'a NI la recherche par CIN NI la liste
  // « Toutes les fiches » — garde serveur (les onglets sont aussi masqués).
  if (user.role === "IT") return refusIT("la recherche par CIN et la consultation des fiches");
  try {
    const { searchParams } = new URL(request.url);
    const cin = searchParams.get("cin")?.trim() ?? "";

    // ---- Paramètres de pagination (Task 99) ----
    const pageParam = parseInt(searchParams.get("page") ?? "", 10);
    const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
    const offsetParam = parseInt(searchParams.get("offset") ?? "", 10);
    const limite = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, LIMITE_MAX)
      : LIMITE_DEFAUT;
    // Rétrocompatibilité : offset explicite sans page → même découpage.
    const skip =
      Number.isFinite(pageParam) && pageParam > 0
        ? (pageParam - 1) * limite
        : Number.isFinite(offsetParam) && offsetParam > 0
          ? offsetParam
          : 0;
    const page = Math.floor(skip / limite) + 1;

    // ---- MODE RECHERCHE EXACTE PAR CIN (dans le contenu) ----
    if (cin) {
      const q = normalizeQuery(cin);

      if (q.length < 3) {
        return NextResponse.json(
          { error: "Veuillez saisir le numéro de CIN complet (au moins 3 caractères)." },
          { status: 400 }
        );
      }

      const totalFiches = await db.payslip.count();
      if (q.length < 6 && totalFiches > SEUIL_COURT) {
        return NextResponse.json(
          {
            error:
              "Requête trop courte pour interroger " +
              totalFiches.toLocaleString("fr-FR") +
              " fiches : saisissez le numéro de CIN COMPLET (au moins 6 caractères). " +
              "La recherche analyse une base volumineuse — un fragment de 3 à 5 caractères " +
              "correspondrait à trop de numéros (montants, dates, matricules) pour rester fiable.",
          },
          { status: 400 }
        );
      }

      // 1) PRÉ-FILTRE SQL par l'index déterministe — quelques candidates
      //    quel que soit le volume (index B-tree sur valeurs chiffrées).
      const emp = chiffrerChamp(q, true) as string;
      const whereIndexe = {
        OR: [{ cinIndex: emp }, { cinTokens: { some: { token: emp } } }],
      };

      // 2) Fiches NON indexées (cinIndexedAt null) → chemin historique par
      //    déchiffrement, plafonné (protection de charge).
      const restants = await db.payslip.count({
        where: { cinIndexedAt: null },
      });
      if (restants > PLAFOND_DECHIFFREMENT) {
        return NextResponse.json(
          {
            error:
              "Recherche momentanément indisponible : " +
              restants.toLocaleString("fr-FR") +
              " fiche(s) ne sont pas encore indexées pour la recherche rapide " +
              "(base volumineuse). Lancez l'indexation : bouton « Indexer la base " +
              "pour la recherche » (onglet Toutes les fiches) ou " +
              "POST /api/payslips/indexation. Aucune donnée n'est perdue — " +
              "l'indexation s'exécute en arrière-plan, par lots, sans arrêt de service.",
            indexationRequise: true,
            restants,
          },
          { status: 409 }
        );
      }
      const nonIndexees =
        restants > 0
          ? await db.payslip.findMany({
              where: { cinIndexedAt: null },
              orderBy: TRI_STABLE,
              select: CHAMPS_RECHERCHE,
            })
          : [];

      // 3) Candidates indexées : déchiffrées par le middleware, puis
      //    ré-évaluées avec la RÈGLE EXACTE historique (parité totale).
      //    Le pré-filtre SQL n'en ramène que quelques lignes (égalité sur
      //    empreinte déterministe indexée), quel que soit le volume.
      const candidates = await db.payslip.findMany({
        where: whereIndexe,
        orderBy: TRI_STABLE,
        select: CHAMPS_RECHERCHE,
      });

      // Règle EXACTE (inchangée depuis Task 32 / correctif « l'employé ne
      // voit pas sa fiche ») : le CIN doit être un numéro COMPLET et
      // IDENTIQUE — soit le champ cin normalisé égal, soit présent tel quel
      // dans le contenu — avec le pré-filtre normalizedContent.includes(q).
      const regleExacte = (r: Record<string, unknown>): boolean => {
        const contenuNormalise = String(r.normalizedContent ?? "");
        if (!contenuNormalise.includes(q)) return false;
        const cinChamp = r.cin ? normaliserCin(r.cin as string) : "";
        return cinChamp === q || isExactCinInContent(String(r.content ?? ""), q);
      };

      const fusion = new Map<string, Record<string, unknown>>();
      for (const r of candidates) {
        if (regleExacte(r as unknown as Record<string, unknown>))
          fusion.set((r as unknown as LignePayslip).id, r as unknown as Record<string, unknown>);
      }
      for (const r of nonIndexees) {
        if (regleExacte(r as unknown as Record<string, unknown>))
          fusion.set((r as unknown as LignePayslip).id, r as unknown as Record<string, unknown>);
      }

      // Tri stable + pagination SERVEUR des résultats.
      const trouves = Array.from(fusion.values()).sort((a, b) => {
        const da = (a.uploadedAt as Date).getTime();
        const dbb = (b.uploadedAt as Date).getTime();
        if (da !== dbb) return dbb - da;
        return String(b.id).localeCompare(String(a.id));
      });
      const total = trouves.length;
      const totalPages = Math.max(1, Math.ceil(total / limite));
      const pageItems = trouves.slice(skip, skip + limite);

      const items: PayslipListItem[] = pageItems.map((r) => ({
        id: r.id as string,
        fileName: String(r.fileName ?? ""),
        fileSize: Number(r.fileSize ?? 0),
        cin: (r.cin as string | null) ?? null,
        employeeName: (r.employeeName as string | null) ?? null,
        period: (r.period as string | null) ?? null,
        netSalary: (r.netSalary as string | null) ?? null,
        matricule: (r.matricule as string | null) ?? null,
        pageNumber: Number(r.pageNumber ?? 1),
        uploadedAt: (r.uploadedAt as Date).toISOString(),
        // (Task 36) snippet supprimé : aucune donnée issue du contenu dans
        // la réponse ; la recherche analyse toujours le contenu intégral.
        snippet: null,
        matchedBy: "cin_content",
        // (v0.2.50) texte des anomalies nom/prénom (déchiffré par le middleware)
        anomalieNom: (r.anomalieNom as string | null) ?? null,
      }));

      return NextResponse.json({
        mode: "search",
        exact: true,
        query: cin.trim().toUpperCase(),
        total,
        page,
        limit: limite,
        totalPages,
        hasMore: skip + limite < total,
        // (Task 99) transparence : combien de fiches restent à indexer pour
        // que la recherche passe entièrement par l'index SQL rapide.
        indexation: { restants },
        items,
      });
    }

    // ---- MODE LISTE PAGINÉE (Task 99) ----
    // Page de 100 fiches par défaut : seules les colonnes affichées sont
    // lues (les contenus chiffrés, lourds, ne quittent JAMAIS la base) et
    // le comptage exact est effectué en parallèle.
    const [rows, total] = await Promise.all([
      db.payslip.findMany({
        orderBy: TRI_STABLE,
        take: limite,
        skip,
        select: CHAMPS_LISTE,
      }),
      db.payslip.count(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limite));

    const items: PayslipListItem[] = rows.map((r) =>
      versItem(r as unknown as Record<string, unknown>)
    );

    return NextResponse.json({
      mode: "list",
      total,
      page,
      limit: limite,
      totalPages,
      hasMore: skip + limite < total,
      items,
    });
  } catch (error) {
    console.error("[LIST/SEARCH] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur lors de la recherche des fiches de paie." },
      { status: 500 }
    );
  }
}
