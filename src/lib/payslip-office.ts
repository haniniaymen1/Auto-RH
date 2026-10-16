/**
 * NOUVEAU (ajouté SANS modifier le comportement existant) : lecture des
 * ARCHIVES ZIP et des documents OFFICE (Excel / Word) contenant des fiches
 * de paie — répond à la demande :
 *   « plusieurs PNG en 1 seul fichier (ZIP), plusieurs PNG en 1 seul PDF,
 *     plusieurs XLSX en 1 seul fichier, plusieurs DOCX en 1 seul fichier… »
 *
 * Principe (le même que pour les PDF multi-fiches déjà en place) :
 *   - ZIP      -> chaque fichier de l'archive est traité INDIVIDUELLEMENT par
 *                 le pipeline existant (PDF texte, PDF image + OCR, PNG/JPG
 *                 OCR, XLSX, DOCX) — les règles de détection ne changent pas ;
 *   - XLSX     -> chaque FEUILLE devient un texte ; les MÊMES règles
 *                 (CIN, employé, période, net, matricule) sont appliquées ;
 *                 si ≥ 2 CIN différents -> 1 fiche par groupe (comme les
 *                 PDF multi-fiches) ;
 *   - DOCX     -> le texte complet est extrait ; si ≥ 2 CIN différents sont
 *                 présents, le texte est découpé en fiches (chaque CIN
 *                 commence une nouvelle fiche).
 *
 * Dépendances ajoutées : fflate (ZIP, pur JS), xlsx / SheetJS (Excel,
 * pur JS), mammoth (Word .docx -> texte, pur JS). Tout fonctionne hors
 * ligne et sur Windows/macOS/Linux (aucun binaire natif).
 */

import { unzipSync } from "fflate";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Extensions acceptées DANS une archive ZIP (identiques à celles du
 * site + .zip imbriqué). Le PDF historique et les images restent les
 * mêmes que dans la route upload. */
export const ZIP_ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "xlsx",
  "xlsm",
  "xls",
  "docx",
  "zip", // archive imbriquée (profondeur max 2)
];

/** Profondeur maximale d'archives imbriquées (ZIP dans ZIP). */
export const ZIP_MAX_DEPTH = 2;

/** Nombre maximal de fichiers traités dans une archive (sécurité). */
export const ZIP_MAX_ENTRIES = 300;

/* ------------------------------------------------------------------ */
/* ZIP — extraction des entrées                                        */
/* ------------------------------------------------------------------ */

export interface ZipEntry {
  /** Chemin complet dans l'archive (ex. "janvier/fiche_01.pdf"). */
  name: string;
  /** Nom simple (sans dossier). */
  baseName: string;
  data: Buffer;
  size: number;
}

/**
 * Extrait les fichiers D'UNE archive ZIP (buffer) — fichiers uniquement
 * (les dossiers, __MACOSX, fichiers cachés et fichiers temporaires Office
 * « ~$… » sont ignorés). Triés par nom pour un ordre stable.
 */
export function unzipArchive(buffer: Buffer): ZipEntry[] {
  const entries = unzipSync(new Uint8Array(buffer));
  const out: ZipEntry[] = [];
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, "/");
    if (!name || name.endsWith("/")) continue; // dossier
    const baseName = name.split("/").pop() || name;
    if (baseName.startsWith(".")) continue; // caché (.DS_Store, …)
    if (baseName.startsWith("~$")) continue; // fichiers temporaires Office
    if (name.includes("__MACOSX")) continue;
    if (data.byteLength === 0) continue;
    out.push({
      name,
      baseName,
      data: Buffer.from(data),
      size: data.byteLength,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
  return out;
}

/** Extension minuscule d'un nom de fichier ("" si aucune). */
export function fileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/* ------------------------------------------------------------------ */
/* XLSX / XLS — 1 texte par FEUILLE                                    */
/* ------------------------------------------------------------------ */

export interface XlsxText {
  sheetNames: string[];
  /** 1 entrée par feuille : cellules séparées par des tabulations,
   * lignes par retours à la ligne (structure de tableau conservée,
   * comme le texte d'un PDF). */
  sheetTexts: string[];
}

/**
 * Lit un classeur Excel (.xlsx / .xlsm / .xls) et retourne le texte de
 * CHAQUE feuille. Les dates sont converties en texte lisible (jj/mm/aaaa)
 * pour rester compatibles avec les règles de période existantes.
 */
export function xlsxToSheetTexts(buffer: Buffer): XlsxText {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true, // dates en Date -> formatées ci-dessous
  });

  const sheetNames: string[] = [];
  const sheetTexts: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    sheetNames.push(name);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: "\t", blankrows: false });
    sheetTexts.push((csv || "").replace(/\r/g, "").trim());
  }
  return { sheetNames, sheetTexts };
}

