/**
 * NOUVEAU (ajouté SANS modifier les modules existants) : ré-analyse d'une
 * fiche DÉJÀ importée, quel que soit son format de stockage.
 *
 * La redétection historique (route /api/payslips/redetect) relisait les PDF
 * via analyzePayslip / analyzePayslipPages. Les fiches importées depuis une
 * IMAGE (PNG/JPG), un CLASSEUR Excel ou un document Word n'étaient donc
 * jamais actualisées (lecture impossible -> « fiche inchangée »).
 *
 * Cette fonction renvoie les MÊMES champs que analyzePayslip, en choisissant
 * le lecteur selon l'extension du fichier :
 *   - .pdf                -> chemins historiques (analyzePayslip / pages +
 *                            groupement multi-fiches) — INCHANGÉS ;
 *   - .png/.jpg/.jpeg     -> OCR adaptatif (passe haute lisibilité) ;
 *   - .xlsx/.xlsm/.xls    -> feuilles -> découpe « 1 bulletin par ligne » ;
 *   - .docx               -> texte -> découpe par CIN candidat.
 *
 * `sourcePage` : page/feuille/ligne d'origine de la fiche (PDF multi-fiches,
 * classeur multi-lignes). La ré-analyse restitue alors UNIQUEMENT les champs
 * de cette page virtuelle — comportement identique à la redétection PDF.
 */
import {
  analyzePayslip,
  analyzePayslipPages,
  groupMultiPayslips,
  detectCin,
  // NOUVEAU (ajouté SANS modifier les imports historiques ci-dessus) :
  // arbitrage CIN N° CNSS vs N° CIN pour les images (même règle que
  // analyzePayslip et que l'upload d'images).
  arbitrateCinWithTableContext,
  // NOUVEAU (Task 15) : arbitrage du NOM — mêmes helpers que analyzePayslip
  isHeaderGarbageName,
  isNameFromHeaderLine,
  nameHasStrayFragments,
  normalizeText,
  extractEmployeeName,
  extractPeriod,
  extractNetSalary,
  extractMatricule,
  type ExtractedPayslip,
} from "./payslip-extractor";
import { ocrImageAdaptive } from "./payslip-ocr-adaptive";
// NOUVEAU (Task 15) : variante « en parties » pour l'arbitrage du nom
import { ocrImageAdaptiveParts } from "./payslip-ocr-adaptive";
import {
  xlsxToSheetTexts,
  docxToText,
  splitTextIntoCinBlocks,
  expandSheetTexts,
} from "./payslip-office";
// NOUVEAU (Task 25, additif) : compteur de candidats CIN réels (garde du
// découpage Word à l'import) — distingue fichier INDIVIDUEL (< 2 CIN) et
// document partagé (≥ 2 CIN) pour la redétection.
import { countDistinctCinCandidates } from "./docx-splitter";

