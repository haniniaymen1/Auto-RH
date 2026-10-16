import { PDFParse } from 'pdf-parse';

async function main() {
  // 1. Image PDF (PNG->PDF)
  const p1 = '/home/z/my-project/upload/spec_pdf/pdf/bulletin_900001_BELHADJ_SANA.pdf';
  const d1 = new PDFParse({ data: require('fs').readFileSync(p1) });
  const r1 = await d1.getText();
  console.log('=== IMAGE PDF (bulletin_900001) text length:', r1.text.length);
  console.log(JSON.stringify(r1.text.slice(0, 300)));
  await d1.destroy();

  // 2. Multi-bulletin PDF
  const p2 = '/home/z/my-project/upload/bulletins_specimen_50.pdf';
  const d2 = new PDFParse({ data: require('fs').readFileSync(p2) });
  const info2 = await d2.getInfo().catch(() => null);
  const r2 = await d2.getText();
  console.log('\n=== MULTI PDF (bulletins_specimen_50.pdf) text length:', r2.text.length, 'pages:', r2.pages?.length ?? 'n/a');
  console.log(JSON.stringify(r2.text.slice(0, 400)));
  await d2.destroy();

  // 3. XLSX - peek at raw strings
  const xlsx = require('/home/z/my-project/node_modules/xlsx') ?? null;
  console.log('\nxlsx module available:', !!xlsx);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
