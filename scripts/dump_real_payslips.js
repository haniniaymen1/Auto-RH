#!/usr/bin/env node
/* Extrait le texte des vraies fiches uploadées pour analyser formats CIN + dates */
const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const path = require("path");

const DIR = "/home/z/my-project/upload/files_extrait";
const OUT = "/home/z/my-project/upload/texte_extrait";
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".pdf")).sort();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const parser = new PDFParse({ data: buf });
    try {
      const res = await parser.getText();
      const txt = (res.text || "").trim();
      fs.writeFileSync(path.join(OUT, f.replace(".pdf", ".txt")), txt);
      console.log(`${f} : ${txt.length} caractères, ${txt.split(/\n/).length} lignes`);
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
