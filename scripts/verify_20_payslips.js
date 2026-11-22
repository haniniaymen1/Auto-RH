// Vérification croisée des fiches de paie de test :
//  1. (CONSERVÉ) Chaque CIN doit être trouvé EXACTEMENT (recherche exacte) dans SA fiche uniquement.
//  2. (CONSERVÉ) Aucun CIN ne doit matcher une autre fiche (faux positif).
//  3. (CONSERVÉ) Réplique detectCin() pour prédire le CIN détecté/stocké en base.
//  4. (NOUVEAU)  Période + Nom/Prénom + Net à payer détectés sur les 20 Bulletins (régression).
//  5. (NOUVEAU)  CIN + Période + Nom/Prénom + Net à payer + Matricule sur les 20 fiches
//                "fiche_de_paie_XX.pdf" (formats SANS deux-points + balises <b>).
//
// Portabilité : fonctionne tel quel dans le projet ; les dossiers sont
// résolus relativement à ce script, ou via les variables d'environnement
// PAYSLIP_DIR (bulletins) et USER_SLIP_DIR (fiches utilisateur).
const { PDFParse } = require("pdf-parse");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = process.env.PAYSLIP_DIR || path.join(ROOT, "test-data", "payslips");

// Dossiers possibles pour les fiches de l'utilisateur (premier trouvé gagnant)
const USER_DIR_CANDIDATES = [
  process.env.USER_SLIP_DIR,
  path.join(ROOT, "upload", "user_slips"),
  DIR, // l'utilisateur peut aussi déposer fiche_de_paie_*.pdf dans test-data/payslips
].filter(Boolean);

const SLIPS = [
  ["Bulletin_Paie_01_Janvier2025.pdf", "09123456"],
  ["Bulletin_Paie_02_Fevrier2025.pdf", "09876543"],
  ["Bulletin_Paie_03_Mars2026.pdf", "04567890"],
  ["Bulletin_Paie_04_Avril2026.pdf", "01112223"],
  ["Bulletin_Paie_05_Mai2026.pdf", "02223334"],
  ["Bulletin_Paie_06_Juin2026.pdf", "05556667"],
  ["Bulletin_Paie_07_Juillet2026.pdf", "03334445"],
  ["Bulletin_Paie_08_Aout2026.pdf", "08123456"],
  ["Bulletin_Paie_09_Septembre2026.pdf", "A123456"],
  ["Bulletin_Paie_10_Octobre2026.pdf", "A654321"],
  ["Bulletin_Paie_11_Novembre2026.pdf", "B234567"],
  ["Bulletin_Paie_12_Decembre2026.pdf", "06112233"],
  ["Bulletin_Paie_13_Janvier2027.pdf", "1234567"],
  ["Bulletin_Paie_14_Fevrier2027.pdf", "07070707"],
  ["Bulletin_Paie_15_Mars2027.pdf", "04445556"],
  ["Bulletin_Paie_16_Avril2027.pdf", "06667778"],
  ["Bulletin_Paie_17_Mai2027.pdf", "07778889"],
  ["Bulletin_Paie_18_Juin2027.pdf", "03445566"],
  ["Bulletin_Paie_19_Juillet2027.pdf", "02233445"],
  ["Bulletin_Paie_20_Aout2027.pdf", "08889990"],
];

