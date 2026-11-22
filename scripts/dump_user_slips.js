const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const dir = "/home/z/my-project/upload/user_slips";
(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pdf")).sort();
  for (const f of files) {
    const parser = new PDFParse({ data: fs.readFileSync(path.join(dir, f)) });
    try {
      const r = await parser.getText();
      const text = (r.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
      console.log("===== " + f + " =====");
      console.log(JSON.stringify(text));
      console.log("");
    } finally { await parser.destroy().catch(()=>{}); }
  }
})();
