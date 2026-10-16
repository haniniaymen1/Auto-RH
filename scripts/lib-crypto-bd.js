/**
 * ============================================================================
 *  CHIFFREMENT DES CHAMPS SENSIBLES DE LA BASE DE DONNÉES (Task 32)
 * ============================================================================
 *
 *  PROBLÈME : le fichier db/custom.db est une base SQLite lisible en clair
 *  (CIN, noms des employés, net à payer, texte intégral des fiches, secrets
 *  TOTP du portail, emails des comptes…). Toute personne accédant au fichier
 *  lit tout.
 *
 *  SOLUTION (100 % additive, aucune donnée détruite) :
 *    - les champs sensibles sont stockés CHIFFRÉS (AES-256-GCM) dans la base ;
 *    - format :  encbd1:<iv>:<tag>:<données>   (chiffré à IV aléatoire)
 *                encbd1d:<iv>:<tag>:<données>  (déterministe, IV dérivé du
 *                                               contenu : même valeur = même
 *                                               empreinte → recherches par
 *                                               égalité préservées en SQL) ;
 *    - toute valeur SANS préfixe est lue telle quelle (compatibilité totale
 *      avec les lignes pas encore migrées — migration progressive possible) ;
 *    - la clé est dérivée (scrypt) du secret existant AUTO_RH_STORAGE_KEY
 *      (repli AUTH_SECRET — même chaîne de repli que le chiffrement des
 *      fichiers, Task 21) avec des sels SPÉCIFIQUES à la base : la clé de la
 *      base est différente de la clé des fichiers.
 *
 *  ⚠ NE PAS PERDRE AUTO_RH_STORAGE_KEY : sans elle, la base devient
 *    illisible (comme pour les fiches chiffrées du stockage).
 *
 *  SYNCHRONISATION : ce fichier est la copie CANONIQUE de l'algorithme.
 *  src/lib/db-crypto.ts (application d'administration) est la JUMELLE
 *  TypeScript — mêmes constantes, même format (précédent : Task 21 qui
 *  duplique storage-crypto.ts dans scripts/portail-server.js). Un test E2E
 *  vérifie l'interopérabilité (écriture côté admin, lecture côté portail).
 *
 *  Utilisé par : scripts/portail-server.js, scripts/chiffrer-base.js,
 *                scripts/sauvegarde-bd.js, tests.
 *  0 dépendance (module crypto natif Node).
 * ============================================================================
 */
"use strict";

const crypto = require("crypto");

/* ------------------------------------------------------------------ */
/* Constantes (⚠ IDENTIQUES dans src/lib/db-crypto.ts)                 */
/* ------------------------------------------------------------------ */

const PREFIXE_ALEA = "encbd1:";
const PREFIXE_DET = "encbd1d:";
const SEL_CLE_ALEA = "autorh-db-aleatoire-v1";
const SEL_CLE_DET = "autorh-db-deterministe-v1";
const SEL_CLE_MAC = "autorh-db-mac-v1";
const TAILLE_IV = 12;
const TAILLE_TAG = 16;

/**
 * Carte des modèles/colonnes chiffrés (⚠ IDENTIQUE dans db-crypto.ts et
 * chiffrer-base.js). "det" = chiffrement DÉTERMINISTE (cherché par égalité
 * en SQL : PortalAccess.cin pour la connexion au portail, User.email pour
 * la connexion RH/IT) ; "alea" = IV aléatoire (protection maximale).
 */
const CARTE_CHAMPS = {
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
      // (Task v0.2.50) anomalies nom/prénom détectées à l'import.
      "anomalieNom",
    ],
  },
  // (SYNCHRONISÉ Task 173 avec db-crypto.ts — la copie était restée à
  // l'état Task 32 : passwordHash, initialPasswordEnc, mailEnvoyeA, email
  // et nomPrenom sont chiffrés comme les autres champs sensibles.)
  PortalAccess: {
    det: ["cin"],
    alea: ["totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA", "email", "nomPrenom"],
  },
  User: { det: ["email"], alea: ["name"] },
  ImportLog: { det: [], alea: ["cinDetected", "fileName", "message"] },
  MailConfig: { det: [], alea: ["username", "password", "imapUser", "imapPassword"] },
  DemandeAdministrative: {
    det: ["cin"],
    alea: ["donnees", "destinataire", "employeEmail"],
  },
};

/* ------------------------------------------------------------------ */
/* Dérivation des clés (mise en cache par processus)                   */
/* ------------------------------------------------------------------ */

function materielSecret() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

let _cles = null;
function cles() {
  if (!_cles) {
    const secret = materielSecret();
    _cles = {
      alea: crypto.scryptSync(secret, SEL_CLE_ALEA, 32),
      det: crypto.scryptSync(secret, SEL_CLE_DET, 32),
      mac: crypto.scryptSync(secret, SEL_CLE_MAC, 32),
    };
  }
  return _cles;
}

