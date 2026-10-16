// Extrait le texte des 20 nouvelles fiches specimen pour analyse
const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = '/home/z/my-project/upload/new_slips';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).sort();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const res = await parser.getText();
    await parser.destroy();
    const text = res.text;
    console.log('='.repeat(70));
    console.log('FICHIER:', f, '— longueur texte:', text.length);
    console.log('-'.repeat(70));
    console.log(text);
  }
})().catch(e => { console.error('ERREUR:', e); process.exit(1); });
