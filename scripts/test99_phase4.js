/**
 * Task 99 — PHASE 4/5 : assertions POST-indexation sur la base 240 000
 * (exécutée APRÈS test99_indexation_directe.js, en moins de 5 minutes).
 *  - état d'indexation via l'API (restants = 0, idempotence du POST)
 *  - recherche CIN d'une fiche lointaine (~n°240 200) + variantes
 *  - pagination de RECHERCHE (150 fiches, même CIN)
 *  - parité sémantique (règle historique recalculée indépendamment)
 *  - statistiques voie rapide SQL (dédoublonnages)
 *  - upload réel → indexé automatiquement (middleware)
 *  - requête portail indexée (cinIndex OU jetons)
 *  - pagination de liste (pages profonde, partielle, au-delà)
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task99_pagination/base";
const SERVER = path.join(ROOT, ".next", "standalone", "task99_pagination", "base", "server.js");
const PORT_ADMIN = 4204;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const DB = path.join(ROOT, "db", "custom.db");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
process.env.DATABASE_URL = "file:" + DB;
const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();
const EMAIL_IT = "it-pagination-test@autorh.local";
const MDP_IT = "It2026!pag99";

/* jumelle du filtre EXACT (algorithme historique, indépendant) */
function normalizeQuery(q) { return q.toUpperCase().replace(/[\s./\-]/g, ""); }
function exactCinRegex(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(sep);
  const purelyNumeric = /^[0-9]+$/.test(q);
  const leftGuard = purelyNumeric ? "(?<![0-9A-Z][ \\t./\\-])" : "";
  return new RegExp(`(?<![A-Z0-9])${leftGuard}${escaped}(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])`);
}
function estExactDansContenu(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(content.toUpperCase()) : false;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("timeout GET " + url)));
  });
}
function httpPost(url, headers = {}, body = "{}") {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(body, "utf8");
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": data.length, ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(240000, () => req.destroy(new Error("timeout POST " + url)));
    req.write(data);
    req.end();
  });
}
async function attendreServeur(url) {
  for (let i = 0; i < 90; i++) { try { await httpGet(url); return; } catch { await attendre(500); } }
  throw new Error("serveur injoignable");
}

const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}
process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

/* PDF minimal valide (texte extractible) */
function pdfMinimal(lignes) {
  const flux =
    "BT /F1 12 Tf 50 700 Td " +
    lignes.map((l) => `(${String(l).replace(/[()\\]/g, "")}) Tj 0 -20 Td`).join(" ") + " ET";
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n" +
      `4 0 obj\n<< /Length ${Buffer.byteLength(flux, "utf8")} >>\nstream\n${flux}\nendstream\nendobj\n` +
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "utf8"
  );
}

