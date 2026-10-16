#!/usr/bin/env node
/* Task 158-c — Nettoyage global : supprimer TOUTES les fiches uploadées
 * après l'état de référence (1258 fiches, fin Task 157). */
const { PrismaClient } = require('@prisma/client');
const BASE = 'http://localhost:4000';
const p = new PrismaClient();

(async () => {
  // 1) distribution des uploads récents pour identifier la fenêtre
  const recents = await p.payslip.findMany({
    orderBy: { uploadedAt: 'desc' }, take: 300,
    select: { id: true, uploadedAt: true },
  });
  const parMinute = {};
  for (const f of recents) {
    const k = f.uploadedAt.toISOString().slice(0, 16);
    parMinute[k] = (parMinute[k] || 0) + 1;
  }
  console.log('Uploads par minute (plus récents en premier):');
  const entrees = Object.entries(parMinute);
  for (const [k, v] of entrees.slice(0, 12)) console.log(`  ${k} → ${v}`);
  // afficher la coupure
  if (entrees.length > 12) console.log('  ...');
  for (const [k, v] of entrees.slice(12, 18)) console.log(`  ${k} → ${v}`);

  // 2) fenêtre de test = tout ce qui est >= seuil. Le test complet a commencé
  //    après 09:10 UTC ; le test structure vers 09:2x. Sécurité : seuil 09:09 UTC.
  const SEUIL = new Date('2026-09-24T09:09:00.000Z');
  const cibles = await p.payslip.findMany({
    where: { uploadedAt: { gte: SEUIL } },
    select: { id: true, uploadedAt: true },
  });
  console.log(`\nSeuil: ${SEUIL.toISOString()} → ${cibles.length} fiche(s) de test à supprimer`);
  const min = cibles.reduce((a, f) => f.uploadedAt < a ? f.uploadedAt : a, new Date(8640000000000000));
  const max = cibles.reduce((a, f) => f.uploadedAt > a ? f.uploadedAt : a, new Date(0));
  console.log(`  fenêtre réelle: ${min.toISOString()} → ${max.toISOString()}`);

  if (cibles.length === 0) { console.log('Rien à supprimer.'); return p.$disconnect(); }

  // 3) suppression par lots via l'API (pour passer par la logique métier + storage)
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif' }),
  });
  const cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const ids = cibles.map(f => f.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50);
    const r = await fetch(BASE + '/api/payslips/delete-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ ids: lot }),
    });
    const j = await r.json().catch(() => ({}));
    deleted += j.deleted || 0;
    console.log(`  lot ${Math.floor(i / 50) + 1}: HTTP ${r.status} deleted=${j.deleted}/${lot.length}`);
  }

  // 4) état final
  const total = await p.payslip.count();
  console.log(`\nSupprimé: ${deleted} | Total final DB: ${total} (attendu 1258)`);
  await p.$disconnect();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
