/**
 * ============================================================================
 * NOUVEAU (Task 99) — INDEX DE RECHERCHE CIN/NOM DÉTERMINISTE
 * ============================================================================
 *
 * Objectif : pagination serveur et recherche CIN côté serveur sur de GROS
 * volumes (jusqu'à 240 000 fiches) SANS déchiffrer toute la table à chaque
 * requête.
 *
 * Contrainte héritée (Task 32) : les champs sensibles de Payslip (cin,
 * content, normalizedContent, employeeName…) sont chiffrés AES-256-GCM à IV
 * ALÉATOIRE — deux valeurs identiques donnent deux empreintes différentes :
 * aucune recherche SQL n'y est possible. L'ancienne recherche chargeait donc
 * TOUTES les lignes et les déchiffrait en JavaScript — acceptable à quelques
 * milliers de fiches, rédhibitoire à 240 000.
 *
 * Solution : colonnes DÉRIVÉES chiffrées en mode DÉTERMINISTE (encbd1d: —
 * même mécanisme que PortalAccess.cin, même valeur = même empreinte),
 * indexées en SQL :
 *   - cinIndex : chiffrement déterministe de normalizeQuery(cin) ;
 *   - nomIndex : chiffrement déterministe de employeeName (dédoublonnage
 *     statistique du tableau de bord) ;
 *   - PayslipCinToken.token : chiffrement déterministe de chaque numéro de
 *     type CIN trouvé DANS LE CONTENU (recherche « dans le contenu » même
 *     quand le champ cin détecté diffère — page multi-employés).
 *
 * SÉCURITÉ : aucune valeur en clair n'est stockée — les colonnes ne
 * contiennent que des empreintes chiffrées (encbd1d:), illisibles sans la
 * clé (AUTO_RH_STORAGE_KEY / AUTH_SECRET). La recherche par égalité sur
 * empreinte déterministe expose au plus « cette fiche contient ce numéro »,
 * jamais le numéro lui-même.
 *
 * PARITÉ DE COMPORTEMENT : la recherche indexée ne fait qu'un PRÉ-FILTRE
 * SQL ; les fiches candidates (quelques lignes) sont ensuite déchiffrées et
 * ré-évaluées avec la MÊME règle exacte qu'avant (normalizeQuery(cin) === q
 * || isExactCinInContent(content, q), avec le pré-filtre
 * normalizedContent.includes(q)) — le résultat est IDENTIQUE à l'ancien,
 * y compris les cas limites (numéro complet, pas de sous-séquence).
 * ============================================================================
 */
import { chiffrerChamp } from "@/lib/db-crypto";

/**
 * Normalisation d'un CIN — copie EXACTE de normalizeQuery() de
 * src/lib/payslip-extractor.ts (majuscules, sans espaces/tirets/points/
 * slashs). Dupliquée volontairement pour ne pas charger l'extracteur PDF
 * (pdf-parse) dans la chaîne d'import du middleware de base.
 * ⚠ Ne pas modifier l'une sans l'autre.
 */
export function normaliserCin(valeur: string | null | undefined): string {
  return String(valeur ?? "")
    .toUpperCase()
    .replace(/[\s./\-]/g, "");
}

/** Plages de longueur retenues pour les jetons de contenu. */
const LONGUEUR_TOKEN_MIN = 6;
const LONGUEUR_TOKEN_MAX = 24;
/** Garde-fou : nombre maximal de jetons extraits d'une seule fiche. */
const JETONS_MAX_PAR_FICHE = 400;

/**
 * Extrait de `content` les numéros de type CIN (formes normalisées) à
 * indexer. Extraction LARGE et volontairement permissive : elle ne fait
 * qu'alimenter le pré-filtre SQL — la règle EXACTE (isExactCinInContent)
 * est TOUJOURS ré-appliquée après déchiffrement des candidates, donc un
 * jeton superflu ne peut JAMAIS fausser le résultat (au pire une ligne
 * candidate inutile) ; un jeton manquant ferait perdre une fiche, d'où la
 * générosité des règles ci-dessous :
 *   1. séquences alphanumériques avec séparateurs simples (« 26 542 351 »,
 *      « 9593-1034 », « SPEC-0001 », « A 123456 ») → forme collée normalisée
 *      si elle contient au moins 50 % de chiffres ;
 *   2. sous-séquences de 6 chiffres minimum (« 09123456 », « 123456789099 ») ;
 *   3. sous-séquences alphanumériques collées de 6 caractères minimum
 *      contenant au moins un chiffre (« A123456 », « SPEC0001 »).
 * Chaque forme est ensuite chiffrée en DÉTERMINISTE par indexJeton().
 */
