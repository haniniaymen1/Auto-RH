/**
 * ============================================================================
 *  CHIFFREMENT DES CHAMPS SENSIBLES DE LA BASE DE DONNÉES (Task 32)
 * ============================================================================
 *
 *  JUMELLE TypeScript de scripts/lib-crypto-bd.js (copie canonique).
 *  ⚠ CONSTANTES ET FORMAT IDENTIQUES — ne pas modifier l'un sans l'autre.
 *    (Précédent assumé : Task 21 duplique déjà storage-crypto.ts dans
 *    scripts/portail-server.js.)
 *
 *  Le fichier db/custom.db est une base SQLite lisible en clair. Cette
 *  bibliothèque chiffre (AES-256-GCM) les champs sensibles :
 *    - Payslip       : cin, fileName, content, normalizedContent,
 *                      employeeName, period, netSalary, matricule
 *    - PortalAccess  : cin (déterministe), totpSecret
 *    - User          : email (déterministe), name
 *    - ImportLog     : cinDetected, fileName, message
 *
 *  Formats :
 *    encbd1:<iv>:<tag>:<données>   — IV aléatoire (protection maximale) ;
 *    encbd1d:<iv>:<tag>:<données>  — IV dérivé du contenu : même valeur =
 *    même empreinte, les recherches SQL par égalité restent possibles
 *    (connexion portail par CIN, connexion RH/IT par email).
 *
 *  Toute valeur SANS préfixe est renvoyée telle quelle : les lignes non
 *  encore migrées restent lisibles (migration progressive, zéro rupture).
 *
 *  ⚠ La clé est dérivée du secret AUTO_RH_STORAGE_KEY (repli AUTH_SECRET)
 *    avec des sels propres à la base — NE PAS PERDRE la clé.
 *
 *  Utilisée par src/lib/db.ts (middleware Prisma : chiffre à l'écriture,
 *  déchiffre à la lecture pour TOUTES les routes d'administration).
 * ============================================================================
 */
import "server-only";
import crypto from "crypto";

/* ------------------------------------------------------------------ */
/* Constantes (⚠ IDENTIQUES dans scripts/lib-crypto-bd.js)             */
/* ------------------------------------------------------------------ */

export const PREFIXE_ALEA = "encbd1:";
export const PREFIXE_DET = "encbd1d:";
const SEL_CLE_ALEA = "autorh-db-aleatoire-v1";
const SEL_CLE_DET = "autorh-db-deterministe-v1";
const SEL_CLE_MAC = "autorh-db-mac-v1";
const TAILLE_IV = 12;
const TAILLE_TAG = 16;

