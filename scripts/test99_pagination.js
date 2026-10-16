/**
 * ============================================================================
 * Task 99 — Test E2E PAGINATION SERVEUR + RECHERCHE CIN SERVEUR (240 000)
 * ============================================================================
 * Phases :
 *   P0  démarrage serveur standalone (port 4204) + compte IT
 *   P1  petit volume NON indexé (250 fiches) : repli de déchiffrement,
 *       parité sémantique exacte (E1..E8), pagination de liste
 *   P2  volume 240 000 : protections (409 indexation requise, 400 requête
 *       courte), perfs de la liste paginée
 *   P3  indexation par lots (POST répétés) — mesure du débit
 *   P4  post-indexation : recherche à distance (fiche n° ~240 200), pages de
 *       recherche (150 fiches même CIN), parité indexée, stats voie rapide
 *   P5  bilan
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = "/home/z/my-project/task99_pagination/base";
const SERVER = path.join(
  ROOT, ".next", "standalone", "task99_pagination", "base", "server.js"
);
const PORT_ADMIN = 4204;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const DB = path.join(ROOT, "db", "custom.db");

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
process.env.DATABASE_URL = "file:" + DB;

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const prisma = new PrismaClient();
const DOSSIER_STOCKAGE = path.join(ROOT, "storage", "payslips");

const MDP_IT = "It2026!pag99";
const EMAIL_IT = "it-pagination-test@autorh.local";

/* --------- jumelle du filtre EXACT (copie de exactCinRegex, test) --------- */
function normalizeQuery(query) {
  return query.toUpperCase().replace(/[\s./\-]/g, "");
}
function exactCinRegex(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(sep);
  const purelyNumeric = /^[0-9]+$/.test(q);
  const leftGuard = purelyNumeric ? "(?<![0-9A-Z][ \\t./\\-])" : "";
  return new RegExp(
    `(?<![A-Z0-9])${leftGuard}${escaped}(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])`
  );
}
function estExactDansContenu(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(content.toUpperCase()) : false;
}
/** Résultat attendu (algorithme HISTORIQUE, indépendant du nouveau code). */
function attenduRecherche(rows, qn) {
  return rows.filter((r) => {
    const nc = String(r.normalizedContent ?? "").toUpperCase();
    if (!nc.includes(qn)) return false;
    const cin = r.cin ? normalizeQuery(r.cin) : "";
    return cin === qn || estExactDansContenu(String(r.content ?? ""), qn);
  });
}

/* ----------------------------- utilitaires ------------------------------ */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("timeout GET " + url)));
  });
}

function httpRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === null ? null : Buffer.from(body, "utf8");
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("timeout " + method + " " + url)));
    if (data) req.write(data);
    req.end();
  });
}

async function attendreServeur(url, essais = 90) {
  for (let i = 0; i < essais; i++) {
    try { await httpGet(url); return; } catch { await attendre(500); }
  }
  throw new Error("Serveur injoignable : " + url);
}

