#!/usr/bin/env node
/**
 * Task 160b — Test de GÉNÉRALISATION : les correctifs s'appliquent-ils à
 * TOUS les bulletins de même structure (pas seulement le fichier testé) ?
 *
 * Méthode : upload via l'API réelle de 2 corpus de même structure mais
 * JAMAIS testés ensemble, puis comparaison champ à champ avec une vérité
 * terrain indépendante (parsée par un analyseur Python distinct).
 *   Corpus A : 9 périodes du même employé (janv→août 2026)
 *   Corpus B : 20 employés différents (même structure, période 08/2026)
 * Puis nettoyage intégral des fiches créées (delete-many) et retour au
 * compte initial.
 */
const BASE = 'http://localhost:4000';
const fs = require('fs');

const VERITE = JSON.parse(fs.readFileSync('/home/z/my-project/tmp-testgen/verite_terrain.json', 'utf8'));
let cookie = '';

function normNum(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  const f = parseFloat(t);
  return isNaN(f) ? null : Math.round(f * 1000) / 1000;
}
function normTxt(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}
function normPeriod(s) {
  const m = String(s || '').match(/(\d{2}\/\d{2}\/\d{2,4}).*?(\d{2}\/\d{2}\/\d{2,4})/s);
  if (!m) return null;
  const cut = (d) => d.length === 10 ? d.slice(0, 8) : d; // garde JJ/MM/AA
  return `${cut(m[1])}|${cut(m[2])}`;
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
  });
  const sc = r.headers.get('set-cookie') || '';
  cookie = sc.split(';')[0];
  if (!cookie) throw new Error('login échoué ' + r.status);
  return r.status;
}

async function totalFiches() {
  const r = await fetch(BASE + '/api/payslips?page=1&pageSize=1', { headers: { cookie } });
  const j = await r.json();
  return j.total ?? j.pagination?.total ?? null;
}

async function upload(filePath, label) {
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(filePath)], { type: 'application/pdf' }), filePath.split('/').pop());
  const r = await fetch(BASE + '/api/payslips/upload', { method: 'POST', headers: { cookie }, body: fd });
  const j = await r.json();
  const res0 = j?.results?.[0] || {};
  const items = res0.items || (res0.id ? [{ id: res0.id, cin: res0.cin, employeeName: res0.employeeName, period: res0.period, netSalary: res0.netSalary, matricule: res0.matricule }] : []);
  console.log(`  [${label}] HTTP ${r.status} -> ${items.length} fiche(s) créée(s)`);
  if (!items.length) console.log('  réponse:', JSON.stringify(j).slice(0, 300));
  return items;
}

function comparer(items, gt, label) {
  const champs = ['employeeName', 'cin', 'period', 'netSalary', 'matricule'];
  const stats = {}; champs.forEach((c) => (stats[c] = { ok: 0, ko: 0, detail: [] }));
  const n = Math.min(items.length, gt.length);
  for (let i = 0; i < n; i++) {
    const it = items[i], g = gt[i];
    for (const c of champs) {
      let ok;
      if (c === 'period') ok = normPeriod(it.period) === normPeriod(g.period);
      else if (c === 'netSalary') ok = normNum(it.netSalary) === normNum(g.netSalary) && normNum(g.netSalary) !== null;
      else ok = normTxt(it[c]) === normTxt(g[c]) && normTxt(g[c]) !== '';
      stats[c][ok ? 'ok' : 'ko']++;
      if (!ok && stats[c].detail.length < 3)
        stats[c].detail.push(`p${g.page} attendu="${g[c]}" obtenu="${it[c]}"`);
    }
  }
  console.log(`\n=== Concordance ${label} (${n} fiches) ===`);
  for (const c of champs) {
    const pct = n ? Math.round((100 * stats[c].ok) / n) : 0;
    console.log(`  ${c.padEnd(14)}: ${stats[c].ok}/${n} (${pct} %)`);
    stats[c].detail.forEach((d) => console.log(`      ${d}`));
  }
  return stats;
}

