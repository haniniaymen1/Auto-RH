/**
 * ============================================================================
 *  NOUVEAU (v0.2.50) — DÉTECTION DES ERREURS / INCOHÉRENCES NOM & PRÉNOM
 * ============================================================================
 *
 *  Demande utilisateur : « Détecter et signaler automatiquement les erreurs
 *  ou incohérences dans le nom et le prénom lors de l'importation ou du
 *  traitement des documents. »
 *
 *  Deux points de détection :
 *   1. IMPORTATION des fiches de paie (src/app/api/payslips/upload) : le nom
 *      extrait de chaque fiche est comparé aux fiches EXISTANTES du même CIN
 *      (historique + même lot) — ordre nom/prénom inversé, probable faute de
 *      frappe, nom différent — et passe des contrôles de format (nom
 *      manquant, un seul mot, chiffres dans le nom). Résultat stocké sur la
 *      fiche (Payslip.anomalieNom, chiffré) et signalé dans les résultats
 *      d'import ET dans l'onglet « Toutes les fiches ».
 *   2. TRAITEMENT des demandes (portail employé, attestations + autorisation
 *      de sortie) : le nom/prénom saisis sont comparés au nom trouvé sur les
 *      fiches de paie du même CIN — l'anomalie est signalée au service RH
 *      dans l'e-mail de la demande, dans le détail administratif ET à
 *      l'employé juste après l'envoi.
 *
 *  Ce module ne contient QUE des fonctions PURES (aucune base de données) —
 *  il possède une JUMELLE JS dans scripts/portail-server.js (⚠ garder les
 *  deux alignées : mêmes seuils, mêmes libellés).
 * ============================================================================
 */

/** Résultat d'une comparaison entre deux écritures d'un même nom. */
export type NiveauComparaison =
  | "IDENTIQUE" // strictement identiques (après retrait des espaces multiples)
  | "ECRITURE" // mêmes lettres mais casse / espaces / tirets différents
  | "ORDRE_INVERSE" // mêmes jetons mais dans un autre ordre (nom ↔ prénom)
  | "PROCHE" // distance de Levenshtein sous le seuil (faute de frappe probable)
  | "DIFFERENT"; // aucune correspondance plausible

/** Écart maximal toléré pour classer deux noms « PROCHE » (faute de frappe). */
function seuilLevenshtein(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  if (n <= 0) return 0;
  // 1 lettre d'écart jusqu'à 8 caractères, 2 jusqu'à 14, 3 au-delà —
  // proportionné pour rester silencieux sur les vraies différences.
  if (n <= 8) return 1;
  if (n <= 14) return 2;
  return 3;
}

/** Distance de Levenshtein classique (programmation dynamique, O(n·m)). */
export function distanceLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let precedent: number[] = new Array(b.length + 1);
  let courant: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) precedent[j] = j;
  for (let i = 1; i <= a.length; i++) {
    courant[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courant[j] = Math.min(
        precedent[j] + 1, // suppression
        courant[j - 1] + 1, // insertion
        precedent[j - 1] + cout // substitution
      );
    }
    const echange = precedent;
    precedent = courant;
    courant = echange;
  }
  return precedent[b.length];
}

/** Retire les accents/diacritiques (é → E, ç → C…). */
function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Forme « lettres uniquement » : majuscules sans accents, espaces / tirets /
 * apostrophes / ponctuation retirés. « Ben Ali-Salah » et « BENALISALAH »
 * deviennent identiques — ces écarts d'écriture sont signalés à part
 * (niveau ECRITURE) mais ne constituent PAS une incohérence grave.
 */
export function formeLettres(s: string | null | undefined): string {
  return sansAccents(String(s ?? "").toUpperCase()).replace(/[^A-Z]/g, "");
}

/**
 * Jetons du nom : majuscules sans accents découpés sur tout séparateur
 * (espaces, tirets, apostrophes). « BEN SALAH » → ["BEN", "SALAH"].
 */