async function login(email, motDePasse) {
  const r = await httpRequest("POST", ADMIN + "/api/auth/login", {
    body: JSON.stringify({ email, password: motDePasse }),
  });
  let cookie = "";
  const sc = r.headers["set-cookie"];
  if (Array.isArray(sc))
    for (const c of sc) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
  return { status: r.status, cookie };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/* ------------------- génération de fiches de test ----------------------- */
let compteurContenu = 0;
function contenuFiche(cin, variantes = {}) {
  compteurContenu++;
  const mois = String((compteurContenu % 12) + 1).padStart(2, "0");
  const lignes = [
    "REPUBLIQUE TUNISIENNE — BULLETIN DE PAIE",
    "SOCIETE EXEMPLE SARL — AFFILIE CNSS 17775208-08",
    `MATRICULE: ${1000 + (compteurContenu % 9000)}`,
  ];
  if (!variantes.sansCin) lignes.push(`CIN: ${cin}`);
  if (variantes.contenuSupplementaire) lignes.push(variantes.contenuSupplementaire);
  lignes.push(
    `NOM: EMPLOYE ${compteurContenu}`,
    `PERIODE: du 01/${mois}/26 au 28/${mois}/26`,
    "CATEGORIE: 3 - ECHELON: 5",
    "SALAIRE BRUT: 1 250,500 TND",
    "RETENUE CNSS: 9,25%",
    "IMPOT SUR REVENU: 145,320 TND",
    "NET A PAYER: 1 050,250 TND",
    "MODE DE PAIEMENT: VIREMENT BANCAIRE",
    "SIGNATURE: LE DIRECTEUR DES RESSOURCES HUMAINES",
    // remplissage réaliste (montants, dates — aucune trace du CIN cherché)
    "PRIME DE RENDEMENT: 120,000   PRIME DE TRANSPORT: 40,000",
    "ABSENCE NON JUSTIFIEE: 0 JOUR   CONGES ACQUIS: 2,5 JOURS",
    `DATE DE PAIEMENT: 27/${mois}/26   REFERENCE: VRMT-${100000 + compteurContenu}`,
  );
  return lignes.join("\n");
}

function normaliserContenu(texte) {
  return texte.toUpperCase().replace(/[\s./\-]/g, "");
}

/** PDF minimal VALIDE avec du texte extrait par pdf.js (structure complète :
 * catalogue, page, police, flux de contenu avec opérateurs Tj). */
function pdfMinimal(lignes) {
  const flux =
    "BT /F1 12 Tf 50 700 Td " +
    lignes
      .map((l) => `(${String(l).replace(/[()\\]/g, "")}) Tj 0 -20 Td`)
      .join(" ") +
    " ET";
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n" +
      `4 0 obj\n<< /Length ${Buffer.byteLength(flux, "utf8")} >>\nstream\n${flux}\nendstream\nendobj\n` +
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "utf8"
  );
}

/** Crée UNE fiche chiffrée (chemin direct, SANS middleware applicatif).
 * avecFichier : écrit aussi le PDF en clair dans le stockage (pour la
 * redétection, qui relit les fichiers sur disque). */
async function creerFicheBrute({ fileName, cin, content, employeeName, period, uploadedAt, netSalary, avecFichier }) {
  const texte = content ?? contenuFiche(cin ?? "00000000", cin ? {} : { sansCin: true });
  const storedName = `t99-${crypto.randomUUID()}.pdf`;
  if (avecFichier) {
    fs.mkdirSync(DOSSIER_STOCKAGE, { recursive: true });
    fs.writeFileSync(
      path.join(DOSSIER_STOCKAGE, storedName),
      pdfMinimal([
        "BULLETIN DE PAIE",
        cin ? `CIN: ${cin}` : "SANS CIN",
        "NET A PAYER: 1050,250 TND",
      ])
    );
  }
  const data = cryptoBd.chiffrerObjet("Payslip", {
    fileName: fileName ?? `Bulletin_${cin ?? "sansCIN"}.pdf`,
    storedName,
    fileSize: 24000 + (compteurContenu % 5000),
    content: texte,
    normalizedContent: normaliserContenu(texte),
    cin: cin ?? null,
    employeeName: employeeName ?? `EMPLOYE ${cin ?? compteurContenu}`,
    period: period ?? "du 01/08/26 au 31/08/26",
    netSalary: netSalary ?? "1050,250",
    matricule: null,
    pageNumber: 1,
    uploadedAt,
  });
  return prisma.payslip.create({ data });
}

