/**
 * ============================================================================
 *  NOUVEAU (Task 92) — SERVICE D'ENVOI D'E-MAILS « ENVOYER L'E-MAIL »
 * ============================================================================
 *
 *  Demande utilisateur : dans « Accès Portail », liste « CIN – Accès Portail
 *  par mot de passe », un bouton « Envoyer l'e-mail » pour chaque
 *  utilisateur — la fenêtre popup saisit l'adresse e-mail du destinataire
 *  et « Envoyer » envoie
 *  un e-mail VOLONTAIREMENT ALLÉGÉ (demande utilisateur) : il contient
 *  uniquement l'adresse d'accès au portail et le mot de passe initial. Le
 *  CIN, l'adresse du serveur et le port du site web ne sont PAS envoyés
 *  (l'employé connaît son CIN ; l'URL du portail contient déjà serveur et
 *  port). La configuration SMTP (test Gmail inclus) est gérée par le panneau
 *  « Envoi d'e-mails (SMTP) » du même onglet (src/components/payslip/mail-panel.tsx).
 *
 *  Sécurité :
 *   - le mot de passe initial n'est JAMAIS stocké en clair : copie chiffrée
 *     AES-256-GCM (champ initialPasswordEnc, carte MailConfig/PortalAccess de
 *     db-crypto.ts), effacée dès que l'employé choisit son propre mot de passe ;
 *   - les identifiants SMTP (nom d'utilisateur + mot de passe du compte ou
 *     d'application) sont chiffrés en base et le mot de passe n'est JAMAIS
 *     renvoyé à l'interface ;
 *   - l'envoi exige une session RH/IT valide (contrôle dans les routes API).
 *
 *  Gmail : compte Google avec validation en 2 étapes + MOT DE PASSE
 *  D'APPLICATION (16 caractères, myaccount.google.com/apppasswords) — un
 *  simple mot de passe de connexion est REFUSÉ par Google.
 * ============================================================================
 */
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { getProjectRoot } from "@/lib/storage-dir";

/** Format e-mail minimal (expéditeur de secours construit depuis le compte). */
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * (Task 102) SOURCE UNIQUE DE LA SÉCURITÉ DE CONNEXION : déduite du PORT.
 * Demande utilisateur : le bouton « Sécurité de la connexion » (interrupteur
 * STARTTLS/plain) est supprimé du panneau SMTP — il doublonnait le champ
 * « Port » et pouvait le CONTRADIRE (ex. port 465 + interrupteur sur
 * STARTTLS = envoi en échec). La convention universelle du SMTP fait que le
 * port détermine le chiffrement :
 *  - port 465        → true  : SSL/TLS DIRECT dès l'ouverture de connexion ;
 *  - tout autre port → false : connexion en clair puis STARTTLS si le serveur
 *    l'annonce (587, 25, 2525… — nodemailer monte la TLS automatiquement),
 *    ou SMTP simple pour les relais internes sans TLS.
 * La valeur reste stockée en base (schéma inchangé, aucune migration) mais
 * elle est TOUJOURS réécrite à partir du port : aucune contradiction possible.
 */
export function secureDepuisPort(port: number): boolean {
  return port === 465;
}

/** Configuration SMTP telle que lue en base (mot de passe JAMAIS inclus). */
export interface ConfigMailLue {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  from: string;
  serveurAdresse: string;
  sitePort: string;
  portailUrl: string;
  // NOUVEAU (Task 116) : routage des demandes administratives.
  rhEmail: string;
  itEmail: string;
  responsablesMap: string;
  // NOUVEAU (v0.2.49) : adresse DÉDIÉE des demandes de parrainage
  // (différente de l'adresse des autres demandes ; vide = repli N+1).
  parrainageEmail: string;
  // NOUVEAU (v0.2.197, demande utilisateur « en copie du responsable
  // principal du parrainage ») : adresse qui reçoit une COPIE des demandes
  // de parrainage — l'adresse dédiée reste destinataire principal.
  parrainageCopieEmail: string;
  // NOUVEAU (v0.2.94, Task 197) : MAP DE CONFIGURATION DES MAILS — une
  // adresse DÉDIÉE par type de demande (attestations : destinataire
  // principal ; congé / autorisation : copie systématique, N+1 principal).
  attestationTravailEmail: string;
  attestationSalaireEmail: string;
  congeEmail: string;
  autorisationEmail: string;
  hasPassword: boolean;
  configuree: boolean; // host renseigné → prête à envoyer
  // NOUVEAU (Task 122) : RÉCEPTION des réponses du RH (IMAP) — le portail
  // interroge la boîte de réception pour détecter les réponses aux demandes
  // avec leur pièce jointe. Identifiants IMAP vides = ceux du SMTP.
  imapActif: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string | null;
  hasImapPassword: boolean;
}

/** Lit la configuration SMTP (singleton) — le mot de passe n'est pas renvoyé. */
export async function lireConfigMail(): Promise<ConfigMailLue> {
  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!cfg) {
    return {
      host: "",
      port: 587,
      secure: secureDepuisPort(587), // (Task 102) dérivée du port
      username: null,
      from: "",
      serveurAdresse: "",
      sitePort: "",
      portailUrl: "",
      rhEmail: "",
      itEmail: "",
      responsablesMap: "",
      parrainageEmail: "",
      parrainageCopieEmail: "",
      attestationTravailEmail: "",
      attestationSalaireEmail: "",
      congeEmail: "",
      autorisationEmail: "",
      hasPassword: false,
      configuree: false,
      imapActif: false,
      imapHost: "",
      imapPort: 993,
      imapUser: null,
      hasImapPassword: false,
    };
  }
  return {
    host: cfg.host,
    port: cfg.port,
    // (Task 102) dérivée du port : la valeur en base n'est plus une source
    // indépendante — l'interface et le journal affichent la valeur EFFECTIVE.
    secure: secureDepuisPort(cfg.port),
    username: cfg.username ?? null,
    from: cfg.from,
    serveurAdresse: cfg.serveurAdresse,
    sitePort: cfg.sitePort,
    portailUrl: cfg.portailUrl,
    rhEmail: cfg.rhEmail ?? "",
    itEmail: cfg.itEmail ?? "",
    responsablesMap: cfg.responsablesMap ?? "",
    parrainageEmail: cfg.parrainageEmail ?? "",
    parrainageCopieEmail: cfg.parrainageCopieEmail ?? "",
    attestationTravailEmail: cfg.attestationTravailEmail ?? "",
    attestationSalaireEmail: cfg.attestationSalaireEmail ?? "",
    congeEmail: cfg.congeEmail ?? "",
    autorisationEmail: cfg.autorisationEmail ?? "",
    hasPassword: Boolean(cfg.password),
    configuree: Boolean(cfg.host),
    // (Task 122) réception IMAP — mots de passe JAMAIS renvoyés.
    imapActif: Boolean(cfg.imapActif),
    imapHost: cfg.imapHost ?? "",
    imapPort: cfg.imapPort ?? 993,
    imapUser: cfg.imapUser ?? null,
    hasImapPassword: Boolean(cfg.imapPassword),
  };
}