/* ------------------------------------------------------------------ */
/* DOCX — extraction du texte                                          */
/* ------------------------------------------------------------------ */

/**
 * Extrait le TEXTE BRUT d'un document Word .docx (mammoth, pur JS).
 * Retourne une chaîne vide si rien n'est lisible.
 */
export async function docxToText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth") as typeof import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return ((result && result.value) || "").replace(/\r/g, "").trim();
}

/* ------------------------------------------------------------------ */
/* DOCX multi-fiches — découpe du texte par CIN                        */
/* ------------------------------------------------------------------ */

/**
 * Candidat CIN dans une ligne (pour DÉCOUPER uniquement — la détection
 * FINALE reste assurée par detectCin() du payslip-extractor, inchangée) :
 *  - 8 chiffres isolés (format tunisien) ;
 *  - NOUVEAU (Task 27) : 9 chiffres isolés (CIN tunisien récent,
 *    carte biométrique — ex. 140000911) ;
 *  - 1-2 lettres suivies de 4 à 8 chiffres (format marocain).
 */
const CIN_CANDIDATE_LINE =
  /(?:^|[^\dA-Za-z])(\d{8,9}|[A-Z]{1,2}\d{5,8})(?:[^\dA-Za-z]|$)/;

/**
 * Découpe un texte DOCX en BLOCS : chaque ligne contenant un candidat CIN
 * commence un nouveau bloc. Utilisé uniquement quand le document contient
 * PLUSIEURS fiches (≥ 2 CIN différents) — sinon le texte entier reste
 * utilisé tel quel (comportement mono-fiche).
 */
export function splitTextIntoCinBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (CIN_CANDIDATE_LINE.test(line)) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks.filter((b) => b.trim().length > 0);
}

/* ------------------------------------------------------------------ */
/* NOUVEAU (ajouté SANS modifier les fonctions ci-dessus) : classeurs  */
/* Excel « 1 bulletin par LIGNE » — une feuille tableau avec une ligne */
/* par employé (Matricule | Nom et prénom | … | N° CIN | Net à payer)  */
/* est DÉCOUPÉE en 1 fiche par ligne de données. Chaque ligne devient  */
/* un texte ÉTIQUETÉ « Libellé : valeur » (1 libellé par ligne) que    */
/* les règles de détection EXISTANTES lisent sans aucune modification  */
/* ("N° CIN : SPEC-0001" -> règle libellé CIN, "Net à payer : 1611"    */
/* -> règle net, etc.). Le contexte global du classeur (période de     */
/* paie, société…) est ajouté à CHAQUE ligne pour la période.          */
/* ------------------------------------------------------------------ */

/** Colonnes repères d'un en-tête de tableau de bulletins. */
const TABLE_HINTS: Array<[RegExp, number]> = [
  [/\bmatricule\b/i, 1],
  [/\bnom\b|\bpr[eé]nom\b/i, 1],
  [/\bcin\b|\bcnss\b/i, 1],
  [/\bnet\b|\bsalaire\b|\bbrut\b/i, 1],
  [/\bfonction\b|\bemploi\b|\bcat[eé]gorie\b/i, 0.5],
  [/\bp[eé]riode\b|\bmois\b/i, 0.5],
];

/**
 * Vrai si les cellules ressemblent à l'en-tête d'un tableau de bulletins
 * (≥ 2,5 colonnes repères reconnues).
 */
function looksLikeBulletinTableHeader(cells: string[]): boolean {
  const joined = cells.join(" | ");
  let score = 0;
  for (const [re, weight] of TABLE_HINTS) {
    if (re.test(joined)) score += weight;
  }
  return score >= 2.5;
}

/**
 * Étend les textes de feuilles : une feuille contenant un TABLEAU avec
 * PLUSIEURS lignes de données (≥ 2) est remplacée par AUTANT de textes
 * que de lignes ; les autres feuilles restent INCHANGÉES.
 * Retourne un tableau de textes (1 entrée = 1 fiche candidate).
 */
