/**
 * ============================================================
 *  NOUVEAU (Task 23 — ajouté SANS modifier les modules existants)
 *  Découpage physique des PDF multi-fiches en fiches INDIVIDUELLES.
 * ============================================================
 *
 *  Besoin utilisateur : « quand j'importe le fichier PDF, tu divises le
 *  fichier par fiche de paie et tu affectes chaque fiche de paie à son
 *  employé (clé = CIN), comme ça quand l'employé veut récupérer sa fiche
 *  de paie il la trouve au format PDF. »
 *
 *  Jusqu'ici, un PDF multi-fiches produisait plusieurs ENREGISTREMENTS
 *  pointant vers le MÊME fichier complet : l'employé qui ouvrait « sa »
 *  fiche recevait donc TOUT le document (les fiches des autres incluses).
 *  Désormais, chaque fiche reçoit son PROPRE fichier PDF contenant
 *  uniquement SES pages — le portail sert ce fichier individuel.
 *
 *  Bibliothèque : pdf-lib (manipulation 100 % locale, aucune dépendance
 *  réseau). Les règles de DÉTECTION (CIN, employé, période…) restent
 *  celles de payslip-extractor.ts — ce module ne fait que COUPER.
 * ============================================================
 */
import { PDFDocument } from "pdf-lib";

/**
 * Nombre de pages d'un PDF (robuste : 0 si illisible).
 */
export async function countPdfPages(buffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

/**
 * Extrait les pages [startPage .. endPage] (1-based, inclusives) d'un PDF
 * et renvoie un NOUVEAU PDF autonome contenant uniquement ces pages.
 *
 * - Les pages sont COPIÉES (le document source n'est pas altéré).
 * - Les polices/images/annexes de ces pages sont embarquées dans le résultat.
 * - `useObjectStreams: false` pour un PDF aussi compatible que possible
 *   avec les vieux lecteurs (navigateurs, Acrobat ancien, impression).
 *
 * Retourne null si le PDF est illisible ou si la plage est invalide —
 * l'appelant garde alors le comportement historique (fichier complet).
 */
export async function extractPdfPageRange(
  buffer: Buffer,
  startPage: number,
  endPage: number
): Promise<Buffer | null> {
  try {
    if (
      !Number.isFinite(startPage) ||
      !Number.isFinite(endPage) ||
      startPage < 1 ||
      endPage < startPage
    ) {
      return null;
    }
    const src = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pageCount = src.getPageCount();
    const from = Math.max(0, startPage - 1);
    const to = Math.min(pageCount, endPage) - 1;
    if (from > to || from >= pageCount) return null;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
    );
    for (const p of copied) out.addPage(p);

    // Métadonnées discrètes : provenance de la fiche (traçabilité).
    out.setTitle(`Fiche de paie — pages ${from + 1} à ${to + 1}`);
    out.setProducer("AutoRH");
    out.setCreator("AutoRH");

    const bytes = await out.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  } catch (e) {
    console.error(
      "[PDF-SPLIT] Découpage impossible (pages " + startPage + "-" + endPage + "):",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Découpe un PDF multi-fiches en fiches individuelles, UNE par groupe.
 *
 * `ranges` : liste ordonnée des fiches, chaque entrée décrit la PLAGE de
 * pages de la fiche dans le document source :
 *   { startPage, endPage }
 *
 * Retourne un buffer PDF PAR plage (même ordre), ou null pour une plage
 * en échec. L'appelant décide du repli (comportement historique).
 *
 * (REFONTE Task 136) : le document source est chargé UNE SEULE FOIS et
 * partagé par toutes les plages. Historiquement, extractPdfPageRange
 * rechargeait le PDF complet pour CHAQUE fiche — un multi-bulletins de
 * 200 pages (43 Mo) était donc lu 200 fois (~1-2 s par lecture, plusieurs
 * minutes avant le premier fichier écrit) et l'import semblait se figer.
 * La mémoire reste bornée : pdf-lib ne copie que les objets référencés par
 * les pages de chaque plage.
 */
export async function splitPdfIntoRanges(
  buffer: Buffer,
  ranges: Array<{ startPage: number; endPage: number }>
): Promise<Array<Buffer | null>> {
  let src: PDFDocument | null = null;
  try {
    src = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch (e) {
    console.error(
      "[PDF-SPLIT] Découpage impossible (chargement du PDF):",
      e instanceof Error ? e.message : e
    );
    return ranges.map(() => null);
  }

  const out: Array<Buffer | null> = [];
  for (const r of ranges) {
    out.push(await extractRangeFromDocument(src, r.startPage, r.endPage));
  }
  return out;
}

/**
 * Extrait la plage [startPage .. endPage] (1-based, incluse) d'un document
 * DÉJÀ CHARGÉ — complément interne de splitPdfIntoRanges (Task 136) :
 * mêmes garanties qu'extractPdfPageRange (copie des pages, useObjectStreams
 * false, métadonnées de traçabilité), sans recharger le PDF source.
 */
async function extractRangeFromDocument(
  src: PDFDocument,
  startPage: number,
  endPage: number
): Promise<Buffer | null> {
  try {
    if (
      !Number.isFinite(startPage) ||
      !Number.isFinite(endPage) ||
      startPage < 1 ||
      endPage < startPage
    ) {
      return null;
    }
    const pageCount = src.getPageCount();
    const from = Math.max(0, startPage - 1);
    const to = Math.min(pageCount, endPage) - 1;
    if (from > to || from >= pageCount) return null;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
    );
    for (const p of copied) out.addPage(p);

    // Métadonnées discrètes : provenance de la fiche (traçabilité).
    out.setTitle(`Fiche de paie — pages ${from + 1} à ${to + 1}`);
    out.setProducer("AutoRH");
    out.setCreator("AutoRH");

    const bytes = await out.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  } catch (e) {
    console.error(
      "[PDF-SPLIT] Découpage impossible (pages " + startPage + "-" + endPage + "):",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
