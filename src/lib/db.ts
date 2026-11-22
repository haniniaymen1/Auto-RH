import { PrismaClient } from '@prisma/client'
import {
  CARTE_CHAMPS,
  chiffrerObjet,
  dechiffrerObjet,
  chiffrerWhere,
} from '@/lib/db-crypto'
// NOUVEAU (Task 99) : index de recherche déterministe (pagination serveur +
// recherche CIN côté serveur sur de gros volumes). Chaque écriture de fiche
// (création, mise à jour, redétection) alimente automatiquement cinIndex /
// nomIndex / cinTokens — aucune route d'écriture à modifier.
import {
  extraireTokensCin,
  indexCin,
  indexJeton,
  indexNom,
} from '@/lib/payslip-index'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// (Task 99) log: ['query'] RETIRÉ : en production, journaliser chaque
// requête (dont les 240 000 mises à jour d'indexation) sature la mémoire
// et les journaux pour aucun bénéfice — les erreurs restent journalisées.
const prismaBase =
  globalForPrisma.prisma ??
  new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaBase

/* ------------------------------------------------------------------ */
/* NOUVEAU (Task 32) — CHIFFREMENT TRANSPARENT DES CHAMPS SENSIBLES    */
/* ------------------------------------------------------------------ */
/*
 * Le fichier db/custom.db est une base SQLite lisible en clair (CIN, noms,
 * net à payer, texte intégral des fiches, secrets TOTP, emails…). Grâce à
 * ce middleware, TOUTES les routes d'administration chiffrent les champs
 * sensibles à l'écriture et déchiffrent à la lecture — sans modifier les
 * routes elles-mêmes (voir src/lib/db-crypto.ts pour l'algorithme et la
 * liste exacte des champs chiffrés par modèle).
 *
 * - Écritures (create / update / upsert / createMany) : champs chiffrés ;
 * - Lectures (findUnique / findFirst / findMany / delete / delete) : champs
 *   déchiffrés — les valeurs SANS préfixe (lignes historiques pas encore
 *   migrées par scripts/chiffrer-base.js) restent renvoyées telles quelles ;
 * - Recherches par égalité sur les champs DÉTERMINISTES (PortalAccess.cin,
 *   User.email) : la clause `where` est chiffrée de la même façon → les
 *   findUnique(where: { cin }) / (where: { email }) continuent de fonctionner.
 *
 * Zéro changement de schéma, zéro migration Prisma : 100 % additif.
 */

const OPS_LECTURE_UNIQUE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'update',
  'upsert',
  'delete',
])

const OPS_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'delete',
  'deleteMany',
  'updateMany',
])

/* ------------------------------------------------------------------ */
/* NOUVEAU (Task 99) — injection de l'index de recherche déterministe   */
/* ------------------------------------------------------------------ */
/**
 * Alimente cinIndex / nomIndex / cinTokens à partir des valeurs EN CLAIR
 * d'une écriture Payslip (create / update / upsert), AVANT le chiffrement
 * aléatoire habituel. Appelée automatiquement par le middleware : toute
 * fiche créée ou mise à jour (import, redétection, correction…) est
 * indexée sans qu'aucune route ne change.
 *
 * - « cin » présent        → cinIndex (déterministe) + cinIndexedAt ;
 *   cinIndexedAt est posé même si le CIN est null/vide : la fiche est
 *   considérée indexée (elle ne repartira pas dans le repli de
 *   déchiffrement des recherches).
 * - « employeeName » présent → nomIndex (déterministe, statistiques).
 * - « content » présent    → jetons de contenu régénérés (remplacement
 *   complet sur update, création simple sur create).
 */
function injecterIndexPayslip(
  donnees: Record<string, unknown>,
  remplacementJetons: boolean
): void {
  if ("cin" in donnees) {
    const idx = indexCin(donnees.cin as string | null | undefined);
    donnees.cinIndex = idx.cinIndex;
    donnees.cinIndexedAt = idx.cinIndexedAt;
  }
  if ("employeeName" in donnees) {
    donnees.nomIndex = indexNom(
      donnees.employeeName as string | null | undefined
    );
  }
  if ("content" in donnees) {
    const jetons = extraireTokensCin(
      donnees.content as string | null | undefined
    ).map((token) => ({ token: indexJeton(token) as string }));
    donnees.cinTokens = remplacementJetons
      ? { deleteMany: {}, create: jetons }
      : { create: jetons };
  }
}

export const db = prismaBase.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const carte = model ? CARTE_CHAMPS[model] : undefined
        if (!carte) return query(args as never)

        type Args = Record<string, unknown>
        let a: Args = (args as Args) ?? {}

        // 1) Écritures : chiffrement des champs sensibles
        if (operation === 'upsert') {
          a = { ...a }
          if (a.where) {
            a.where = chiffrerWhere(model as string, a.where as Args)
          }
          if (a.create) {
            // (Task 99) index déterministe injecté AVANT chiffrement
            // (UNIQUEMENT Payslip : PortalAccess possède aussi un champ cin)
            if (model === 'Payslip') {
              injecterIndexPayslip(a.create as Args, false)
            }
            a.create = chiffrerObjet(model as string, a.create as Args)
          }
          if (a.update) {
            if (model === 'Payslip') {
              injecterIndexPayslip(a.update as Args, true)
            }
            a.update = chiffrerObjet(model as string, a.update as Args)
          }
        } else if (operation === 'create' || operation === 'update') {
          a = { ...a }
          if (a.where) {
            a.where = chiffrerWhere(model as string, a.where as Args)
          }
          if (a.data) {
            // (Task 99) index déterministe injecté AVANT chiffrement
            if (model === 'Payslip') {
              injecterIndexPayslip(
                a.data as Args,
                operation === 'update'
              )
            }
            a.data = chiffrerObjet(model as string, a.data as Args)
          }
        } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
          if (a.data) {
            const d = a.data as unknown
            const liste = Array.isArray(d) ? d : [d]
            a = {
              ...a,
              data: liste.map((x) =>
                chiffrerObjet(model as string, x as Args)
              ) as unknown,
            }
          }
        } else if (OPS_WHERE.has(operation)) {
          // 2) Lectures/comptages : where par égalité sur champ déterministe
          if (a.where) {
            a = { ...a, where: chiffrerWhere(model as string, a.where as Args) }
          }
        }

        // 3) Exécution
        const resultat = await query(a as never)

        // 4) Déchiffrement des résultats lisibles (lignes)
        if (OPS_LECTURE_UNIQUE.has(operation) && resultat != null) {
          if (Array.isArray(resultat)) {
            return (resultat as Args[]).map((r) =>
              dechiffrerObjet(model as string, r)
            ) as never
          }
          return dechiffrerObjet(
            model as string,
            resultat as unknown as Args
          ) as never
        }
        return resultat
      },
    },
  },
})
