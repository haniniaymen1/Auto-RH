#!/usr/bin/env node
/* SYNCHRONISATION depuis le miroir /tmp/my-project (état v0.2.141 intact) :
 *  - copie vers le FS principal TOUS les fichiers du miroir ABSENTS du FS
 *    (ajouts Tasks 178-181 : moteurs, routes, tests, seeds…)
 *  - NE TOUCHE PAS aux fichiers existants (base 138 restaurée + fusions manuelles)
 * Exclusions : node_modules, .next, .git, storage, logs, tool-results, db (traitée à part), fusion-securite
 */
const fs = require('fs');
const path = require('path');

const M = '/tmp/my-project';
const B = '/home/z/my-project';
const EXCL_DIRS = new Set(['node_modules', '.next', '.git', 'storage', 'logs', 'tool-results',
  'audit-versions', 'home', '.zscripts', 'db', 'dev.log', 'agent-ctx', '.turbo', 'fusion-securite',
  'upload', 'ocr-data', 'test-results', 'playwright-report', 'mini-services']);
const EXCL_FILES = /\.(log|db-wal|db-shm|pid|tmp)$/i;

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

const mFiles = walk(M, M, new Map());
let copies = 0, ignores = 0;
const ignoreLst = [];
for (const [rel, src] of mFiles) {
  const dst = path.join(B, rel);
  if (fs.existsSync(dst)) { ignores++; ignoreLst.push(rel); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copies++;
}
console.log('COPIÉS depuis le miroir : ' + copies);
console.log('IGNORÉS (déjà présents — base 138 restaurée ou fusion en cours) : ' + ignores);