export function extraireTokensCin(content: string | null | undefined): string[] {
  const texte = String(content ?? "").toUpperCase();
  if (!texte) return [];
  const bruts = new Set<string>();

  // Séquences alphanumériques éventuellement entrecoupées d'UN séparateur
  // simple (espace, tabulation, point, tiret, slash) — les séparateurs
  // insérés par l'extraction PDF / OCR entre les caractères d'un même numéro.
  const reRuns = /[0-9A-Z]+(?:[ \t./-][0-9A-Z]+)*/g;
  const reChiffres = /[0-9]{6,}/g;
  const reAlnum = /[0-9A-Z]{6,}/g;
  let m: RegExpExecArray | null;
  while ((m = reRuns.exec(texte)) !== null) {
    const run = m[0];
    if (bruts.size >= JETONS_MAX_PAR_FICHE) break;

    // (1) forme collée du run complet
    const colle = run.replace(/[ \t./-]/g, "");
    if (
      colle.length >= LONGUEUR_TOKEN_MIN &&
      colle.length <= LONGUEUR_TOKEN_MAX
    ) {
      const chiffres = (colle.match(/[0-9]/g) ?? []).length;
      if (chiffres >= 1 && chiffres * 2 >= colle.length) bruts.add(colle);
    }

    // (2) sous-séquences de chiffres purs (au cas où le run aurait avalé des
    //     mots voisins — ex. « CIN 09123456 NET »)
    let c: RegExpExecArray | null;
    reChiffres.lastIndex = 0;
    while ((c = reChiffres.exec(run)) !== null) {
      if (c[0].length <= LONGUEUR_TOKEN_MAX) bruts.add(c[0]);
    }
    // (3) sous-séquences alphanumériques collées avec au moins un chiffre
    let a: RegExpExecArray | null;
    reAlnum.lastIndex = 0;
    while ((a = reAlnum.exec(run)) !== null) {
      if (a[0].length <= LONGUEUR_TOKEN_MAX && /[0-9]/.test(a[0])) bruts.add(a[0]);
    }
  }

  return Array.from(bruts).slice(0, JETONS_MAX_PAR_FICHE);
}

/** Empreinte déterministe (encbd1d:) d'une forme de CIN normalisée. */
export function indexJeton(tokenNormalise: string): string | null {
  if (!tokenNormalise) return null;
  return chiffrerChamp(tokenNormalise, true) ?? null;
}

/**
 * Colonnes d'index à écrire pour un CIN (champ `cin` de la fiche).
 * cinIndexedAt est TOUJOURS renvoyé : une fiche SANS CIN doit aussi être
 * marquée « indexée » (sinon elle repartirait dans le repli de
 * déchiffrement à chaque recherche).
 * Cas « chaîne vide » : l'ancien comptage statistique comptait cin=""
 * comme « avec CIN » (non null) — la même convention est conservée
 * (cinIndex=""), le dédoublonnage excluant lui la chaîne vide.
 */
export function indexCin(cin: string | null | undefined): {
  cinIndex: string | null;
  cinIndexedAt: Date;
} {
  const normalise = normaliserCin(cin);
  return {
    cinIndex: normalise === "" ? "" : chiffrerChamp(normalise, true) ?? null,
    cinIndexedAt: new Date(),
  };
}

/**
 * Empreinte déterministe d'un nom d'employé (dédoublonnage statistique).
 * Chaîne vide → chaîne vide (compte comme « non null » dans les
 * statistiques, exactement comme l'ancien Set JavaScript).
 */
export function indexNom(nom: string | null | undefined): string | null {
  const valeur = String(nom ?? "");
  if (valeur === "") return "";
  return chiffrerChamp(valeur, true) ?? null;
}
