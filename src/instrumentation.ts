/**
 * ============================================================================
 *  NOUVEAU (v0.2.129 — demande utilisateur) — BALAYAGE AUTOMATIQUE DES
 *  COMPTES « MOT DE PASSE INITIAL EXPIRÉ »
 * ============================================================================
 *
 *  Demande : « Si le délai de 15 minutes expire sans activation du compte,
 *  celui-ci doit être automatiquement désactivé… Le système doit appliquer
 *  automatiquement ces règles, sans intervention manuelle pour la
 *  désactivation à l'expiration du délai. »
 *
 *  Next.js charge ce fichier UNE FOIS par processus serveur (register()).
 *  Toutes les 30 secondes, tout compte IT/RH dont le mot de passe initial
 *  (passwordExpiresAt) est dépassé SANS avoir été activé est désactivé
 *  (isActive=false) : son ancien mot de passe n'est plus accepté, et le
 *  SuperAdmin devra le RÉACTIVER (nouveau mot de passe initial unique envoyé
 *  par e-mail, valide 15 minutes).
 *
 *  Garde-fous :
 *   - un compte ACTIVÉ (passwordExpiresAt nettoyé à la première connexion)
 *     n'est JAMAIS touché ;
 *   - un compte sans expiration courte (superadmin, comptes historiques)
 *     n'est JAMAIS touché ;
 *   - le balayage n'est JAMAIS bloquant : toute erreur est journalisée et
 *     le processus serveur continue ;
 *   - garde en double-Serveur (administration 4000 + portail 4001) : le
 *     verrou globalThis évite deux balayages concurrents dans le process,
 *     et l'opération est idempotente (update conditionnel sur isActive).
 * ============================================================================
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const globalBalayage = globalThis as typeof globalThis & {
    __servicerhBalayageInitialDemarre?: boolean;
  };
  if (globalBalayage.__servicerhBalayageInitialDemarre) return;
  globalBalayage.__servicerhBalayageInitialDemarre = true;

  const { db } = await import("@/lib/db");
  const { journalAuth } = await import("@/lib/auth-journal");

  const PERIODE_MS = 30 * 1000; // toutes les 30 secondes

  async function balayer(): Promise<void> {
    try {
      const maintenant = new Date();
      const expires = await db.user.findMany({
        where: {
          isActive: true,
          passwordExpiresAt: { not: null, lte: maintenant },
        },
        select: { id: true, email: true, role: true },
      });
      for (const compte of expires) {
        // update CONDITIONNEL : ne désactive que si toujours actif (idempotent)
        const maj = await db.user.updateMany({
          where: { id: compte.id, isActive: true },
          data: { isActive: false },
        });
        if (maj.count > 0) {
          await journalAuth({
            evenement: "desactivation-automatique",
            ip: "systeme",
            email: compte.email,
            role: compte.role,
            detail:
              "Délai d'activation de 15 minutes dépassé sans connexion — compte désactivé automatiquement (v0.2.129)",
          });
          console.warn(
            `[BALAYAGE v0.2.129] Compte désactivé automatiquement (délai d'activation expiré) : ${compte.email}`
          );
        }
      }
    } catch (e) {
      // JAMAIS bloquant : le serveur continue quoi qu'il arrive.
      console.error("[BALAYAGE v0.2.129] échec du balayage :", e);
    }
  }

  // Premier balayage peu après le démarrage, puis périodique.
  setTimeout(() => {
    void balayer();
  }, 5_000);
  const minuterie = setInterval(() => {
    void balayer();
  }, PERIODE_MS);
  // ne maintient PAS le processus en vie uniquement pour le balayage
  if (typeof minuterie.unref === "function") minuterie.unref();
}
