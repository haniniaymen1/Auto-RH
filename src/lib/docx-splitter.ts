/**
 * ============================================================
 *  NOUVEAU (Task 25 — ajouté SANS modifier les modules existants)
 *  Découpage physique des documents WORD (.docx) multi-fiches
 *  en fiches INDIVIDUELLES.
 * ============================================================
 *
 *  Besoin utilisateur : « le fichier docx contient plusieurs pages,
 *  chaque page contient une fiche de paie. Quand j'importe le fichier
 *  DOCX, l'application le divise en fiches de paie individuelles et
 *  affecte chaque fiche à l'employé correspondant (clé = CIN). Ainsi
 *  l'employé récupère sa fiche de paie au format DOCX. »
 *
 *  Jusqu'ici (comportement historique conservé en repli), un DOCX
 *  multi-fiches produisait plusieurs ENREGISTREMENTS pointant vers le
 *  MÊME fichier complet : l'employé qui ouvrait « sa » fiche recevait
 *  donc TOUT le document (les fiches des autres incluses). Désormais,
 *  chaque fiche reçoit son PROPRE fichier Word contenant uniquement
 *  SES pages — le portail sert ce fichier individuel.
 *
 *  PRINCIPE TECHNIQUE (haute fidélité, 100 % local) :
 *   - un .docx est une archive ZIP dont « word/document.xml » décrit
 *     le corps du document (suite d'éléments <w:p>, <w:tbl>…) ;
 *   - le corps est découpé en ÉLÉMENTS DE PREMIER NIVEAU (scanner
 *     XML à comptage de profondeur — les <w:p> imbriqués des tableaux
 *     ne perturbent pas la découpe) ;
 *   - les éléments sont regroupés en « PAGES » aux mêmes endroits que
 *     Word :
 *       1. saut de page explicite  <w:br w:type="page"/> ;
 *       2. saut de section         <w:sectPr> dans un paragraphe ;
 *       3. (à défaut) marqueur de rendu <w:lastRenderedPageBreak/> ;
 *       4. (à défaut) début d'un nouveau CIN candidat — même règle
 *          que splitTextIntoCinBlocks() du découpage texte historique ;
 *   - chaque fichier individuel est reconstruit en COPIANT l'intégralité
 *     de l'archive originale et en remplaçant uniquement
 *     word/document.xml : styles, polices, en-têtes/pieds de page,
 *     numérotation et images restent identiques à l'original ;
 *   - les règles de DÉTECTION (CIN, employé, période…) restent celles
 *     de payslip-extractor.ts — ce module ne fait que COUPER.
 * ============================================================
 */
import JSZip from "jszip";

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

/** Un « page » du document : éléments XML regroupés + texte visible. */
export interface DocxPageGroup {
  /** XML concaténé des éléments de premier niveau de cette page. */
  xml: string;
  /** Texte visible (1 ligne par paragraphe), même esprit que mammoth. */
  text: string;
}

/** Document découpé en pages. */
export interface DocxPageSplit {
  /** Pages dans l'ordre du document (1 groupe par page logique). */
  pages: DocxPageGroup[];
}

/* ------------------------------------------------------------------ */
/* Outils XML                                                          */
/* ------------------------------------------------------------------ */

/** Balise XML : ouvrante, fermante ou auto-fermante (attributs gérés,
 * y compris valeurs contenant « > » entre guillemets). Les attributs
 * sont LAZY : le « / » final d'une balise auto-fermante (<w:br/>) reste
 * capturé par le groupe 4 au lieu d'être avalé par les attributs. */
const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;

/** Décode les entités XML d'un contenu <w:t>. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Extrait les ÉLÉMENTS DE PREMIER NIVEAU d'un fragment XML (le contenu
 * de <w:body>) : scanner à comptage de profondeur — chaque élément qui
 * fait passer la profondeur de 0 à 1 ouvre un élément de premier niveau,
 * refermé quand la profondeur revient à 0. Retourne null si le XML est
 * malformé (l'appelant garde alors le comportement historique).
 */
function topLevelElements(bodyXml: string): string[] | null {
  const out: string[] = [];
  const re = new RegExp(TAG_RE.source, "g");
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyXml)) !== null) {
    const full = m[0];
    const closing = m[1] === "/";
    const selfClose = m[4] === "/";
    if (closing) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(bodyXml.slice(start, m.index + full.length));
        start = -1;
      }
      if (depth < 0) return null; // balise fermante orpheline
    } else if (!selfClose) {
      if (depth === 0) start = m.index;
      depth++;
    }
    // auto-fermante : aucun changement de profondeur
  }
  if (depth !== 0) return null; // XML malformé
  return out;
}

