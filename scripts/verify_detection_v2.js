// ============================================================================
// Vérification de la détection v2 : CIN (avec séparateurs) + PÉRIODE
//  A. 20 fiches de l'utilisateur (upload/files_extracted) :
//     - detectCin  -> CIN attendu (20 écritures différentes)
//     - extractPeriod -> période attendue ("Période de paie : Mois Année")
//     - recherche exacte : chaque CIN -> SA fiche uniquement
//     - recherche partielle -> TOUJOURS 0 résultat
//  B. NON-RÉGRESSION : 20 anciennes fiches Sage (test-data/payslips)
//     - mêmes contrôles de recherche exacte + détectCin
// Réplique EXACTE de la logique v2 (src/lib/payslip-extractor.ts).
// ============================================================================
const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const path = require("path");

// --- Réplique exacte de la logique v2 du site -------------------------------
function normalizeText(t) { return String(t || "").toUpperCase().replace(/[\s.\/\-]/g, ""); }
function normalizeQuery(q) { return normalizeQuery0(q); }
function normalizeQuery0(q) { return String(q || "").toUpperCase().replace(/[\s.\/\-]/g, ""); }
function exactCinRegex(query) {
  const q = normalizeQuery0(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(sep);
  return new RegExp(
    "(?<![A-Z0-9])(?<![0-9A-Z][ \\t./\\-])" + escaped + "(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])"
  );
}
function isExactCinInContent(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(String(content || "").toUpperCase()) : false;
}
function detectCin(text) {
  // 1-bis. NOUVEAU : libellé CIN + chiffres séparés (espaces/points/tirets/slashs)
  const labeledSep = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/i
  );
  if (labeledSep) {
    const cleaned = labeledSep[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    const digits = cleaned.match(/^(\d{5,})$/);
    if (digits) return digits[1].slice(0, 8);
    if (/^[A-Z]{0,2}\d{5,8}$/.test(cleaned)) return cleaned;
  }
  // 1. ANCIEN conservé : libellé CIN + chiffres collés
  const labeled = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*[^A-Z0-9]{0,12}([A-Z]{0,2}\d{5,8})/i
  );
  if (labeled) return labeled[1].toUpperCase();
  // 2. ANCIEN conservé : 8 chiffres isolés
  const tunisian = text.match(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/);
  if (tunisian) return tunisian[1];
  // 3. ANCIEN conservé : 1-2 lettres + 5-6 chiffres
  const moroccan = text.match(/(?:^|[^A-Z0-9])([A-Z]{1,2}\d{5,6})(?![0-9A-Z])/);
  if (moroccan) return moroccan[1];
  return null;
}
function extractPeriod(text) {
  const range = text.match(
    /P[EÉ]RIODE(?:\s+DE\s+PAIE)?\s*[:=]?\s*(?:DU\s+)?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*(?:AU|[-–—]|À|A)\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  );
  if (range) return `du ${range[1]} au ${range[2]}`.slice(0, 40);
  const patterns = [
    /P[EÉ]RIODE(?:\s+DE\s+PAIE|\s+DE\s+LA\s+PAIE|\s+DU\s+BULLETIN(?:\s+DE\s+PAIE)?)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /P[EÉ]RIODE\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2})/i,
    /MOIS(?:\s+DE\s+PAIE)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    /(?:MOIS|DATE\s+DE\s+PAIE)\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    /(?:^|\n)[^\n]*?\bDU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+AU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[2] ? `du ${m[1]} au ${m[2]}` : m[1]).trim().slice(0, 40);
  }
  return null;
}
function extractEmployeeName(text) {
  const patterns = [
    /(?:NOM\s*(?:ET\s*PRENOMS?|PR[EÉ]NOMS?)?|EMPLOY[EÉ]|SALARI[EÉ])\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
    /COLLABORATEUR\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      let name = m[1].trim().replace(/\s{2,}/g, " ").slice(0, 60);
      const cut = name.replace(
        /\s+(?:MATRICULES?|N[°O]?\s*CNSS|CNSS|POSTE(?:\s+OCCUP[EÉ])?|FONCTION|DATE(?:\s+D'[A-ZÀ-ÿ]+)?|C\.?I\.?N\.?|SERVICE|D[EÉ]PARTEMENT|EMPLOI)\b[\s\S]*$/i,
        ""
      ).trim().replace(/[\s:]+$/, "");
      if (cut.length >= 3) name = cut;
      return name;
    }
  }
  return null;
}

// --- Données de test ---------------------------------------------------------
// A. Fiches de l'utilisateur : fichier -> [CIN attendu, période attendue]
const USER_DIR = "/home/z/my-project/upload/files_extracted";
const USER = [
  ["fiche_paie_01.pdf", "32181960", "Avril 2026"],
  ["fiche_paie_02.pdf", "26542351", "Février 2026"],  // 26 542 351
  ["fiche_paie_03.pdf", "95931034", "Février 2026"],  // 9593-1034
  ["fiche_paie_04.pdf", "92832764", "Septembre 2026"],// N° 92832764
  ["fiche_paie_05.pdf", "39537672", "Avril 2026"],    // CIN: 39537672
  ["fiche_paie_06.pdf", "10122691", "Octobre 2026"],  // CIN N° 10 122 691
  ["fiche_paie_07.pdf", "27048281", "Mai 2026"],      // 270.482.81
  ["fiche_paie_08.pdf", "15430391", "Février 2026"],  // C.I.N n° 15430391
  ["fiche_paie_09.pdf", "38346578", "Avril 2026"],    // 38/346/578
  ["fiche_paie_10.pdf", "10518347", "Mars 2026"],     // N°CIN : 1051 8347
  ["fiche_paie_11.pdf", "56670106", "Février 2026"],  // brut
  ["fiche_paie_12.pdf", "81080132", "Août 2026"],     // 81 080 132
  ["fiche_paie_13.pdf", "68723430", "Janvier 2026"],  // 6872-3430
  ["fiche_paie_14.pdf", "19136193", "Janvier 2026"],  // N° 19136193
  ["fiche_paie_15.pdf", "46247510", "Octobre 2026"],  // CIN: 46247510
  ["fiche_paie_16.pdf", "42784980", "Mai 2026"],      // CIN N° 42 784 980
  ["fiche_paie_17.pdf", "93534874", "Février 2026"],  // 935.348.74
  ["fiche_paie_18.pdf", "80112805", "Mars 2026"],     // C.I.N n° 80112805
  ["fiche_paie_19.pdf", "86923226", "Décembre 2026"], // 86/923/226
  ["fiche_paie_20.pdf", "33754330", "Juillet 2026"],  // N°CIN : 3375 4330
];

// B. Anciennes fiches Sage (non-régression)
const SAGE_DIR = "/home/z/my-project/test-data/payslips";
const SAGE = [
  ["Bulletin_Paie_01_Janvier2025.pdf", "09123456", "Janvier 2025"],
  ["Bulletin_Paie_02_Fevrier2025.pdf", "09876543", "Février 2025"],
  ["Bulletin_Paie_03_Mars2026.pdf", "04567890", "Mars 2026"],
  ["Bulletin_Paie_04_Avril2026.pdf", "01112223", "Avril 2026"],
  ["Bulletin_Paie_05_Mai2026.pdf", "02223334", "Mai 2026"],
  ["Bulletin_Paie_06_Juin2026.pdf", "05556667", "Juin 2026"],
  ["Bulletin_Paie_07_Juillet2026.pdf", "03334445", "Juillet 2026"],
  ["Bulletin_Paie_08_Aout2026.pdf", "08123456", "Août 2026"],
  ["Bulletin_Paie_09_Septembre2026.pdf", "A123456", "Septembre 2026"],
  ["Bulletin_Paie_10_Octobre2026.pdf", "A654321", "Octobre 2026"],
  ["Bulletin_Paie_11_Novembre2026.pdf", "B234567", "Novembre 2026"],
  ["Bulletin_Paie_12_Decembre2026.pdf", "06112233", "Décembre 2026"],
  ["Bulletin_Paie_13_Janvier2027.pdf", "1234567", "Janvier 2027"],
  ["Bulletin_Paie_14_Fevrier2027.pdf", "07070707", "Février 2027"],
  ["Bulletin_Paie_15_Mars2027.pdf", "04445556", "Mars 2027"],
  ["Bulletin_Paie_16_Avril2027.pdf", "06667778", "Avril 2027"],
  ["Bulletin_Paie_17_Mai2027.pdf", "07778889", "Mai 2027"],
  ["Bulletin_Paie_18_Juin2027.pdf", "03445566", "Juin 2027"],
  ["Bulletin_Paie_19_Juillet2027.pdf", "02233445", "Juillet 2027"],
  ["Bulletin_Paie_20_Aout2027.pdf", "08889990", "Août 2027"],
];

async function readText(dir, file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const parser = new PDFParse({ data: buf });
  try {
    const res = await parser.getText();
    return res.text || "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function partialsOf(cin) {
  const p = new Set();
  if (cin.length > 4) p.add(cin.slice(0, cin.length - 1)); // tout sauf le dernier
  if (cin.length > 4) p.add(cin.slice(1));                 // tout sauf le premier
  if (cin.length > 5) p.add(cin.slice(0, 4));              // 4 premiers
  if (cin.length > 6) p.add(cin.slice(2, 7));              // 5 du milieu
  // formes espacées/tirétées que l'utilisateur pourrait taper par erreur
  p.add(cin.slice(0, 4) + "-" + cin.slice(4));
  p.add(cin.slice(0, 2) + " " + cin.slice(2, 5) + " " + cin.slice(5));
  return [...p].filter((x) => x.replace(/[\s.\-/]/g, "").length >= 3 && x.replace(/[\s.\-/]/g, "") !== cin);
}

let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log(`  PASS  ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  // ================= A. Fiches de l'utilisateur =================
  console.log("\n================ A. VOS 20 FICHES (détection CIN + période) ================");
  const userTexts = [];
  for (const [file] of USER) userTexts.push(await readText(USER_DIR, file));

  console.log("\n-- A1. CIN détecté (stocké en base) --");
  for (let i = 0; i < USER.length; i++) {
    const [file, cin] = USER[i];
    const got = detectCin(userTexts[i]);
    check(`${file} -> ${cin}`, got === cin, got === cin ? "" : `obtenu: ${got}`);
  }

  console.log("\n-- A2. Période détectée --");
  for (let i = 0; i < USER.length; i++) {
    const [file, , per] = USER[i];
    const got = extractPeriod(userTexts[i]);
    check(`${file} -> « ${per} »`, got === per, got === per ? "" : `obtenu: ${got}`);
  }

  console.log("\n-- A3. Nom détecté (sans « Matricule paie » collé) --");
  for (let i = 0; i < USER.length; i++) {
    const got = extractEmployeeName(userTexts[i]) || "";
    const ok = /matricule/i.test(got) === false && got.length >= 3;
    check(`${USER[i][0]} -> « ${got} »`, ok, ok ? "" : "contient encore un libellé parasite");
  }

  console.log("\n-- A4. Recherche EXACTE : chaque CIN -> SA fiche uniquement --");
  for (let i = 0; i < USER.length; i++) {
    const [file, cin] = USER[i];
    const hits = [];
    for (let j = 0; j < USER.length; j++) {
      if (isExactCinInContent(userTexts[j], cin)) hits.push(USER[j][0]);
    }
    check(`CIN ${cin} -> ${file}`, hits.length === 1 && hits[0] === file, hits.length === 1 ? "" : `trouvés: ${hits.join(", ")}`);
  }

  console.log("\n-- A5. Recherche PARTIELLE / variante -> 0 résultat partout --");
  let partialCombos = 0, leaks = 0;
  for (let i = 0; i < USER.length; i++) {
    const [file, cin] = USER[i];
    for (const p of partialsOf(cin)) {
      partialCombos++;
      for (let j = 0; j < USER.length; j++) {
        if (isExactCinInContent(userTexts[j], p)) { leaks++; console.log(`  FUITE: "${p}" matche ${USER[j][0]}`); }
      }
    }
  }
  check(`${partialCombos} recherches partielles -> 0 correspondance`, leaks === 0, `${leaks} fuite(s)`);

  console.log("\n-- A6. Pré-filtre SQL (normalizedContent contient la requête normalisée) --");
  let preFiltreKo = 0;
  for (let i = 0; i < USER.length; i++) {
    const [, cin] = USER[i];
    for (let j = 0; j < USER.length; j++) {
      const norm = normalizeText(userTexts[j]);
      if (isExactCinInContent(userTexts[j], cin) && !norm.includes(normalizeQuery0(cin))) preFiltreKo++;
    }
  }
  check("tout match exact passe le pré-filtre normalisé", preFiltreKo === 0, `${preFiltreKo} écart(s)`);

  // ================= B. Non-régression : anciennes fiches Sage =================
  console.log("\n================ B. NON-RÉGRESSION : 20 anciennes fiches Sage ================");
  const sageTexts = [];
  for (const [file] of SAGE) sageTexts.push(await readText(SAGE_DIR, file));

  console.log("\n-- B1. CIN détecté inchangé --");
  for (let i = 0; i < SAGE.length; i++) {
    const [file, cin] = SAGE[i];
    const got = detectCin(sageTexts[i]);
    check(`${file} -> ${cin}`, got === cin, got === cin ? "" : `obtenu: ${got}`);
  }

  console.log("\n-- B2. Recherche exacte : chaque CIN -> SA fiche uniquement --");
  for (let i = 0; i < SAGE.length; i++) {
    const [file, cin] = SAGE[i];
    const hits = [];
    for (let j = 0; j < SAGE.length; j++) {
      if (isExactCinInContent(sageTexts[j], cin)) hits.push(SAGE[j][0]);
    }
    check(`CIN ${cin} -> ${file}`, hits.length === 1 && hits[0] === file, hits.length === 1 ? "" : `trouvés: ${hits.join(", ")}`);
  }

  console.log("\n-- B3. Recherche partielle -> 0 résultat --");
  let p2 = 0, leaks2 = 0;
  for (let i = 0; i < SAGE.length; i++) {
    const [, cin] = SAGE[i];
    for (const p of partialsOf(cin)) {
      p2++;
      for (let j = 0; j < SAGE.length; j++) {
        if (isExactCinInContent(sageTexts[j], p)) { leaks2++; console.log(`  FUITE: "${p}" matche ${SAGE[j][0]}`); }
      }
    }
  }
  check(`${p2} recherches partielles -> 0 correspondance`, leaks2 === 0, `${leaks2} fuite(s)`);

  // ================= C. Cas limites documentés =================
  console.log("\n================ C. Cas limites ================");
  const t = "N° CIN : 26 542 351 Matricule CNSS : 8707870\nDate de paiement : 28/02/2026";
  check("26542351 trouvé", isExactCinInContent(t, "26542351"));
  check("26 542 351 (saisie avec espaces) trouvé", isExactCinInContent(t, "26 542 351"));
  check("2654235 (7/8) refusé", !isExactCinInContent(t, "2654235"));
  check("542351 (fin) refusé", !isExactCinInContent(t, "542351"));
  check("265423518 (8+1 chiffre inventé) refusé", !isExactCinInContent(t, "265423518"));
  const t2 = "CIN : 9593-1034 Matricule";
  check("95931034 trouvé dans '9593-1034'", isExactCinInContent(t2, "95931034"));
  check("9593-1034 (saisie telle quelle) trouvé", isExactCinInContent(t2, "9593-1034"));
  check("9593 (début) refusé", !isExactCinInContent(t2, "9593"));
  check("1034 (fin) refusé", !isExactCinInContent(t2, "1034"));
  const t3 = "A 123456"; // artefact d'extraction (ancien cas, doit rester OK)
  check("A123456 trouvé dans 'A 123456' (artefact, comportement conservé)", isExactCinInContent(t3, "A123456"));
  check("123456 (sans la lettre) refusé", !isExactCinInContent(t3, "123456"));

  console.log(`\n================ BILAN : ${pass} PASS / ${fail} FAIL ================`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
