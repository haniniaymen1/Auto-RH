const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");
(async () => {
  const dir = "/home/z/my-project/upload/zip2_extracted";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pdf")).sort();
  for (const f of files.slice(0, 6)) {
    const buf = fs.readFileSync(path.join(dir, f));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const doc = await parser.getText();
    const text = doc.text.replace(/\r/g, "");
    console.log("=".repeat(70));
    console.log("FILE:", f, "| lines:", doc.text.split("\n").length);
    console.log(text.split("\n").filter(l => l.trim()).slice(0, 30).join("\n"));
    await parser.destroy();
  }
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
