/**
 * ============================================================================
 *  NOUVEAU (Task 208 — « Logs : pas de journalisation des échecs d'auth »)
 *  JOURNAL DE SÉCURITÉ DES AUTHENTIFICATIONS
 * ============================================================================
 *
 *  Écrit chaque événement d'authentification notable dans
 *  logs/auth-securite.log (JSON Lines, 1 événement par ligne) :
 *    - echec        : mauvais email ou mauvais mot de passe (401)
 *    - verrouille   : anti force-brute déclenché (429, fenêtre Task 94)
 *    - desactive    : compte désactivé (403)
 *    - succes       : connexion réussie (rôle en clair, JAMAIS le mot de passe)
 *
 *  Principes :
 *    - JAMAIS BLOQUANT : toute erreur d'écriture (disque, droits) est
 *      avalée et journalisée en console — la connexion continue ;
 *    - aucune donnée sensible : email tenté en clair (nécessaire pour
 *      l'analyse d'attaque), mot de passe JAMAIS ;
 *    - format JSON Lines : exploitable par grep/journalctl/SIEM ;
 *    - en mémoire du processus : aucun impact sur la latence perçue
 *      (écriture asynchrone fs.appendFile).
 * ============================================================================
 */
import "server-only";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

export type EvenementAuth =
  | "echec"
  | "verrouille"
  | "desactive"
  | "succes"
  // NOUVEAU (v0.2.129) : compte IT/RH désactivé AUTOMATIQUEMENT — délai de
  // 15 minutes pour activer le compte avec le mot de passe initial dépassé.
  | "desactivation-automatique"
  // NOUVEAU (v0.2.129) : réactivation d'un compte expiré par le SuperAdmin
  // (génération d'un NOUVEAU mot de passe initial + e-mail).
  | "reactivation";

// (Task 208) le server.js standalone de Next force process.chdir(__dirname)
// (→ .next/standalone) : le journal doit être ancré sur la RACINE du projet
// (AUTO_RH_ROOT, posée en absolu par scripts/start-prod.js), pas sur le cwd.
const RACINE = process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT || process.cwd();
const DOSSIER_LOGS = path.join(RACINE, "logs");
const FICHIER = path.join(DOSSIER_LOGS, "auth-securite.log");

export async function journalAuth(entree: {
  evenement: EvenementAuth;
  ip: string;
  email?: string;
  role?: string;
  detail?: string;
}): Promise<void> {
  try {
    const ligne =
      JSON.stringify({
        horodatage: new Date().toISOString(),
        evenement: entree.evenement,
        ip: entree.ip,
        ...(entree.email ? { email: entree.email.slice(0, 200) } : {}),
        ...(entree.role ? { role: entree.role } : {}),
        ...(entree.detail ? { detail: entree.detail.slice(0, 300) } : {}),
      }) + "\n";
    await mkdir(DOSSIER_LOGS, { recursive: true });
    await appendFile(FICHIER, ligne, "utf8");
  } catch (e) {
    // jamais bloquant — la sécurité de la connexion ne dépend pas du journal
    console.warn(
      "[AUTH-JOURNAL] écriture impossible:",
      e instanceof Error ? e.message : e
    );
  }
}
