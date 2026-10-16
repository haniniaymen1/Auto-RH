/**
 * Authentification AutoRH — accès réservé aux utilisateurs autorisés (RH / IT).
 *
 * - Mots de passe hachés avec scrypt (crypto natif Node, aucune dépendance).
 * - Session = cookie httpOnly signé (HMAC-SHA256) contenant l'utilisateur + expiration.
 * - Chaque requête API revalide la session ET l'état du compte en base
 *   (un compte désactivé est déconnecté immédiatement).
 *
 * Variables d'environnement (.env) :
 *   AUTH_SECRET  clé de signature des sessions (générée par les scripts de démarrage)
 *
 * (MODIFIÉ Task 173) : l'inscription par code d'activation (SIGNUP_CODE) est
 * SUPPRIMÉE — les comptes RH/IT sont créés exclusivement par le
 * superadministrateur depuis l'onglet « Utilisateurs » de l'administration.
 */
import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
// NOUVEAU (Task 64) : politique d'expiration des mots de passe (15 jours)
import { isPasswordExpired } from "@/lib/password-policy";

export const SESSION_COOKIE = "auto_rh_session";
export const ROLES = ["RH", "IT"] as const;
export type Role = (typeof ROLES)[number];

// NOUVEAU (Task 34) : rôle SUPERADMINISTRATEUR — niveau au-dessus de RH/IT.
// Un compte superadmin ne peut être créé que par le script
// scripts/creer-superadmin.js (ou le .bat CREER-SUPERADMIN-WINDOWS.bat) :
// JAMAIS par l'inscription publique (ROLES ci-dessus reste limité à RH/IT).
export const TOUS_ROLES = ["RH", "IT", "SUPERADMIN"] as const;
export type TousRoles = (typeof TOUS_ROLES)[number];

/** NOUVEAU (Task 34) : le compte est-il superadministrateur ? */
export function estSuperadmin(u: { role: string } | null | undefined): boolean {
  return u?.role === "SUPERADMIN";
}

/** NOUVEAU (Task 34) : IT ou superadministrateur (gestion des comptes). */
export function peutGererUtilisateurs(u: { role: string } | null | undefined): boolean {
  return u?.role === "IT" || u?.role === "SUPERADMIN";
}

/* ------------------------------------------------------------------ */
/* NOUVEAU (Task 172) : MATRICE DES RÔLES ET PERMISSIONS               */
/*                                                                     */
/* Demande administrateur — « Gestion des rôles et des permissions » :  */
/*  • SUPERADMIN : tous les droits — gestion complète des comptes RH    */
/*    et IT (créer, supprimer, activer/désactiver, changer le rôle,     */
/*    réinitialiser les accès) et de tous les paramètres ;              */
/*  • IT : droits LIMITÉS — pas de recherche par CIN, pas d'accès à     */
/*    la liste « Toutes les fiches », pas d'import de fiches, pas de    */
/*    création ni de gestion des accès employés du portail, et ne peut  */
/*    pas créer de comptes RH (gestion des comptes limitée au rôle IT). */
/*  • RH : fonctionnalités métier de la paie (recherche, consultation,  */
/*    import, accès portail, demandes).                                 */
/*                                                                     */
/* Toute restriction est appliquée CÔTÉ SERVEUR (les API répondent 403) */
/* et doublée côté interface (onglets masqués, boutons désactivés).     */
/* ------------------------------------------------------------------ */

/** Rôle autorisé à consulter / rechercher les fiches ? (RH + superadministrateur) */
export function peutConsulterFiches(u: { role: string } | null | undefined): boolean {
  return u?.role === "RH" || u?.role === "SUPERADMIN";
}

/** Rôle autorisé à importer des fiches de paie ? (RH + superadministrateur) */
export function peutImporterFiches(u: { role: string } | null | undefined): boolean {
  return u?.role === "RH" || u?.role === "SUPERADMIN";
}

/** Rôle autorisé à créer / gérer les accès employés du portail ? (RH + superadministrateur) */
export function peutGererAccesPortail(u: { role: string } | null | undefined): boolean {
  return u?.role === "RH" || u?.role === "SUPERADMIN";
}