// (NOUVEAU) Attendus pour la section 4 — Période / Nom / Net (valeurs stockées par le site)
const BULLETIN_FIELDS = [
  ["Bulletin_Paie_01_Janvier2025.pdf", "BEN ALI Mohamed", "Janvier 2025", "1 760,050 DT"],
  ["Bulletin_Paie_02_Fevrier2025.pdf", "TRABELSI Amira", "02/2025", "2 336,118 DT"],
  ["Bulletin_Paie_03_Mars2026.pdf", "GHARBI Karim", "03/2026", "1 359,424 DT"],
  ["Bulletin_Paie_04_Avril2026.pdf", "JAZIRI Salma", "04/2026", "2 006,354 DT"],
  ["Bulletin_Paie_05_Mai2026.pdf", "MANSOURI Hédi", "du 01/05/26 au 31/05/26", "1 614,528 DT"],
  ["Bulletin_Paie_06_Juin2026.pdf", "CHAABANE Nadia", "Juin 2026", "2 494,422 DT"],
  ["Bulletin_Paie_07_Juillet2026.pdf", "BOUAZIZI Ali", "2026-07", "1 165,181 DT"],
  ["Bulletin_Paie_08_Aout2026.pdf", "DRIDI Samir", "Août 2026", "2 916,170 DT"],
  ["Bulletin_Paie_09_Septembre2026.pdf", "FERCHICHI Leila", "Septembre 2026", "2 067,675 DT"],
  ["Bulletin_Paie_10_Octobre2026.pdf", "GHANMI Youssef", "10/2026", "2 723,126 DT"],
  ["Bulletin_Paie_11_Novembre2026.pdf", "HAMDI Rim", "11/2026", "1 464,746 DT"],
  ["Bulletin_Paie_12_Decembre2026.pdf", "IBRAHIM Sofiene", "Décembre 2026", "2 546,944 DT"],
  ["Bulletin_Paie_13_Janvier2027.pdf", "JEDDI Mouna", "du 01/01/2027 au 31/01/2027", "1 306,163 DT"],
  ["Bulletin_Paie_14_Fevrier2027.pdf", "KAMMOUN Walid", "Février 2027", "1 821,371 DT"],
  ["Bulletin_Paie_15_Mars2027.pdf", "LOUATI Hanen", "Mars 2027", "2 261,458 DT"],
  ["Bulletin_Paie_16_Avril2027.pdf", "MEZLINI Fares", "04/2027", "1 557,467 DT"],
  ["Bulletin_Paie_17_Mai2027.pdf", "NACCACHE Dorra", "Mai 2027", "2 371,501 DT"],
  ["Bulletin_Paie_18_Juin2027.pdf", "OUALI Bechir", "du 01/06/2027 au 30/06/2027", "1 931,693 DT"],
  ["Bulletin_Paie_19_Juillet2027.pdf", "ZOUARI Ines", "Juillet 2027", "2 133,536 DT"],
  ["Bulletin_Paie_20_Aout2027.pdf", "BEN SALAH Rachid", "2027-08", "1 213,442 DT"],
];

// (NOUVEAU) Attendus pour la section 5 — fiches "fiche_de_paie_XX.pdf" de l'utilisateur.
// Tous les CIN sont identiques (07451236) : c'est le MÊME employé sur 20 formats
// de date/écriture CIN différents — la recherche exacte doit donc retourner les 20.
const USER_SLIPS = [
  ["fiche_de_paie_01.pdf", "Amine Ben Ali", "1 300,863 DT", "EMP-0001", "01/08/26"],
  ["fiche_de_paie_02.pdf", "Sami Trabelsi", "1 320,434 DT", "EMP-0002", "02-08-2026"],
  ["fiche_de_paie_03.pdf", "Yassine Hammami", "1 346,005 DT", "EMP-0003", "2026/08/03"],
  ["fiche_de_paie_04.pdf", "Meriem Jaziri", "1 370,576 DT", "EMP-0004", "04.08.2026"],
  ["fiche_de_paie_05.pdf", "Ines Gharbi", "1 419,148 DT", "EMP-0005", "August 05, 2026"],
  ["fiche_de_paie_06.pdf", "Ahmed Mansouri", "1 458,718 DT", "EMP-0006", "06 August 2026"],
  ["fiche_de_paie_07.pdf", "Nour Khelifi", "1 478,289 DT", "EMP-0007", "2026-08-07"],
  ["fiche_de_paie_08.pdf", "Malek Saidi", "1 503,860 DT", "EMP-0008", "08/08/2026"],
  ["fiche_de_paie_09.pdf", "Sarra Brahmi", "1 528,431 DT", "EMP-0009", "09-Aug-2026"],
  ["fiche_de_paie_10.pdf", "Oussama Chaabane", "1 577,002 DT", "EMP-0010", "Aug 10 2026"],
  ["fiche_de_paie_11.pdf", "Hiba Mrad", "1 616,573 DT", "EMP-0011", "11 Aug, 2026"],
  ["fiche_de_paie_12.pdf", "Fares Ayari", "1 636,144 DT", "EMP-0012", "2026.08.12"],
  ["fiche_de_paie_13.pdf", "Rania Ben Amor", "1 661,715 DT", "EMP-0013", "13_08_2026"],
  ["fiche_de_paie_14.pdf", "Seif Dridi", "1 686,286 DT", "EMP-0014", "08/14/2026"],
  ["fiche_de_paie_15.pdf", "Aya Karray", "1 734,857 DT", "EMP-0015", "15/08/26"],
  ["fiche_de_paie_16.pdf", "Mohamed Tlili", "1 774,428 DT", "EMP-0016", "2026-08-16"],
  ["fiche_de_paie_17.pdf", "Lina Kammoun", "1 793,999 DT", "EMP-0017", "17.08.26"],
  ["fiche_de_paie_18.pdf", "Wassim Mejri", "1 819,570 DT", "EMP-0018", "August 18 2026"],
  ["fiche_de_paie_19.pdf", "Mariem Ferchichi", "1 844,141 DT", "EMP-0019", "19 August, 2026"],
  ["fiche_de_paie_20.pdf", "Bilel Bouzid", "1 892,712 DT", "EMP-0020", "20-08-26"],
];
const USER_CIN = "07451236";
const USER_PERIOD = "Août 2026";