(async () => {
  let admin = null;
  let errBuf = "";
  try {
    console.log("=== P4 : serveur + login ===");
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORT_ADMIN), HOSTNAME: "127.0.0.1", DATABASE_URL: "file:" + DB, AUTO_RH_ROOT: ROOT },
      stdio: ["ignore", "ignore", "pipe"],
    });
    // (correction) DRAIN OBLIGATOIRE du stderr : sans consommateur, le tampon
    // du pipe (64 Ko) se remplit, le serveur BLOQUE sur ses écritures de
    // journal et toute requête suivante expire (constaté : timeout upload).
    admin.stderr.on("data", (c) => {
      errBuf = (errBuf + c).slice(-40000);
    });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(1000);
    const login = await httpPost(`${ADMIN}/api/auth/login`, {}, JSON.stringify({ email: EMAIL_IT, password: MDP_IT }));
    let cookie = "";
    for (const c of login.headers["set-cookie"] || []) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
    verdict("P4.login", login.status === 200 && Boolean(cookie), `login → ${login.status}`);
    const auth = { Cookie: `auto_rh_session=${cookie}` };
    const get = (u) => httpGet(ADMIN + u, auth);

    // État d'indexation + idempotence du POST
    const etat = JSON.parse((await get("/api/payslips/indexation")).body);
    verdict("P4.restants0", etat.restants === 0 && etat.termine === true, `GET indexation → restants=${etat.restants}`);
    const idem = JSON.parse((await httpPost(ADMIN + "/api/payslips/indexation", auth)).body);
    verdict("P4.idempotence", idem.traites === 0 && idem.termine === true, `POST indexation → traites=${idem.traites}, termine=${idem.termine}`);

    const totalAttendu = 240000 + 250;
    // fiche lointaine = unique fiche de CIN 98765432
    const empLoin = cryptoBd.chiffrerChamp("98765432", true);
    const loin = await prisma.payslip.findFirst({ where: { cinIndex: empLoin }, select: { id: true } });

    // Recherche lointaine + variante + sous-séquence
    const t3 = Date.now();
    const rLoin = await get(`/api/payslips?cin=98765432`);
    const dLoin = JSON.parse(rLoin.body);
    const msLoin = Date.now() - t3;
    verdict(
      "P4.rechercheLointaine",
      rLoin.status === 200 && dLoin.total === 1 && dLoin.items[0]?.id === loin.id && msLoin < 2000,
      `fiche n°~240 200 → trouvée en ${msLoin} ms, total=${dLoin.total}`
    );
    const dLoin2 = JSON.parse((await get("/api/payslips?cin=98765%20432")).body);
    verdict("P4.varianteEspaces", dLoin2.total === 1 && dLoin2.items[0]?.id === loin.id, "« 98765 432 » → même fiche");
    const dPart = JSON.parse((await get("/api/payslips?cin=8765432")).body);
    verdict("P4.sousSequenceRefusée", dPart.total === 0, "« 8765432 » (sous-séquence) → 0 résultat");

    // Pagination de RECHERCHE : 150 fiches de CIN_FREQUENT
    const dFreq = JSON.parse((await get("/api/payslips?cin=55554444")).body);
    verdict(
      "P4.recherchePage1",
      dFreq.total === 150 && dFreq.items.length === 100 && dFreq.totalPages === 2,
      `CIN 55554444 → total=${dFreq.total}, page 1 = ${dFreq.items.length} items, totalPages=${dFreq.totalPages}`
    );
    const dFreq2 = JSON.parse((await get("/api/payslips?cin=55554444&page=2")).body);
    const idsF1 = new Set(dFreq.items.map((x) => x.id));
    verdict(
      "P4.recherchePage2",
      dFreq2.items.length === 50 && dFreq2.page === 2 && dFreq2.items.every((x) => !idsF1.has(x.id)),
      `page 2 → ${dFreq2.items.length} items, sans chevauchement`
    );

    // Parité sémantique post-indexation (règle historique recalculée)
    const petites = (await prisma.payslip.findMany({
      where: {
        AND: [
          { storedName: { startsWith: "t99-" } },
          { storedName: { not: { startsWith: "t99-bulk-" } } },
        ],
      },
    })).map((r) => cryptoBd.dechiffrerObjet("Payslip", r));
    for (const qn of ["12345678", "08765432", "26542351", "95931034", "A123456", "11112222", "30000042"]) {
      const attendus = petites
        .filter((r) => {
          const nc = String(r.normalizedContent ?? "").toUpperCase();
          if (!nc.includes(qn)) return false;
          const cin = r.cin ? normalizeQuery(r.cin) : "";
          return cin === qn || estExactDansContenu(String(r.content ?? ""), qn);
        })
        .map((r) => r.id)
        .sort();
      const r = await get(`/api/payslips?cin=${encodeURIComponent(qn)}`);
      const d = JSON.parse(r.body);
      const obtenus = (d.items ?? []).filter((x) => petites.some((p) => p.id === x.id)).map((x) => x.id).sort();
      // le volume massif peut aussi contenir des correspondances (CIN proches
      // interdits par construction) — on filtre sur le petit volume
      verdict(
        "P4.parité." + qn,
        r.status === 200 && JSON.stringify(attendus) === JSON.stringify(obtenus),
        `historique=${attendus.length}, API(petit volume)=${obtenus.length}`
      );
    }

    // Stats voie rapide
    const st = await get("/api/stats");
    const dSt = JSON.parse(st.body);
    const cinsAttendus = new Set();
    for (const r of petites) {
      const n = normalizeQuery(r.cin ?? "");
      if (n) cinsAttendus.add(n);
    }
    for (let i = 0; i < 240000; i++) {
      const cin = i === 50 ? "98765432" : i >= 100 && i < 250 ? "55554444" : String(20000000 + i);
      cinsAttendus.add(normalizeQuery(cin));
    }
    for (let j = 0; j < 240; j++) cinsAttendus.add(String(30000000 + j));
    verdict(
      "P4.statsRapide",
      st.status === 200 && dSt.total === totalAttendu && dSt.withCin === cinsAttendus.size,
      `stats → total=${dSt.total} (attendu ${totalAttendu}), withCin=${dSt.withCin} (attendu ${cinsAttendus.size})`
    );

    // Listes : profonde, dernière partielle, au-delà
    const derniere = Math.ceil(totalAttendu / 100);
    const pPro = JSON.parse((await get(`/api/payslips?page=2400&limit=100`)).body);
    verdict("P4.pageProfonde", pPro.items.length === 100 && pPro.page === 2400, `page 2400 → ${pPro.items.length} items`);
    const pD = JSON.parse((await get(`/api/payslips?page=${derniere}&limit=100`)).body);
    verdict("P4.dernierePartielle", pD.items.length === totalAttendu % 100, `dernière page → ${pD.items.length} items (reste ${totalAttendu % 100})`);

    // P5 : upload réel → indexé automatiquement par le middleware
    const PDF_TEXT = pdfMinimal(["BULLETIN DE PAIE","CIN: 44556677","SOCIETE EXEMPLE SARL — AFFILIE CNSS 17775208-08","MATRICULE: 4471 — CATEGORIE: 3 — ECHELON: 5","PERIODE: du 01/08/26 au 31/08/26","SALAIRE BRUT: 1 250,500 TND","RETENUE CNSS: 9,25% — IMPOT SUR REVENU: 145,320 TND","PRIME DE RENDEMENT: 120,000 — PRIME DE TRANSPORT: 40,000","CONGES ACQUIS: 2,5 JOURS — ABSENCE: 0 JOUR","NET A PAYER: 1 050,250 TND","MODE DE PAIEMENT: VIREMENT BANCAIRE — REFERENCE: VRMT-447100","SIGNATURE: LE DIRECTEUR DES RESSOURCES HUMAINES"]);
    const boundary = "----t99" + Date.now();
    const corps = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename=" Bulletin_44556677.pdf "\r\nContent-Type: application/pdf\r\n\r\n`, "utf8"),
      PDF_TEXT,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const up = await httpPost(ADMIN + "/api/payslips/upload", { ...auth, "Content-Type": "multipart/form-data; boundary=" + boundary }, corps);
    let upData = null;
    try { upData = JSON.parse(up.body); } catch {}
    const upCree = upData?.results?.[0];
    const dUp = JSON.parse((await get("/api/payslips?cin=44556677")).body);
    verdict(
      "P5.uploadIndexé",
      up.status === 200 && upCree?.status === "SUCCESS" && dUp.total >= 1 && (dUp.items ?? []).some((x) => x.id === upCree?.id),
      `upload PDF → ${up.status}/${upCree?.status ?? "?"}, recherche « 44556677 » → total=${dUp.total} (indexé dès l'import)`
    );

    // P6 : requête du PORTAIL (cinIndex OU jetons) — le CIN 08765432 n'est
    // présent QUE dans le contenu de deux fiches (champ cin null / autre)
    const emp = cryptoBd.chiffrerChamp("08765432", true);
    const candidats = await prisma.payslip.findMany({
      where: { OR: [{ cinIndex: emp }, { cinTokens: { some: { token: emp } } }] },
      select: { id: true },
    });
    verdict(
      "P6.portailRequeteIndexée",
      candidats.length === 2,
      `requête portail (cinIndex OU jetons) → ${candidats.length} candidates (attendu 2)`
    );
  } catch (e) {
    console.error("[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    try { await prisma.$disconnect(); } catch {}
    if (admin) { try { admin.kill("SIGTERM"); } catch {} setTimeout(() => { try { admin.kill("SIGKILL"); } catch {} }, 2500).unref(); }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n===== PHASE 4/5 TASK 99 : ${ok}/${resultats.length} PASS =====`);
    resultats.forEach((r) => { if (!r.ok) console.log(`  ECHEC ${r.id}`); });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