(async () => {
  console.log(`Login : HTTP ${await login()}`);
  const base = await totalFiches();
  console.log(`Compte initial : ${base} fiches`);

  console.log('\n--- Upload Corpus A (9 périodes, même employé) ---');
  const itemsA = await upload('/home/z/my-project/tmp-transfernow/transfer_20260924GsjEuUV5/FICHE_3879_TEST_EMPLOYE_2026.PDF', 'A');
  console.log('\n--- Upload Corpus B (20 employés différents) ---');
  const itemsB = await upload('/home/z/my-project/tmp-testgen/corpus_20_employes.pdf', 'B');

  const sA = comparer(itemsA, VERITE.A, 'CORPUS A — 9 périodes');
  const sB = comparer(itemsB, VERITE.B, 'CORPUS B — 20 employés');

  // ---- matricule : absent de items[] -> vérifié via l'API détail ----
  async function completerMatricule(items, gt) {
    let ok = 0, n = 0;
    for (let i = 0; i < Math.min(items.length, gt.length); i++) {
      const r = await fetch(`${BASE}/api/payslips/${items[i].id}`, { headers: { cookie } });
      if (!r.ok) continue;
      const d = await r.json();
      n++;
      if (normTxt(d.matricule) === normTxt(gt[i].matricule)) ok++;
      else console.log(`      matricule p${gt[i].page} attendu="${gt[i].matricule}" obtenu="${d.matricule}"`);
    }
    return { ok, n };
  }
  console.log('\n=== Matricule (via API détail) ===');
  const mA = await completerMatricule(itemsA, VERITE.A);
  const mB = await completerMatricule(itemsB, VERITE.B);
  console.log(`  Corpus A      : ${mA.ok}/${mA.n} (${mA.n ? Math.round((100 * mA.ok) / mA.n) : 0} %)`);
  console.log(`  Corpus B      : ${mB.ok}/${mB.n} (${mB.n ? Math.round((100 * mB.ok) / mB.n) : 0} %)`);

  // ---- Nettoyage ----
  const ids = [...itemsA, ...itemsB].map((x) => x.id).filter(Boolean);
  console.log(`\n--- Nettoyage : ${ids.length} fiches de test ---`);
  if (ids.length) {
    const chk = await fetch(`${BASE}/api/payslips/${ids[0]}`, { headers: { cookie } });
    console.log(`  vérif id[0] via API détail : HTTP ${chk.status}`);
    for (let i = 0; i < ids.length; i += 50) {
      const lot = ids.slice(i, i + 50);
      const r = await fetch(BASE + '/api/payslips/delete-many', {
        method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lot }),
      });
      console.log(`  lot ${Math.floor(i / 50) + 1}: HTTP ${r.status} (${lot.length} ids) -> ${await r.text()}`);
    }
  }
  const apres = await totalFiches();
  console.log(`\nCompte final : ${apres} (attendu ${base}) -> ${apres === base ? 'RESTAURÉ ✔' : 'ANOMALIE ✘'}`);

  // ---- Verdict ----
  // NB : le champ matricule n'est PAS exposé dans items[] de la réponse
  // d'upload (limitation de format) -> seuls les 4 autres champs sont
  // comparés ici ; le matricule est validé séparément via l'API détail.
  let globalOk = 0, globalAll = 0, koChamps = [];
  const champs = ['employeeName', 'cin', 'period', 'netSalary'];
  for (const c of champs) {
    globalOk += sA[c].ok + sB[c].ok;
    globalAll += sA[c].ok + sA[c].ko + sB[c].ok + sB[c].ko;
    if (sA[c].ko + sB[c].ko > 0) koChamps.push(c);
  }
  const matOk = mA.ok + mB.ok, matAll = mA.n + mB.n;
  globalOk += matOk; globalAll += matAll;
  if (matOk < matAll) koChamps.push('matricule');
  console.log(`\n==== VERDICT GLOBAL : ${globalOk}/${globalAll} champs exacts (${Math.round((100 * globalOk) / globalAll)} %) ===`);
  console.log(`Champs avec écarts : ${koChamps.length ? koChamps.join(', ') : 'AUCUN'}`);
  fs.writeFileSync('/home/z/my-project/tmp-testgen/resultats.json', JSON.stringify({ sA, sB, mA, mB, base, apres, globalOk, globalAll }, null, 1));
})().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
