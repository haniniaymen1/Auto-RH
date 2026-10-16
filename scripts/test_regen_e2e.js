#!/usr/bin/env node
/**
 * Preuve E2E (Task « refaire même structure txt pdf ») :
 *  1. connexion superadmin sur l'admin (port 4000) ;
 *  2. import réel de l'échantillon régénéré (3 premières fiches) ;
 *  3. comparaison champ à champ des valeurs extraites par le site
 *     (employeeName, cin, netSalary, period + matricule via détail)
 *     avec les valeurs du fichier source TransferNow ;
 *  4. nettoyage complet (delete-many) et vérification du compte rendu.
 */
"use strict";
const fs = require("fs");
const assert = require("assert");

const BASE = "http://127.0.0.1:4000";
const EMAIL = "superadmin@autorh.local";
const PASS = "AutoRH-2026!Verif#1";
const SAMPLE = process.argv[2] || "/home/z/my-project/scripts/echantillon_3_fiches.pdf";
const JSON_SRC = "/home/z/my-project/scripts/fiches_1000.json";

function normTxt(s) {
  return String(s || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normNum(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[\s\u00a0]/g, "").replace(/DT$/i, "").trim();
}

function normPeriod(s) {
  const t = String(s || "").trim();
  // « 01/10/26 au 31/10/26 » ou « 01/10/26 - 31/10/26 » -> paires de dates
  const m = t.match(/(\d{2}\/\d{2}\/\d{2,4})\s*(?:au|-|à|–)\s*(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) return `${m[1]}|${m[2]}`;
  const d = t.match(/\d{2}\/\d{2}\/\d{2,4}/g);
  if (d && d.length >= 2) return `${d[0]}|${d[1]}`;
  return t.toUpperCase();
}

function numFloat(s) {
  const t = normNum(s).replace(/\./g, " ").replace(/,/g, ".").replace(/ /g, "");
  const f = parseFloat(t.replace(/[^0-9.\-]/g, ""));
  return isNaN(f) ? null : f;
}

(async () => {
  const DEBUT = parseInt(process.argv[3] || "0", 10);
  const fiches = JSON.parse(fs.readFileSync(JSON_SRC, "utf8")).slice(DEBUT, DEBUT + 3);

  // ---- 1. connexion ---------------------------------------------------
  let r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch((e) => {
    throw new Error("connexion fetch: " + e.message + " / " + (e.cause && e.cause.message));
  });
  const txtLogin = await r.text();
  assert.strictEqual(r.status, 200, `connexion KO (${r.status}) : ${txtLogin.slice(0, 200)}`);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie, "cookie de session manquant");
  console.log("1. Connexion superadmin : OK");

  // ---- 2. import réel --------------------------------------------------
  const buf = fs.readFileSync(SAMPLE);
  const fd = new FormData();
  fd.append("files", new Blob([buf], { type: "application/pdf" }), "echantillon-regenere.pdf");
  r = await fetch(`${BASE}/api/payslips/upload`, {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
  const upTxt = await r.text();
  console.log(`   upload : HTTP ${r.status}, body=${upTxt.slice(0, 300) || "(vide)"}`);
  let up;
  try {
    up = JSON.parse(upTxt);
  } catch {
    throw new Error(`réponse upload non JSON (HTTP ${r.status})`);
  }
  assert.strictEqual(r.status, 200, `upload KO (${r.status}) : ${JSON.stringify(up).slice(0, 300)}`);
  const items = (up.results && up.results[0] && up.results[0].items) || [];
  assert.strictEqual(items.length, 3, `fiches créées : ${items.length} (attendu 3)`);
  console.log(`2. Import échantillon régénéré : OK (${items.length} fiches créées)`);

  // ---- 3. comparaison champ à champ ------------------------------------
  let ok = 0;
  const attendu = [];
  for (let i = 0; i < 3; i++) {
    const f = fiches[i];
    const it = items[i];
    const checks = [];
    checks.push(["employeeName", normTxt(it.employeeName), normTxt(f.nom_prenom)]);
    checks.push(["cin", normNum(it.cin), normNum(f.cin)]);
    checks.push(["netSalary", numFloat(it.netSalary), numFloat(f.net_bas)]);
    checks.push(["period", normPeriod(it.period), normPeriod(`${f.date_debut} au ${f.date_fin}`)]);

    // matricule via l'API de détail
    const id = it.id;
    const rd = await fetch(`${BASE}/api/payslips/${id}`, { headers: { cookie } });
    const det = await rd.json();
    const detData = det.payslip || det;
    checks.push(["matricule", normNum(detData.matricule), normNum(f.matricule)]);

    const ligneOk = checks.every(([, a, b]) => a === b);
    if (ligneOk) ok++;
    console.log(`   fiche ${i + 1} (${f.nom_prenom}) : ${ligneOk ? "EXACT 5/5" : "ÉCART"}`);
    for (const [champ, a, b] of checks) {
      const eq = a === b;
      if (!eq || process.env.VERBOSE) {
        console.log(`     ${champ.padEnd(13)} site=${JSON.stringify(a)}  source=${JSON.stringify(b)} ${eq ? "" : "<-- ÉCART"}`);
      }
    }
    attendu.push({ id, checks });
  }
  console.log(`3. Comparaison : ${ok}/3 fiches EXACTES (5 champs : nom, CIN, net, période, matricule)`);

  // ---- 4. nettoyage ------------------------------------------------------
  const ids = items.map((x) => x.id);
  r = await fetch(`${BASE}/api/payslips/delete-many`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const del = await r.json();
  console.log(`4. Nettoyage : HTTP ${r.status}, deleted=${del.deleted}`);
  assert.strictEqual(del.deleted, 3, "le nettoyage n'a pas supprimé les 3 fiches de test");

  const rl = await fetch(`${BASE}/api/payslips?page=1&limit=100`, { headers: { cookie } });
  const lst = await rl.json();
  console.log(`   fiches restantes dans la base : ${lst.total}`);

  assert.strictEqual(ok, 3, "Toutes les fiches doivent être extraites EXACTEMENT");
  console.log("\n=== PREUVE E2E COMPLETE : 3/3 FICHES EXACTES, NETTOYAGE OK ===");
})().catch((e) => {
  console.error("ECHEC E2E :", e.message);
  process.exit(1);
});
