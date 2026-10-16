/**
 * GET  /api/users — liste des comptes utilisateurs.
 * POST /api/users — NOUVEAU (Task 172) : création d'un compte RH ou IT par le
 *                   superadministrateur (« Gestion des rôles et des permissions »).
 *
 * GET (MODIFIÉ Task 173 — « Permissions du rôle IT ») : réservé au rôle IT
 * (Informatique) ET au superadministrateur — l'IT CONSULTE la liste des
 * utilisateurs, mais ne peut plus rien modifier : ni création, ni
 * activation/désactivation, ni suppression, ni changement de rôle ou de
 * permissions (PATCH/DELETE/POST ci-dessous et routes dédiées sont
 * superadministrateur uniquement). Le RH n'a AUCUN accès à cette liste.
 *
 * POST (NOUVEAU Task 172, confirmé Task 173) : RÉSERVÉ AU SUPERADMINISTRATEUR
 * — crée un compte RH ou IT directement depuis l'onglet « Utilisateurs »
 * (nom, e-mail, mot de passe, rôle). Le rôle IT ne peut PAS créer de comptes
 * (et surtout pas de comptes RH). Garde-fous :
 * - rôle attribuable : « RH » ou « IT » uniquement (les comptes
 *   superadministrateurs restent créés par le script CREER-SUPERADMIN) ;
 * - e-mail unique (contrôle explicite avant création) ;
 * - politique de complexité du mot de passe (8 caractères min., minuscule +
 *   majuscule + chiffre + symbole — src/lib/password-policy.ts) ;
 * - passwordChangedAt = ANTIDATÉ (au-delà des 15 jours) → le mot de passe
 *   initial est PROVISOIRE : changement OBLIGATOIRE à la première connexion
 *   (session mustChangePassword=true — écran non contournable).
 *
 * NOUVEAU (v0.2.106 — demande utilisateur, point 1) : un E-MAIL AUTOMATIQUE
 * est envoyé au compte nouvellement créé (identifiant + mot de passe initial
 * + adresse d'accès + obligation de changement à la première connexion).
 * L'envoi est JAMAIS bloquant : en cas d'échec (SMTP non configuré, serveur
 * indisponible…), le compte est QUAND MÊME créé et la réponse porte l'état
 * exact `emailInitial` pour que l'interface affiche l'information (l'invitant
 * alors à communiquer les identifiants manuellement). Chaque tentative est
 * journalisée (action "compte-cree", sans aucun secret dans le journal).
 *
 * NOUVEAU (v0.2.129 — demande utilisateur) : VALIDITÉ DE 15 MINUTES du mot
 * de passe initial des comptes IT/RH :
 *   - passwordExpiresAt = now + 15 min ; activatedAt = null (non activé) ;
 *   - sans connexion dans le délai => désactivation AUTOMATIQUE (balayage
 *     src/instrumentation.ts + contrôle paresseux au login) ; l'ancien mot
 *     de passe n'est plus accepté ; réactivation = SuperAdmin seul, avec un
 *     NOUVEAU mot de passe unique envoyé par e-mail (route /reactiver) ;
 *   - le mot de passe initial est enregistré dans l'HISTORIQUE
 *     (PasswordHistory) : il ne pourra JAMAIS être réattribué à ce compte.
 *
 * NOUVEAU (v0.2.129 — demande utilisateur) : CASE À COCHER « Manager » et
 * LISTE DÉROULANTE « Manager responsable » — le compte créé peut être marqué
 * « Manager » (il apparaîtra automatiquement dans la liste déroulante des
 * managers des prochains comptes) et se voir attribuer un manager responsable
 * choisi parmi les comptes « Manager » actifs.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  estSuperadmin,
  forbiddenSuperadmin,
  hashPassword,
  motDePasseExpire,
  forbidden,
  getSessionUser,
  unauthorized,
} from "@/lib/auth";
import { erreurPolitiqueMotDePasse, PASSWORD_MAX_AGE_DAYS } from "@/lib/password-policy";
// NOUVEAU (v0.2.129) : validité 15 min du mot de passe initial + statut d'activation
import {
  expirationInitialeDepuisMaintenant,
  statutActivation,
} from "@/lib/mot-de-passe-initial";
import {
  envoyerEmailCreationCompte,
  journaliserEnvoi,
  lireConfigMail,
  ErreurMail,
} from "@/lib/mailer";

export const runtime = "nodejs";

const ROLES_CREATABLES = ["RH", "IT"] as const;

export async function GET() {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, TOUS les comptes :
  // seul le changement de mot de passe reste autorisé, toute autre API répond 403.
  if (me.mustChangePassword) return motDePasseExpire();
  // (MODIFIÉ Task 34) IT conservé (non-suppressif) + SUPERADMIN autorisé
  if (me.role !== "IT" && !estSuperadmin(me)) return forbidden();

  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      // NOUVEAU (v0.2.129) : suivi d'activation + Manager
      passwordExpiresAt: true,
      activatedAt: true,
      isManager: true,
      managerId: true,
      manager: { select: { id: true, name: true, email: true } },
    },
  });
  // NOUVEAU (v0.2.129) : statut d'activation calculé CÔTÉ SERVEUR (source de
  // vérité) — « actif » | « attente » | « expire » | « desactive ».
  const usersAvecStatut = users.map((u) => ({
    ...u,
    statutActivation: statutActivation(u),
  }));
  return NextResponse.json({ users: usersAvecStatut, meId: me.id });
}

/** NOUVEAU (Task 172) : création d'un compte RH/IT — superadministrateur uniquement. */
export async function POST(request: NextRequest) {
  const me = await getSessionUser();
  if (!me) return unauthorized();
  if (me.mustChangePassword) return motDePasseExpire();
  if (!estSuperadmin(me)) {
    return forbiddenSuperadmin();
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const role = String(body?.role ?? "").trim().toUpperCase();

  if (!name || name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "Nom invalide : 2 à 80 caractères requis." },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    return NextResponse.json(
      { error: "Adresse e-mail invalide." },
      { status: 400 }
    );
  }
  if (!(ROLES_CREATABLES as readonly string[]).includes(role)) {
    return NextResponse.json(
      { error: "Rôle invalide : choisissez « RH » ou « IT ». Les comptes superadministrateurs sont créés via CREER-SUPERADMIN-WINDOWS.bat." },
      { status: 400 }
    );
  }
  const erreurPolitique = erreurPolitiqueMotDePasse(password);
  if (erreurPolitique) {
    return NextResponse.json({ error: erreurPolitique }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json(
      { error: "Mot de passe trop long (200 caractères maximum)." },
      { status: 400 }
    );
  }

  const existant = await db.user.findUnique({ where: { email } });
  if (existant) {
    return NextResponse.json(
      { error: "Un compte existe déjà avec cette adresse e-mail." },
      { status: 409 }
    );
  }

  // NOUVEAU (v0.2.129 — demande utilisateur) : case à cocher « Manager » +
  // liste déroulante « Manager responsable ».
  const isManager = Boolean(body?.isManager);
  const managerIdBrut = String(body?.managerId ?? "").trim();
  let managerId: string | null = null;
  if (managerIdBrut) {
    const manager = await db.user.findUnique({ where: { id: managerIdBrut } });
    if (!manager || !manager.isActive) {
      return NextResponse.json(
        { error: "Manager responsable introuvable ou désactivé." },
        { status: 400 }
      );
    }
    managerId = manager.id;
  }

  const passwordHashInitial = hashPassword(password);
  const estCompteInitial = role === "IT" || role === "RH";
  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: passwordHashInitial,
      role,
      isActive: true,
      // (MODIFIÉ — demande utilisateur, point 1) : pour un compte IT ou RH, le
      // mot de passe fixé par le SuperAdmin est PROVISOIRE — OBLIGATOIREMENT
      // changé à la première connexion. Mécanisme : passwordChangedAt est
      // ANTIDATÉ au-delà des 15 jours de la politique Task 64 → la session
      // porte mustChangePassword=true dès le premier login (écran de
      // changement NON CONTOURNABLE, session 15 min, toutes les autres API
      // répondent 403 tant que le nouveau mot de passe n'est pas défini).
      passwordChangedAt: estCompteInitial
        ? new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000)
        : new Date(),
      // NOUVEAU (v0.2.129) : VALIDITÉ DE 15 MINUTES du mot de passe initial
      // (IT/RH) — compte créé NON ACTIVÉ (activatedAt=null) : il doit être
      // activé (première connexion) dans les 15 minutes, sinon désactivation
      // automatique. Les comptes superadmin (script CREER-SUPERADMIN) ne
      // sont PAS concernés par cette expiration courte.
      passwordExpiresAt: estCompteInitial ? expirationInitialeDepuisMaintenant() : null,
      activatedAt: null,
      // NOUVEAU (v0.2.129 — demande utilisateur) : case à cocher « Manager »
      // + manager responsable choisi dans la liste déroulante.
      isManager,
      managerId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      isManager: true,
      managerId: true,
    },
  });

  // NOUVEAU (v0.2.129) : le mot de passe initial entre dans l'HISTORIQUE du
  // compte — aucun mot de passe déjà attribué ne pourra être réutilisé
  // (unicité vérifiée à chaque réattribution).
  await db.passwordHistory.create({
    data: { userId: user.id, hash: passwordHashInitial },
  });

  // ------------------------------------------------------------------
  // NOUVEAU (v0.2.106 — demande utilisateur, point 1) : E-MAIL AUTOMATIQUE
  // au compte créé — identifiant, mot de passe initial (celui saisi ci-
  // dessus par le superadministrateur), adresse d'accès au site
  // d'administration et obligation de changement à la première connexion.
  // JAMAIS bloquant : le compte reste créé quel que soit le résultat.
  // ------------------------------------------------------------------
  const roleLabel = role === "IT" ? "Informatique (IT)" : "RH";
  let hote = String(request.headers.get("host") ?? "").trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(hote)) hote = "localhost:4000";
  const urlAdministration = `http://${hote}`;
  let emailInitial: Record<string, unknown>;
  // (Task 221) adresse d'expédition réellement utilisée (renvoyée par le
  // mailer : l'adresse du service informatique configurée, sinon repli) —
  // affichée au superadministrateur dans le message de confirmation.
  let expediteurUtilise = "";
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
  try {
    const { messageId, from, response } = await envoyerEmailCreationCompte(email, {
      nomComplet: name,
      roleLabel,
      identifiant: email,
      motDePasseInitial: password,
      urlAdministration,
    });
    expediteurUtilise = from;
    journaliserEnvoi({
      action: "compte-cree",
      dest: email,
      from,
      host: cfgHost,
      port: cfgPort,
      secure: cfgSecure,
      succes: true,
      messageId,
      reponseSmtp: response,
    });
    emailInitial = { envoye: true, destinataire: email, urlAdministration };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    journaliserEnvoi({
      action: "compte-cree",
      dest: email,
      from: "",
      host: cfgHost,
      port: cfgPort,
      secure: cfgSecure,
      succes: false,
      code: e instanceof ErreurMail ? "MAIL_NON_CONFIGURE" : "SMTP_ECHEC",
      erreur: detail,
    });
    emailInitial = { envoye: false, destinataire: email, erreur: detail };
  }

  return NextResponse.json({
    user,
    emailInitial,
    message:
      `Compte ${role === "IT" ? "informatique (IT)" : "RH"} créé pour ${user.name} (${user.email}). ` +
      (emailInitial.envoye
        ? `Un e-mail avec l'identifiant et le mot de passe initial a été envoyé automatiquement à ${user.email} DEPUIS L'ADRESSE DU SERVICE INFORMATIQUE CONFIGURÉE (${expediteurUtilise}) — le mot de passe initial est valable 15 MINUTES : passé ce délai sans connexion, le compte sera automatiquement désactivé.`
        : `ATTENTION : l'e-mail d'identification n'a PAS pu être envoyé — communiquez manuellement à ${user.email} son identifiant, son mot de passe initial et l'adresse ${urlAdministration}. Le mot de passe initial est valable 15 MINUTES à compter de maintenant ; changement de mot de passe OBLIGATOIRE à la première connexion.`),
  });
}