/**
 * NOUVEAU (Task 172) : réponse 403 dédiée quand le rôle IT tente une
 * fonctionnalité qui ne lui est pas autorisée. Message explicite pour
 * l'interface ; le paramètre `reserveA` permet d'ajuster le destinataire
 * (par défaut : RH + superadministrateur ; pour la configuration SMTP :
 * superadministrateur uniquement).
 */
export function refusIT(fonctionnalite: string, reserveA = "aux rôles RH et superadministrateur") {
  return Response.json(
    {
      error:
        `Accès refusé : ${fonctionnalite} n'est pas autorisé pour le rôle IT (Informatique) — ` +
        `fonctionnalité réservée ${reserveA}.`,
      code: "FONCTIONNALITE_NON_AUTORISEE_IT",
    },
    { status: 403 }
  );
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: TousRoles; // (MODIFIÉ Task 34 : inclut SUPERADMIN)
  // NOUVEAU (Task 64) : true = mot de passe EXPIRÉ (politique 15 jours) →
  // l'interface force l'écran de changement et les API de données répondent 403.
  mustChangePassword?: boolean;
}

/** Durées de session (secondes). */
const DAY = 60 * 60 * 24;
export const MAX_AGE_SHORT = DAY; // session classique : 1 jour
export const MAX_AGE_LONG = 30 * DAY; // « Se souvenir de moi » : 30 jours
// NOUVEAU (Task 64) : durée de la session « changement de mot de passe requis ».
// Une session dont le mot de passe est expiré ne reste ouverte que 15 minutes :
// le temps de choisir un nouveau mot de passe (ou de se déconnecter).
export const MAX_AGE_MOT_DE_PASSE_EXPIRE = 15 * 60;

/**
 * Clé de signature : variable d'env AUTH_SECRET.
 *
 * (CORRECTIF SÉCURITÉ — Task 94) : l'ancien repli en dur
 * « autorh-secret-local-a-changer-dans-env » est SUPPRIMÉ. Cette valeur
 * étant publique (elle figurait dans le code source et l'archive livrée),
 * quiconque lançait le site sans AUTH_SECRET permettait de FORGER des
 * cookies de session (admin et portail) — contournement total de l'auth.
 * Désormais, sans AUTH_SECRET, un secret ALÉATOIRE est généré pour la durée
 * du processus : personne ne peut forger de session (échec fermé). Les
 * sessions sont simplement invalidées à chaque redémarrage tant que le
 * secret n'est pas défini — scripts/start-prod.js génère désormais
 * AUTOMATIQUEMENT AUTH_SECRET dans .env pour un secret stable.
 */
let secretAuSecours: string | null = null;
let avertiSecretManquant = false;
function authSecret(): string {
  const env = process.env.AUTH_SECRET?.trim();
  if (env) return env;
  if (!avertiSecretManquant) {
    avertiSecretManquant = true;
    console.warn(
      "[SÉCURITÉ] AUTH_SECRET absent du fichier .env : un secret ALÉATOIRE est utilisé " +
        "pour signer les sessions (les connexions seront invalidées à chaque redémarrage). " +
        "Redémarrez le site une fois via le lanceur habituel (DEMARRER-*.bat/.sh) : " +
        "il génère et enregistre AUTH_SECRET automatiquement."
    );
  }
  if (!secretAuSecours) {
    secretAuSecours = crypto.randomBytes(48).toString("base64url");
  }
  return secretAuSecours;
}

/* ------------------------------------------------------------------ */
/* Mots de passe (scrypt natif)                                        */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Jetons de session signés (HMAC-SHA256)                              */
/* ------------------------------------------------------------------ */

interface TokenPayload extends SessionUser {
  exp: number; // expiration en secondes epoch
  // (CORRECTIF SÉCURITÉ — Task 94) VERSION DE SESSION : horodatage (ms) du
  // dernier changement de mot de passe AU MOMENT de l'émission du jeton.
  // Chaque requête le compare à la valeur ACTUELLE de la base : un changement
  // ou une réinitialisation du mot de passe invalide IMMÉDIATEMENT toutes les
  // sessions émises avant (vol de cookie, ex-employé, réinitialisation RH/IT).
  pwv?: number;
}