/**
 * Défauts DÉTECTÉS depuis la requête du RH/IT (pré-remplissage du panneau) :
 * l'en-tête Host donne l'adresse IP ou le nom DNS utilisé par le navigateur —
 * c'est déjà la bonne adresse pour accéder au serveur depuis le réseau.
 */
export function defautsDepuisRequete(hote: string | null): {
  serveur: string;
  sitePort: string;
  portailUrl: string;
} {
  const brut = String(hote ?? "").trim(); // ex. « 192.168.1.10:4000 » ou « paie.entreprise.tn »
  const sansPort = brut.replace(/:\d+$/, "");
  const port = (brut.match(/:(\d+)$/) || [])[1] ?? "4000";
  // Le portail EMPLOYÉS est servi sur le port ADMIN + 1 (4000/4001 en local) :
  // c'est LUI l'adresse d'accès à communiquer aux employés.
  const portPortail = String(parseInt(port, 10) + 1 || 4001);
  return {
    serveur: sansPort,
    sitePort: portPortail,
    portailUrl: `http://${sansPort}${portPortail === "80" ? "" : ":" + portPortail}`,
  };
}

/**
 * Construit le transporteur nodemailer depuis la configuration en base.
 * Lève une Erreur explicite si la configuration est absente ou incomplète.
 * (Le mot de passe est lu UNIQUEMENT ici, pour le transporteur : il n'est
 * JAMAIS renvoyé à l'interface ni journalisé.)
 */
export async function transporteurDepuisConfig() {
  const brut = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!brut || !brut.host) {
    throw new ErreurMail(
      "MAIL_NON_CONFIGURE",
      "Le serveur SMTP n'est pas configuré : ouvrez le panneau « Envoi d'e-mails (SMTP) » de l'onglet Accès portail, renseignez votre serveur (ou choisissez un préréglage : Gmail ou serveur personnalisé), puis enregistrez."
    );
  }
  const cfg: ConfigMailLue = {
    host: brut.host,
    port: brut.port,
    secure: secureDepuisPort(brut.port), // (Task 102) dérivée du port
    username: brut.username ?? null,
    from: brut.from,
    serveurAdresse: brut.serveurAdresse,
    sitePort: brut.sitePort,
    portailUrl: brut.portailUrl,
    rhEmail: brut.rhEmail ?? "",
    itEmail: brut.itEmail ?? "",
    responsablesMap: brut.responsablesMap ?? "",
    parrainageEmail: brut.parrainageEmail ?? "",
    // (v0.2.197) copie du parrainage — lue ici pour l'état affiché par
    // GET /api/mail-config (panneau SMTP → routage).
    parrainageCopieEmail: brut.parrainageCopieEmail ?? "",
    // (Task 197) routage dédié par type de demande — lus ici pour l'état
    // affiché par GET /api/mail-config (panneau SMTP → routage).
    attestationTravailEmail: brut.attestationTravailEmail ?? "",
    attestationSalaireEmail: brut.attestationSalaireEmail ?? "",
    congeEmail: brut.congeEmail ?? "",
    autorisationEmail: brut.autorisationEmail ?? "",
    hasPassword: Boolean(brut.password),
    configuree: true,
    // (Task 122) réception IMAP — lecture ici uniquement pour l'état affiché.
    imapActif: Boolean(brut.imapActif),
    imapHost: brut.imapHost ?? "",
    imapPort: brut.imapPort ?? 993,
    imapUser: brut.imapUser ?? null,
    hasImapPassword: Boolean(brut.imapPassword),
  };
  const transport = nodemailer.createTransport({
    host: brut.host,
    port: brut.port,
    // (Task 102) dérivée du port — 465 = SSL/TLS direct ; autre port =
    // STARTTLS (monté automatiquement si le serveur l'annonce) ou SMTP simple.
    secure: secureDepuisPort(brut.port),
    auth:
      brut.username && brut.password
        ? { user: brut.username, pass: brut.password }
        : undefined,
    // Les serveurs d'entreprise utilisent souvent un certificat auto-signé :
    // on ne bloque PAS l'envoi local pour un motif de TLS non vérifiable.
    tls: { rejectUnauthorized: false },
  });
  return { transport, cfg };
}

/** Erreur métier avec code stable (affichée proprement à l'interface). */
export class ErreurMail extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * ============================================================================
 *  NOUVEAU (Task 14) — JOURNAL D'ENVOI : DIAGNOSTIC « JE NE REÇOIS PAS
 *  L'E-MAIL »
 * ============================================================================
 *  Chaque tentative d'envoi (RÉUSSIE ou ÉCHOUÉE) écrit UNE ligne JSON dans
 *  <racine>/logs/journal-emails.log — le même dossier « logs » que les autres
 *  journaux, ouvert par le bouton « Voir les journaux » du lanceur Windows
 *  (JOURNAUX-SILENCIEUX-WINDOWS.vbs).
 *
 *  Contenu : horodatage, action (envoi-acces / envoi-test / compte-cree…), destinataire,
 *  expéditeur (Mail From), serveur (hôte/port/SSL), succès, référence du
 *  message (messageId renvoyée par le serveur SMTP), réponse SMTP brute
 *  (ex. « 250 2.0.0 OK … gsmtp »), code et message d'erreur le cas échéant.
 *
 *  CONFIDENTIALITÉ : AUCUN secret n'est journalisé — ni mot de passe SMTP,
 *  ni mot de passe initial, ni sujet/corps du message.
 *
 *  ROBUSTESSE : une erreur d'écriture du journal (droits, disque plein…)
 *  ne fait JAMAIS échouer l'envoi lui-même.
 * ==========================================================================
 */
