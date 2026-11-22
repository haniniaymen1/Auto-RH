/* Inspection base : fiches récentes, PDF vs PNG, contenu normalisé */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const total = await prisma.payslip.count();
  console.log('TOTAL fiches:', total);

  const recent = await prisma.payslip.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: 60,
    select: {
      id: true, fileName: true, cin: true, employeeName: true,
      normalizedContent: true, uploadedAt: true,
    },
  });

  console.log('\n--- 60 plus récentes ---');
  for (const p of recent) {
    const nc = p.normalizedContent || '';
    const ncLen = nc.length;
    const has900001 = nc.includes('900001') ? 'CONTIENT900001' : '-';
    console.log(
      p.uploadedAt.toISOString().slice(5, 16),
      '|', p.id.slice(0, 8),
      '|', (p.fileName || '').slice(0, 44).padEnd(44),
      '| cin=', (p.cin || 'NULL').padEnd(10),
      '| nom=', (p.employeeName || 'NULL').slice(0, 18).padEnd(18),
      '| ncont=', String(ncLen).padStart(5),
      '|', has900001
    );
  }

  // Répartition par extension
  const groups = {};
  for (const p of recent) {
    const ext = (p.fileName || '').split('.').pop().toLowerCase();
    groups[ext] = (groups[ext] || 0) + 1;
  }
  console.log('\n--- Répartition par extension (60 récentes) ---', groups);

  // Fiches dont le cin commence par 900001 / se termine par 001
  const cinList = await prisma.payslip.findMany({
    where: { OR: [{ cin: { startsWith: '900' } }, { cin: { endsWith: '001' } }] },
    select: { fileName: true, cin: true, employeeName: true, normalizedContent: true },
  });
  console.log('\n--- Fiches cin LIKE 900* ou *001 :', cinList.length, '---');
  for (const p of cinList.slice(0, 20)) {
    const nc = p.normalizedContent || '';
    console.log((p.cin || 'NULL').padEnd(10), '|', (p.fileName || '').slice(0, 44).padEnd(44),
      '|', (p.employeeName || '').slice(0, 18).padEnd(18), '| ncont=', nc.length,
      '| cin-dans-contenu=', nc.includes(p.cin || '___') ? 'OUI' : 'NON');
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