/** Version de session dérivée de la date de dernier changement de mot de passe. */
function versionMotDePasse(date: Date | null | undefined): number {
  return date instanceof Date ? date.getTime() : 0;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function createSessionToken(
  user: SessionUser,
  maxAge: number,
  pwv?: number
): string {
  const payload: TokenPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + maxAge,
    pwv: typeof pwv === "number" ? pwv : undefined,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined | null
): (SessionUser & { pwv: number }) | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    // (CORRECTIF SÉCURITÉ — Task 94) les jetons SANS version de session
    // (émis avant le correctif) sont refusés : tout le monde se reconnecte
    // une seule fois après la mise à jour, les sessions potentiellement
    // compromises disparaissent.
    if (typeof payload.pwv !== "number") return null;
    // (MODIFIÉ Task 34) les sessions « RH » et « IT » historiques restent valides ;
    // le rôle SUPERADMIN est désormais accepté à l'identique.
    if (!(TOUS_ROLES as readonly string[]).includes(payload.role)) return null;
    return {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      pwv: payload.pwv,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Session côté serveur (API routes)                                   */
/* ------------------------------------------------------------------ */

/**
 * Retourne l'utilisateur connecté, ou null.
 * Revalide à chaque appel : signature, expiration, existence ET activation en base.
 * NOUVEAU (Task 64) : calcule AUSSI en temps réel l'expiration du mot de passe
 * (politique 15 jours, TOUS les comptes : RH, IT, superadministrateur).
 * Tant que le mot de passe n'est pas changé, mustChangePassword reste true —
 * même sur une session « Se souvenir de moi » déjà ouverte.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const session = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  // Le compte doit toujours exister et rester actif en base
  const dbUser = await db.user.findUnique({ where: { id: session.id } });
  if (!dbUser || !dbUser.isActive) return null;

  // (CORRECTIF SÉCURITÉ — Task 94) RÉVOCATION DES SESSIONS ANCIENNES :
  // le jeton doit porter EXACTEMENT la version de session actuelle du compte
  // (horodatage du dernier changement de mot de passe). Un changement ou une
  // réinitialisation de mot de passe déconnecte immédiatement toutes les
  // sessions émises avant — y compris « Se souvenir de moi » (30 jours).
  if (session.pwv !== versionMotDePasse(dbUser.passwordChangedAt)) return null;

  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role as TousRoles,
    // NOUVEAU (Task 64) : expiration recalculée EN TEMPS RÉEL depuis la base —
    // aucune session ne peut contourner l'expiration des 15 jours.
    mustChangePassword: isPasswordExpired(dbUser.passwordChangedAt),
  };
}

/** Réponse 401 standard pour les API protégées. */
export function unauthorized() {
  return Response.json(
    { error: "Accès refusé : veuillez vous connecter." },
    { status: 401 }
  );
}

/**
 * NOUVEAU (Task 64) : réponse 403 standard quand le mot de passe est expiré.
 * Insérée dans TOUTES les API de données : tant que l'utilisateur n'a pas
 * changé son mot de passe expiré, rien d'autre n'est accessible.
 */
export function motDePasseExpire() {
  return Response.json(
    {
      error:
        "Votre mot de passe a expiré (politique de sécurité : changement tous les 15 jours). Changez votre mot de passe pour continuer.",
      code: "MOT_DE_PASSE_EXPIRE",
    },
    { status: 403 }
  );
}

/** Réponse 403 standard (session valide mais rôle insuffisant). */
export function forbidden() {
  return Response.json(
    { error: "Accès réservé aux informaticiens." },
    { status: 403 }
  );
}

/** NOUVEAU (Task 34) : 403 pour les actions réservées au superadministrateur. */
export function forbiddenSuperadmin() {
  return Response.json(
    { error: "Accès réservé au superadministrateur." },
    { status: 403 }
  );
}
