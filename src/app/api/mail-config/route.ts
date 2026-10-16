/**
 * ============================================================================
 *  NOUVEAU (Task 92) — API DE CONFIGURATION DU SERVICE D'ENVOI D'E-MAILS
 * ============================================================================
 *
 *  Panneau « Envoi d'e-mails (SMTP) » de l'onglet « Accès portail » :
 *   - GET  /api/mail-config          → configuration SANS le mot de passe
 *                                      (booléen hasPassword seulement) +
 *                                      défauts détectés depuis la requête
 *                                      (serveur IP/DNS, port, URL du portail) ;
 *   - PUT  /api/mail-config          → enregistre la configuration ; le mot
 *                                      de passe n'est écrasé QUE s'il est
 *                                      fourni (champ vide = inchangé) ;
 *   - POST /api/mail-config          → { action: "test", dest } : envoie un
 *                                      e-mail de TEST au destinataire saisi
 *                                      (test Gmail inclus) — retourne le
 *                                      message d'erreur SMTP exact en cas
 *                                      d'échec (diagnostic à l'écran).
 *
 *  Sécurité (MODIFIÉ — Task 173, « Permissions du rôle IT ») : la
 *  CONFIGURATION du serveur d'envoi est une fonctionnalité TECHNIQUE
 *  autorisée à l'IT (consulter ET modifier) et au superadministrateur :
 *   - GET  : IT/SUPERADMIN → configuration complète + défauts détectés ;
 *            RH → UNIQUEMENT le booléen « configuree » (aucun hôte, port,
 *            compte, expéditeur, ni défaut de pré-remplissage) — le RH a
 *            juste besoin de savoir si le service d'envoi est prêt pour
 *            l'affichage de la popup « Envoyer l'e-mail » ;
 *   - PUT  : IT/SUPERADMIN uniquement (le RH ne configure JAMAIS le SMTP) ;
 *   - POST : IT/SUPERADMIN uniquement (l'e-mail de test est un outil de
 *            diagnostic de la configuration).
 *  Aucun autre droit RH n'est associé à cette fonctionnalité : l'IT ne
 *  gère ni les fiches, ni les accès portail, ni les demandes (403 serveur
 *  sur les API concernées), et la liste des utilisateurs lui est en
 *  consultation seule.
 *  Le RH utilise le service d'envoi (« Envoyer l'e-mail » via /api/portal-access)
 *  mais ne voit et ne modifie AUCUN paramètre SMTP.
 *  Mot de passe expiré → 403 (même politique que les autres API de données).
 *  Les identifiants SMTP sont chiffrés en base (AES-256-GCM, carte
 *  MailConfig de src/lib/db-crypto.ts) et le mot de passe ne QUITTE JAMAIS
 *  le serveur.
 *
 *  (Task 102) Le BOUTON « Sécurité de la connexion » est SUPPRIMÉ (demande
 *  utilisateur : fonctionnalité en double avec le champ « Port ») : la
 *  sécurité est DÉDUITE du port par secureDepuisPort() (src/lib/mailer.ts) —
 *  465 = SSL/TLS direct, autre port = STARTTLS/plain. Le PUT ignore tout
 *  champ « secure » reçu de l'interface (rétrocompatibilité silencieuse).
 *
 *  (NOUVEAU Task 122) RÉCEPTION DES RÉPONSES DU RH (IMAP) : le panneau
 *  expose une rubrique supplémentaire (interrupteur, hôte, port, identifiants)
 *  pour interroger la boîte de réception où arrivent les réponses du service
 *  RH aux demandes administratives (avec le document demandé en pièce
 *  jointe). Les identifiants IMAP vides réutilisent ceux du SMTP ; imapUser/
 *  imapPassword sont chiffrés comme username/password et jamais renvoyés.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  defautsDepuisRequete,
  envoyerEmailTest,
  ErreurMail,
  journaliserEnvoi,
  lireConfigMail,
  secureDepuisPort,
} from "@/lib/mailer";

export const runtime = "nodejs";

/** Validation simple d'une adresse e-mail (RFC simplifiée). */
function emailValide(s: unknown): s is string {
  const v = String(s ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}

/**
 * Validation du nom d'utilisateur SMTP — élargie pour les SERVEURS
 * PERSONNALISÉS/INTERNES : ce peut être un SIMPLE LOGIN (ex. « admin »,
 * « DOMAIN\\utilisateur », « service_rh_mail ») et pas seulement une adresse
 * e-mail. S'il contient « @ », ce doit être un e-mail valide (détection de
 * fautes de frappe) ; sinon, tout identifiant sans espace est accepté.
 */
function compteSmtpValide(s: string): boolean {
  if (!s || s.length > 254 || /\s/.test(s)) return false;
  if (s.includes("@")) return emailValide(s);
  // Login simple : lettres, chiffres, ponctuation courante des identifiants
  // (le backslash couvre les logins Windows « DOMAIN\\user »).
  return /^[A-Za-z0-9._%+\\/-]+$/.test(s);
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    const config = await lireConfigMail();
    // (MODIFIÉ v0.2.100 — matrice des rôles) « Consulter la configuration
    // SMTP » = Non pour le RH : AUCUN paramètre SMTP ne lui est renvoyé —
    // ni l'état booléen « configuree » (autrefois seul visible, désormais
    // supprimé), ni hôte, ni port, ni compte, ni défauts. La popup « Envoyer
    // l'e-mail » du RH affiche un message NEUTRE (sans état). Consultation
    // complète : IT / SUPERADMIN ; écriture et tests : IT / SUPERADMIN.
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json({ config: {} });
    }
    // Défauts pré-remplis depuis l'en-tête Host (IP/DNS déjà utilisé par le
    // navigateur du RH/IT) — uniquement si la base n'a pas encore de valeurs.
    const d = defautsDepuisRequete(request.headers.get("host"));
    return NextResponse.json({
      config,
      defauts: d,
    });
  } catch (error) {
    // (v0.2.167) erreur RÉELLE + indice actionnable (clé .env / schéma / fichier)
    return erreurServeurMailConfig(error, "lecture de la configuration");
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (Task 13) ENREGISTREMENT de la configuration SMTP : réservé à
  // l'informatique — le RH utilise l'envoi d'e-mails, il ne configure pas.
  // (MODIFIÉ Task 173) : l'IT (comme le superadministrateur) CONSULTE et
  // MODIFIE la configuration mail — fonctionnalité technique du rôle IT.
  if (session.role !== "IT" && !estSuperadmin(session)) {
    return Response.json(
      { error: "Accès refusé : la configuration SMTP est réservée aux rôles IT et superadministrateur." },
      { status: 403 }
    );
  }
  try {
    const body = await request.json().catch(() => null);
    const host = String(body?.host ?? "").trim();
    const port = parseInt(String(body?.port ?? ""), 10);
    // (Task 102) le champ « secure » du corps de requête est IGNORÉ : la
    // sécurité est déduite du port (l'ancien bouton de l'interface est
    // supprimé — fonctionnalité en double avec le champ Port).
    const username = String(body?.username ?? "").trim();
    const password = body?.password === undefined || body?.password === null ? "" : String(body?.password);
    const from = String(body?.from ?? "").trim();
    const serveurAdresse = String(body?.serveurAdresse ?? "").trim();
    const sitePort = String(body?.sitePort ?? "").trim();
    const portailUrl = String(body?.portailUrl ?? "").trim();
    // NOUVEAU (Task 116) : routage des DEMANDES ADMINISTRATIVES.
    const rhEmail = String(body?.rhEmail ?? "").trim();
    const itEmail = String(body?.itEmail ?? "").trim();
    const responsablesMap = String(body?.responsablesMap ?? "").replace(/\r\n/g, "\n").trim();
    // NOUVEAU (v0.2.49) : adresse DÉDIÉE des demandes de PARRAINAGE —
    // différente de l'adresse utilisée pour les autres demandes. Vide =
    // repli historique (N+1 saisi par l'employé dans le formulaire).
    const parrainageEmail = String(body?.parrainageEmail ?? "").trim();
    // NOUVEAU (v0.2.197, demande utilisateur « en copie du responsable
    // principal du parrainage ») : adresse qui reçoit une COPIE des demandes
    // de parrainage — l'adresse dédiée ci-dessus reste destinataire
    // principal pour la validation par réponse e-mail. Vide = aucune copie.
    const parrainageCopieEmail = String(body?.parrainageCopieEmail ?? "").trim();
    // NOUVEAU (v0.2.94, Task 197) : MAP DE CONFIGURATION DES MAILS — une
    // adresse DÉDIÉE par type de demande. Attestations : destinataire
    // PRINCIPAL (vide = repli boîte RH). Congé / autorisation de sortie :
    // boîte qui reçoit une COPIE systématique (le N+1 saisi reste
    // destinataire principal ; vide = la copie part à la boîte RH).
    const attestationTravailEmail = String(body?.attestationTravailEmail ?? "").trim();
    const attestationSalaireEmail = String(body?.attestationSalaireEmail ?? "").trim();
    const congeEmail = String(body?.congeEmail ?? "").trim();
    const autorisationEmail = String(body?.autorisationEmail ?? "").trim();
    // NOUVEAU (Task 122) : RÉCEPTION des réponses du RH (IMAP). L'interrupteur
    // peut être activé seulement si un hôte IMAP est fourni ; les identifiants
    // vides signifient « identiques au compte SMTP » (cas standard : la boîte
    // qui ENVOIE les demandes reçoit les réponses). Le mot de passe IMAP
    // n'est écrasé QUE s'il est explicitement fourni (comme le SMTP).
    const imapActif = Boolean(body?.imapActif);
    const imapHost = String(body?.imapHost ?? "").trim();
    const imapPort = parseInt(String(body?.imapPort ?? ""), 10);
    const imapUser = String(body?.imapUser ?? "").trim();
    const imapPassword =
      body?.imapPassword === undefined || body?.imapPassword === null
        ? ""
        : String(body?.imapPassword);
    if (imapActif && !imapHost) {
      return NextResponse.json(
        { error: "L'adresse du serveur IMAP est obligatoire pour activer la réception des réponses (ex. imap.gmail.com)." },
        { status: 400 }
      );
    }
    if (imapHost && !Number.isFinite(imapPort)) {
      return NextResponse.json(
        { error: "Le port IMAP doit être un nombre entre 1 et 65535 (993 SSL/TLS recommandé, 143 STARTTLS)." },
        { status: 400 }
      );
    }
    if (Number.isFinite(imapPort) && (imapPort < 1 || imapPort > 65535)) {
      return NextResponse.json(
        { error: "Le port IMAP doit être un nombre entre 1 et 65535 (993 SSL/TLS recommandé, 143 STARTTLS)." },
        { status: 400 }
      );
    }
    if (imapUser && !compteSmtpValide(imapUser)) {
      return NextResponse.json(
        { error: "Nom d'utilisateur IMAP invalide : utilisez une adresse e-mail complète (ex. rh@entreprise.tn) ou un identifiant sans espace." },
        { status: 400 }
      );
    }

    if (!host) {
      return NextResponse.json(
        { error: "L'adresse du serveur SMTP est obligatoire (ex. smtp.monentreprise.com ou 192.168.1.100)." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: "Le port SMTP doit être un nombre entre 1 et 65535 (25 relais interne, 465 SSL/TLS, 587 STARTTLS)." },
        { status: 400 }
      );
    }
    // Serveur personnalisé/interne : le nom d'utilisateur peut être un SIMPLE
    // LOGIN (ex. « admin », « DOMAIN\\utilisateur »), pas seulement un e-mail.
    if (username && !compteSmtpValide(username)) {
      return NextResponse.json(
        { error: "Nom d'utilisateur invalide : utilisez une adresse e-mail complète (ex. support@mail.com) ou un identifiant sans espace (ex. admin, DOMAIN\\utilisateur)." },
        { status: 400 }
      );
    }
    // (Task 116) validation du routage des demandes administratives.
    if (rhEmail && !emailValide(rhEmail)) {
      return NextResponse.json(
        { error: "L'adresse e-mail du service RH est invalide (ex. rh@entreprise.tn)." },
        { status: 400 }
      );
    }
    if (itEmail && !emailValide(itEmail)) {
      return NextResponse.json(
        { error: "L'adresse e-mail du service informatique est invalide (ex. it@entreprise.tn)." },
        { status: 400 }
      );
    }
    // (v0.2.49) validation de l'adresse dédiée du parrainage.
    if (parrainageEmail && !emailValide(parrainageEmail)) {
      return NextResponse.json(
        { error: "L'adresse e-mail dédiée des demandes de parrainage est invalide (ex. parrainage@entreprise.tn)." },
        { status: 400 }
      );
    }
    // (v0.2.197) validation de l'adresse en COPIE du parrainage.
    if (parrainageCopieEmail && !emailValide(parrainageCopieEmail)) {
      return NextResponse.json(
        { error: "L'adresse e-mail en copie des demandes de parrainage est invalide (ex. responsable.parrainage@entreprise.tn)." },
        { status: 400 }
      );
    }
    // (v0.2.94, Task 197) validation des 4 adresses dédiées par type.
    for (const [champ, libelle, exemple] of [
      [attestationTravailEmail, "des demandes d'attestation de travail", "attestation.travail@entreprise.tn"],
      [attestationSalaireEmail, "des demandes d'attestation de salaire", "attestation.salaire@entreprise.tn"],
      [congeEmail, "des demandes de congé", "conge@entreprise.tn"],
      [autorisationEmail, "des demandes d'autorisation de sortie", "autorisation@entreprise.tn"],
    ] as const) {
      if (champ && !emailValide(champ)) {
        return NextResponse.json(
          { error: `L'adresse e-mail dédiée ${libelle} est invalide (ex. ${exemple}).` },
          { status: 400 }
        );
      }
    }
    if (responsablesMap) {
      const lignes = responsablesMap.split("\n");
      if (lignes.length > 100) {
        return NextResponse.json(
          { error: "La table des responsables accepte au maximum 100 lignes." },
          { status: 400 }
        );
      }
      for (const ligneBrute of lignes) {
        const ligne = ligneBrute.trim();
        if (!ligne) continue;
        const i = ligne.indexOf("=");
        const cle = i > 0 ? ligne.slice(0, i).trim().toUpperCase() : "";
        const val = i > 0 ? ligne.slice(i + 1).trim() : "";
        if (!cle || !val || !emailValide(val)) {
          return NextResponse.json(
            { error: `Ligne de responsable invalide : « ${ligne.slice(0, 80)} » — format attendu : DEPARTEMENT=email (ex. COMPTABILITE=compta@entreprise.tn).` },
            { status: 400 }
          );
        }
      }
    }
    // Mot de passe requis SEULEMENT pour une première configuration avec
    // compte d'envoi : s'il est laissé vide alors qu'un mot de passe existe
    // déjà, l'ancien est conservé (champ interface « inchangé »).
    const existante = await db.mailConfig.findUnique({ where: { id: "smtp" } });
    if (username && !existante?.password && !password) {
      return NextResponse.json(
        { error: "Le mot de passe SMTP est requis avec un nom d'utilisateur (mot de passe du compte pour un serveur personnalisé, ou mot de passe d'application pour Gmail)." },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {
      host,
      port,
      // (Task 102) dérivée du port — 465 = SSL/TLS direct, autre port =
      // STARTTLS/plain ; aucune contradiction port/sécurité possible.
      secure: secureDepuisPort(port),
      username: username || null,
      from,
      serveurAdresse,
      sitePort,
      portailUrl,
      // (Task 116) routage des demandes administratives.
      rhEmail,
      itEmail,
      responsablesMap,
      // (v0.2.49) adresse dédiée des demandes de parrainage.
      parrainageEmail,
      // (v0.2.197) adresse en copie des demandes de parrainage.
      parrainageCopieEmail,
      // (v0.2.94, Task 197) adresses dédiées par type de demande.
      attestationTravailEmail,
      attestationSalaireEmail,
      congeEmail,
      autorisationEmail,
      // (Task 122) réception des réponses du RH (IMAP). La sécurité est
      // DÉDUITE du port comme le SMTP (Task 102) : 993 = SSL/TLS direct,
      // autre port = STARTTLS/négocié par le client de lecture (ImapFlow).
      imapActif: imapActif && Boolean(imapHost),
      imapHost,
      imapPort: Number.isFinite(imapPort) && imapPort >= 1 && imapPort <= 65535 ? imapPort : 993,
      imapUser: imapUser || null,
    };
    // Le mot de passe n'est écrasé QUE s'il est explicitement fourni.
    if (password) data.password = password;
    if (imapPassword) data.imapPassword = imapPassword;
    await db.mailConfig.upsert({
      where: { id: "smtp" },
      update: data,
      create: { id: "smtp", ...data },
    });
    const config = await lireConfigMail();
    return NextResponse.json({
      ok: true,
      config,
      message:
        "Configuration SMTP enregistrée. Utilisez « Envoyer un e-mail de test » pour la valider (toute adresse destinataire est acceptée).",
    });
  } catch (error) {
    // (v0.2.167) erreur RÉELLE + indice actionnable (clé .env / schéma / fichier)
    return erreurServeurMailConfig(error, "enregistrement de la configuration");
  }
}

/**
 * (NOUVEAU 0.2.47) Traduit une erreur IMAP brute (ImapFlow / réseau) en
 * explication ACTIONNABLE — jumelle du messageImapLisible() du portail
 * (scripts/portail-server.js) : garder les deux alignées.
 */
/**
 * (NOUVEAU v0.2.167 — « Erreur serveur dans la configuration SMTP et IMAP »)
 * Les anciens catch renvoyaient un « Erreur serveur. » NU : impossible de
 * diagnostiquer à distance. Désormais l'erreur RÉELLE est affichée dans le
 * panneau, accompagnée d'un indice ACTIONNABLE pour les 3 causes connues :
 *   1. clé de chiffrement .env ≠ clé de la base (déploiement / .env régénéré)
 *      → scripts/reparer-cle-chiffrement.js ;
 *   2. base pas à jour du schéma Prisma (db push non exécuté) → relance du
 *      lanceur ou npx prisma db push ;
 *   3. fichier de base introuvable (DATABASE_URL) → vérifier .env / db/.
 * Endpoints réservés IT / superadministrateur : aucun secret n'est renvoyé,
 * seuls des messages de diagnostic (pratique identique au test SMTP 502).
 */
function erreurServeurMailConfig(erreur: unknown, operation: string) {
  const brut = erreur instanceof Error ? erreur.message : String(erreur);
  console.error("[MAIL-CONFIG] " + operation + ":", erreur);
  let detail = brut.slice(0, 400);
  let indice = "";
  const cleIllisible =
    brut.includes("Champ de base de données illisible") ||
    brut.includes("clé de chiffrement");
  const schemaManquant =
    brut.includes("does not exist in the current database") ||
    brut.includes("Unknown column") ||
    brut.includes("Unknown argument") ||
    brut.includes("P2021") ||
    brut.includes("P2022");
  const fichierIntrouvable =
    brut.includes("SQLITE_CANTOPEN") ||
    brut.includes("cantopen") ||
    brut.includes("Unable to open") ||
    brut.includes("DATABASE_URL") ||
    brut.includes("Malformed database");
  if (cleIllisible) {
    detail =
      "Base de données illisible : la clé de chiffrement du fichier .env (AUTO_RH_STORAGE_KEY / AUTH_SECRET) ne correspond pas à celle qui a chiffré la base.";
    indice =
      "Exécutez « node scripts/reparer-cle-chiffrement.js » (réparation automatique de la base avec la clé actuelle du .env), ou restaurez le fichier .env d'origine — puis redémarrez les services. Le diagnostic complet : « node scripts/diagnostic-config-email.js ».";
  } else if (schemaManquant) {
    detail =
      "Base de données incomplète : une table ou une colonne attendue par la configuration e-mail est absente.";
    indice =
      "Relancez le lanceur habituel (DEMARRER-WINDOWS.bat ou node scripts/redemarrer-services-4000-4001.js) : il met la base à jour (« prisma db push ») — ou exécutez « npx prisma db push » puis redémarrez.";
  } else if (fichierIntrouvable) {
    detail =
      "Fichier de base de données introuvable ou illisible (db/custom.db).";
    indice =
      "Vérifiez DATABASE_URL dans le fichier .env (chemin ABSOLU vers db/custom.db) et que le fichier db/custom.db existe.";
  }
  return NextResponse.json(
    {
      error:
        "Erreur serveur (" + operation + ") : " + detail + (indice ? " — Solution : " + indice : ""),
      indice,
      code: "MAIL_CONFIG_ERREUR_SERVEUR",
    },
    { status: 500 }
  );
}

function indiceImapLisible(message: string): string {
  const m = String(message ?? "");
  const contient = (...mots: string[]) => mots.some((x) => m.toLowerCase().includes(x.toLowerCase()));
  if (contient("ENOTFOUND", "EAI_AGAIN")) {
    return "Nom de serveur introuvable : vérifiez l'orthographe de l'hôte (ex. imap.gmail.com).";
  }
  if (contient("ECONNREFUSED")) {
    return "Connexion refusée : le port est probablement faux ou bloqué (993 = SSL/TLS, 143 = STARTTLS).";
  }
  if (contient("ETIMEDOUT", "timeout", "ESOCKETTIMEDOUT")) {
    return "Le serveur ne répond pas dans le délai : vérifiez hôte/port et le pare-feu du serveur de messagerie.";
  }
  if (contient("AUTHENTICATIONFAILED", "authentication failed", "invalid credentials", "login failed", "AUTHORIZATIONFAILED")) {
    return "Identifiant ou mot de passe refusé : pour Gmail et Outlook, utilisez un MOT DE PASSE D'APPLICATION (compte → sécurité → validation en deux étapes).";
  }
  if (contient("unsafe login", "plaintext")) {
    return "Le serveur exige une connexion chiffrée : utilisez le port 993 (SSL/TLS).";
  }
  if (contient("certificate", "self-signed", "ERR_SSL", "wrong version number", "EPROTO")) {
    return "Problème TLS : port 993 attendu pour le SSL/TLS direct (143 = STARTTLS) — ou certificat du serveur interne à vérifier.";
  }
  if (contient("no such mailbox", "tryto", "nonexistent", "invalid mailbox")) {
    return "La boîte INBOX est indisponible sur ce compte : vérifiez qu'il s'agit bien d'un compte de MESSAGERIE (IMAP) et pas d'un serveur SMTP.";
  }
  if (contient("command failed")) {
    return "Le serveur a refusé une commande IMAP" + (m ? " (réponse : " + m + ")" : "") + " — vérifiez hôte/port et les identifiants, puis relancez le test pour l'étape exacte.";
  }
  return "Vérifiez l'hôte, le port (993 = SSL/TLS, 143 = STARTTLS), le compte et le mot de passe d'application.";
}

/** Petit constructeur d'étape pour le résultat du test IMAP. */
function etapeImap(nom: string, ok: boolean, detail = "") {
  return { etape: nom, ok, detail };
}

/**
 * (0.2.47) Détail COMPLET d'une erreur IMAP : le message d'ImapFlow
 * (« Command failed ») ne dit RIEN — le code du serveur
 * (ex. [AUTHENTICATIONFAILED]) vit dans e.responseText et dans l'objet
 * e.response ; on concatène le tout pour le diagnostic et l'indice.
 */
function detailErreurImap(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const morceaux = [msg];
  if (e && typeof e === "object") {
    const obj = e as { responseText?: string; response?: unknown };
    if (obj.responseText) morceaux.push(String(obj.responseText));
    if (obj.response) {
      try { morceaux.push(JSON.stringify(obj.response)); } catch { /* non sérialisable */ }
    }
  }
  return morceaux.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * (NOUVEAU 0.2.47) TEST IMAP RÉEL : mêmes bibliothèques et mêmes étapes que
 * le moteur de réception du portail (ImapFlow, INBOX, recherche des non
 * lus). Le résultat liste chaque étape + l'indice lisible en cas d'échec.
 */
async function testImap(body: Record<string, unknown> | null) {
  const formHost = String(body?.imapHost ?? "").trim();
  const formPort = parseInt(String(body?.imapPort ?? ""), 10);
  const formUser = String(body?.imapUser ?? "").trim();
  const formPass = typeof body?.imapPassword === "string" ? String(body?.imapPassword) : "";

  const cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const host = formHost || String(cfg?.imapHost ?? "").trim();
  const port = Number.isFinite(formPort) && formPort >= 1 && formPort <= 65535 ? formPort : Number(cfg?.imapPort) || 993;
  const user = formUser || (cfg?.imapUser ? String(cfg.imapUser) : "") || (cfg?.username ? String(cfg.username) : "");
  // Mot de passe : saisi du formulaire > IMAP enregistré > SMTP enregistré
  // (même chaîne de repli que chargerConfigImap() du portail).
  const pass =
    formPass ||
    (cfg?.imapPassword ? String(cfg.imapPassword) : "") ||
    (cfg?.password ? String(cfg.password) : "");

  const etapes: ReturnType<typeof etapeImap>[] = [];
  if (!host || !user || !pass) {
    const manquant = !host ? "l'hôte" : !user ? "le compte" : "le mot de passe";
    return NextResponse.json(
      {
        ok: false,
        etapes: etapes.concat(etapeImap("Préparation", false, manquant + " est manquant")),
        erreur: "Configuration IMAP incomplète : " + manquant + " est manquant.",
        indice:
          !pass && host && user
            ? "Renseignez le mot de passe IMAP (ou le mot de passe SMTP si le compte est le même), puis enregistrez ou relancez le test."
            : "Complétez la rubrique « Réception des réponses du service RH (IMAP) ».",
      },
      { status: 400 }
    );
  }

  let ImapFlowCtor: (typeof import("imapflow"))["ImapFlow"] | null = null;
  try {
    const mod = await import("imapflow");
    ImapFlowCtor = mod.ImapFlow;
  } catch {
    return NextResponse.json(
      { ok: false, etapes: [etapeImap("Paquets", false, "imapflow indisponible")], erreur: "Paquet imapflow indisponible sur le serveur." },
      { status: 500 }
    );
  }

  const client = new ImapFlowCtor({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

  try {
    try {
      await client.connect();
      etapes.push(etapeImap("Connexion au serveur " + host + ":" + port, true, port === 993 ? "SSL/TLS direct" : "STARTTLS/négocié"));
    } catch (e) {
      const brut = detailErreurImap(e);
      const msg = e instanceof Error ? e.message : String(e);
      etapes.push(etapeImap("Connexion au serveur " + host + ":" + port, false, brut));
      journaliserEnvoi({
        action: "test-imap", dest: "", from: "", host, port, secure: port === 993,
        succes: false, code: "IMAP_CONNEXION", erreur: brut,
      });
      return NextResponse.json({ ok: false, etapes, erreur: "Connexion impossible : " + brut, indice: indiceImapLisible(brut) }, { status: 502 });
    }

    let nonLus = 0;
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        etapes.push(etapeImap("Ouverture de la boîte INBOX", true, "Compte et mot de passe acceptés"));
        try {
          const uids = await client.search({ seen: false }, { uid: true });
          nonLus = Array.isArray(uids) ? uids.length : 0;
          etapes.push(etapeImap("Recherche des messages non lus", true, nonLus + " message(s) non lu(s)"));
        } catch (e) {
          const brut = detailErreurImap(e);
          etapes.push(etapeImap("Recherche des messages non lus", false, brut));
          journaliserEnvoi({
            action: "test-imap", dest: "", from: "", host, port, secure: port === 993,
            succes: false, code: "IMAP_RECHERCHE", erreur: brut,
          });
          return NextResponse.json({ ok: false, etapes, erreur: "Boîte ouverte mais recherche refusée : " + brut, indice: indiceImapLisible(brut) }, { status: 502 });
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      const brut = detailErreurImap(e);
      etapes.push(etapeImap("Ouverture de la boîte INBOX", false, brut));
      journaliserEnvoi({
        action: "test-imap", dest: "", from: "", host, port, secure: port === 993,
        succes: false, code: "IMAP_BOITE", erreur: brut,
      });
      return NextResponse.json({ ok: false, etapes, erreur: "Boîte INBOX inaccessible : " + brut, indice: indiceImapLisible(brut) }, { status: 502 });
    }

    try { await client.logout(); } catch { /* déjà fermé */ }
    journaliserEnvoi({
      action: "test-imap", dest: "", from: user, host, port, secure: port === 993,
      succes: true, code: "IMAP_OK", erreur: "",
    });
    return NextResponse.json({
      ok: true,
      etapes,
      message:
        "Connexion IMAP réussie : le portail pourra relever la boîte " + user + " (" + host + ":" + port + (port === 993 ? ", SSL/TLS" : ", STARTTLS") + ") et détecter les réponses du service RH.",
    });
  } catch (e) {
    const brut = detailErreurImap(e);
    try { await client.logout(); } catch { /* déjà fermé */ }
    journaliserEnvoi({
      action: "test-imap", dest: "", from: "", host, port, secure: port === 993,
      succes: false, code: "IMAP_ECHEC", erreur: brut,
    });
    return NextResponse.json({ ok: false, etapes, erreur: "Échec IMAP : " + brut, indice: indiceImapLisible(brut) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  // (Task 13) E-MAIL DE TEST (diagnostic de configuration) : réservé à
  // l'informatique — le RH envoie les e-mails d'accès, pas les tests SMTP.
  // (MODIFIÉ Task 173) : l'IT (comme le superadministrateur) dispose du
  // test SMTP — outil de diagnostic de SA configuration mail.
  if (session.role !== "IT" && !estSuperadmin(session)) {
    return Response.json(
      { error: "Accès refusé : le test SMTP est réservé aux rôles IT et superadministrateur." },
      { status: 403 }
    );
  }
  try {
    const body = await request.json().catch(() => null);
    const action = String(body?.action ?? "");
    // (NOUVEAU 0.2.47) TEST DE CONNEXION IMAP : le portail relève la boîte
    // toutes les 2 min ; quand la relève échoue, le journal affichait un
    // « Command failed » abscons. Ce test exécute le MÊME parcours que le
    // portail (connexion → INBOX → recherche des non lus) et renvoie
    // L'ÉTAPE exacte + une explication lisible — valeurs du FORMULAIRE
    // acceptées (test possible AVANT enregistrement ; mot de passe vide =
    // mot de passe IMAP enregistré, sinon celui du SMTP).
    if (action === "test-imap") {
      return await testImap(body);
    }
    if (action !== "test") {
      return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    const dest = String(body?.dest ?? "").trim();
    if (!emailValide(dest)) {
      return NextResponse.json(
        { error: "Saisissez une adresse e-mail destinataire valide (ex. destinataire@exemple.com)." },
        { status: 400 }
      );
    }
    try {
      // (Task 14) Journalisation de la tentative (succès OU échec) dans
      // logs/journal-emails.log — diagnostic « je ne reçois pas l'e-mail ».
      const cfg = await lireConfigMail();
      const { messageId, from, response } = await envoyerEmailTest(dest);
      journaliserEnvoi({
        action: "envoi-test",
        dest,
        from,
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        succes: true,
        messageId,
        reponseSmtp: response,
      });
      return NextResponse.json({
        ok: true,
        message:
          "E-mail de test envoyé à " + dest + " — vérifiez sa réception (dossier Spam si besoin).",
        messageId,
        from,
        smtpResponse: response,
      });
    } catch (e) {
      // (Task 14) L'échec est aussi journalisé (même fichier) avec le détail
      // exact renvoyé par le serveur SMTP — indispensable au diagnostic.
      let hote = "";
      let port = 0;
      let securise = false;
      try {
        const cfg = await lireConfigMail();
        hote = cfg.host;
        port = cfg.port;
        securise = cfg.secure;
      } catch {
        // configuration illisible : on journalise quand même l'échec
      }
      const codeErreur = e instanceof ErreurMail ? e.code : "SMTP_ECHEC";
      const detailErreur = e instanceof Error ? e.message : String(e);
      journaliserEnvoi({
        action: "envoi-test",
        dest,
        from: "",
        host: hote,
        port,
        secure: securise,
        succes: false,
        code: codeErreur,
        erreur: detailErreur,
      });
      if (e instanceof ErreurMail) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      // Échec SMTP : le message exact est renvoyé pour le diagnostic à l'écran
      // (ex. Gmail : « Username and Password not accepted » = mot de passe
      // d'application requis, ou validation en 2 étapes désactivée).
      console.error("[MAIL-CONFIG] Test:", e);
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error:
            "L'envoi du e-mail de test a échoué. Détail du serveur SMTP : " + detail,
          code: "SMTP_ECHEC",
        },
        { status: 502 }
      );
    }
  } catch (error) {
    // (v0.2.167) erreur RÉELLE + indice actionnable (clé .env / schéma / fichier)
    return erreurServeurMailConfig(error, "test de la configuration");
  }
}
