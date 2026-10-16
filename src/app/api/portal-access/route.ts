/**
 * API de gestion des accès au PORTAIL EMPLOYÉS (MODIFIÉ Task 64).
 *
 * La connexion au portail se fait par CIN + MOT DE PASSE :
 *   1. le RH/IT crée l'accès → un MOT DE PASSE INITIAL est généré et affiché
 *      UNE SEULE fois à l'écran (à communiquer à l'employé) ;
 *   2. à sa première connexion, l'employé est OBLIGÉ de choisir son propre
 *      mot de passe (le mot de passe initial devient inutilisable) ;
 *   3. TOUS LES 15 JOURS, le portail oblige l'employé à changer son mot de
 *      passe (politique d'expiration appliquée à tous les utilisateurs) ;
 *   4. « Réinitialiser » regénère un nouveau mot de passe initial à usage
 *      unique (l'ancien mot de passe ne fonctionne plus, le changement
 *      obligatoire est re-déclenché).
 *
 * Sécurité des mots de passe : hachage scrypt (même schéma que les comptes
 * RH/IT — src/lib/auth.ts) PUIS chiffrement AES-256-GCM en base (champ
 * « passwordHash », carte alea de db-crypto — identique aux autres champs
 * sensibles). Le mot de passe initial en clair n'est JAMAIS stocké.
 *
 * GET  /api/portal-access            → liste des accès (SANS les mots de passe
 *                                      NI les secrets TOTP — seulement des booléens)
 * POST /api/portal-access            → actions :
 *      { action: "create", cin }     → crée l'accès + mot de passe initial (affiché 1 fois)
 *      { action: "reset", id }       → nouveau mot de passe initial (affiché 1 fois)
 *      { action: "toggle", id }      → active/désactive l'accès
 *      { action: "unlock", id }      → lève un verrouillage anti force-brute
 *      { action: "delete", id }      → supprime l'accès
 *      { action: "modifier-nom", cin, nom } → NOUVEAU (Task 173) : met à jour
 *                              le NOM ET PRÉNOM de l'employé (toutes les
 *                              fiches du même CIN + accès portail).
 *
 * NOUVEAU (Task 80) — SECTION « GESTION DES QR CODES » de l'onglet « Accès
 * portail » (demande utilisateur) :
 *      { action: "qr", id }          → QR code de l'employé (SVG + URI
 *                                      otpauth://totp/… standard) pour le faire
 *                                      scanner EN DIRECT par l'employé ; le
 *                                      secret TOTP persistant est créé à la
 *                                      volée s'il n'existe pas encore ;
 *      { action: "reset-qr", id }    → RÉINITIALISE le QR : NOUVEAU secret TOTP
 *                                      (l'ancienne application ne génère plus de
 *                                      codes valables), verrou d'affichage
 *                                      qrPresente repassé à false et fenêtre
 *                                      anti-rejeu effacée — retourne le nouveau
 *                                      QR (SVG + URI) pour re-scan immédiat.
 *      Le QR est au FORMAT STANDARD otpauth://totp/… (Task 78) : Google
 *      Authenticator, Microsoft Authenticator, Authy et FreeOTP savent le
 *      lire. Le SECRET ne quitte JAMAIS le serveur en clair dans la liste :
 *      il n'est embarqué QUE dans l'URI otpauth du QR demandé explicitement.
 *
 * NOUVEAU (Task 92) — SERVICE D'ENVOI D'E-MAILS « SEND MAIL » (demande
 * utilisateur : un bouton « Send Mail » pour CHAQUE utilisateur de la liste
 * « CIN – Accès Portail par mot de passe ») :
 *      { action: "send-mail", id, dest, reset? }
 *                        → envoie à `dest` un e-mail ALLÉGÉ (demande
 *                          utilisateur) contenant : MOT DE PASSE INITIAL et
 *                          adresse d'accès au portail. Le CIN, l'adresse IP
 *                          (ou nom DNS) du serveur et le port du site web ne
 *                          sont PLUS envoyés (l'employé connaît son CIN ;
 *                          l'URL contient le reste). Le mot de passe initial
 *                          provient de la
 *                          copie chiffrée `initialPasswordEnc` tant qu'il est
 *                          valable ; s'il n'existe plus (l'employé a déjà
 *                          choisi le sien), il faut `reset: true` pour
 *                          RÉINITIALISER l'accès et envoyer le NOUVEAU mot de
 *                          passe initial. Le transport SMTP vient de la
 *                          configuration du panneau « Envoi d'e-mails »
 *                          (src/app/api/mail-config/route.ts — test Gmail
 *                          inclus). La copie chiffrée du mot de passe initial
 *                          est EFFACÉE par le portail dès que l'employé
 *                          choisit son propre mot de passe.
 *
 * Réservé aux utilisateurs connectés (RH ou IT) — voir src/lib/auth.ts.
 * NOUVEAU (Task 64) : API de données → refusée (403) si le mot de passe du
 * compte connecté a expiré (politique 15 jours).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
// NOUVEAU (Task 173) : empreinte déterministe du CIN pour retrouver toutes
// les fiches de l'employé lors de la modification du nom et prénom.
import { indexCin } from "@/lib/payslip-index";
import {
  getSessionUser,
  motDePasseExpire,
  refusIT,
  unauthorized,
} from "@/lib/auth";
import {
  defautsDepuisRequete,
  envoyerEmailAcces,
  ErreurMail,
  journaliserEnvoi,
  lireConfigMail,
} from "@/lib/mailer";
// NOUVEAU (v0.2.109) : remplissage AUTOMATIQUE des colonnes « Nom » /
// « Prénom » à la création d'un accès — le nom de RÉFÉRENCE des fiches de
// paie du CIN (nomEmployeDepuisFiches) est DÉCOUPÉ selon les règles de
// l'utilisateur (premier mot = Nom, mots suivants = Prénom, composés
// « Ben »/« Bel »/« Bou » conservés ensemble — src/lib/nom-employe.ts).
import { nomEmployeDepuisFiches } from "@/lib/demandes";
import { separerNomPrenom } from "@/lib/nom-employe";

export const runtime = "nodejs";

// (NOUVEAU Task 86 — « Qr code n'expire pas apres 10 minute vérifier »)
// Durée de la FENÊTRE du secret TOTP d'inscription — MÊME valeur que le
// portail (PORTAL_OTP_TTL_MS, plancher 3 s pour les tests, plafond 10 min).
const OTP_TTL_MS = (() => {
  const n = parseInt(process.env.PORTAL_OTP_TTL_MS || "", 10);
  return Number.isFinite(n) && n >= 3000 && n <= 600000 ? n : 10 * 60 * 1000;
})();

/** Normalisation identique à celle du portail (majuscules, sans espaces/tirets/points/slashs). */
function normalizeCin(v: unknown): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[\s.\/\-]/g, "");
}

