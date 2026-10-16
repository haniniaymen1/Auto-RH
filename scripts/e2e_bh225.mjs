// E2E : login admin -> upload Bh225 -> recherche CIN 12345678
const BASE = "http://localhost:3000";
const fs = require("fs");

let cookie = "";
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return res;
}

// 1. login ( NextAuth credentials )
const loginRes = await fetch(BASE + "/api/auth/callback/credentials", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: "admin", password: "admin123" }),
  redirect: "manual",
});
const setCookie = loginRes.headers.getSetCookie?.() || [];
cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
console.log("login:", loginRes.status, cookie ? "cookie OK" : "PAS de cookie");

// vérif session
const me = await req("/api/auth/session");
console.log("session:", me.status, JSON.stringify((await me.json())?.user?.name || null));

// 2. upload Bh225
const buf = fs.readFileSync("/home/z/my-project/upload/Docs From Bh225_260914145812.pdf");
const fd = new FormData();
fd.append("files", new Blob([buf], { type: "application/pdf" }), "Docs From Bh225_260914145812.pdf");
const up = await req("/api/payslips/upload", { method: "POST", body: fd });
const upJson = await up.json();
console.log("upload:", up.status, JSON.stringify(upJson.results?.[0] || upJson).slice(0, 400));

// 3. recherche CIN exact 12345678
const q = await req("/api/payslips?cin=12345678&limit=10");
const qJson = await q.json();
console.log("recherche 12345678:", q.status, "items:", qJson.items?.length || 0);
for (const it of qJson.items || []) {
  console.log("  ->", JSON.stringify({ fileName: it.fileName, cin: it.cin, employeeName: it.employeeName, period: it.period, netSalary: it.netSalary }));
}
// 4. le faux CIN (CNSS) ne doit RIEN retourner
const q2 = await req("/api/payslips?cin=17775208&limit=10");
const q2Json = await q2.json();
console.log("recherche 17775208 (CNSS, attendu 0):", q2Json.items?.length || 0);
