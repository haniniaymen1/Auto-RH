#!/usr/bin/env node
/* AUDIT v0.2.138 (référence utilisateur) vs v0.2.141 (code actuel)
 * Liste :
 *  - [PERDU]   fichiers présents en 138, absents du code actuel
 *  - [NOUVEAU] fichiers présents dans le code actuel, absents en 138
 *  - [DIFF]    fichiers présents des deux côtés mais de contenu différent
 * Exclusions : node_modules, .next, .git, download, storage, logs, home/ (artefact ZIP), tool-results, db
 */
const fs = require('fs');
const path = require('path');

const A = '/home/z/my-project/audit-versions/v02138';
const B = '/home/z/my-project';

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

const aFiles = walk(A, A, new Map());
const bFiles = walk(B, B, new Map());

const crypto = require('crypto');
function md5(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

const perdu = [], nouveau = [], diff = []; let identiques = 0;
for (const [rel, full] of aFiles) {
  if (!bFiles.has(rel)) perdu.push(rel);
  else { try { if (md5(full) !== md5(bFiles.get(rel))) diff.push(rel); else identiques++; } catch { diff.push(rel); } }
}
for (const rel of bFiles.keys()) if (!aFiles.has(rel)) nouveau.push(rel);

console.log('=== [PERDU] présents en v0.2.138, ABSENTS du code actuel (' + perdu.length + ') ===');
for (const r of perdu.sort()) console.log('  ' + r);
console.log('\n=== [NOUVEAU] absents en v0.2.138, présents dans le code actuel (' + nouveau.length + ') ===');
for (const r of nouveau.sort()) console.log('  ' + r);
console.log('\n=== [DIFF] contenu modifié (' + diff.length + ') ===');
for (const r of diff.sort()) {
  const sa = fs.statSync(aFiles.get(r)).size, sb = fs.statSync(bFiles.get(r)).size;
  const signe = sb > sa ? '+' : (sb < sa ? '-' : ' ');
  console.log('  [' + signe + '] ' + r + '  (' + sa + ' → ' + sb + ' o)');
}
console.log('\n=== RÉSUMÉ ===');
console.log('identiques : ' + identiques + ' ; perdus : ' + perdu.length + ' ; nouveaux : ' + nouveau.length + ' ; modifiés : ' + diff.length);
