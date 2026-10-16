/** Test rapide : politique code d'activation portée — code faible → 403 AVANT
 *  la comparaison (même avec un code erroné). Serveur niché éphémère 4203. */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project/task97_png/extracted";
const SERVER = path.join(ROOT, ".next", "standalone", "task97_png", "extracted", "server.js");
const PORT = 4203;
process.env.SIGNUP_CODE = "Paie2026!"; // code configuré pour le test de comparaison
const ADMIN = `http://127.0.0.1:${PORT}`;

for (const l of fs.readFileSync(ROOT + "/.env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

function httpPostJson(url, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode, body: out }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const srv = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT),
      DATABASE_URL: "file:" + path.join(ROOT, "db", "custom.db"), AUTO_RH_ROOT: ROOT },
    stdio: ["ignore", "ignore", "ignore"],
  });
  let ok = 0, total = 0;
  try {
    for (let i = 0; i < 60; i++) {
      try { await new Promise((r, j) => http.get(ADMIN + "/login", (x) => { x.resume(); r(); }).on("error", j)); break; }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    await new Promise((r) => setTimeout(r, 1500));

    /* Codes faibles → 403 politique AVANT toute comparaison */
    const faibles = [
      ["PAIESAGE-2026", "que majuscules/chiffres/tiret (pas de minuscule)"],
      ["abc123", "trop court"],
      ["Abcdefgh", "pas de chiffre ni symbole"],
      ["Paie2026!", "symbole manquant ? non — 9 car, tout y est → doit PASSEr la politique"],
    ];
    // NB : « Paie2026! » EST conforme (min+maj+chiffre+symbole, 9 car) → la
    // politique passe, la comparaison s'applique (code erroné → 403 autre message).
    for (const [code, desc] of faibles.slice(0, 3)) {
      total++;
      const r = await httpPostJson(ADMIN + "/api/auth/signup", {
        name: "Test", email: "test97@x.local", password: "Pol!tique2026A", role: "RH", code,
      });
      const msg = (() => { try { return JSON.parse(r.body).error || ""; } catch { return ""; } })();
      const pass = r.status === 403 && msg.includes("code d'activation doit");
      console.log(`  ${pass ? "✅" : "❌"} code faible (${desc}) → ${r.status} « ${msg.slice(0, 70)}… »`);
      if (pass) ok++;
    }
    /* Code conforme mais erroné → 403 comparaison (message différent) */
    total++;
    const r4 = await httpPostJson(ADMIN + "/api/auth/signup", {
      name: "Test", email: "test97@x.local", password: "Pol!tique2026A", role: "RH", code: "Autre2026!", // conforme mais ERRONÉ
    });
    const msg4 = (() => { try { return JSON.parse(r4.body).error || ""; } catch { return ""; } })();
    const pass4 = r4.status === 403 && !msg4.includes("code d'activation doit");
    console.log(`  ${pass4 ? "✅" : "❌"} code conforme erroné → ${r4.status} (comparaison, pas la politique) « ${msg4.slice(0, 60)}… »`);
    if (pass4) ok++;

    console.log(`\n=== POLITIQUE CODE : ${ok}/${total} ===`);
    process.exitCode = ok === total ? 0 : 1;
  } finally {
    srv.kill("SIGTERM");
    setTimeout(() => srv.kill("SIGKILL"), 2000).unref();
    setTimeout(() => process.exit(process.exitCode ?? 0), 2500).unref();
  }
})();
