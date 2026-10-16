#!/usr/bin/env node
/* Task 159 — Import du fichier réel FICHE 3879 EMPLOYE TEST 2026.PDF (9 fiches mensuelles) */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const FILE = '/home/z/my-project/tmp-transfernow/transfer_20260924GsjEuUV5/FICHE_3879_TEST_EMPLOYE_2026.PDF';

(async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
  });
  const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  console.log('login:', r.status);

  const buf = fs.readFileSync(FILE);
  const fd = new FormData();
  fd.append('files', new Blob([buf], { type: 'application/pdf' }), 'FICHE 3879 EMPLOYE TEST 2026.PDF');
  const t0 = Date.now();
  const ru = await fetch(BASE + '/api/payslips/upload', {
    method: 'POST', headers: { cookie: cookies }, body: fd, signal: AbortSignal.timeout(240000),
  });
  const j = await ru.json().catch(() => null);
  console.log('upload:', ru.status, 'en', ((Date.now() - t0) / 1000).toFixed(1), 's');
  if (j) {
    console.log('fiabilité:', JSON.stringify(j.fiabilite));
    console.log('anomaliesNoms:', j.anomaliesNoms);
    for (const res of (j.results || [])) {
      console.log(`- ${res.fileName}: ${res.status} — ${res.message?.slice(0, 110)}`);
      if (res.items?.length) {
        for (const it of res.items) {
          console.log(`    p.${it.page} → ${it.employeeName} | CIN ${it.cin} | ${it.period} | net ${it.netSalary}`);
        }
      } else if (res.id) {
        console.log(`    mono-fiche → ${res.employeeName} | CIN ${res.cin} | ${res.period} | net ${res.netSalary}`);
      }
    }
  } else {
    console.log((await ru.text()).slice(0, 300));
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