export function fileExtensionOf(name: string): string {
  const m = (name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Analyse une page virtuelle (texte) avec les MÊMES règles que l'import. */
function analyzeVirtualText(t: string, page: number) {
  return {
    page,
    text: t,
    normalizedText: normalizeText(t),
    cin: detectCin(t),
    employeeName: extractEmployeeName(t),
    period: extractPeriod(t),
    netSalary: extractNetSalary(t),
    matricule: extractMatricule(t),
  };
}

/** Champs restitués pour une fiche (identiques à ExtractedPayslip). */
export interface ReanalyzedPayslip {
  text: string;
  normalizedText: string;
  pages: number;
  cin: string | null;
  employeeName: string | null;
  period: string | null;
  netSalary: string | null;
  matricule: string | null;
  ocrUsed?: boolean;
}

/**
 * Ré-analyse le fichier stocké d'une fiche. Retourne null si le format est
 * inconnu ou si la page demandée n'existe plus (la fiche restera inchangée,
 * comme dans la redétection historique).
 */
export async function reanalyzeStoredFile(
  fileName: string,
  buffer: Buffer,
  sourcePage?: number | null
): Promise<ReanalyzedPayslip | null> {
  const ext = fileExtensionOf(fileName);

  // ---------- PDF : chemins historiques INCHANGÉS ----------
  if (ext === "pdf") {
    if (sourcePage != null) {
      const { pagePayslips } = await analyzePayslipPages(buffer);
      const groups = groupMultiPayslips(pagePayslips);
      const group = groups?.find((g) => g.page === sourcePage);
      if (!group) {
        // NOUVEAU (Task 23, additif) : les fiches issues du DÉCOUPAGE
        // automatique (import) pointent vers un PDF INDIVIDUEL ne
        // contenant plus qu'UNE SEULE fiche — groupMultiPayslips renvoie
        // alors null (moins de 2 CIN différents) et aucun groupe ne peut
        // correspondre à sourcePage (numéro de page du document ORIGINAL).
        // On ré-analyse donc le fichier individuel EN ENTIER au lieu
        // d'échouer (« fiche inchangée »).
        if (!groups || groups.length === 0) {
          const whole = await analyzePayslip(buffer);
          if (whole.text && whole.text.trim().length > 0) return whole;
        }
        return null;
      }
      return {
        text: group.text,
        normalizedText: group.normalizedText,
        pages: pagePayslips.length,
        cin: group.cin,
        employeeName: group.employeeName,
        period: group.period,
        netSalary: group.netSalary,
        matricule: group.matricule,
      };
    }
    return await analyzePayslip(buffer);
  }

  // ---------- IMAGE PNG/JPG : OCR adaptatif ----------
  if (["png", "jpg", "jpeg"].includes(ext)) {
    // MODIFIÉ (Task 15) : ocrImageAdaptiveParts — même déroulement, la
    // partie hi-res sert à l'ARBITRAGE DU NOM ci-dessous (cas « COTES »).
    const { text, hiResText } = await ocrImageAdaptiveParts(buffer);
    if (!text || !text.trim()) return null;
    // NOUVEAU (Task 15) : ARBITRAGE DU NOM — mêmes règles que
    // analyzePayslip et que la route d'upload d'images.
    let employeeName = extractEmployeeName(text);
    if (
      hiResText &&
      (isHeaderGarbageName(employeeName) ||
        isNameFromHeaderLine(text, employeeName) ||
        nameHasStrayFragments(text, employeeName))
    ) {
      const hiName = extractEmployeeName(hiResText);
      if (hiName && !isHeaderGarbageName(hiName)) {
        employeeName = hiName;
      }
    }
    return {
      text,
      normalizedText: normalizeText(text),
      pages: 1,
      // NOUVEAU (ajouté SANS modifier la détection historique au-dessus) :
      // même arbitrage CIN que analyzePayslip / upload d'images (N° CNSS
      // avec clé « - 08 » remplacé par le vrai CIN sous l'en-tête « N° CIN »).
      cin: arbitrateCinWithTableContext(detectCin(text), text),
      employeeName,
      period: extractPeriod(text),
      netSalary: extractNetSalary(text),
      matricule: extractMatricule(text),
      ocrUsed: true,
    };
  }

  // ---------- CLASSEUR EXCEL : feuilles + découpe par ligne ----------
  if (["xlsx", "xlsm", "xls"].includes(ext)) {
    const { sheetTexts } = xlsxToSheetTexts(buffer);
    const expanded = expandSheetTexts(sheetTexts).map((t, i) =>
      analyzeVirtualText(t, i + 1)
    );
    if (expanded.length === 0) return null;
    if (sourcePage != null) {
      const page = expanded.find((p) => p.page === sourcePage);
      if (!page) {
        // NOUVEAU (Task 24, additif) : mêmes règles que le PDF (Task 23) —
        // les fiches issues du DÉCOUPAGE automatique (import) pointent vers
        // un classeur INDIVIDUEL ne contenant plus qu'UNE SEULE fiche :
        // sourcePage (feuille/ligne du classeur ORIGINAL) ne peut plus
        // correspondre. On ré-analyse alors le fichier individuel EN ENTIER
        // — UNIQUEMENT s'il ne contient qu'UNE fiche (moins de 2 CIN
        // différents) ; les classeurs partagés historiques (≥ 2 CIN,
        // importés avant le découpage) restent « fiche inchangée ».
        const distinctCins = Array.from(
          new Set(expanded.map((p) => p.cin).filter(Boolean))
        );
        if (distinctCins.length < 2) {
          const joined = expanded.map((p) => p.text).join("\n");
          if (joined.trim().length > 0) {
            return {
              text: joined,
              normalizedText: normalizeText(joined),
              pages: expanded.length,
              cin: detectCin(joined),
              employeeName: extractEmployeeName(joined),
              period: extractPeriod(joined),
              netSalary: extractNetSalary(joined),
              matricule: extractMatricule(joined),
            };
          }
        }
        return null;
      }
      return {
        text: page.text,
        normalizedText: page.normalizedText,
        pages: expanded.length,
        cin: page.cin,
        employeeName: page.employeeName,
        period: page.period,
        netSalary: page.netSalary,
        matricule: page.matricule,
      };
    }
    const joined = expanded.map((p) => p.text).join("\n");
    return {
      text: joined,
      normalizedText: normalizeText(joined),
      pages: expanded.length,
      cin: detectCin(joined),
      employeeName: extractEmployeeName(joined),
      period: extractPeriod(joined),
      netSalary: extractNetSalary(joined),
      matricule: extractMatricule(joined),
    };
  }

  // ---------- DOCUMENT WORD : texte + découpe par CIN ----------
  if (ext === "docx") {
    const text = await docxToText(buffer);
    if (!text || !text.trim()) return null;
    // NOUVEAU (Task 25, additif) : fichier INDIVIDUEL (moins de 2 candidats
    // CIN réels — même comptage que la garde du découpage à l'import, qui
    // ignore les matricules et N° CNSS) -> analyse du texte EN ENTIER.
    // Les blocs « par CIN » d'un fichier individuel ne sont que des
    // FRAGMENTS du même bulletin : la sourcePage y « correspondrait » à un
    // fragment (le bloc CIN sans le nom, ou le préambule sans le CIN) —
    // nom, période ou CIN seraient perdus à la redétection. Les documents
    // PARTAGÉS historiques (≥ 2 CIN, importés avant le découpage) suivent
    // le chemin par blocs INCHANGÉ ci-dessous.
    if (countDistinctCinCandidates(text) < 2) {
      return {
        text,
        normalizedText: normalizeText(text),
        pages: 1,
        cin: detectCin(text),
        employeeName: extractEmployeeName(text),
        period: extractPeriod(text),
        netSalary: extractNetSalary(text),
        matricule: extractMatricule(text),
      };
    }
    const blocks = splitTextIntoCinBlocks(text);
    const pages = (blocks.length > 0 ? blocks : [text]).map((t, i) =>
      analyzeVirtualText(t, i + 1)
    );
    if (sourcePage != null) {
      const page = pages.find((p) => p.page === sourcePage);
      if (!page) {
        // (Task 25, additif) : les fiches issues du DÉCOUPAGE automatique
        // (import) pointent vers un document Word INDIVIDUEL ne contenant
        // plus qu'UNE SEULE fiche : sourcePage (page du document ORIGINAL)
        // ne peut plus correspondre. Le garde « moins de 2 candidats CIN »
        // ci-dessus a DÉJÀ ré-analysé ce cas en entier — on n'arrive ici
        // que pour les documents partagés (≥ 2 CIN) : « fiche inchangée ».
        return null;
      }
      return {
        text: page.text,
        normalizedText: page.normalizedText,
        pages: pages.length,
        cin: page.cin,
        employeeName: page.employeeName,
        period: page.period,
        netSalary: page.netSalary,
        matricule: page.matricule,
      };
    }
    return {
      text,
      normalizedText: normalizeText(text),
      pages: 1,
      cin: detectCin(text),
      employeeName: extractEmployeeName(text),
      period: extractPeriod(text),
      netSalary: extractNetSalary(text),
      matricule: extractMatricule(text),
    };
  }

  return null;
}

/** Type historique exposé pour compatibilité d'import. */
export type { ExtractedPayslip };
