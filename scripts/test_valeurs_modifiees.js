#!/usr/bin/env node
/**
 * Task 164 — Preuve « même si on change le CIN et les noms » :
 * 1) contrôle hors ligne avec pdf-parse (le MÊME moteur que le serveur)
 * 2) import RÉEL sur le site de la fiche modifiée
 * 3) comparaison des valeurs extraites avec les NOUVELLES valeurs
 * 4) nettoyage complet (delete-many) et retour au compte initial
 */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const PDF = '/home/z/my-project/tmp-testgen/fiche_valeurs_modifiees.pdf';

// Valeurs ANCIENNES (TMAR AZIZ) vs NOUVELLES (injectées dans le PDF)
const ATTENDU = {
  matricule: '118866',
  employeeName: 'BEN ALI MEHDI',
  cin: '09765432',
  netSalary: '1431,179',                    // inchangé (doit rester exact)
  period: 'du 01/08/26 au 31/08/26',        // inchangé (doit rester exact)
};
const ANCIENS = { employeeName: 'TMAR AZIZ', cin: '80012134', matricule: '294452' };

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

(async () => {
  let ok = true;

  // ---- 1) Contrôle hors ligne (pdf-parse = moteur du serveur) ----
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: fs.readFileSync(PDF) });
  const rp = await parser.getText();
  const txt = rp.pages[0].text || rp.text;
  await parser.destroy();
  console.log('--- 1) Contrôle hors ligne (pdf-parse) ---');
  for (const [c, v] of Object.entries(ATTENDU)) {
    if (c === 'netSalary' || c === 'period') continue;
    const present = normTxt(txt).includes(normTxt(v));
    ok &= present;
    console.log(`  nouveau ${c.padEnd(12)} "${v}" présent dans le texte : ${present ? 'OUI' : 'NON'}`);
  }
  for (const [c, v] of Object.entries(ANCIENS)) {
    const absent = !normTxt(txt).includes(normTxt(v));
    ok &= absent;
    console.log(`  ancien  ${c.padEnd(12)} "${v}" absent du texte      : ${absent ? 'OUI' : 'NON'}`);
  }

  // ---- 2) Import réel sur le site ----
  console.log('\n--- 2) Import réel sur le site ---');
  await login();
  const base = await totalFiches();
  console.log(`  Compte initial : ${base} fiches`);
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(PDF)], { type: 'application/pdf' }), 'fiche_valeurs_modifiees.pdf');
  const rup = await fetch(BASE + '/api/payslips/upload', { method: 'POST', headers: { cookie }, body: fd });
  const jup = await rup.json();
  const res0 = jup?.results?.[0] || {};
  const items = res0.items || (res0.id ? [res0] : []);
  console.log(`  Upload : HTTP ${rup.status} -> ${items.length} fiche(s) créée(s)`);
  ok &= items.length === 1;
  if (!items.length) { console.log('  réponse:', JSON.stringify(jup).slice(0, 300)); process.exit(1); }

  // ---- 3) Valeurs extraites (API détail) vs NOUVELLES valeurs ----
  console.log('\n--- 3) Valeurs extraites par le site vs NOUVELLES valeurs ---');
  const id = items[0].id;
  const d = await (await fetch(`${BASE}/api/payslips/${id}`, { headers: { cookie } })).json();
  const verdicts = [];
  const cmp = (c, obtenu, attendu, egal) => {
    verdicts.push({ c, obtenu, attendu, ok: egal });
    ok &= egal;
    console.log(`  ${c.padEnd(12)}: obtenu="${obtenu}"  attendu="${attendu}"  ${egal ? 'EXACT ✔' : 'ÉCART ✘'}`);
  };
  cmp('matricule', d.matricule, ATTENDU.matricule, normTxt(d.matricule) === normTxt(ATTENDU.matricule));
  cmp('employeeName', d.employeeName, ATTENDU.employeeName, normTxt(d.employeeName) === normTxt(ATTENDU.employeeName));
  cmp('cin', d.cin, ATTENDU.cin, normTxt(d.cin) === normTxt(ATTENDU.cin));
  cmp('netSalary', d.netSalary, ATTENDU.netSalary, normNum(d.netSalary) === normNum(ATTENDU.netSalary) && normNum(ATTENDU.netSalary) !== null);
  cmp('period', d.period, ATTENDU.period, normPeriod(d.period) === normPeriod(ATTENDU.period));
  // aucun ancien résiduel ?
  for (const [c, v] of Object.entries(ANCIENS)) {
    const residu = normTxt(String(d[c] || '')) === normTxt(v);
    if (residu) { ok = false; console.log(`  ✘ ANCIENNE valeur résiduelle détectée sur ${c}`); }
  }

  // ---- 4) Nettoyage ----
  console.log('\n--- 4) Nettoyage ---');
  const rdel = await fetch(BASE + '/api/payslips/delete-many', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });
  const jdel = await rdel.json().catch(() => ({}));
  console.log(`  delete-many : HTTP ${rdel.status} -> ${JSON.stringify(jdel)}`);
  ok &= jdel.deleted === 1;
  const apres = await totalFiches();
  console.log(`  Compte final : ${apres} (attendu ${base}) -> ${apres === base ? 'RESTAURÉ ✔' : 'ANOMALIE ✘'}`);
  ok &= apres === base;

  console.log(`\n==== VERDICT : ${ok ? 'LE SITE A LU LES NOUVELLES VALEURS — 5/5 CHAMPS EXACTS ✔' : 'ÉCART DÉTECTÉ ✘'} ====`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
