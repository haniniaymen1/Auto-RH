// Diagnostic Task 27 : reproduction de l'échec de détection CIN
// sur « bulletins_tunis_call_center_50_UNFICHIER (page 2) (1) (1).docx »
// Réplique FIDÈLE des règles actuelles de detectCin (payslip-extractor.ts)
// en JS pur — la vérification finale passera par l'API réelle.
const path = require("path");
const PROJECT = "/home/z/my-project";

async function main() {
  const mammoth = require(path.join(PROJECT, "node_modules/mammoth"));
  const file = process.argv[2] || path.join(PROJECT, "upload/bulletins_tunis_call_center_50_UNFICHIER (page 2) (1) (1).docx");
  const result = await mammoth.extractRawText({ path: file });
  const text = ((result && result.value) || "").replace(/\r/g, "").trim();
  console.log("=== TEXTE EXTRAIT (" + text.length + " car.) — 25 premières lignes ===");
  console.log(text.split("\n").slice(0, 25).join("\n"));
  console.log("=== FIN EXTRAIT ===\n");

  // ---- Règle 1-bis (labeledSep) ----
  function rule1bis(text) {
    const m = text.match(
      /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/i
    );
    if (!m) return null;
    const cleaned = m[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    const digits = cleaned.match(/^(\d{5,})$/);
    if (digits) return digits[1].slice(0, 8); // <-- TRONCATURE à 8 !
    if (/^[A-Z]{0,2}\d{5,8}$/.test(cleaned)) return cleaned;
    return null;
  }

  // ---- Règle 1 (labeled compact) ----
  function rule1(text) {
    const m = text.match(
      /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*[^A-Z0-9]{0,12}([A-Z]{0,2}\d{5,8})/i
    );
    return m ? m[1].toUpperCase() : null;
  }

  // ---- Règle 2 (8 chiffres isolé + exclusion CNSS clé même ligne) ----
  function rule2(text) {
    const tunisian = text.match(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/);
    if (!tunisian) return null;
    const afterCand = text.slice(
      tunisian.index + tunisian[0].length,
      tunisian.index + tunisian[0].length + 12
    );
    const cnssKey = afterCand.match(/^[ \t]*[-\/][ \t]*(\d{1,2})(?!\d)/);
    if (cnssKey) {
      const nl = text.indexOf("\n", tunisian.index);
      const line = text.slice(tunisian.index, nl === -1 ? undefined : nl);
      const all8 = [
        ...line.matchAll(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/g),
      ].filter((m) => m.index !== 0);
      for (const other of all8) {
        const afterOther = line.slice(
          other.index + other[0].length,
          other.index + other[0].length + 12
        );
        if (!/^[ \t]*[-\/][ \t]*(\d{1,2})(?!\d)/.test(afterOther)) return other[1];
      }
    }
    return tunisian[1];
  }

  // ---- Règle 5 (en-tête colonne N° CIN + jetons lettres-chiffres, 3 lignes) ----
  function rule5(text) {
    const CIN_COLUMN_HEADER =
      /(?:^|[^\dA-ZÀ-Þ])N\s*[°o]\s*C\.?\s*I\.?\s*N\.?(?:[^\dA-ZÀ-Þ]|$)/i;
    const CIN_TOKEN_IN_LINE = /\b([A-ZÀ-Þ]{2,15}-?\d{1,8})(?!\d)/g;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!CIN_COLUMN_HEADER.test(lines[i])) continue;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const valueLine = lines[j].trim();
        if (!valueLine) continue;
        const tokens = [...valueLine.matchAll(CIN_TOKEN_IN_LINE)].map((m) => m[1]);
        if (tokens.length > 0) return tokens[tokens.length - 1];
        break;
      }
    }
    return null;
  }

  // ---- detectCinFromTableContext (fenêtre 3 lignes, 5-10 chiffres) ----
  function tableCtx(text) {
    const CIN_HEADER = /(?:^|[^\dA-ZÀ-Þ])N\s*[°o]\s*C\.?\s*I\.?\s*N\.?(?:[^\dA-ZÀ-Þ]|$)/i;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!CIN_HEADER.test(lines[i])) continue;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const line = lines[j].trim();
        if (!line) continue;
        for (const m of line.matchAll(/(?<!\d)(\d{5,10})(?!\d)/g)) {
          const num = m[1];
          const start = m.index ?? 0;
          const after = line.slice(start + num.length, start + num.length + 6);
          if (/^[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.test(after)) continue;
          if (/^[ \t]*[,.]\d{3}(?!\d)/.test(after)) continue;
          if (start > 0 && /[,.]/.test(line.slice(start - 1, start))) continue;
          return num;
        }
        break;
      }
    }
    for (const line of text.split("\n")) {
      const cnss = /(?<!\d)(\d{8})[ \t]*(?:[-\/][ \t]*\d{1,2})(?!\d)/.exec(line);
      if (!cnss) continue;
      const from = cnss.index + cnss[0].length;
      const rest = line.slice(from);
      for (const m of rest.matchAll(/(?<!\d)(\d{5,10})(?!\d)/g)) {
        const num = m[1];
        const start = from + (m.index ?? 0);
        const after = line.slice(start + num.length, start + num.length + 6);
        if (/^[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.test(after)) continue;
        if (/^[ \t]*[,.]\d{3}(?!\d)/.test(after)) continue;
        if (start > 0 && /[,.]/.test(line.slice(start - 1, start))) continue;
        return num;
      }
    }
    return null;
  }

  console.log("=== REPRODUCTION DU CHEMIN DOCX (upload route) ===");
  const r1bis = rule1bis(text);
  const r1 = rule1(text);
  const r2 = rule2(text);
  const r5 = rule5(text);
  const ctx = tableCtx(text);
  console.log("Règle 1-bis (libellé + séparés) :", r1bis);
  console.log("Règle 1   (libellé compact)    :", r1);
  console.log("Règle 2   (1er 8 chiffres)     :", r2, r2 === "17700137" ? "  <-- N° CNSS ! (FAUX)" : "");
  console.log("Règle 5   (en-tête + jetons)   :", r5);
  console.log("TableCtx  (PDF/OCR, fenêtre 3) :", ctx);
  const current = r1bis || r1 || r2 || r5;
  console.log("\n>>> detectCin ACTUEL retourne :", current, current === "140000911" ? "(CORRECT)" : "(FAUX — attendu : 140000911)");
  console.log(">>> Arbitrage PDF/OCR (tableCtx) :", ctx || "(null) — l'arbitrage ne corrige pas : fenêtre 3 lignes < distance 7 lignes");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
