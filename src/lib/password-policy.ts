/**
 * NOUVEAU (Task 64) — POLITIQUE D'EXPIRATION DES MOTS DE PASSE.
 *
 * RÈGLE APPLIQUÉE À TOUS LES UTILISATEURS SANS EXCEPTION :
 *   - employés du portail (PortalAccess) ;
 *   - comptes RH et IT (User) ;
 *   - superadministrateur (User).
 *
 * Chaque mot de passe expire au bout de PASSWORD_MAX_AGE_DAYS jours.
 * À la prochaine connexion (ou à la prochaine requête avec une session déjà
 * ouverte), le changement de mot de passe est OBLIGATOIRE :
 *   - interface d'administration : écran de changement non contournable +
 *     refus serveur (403) sur toutes les API de données ;
 *   - portail employés : écran de changement forcé (session « pending »,
 *     aucun accès aux fiches tant que le changement n'est pas fait).
 *
 * Convention : passwordChangedAt = null  <=>  mot de passe EXPIRÉ.
 * Ainsi, tout compte existant doit changer son mot de passe une première fois
 * après l'installation de cette mise à jour (comportement voulu : OBLIGATOIRE
 * pour TOUS), et toute création/réinitialisation repart sur 15 jours pleins.
 */

/** Durée de vie d'un mot de passe, en jours. */
export const PASSWORD_MAX_AGE_DAYS = 15;

/** Durée de vie en millisecondes (15 × 24 h). */
export const PASSWORD_MAX_AGE_MS = PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Le mot de passe est-il expiré ?
 * @param changedAt date du dernier changement (null/undefined = jamais => expiré)
 */
export function isPasswordExpired(changedAt: Date | string | null | undefined): boolean {
  if (!changedAt) return true; // jamais changé => expiré
  const t = new Date(changedAt).getTime();
  if (!Number.isFinite(t)) return true; // valeur invalide => par prudence, expiré
  return Date.now() - t >= PASSWORD_MAX_AGE_MS;
}

/** Nombre de jours restants avant expiration (0 = expiré aujourd'hui / déjà expiré). */
export function daysUntilExpiry(changedAt: Date | string | null | undefined): number {
  if (!changedAt) return 0;
  const t = new Date(changedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const restantMs = t + PASSWORD_MAX_AGE_MS - Date.now();
  return Math.max(0, Math.floor(restantMs / (24 * 60 * 60 * 1000)));
}

/* ==================================================================
 * NOUVEAU — POLITIQUE DE COMPLEXITÉ (TOUS les mots de passe)
 * ==================================================================
 * Règle OBLIGATOIRE appliquée partout — création d'un compte RH/IT par le
 * superadministrateur, changement de mot de passe, réinitialisation,
 * première connexion du portail employés :
 *   - 8 caractères minimum ;
 *   - au moins une lettre minuscule (a-z) ;
 *   - au moins une lettre majuscule (A-Z) ;
 *   - au moins un chiffre (0-9) ;
 *   - au moins un symbole (ex. ! @ # $ % * + = ?).
 * Les scripts JS autonomes (portail, superadmin)
 * dupliquent volontairement ces mêmes regex : ils ne peuvent pas
 * importer ce module TypeScript.
 */

/** Longueur minimale obligatoire. */
export const MOT_DE_PASSE_MIN_LONGUEUR = 8;

/** Règle affichable dans les interfaces et les e-mails. */
export const MESSAGE_POLITIQUE_MOT_DE_PASSE =
  "8 caractères minimum, avec au moins une minuscule, une majuscule, un chiffre et un symbole (ex. !@#$%*+=?)";

/** Liste des règles NON satisfaites (tableau vide = mot de passe conforme). */
export function erreursPolitiqueMotDePasse(mdp: string): string[] {
  const erreurs: string[] = [];
  if (!mdp || mdp.length < MOT_DE_PASSE_MIN_LONGUEUR) {
    erreurs.push("au moins 8 caractères");
  }
  if (!/[a-z]/.test(mdp)) erreurs.push("une lettre minuscule (a-z)");
  if (!/[A-Z]/.test(mdp)) erreurs.push("une lettre majuscule (A-Z)");
  if (!/[0-9]/.test(mdp)) erreurs.push("un chiffre (0-9)");
  if (!/[^A-Za-z0-9]/.test(mdp)) erreurs.push("un symbole (ex. !@#$%*+=?)");
  return erreurs;
}

/** Le mot de passe satisfait-il toute la politique de complexité ? */
export function motDePasseConforme(mdp: string): boolean {
  return erreursPolitiqueMotDePasse(mdp).length === 0;
}

/** Message d'erreur complet à renvoyer à l'interface, ou null si conforme. */
export function erreurPolitiqueMotDePasse(mdp: string): string | null {
  const erreurs = erreursPolitiqueMotDePasse(mdp);
  if (erreurs.length === 0) return null;
  return "Le mot de passe n'est pas assez fort : il doit contenir " + erreurs.join(", ") + ".";
}
