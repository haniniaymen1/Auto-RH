/**
 * ============================================================================
 *  NOUVEAU (v0.2.50) — PASSE SERVEUR DE DÉTECTION DES INCOHÉRENCES NOM &
 *  PRÉNOM APRÈS UN IMPORT (jumelle JS côté portail pour les DEMANDES :
 *  voir scripts/portail-server.js → verifierCoherenceNomDemande).
 * ============================================================================
 *
 *  Appelée par POST /api/payslips/upload APRÈS la création des enregistrements
 *  du lot. Pour chaque fiche créée :
 *   1. contrôles de FORMAT du nom extrait (absent, chiffres, un seul mot…) ;
 *   2. comparaison aux AUTRES fiches du MÊME CIN (historique ET autres fiches
 *      du même lot, soi-même exclu) : le nom de référence est le plus
 *      FRÉQUENT parmi ces fiches — le nom correct d'un employé apparaît sur
 *      toutes ses fiches mensuelles, une coquille isolée ne devient JAMAIS
 *      la référence ; à égalité, la plus récente l'emporte. Écarts signalés :
 *      écriture, ordre inversé, faute de frappe probable, nom différent.
 *   3. le texte (lisible, multi-lignes) est enregistré dans
 *      Payslip.anomalieNom (CHIFFRÉ — carte db-crypto) et renvoyé à la route
 *      pour affichage immédiat dans les résultats d'import.
 *
 *  JAMAIS bloquante : toute erreur est journalisée et renvoie une carte vide
 *  (l'import reste un succès).
 * ============================================================================
 */
import { db } from "@/lib/db";
import { normaliserCin } from "@/lib/payslip-index";
import { chiffrerChamp } from "@/lib/db-crypto";
import {
  anomaliesNomFiche,
  anomaliesFormatNom,
  formeLettres,
} from "@/lib/nom-anomalies";

export interface ResultatDetectionNoms {
  /** id de fiche → liste des anomalies détectées (absent = aucune). */
  parId: Record<string, string[]>;
  /** Nombre de fiches porteuses d'au moins une anomalie. */
  total: number;
}

/** Plafond de sécurité : nombre maximum de fiches analysées par appel. */
const PLAFOND_FICHES = 5000;
/** Nombre maximum de lignes lues par CIN (les plus récentes d'abord). */
const ECHANTILLON_PAR_CIN = 80;

export async function detecterAnomaliesNomsImports(
  ids: string[]
): Promise<ResultatDetectionNoms> {
  const vide: ResultatDetectionNoms = { parId: {}, total: 0 };
  try {
    const idsPropres = Array.from(
      new Set((ids || []).filter((x) => typeof x === "string" && x))
    ).slice(0, PLAFOND_FICHES);
    if (!idsPropres.length) return vide;

    // 1) Lecture DÉCHIFFRÉE des fiches du lot (middleware db.ts).
    const fiches = await db.payslip.findMany({
      where: { id: { in: idsPropres } },
      select: { id: true, cin: true, employeeName: true },
    });
    if (!fiches.length) return vide;

    // 2) Regroupement par CIN normalisé (uniquement les fiches AVEC CIN).
    const cinParId = new Map<string, string>();
    const idsParCin = new Map<string, string[]>();
    for (const f of fiches) {
      const q = normaliserCin(f.cin ?? "");
      if (!q) continue;
      cinParId.set(f.id, q);
      const sac = idsParCin.get(q);
      if (sac) sac.push(f.id);
      else idsParCin.set(q, [f.id]);
    }

    const idsSet = new Set(idsPropres);

    // 3) Pour chaque CIN : fiches correspondantes (index déterministe +
    //    jetons de contenu, même pré-filtre que la recherche CIN). Le lot
    //    vient d'être créé : il figure dans le résultat — c'est VOLONTAIRE,
    //    une incohérence entre deux fiches du MÊME lot doit être détectée
    //    (chaque fiche exclut seulement elle-même au moment de la comparaison).
    const lignesParCin = new Map<
      string,
      Array<{ id: string; nom: string; dansLot: boolean }>
    >();
    for (const [cinNorm] of idsParCin) {
      const idx = chiffrerChamp(cinNorm, true);
      if (!idx) continue;
      const lignes = await db.payslip.findMany({
        where: {
          OR: [{ cinIndex: idx }, { cinTokens: { some: { token: idx } } }],
        },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        take: ECHANTILLON_PAR_CIN,
        select: { id: true, employeeName: true },
      });
      const lignesNommees: Array<{
        id: string;
        nom: string;
        dansLot: boolean;
      }> = [];
      for (const l of lignes) {
        const nom = String(l.employeeName ?? "").trim();
        if (nom) lignesNommees.push({ id: l.id, nom, dansLot: idsSet.has(l.id) });
        if (lignesNommees.length >= ECHANTILLON_PAR_CIN) break;
      }
      lignesParCin.set(cinNorm, lignesNommees);
    }

    // 4) Élection du nom de RÉFÉRENCE pour une fiche donnée : le plus
    //    fréquent parmi les AUTRES lignes du même CIN (soi-même exclu) ;
    //    à égalité de fréquence, la plus récente l'emporte (liste triée
    //    desc → la première rencontrée avec le compte maximal gagne).
    function referencePour(
      cinNorm: string,
      idFiche: string
    ): string | null {
      const lignes = lignesParCin.get(cinNorm);
      if (!lignes || lignes.length === 0) return null;
      const compte = new Map<string, { n: number; nom: string }>();
      for (const l of lignes) {
        if (l.id === idFiche) continue; // jamais soi-même
        const cle = formeLettres(l.nom);
        if (!cle) continue;
        const ex = compte.get(cle);
        if (ex) ex.n += 1;
        else compte.set(cle, { n: 1, nom: l.nom });
      }
      let meilleure: { n: number; nom: string } | null = null;
      for (const v of compte.values()) {
        if (!meilleure || v.n > meilleure.n) meilleure = v;
      }
      return meilleure ? meilleure.nom : null;
    }

    // 5) Anomalies par fiche : format d'abord, puis écart avec la référence.
    const parId: Record<string, string[]> = {};
    const misesAJour: Array<Promise<unknown>> = [];
    for (const f of fiches) {
      const anomalies = anomaliesFormatNom(f.employeeName);
      const cinNorm = cinParId.get(f.id);
      const reference = cinNorm ? referencePour(cinNorm, f.id) : null;
      if (reference) {
        anomalies.push(...anomaliesNomFiche(f.employeeName, reference));
      }
      if (!anomalies.length) continue;
      const texte = anomalies.join("\n");
      parId[f.id] = anomalies;
      misesAJour.push(
        db.payslip.update({
          where: { id: f.id },
          data: { anomalieNom: texte },
        })
      );
    }
    // 6) Écritures (chiffrées par le middleware) — en parallèle, tolérantes
    //    aux échecs individuels.
    if (misesAJour.length) await Promise.allSettled(misesAJour);

    return { parId, total: Object.keys(parId).length };
  } catch (e) {
    console.error("[ANOMALIES-NOM] détection impossible (import conservé):", e);
    return vide;
  }
}