export function jetonsNom(s: string | null | undefined): string[] {
  return sansAccents(String(s ?? "").toUpperCase())
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/**
 * Appariement par JETONS TRIÉS : même nombre de jetons et une seule paire
 * qui diffère (distance ≤ seuil), toutes les autres identiques → faute de
 * frappe LOCALISÉE. Indispensable pour comparer « PRÉNOM NOM » (formulaire)
 * à « NOM PRÉNOM » (fiche Sage) : la rotation fausse la distance au niveau
 * des lettres entières (ex. « Ayman EMPLOYE » vs « EMPLOYE TEST »).
 */
function prochesParJetons(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  let ecarts = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] === sb[i]) continue;
    ecarts++;
    if (ecarts > 1) return false;
    const s = seuilLevenshtein(sa[i], sb[i]);
    if (distanceLevenshtein(sa[i], sb[i]) > s) return false;
  }
  return ecarts === 1;
}

/**
 * Compare deux écritures d'un nom et renvoie le niveau d'écart.
 * Jamais d'exception : toute entrée vide donne DIFFERENT (l'appelant gère
 * les cas « nom non détecté » séparément avec anomaliesFormatNom).
 */
export function comparerNoms(
  a: string | null | undefined,
  b: string | null | undefined
): NiveauComparaison {
  const bruteA = String(a ?? "").trim();
  const bruteB = String(b ?? "").trim();
  if (!bruteA || !bruteB) return "DIFFERENT";
  if (bruteA === bruteB) return "IDENTIQUE";
  const la = formeLettres(bruteA);
  const lb = formeLettres(bruteB);
  if (la === lb) return "ECRITURE";
  const ja = jetonsNom(bruteA);
  const jb = jetonsNom(bruteB);
  if (ja.join(" ") && [...ja].sort().join(" ") === [...jb].sort().join(" ")) {
    return "ORDRE_INVERSE";
  }
  // Faute de frappe localisée sur UN jeton (ordre éventuellement différent).
  if (prochesParJetons(ja, jb)) return "PROCHE";
  const d = distanceLevenshtein(la, lb);
  if (d > 0 && d <= seuilLevenshtein(la, lb)) return "PROCHE";
  return "DIFFERENT";
}

/**
 * Contrôles de FORMAT d'un nom extrait d'un document (sans référence
 * nécessaire) : renvoie la liste des anomalies lisibles (vide = RAS).
 *  - nom absent → « non détecté » (l'extraction n'a rien trouvé) ;
 *  - chiffres dans le nom → probable erreur de lecture (OCR, colonne voisine) ;
 *  - un seul mot → le nom OU le prénom semble manquer ;
 *  - moins de 3 lettres → trop court pour être un vrai nom.
 */
export function anomaliesFormatNom(
  nom: string | null | undefined
): string[] {
  const brut = String(nom ?? "").trim();
  const anomalies: string[] = [];
  if (!brut) {
    anomalies.push("Nom de l'employé non détecté dans le document.");
    return anomalies;
  }
  const lettres = formeLettres(brut);
  if (/\d/.test(brut)) {
    anomalies.push(
      "Le nom contient des chiffres (« " + brut + " ») — probable erreur de lecture du document."
    );
  } else if (lettres.length < 3) {
    anomalies.push(
      "Nom trop court (« " + brut + " ») — vérifiez la lecture du document."
    );
  } else if (jetonsNom(brut).length < 2) {
    anomalies.push(
      "Un seul mot détecté (« " + brut + " ») : le nom ou le prénom semble manquer."
    );
  }
  return anomalies;
}

/** Libellé lisible d'un écart entre la valeur du document et la référence. */
function libelleEcart(
  niveau: NiveauComparaison,
  valeur: string,
  reference: string
): string | null {
  switch (niveau) {
    case "IDENTIQUE":
      return null;
    case "ECRITURE":
      return (
        "Écriture différente des fiches existantes : « " +
        valeur +
        " » au lieu de « " +
        reference +
        " » (majuscules, espaces ou tirets)."
      );
    case "ORDRE_INVERSE":
      return (
        "Ordre nom / prénom probablement inversé : « " +
        valeur +
        " » alors que les fiches existantes portent « " +
        reference +
        " »."
      );
    case "PROCHE":
      return (
        "Probable faute de frappe : « " +
        valeur +
        " » diffère du nom sur les fiches existantes « " +
        reference +
        " »."
      );
    case "DIFFERENT":
      return (
        "Nom différent des fiches existantes du même CIN : « " +
        valeur +
        " » au lieu de « " +
        reference +
        " »."
      );
  }
}

