#!/usr/bin/env node
/* Classification fine des fichiers perdus entre v0.2.138 et code actuel :
 *  - SUPPRIMÉ : le contenu (MD5) n'existe NULLE PART dans le code actuel
 *  - RENOMMÉ  : le contenu existe ailleurs dans le code actuel
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

const aFiles = walk(A, A, new Map());
const bFiles = walk(B, B, new Map());

// index des hash du code actuel
const hashB = new Map();
for (const [rel, full] of bFiles) {
  try { const h = md5(full); if (!hashB.has(h)) hashB.set(h, []); hashB.get(h).push(rel); } catch {}
}

const supprimes = [], renommes = [];
for (const [rel, full] of aFiles) {
  if (bFiles.has(rel)) continue;
  let h; try { h = md5(full); } catch { supprimes.push([rel, '?']); continue; }
  if (hashB.has(h)) renommes.push([rel, hashB.get(h)[0]]);
  else supprimes.push([rel, h]);
}

console.log('=== SUPPRIMÉS (contenu introuvable dans le code actuel) : ' + supprimes.length + ' ===');
for (const [r] of supprimes) console.log('  ' + r);
console.log('\n=== RENOMMÉS/DÉPLACÉS (contenu retrouvé ailleurs) : ' + renommes.length + ' ===');
for (const [a, b] of renommes) console.log('  ' + a + '  →  ' + b);

// Échantillon des NOUVEAUX (artefacts ?)
const nouveaux = [];
for (const rel of bFiles.keys()) if (!aFiles.has(rel)) nouveaux.push(rel);
console.log('\n=== NOUVEAUX (échantillon 60 / ' + nouveaux.length + ') ===');
for (const r of nouveaux.slice(0, 60)) console.log('  ' + r);