/** Carte des modèles/colonnes chiffrés (⚠ IDENTIQUE côté scripts). */
export const CARTE_CHAMPS: Record<string, { det: string[]; alea: string[] }> = {
  Payslip: {
    det: [],
    alea: [
      "cin",
      "fileName",
      "content",
      "normalizedContent",
      "employeeName",
      "period",
      "netSalary",
      "matricule",
      // NOUVEAU (v0.2.50) : texte des anomalies nom/prénom détectées à
      // l'import (contient des noms → chiffré comme employeeName).
      "anomalieNom",
    ],
  },
  // (MODIFIÉ Task 64) passwordHash = mot de passe haché scrypt de l'employé,
  // chiffré en plus (AES-256-GCM) comme les autres champs sensibles.
  // (MODIFIÉ Task 92) initialPasswordEnc = copie chiffrée du mot de passe
  // INITIAL (service « Send Mail » — effacée dès que l'employé choisit son
  // propre mot de passe) ; mailEnvoyeA = dernier destinataire de l'e-mail.
  // (MODIFIÉ Task 173) nomPrenom = nom et prénom de l'employé (colonne
  // « Nom et prénom » du tableau « Accès Portail par mot de passe »).
  PortalAccess: {
    det: ["cin"],
    // (MODIFIÉ v0.2.106) : + nom, prenom — séparation de la colonne « Nom et
    // prénom » (chiffrés à IV aléatoire, comme nomPrenom).
    // (MODIFIÉ v0.2.107) : + matricule — colonne « Matricule » de l'onglet
    // Accès portail (auto-associé depuis les fiches de paie, modifiable par
    // le RH ; chiffré à IV aléatoire comme les autres champs sensibles).
    alea: ["totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA", "email", "nomPrenom", "nom", "prenom", "matricule"],
  },
  User: { det: ["email"], alea: ["name"] },
  ImportLog: { det: [], alea: ["cinDetected", "fileName", "message"] },
  // NOUVEAU (Task 92) : configuration SMTP — le compte d'envoi et le mot de
  // passe (mot de passe d'application Gmail…) sont chiffrés ; le mot de passe
  // n'est JAMAIS renvoyé à l'interface (booléen hasPassword seulement).
  // (MODIFIÉ Task 122) : identifiants IMAP de RÉCEPTION des réponses du RH —
  // imapUser et imapPassword sont chiffrés comme username/password (champs
  // vides = mêmes identifiants que le compte d'envoi SMTP).
  MailConfig: { det: [], alea: ["username", "password", "imapUser", "imapPassword"] },
  // NOUVEAU (v0.2.99) : mot de passe du CERTIFICAT de signature électronique —
  // stocké CHIFFRÉ PAR SECTION (SignatureConfig = section « Import »,
  // SignatureConfigReponse = section « Demandes / Réponses ») : chaque section
  // gère LE SIEN, jamais renvoyé à l'interface (booléen
  // certMotDePasseEnregistre seul). Même discipline que le mot de passe SMTP.
  SignatureConfig: { det: [], alea: ["certMotDePasse", "certCleMotDePasse"] },
  SignatureConfigReponse: { det: [], alea: ["certMotDePasse", "certCleMotDePasse"] },
  // NOUVEAU (Task 184, v0.2.144) : section « Réponse automatique PDF par
  // e-mail » — le mot de passe du certificat DÉDIÉ est chiffré (IV aléatoire),
  // même discipline que les autres sections ; jamais renvoyé à l'interface
  // (booléen hasCertPassword seul).
  ReponsePdfConfig: { det: [], alea: ["certMotDePasse"] },
  // NOUVEAU (Task 224) : API de certification et de signature électronique —
  // le secret de l'API externe (token / clé d'API / mot de passe Basic) et les
  // mots de passe du certificat LOCAL (coffre .p12/.pfx et clé privée séparée)
  // sont chiffrés — jamais renvoyés à l'interface (booléens *Enregistre).
  // SignatureApiDocument n'a AUCUN champ sensible (métadonnées publiques
  // du certificat seulement) : aucune carte nécessaire.
  SignatureApiConfig: { det: [], alea: ["apiSecret", "certMotDePasse", "certCleMotDePasse"] },
  // NOUVEAU (Task 116) : demandes administratives — le CIN du demandeur est
  // chiffré DÉTERMINISTE (recherche « mes demandes » par égalité, même
  // mécanisme que PortalAccess.cin) ; le JSON du formulaire, l'e-mail du
  // traiteur (RH / N+1 / responsable) et l'e-mail de notification de
  // l'employé sont chiffrés à IV aléatoire. reference / statut / type /
  // commentaire / traitePar restent en clair (traçabilité, filtres).
  DemandeAdministrative: {
    det: ["cin"],
    // (MODIFIÉ Task 179) docSigneDestinataires = trace des destinataires du
    // document d'acceptation signé (adresses e-mail) — chiffrée comme les
    // autres champs contenant des adresses.
    // (MODIFIÉ Task 180) docRefusDestinataires = même trace pour le document
    // de REFUS signé & tamponné — chiffrement identique (IV aléatoire).
    alea: [
      "donnees",
      "destinataire",
      "employeEmail",
      "docSigneDestinataires",
      "docRefusDestinataires",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Dérivation des clés (mise en cache par processus)                   */
/* ------------------------------------------------------------------ */

function materielSecret(): string {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

let clesCache: { alea: Buffer; det: Buffer; mac: Buffer } | null = null;
function cles() {
  if (!clesCache) {
    const secret = materielSecret();
    clesCache = {
      alea: crypto.scryptSync(secret, SEL_CLE_ALEA, 32),
      det: crypto.scryptSync(secret, SEL_CLE_DET, 32),
      mac: crypto.scryptSync(secret, SEL_CLE_MAC, 32),
    };
  }
  return clesCache;
}

/* ------------------------------------------------------------------ */
/* Chiffrement / déchiffrement d'un champ                              */
/* ------------------------------------------------------------------ */

export function chiffrerChamp(
  valeur: string | null | undefined,
  deterministe: boolean
): string | null | undefined {
  if (valeur === null || valeur === undefined) return valeur;
  const texte = String(valeur);
  if (texte === "") return valeur;
  if (texte.startsWith(PREFIXE_ALEA) || texte.startsWith(PREFIXE_DET)) {
    return valeur; // déjà chiffré — idempotent
  }
  const k = cles();
  let iv: Buffer;
  if (deterministe) {
    iv = crypto
      .createHmac("sha256", k.mac)
      .update(texte, "utf8")
      .digest()
      .subarray(0, TAILLE_IV);
  } else {
    iv = crypto.randomBytes(TAILLE_IV);
  }
  const chiffre = crypto.createCipheriv(
    "aes-256-gcm",
    deterministe ? k.det : k.alea,
    iv
  );
  const donnees = Buffer.concat([chiffre.update(texte, "utf8"), chiffre.final()]);
  const tag = chiffre.getAuthTag();
  return (
    (deterministe ? PREFIXE_DET : PREFIXE_ALEA) +
    iv.toString("base64") +
    ":" +
    tag.toString("base64") +
    ":" +
    donnees.toString("base64")
  );
}

export function dechiffrerChamp(valeur: string | null | undefined): string | null | undefined {
  if (valeur === null || valeur === undefined) return valeur;
  const texte = String(valeur);
  const deterministe = texte.startsWith(PREFIXE_DET);
  if (!deterministe && !texte.startsWith(PREFIXE_ALEA)) return valeur;
  try {
    const parties = texte.split(":");
    if (parties.length < 4) return valeur;
    const iv = Buffer.from(parties[1], "base64");
    const tag = Buffer.from(parties[2], "base64");
    const donnees = Buffer.from(parties.slice(3).join(":"), "base64");
    const k = cles();
    const clair = crypto.createDecipheriv(
      "aes-256-gcm",
      deterministe ? k.det : k.alea,
      iv
    );
    clair.setAuthTag(tag);
    return Buffer.concat([clair.update(donnees), clair.final()]).toString("utf8");
  } catch (e) {
    throw new Error(
      "Champ de base de données illisible : la clé de chiffrement " +
        "(AUTO_RH_STORAGE_KEY / AUTH_SECRET dans .env) ne correspond pas à " +
        "celle utilisée lors du chiffrement. " +
        "Restaurez la clé d'origine ou relancez scripts/chiffrer-base.js avec la bonne clé. " +
        "Détail technique : " +
        (e instanceof Error ? e.message : String(e))
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers objet / where (utilisés par le middleware de src/lib/db.ts) */
/* ------------------------------------------------------------------ */

/** Chiffre les champs sensibles d'un objet `data` prêt pour Prisma. */
export function chiffrerObjet<T extends Record<string, unknown>>(
  modele: string,
  objet: T | undefined | null
): T | undefined | null {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !objet) return objet;
  const sortie = { ...objet };
  for (const c of carte.det) {
    if (c in sortie) {
      (sortie as Record<string, unknown>)[c] = chiffrerChamp(
        sortie[c] as string | null | undefined,
        true
      );
    }
  }
  for (const c of carte.alea) {
    if (c in sortie) {
      (sortie as Record<string, unknown>)[c] = chiffrerChamp(
        sortie[c] as string | null | undefined,
        false
      );
    }
  }
  return sortie;
}

/** Déchiffre les champs sensibles présents dans une ligne lue de la base. */
export function dechiffrerObjet<T extends Record<string, unknown>>(
  modele: string,
  objet: T | null | undefined
): T | null | undefined {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !objet) return objet;
  const sortie = { ...objet };
  for (const c of [...carte.det, ...carte.alea]) {
    if (sortie[c] !== undefined && sortie[c] !== null) {
      (sortie as Record<string, unknown>)[c] = dechiffrerChamp(
        sortie[c] as string | null | undefined
      );
    }
  }
  return sortie;
}

/** Chiffre la clause `where` quand elle cible un champ déterministe. */
export function chiffrerWhere(
  modele: string,
  where: Record<string, unknown> | undefined | null
): Record<string, unknown> | undefined | null {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !where || typeof where !== "object") return where;
  const sortie = { ...where };
  for (const c of carte.det) {
    if (typeof sortie[c] === "string") {
      sortie[c] = chiffrerChamp(sortie[c] as string, true);
    }
  }
  return sortie;
}

/** Champ chiffré ? (contrôles / diagnostics) */
export function estChiffre(valeur: unknown): boolean {
  return (
    typeof valeur === "string" &&
    (valeur.startsWith(PREFIXE_ALEA) || valeur.startsWith(PREFIXE_DET))
  );
}