export interface EntreeJournalMail {
  // (MODIFIÉ Task 116) : + demande-creation (portail → RH / N+1 / responsable)
  // et demande-statut (administration → employé après acceptation/refus/info).
  // (MODIFIÉ 0.2.47) : + test-imap (diagnostic de la réception des réponses RH).
  // (MODIFIÉ v0.2.51) : + demande-document (notification « votre document est
  //   disponible » envoyée par l'administration après un import direct du
  //   document de réponse — POST /api/demandes/[id]/repondre).
  // (NOUVEAU v0.2.106 — demande utilisateur, point 1) : + compte-cree
  //   (e-mail AUTOMATIQUE au nouveau RH/IT créé par le superadministrateur —
  //   identifiant + mot de passe initial + adresse d'accès).
  action:
    | "envoi-acces"
    | "envoi-test"
    | "compte-cree"
    | "compte-reactive"
    | "demande-creation"
    | "demande-statut"
    | "demande-document"
    | "doc-signe"
    | "reponse-pdf"
    | "test-imap";
  dest: string;
  from: string;
  host: string;
  port: number;
  secure: boolean;
  succes: boolean;
  messageId?: string | null;
  reponseSmtp?: string | null;
  code?: string | null;
  erreur?: string | null;
  // NOUVEAU (Task 116) : référence de la demande (DEM-AAAA-NNNNN) — champ
  // optionnel absent des entrées historiques (envoi-acces / envoi-test).
  reference?: string | null;
  type?: string | null;
}

export function journaliserEnvoi(e: EntreeJournalMail): void {
  try {
    const dossier = path.join(getProjectRoot(), "logs");
    fs.mkdirSync(dossier, { recursive: true });
    const ligne =
      JSON.stringify({ horodatage: new Date().toISOString(), ...e }) + "\n";
    fs.appendFileSync(path.join(dossier, "journal-emails.log"), ligne, "utf8");
  } catch {
    // Journal indisponible : l'envoi continue quand même (jamais bloquant).
  }
}

/**
 * Adresse d'expédition effective : le Mail From saisi dans la configuration
 * d'abord ; sinon le nom d'utilisateur UNIQUEMENT s'il est une adresse e-mail
 * valide (sur un serveur personnalisé, un simple login comme « admin » ne peut
 * PAS construire un From : le champ Mail From doit alors être renseigné) ;
 * sinon le nom d'application seul.
 */
function expediteurEffectif(cfg: ConfigMailLue): string {
  if (cfg.from) return cfg.from;
  if (cfg.username && REGEX_EMAIL.test(cfg.username)) {
    return `AutoRH <${cfg.username}>`;
  }
  return "AutoRH";
}

/**
 * (NOUVEAU Task 221 — demande utilisateur, point 1) : adresse d'expédition
 * de l'E-MAIL DE CRÉATION D'UN COMPTE RH / IT. L'adresse du SERVICE
 * INFORMATIQUE configurée dans le système (MailConfig.itEmail — panneau
 * SMTP → « E-mail du service informatique ») est utilisée COMME EXPÉDITEUR
 * du message : l'utilisateur voit l'e-mail partir de son service informatique.
 * Repli historique (adresse IT absente) : expéditeurEffectif (Mail From,
 * compte SMTP, ou nom d'application) — l'envoi n'est JAMAIS bloqué par
 * l'absence de cette adresse.
 */
function expediteurCreationCompte(cfg: ConfigMailLue): string {
  if (cfg.itEmail) return cfg.itEmail;
  return expediteurEffectif(cfg);
}

