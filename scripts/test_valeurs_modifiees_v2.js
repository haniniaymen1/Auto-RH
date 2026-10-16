#!/usr/bin/env node
/**
 * Task 164 v2 — Preuve « même si on change le CIN et les noms » :
 * Phase A : nettoyage des 19 fiches orphelines du 1er essai (fenêtre temporelle
 *           dynamique = 10 min avant la plus récente), retour à 1267 fiches
 * Phase B : import propre du PDF 1 page modifié (BEN ALI MEHDI / 09765432 /
 *           118866), vérification 5 champs via réponse d'upload (+ détail pour
 *           le matricule), suppression, retour à 1267
 */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const PDF = '/home/z/my-project/tmp-testgen/fiche_valeurs_modifiees.pdf';

const ATTENDU = {
  matricule: '118866',
  employeeName: 'BEN ALI MEHDI',
  cin: '09765432',
  netSalary: '1431,179',
  period: 'du 01/08/26 au 31/08/26',
};

let cookie = '';
const normTxt = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const normNum = (s) => { const t = String(s ?? '').replace(/\s/g, '').replace(',', '.'); const f = parseFloat(t); return isNaN(f) ? null : Math.round(f * 1000) / 1000; };
const normPeriod = (s) => { const m = String(s || '').match(/(\d{2}\/\d{2}\/\d{2,4}).*?(\d{2}\/\d{2}\/\d{2,4})/s); if (!m) return null; const c = (d) => (d.length === 10 ? d.slice(0, 8) : d); return `${c(m[1])}|${c(m[2])}`; };

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
  });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('login échoué ' + r.status);
}
const totalFiches = async () => {
  const j = await (await fetch(BASE + '/api/payslips?page=1&pageSize=1', { headers: { cookie } })).json();
  return j.total ?? j.pagination?.total ?? null;
};
async function listerPage(page) {
  const r = await fetch(`${BASE}/api/payslips?page=${page}&limit=100`, { headers: { cookie } });
  return r.json();
}
const tsDe = (it) => it.uploadedAt || it.createdAt || it.uploaded_at || '';
const nomDe = (it) => it.employeeName || it.employee_name || it.nom || '';

