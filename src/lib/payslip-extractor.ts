import { PDFParse } from "pdf-parse";
// NOUVEAU (ajouté sans modifier l'existant) : OCR des PDF image
// (fiches converties PNG -> PDF, scans) — voir src/lib/payslip-ocr.ts
// NOUVEAU (ajouté) : ocrPdfPagesHighRes = passe OCR « haute lisibilité »
// (agrandissement 2x + segmentation PSM 4) complémentaire de ocrPdfPages.
import { ocrPdfPages, ocrPdfPagesHighRes, OCR_TEXT_MIN } from "./payslip-ocr";

export interface ExtractedPayslip {
  text: string;
  normalizedText: string;
  pages: number;
  cin: string | null;
  employeeName: string | null;
  period: string | null;
  netSalary: string | null;
  matricule: string | null;
  // NOUVEAU : true quand le texte provient (aussi) de l'OCR (PDF image).
  // Champ optionnel : aucun appelant existant n'est impacté.
  ocrUsed?: boolean;
}

/** Normalise un texte : majuscules + suppression de tous les espaces.
 * Permet de retrouver un CIN même si l'extraction a inséré des espaces.
 * NOUVEAU : supprime aussi les points, tirets et slashs pour retrouver un CIN
 * écrit sous la forme "26 542 351", "9593-1034", "270.482.81" ou "38/346/578". */
export function normalizeText(text: string): string {
  return text.toUpperCase().replace(/[\s.\/\-]/g, "");
}

/** Normalise une requête CIN saisie par l'utilisateur.
 * NOUVEAU : l'utilisateur peut saisir "9593-1034" ou "26 542 351",
 * la requête est nettoyée de la même manière que le contenu. */
export function normalizeQuery(query: string): string {
  return query.toUpperCase().replace(/[\s.\/\-]/g, "");
}

/** Extrait le texte d'un buffer PDF. */
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
    const pages = result.pages?.length || 1;
    return { text, pages };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * NOUVEAU (Task 70) : VALEURS CIN écrites sur la ligne qui SUIT un libellé.
 * Retourne TOUTES les valeurs trouvées (detectCin n'utilise que la première,
 * la route « répertoire employés » les utilise toutes — lecture seule).
 *
 * Règles de la ligne candidate (située 1 à 2 lignes non vides après le
 * libellé) :
 *  - rejetée si elle ressemble à un MONTANT : devise (TND/EUR/USD/MAD/DH/€),
 *    pourcentage, décimal « 1 450,000 » ;
 *  - nettoyée : contenu entre parenthèses retiré (« (INVALIDE) », « (FORMAT
 *    FICTIF) »), préfixes « ID: » / « CIN » retirés, puis seuls A-Z0-9
 *    conservés (espaces, tirets, points, slashs supprimés) ;
 *  - acceptée si : longueur 7-16, uniquement A-Z0-9, et
 *      · purement numérique : EXACTEMENT 8 ou 9 chiffres (CIN classiques),
 *      · lettres + chiffres : au plus 8 lettres ET au moins 5 chiffres
 *        (« DEMO001234 », « FICTIF004567 », « XX014567 », « 013456DEMO »).
 * Les lignes de tableaux (« Rubrique Base Taux Gains Retenues ») et les
 * lignes de montants sont automatiquement rejetées (0 chiffre / marqueurs).
 */
export function valeursCinLigneSuivante(text: string): string[] {
  const trouvees: string[] = [];
  if (!text) return trouvees;
  const lignes = text.split("\n").map((l) => l.trim());
  const RE_LABEL =
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+(?:NATIONALE\s+)?D'?\s*IDENTIT)/i;
  const nettoyerLigne = (ligne: string): string | null => {
    if (!ligne) return null;
    // Marqueurs de montant / devise : jamais un CIN.
    if (/(?:TND|EUR|USD|MAD|\bDH\b|€|\d\s*%|,\d{3})/i.test(ligne)) return null;
    let t = ligne.replace(/\([^)]*\)/g, " ");
    t = t.replace(/^(?:ID|CIN)\s*[:\-]?\s+/i, "");
    const nettoye = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{7,16}$/.test(nettoye)) return null;
    // CORRECTIF (Task 70, vérifié par diag70_source_s6.mjs) : une ligne-champ
    // « Periode : 09/2026 » produisait le faux positif PERIODE092026. Deux
    // gardes : (a) une ligne contenant « : » n'est jamais une valeur CIN nue
    // (le libellé est sur la ligne PRÉCÉDENTE ; seuls les étiquetages
    // immédiats « ID: » / « CIN: » restent tolérés) ; (b) les mots-étiquettes
    // des bulletins de paie ne peuvent PAS commencer un CIN.
    if (ligne.includes(":") && !/^\s*(?:ID|CIN)\s*[:\-]/i.test(ligne)) return null;
    if (
      /^(?:PERIODE|PERIOD|EMPLOYE|MATRICULE|NET|BRUT|SALAIRE|FONCTION|SERVICE|SITUATION|FAMILLE|CATEGORIE|REGIME|CNSS|AMO|CIMR|MUTUELLE|ENTREPRISE|SOCIETE|AGENCE|TELEPHONE|ADRESSE|BANQUE|TOTAL|IMPOSABLE|RETENUE|GAINS|CHARGE)/.test(
        nettoye
      )
    ) {
      return null;
    }
    const chiffres = (nettoye.match(/\d/g) || []).length;
    const lettres = nettoye.length - chiffres;
    if (lettres === 0) return /^\d{8,9}$/.test(nettoye) ? nettoye : null;
    if (lettres > 8 || chiffres < 5) return null;
    return nettoye;
  };
  for (let i = 0; i < lignes.length; i++) {
    if (!lignes[i] || !RE_LABEL.test(lignes[i])) continue;
    for (let j = i + 1; j <= i + 2 && j < lignes.length; j++) {
      if (!lignes[j]) continue;
      const v = nettoyerLigne(lignes[j]);
      if (v) {
        trouvees.push(v);
        break;
      }
    }
  }
  return Array.from(new Set(trouvees));
}

// NOUVEAU (Task 154) : bulletins à LIBELLÉS EMPILÉS VERTICALEMENT — la
// couche texte PDF isole chaque libellé sur sa propre ligne, les valeurs
// suivent EN BLOC dans le même ordre (bulletins réels « Tunis Call
// Center », 1000 pages) :
//   "MATRICULE" / "NOM ET PRENOM" / "FONCTION" / "CATEGORIE"    (libellés)
//   "294452"    / "TMAR AZIZ"      / "Webdesigner" / "Exécution"  (valeurs)
// Le parser repère chaque run d'au moins 2 libellés connus consécutifs et
// associe à chaque libellé la valeur de même rang. Règle GÉNÉRIQUE (aucun
// nom ni employeur codé en dur) : vaut pour toute fiche de ce format.
const LIBELLES_VERTICAUX = new Set([
  "MATRICULE", "NOM ET PRENOM", "NOM ET PRENOMS", "NOM", "NOMS",
  "PRENOM", "PRENOMS", "FONCTION", "EMPLOI", "POSTE", "CATEGORIE",
  "SERVICE", "DEPARTEMENT", "ETAT CIVIL", "SITUATION FAMILIALE",
  "ENF A CHARGE", "ENFANT A CHARGE", "ENFANTS A CHARGE",
  "CNSS", "N CNSS", "NO CNSS", "NUM CNSS",
  "CIN", "N CIN", "NO CIN", "NUM CIN",
  "DATE EMBAUCHE", "DATE D EMBAUCHE",
]);

const normaliserLibelleVert = (l: string): string =>
  l
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.°'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// NOUVEAU (Task 160, correctif fiabilité) : certains bulletins de MÊME
// structure écrivent DEUX libellés sur UNE MÊME ligne, séparés par un
// espacement large (couche texte PDF) :
//   "MATRICULE" / "NOM ET PRENOM" / … / "ENF. A CHARGE"
//   "N° CNSS                                N° CIN"      <- 2 libellés / ligne
//   "003879"   / "EMPLOYE TEST"   / …
// Cette ligne n'est PAS un libellé unique connu -> le run s'arrêtait AVANT
// elle et la collecte des valeurs commençait SUR elle : la valeur de rang 1
// devenait « N° CNSS N° CIN » et le MATRICULE réel (003879) était attribué
// au rang suivant -> extractMatricule renvoyait null (9 fiches réelles).
// Correctif GÉNÉRIQUE : une ligne dont TOUS les morceaux (séparés par un
// espacement de 2+ espaces) sont des libellés connus prolonge le bloc de
// libellés, chaque morceau dans l'ordre. Les lignes de VALEURS (noms,
// nombres, « 28843385 - 97 »…) ne correspondent jamais : aucun de leurs
// morceaux n'est un libellé connu. Formats horizontaux (libellés déjà sur
// lignes séparées) et tableurs (tabulations, indexLibellesHorizontaux)
// restent traités par leurs règles existantes inchangées.
const libellesMultiSurLigne = (ligne: string): string[] => {
  const morceaux = ligne.split(/\s{2,}/).map((m) => normaliserLibelleVert(m)).filter(Boolean);
  if (morceaux.length < 2) return [];
  return morceaux.every((m) => LIBELLES_VERTICAUX.has(m)) ? morceaux : [];
};

// NOUVEAU (Task 160, correctif fiabilité) : pdf-parse peut émettre les
// libellés de colonnes sur UNE MÊME ligne séparés par des ESPACES SIMPLES
// (fusion des cellules du tableau) :
//   "MATRICULE NOM ET PRENOM FONCTION CATEGORIE"
//   "ETAT CIVIL ENF. A CHARGE N° CNSS N° CIN"
//   "003879 EMPLOYE TEST Technicien en Informatique"
// On reconnaît une telle ligne en la consommant GREEMENT de gauche à
// droite : chaque morceau doit être un libellé connu (essai du plus long
// d'abord, pour distinguer « NOM ET PRENOMS » de « NOM ET PRENOM »), et la
// ligne ENTIERE doit être consommée par au moins 2 libellés. Une ligne de
// VALEURS (« 003879 EMPLOYE TEST … », « Célibataire 0 17775208 08 »)
// commence par un mot inconnu -> rejetée immédiatement. Aucun nom,
// matricule ni employeur codé en dur : règle valable pour toute fiche de
// ce format.
const LIBELLES_TRIES_LONGUEUR = Array.from(LIBELLES_VERTICAUX).sort(
  (a, b) => b.length - a.length
);
export function ligneDeLibelles(ligne: string): string[] | null {
  let reste = normaliserLibelleVert(ligne);
  if (!reste) return null;
  const trouves: string[] = [];
  while (reste.length) {
    reste = reste.replace(/^[ \t]+/, "");
    if (!reste) break;
    const candidat = LIBELLES_TRIES_LONGUEUR.find(
      (lb) => reste === lb || reste.startsWith(lb + " ")
    );
    if (!candidat) return null;
    trouves.push(candidat);
    reste = reste.slice(candidat.length);
  }
  return trouves.length >= 2 ? trouves : null;
}

/**
 * NOUVEAU (Task 154) : lit les blocs « libellés empilés puis valeurs empilées »
 * et renvoie libellé normalisé -> valeur (premier bloc gagnant pour un libellé
 * donné). Voir le commentaire de LIBELLES_VERTICAUX pour la structure visée.
 */
export function blocLibellesVerticaux(text: string): Map<string, string> {
  const res = new Map<string, string>();
  if (!text) return res;
  const lignes = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lignes.length; i++) {
    if (
      !LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[i])) &&
      libellesMultiSurLigne(lignes[i]).length < 2
    )
      continue;
    // run de libellés consécutifs — au moins 2 : un libellé isolé n'est
    // pas un bloc (évite tout faux positif sur les fiches classiques)
    let j = i;
    const labels: string[] = [];
    while (
      j < lignes.length &&
      (LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[j])) ||
        /* NOUVEAU (Task 160) : ligne multi-libellés (« N° CNSS   N° CIN ») */
        (() => {
          const multi = libellesMultiSurLigne(lignes[j]);
          if (multi.length >= 2) {
            labels.push(...multi);
            return true;
          }
          return false;
        })())
    ) {
      if (LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[j])))
        labels.push(normaliserLibelleVert(lignes[j]));
      j++;
    }
    if (labels.length < 2) continue;
    // valeurs dans le même ordre : au plus labels.length lignes, arrêt
    // au prochain libellé connu (lui-même début du bloc suivant)
    const valeurs: string[] = [];
    let k = j;
    while (
      k < lignes.length &&
      valeurs.length < labels.length &&
      !LIBELLES_VERTICAUX.has(normaliserLibelleVert(lignes[k]))
    ) {
      valeurs.push(lignes[k]);
      k++;
    }
    for (let v = 0; v < labels.length && v < valeurs.length; v++) {
      if (!res.has(labels[v])) res.set(labels[v], valeurs[v]);
    }
    i = k - 1; // le prochain bloc peut commencer à k (« ETAT CIVIL »…)
  }
  return res;
}