/** Échappe les caractères HTML du corps d'e-mail. */
function echappe(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Données d'accès incluses dans l'e-mail envoyé par le bouton
 * « Envoyer l'e-mail » — VOLONTAIREMENT
 * ALLÉGÉ (demande utilisateur : « tout ce qui est dans le cadre rouge
 * n'envoyer pas ») : uniquement l'adresse d'accès au portail et le mot de
 * passe initial. Le CIN, l'adresse du serveur (IP/DNS) et le port du site
 * web ne sont PLUS inclus dans l'e-mail.
 */
export interface DonneesAcces {
  motDePasseInitial: string;
  portailUrl: string; // adresse d'accès au portail
}

/** Version texte brut de l'e-mail (lisible partout). */
export function texteEmailAcces(d: DonneesAcces): string {
  return [
    "Bonjour,",
    "",
    "Voici vos identifiants d'accès à votre portail AutoRH.",
    "",
    "  Adresse d'accès au portail : " + d.portailUrl,
    "",
    "  Mot de passe initial       : " + d.motDePasseInitial,
    "",
    "Première connexion :",
    "  1. Ouvrez l'adresse d'accès au portail ci-dessus.",
    "  2. Saisissez votre CIN, le mot de passe initial puis le code OTP",
    "     de votre application d'authentification.",
    "  3. Le portail vous OBLIGE à choisir votre propre mot de passe :",
    "     le mot de passe initial cesse alors de fonctionner.",
    "     Règle : 8 caractères minimum, avec minuscules, majuscules,",
    "     chiffres et symboles (exemple : ServiceRH2026!).",
    "",
    "Par sécurité, votre mot de passe expire tous les 15 jours : le portail",
    "vous demandera d'en choisir un nouveau. En cas d'oubli, contactez le",
    "service RH/Informatique pour une réinitialisation.",
    "",
    "Cet e-mail a été envoyé par le service RH/Informatique via AutoRH.",
    "Si vous n'êtes pas le destinataire prévu, ignorez et supprimez ce message.",
  ].join("\n");
}

/** Version HTML de l'e-mail (même contenu, présentation soignée). */
export function htmlEmailAcces(d: DonneesAcces): string {
  const ligne = (libelle: string, valeur: string, mono = false) =>
    `<tr><td style="padding:6px 14px;color:#475569;font-size:13px;">${libelle}</td>` +
    `<td style="padding:6px 14px;"><b style="${mono ? "font-family:monospace;font-size:15px;letter-spacing:1px;" : ""}color:#0f172a;">${echappe(valeur)}</b></td></tr>`;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:#059669;padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">Accès à votre portail AutoRH</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Vos identifiants personnels — AutoRH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">Bonjour,</p>
    <p style="margin:0 0 14px;">Voici vos identifiants d'accès à votre portail AutoRH (fiches de paie, demandes administratives, documents) :</p>
    <table style="border-collapse:collapse;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
      ${ligne("Adresse d'accès au portail", d.portailUrl)}
      ${ligne("Mot de passe initial", d.motDePasseInitial, true)}
    </table>
    <p style="margin:16px 0 6px;font-weight:600;">Première connexion :</p>
    <ol style="margin:0 0 14px;padding-left:20px;color:#475569;">
      <li>Ouvrez l'<b>adresse d'accès au portail</b> ci-dessus.</li>
      <li>Saisissez votre <b>CIN</b>, le <b>mot de passe initial</b> puis le <b>code OTP</b> de votre application d'authentification.</li>
      <li>Le portail vous <b>oblige</b> à choisir votre propre mot de passe : le mot de passe initial cesse alors de fonctionner.</li>
    </ol>
    <p style="margin:0 0 14px;color:#475569;">Règle du mot de passe personnel : <b>8 caractères minimum</b>, avec minuscules, majuscules, chiffres et symboles (exemple&nbsp;: ServiceRH2026!).</p>
    <p style="margin:0 0 14px;color:#475569;">Par sécurité, votre mot de passe <b>expire tous les 15 jours</b> : le portail vous demandera d'en choisir un nouveau. En cas d'oubli, contactez le service RH/Informatique.</p>
    <p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé par le service RH/Informatique via AutoRH. Si vous n'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>
  </div>
</div>`;
}

/** Envoie l'e-mail d'accès (texte + HTML) au destinataire désigné.
 *  (Task 14) Renvoie AUSSI la réponse brute du serveur SMTP (info.response,
 *  ex. « 250 2.0.0 OK … gsmtp ») : preuve d'acceptation affichée à l'écran
 *  et consignée dans le journal d'envoi. */
export async function envoyerEmailAcces(
  dest: string,
  d: DonneesAcces
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurEffectif(cfg);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) e-mail SYSTÈME : jamais classé par le poller IMAP du
    // portail s'il revient dans la boîte SMTP (Garde 2 X-Auto-RH-Systeme).
    headers: { "X-Auto-RH-Systeme": "acces-portail" },
    subject: "Vos accès au portail AutoRH (mot de passe initial)",
    text: texteEmailAcces(d),
    html: htmlEmailAcces(d),
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}

/* ==========================================================================
 *  NOUVEAU (v0.2.106 — demande utilisateur, point 1)
 *  E-MAIL AUTOMATIQUE DE CRÉATION D'UN COMPTE RH / IT
 * ==========================================================================
 *  Quand le superadministrateur crée un compte RH ou IT (onglet
 *  « Utilisateurs » → POST /api/users), un e-mail est envoyé AUTOMATIQUEMENT
 *  au compte nouvellement créé. Il contient :
 *   - le NOM du titulaire et le RÔLE attribué ;
 *   - l'IDENTIFIANT (l'adresse e-mail du compte sert de login) ;
 *   - le MOT DE PASSE INITIAL saisi/généré par le superadministrateur ;
 *   - l'adresse d'accès au SITE D'ADMINISTRATION ;
 *   - l'obligation de CHANGER le mot de passe à la première connexion
 *     (mécanisme déjà en place : passwordChangedAt antidaté à la création →
 *     mustChangePassword=true au premier login — écran non contournable).
 *
 *  L'envoi est JOURNALISÉ (action "compte-cree") et JAMAIS bloquant pour la
 *  création du compte : si le SMTP n'est pas configuré, le compte existe
 *  quand même et l'interface invite le superadministrateur à communiquer les
 *  identifiants manuellement.
 * ========================================================================== */

/** Données de l'e-mail de création de compte RH/IT. */
export interface DonneesCreationCompte {
  nomComplet: string;
  roleLabel: string; // « RH » ou « Informatique (IT) »
  identifiant: string; // l'adresse e-mail du compte (login)
  motDePasseInitial: string;
  urlAdministration: string; // ex. http://192.168.1.10:4000
}

/** Version texte brut. */
export function texteEmailCreationCompte(d: DonneesCreationCompte): string {
  return [
    `Bonjour ${d.nomComplet},`,
    "",
    `Un compte ${d.roleLabel} vient d'être créé pour vous dans AutoRH`,
    "(gestion des fiches de paie, des demandes administratives et des documents).",
    "",
    "  Votre identifiant (connexion) : " + d.identifiant,
    "  Mot de passe initial          : " + d.motDePasseInitial,
    "  Adresse d'accès               : " + d.urlAdministration,
    "",
    "IMPORTANT — VALIDITÉ DE 15 MINUTES (v0.2.129) :",
    "  Ce mot de passe initial n'est valable que 15 MINUTES à compter de",
    "  l'envoi de cet e-mail. Connectez-vous et activez votre compte SANS",
    "  ATTENDRE. Passé ce délai sans connexion, le compte est AUTOMATIQUEMENT",
    "  désactivé et ce mot de passe ne fonctionne plus : seul le",
    "  superadministrateur pourra vous envoyer un NOUVEAU mot de passe",
    "  initial (lui aussi valable 15 minutes).",
    "PREMIÈRE CONNEXION — CHANGEMENT OBLIGATOIRE :",
    "  1. Ouvrez l'adresse d'accès ci-dessus et connectez-vous avec votre",
    "     identifiant et le mot de passe initial.",
    "  2. Le portail vous OBLIGE à choisir un nouveau mot de passe personnel :",
    "     le mot de passe initial cesse alors de fonctionner.",
    "     Règle : 8 caractères minimum, avec minuscules, majuscules, chiffres",
    "     et symboles (exemple : ServiceRH2026!).",
    "",
    "Par sécurité, votre mot de passe expire tous les 15 jours : le portail vous",
    "demandera d'en choisir un nouveau. Ne transmettez JAMAIS ce mot de passe à",
    "un tiers — il est strictement personnel.",
    "",
    "E-mail automatique AutoRH — merci de NE PAS répondre à cet e-mail :",
    "les réponses envoyées à cette adresse ne sont pas lues. Pour toute question,",
    "contactez le superadministrateur.",
  ].join("\n");
}

/** Version HTML (même contenu, présentation soignée). */
export function htmlEmailCreationCompte(d: DonneesCreationCompte): string {
  const ligne = (libelle: string, valeur: string, mono = false) =>
    `<tr><td style="padding:6px 14px;color:#475569;font-size:13px;">${libelle}</td>` +
    `<td style="padding:6px 14px;"><b style="${mono ? "font-family:monospace;font-size:15px;letter-spacing:1px;" : ""}color:#0f172a;">${echappe(valeur)}</b></td></tr>`;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:#0f766e;padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">Votre compte ${echappe(d.roleLabel)} AutoRH a été créé</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Vos identifiants d'accès à l'administration — AutoRH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">Bonjour ${echappe(d.nomComplet)},</p>
    <p style="margin:0 0 14px;">Un compte <b>${echappe(d.roleLabel)}</b> vient d'être créé pour vous dans AutoRH (gestion des fiches de paie, des demandes administratives et des documents).</p>
    <table style="border-collapse:collapse;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
      ${ligne("Votre identifiant (connexion)", d.identifiant)}
      ${ligne("Mot de passe initial", d.motDePasseInitial, true)}
      ${ligne("Adresse d'accès", d.urlAdministration)}
    </table>
    <p style="margin:14px 0;padding:10px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;color:#92400e;font-size:13px;">
      <b>IMPORTANT — VALIDITÉ DE 15 MINUTES :</b> ce mot de passe initial n'est valable que <b>15 minutes</b> à compter de l'envoi de cet e-mail. Connectez-vous et activez votre compte <b>sans attendre</b>. Passé ce délai sans connexion, le compte est <b>automatiquement désactivé</b> et ce mot de passe ne fonctionne plus : seul le superadministrateur pourra vous envoyer un nouveau mot de passe initial (lui aussi valable 15 minutes).
    </p>
    <p style="margin:16px 0 6px;font-weight:600;">Première connexion — changement OBLIGATOIRE :</p>
    <ol style="margin:0 0 14px;padding-left:20px;color:#475569;">
      <li>Ouvrez l'<b>adresse d'accès</b> ci-dessus et connectez-vous avec votre <b>identifiant</b> et le <b>mot de passe initial</b>.</li>
      <li>Le portail vous <b>oblige</b> à choisir un nouveau mot de passe personnel : le mot de passe initial cesse alors de fonctionner.</li>
    </ol>
    <p style="margin:0 0 14px;color:#475569;">Règle du mot de passe personnel : <b>8 caractères minimum</b>, avec minuscules, majuscules, chiffres et symboles (exemple&nbsp;: ServiceRH2026!).</p>
    <p style="margin:0 0 14px;color:#475569;">Par sécurité, votre mot de passe <b>expire tous les 15 jours</b>. Il est <b>strictement personnel</b> : ne le transmettez jamais à un tiers.</p>
    <p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique AutoRH — merci de ne pas répondre. Pour toute question, contactez le superadministrateur.</p>
  </div>
</div>`;
}

/** Envoie l'e-mail AUTOMATIQUE de création de compte RH/IT (texte + HTML).
 *  (MODIFIÉ Task 221 — demande utilisateur, point 1) : l'EXPÉDITEUR du
 *  message est l'ADRESSE DU SERVICE INFORMATIQUE configurée dans le système
 *  (MailConfig.itEmail) — repli expéditeurEffectif si cette adresse est
 *  absente. JAMAIS bloquant : l'appelant (POST /api/users) capture les
 *  erreurs et renvoie l'état exact à l'interface (envoyé / erreur lisible). */
export async function envoyerEmailCreationCompte(
  dest: string,
  d: DonneesCreationCompte
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurCreationCompte(cfg);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) e-mail SYSTÈME — jamais classé (Garde 2).
    headers: { "X-Auto-RH-Systeme": "compte-cree" },
    subject: `AutoRH — Votre compte ${d.roleLabel} a été créé (mot de passe initial VALABLE 15 MINUTES)`,
    text: texteEmailCreationCompte(d),
    html: htmlEmailCreationCompte(d),
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}

/* ==================================================================
 * NOUVEAU (v0.2.129 — demande utilisateur) — E-MAIL DE RÉACTIVATION
 * ==================================================================
 * Le compte IT/RH n'a pas été activé dans les 15 minutes : il est
 * désactivé automatiquement. Quand le SuperAdmin le RÉACTIVE (route
 * /api/users/[id]/reactiver), un NOUVEAU mot de passe initial — unique,
 * différent de tous les précédents — est généré et envoyé par cet e-mail,
 * soumis au MÊME délai de validité de 15 minutes.
 * ================================================================== */

export interface DonneesReactivationCompte {
  nomComplet: string;
  roleLabel: string; // « RH » ou « Informatique (IT) »
  identifiant: string; // l'adresse e-mail du compte (login)
  motDePasseInitial: string; // NOUVEAU mot de passe initial (unique)
  urlAdministration: string;
}

/** Version texte brut de l'e-mail de réactivation. */
export function texteEmailReactivationCompte(d: DonneesReactivationCompte): string {
  return [
    `Bonjour ${d.nomComplet},`,
    "",
    `Votre compte ${d.roleLabel} AutoRH vient d'être RÉACTIVÉ par le`,
    "superadministrateur (le délai d'activation de 15 minutes avait été", 
    "dépassé : l'ancien mot de passe initial n'est plus valable).", 
    "",
    "  Votre identifiant (connexion) : " + d.identifiant,
    "  NOUVEAU mot de passe initial  : " + d.motDePasseInitial,
    "  Adresse d'accès               : " + d.urlAdministration,
    "",
    "IMPORTANT — VALIDITÉ DE 15 MINUTES :",
    "  Ce nouveau mot de passe initial est UNIQUE (différent de tous les",
    "  mots de passe précédemment attribués à votre compte) et n'est",
    "  valable que 15 MINUTES à compter de l'envoi de cet e-mail.",
    "  Connectez-vous SANS ATTENDRE. Passé ce délai sans connexion, le",
    "  compte sera de nouveau AUTOMATIQUEMENT désactivé.",
    "",
    "PREMIÈRE CONNEXION — CHANGEMENT OBLIGATOIRE :",
    "  1. Ouvrez l'adresse d'accès ci-dessus et connectez-vous avec votre",
    "     identifiant et ce nouveau mot de passe initial.",
    "  2. Le portail vous OBLIGE à choisir un nouveau mot de passe personnel.",
    "     Règle : 8 caractères minimum, avec minuscules, majuscules, chiffres",
    "     et symboles (exemple : ServiceRH2026!).",
    "",
    "E-mail automatique AutoRH — merci de NE PAS répondre à cet e-mail :",
    "les réponses envoyées à cette adresse ne sont pas lues. Pour toute question,",
    "contactez le superadministrateur.",
  ].join("\n");
}

