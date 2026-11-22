// Diagnostic: what text does pdf-parse get from the user's problematic PDF?
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire("/home/z/my-project/package.json");

async function main() {
  const { PDFParse } = await import("pdf-parse");
  const pdfPath = "/home/z/my-project/upload/Docs From Bh225_260914145812 (1)-1.pdf";
  const dataBuffer = fs.readFileSync(pdfPath);
  console.log("File size:", dataBuffer.length, "bytes");

  const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
  try {
    const result = await parser.getText();
    const text = result.text || "";
    console.log("=== TEXT LENGTH:", text.length, "===");
    if (text.trim().length === 0) {
      console.log(">>> TEXT IS EMPTY → image-type PDF (no text layer) confirmed");
    } else {
      console.log("=== RAW TEXT (first 3000 chars) ===");
      console.log(text.slice(0, 3000));
      console.log("=== END ===");
      // show total pages
      console.log("Pages:", result.pages?.length ?? "n/a");
    }
  } finally {
    await parser.destroy();
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
