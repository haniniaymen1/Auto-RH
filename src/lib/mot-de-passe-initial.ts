/**
 * ============================================================================
 *  NOUVEAU (v0.2.129 — demande utilisateur) — MOT DE PASSE INITIAL DES
 *  COMPTES IT/RH : VALIDITÉ DE 15 MINUTES + UNICITÉ ABSOLUE
 * ============================================================================
 *
 *  Règles demandées (appliquées automatiquement, sans intervention manuelle) :
 *   1. Lorsqu'un SuperAdmin crée un compte IT ou RH, un e-mail contenant le
 *      mot de passe initial est envoyé à l'utilisateur.
 *   2. Le mot de passe initial est valide 15 minutes MAXIMUM à compter de
 *      l'envoi de l'e-mail (DUREE_VALIDITE_MDP_INITIAL_MS).
 *   3. Si le délai expire sans activation du compte (première connexion), le
 *      compte est AUTOMATIQUEMENT désactivé — balayage périodique
 *      (src/instrumentation.ts) + contrôle paresseux au login — et l'ancien
 *      mot de passe n'est plus accepté.
 *   4. Le compte ne peut être réactivé qu'après une intervention du
 *      SuperAdmin, qui déclenche l'envoi d'un NOUVEAU mot de passe initial
 *      (route POST /api/users/[id]/reactiver).
 *   5. Le nouveau mot de passe est UNIQUE et DIFFÉRENT de tous les mots de
 *      passe précédemment attribués à ce compte (historique PasswordHistory) ;
 *      le SuperAdmin ne peut pas réutiliser un ancien mot de passe
 *      (contrôle dans genererMotDePasseUnique + routes d'attribution).
 *   6. Le nouveau mot de passe est envoyé par e-mail avec le même délai de
 *      15 minutes.
 * ============================================================================
 */
import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

/** Validité du mot de passe initial : 15 minutes, en millisecondes. */
export const DUREE_VALIDITE_MDP_INITIAL_MS = 15 * 60 * 1000;

/** Date d'expiration d'un mot de passe initial attribué MAINTENANT. */
export function expirationInitialeDepuisMaintenant(): Date {
  return new Date(Date.now() + DUREE_VALIDITE_MDP_INITIAL_MS);
}

/* ------------------------------------------------------------------ */
/* Génération d'un mot de passe conforme à la politique de complexité  */
/* (8 caractères min., minuscule + majuscule + chiffre + symbole)      */
/* ------------------------------------------------------------------ */

const ALPHABETS = {
  minuscules: "abcdefghijkmnopqrstuvwxyz",
  majuscules: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  chiffres: "23456789",
  symboles: "!@#$%*+=?",
};

/**
 * Génère un mot de passe ALÉATOIRE (crypto sécurisé) conforme à la politique
 * de complexité : 12 caractères garantissant au moins une minuscule, une
 * majuscule, un chiffre et un symbole (caractères ambigus exclus : l, I, O, 0, 1).
 */
export function genererMotDePasse(longueur = 12): string {
  const tous = Object.values(ALPHABETS).join("");
  const tire = (alphabet: string): string =>
    alphabet[crypto.randomInt(0, alphabet.length)];
  // au moins un caractère de chaque classe requise
  const caracteres = [
    tire(ALPHABETS.minuscules),
    tire(ALPHABETS.majuscules),
    tire(ALPHABETS.chiffres),
    tire(ALPHABETS.symboles),
  ];
  for (let i = caracteres.length; i < longueur; i++) {
    caracteres.push(tire(tous));
  }
  // mélange Fisher-Yates cryptographique
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}

/* ------------------------------------------------------------------ */
/* UNICITÉ vs HISTORIQUE — « différent de tous les mots de passe       */
/* précédemment attribués à ce compte »                                */
/* ------------------------------------------------------------------ */

/**
 * Le mot de passe candidat est-il différent de TOUS les mots de passe
 * déjà attribués au compte (hash actuel + historique PasswordHistory) ?
 * Comparaison par VÉRIFICATION scrypt (et non égalité de chaînes) : deux
 * attributions du même mot de passe produisent des sels différents.
 */
export async function estMotDePasseInedit(
  candidat: string,
  userId: string
): Promise<boolean> {
  const utilisateur = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (utilisateur?.passwordHash && verifyPassword(candidat, utilisateur.passwordHash)) {
    return false; // = mot de passe ACTUEL du compte
  }
  const historique = await db.passwordHistory.findMany({
    where: { userId },
    select: { hash: true },
  });
  for (const entree of historique) {
    if (verifyPassword(candidat, entree.hash)) return false; // déjà attribué
  }
  return true;
}

/**
 * Génère un NOUVEAU mot de passe initial unique pour le compte :
 * différent de tous les mots de passe précédemment attribués (et de
 * l'actuel). Jusqu'à 60 tentatives (probabilité de collision négligeable).
 * Lève une erreur si l'unicité ne peut être garantie.
 */
export async function genererMotDePasseUnique(userId: string): Promise<string> {
  for (let tentative = 0; tentative < 60; tentative++) {
    const candidat = genererMotDePasse();
    if (await estMotDePasseInedit(candidat, userId)) return candidat;
  }
  throw new Error(
    "Impossible de générer un mot de passe inédit pour ce compte (historique saturé)."
  );
}

/* ------------------------------------------------------------------ */
/* STATUT D'ACTIVATION (affiché dans la liste des comptes)             */
/* ------------------------------------------------------------------ */

export type StatutActivation =
  | "actif" // mot de passe normal, compte actif
  | "attente" // mot de passe initial en cours de validité (pas encore activé)
  | "expire" // délai d'activation dépassé → désactivé automatiquement
  | "desactive"; // désactivé manuellement par le SuperAdmin

/**
 * Statut d'activation calculé côté serveur (source de vérité) :
 *   - isActive=false + expiration passée => « expire » (désactivé AUTOMATIQUEMENT
 *     — y compris le cas pas encore balayé mais expiré) ;
 *   - isActive=false sinon => « desactive » (désactivation manuelle) ;
 *   - passwordExpiresAt future => « attente » (expire dans < 15 min) ;
 *   - sinon => « actif ».
 */
export function statutActivation(u: {
  isActive: boolean;
  passwordExpiresAt: Date | string | null;
}): StatutActivation {
  const expiration = u.passwordExpiresAt
    ? new Date(u.passwordExpiresAt).getTime()
    : null;
  const expiree = expiration !== null && expiration <= Date.now();
  if (!u.isActive) return expiree ? "expire" : "desactive";
  if (expiration !== null) return expiree ? "expire" : "attente";
  return "actif";
}

/**
 * Le compte est-il dans l'état « mot de passe initial expiré » (désactivé
 * automatiquement) ? Utilisé pour INTERDIRE la simple réactivation manuelle
 * (le SuperAdmin doit passer par la réactivation avec NOUVEAU mot de passe).
 */
export function desactiveParExpiration(u: {
  isActive: boolean;
  passwordExpiresAt: Date | string | null;
}): boolean {
  return statutActivation(u) === "expire";
}
