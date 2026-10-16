const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
async function main() {
  const slips = await db.payslip.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 8
  });
  for (const s of slips) {
    console.log(JSON.stringify({
      id: s.id, fileName: s.fileName, storedName: s.storedName,
      cin: s.cin, employeeName: s.employeeName, period: s.period,
      netSalary: s.netSalary, uploadedAt: s.uploadedAt,
      contentLen: (s.content||"").length
    }));
    if (s.content && (s.content||"").length < 300) console.log("  CONTENT:", JSON.stringify(s.content));
  }
}
main().catch(console.error).finally(() => db.$disconnect());