/** Segments d'un paragraphe : texte <w:t>, tabulation <w:tab/>, saut <w:br/>. */
const PARA_SEG_RE =
  /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/?>/g;

/** Paragraphe <w:p> (y compris auto-fermé) — les paragraphes ne
 * s'imbriquent JAMAIS entre eux (structure OOXML). */
const PARA_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;

/**
 * Texte visible d'un élément XML : 1 ligne par paragraphe (les cellules
 * de tableaux produisent leurs propres lignes, comme mammoth). Les
 * tabulations et sauts deviennent des séparateurs intra-ligne.
 */
function elementLines(xml: string): string[] {
  const lines: string[] = [];
  const re = new RegExp(PARA_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1] ?? ""; // paragraphe auto-fermé : vide
    let text = "";
    const segRe = new RegExp(PARA_SEG_RE.source, "g");
    let seg: RegExpExecArray | null;
    while ((seg = segRe.exec(inner)) !== null) {
      if (seg[1] !== undefined) text += decodeXmlEntities(seg[1]);
      else if (seg[0].startsWith("<w:tab")) text += "\t";
      else text += " "; // <w:br/> (ligne ou page) : séparateur
    }
    lines.push(text.trim());
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Marqueurs de fin / début de page                                    */
/* ------------------------------------------------------------------ */

/** Saut de page explicite (Ctrl+Entrée / générateurs Word). */
const EXPLICIT_PAGE_BREAK_RE = /<w:br\b[^>]*type\s*=\s*["']page["']/;
/** Marqueur de rendu inséré par Word (position de début d'une nouvelle page). */
const RENDERED_BREAK_RE = /<w:lastRenderedPageBreak\b/;
/** Saut de SECTION dans un paragraphe (implique un changement de page). */
const SECT_PR_RE = /<w:sectPr[\s>]/;

/** Candidat CIN dans une ligne — MÊME règle que splitTextIntoCinBlocks()
 * de payslip-office.ts (découpage texte historique DOCX) : la détection
 * FINALE reste assurée par detectCin(), inchangée.
 * MODIFIÉ (Task 27) : \d{8,9} — les CIN tunisiens récents comptent
 * 9 chiffres (carte biométrique, ex. 140000911) : sans cette extension
 * la ligne du CIN n'était jamais reconnue comme début de page/fiche et
 * detectCin() retenait le N° CNSS « 17700137 - 04 » à sa place. */
export const CIN_CANDIDATE_LINE_RE =
  /(?:^|[^\dA-Za-z])(\d{8,9}|[A-Z]{1,2}\d{5,8})(?:[^\dA-Za-z]|$)/;

/** Version GLOBALE (comptage de tous les candidats d'un texte). */
const CIN_CANDIDATE_GLOBAL_RE =
  /(?:^|[^\dA-Za-z])(\d{8,9}|[A-Z]{1,2}\d{5,8})(?:[^\dA-Za-z]|$)/g;

/**
 * Nombre de CANDIDATS CIN DISTINCTS d'un texte — garde de confidentialité
 * du découpage Word (une page contenant 2 CIN différents ne doit jamais
 * être recopiée dans un fichier individuel).
 *
 * Les faux positifs identifiés par les règles HISTORIQUES de detectCin()
 * sont EXCLUS (mêmes exclusions, aucune règle modifiée) :
 *  - N° CNSS « 17775208 - 08 » : 8 chiffres immédiatement suivis d'un
 *    séparateur « - » ou « / » et d'une clé de 1-2 chiffres ;
 *  - montants décimaux « 12500000,000 » : nombre suivi de « , » ou « . »
 *    + exactement 3 chiffres (millièmes).
 */
export function countDistinctCinCandidates(text: string): number {
  const found = new Set<string>();
  const re = new RegExp(CIN_CANDIDATE_GLOBAL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // le candidat (m[1]) est encadré par les frontières consommées par
    // m[0] : on localise sa position EXACTE pour inspecter avant/après
    const candStart = m.index + m[0].indexOf(m[1]);
    const candEnd = candStart + m[1].length;
    const after = text.slice(candEnd, candEnd + 12);
    // N° CNSS : « - 08 » / « /8 » juste après (clé de 1-2 chiffres)
    if (/^[ \t]*[-\/][ \t]*\d{1,2}(?!\d)/.test(after)) continue;
    // montant décimal : « ,000 » / « .000 » juste après
    if (/^[,.]\d{3}(?!\d)/.test(after)) continue;
    // partie décimale d'un montant JUSTE AVANT (« ,190 » collé)
    const before = text.slice(Math.max(0, candStart - 1), candStart);
    if (before === "," || before === ".") continue;
    found.add(m[1].toUpperCase());
  }
  return found.size;
}

/* ------------------------------------------------------------------ */
/* Classification d'un élément de premier niveau                       */
/* ------------------------------------------------------------------ */

interface BodyElement {
  xml: string;
  lines: string[];
  isParagraph: boolean;
  /** <w:br w:type="page"/> : la page se termine APRÈS cet élément. */
  hasExplicitPageBreak: boolean;
  /** <w:lastRenderedPageBreak/> : cet élément DÉBUTE une nouvelle page. */
  hasRenderedBreak: boolean;
  /** Paragraphe porteur d'un <w:sectPr> : fin de section/page. */
  hasSectionBreak: boolean;
  /** Un des paragraphes de l'élément commence par un candidat CIN. */
  hasCinCandidate: boolean;
}

function classifyElement(xml: string): BodyElement {
  const isParagraph = /^<w:p[\s/>]/.test(xml);
  return {
    xml,
    lines: elementLines(xml),
    isParagraph,
    hasExplicitPageBreak: EXPLICIT_PAGE_BREAK_RE.test(xml),
    hasRenderedBreak: RENDERED_BREAK_RE.test(xml),
    hasSectionBreak: isParagraph && SECT_PR_RE.test(xml),
    hasCinCandidate: isParagraph && elementLines(xml).some((l) => CIN_CANDIDATE_LINE_RE.test(l)),
  };
}

/* ------------------------------------------------------------------ */
/* Groupement des éléments en « pages »                                */
/* ------------------------------------------------------------------ */

/**
 * Regroupe les éléments en pages logiques, dans l'ordre des fin de page
 * reconnues (priorité : sauts explicites > marqueurs de rendu > CIN).
 * Retourne null si moins de 2 pages (rien à découper de façon fiable).
 */
function groupElementsIntoPages(elements: BodyElement[]): BodyElement[][] | null {
  const hasExplicit = elements.some(
    (e) => e.hasExplicitPageBreak || e.hasSectionBreak
  );
  const hasRendered = !hasExplicit && elements.some((e) => e.hasRenderedBreak);

  const groups: BodyElement[][] = [];
  let current: BodyElement[] = [];
  const close = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  };

  if (hasExplicit) {
    // Convention Word : le saut se produit APRÈS l'élément qui le porte
    // (paragraphe de fin de page — souvent vide). Un paragraphe porteur
    // d'un <w:sectPr> clôt également sa section.
    for (const el of elements) {
      current.push(el);
      if (el.hasExplicitPageBreak || el.hasSectionBreak) close();
    }
    close();
  } else if (hasRendered) {
    // Word insère <w:lastRenderedPageBreak/> au DÉBUT de la première
    // course de la nouvelle page : l'élément porteur OUVRE une page.
    for (const el of elements) {
      if (el.hasRenderedBreak && current.length > 0) close();
      current.push(el);
    }
    close();
  } else {
    // Aucun marqueur de page : repli « MÊME règle que le découpage texte
    // historique » — chaque paragraphe contenant un candidat CIN ouvre
    // un nouveau bloc (le préambule avant le 1er CIN reste un bloc).
    for (const el of elements) {
      if (el.hasCinCandidate && current.length > 0) close();
      current.push(el);
    }
    close();
  }

  const pages = groups.filter((g) =>
    g.some((el) => el.lines.some((l) => l.length > 0))
  );
  return pages.length >= 2 ? pages : null;
}

/* ------------------------------------------------------------------ */
/* Lecture de l'archive                                                */
/* ------------------------------------------------------------------ */

const DOC_XML_PATH = "word/document.xml";

interface DocxParsed {
  /** Archive ouverte (lecture des autres entrées pour la recopie). */
  zip: JSZip;
  /** Tout ce qui précède le contenu de <w:body> (déclaration XML,
   * <w:document …>, <w:body>). */
  prefix: string;
  /** Tout ce qui suit le contenu de <w:body> (</w:body></w:document>). */
  suffix: string;
  /** Éléments de premier niveau du corps, classifiés. */
  elements: BodyElement[];
  /** <w:sectPr> final du corps (mise en page du document). */
  finalSectPr: string | null;
}

async function parseDocx(buffer: Buffer): Promise<DocxParsed | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const docEntry = zip.file(DOC_XML_PATH);
  if (!docEntry) return null;
  let xml: string;
  try {
    xml = await docEntry.async("string");
  } catch {
    return null;
  }
  const bodyOpen = xml.indexOf("<w:body>");
  const bodyClose = xml.lastIndexOf("</w:body>");
  if (bodyOpen < 0 || bodyClose <= bodyOpen) return null;

  const prefix = xml.slice(0, bodyOpen + "<w:body>".length);
  const suffix = xml.slice(bodyClose);
  const bodyXml = xml.slice(bodyOpen + "<w:body>".length, bodyClose);

  const rawElements = topLevelElements(bodyXml);
  if (!rawElements || rawElements.length === 0) return null;

  const elements = rawElements.map(classifyElement);

  // <w:sectPr> FINAL du corps : dernier élément de premier niveau s'il
  // s'agit d'une balise sectPr (structure Word standard).
  let finalSectPr: string | null = null;
  if (elements.length > 0 && /^<w:sectPr[\s>]/.test(elements[elements.length - 1].xml)) {
    finalSectPr = elements[elements.length - 1].xml;
    elements.pop();
  }

  return { zip, prefix, suffix, elements, finalSectPr };
}

