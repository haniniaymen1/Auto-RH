const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.payslip.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: 12,
    select: { id: true, fileName: true, employeeName: true, cin: true, period: true, netSalary: true, matricule: true, uploadedAt: true, sourcePage: true, pageNumber: true, content: true }
  });
  for (const r of rows) {
    console.log(JSON.stringify({
      f: r.fileName.slice(0, 40), emp: r.employeeName, cin: r.cin, per: r.period,
      net: r.netSalary, mat: r.matricule, sp: r.sourcePage, pg: r.pageNumber,
      at: r.uploadedAt.toISOString(), clen: (r.content || '').length
    }));
  }
  // group counts by minute
  const all = await p.payslip.findMany({ select: { fileName: true, uploadedAt: true, employeeName: true, period: true, cin: true } });
  const byMin = {};
  for (const r of all) {
    const k = r.uploadedAt.toISOString().slice(0, 16);
    byMin[k] = byMin[k] || { n: 0, withData: 0, empty: 0, sample: r.fileName.slice(0, 30) };
    byMin[k].n++;
    if (r.employeeName && r.period) byMin[k].withData++; else byMin[k].empty++;
  }
  console.log('\n=== by minute ===');
  for (const [k, v] of Object.entries(byMin).sort()) console.log(k, JSON.stringify(v));
  console.log('TOTAL:', all.length);
  await p.$disconnect();
})();