/**
 * Mot de passe INITIAL (à usage unique) — (MODIFIÉ — politique de complexité) :
 * 12 caractères lisibles en 3 blocs de 4, GARANTISSANT la politique obligatoire
 * (8 caractères minimum, avec minuscule + majuscule + chiffre + symbole) :
 * 3 majuscules, 3 minuscules, 3 chiffres, 3 symboles, mélangés par
 * Fisher-Yates. Alphabet sans caractères ambigus (pas de I, O, 0, 1, L pour
 * éviter les erreurs de retranscription) ; symboles simples à taper
 * (! @ # $ % * + = ?). Affiché UNE SEULE fois dans l'interface.
 */
function genererMotDePasseInitial(): string {
  const MAJ = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const MIN = "abcdefghjkmnpqrstuvwxyz";
  const CHIFFRES = "23456789";
  const SYMBOLES = "!@#$%*+=?";
  const categories = [
    MAJ, MAJ, MAJ,
    MIN, MIN, MIN,
    CHIFFRES, CHIFFRES, CHIFFRES,
    SYMBOLES, SYMBOLES, SYMBOLES,
  ];
  const caracteres = categories.map((alphabet) => alphabet[crypto.randomInt(alphabet.length)]);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return (
    caracteres.slice(0, 4).join("") +
    "-" +
    caracteres.slice(4, 8).join("") +
    "-" +
    caracteres.slice(8, 12).join("")
  );
}

/**
 * (NOUVEAU Task 66) Nettoyage de la forme HACHÉE du mot de passe : les
 * tirets et espaces sont retirés AVANT hachage. Le mot de passe initial
 * reste AFFICHÉ « XXXX-XXXX-XXXX » pour la lecture, mais le portail
 * (scripts/portail-server.js, même règle) accepte la saisie avec ou sans
 * tirets/espaces : recopier « ABCD-EFGH-JKLM », « ABCDEFGHJKLM » ou un
 * collage parasite avec espace donne le même résultat.
 */
function nettoyerMotDePasse(s: string): string {
  return s.replace(/[\s-]/g, "");
}

/** Import paresseux : hashPassword côté serveur (scrypt identique aux comptes admin). */
async function hacher(motDePasse: string): Promise<string> {
  const { hashPassword } = await import("@/lib/auth");
  return hashPassword(motDePasse);
}

/**
 * NOUVEAU (Task 80) Secret TOTP PERSISTANT — MÊME ALGORITHME que le portail
 * (scripts/portail-server.js, genererSecretTotp) : 20 octets aléatoires =
 * 32 caractères Base32 (RFC 4648 sans padding — recommandation de la spec
 * « Key URI Format » de Google).
 */