/**
 * Compare le nom extrait d'une fiche importée au nom de RÉFÉRENCE (fiche la
 * plus récente du même CIN déjà en base). Renvoie la liste des anomalies
 * (vide = cohérent) : format d'abord, puis écart avec la référence.
 */
export function anomaliesNomFiche(
  employeeName: string | null | undefined,
  nomReference: string | null | undefined
): string[] {
  const anomalies = anomaliesFormatNom(employeeName);
  const brut = String(employeeName ?? "").trim();
  const reference = String(nomReference ?? "").trim();
  if (!brut || !reference) return anomalies; // pas de référence comparable
  const ecart = libelleEcart(comparerNoms(brut, reference), brut, reference);
  if (ecart) anomalies.push(ecart);
  return anomalies;
}

/**
 * Contrôles de format d'un champ UNIQUE (nom OU prénom saisi séparément) :
 * chiffres ou longueur insuffisante. Le contrôle « un seul mot » ne s'applique
 * PAS ici (un prénom comme « Mohamed » est parfaitement normal) — il est fait
 * sur le nom COMPLET dans verifierCoherenceDemande.
 */
function anomaliesFormatChamp(v: string): string[] {
  if (!v) return [];
  const anomalies: string[] = [];
  if (/\d/.test(v)) {
    anomalies.push(
      "Le champ « " + v + " » contient des chiffres — vérifiez la saisie."
    );
  } else if (formeLettres(v).length < 2) {
    anomalies.push(
      "Le champ « " + v + " » est trop court — vérifiez la saisie."
    );
  }
  return anomalies;
}

/**
 * Vérifie la COHÉRENCE du nom/prénom saisis dans un formulaire de demande
 * avec le nom trouvé sur les fiches de paie du même CIN. Renvoie le texte
 * de l'anomalie (ou null = cohérent / aucune fiche de référence).
 *
 * Particularité : le formulaire sépare nom et prénom alors que la fiche
 * porte « NOM PRENOM » (ordre Sage le plus courant). Le même ensemble de
 * jetons est donc considéré cohérent QUEL QUE SOIT l'ordre — seuls les
 * vrais écarts (faute de frappe, nom différent, chiffres…) sont signalés.
 */
export function verifierCoherenceDemande(
  nom: string | null | undefined,
  prenom: string | null | undefined,
  nomFiches: string | null | undefined
): string | null {
  const reference = String(nomFiches ?? "").trim();
  const nomPropre = String(nom ?? "").trim();
  const prenomPropre = String(prenom ?? "").trim();
  if (!reference || (!nomPropre && !prenomPropre)) return null;
  const saisi = (prenomPropre + " " + nomPropre).trim();
  // Contrôles de format : chaque champ (chiffres, longueur) PUIS le nom
  // complet (un seul mot = nom ou prénom manquant).
  const format = [
    ...anomaliesFormatChamp(nomPropre),
    ...anomaliesFormatChamp(prenomPropre),
    ...anomaliesFormatNom(saisi).filter((a) => a.indexOf("un seul mot") >= 0),
  ];
  const niveau = comparerNoms(saisi, reference);
  if (niveau === "IDENTIQUE" || niveau === "ECRITURE" || niveau === "ORDRE_INVERSE") {
    // Écriture acceptée (casse / ordre libre) — on signale seulement un
    // problème de FORMAT détecté sur les champs eux-mêmes.
    return format.length ? format.join(" ") : null;
  }
  // (anomaliesFormatNom(saisi) aurait pu signaler un nom trop court en plus
  // du « un seul mot » déjà filtré ci-dessus : rien d'autre à reprendre.)
  const ecart =
    niveau === "PROCHE"
      ? "Probable faute de saisie : « " +
        saisi +
        " » diffère du nom sur vos fiches de paie (« " +
        reference +
        " »)."
      : "Nom / prénom saisis (« " +
        saisi +
        " ») différents de ceux des fiches de paie (« " +
        reference +
        " »).";
  return format.length ? format.join(" ") + " " + ecart : ecart;
}