// NOUVEAU (Task 154) : une VALEUR de nom crédible pour le bloc vertical —
// lettres/espaces/tirets/apostrophes uniquement, pas un libellé, pas un nombre.
const estValeurNomVert = (v: string): boolean =>
  /^[A-Za-zÀ-ÿ'’\- ]{3,60}$/.test((v || "").trim()) &&
  !LIBELLES_VERTICAUX.has(normaliserLibelleVert(v)) &&
  !/^\d+$/.test((v || "").trim());

// NOUVEAU (Task 157) : bulletins TABLEUR (XLSX/XLS sérialisés par
// sheet_to_csv avec des TABULATIONS) — les libellés sont sur UNE MÊME ligne
// séparés par des tabulations, les valeurs correspondantes sur la ligne
// suivante À LA MÊME POSITION DE COLONNE (50 fiches réelles « DEMO CALL
// CENTER » : 50/50 noms manquants avant ce correctif) :
//   "Matricule\tNom et Prénom\t\tFonction\tDépartement"   (libellés)
//   "00001\tJLASSI SANA\t\tAGENT ADMINISTRATIF"            (valeurs)
// Le parser repère chaque ligne contenant au moins 2 libellés connus et
// associe à chaque libellé la cellule de MÊME INDEX de la 1ʳᵉ ligne de
// valeurs suivante (non vide, non elle-même une ligne de libellés).
// Règle GÉNÉRIQUE (aucun nom ni employeur codé en dur) : vaut pour toute
// fiche de ce format. Les PDF texte ne sont pas affectés : leur couche
// texte n'émet pas de tabulations (layout espaces) et le parser vertical
// (Task 154) reste appelé EN PREMIER, comportement inchangé.
const indexLibellesHorizontaux = (ligne: string): number[] => {
  const cellules = ligne.split("\t");
  const idx: number[] = [];
  for (let c = 0; c < cellules.length; c++) {
    if (LIBELLES_VERTICAUX.has(normaliserLibelleVert(cellules[c]))) idx.push(c);
  }
  return idx;
};

/**
 * NOUVEAU (Task 157) : lit les blocs « libellés EN LIGNE puis valeurs en
 * ligne suivante » (tableurs) et renvoie libellé normalisé -> valeur
 * (premier bloc gagnant pour un libellé donné). Voir le commentaire de
 * indexLibellesHorizontaux pour la structure visée.
 */
export function blocLibellesHorizontaux(text: string): Map<string, string> {
  const res = new Map<string, string>();
  if (!text) return res;
  const lignes = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  for (let i = 0; i < lignes.length; i++) {
    const idxLabels = indexLibellesHorizontaux(lignes[i]);
    if (idxLabels.length < 2) continue;
    // ligne de valeurs : 1ʳᵉ ligne suivante non vide qui n'est PAS
    // elle-même une ligne de libellés (sinon ce serait le bloc suivant)
    for (let j = i + 1; j < lignes.length && j <= i + 3; j++) {
      if (!lignes[j] || !lignes[j].trim()) continue;
      if (indexLibellesHorizontaux(lignes[j]).length >= 2) break; // autre bloc
      const cellules = lignes[j].split("\t");
      for (const b of idxLabels) {
        const lib = normaliserLibelleVert(lignes[i].split("\t")[b]);
        if (res.has(lib)) continue;
        const v = b < cellules.length ? (cellules[b] || "").trim() : "";
        if (v) res.set(lib, v);
      }
      break; // première ligne de valeurs consommée
    }
  }
  return res;
}

/**
 * NOUVEAU (Task 157) : consommation commune des blocs de libellés
 * (verticaux Task 154 et horizontaux Task 157) pour le NOM — même ordre de
 * priorité : « NOM ET PRENOM » complet, puis « NOM » + « PRENOM » séparés.
 * Retourne null si aucun nom crédible n'est trouvé (l'appelant continue).
 */
const nomDepuisBlocLibelles = (bloc: Map<string, string>): string | null => {
  if (!bloc || bloc.size === 0) return null;
  const nomComplet =
    bloc.get("NOM ET PRENOM") || bloc.get("NOM ET PRENOMS");
  if (nomComplet && estValeurNomVert(nomComplet)) {
    return nomComplet.trim().replace(/\s{2,}/g, " ").slice(0, 60);
  }
  const nomSeul = bloc.get("NOM");
  const prenomSeul = bloc.get("PRENOM") || bloc.get("PRENOMS");
  if (
    nomSeul &&
    prenomSeul &&
    estValeurNomVert(nomSeul) &&
    estValeurNomVert(prenomSeul)
  ) {
    return (nomSeul.trim() + " " + prenomSeul.trim())
      .replace(/\s{2,}/g, " ")
      .slice(0, 60);
  }
  if (nomSeul && estValeurNomVert(nomSeul) && !prenomSeul) {
    return nomSeul.trim().replace(/\s{2,}/g, " ").slice(0, 60);
  }
  return null;
};

/**
 * Détecte un CIN dans le texte du contenu.
 * Stratégie (dans l'ordre de fiabilité) :
 *  1-bis. NOUVEAU : champ libellé CIN avec chiffres SÉPARÉS
 *         ("26 542 351", "9593-1034", "270.482.81", "38/346/578", …)
 *  1. Champ explicitement libellé "C.I.N" / "CIN" / "Carte d'identité"
 *  1-sexies. NOUVEAU (Task 70) : libellé CIN SEUL sur sa ligne, valeur sur
 *            la LIGNE SUIVANTE (ex. « CIN (FORMAT FICTIF) » \n « DEMO 001 234 »)
 *  2. Format tunisien : 8 chiffres
 *  3. Format marocain / général : 1-2 lettres + 5 à 8 chiffres
 */
export function detectCin(text: string): string | null {
  // NOUVEAU (Task 27) : en-tête de colonne « N° CIN » — la déclaration est
  // DÉPLACÉE en tête de fonction (elle était historiquement dans la règle 5)
  // pour être réutilisée par la NOUVELLE règle 1-ter. Aucun changement de
  // comportement : la règle 5 utilise exactement la même regex.
  const CIN_COLUMN_HEADER =
    /(?:^|[^\dA-ZÀ-Þ])N\s*[°o]\s*C\.?\s*I\.?\s*N\.?(?:[^\dA-ZÀ-Þ]|$)/i;

  // 1-bis. NOUVEAU : champ libellé CIN avec chiffres séparés par des espaces,
  // points, tirets ou slashs. Ex. :
  //   "CIN : 26 542 351"          (espaces 2-3-3)
  //   "N° CIN : 9593-1034"        (tiret 4-4)
  //   "C.I.N n° 270.482.81"       (points 3-3-2)
  //   "N° CIN : 38/346/578"       (slashs 2/3/3)
  //   "N°CIN : 1051 8347"         (espace 4-4)
  //   "CIN N° 42 784 980"         (préfixe N° + espaces)
  // Les séparateurs sont retirés : le CIN stocké est toujours compact (ex. 26542351).
  const labeledSep = text.match(
    // MODIFIÉ (Task 159) : idem règle 1 — libellé et valeur sur la MÊME ligne
    // ([^\S\n] après le libellé, gap sans \n) ; sinon l'en-tête de colonne
    // « … N° CIN » capte le matricule de la ligne suivante (003879).
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])[^\S\n]*(?:N\s*[°o]\s*)?[^A-Z0-9\n]{0,12}((?:[A-Z]{1,8}[\s.\/-]*)?\d[\d\s.\/\-]{3,12}\d)/i
  );
  if (labeledSep) {
    const cleaned = labeledSep[1].replace(/[\s.\/\-]/g, "").toUpperCase();
    // Cas 8 chiffres ou plus collés après nettoyage : on garde les 8 premiers
    // (évite de capturer un CIN + un autre nombre restés sur la même ligne).
    const digits = cleaned.match(/^(\d{5,})$/);
    if (digits) {
      // NOUVEAU (Task 27) : EXACTEMENT 9 chiffres = CIN tunisien récent
      // (carte biométrique, ex. 140000911) -> conservé EN ENTIER. Les
      // valeurs de 10 chiffres et plus restent tronquées à 8 (comportement
      // historique de protection contre les nombres collés).
      if (cleaned.length === 9) return cleaned;
      return digits[1].slice(0, 8);
    }
    // Cas lettres + chiffres (ex. A 12 34 56 -> A123456).
    // MODIFIÉ (Task 70) : préfixe élargi de 0-2 à 0-8 lettres et minimum
    // abaissé à 4 chiffres — les fiches SPECIMEN de l'utilisateur écrivent
    // le CIN sous des formes à 3-8 lettres (« CIN : DEMO 001 234 »,
    // « CIN : SPEC-0001 »). Toujours APRÈS un libellé CIN explicite : le
    // libellé garantit la sémantique, aucune extension hors libellé.
    if (/^[A-Z]{0,8}\d{4,9}$/.test(cleaned)) return cleaned;
  }

  // 1. ANCIEN (conservé) : champ libellé CIN, chiffres collés
  //    (tirets, points, espaces tolérés autour du libellé)
  // MODIFIÉ (Task 27) : \d{5,9} + garde (?!\d) — le CIN tunisien récent
  // compte 9 chiffres (« N° CIN : 140000911 ») : la règle historique
  // \d{5,8} en capturait les 8 PREMIERS (« 14000091 » — CIN TRONQUÉ).
  // La garde (?!\d) garantit qu'on ne capture jamais un fragment d'un
  // nombre plus long (une suite de 10+ chiffres est rejetée par cette
  // règle et tombe dans les règles suivantes, comme avant). Pour les
  // valeurs à 8 chiffres ou moins le comportement est STRICTEMENT
  // identique à l'historique.
  const labeled = text.match(
    // MODIFIÉ (Task 159) : le libellé et sa valeur doivent rester sur la MÊME
    // ligne ([^\S\n] + classe sans \n). Avant, \s* puis la classe du gap
    // traversaient un saut de ligne : dans les bulletins « Tunis Call Center »
    // couche texte, l'en-tête de colonnes « … N° CIN » capturait le MATRICULE
    // « 003879 » de la ligne suivante comme s'il était étiqueté CIN. Les
    // valeurs à la ligne suivante restent couvertes par la règle 1-sexies
    // (libellé seul) et la règle 1-ter (en-tête de colonne).
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])[^\S\n]*[^A-Z0-9\n]{0,12}([A-Z]{0,8}\d{5,9})(?!\d)/i
  );
  if (labeled) return labeled[1].toUpperCase();

  // 1-sexies. NOUVEAU (Task 70) : libellé CIN SEUL sur sa ligne, VALEUR sur
  // la ligne suivante. Vu sur les fiches réelles de l'utilisateur :
  //   « CIN (FORMAT FICTIF) »\n« DEMO 001 234 »      (4 lettres + 6 chiffres)
  //   « CIN (FORMAT FICTIF) »\n« FICTIF/004567 »    (6 lettres + 6 chiffres)
  //   « CIN (FORMAT FICTIF) »\n« 000 005 678 (INVALIDE) »
  //   « CIN (FORMAT FICTIF) »\n« ID: DEMO009012 »
  //   « CIN (FORMAT FICTIF) »\n« 013-456-DEMO »      (chiffres PUIS lettres)
  // Les règles « même ligne » (1-bis / 1) ne voient QUE la ligne du libellé :
  // la valeur leur est invisible -> 0 CIN détecté pour ces 20 fiches.
  const valeursLigneSuivante = valeursCinLigneSuivante(text);
  if (valeursLigneSuivante.length > 0) return valeursLigneSuivante[0];

  // 1-ter. NOUVEAU (Task 27) : CIN à 9 chiffres lu SOUS un en-tête de
  // colonne « N° CIN » dans les bulletins à TABLEAUX exportés Word/Excel
  // (1 cellule = 1 ligne : l'en-tête et la valeur sont éloignés de
  // plusieurs lignes — la règle 5 (fenêtre 3 lignes, jetons
  // LETTRES-chiffres) et la règle 2 (1er 8 chiffres isolé) ne les
  // captaient pas : le N° CNSS « 17700137 - 04 » était retenu À LA
  // PLACE du CIN). Exemple réel (bulletin « Tunis Call Center ») :
  //   "ETAT CIVIL" / "ENF. A CHARGE" / "N° CNSS" / "N° CIN" / ...
  //   "Marie(e)" / "2" / "17700137 - 04" / "140000911"
  // Fenêtre : 12 lignes non vides sous l'en-tête. Le candidat doit être
  // un nombre isolé de 8 ou 9 chiffres, avec les MÊMES exclusions
  // que detectCinFromTableContext (clé CNSS « - 08 » juste après,
  // montant décimal collé avant/après).
  // MODIFIÉ (Task 154) : 9 chiffres -> 8 ou 9 chiffres. Les bulletins texte
  // réels (« Tunis Call Center », couche PDF) ont un CIN à 8 CHIFFRES sous
  // l'en-tête « N° CIN » : la règle ne couvrait que 9 chiffres et laissait
  // la règle 2 capter le N° CNSS « 28843385 - 97 » (8 chiffres isolés +
  // clé) À LA PLACE du CIN « 80012134 » présent 1 ligne plus bas. Les
  // gardes ci-dessous (clé CNSS juste après, montants) écartent le CNSS.
  const linesTer = text.split("\n");
  for (let i = 0; i < linesTer.length; i++) {
    if (!CIN_COLUMN_HEADER.test(linesTer[i])) continue;
    let seen = 0;
    for (let j = i + 1; j < linesTer.length && seen < 12; j++) {
      const line = linesTer[j].trim();
      if (!line) continue;
      seen++;
      // MODIFIÉ (Task 154) : \d{9} -> \d{8,9} (voir commentaire ci-dessus)
      for (const m of line.matchAll(/(?<!\d)(\d{8,9})(?!\d)/g)) {
        const num = m[1];
        const start = m.index ?? 0;
        const after = line.slice(start + num.length, start + num.length + 6);
        // clé CNSS juste après (« - 08 » / « /8 ») : numéro d'affiliation
        if (/^[ \t]*[-\/][ \t]*\d{1,2}(?!\d)/.test(after)) continue;
        // NOUVEAU (Task 159) : clé CNSS séparée par un ESPACE SEUL (« 17775208 08 »)
        // — la couche texte PDF de la famille « Tunis Call Center » perd le tiret :
        // le numéro d'affiliation « 17775208 - 08 » y apparaît « 17775208 08 »
        // (clé 1-2 chiffres en FIN de ligne). Sans cette garde, le N° CNSS était
        // retenu À LA PLACE du CIN « 12345678 » isolé quelques lignes plus bas.
        if (/^[ \t]+\d{1,2}[ \t]*$/.test(after)) continue;
        // montant décimal collé APRÈS (« 12,000 »)
        if (/^[ \t]*[,]\d{3}(?!\d)/.test(after)) continue;
        // partie décimale d'un montant JUSTE AVANT (« ,190 » collé)
        if (start > 0 && /[,.]/.test(line.slice(start - 1, start))) continue;
        return num;
      }
    }
  }

  // 2. Format tunisien : nombre de 8 chiffres isolé
  // NOUVEAU (ajouté SANS modifier la règle historique ci-dessous) : les
  // bulletins tunisiens scannés affichent souvent le N° CNSS sous la forme
  // "17775208 - 08" (numéro d'affiliation + clé de contrôle à 1-2 chiffres).
  // Ce numéro EST un 8 chiffres isolé : la règle historique le capturait
  // AVANT le vrai CIN (lui aussi sur 8 chiffres) placé plus loin sur la
  // MÊME ligne. Correctif : si le 1er candidat est immédiatement suivi
  // d'un séparateur "-" ou "/" et d'une clé de 1-2 chiffres (motif CNSS),
  // on retient le 8 chiffres SUIVANT de la même ligne — s'il existe et
  // n'est pas lui-même suivi d'une clé. Sinon : comportement historique
  // strictement inchangé (premier 8 chiffres isolé).
  const tunisian = text.match(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/);
  if (tunisian && tunisian.index !== undefined) {
    // (CORRECTIF v0.2.201) : `tunisian.index` est de type `number | undefined`
    // selon les types RegExp de TypeScript. On l'extrait dans une variable
    // `number` après vérification — le comportement runtime est IDENTIQUE
    // (l'index est toujours défini quand le match a réussi).
    const ti = tunisian.index;
    const afterCand = text.slice(
      ti + tunisian[0].length,
      ti + tunisian[0].length + 12
    );
    const cnssKey = afterCand.match(/^[ \t]*[-\/][ \t]*(\d{1,2})(?!\d)/);
    if (cnssKey) {
      // motif CNSS détecté : cherche un autre 8 chiffres sur la MÊME ligne
      // CORRECTIF (Task 159) : le début de ligne était calculé depuis
      // tunisian.index, qui pointe sur le caractère PRÉCÉDENT les 8 chiffres
      // (souvent le \n qui les sépare) — indexOf("\n", index) retombait alors
      // sur CE MÊME \n et la « ligne » était vide : la recherche du CIN voisin
      // échouait systématiquement quand le CNSS commençait une ligne.
      // On repart désormais du DÉBUT des 8 chiffres du candidat.
      const debutChiffres = ti + tunisian[0].length - 8;
      const nl = text.indexOf("\n", debutChiffres);
      const line = text.slice(debutChiffres, nl === -1 ? undefined : nl);
      // le CNSS lui-même est le 1er match de "line" (index 0) : on l'exclut
      const all8 = [
        ...line.matchAll(/(?:^|[^0-9A-Z])(\d{8})(?![0-9])/g),
      ].filter((m) => m.index !== 0);
      for (const other of all8) {
        const afterOther = line.slice(
          other.index + other[0].length,
          other.index + other[0].length + 12
        );
        if (!/^[ \t]*[-\/][ \t]*(\d{1,2})(?!\d)/.test(afterOther)) {
          return other[1]; // le CIN (pas un CNSS)
        }
      }
      // aucun autre candidat fiable -> historique (le 1er 8 chiffres)
    }
    return tunisian[1];
  }

  // 3. Format 1-2 lettres + 5-6 chiffres (Maroc, etc.) : ex. A123456, AB12345
  const moroccan = text.match(/(?:^|[^A-Z0-9])([A-Z]{1,2}\d{5,6})(?![0-9A-Z])/);
  if (moroccan) return moroccan[1];

  // 4. NOUVEAU (dernier recours — tous les motifs précédents restent
  //    prioritaires et inchangés) : valeur ALPHANUMÉRIQUE après un libellé
  //    CIN. Couvre les formats de démonstration / particuliers :
  //      "CIN (FORMAT FICTIF)\nDEMO 001 234"   -> DEMO001234
  //      "CIN : DEMO-12-3456"                  -> DEMO123456
  //      "CIN (FORMAT FICTIF)\nFICTIF/004567"  -> FICTIF004567
  //      "CIN (FORMAT FICTIF)\nCIN XX 014 567" -> XX014567
  //      "CIN (FORMAT FICTIF)\nID: DEMO009012" -> DEMO009012
  //      "CIN (FORMAT FICTIF)\nD016.789"       -> D016789
  //      "CIN (FORMAT FICTIF)\n013-456-DEMO"   -> 013456DEMO
  //    La valeur doit contenir au moins 3 chiffres (évite de capter un mot),
  //    rester sur une seule ligne et faire une longueur plausible (4 à 20
  //    caractères). Les séparateurs sont retirés comme pour les autres motifs.
  const alnum = text.match(
    /(?:C\.?\s*I\.?\s*N\.?|CIN|CARTE\s+D'?\s*IDENTIT[EÉ])\s*(?:N\s*[°o]\s*)?(?:\([^)]{0,30}\))?[ \t]*[:=\-]?[ \t]*(?:\n[ \t]*(?:I\.?D\.?\s*)?[:=\-]?[ \t]*)?(?:I\.?D\.?\s*[:=\-]\s*)?([A-Z0-9](?:[A-Z0-9 \t.\/\-]{2,18}[A-Z0-9])?)/i
  );
  if (alnum) {
    let v = alnum[1]
      // retire un libellé "CIN" répété au début de la valeur, uniquement s'il
      // est suivi d'un ESPACE ("CIN XX 014 567" -> "XX 014 567"). Une valeur
      // réellement construite avec "CIN" collé ("CIN-DEMO-006789") est gardée
      // intacte car le tiret fait partie du numéro.
      .replace(/^C\.?\s*I\.?\s*N\.?[ \t]+/i, "")
      .replace(/^[.\/\-]+/, "")
      .replace(/[.\/\-]+$/, "")
      .trim();
    const compact = v.replace(/[\s.\/\-]/g, "").toUpperCase();
    const digitCount = (compact.match(/\d/g) || []).length;
    // NOUVEAU (Task 159) : la valeur ne doit contenir qu'UN SEUL bloc de
    // lettres, compté AVANT compactage (les séparateurs supprimés fusionneraient
    // sinon deux mots en un seul bloc). « N° CIN\n003879 EMPLOYE TEST »
    // (matricule + nom après un en-tête de colonne) produisait
    // « 003879EMPLOYETEST » retenu comme CIN. Les formats documentés
    // (« DEMO 001 234 », « FICTIF/004567 », « XX 014 567 », « 013-456-DEMO »,
    // « D016.789 ») n'ont qu'un seul bloc alphabétique : deux blocs ou plus =
    // matricule + nom → rejet.
    const blocsLettres = v.toUpperCase().match(/[A-ZÀ-Þ]{2,}/g) || [];
    if (
      compact.length >= 4 &&
      compact.length <= 20 &&
      digitCount >= 3 &&
      blocsLettres.length <= 1
    ) {
      return compact;
    }
  }

  // 5. NOUVEAU (ajouté EN DERNIER RECOURS : tous les motifs précédents
  //    restent prioritaires et inchangés) : fiches « tableau » où l'en-tête
  //    de colonne « N° CIN » est sur UNE ligne et la valeur sur la ligne
  //    SUIVANTE (bulletins à colonnes, texte PDF ou OCR) :
  //      "ETAT CIVIL ENF. A CHARGE N° CNSS N° CIN Droit acquis Solde Congés"
  //      "Marie(e) 1 SPECIMEN-001 SPEC-0001 6,205 19,000 1709,279"
  //    Sur la ligne de valeurs on cherche les jetons LETTRES-CHIFFRES
  //    ("SPEC-0001", "SPECIMEN-001", "SPEC0001"…). S'il y en a PLUSIEURS, le
  //    DERNIER est retenu : la colonne « N° CIN » vient généralement après
  //    le « N° CNSS ». Un seul jeton -> il est retenu tel quel.
  // MODIFIÉ (Task 27) : CIN_COLUMN_HEADER est désormais déclaré en TÊTE de
  // fonction (réutilisé par la règle 1-ter) — regex STRICTEMENT identique.
  const CIN_TOKEN_IN_LINE = /\b([A-ZÀ-Þ]{2,15}-?\d{1,8})(?!\d)/g;
  const lines5 = text.split("\n");
  for (let i = 0; i < lines5.length; i++) {
    if (!CIN_COLUMN_HEADER.test(lines5[i])) continue;
    // 1re ligne non vide dans les 3 lignes qui suivent l'en-tête (l'OCR
    // insère parfois des lignes vides entre l'en-tête et la valeur)
    for (let j = i + 1; j <= i + 3 && j < lines5.length; j++) {
      const valueLine = lines5[j].trim();
      if (!valueLine) continue;
      const tokens = [...valueLine.matchAll(CIN_TOKEN_IN_LINE)].map(
        (m) => m[1]
      );
      if (tokens.length > 0) return tokens[tokens.length - 1];
      break; // 1re ligne non vide sans jeton -> on ne cherche pas plus loin
    }
  }

  // 6. NOUVEAU (tout dernier recours — aucun motif précédent n'a matché) :
  //    premier jeton « LETTRES-CHIFFRES » du texte (identifiant du type
  //    "SPEC-0001" présent SANS en-tête « CIN » lisible, ex. OCR fragmenté).
  //    Au moins 2 chiffres pour éviter les faux positifs ("AB-1", …).
  const anyToken = text.match(/\b([A-ZÀ-Þ]{2,15}-?\d{2,8})(?!\d)/);
  if (anyToken) return anyToken[1];

  return null;
}

