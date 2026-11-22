const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
async function main() {
  const slips = await db.payslip.findMany({
    where: { OR: [
      { fileName: { contains: "Bh225" } },
      { cin: "17775208" }
    ]},
    orderBy: { uploadedAt: "desc" },
    take: 5
  });
  for (const s of slips) {
    console.log(JSON.stringify({
      id: s.id, fileName: s.fileName, storedName: s.storedName,
      cin: s.cin, employeeName: s.employeeName, period: s.period,
      netSalary: s.netSalary, matricule: s.matricule,
      uploadedAt: s.uploadedAt,
      contentLen: (s.content||"").length,
      normContentLen: (s.normalizedContent||"").length
    }, null, 2));
    if (s.content) console.log("CONTENT:", JSON.stringify(s.content.slice(0, 800)));
  }
  const total = await db.payslip.count();
  console.log("Total payslips in DB:", total);
}
main().catch(console.error).finally(() => db.$disconnect());
