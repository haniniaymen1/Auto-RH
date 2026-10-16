/**
 * ============================================================
 *  NOUVEAU (Task 24 — ajouté SANS modifier les modules existants)
 *  Découpage physique des CLASSEURS EXCEL multi-fiches en fiches
 *  INDIVIDUELLES.
 * ============================================================
 *
 *  Besoin utilisateur : « quand j'importe le fichier Excel, tu divises le
 *  fichier par fiche de paie et tu affectes chaque fiche de paie à son
 *  employé (clé = CIN), comme ça quand l'employé veut récupérer sa fiche
 *  de paie il la trouve au format Excel. »
 *
 *  Jusqu'ici, un classeur Excel multi-fiches produisait plusieurs
 *  ENREGISTREMENTS pointant vers le MÊME classeur complet : l'employé qui
 *  ouvrait « sa » fiche recevait donc TOUT le classeur (les fiches des
 *  autres employés incluses). Désormais, chaque fiche reçoit son PROPRE
 *  fichier Excel contenant uniquement SA feuille — le portail sert ce
 *  fichier individuel.
 *
 *  Bibliothèque : exceljs (manipulation 100 % locale, aucune dépendance
 *  réseau, aucune binaire natif — fonctionne sur Windows/macOS/Linux).
 *  ExcelJS est utilisé (et non SheetJS) pour une COPIE HAUTE FIDÉLITÉ :
 *  valeurs, formules, STYLES (polices, couleurs, bordures, fonds),
 *  FUSIONS de cellules, largeurs de colonnes / hauteurs de lignes et
 *  images (logos) sont conservés.
 *
 *  Les règles de DÉTECTION (CIN, employé, période…) restent celles de
 *  payslip-extractor.ts — ce module ne fait que COUPER.
 * ============================================================
 */
import ExcelJS from "exceljs";

/** Informations sur les feuilles d'un classeur (ordre physique). */
export interface ExcelSheetInfo {
  /** Index physique 0-based (ordre des onglets). */
  index: number;
  /** Nom de la feuille (onglet). */
  name: string;
  /** Vrai si la feuille contient au moins une cellule renseignée. */
  hasContent: boolean;
}

/** Paire « Libellé / Valeur » pour la génération d'une fiche étiquetée. */
export interface LabeledPair {
  label: string;
  value: string;
}

/**
 * Liste les feuilles d'un classeur Excel (ordre physique des onglets).
 * Retourne null si le classeur est illisible par ExcelJS (ex. ancien
 * format .xls) — l'appelant garde alors le comportement historique.
 */
