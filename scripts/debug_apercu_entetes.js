/* Debug : appelle l'aperçu et affiche TOUS les en-têtes + le cfg utilisé. */
const path = require('path');
const racine = '/home/z/my-project';
const acceptation = require(path.join(racine, 'scripts/document-acceptation.js'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  // 1) cfg vue par le MOTEUR (hors serveur)
  const cfg = await acceptation.chargerConfig(db);
  console.log('cfgMoteur: signerActif=%s elecActif=%s certChemin=%s source=%s',
    cfg.signerActif, cfg.docElecActif, cfg.certChemin || '(vide)', cfg._sourceReponsePdf ? 'REPONSE-PDF' : 'historique');

  // 2) aperçu direct moteur
  const r = await acceptation.apercuDocument(db, null, cfg, { dechiffrerChamp: (v) => v });
  console.log('moteur: elements=%s signatureCrypto=%s avertissements=%j',
    r.elements.join(','), r.signatureCrypto, r.avertissements);

  // 3) via l'API (serveur 4000) — login puis aperçu
  let cookie = '';
  const login = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@autorh.local', password: 'AutoRH-2026!Verif#1' }),
  });
  const setC = login.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  console.log('login status=', login.status);
  const f = new FormData();
  f.append('action', 'apercu');
  const res = await fetch('http://localhost:4000/api/reponse-pdf-config', {
    method: 'POST', headers: { Cookie: cookie }, body: f,
  });
  console.log('apercu status=', res.status);
  for (const [k, v] of res.headers.entries()) {
    if (k.startsWith('x-apercu')) {
      let val = v;
      try { val = decodeURIComponent(v); } catch { /* */ }
      console.log('  %s = %s', k, val.slice(0, 300));
    }
  }
  await db.$disconnect();
}

main().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
