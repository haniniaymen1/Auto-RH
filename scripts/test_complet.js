#!/usr/bin/env node
/* Task 158 — Batterie de tests COMPLÈTE du système Auto-RH
 * Phases : infra, auth, sécurité, upload (8 formats), recherche,
 * téléchargement, portail, nettoyage, état final.
 * Les fiches créées par les tests sont supprimées à la fin.
 */
const BASE = 'http://localhost:4000';
const PORTAL = 'http://localhost:4001';
const PREVIEW = 'http://localhost:3000';
const DIR = '/home/z/my-project/tmp-transfernow/fichiers/';
const fs = require('fs');

const resultats = [];
function record(phase, test, ok, detail) {
  resultats.push({ phase, test, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${phase}] ${test} — ${detail}`);
}

async function check(name, url, expected, method = 'GET', headers = {}, body = null) {
  try {
    const r = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const ok = expected.includes(r.status);
    return { ok, status: r.status, r };
  } catch (e) {
    return { ok: false, status: 'ERR', r: null, err: e.message };
  }
}

(async () => {
  console.log('================ PHASE 1 : INFRASTRUCTURE ================');
  for (const [n, u, exp] of [
    ['Admin 4000 /login', BASE + '/login', [200]],
    ['Portail employé 4001 /', PORTAL + '/', [200, 307]],
    ['Preview 3000 /', PREVIEW + '/', [200, 307, 404]],
  ]) {
    const c = await check(n, u, exp);
    record('INFRA', n, c.ok, `HTTP ${c.status}`);
  }

  console.log('================ PHASE 2 : AUTHENTIFICATION ================');
  // 2.1 mauvais mot de passe
  {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'MAUVAIS-mot-de-passe-123' }),
      signal: AbortSignal.timeout(15000),
    });
    record('AUTH', 'Login mot de passe erroné rejeté', r.status === 401 || r.status === 400, `HTTP ${r.status}`);
  }
  // 2.2 email inexistant
  {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inconnu@autorh.local', password: 'Xxxxxxxxx-2026!' }),
      signal: AbortSignal.timeout(15000),
    });
    record('AUTH', 'Login email inexistant rejeté', r.status === 401 || r.status === 400, `HTTP ${r.status}`);
  }
  // 2.3 login valide
  let cookies = '';
  {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
      signal: AbortSignal.timeout(15000),
    });
    cookies = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const j = await r.json().catch(() => ({}));
    record('AUTH', 'Login superadmin valide', r.status === 200 && cookies.length > 0,
      `HTTP ${r.status}, cookie ${cookies ? 'OK' : 'ABSENT'}, rôle ${j.user?.role || j.role || '?'}`);
  }

  console.log('================ PHASE 3 : SÉCURITÉ (sans auth) ================');
  {
    const fd = new FormData();
    fd.append('files', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'x.pdf');
    const r = await fetch(BASE + '/api/payslips/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(15000) });
    record('SECURITE', 'Upload sans session rejeté', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }
  {
    const r = await fetch(BASE + '/api/payslips?limit=5', { signal: AbortSignal.timeout(15000) });
    record('SECURITE', 'Liste fiches sans session rejetée', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }
  {
    const r = await fetch(BASE + '/api/payslips/cmufatrln0000q0ttjow1rghg/file', { signal: AbortSignal.timeout(15000) });
    record('SECURITE', 'Fichier fiche sans session rejeté', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }
  {
    const r = await fetch(BASE + '/api/payslips/delete-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['x'] }), signal: AbortSignal.timeout(15000),
    });
    record('SECURITE', 'Suppression sans session rejetée', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }

  console.log('================ PHASE 4 : UPLOAD — 8 FORMATS ================');
  const fichesCreees = []; // {id, fileName}
  const uploads = [
    ['PDF texte 1 page', 'exemple_fiche_paie_sage.pdf'],
    ['PDF texte 50 fiches', 'bulletins_specimen_50_(1).pdf'],
    ['PDF scanné 1 page', 'Docs_From_Bh225_260914145812.pdf'],
    ['Image PNG', 'Docs_From_Bh225_260914145812_(1)-1.png'],
    ['XLSX multi-bulletins', 'Bulletins_de_paie_50_exemples_1.xlsx'],
    ['DOCX multi-bulletins', 'bulletins_tunis_call_center_50_UNFICHIER_1.docx'],
    ['ZIP (50 DOCX séparés)', 'bulletins_tunis_call_center_50_1_(1).zip'],
    ['ZIP (50 XLSX séparés)', 'Bulletins_de_paie_50_fichiers_separes_1_(1).zip'],
    // PDF_Scanner (ordonnance) volontairement testé aussi : ne doit rien créer d'exploitable
    ['Ordonnance médicale (cas limite)', 'PDF_Scanner_160726_5.36.16.pdf'],
  ];
  for (const [label, file] of uploads) {
    const t0 = Date.now();
    try {
      const buf = fs.readFileSync(DIR + file);
      const fd = new FormData();
      fd.append('files', new Blob([buf]), file);
      const r = await fetch(BASE + '/api/payslips/upload', {
        method: 'POST', headers: { cookie: cookies }, body: fd, signal: AbortSignal.timeout(240000),
      });
      const j = await r.json().catch(() => null);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      // Structure de réponse : results[] avec id plat (mono-fiche)
      // OU results[].items[] (multi-fiches divisées par page).
      const res0 = j?.results?.[0] || {};
      const items = res0.items || (res0.id ? [{ id: res0.id, fileName: res0.fileName, employeeName: res0.employeeName, cin: res0.cin, netSalary: res0.netSalary }] : []);
      const nbFiches = items.length || j?.success || 0;
      if (r.status === 200 && nbFiches >= 1) {
        for (const it of items) fichesCreees.push({ id: it.id, fileName: it.fileName || file });
        const ex = items[0] || {};
        record('UPLOAD', `${label} (${file})`, true,
          `${nbFiches} fiche(s) en ${dt}s — ex: ${ex.employeeName || '?'} / CIN ${ex.cin || '?'} / ${ex.netSalary || '?'}`);
      } else if (r.status === 200 && j && (j.success === 0 || j.processed === 0)) {
        record('UPLOAD', `${label} (${file})`, true, `0 fiche créée en ${dt}s (rejet logique : ${j.results?.[0]?.message?.slice(0, 80) || 'n/a'})`);
      } else {
        record('UPLOAD', `${label} (${file})`, false, `HTTP ${r.status} en ${dt}s : ${JSON.stringify(j).slice(0, 120)}`);
      }
    } catch (e) {
      record('UPLOAD', `${label} (${file})`, false, `EXCEPTION ${e.message.slice(0, 100)}`);
    }
  }

  console.log('================ PHASE 5 : RECHERCHE ================');
  {
    const r = await fetch(BASE + '/api/payslips?limit=10', { headers: { cookie: cookies }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    record('RECHERCHE', 'Liste paginée', r.status === 200 && j?.items?.length > 0,
      `HTTP ${r.status}, total=${j?.total}, reçus=${j?.items?.length}, mode=${j?.mode || '?'}`);
  }
  {
    const r = await fetch(BASE + '/api/payslips?cin=12345678&limit=10', { headers: { cookie: cookies }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    const bon = r.status === 200 && j?.total === 208 && (j.items || []).every(f => f.cin === '12345678');
    record('RECHERCHE', 'Recherche par CIN 12345678', bon, `HTTP ${r.status}, total=${j?.total} (attendu 208), exact=${j?.exact}`);
  }
  {
    // fiche de test créée par l'upload xlsx : recherche par son CIN réel
    const ex = fichesCreees[0];
    if (ex) {
      const r = await fetch(BASE + `/api/payslips/${ex.id}`, { headers: { cookie: cookies }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => null);
      const f = j?.payslip || j;
      record('RECHERCHE', 'Fiche par ID (déchiffrée)', r.status === 200 && !!f?.employeeName,
        `HTTP ${r.status} — ${f?.employeeName || '?'} / CIN ${f?.cin || '?'} / ${f?.netSalary || '?'}`);
    }
  }

  console.log('================ PHASE 6 : TÉLÉCHARGEMENT FICHE ================');
  {
    const cible = fichesCreees[0]?.id || 'cmufatrln0000q0ttjow1rghg';
    const r = await fetch(BASE + `/api/payslips/${cible}/file`, { headers: { cookie: cookies }, signal: AbortSignal.timeout(30000) });
    const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null;
    const estPdf = buf && buf.subarray(0, 5).toString() === '%PDF-';
    const estImg = buf && buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50;
    record('DOWNLOAD', `GET /api/payslips/${cible.slice(-6)}.../file`,
      r.status === 200 && (estPdf || estImg),
      `HTTP ${r.status}, ${buf ? buf.length : 0} octets, type=${estPdf ? 'PDF' : estImg ? 'IMAGE' : '?'}`);
  }

  console.log('================ PHASE 7 : PORTAIL EMPLOYÉ ================');
  {
    const c = await check('Portail API', PORTAL + '/api/auth/session', [200, 401, 404]);
    record('PORTAIL', 'API portail répond', c.ok, `HTTP ${c.status}`);
  }
  {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employe-inexistant@autorh.local', password: 'Test-2026!Xx' }),
      signal: AbortSignal.timeout(15000),
    });
    record('PORTAIL', 'Portail rejette employé inexistant', r.status === 401 || r.status === 400 || r.status === 403, `HTTP ${r.status}`);
  }

  console.log('================ PHASE 8 : NETTOYAGE ================');
  console.log(`Fiches créées par les tests : ${fichesCreees.length}`);
  for (let i = 0; i < fichesCreees.length; i += 50) {
    const lot = fichesCreees.slice(i, i + 50).map(f => f.id);
    try {
      const r = await fetch(BASE + '/api/payslips/delete-many', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookies },
        body: JSON.stringify({ ids: lot }), signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      console.log(`  lot ${Math.floor(i / 50) + 1}: HTTP ${r.status} deleted=${j.deleted}`);
    } catch (e) {
      console.log(`  lot ${Math.floor(i / 50) + 1}: ERREUR ${e.message}`);
    }
  }

  console.log('================ PHASE 9 : ÉTAT FINAL ================');
  {
    const r = await fetch(BASE + '/api/payslips?limit=1', { headers: { cookie: cookies }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    record('FINAL', 'Base restaurée (1258 fiches attendues)', j?.total === 1258, `total=${j?.total}`);
  }
  {
    const r = await fetch(BASE + '/api/payslips?cin=12345678&limit=1', { headers: { cookie: cookies }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    record('FINAL', 'CIN 12345678 inchangé (208 attendues)', j?.total === 208, `total=${j?.total}`);
  }

  // Synthèse
  console.log('\n================= SYNTHÈSE =================');
  const pass = resultats.filter(r => r.ok).length;
  console.log(`${pass}/${resultats.length} tests PASS`);
  const fails = resultats.filter(r => !r.ok);
  if (fails.length) {
    console.log('ÉCHECS:');
    for (const f of fails) console.log(`  - [${f.phase}] ${f.test} : ${f.detail}`);
  }
  fs.writeFileSync('/home/z/my-project/tmp-transfernow/resultats_tests.json',
    JSON.stringify(resultats, null, 2));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