export async function getExcelSheetInfos(
  buffer: Buffer
): Promise<ExcelSheetInfo[] | null> {
  try {
    const wb = new ExcelJS.Workbook();
    // (typage exceljs : son « Buffer » interne étend ArrayBuffer — le cast
    // est neutre à l'exécution, le Node Buffer est accepté tel quel)
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb.worksheets.map((ws, i) => {
      let hasContent = true; // en cas de doute : considérer renseignée
      try {
        hasContent = ws.actualRowCount > 0;
      } catch {
        // best effort — la feuille est conservée
      }
      return {
        index: i,
        name: ws.name || `Feuille ${i + 1}`,
        hasContent,
      };
    });
  } catch (e) {
    console.error(
      "[EXCEL-SPLIT] Classeur illisible par le découpeur:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Copie UNE feuille source dans un classeur destination — haute fidélité :
 * valeurs, formules, styles (polices, couleurs, bordures, formats de
 * nombre), fusions de cellules, largeurs de colonnes, hauteurs de lignes,
 * mise en page et images (logos). Étapes décorées « best effort » : la
 * moindre difficulté de style n'empêche JAMAIS la copie des valeurs.
 */
function copySheetInto(
  outWb: ExcelJS.Workbook,
  srcWb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet
): ExcelJS.Worksheet {
  const outWs = outWb.addWorksheet(ws.name || "Feuille", {
    properties: ws.properties
      ? (JSON.parse(JSON.stringify(ws.properties)) as ExcelJS.WorksheetProperties)
      : undefined,
    pageSetup: ws.pageSetup
      ? (JSON.parse(JSON.stringify(ws.pageSetup)) as Partial<ExcelJS.PageSetup>)
      : undefined,
    views: ws.views
      ? (JSON.parse(JSON.stringify(ws.views)) as ExcelJS.WorksheetView[])
      : undefined,
  });

  // Largeurs de colonnes (+ masquage, style par défaut de colonne)
  try {
    if (ws.columns && ws.columns.length) {
      outWs.columns = ws.columns.map((c) => ({
        width: c.width,
        hidden: c.hidden,
        style: c.style
          ? (JSON.parse(JSON.stringify(c.style)) as Partial<ExcelJS.Style>)
          : undefined,
      }));
    }
  } catch {
    // best effort — les largeurs ne bloquent jamais la copie
  }

  // Lignes + cellules : valeurs ET styles
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = outWs.getRow(rowNumber);
    try {
      if (row.height !== undefined) newRow.height = row.height;
      newRow.hidden = row.hidden;
    } catch {
      // best effort
    }
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      // valeur : texte, nombre, date, formule {formula, result}, texte riche…
      newCell.value = cell.value;
      try {
        if (cell.style && Object.keys(cell.style).length) {
          newCell.style = JSON.parse(
            JSON.stringify(cell.style)
          ) as ExcelJS.Style;
        }
      } catch {
        // best effort — la valeur reste copiée même si le style échoue
      }
    });
  });

  // Fusions de cellules (ex. bandeau « BULLETIN DE PAIE » sur A1:F1)
  try {
    const merges = (ws.model as { merges?: string[] } | undefined)?.merges;
    if (Array.isArray(merges)) {
      for (const m of merges) {
        try {
          outWs.mergeCells(m);
        } catch {
          // fusion atypique — ignorée
        }
      }
    }
  } catch {
    // best effort
  }

  // Images (logos d'en-tête…) — l'imageId référence le tableau media du
  // classeur SOURCE ; on recopie le média dans le classeur destination.
  try {
    const images = ws.getImages() as unknown as Array<{
      imageId: number;
      range: ExcelJS.ImageRange;
    }>;
    // (typage exceljs : son « Buffer » interne étend ArrayBuffer — le cast
    // est neutre à l'exécution, le Node Buffer est accepté tel quel)
    const media =
      ((srcWb.model as unknown as { media?: Array<{ extension?: string; buffer?: ArrayBuffer; base64?: string }> } | undefined)?.media) || [];
    for (const img of images) {
      const m = media[img.imageId];
      if (!m || (!m.buffer && !m.base64)) continue;
      const ext = (m.extension || "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
      const newId = outWb.addImage({
        buffer: m.buffer,
        base64: m.base64,
        extension: ext as "png" | "jpeg" | "gif",
      });
      outWs.addImage(newId, img.range);
    }
  } catch {
    // best effort — une image non recopiée n'empêche jamais l'import
  }

  return outWs;
}

/**
 * Extrait les feuilles [startSheet .. endSheet] (1-based, inclusives —
 * les numéros d'ONGLETS affichés dans Excel) d'un classeur et renvoie un
 * NOUVEAU classeur autonome contenant uniquement ces feuilles.
 *
 * - Les feuilles sont COPIÉES (le classeur source n'est pas altéré).
 * - Fidélité maximale : styles, fusions, dimensions, images (voir
 *   copySheetInto).
 * - Le résultat est TOUJOURS un .xlsx (lisible partout, y compris depuis
 *   un .xlsm/.xls source).
 *
 * Retourne null si le classeur est illisible ou si la plage est invalide —
 * l'appelant garde alors le comportement historique (fichier complet).
 */
