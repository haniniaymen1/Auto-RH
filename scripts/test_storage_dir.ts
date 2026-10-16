/**
 * Test unitaire de src/lib/storage-dir.ts (via tsx).
 * Vérifie la résolution de la racine et du dossier de stockage dans
 * plusieurs scénarios d'environnement, SANS toucher au disque.
 */
import { getProjectRoot, getStorageDir, storageReadCandidates, resolveStoredFile } from "../src/lib/storage-dir";
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { console.log("PASS ", label); pass++; }
  else { console.log("ÉCHEC", label, extra); fail++; }
}

// Racine du projet, déduite de l'emplacement de CE script (portable).
const REAL_ROOT = path.resolve(__dirname, "..");

// --- Scénario 1 : dev classique (cwd = racine, DATABASE_URL absolu) ---
delete process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT;
delete process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR;
delete process.env.STORAGE_DIR;
process.env.DATABASE_URL = `file:${REAL_ROOT}/db/custom.db`;
process.chdir(REAL_ROOT);
check("S1 racine = racine réelle", getProjectRoot() === REAL_ROOT, getProjectRoot());
check("S1 storage = racine/storage/payslips", getStorageDir() === path.join(REAL_ROOT, "storage", "payslips"));

// --- Scénario 2 : standalone SANS env (cwd = .next/standalone) ---
// Racine doit être retrouvée via DATABASE_URL absolu + remontée cwd.
// (Nécessite un build standalone présent ; sinon le scénario est sauté.)
const fakeStandalone = path.join(REAL_ROOT, ".next", "standalone");
if (fs.existsSync(fakeStandalone)) {
  process.chdir(fakeStandalone);
  delete process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT;
  delete process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR;
  check("S2 racine (cwd standalone, via DATABASE_URL)", getProjectRoot() === REAL_ROOT, getProjectRoot());
  check("S2 storage canonique", getStorageDir() === path.join(REAL_ROOT, "storage", "payslips"));
  const cands = storageReadCandidates();
  check("S2 candidats incluent ancien emplacement standalone", cands.includes(path.join(REAL_ROOT, ".next", "standalone", "storage", "payslips")), JSON.stringify(cands));
  check("S2 candidats incluent emplacement historique cwd", cands.includes(path.join(fakeStandalone, "storage", "payslips")));
} else {
  console.log("SKIP  S2 (pas de build .next/standalone — lancez npm run build pour le tester)");
}

// --- Scénario 3 : standalone AVEC env (ce que fait start-prod.js) ---
process.env.AUTO_RH_ROOT = REAL_ROOT;
process.env.AUTO_RH_STORAGE_DIR = path.join(REAL_ROOT, "storage", "payslips");
process.chdir(path.dirname(REAL_ROOT)); // cwd totalement étranger
check("S3 racine via AUTO_RH_ROOT (cwd étranger)", getProjectRoot() === REAL_ROOT);
check("S3 storage via AUTO_RH_STORAGE_DIR", getStorageDir() === path.join(REAL_ROOT, "storage", "payslips"));

// --- Scénario 4 : résolution réelle d'un fichier existant ---
const existing = fs.readdirSync(path.join(REAL_ROOT, "storage", "payslips"))[0];
check("S4 resolveStoredFile trouve un PDF réel", !!existing && resolveStoredFile(existing) !== null, String(existing));
check("S4 resolveStoredFile → null pour fichier absent", resolveStoredFile("inexistant-xyz-1234567890.pdf") === null);

// --- Scénario 5 : DATABASE_URL relative (dev historique) — repli cwd ---
delete process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT;
delete process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR;
process.env.DATABASE_URL = "file:./db/custom.db";
process.chdir(REAL_ROOT);
check("S5 DATABASE_URL relative → repli remontée cwd → racine", getProjectRoot() === REAL_ROOT, getProjectRoot());

console.log(`\nBILAN STORAGE-DIR : ${pass} PASS / ${fail} ÉCHEC`);
process.exit(fail === 0 ? 0 : 1);
