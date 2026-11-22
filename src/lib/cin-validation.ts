/**
 * ============================================================================
 * Task 109 — Vérification d'authenticité des CIN détectés et calcul des taux
 * de fiabilité / d'erreur APRÈS IMPORTATION.
 * ============================================================================
 * Demande utilisateur : « Calculer le taux de fiabilité et le taux d'erreur
 * après l'importation en vérifiant le nombre de CIN corrects (vrais) et de
 * numéros CIN incorrects (faux). »
 *
 * PRINCIPE — la DÉTECTION (payslip-extractor.ts) et la VALIDATION sont deux
 * étapes distinctes :
 *  - la détection extrait la valeur écrite sur la fiche, même fictive
 *    (« DEMO 001 234 », « SPEC-0001 » — Task 70) : elle doit rester permissive ;
 *  - la validation (CE FICHIER) vérifie si la valeur détectée a le format
 *    d'un VRAI numéro de CIN tunisien :
 *      · CIN classique  : EXACTEMENT 8 chiffres (ex. 07451236) ;
 *      · CIN biométrique: EXACTEMENT 9 chiffres (ex. 140000911 — Task 27) ;
 *    sans lettres, et sans 4 zéros consécutifs en tête (séquence non
 *    plausible, ex. 000005678).
 *
 * CLASSIFICATION par fiche importée :
 *  - "valide"   (VRAI) : CIN détecté et format authentique ;
 *  - "invalide" (FAUX) : une valeur a été détectée mais son format n'est PAS
 *                        authentique (lettres, longueur anormale, zéros…) ;
 *  - "absent"          : aucune valeur CIN trouvée sur la fiche — rien à
 *                        vérifier (comptée à part, ni vraie ni fausse).
 *
 * TAUX (demande exacte de l'utilisateur) :
 *      taux de fiabilité = CIN vrais / fiches importées × 100
 *      taux d'erreur     = CIN faux  / fiches importées × 100
 *
 * PORTÉE DE LA VÉRIFICATION (à rappeler à l'utilisateur) : il s'agit d'une
 * vérification d'AUTHENTICITÉ DE FORMAT, réalisable automatiquement sur le
 * document. Certifier qu'un CIN formatiquement valide correspond bien à une
 * carte d'identité réelle exigerait un registre officiel externe (aucune
 * application locale ne peut le faire) ; un CIN au bon format mais erroné
 * ( erreur de saisie dans Sage ) n'est donc PAS détectable comme tel.
 * ============================================================================
 */
import type { FiabiliteCin } from "@/lib/types";

export type ClasseCin = "valide" | "invalide" | "absent";

/**
 * Classifie UNE valeur de CIN détectée (déjà compacte : la détection retire
 * espaces/points/tirets/slashs avant stockage).
 *  - "valide"   : 8 ou 9 chiffres purs, sans 4 zéros en tête ;
 *  - "invalide" : tout le reste (lettres, longueur anormale, zéros…) ;
 *  - "absent"   : valeur vide ou null (aucun CIN détecté sur la fiche).
 */
export function classerCin(cin: string | null | undefined): ClasseCin {
  const c = String(cin ?? "").trim();
  if (!c) return "absent";
  // Format tunisien authentique : 8 chiffres (classique) ou 9 (biométrique).
  if (/^\d{8}$/.test(c) || /^\d{9}$/.test(c)) {
    // Garde : 4 zéros consécutifs en tête = séquence non plausible
    // (ex. « 000 005 678 (INVALIDE) » des fiches spécimen → 000005678).
    if (/^0{4}/.test(c)) return "invalide";
    return "valide";
  }
  // Lettres présentes (« DEMO001234 », « SPEC0001 », « 013456DEMO »),
  // longueur anormale (5-7 chiffres, 10 et plus), caractères parasites…
  return "invalide";
}

/**
 * Agrège la vérification d'une liste de CIN (un élément = une fiche importée)
 * et calcule les taux demandés. Les fiches SANS CIN détecté sont comptées
 * dans le total (elles abaissent mécaniquement le taux de fiabilité : un
 * import dont les fiches ne livrent pas de CIN lisible n'est pas fiable) mais
 * restent affichées à part pour le diagnostic (cause typique : scan de
 * mauvaise qualité, bulletin sans numéro CIN imprimé).
 */
export function resumeFiabilite(
  cins: Array<string | null | undefined>
): FiabiliteCin {
  let vrais = 0;
  let faux = 0;
  let nonDetectes = 0;
  for (const cin of cins) {
    const classe = classerCin(cin);
    if (classe === "valide") vrais++;
    else if (classe === "invalide") faux++;
    else nonDetectes++;
  }
  const total = vrais + faux + nonDetectes;
  const arrondi = (n: number) => Math.round(n * 10) / 10;
  return {
    total,
    vrais,
    faux,
    nonDetectes,
    tauxFiabilite: total > 0 ? arrondi((vrais / total) * 100) : 0,
    tauxErreur: total > 0 ? arrondi((faux / total) * 100) : 0,
  };
}

/** Formate un taux « 68,8 % » (virgule française, sans décimale inutile). */
export function formaterTaux(taux: number): string {
  const s = taux.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return `${s} %`;
}

/** Ligne de synthèse lisible (message ImportLog + panneau d'import).
 * Convention de pluralisation du projet (import-tab, stats) : « s » seulement
 * au-delà de 1. « faux » est INVARIABLE en français (0 faux, 1 faux, 4 faux). */
export function ligneFiabilite(f: FiabiliteCin): string {
  const pluriel = (n: number, s: string) => `${n} ${s}${n > 1 ? "s" : ""}`;
  return (
    `Fiabilité CIN : ${formaterTaux(f.tauxFiabilite)} ` +
    `(${pluriel(f.vrais, "vrai")}, ${f.faux} faux, ` +
    `${pluriel(f.nonDetectes, "non détecté")} ` +
    `sur ${pluriel(f.total, "fiche")}) — ` +
    `taux d'erreur : ${formaterTaux(f.tauxErreur)}`
  );
}