// --- Réplique exacte de la logique du site (src/lib/payslip-extractor.ts) ---
// (mise à jour : séparateurs espaces/points/tirets/slashs + garde anti-sous-numéro,
//  et detectCin avec le motif 1-bis "chiffres séparés" — anciens motifs conservés)
function normalizeQuery(q) { return q.toUpperCase().replace(/[\s.\/\-]/g, ""); }
function exactCinRegex(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(sep);
  return new RegExp(
    `(?<![A-Z0-9])(?<![0-9A-Z][ \\t./\\-])${escaped}(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])`
  );
}
function isExactCinInContent(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(content.toUpperCase()) : false;
}
function detectCin(text) {
  // 1-bis (NOUVEAU, conservé du site) : CIN libellé avec chiffres séparés
  // ("26 542 351", "9593-1034", "270.482.81", "38/346/578", …)
  const labeledSep = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?[^A-Z0-9]{0,12}((?:[A-Z]\s*)?\d[\d\s.\/\-]{3,12}\d)/i
  );
  if (labeledSep) {
    const cleaned = labeledSep[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    const digits = cleaned.match(/^(\d{5,})$/);
    if (digits) return digits[1].slice(0, 8);
    if (/^[A-Z]{0,2}\d{5,8}$/.test(cleaned)) return cleaned;
  }
  // 1. (ANCIEN, conservé) : CIN libellé, chiffres collés
  const labeled = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*[^A-Z0-9]{0,12}([A-Z]{0,2}\d{5,8})/i
  );
  if (labeled) return labeled[1].toUpperCase();
  // 2. (ANCIEN, conservé) : format tunisien 8 chiffres isolé
  const tunisian = text.match(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/);
  if (tunisian) return tunisian[1];
  // 3. (ANCIEN, conservé) : 1-2 lettres + 5-6 chiffres
  const moroccan = text.match(/(?:^|[^A-Z0-9])([A-Z]{1,2}\d{5,6})(?![0-9A-Z])/);
  if (moroccan) return moroccan[1];
  // 4. (NOUVEAU, conservé du site — dernier recours) : valeur ALPHANUMÉRIQUE
  //    après un libellé CIN — formats démo/fictifs : "DEMO 001 234",
  //    "DEMO-12-3456", "FICTIF/004567", "CIN XX 014 567", "ID: DEMO009012"…
  const alnum = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?(?:\([^)]{0,30}\))?[ \t]*[:=\-]?[ \t]*(?:\n[ \t]*(?:I\.?D\.?\s*)?[:=\-]?[ \t]*)?(?:I\.?D\.?\s*[:=\-]\s*)?([A-Z0-9](?:[A-Z0-9 \t.\/\-]{2,18}[A-Z0-9])?)/i
  );
  if (alnum) {
    const v = alnum[1]
      .replace(/^C\.?\s*I\.?\s*N\.?[ \t]+/i, "")
      .replace(/^[.\/\-]+/, "")
      .replace(/[.\/\-]+$/, "")
      .trim();
    const compact = v.replace(/[\s.\/\-]/g, "").toUpperCase();
    const digitCount = (compact.match(/\d/g) || []).length;
    if (compact.length >= 4 && compact.length <= 20 && digitCount >= 3) return compact;
  }
  return null;
}
// Réplique du filtre EXACT de la route de recherche du site :
// le CIN demandé correspond si (CIN détecté stocké === requête) OU (regex exacte sur le contenu)
function siteSearchMatch(text, detectedCin, query) {
  const q = normalizeQuery(query);
  return detectedCin === q || isExactCinInContent(text, q);
}

