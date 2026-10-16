#!/usr/bin/env node
/**
 * Test E2E — CORRECTION « Erreur 405 à l'import des fiches de paie » (v0.2.87).
 *
 * Contexte : le fichier src/app/api/payslips/upload/route.ts avait DISPARU lors
 * de la restauration d'environnement (même épisode que les clés .env de la
 * Tâche 178) : la route existait en v0.2.82, était ABSENTE en v0.2.83+, et le
 * POST de l'UI tombait sur /api/payslips/[id] (GET+DELETE seulement) → 405.
 *
 * Vérifie contre l'administration réelle (port 4000) :
 *   1. RH/SuperAdmin : POST multipart /api/payslips/upload (IDENTIQUE à
 *      l'UI import-tab.tsx : champ « files ») → 200 + résultats d'extraction
 *      (CIN, nom, période, net) + fiche persistée + fichier chiffré sur disque ;
 *   2. Import d'un LOT (2 fichiers en un seul appel, comme les lots de l'UI) ;
 *   3. La fiche importée est listée par GET /api/payslips ;
 *   4. IT : POST upload → 403 (Task 176, refusIT) ;
 *   5. Non-régression QR Fiche en ligne + signature : cf. les 2 autres tests ;
 *   6. Nettoyage complet (fiches + fichiers disque + comptes de test).
 *
 * Usage : node scripts/test_correction_405_upload.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();

const BASE = "http://localhost:4000";
const db = new PrismaClient();

const CIN1 = "TEST40501";
const CIN2 = "TEST40502";

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

/** Fiche PDF valide (pdf-lib) avec champs textuels détectables. */
async function creerFichePdf(chemin, cin, nom, net) {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("BULLETIN DE PAIE", { x: 60, y: 780, size: 20, font: gras });
  page.drawText("Nom et prenom : " + nom, { x: 60, y: 730, size: 13, font: reg });
  page.drawText("CIN : " + cin, { x: 60, y: 700, size: 13, font: gras });
  page.drawText("Periode : 09/2026", { x: 60, y: 670, size: 13, font: reg });
  page.drawText("Net a payer : " + net, { x: 60, y: 640, size: 14, font: gras });
  fs.writeFileSync(chemin, await pdf.save());
}