/** Version HTML (même contenu, présentation soignée). */
export function htmlEmailReactivationCompte(d: DonneesReactivationCompte): string {
  const ligne = (libelle: string, valeur: string, mono = false) =>
    `<tr><td style="padding:6px 14px;color:#475569;font-size:13px;">${libelle}</td>` +
    `<td style="padding:6px 14px;"><b style="${mono ? "font-family:monospace;font-size:15px;letter-spacing:1px;" : ""}color:#0f172a;">${echappe(valeur)}</b></td></tr>`;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:#b45309;padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">Votre compte ${echappe(d.roleLabel)} AutoRH a été réactivé</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Nouveau mot de passe initial — valable 15 minutes — AutoRH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">Bonjour ${echappe(d.nomComplet)},</p>
    <p style="margin:0 0 14px;">Votre compte <b>${echappe(d.roleLabel)}</b> vient d'être <b>réactivé</b> par le superadministrateur (le délai d'activation de 15 minutes avait été dépassé : l'ancien mot de passe initial n'est plus valable).</p>
    <table style="border-collapse:collapse;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
      ${ligne("Votre identifiant (connexion)", d.identifiant)}
      ${ligne("NOUVEAU mot de passe initial", d.motDePasseInitial, true)}
      ${ligne("Adresse d'accès", d.urlAdministration)}
    </table>
    <p style="margin:14px 0;padding:10px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;color:#92400e;font-size:13px;">
      <b>IMPORTANT — VALIDITÉ DE 15 MINUTES :</b> ce nouveau mot de passe initial est <b>unique</b> (différent de tous les mots de passe précédemment attribués à votre compte) et n'est valable que <b>15 minutes</b> à compter de l'envoi de cet e-mail. Connectez-vous <b>sans attendre</b> : passé ce délai, le compte sera de nouveau <b>automatiquement désactivé</b>.
    </p>
    <p style="margin:0 0 14px;color:#475569;">À la première connexion, le portail vous <b>oblige</b> à choisir un nouveau mot de passe personnel : <b>8 caractères minimum</b>, avec minuscules, majuscules, chiffres et symboles (exemple&nbsp;: ServiceRH2026!).</p>
    <p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique AutoRH — merci de ne pas répondre. Pour toute question, contactez le superadministrateur.</p>
  </div>