/**
 * Extrait le nom de l'employé (best effort, formats Sage courants).
 *
 * MOTIFS AJOUTÉS (les anciens sont tous conservés) :
 *  - "Nom et prénom Amine Ben Ali" SANS deux-points (libellé et valeur
 *    séparés par de simples espaces), ancré en début de ligne pour éviter
 *    le faux positif "Employeur fictif Société…".
 *  - "Employé Amine Ben Ali" / "Salarié Amine Ben Ali" sans deux-points.
 */
export function extractEmployeeName(text: string): string | null {
  // NOUVEAU (Task 151) : fiches à champs SÉPARÉS —
  //   Nom : TRABELSI
  //   Prénom : Amine
  // Les motifs historiques s'arrêtent au libellé « NOM » seul et rendent
  // « TRABELSI » SANS le prénom (nom incomplet = « faux nom » signalé).
  // Passe préalable : libellé « NOM » EXACTEMENT (une ligne entière,
  // pas « NOM ET PRENOM »), puis « PRÉNOM(S) : Y » dans les 3 lignes
  // suivantes → on joint « X Y ». Les autres formats restent inchangés.
  {
    const lignes0 = text.split("\n");
    for (let i = 0; i < lignes0.length; i++) {
      const mNom = lignes0[i].match(
        /^[ \t]*NOM(?![A-ZÀ-Ý])[ \t]*[:=][ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})[ \t]*$/i
      );
      if (!mNom) continue;
      const nomX = mNom[1].trim().replace(/\s{2,}/g, " ");
      if (nomX.length < 3) continue;
      for (
        let j = i + 1;
        j <= Math.min(i + 3, lignes0.length - 1);
        j++
      ) {
        const mPre = lignes0[j].match(
          /^[ \t]*PR[EÉ]NOMS?(?![A-ZÀ-Ý])[ \t]*[:=][ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})[ \t]*$/i
        );
        if (mPre) {
          const preY = mPre[1].trim().replace(/\s{2,}/g, " ");
          if (preY.length >= 3) return (nomX + " " + preY).slice(0, 60);
          break;
        }
      }
    }
  }
  // NOUVEAU (Task 154) : bulletins à libellés EMPILÉS verticalement —
  // la valeur du nom est la ligne de même rang sous le bloc de libellés
  // (« NOM ET PRENOM » / « FONCTION » / « CATEGORIE » \n « TMAR AZIZ » / …).
  // Passé AVANT les motifs historiques : leur motif sans deux-points
  // captait le MOT « PRENOM » lui-même (1000 fiches réelles = 1000 fois
  // « PRENOM »). La passe « NOM : X / Prénom : Y » (Task 151) reste
  // prioritaire pour les fiches à champs séparés avec deux-points.
  {
    const nomBloc = nomDepuisBlocLibelles(blocLibellesVerticaux(text));
    if (nomBloc) return nomBloc;
  }
  // NOUVEAU (Task 157) : bulletins TABLEUR à libellés EN LIGNE (XLSX/XLS
  // sérialisés avec tabulations) — même consommation, map horizontale :
  // « Matricule\tNom et Prénom\t\tFonction » \n « 00001\tJLASSI SANA\t\tAGENT… ».
  // Passé après le bloc vertical (inchangé) et avant les motifs historiques.
  {
    const nomBlocH = nomDepuisBlocLibelles(blocLibellesHorizontaux(text));
    if (nomBlocH) return nomBlocH;
  }
  const patterns = [
    // ANCIEN (conservé) : libellé suivi de ":" ou "="
    /(?:NOM\s*(?:ET\s*PRENOMS?|PR[EÉ]NOMS?)?|EMPLOY[EÉ]|SALARI[EÉ])\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
    // ANCIEN (conservé)
    /COLLABORATEUR\s*[:=]\s*([A-ZÀ-Ý][A-ZÀ-Ý' -]{3,60})/i,
    // NOUVEAU : "Nom et prénom Amine Ben Ali", "Nom Prénom Amine Ben Ali",
    // "Nom Amine Ben Ali" — SANS deux-points. (?![A-ZÀ-Ý]) après NOM évite
    // de matcher "NOMENCLATURE". Ancrage début de ligne = pas de faux
    // positif sur "Employeur fictif…".
    /(?:^|\n)[ \t]*NOM(?![A-ZÀ-Ý])[ \t]*(?:ET[ \t]*|&[ \t]*|\/[ \t]*)?(?:PR[EÉ]NOMS?(?![A-ZÀ-Ý]))?[ \t]*[:=]?[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
    // NOUVEAU : "Employé Amine Ben Ali" / "Salarié Amine Ben Ali" sans deux-points
    /(?:^|\n)[ \t]*(?:EMPLOY[EÉ]|SALARI[EÉ])(?![A-ZÀ-Ý])[ \t]*[:=]?[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
    // NOUVEAU : en-tête de section "SALARIÉ(E)" / "EMPLOYÉ(E)" — le nom est sur
    // la ligne suivante (fiches à rubriques : "SALARIE(E)\nAmine Ben Salem")
    /(?:^|\n)[ \t]*(?:SALARI[EÉ]|EMPLOY[EÉ])\s*\(\s*E\s*\)[ \t]*\n[ \t]*([A-ZÀ-Ý][A-ZÀ-Ý'’ -]{2,60})/i,
  ];
  // NOUVEAU (Task 154, filet de sécurité générique) : un motif ne doit
  // JAMAIS retourner un LIBELLÉ seul (« PRENOM », « FONCTION »…) — sur les
  // fiches à libellés empilés, le motif sans deux-points captait le mot
  // « PRENOM » après « NOM ET ». Ce match est sauté et le motif suivant est
  // essayé ; la passe « bloc vertical » ci-dessus a déjà retourné le bon
  // nom pour ces fiches.
  const MOTS_LIBELLES = new Set([
    "NOM", "NOMS", "PRENOM", "PRENOMS", "FONCTION", "CATEGORIE",
    "MATRICULE", "CNSS", "CIN", "SERVICE", "EMPLOI", "POSTE",
    "SALARIE", "EMPLOYE", "ETAT", "CIVIL", "ENF", "CHARGE", "DATE",
    "NAISSANCE", "EMBAUCHE", "COLLABORATEUR",
  ]);
  const estNomLibelle = (n: string): boolean => {
    const mots = n
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^A-Z]+/)
      .filter(Boolean);
    return mots.length > 0 && mots.every((m) => MOTS_LIBELLES.has(m));
  };
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      let name = m[1].trim().replace(/\s{2,}/g, " ").slice(0, 60);
      if (estNomLibelle(name)) continue; // NOUVEAU (Task 154) : libellé seul = pas un nom
      // NOUVEAU : coupe les libellés qui suivent le nom sur la même ligne
      // (ex. "Karoui Ines Matricule paie : MAT-1003" -> "Karoui Ines")
      const cut = name.replace(
        /\s+(?:MATRICULES?|N[°O]?\s*CNSS|CNSS|POSTE(?:\s+OCCUP[EÉ])?|FONCTION|DATE(?:\s+D'[A-ZÀ-ÿ]+)?|C\.?I\.?N\.?|SERVICE|D[EÉ]PARTEMENT|EMPLOI)\b[\s\S]*$/i,
        ""
      ).trim().replace(/[\s:]+$/, "");
      if (cut.length >= 3) name = cut;
      return name;
    }
  }

  // NOUVEAU (ajouté EN DERNIER : tous les motifs précédents restent
  // prioritaires et inchangés) : fiches "tableau" scannées (OCR) —
  // l'en-tête de colonne "NOM ET PRENOM" (parfois collé par l'OCR :
  // "NOMETPRENOM") n'est PAS suivi de ":" : le nom est sur la ligne de
  // valeurs EN DESSOUS, éventuellement collé en majuscules
  // ("EMPLOYETEST"). Exemple réel :
  //   "MATRICULE   NOMETPRENOM     FONCTION        CATEGORIE"
  //   "[0087 | EMPLOYETEST :ç— | Technicien en Informatique"
  // On retourne le 1er RUN de tokens TOUT MAJUSCULES (strict, sans le flag
  // "i") adjacents — chaque token >= 3 lettres, 4 tokens max — joint par
  // des espaces ("EMPLOYE TEST"); un token seul collé est accepté
  // ("EMPLOYETEST"). Les libellés de colonnes connus sont exclus. Un mot
  // à casse mixte ("Technicien") n'est PAS retenu : c'est une fonction,
  // pas un nom.
  const NOM_HEADER_TBL =
    /NOM[ \t]*(?:ET[ \t]*|&[ \t]*|\/[ \t]*)?(?:PR[EÉ]NOMS?|PREN[O0]MS?)/;
  const EXCLUDE_TBL =
    /^(?:FONCTION|CATEGORIE|CATÉGORIE|MATRICULE|BULLETIN|SALAIRE|PAIE|CNSS|CIN|EMPLOYEUR|OCCUPATION|SERVICE|DEPARTEMENT|DÉPARTEMENT|ETAT|ÉTAT|CIVIL|CHARGE|EMPLOI)$/;
  const IS_UPPER = /^[A-ZÀ-Þ]+$/;
  // NOUVEAU (ajouté SANS modifier le bloc « tout majuscules » ci-dessous ni
  // les motifs historiques) : fiches « tableau » où le nom est écrit en casse
  // mixte ("Amine trablesi", "Karoui Ines") sur la ligne de valeurs sous
  // l'en-tête « NOM ET PRENOM ». Le bloc historique ne retient que des tokens
  // TOUT MAJUSCULES (pour ne pas confondre nom et fonction) : ces fiches
  // restaient sans nom, ou pire héritaient d'un fragment d'en-tête lu à la
  // ligne suivante ("ETAT CIVIL EF AGHIRGE" -> "AGHIRGE"). Prudence :
  //   - 1 à 4 mots adjacents, chacun 3+ lettres, total >= 5 caractères
  //     (un mot isolé doit faire 8+ caractères, ex. "Aminetrablesi" collé) ;
  //   - MAJUSCULES exclues (gérées par le bloc historique ci-dessous) et
  //     1re lettre de chaque mot en casse quelconque : les fiches réelles
  //     écrivent souvent le nom en casse mixte imparfaite
  //     ("Amine trablesi" — nom de famille en minuscule) ;
  //   - vocabulaire exclu (fonctions, état civil, libellés de colonnes) —
  //     un mot du vocabulaire AVANT le nom est ignoré, APRÈS le nom arrête
  //     le run (ex. "Amine trablesi | Technicien en Informatique") ;
  //   - mots de 2 lettres ("Le", "En") sautés sans casser le run.
  const IS_TITLE = /^[A-Za-zÀ-ÿ][a-zà-ÿ’'-]{2,19}$/;
  // NOUVEAU (Task 151) : particules de noms arabes/maghrébins de 2 lettres.
  // Avant : tout token de moins de 3 lettres était PERDU (« EL AMRANI » →
  // « AMRANI »). Liste FERMÉE (blanche) : « EF » d'un fragment OCR n'est PAS
  // membre — la détection des fragments d'en-tête n'est pas affaiblie.
  const PARTICULES2 = new Set([
    "EL", "ED", "EN", "AN", "AT", "AB", "BN", "IB",
    "AL", "AD", "AR", "AS", "AF", "AK", "AZ",
  ]);
  const stripAccLower = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const EXCLUDE_TITLE = new Set(
    [
      // libellés de colonnes / en-têtes
      "nom", "prenom", "prenoms", "matricule", "fonction", "categorie",
      "bulletin", "paie", "salaire", "base", "taux", "gains", "retenues",
      "rubrique", "nombre", "net", "brut", "total", "periode", "droit",
      "acquis", "solde", "conges", "trav", "jours", "feries", "prime",
      "presence", "absence", "cnss", "cin", "date", "paiement", "virement",
      "compte", "banque", "signature", "cachet", "societe", "employeur",
      "etat", "civil", "charge", "emploi", "service", "departement",
      "mois", "annee", "categorie",
      // état civil (valeurs)
      "celibataire", "marie", "mariee", "divorce", "veuf", "veuve",
      "conjoint", "conjointe", "enfant", "enfants", "homme", "femme",
      // fonctions / métiers et services courants
      "technicien", "technicienne", "ingenieur", "informaticien",
      "comptable", "directeur", "directrice", "responsable", "gerant",
      "agent", "cadre", "employe", "salarie", "stagiaire", "consultant",
      "commercial", "controleur", "chauffeur", "gardien", "ouvrier",
      "ouvriere", "secretaire", "vendeur", "vendeuse", "caissier",
      "caissiere", "medecin", "avocat", "professeur", "formateur",
      "developpeur", "operateur", "superviseur", "teleconseiller",
      "telemarketing", "informatique", "administration", "comptabilite",
      "logistique", "marketing", "ventes", "achat", "achats", "production",
      "qualite", "maintenance",
      // NOUVEAU (mots AJOUTÉS à la liste, aucun mot existant retiré) :
      // fonctions/services supplémentaires vus sur fiches réelles — un mot
      // de ce vocabulaire ne doit JAMAIS être pris pour un nom.
      "assistant", "administratif", "clientele", "team",
      "leader", "plateau", "equipe", "support", "appel", "centre",
      // libellés collés par l'OCR ("Droitacquis", "SoldeCongés")
      "droitacquis", "soldeconges", "hjtrav", "salbase", "baseth",
      "nometprenom", "matriculecna", "bulletindepae", "bulletindepaie",
    ].map((w) => stripAccLower(w))
  );
  if (
    NOM_HEADER_TBL.test(text) &&
    !text.match(/NOM[ \t]*(?:ET[ \t]*)?(?:PR[EÉ]NOMS?)[ \t]*[:=]/)
  ) {
    const linesTitle = text.split("\n");
    for (let i = 0; i < linesTitle.length; i++) {
      const hmTitle = linesTitle[i].match(NOM_HEADER_TBL);
      if (!hmTitle) continue;
      // (CORRECTIF v0.2.201) : `hmTitle.index` est `number | undefined`. On
      // ajoute une vérification explicite — runtime identique.
      if (hmTitle.index === undefined) continue;
      const candidatesTitle = [
        linesTitle[i].slice(hmTitle.index + hmTitle[0].length),
        linesTitle[i + 1],
        linesTitle[i + 2],
      ];
      for (const candTitle of candidatesTitle) {
        if (!candTitle) continue;
        const tokensTitle = candTitle
          .replace(/[\[\]{}()"“”]/g, " ")
          .split(/[|\t:]/)
          .join(" ")
          .split(/\s+/)
          .filter(Boolean);
        const runTitle: string[] = [];
        // NOUVEAU (ajouté SANS modifier la logique du run ci-dessous) :
        // si la ligne de valeurs contient AVANT le 1er mot en casse mixte un
        // RUN DE MOTS TOUT MAJUSCULES crédible (>= 2 mots de 3+ lettres, ou
        // 1 mot de 8+ lettres — mêmes critères que le bloc historique
        // majuscules), c'est LUI le vrai nom (« 900001 BELHADJ SANA
        // Assistant Administratif » -> nom = « BELHADJ SANA », PAS la
        // fonction « Assistant Administratif »). On abandonne alors ce
        // candidat : le bloc historique majuscules le traitera.
        let upperRun = 0;
        let prevUpper = false;
        let deferToUpper = false;
        for (const tk of tokensTitle) {
          // NOUVEAU (Task 151) : particule de nom de 2 lettres (« El », « EL »)
          // → membre du run À TOUTE POSITION, avant les autres règles.
          // Garde : doit commencer par une majuscule (« en », « le » français
          // tout minuscules restent ignorés).
          if (
            tk.length === 2 &&
            PARTICULES2.has(tk.toUpperCase()) &&
            /^[A-ZÀ-Þ]/.test(tk)
          ) {
            runTitle.push(tk);
            continue;
          }
          if (!IS_TITLE.test(tk)) {
            if (runTitle.length > 0) break; // le run s'arrête au 1er non-nom
            const cleanUpper = tk.replace(/^[^A-ZÀ-Þ]+|[^A-ZÀ-Þ]+$/g, "");
            const isUpperName =
              cleanUpper.length >= 3 &&
              IS_UPPER.test(cleanUpper) &&
              !EXCLUDE_TBL.test(cleanUpper) &&
              !/^\d/.test(cleanUpper);
            upperRun = isUpperName ? (prevUpper ? upperRun + 1 : 1) : 0;
            prevUpper = isUpperName;
            if (
              (upperRun >= 2 || (upperRun === 1 && cleanUpper.length >= 8))
            ) {
              deferToUpper = true;
              break;
            }
            continue;
          }
          if (EXCLUDE_TITLE.has(stripAccLower(tk))) {
            if (runTitle.length > 0) break; // mot de vocabulaire après le nom
            continue; // libellé avant le nom ("Nom Salarié…") : ignoré
          }
          if (tk.length < 3) {
            // NOUVEAU (Task 151) : particule de nom de 2 lettres (« El »…)
            // → membre du run ; les autres (« Le », « En ») ignorées.
            if (PARTICULES2.has(tk.toUpperCase())) runTitle.push(tk);
            continue;
          }
          runTitle.push(tk);
          if (runTitle.length === 4) break;
        }
        if (deferToUpper) continue; // candidat suivant (nom en majuscules)
        if (runTitle.length > 0) {
          const joined = runTitle.join(" ");
          if (runTitle.length >= 2 && joined.replace(/\s/g, "").length >= 5) {
            return joined.slice(0, 60);
          }
          if (runTitle.length === 1 && runTitle[0].length >= 8) {
            return runTitle[0].slice(0, 60);
          }
          // run trop court pour être un nom crédible : candidat suivant
        }
      }
    }
  }
  // NOUVEAU (Task 15) : repli « fragment d'en-tête d'un seul mot court »
  // mémorisé dans le bloc ci-dessous — utilisé en TOUT DERNIER recours
  // uniquement (déclaré ici : portée jusqu'à la fin de la fonction).
  let headerFragmentFallback: string | null = null;
  if (NOM_HEADER_TBL.test(text) && !text.match(/NOM[ \t]*(?:ET[ \t]*)?(?:PR[EÉ]NOMS?)[ \t]*[:=]/)) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hm = lines[i].match(NOM_HEADER_TBL);
      if (!hm) continue;
      // (CORRECTIF v0.2.201) : `hm.index` est `number | undefined`. On
      // ajoute une vérification explicite — runtime identique.
      if (hm.index === undefined) continue;
      // candidates : fin de la ligne d'en-tête puis les 2 lignes suivantes
      const after = lines[i].slice(hm.index + hm[0].length);
      const candidates = [after, lines[i + 1], lines[i + 2]];
      let candIdx = -1;
      for (const cand of candidates) {
        candIdx++;
        if (!cand) continue;
        const tokens = cand
          .replace(/[\[\]{}()"“”]/g, " ")
          .split(/[|\t:]/)
          .join(" ")
          .split(/\s+/)
          .filter(Boolean);
        // 1er run de tokens TOUT MAJUSCULES adjacents (1 à 4 tokens)
        // NOUVEAU (Task 151) : les particules de 2 lettres (EL, ED, BN…)
        // sont MEMBRES du run au lieu d'être perdues (« EL AMRANI AHMED »).
        const estNomMaj = (c: string) =>
          (c.length >= 3 &&
            IS_UPPER.test(c) &&
            !EXCLUDE_TBL.test(c) &&
            !/^\d/.test(c)) ||
          PARTICULES2.has(c);
        let run: string[] = [];
        let idxPremierRun = -1;
        for (let ti = 0; ti < tokens.length; ti++) {
          const clean = tokens[ti].replace(/^[^A-ZÀ-Þ]+|[^A-ZÀ-Þ]+$/g, "");
          const isName = estNomMaj(clean);
          if (isName) {
            if (run.length === 0) idxPremierRun = ti;
            run.push(clean);
            if (run.length === 4) break;
          } else if (run.length > 0) {
            break; // le run majuscules s'arrête au 1er token non-nom
          }
        }
        // NOUVEAU (Task 151) : nombre de libellés connus AVANT le 1er token
        // du run sur CETTE ligne — détecte une bande d'en-tête déguisée en
        // ligne de valeurs (« ETAT CIVIL EF AGHIRGE » : run = « AGHIRGE »).
        let libellesAvantRun = 0;
        if (run.length > 0) {
          for (const tk of tokens) {
            const cleanTk = tk.replace(/^[^A-ZÀ-Þ]+|[^A-ZÀ-Þ]+$/g, "");
            if (estNomMaj(cleanTk)) break;
            if (EXCLUDE_TBL.test(cleanTk)) libellesAvantRun++;
          }
        }
        if (run.length > 0) {
          // NOUVEAU (Task 151, garde AJOUTÉE sans toucher aux gardes
          // historiques ci-dessous) : si ≥ 2 libellés connus précèdent le
          // run sur la même ligne, c'est un fragment de bande d'en-tête,
          // PAS une ligne de valeurs → on lui applique les MÊMES gardes
          // qu'au fragment collé à la fin de la ligne d'en-tête (candIdx 0).
          if (libellesAvantRun >= 2) {
            if (run.join(" ").replace(/\s/g, "").length < 5) {
              continue; // fragment trop court : candidat suivant
            }
            // NOUVEAU (Task 153) : sur une ligne DÉGUIRÉE (candIdx > 0),
            // un run d'UN SEUL mot est TOUJOURS un fragment de bande
            // d'en-tête — une vraie ligne de valeurs n'a jamais ≥ 2
            // libellés connus avant le nom — même si le mot est long.
            // Ex. réel : « ETAT CIVIL EF ABDELKEFI » (9 lettres) gagnait
            // au lieu du vrai nom « ABDELKEFI HAFEDH » sur la ligne de
            // valeurs en dessous. Sur la ligne d'en-tête elle-même
            // (candIdx 0), le comportement historique est conservé
            // (mot collé ≥ 8 lettres accepté : nom réellement imprimé).
            if (run.length === 1 && (run[0].length < 8 || candIdx > 0)) {
              headerFragmentFallback ??= run.join(" ");
              continue; // 1 mot : repli, candidat suivant
            }
          }
          // NOUVEAU (garde AJOUTÉE, rien d'autre n'est modifié) : le fragment
          // situÉ APRÈS « NOM ET PRENOM » SUR LA LIGNE D'EN-TÊTE (1er
          // candidat) doit être crédible (>= 5 lettres au total) pour être
          // pris pour un nom. Cas réel (OCR) : la bande d'en-tête
          // « … NOM ET PRENOM TES 7 FONCTION 1 CATEGORIE » produisait le
          // fragment « TES » (3 lettres) retenu comme nom. Les fiches où le
          // nom est RÉELLEMENT sur la ligne d'en-tête (2 mots ou mot collé
          // long) restent prises en charge (>= 5 lettres).
          if (candIdx === 0 && run.join(" ").replace(/\s/g, "").length < 5) {
            continue; // fragment d'en-tête trop court : candidat suivant
          }
          // NOUVEAU (Task 15, garde AJOUTÉE sans modifier la garde
          // précédente ni le retour ci-dessous) : fragment de la bande
          // d'en-tête d'UN SEUL mot court (5-7 lettres) — ex. « COTES » lu
          // dans « … NOM ET PRENOM  COTES  7 FONCTION  77 CATÉGORIE » —
          // ce n'est PAS le nom mais un déchet OCR de la bande d'en-tête :
          // on le met en REPLI et on continue avec les lignes de valeurs
          // EN DESSOUS (et, le cas échéant, la partie hi-res). Les noms
          // réellement imprimés sur la ligne d'en-tête (2+ mots, ou mot
          // collé >= 8 lettres) restent retournés immédiatement — inchangé.
          if (candIdx === 0 && run.length === 1 && run[0].length < 8) {
            headerFragmentFallback ??= run.join(" ");
            continue;
          }
          // NOUVEAU (Task 152) : LETTRE DÉTACHÉE juste avant le run — l'OCR
          // sépare parfois la 1re lettre du nom (« H ANINI TEST » lu pour
          // « EMPLOYE TEST ») : la lettre seule est ignorée par le run et le
          // nom capté perd son H (« ANINI TEST » = faux nom signalé). On
          // recolle la lettre au 1er token du run. Garde : exactement 1
          // lettre MAJUSCULE, immédiatement avant, pas un libellé connu.
          if (idxPremierRun > 0) {
            const avant = tokens[idxPremierRun - 1].replace(
              /^[^A-ZÀ-Þ]+|[^A-ZÀ-Þ]+$/g,
              ""
            );
            if (
              avant.length === 1 &&
              IS_UPPER.test(avant) &&
              !EXCLUDE_TBL.test(avant)
            ) {
              const runColle = [avant + run[0], ...run.slice(1)];
              return runColle.join(" ").slice(0, 60);
            }
          }
          return run.join(" ").slice(0, 60);
        }
      }
    }
  }
  // NOUVEAU (Task 15) : repli en TOUT DERNIER recours — le fragment court
  // d'en-tête (« COTES »…) n'est utilisé que si AUCUNE ligne de valeurs
  // (ni aucune partie hi-res) n'a fourni de nom crédible.
  if (headerFragmentFallback) return headerFragmentFallback.slice(0, 60);
  return null;
}

/**
 * Extrait la période de paie (best effort).
 *
 * MOTIFS AJOUTÉS (les anciens sont tous conservés) :
 *  - "Période de paie : Avril 2026" / "Période du bulletin : Février 2026"
 *  - "Mois de paie : Mars 2026"
 *  - plage "Période du 01/10/2026 au 31/10/2026" (séparateurs / - . tolérés)
 *  - plage générique en début de ligne "du 01/01/2026 au 31/01/2026"
 */
export function extractPeriod(text: string): string | null {
  // NOUVEAU : plage explicite "Période (de paie) du JJ/MM/AAAA au JJ/MM/AAAA"
  const range = text.match(
    /P[EÉ]RIODE(?:\s+DE\s+PAIE)?\s*[:=]?\s*(?:DU\s+)?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*(?:AU|[-–—]|À|A)\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  );
  if (range) return (`du ${range[1]} au ${range[2]}`).slice(0, 40);

  const patterns = [
    // NOUVEAU : "Période de paie : Avril 2026", "Période du bulletin : 02/2026",
    // "Période : Février 2026", "Période 01/2026", "Période : 28/02/2026"…
    /P[EÉ]RIODE(?:\s+DE\s+PAIE|\s+DE\s+LA\s+PAIE|\s+DU\s+BULLETIN(?:\s+DE\s+PAIE)?)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    // ANCIEN (conservé) : "Période : Janvier 2025", "Période 01/2025", "Période 2025-01"
    /P[EÉ]RIODE\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2})/i,
    // NOUVEAU : "Mois de paie : Mars 2026"
    /MOIS(?:\s+DE\s+PAIE)?\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    // ANCIEN (conservé) : "Mois : Mars 2026", "Date de paie : 02/2026"
    // CORRECTION (garde ajoutée) : "DATE DE PAIE" ne doit plus correspondre au
    // début de "DATE DE PAIEMENT" — sinon la valeur capturée devient le début
    // du mot suivant (ex. "MENT 2026" capturé depuis "DATE DE PAIEMENT\n2026…").
    /(?:MOIS|DATE\s+DE\s+PAIE(?![A-ZÀ-Ý]))\s*[:=]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[/-]\d{4})/i,
    // NOUVEAU : plage générique sur une ligne : "du 01/01/2026 au 31/01/2026"
    /(?:^|\n)[^\n]*?\bDU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+AU\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    // NOUVEAU (ajouté SANS supprimer les motifs précédents) : plage SANS "du"
    // en début de ligne — bulletins à colonnes (1re cellule de la ligne de
    // valeurs) : "01/01/2026 au 31/01/2026", "2026-01-01 au 2026-01-31",
    // "01.01.26 au 31.01.26", "01/01/2026 to 01/31/2026" (format US),
    // "01/01/2026 - 31/01/2026"… La ligne peut continuer après (tabs des
    // colonnes "Date de Paiement", "Mode de Règlement", etc.).
    /(?:^|\n)[ \t]*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})[ \t]+(?:AU|TO|À|[-–—])[ \t]+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i,
    // NOUVEAU (ajouté SANS supprimer les motifs précédents) : plage avec noms
    // de mois en toutes lettres — "1 Janvier 2026 au 31 Janvier 2026",
    // "01 Février 2026 au 28 Février 2026", "1er Mai 2026 au 31 Mai 2026"…
    /(?:^|\n)[ \t]*(\d{1,2}(?:er)?\s+(?:JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE)\s+\d{4})[ \t]+(?:AU|TO|À)[ \t]+(\d{1,2}(?:er)?\s+(?:JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE)\s+\d{4})/i,
    // NOUVEAU (ajouté EN DERNIER : tous les motifs précédents restent
    // prioritaires) : DEUX dates côte à côte SANS mot de liaison — bulletins
    // scannés où la case "SALAIRE"/"Période" affiche le début et la fin
    // séparés par des espaces, éventuellement précédés de bordures OCR :
    //   "| SALAIRE          LS"
    //   "01/08/26                  31/08/26"
    // La ligne ne doit contenir RIEN d'autre que ces deux dates (bordures
    // | et espaces tolérés) pour éviter les faux positifs.
    /(?:^|\n)[ \t]*(?:[|\]})]?[ \t]*)(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[ \t]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[ \t]*(?:[\t|]|\r?\n|$)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[2] ? `du ${m[1]} au ${m[2]}` : m[1]).trim().slice(0, 40);
  }

  // NOUVEAU (dernier recours, tous les motifs précédents restent prioritaires) :
  // valeur libre sur la ligne qui suit un en-tête de section "PÉRIODE (DE PAIE)"
  // ou "MOIS (DE PAIE)". Gère les formats exotiques non couverts par les motifs
  // structurés : "Novembre deux mille vingt-six", "Semaine 02 a 05 - Jan. 2027",
  // "Du 1er au 31 juillet 2026", "Du 01 avr. au 30 avr. 2027", "Mai / 2026",
  // "2026 / DEC", "Juin-27", "05.2027"…
  const header = text.match(
    /(?:^|\n)[ \t]*(?:P[EÉ]RIODE(?:\s+D[EÉ]\s+PAIE|\s+D[EÉ]\s+LA\s+PAIE|\s+DU\s+BULLETIN(?:\s+DE\s+PAIE)?)?|MOIS(?:\s+D[EÉ]\s+PAIE)?)[ \t]*[:=]?[ \t]*\n[ \t]*(.+?)[ \t]*(?:\n|$)/i
  );
  if (header) {
    let value = header[1].trim();
    // retire un préfixe "Période :" / "Mois de paie :" répété sur la ligne de valeur
    value = value
      .replace(/^P[EÉ]RIODE(?:\s+D[EÉ]\s+PAIE|\s+D[EÉ]\s+LA\s+PAIE)?\s*[:=\-]\s*/i, "")
      .replace(/^MOIS(?:\s+D[EÉ]\s+PAIE)?\s*[:=\-]\s*/i, "")
      .trim();
    // coupe une éventuelle section suivante collée sur la même ligne
    value = value
      .split(
        /\s+(?:DATE\s+DE\s+PAIEMENT|EMPLOYEUR|SALARI[EÉ]|RUBRIQUE|RECAPITULATIF|C\.?\s*I\.?\s*N\.?\b|NET)/i
      )[0]
      .trim();
    // validation : longueur raisonnable + contient un chiffre (2 groupes)
    // ou un nom de mois français — sinon on ne retourne rien.
    const digitRuns = (value.match(/\d+/g) || []).length;
    const MOIS_FR =
      /JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE|JANV|F[EÉ]V|AVR|JUIL|SEPT|OCT|NOV|D[EÉ]C/i;
    if (
      value.length >= 3 &&
      value.length <= 40 &&
      !/^(?:DATE\s+DE\s+PAIEMENT|EMPLOYEUR|SALARI[EÉ]|RUBRIQUE|RECAPITULATIF|NET\s+[ÀA]\s+PAYER)/i.test(value) &&
      (digitRuns >= 2 || MOIS_FR.test(value))
    ) {
      return value;
    }
  }

  // NOUVEAU (ajouté SANS supprimer les motifs précédents ; dernier recours
  // absolu, tous les motifs ci-dessus restent prioritaires) : en-tête de
  // tableau multi-colonnes dont la 1re colonne est la période :
  //     "Période de Paie <tab> Date de Paiement <tab> Mode de Règlement"
  //     "01/01/2026 au 31/01/2026 <tab> 31/01/2026 <tab> Virement"
  // Contrairement au motif "en-tête seul sur sa ligne" ci-dessus, la ligne
  // d'en-tête PEUT contenir d'autres libellés de colonnes après "Période".
  // On capture la 1re cellule (avant tabulation / barre verticale) de la
  // ligne suivante, avec une validation stricte (ressemble à une période).
  const tableHeader = text.match(
    /(?:^|\n)[ \t]*P[EÉ]RIODE(?:\s+DE\s+PAIE|\s+DE\s+LA\s+PAIE)?[ \t]*[^\n]*\n[ \t]*([^\n\t|]*?)[ \t]*(?:[\t|]|\n|$)/i
  );
  if (tableHeader) {
    const value = tableHeader[1].trim().replace(/\s{2,}/g, " ");
    const MOIS_FR_TBL =
      /JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE|JANV|F[EÉ]V|AVR|JUIL|SEPT|OCT|NOV|D[EÉ]C/i;
    const looksLikePeriod =
      /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(value) || // 01/01/2026, 31.01.26…
      /\d{4}-\d{1,2}-\d{1,2}/.test(value) || // 2026-01-31…
      (MOIS_FR_TBL.test(value) && /\d{2,4}/.test(value)) || // Janvier 2026…
      (/\d/.test(value) && /[ \t](?:AU|TO|À)[ \t]/i.test(value)); // X au/to Y
    if (
      value.length >= 3 &&
      value.length <= 40 &&
      !/^(?:DATE\s+DE\s+PAIEMENT|EMPLOYEUR|SALARI[EÉ]|RUBRIQUE|MODE\s+DE|NET\s+[ÀA]\s+PAYER)/i.test(value) &&
      looksLikePeriod
    ) {
      return value;
    }
  }
  // NOUVEAU (Task 154, dernier recours — tous les motifs ci-dessus restent
  // prioritaires) : DATES EMPILÉES — les bulletins texte isolent les deux
  // bornes de période sur DEUX LIGNES DE DATES SEULES consécutives près du
  // haut de page, sans le mot « Période » :
  //   "BULLETIN DE PAIE" / "SALAIRE" / "01/08/26" / "31/08/26"
  // Fenêtre : 15 premières lignes (au-delà, les paires de dates sont
  // rarement une période). Aucun impact sur les fiches à libellé explicite.
  {
    const lignesP = text.split("\n").map((l) => l.trim());
    const estDateSeule = (l: string) =>
      /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.test(l);
    for (let i = 0; i < Math.min(lignesP.length - 1, 15); i++) {
      if (estDateSeule(lignesP[i]) && estDateSeule(lignesP[i + 1])) {
        return `du ${lignesP[i]} au ${lignesP[i + 1]}`;
      }
    }
  }
  return null;
}

