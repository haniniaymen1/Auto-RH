/**
 * ============================================================================
 *  NOUVEAU (v0.2.129 — demande utilisateur) — RÉACTIVATION D'UN COMPTE IT/RH
 *  DONT LE DÉLAI D'ACTIVATION DE 15 MINUTES A EXPIRÉ
 * ============================================================================
 *  POST /api/users/[id]/reactiver — RÉSERVÉ AU SUPERADMINISTRATEUR.
 *
 *  « Le compte ne pourra être réactivé qu'après une intervention du
 *  SuperAdmin, qui devra permettre l'envoi d'un nouveau mot de passe initial. »
 *
 *  Ce que fait cette route :
 *   1. GÉNÈRE un NOUVEAU mot de passe initial ALÉATOIRE, UNIQUE et
 *      DIFFÉRENT de tous les mots de passe précédemment attribués à ce
 *      compte (vérification scrypt contre le hash actuel + l'historique
 *      PasswordHistory) — le SuperAdmin ne peut pas réutiliser un ancien
 *      mot de passe ;
 *   2. RÉACTIVE le compte (isActive=true) et repose une VALIDITÉ DE
 *      15 MINUTES (passwordExpiresAt = now + 15 min, activatedAt = null,
 *      passwordChangedAt antidaté → changement obligatoire à la connexion) ;
 *   3. ENREGISTRE le nouveau hash dans l'historique du compte ;
 *   4. ENVOIE le nouveau mot de passe par E-MAIL (même mécanisme que la
 *      création, mention « valable 15 minutes ») — envoi jamais bloquant,
 *      l'état exact est renvoyé à l'interface ;
 *   5. JOURNALISE l'opération (evenement "reactivation" + envoi "compte-reactive").
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  motDePasseExpire,
  estSuperadmin,
  forbiddenSuperadmin,
  getSessionUser,
  hashPassword,
  unauthorized,
} from "@/lib/auth";
import {
  expirationInitialeDepuisMaintenant,
  genererMotDePasseUnique,
} from "@/lib/mot-de-passe-initial";
import { PASSWORD_MAX_AGE_DAYS } from "@/lib/password-policy";
import {
  envoyerEmailReactivationCompte,
  journaliserEnvoi,
  lireConfigMail,
  ErreurMail,
} from "@/lib/mailer";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  if (me.mustChangePassword) return motDePasseExpire();
  if (!estSuperadmin(me)) return forbiddenSuperadmin();

  const { id } = await params;
  const cible = await db.user.findUnique({ where: { id } });
  if (!cible) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }
  // Seuls les comptes IT/RH sont soumis à la validité de 15 minutes ; les
  // comptes superadministrateurs ne sont jamais « expirés ».
  if (cible.role !== "IT" && cible.role !== "RH") {
    return NextResponse.json(
      {
        error:
          "La réactivation par nouveau mot de passe initial concerne uniquement les comptes RH et IT.",
      },
      { status: 400 }
    );
  }

  // 1) NOUVEAU mot de passe UNIQUE — différent de tous les précédents du compte.
  let motDePasse: string;
  try {
    motDePasse = await genererMotDePasseUnique(cible.id);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Génération du nouveau mot de passe impossible.",
      },
      { status: 500 }
    );
  }
  const nouveauHash = hashPassword(motDePasse);

  // 2) Réactivation + nouvelle validité de 15 minutes (compte NON activé).
  await db.user.update({
    where: { id: cible.id },
    data: {
      passwordHash: nouveauHash,
      isActive: true,
      passwordExpiresAt: expirationInitialeDepuisMaintenant(),
      activatedAt: null,
      passwordChangedAt: new Date(
        Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000
      ),
    },
  });

  // 3) Historique : le nouveau mot de passe ne pourra jamais être réattribué.
  await db.passwordHistory.create({
    data: { userId: cible.id, hash: nouveauHash },
  });

  // 4) E-MAIL automatique avec le nouveau mot de passe initial (valable 15 min).
  const roleLabel = cible.role === "IT" ? "Informatique (IT)" : "RH";
  let hote = String(request.headers.get("host") ?? "").trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(hote)) hote = "localhost:4000";
  const urlAdministration = `http://${hote}`;
  let cfgHost = "";
  let cfgPort = 0;
  let cfgSecure = false;
  try {
    const cfg = await lireConfigMail();
    cfgHost = cfg.host;
    cfgPort = cfg.port;
    cfgSecure = cfg.secure;
  } catch {
    // configuration illisible : journalisation quand même
  }
  let emailReactivation: Record<string, unknown>;
  let expediteurUtilise = "";
  try {
    const { messageId, from, response } = await envoyerEmailReactivationCompte(
      cible.email,
      {
        nomComplet: cible.name,
        roleLabel,
        identifiant: cible.email,
        motDePasseInitial: motDePasse,
        urlAdministration,
      }
    );
    expediteurUtilise = from;
    journaliserEnvoi({
      action: "compte-reactive",
      dest: cible.email,
      from,
      host: cfgHost,
      port: cfgPort,
      secure: cfgSecure,
      succes: true,
      messageId,
      reponseSmtp: response,
    });
    emailReactivation = { envoye: true, destinataire: cible.email, urlAdministration };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    journaliserEnvoi({
      action: "compte-reactive",
      dest: cible.email,
      from: "",
      host: cfgHost,
      port: cfgPort,
      secure: cfgSecure,
      succes: false,
      code: e instanceof ErreurMail ? "MAIL_NON_CONFIGURE" : "SMTP_ECHEC",
      erreur: detail,
    });
    emailReactivation = { envoye: false, destinataire: cible.email, erreur: detail };
  }

  // 5) Journal de sécurité (sans aucun secret).
  const { journalAuth } = await import("@/lib/auth-journal");
  await journalAuth({
    evenement: "reactivation",
    ip:
      (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() ||
      "local",
    email: cible.email,
    role: cible.role,
    detail: "Réactivation par le SuperAdmin — NOUVEAU mot de passe initial (valable 15 min) envoyé par e-mail (v0.2.129)",
  });

  return NextResponse.json({
    ok: true,
    emailReactivation,
    message:
      `Compte réactivé pour ${cible.name} (${cible.email}). ` +
      (emailReactivation.envoye
        ? `Un NOUVEAU mot de passe initial (unique, différent de tous les précédents) a été envoyé à ${cible.email} depuis ${expediteurUtilise} — valable 15 MINUTES : passé ce délai sans connexion, le compte sera de nouveau automatiquement désactivé.`
        : `ATTENTION : l'e-mail n'a PAS pu être envoyé (${String(emailReactivation.erreur ?? "")}) — communiquez manuellement le nouveau mot de passe à ${cible.email} ; il est valable 15 MINUTES.`),
  });
}
