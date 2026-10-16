/**
 * NOUVEAU (ajouté SANS modifier les modules existants) : OCR « adaptatif »
 * des images PNG/JPG importées directement.
 *
 * Constat terrain : sur certaines fiches en TABLEAU, l'OCR en mode par
 * défaut lit correctement les rubriques (net à payer…) mais retourne du
 * texte SANS RAPPORT pour le bloc d'en-tête (matricule / nom / période /
 * N° CIN) — ex. "PEN / ONE CECI SEE" au lieu du tableau. L'employé, la
 * période et le CIN sont alors introuvables alors que l'image est nette.
 *
 * Stratégie (aucune règle de détection modifiée) :
 *   1. passe HISTORIQUE ocrImageBuffer() (mode par défaut) — inchangée ;
 *   2. si les champs clés (CIN, ou nom + période) sont déjà identifiés,
 *      on s'arrête là (coût identique à l'historique) ;
 *   3. sinon passe « haute lisibilité » : image agrandie 2x (lanczos,
 *      @napi-rs/canvas déjà présent) + OCR PSM 4, et le texte obtenu est
 *      AJOUTÉ au premier (jamais substitué). Les règles de détection
 *      existantes retrouvent alors l'en-tête du tableau.
 *
 * MODIFIÉ (Task 15, ADDITIF — « detection fausse » vérifiée sur la fiche
 * EMPLOYE TEST convertie PNG -> le CIN était correct mais le nom lu
 * « COTES » (déchet de la bande d'en-tête) n'était JAMAIS remis en cause
 * car le CIN était présent) :
 *   - condition d'arrêt (2) durcie de façon ADDITIVE : si le nom détecté
 *     est SUSPECT (fragment d'en-tête ou garbage — mêmes helpers que
 *     analyzePayslip), la passe haute lisibilité est DÉCLENCHÉE aussi ;
 *   - nouvelle fonction exportée ocrImageAdaptiveParts() qui renvoie le
 *     texte combiné ET la partie hi-res séparément, afin que les appelants
 *     (route upload image, redétection) puissent appliquer le MÊME
 *     arbitrage du nom que analyzePayslip. ocrImageAdaptive() conserve sa
 *     signature historique (string) : aucun appelant existant n'est cassé.
 */
import {
  detectCin,
  extractEmployeeName,
  extractPeriod,
  isHeaderGarbageName,
  isNameFromHeaderLine,
  nameHasStrayFragments,
} from "./payslip-extractor";
import {
  ocrImageBuffer,
  ocrImageBufferPsm4,
  upscaleImageBuffer2x,
} from "./payslip-ocr";

/** NOUVEAU (Task 15) : vrai si le nom lu semble être un déchet d'en-tête
 * (garbage, fragment lu sur une ligne de libellés de colonnes, ou morcelé
 * par l'OCR — fragments parasites de 1-2 lettres juste avant le nom).
 * Un nom ABSENT est aussi considéré comme suspect (il faut tenter la
 * hi-res). */
function nameLooksSuspicious(
  text: string,
  name: string | null | undefined
): boolean {
  if (!name) return true;
  return (
    isHeaderGarbageName(name) ||
    isNameFromHeaderLine(text, name) ||
    nameHasStrayFragments(text, name)
  );
}

/** NOUVEAU (Task 15) : variante « en parties » de ocrImageAdaptive —
 * même déroulement EXACT (passe historique puis hi-res si besoin), mais
 * renvoie aussi la partie hi-res pour l'arbitrage du nom côté appelant. */
export async function ocrImageAdaptiveParts(image: Buffer): Promise<{
  text: string;
  hiResText: string | null;
}> {
  // 1) passe historique (comportement inchangé)
  const first = await ocrImageBuffer(image);

  // 2) champs clés déjà là (et nom NON suspect) -> texte historique tel quel
  //    (condition historique inchangée ; Task 15 ajoute uniquement la
  //    poursuite vers la hi-res quand le nom est suspect)
  const cinFirst = detectCin(first);
  const nameFirst = extractEmployeeName(first);
  if (
    (cinFirst || (nameFirst && extractPeriod(first))) &&
    !nameLooksSuspicious(first, nameFirst)
  ) {
    return { text: first, hiResText: null };
  }

  // 3) passe haute lisibilité (2x + PSM 4), texte AJOUTÉ (ordre inchangé)
  try {
    const upscaled = await upscaleImageBuffer2x(image);
    const second = await ocrImageBufferPsm4(upscaled);
    if (second && second.trim()) {
      const combined = first ? `${first}\n${second}` : second;
      return { text: combined, hiResText: second };
    }
  } catch (e) {
    console.error(
      "[OCR-ADAPTIVE] passe haute lisibilité impossible:",
      e instanceof Error ? e.message : e
    );
  }
  return { text: first, hiResText: null };
}

export async function ocrImageAdaptive(image: Buffer): Promise<string> {
  const parts = await ocrImageAdaptiveParts(image);
  return parts.text;
}