export function expandSheetTexts(sheetTexts: string[]): string[] {
  const out: string[] = [];

  // Contexte global du classeur : premières lignes SIMPLES (moins de 4
  // colonnes) des feuilles — société, période de paie, mentions légales…
  // Ces lignes ne font pas partie du tableau ; elles complètent chaque
  // fiche (ex. "Période de paie\t01/08/26 au 31/08/26" -> période).
  const contextLines: string[] = [];
  for (const sheet of sheetTexts) {
    for (const line of sheet.split("\n").slice(0, 12)) {
      const l = line.trim();
      if (!l) continue;
      if (l.split("\t").length >= 4) continue; // ligne de tableau -> ignorée
      if (contextLines.includes(l)) continue;
      contextLines.push(l);
    }
    if (contextLines.length >= 10) break;
  }
  const context = contextLines.slice(0, 10).join("\n");

  for (const sheet of sheetTexts) {
    const lines = sheet.split("\n");

    // 1) ligne d'en-tête du tableau (parmi les 15 premières lignes)
    let headerIdx = -1;
    let headerCells: string[] = [];
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const cells = lines[i].split("\t").map((c) => c.trim());
      if (cells.length >= 4 && looksLikeBulletinTableHeader(cells)) {
        headerIdx = i;
        headerCells = cells;
        break;
      }
    }
    if (headerIdx === -1) {
      out.push(sheet); // feuille sans tableau : INCHANGÉE
      continue;
    }

    // NOUVEAU (Task 28, additif) : garde « bulletin VERTICAL » —
    // l'explosion « 1 bulletin par LIGNE » n'a de sens que si l'en-tête
    // possède une colonne d'IDENTITÉ (N° CIN / N° CNSS) : chaque ligne
    // devient 1 fiche clé CIN. Un bulletin VERTICAL (1 fiche par feuille,
    // ex. « Matricule | Nom et Prénom | Fonction | Département » suivi des
    // rubriques Présence, Salaire de base…) RESSEMBLE à un en-tête de
    // tableau (score ≥ 2,5 via « Matricule » + « Nom » + « Fonction »)
    // mais n'a AUCUNE colonne CIN — l'exploser cassait le bulletin en
    // fragments sans identité et BLOQUAIT le découpage « 1 feuille = 1
    // fiche » (les 50 feuilles d'un classeur restaient collées en UNE
    // seule fiche). La feuille reste donc ENTIÈRE (comportement « 1 fiche
    // par feuille », identique aux autres formats) ; les VRAIS tableaux
    // par lignes (en-tête avec colonne « N° CIN » / « N° CNSS », ex.
    // bulletins_specimen_50.xlsx) restent explosés exactement comme avant.
    const hasIdentityColumn = headerCells.some((c) =>
      /\bc\.?\s*i\.?\s*n\.?\b|\bcnss\b/i.test(c)
    );
    if (!hasIdentityColumn) {
      out.push(sheet); // feuille-bulletin vertical : INCHANGÉE
      continue;
    }

    // 2) lignes de données (au moins la moitié des colonnes renseignées)
    //    — les lignes de TOTAL / sous-total sont EXCLUES (ce ne sont pas
    //    des bulletins : "\tTOTAL (50 bulletins)\t…\t88 442.636…").
    const minCells = Math.max(3, Math.floor(headerCells.length / 2));
    const rows: string[][] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cells = lines[i].split("\t").map((c) => c.trim());
      if (cells.filter(Boolean).length < minCells) continue;
      const isAggregate = cells
        .slice(0, 3)
        .some((c) =>
          /^\s*(?:grand\s+)?(?:sous-?total|total|totaux|somme)\b/i.test(c)
        );
      if (isAggregate) continue;
      rows.push(cells);
    }
    if (rows.length < 2) {
      out.push(sheet); // 0 ou 1 ligne : INCHANGÉE (comportement historique)
      continue;
    }

    // 3) 1 texte ÉTIQUETÉ par ligne de données : "Libellé : valeur" par
    // colonne, puis le contexte classeur (période, société…)
    const labels = headerCells.map((c) => c.replace(/\s+/g, " ").trim());
    for (const cells of rows) {
      const parts: string[] = [];
      for (let c = 0; c < labels.length; c++) {
        const label = labels[c];
        const value = (cells[c] || "").trim();
        if (!label || !value) continue;
        parts.push(`${label} : ${value}`);
      }
      const text =
        parts.join("\n") + (context ? `\n\n${context}` : "");
      if (text.trim()) out.push(text);
    }
  }
  return out;
}