/* ------------------------------------------------------------------ */
/* API publique 1 — découpage en pages                                 */
/* ------------------------------------------------------------------ */

/**
 * Découpe un document Word en « pages » logiques (voir l'en-tête du
 * module). Retourne null si le document est illisible, malformé ou si
 * moins de 2 pages sont identifiables — l'appelant garde alors le
 * comportement historique (fichier complet partagé).
 */
export async function getDocxPageGroups(
  buffer: Buffer
): Promise<DocxPageSplit | null> {
  try {
    const parsed = await parseDocx(buffer);
    if (!parsed) return null;
    const grouped = groupElementsIntoPages(parsed.elements);
    if (!grouped) return null;
    return {
      pages: grouped.map((els) => ({
        xml: els.map((e) => e.xml).join(""),
        text: els
          .flatMap((e) => e.lines)
          .filter((l) => l.length > 0)
          .join("\n"),
      })),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* API publique 2 — extraction d'une plage de pages                    */
/* ------------------------------------------------------------------ */

/**
 * Extrait les pages [startPage .. endPage] (1-based, inclusives) du
 * document et renvoie un NOUVEAU .docx AUTONOME contenant uniquement
 * ces pages :
 *   - l'intégralité de l'archive originale est COPIÉE (styles, polices,
 *     numérotation, en-têtes/pieds, images) ; seul word/document.xml
 *     est réécrit — fidélité maximale ;
 *   - la mise en page (<w:sectPr>) est conservée : celle de la SECTION
 *     de la plage si la page se termine par un saut de section, sinon
 *     le <w:sectPr> final du document original ;
 *   - le document source n'est jamais altéré.
 *
 * Retourne null si le document est illisible ou si la plage est
 * invalide — l'appelant garde alors le comportement historique.
 */
export async function extractDocxPageRange(
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
    const parsed = await parseDocx(buffer);
    if (!parsed) return null;
    const grouped = groupElementsIntoPages(parsed.elements);
    if (!grouped) return null;
    const from = Math.max(1, startPage) - 1;
    const to = Math.min(grouped.length, endPage) - 1;
    if (from > to || from >= grouped.length) return null;

    const rangeElements = grouped.slice(from, to + 1);
    let bodyContent = rangeElements.map((els) => els.map((e) => e.xml).join("")).join("");

    // Mise en page de la plage : si la DERNIÈRE page se termine par un
    // paragraphe porteur de <w:sectPr>, on utilise CE sectPr (mise en
    // page de la section concernée) et on le retire du paragraphe — le
    // fichier individuel reste à section unique (pas de page blanche).
    let sectPrToUse = parsed.finalSectPr;
    const lastEl = [...rangeElements[rangeElements.length - 1]].pop();
    if (lastEl && lastEl.isParagraph && SECT_PR_RE.test(lastEl.xml)) {
      const m = lastEl.xml.match(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/);
      if (m) {
        sectPrToUse = m[0];
        // retire le sectPr du paragraphe (les autres propriétés pPr
        // sont conservées) — DERNIÈRE occurrence dans la dernière page
        const idx = bodyContent.lastIndexOf(m[0]);
        if (idx >= 0) {
          bodyContent =
            bodyContent.slice(0, idx) + bodyContent.slice(idx + m[0].length);
        }
      }
    }

    const newXml = parsed.prefix + bodyContent + (sectPrToUse ?? "") + parsed.suffix;

    // Reconstruction de l'archive : toutes les entrées originales sont
    // recopiées À L'IDENTIQUE, seul word/document.xml est remplacé.
    const out = new JSZip();
    for (const name of Object.keys(parsed.zip.files)) {
      if (name === DOC_XML_PATH) continue;
      const entry = parsed.zip.files[name];
      if (entry.dir) continue; // dossiers implicites recréés par out.file()
      const data = await entry.async("nodebuffer");
      out.file(name, data, { compression: "DEFLATE" });
    }
    out.file(DOC_XML_PATH, newXml, { compression: "DEFLATE" });
    const result = await out.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}