(async () => {
  await login();

  // ================= PHASE A : NETTOYAGE DES ORPHELINS =================
  console.log('===== PHASE A : nettoyage des fiches de test orphelines =====');
  let j1 = await listerPage(1);
  const exemple = (j1.items || [])[0] || {};
  console.log('  champs liste :', Object.keys(exemple).join(', '));
  const tsRef = tsDe(exemple);
  const ageMin = (Date.now() - Date.parse(tsRef)) / 60000;
  if (ageMin > 10) {
    console.log(`  Plus récente fiche : ${ageMin.toFixed(0)} min -> rien de récent à nettoyer, Phase A ignorée`);
  } else {
  const cutoff = new Date(Date.parse(tsRef) - 10 * 60 * 1000).toISOString().slice(0, 16);
  console.log(`  plus récente : "${nomDe(exemple)}" (${tsRef}) -> coupure = ${cutoff}`);

  const orphelins = [];
  for (let p = 1; p <= 30; p++) {
    const j = p === 1 ? j1 : await listerPage(p);
    const items = j.items || [];
    let stop = false;
    for (const it of items) {
      if (tsDe(it) >= cutoff) orphelins.push(it); else { stop = true; break; }
    }
    if (stop || !j.hasMore) break;
  }
  console.log(`  ${orphelins.length} fiche(s) dans la fenêtre :`);
  orphelins.forEach((it) => console.log(`    - ${nomDe(it)} | CIN ${it.cin} | ${it.id}`));
  const employe = orphelins.filter((it) => normTxt(nomDe(it)).includes('EMPLOYE'));
  if (employe.length) { console.log('  ✘ SÉCURITÉ : fiches EMPLOYE détectées dans la fenêtre, nettoyage annulé'); process.exit(2); }
  if (orphelins.length) {
    let supprimes = 0;
    for (let i = 0; i < orphelins.length; i += 50) {
      const lot = orphelins.slice(i, i + 50).map((x) => x.id);
      const r = await fetch(BASE + '/api/payslips/delete-many', {
        method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lot }),
      });
      const jd = await r.json().catch(() => ({}));
      supprimes += jd.deleted || 0;
      console.log(`  lot ${Math.floor(i / 50) + 1}: HTTP ${r.status} -> ${JSON.stringify(jd)}`);
    }
    console.log(`  Supprimés : ${supprimes}/${orphelins.length}`);
  }
  const apresA = await totalFiches();
  console.log(`  Compte après Phase A : ${apresA} (attendu 1267) ${apresA === 1267 ? '✔' : '✘'}`);
  }

  // ================= PHASE B : TEST PROPRE (1 PAGE) =================
  console.log('\n===== PHASE B : import du PDF 1 page aux valeurs modifiées =====');
  const base = await totalFiches();
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(PDF)], { type: 'application/pdf' }), 'fiche_valeurs_modifiees.pdf');
  const rup = await fetch(BASE + '/api/payslips/upload', { method: 'POST', headers: { cookie }, body: fd });
  const jup = await rup.json();
  const res0 = jup?.results?.[0] || {};
  const items = res0.items || (res0.id ? [res0] : []);
  console.log(`  Upload : HTTP ${rup.status} -> ${items.length} fiche(s)`);
  if (items.length !== 1) { console.log('  réponse:', JSON.stringify(jup).slice(0, 400)); process.exit(1); }
  const fiche = items[0];
  console.log('  fiche créée :', JSON.stringify(fiche).slice(0, 400));

  let ok = true;
  console.log('\n  --- Valeurs extraites vs NOUVELLES valeurs injectées ---');
  const cmp = (c, obtenu, attendu, egal) => {
    ok &= egal;
    console.log(`  ${c.padEnd(12)}: obtenu="${obtenu}"  attendu="${attendu}"  ${egal ? 'EXACT ✔' : 'ÉCART ✘'}`);
  };
  cmp('employeeName', fiche.employeeName, ATTENDU.employeeName, normTxt(fiche.employeeName) === normTxt(ATTENDU.employeeName));
  cmp('cin', fiche.cin, ATTENDU.cin, normTxt(fiche.cin) === normTxt(ATTENDU.cin));
  cmp('netSalary', fiche.netSalary, ATTENDU.netSalary, normNum(fiche.netSalary) === normNum(ATTENDU.netSalary) && normNum(ATTENDU.netSalary) !== null);
  cmp('period', fiche.period, ATTENDU.period, normPeriod(fiche.period) === normPeriod(ATTENDU.period));
  const rdet = await fetch(`${BASE}/api/payslips/${fiche.id}`, { headers: { cookie } });
  if (rdet.ok) {
    const d = await rdet.json();
    cmp('matricule', d.matricule, ATTENDU.matricule, normTxt(d.matricule) === normTxt(ATTENDU.matricule));
  } else {
    console.log(`  matricule   : API détail HTTP ${rdet.status} — comparé via liste si présent`);
    cmp('matricule', fiche.matricule, ATTENDU.matricule, normTxt(fiche.matricule) === normTxt(ATTENDU.matricule));
  }

  console.log('\n  --- Nettoyage Phase B ---');
  const rdel = await fetch(BASE + '/api/payslips/delete-many', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [fiche.id] }),
  });
  const jd = await rdel.json().catch(() => ({}));
  console.log(`  delete-many : HTTP ${rdel.status} -> ${JSON.stringify(jd)}`);
  ok &= (jd.deleted === 1);
  const finale = await totalFiches();
  console.log(`  Compte final : ${finale} (attendu ${base}) ${finale === base ? 'RESTAURÉ ✔' : 'ANOMALIE ✘'}`);
  ok &= finale === base;

  console.log(`\n==== VERDICT FINAL : ${ok ? 'LE SITE A LU LES NOUVELLES VALEURS (CIN, NOM, MATRICULE MODIFIÉS) ✔' : 'ÉCART DÉTECTÉ ✘'} ====`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
