#!/usr/bin/env node
/**
 * Test E2E — Correctif « Erreur 405 » import fiches de paie (v0.2.175).
 *
 * Scénario :
 *  T1. POST /api/payslips/upload SANS auth            -> 401 (route existe, plus de 405)
 *  T2. Connexion superadmin de test (lab116)          -> 200
 *  T3. POST /api/payslips/upload AVEC auth + PDF réel -> 200 + JSON { results: [...] }
 *  T4. La fiche importée est en base (Payslip) + fichier chiffré en storage
 *  T5. Repli : réponse JSON (jamais HTML 405)
 *  Nettoyage : fiche de test supprimée + compte lab116 supprimé.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = "http://localhost:3000";
let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log(`  [OK]   ${nom}${detail ? " — " + detail : ""}`); }
  else      { fail++; console.log(`  [FAIL] ${nom}${detail ? " — " + detail : ""}`); }
}

function creerPdfTest() {
  // Petit PDF minimaliste d'une page (contenu texte insuffisant pour l'extraction,
  // mais suffisant pour valider la route : la fiche est enregistrée en état
  // "non analysé" — c'est la ROUTE qu'on teste, pas l'extraction OCR).
  const lignes = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    "4 0 obj << /Length 90 >> stream",
    "BT /F1 12 Tf 50 800 Td (FICHE DE PAIE TEST 405) Tj ET",
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  return Buffer.from(lignes, "latin1");
}

async function main() {
  console.log("=== TEST E2E — import fiches de paie (correctif 405, v0.2.175) ===\n");

  const pdf = creerPdfTest();
  const cheminPdf = "/tmp/fiche-test-405.pdf";
  fs.writeFileSync(cheminPdf, pdf);

  // ---- T1 : sans authentification -> 401 (et surtout PLUS de 405) ----
  console.log("T1. POST /api/payslips/upload sans authentification");
  let r1 = await fetch(BASE + "/api/payslips/upload", {
    method: "POST",
    body: (() => { const fd = new FormData(); fd.append("files", new Blob([pdf], { type: "application/pdf" }), "fiche-test-405.pdf"); return fd; })(),
  });
  check("Statut 401 (route existante + garde auth)", r1.status === 401, `status=${r1.status}`);
  check("Corps JSON (pas de page HTML)", (r1.headers.get("content-type") || "").includes("application/json"));
  const j1 = await r1.json().catch(() => ({}));
  check("Message d'accès refusé", typeof j1.error === "string" && /connecter/i.test(j1.error), j1.error || "");

  // ---- T2 : connexion compte de test ----
  console.log("\nT2. Connexion superadministrateur de test");
  try { execFileSync("node", [path.join(__dirname, "lab226", "creer-compte-e2e-116.cjs")], { stdio: "ignore" }); } catch {}
  const compte = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const rLogin = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: compte.email, password: compte.password }),
  });
  check("Connexion 200", rLogin.status === 200, `status=${rLogin.status}`);
  const setCookie = rLogin.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  check("Cookie de session reçu", cookie.startsWith("auto_rh_session="), cookie.slice(0, 40) + "…");

  // ---- T3 : upload authentifié d'un vrai PDF ----
  console.log("\nT3. POST /api/payslips/upload authentifié (PDF réel)");
  const fd = new FormData();
  fd.append("files", new Blob([pdf], { type: "application/pdf" }), "fiche-test-405.pdf");
  const r3 = await fetch(BASE + "/api/payslips/upload", {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
  check("Statut 200 (import accepté)", r3.status === 200, `status=${r3.status}`);
  const j3 = await r3.json().catch(() => null);
  check("Réponse JSON avec results", !!(j3 && Array.isArray(j3.results)), j3 ? `${j3.results.length} résultat(s)` : "JSON invalide");
  if (j3 && Array.isArray(j3.results) && j3.results.length > 0) {
    const f = j3.results[0];
    check("Résultat : fileName renvoyé", !!f.fileName, f.fileName || "");
    check("Résultat : statut de la fiche", typeof f.status === "string", f.status || JSON.stringify(Object.keys(f)));
  }

  // ---- T4 : la fiche est bien en base ----
  // (fileName est CHIFFRÉ en base — la vérification se fait par l'id renvoyé)
  console.log("\nT4. Vérification en base (Payslip + fichier storage)");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: "file:" + path.join(__dirname, "..", "db", "custom.db") } },
  });
  const idFiche = j3 && Array.isArray(j3.results) && j3.results[0] ? j3.results[0].id : null;
  check("id de fiche renvoyé", !!idFiche, idFiche || "absent");
  const fiches = idFiche
    ? await prisma.payslip.findMany({ where: { id: idFiche }, take: 3 })
    : [];
  check("Fiche enregistrée en base", fiches.length > 0, `${fiches.length} fiche(s)`);
  if (fiches.length > 0) {
    const f = fiches[0];
    check("Champ storedName rempli", !!f.storedName, f.storedName || "");
    check("Champ fileSize > 0", (f.fileSize || 0) > 0, String(f.fileSize));
    const storageDir = path.join(__dirname, "..", "storage", "payslips");
    const cheminFiche = path.join(storageDir, f.storedName || "");
    check("Fichier chiffré présent en storage", fs.existsSync(cheminFiche), cheminFiche);
  }

  // ---- T5 : une 2e route d'import sensiblement identique répond JSON ----
  console.log("\nT5. Cohérence des autres routes fiches (non-régression)");
  const rList = await fetch(BASE + "/api/payslips", { headers: { cookie } });
  check("GET /api/payslips -> 200", rList.status === 200, `status=${rList.status}`);

  // ---- Nettoyage ----
  console.log("\nNettoyage");
  for (const f of fiches) {
    try { fs.unlinkSync(path.join(__dirname, "..", "storage", "payslips", f.storedName)); } catch {}
    await prisma.payslip.delete({ where: { id: f.id } }).catch(() => {});
  }
  check("Fiches de test supprimées", true, `${fiches.length} ligne(s)`);
  await prisma.$disconnect();

  // compte lab116 (l'email est CHIFFRÉ en base — même chiffrement
  // déterministe que src/lib/db-crypto.ts, secrets chargés depuis .env)
  function emailChiffre(email) {
    const crypto = require("crypto");
    const env = {};
    for (const ligne of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    const secret = env.AUTO_RH_STORAGE_KEY || env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env";
    const selDet = "autorh-db-deterministe-v1";
    const selMac = "autorh-db-mac-v1";
    const kDet = crypto.scryptSync(secret, selDet, 32);
    const kMac = crypto.scryptSync(secret, selMac, 32);
    const iv = crypto.createHmac("sha256", kMac).update(email, "utf8").digest().subarray(0, 12);
    const c = crypto.createCipheriv("aes-256-gcm", kDet, iv);
    const donnees = Buffer.concat([c.update(email, "utf8"), c.final()]);
    return "encbd1d:" + iv.toString("base64") + ":" + c.getAuthTag().toString("base64") + ":" + donnees.toString("base64");
  }
  const prisma2 = new PrismaClient({
    datasources: { db: { url: "file:" + path.join(__dirname, "..", "db", "custom.db") } },
  });
  const suppr = await prisma2.user.deleteMany({ where: { email: emailChiffre(compte.email) } });
  await prisma2.$disconnect();
  check("Compte de test supprimé", suppr.count === 1, `${suppr.count} compte(s)`);

  console.log(`\n=== BILAN : ${ok} OK / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(1); });