</div>`;
}

/** Envoie l'e-mail AUTOMATIQUE de réactivation (texte + HTML) — même
 *  expéditeur que la création (adresse du service informatique configurée).
 *  JAMAIS bloquant : l'appelant capture les erreurs et renvoie l'état exact. */
export async function envoyerEmailReactivationCompte(
  dest: string,
  d: DonneesReactivationCompte
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurCreationCompte(cfg);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) e-mail SYSTÈME — jamais classé (Garde 2).
    headers: { "X-Auto-RH-Systeme": "compte-reactive" },
    subject: `AutoRH — Votre compte ${d.roleLabel} a été réactivé (NOUVEAU mot de passe initial VALABLE 15 MINUTES)`,
    text: texteEmailReactivationCompte(d),
    html: htmlEmailReactivationCompte(d),
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}

/** Envoie l'e-mail de TEST du panneau de configuration.
 *  (Task 14) Renvoie AUSSI la réponse brute du serveur SMTP (voir ci-dessus). */
export async function envoyerEmailTest(
  dest: string
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurEffectif(cfg);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) e-mail de TEST — jamais classé (Garde 2).
    headers: { "X-Auto-RH-Systeme": "test-smtp" },
    subject: "AutoRH — e-mail de test du serveur SMTP",
    text:
      "Félicitations : votre configuration SMTP fonctionne.\n\n" +
      "Cet e-mail de test confirme que le serveur d'envoi est correctement paramétré.\n" +
      "Vous pouvez désormais utiliser le bouton « Envoyer l'e-mail » de la liste " +
      "« CIN – Accès Portail par mot de passe » pour envoyer aux employés leurs " +
      "identifiants (mot de passe initial et adresse d'accès au portail).",
    html:
      '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#059669;padding:18px 22px;color:#fff;font-size:18px;font-weight:700;">Configuration SMTP validée</div>' +
      '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
      "<p style=\"margin:0 0 12px;\">Félicitations : votre configuration SMTP fonctionne.</p>" +
      '<p style="margin:0 0 12px;">Vous pouvez désormais utiliser le bouton <b>« Envoyer l\'e-mail »</b> de la liste « CIN – Accès Portail par mot de passe » pour envoyer aux employés leurs identifiants (mot de passe initial et adresse d\'accès au portail).</p>' +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail de test — AutoRH</p>' +
      "</div></div>",
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}

/* ==========================================================================
 *  NOUVEAU (Task 116) — E-MAILS DES DEMANDES ADMINISTRATIVES
 * ==========================================================================
 *  Deux familles d'e-mails (voir src/lib/demandes.ts pour les types/statuts) :
 *   - CRÉATION (action "demande-creation") : envoyée par le PORTAIL employé
 *     (scripts/portail-server.js, jumelle JS de ces templates) vers le
 *     service RH (attestations), le N+1 saisi (congé, parrainage) ou le
 *     responsable du département (autorisation de sortie) ;
 *   - CHANGEMENT DE STATUT (action "demande-statut") : envoyée par
 *     l'ADMINISTRATION (cette librairie) à l'employé après traitement
 *     (Acceptée / Refusée / Information requise).
 *
 *  Chaque e-mail contient AU MINIMUM (cahier des charges) : le type de
 *  demande, le nom et prénom de l'employé, la date de la demande, les
 *  informations nécessaires au traitement, le statut (notifications de
 *  suivi) et l'identifiant unique (référence DEM-AAAA-NNNNN).
 * ========================================================================== */

/** Données affichées dans un e-mail de demande. */
export interface DonneesEmailDemande {
  reference: string;
  typeLibelle: string;
  nomEmploye: string; // nom/prénom si connu, sinon « CIN •••123 »
  cinMasque: string;
  // NOUVEAU (v0.2.107 — demande utilisateur, point 3) : matricule de
  // l'employé, récupéré automatiquement depuis ses fiches de paie (valeur
  // manuelle de l'accès portail prioritaire — src/lib/matricule.ts). Inséré
  // dans le tableau d'informations (texte ET HTML) juste sous « Employé ».
  // Vide/null = ligne omise (aucun matricule détecté pour ce CIN).
  matricule?: string | null;
  dateDemande: string; // date/heure formatée FR
  statutLabel: string;
  commentaire?: string | null; // commentaire RH (statut) ou commentaire employé (création)
  infos: [string, string][]; // paires [libellé, valeur] du formulaire
}

/** Lignes de tableau HTML réutilisables. */
function lignesTableauDemande(d: DonneesEmailDemande): string {
  const ligne = (l: string, v: string) =>
    `<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">${echappe(l)}</td>` +
    `<td style="padding:6px 14px;"><b style="color:#0f172a;">${echappe(v)}</b></td></tr>`;
  return d.infos.map(([l, v]) => ligne(l, String(v ?? "—"))).join("");
}

