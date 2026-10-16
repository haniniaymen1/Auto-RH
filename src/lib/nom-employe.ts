/**
 * ============================================================================
 *  NOUVEAU (v0.2.109 — demande utilisateur « Accès portail ») — DÉCOUPAGE
 *  AUTOMATIQUE DU NOM COMPLET EN « Nom » + « Prénom » SÉPARÉS
 * ============================================================================
 *  Les fiches de paie importées portent le nom de l'employé en UNE SEULE
 *  chaîne (Payslip.employeeName, ex. « Saidani Mohamed Amine »). Cette
 *  librairie applique les règles de l'utilisateur pour remplir
 *  AUTOMATIQUEMENT et SÉPARÉMENT les colonnes « Nom » et « Prénom » du
 *  tableau « Accès portail par mot de passe » :
 *
 *  RÈGLES (demande utilisateur, v0.2.109) :
 *   1) CAS GÉNÉRAL — le PREMIER mot correspond au Nom, tous les mots
 *      suivants correspondent au Prénom :
 *          « Saidani Mohamed Amine » → Nom : Saidani
 *                                       Prénom : Mohamed Amine
 *   2) NOMS COMPOSÉS AVEC « Ben », « Bel » ou « Bou » — lorsque le nom
 *      contient l'un de ces mots (mot SEUL, insensible à la casse),
 *      l'ensemble du nom composé (Ben/Bel/Bou + le mot qui suit) appartient
 *      au Nom :
 *          « Ben Hnid Mohamed »       → Nom : Ben Hnid
 *                                       Prénom : Mohamed
 *          « Bel Agha Mohamed Amine » → Nom : Bel Agha
 *                                       Prénom : Mohamed Amine
 *          « bou mnijel majdi »       → Nom : bou mnijel
 *                                       Prénom : majdi
 *
 *  DÉTAILS D'APPLICATION (déduits des mêmes règles, documentés ici pour la
 *  maintenance — le RH garde le crayon pour corriger toute exception) :
 *   - le composé Ben/Bel/Bou peut être précédé d'autres mots du Nom :
 *         « Saidani Ben Amor Mohamed » → Nom : Saidani Ben Amor
 *                                         Prénom : Mohamed
 *   - si le composé TERMINE le nom (aucun mot après), les mots situés
 *     AVANT le composé forment le Prénom (convention « Prénom Nom ») :
 *         « Mohamed Ben Salah »        → Nom : Ben Salah
 *                                         Prénom : Mohamed
 *   - un mot COLLÉ (ex. « Benali », « Belhaj », « Bouslama ») n'est PAS un
 *     composé :
 *         « Benali Mohamed »           → Nom : Benali
 *                                         Prénom : Mohamed (cas général)
 *   - un seul mot → Nom seul, Prénom vide ; chaîne vide → null/null.
 *
 *  Fonction PURE (aucune dépendance serveur) : utilisable côté API
 *  (répertoire /api/payslips/employes, création des accès) comme côté
 *  interface (repli d'affichage des accès historiques).
 * ============================================================================
 */

/** Longueurs maximales cohérentes avec l'action « modifier-nom » de
 *  /api/portal-access (validation 2 à 80 caractères par champ). */
const LONGUEUR_MAX = 80;

/** Découpe un nom complet en { nom, prenom } selon les règles ci-dessus.
 *  Retourne TOUJOURS un objet à deux champs (null quand la partie est
 *  absente) — jamais une exception, même sur une entrée inattendue. */
export function separerNomPrenom(
  nomComplet: string | null | undefined
): { nom: string | null; prenom: string | null } {
  try {
    const propre = String(nomComplet ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!propre) return { nom: null, prenom: null };

    const mots = propre.split(" ").filter(Boolean);
    if (mots.length === 0) return { nom: null, prenom: null };
    if (mots.length === 1) return { nom: mots[0], prenom: null };

    // Index du PREMIER mot composé « Ben » / « Bel » / « Bou » (mot SEUL,
    // insensible à la casse — les fiches scannées sont souvent en
    // MAJUSCULES).
    const iCompose = mots.findIndex((m) => /^(ben|bel|bou)$/i.test(m));

    let nom: string;
    let prenom: string;

    if (iCompose === -1) {
      // CAS GÉNÉRAL — premier mot = Nom, tous les suivants = Prénom.
      nom = mots[0];
      prenom = mots.slice(1).join(" ");
    } else if (iCompose === 0) {
      // Composé en TÊTE (« Ben Hnid Mohamed », « Bel Agha Mohamed Amine »,
      // « bou mnijel majdi ») : Nom = Ben/Bel/Bou + le mot suivant ;
      // Prénom = tout le reste.
      nom = mots.slice(0, 2).join(" ");
      prenom = mots.slice(2).join(" ");
    } else {
      // Composé plus loin dans le nom : le Nom s'étend JUSQU'AU composé
      // inclus. Si aucun mot ne suit le composé, les mots situés AVANT
      // forment le Prénom (le composé termine le nom → « Mohamed Ben
      // Salah » → Nom « Ben Salah », Prénom « Mohamed »).
      const apres = mots.slice(iCompose + 2).join(" ");
      if (apres) {
        nom = mots.slice(0, iCompose + 2).join(" ");
        prenom = apres;
      } else {
        nom = mots.slice(iCompose, iCompose + 2).join(" ");
        prenom = mots.slice(0, iCompose).join(" ");
      }
    }

    // Garde-fous de longueur (cohérents avec la validation « modifier-nom ») :
    // au-delà, la partie est renvoyée entière tronquée — le RH corrige au
    // crayon si besoin.
    nom = nom.slice(0, LONGUEUR_MAX);
    prenom = prenom ? prenom.slice(0, LONGUEUR_MAX) : "";
    return { nom: nom || null, prenom: prenom || null };
  } catch {
    return { nom: null, prenom: null };
  }
}