// --- (NOUVEAU) Répliques extractPeriod / extractEmployeeName / extractNetSalary / extractMatricule ---
function extractPeriod(text) {
  const range = text.match(
    /P[EÉ]RIODE(?:\s+DE\s+PAIE)?\s*[:=]?\s*(?:DU\s+)?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*(?:AU|[-–—]|À|A)\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  );
  if (range) return (`du ${range[1]} au ${range[2]}`).slice(0, 40);
  const patterns = [
    /P[EÉ]RIODE(?:\s+DE\s+PAIE|\s+DE\s+LA\s+PAIE|\s+DU\s+BULLETIN(?:\s+DE\s+PAIE)?)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /P[EÉ]RIODE\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2})/i,
    /MOIS(?:\s+DE\s+PAIE)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    // CORRECTION (garde) : "DATE DE PAIE" ne matche plus le début de "DATE DE PAIEMENT"
    /(?:MOIS|DATE\s+DE\s+PAIE(?![A-ZÀ-Ý]))\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    /(?:^|\n)[^\n]*?\bDU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+AU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[2] ? `du ${m[1]} au ${m[2]}` : m[1]).trim().slice(0, 40);
  }
  // NOUVEAU (conservé du site — dernier recours) : ligne suivant l'en-tête
  // "PÉRIODE (DE PAIE)" / "MOIS (DE PAIE)" — formats libres
  const header = text.match(
    /(?:^|\n)[ \t]*(?:P[EÉ]RIODE(?:\s+D[EÉ]\s+PAIE|\s+D[EÉ]\s+LA\s+PAIE|\s+DU\s+BULLETIN(?:\s+DE\s+PAIE)?)?|MOIS(?:\s+D[EÉ]\s+PAIE)?)[ \t]*[:=]?[ \t]*\n[ \t]*(.+?)[ \t]*(?:\n|$)/i
  );
  if (header) {
    let value = header[1].trim();
    value = value
      .replace(/^P[EÉ]RIODE(?:\s+D[EÉ]\s+PAIE|\s+D[EÉ]\s+LA\s+PAIE)?\s*[:=\-]\s*/i, "")
      .replace(/^MOIS(?:\s+D[EÉ]\s+PAIE)?\s*[:=\-]\s*/i, "")
      .trim();
    value = value
      .split(/\s+(?:DATE\s+DE\s+PAIEMENT|EMPLOYEUR|SALARI[EÉ]|RUBRIQUE|RECAPITULATIF|C\.?\s*I\.?\s*N\.?\b|NET)/i)[0]
      .trim();
    const digitRuns = (value.match(/\d+/g) || []).length;
    const MOIS_FR = /JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE|JANV|F[EÉ]V|AVR|JUIL|SEPT|OCT|NOV|D[EÉ]C/i;
    if (
      value.length >= 3 && value.length <= 40 &&
      !/^(?:DATE\s+DE\s+PAIEMENT|EMPLOYEUR|SALARI[EÉ]|RUBRIQUE|RECAPITULATIF|NET\s+[ÀA]\s+PAYER)/i.test(value) &&
      (digitRuns >= 2 || MOIS_FR.test(value))
    ) return value;
  }
  return null;
}