/** Couleur d'accent selon le statut (vert acceptée, rouge refusée, ambre info, gris attente). */
function couleurStatut(statutLabel: string): string {
  if (/accept/i.test(statutLabel)) return "#059669";
  if (/refus/i.test(statutLabel)) return "#dc2626";
  if (/information/i.test(statutLabel)) return "#d97706";
  return "#475569";
}

/**
 * Nom affiché de l'employé (MODIFIÉ v0.2.42) : les types SANS formulaire
 * (attestations — et congé sans nom saisi) stockent déjà « Employé (CIN •••233) »
 * comme nomEmploye ; dans ce cas on n'ajoute PAS une seconde fois le CIN masqué.
 */
function employeAffiche(d: DonneesEmailDemande): string {
  return d.nomEmploye.includes(d.cinMasque)
    ? d.nomEmploye
    : `${d.nomEmploye} (CIN ${d.cinMasque})`;
}

/**
 * Version texte brut — création OU changement de statut.
 * (MODIFIÉ v0.2.105 — demande utilisateur) les e-mails envoyés à l'EMPLOYÉ
 * (statut / document disponible) sont des NOTIFICATIONS PURES : mention
 * explicite « NE PAS répondre », renvoi au portail, contact RH pour toute
 * question. La branche CRÉATION (RH / N+1 / responsable) est inchangée : la
 * réponse par e-mail du traitant reste un parcours supporté (Task 122).
 */
export function texteEmailDemande(d: DonneesEmailDemande, changementStatut: boolean): string {
  const intro = changementStatut
    ? `Le statut de votre demande administrative a été mis à jour.`
    : `Une nouvelle demande administrative nécessite votre traitement.`;
  const lignes = d.infos.map(([l, v]) => `  ${l.padEnd(26, " ")}: ${v}`).join("\n");
  return [
    "Bonjour,",
    "",
    intro,
    ...(changementStatut
      ? [
          "",
          "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
          "les réponses envoyées à cette adresse ne sont pas lues.",
        ]
      : []),
    "",
    `  Référence unique           : ${d.reference}`,
    `  Type de demande            : ${d.typeLibelle}`,
    `  Employé                    : ${employeAffiche(d)}`,
    // NOUVEAU (v0.2.107) : matricule de l'employé (omis si non détecté).
    ...(d.matricule ? [`  Matricule                  : ${d.matricule}`] : []),
    `  Date de la demande         : ${d.dateDemande}`,
    `  Statut                     : ${d.statutLabel}`,
    ...(d.commentaire ? [`  Commentaire                : ${d.commentaire}`] : []),
    ...(d.infos.length
      ? ["", "Informations de la demande :", lignes]
      : []),
    "",
    ...(changementStatut
      ? [
          "Le détail de votre demande (et les documents reçus) est consultable à",
          "tout moment dans la section « Demandes administratives » de votre",
          "portail employé. Pour toute question, contactez le service RH.",
        ]
      : [
          "Merci de traiter cette demande. L'employé suit son avancement dans son",
          "section « Demandes administratives » du portail employé.",
        ]),
    "",
    ...(changementStatut
      ? ["E-mail automatique AutoRH — notification SANS réponse."]
      : [
          "Cet e-mail a été envoyé automatiquement par AutoRH. Si vous n'êtes pas",
          "le destinataire prévu, ignorez et supprimez ce message.",
        ]),
  ].join("\n");
}

/** Version HTML — création OU changement de statut (v0.2.105 : encadré
 *  « notification sans réponse » sur la branche employé, même règle que le
 *  texte brut).
 *  (MODIFIÉ v0.2.125) paramètre facultatif `pieces` : quand la notification
 *  porte des pièces jointes (réponse avec document —
 *  envoyerEmailDocumentRepondu), un ENCADRÉ DÉDIÉ « Document joint à cet
 *  e-mail » est inséré dans le corps HTML (symétrique de la section du corps
 *  texte) : l'employé voit immédiatement que le fichier est joint et qu'il
 *  reste disponible dans son portail. */
