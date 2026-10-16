const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");
(async () => {
  const dir = "/home/z/my-project/upload/zip2_extracted";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pdf")).sort();
  for (const f of files.slice(5)) {
    const buf = fs.readFileSync(path.join(dir, f));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const doc = await parser.getText();
    const lines = doc.text.replace(/\r/g, "").split("\n").map(l => l.replace(/\t/g, " | "));
    const i = lines.findIndex(l => /p[ée]riode/i.test(l));
    console.log(f, "=>", lines[i] ? "[" + lines[i].trim() + "]" : "NOT_FOUND", "||", lines[i+1] ? lines[i+1].trim() : "");
    await parser.destroy();
  }
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