function extractEmployeeName(text) {
  const patterns = [
    // ANCIEN (conservé) : libellé suivi de ":" ou "="
    /(?:NOM\s*(?:ET\s*PRENOMS?|PR[EÉ]NOMS?)?|EMPLOY[EÉ]|SALARI[EÉ])\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
    // ANCIEN (conservé)
    /COLLABORATEUR\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
    // NOUVEAU : "Nom et prénom Amine Ben Ali" SANS deux-points
    /(?:^|\n)[ \t]*NOM(?![A-ZÀ-Ý])[ \t]*(?:ET[ \t]*|&[ \t]*|\/[ \t]*)?(?:PR[EÉ]NOMS?(?![A-ZÀ-Ý]))?[ \t]*[:=]?[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
    // NOUVEAU : "Employé Amine Ben Ali" / "Salarié Amine Ben Ali" sans deux-points
    /(?:^|\n)[ \t]*(?:EMPLOY[EÉ]|SALARI[EÉ])(?![A-ZÀ-Ý])[ \t]*[:=]?[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
    // NOUVEAU : en-tête "SALARIÉ(E)" / "EMPLOYÉ(E)" — nom sur la ligne suivante
    /(?:^|\n)[ \t]*(?:SALARI[EÉ]|EMPLOY[EÉ])\s*\(\s*E\s*\)[ \t]*\n[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
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

function extractNetSalary(text) {
  const m = text.match(
    /NET\s+[ÀA]?\s*(?:A\s*)?PAYER(?:\s*[:=]\s*|\s*)((?:<[^<>]{0,40}>\s*){0,8})([\d\s.,']{3,15})\s*(?:DT|DINARS?|DH|MAD|TND|€)?/i
  );
  if (m) return m[2].trim().replace(/\s{2,}/g, " ") + " DT";
  return null;
}

function extractMatricule(text) {
  // NOUVEAU (prioritaire) : matricule salarié en début de ligne — ignore le
  // "Matricule fiscal" de l'employeur. Ancien motif non ancré conservé ensuite.
  const lineStart = text.match(
    /(?:^|\n)[ \t]*MATRICULE(?!\s+FISCAL)(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i
  );
  if (lineStart && /\d/.test(lineStart[1])) return lineStart[1].trim();
  const m = text.match(/MATRICULE(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i);
  if (m && /\d/.test(m[1])) return m[1].trim();
  return null;
}

async function readText(file) {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  try {
    const res = await parser.getText();
    return (res.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function findUserDir() {
  for (const dir of USER_DIR_CANDIDATES) {
    if (dir && fs.existsSync(path.join(dir, "fiche_de_paie_01.pdf"))) return dir;
  }
  return null;
}

async function main() {
  let errors = 0;

  const texts = [];
  for (const [file] of SLIPS) {
    texts.push(await readText(path.join(DIR, file)));
  }

  console.log("=== 1) Matrice croisée : recherche EXACTE de chaque CIN sur chaque fiche ===");
  for (let i = 0; i < SLIPS.length; i++) {
    const [file, cin] = SLIPS[i];
    const hits = [];
    for (let j = 0; j < SLIPS.length; j++) {
      if (isExactCinInContent(texts[j], cin)) hits.push(SLIPS[j][0]);
    }
    const ok = hits.length === 1 && hits[0] === file;
    if (!ok) errors++;
    console.log(`${ok ? "PASS" : "ÉCHEC"}  ${cin.padEnd(9)} → ${hits.length} fiche(s)${ok ? "" : " : " + hits.join(", ")}`);
  }

  console.log("\n=== 2) Requêtes partielles (doivent retourner 0 fiche) ===");
  for (const partial of ["0912", "1234", "123456", "091234", "A123", "23456", "654321", "8889990", "812345", "0707"]) {
    const hits = [];
    for (let j = 0; j < SLIPS.length; j++) {
      if (isExactCinInContent(texts[j], partial)) hits.push(SLIPS[j][0]);
    }
    const ok = hits.length === 0;
    if (!ok) errors++;
    console.log(`${ok ? "PASS" : "ÉCHEC"}  "${partial}" → ${hits.length} fiche(s)${ok ? "" : " : " + hits.join(", ")}`);
  }

  console.log("\n=== 3) CIN détecté (valeur stockée en base) par fiche ===");
  for (let i = 0; i < SLIPS.length; i++) {
    const [file, cin] = SLIPS[i];
    const det = detectCin(texts[i]);
    const note = det === cin ? "" : `   ⚠ détecté=${det === null ? "null" : det} (la recherche par contenu reste EXACTE)`;
    console.log(`${file.padEnd(38)} CIN réel=${cin.padEnd(9)} détecté=${det === null ? "null" : det}${note}`);
  }

  console.log("\n=== 4) (NOUVEAU) Période + Nom/Prénom + Net à payer sur les 20 Bulletins ===");
  for (let i = 0; i < BULLETIN_FIELDS.length; i++) {
    const [file, expName, expPer, expNet] = BULLETIN_FIELDS[i];
    const t = texts[i];
    const name = extractEmployeeName(t);
    const per = extractPeriod(t);
    const net = extractNetSalary(t);
    const ok = name === expName && per === expPer && net === expNet;
    if (!ok) errors++;
    console.log(
      `${ok ? "PASS" : "ÉCHEC"}  ${file}\n      nom=${name ?? "null"}${name === expName ? "" : "  (attendu : " + expName + ")"}\n      période=${per ?? "null"}${per === expPer ? "" : "  (attendu : " + expPer + ")"}\n      net=${net ?? "null"}${net === expNet ? "" : "  (attendu : " + expNet + ")"}`
    );
  }

  console.log("\n=== 5) (NOUVEAU) Fiches utilisateur fiche_de_paie_01..20 : CIN + Période + Nom + Net + Matricule ===");
  const userDir = findUserDir();
  if (!userDir) {
    console.log("INFO : dossier des fiches utilisateur introuvable (upload/user_slips ou PAYSLIP_DIR) — section 5 ignorée.");
  } else {
    console.log(`Dossier : ${userDir}`);
    let sectionFail = 0;
    for (const [file, expName, expNet, expMat, expDate] of USER_SLIPS) {
      const p = path.join(userDir, file);
      if (!fs.existsSync(p)) { console.log(`ÉCHEC  ${file} absent`); sectionFail++; errors++; continue; }
      const t = await readText(p);
      const cin = detectCin(t);
      const per = extractPeriod(t);
      const name = extractEmployeeName(t);
      const net = extractNetSalary(t);
      const mat = extractMatricule(t);
      const ok = cin === USER_CIN && per === USER_PERIOD && name === expName && net === expNet && mat === expMat;
      if (!ok) sectionFail++, errors++;
      console.log(
        `${ok ? "PASS" : "ÉCHEC"}  ${file}  (date d'édition : ${expDate})\n      CIN=${cin ?? "null"} | période=${per ?? "null"} | nom=${name ?? "null"} | net=${net ?? "null"} | matricule=${mat ?? "null"}`
      );
    }
    // Rappel : le MÊME CIN sur les 20 fiches → la recherche du site les retourne
    // TOUTES (même employé). Réplique exacte du filtre de la route :
    // (CIN détecté === requête) OU (regex exacte dans le contenu).
    let all = [];
    for (const [file] of USER_SLIPS) {
      const p = path.join(userDir, file);
      if (!fs.existsSync(p)) continue;
      const t = await readText(p);
      if (siteSearchMatch(t, detectCin(t), USER_CIN)) all.push(file);
    }
    console.log(`INFO  Recherche exacte "${USER_CIN}" → ${all.length}/20 fiches (attendu : 20 — même employé, 20 formats d'écriture différents)`);
    if (all.length !== USER_SLIPS.length) errors++;
    console.log(sectionFail === 0 ? "→ 20/20 fiches utilisateur : TOUT est détecté ✔" : `→ ${sectionFail} fiche(s) en échec ✘`);
  }

  console.log(
    errors === 0
      ? "\n✔ TOUS LES TESTS PASSENT (CIN exact + période + nom/prénom + net à payer + matricule)"
      : `\n✘ ${errors} ERREUR(S)`
  );
  process.exit(errors === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
