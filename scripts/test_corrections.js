#!/usr/bin/env node
/* Task 158-b — Correction des 4 points : structure réponse upload,
 * re-test téléchargement, nettoyage global par fenêtre temporelle. */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const FILE = '/home/z/my-project/tmp-transfernow/fichiers/exemple_fiche_paie_sage.pdf';

(async () => {
  // login
  let r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
  });
  const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  // 1) upload test → structure complète de la réponse
  const buf = fs.readFileSync(FILE);
  const fd = new FormData();
  fd.append('files', new Blob([buf]), 'exemple_fiche_paie_sage.pdf');
  r = await fetch(BASE + '/api/payslips/upload', { method: 'POST', headers: { cookie: cookies }, body: fd });
  const j = await r.json();
  console.log('=== STRUCTURE RÉPONSE UPLOAD ===');
  console.log(JSON.stringify(j, null, 1).slice(0, 1500));
  const items = j?.results?.[0]?.items || j?.results?.[0]?.created_items || [];
  console.log(`\nresults[0].items : ${items.length} élément(s)`);
  const idsUpload = items.map(it => it.id).filter(Boolean);
  console.log('IDs:', idsUpload);

  // 2) re-test téléchargement avec un ID vivant
  if (idsUpload[0]) {
    const rd = await fetch(`${BASE}/api/payslips/${idsUpload[0]}/file`, { headers: { cookie: cookies } });
    const b = Buffer.from(await rd.arrayBuffer());
    const estPdf = b.subarray(0, 5).toString() === '%PDF-';
    console.log(`\n=== RE-TEST DOWNLOAD === HTTP ${rd.status}, ${b.length} octets, PDF=${estPdf} => ${rd.status === 200 && estPdf ? 'PASS' : 'FAIL'}`);
  }
  // téléchargement d'une fiche EMPLOYE existante (backup : 1re des 208)
  const rl = await fetch(BASE + '/api/payslips?cin=12345678&limit=1', { headers: { cookie: cookies } });
  const jl = await rl.json();
  const idEmploye = jl.items?.[0]?.id;
  if (idEmploye) {
    const rd = await fetch(`${BASE}/api/payslips/${idEmploye}/file`, { headers: { cookie: cookies } });
    const b = Buffer.from(await rd.arrayBuffer());
    const estPdf = b.subarray(0, 5).toString() === '%PDF-';
    console.log(`Download fiche EMPLOYE ${idEmploye}: HTTP ${rd.status}, ${b.length} octets, PDF=${estPdf} => ${rd.status === 200 && estPdf ? 'PASS' : 'FAIL'}`);
  }

  // 3) suppression de la fiche du test structure
  if (idsUpload.length) {
    const rd = await fetch(BASE + '/api/payslips/delete-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ ids: idsUpload }),
    });
    console.log('\nSuppression fiche test structure:', rd.status, JSON.stringify(await rd.json().catch(() => ({}))));
  }
  console.log('\nFIN PHASE A — les fiches des 9 uploads précédents seront nettoyées en phase B (fenêtre temporelle).');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
