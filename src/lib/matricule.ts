/**
 * ============================================================================
 *  NOUVEAU (v0.2.107 — demande utilisateur) — RÉSOLUTION DU MATRICULE EMPLOYÉ
 * ============================================================================
 *  Le matricule est EXTRAIT DES FICHES DE PAIE à l'import (Payslip.matricule,
 *  champ chiffré). Cette librairie le rend disponible dans TOUTES les parties
 *  du portail d'administration qui affichent un employé par son CIN :
 *
 *   - onglet « Accès portail » : colonne « Matricule » (auto-association) ;
 *   - onglet « Demandes » : informations de la demande ;
 *   - e-mails des demandes (création, statut, document-réponse) ;
 *   - onglet « Toutes les fiches » : colonne « Matricule » (valeur directe
 *     de la fiche — sans passer par ce résolveur).
 *
 *  RÈGLE DE RÉSOLUTION (par CIN) :
 *   1) PRIORITÉ : matricule posé MANUELLEMENT par le RH sur l'accès portail
 *      (PortalAccess.matricule — action « modifier-matricule ») ;
 *   2) REPLI : matricule de la fiche de paie la PLUS RÉCENTE du même CIN qui
 *      en porte un (recherche indexée sur cinIndex — empreinte déterministe,
 *      aucun déchiffrement massif ; même mécanisme que
 *      nomEmployeDepuisFiches de src/lib/demandes.ts).
 *
 *  JAMAIS bloquant : toute erreur → valeur absente (l'appelant garde son
 *  affichage « — » / omet la ligne « Matricule » dans les e-mails).
 * ============================================================================
 */
import "server-only";
import { normaliserCin } from "@/lib/payslip-index";
import { chiffrerChamp } from "@/lib/db-crypto";
import { db } from "@/lib/db";

/** Matricule d'UN employé ("" si aucun — repli de l'appelant). */
export async function matriculeEmploye(
  cin: string | null | undefined
): Promise<string> {
  const carte = await matriculesPourCins([cin]);
  return carte.get(normaliserCin(cin)) ?? "";
}

/**
 * Résolution EN LOT (une demande d'administration liste jusqu'à 400
 * demandes) : DEUX requêtes indexées au maximum.
 *  - PortalAccess : where cin IN (empreintes déterministes — la clause est
 *    passée DÉJÀ chiffrée : chiffrerChamp est idempotent, le middleware ne
 *    re-chiffre pas une valeur qui porte le préfixe encbd1d:) ;
 *  - Payslip : where cinIndex IN (…), tri uploadedAt desc — la première
 *    valeur non vide de chaque empreinte gagne.
 * Retour : Map « CIN normalisé → matricule » (les CIN sans matricule y
 * manquent — l'appelant teste simplement la présence).
 */
export async function matriculesPourCins(
  cins: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const resultat = new Map<string, string>();
  try {
    // Dédoublonnage sur la forme normalisée (même règle que la connexion
    // portail, la création d'accès et l'index cinIndex).
    const propres: string[] = [];
    const vus = new Set<string>();
    for (const c of cins) {
      const q = normaliserCin(c);
      if (!q || vus.has(q)) continue;
      vus.add(q);
      propres.push(q);
    }
    if (propres.length === 0) return resultat;

    // 1) PRIORITÉ — valeur manuelle du RH sur l'accès portail.
    const empreintes = propres
      .map((q) => chiffrerChamp(q, true))
      .filter((e): e is string => Boolean(e));
    const empreinteVersCin = new Map<string, string>();
    for (let i = 0; i < propres.length; i++) {
      const e = empreintes[i];
      if (e) empreinteVersCin.set(e, propres[i]);
    }
    if (empreintes.length > 0) {
      const accesRows = await db.portalAccess.findMany({
        where: { cin: { in: empreintes } },
        select: { cin: true, matricule: true },
      });
      for (const row of accesRows) {
        const m = String(row.matricule ?? "").trim();
        if (m) resultat.set(row.cin, m); // cin déchiffré par le middleware
      }
    }

    // 2) REPLI — matricule de la fiche la plus récente du CIN.
    const manquants = propres.filter((q) => !resultat.has(q));
    if (manquants.length === 0) return resultat;
    const empreintesManquantes = manquants
      .map((q) => chiffrerChamp(q, true))
      .filter((e): e is string => Boolean(e));
    if (empreintesManquantes.length === 0) return resultat;
    const fichesRows = await db.payslip.findMany({
      where: { cinIndex: { in: empreintesManquantes } },
      orderBy: { uploadedAt: "desc" },
      select: { cinIndex: true, matricule: true },
    });
    for (const f of fichesRows) {
      const cin = f.cinIndex ? empreinteVersCin.get(f.cinIndex) : undefined;
      if (!cin || resultat.has(cin)) continue; // tri desc : le plus récent gagne
      const m = String(f.matricule ?? "").trim();
      if (m) resultat.set(cin, m);
    }
    return resultat;
  } catch {
    return resultat; // jamais bloquant — affichage « — » / ligne omise
  }
}