export function htmlEmailDemande(
  d: DonneesEmailDemande,
  changementStatut: boolean,
  pieces?: { nom: string; taille?: string }[]
): string {
  const accent = changementStatut ? couleurStatut(d.statutLabel) : "#059669";
  const intro = changementStatut
    ? "Le statut de votre demande administrative a été mis à jour."
    : "Une nouvelle demande administrative nécessite votre traitement.";
  const noticeSansReponse = changementStatut
    ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;">' +
      '<b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues. Le suivi de votre demande se fait dans votre portail employé.</div>'
    : "";
  const pied = changementStatut
    ? 'E-mail automatique AutoRH (notification SANS réponse). Pour toute question, contactez le service RH.'
    : "E-mail envoyé automatiquement par AutoRH. Si vous n'êtes pas le destinataire prévu, ignorez et supprimez ce message.";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:${accent};padding:18px 22px;color:#fff;">
    <div style="font-size:18px;font-weight:700;">${changementStatut ? "Notification — Suivi de votre demande" : "Demande administrative"} — ${echappe(d.typeLibelle)}</div>
    <div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ${echappe(d.reference)} — AutoRH</div>
  </div>
  <div style="padding:20px 22px;color:#334155;font-size:14px;">
    <p style="margin:0 0 14px;">${intro}</p>
    ${noticeSansReponse}
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">
      <table style="border-collapse:collapse;width:100%;">
        ${lignesTableauDemande({
          ...d,
          infos: [
            ["Référence unique", d.reference],
            ["Type de demande", d.typeLibelle],
            ["Employé", employeAffiche(d)],
            // NOUVEAU (v0.2.107) : matricule de l'employé (ligne omise si
            // non détecté dans les fiches de paie du CIN).
            ...(d.matricule ? ([["Matricule", d.matricule]] as [string, string][]) : []),
            ["Date de la demande", d.dateDemande],
            ["Statut", d.statutLabel],
            ...(d.commentaire ? ([["Commentaire", d.commentaire]] as [string, string][]) : []),
            ...d.infos,
          ],
        })}
      </table>
    </div>
    ${(pieces && pieces.length
      ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#166534;font-size:13px;">' +
        '<b>Document joint à cet e-mail :</b>' +
        '<ul style="margin:6px 0 0;padding-left:20px;">' +
        pieces
          .map(
            (p) =>
              '<li style="margin:3px 0;">' + echappe(p.nom) +
              (p.taille ? ' <span style="color:#64748b;font-size:12px;">(' + echappe(p.taille) + ')</span>' : '') +
              '</li>'
          )
          .join("") +
        '</ul>' +
        '<div style="margin-top:6px;">Le fichier est joint à ce message ; vous pouvez aussi le visualiser et le télécharger dans la section « Demandes administratives » de votre portail employé.</div>' +
        '</div>'
      : "")}
    <p style="margin:0;color:#94a3b8;font-size:12px;">${pied}</p>
  </div>
</div>`;
}

/**
 * Envoie la NOTIFICATION DE CHANGEMENT DE STATUT à l'employé
 * (acceptée / refusée / information requise) — action journalisée
 * "demande-statut". Utilisée par POST /api/demandes/[id].
 */
export async function envoyerEmailDemandeStatut(
  dest: string,
  d: DonneesEmailDemande
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurEffectif(cfg);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) notification de DÉCISION — jamais classée : son
    // sujet/corps (« acceptée »/« refusée ») déclencherait une décision
    // parasite si elle revenait dans la boîte SMTP (Garde 2).
    headers: { "X-Auto-RH-Systeme": "decision-demande" },
    subject: `AutoRH — Demande ${d.reference} : ${d.statutLabel} (${d.typeLibelle})`,
    text: texteEmailDemande(d, true),
    html: htmlEmailDemande(d, true),
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}

/**
 * NOUVEAU (v0.2.51) — envoie la NOTIFICATION « votre document est disponible »
 * quand le service RH a importé le document de réponse DIRECTEMENT depuis le
 * détail de la demande (parcours d'administration, sans passer par une
 * réponse e-mail). Mêmes gabarits que les notifications de statut ; seul le
 * SUJET change (« votre document est disponible »). Le commentaire porte le
 * nom du document et le renvoi vers la rubrique « Mes demandes » du portail.
 * Utilisée par POST /api/demandes/[id]/repondre.
 *
 * (MODIFIÉ v0.2.106 — demande utilisateur, point 3) le document de réponse
 * est désormais JOINT À L'E-MAIL (tous types de demandes) : l'employé reçoit
 * la pièce jointe EN PLUS du stockage portail. `piecesJointes` = documents
 * FINAUX (tamponnés) déjà en mémoire — { nom, contenu: Buffer, typeMime }.
 * Aucune écriture disque supplémentaire : on joint les octets finaux tels
 * qu'ils ont été stockés. Si la liste est vide (cas improbable), l'e-mail
 * part SANS pièce jointe (comportement historique).
 */
export interface PieceJointeEmail {
  nom: string;
  contenu: Buffer;
  typeMime: string;
}

export async function envoyerEmailDocumentRepondu(
  dest: string,
  d: DonneesEmailDemande,
  piecesJointes?: PieceJointeEmail[]
): Promise<{ messageId: string; from: string; response: string }> {
  const { transport, cfg } = await transporteurDepuisConfig();
  const from = expediteurEffectif(cfg);
  // (NOUVEAU v0.2.125) la taille lisible des pièces jointes est affichée
  // dans le bloc HTML dédié (ex. « 84,2 Ko ») — cohérent avec l'interface.
  const tailleLisible = (n: number): string => {
    const v = Number(n || 0);
    if (!isFinite(v) || v <= 0) return "0 Ko";
    if (v >= 1048576) return (v / 1048576).toFixed(1).replace(".", ",") + " Mo";
    return Math.max(1, Math.round(v / 1024)) + " Ko";
  };
  const piecesAffichees = (piecesJointes && piecesJointes.length
    ? piecesJointes.map((p) => ({ nom: p.nom, taille: tailleLisible(p.contenu.length) }))
    : undefined);
  const info = await transport.sendMail({
    from,
    to: dest,
    // (NOUVEAU Task 251) notification de DOCUMENT — jamais classée (Garde 2).
    headers: { "X-Auto-RH-Systeme": "document-disponible" },
    subject: `AutoRH — Demande ${d.reference} : votre document est disponible (${d.typeLibelle})`,
    text: texteEmailDemande(d, true) +
      (piecesJointes && piecesJointes.length
        ? `\n\nLe document du service RH est joint à cet e-mail (${piecesJointes.map((p) => p.nom).join(", ")}).\nVous pouvez aussi le visualiser et le télécharger dans la section\n« Demandes administratives » de votre portail employé.`
        : ""),
    html: htmlEmailDemande(d, true, piecesAffichees),
    ...(piecesJointes && piecesJointes.length
      ? {
          attachments: piecesJointes.map((p) => ({
            filename: p.nom,
            content: p.contenu,
            contentType: p.typeMime,
          })),
        }
      : {}),
  });
  return { messageId: info.messageId, from, response: info.response ?? "" };
}