/** Multipart FormData réel (comme l'UI : champ « files », lots). */
async function posterUpload(cookie, chemins) {
  const fd = new FormData();
  for (const c of chemins) {
    const buf = fs.readFileSync(c);
    fd.append("files", new Blob([buf], { type: "application/pdf" }), path.basename(c));
  }
  const res = await fetch(BASE + "/api/payslips/upload", {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  console.log("== Correction 405 — import des fiches de paie : preuve E2E ==");

  // ---- Connexions ----
  const sup = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }),
  });
  const cookieSup = (sup.headers.get("set-cookie") || "").split(";")[0];
  check("Connexion superadministrateur", sup.status === 200 && Boolean(cookieSup), `status=${sup.status}`);

  // ---- Nettoyage préalable ----
  await db.payslip.deleteMany({ where: { cin: { in: [CIN1, CIN2] } } });

  // ---- 1) Import UNITAIRE (1 PDF) ----
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "t405-"));
  const f1 = path.join(tmp, "bulletin-405-a.pdf");
  await creerFichePdf(f1, CIN1, "EMPLOYE TEST 405", "2 400,000");
  const r1 = await posterUpload(cookieSup, [f1]);
  check("POST /api/payslips/upload (1 PDF) → 200 (405 CORRIGÉ)", r1.status === 200, `status=${r1.status}`);
  const res1 = r1.json?.results?.[0];
  check("Réponse : 1 résultat avec succès", Array.isArray(r1.json?.results) && r1.json.results.length === 1 && res1?.status === "SUCCESS", JSON.stringify(res1 || r1.json).slice(0, 160));
  check("CIN extrait correctement", res1?.cin === CIN1, `cin=${res1?.cin}`);
  const fiche1 = res1?.id ? await db.payslip.findUnique({ where: { id: res1.id } }) : null;
  check("Fiche persistée en base", Boolean(fiche1));
  check("Fichier chiffré sur disque (storedName présent)", Boolean(fiche1?.storedName));

  // ---- 2) Import en LOT (2 fichiers, 1 appel — comme les lots de l'UI) ----
  const f2 = path.join(tmp, "bulletin-405-b.pdf");
  await creerFichePdf(f2, CIN2, "EMPLOYE TEST 405 B", "3 100,000");
  const r2 = await posterUpload(cookieSup, [f1, f2]);
  check("POST upload (lot de 2) → 200", r2.status === 200 && r2.json?.results?.length === 2, `status=${r2.status} n=${r2.json?.results?.length}`);
  const idsLot = (r2.json?.results || []).map(r => r.id).filter(Boolean);
  const enBaseLot = idsLot.length ? await db.payslip.count({ where: { id: { in: idsLot } } }) : 0;
  check("Les 2 fiches du lot sont en base", idsLot.length === 2 && enBaseLot === 2, `ids=${idsLot.length} enBase=${enBaseLot}`);

  // ---- 3) La fiche est listée par l'API de liste ----
  const liste = await fetch(BASE + "/api/payslips?page=1&limit=10", { headers: { cookie: cookieSup } });
  const lj = await liste.json().catch(() => null);
  const presente = JSON.stringify(lj).includes(CIN1);
  check("Fiche importée visible dans GET /api/payslips", liste.status === 200 && presente, `status=${liste.status}`);

  // ---- 4) IT : import REFUSÉ (Task 176) ----
  const emailIt = "it-405-" + crypto.randomBytes(3).toString("hex") + "@test.local";
  const creaIt = await fetch(BASE + "/api/users", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: cookieSup },
    body: JSON.stringify({ name: "IT Test 405", email: emailIt, password: "It-405-Temp!1", role: "IT" }),
  });
  check("Compte IT de test créé", [200, 201].includes(creaIt.status), `status=${creaIt.status}`);
  const creaItJson = await creaIt.json().catch(() => null);
  const idIt = creaItJson?.id || creaItJson?.user?.id || null;
  const itLogin = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIt, password: "It-405-Temp!1" }),
  });
  const cookieIt = (itLogin.headers.get("set-cookie") || "").split(";")[0];
  if (itLogin.status === 200 && cookieIt) {
    const rIt = await posterUpload(cookieIt, [f1]);
    check("IT POST upload → 403 (Task 176)", rIt.status === 403, `status=${rIt.status}`);
    const it2 = await fetch(BASE + "/api/payslips/upload", { method: "POST", headers: { "Content-Type": "application/json", cookie: cookieIt }, body: "{}" });
    check("IT POST upload (JSON) → 403 aussi", it2.status === 403, `status=${it2.status}`);
  } else {
    check("Compte IT de test créé/connecté", false, `login=${itLogin.status}`);
  }

  // ---- 5) Sans session : 401 ----
  const anon = await fetch(BASE + "/api/payslips/upload", { method: "POST", body: new FormData() });
  check("Sans session → 401 (middleware)", anon.status === 401, `status=${anon.status}`);

  // ---- 6) NETTOYAGE (par ID réel — les champs en base sont CHIFFRÉS : les
  //      requêtes par valeur brute ne trouvent RIEN, ne jamais s'y fier) ----
  const idsNettoyage = [...new Set([res1?.id, ...idsLot].filter(Boolean))];
  const supDel = idsNettoyage.length
    ? await fetch(BASE + "/api/payslips/delete-many", {
        method: "POST", headers: { "Content-Type": "application/json", cookie: cookieSup },
        body: JSON.stringify({ ids: idsNettoyage }),
      })
    : { status: "(aucun id)" };
  check("Nettoyage : fiches de test supprimées", [200, 204].includes(supDel.status), `status=${supDel.status} ids=${idsNettoyage.length}`);
  const resteFiches = await db.payslip.count({ where: { id: { in: idsNettoyage.length ? idsNettoyage : [""] } } });
  check("Base vidée des fiches de test (0)", resteFiches === 0, `restes=${resteFiches}`);
  // Le compte IT : suppression par id (réponse de création), sinon par
  // DÉCHIFFREMENT réel des e-mails (jamais par e-mail brut, chiffré en base).
  if (idIt) {
    await db.user.delete({ where: { id: idIt } }).catch(() => {});
  } else {
    const cryptoBdLocal = require("./lib-crypto-bd.js");
    cryptoBdLocal.reinitialiserCles?.();
    for (const u of await db.user.findMany({ select: { id: true, email: true } })) {
      try {
        if (String(cryptoBdLocal.dechiffrerChamp(u.email)) === emailIt) {
          await db.user.delete({ where: { id: u.id } });
        }
      } catch {}
    }
  }
  const resteIt = (await db.user.findMany({ select: { email: true } })).filter((u) => {
    try { return String(cryptoBd.dechiffrerChamp(u.email)) === emailIt; } catch { return false; }
  }).length;
  check("Compte IT de test supprimé", resteIt === 0, `restes=${resteIt}`);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n==== BILAN : ${OK} OK / ${KO} FAIL ====`);
  await db.$disconnect();
  process.exit(KO === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("[ERREUR FATALE]", e); try { await db.$disconnect(); } catch {} process.exit(2); });