/**
 * Extrait le net à payer (best effort).
 *
 * NOUVEAU : tolère des balises HTML/texte entre le libellé et le montant,
 * ex. "<b>Net à payer</b> <b>1 300,863</b>" (fiches exportées d'outils qui
 * mettent le libellé en gras). L'ancien format "NET À PAYER : 2 500,000 DT"
 * reste accepté à l'identique.
 */
// NOUVEAU (Task 157) : les tableurs sérialisent les montants au format
// en-US (« 1,758.640 » — virgule milliers, point décimal) alors que les
// fiches tunisiennes affichent « 1 758,640 ». Transformation UNILATÉRALE
// et SANS AMBIGUÏTÉ : le format français ne produit jamais « virgules en
// groupes de 3 + point décimal ». Les autres formats restent inchangés.
const normaliserMontantFr = (v: string): string => {
  const s = (v || "").trim();
  return /^\d{1,3}(?:,\d{3})+\.\d+$/.test(s)
    ? s.replace(/,/g, " ").replace(".", ",")
    : s;
};

export function extractNetSalary(text: string): string | null {
  const m = text.match(
    /NET\s+[ÀA]?\s*(?:A\s*)?PAYER(?:\s*[:=]\s*|\s*)((?:<[^<>]{0,40}>\s*){0,8})([\d\s.,']{3,15})\s*(?:DT|DINARS?|DH|MAD|TND|€)?/i
  );
  // NOUVEAU (garde ajoutée SANS modifier le motif) : la capture doit
  // contenir un chiffre — sur les fiches scannées le motif historique peut
  // matcher des ESPACES seules juste avant une bordure "|" du tableau
  // (m[2] = "   " -> " DT" sans la garde). Dans ce cas on continue vers le
  // motif de secours ci-dessous au lieu de retourner une valeur vide.
  if (m && /\d/.test(m[2]))
    return (
      normaliserMontantFr(m[2].trim().replace(/\s{2,}/g, " ")) + " DT"
    );

  // NOUVEAU (ajouté SANS modifier le motif historique ci-dessus) : fiches
  // "tableau" scannées où des bordures "|" (lues par l'OCR) séparent le
  // libellé du montant :
  //   "2100 Net à payer      |        |        |     1593,851      |"
  // Le libellé peut aussi être collé ("NETAPAYER"). On saute AU PLUS 200
  // caractères de séparateurs (espaces, |, :, etc.) — SANS jamais traverser
  // un retour à la ligne : le montant doit rester sur la MÊME ligne que le
  // libellé (évite d'associer le "Net à payer" d'une rubrique au montant
  // d'une autre ligne du tableau).
  const m2 = text.match(
    /NET\s*[ÀA]?\s*A?\s*PAYER[ \t|:=<>'"\/]{0,200}?([\d][\d \t.,']{2,14})\s*(?:DT|DINARS?|DH|MAD|TND|€)?/i
  );
  if (m2) {
    const amount = normaliserMontantFr(m2[1].trim().replace(/\s{2,}/g, " "));
    // garde : refuse une capture qui ne contient aucun chiffre réel après
    // nettoyage (ex. uniquement des séparateurs)
    if (/\d/.test(amount)) return amount + " DT";
  }
  return null;
}

/**
 * Extrait le matricule employé (best effort).
 * NOUVEAU : deux-points optionnel — "Matricule EMP-0001" (sans ":") est
 * désormais reconnu en plus de "Matricule : MAT-1003" (ancien, conservé).
 * La valeur doit contenir au moins un chiffre (évite de capter un mot).
 */
export function extractMatricule(text: string): string | null {
  // NOUVEAU (Task 154, prioritaire) : bloc de libellés EMPILÉS — la valeur
  // du matricule est la ligne de même rang sous le bloc (« MATRICULE » /
  // « NOM ET PRENOM » / « FONCTION » / « CATEGORIE » \n « 294452 » / …).
  // Les motifs historiques ci-dessous ne voyaient qu'une ligne « NOM ET
  // PRENOM » après « MATRICULE » et renvoyaient null (1000 fiches réelles).
  {
    const blocMat = blocLibellesVerticaux(text).get("MATRICULE");
    if (blocMat && /^\d{3,10}$/.test(blocMat.trim())) return blocMat.trim();
  }
  // NOUVEAU (prioritaire, anciens motifs conservés ci-dessous) : matricule
  // SALARIÉ en début de ligne — évite de capter le "Matricule fiscal" de
  // l'EMPLOYEUR présent plus haut dans la fiche :
  //   "Matricule fiscal: DEMO-MF-000"  (employeur — ignoré ici)
  //   "Matricule: EMP-DEMO-001"        (salarié — début de ligne)
  const lineStart = text.match(
    /(?:^|\n)[ \t]*MATRICULE(?!\s+FISCAL)(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i
  );
  if (lineStart && /\d/.test(lineStart[1])) return lineStart[1].trim();
  const m = text.match(/MATRICULE(?:\s+EMPLOY[EÉ])?\s*[:=]?\s*([A-Z0-9\-\/]{2,20})/i);
  if (m && /\d/.test(m[1])) return m[1].trim();

  // NOUVEAU (ajouté EN DERNIER RECOURS : les deux motifs précédents restent
  // prioritaires et inchangés) : fiches « tableau » — l'en-tête de colonne
  // "MATRICULE" est sur UNE ligne, la valeur (chiffres) sur la ligne
  // SUIVANTE (bulletins à colonnes, texte PDF ou OCR) :
  //   "MATRICULE      NOM ET PRENOM      FONCTION      CATEGORIE"
  //   "900001         BELHADJ SANA       Assistant     Administratif"
  const MAT_HEADER = /(?:^|[^\dA-ZÀ-Þ])MATRICULE(?:[^\dA-ZÀ-Þ]|$)/i;
  const linesM = text.split("\n");
  for (let i = 0; i < linesM.length; i++) {
    if (!MAT_HEADER.test(linesM[i])) continue;
    // 1re ligne de valeurs dans les 5 lignes qui suivent l'en-tête.
    // NOUVEAU (Task 160, correctif fiabilité) : pdf-parse émet les libellés
    // de colonnes sur des lignes à espaces simples et les blocs de valeurs
    // arrivent APRÈS le bloc COMPLET de libellés :
    //   "MATRICULE NOM ET PRENOM FONCTION CATEGORIE"
    //   "ETAT CIVIL ENF. A CHARGE N° CNSS N° CIN"      <- ligne de libellés
    //   "003879 EMPLOYE TEST Technicien en Informatique"  <- ligne de valeurs
    // Une ligne de libellés intercalée est SAUTÉE (pas un échec) ; avant ce
    // correctif, elle faisait « break » et le matricule restait null.
    for (let j = i + 1; j <= i + 5 && j < linesM.length; j++) {
      const valueLine = linesM[j].trim();
      if (!valueLine) continue;
      if (ligneDeLibelles(valueLine)) continue; // ligne de libellés -> sauter
      // NOUVEAU (Task 160, durci) : le matricule est le PREMIER jeton de la
      // ligne de valeurs (1re colonne du tableau) — seuls des caractères NON
      // alphanumériques (bordures « | », espaces, tabulations) peuvent le
      // précéder. Un nombre isolé de 3 à 8 chiffres (pas un montant
      // "12,000"/"12.000") ; garde anti-CNSS : un nombre suivi d'une clé
      // « - 08 » / « /8 » est un N° CNSS (8 chiffres + clé) — jamais un
      // matricule. Une ligne de valeurs qui ne COMMENCE pas par ce nombre
      // (« Célibataire 0 28843385 - 97 … ») n'est pas la ligne du matricule :
      // on s'arrête plutôt que de risquer un numéro d'une autre colonne.
      const vm = valueLine.match(
        /^(?:(?![\dA-Za-zÀ-ÿ]).)*?(\d{3,8})(?![\d.,])(?![ \t]*[-/][ \t]*\d{1,2}(?:[^\d]|$))/
      );
      if (vm) return vm[1];
      break; // 1re ligne non vide sans nombre -> on ne cherche pas plus loin
    }
  }
  return null;
}

/** Construit un extrait du texte autour de la première occurrence de la requête. */
export function buildSnippet(text: string, query: string, radius = 70): string | null {
  const idx = text.toUpperCase().indexOf(query.toUpperCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

/* ------------------------------------------------------------------ */
/* Recherche EXACTE de CIN                                             */
/* ------------------------------------------------------------------ */

/**
 * Construit la regex de correspondance EXACTE d'un CIN dans un texte.
 *
 * - ANCIEN (conservé) : chaque caractère du CIN peut être séparé par des
 *   espaces (artefacts fréquents de l'extraction de texte PDF : "A 123456").
 * - NOUVEAU : chaque caractère peut aussi être séparé par des points, tirets
 *   ou slashs (écritures réelles : "26 542 351", "9593-1034", "270.482.81",
 *   "38/346/578").
 * - ANCIEN (conservé) : le CIN ne doit être collé à AUCUN autre caractère
 *   alphanumérique : il doit être un numéro complet, pas une partie d'un
 *   nombre plus long. Ex. : la requête "12345" ne correspond PAS à
 *   "12345678" ni à "A123456".
 * - NOUVEAU : gardes supplémentaires pour que les écritures séparées restent
 *   EXACTES : une partie de CIN ne correspond pas non plus quand le numéro
 *   est écrit avec des séparateurs (ex. "542351" ne correspond PAS à
 *   "26 542 351", ni "9593" à "9593-1034").
 */
export function exactCinRegex(query: string): RegExp | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(sep);
  // - (?<![A-Z0-9])               : rien de collé à gauche (ancien, conservé)
  // - (?<![0-9A-Z][ \t./-])       : pas la suite d'un autre nombre séparé SUR
  //     LA MÊME LIGNE (ex. "542 351" dans "26 542 351")          [NOUVEAU]
  // - (?![A-Z0-9])                : rien de collé à droite (ancien, conservé)
  // - (?![ \t./-]{1,4}[0-9])      : pas de suite de chiffres après séparateur
  //     sur la même ligne (ex. "9593" dans "9593-1034")          [NOUVEAU]
  //   Les gardes ne traversent JAMAIS un retour à la ligne : un CIN en fin de
  //   page suivie d'un autre élément reste valable.
  //
  //   (CORRECTIF « l'employé ne voit pas sa fiche » : la 2e garde ci-dessus
  //   rejetait à tort les CIN ALPHANUMÉRIQUES précédés d'un autre numéro sur
  //   la même ligne — ex. « N° CNSS: 001 SPEC-0001 » ou « SPECIMEN-001
  //   SPEC-0001 » : le « 001 » avant le CIN faisait échouer la garde, la fiche
  //   n'était donc jamais trouvée. Elle n'a de sens que pour un CIN NUMÉRIQUE
  //   (risque de « queue » d'un nombre plus long à format séparé) ; pour un
  //   CIN contenant des lettres, le préfixe alphabétique le rend déjà
  //   structurellement distinct. Comportement NUMÉRIQUE strictement inchangé.)
  const purelyNumeric = /^[0-9]+$/.test(q);
  const leftGuard = purelyNumeric ? "(?<![0-9A-Z][ \\t./\\-])" : "";
  return new RegExp(
    `(?<![A-Z0-9])${leftGuard}${escaped}(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])`
  );
}

/**
 * Vrai si le CIN saisi apparaît EXACTEMENT (numéro complet) dans le contenu,
 * en tolérant les espaces insérés par l'extraction PDF (ancien) ET les
 * écritures avec points/tirets/slashs (nouveau : "26 542 351", "9593-1034").
 */
export function isExactCinInContent(content: string, query: string): boolean {
  const re = exactCinRegex(query);
  return re ? re.test(content.toUpperCase()) : false;
}

/** Retourne la position de la première correspondance exacte du CIN dans le texte. */
export function findExactCinMatch(
  content: string,
  query: string
): { index: number; length: number } | null {
  const re = exactCinRegex(query);
  if (!re) return null;
  const upper = content.toUpperCase();
  const m = re.exec(upper);
  if (!m) return null;
  return { index: m.index, length: m[0].length };
}

/** Extrait du texte autour de la correspondance EXACTE du CIN. */
export function buildExactSnippet(text: string, query: string, radius = 70): string | null {
  const m = findExactCinMatch(text, query);
  if (!m) return null;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

/* ------------------------------------------------------------------ */
/* NOUVEAU (ajouté SANS modifier detectCin ni aucune règle historique) */
/* Aides d'arbitrage pour les fiches « tableau » scannées (OCR) :       */
/*   - isHeaderGarbageName : détecte les faux noms issus des en-têtes   */
/*     (« ETATCIVIL ENFACHARGE », « AGHIRGE » = « A CHARGE » mal lu) ;  */
/*   - detectCinFromTableContext : lit le CIN sous l'en-tête de colonne */
/*     « N° CIN », y compris sur 9 chiffres imprimés (ex. 149654358)    */
/*     que la règle « 1er nombre de 8 chiffres isolé » ne capte pas ;   */
/*   - lineHasCnssKeyAfter : reconnaît un N° CNSS « 17775208 - 08 »     */
/*     (clé juste après le numéro) pour NE PAS l'écraser à tort.        */
/* ------------------------------------------------------------------ */

const GARBAGE_NAME_RE = [
  /ETATCIVIL/,
  /ENF\.?A?CHARGE/,
  /ENFACHARGE/,
  /ENCHARGE/,
  /CATEGORIE/,
  /EATEGORIE/,
  /FONCTION/,
  /MATRICULE/,
  /DROITACQUIS/,
  /SOLDECONGES/,
  /BULLETIN/,
  /RUBRIQUE/,
];

/**
 * Vrai si ce « nom » est en réalité un fragment d'en-tête de tableau
 * (fiche scannée mal lue). Utilisé UNIQUEMENT pour déclencher la passe
 * OCR haute lisibilité et l'arbitrage : aucune règle d'extraction
 * existante n'est modifiée.
 */
export function isHeaderGarbageName(
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const compact = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z]/g, "");
  if (compact.length < 4) return true; // trop court pour être un nom
  if (GARBAGE_NAME_RE.some((re) => re.test(compact))) return true;
  const KNOWN = new Set([
    "ETAT", "CIVIL", "ENF", "A", "CHARGE", "NOM", "PRENOM", "CNSS",
    "CIN", "NON", "OUI", "MATRICULE", "FONCTION", "CATEGORIE",
  ]);
  const tokens = name.trim().split(/[\s.'’-]+/).filter(Boolean);
  if (
    tokens.length > 0 &&
    tokens.every((t) => KNOWN.has(t.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
  ) {
    return true;
  }
  return false;
}

/** Vrai si `cin` apparaît dans `text` immédiatement suivi (même ligne)
 * d'une clé CNSS « - 08 » ou « / 8 » : c'est alors un N° CNSS, pas un CIN.
 * (MODIFIÉ Task 136) la clé SANS tiret (« 17775208 08 ») est aussi reconnue :
 * l'OCR perd fréquemment le tiret imprimé (« - 08 » lu « 08 ») — même
 * convention que la lecture sous en-tête « N° CIN » (exclusion clé sans
 * tiret), sinon le N° CNSS restait retenu comme CIN sur ces scans et
 * TOUTES les pages d'un même modèle se retrouvaient avec le même « CIN »
 * (fichier multi-bulletins alors indécoupable). La clé relâchée reste
 * bornée : 1-2 chiffres non suivis de chiffres/virgule/point (pas un
 * montant décimal). */
export function lineHasCnssKeyAfter(text: string, cin: string): boolean {
  if (!cin) return false;
  const upper = text.toUpperCase();
  const idx = upper.indexOf(cin.toUpperCase());
  if (idx === -1) return false;
  const nl = text.indexOf("\n", idx);
  const rest = text.slice(idx + cin.length, nl === -1 ? undefined : nl);
  return /^[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.test(rest);
}

/**
 * NOUVEAU (ajouté SANS modifier la logique d'arbitrage existante de
 * analyzePayslip, qui reste inchangée) : arbitrage CIN réutilisable par les
 * AUTRES chemins de lecture (images PNG/JPG de l'upload, ré-analyse).
 * Mêmes règles que le bloc historique d'analyzePayslip :
 *   - pas de CIN détecté           -> on prend le CIN lu sous « N° CIN » ;
 *   - CIN capté = N° CNSS (clé « - 08 » sur la même ligne) ET qu'un vrai
 *     CIN est lisible sous l'en-tête « N° CIN » -> on remplace.
 * Sinon le CIN d'origine est conservé tel quel.
 */
export function arbitrateCinWithTableContext(
  cin: string | null,
  text: string
): string | null {
  const ctxCin = detectCinFromTableContext(text);
  if (!ctxCin) return cin;
  if (!cin) return ctxCin;
  if (cin !== ctxCin && lineHasCnssKeyAfter(text, cin)) return ctxCin;
  return cin;
}

/**
 * NOUVEAU (Task 15, ajouté SANS modifier aucune fonction existante) :
 * vrai si le nom détecté est PRÉCÉDÉ, sur sa ligne, d'un fragment OCR
 * parasite de 1-2 lettres MAJUSCULES — ex. réel (fiche EMPLOYE TEST
 * convertie PNG) : la ligne de valeurs est lue « 003879  CS  H AN RIT
 * TEST … » -> le nom extrait « RIT TEST » est précédé de « AN » (et
 * « H ») : l'OCR a morcelé « EMPLOYE ». Un vrai nom n'est jamais immédiatement
 * précédé d'un tel fragment (les particules FR « DE / DU / LA / ET … » et
 * les nombres/matricules sont ignorés). Utilisé UNIQUEMENT pour déclencher
 * la passe OCR haute lisibilité (coût = relecture, jamais un changement de
 * règle d'extraction).
 */
export function nameHasStrayFragments(
  text: string,
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const tokensName = name.trim().split(/\s+/).filter(Boolean);
  if (tokensName.length === 0) return false;
  const firstToken = tokensName[0].toUpperCase();
  // particules / libellés courts ignorés pendant le retour arrière
  const SKIP = new Set([
    "ET", "DU", "DE", "LA", "LE", "LES", "L", "D", "AU", "AUX", "A",
    "EN", "SUR", "NOM", "N", "N°",
  ]);
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/[\[\]{}()"“”]/g, " ");
    if (!line.toUpperCase().includes(firstToken)) continue;
    const tokens = line
      .split(/[|\t:]/)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean);
    // 1re occurrence du 1er token du nom (en partant de la fin : la
    // dernière lecture de la ligne est la plus fiable)
    let idx = -1;
    for (let k = tokens.length - 1; k >= 0; k--) {
      if (tokens[k].toUpperCase() === firstToken) {
        idx = k;
        break;
      }
    }
    if (idx <= 0) continue;
    let j = idx - 1;
    // on saute les nombres (matricules, montants) et les particules
    while (j >= 0 && (SKIP.has(tokens[j].toUpperCase()) || /^\d+[.,]?\d*$/.test(tokens[j]))) {
      j--;
    }
    if (j < 0) continue;
    // fragment parasite = 1-2 lettres TOUT MAJUSCULES juste avant le nom
    if (/^[A-ZÀ-Þ]{1,2}$/.test(tokens[j])) return true;
  }
  return false;
}

/**
 * NOUVEAU : vrai si le nom détecté a été lu sur une LIGNE D'EN-TÊTE de
 * tableau (ligne contenant le nom ET au moins 2 libellés de colonnes :
 * MATRICULE / NOM ET PRENOM / FONCTION / CATEGORIE / BULLETIN DE PAIE).
 * Cas réel (OCR de mauvaise qualité) : la ligne d'en-tête « MATRICULE
 * COTES NOM ET PRENOM COTES FONCTION CATEGORIE » fait retourner « COTES »
 * comme nom — ce n'est PAS un nom mais un fragment de la bande d'en-tête.
 * Utilisé UNIQUEMENT pour déclencher la passe haute lisibilité et
 * l'arbitrage du nom : aucune règle d'extraction existante n'est modifiée.
 */
export function isNameFromHeaderLine(
  text: string,
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const needle = name.trim();
  if (needle.length < 3) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = new RegExp(
    `(?:^|[^A-ZÀ-Þ0-9])${esc}(?=[^A-ZÀ-Þ0-9]|$)`,
    "i"
  );
  const labels: Array<[RegExp, number]> = [
    [/MATRICULE/i, 1],
    [/NOM[ \t]+ET[ \t]+PR[EÉ]NOM/i, 1],
    [/FONCTION/i, 1],
    [/CATEG[O0]RIE/i, 1],
    [/BULLETIN[ \t]+DE[ \t]+PAIE/i, 1],
  ];
  for (const line of text.split("\n")) {
    if (!nameRe.test(line)) continue;
    const hits = labels.reduce((n, [re]) => (re.test(line) ? n + 1 : n), 0);
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * CIN candidat lu sous un en-tête de colonne « N° CIN » (fiches tableau,
 * texte PDF ou OCR) : premier nombre NU de 5 à 10 chiffres des lignes de
 * valeurs qui suivent l'en-tête, en excluant :
 *   - les nombres suivis d'une clé CNSS « - 08 » / « /8 » (N° CNSS) ;
 *   - les montants décimaux « 12,000 » / « 1612.190 » (partie entière ou
 *     décimale collée à une virgule/point) ;
 *   - les nombres de moins de 5 chiffres (clés, quantités).
 * Retourne null si aucun en-tête/candidat : l'appelant garde alors la
 * détection historique INCHANGÉE.
 */
export function detectCinFromTableContext(text: string): string | null {
  const CIN_HEADER =
    /(?:^|[^\dA-ZÀ-Þ])N\s*[°o]\s*C\.?\s*I\.?\s*N\.?(?:[^\dA-ZÀ-Þ]|$)/i;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!CIN_HEADER.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;
      for (const m of line.matchAll(/(?<!\d)(\d{5,10})(?!\d)/g)) {
        const num = m[1];
        const start = m.index ?? 0;
        const after = line.slice(start + num.length, start + num.length + 6);
        // clé CNSS juste après : « - 08 », « /8 » ou « 08 » (tiret perdu par
        // l'OCR) suivie d'aucun chiffre/virgule -> c'est le N° CNSS
        if (/^[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.test(after)) continue;
        // montant décimal collé APRÈS : « 12,000 », « 1612.190 »
        if (/^[ \t]*[,.]\d{3}(?!\d)/.test(after)) continue;
        // partie décimale d'un montant : « ,190 » / «.537 » juste avant
        if (start > 0 && /[,.]/.test(line.slice(start - 1, start))) continue;
        return num;
      }
      // NOUVEAU (Task 70) : repli JETONS LETTRES+chiffres — la colonne
      // « N° CIN » peut contenir un CIN alphabétique (« SPEC-0001 » vu sur
      // les bulletins SPECIMEN de l'utilisateur, colonne N° CIN, la colonne
      // N° CNSS « SPECIMEN-001 » venant AVANT dans la même ligne). Aucun
      // candidat numérique n'ayant été retenu ci-dessus, on collecte les
      // jetons LETTRES(1-8)+séparateur?+chiffres(3-6) de la ligne : s'il
      // n'y en a qu'un, on le prend ; s'il y en a plusieurs, on prend le
      // DERNIER (ordre des colonnes : N° CNSS avant N° CIN ; les montants
      // ne sont jamais lettres+chiffres).
      const jetonsAlphanum = [
        ...line.matchAll(/(?<![A-Z0-9])([A-Z]{1,8})[\s\-\/.]?(\d{3,6})(?!\d)/gi),
      ];
      if (jetonsAlphanum.length > 0) {
        const dernier = jetonsAlphanum[jetonsAlphanum.length - 1];
        return (dernier[1] + dernier[2]).toUpperCase();
      }
      break; // première ligne de valeurs sans candidat : on s'arrête
    }
  }
  // NOUVEAU (repli, ajouté sans toucher au balayage par en-tête ci-dessus) :
  // l'en-tête « N° CIN » est parfois illisible (lu « 1 NON » par l'OCR) alors
  // que la ligne de valeurs est correcte. Sur ces fiches, le N° CNSS est
  // imprimé juste AVANT le CIN sous la forme « 17775208 - 08 » (numéro +
  // clé) : on cherche la 1re ligne contenant ce motif et on retourne le 1er
  // nombre nu (5-10 chiffres, mêmes exclusions) qui le SUIT sur cette ligne.
  // (MODIFIÉ Task 136) : le tiret de la clé CNSS est désormais OPTIONNEL —
  // l'OCR le perd souvent (« 17775208 08 » au lieu de « 17775208 - 08 ») et
  // le motif avec tiret obligatoire restait alors SANS RÉSULTAT : le CIN lu
  // juste après (« N° CIN : 81000000 ») n'était jamais retenu, toutes les
  // pages du même modèle partageaient le N° CNSS comme « CIN » et le fichier
  // multi-bulletins n'était pas découpé. La clé reste bornée à 1-2 chiffres
  // non suivis de chiffres/virgule/point (exclut les montants).
  for (const line of text.split("\n")) {
    const cnss = /(?<!\d)(\d{8})[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.exec(line);
    if (!cnss) continue;
    const from = cnss.index + cnss[0].length;
    const rest = line.slice(from);
    for (const m of rest.matchAll(/(?<!\d)(\d{5,10})(?!\d)/g)) {
      const num = m[1];
      const start = from + (m.index ?? 0);
      const after = line.slice(start + num.length, start + num.length + 6);
      if (/^[ \t]*(?:[-\/][ \t]*)?\d{1,2}(?![\d,.])/.test(after)) continue;
      if (/^[ \t]*[,.]\d{3}(?!\d)/.test(after)) continue;
      if (start > 0 && /[,.]/.test(line.slice(start - 1, start))) continue;
      return num;
    }
  }
  return null;
}

/** Analyse complète d'un PDF de fiche de paie. */
export async function analyzePayslip(buffer: Buffer): Promise<ExtractedPayslip> {
  const { text, pages } = await extractPdfText(buffer);

  // NOUVEAU (fallback OCR incrémental — tous les traitements précédents sont
  // conservés à l'identique) : PDF sans texte extractible (fiches converties
  // PNG -> PDF, scans, captures d'écran) -> chaque page est lue par OCR, puis
  // LES MÊMES règles de détection (CIN, nom, période, net, matricule) sont
  // appliquées sur le texte fusionné (texte historique + texte OCR).
  let finalText = text;
  let ocrUsed = false;
  if ((text || "").trim().length < OCR_TEXT_MIN) {
    try {
      const ocrPages = await ocrPdfPages(buffer);
      const ocrText = ocrPages.filter(Boolean).join("\n").trim();
      if (ocrText.length > 0) {
        finalText = text ? `${text}\n${ocrText}` : ocrText;
        ocrUsed = true;
      }
    } catch (e) {
      console.error(
        "[EXTRACTOR] OCR impossible (PDF image illisible ?):",
        e instanceof Error ? e.message : e
      );
    }
  }

  // NOUVEAU (ajouté SANS modifier le bloc OCR historique ci-dessus) : passe
  // « haute lisibilité » (rendu + agrandissement 2x + segmentation PSM 4)
  // quand la 1re passe OCR n'a pas permis d'identifier les champs clés
  // (zones de tableau mal segmentées : en-tête MATRICULE / NOM / CIN illu).
  // Le texte obtenu est AJOUTÉ au texte existant, jamais substitué : toutes
  // les règles de détection continuent de s'appliquer à l'identique.
  // NOUVEAU (condition ajoutée, aucune condition existante retirée) : la
  // passe se déclenche AUSSI quand le nom détecté est en réalité un fragment
  // d'en-tête de tableau (« ETATCIVIL ENFACHARGE », « AGHIRGE » = «
  // A CHARGE » mal lu par l'OCR...).
  let hiResText = ""; // NOUVEAU : texte haute lisibilité gardé pour l'arbitrage
  if (
    ocrUsed &&
    (!detectCin(finalText) ||
      !extractEmployeeName(finalText) ||
      !extractPeriod(finalText) ||
      isHeaderGarbageName(extractEmployeeName(finalText)) ||
      // NOUVEAU (condition AJOUTÉE, aucune condition existante retirée) :
      // le nom détecté provient d'une LIGNE D'EN-TÊTE de tableau (ex. OCR
      // « MATRICULE COTES NOM ET PRENOM COTES FONCTION CATEGORIE » -> nom
      // « COTES ») : la passe haute lisibilité relit correctement la ligne
      // de valeurs et permet l'arbitrage du nom ET du CIN.
      isNameFromHeaderLine(finalText, extractEmployeeName(finalText)))
  ) {
    try {
      const hiPages = await ocrPdfPagesHighRes(buffer);
      const hiText = hiPages.filter(Boolean).join("\n").trim();
      if (hiText) {
        finalText = `${finalText}\n${hiText}`;
        hiResText = hiText; // NOUVEAU : mémorisé pour l'arbitrage du nom
      }
    } catch (e) {
      console.error(
        "[EXTRACTOR] OCR haute lisibilité impossible:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const normalizedText = normalizeText(finalText);
  // ANCIEN (intégralement conservé) : les champs sont d'abord détectés avec
  // LES MÊMES règles que l'historique...
  const result: ExtractedPayslip = {
    text: finalText,
    normalizedText,
    pages,
    cin: detectCin(finalText),
    employeeName: extractEmployeeName(finalText),
    period: extractPeriod(finalText),
    netSalary: extractNetSalary(finalText),
    matricule: extractMatricule(finalText),
    ocrUsed,
  };

  // NOUVEAU — arbitrage CIN par contexte de colonne « N° CIN » (fiches
  // tableau scannées) : la détection historique n'est remplacée QUE si
  //   a) elle n'avait rien trouvé, OU
  //   b) le CIN capté est en réalité un N° CNSS (une clé « - 08 » figure
  //      juste après sur la même ligne) ET qu'un vrai CIN (5-10 chiffres,
  //      sans clé) est lisible sous l'en-tête « N° CIN ».
  // Cas couvert : CIN imprimés sur 9 chiffres (ex. 149654358) que la règle
  // « 1er nombre de 8 chiffres isolé » ne capte pas — elle prenait alors le
  // N° CNSS à la place (« le numero de cin faux »).
  const ctxCin = detectCinFromTableContext(finalText);
  if (ctxCin) {
    if (!result.cin) {
      result.cin = ctxCin;
    } else if (
      result.cin !== ctxCin &&
      lineHasCnssKeyAfter(finalText, result.cin)
    ) {
      result.cin = ctxCin;
    }
  }

  // NOUVEAU — règle (c), AJOUTÉE après les règles historiques (a)/(b)
  // ci-dessus qui restent inchangées : quand la passe « haute lisibilité »
  // a tourné, le CIN lu sous l'en-tête « N° CIN » dans CE texte est plus
  // fiable que celui de la 1re passe OCR. Si le CIN courant n'apparaît
  // NULLE PART dans le texte haute lisibilité (lecture erronée de la 1re
  // passe, ex. « 149654358 » lu « 12345678 »), on le remplace par le sien.
  if (hiResText && result.cin) {
    const hiCtx = detectCinFromTableContext(hiResText);
    if (hiCtx && hiCtx !== result.cin && !hiResText.includes(result.cin)) {
      result.cin = hiCtx;
    }
  }

  // NOUVEAU — arbitrage nom : si le nom détecté est un fragment d'en-tête
  // ou a été lu sur une ligne d'en-tête (voir isNameFromHeaderLine), et que
  // la passe haute lisibilité en propose un plausible, on garde le sien
  // (le texte historique reste inchangé pour la recherche).
  if (
    hiResText &&
    (isHeaderGarbageName(result.employeeName) ||
      isNameFromHeaderLine(finalText, result.employeeName))
  ) {
    const hiName = extractEmployeeName(hiResText);
    if (hiName && !isHeaderGarbageName(hiName)) {
      result.employeeName = hiName;
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* NOUVEAU : PDF multi-fiches (plusieurs fiches dans UN SEUL fichier)  */
/* ------------------------------------------------------------------ */

/** Analyse d'UNE page d'un PDF (mêmes champs que ExtractedPayslip). */
export interface PagePayslip {
  page: number; // numéro de page (1 = première page)
  text: string;
  normalizedText: string;
  cin: string | null;
  employeeName: string | null;
  period: string | null;
  netSalary: string | null;
  matricule: string | null;
  // NOUVEAU : true quand le texte de cette page provient (aussi) de l'OCR.
  ocrUsed?: boolean;
}

/**
 * Extrait le texte global + le texte de CHAQUE page.
 * (Les anciens motifs de nettoyage du texte sont conservés à l'identique.)
 */
export async function extractPdfPageTexts(
  buffer: Buffer
): Promise<{ text: string; pages: number; pageTexts: string[] }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const clean = (t: string | undefined) =>
      (t || "").replace(/--\s*\d+ of \d+\s*--/g, " ").trim();
    const text = clean(result.text);
    const pages = result.pages?.length || 1;
    const pageTexts = (result.pages || []).map((p) => clean(p.text));
    if (pageTexts.length === 0) pageTexts.push(text);
    return { text, pages, pageTexts };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * NOUVEAU : analyse page par page d'un PDF.
 *
 * Permet de gérer les fichiers contenant PLUSIEURS fiches de paie
 * (1 fiche par page, ou fiche sur plusieurs pages consécutives).
 * Chaque page est analysée avec LES MÊMES règles que l'analyse globale
 * (CIN, employé, période, net, matricule) : aucune règle n'est dupliquée
 * ni modifiée.
 */
export async function analyzePayslipPages(
  buffer: Buffer
): Promise<{ pages: number; pagePayslips: PagePayslip[] }> {
  const { pages, pageTexts } = await extractPdfPageTexts(buffer);

  // NOUVEAU (fallback OCR incrémental, aucun comportement existant modifié) :
  // pages SANS texte extractible (PDF image / scan) -> OCR page par page.
  // Les pages qui ont déjà du texte restent INCHANGÉES.
  const emptyPages = pageTexts.map((t) => (t || "").trim().length < OCR_TEXT_MIN);
  if (emptyPages.some(Boolean)) {
    try {
      const ocrTexts = await ocrPdfPages(buffer);
      if (pageTexts.length === 1 && ocrTexts.length > 1) {
        // extraction historique ayant fusionné les pages -> on fusionne
        // aussi les pages OCR pour rester cohérent
        const joined = ocrTexts.filter(Boolean).join("\n");
        if (joined.trim()) {
          pageTexts[0] = pageTexts[0] ? `${pageTexts[0]}\n${joined}` : joined;
        }
      } else {
        for (let i = 0; i < pageTexts.length && i < ocrTexts.length; i++) {
          if (emptyPages[i] && ocrTexts[i] && ocrTexts[i].trim()) {
            pageTexts[i] = pageTexts[i]
              ? `${pageTexts[i]}\n${ocrTexts[i]}`
              : ocrTexts[i];
          }
        }
      }
    } catch (e) {
      console.error(
        "[EXTRACTOR] OCR par page impossible:",
        e instanceof Error ? e.message : e
      );
    }
  }

  // NOUVEAU (ajouté SANS modifier le bloc OCR par page ci-dessus) : passe
  // « haute lisibilité » (agrandissement 2x + PSM 4) pour les pages TOUJOURS
  // incomplètes après la 1re passe (pas de CIN, ou pas de nom+période).
  // Le texte est AJOUTÉ à la page concernée, jamais substitué.
  // NOUVEAU (condition AJOUTÉE, inchangée sinon) : une page OCR dont le nom
  // provient d'une ligne d'en-tête de tableau (« COTES » lu dans la bande
  // MATRICULE / NOM ET PRENOM / FONCTION / CATEGORIE) est aussi incomplète.
  const incompletePages = pageTexts.map(
    (t) =>
      !detectCin(t) ||
      !extractEmployeeName(t) ||
      !extractPeriod(t) ||
      isNameFromHeaderLine(t, extractEmployeeName(t))
  );
  if (incompletePages.some(Boolean)) {
    try {
      const hiTexts = await ocrPdfPagesHighRes(buffer);
      for (let i = 0; i < pageTexts.length && i < hiTexts.length; i++) {
        if (incompletePages[i] && hiTexts[i] && hiTexts[i].trim()) {
          pageTexts[i] = pageTexts[i]
            ? `${pageTexts[i]}\n${hiTexts[i]}`
            : hiTexts[i];
        }
      }
    } catch (e) {
      console.error(
        "[EXTRACTOR] OCR haute lisibilité par page impossible:",
        e instanceof Error ? e.message : e
      );
    }
  }

  // (MODIFIÉ Task 136) : arbitrage CIN AVEC le contexte de tableau appliqué
  // PAR PAGE — mêmes règles que les chemins Excel (expandSheetTexts) et
  // analyse globale (analyzePayslip) qui utilisaient déjà
  // arbitrateCinWithTableContext. Sans cet arbitrage, un bulletin scanné à
  // colonnes (« N° CNSS | N° CIN ») dont l'OCR lit mal l'en-tête retenait le
  // N° CNSS comme CIN : TOUTES les pages d'un PDF multi-bulletins du même
  // modèle obtenaient le MÊME « CIN » → groupMultiPayslips les fusionnait →
  // fichier jamais découpé (cas réel « bulletins_paie_SPECIMEN_200_CIN_fictifs.pdf »).
  const pagePayslips: PagePayslip[] = pageTexts.map((t, i) => ({
    page: i + 1,
    text: t,
    normalizedText: normalizeText(t),
    cin: arbitrateCinWithTableContext(detectCin(t), t),
    employeeName: extractEmployeeName(t),
    period: extractPeriod(t),
    netSalary: extractNetSalary(t),
    matricule: extractMatricule(t),
    ocrUsed: emptyPages[i] ?? false,
  }));
  return { pages, pagePayslips };
}

/* ============================================================
 * (Task 104) IDENTITÉ EMPLOYÉ — distingue une page de CONTINUATION
 * (fiche qui déborde sur 2 pages, en-tête répété : MÊME personne)
 * d'une NOUVELLE fiche complète (employé DIFFÉRENT) au sein des
 * pages consécutives portant le MÊME CIN.
 *
 * Cas réel corrigé : « 20_fiches_de_paie_specimen.pdf » — 20 fiches
 * COMPLÈTES (matricules EMP-0001..EMP-0020, noms tous différents,
 * un « Net à payer » par page) partageant un MÊME CIN fictif
 * (« CIN : 07451236 », « C.I.N. : 0745 1236 », « Carte ID : … »).
 * La règle historique « consécutives + même CIN = une seule fiche »
 * fusionnait les 20 pages en UN SEUL enregistrement → fichier non
 * découpé. Or une page de continuation n'appartient JAMAIS à un
 * autre employé : un nom ou un matricule différent trahit une
 * fiche distincte.
 *
 * Prudence (aucune régression des cas historiques) :
 *  - noms présents des deux côtés → comparaison par SIMILARITÉ
 *    (bigrammes, seuil 0.75) : tolère le bruit OCR sur un même nom
 *    (« Amine Ben Ali » / « Amine Ben A11 ») tout en séparant des
 *    personnes différentes ;
 *  - matricules consultés SEULEMENT si un nom manque : comparaison
 *    exacte après normalisation (un matricule différent = un autre
 *    salarié) ;
 *  - aucun signal fiable → comportement historique (fusion).
 * ============================================================ */

/** Normalise une identité : sans accents, majuscules, ponctuation → espaces. */
export function normaliserIdentite(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Similarité 0..1 par coefficient de Dice sur bigrammes (robuste au bruit OCR). */
export function similariteBigrammes(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b || a.length < 2 || b.length < 2) return 0;
  const compte = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = compte(a);
  const B = compte(b);
  let totalA = 0;
  let totalB = 0;
  let inter = 0;
  for (const n of A.values()) totalA += n;
  for (const [g, n] of B) {
    totalB += n;
    const na = A.get(g);
    if (na) inter += Math.min(n, na);
  }
  if (totalA === 0 || totalB === 0) return 0;
  return (2 * inter) / (totalA + totalB);
}

/**
 * (Task 104) Les deux noms désignent-ils la MÊME personne ?
 * Retourne null si indécidable (un nom manque ou vide), sinon
 * true (même personne) / false (personnes différentes).
 */
export function memePersonne(
  nomA: string | null | undefined,
  nomB: string | null | undefined
): boolean | null {
  const a = normaliserIdentite(nomA as string);
  const b = normaliserIdentite(nomB as string);
  if (!a || !b) return null;
  return similariteBigrammes(a, b) >= 0.75;
}

/**
 * (Task 104) La page `p` démarre-t-elle une NOUVELLE fiche d'un employé
 * DIFFÉRENT de la dernière page du groupe `prev` ?
 * Décision : noms si comparables, sinon matricules (exact), sinon false.
 */
function identiteDifferente(prev: PagePayslip, p: PagePayslip): boolean {
  const meme = memePersonne(prev.employeeName, p.employeeName);
  if (meme !== null) return !meme; // noms comparables → ils décident
  const ma = normaliserIdentite(prev.matricule || "").replace(/ /g, "");
  const mb = normaliserIdentite(p.matricule || "").replace(/ /g, "");
  if (ma && mb) return ma !== mb;
  return false; // aucun signal fiable → comportement historique (fusion)
}

/**
 * NOUVEAU (Task 159) : deux périodes sont-elles COMPATIBLES avec une fusion
 * en UNE SEULE fiche ? Utilisé par groupMultiPayslips pour distinguer
 *  - une page de CONTINUATION (fiche qui déborde : même période, ou période
 *    absente sur l'une des deux pages) — fusion historique conservée ;
 *  - de VRAIS bulletins MENSUELS successifs du MÊME employé (même CIN, même
 *    nom, période différente — cas réel « FICHE 3879 EMPLOYE TEST 2026.PDF » :
 *    9 bulletins janv→août 2026 que la règle historique fusionnait en UNE
 *    seule fiche « janvier », perdant 8 mois) — chaque mois devient une fiche.
 * Comparaison sur les dates dd/mm/aa(dd) extraites des chaînes de période :
 * toute date diffère ou l'une des chaînes manque de dates → décision.
 * Indécidable (pas de dates des deux côtés) → compatibles (historique).
 */
export function periodesCompatibles(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return true;
  const dates = (s: string) => (s.match(/\d{2}\/\d{2}\/\d{2,4}/g) || []).join("|");
  const da = dates(a);
  const db = dates(b);
  if (!da || !db) return true;
  return da === db;
}

/**
 * NOUVEAU : regroupe les pages analysées en fiches individuelles.
 *
 * - Une page SANS CIN est ignorée (annexe, rubriques de continuation…).
 * - Les pages CONSÉCUTIVES portant le MÊME CIN sont regroupées en une seule
 *   fiche (fiche qui déborde sur 2 pages avec en-tête répété), SAUF si les
 *   pages consécutives sont STRICTEMENT IDENTIQUES (copies de la même fiche,
 *   ex. « copies_150_one_pdf » : 150 copies) — chaque copie est alors une
 *   fiche distincte (CORRECTIF Task 101) — SAUF si elles appartiennent à des
 *   employés DIFFÉRENTS (nom ou matricule différent, ex.
 *   « 20_fiches_de_paie_specimen.pdf » : 20 fiches complètes, un même CIN
 *   fictif) — chaque employé est alors une fiche distincte (CORRECTIF
 *   Task 104).
 * - Le même CIN sur des pages NON consécutives = 2 fiches distinctes
 *   (2 bulletins du même employé dans un seul PDF).
 * - Les champs vides d'une page sont complétés par ceux des pages suivantes
 *   du même groupe (ex. net à payer en bas de la 2e page).
 *
 * Retourne null si le document ne contient pas plusieurs fiches distinctes
 * (moins de 2 CIN différents ET aucun groupe séparable) →
 * l'appelant garde le comportement historique.
 */
export function groupMultiPayslips(
  pagePayslips: PagePayslip[]
): PagePayslip[] | null {
  const withCin = pagePayslips.filter((p) => p.cin);
  const distinctCins = Array.from(new Set(withCin.map((p) => p.cin as string)));

  type Group = {
    firstPage: number;
    lastPage: number;
    cin: string;
    parts: PagePayslip[];
  };
  const groups: Group[] = [];

  // (CORRECTIF Task 101) Pages CONSÉCUTIVES et STRICTEMENT IDENTIQUES (même
  // texte normalisé) = COPIES de la même fiche (ex. « copies_150_one_pdf » :
  // 150 copies de la même fiche dans un seul PDF) — chaque copie devient une
  // fiche PROPRE au lieu d'être fusionnée. Une vraie page de CONTINUATION
  // (fiche qui déborde) a un texte DIFFÉRENT de la page précédente et n'est
  // JAMAIS une copie : la fusion historique s'applique toujours à elle.
  // lastGroupIsCopy : le dernier groupe vient d'être créé comme COPIE d'une
  // fiche complète — la page suivante (différente) ne peut donc pas s'y
  // fondre (une copie est une fiche TERMINÉE ; la page suivante commence un
  // nouveau document).
  let prevWithCin: PagePayslip | null = null;
  let lastGroupIsCopy = false;
  for (const p of withCin) {
    const last = groups[groups.length - 1];
    const isCopy =
      prevWithCin !== null &&
      p.page === prevWithCin.page + 1 &&
      prevWithCin.normalizedText === p.normalizedText;
    if (isCopy) {
      groups.push({
        firstPage: p.page,
        lastPage: p.page,
        cin: p.cin as string,
        parts: [p],
      });
      lastGroupIsCopy = true;
    } else if (
      last &&
      !lastGroupIsCopy &&
      last.cin === p.cin &&
      last.lastPage === p.page - 1 &&
      // (CORRECTIF Task 104) même CIN, page consécutive, mais employé
      // DIFFÉRENT (nom substantiellement différent, ou matricule différent
      // si un nom manque) = NOUVELLE fiche complète, PAS une continuation.
      // Une page de continuation répète l'identité de SON propre employé :
      // elle n'est jamais touchée par cette condition.
      !identiteDifferente(last.parts[last.parts.length - 1], p) &&
      // (CORRECTIF Task 159) même employé, page consécutive, mais PÉRIODE
      // DIFFÉRENTE des deux côtés = bulletins MENSUELS successifs du même
      // salarié (cas réel « FICHE 3879 EMPLOYE TEST 2026.PDF » : 9 bulletins
      // janv→août fusionnés en 1 fiche « janvier ») — chaque période devient
      // une fiche. Une continuation (même période, ou période absente d'un
      // côté) reste fusionnée comme historiquement.
      periodesCompatibles(
        last.parts[last.parts.length - 1].period,
        p.period
      )
    ) {
      last.lastPage = p.page;
      last.parts.push(p);
    } else {
      groups.push({ firstPage: p.page, lastPage: p.page, cin: p.cin as string, parts: [p] });
      lastGroupIsCopy = false;
    }
    prevWithCin = p;
  }

  // (MODIFIÉ Task 101) historique : « moins de 2 CIN différents → mono-fiche ».
  // La règle reste valable SAUF quand des COPIES identiques forment déjà
  // PLUSIEURS fiches (ex. 150 copies du même employé = 150 fiches, un seul
  // CIN) : dans ce cas les groupes sont renvoyés comme pour un PDF
  // multi-employés — sinon le fichier restait une seule fiche indécomposable.
  if (distinctCins.length < 2 && groups.length < 2) return null;

  return groups.map((g) => {
    const text = g.parts.map((p) => p.text).join("\n");
    const pick = <K extends keyof PagePayslip>(k: K): PagePayslip[K] => {
      for (const p of g.parts) if (p[k]) return p[k];
      return ("" as unknown) as PagePayslip[K];
    };
    return {
      page: g.firstPage,
      text,
      normalizedText: normalizeText(text),
      cin: g.cin,
      employeeName: pick("employeeName") || null,
      period: pick("period") || null,
      netSalary: pick("netSalary") || null,
      matricule: pick("matricule") || null,
    };
  });
}