export async function extractExcelSheetRange(
  buffer: Buffer,
  startSheet: number,
  endSheet: number
): Promise<Buffer | null> {
  try {
    if (
      !Number.isFinite(startSheet) ||
      !Number.isFinite(endSheet) ||
      startSheet < 1 ||
      endSheet < startSheet
    ) {
      return null;
    }
    const src = new ExcelJS.Workbook();
    // (typage exceljs : son « Buffer » interne étend ArrayBuffer — le cast
    // est neutre à l'exécution, le Node Buffer est accepté tel quel)
    await src.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheets = src.worksheets;
    if (!sheets.length) return null;
    const from = Math.max(0, startSheet - 1);
    const to = Math.min(sheets.length, endSheet) - 1;
    if (from > to || from >= sheets.length) return null;

    const out = new ExcelJS.Workbook();
    out.creator = "AutoRH";
    out.lastModifiedBy = "AutoRH";
    for (let i = from; i <= to; i++) {
      copySheetInto(out, src, sheets[i]);
    }
    if (!out.worksheets.length) return null;

    const bytes = await out.xlsx.writeBuffer();
    return Buffer.from(bytes as unknown as ArrayBuffer);
  } catch (e) {
    console.error(
      "[EXCEL-SPLIT] Découpage impossible (feuilles " +
        startSheet +
        "-" +
        endSheet +
        "):",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Génère une fiche Excel ÉTIQUETÉE « Libellé | Valeur » — utilisée quand
 * le bulletin est une LIGNE d'un tableau (« 1 bulletin par ligne ») : la
 * feuille contient alors PLUSIEURS employés, impossible de recopier « la
 * feuille de l'employé » sans emporter les salaires des autres. Chaque
 * employé reçoit donc un fichier Excel propre reprenant SES informations
 * (une ligne par libellé : Matricule, N° CIN, Net à payer…).
 *
 * - `title` : ligne de titre fusionnée (nom du fichier d'origine).
 * - `pairs` : paires libellé/valeur ; une paire SANS valeur (value === "")
 *   est rendue comme une ligne de contexte (société, période, mentions…).
 */
export async function buildLabeledExcel(
  title: string,
  pairs: LabeledPair[]
): Promise<Buffer | null> {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "AutoRH";
    wb.lastModifiedBy = "AutoRH";
    const ws = wb.addWorksheet("Fiche de paie");
    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 48;

    let r = 1;
    // Titre fusionné A:B
    const titleCell = ws.getCell(r, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { vertical: "middle" };
    try {
      ws.mergeCells(r, 1, r, 2);
    } catch {
      // best effort
    }
    ws.getRow(r).height = 22;
    r += 2;

    for (const p of pairs) {
      const label = (p.label || "").toString();
      const value = (p.value || "").toString();
      if (!label && !value) continue;
      if (!value) {
        // ligne de contexte (société, période de paie, mentions légales…)
        const c = ws.getCell(r, 1);
        c.value = label;
        c.font = { size: 10, color: { argb: "FF666666" } };
        try {
          ws.mergeCells(r, 1, r, 2);
        } catch {
          // best effort
        }
      } else {
        const lc = ws.getCell(r, 1);
        lc.value = label;
        lc.font = { bold: true, size: 11 };
        lc.alignment = { vertical: "middle" };
        const vc = ws.getCell(r, 2);
        vc.value = value;
        vc.alignment = { vertical: "middle" };
        const hair = {
          bottom: { style: "hair" as const, color: { argb: "FFCCCCCC" } },
        };
        lc.border = hair;
        vc.border = hair;
      }
      r++;
    }

    const bytes = await wb.xlsx.writeBuffer();
    return Buffer.from(bytes as unknown as ArrayBuffer);
  } catch (e) {
    console.error(
      "[EXCEL-SPLIT] Génération de la fiche étiquetée impossible:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