/* ------------------------------ verdicts -------------------------------- */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "ECHEC"} ${id} — ${detail}`);
}

// (Task 99) diagnostics de mort subtile : tout plantage imprime sa trace.
process.on("uncaughtException", (e) => {
  console.error("[UNCAUGHT]", e);
  process.exit(2);
});
process.on("unhandledRejection", (e) => {
  console.error("[UNHANDLED REJECTION]", e);
  process.exit(2);
});

/* ================================ MAIN ================================== */
(async () => {
  let admin = null;
  let errBuf = "";
  const idsCrees = [];
  try {
    /* ---------- P0 : purge des exécutions précédentes ---------- */
    console.log("=== P0 : purge des données de test précédentes ===");
    const vieux = await prisma.payslip.deleteMany({
      where: { storedName: { startsWith: "t99-" } },
    });
    // (les jetons sont supprimés en cascade avec leur fiche)
    try {
      for (const f of fs.readdirSync(DOSSIER_STOCKAGE)) {
        if (f.startsWith("t99-")) {
          try { fs.unlinkSync(path.join(DOSSIER_STOCKAGE, f)); } catch {}
        }
      }
    } catch {}
    await prisma.user.deleteMany({
      where: { email: cryptoBd.chiffrerChamp(EMAIL_IT, true) },
    });
    console.log(`  purge : ${vieux.count} fiche(s) supprimée(s)`);

    /* ---------- P0 : serveur + compte IT ---------- */
    console.log("=== P0 : démarrage serveur (port " + PORT_ADMIN + ") ===");
    admin = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT_ADMIN),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: "file:" + DB,
        AUTO_RH_ROOT: ROOT,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    admin.stderr.on("data", (c) => {
      // (Task 99) borné : sans cela, l'accumulation des journaux serveur
      // fait exploser la mémoire du harnais sur les gros volumes.
      errBuf = (errBuf + c).slice(-40000);
    });
    await attendreServeur(`${ADMIN}/login`);
    await attendre(1200);

    await prisma.user.create({
      data: cryptoBd.chiffrerObjet("User", {
        email: EMAIL_IT,
        name: "IT Pagination Test (Task 99)",
        passwordHash: hashPassword(MDP_IT),
        role: "IT",
        isActive: true,
        passwordChangedAt: new Date(),
      }),
    });
    const it = await login(EMAIL_IT, MDP_IT);
    verdict("P0.login", it.status === 200 && Boolean(it.cookie), `login IT → ${it.status}`);
    if (!it.cookie) throw new Error("login impossible");
    const auth = { Cookie: `auto_rh_session=${it.cookie}` };
    const get = (u) => httpGet(ADMIN + u, auth);

    /* ---------- P1 : petit volume NON indexé (repli + parité) ---------- */
    console.log("=== P1 : 250 fiches non indexées — repli déchiffrement + parité ===");
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // Cas limites sémantiques (E1..E8)
    const casLimites = [];
    casLimites.push(await creerFicheBrute({ cin: "12345678", uploadedAt: new Date(base), fileName: "E1_classique.pdf", avecFichier: true }));
    // E2 : CIN présent dans le CONTENU seulement (champ cin null)
    casLimites.push(await creerFicheBrute({ cin: null, uploadedAt: new Date(base + 1000), fileName: "E2_sansCinContenu.pdf", content: contenuFiche("08765432") }));
    casLimites.push(await creerFicheBrute({ cin: "99999999", uploadedAt: new Date(base + 2000), fileName: "E3_multiCIN.pdf", content: contenuFiche("99999999", { contenuSupplementaire: "AUTRE EMPLOYE CIN: 08765432" }) }));
    casLimites.push(await creerFicheBrute({ cin: "12 345 678", uploadedAt: new Date(base + 3000), fileName: "E4_espaces.pdf" }));
    // E5/E6 : écritures séparées dans le contenu, champ cin null
    casLimites.push(await creerFicheBrute({ cin: null, uploadedAt: new Date(base + 4000), fileName: "E5_separe.pdf", content: contenuFiche("26 542 351") }));
    casLimites.push(await creerFicheBrute({ cin: null, uploadedAt: new Date(base + 5000), fileName: "E6_tiret.pdf", content: contenuFiche("9593-1034") }));
    casLimites.push(await creerFicheBrute({ cin: "A123456", uploadedAt: new Date(base + 6000), fileName: "E7_alnum.pdf" }));
    for (let k = 0; k < 3; k++) {
      casLimites.push(await creerFicheBrute({ cin: "11112222", uploadedAt: new Date(base + 7000 + k), fileName: `E8_multi_${k}.pdf`, period: `du 01/0${k + 1}/26 au 28/0${k + 1}/26` }));
    }
    idsCrees.push(...casLimites.map((r) => r.id));
    // 240 fiches nominales
    for (let j = 0; j < 240; j++) {
      const r = await creerFicheBrute({ cin: String(30000000 + j), uploadedAt: new Date(base + 10000 + j * 1000) });
      idsCrees.push(r.id);
    }

    // Expectations INDEPENDANTES (algorithme historique) sur TOUTES les
    // fiches du petit volume — y compris les nominales.
    const lues = await prisma.payslip.findMany({
      where: { storedName: { startsWith: "t99-" } },
    }).then((rs) => rs.map((r) => cryptoBd.dechiffrerObjet("Payslip", r)));

    async function testerRecherche(q, attendusIds, label) {
      const t0 = Date.now();
      const r = await get(`/api/payslips?cin=${encodeURIComponent(q)}`);
      const ms = Date.now() - t0;
      let data = null;
      try { data = JSON.parse(r.body); } catch {}
      const ok = r.status === 200 && data && JSON.stringify([...(data.items ?? [])].map((x) => x.id).sort()) === JSON.stringify([...attendusIds].sort());
      verdict(
        label,
        ok,
        `« ${q} » → ${r.status}, total=${data ? data.total : "?"}, attendus=${attendusIds.length}, ${ms} ms`
      );
      return data;
    }

    // S1 : CIN classique → E1 ET E4 (« 12 345 678 » normalisé identique)
    await testerRecherche("12345678", [casLimites[0].id, casLimites[3].id], "S1.cinClassique");
    // S2 : contenu seul (cin null) → E2 ET E3 (page multi-employés)
    await testerRecherche("08765432", [casLimites[1].id, casLimites[2].id], "S2.contenuSeul+multiCIN");
    // S3 : variante espacée → E1 ET E4
    await testerRecherche("12 345 678", [casLimites[0].id, casLimites[3].id], "S3.varianteEspaces");
    // S4 : séparés « 26 542 351 » → E5 ; partiels refusés
    await testerRecherche("26542351", [casLimites[4].id], "S4a.separeCollé");
    await testerRecherche("26 542 351", [casLimites[4].id], "S4b.separeEspacé");
    // S5 : « 9593-1034 » → E6 ; « 9593 » seul → rien (sous-séquence)
    await testerRecherche("95931034", [casLimites[5].id], "S5a.tiretCollé");
    await testerRecherche("9593", [], "S5b.sousSequenceRefusée");
    // S6 : alphanumérique insensible à la casse
    await testerRecherche("a123456", [casLimites[6].id], "S6.alnumCasse");
    // S7 : 3 fiches même CIN
    await testerRecherche("11112222", casLimites.slice(7, 10).map((r) => r.id), "S7.troisFiches");
    // S8 : inconnu → 0
    await testerRecherche("00000001", [], "S8.inconnu");

    // S9 : parité globale — pour CHAQUE cas limite, résultat API == historique
    for (const qn of ["12345678", "08765432", "26542351", "95931034", "A123456", "11112222", "30000042"]) {
      const attendus = attenduRecherche(lues, qn).map((r) => r.id).sort();
      const r = await get(`/api/payslips?cin=${encodeURIComponent(qn)}`);
      const data = JSON.parse(r.body);
      const obtenus = (data.items ?? []).map((x) => x.id).sort();
      verdict(
        "S9.parité." + qn,
        r.status === 200 && JSON.stringify(attendus) === JSON.stringify(obtenus),
        `historique=${attendus.length}, API=${obtenus.length}`
      );
    }

    // S10 : requête 2 caractères → 400 (règle inchangée : minimum 3)
    const s10 = await get("/api/payslips?cin=12");
    verdict("S10.requeteTropCourte", s10.status === 400, `cin=12 → ${s10.status}`);

    // L1..L4 : pagination de LISTE sur petit volume (250 fiches au total)
    const totalP1 = 250;
    const l1 = await get("/api/payslips?page=2&limit=7");
    const d1 = JSON.parse(l1.body);
    verdict(
      "L1.page2limit7",
      l1.status === 200 && d1.items.length === 7 && d1.page === 2 && d1.total === totalP1 && d1.totalPages === Math.ceil(totalP1 / 7),
      `page=2, limit=7 → ${d1.items.length} items, total=${d1.total}, totalPages=${d1.totalPages}`
    );
    const l2 = await get("/api/payslips?page=1&limit=7");
    const d2 = JSON.parse(l2.body);
    const ids1 = new Set(d1.items.map((x) => x.id));
    verdict(
      "L2.pagesDisjointes",
      d2.items.every((x) => !ids1.has(x.id)),
      "page 1 et page 2 sans chevauchement"
    );
    const l3 = await get("/api/payslips");
    const d3 = JSON.parse(l3.body);
    verdict(
      "L3.defaut100",
      l3.status === 200 && d3.items.length === 100 && d3.limit === 100 && d3.page === 1,
      `sans paramètres → ${d3.items.length} items (défaut 100), page=${d3.page}`
    );
    const l4 = await get("/api/payslips?limit=99999");
    const d4 = JSON.parse(l4.body);
    verdict(
      "L4.plafondLimit",
      d4.limit === 1000 && d4.items.length === 250,
      `limit=99999 → plafonné à ${d4.limit}, items=${d4.items.length} (toutes les fiches)`
    );
    const l5 = await get("/api/payslips?offset=10&limit=5");
    const d5 = JSON.parse(l5.body);
    verdict(
      "L5.offsetRetrocompatible",
      d5.items.length === 5 && d5.items[0].id === d3.items[10].id,
      "offset=10&limit=5 → même 6e fiche que la liste par défaut"
    );

    // S11 : redétection — la fiche E1 possède un VRAI fichier PDF sur disque
    // (redetect relit les fichiers stockés). On efface son CIN, la
    // redétection doit le retrouver ET le réindexer automatiquement.
    const cibleRedetect = casLimites[0].id;
    await prisma.payslip.update({
      where: { id: cibleRedetect },
      data: cryptoBd.chiffrerObjet("Payslip", { cin: null, employeeName: null, period: null }),
    });
    const rd = await httpRequest("POST", ADMIN + "/api/payslips/redetect", { headers: auth, body: "{}" });
    const rdData = JSON.parse(rd.body);
    const relue = await prisma.payslip.findUnique({ where: { id: cibleRedetect } })
      .then((r) => cryptoBd.dechiffrerObjet("Payslip", r));
    const rechercheApresRedetect = await get("/api/payslips?cin=12345678");
    const rdata = JSON.parse(rechercheApresRedetect.body);
    verdict(
      "S11.redetectReindexe",
      rd.status === 200 && normalizeQuery(relue.cin ?? "") === "12345678" &&
        (rdata.items ?? []).some((x) => x.id === cibleRedetect),
      `redetect → ${rd.status}, updated=${rdData.updated}/${rdData.total}, CIN re-détecté et retrouvé`
    );

    /* ---------- P2 : volume 240 000 ---------- */
    console.log("=== P2 : insertion de 240 000 fiches (par lots chiffrés) ===");
    const TAILLE_BULK = 240000;
    const LOTS = 1000;
    const cinsVus = new Set();
    for (const r of lues) {
      const n = normalizeQuery(r.cin ?? "");
      if (n) cinsVus.add(n);
    }
    for (let j = 0; j < 240; j++) cinsVus.add(String(30000000 + j));
    const CIN_LOIN = "98765432";
    const CIN_FREQUENT = "55554444"; // 150 fiches → pagination de recherche
    let idFicheLoin = null;
    const tSeed0 = Date.now();
    let lot = [];
    const envoyer = async () => {
      if (!lot.length) return;
      const data = lot.map((d) => cryptoBd.chiffrerObjet("Payslip", d));
      const crees = await prisma.payslip.createMany({ data });
      lot = [];
      return crees;
    };
    for (let i = 0; i < TAILLE_BULK; i++) {
      let cin;
      let employeeName;
      if (i === 50) { cin = CIN_LOIN; employeeName = "EMPLOYE LOINTAIN"; }
      else if (i >= 100 && i < 250) { cin = CIN_FREQUENT; employeeName = "EMPLOYE FREQUENT"; }
      else { cin = String(20000000 + i); employeeName = `EMPLOYE ${20000000 + i}`; }
      const n = normalizeQuery(cin);
      cinsVus.add(n);
      const uploadedAt = new Date(base + 100000 + i * 1000);
      const texte = contenuFiche(cin);
      lot.push({
        fileName: `Bulletin_${cin}.pdf`,
        storedName: `t99-bulk-${crypto.randomUUID()}.pdf`,
        fileSize: 24000 + (i % 5000),
        content: texte,
        normalizedContent: normaliserContenu(texte),
        cin,
        employeeName,
        period: "du 01/08/26 au 31/08/26",
        netSalary: "1050,250",
        matricule: null,
        pageNumber: 1,
        uploadedAt,
      });
      if (i === 50) {
        const rec = await creerFicheBrute({
          fileName: "Bulletin_98765432.pdf",
          cin: CIN_LOIN,
          employeeName: "EMPLOYE LOINTAIN",
          uploadedAt,
        });
        idFicheLoin = rec.id;
        idsCrees.push(rec.id);
        // la version « lot » de cette fiche n'est pas insérée
        lot.pop();
      }
      // (correctif) vider le lot toutes les 1000 fiches — sinon l'ensemble
      // des 240 000 objets s'accumule en mémoire
      if (lot.length >= LOTS) await envoyer();
    }
    await envoyer();
    // (Task 99) total attendu = petit volume (250) + volume massif (240 000,
    // dont la fiche lointaine i=50 créée unitairement à la place du lot).
    const totalAttendu = 240000 + 250;
    const dureeSeed = Math.round((Date.now() - tSeed0) / 1000);
    const totalBd = await prisma.payslip.count();
    console.log(`  insertion terminée en ${dureeSeed}s — total en base = ${totalBd}`);
    verdict("P2.totalFiches", totalBd === totalAttendu, `${totalBd} fiches (attendu ${totalAttendu})`);

    // L6 : pagination sur 240k — page 1, page profonde, perfs
    const t1 = Date.now();
    const p1r = await get("/api/payslips?page=1&limit=100");
    const p1 = JSON.parse(p1r.body);
    const msPage1 = Date.now() - t1;
    verdict(
      "L6a.page1perf",
      p1r.status === 200 && p1.items.length === 100 && p1.total === totalAttendu && p1.totalPages === Math.ceil(totalAttendu / 100) && msPage1 < 5000,
      `page 1 : ${msPage1} ms, ${p1.items.length} items, totalPages=${p1.totalPages}`
    );
    const pageProfonde = 2400;
    const t2 = Date.now();
    const pPr = await get(`/api/payslips?page=${pageProfonde}&limit=100`);
    const pPro = JSON.parse(pPr.body);
    const msProfonde = Date.now() - t2;
    verdict(
      "L6b.pageProfonde",
      pPr.status === 200 && pPro.items.length > 0 && pPro.page === pageProfonde && msProfonde < 5000,
      `page ${pageProfonde} : ${msProfonde} ms, ${pPro.items.length} items`
    );
    // Poids de la réponse (liste légère : pas de contenu)
    const poidsKo = Math.round(Buffer.byteLength(p1r.body, "utf8") / 1024);
    console.log(`  [info] poids page de 100 fiches ≈ ${poidsKo} Ko`);
    // Dernière page partielle
    const derniere = Math.ceil(totalAttendu / 100);
    const pD = JSON.parse((await get(`/api/payslips?page=${derniere}&limit=100`)).body);
    verdict(
      "L6c.dernierePartielle",
      pD.items.length === totalAttendu % 100,
      `dernière page (${derniere}) : ${pD.items.length} items (reste ${totalAttendu % 100})`
    );
    // Page au-delà → vide, pas d'erreur
    const pX = JSON.parse((await get(`/api/payslips?page=${derniere + 5}&limit=100`)).body);
    verdict("L6d.pageAuDela", pX.items.length === 0 && pX.page === derniere + 5, `page ${derniere + 5} → 0 item, sans erreur`);

    // P2.409 : recherche alors que 240k fiches ne sont pas indexées
    const r409 = await get(`/api/payslips?cin=${CIN_LOIN}`);
    const d409 = JSON.parse(r409.body);
    verdict(
      "P2.protection409",
      r409.status === 409 && d409.indexationRequise === true && d409.restants > 200000,
      `recherche avant indexation → ${r409.status} (indexationRequise, restants=${d409.restants})`
    );
    // P2.400 : requête courte sur grosse base
    const r400 = await get("/api/payslips?cin=12345");
    verdict("P2.requeteCourte400", r400.status === 400, `cin=12345 sur ${totalAttendu} fiches → ${r400.status}`);

    /* ---------- P3 : indexation par lots ---------- */
    console.log("=== P3 : indexation (POST répétés) — jusqu'à termine ===");
    const tIdx = Date.now();
    let appels = 0;
    let traitesTotal = 0;
    for (;;) {
      const r = await httpRequest("POST", ADMIN + "/api/payslips/indexation", {
        headers: auth,
        body: JSON.stringify({}),
      });
      if (r.status !== 200) {
        verdict("P3.indexation", false, `appel ${appels + 1} → ${r.status} ${r.body.slice(0, 200)}`);
        break;
      }
      const d = JSON.parse(r.body);
      appels++;
      traitesTotal += d.traites ?? 0;
      // (progression) chaque appel est journalisé — visibilité maximale
      console.log(
        `  [indexation] appel n°${appels} — +${d.traites ?? 0}, cumul ${traitesTotal.toLocaleString("fr-FR")}, restantes ${(d.restants ?? 0).toLocaleString("fr-FR")} (${Math.round((Date.now() - tIdx) / 1000)} s)`
      );
      if (d.termine) {
        const totalMs = Date.now() - tIdx;
        const debit = Math.round((traitesTotal / (totalMs / 1000)));
        verdict(
          "P3.indexation",
          traitesTotal === totalAttendu,
          `${traitesTotal.toLocaleString("fr-FR")} fiches indexées en ${Math.round(totalMs / 1000)} s (${appels} appels, ≈${debit.toLocaleString("fr-FR")} fiches/s)`
        );
        break;
      }
    }

    /* ---------- P4 : post-indexation ---------- */
    console.log("=== P4 : recherche indexée sur 240k ===");
    // Recherche de la fiche lointaine (elle était en page ~2402)
    const t3 = Date.now();
    const rLoin = await get(`/api/payslips?cin=${CIN_LOIN}`);
    const dLoin = JSON.parse(rLoin.body);
    const msLoin = Date.now() - t3;
    verdict(
      "P4.rechercheLointaine",
      rLoin.status === 200 && dLoin.total === 1 && dLoin.items[0]?.id === idFicheLoin && msLoin < 2000,
      `CIN ${CIN_LOIN} (fiche n° ~240 200) → trouvée en ${msLoin} ms, total=${dLoin.total}`
    );
    // Variante espacée → même résultat
    const dLoin2 = JSON.parse((await get(`/api/payslips?cin=${"98765 432"}`)).body);
    verdict(
      "P4.varianteEspaces",
      dLoin2.total === 1 && dLoin2.items[0]?.id === idFicheLoin,
      "« 98765 432 » → même fiche"
    );
    // Sous-séquence refusée (sémantique exacte inchangée)
    const dPart = JSON.parse((await get("/api/payslips?cin=8765432")).body);
    verdict("P4.sousSequenceRefusée", dPart.total === 0, "« 8765432 » (sous-séquence) → 0 résultat");
    // CIN fréquent : 150 fiches → pagination de RECHERCHE
    const dFreq = JSON.parse((await get(`/api/payslips?cin=${CIN_FREQUENT}`)).body);
    verdict(
      "P4.recherchePage1",
      dFreq.total === 150 && dFreq.items.length === 100 && dFreq.totalPages === 2,
      `CIN ${CIN_FREQUENT} → total=150, page 1 = 100 items, totalPages=2`
    );
    const dFreq2 = JSON.parse((await get(`/api/payslips?cin=${CIN_FREQUENT}&page=2`)).body);
    const idsF1 = new Set(dFreq.items.map((x) => x.id));
    verdict(
      "P4.recherchePage2",
      dFreq2.items.length === 50 && dFreq2.page === 2 && dFreq2.items.every((x) => !idsF1.has(x.id)),
      `page 2 → ${dFreq2.items.length} items, sans chevauchement`
    );
    // Parité post-indexation des cas limites (mêmes attentes qu'en P1)
    await testerRecherche("12345678", [casLimites[0].id], "P4a.paritéE1");
    await testerRecherche("08765432", [casLimites[1].id, casLimites[2].id], "P4b.paritéE2E3");
    await testerRecherche("26542351", [casLimites[4].id], "P4c.paritéE5");
    await testerRecherche("95931034", [casLimites[5].id], "P4d.paritéE6");
    await testerRecherche("a123456", [casLimites[6].id], "P4e.paritéE7");
    await testerRecherche("11112222", casLimites.slice(7, 10).map((r) => r.id), "P4f.paritéE8");

    // Stats : voie rapide SQL (indexation complète)
    const st = await get("/api/stats");
    const dSt = JSON.parse(st.body);
    verdict(
      "P4.statsRapide",
      st.status === 200 && dSt.total === totalAttendu && dSt.withCin === cinsVus.size,
      `stats → total=${dSt.total}, withCin=${dSt.withCin} (distincts attendus ${cinsVus.size}), employees=${dSt.employees}`
    );

    /* ---------- P5 : upload réel → indexé automatiquement ---------- */
    const PDF_TEXT = pdfMinimal([
      "BULLETIN DE PAIE",
      "CIN: 44556677",
      "NET: 1000 TND",
    ]);
    const boundary = "----t99" + Date.now();
    const corps = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="fichiers"; filename=" Bulletin_44556677.pdf "\r\nContent-Type: application/pdf\r\n\r\n`,
        "utf8"
      ),
      PDF_TEXT,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const up = await httpRequest("POST", ADMIN + "/api/payslips/upload", {
      headers: { ...auth, "Content-Type": "multipart/form-data; boundary=" + boundary },
      body: corps,
    });
    let upData = null;
    try { upData = JSON.parse(up.body); } catch {}
    const upCree = upData?.results?.[0];
    const idUploade = upCree?.id;
    if (idUploade) idsCrees.push(idUploade);
    const upTrouve = await get("/api/payslips?cin=44556677");
    const dUp = JSON.parse(upTrouve.body);
    verdict(
      "P5.uploadIndexé",
      up.status === 200 && upCree?.status === "SUCCESS" && dUp.total >= 1 &&
        (dUp.items ?? []).some((x) => x.id === idUploade),
      `upload PDF → ${up.status}/${upCree?.status ?? "?"}, recherche « 44556677 » → total=${dUp.total} (indexé dès l'import)`
    );

    /* ---------- Portail : jumelle indexée (test isolé de la requête) ---------- */
    const emp = cryptoBd.chiffrerChamp(CIN_LOIN, true);
    const candidats = await prisma.payslip.findMany({
      where: { OR: [{ cinIndex: emp }, { cinTokens: { some: { token: emp } } }] },
      select: { id: true, cin: true },
    });
    verdict(
      "P6.portailRequeteIndexée",
      candidats.length === 1 && candidats[0].id === idFicheLoin,
      `requête portail (cinIndex OU jeton) → ${candidats.length} candidate, bonne fiche`
    );
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    try { await prisma.$disconnect(); } catch {}
    if (admin) {
      try { admin.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { admin.kill("SIGKILL"); } catch {} }, 3000).unref();
    }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n===== BILAN TASK 99 : ${ok}/${resultats.length} PASS =====`);
    resultats.forEach((r) => { if (!r.ok) console.log(`  ECHEC ${r.id}`); });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