/** Permet aux tests d'utiliser un .env temporaire (redémarre le cache). */
function reinitialiserCles() {
  _cles = null;
}

/* ------------------------------------------------------------------ */
/* Chiffrement / déchiffrement d'un champ                              */
/* ------------------------------------------------------------------ */

/**
 * Chiffre une valeur de champ de base de données.
 * - null / undefined / ""            → renvoyés tels quels ;
 * - valeur déjà préfixée (encbd1…)   → renvoyée telle quelle (idempotent) ;
 * - sinon → AES-256-GCM, IV aléatoire, ou IV déterministe si `deterministe`.
 */
function chiffrerChamp(valeur, deterministe) {
  if (valeur === null || valeur === undefined) return valeur;
  const texte = String(valeur);
  if (texte === "") return valeur;
  if (texte.startsWith(PREFIXE_ALEA) || texte.startsWith(PREFIXE_DET)) {
    return valeur; // déjà chiffré — ne jamais rechiffrer
  }
  const k = cles();
  let iv;
  if (deterministe) {
    // IV dérivé du contenu (HMAC) : même valeur → même chiffré. Permet les
    // recherches SQL par égalité (findUnique where cin/email) tout en ne
    // laissant RIEN de lisible. Fuite admise : égalité (deux CIN identiques
    // produisent la même empreinte) — sans risque pour ce cas d'usage local.
    iv = crypto
      .createHmac("sha256", k.mac)
      .update(texte, "utf8")
      .digest()
      .subarray(0, TAILLE_IV);
  } else {
    iv = crypto.randomBytes(TAILLE_IV);
  }
  const chiffre = crypto.createCipheriv("aes-256-gcm", deterministe ? k.det : k.alea, iv);
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

/**
 * Déchiffre une valeur de champ.
 * - null / undefined / valeur sans préfixe → renvoyée telle quelle
 *   (compatibilité totale avec les données claires historiques) ;
 * - valeur préfixée → AES-256-GCM (l'authentification GCM échoue si la clé
 *   ne correspond pas : voir message d'erreur explicite).
 */
function dechiffrerChamp(valeur) {
  if (valeur === null || valeur === undefined) return valeur;
  const texte = String(valeur);
  const deterministe = texte.startsWith(PREFIXE_DET);
  if (!deterministe && !texte.startsWith(PREFIXE_ALEA)) return valeur;
  try {
    const parties = texte.split(":");
    // encbd1(d) : iv : tag : données — le base64 peut contenir « : » ? NON,
    // l'alphabet base64 standard n'utilise pas « : » → split sûr.
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
        (e && e.message ? e.message : String(e))
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers objet / liste par modèle                                    */
/* ------------------------------------------------------------------ */

/** Chiffre les champs sensibles d'un objet `data` prêt pour Prisma. */
function chiffrerObjet(modele, objet) {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !objet) return objet;
  const sortie = Object.assign({}, objet);
  for (const c of carte.det) {
    if (c in sortie) sortie[c] = chiffrerChamp(sortie[c], true);
  }
  for (const c of carte.alea) {
    if (c in sortie) sortie[c] = chiffrerChamp(sortie[c], false);
  }
  return sortie;
}

/** Déchiffre les champs sensibles présents dans une ligne lue de la base. */
function dechiffrerObjet(modele, objet) {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !objet) return objet;
  const sortie = Object.assign({}, objet);
  for (const c of carte.det) {
    if (sortie[c] !== undefined && sortie[c] !== null) {
      sortie[c] = dechiffrerChamp(sortie[c]);
    }
  }
  for (const c of carte.alea) {
    if (sortie[c] !== undefined && sortie[c] !== null) {
      sortie[c] = dechiffrerChamp(sortie[c]);
    }
  }
  return sortie;
}

/** Chiffre la clause `where` quand elle cible un champ déterministe. */
function chiffrerWhere(modele, where) {
  const carte = CARTE_CHAMPS[modele];
  if (!carte || !where || typeof where !== "object") return where;
  const sortie = Object.assign({}, where);
  for (const c of carte.det) {
    if (typeof sortie[c] === "string") {
      sortie[c] = chiffrerChamp(sortie[c], true);
    }
  }
  return sortie;
}

/** Champ chiffré ? (contrôle / migration) */
function estChiffre(valeur) {
  return (
    typeof valeur === "string" &&
    (valeur.startsWith(PREFIXE_ALEA) || valeur.startsWith(PREFIXE_DET))
  );
}

module.exports = {
  PREFIXE_ALEA,
  PREFIXE_DET,
  CARTE_CHAMPS,
  chiffrerChamp,
  dechiffrerChamp,
  chiffrerObjet,
  dechiffrerObjet,
  chiffrerWhere,
  estChiffre,
  reinitialiserCles,
};
