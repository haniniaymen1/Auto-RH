/**
 * Task 110 — inspection approfondie : les pages sont-elles des images (scans) ?
 */
const path = require("path");
const fs = require("fs");
const ROOT = "/home/z/my-project/task104_specimen/app";

async function main() {
  const pdfjs = await import("file://" + path.join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"));
  const fichiers = [
    "/home/z/my-project/upload/copies_150_one_pdf.pdf",
    "/home/z/my-project/upload/DocsFromBh225_260914145812_200_copies.pdf",
  ];
  for (const f of fichiers) {
    console.log("\n=== " + path.basename(f) + " ===");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    console.log("page 1 dimensions:", Math.round(vp.width), "x", Math.round(vp.height), "pt");
    const ops = await page.getOperatorList();
    const compteur = {};
    for (const op of ops.fnArray) {
      const nom = pdfjs.OPS[op];
      compteur[nom] = (compteur[nom] || 0) + 1;
    }
    const pertinents = Object.entries(compteur).filter(([k]) => /image|fill|show/i.test(k));
    console.log("opérateurs pertinents page 1:", JSON.stringify(pertinents));
    // taille des images embarquées
    let imgs = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) imgs++;
    }
    console.log("images peintes page 1:", imgs);
    // ressources communes : check xobject sur qq pages
    for (const p of [2, 3]) {
      const pg = await doc.getPage(p);
      const o2 = await pg.getOperatorList();
      let im2 = 0;
      for (const op of o2.fnArray) if (op === pdfjs.OPS.paintImageXObject) im2++;
      const t2 = await pg.getTextContent();
      console.log(`page ${p}: images=${im2}, items texte=${t2.items.length}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
