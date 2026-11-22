#!/usr/bin/env node
/* RESTAURATION EN MASSE depuis v0.2.138 :
 *  - restaure tous les fichiers PERDUS (absents du code actuel)
 *  - restaure les fichiers DIFF non touchés par les Tasks 178-181
 *  - IGNORE les fichiers de FUSION (traités séparément)
 * Le répertoire d'audit (v02138) reste la source intouchable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const A = '/home/z/my-project/audit-versions/v02138';
const B = '/home/z/my-project';

// Fichiers à FUSIONNER manuellement (Tasks 178-181) — NE PAS écraser
const FUSION = new Set([
  'prisma/schema.prisma',
  'src/lib/demandes.ts',
  'src/lib/db-crypto.ts',
  'src/app/api/demandes/[id]/route.ts',
  'src/app/api/demandes/[id]/repondre/route.ts',
  'src/app/api/demandes/route.ts',
  'src/app/api/demandes/[id]/documents/[docId]/route.ts',
  'scripts/portail-server.js',
  'src/components/payslip/demandes-tab.tsx',
  'package.json',
]);

const EXCL_DIRS = new Set(['node_modules', '.next', '.git', 'download', 'storage', 'tool-results',
  'audit-versions', 'home', '.zscripts', 'db', 'dev.log', 'agent-ctx', '.turbo']);
const EXCL_FILES = /\.(log|db|db-wal|db-shm|sqlite|pid|tmp)$/i;

function walk(root, base, out) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      if (EXCL_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else {
      if (EXCL_FILES.test(e.name)) continue;
      out.set(rel, full);
    }
  }
  return out;
}
function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

const aFiles = walk(A, A, new Map());
const bFiles = walk(B, B, new Map());

let restaures = 0, ignoresFusion = 0, dejaIdentiques = 0;
const logRestaures = [], logFusion = [];

for (const [rel, src] of aFiles) {
  const dst = path.join(B, rel);
  if (FUSION.has(rel)) {
    if (bFiles.has(rel)) { logFusion.push(rel + '  (fusion manuelle requise)'); ignoresFusion++; }
    else {
      // fichier de fusion absent de l'actuel → le restaurer quand même (base 138)
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      logRestaures.push(rel + '  (fichier de fusion ABSENT — base 138 restaurée)');
      restaures++;
    }
    continue;
  }
  let besoin = false;
  if (!bFiles.has(rel)) besoin = true;
  else { try { if (md5(src) !== md5(dst)) besoin = true; else dejaIdentiques++; } catch { besoin = true; } }
  if (besoin) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    logRestaures.push(rel);
    restaures++;
  }
}

console.log('=== FICHIERS DE FUSION CONSERVÉS (état actuel, à fusionner avec 138) : ' + ignoresFusion + ' ===');
for (const l of logFusion) console.log('  ' + l);
console.log('\n=== FICHIERS RESTAURÉS depuis v0.2.138 : ' + restaures + ' (identiques déjà en place : ' + dejaIdentiques + ') ===');
for (const l of logRestaures) console.log('  ' + l);
