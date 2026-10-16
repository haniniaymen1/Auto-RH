/**
 * Task 110 — inspection préalable des vrais fichiers de l'utilisateur
 * (pages, texte, motifs CIN) AVANT test E2E sur la build 0.2.35.
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
    if (!fs.existsSync(f)) { console.log("ABSENT:", f); continue; }
    const taille = fs.statSync(f).size;
    console.log("\n=== " + path.basename(f) + " (" + taille + " octets) ===");
    try {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
      console.log("pages:", doc.numPages);
      // échantillonner les 2 premières pages + dernière
      const echantillon = [1, 2, doc.numPages];
      for (const p of [...new Set(echantillon)]) {
        if (p > doc.numPages) continue;
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const texte = tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ");
        console.log(`--- page ${p} (400 premiers caractères) ---`);
        console.log(texte.slice(0, 400));
        // motifs CIN candidats sur la page entière
        const cands = texte.match(/\b[A-Z]{0,2}\s?\d{6,10}\b/g) || [];
        console.log("candidats CIN page " + p + ":", cands.slice(0, 12).join(" | "));
      }
    } catch (e) {
      console.log("ERREUR lecture:", e.message);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
