// E2E : login admin -> upload Bh225 -> recherche CIN
const fs = require("fs");
const BASE = "http://localhost:3000";
let cookie = "";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const scs = res.headers.getSetCookie?.() || [];
  if (scs.length) cookie = scs.map((c) => c.split(";")[0]).join("; ");
  return res;
}

async function main() {
  // 1. login
  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "it@demo.tn", password: "demo1234" }),
  });
  console.log("login:", login.status);

  // 2. upload Bh225
  const buf = fs.readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812.pdf");
  const fd = new FormData();
  fd.append("files", new Blob([buf], { type: "application/pdf" }), "Docs From Bh225_e2e.pdf");
  const up = await req("/api/payslips/upload", { method: "POST", body: fd });
  const upJson = await up.json();
  console.log("upload:", up.status, JSON.stringify(upJson.results?.[0] || upJson).slice(0, 400));

  // 3. recherche CIN exact
  const q = await req("/api/payslips?cin=12345678&limit=10");
  const qJson = await q.json();
  console.log("recherche 12345678:", q.status, "items:", qJson.items?.length || 0);
  for (const it of qJson.items || []) {
    console.log("  ->", JSON.stringify({ fileName: it.fileName, cin: it.cin, employeeName: it.employeeName, period: it.period, netSalary: it.netSalary }));
  }
  // 4. faux CIN (CNSS) ne doit rien retourner
  const q2 = await req("/api/payslips?cin=17775208&limit=10");
  const q2Json = await q2.json();
  console.log("recherche 17775208 (CNSS, attendu 0):", q2Json.items?.length || 0);
}
main().catch((e) => { console.error("E2E ERREUR:", e.message); process.exit(1); });