function genererSecretTotp(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const octets = crypto.randomBytes(20);
  let sortie = "";
  let tampon = 0;
  let bits = 0;
  for (const octet of octets) {
    tampon = (tampon << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += alphabet[(tampon >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += alphabet[(tampon << (5 - bits)) & 31];
  return sortie;
}

/**
 * NOUVEAU (Task 80) Contenu du QR code — URI STANDARD « otpauth://totp/… »,
 * MÊME FORMAT que le portail (contenuQrOtp, Task 78) : label
 * « AutoRH:Espace employé » (MODIFIÉ Task 88 puis v0.2.105 — renommage :
 * l'Account Name affiché par l'application d'authentification est
 * « Espace employé », PLUS le CIN),
 * secret Base32, SHA1, 6 chiffres, période 30 s.
 */
function contenuQr(cin: string, secret: string): string {
  // (MODIFIÉ Task 88) le CIN n'entre PLUS dans le label (Account Name =
  // « Fiche de paie », comme le portail) ; `cin` reste dans la signature
  // pour l'appelant existant. Le label ne participe pas au calcul TOTP.
  void cin;
  const label = encodeURIComponent("AutoRH:Espace employé");
  return (
    "otpauth://totp/" +
    label +
    "?secret=" +
    secret +
    "&issuer=AutoRH&algorithm=SHA1&digits=6&period=30"
  );
}

/**
 * NOUVEAU (Task 80) QR code SVG — mêmes paramètres que le portail (svgQrOtp)
 * pour un rendu identique dans la section « Gestion des QR codes ».
 */
async function svgQr(cin: string, secret: string): Promise<string> {
  return QRCode.toString(contenuQr(cin, secret), {
    type: "svg",
    margin: 1,
    width: 216,
    errorCorrectionLevel: "M",
    color: { dark: "#065f46", light: "#ffffff" },
  });
}

/** Sérialise une ligne d'accès pour la réponse (sans aucun secret). */
function serializer(row: {
  id: string;
  cin: string;
  isActive: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  qrPresente: boolean;
  hasQrSecret: boolean;
  otpFenetreCreeA: Date | null;
  // NOUVEAU (Task 92) : le mot de passe initial est-il encore DISPONIBLE
  // pour l'envoi « Send Mail » (copie chiffrée présente + pas encore
  // consommé) ? Booléen SEULEMENT — jamais le mot de passe lui-même.
  aMotDePasseInitial: boolean;
  mailEnvoyeA: string | null;
  mailEnvoyeLe: Date | null;
  // NOUVEAU (Task 173) : nom et prénom mémorisés sur l'accès (colonne
  // « Nom et prénom » du tableau — modifiable par le RH). null = repli sur
  // le nom des fiches du même CIN côté interface.
  nomPrenom: string | null;
  // NOUVEAU (v0.2.106 — demande utilisateur, point 2) : nom et prénom
  // SÉPARÉS (colonnes « Nom » / « Prénom » du tableau). null = non défini
  // (accès historiques : la colonne « Nom » replie sur nomPrenom côté UI).
  nom: string | null;
  prenom: string | null;
  // NOUVEAU (v0.2.107 — demande utilisateur) : MATRICULE de l'employé —
  // valeur manuelle posée par le RH (crayon de la colonne « Matricule »).
  // null = aucune valeur manuelle : l'interface replie sur l'auto-association
  // (matricule de la fiche la plus récente du CIN, fourni par
  // GET /api/payslips/employes).
  matricule: string | null;
  // NOUVEAU (v0.2.91) : e-mail de NOTIFICATION de l'employé (Task 116,
  // chiffré en base) — désormais visible et MODIFIABLE par le RH et le
  // superadministrateur (colonne « E-mail d'accès », bouton crayon).
  email: string | null;
  // NOUVEAU (v0.2.131 — demande utilisateur) : désignation MANAGER de
  // l'accès (case à cocher de la fenêtre « Mot de passe initial — CIN »),
  // son MANAGER RESPONSABLE (autre accès coché « Manager ») et le NOM
  // d'affichage de ce responsable (résolu côté serveur — les champs sont
  // chiffrés en base). null = aucun responsable.
  isManager: boolean;
  managerId: string | null;
  managerNom: string | null;
  createdAt: Date;
}) {
  // (NOUVEAU Task 86) QR d'inscription EXPIRÉ ? = employé NON INSCRIT
  // (lastLoginAt null) dont le secret de fenêtre (otpFenetreCreeA) a dépassé
  // les 10 minutes : le QR affiché/scanné est MORT — un NOUVEAU QR (nouveau
  // secret) sera présenté à la prochaine connexion du portail.
  const fenetreExpiree =
    !row.lastLoginAt &&
    Boolean(row.hasQrSecret) &&
    Boolean(row.otpFenetreCreeA) &&
    Date.now() - new Date(row.otpFenetreCreeA as Date).getTime() >= OTP_TTL_MS;
  return {
    id: row.id,
    cin: row.cin,
    isActive: row.isActive,
    hasPassword: row.hasPassword,
    mustChangePassword: row.mustChangePassword,
    passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    // NOUVEAU (Task 80) état QR — booléens SEULEMENT, jamais le secret :
    qrPresente: row.qrPresente,
    hasQrSecret: row.hasQrSecret,
    // NOUVEAU (Task 86) fenêtre du QR d'inscription expirée :
    qrFenetreExpiree: fenetreExpiree,
    // NOUVEAU (Task 92) état « Send Mail » :
    aMotDePasseInitial: row.aMotDePasseInitial,
    mailEnvoyeA: row.mailEnvoyeA,
    mailEnvoyeLe: row.mailEnvoyeLe?.toISOString() ?? null,
    // NOUVEAU (Task 173) : nom et prénom de l'employé (chiffré en base,
    // déchiffré par le middleware de lecture).
    nomPrenom: row.nomPrenom ?? null,
    // NOUVEAU (v0.2.106) : nom et prénom SÉPARÉS (chiffrés en base,
    // déchiffrés par le middleware de lecture).
    nom: row.nom ?? null,
    prenom: row.prenom ?? null,
    // NOUVEAU (v0.2.107) : matricule manuel de l'employé (chiffré en base,
    // déchiffré par le middleware de lecture).
    matricule: row.matricule ?? null,
    // NOUVEAU (v0.2.91) : e-mail de notification de l'employé (chiffré en
    // base, déchiffré par le middleware de lecture).
    email: row.email ?? null,
    // NOUVEAU (v0.2.131) : désignation MANAGER + responsable (nom résolu).
    isManager: row.isManager,
    managerId: row.managerId ?? null,
    managerNom: row.managerNom ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré → API de données refusée
  if (session.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : le rôle IT ne peut NI consulter NI gérer les accès
  // employés du portail — garde serveur (l'onglet « Accès portail » est
  // aussi masqué dans l'interface).
  if (session.role === "IT") return refusIT("la gestion des accès au portail employé");
  try {
    const rows = await db.portalAccess.findMany({
      orderBy: { createdAt: "desc" },
      // NOUVEAU (v0.2.131) : les noms des MANAGERS RESPONSABLES sont résolus
      // en une SEULE requête supplémentaire (les champs nom/prénom sont
      // chiffrés en base et déchiffrés par le middleware de lecture) —
      // l'interface reçoit managerNom prêt à afficher dans la liste déroulante.
      select: {
        id: true,
        cin: true,
        isActive: true,
        passwordHash: true,
        mustChangePassword: true,
        passwordChangedAt: true,
        failedAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        qrPresente: true,
        totpSecret: true,
        otpFenetreCreeA: true, // (Task 86) fenêtre du secret d'inscription
        initialPasswordEnc: true, // (Task 92) copie chiffrée du mot de passe initial
        mailEnvoyeA: true, // (Task 92) dernier destinataire de l'e-mail
        mailEnvoyeLe: true, // (Task 92) date du dernier envoi
        nomPrenom: true, // (Task 173) nom et prénom de l'employé
        nom: true, // (v0.2.106) nom séparé
        prenom: true, // (v0.2.106) prénom séparé
        matricule: true, // (v0.2.107) matricule manuel de l'employé
        email: true, // (v0.2.91) e-mail de notification de l'employé
        isManager: true, // (v0.2.131) désignation manager de l'accès
        managerId: true, // (v0.2.131) manager responsable choisi
        createdAt: true,
        // Le hash et le secret TOTP ne sont JAMAIS renvoyés : seuls les
        // booléens hasPassword / hasQrSecret / qrFenetreExpiree sont exposés.
      },
    });
    // (v0.2.131) noms d'affichage des managers référencés (une requête pour
    // tous — évite N+1 ; les lectures passent par le middleware qui déchiffre).
    const idsManagers = Array.from(
      new Set(rows.map((r) => r.managerId).filter((v): v is string => Boolean(v)))
    );
    const lignesManagers = idsManagers.length
      ? await db.portalAccess.findMany({
          where: { id: { in: idsManagers } },
          select: { id: true, nom: true, prenom: true, nomPrenom: true, cin: true },
        })
      : [];
    const nomsManagers = new Map(
      lignesManagers.map((m) => [
        m.id,
        [m.prenom, m.nom].filter(Boolean).join(" ") || m.nomPrenom || `CIN ${m.cin}`,
      ])
    );
    return NextResponse.json({
      items: rows.map((r) =>
        serializer({
          id: r.id,
          cin: r.cin,
          isActive: r.isActive,
          hasPassword: Boolean(r.passwordHash),
          mustChangePassword: r.mustChangePassword,
          passwordChangedAt: r.passwordChangedAt,
          failedAttempts: r.failedAttempts,
          lockedUntil: r.lockedUntil,
          lastLoginAt: r.lastLoginAt,
          qrPresente: r.qrPresente,
          hasQrSecret: Boolean(r.totpSecret),
          otpFenetreCreeA: r.otpFenetreCreeA,
          aMotDePasseInitial:
            Boolean(r.initialPasswordEnc) && r.mustChangePassword,
          mailEnvoyeA: r.mailEnvoyeA,
          mailEnvoyeLe: r.mailEnvoyeLe,
          nomPrenom: r.nomPrenom,
          nom: r.nom,
          prenom: r.prenom,
          matricule: r.matricule,
          email: r.email,
          isManager: r.isManager,
          managerId: r.managerId,
          managerNom: r.managerId ? nomsManagers.get(r.managerId) ?? null : null,
          createdAt: r.createdAt,
        })
      ),
    });
  } catch (error) {
    console.error("[PORTAL-ACCESS] Liste:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  // NOUVEAU (Task 64) : mot de passe expiré → API de données refusée
  if (session.mustChangePassword) return motDePasseExpire();
  // NOUVEAU (Task 172) : création / gestion des accès employés refusées au rôle IT
  // (actions create, reset, toggle, unlock, delete, qr, reset-qr, send-mail).
  if (session.role === "IT") return refusIT("la création ou la gestion des accès employés");
  try {
    const body = await request.json().catch(() => null);
    const action = String(body?.action ?? "");

    // ------------------------------------------------------------------
    // NOUVEAU (Task 173 ; MODIFIÉ v0.2.106 — demande utilisateur, point 2)
    // — MODIFIER LE NOM ET LE PRÉNOM DE L'EMPLOYÉ (deux champs distincts)
    // ------------------------------------------------------------------
    // { action: "modifier-nom", cin, nom, prenom }
    // Colonnes « Nom » / « Prénom » du tableau « Accès Portail par mot de
    // passe » : le RH (et le superadministrateur) corrige les deux champs
    // directement depuis cette interface. La modification est :
    //  1) répercutée dans LES DONNÉES DE L'EMPLOYÉ : toutes les fiches de
    //     paie du même CIN voient leur employeeName mis à jour avec le nom
    //     COMPLET reconstitué (« Prénom Nom » ; ou le nom seul si le prénom
    //     est vide — le middleware de base re-chiffre le nom et recalcule
    //     l'index déterministe nomIndex automatiquement) ;
    //  2) mémorisée sur l'accès portail : nom + prenom (colonnes séparées)
    //     ET nomPrenom = nom complet (SYNCHRONISATION de compatibilité — le
    //     portail employé et le pré-remplissage des demandes Task 175 lisent
    //     nomPrenom) ; le nom reste affiché même si le CIN n'a aucune fiche.
    // Validation (chacun des deux champs) : 2 à 80 caractères, lettres
    // (accents compris), espaces, tirets et apostrophes uniquement. Le
    // prénom peut être vide (null) — la colonne « Prénom » affiche alors « — ».
    if (action === "modifier-nom") {
      const cin = normalizeCin(body?.cin);
      const nom = String(body?.nom ?? "").trim().replace(/\s+/g, " ");
      const prenomBrut = String(body?.prenom ?? "").trim().replace(/\s+/g, " ");
      const prenom = prenomBrut || null;
      if (cin.length < 3 || cin.length > 30) {
        return NextResponse.json(
          { error: "CIN invalide : impossible de localiser l'employé." },
          { status: 400 }
        );
      }
      if (nom.length < 2 || nom.length > 80) {
        return NextResponse.json(
          { error: "Le nom doit contenir de 2 à 80 caractères." },
          { status: 400 }
        );
      }
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(nom)) {
        return NextResponse.json(
          { error: "Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes." },
          { status: 400 }
        );
      }
      if (prenom && (prenom.length < 2 || prenom.length > 80)) {
        return NextResponse.json(
          { error: "Le prénom doit contenir de 2 à 80 caractères (ou être vide)." },
          { status: 400 }
        );
      }
      if (prenom && !/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(prenom)) {
        return NextResponse.json(
          { error: "Le prénom ne peut contenir que des lettres, espaces, tirets et apostrophes." },
          { status: 400 }
        );
      }
      const nomComplet = [prenom, nom].filter(Boolean).join(" ");

      // 1) Fiches de paie du même CIN (recherche par empreinte
      //    déterministe — la même que celle alimentée à l'écriture).
      const idx = indexCin(cin);
      const fiches = idx.cinIndex
        ? await db.payslip.findMany({
            where: { cinIndex: idx.cinIndex },
            select: { id: true },
          })
        : [];
      // Mise à jour fiche par fiche (le middleware chiffre employeeName et
      // recalcule nomIndex à chaque écriture ; updateMany ne passe PAS par
      // le chiffrement, il est volontairement écarté ici).
      for (const f of fiches) {
        await db.payslip.update({
          where: { id: f.id },
          data: { employeeName: nomComplet },
        });
      }

      // 2) Mémorisation sur l'accès portail existant (s'il y en a un) :
      //    nom + prenom SÉPARÉS (colonnes du tableau) et nomPrenom = nom
      //    complet reconstitué (compatibilité portail / demandes Task 175).
      const acces = await db.portalAccess.findUnique({ where: { cin } });
      if (acces) {
        await db.portalAccess.update({
          where: { cin },
          data: { nom, prenom, nomPrenom: nomComplet },
        });
      }

      return NextResponse.json({
        ok: true,
        cin,
        nom,
        prenom,
        nomComplet,
        fichesModifiees: fiches.length,
        accesModifie: Boolean(acces),
        message:
          `Nom et prénom mis à jour pour le CIN ${cin}` +
          (fiches.length > 0
            ? ` — ${fiches.length} fiche${fiches.length > 1 ? "s" : ""} de paie mise${fiches.length > 1 ? "s" : ""} à jour.`
            : acces
              ? " (accès sans fiche de paie pour le moment)."
              : "."),
      });
    }

    // ------------------------------------------------------------------
    // NOUVEAU (v0.2.107 — demande utilisateur, point 2) — MODIFIER LE
    // MATRICULE DE L'EMPLOYÉ
    // ------------------------------------------------------------------
    // { action: "modifier-matricule", cin, matricule }
    // Colonne « Matricule » du tableau « Accès Portail par mot de passe » :
    // le RH (et le superadministrateur) corrige le matricule EXACTEMENT
    // comme le nom, le prénom et l'e-mail (crayon). La valeur saisie est :
    //  1) répercutée dans LES DONNÉES DE L'EMPLOYÉ : toutes les fiches de
    //     paie du même CIN portent le nouveau matricule (le middleware de
    //     base re-chiffre le champ à chaque écriture) — les colonnes
    //     « Matricule » de « Toutes les fiches » et des demandes restent
    //     cohérentes avec la correction ;
    //  2) mémorisée sur l'accès portail (valeur manuelle PRIORITAIRE sur
    //     l'auto-association — résolveur src/lib/matricule.ts utilisé par
    //     les demandes et les e-mails).
    // Valeur VIDE = EFFACEMENT de la valeur manuelle : l'affichage replie
    // sur le matricule auto-associé (fiche la plus récente du CIN qui en
    // porte un) — les fiches ne sont PAS modifiées dans ce cas.
    // Validation : 1 à 30 caractères, lettres, chiffres, espaces, tirets,
    // points et barres (formes « 003879 », « MAT-1003 », « EMP/0001 »…).
    if (action === "modifier-matricule") {
      const cin = normalizeCin(body?.cin);
      const brut = String(body?.matricule ?? "").trim().replace(/\s+/g, " ");
      const matricule = brut || null;
      if (cin.length < 3 || cin.length > 30) {
        return NextResponse.json(
          { error: "CIN invalide : impossible de localiser l'employé." },
          { status: 400 }
        );
      }
      if (matricule && !/^[A-Za-z0-9][A-Za-z0-9/.\- ]{0,29}$/.test(matricule)) {
        return NextResponse.json(
          { error: "Le matricule ne peut contenir que des lettres, chiffres, espaces, tirets, points et barres (1 à 30 caractères)." },
          { status: 400 }
        );
      }

      let fichesModifiees = 0;
      if (matricule) {
        // 1) Fiches de paie du même CIN (recherche par empreinte
        //    déterministe — la même que celle alimentée à l'écriture).
        const idx = indexCin(cin);
        const fiches = idx.cinIndex
          ? await db.payslip.findMany({
              where: { cinIndex: idx.cinIndex },
              select: { id: true },
            })
          : [];
        // Mise à jour fiche par fiche (le middleware chiffre matricule à
        // chaque écriture ; updateMany ne passe PAS par le chiffrement).
        for (const f of fiches) {
          await db.payslip.update({
            where: { id: f.id },
            data: { matricule },
          });
        }
        fichesModifiees = fiches.length;
      }

      // 2) Mémorisation sur l'accès portail (s'il y en a un) — valeur
      //    manuelle prioritaire, ou EFFACEMENT (null) de cette valeur.
      const acces = await db.portalAccess.findUnique({ where: { cin } });
      if (acces) {
        await db.portalAccess.update({
          where: { cin },
          data: { matricule },
        });
      }

      return NextResponse.json({
        ok: true,
        cin,
        matricule,
        fichesModifiees,
        accesModifie: Boolean(acces),
        message: matricule
          ? `Matricule mis à jour pour le CIN ${cin} — ${matricule}` +
            (fichesModifiees > 0
              ? ` — ${fichesModifiees} fiche${fichesModifiees > 1 ? "s" : ""} de paie mise${fichesModifiees > 1 ? "s" : ""} à jour.`
              : acces
                ? " (accès sans fiche de paie pour le moment)."
                : ".")
          : `Valeur manuelle effacée pour le CIN ${cin} — le matricule affiché replie sur l'auto-association depuis les fiches de paie.`,
      });
    }

    // ------------------------------------------------------------------
    // NOUVEAU (v0.2.91 — demande utilisateur) — MODIFIER L'E-MAIL DE L'EMPLOYÉ
    // ------------------------------------------------------------------
    // { action: "modifier-email", cin, email }
    // Le RH (et le superadministrateur) corrige l'adresse e-mail de
    // l'employé directement depuis le tableau « Accès Portail par mot de
    // passe » (bouton crayon de la colonne « E-mail d'accès »). Cette
    // adresse reçoit les NOTIFICATIONS de ses demandes administratives
    // (Task 116 : acceptée / refusée / information requise) et sert de
    // destinataire proposé PAR DÉFAUT au bouton « Envoyer l'e-mail ».
    // Champ chiffré (AES-256-GCM, carte PortalAccess) par le middleware de
    // base — aucune manipulation manuelle. L'IT est déjà refusé en tête de
    // POST (garde serveur) : seuls RH et SUPERADMIN passent.
    if (action === "modifier-email") {
      const cin = normalizeCin(body?.cin);
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (cin.length < 3 || cin.length > 30) {
        return NextResponse.json(
          { error: "CIN invalide : impossible de localiser l'employé." },
          { status: 400 }
        );
      }
      if (
        email.length < 6 ||
        email.length > 254 ||
        !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)
      ) {
        return NextResponse.json(
          { error: "Adresse e-mail invalide (ex. attendu : prenom.nom@entreprise.tn)." },
          { status: 400 }
        );
      }
      const acces = await db.portalAccess.findUnique({ where: { cin } });
      if (!acces) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      await db.portalAccess.update({
        where: { cin },
        data: { email },
      });
      return NextResponse.json({
        ok: true,
        cin,
        email,
        message: `E-mail de l'employé mis à jour pour le CIN ${cin} — ${email}`,
      });
    }

    // ------------------------------------------------------------------
    // NOUVEAU (v0.2.131 — demande utilisateur) — DÉSIGNER UN EMPLOYÉ COMME
    // MANAGER ET CHOISIR SON MANAGER RESPONSABLE, depuis la fenêtre
    // « Mot de passe initial — CIN » de l'onglet Accès portail.
    // ------------------------------------------------------------------
    // { action: "modifier-manager", id, isManager, managerId }
    //  - isManager = true  : l'employé rejoint AUTOMATIQUEMENT la liste
    //    déroulante « Manager responsable » des AUTRES employés (la liste de
    //    l'interface est recalculée après chaque appel — mise à jour au fur
    //    et à mesure des désignations) ;
    //  - isManager = false : l'employé quitte la liste ; les employés qui
    //    l'avaient comme responsable sont REMIS À « Aucun » (plus de
    //    référence vers un non-manager) ;
    //  - managerId (facultatif) : l'identifiant d'un AUTRE accès portail
    //    ACTIF et coché « Manager » — validé côté serveur ; null = aucun.
    if (action === "modifier-manager") {
      const id = String(body?.id ?? "");
      const isManager = Boolean(body?.isManager);
      const managerIdBrut = body?.managerId == null ? "" : String(body.managerId);
      const acces = await db.portalAccess.findUnique({ where: { id } });
      if (!acces) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      let managerId: string | null = null;
      if (managerIdBrut) {
        const resp = await db.portalAccess.findUnique({ where: { id: managerIdBrut } });
        if (!resp || !resp.isActive) {
          return NextResponse.json(
            { error: "Manager responsable introuvable ou désactivé." },
            { status: 400 }
          );
        }
        if (!resp.isManager) {
          return NextResponse.json(
            { error: "Cet employé n'est pas désigné « Manager » : cochez d'abord sa case « Manager »." },
            { status: 400 }
          );
        }
        if (resp.id === acces.id) {
          return NextResponse.json(
            { error: "Un employé ne peut pas être son propre manager responsable." },
            { status: 400 }
          );
        }
        managerId = resp.id;
      }
      // (v0.2.131) Décocher « Manager » : les subordonnés qui référençaient
      // cet accès comme responsable repassent à « Aucun » (cohérence : la
      // liste déroulante ne propose plus ce non-manager).
      if (!isManager && acces.isManager) {
        await db.portalAccess.updateMany({
          where: { managerId: acces.id },
          data: { managerId: null },
        });
      }
      const misAJour = await db.portalAccess.update({
        where: { id },
        data: { isManager, managerId },
      });
      return NextResponse.json({
        ok: true,
        access: {
          id: misAJour.id,
          cin: misAJour.cin,
          isActive: misAJour.isActive,
          isManager: misAJour.isManager,
          managerId: misAJour.managerId,
        },
      });
    }

    // ---- Créer un accès : génère le MOT DE PASSE INITIAL (affiché UNE FOIS) ----
    if (action === "create") {
      const cin = normalizeCin(body?.cin);
      if (cin.length < 3 || cin.length > 30) {
        return NextResponse.json(
          { error: "Veuillez saisir un numéro CIN complet (3 à 30 caractères)." },
          { status: 400 }
        );
      }
      const initialPassword = genererMotDePasseInitial();
      // (Task 66) hash de la forme NETTOYÉE (sans tirets) — saisie tolérante
      const passwordHash = await hacher(nettoyerMotDePasse(initialPassword));
      // NOUVEAU (v0.2.109) : REMPLISSAGE AUTOMATIQUE des colonnes « Nom » /
      // « Prénom » depuis les fiches de paie du CIN — le nom de référence
      // (le plus fréquent parmi les 8 fiches les plus récentes) est découpé
      // selon les règles utilisateur (premier mot = Nom, mots suivants =
      // Prénom, composés « Ben »/« Bel »/« Bou » ensemble). JAMAIS bloquant (repli
      // null = l'interface réappliquera le découpage à l'affichage) et
      // JAMAIS destructif : sur un accès EXISTANT (branche update), les
      // valeurs déjà posées — notamment une correction du RH au crayon —
      // NE SONT PAS écrasées ; seules les valeurs manquantes sont comblées.
      let nomAuto: string | null = null;
      let prenomAuto: string | null = null;
      try {
        const nomReference = await nomEmployeDepuisFiches(cin);
        if (nomReference) {
          const decoupe = separerNomPrenom(nomReference);
          nomAuto = decoupe.nom;
          prenomAuto = decoupe.prenom;
        }
      } catch {
        // repli silencieux : colonnes laissées à null (auto-association UI)
      }
      const existant = await db.portalAccess.findUnique({
        where: { cin },
        select: { nom: true },
      });
      // Upsert : si l'accès existe déjà (même CIN), il repart sur une base saine
      // avec un NOUVEAU mot de passe initial (l'ancien ne fonctionne plus).
      // (Task 92) une COPIE CHIFFRÉE du mot de passe initial est conservée
      // (initialPasswordEnc) : le bouton « Send Mail » pourra l'envoyer par
      // e-mail tant qu'elle est valable — effacée par le portail dès que
      // l'employé choisit son propre mot de passe.
      const access = await db.portalAccess.upsert({
        where: { cin },
        update: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          initialPasswordEnc: initialPassword,
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
          // (v0.2.109) comble SEULEMENT les colonnes manquantes — ne touche
          // pas au nom/prénom déjà enregistré (correction RH prioritaire).
          ...(nomAuto && !existant?.nom ? { nom: nomAuto } : {}),
          ...(prenomAuto && !existant?.nom ? { prenom: prenomAuto } : {}),
        },
        create: {
          cin,
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          initialPasswordEnc: initialPassword,
          isActive: true,
          // (v0.2.109) colonnes « Nom » / « Prénom » pré-remplies depuis les
          // fiches de paie du CIN (règles de découpage v0.2.109).
          ...(nomAuto ? { nom: nomAuto } : {}),
          ...(prenomAuto ? { prenom: prenomAuto } : {}),
        },
      });
      return NextResponse.json({
        access: {
          id: access.id,
          cin: access.cin,
          isActive: access.isActive,
          // NOUVEAU (v0.2.131) : état de la désignation MANAGER de l'accès
          // (false/null à la création ; conservé si l'accès existait déjà —
          // l'upsert ne touche PAS à isManager/managerId).
          isManager: access.isManager,
          managerId: access.managerId,
        },
        // Le mot de passe initial n'est retourné QUE ICI (affichage unique).
        initialPassword,
        message:
          "Communiquez ce mot de passe initial à l'employé : il sera OBLIGÉ de choisir son propre mot de passe à sa première connexion.",
      });
    }

    // ---- Réinitialiser : nouveau mot de passe initial (affiché UNE FOIS) ----
    // Cas prévus : mot de passe oublié, accès ancien (OTP) jamais migré vers un
    // mot de passe, suspicion de compromission. Re-déclenche le changement
    // OBLIGATOIRE à la prochaine connexion du portail.
    if (action === "reset") {
      const id = String(body?.id ?? "");
      const row = await db.portalAccess.findUnique({ where: { id } });
      if (!row) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      const initialPassword = genererMotDePasseInitial();
      // (Task 66) hash de la forme NETTOYÉE (sans tirets) — saisie tolérante
      // (Task 92) la copie chiffrée (initialPasswordEnc) accompagne le NOUVEAU
      // mot de passe initial pour l'envoi « Send Mail » éventuel.
      const passwordHash = await hacher(nettoyerMotDePasse(initialPassword));
      await db.portalAccess.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          initialPasswordEnc: initialPassword,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      return NextResponse.json({
        ok: true,
        cin: row.cin,
        // NOUVEAU (v0.2.131) : l'objet access permet à l'interface d'ouvrir
        // la fenêtre « Mot de passe initial — CIN » avec l'état ACTUEL de la
        // désignation Manager (le reset ne touche PAS à isManager/managerId).
        access: {
          id: row.id,
          cin: row.cin,
          isActive: row.isActive,
          isManager: row.isManager,
          managerId: row.managerId,
        },
        initialPassword,
        message:
          "Communiquez ce mot de passe initial à l'employé : son ancien mot de passe ne fonctionne plus et il devra choisir le sien à la prochaine connexion.",
      });
    }

    // ---- Activer / désactiver un accès ----
    if (action === "toggle") {
      const id = String(body?.id ?? "");
      const row = await db.portalAccess.findUnique({ where: { id } });
      if (!row) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      const updated = await db.portalAccess.update({
        where: { id },
        data: {
          isActive: !row.isActive,
          // Réactiver = repartir sur une base saine (compteur d'échecs remis à zéro)
          failedAttempts: !row.isActive ? 0 : row.failedAttempts,
          lockedUntil: !row.isActive ? null : row.lockedUntil,
        },
      });
      return NextResponse.json({
        access: { id: updated.id, cin: updated.cin, isActive: updated.isActive },
      });
    }

    // ---- Lever un verrouillage anti force-brute ----
    if (action === "unlock") {
      const id = String(body?.id ?? "");
      const updated = await db.portalAccess.updateMany({
        where: { id },
        data: { lockedUntil: null, failedAttempts: 0 },
      });
      if (updated.count === 0) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // ---- Supprimer un accès ----
    if (action === "delete") {
      const id = String(body?.id ?? "");
      await db.portalAccess.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    // ---- NOUVEAU (Task 80) AFFICHER LE QR CODE d'un employé ----
    // Section « Gestion des QR codes » : le RH/IT affiche le QR de l'employé
    // à l'écran pour qu'il le scanne EN DIRECT avec son application
    // d'authentification. (MODIFIÉ Task 86) pour un employé NON INSCRIT, le
    // secret est une FENÊTRE de 10 minutes (otpFenetreCreeA) : si elle est
    // absente ou DÉPASSÉE, un NOUVEAU secret est généré AVANT l'affichage —
    // le QR montré au RH est TOUJOURS vivant 10 minutes ; s'il n'est pas
    // scanné dans ce délai, le portail le RÉGÉNÈRE à la prochaine connexion
    // (l'ancien scan devient inutilisable). Pour un employé INSCRIT : secret
    // DÉFINITIF inchangé (aucune rotation). Rien d'autre n'est modifié en
    // base : l'affichage admin ne compte PAS comme un affichage portail (le
    // verrou qrPresente reste piloté par le portail seul).
    if (action === "qr") {
      const id = String(body?.id ?? "");
      const row = await db.portalAccess.findUnique({ where: { id } });
      if (!row) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      let secret = row.totpSecret;
      // (Task 86) fenêtre du secret VIVANTE ? (non inscrit uniquement)
      const fenetreVivante =
        !row.lastLoginAt &&
        Boolean(secret) &&
        Boolean(row.otpFenetreCreeA) &&
        row.otpFenetreCreeA !== null &&
        Date.now() - row.otpFenetreCreeA.getTime() < OTP_TTL_MS;
      let fenetreRenouvelee = false;
      if (row.lastLoginAt) {
        // Inscrit : secret définitif (créé à la volée s'il manque — Task 80).
        if (!secret) {
          secret = genererSecretTotp();
          await db.portalAccess.update({
            where: { id },
            data: { totpSecret: secret, otpFenetreCreeA: null },
          });
        }
      } else if (!secret || !fenetreVivante) {
        // (Task 86) non inscrit SANS fenêtre vivante : RÉGÉNÉRATION — le
        // QR affiché expire VRAIMENT dans 10 minutes (otpFenetreCreeA = maintenant).
        secret = genererSecretTotp();
        fenetreRenouvelee = true;
        await db.portalAccess.update({
          where: { id },
          data: { totpSecret: secret, otpFenetreCreeA: new Date() },
        });
      }
      const payload = contenuQr(row.cin, secret);
      const svg = await svgQr(row.cin, secret);
      return NextResponse.json({
        ok: true,
        cin: row.cin,
        svg,
        payload,
        qrPresente: row.qrPresente,
        // (Task 86) info d'expiration pour l'interface :
        fenetreRenouvelee,
        expireA:
          row.lastLoginAt || !secret
            ? null
            : new Date(
                (fenetreRenouvelee ? Date.now() : row.otpFenetreCreeA!.getTime()) + OTP_TTL_MS
              ).toISOString(),
      });
    }

    // ---- NOUVEAU (Task 80) RÉINITIALISER LE QR CODE d'un employé ----
    // Changement de téléphone / perte / compromission : un NOUVEAU secret
    // TOTP est généré (l'ANCIENNE application ne génère plus que des codes
    // REFUSÉS), le verrou d'affichage qrPresente repasse à false et la
    // fenêtre anti-rejeu lastUsedWindow est effacée (elle appartenait à
    // l'ancien secret). lastLoginAt n'est PAS touché. Le nouveau QR est
    // renvoyé (SVG + URI) pour un re-scan immédiat par l'employé.
    // (MODIFIÉ Task 86) la NOUVELLE fenêtre du secret dépend de l'état :
    // employé INSCRIT → otpFenetreCreeA = null (secret DÉFINITIF immédiat,
    // la fenêtre /otp le ré-affichera tel quel) ; employé NON INSCRIT →
    // otpFenetreCreeA = maintenant (le QR de la réinitialisation ouvre une
    // fenêtre de 10 minutes — vivante pour le re-scan, morte ensuite, le
    // portail réutilisera ce même secret tant que la fenêtre est vivante).
    if (action === "reset-qr") {
      const id = String(body?.id ?? "");
      const row = await db.portalAccess.findUnique({ where: { id } });
      if (!row) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      const nouveauSecret = genererSecretTotp();
      await db.portalAccess.update({
        where: { id },
        data: {
          totpSecret: nouveauSecret,
          qrPresente: false,
          lastUsedWindow: null,
          // (Task 86) fenêtre du secret : définie pour un non inscrit,
          // scellée pour un inscrit.
          otpFenetreCreeA: row.lastLoginAt ? null : new Date(),
        },
      });
      const payload = contenuQr(row.cin, nouveauSecret);
      const svg = await svgQr(row.cin, nouveauSecret);
      return NextResponse.json({
        ok: true,
        cin: row.cin,
        svg,
        payload,
        qrPresente: false,
        message:
          "Nouveau QR code généré : l'ancienne application d'authentification ne génère plus de codes valables. Faites scanner ce QR code à l'employé.",
      });
    }

    // ---- ENVOYER PAR E-MAIL (« SEND MAIL ») ----
    // Demande utilisateur : bouton « Send Mail » pour CHAQUE utilisateur de
    // la liste « CIN – Accès Portail par mot de passe » — la popup saisit
    // l'adresse e-mail du destinataire et « Send » envoie un e-mail ALLÉGÉ :
    // mot de passe initial + adresse d'accès au portail (ni CIN, ni serveur,
    // ni port — demande utilisateur « tout ce qui est dans le cadre rouge
    // n'envoyer pas »).
    //  - le mot de passe initial vient de la copie chiffrée
    //    initialPasswordEnc TANT QU'IL EST VALABLE (mustChangePassword) ;
    //  - s'il n'existe plus (employé déjà passé au sien), l'interface
    //    confirme `reset: true` : NOUVEAU mot de passe initial généré (comme
    //    l'action « reset ») PUIS envoyé — l'ancien cesse de fonctionner ;
    //  - la configuration SMTP (hôte/port/compte/mot de passe d'application,
    //    test Gmail inclus) vient du panneau « Envoi d'e-mails (SMTP) ».
    if (action === "send-mail") {
      const id = String(body?.id ?? "");
      const dest = String(body?.dest ?? "").trim();
      const resetDemande = Boolean(body?.reset);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dest) || dest.length > 254) {
        return NextResponse.json(
          { error: "Saisissez une adresse e-mail destinataire valide." },
          { status: 400 }
        );
      }
      const row = await db.portalAccess.findUnique({ where: { id } });
      if (!row) {
        return NextResponse.json({ error: "Accès introuvable." }, { status: 404 });
      }
      // 1) D'où vient le mot de passe initial à envoyer ?
      let motDePasseAEnvoyer: string | null = null;
      let resetEffectue = false;
      if (row.mustChangePassword && row.initialPasswordEnc) {
        // Copie chiffrée encore valable (l'employé n'a pas encore choisi son
        // propre mot de passe) — déchiffrée EN MÉMOIRE, jamais journalisée.
        motDePasseAEnvoyer = row.initialPasswordEnc;
      } else if (resetDemande) {
        // RÉINITIALISER PUIS ENVOYER : nouveau mot de passe initial à usage
        // unique (l'ancien mot de passe, choisi ou non, cesse de fonctionner).
        motDePasseAEnvoyer = genererMotDePasseInitial();
        const passwordHash = await hacher(nettoyerMotDePasse(motDePasseAEnvoyer));
        await db.portalAccess.update({
          where: { id },
          data: {
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: null,
            initialPasswordEnc: motDePasseAEnvoyer,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        resetEffectue = true;
      } else {
        return NextResponse.json(
          {
            code: "MOT_DE_PASSE_INDISPONIBLE",
            error:
              "Le mot de passe initial n'est plus disponible (l'employé a déjà choisi son propre mot de passe, ou accès ancien sans copie). Cochez « Réinitialiser le mot de passe et envoyer le nouveau » : un NOUVEAU mot de passe initial sera généré et envoyé — l'ancien cesse de fonctionner.",
          },
          { status: 409 }
        );
      }
      // 2) URL du portail : valeur du panneau SMTP ; si absente, défaut
      //    détecté depuis la requête. E-mail ALLÉGÉ (demande utilisateur) :
      //    le CIN, l'adresse du serveur et le port du site web ne sont plus
      //    inclus — l'employé connaît son CIN et l'URL contient le reste.
      const cfg = await lireConfigMail();
      const defauts = defautsDepuisRequete(request.headers.get("host"));
      const portailUrl = cfg.portailUrl || defauts.portailUrl;
      // 3) Envoi via le transporteur SMTP configuré.
      //    (Task 14) Chaque tentative — réussie OU échouée — est consignée
      //    dans logs/journal-emails.log (diagnostic « je ne reçois pas »),
      //    et la réponse du serveur SMTP est renvoyée à l'interface
      //    (référence du message affichée au RH/IT).
      let resultatEnvoi: { messageId: string; from: string; response: string };
      try {
        resultatEnvoi = await envoyerEmailAcces(dest, {
          motDePasseInitial: motDePasseAEnvoyer,
          portailUrl,
        });
      } catch (e) {
        journaliserEnvoi({
          action: "envoi-acces",
          dest,
          from: cfg.from,
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          succes: false,
          code: e instanceof ErreurMail ? e.code : "SMTP_ECHEC",
          erreur: e instanceof Error ? e.message : String(e),
        });
        if (e instanceof ErreurMail) {
          return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
        }
        console.error("[PORTAL-ACCESS] Send-mail SMTP:", e);
        const detail = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error:
              "L'envoi a échoué. Détail du serveur SMTP : " + detail,
            code: "SMTP_ECHEC",
          },
          { status: 502 }
        );
      }
      journaliserEnvoi({
        action: "envoi-acces",
        dest,
        from: resultatEnvoi.from,
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        succes: true,
        messageId: resultatEnvoi.messageId,
        reponseSmtp: resultatEnvoi.response,
      });
      // 4) Traçabilité : dernier destinataire + date (affichés au RH/IT).
      await db.portalAccess.update({
        where: { id },
        data: { mailEnvoyeA: dest, mailEnvoyeLe: new Date() },
      });
      return NextResponse.json({
        ok: true,
        cin: row.cin,
        dest,
        resetEffectue,
        // (Task 14) Preuve d'acceptation du serveur SMTP : référence du
        // message + réponse brute — affichés au RH/IT pour le diagnostic.
        reference: resultatEnvoi.messageId,
        smtpResponse: resultatEnvoi.response,
        apercu: {
          motDePasse: motDePasseAEnvoyer,
          portailUrl,
        },
        message: resetEffectue
          ? "E-mail envoyé à " + dest + " avec le NOUVEAU mot de passe initial (l'ancien cesse de fonctionner)."
          : "E-mail envoyé à " + dest + " avec le mot de passe initial actuel.",
      });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    console.error("[PORTAL-ACCESS] Action:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
