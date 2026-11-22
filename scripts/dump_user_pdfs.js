// Dump raw text of user's PDFs exactly as the site does (pdf-parse)
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DIR = '/home/z/my-project/upload/files_extracted';

(async () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.pdf')).sort();
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const res = await parser.getText();
    await parser.destroy();
    console.log('='.repeat(70));
    console.log('FILE:', f);
    console.log('-'.repeat(70));
    console.log(JSON.stringify(res.text)); // JSON to reveal exact spacing/line breaks
    console.log();
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
