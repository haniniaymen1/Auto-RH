#!/usr/bin/env node
/**
 * ============================================================
 *  Fiches de Paie - PORTAIL EMPLOYES
 *  (MODIFIÉ Task 64 : accès SÉCURISÉ par CIN + MOT DE PASSE,
 *   changement OBLIGATOIRE à la première connexion puis
 *   TOUS LES 15 JOURS — remplace l'ancien code OTP)
 * ============================================================
 *
 *  - Une seule page web protégée par connexion : numéro de CIN + mot de passe.
 *  - Chaque accès est créé par l'administration RH/IT (onglet « Accès
 *    portail ») avec un MOT DE PASSE INITIAL à usage unique : à la première
 *    connexion, l'employé est OBLIGÉ de choisir son propre mot de passe.
 *  - NOUVEAU (Task 64) : le mot de passe EXPIRE TOUS LES 15 JOURS — à la
 *    prochaine connexion, le changement est de nouveau OBLIGATOIRE. La même
 *    politique s'applique côté administration (RH/IT/superadmin).
 *  - AUCUN SMS, AUCUN e-mail : tout est vérifié 100 % localement.
 *  - Tourne sur son PROPRE PORT (4001 par defaut), different du
 *    port de l'administration (4000, protege par login RH/IT).
 *  - Lit la MEME base SQLite (db/custom.db) et les MEMES PDF
 *    (storage/payslips/) que l'application d'administration.
 *  - Aucune dépendance supplémentaire : Node + @prisma/client.
 *
 *  Securite integree :
 *   - connexion = CIN + mot de passe (scrypt, comparaison à temps constant) ;
 *   - (NOUVEAU Task 74, MODIFIÉ Task 75, MODIFIÉ Task 76, MODIFIÉ Task 85)
 *     VÉRIFICATION EN DEUX ÉTAPES À CHAQUE CONNEXION : après CIN + mot de
 *     passe VALIDÉS, la fenêtre de confirmation /otp affiche LE QR CODE —
 *     UNIQUEMENT le QR code, AUCUN code OTP n'est JAMAIS affiché en clair
 *     (demande utilisateur Task 85 : « jamais affiche le code otp comme ca,
 *     dans cette fenetre n affiche que qr code qui expire apres 10 minute »)
 *     — il expire après 10 MINUTES (expire = reconnexion). L'employé scanne
 *     le QR code avec son APPLICATION D'AUTHENTIFICATION puis saisit le code
 *     à 6 chiffres qu'elle génère pour ouvrir réellement sa session. Le
 *     parcours en une étape (Task 82 : CIN + mot de passe + code OTP dans le
 *     formulaire de connexion) reste disponible à chaque connexion.
 *   - (NOUVEAU Task 78) QR CODE AU FORMAT STANDARD « otpauth://totp/… » :
 *     l'ancien QR encodait un JSON {app, objet, code, expire} qu'AUCUNE
 *     application d'authentification ne savait interpréter (retour
 *     utilisateur : « application authenticator cannot interpret qr code »).
 *     Désormais le QR encode l'URI STANDARD (spec « Key URI Format » — label
 *     "AutoRH:Espace employé" (MODIFIÉ Task 88 puis v0.2.105 : l'Account
 *     Name affiché par l'application d'authentification est
 *     « Espace employé », PLUS le CIN — le numéro national ne figure plus
 *     sur l'écran du téléphone), secret
 *     Base32 PERSISTANT de l'employé, SHA1, 6 chiffres,
 *     période 30 s), lisible par Google Authenticator, Microsoft
 *     Authenticator, Authy, FreeOTP… : l'application ajoute le compte et
 *     génère les codes OTP. (MODIFIÉ Task 85) /api/otp/verify n'accepte PLUS
 *     QUE les codes TOTP de l'application (tolérance ±1 fenêtre, anti-rejeu
 *     via lastUsedWindow) — AUCUN code n'est affiché à l'écran.
 *   - (NOUVEAU Task 80) LA FENÊTRE DE PREMIÈRE CONNEXION AFFICHE UNIQUEMENT
 *     LE QR CODE (demande utilisateur : « Dans cette fenêtre, afficher
 *     uniquement le QR code ») : la page /otp du mode première connexion est
 *     désormais une page d'INSCRIPTION DÉDIÉE — le QR code, RIEN D'AUTRE
 *     (l'ancien contenu — code affiché, compte à rebours, formulaire de
 *     confirmation, boutons « Générer un nouveau code » / « Se déconnecter »
 *     — est RETIRÉ de cette fenêtre). Après avoir scanné le QR code,
 *     l'employé se RECONNECTE avec son CIN et son mot de passe : la page /otp
 *     de confirmation (code affiché + saisie) s'ouvre alors — même parcours
 *     que les connexions suivantes (CIN + mot de passe + OTP). Le verrou
 *     d'affichage devient `!acc.lastLoginAt && !acc.qrPresente` (NOUVEAU champ
 *     PortalAccess.qrPresente, posé quand la page QR est servie) : le QR ne
 *     s'affiche qu'UNE SEULE fois, même si le défi est annulé (5 erreurs) ou
 *     expiré — le RH/IT peut le ré-afficher ou le RÉINITIALISER depuis la
 *     NOUVELLE section « Gestion des QR codes » de l'onglet « Accès portail »
 *     (administration). En cohérence, /api/otp/verify REFUSE le code tant que
 *     le défi est en mode première connexion (la fenêtre QR n'a plus de
 *     formulaire : la confirmation se fait APRÈS reconnexion).
 *   - (NOUVEAU Task 82) CHAMP « CODE OTP » DANS LE FORMULAIRE DE CONNEXION
 *     (retours utilisateur : « Il n'y a pas de champ permettant de saisir
 *     l'OTP. » + « le même problème se produit lorsque le CIN ou le mot de
 *     passe est incorrect » + « Le changement du mot de passe initial ne
 *     s'affiche pas ») : le formulaire de connexion affiche un 3ᵉ champ
 *     « Code OTP (application d'authentification) ». L'employé inscrit via
 *     le QR saisit CIN + mot de passe + code OTP en UNE étape :
 *     /api/verify vérifie le code TOTP (tolérance ±1 fenêtre, anti-rejeu
 *     lastUsedWindow) et ouvre la session COMPLÈTE — avec redirection vers
 *     /changer quand le changement du mot de passe initial est dû (la page
 *     de changement s'affiche donc dès la connexion en une étape). Code
 *     incorrect aux connexions suivantes = même traitement qu'un mauvais
 *     mot de passe (compteur + verrouillage) avec message explicite ;
 *     code parasite à la PREMIÈRE connexion = ignoré (parcours QR intact,
 *     y compris le QR montré par le RH : code valable → connexion directe).
 *     Champ VIDE = parcours en deux étapes inchangé (défi + page /otp).
 *   - (NOUVEAU Task 83 — MAQUETTE UTILISATEUR) PREMIÈRE CONNEXION EN 2
 *     ÉTAPES SUR PAGES DÉDIÉES :
 *       étape 1  /premiere : CIN + Mot de passe initial + Nouveau mot de
 *                  passe + Répéter le nouveau mot de passe + « Valider »
 *                  (/api/premiere : identification + changement du mot de
 *                  passe initial en une requête — le changement s'affiche
 *                  DÈS la première connexion) ;
 *       étape 2  /otp (mode première) : QR code + champ « Code OTP » +
 *                  mention « Le QR code expire dans 10 minutes. » +
 *                  « Valider » (REMPLACE la page « QR seul » Task 80) ;
 *       réussite /premiere-reussie : « Configuration réussie » + encadré
 *                  « Le QR code n'est affiché que lors de la première
 *                  connexion. » + « Aller à la page de connexion » (MODIFIÉ
 *                  Task 87 : retour à la FENÊTRE INITIALE de connexion —
 *                  CIN + mot de passe + code OTP — et non au portail).
 *     /api/verify oriente automatiquement vers /premiere tout compte
 *     mustChangePassword (première connexion ou accès réinitialisé) ;
 *     /api/otp/verify accepte de nouveau le code PENDANT l'inscription
 *     (le refus Task 80 OTP_QR_A_SCANNER est supprimé). Le QR ne s'affiche
 *     qu'UNE SEULE FOIS (verrou qrPresente) et JAMAIS aux connexions
 *     suivantes. Design modernisé sur TOUTES les pages (fond clair bleuté,
 *     cartes blanches arrondies, ombres légères, cercles icônes bleus,
 *     champs à œil, boutons verts) — maquette fournie par l'utilisateur.
 *   - (MODIFIÉ Task 84) CERCLES DU PORTAIL EN VERT puis ORANGE LOGO (Task 143 ; retour initial :
 *     « change le de ces cercle vers vert » + capture du cercle bleu « 2 »
 *     de la page /otp) : les cercles des têtes de carte — badge d'étape
 *     .etq-etape (1, 2) ET cercles icônes .icon-rond (cadenas, clé) —
 *     passent du BLEU au VERT puis au vert émeraude #10b981 (même orange que les boutons),
 *     ombres portées orangées rgba(16,185,129,.28). AUCUNE règle fonctionnelle
 *     touchée : couleurs uniquement, 4 blocs CSS (connexion, /changer,
 *     CSS_OTP partagé, fiches).
 *   - (NOUVEAU Task 85) LA FENÊTRE DE CONFIRMATION OTP N'AFFICHE JAMAIS LE
 *     CODE (retour utilisateur : « jamais affiche le code otp comme ca » +
 *     capture du code « 963 903 » affiché en clair) : la page /otp des
 *     connexions SUIVANTES est alignée sur la fenêtre d'inscription —
 *     QR code (URI otpauth://totp standard, secret persistant) + mention
 *     « Le QR code expire dans 10 minutes. » + champ « Code OTP » +
 *     « Valider » + « Se déconnecter ». Le mécanisme « code à usage unique
 *     affiché à l'écran » est SUPPRIMÉ : plus de bloc code, plus de compte
 *     à rebours du code, plus de bouton « Générer un nouveau code », plus
 *     d'endpoint /api/otp/nouveau, plus de code stocké dans le défi — la
 *     SEULE voie de confirmation est le code TOTP de l'application
 *     d'authentification (lecture du QR). À l'expiration (10 min), la page
 *     bascule vers « Code OTP expiré » → reconnexion CIN + mot de passe.
 *   - (NOUVEAU Task 86) LE QR CODE D'INSCRIPTION EXPIRE VRAIMENT (retour
 *     utilisateur : « Qr code n'expire pas apres 10 minute vérifier ») :
 *     jusqu'ici le secret TOTP était PERSISTANT dès la première validation
 *     CIN + mot de passe — la fenêtre expirait, mais le QR scanné restait
 *     valable POUR TOUJOURS (le même QR revenait à chaque reconnexion et
 *     son code était accepté). DÉSORMAIS, tant que l'inscription n'est pas
 *     confirmée (lastLoginAt null), le secret encodé par le QR est une
 *     FENÊTRE de 10 minutes (nouveau champ PortalAccess.otpFenetreCreeA) :
 *     il est RÉGÉNÉRÉ à chaque nouvelle fenêtre — l'ancien QR scanné devient
 *     DÉFINITIVEMENT inutilisable et un NOUVEAU QR (nouveau secret, image
 *     différente) est affiché à la reconnexion — et n'est SCELLÉ (secret
 *     définitif, otpFenetreCreeA repassé à null) que par la CONFIRMATION du
 *     code. La fenêtre du défi est ALIGNÉE sur la vie du secret (QR et
 *     fenêtre expirent ENSEMBLE) ; /api/otp/verify refuse (410) tout code
 *     dont la fenêtre de secret est dépassée ; le compte à rebours restant
 *     est AFFICHÉ sur la fenêtre QR (« Le QR code expire dans mm:ss »).
 *     L'administration s'aligne : « Afficher le QR » d'un employé non inscrit
 *     régénère la fenêtre si elle est dépassée (QR toujours vivant), statut
 *     « QR expiré » visible dans « Gestion des QR codes » (Task 80).
 *   - (NOUVEAU Task 90) APRÈS LE SCAN DU QR CODE, RETOUR À LA FENÊTRE
 *     INITIALE DE CONNEXION — MÊME QUAND L'INSCRIPTION SE TERMINE SUR UN
 *     DÉFI NON « PREMIERE » (retour utilisateur : « Apres le scan du QR
 *     code, je veux etre redirige vers la page d inscription initiale
 *     (CIN, Mot de passe, OTP) » + « le système me redirige vers
 *     l'interface Vos fiches de paie — je ne souhaite pas cette
 *     redirection ») : lorsqu'un employé N'AYANT JAMAIS completé de
 *     connexion (lastLoginAt null) confirme le code d'un QR de fenêtre non
 *     scellée (otpFenetreCreeA non null — cas du QR expiré puis re-scanne
 *     à la reconnexion, Tasks 85/86), /api/otp/verify N'OUVRE PLUS le
 *     portail directement : la réponse renvoie redirect=/premiere-reussie
 *     et la page « Configuration réussie » referme la session (Task 87)
 *     puis ramène à la FENÊTRE INITIALE (CIN + mot de passe + code OTP).
 *     Un employé DÉJÀ INSCRIT (secret scellé) ouvre toujours son espace
 *     directement : connexion normale à deux facteurs inchangée.
 *   - (NOUVEAU Task 87) APRÈS LA FENÊTRE « CONFIGURATION RÉUSSIE »,
 *     RETOUR À LA FENÊTRE INITIALE DE CONNEXION (retour utilisateur :
 *     « apres cette fenetre derige vers fenetre initial (cin, mot de
 *     passe, otp) ») : la page /premiere-reussie N'OUVRE PLUS le portail —
 *     la session créée par l'inscription est FERMÉE (cookie effacé au
 *     moment où la page est servie), le texte annonce la fenêtre de
 *     connexion (CIN, mot de passe et code OTP), la redirection
 *     automatique (5 s) ET le bouton mènent à /login. L'employé
 *     re-saisit donc ses identifiants + son code OTP pour entrer au
 *     portail : le parcours complet d'authentification à deux facteurs
 *     est validé DÈS la première connexion.
 *   - session = cookie httpOnly signé HMAC-SHA256 (30 minutes par défaut,
 *     configurable ; option « Se souvenir de moi » — Task 33) ;
 *   - session « pending » 10 minutes pour le changement OBLIGATOIRE du mot
 *     de passe : AUCUN accès aux fiches tant que le changement n'est pas fait ;
 *   - chaque employé ne peut consulter QUE les fiches de SON CIN
 *     (la recherche et les PDF sont verrouillés sur la session) ;
 *   - anti force-brute : compteur d'échecs + verrouillage temporaire ;
 *   - le telechargement d'un PDF revérifie le CIN dans le
 *     contenu de la fiche (impossible d'y acceder sans lui) ;
 *   - limiteur de requetes par adresse IP (anti-énumeration) ;
 *   - metadonnees minimales renvoyees (pas de contenu brut).
 *
 *  Lancement :
 *      node scripts/portail-server.js
 *  Variables (optionnelles) :
 *      PORTAL_PORT=4001   numero de port du portail
 *      HOSTNAME=0.0.0.0   0.0.0.0 = accessible depuis le reseau
 * ============================================================
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
// NOUVEAU (Task 18) : crypto natif — signature des sessions + TOTP (RFC 6238)
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
// (NOUVEAU Task 32) chiffrement des champs sensibles de la base — même
// bibliothèque que scripts/chiffrer-base.js (jumelle de src/lib/db-crypto.ts).
const cryptoBd = require("./lib-crypto-bd.js");
// NOUVEAU (Task 74) : génération du QR code du défi OTP — paquet « qrcode »
// DÉJÀ présent dans node_modules, rendu SVG côté serveur (aucune ressource
// externe, aucun CDN : la page reste 100 % autonome).
const QRCode = require("qrcode");

// ---------- Racine du projet (independante du repertoire courant) ----------
const ROOT = path.join(__dirname, "..");

// ---------- Chargement du .env de la racine (sans ecraser l'existant) ----------
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
})();

// (MODIFIÉ Task 64) port par défaut du portail : 4001 (l'administration : 4000)
const PORT = parseInt(process.env.PORTAL_PORT || process.env.PORT || "4001", 10);
const HOST = process.env.HOSTNAME || "0.0.0.0";
// ---------- (ANCIEN, CONSERVÉ) Dossier des PDF stockés ----------
const STORAGE_DIR = path.join(ROOT, "storage", "payslips");

// ---------- (NOUVEAU) Racine du site dérivée de DATABASE_URL ----------
// Les scripts de démarrage écrivent DATABASE_URL=file:<racine>/db/custom.db
// (chemin ABSOLU). On en déduit le dossier du site d'administration même
// si le portail est lancé depuis ailleurs.
function rootFromDatabaseUrl() {
  const m = String(process.env.DATABASE_URL || "").match(
    /^file:(.+)[/\\]db[/\\][^/\\]+\.db\/?$/i
  );
  if (!m) return null;
  try { return path.resolve(m[1]); } catch { return null; }
}
const DB_ROOT = rootFromDatabaseUrl();

// ---------- (NOUVEAU, étendu) Résolution MULTI-CANDIDATS du dossier des PDF ----------
// Le portail et le site d'administration doivent lire les MÊMES fichiers.
// CORRECTIF « Fichier PDF introuvable sur le serveur » : le serveur de
// production Next.js « standalone » force process.chdir(__dirname) — le site
// écrivait donc ses PDF dans <racine>/.next/standalone/storage/payslips/
// au lieu de <racine>/storage/payslips/. Le portail examine désormais TOUS
// les emplacements possibles, dans l'ordre (le premier dossier contenant
// réellement le fichier gagne) :
//   1. variable d'environnement STORAGE_DIR              (override explicite)
//   2. variable d'environnement AUTO_RH_STORAGE_DIR     (posée par les scripts de démarrage)
//   3. <dossier du portail>/storage/payslips             (ancien comportement)
//   4. <répertoire de lancement>/storage/payslips        (site lancé depuis un autre cwd)
//   5. <dossier parent du portail>/storage/payslips      (copie imbriquée)
//   6. <racine déduite de DATABASE_URL>/storage/payslips (dossier du site détecté)
//   7. <dossier du portail>/.next/standalone/storage/payslips  (PDF écrits par l'ancien bug)
//   8. <répertoire de lancement>/.next/standalone/storage/payslips
const STORAGE_CANDIDATES = [...new Set(
  [
    process.env.STORAGE_DIR,
    process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR,
    STORAGE_DIR,
    path.join(process.cwd(), "storage", "payslips"),
    path.join(path.dirname(ROOT), "storage", "payslips"),
    DB_ROOT ? path.join(DB_ROOT, "storage", "payslips") : null,
    path.join(ROOT, ".next", "standalone", "storage", "payslips"),
    path.join(process.cwd(), ".next", "standalone", "storage", "payslips"),
  ].filter(Boolean)
)];
// (MODIFIÉ 0.2.60 — pagination complète du portail) l'ancien plafond
// MAX_RESULTS = 100 TRONQUAIT silencieusement la liste de l'employé :
// l'administration affichait p. ex. « 551 fiches … page 1 sur 6 » quand le
// portail s'arrêtait à 100 fiches sans aucune navigation. Plus AUCUN plafond
// masqué : la recherche trouve TOUTES les fiches du CIN de session, puis les
// résultats sont servis PAR PAGES (défaut 100/page — même découpage que
// l'administration, Task 99), navigables sans perte ni doublon.
const PAR_PAGE_DEFAUT = 100;
const PAR_PAGE_MAX = 500;

// (NOUVEAU) Recherche APPROFONIE : parcourt récursivement le dossier du site
// (hors node_modules et .git) pour retrouver un PDF égaré dans n'importe quel
// sous-dossier « storage/payslips ». Utilisée seulement si aucun candidat ne
// contient le fichier ; le résultat est mis en cache pour la suite.
const DEEP_SEARCH_ROOTS = [...new Set([ROOT, process.cwd(), DB_ROOT].filter(Boolean))];
const deepFoundDirs = new Set();
function deepFindStoredFile(storedName) {
  const SKIP = new Set(["node_modules", ".git"]);
  for (const base of DEEP_SEARCH_ROOTS) {
    const stack = [{ dir: base, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      if (depth > 6) continue;
      // Ce dossier contient-il le fichier cherché (sous storage/payslips) ?
      const direct = path.join(dir, "storage", "payslips", storedName);
      try {
        if (fs.statSync(direct).isFile()) {
          deepFoundDirs.add(path.join(dir, "storage", "payslips"));
          return direct;
        }
      } catch {}
      // Descendre dans les sous-dossiers (y compris .next — c'est précisément
      // là que l'ancien bug rangeait les PDF, dans .next/standalone/storage/).
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (SKIP.has(e.name)) continue;
        stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
      }
    }
  }
  return null;
}

// (NOUVEAU) Cherche un PDF stocké dans les dossiers candidats, dans l'ordre,
// puis (nouveau) via la recherche approfondie. Retourne { filePath, dir }
// dès qu'un dossier contient réellement le fichier,
// sinon { filePath: null, tried: [...] } pour le message de diagnostic.
function findStoredFile(storedName) {
  const tried = [];
  for (const dir of STORAGE_CANDIDATES) {
    const p = path.join(dir, storedName);
    tried.push(p);
    try {
      if (fs.statSync(p).isFile()) return { filePath: p, dir, tried };
    } catch {}
  }
  // (NOUVEAU) dossiers déjà découverts par une recherche approfondie antérieure
  for (const dir of deepFoundDirs) {
    const p = path.join(dir, storedName);
    tried.push(p + "  (recherche approfondie)");
    try {
      if (fs.statSync(p).isFile()) return { filePath: p, dir, tried };
    } catch {}
  }
  // (NOUVEAU) recherche approfondie (une seule fois par fichier demandé)
  const deep = deepFindStoredFile(storedName);
  if (deep) {
    tried.push(deep + "  (recherche approfondie — TROUVÉ)");
    return { filePath: deep, dir: path.dirname(deep), tried };
  }
  return { filePath: null, dir: null, tried };
}

// ---------- (NOUVEAU Task 21) Chiffrement AES-256 du stockage ----------
// Identique à src/lib/storage-crypto.ts (mêmes constantes, même dérivation).
// Les fiches importées depuis la Task 21 sont chiffrées sur le disque
// (en-tête PAIESAGE1 + AES-256-GCM) ; les fiches historiques en clair
// restent lues telles quelles — compatibilité totale, rien n'est retiré.
const ENC_MAGIC = Buffer.from("PAIESAGE1", "utf8");
const ENC_NONCE_LEN = 12;
const ENC_TAG_LEN = 16;
const ENC_SALT = "autorh-storage-v1";

function encKeyMaterial() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

let _encKeyCache = null;
function encKey() {
  if (!_encKeyCache) _encKeyCache = crypto.scryptSync(encKeyMaterial(), ENC_SALT, 32);
  return _encKeyCache;
}

function isEncryptedBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length > ENC_MAGIC.length &&
    buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)
  );
}

// Déchiffre si nécessaire ; fichier historique en clair => renvoyé tel quel.
function decryptFromStorage(buf) {
  if (!isEncryptedBuffer(buf)) return buf;
  const nonceStart = ENC_MAGIC.length;
  const tagStart = nonceStart + ENC_NONCE_LEN;
  const dataStart = tagStart + ENC_TAG_LEN;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encKey(),
    buf.subarray(nonceStart, tagStart)
  );
  decipher.setAuthTag(buf.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(buf.subarray(dataStart)), decipher.final()]);
}

// (NOUVEAU Task 122) Chiffrement d'un DOCUMENT de demande au stockage —
// jumelle exacte d'encryptForStorage() de src/lib/storage-crypto.ts (mêmes
// en-tête PAIESAGE1, nonce 12 octets, tag GCM 16 octets, clé scrypt). Les
// documents transmis par le RH par e-mail sont donc chiffrés sur le disque
// comme les fiches de paie. Idempotent : un buffer déjà chiffré est renvoyé
// tel quel ; AUTO_RH_STORAGE_DISABLE=1 conserve le comportement historique.
function storageEncryptionActive() {
  return process.env.AUTO_RH_STORAGE_DISABLE !== "1";
}
function encryptForStorage(buf) {
  if (!storageEncryptionActive() || isEncryptedBuffer(buf)) return buf;
  const nonce = crypto.randomBytes(ENC_NONCE_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, nonce, tag, ciphertext]);
}

// ---------- Normalisation IDENTIQUE a l'application d'administration ----------
// (majuscules + suppression des espaces ; NOUVEAU : aussi des points, tirets
//  et slashs pour retrouver un CIN écrit "26 542 351", "9593-1034", …)
function normalizeText(t) {
  return String(t || "").toUpperCase().replace(/[\s.\/\-]/g, "");
}

// ---------- Recherche EXACTE de CIN ----------
// Le CIN saisi doit apparaitre comme numero COMPLET dans le contenu du PDF
// (pas comme une partie d'un autre numero). Ex. : chercher "12345" ne
// renvoie PAS les fiches contenant "09123456" ni "A123456".
// - ANCIEN (conserve) : espaces interieurs tolérés (artefact PDF "A 123456").
// - NOUVEAU : points, tirets et slashs aussi tolérés entre les caracteres
//   ("26 542 351", "9593-1034", "270.482.81", "38/346/578"), avec des gardes
//   supplementaires pour qu'une PARTIE de CIN ne corresponde jamais
//   (ex. "542351" ne correspond PAS a "26 542 351").
function exactCinRegex(query) {
  const q = normalizeText(query);
  if (!q) return null;
  const sep = "[\\s./\\-]*";
  const escaped = q
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(sep);
  // (CORRECTIF « l'employé ne voit pas sa fiche », identique au site admin) :
  // la 2e garde gauche rejetait à tort les CIN ALPHANUMÉRIQUES précédés
  // d'un autre numéro sur la même ligne (« SPECIMEN-001 SPEC-0001 » → le
  // « 001 » faisait échouer la garde). Elle ne s'applique plus qu'aux CIN
  // NUMÉRIQUES — comportement numérique strictement inchangé.
  const purelyNumeric = /^[0-9]+$/.test(q);
  const leftGuard = purelyNumeric ? "(?<![0-9A-Z][ \\t./\\-])" : "";
  return new RegExp(
    "(?<![A-Z0-9])" + leftGuard + escaped +
      "(?![A-Z0-9])(?![ \\t./\\-]{1,4}[0-9])"
  );
}

function isExactCinInContent(content, query) {
  const re = exactCinRegex(query);
  return re ? re.test(String(content || "").toUpperCase()) : false;
}

// ---------- Base de donnees ----------
const prisma = new PrismaClient({ log: ["error"] });

function isDbError(err) {
  // P1001 : base introuvable, P2021 : table introuvable, P1003 : fichier absent
  return err && (err.code === "P1001" || err.code === "P2021" || err.code === "P1003");
}

// ---------- Limiteur de requetes par IP (anti-abus) ----------
const RATE = {
  verify: { max: 15, windowMs: 60 * 1000 }, // (Task 18) 15 connexions / minute / IP
  // (NOUVEAU Task 83) seau DÉDIÉ à /api/premiere (identification + changement
  // du mot de passe initial en une requête) — ne consomme PAS le quota de
  // /api/verify : les deux parcours restent indépendants pour l'employé.
  premiere: { max: 15, windowMs: 60 * 1000 }, // 15 premières connexions / minute / IP
  change: { max: 10, windowMs: 60 * 1000 }, // NOUVEAU (Task 64) : 10 changements de mot de passe / minute / IP
  otp: { max: 20, windowMs: 60 * 1000 }, // NOUVEAU (Task 74) : 20 vérifications/générations OTP / minute / IP
  search: { max: 30, windowMs: 60 * 1000 }, // 30 recherches / minute / IP
  file: { max: 60, windowMs: 60 * 1000 }, // 60 fichiers   / minute / IP
};
const buckets = new Map(); // ip -> { verify: [t], change: [timestamps], search: [timestamps], file: [timestamps] }

function allowRequest(ip, kind) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { verify: [], premiere: [], change: [], otp: [], search: [], file: [] };
    buckets.set(ip, b);
  }
  const arr = b[kind];
  const cfg = RATE[kind];
  while (arr.length && now - arr[0] > cfg.windowMs) arr.shift();
  if (arr.length >= cfg.max) return false;
  arr.push(now);
  return true;
}

// Purge periodique des compteurs vides (evite toute fuite memoire)
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    b.verify = b.verify.filter((t) => now - t <= RATE.verify.windowMs);
    b.premiere = b.premiere.filter((t) => now - t <= RATE.premiere.windowMs);
    b.change = b.change.filter((t) => now - t <= RATE.change.windowMs);
    b.otp = b.otp.filter((t) => now - t <= RATE.otp.windowMs);
    b.search = b.search.filter((t) => now - t <= RATE.search.windowMs);
    b.file = b.file.filter((t) => now - t <= RATE.file.windowMs);
    if (!b.verify.length && !b.premiere.length && !b.change.length && !b.otp.length && !b.search.length && !b.file.length)
      buckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ============================================================
//  (MODIFIÉ Task 64) : SÉCURITÉ — sessions signées + MOT DE PASSE
// ============================================================

// ---------- Secret de signature (même .env que l'administration) ----------
// Identique à src/lib/auth.ts : AUTH_SECRET, sinon valeur par défaut partagée.
function authSecret() {
  return process.env.AUTH_SECRET || "autorh-secret-local-a-changer-dans-env";
}

// ---------- (MODIFIÉ Task 64) Session portail : cookie signé ----------
const PORTAL_COOKIE = "portail_session";
function lireMinutesEnv(nom, defaut) {
  const n = parseInt(String(process.env[nom] || "").trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= 525600 ? n : defaut; // plafond : 1 an
}
const PORTAL_SESSION_MINUTES = lireMinutesEnv("PORTAL_SESSION_MAX_AGE_MINUTES", 30);
const PORTAL_REMEMBER_MINUTES = lireMinutesEnv("PORTAL_SESSION_REMEMBER_MINUTES", 30 * 24 * 60);
const SESSION_MAX_AGE = PORTAL_SESSION_MINUTES * 60; // (MODIFIÉ Task 33 : configurable, défaut IDENTIQUE)
const REMEMBER_MAX_AGE = PORTAL_REMEMBER_MINUTES * 60; // NOUVEAU (Task 33)
// Libellé humain de la durée « souvenir » (injecté dans la page de connexion)
const LIBELLE_SOUVENIR =
  PORTAL_REMEMBER_MINUTES % 1440 === 0
    ? PORTAL_REMEMBER_MINUTES / 1440 + " jour" + (PORTAL_REMEMBER_MINUTES >= 2880 ? "s" : "")
    : PORTAL_REMEMBER_MINUTES % 60 === 0
      ? PORTAL_REMEMBER_MINUTES / 60 + " heure" + (PORTAL_REMEMBER_MINUTES >= 120 ? "s" : "")
      : PORTAL_REMEMBER_MINUTES + " minute" + (PORTAL_REMEMBER_MINUTES >= 2 ? "s" : "");

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

// ---------- NOUVEAU (Task 64) : POLITIQUE MOT DE PASSE — 15 JOURS ----------
// IDENTIQUE à src/lib/password-policy.ts (administration) : TOUS les
// utilisateurs — employés du portail, RH, IT, superadministrateur — doivent
// changer leur mot de passe tous les 15 jours.
const PASSWORD_MAX_AGE_DAYS = 15;
const PASSWORD_MAX_AGE_MS = PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** Mot de passe expiré ? null = jamais changé => EXPIRÉ. */
function estMotDePasseExpire(changedAt) {
  if (!changedAt) return true;
  const t = new Date(changedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= PASSWORD_MAX_AGE_MS;
}

/** Hachage scrypt — IDENTIQUE à src/lib/auth.ts (format « scrypt:salt:hash »). */
function hacherMotDePasse(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

/** Vérification scrypt à temps constant — IDENTIQUE à src/lib/auth.ts. */
function verifierMotDePasse(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ---------- (NOUVEAU Task 66) Saisie TOLÉRANTE du mot de passe ----------
// Le mot de passe INITIAL est AFFICHÉ « XXXX-XXXX-XXXX » pour la lecture,
// mais l'employé doit pouvoir le recopier AVEC ou SANS tirets, et un mot de
// passe collé ne doit pas échouer à cause d'un espace/retour à la ligne
// parasite. Le nettoyage retire tirets et blancs de la SAISIE uniquement.
function nettoyerMotDePasse(s) {
  return String(s == null ? "" : s).replace(/[\s-]/g, "");
}

/** (Task 66) Vérification tolérante : essaie la saisie exacte (compatibilité
 *  avec les accès déjà enregistrés), puis la saisie ramenée aux bords, puis
 *  la forme nettoyée (sans tirets ni espaces). Un seul de ces candidats doit
 *  correspondre pour accepter la connexion / la preuve d'identité. */
function verifierMotDePasseTolerant(password, stored) {
  const brut = String(password == null ? "" : password);
  const candidats = [brut, brut.trim(), nettoyerMotDePasse(brut)];
  const vus = new Set();
  for (const candidat of candidats) {
    if (!candidat || vus.has(candidat)) continue;
    vus.add(candidat);
    if (verifierMotDePasse(candidat, stored)) return true;
  }
  return false;
}

/** Règles du nouveau mot de passe (Task 64) : >= 8 caractères, différent de
 *  l'actuel, différent du CIN. Renvoie un message d'erreur ou null si OK.
 *  (Task 66 : appelé avec les formes NETTOYÉES — la longueur minimale porte
 *  donc sur les vrais caractères, hors tirets/espaces.)
 *  (MODIFIÉ Task 94 — « les mots de passe doivent être minimum 8 caractères
 *  (minuscule, majuscule, chiffre et symbole) » : POLITIQUE DE COMPLEXITÉ
 *  complète, IDENTIQUE à src/lib/password-policy.ts (validerPolitiqueMotDePasse)
 *  et aux routes d'administration. NB : la vérification porte sur la forme
 *  NETTOYÉE — un tiret « - » ou un espace saisi est ignoré à la comparaison,
 *  il ne peut donc PAS compter comme le symbole exigé : prévoyez un vrai
 *  symbole (par exemple ! ? _ % @ & *). */
function erreurPolitiqueMotDePasse(m) {
  if (!m || m.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères, avec au moins une minuscule, une majuscule, un chiffre et un symbole.";
  }
  if (m.length > 200) {
    return "Mot de passe trop long (200 caractères maximum).";
  }
  if (!/[a-z]/.test(m)) {
    return "Le mot de passe doit contenir au moins une LETTRE MINUSCULE (a-z), en plus des 8 caractères minimum.";
  }
  if (!/[A-Z]/.test(m)) {
    return "Le mot de passe doit contenir au moins une LETTRE MAJUSCULE (A-Z), en plus des 8 caractères minimum.";
  }
  if (!/[0-9]/.test(m)) {
    return "Le mot de passe doit contenir au moins un CHIFFRE (0-9), en plus des 8 caractères minimum.";
  }
  if (!/[^A-Za-z0-9]/.test(m)) {
    return "Le mot de passe doit contenir au moins un SYMBOLE (par exemple ! ? _ % @), en plus des 8 caractères minimum. NB : les tirets et espaces sont ignorés à la saisie — prévoyez un autre symbole.";
  }
  return null;
}

function validerNouveauMotDePasse(nouveau, actuel, cin) {
  // (MODIFIÉ Task 94 : politique de complexité complète en premier)
  const erreurPolitique = erreurPolitiqueMotDePasse(nouveau);
  if (erreurPolitique) return erreurPolitique;
  if (actuel && nouveau === actuel) {
    return "Le nouveau mot de passe doit être DIFFÉRENT du mot de passe actuel.";
  }
  if (cin && normalizeText(nouveau) === normalizeText(cin)) {
    return "Le nouveau mot de passe ne doit pas être votre numéro CIN.";
  }
  return null;
}

// ---------- (MODIFIÉ Task 64) Session portail : cookie signé ----------
// pending = 1 : session transitoire (10 minutes) qui OBLIGE au changement de
// mot de passe (première connexion OU expiration 15 jours OU réinitialisation
// par le RH/IT). AUCUN accès aux fiches tant que le changement n'est pas fait.
const PENDING_MAX_AGE = 10 * 60; // 10 minutes

// (Task 33) durées de session CONFIGURABLES via .env (en MINUTES)
//   PORTAL_SESSION_MAX_AGE_MINUTES   = session normale (défaut 30)
//   PORTAL_SESSION_REMEMBER_MINUTES  = session « Se souvenir de moi » (défaut 30 jours)

/**
 * (MODIFIÉ Task 74) Crée un jeton de session signé.
 * @param {string} cin      CIN de l'employé (identifiant de session)
 * @param {boolean} remember session longue « Se souvenir de moi »
 * @param {boolean} pending  true = session transitoire 10 min, changement de
 *                           mot de passe OBLIGATOIRE avant tout accès aux fiches
 * @param {boolean} otp      (Task 74) true = session transitoire 10 min, étape
 *                           « code OTP » en cours : CIN + mot de passe DÉJÀ
 *                           validés, le code affiché (QR) reste à confirmer
 */
function createPortalSession(cin, remember, pending, otp) {
  const duree =
    pending || otp ? PENDING_MAX_AGE : remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;
  const payload = b64url(
    JSON.stringify({
      cin,
      exp: Math.floor(Date.now() / 1000) + duree,
      rm: remember ? 1 : 0,
      pd: pending ? 1 : 0,
      ot: otp ? 1 : 0,
    })
  );
  const sig = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return payload + "." + sig;
}

function verifyPortalSession(token) {
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
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.exp !== "number" || p.exp * 1000 < Date.now()) return null;
    if (!p.cin || String(p.cin).length < 3) return null;
    // (MODIFIÉ Task 33) `rm` = session « souvenir » — les anciens jetons sans rm
    // restent valides (compatibilité) et sont traités comme session normale.
    // NOUVEAU (Task 64) : `pd` = session « pending » (changement de mot de
    // passe OBLIGATOIRE). Les anciens jetons sans pd sont des sessions normales.
    // NOUVEAU (Task 74) : `ot` = session « otp » (étape code OTP en cours).
    return {
      cin: String(p.cin),
      rm: p.rm === 1 || p.rm === true,
      pending: p.pd === 1 || p.pd === true,
      otp: p.ot === 1 || p.ot === true,
    };
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
    }
  }
  return out;
}

/** Retourne la session valide { cin } ou null. */
function getSessionCin(req) {
  return verifyPortalSession(parseCookies(req)[PORTAL_COOKIE]);
}

// (MODIFIÉ Task 33) maxAge optionnel : la durée du cookie s'aligne sur le type
// de session (normale ou « souvenir »). Les appels historiques restent valides.
// (MODIFIÉ Task 208) cookie « Secure » automatique en HTTPS (suffixeCookieSecure).
function setSessionCookie(res, token, maxAgeSecondes) {
  const duree =
    Number.isFinite(maxAgeSecondes) && maxAgeSecondes > 0 ? maxAgeSecondes : SESSION_MAX_AGE;
  res.setHeader(
    "Set-Cookie",
    PORTAL_COOKIE + "=" + encodeURIComponent(token) +
      "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + duree + suffixeCookieSecure(res)
  );
}

// (MODIFIÉ Task 33 + Task 64 + Task 74) RENOUVELLEMENT GLISSANT — chaque
// consultation de la page ou du chargement des fiches prolonge la session avec
// la durée d'origine (normale ou « souvenir »). Une session PENDING (changement
// de mot de passe obligatoire, Task 64) ni une session OTP (étape code OTP en
// cours, Task 74) ne sont JAMAIS prolongées : elles gardent leurs 10 minutes.
function renouvelerSession(res, sess) {
  try {
    if (!sess || !sess.cin) return;
    if (sess.pending || sess.otp) return; // Task 64/74 : pas de renouvellement d'une session transitoire
    const remember = sess.rm === true;
    setSessionCookie(
      res,
      createPortalSession(sess.cin, remember, false),
      remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE
    );
  } catch {
    // renouvellement « best effort » — ne doit jamais bloquer la requête
  }
}

// (MODIFIÉ Task 208) « Secure » automatique en HTTPS, comme setSessionCookie.
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", PORTAL_COOKIE + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" + suffixeCookieSecure(res));
}

// ---------- TOTP RFC 6238 (pur Node, aucune dépendance) ----------
// Compatible Google Authenticator / Microsoft Authenticator / Authy / FreeOTP.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s) {
  const clean = String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** (NOUVEAU Task 78) Encodage Base32 RFC 4648 SANS bourrage — format du
 *  paramètre « secret » exigé par les applications d'authentification. */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** (NOUVEAU Task 78) Secret TOTP PERSISTANT : 20 octets aléatoires = 32
 *  caractères Base32 (80 bits — recommandation de la spec « Key URI
 *  Format »). Généré UNE SEULE FOIS par employé, conservé en base
 *  (PortalAccess.totpSecret — colonne historique Task 18 réutilisée). */
function genererSecretTotp() {
  return base32Encode(crypto.randomBytes(20));
}

/** Code TOTP à 6 chiffres pour une fenêtre de 30 secondes donnée. */
function totpAt(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code =
    (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

/**
 * Vérifie un code TOTP avec tolérance ±1 fenêtre (horloge du téléphone) et
 * ANTI-REJEU : une fenêtre déjà consommée (lastUsedWindow) est refusée.
 */
function verifyTotp(secretB32, code, lastUsedWindow) {
  const secret = base32Decode(secretB32);
  if (!secret.length) return { ok: false };
  const now = Math.floor(Date.now() / 1000 / 30);
  const a = Buffer.from(String(code));
  for (const w of [now, now - 1, now + 1]) {
    const expected = Buffer.from(totpAt(secret, w));
    if (a.length === expected.length && crypto.timingSafeEqual(a, expected)) {
      if (lastUsedWindow != null && w <= lastUsedWindow) return { ok: false, replay: true };
      return { ok: true, window: w };
    }
  }
  return { ok: false };
}

// ---------- Anti force-brute ----------
const MAX_VERIFY_ATTEMPTS = 5; // 5 échecs…
const LOCK_MS = 15 * 60 * 1000; // … puis verrouillage 15 minutes

// ---------- (NOUVEAU Task 74, MODIFIÉ Task 75/76, MODIFIÉ Task 78) DÉFI OTP + QR CODE — EXPIRATION : 10 MINUTES ----------
// (MODIFIÉ Task 76) le défi OTP est créé à CHAQUE validation CIN + mot de
// passe (demande utilisateur : « lors des connexions suivantes, l'utilisateur
// doit obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP »).
// Le champ `premiere` du défi distingue la TOUTE PREMIÈRE connexion de
// l'employé (aucune connexion complète enregistrée — verrou lastLoginAt).
// (MODIFIÉ Task 85) la page /otp affiche LE QR CODE dans TOUS les cas
// (inscription ET connexions suivantes — même fenêtre « QR + Code OTP ») ;
// AUCUN code OTP n'est généré ni affiché : la SEULE voie de confirmation est
// le code TOTP de l'application d'authentification (lecture du QR).
// lastLoginAt est posé quand l'OTP est confirmé (connexion COMPLÈTE) — un
// défi abandonné, expiré ou annulé n'écrit RIEN.
// (MODIFIÉ Task 78) le QR code encode l'URI STANDARD otpauth://totp/… avec le
// SECRET TOTP PERSISTANT de l'employé (Base32, PortalAccess.totpSecret) —
// lisible par Google/Microsoft Authenticator, Authy, FreeOTP (l'ancien JSON
// {app, objet, code, expire} n'était interprétable par AUCUNE application).
// Le défi (QR + fenêtre de confirmation) expire au bout de 10 minutes.
// PORTAL_OTP_TTL_MS permet de RÉDUIRE la durée pour les tests (plancher 3 s)
// — il ne peut JAMAIS l'allonger au-delà des 10 minutes.
const OTP_TTL_MS = (() => {
  const n = parseInt(process.env.PORTAL_OTP_TTL_MS || "", 10);
  return Number.isFinite(n) && n >= 3000 && n <= 600000 ? n : 10 * 60 * 1000; // défaut : 10 minutes
})();
const OTP_MINUTES = Math.max(1, Math.ceil(OTP_TTL_MS / 60000));
const LIBELLE_OTP = OTP_MINUTES + " minute" + (OTP_MINUTES > 1 ? "s" : "");
const OTP_COOKIE_MAX_AGE = Math.ceil(OTP_TTL_MS / 1000);
const OTP_MAX_TENTATIVES = 5; // 5 mauvais codes → défi annulé, reconnexion
const otpDefis = new Map(); // cin -> { expireAt(ms), tentatives, remember, premiere, totpSecret, creeA }

/** Crée (ou régénère) le défi OTP d'un CIN — remplace tout défi précédent.
 *  (Task 76) `premiere` = TOUTE PREMIÈRE connexion de cet employé → la page
 *  /otp sert la fenêtre d'inscription « Configuration OTP » ; sinon la
 *  fenêtre de confirmation des connexions suivantes.
 *  (MODIFIÉ Task 85) PLUS AUCUN code OTP généré ni stocké : le défi ne porte
 *  que la fenêtre de validité (10 min) et le secret TOTP persistant
 *  (NOUVEAU Task 78, Base32) embarqué dans l'URI otpauth:// du QR code.
 *  (NOUVEAU Task 78) `totpSecret` = secret TOTP PERSISTANT de l'employé.
 *  (MODIFIÉ Task 86) `expireAtMs` (optionnel) : ALIGNEMENT de la fenêtre du
 *  défi sur celle du SECRET DE FENÊTRE (inscription non confirmée) — le QR
 *  et sa fenêtre expirent ENSEMBLE, à otpFenetreCreeA + 10 minutes. Absent
 *  (= secret définitif d'un employé inscrit) : expiration à maintenant +
 *  10 minutes, comme auparavant. */
function creerDefiOtp(cin, remember, premiere, totpSecret, expireAtMs) {
  const maintenant = Date.now();
  for (const [k, d] of otpDefis) if (d.expireAt <= maintenant) otpDefis.delete(k); // hygiène mémoire
  const expiration =
    Number.isFinite(expireAtMs) && expireAtMs > maintenant
      ? expireAtMs // (Task 86) alignée sur la vie du secret de fenêtre
      : maintenant + OTP_TTL_MS;
  const defi = {
    cin,
    expireAt: expiration,
    // (Task 86) true = le QR encode un secret de FENÊTRE (inscription non
    // confirmée) : le QR expire vraiment avec la fenêtre. false = secret
    // définitif d'un employé inscrit (la fenêtre de la page expire, pas le QR).
    fenetre:
      Number.isFinite(expireAtMs) && expireAtMs > maintenant,
    tentatives: 0,
    remember: remember === true,
    premiere: premiere === true,
    totpSecret: String(totpSecret || ""),
    creeA: maintenant,
  };
  otpDefis.set(cin, defi);
  return defi;
}

/** Défi toujours VALABLE (non expiré) pour ce CIN, sinon null (et purgé). */
function defiOtpValide(cin) {
  const d = otpDefis.get(cin);
  if (!d) return null;
  if (d.expireAt <= Date.now()) {
    otpDefis.delete(cin);
    return null;
  }
  return d;
}

// ============================================================
// (NOUVEAU Task 86) LE SECRET TOTP D'INSCRIPTION EST UNE FENÊTRE DE 10 MINUTES
// Retour utilisateur : « Qr code n'expire pas apres 10 minute vérifier » —
// jusqu'ici le secret persistait dès la première validation CIN + mot de
// passe : la FENÊTRE expirait, mais le QR scanné restait valable pour
// toujours (même QR ré-affiché à chaque reconnexion, code accepté à vie).
// DÉSORMAIS :
//   - employé INSCRIT (lastLoginAt != null) → secret DÉFINITIF en base
//     (inchangé — l'application déjà associée continue de fonctionner ;
//     seul le RH/IT peut le remplacer via « Réinitialiser le QR », Task 80) ;
//   - employé NON INSCRIT (lastLoginAt null) → le secret encodé par le QR
//     est une FENÊTRE : il est RÉUTILISÉ tant qu'il est vivant (reconnexion
//     dans les 10 minutes → MÊME QR, même compte à rebours — pas de surprise),
//     sinon RÉGÉNÉRÉ et enregistré (chiffré) avec son horodatage
//     otpFenetreCreeA : l'ancien QR scanné devient DÉFINITIVEMENT inutilisable
//     (la vérification porte sur le secret de fenêtre EN BASE) et le QR
//     affiché à la reconnexion est DIFFÉRENT ;
//   - SCELLEMENT : la confirmation du code (/api/otp/verify ou connexion en
//     une étape) repasse otpFenetreCreeA à null — le secret de la fenêtre
//     CONFIRMÉE devient le secret définitif du compte.
// La fenêtre du DÉFI est ALIGNÉE sur la vie du secret : QR et fenêtre
// expirent ENSEMBLE, à otpFenetreCreeA + 10 minutes.
// ============================================================

/** Fenêtre de secret encore VIVANTE ? (non inscrit uniquement)
 *  @returns {boolean} true = le secret en base est une fenêtre en cours. */
function fenetreSecretVivante(acc) {
  if (!acc || acc.lastLoginAt) return false; // inscrit → secret définitif
  if (!acc.totpSecret || !acc.otpFenetreCreeA) return false;
  const creeA = new Date(acc.otpFenetreCreeA).getTime();
  return Number.isFinite(creeA) && Date.now() - creeA < OTP_TTL_MS;
}

/** Secret TOTP à encoder dans le QR + expiration ALIGNÉE de la fenêtre.
 *  (Task 86) Réutilise la fenêtre vivante, sinon RÉGÉNÈRE le secret et
 *  l'enregistre (chiffré, Task 32) avec otpFenetreCreeA = maintenant.
 *  @param {Object} acc  PortalAccess FRAIS (findUnique) de l'employé
 *  @returns {Promise<{secret:string, expireAt:number|null}>}
 *          expireAt = millisecondes d'expiration du secret de fenêtre
 *          (null = secret définitif d'un employé inscrit — le défi garde
 *          alors sa propre fenêtre de 10 minutes). */
async function obtenirSecretFenetre(acc) {
  if (acc.lastLoginAt) {
    // Employé inscrit : secret DÉFINITIF (aucune rotation).
    const secret = cryptoBd.dechiffrerChamp(acc.totpSecret);
    if (secret) return { secret, expireAt: null };
    // (defensif) inscrit SANS secret : régénération d'un secret définitif.
    const nouveau = genererSecretTotp();
    await prisma.portalAccess.update({
      where: { id: acc.id },
      data: { totpSecret: cryptoBd.chiffrerChamp(nouveau, false), otpFenetreCreeA: null },
    });
    return { secret: nouveau, expireAt: null };
  }
  if (fenetreSecretVivante(acc)) {
    // Fenêtre en cours : MÊME secret (même QR) jusqu'à son expiration.
    return {
      secret: cryptoBd.dechiffrerChamp(acc.totpSecret),
      expireAt: new Date(acc.otpFenetreCreeA).getTime() + OTP_TTL_MS,
    };
  }
  // Aucune fenêtre vivante (première fois ou fenêtre expirée) : NOUVEAU
  // secret — l'ancien QR (s'il a été scanné) ne vaut plus RIEN.
  const secret = genererSecretTotp();
  await prisma.portalAccess.update({
    where: { id: acc.id },
    data: {
      totpSecret: cryptoBd.chiffrerChamp(secret, false),
      otpFenetreCreeA: new Date(),
    },
  });
  return { secret, expireAt: Date.now() + OTP_TTL_MS };
}

/** Contenu du QR code (MODIFIÉ Task 78) : URI STANDARD « otpauth://totp/… »
 *  (spec « Key URI Format » de Google) — le SEUL format que les applications
 *  d'authentification savent interpréter (Google Authenticator, Microsoft
 *  Authenticator, Authy, FreeOTP…). L'ancien JSON {app, objet, code, expire}
 *  est ABANDONNÉ : aucune application ne le lisait (retour utilisateur Task
 *  78 : « application authenticator cannot interpret qr code »). L'URI
 *  embarque le secret TOTP PERSISTANT de l'employé (Base32) — PAS un code :
 *  l'application génère ses propres codes à 6 chiffres (période 30 s),
 *  SEULE voie de confirmation acceptée par /api/otp/verify (Task 85 : aucun
 *  code n'est jamais affiché à l'écran).
 *  (MODIFIÉ Task 88, puis v0.2.105 — renommage AutoRH) le LABEL de l'URI
 *  est « AutoRH:Espace employé » — dans l'application Authenticator, le
 *  champ « Account Name » affiche « Espace employé » AU LIEU du CIN. Le
 *  label ne participe PAS au calcul TOTP (seul le secret compte) : les
 *  comptes déjà associés continuent de générer des codes valables. */
function contenuQrOtp(defi) {
  // (MODIFIÉ Task 88, v0.2.105) Account Name = « Espace employé » (PLUS le
  // CIN) : l'application d'authentification affiche « Espace employé » avec
  // l'émetteur AutoRH ; le CIN n'apparaît plus sur l'écran du téléphone.
  const label = encodeURIComponent("AutoRH:Espace employé");
  return (
    "otpauth://totp/" +
    label +
    "?secret=" +
    String(defi.totpSecret || "") +
    "&issuer=AutoRH&algorithm=SHA1&digits=6&period=30"
  );
}

/** QR code SVG du défi (échec impossible en pratique : page utilisable sans). */
async function svgQrOtp(defi) {
  try {
    return await QRCode.toString(contenuQrOtp(defi), {
      type: "svg",
      margin: 1,
      width: 216,
      errorCorrectionLevel: "M",
      color: { dark: "#065f46", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Lecture du corps JSON des requêtes POST ----------
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10000) {
        req.destroy();
        resolve(null);
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(null));
  });
}

// ---------- MODIFIÉ (Task 115) : LOGO TRAILMIX fourni par l'utilisateur ----------
// Dégradé orange-rose-violet « T » (upload trailmix-logo-gradient-preview-white.jpg),
// fond blanc supprimé puis réduit : header 72 px + favicon 64 px. Injectés en
// data URI PNG pour conserver le principe Task 18 : HTML 100 % autonome, aucun
// fichier externe à servir, aucune dépendance.
const LOGO_TRAILMIX_PNG =
  "data:image/png;base64," +
  "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";
const LOGO_TRAILMIX_FAVICON_PNG =
  "data:image/png;base64," +
  "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";
const LOGO_ADMIN_FAVICON_LINK =
  '<link rel="icon" type="image/png" href="' + LOGO_TRAILMIX_FAVICON_PNG + '">' +
  '<link rel="apple-touch-icon" href="' + LOGO_TRAILMIX_FAVICON_PNG + '">';

// ---------- Reponses HTTP ----------
// (MODIFIÉ Task 208 — durcissement recommandé par l'audit sécurité) :
// X-Frame-Options SAMEORIGIN (la visionneuse PDF du portail affiche les fiches
// dans une iframe de même origine — DENY la casserait), HSTS (actif derrière
// un proxy HTTPS, ignoré en HTTP local), CSP adaptée au portail (CSS/JS
// inline par conception), Permissions-Policy.
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; " +
    "object-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// (NOUVEAU Task 208) suffixe « ; Secure » pour les cookies de session :
// appliqué automatiquement quand la requête arrive en HTTPS (proxy avec
// x-forwarded-proto: https, ou serveur TLS natif) ou quand
// AUTO_RH_FORCE_SECURE_COOKIES=1. En HTTP local, absent (un cookie Secure
// n'est jamais envoyé par les navigateurs sur http — la connexion casserait).
function suffixeCookieSecure(res) {
  try {
    const req = res && res.req;
    const proto = req && req.headers && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const tlsNatif = req && req.socket && req.socket.encrypted === true;
    if (proto === "https" || tlsNatif || process.env.AUTO_RH_FORCE_SECURE_COOKIES === "1") {
      return "; Secure";
    }
  } catch {}
  return "";
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendErrorPage(res, status, title, message) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>AutoRH — Portail Employés</title>" +
      // MODIFIÉ (Task 26) : favicon centralisé dans LOGO_ADMIN_FAVICON_LINK
      // (même logo que la page administration — contenu public/fiche-icon.svg).
      LOGO_ADMIN_FAVICON_LINK +
      "</head>" +
      '<body style="font-family:system-ui,sans-serif;background:#FFF9F3;color:#0f172a;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
      '<div style="max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;' +
      'padding:32px;text-align:center;box-shadow:0 8px 30px rgba(2,44,34,.06)">' +
      '<div style="font-size:40px">🔒</div>' +
      '<h1 style="font-size:20px;margin:8px 0 4px">' + title + "</h1>" +
      '<p style="color:#475569;font-size:14px;line-height:1.6">' + message + "</p>" +
      "</div></body></html>"
  );
}

// ============================================================
//  (MODIFIÉ Task 64) PAGE DE CONNEXION (CIN + mot de passe)
//  HTML autonome : aucun fichier externe, aucun CDN, aucune dépendance.
// ============================================================
const LOGIN_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : connexion</title>
<!-- NOUVEAU (Task 26) : même logo (favicon) que la page administration -->
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: #f6fef9 fixed;
    color: #0f172a; display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    background: #ffffff; border-bottom: 1px solid #e2e8f0;
    padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .logo {
    /* MODIFIÉ (Task 115) : plus de carré vert — le logo Trailmix
       s'affiche directement (dégradé sur fond transparent). */
    height: 34px; display: inline-flex; align-items: center; flex: none;
  }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
  .brand small { display: block; font-weight: 500; font-size: 11.5px; color: #64748b; letter-spacing: 0; }
  main { flex: 1; width: 100%; max-width: 560px; margin: 0 auto; padding: 30px 18px 40px; }
  .hero { text-align: center; margin-bottom: 22px; }
  .hero h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.4px; }
  .hero p { color: #475569; font-size: 14.5px; margin-top: 6px; line-height: 1.55; }
  .card {
    background: #ffffff; border: 1px solid #e6eaf2; border-radius: 16px;
    padding: 24px; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);
  }
  label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 7px; color: #1e293b; }
  .field { margin-bottom: 16px; }
  /* (MODIFIÉ Task 69) rayon 12px pour rester identique au champ mot de
     passe (image utilisateur) — les deux champs du formulaire ont EXACTEMENT
     la même apparence. */
  input[type="text"] {
    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; text-transform: uppercase; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="text"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  /* (NOUVEAU Task 69) champ MOT DE PASSE de la CONNEXION : avant cette
     correction, aucune règle CSS ne visait input[type="password"] sur CETTE
     page — le champ s'affichait en style navigateur BRUT (coins carrés,
     bordure fine par défaut, hauteur différente) et tranchait avec le champ
     CIN et avec l'image fournie par l'utilisateur. Style aligné sur le
     champ CIN : fond blanc, coins arrondis 12px, bordure claire 1.5px,
     hauteur 48px, anneau émeraude au focus. Les attributs de sécurité
     (autocomplete="current-password", Task 66) sont INCHANGÉS. */
  input[type="password"] {
    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="password"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  input.code {
    letter-spacing: 10px; font-size: 22px; font-weight: 700; text-align: center;
    text-transform: none; padding-left: 0; padding-right: 0;
  }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: #10b981; color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  /* NOUVEAU (Task 33) : case « Se souvenir de moi » */
  .remember {
    display: flex; align-items: center; gap: 9px;
    font-weight: 500; font-size: 13.5px; color: #334155;
    margin: 2px 0 16px; cursor: pointer; user-select: none;
  }
  .remember input { width: 16px; height: 16px; accent-color: #10b981; cursor: pointer; margin: 0; }
  .remember span { line-height: 1.4; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: #10b981; color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: #10b981; color: #fff;
    font-weight: 800; font-size: 17px; display: inline-flex; align-items: center;
    justify-content: center; flex: none; box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .carte-titre { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .carte-sous { color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 2px; }
  .champ-mdp { position: relative; }
  .champ-mdp input { padding-right: 48px; }
  .oeil {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 38px; height: 38px; border: none; background: transparent; color: #94a3b8;
    cursor: pointer; border-radius: 9px; display: inline-flex; align-items: center;
    justify-content: center; padding: 0;
  }
  .oeil:hover { background: #f1f5f9; color: #475569; }
  .oeil svg { width: 19px; height: 19px; }
  .note-verte {
    display: flex; gap: 10px; align-items: flex-start; background: #FFF3E8;
    border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #10b981;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #10b981;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #10b981; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer {
    margin-top: auto; padding: 16px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6;
  }
</style>
</head>
<body>
<header>
  <span class="logo" aria-hidden="true">
    <!-- MODIFIÉ (Task 115) : logo Trailmix (data URI PNG, fond transparent) -->
    <img src="${LOGO_TRAILMIX_PNG}" alt="" style="width:auto;height:34px;display:block" />
  </span>
  <span class="brand">AutoRH<small>Portail Employés</small></span>
</header>

<main>
  <div class="hero">
    <h1>Accès sécurisé au portail</h1>
    <p>Connectez-vous avec votre numéro de CIN et votre <b>mot de passe</b>.<br>
       Premier accès ? Utilisez le mot de passe initial fourni par votre service RH —
       il vous sera ensuite demandé d'en choisir un personnel.<br>
       <!-- (MODIFIÉ Task 81) l'employé REVENU après sa première connexion doit
            utiliser le mot de passe QU'IL A CHOISI : le message « mot de passe
            initial » seul l'induisait en erreur (retour utilisateur : à la
            reconnexion après le scan du QR, « CIN ou mot de passe incorrect »
            s'affichait alors qu'il recopiait l'initial devenu invalide). -->
       Déjà venu ? Utilisez <b>VOTRE</b> mot de passe (celui que vous avez choisi) :
       le mot de passe initial ne fonctionne plus après le changement obligatoire
       de la première connexion.<br>
       <!-- (NOUVEAU Task 82) retour utilisateur : « Il n'y a pas de champ
            permettant de saisir l'OTP » — le champ Code OTP est DÉSORMAIS
            affiché directement sur CE formulaire (3e champ) : l'employé
            inscrit à l'aide du QR de la première connexion saisit son CIN,
            son mot de passe ET son code OTP en UNE étape. -->
       Dès votre 2ᵉ connexion, saisissez aussi votre <b>code OTP</b> dans le
       champ dédié ci-dessous (application d'authentification) — ou laissez-le
       vide : un code vous sera alors présenté à l'étape suivante.</p>
  </div>

  <div class="card">
    <!-- (NOUVEAU Task 83 — maquette) tête de carte : cercle utilisateur bleu
         + titre « Connexion » + sous-titre. Le formulaire comporte 3 champs
         (CIN + mot de passe + OTP) + « Se connecter » (2e connexion et
         suivantes) et le lien vers la page PREMIÈRE connexion (/premiere). -->
    <div class="carte-tete">
      <span class="icon-rond" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      </span>
      <span>
        <span class="carte-titre">Connexion</span>
        <span class="carte-sous">Veuillez vous identifier pour accéder à votre portail employé.</span>
      </span>
    </div>
    <!-- (MODIFIÉ Task 66) autocomplete="current-password" sur le mot de passe :
         ce champ est une CONNEXION (mot de passe DÉJÀ connu) — le navigateur
         doit PROPOSER le mot de passe enregistré de l'employé, PAS en générer
         un nouveau ("new-password" provoquait un pré-remplissage FAUX du
         champ : « le champ de mot de passe est mauvais »). Le formulaire et
         le CIN restent "off" (aucun historique de saisie, esprit Task 37). -->
    <form id="form" novalidate autocomplete="off">
      <div class="field">
        <label for="cin">Numéro CIN</label>
        <input type="text" id="cin" name="cin" placeholder="CIN complet — ex. 09123456 ou A123456"
               autocomplete="off" spellcheck="false" autofocus>
      </div>
      <div class="field">
        <label for="password">Mot de passe</label>
        <div class="champ-mdp">
          <input type="password" id="password" name="password" placeholder="Votre mot de passe"
                 autocomplete="current-password">
          <!-- (NOUVEAU Task 83 — maquette) œil afficher/masquer -->
          <button type="button" class="oeil" data-cible="password" aria-label="Afficher le mot de passe" tabindex="-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
        <p class="hint" style="margin-top:6px">Astuce : recopiez votre mot de passe (initial ou
           personnel) avec ou sans tirets — les tirets et espaces sont ignorés.</p>
      </div>
      <!-- (NOUVEAU Task 82) TROISIÈME CHAMP du formulaire de connexion : le
           CODE OTP — retour utilisateur « Il n'y a pas de champ permettant de
           saisir l'OTP ». L'employé inscrit via le QR de la première connexion
           saisit ici le code à 6 chiffres de SON application d'authentification
           (Google Authenticator, Microsoft Authenticator, Authy, FreeOTP…) et
           se connecte en UNE étape. À la PREMIÈRE connexion, le champ reste
           VIDE : le portail affiche alors le QR code d'inscription (Task 80).
           Les connexions SUIVANTES qui laissent le champ vide reçoivent un
           code à l'étape suivante (double voie Task 78 inchangée). -->
      <div class="field">
        <label for="otp">Code OTP (application d'authentification)</label>
        <input type="text" id="otp" name="otp" class="code" inputmode="numeric" maxlength="8"
               placeholder="••••••" autocomplete="one-time-code" spellcheck="false">
        <p class="hint" style="margin-top:6px">Dès votre 2ᵉ connexion : saisissez le code à 6 chiffres
           généré par votre application (Google Authenticator, Microsoft Authenticator,
           Authy, FreeOTP…). PREMIÈRE connexion ? Laissez ce champ VIDE : le portail
           affichera le QR code d'inscription (une seule fois). Pas d'application sous la
           main ? Laissez vide : un code vous sera présenté à l'étape suivante.</p>
      </div>
      <!-- (Task 33) « Se souvenir de moi » — évite de ressaisir CIN + mot de passe
           à chaque visite sur cet appareil (session longue signée, durée configurable) -->
      <label class="remember" for="remember">
        <input type="checkbox" id="remember" name="remember" checked>
        <span>Se souvenir de moi sur cet appareil (${LIBELLE_SOUVENIR})</span>
      </label>
      <button type="submit" id="btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Se connecter
      </button>
      <!-- (NOUVEAU Task 83 — maquette) point d'entrée explicite de la
           PREMIÈRE connexion : page dédiée /premiere (CIN + mot de passe
           initial + nouveau mot de passe ×2 → QR + code OTP). -->
      <a class="lien-premiere" href="/premiere">Première connexion ? (mot de passe initial + configuration OTP)</a>
      <p class="hint">Pas encore d'accès, mot de passe initial perdu ou expiré ?<br>
         Contactez votre service RH : il peut créer ou réinitialiser votre accès
         (un nouveau mot de passe initial vous sera remis).</p>
      <div class="msg" id="msg" role="alert" aria-live="polite"></div>
      <!-- (NOUVEAU Task 81) bandeau d'aide affiché sous le message d'erreur
           lorsque la connexion échoue avec « CIN ou mot de passe incorrect » :
           rappel que le mot de passe INITIAL devient invalide dès que l'employé
           a choisi le sien (fin de la première connexion) — le cas exact du
           retour utilisateur (reconnexion après le scan du QR). Texte STATIQUE
           (aucune fuite d'information : montré à tout échec de ce type). -->
      <p class="hint" id="hint-echec" hidden style="display:none; margin-top:10px; background:#fffbeb;
         border:1px solid #fde68a; color:#92400e; border-radius:10px; padding:10px 12px;">
         <b>Mot de passe refusé après votre première connexion ?</b><br>
         Si vous aviez <b>choisi votre propre mot de passe</b> à la fin de la première
         connexion (QR code + code OTP + changement obligatoire), utilisez celui-là :
         le mot de passe initial n'est <b>plus valable</b>. Vous ne le retrouvez pas ?
         Contactez votre service RH : il peut réinitialiser votre accès (un nouveau
         mot de passe initial vous sera remis).
      </p>
      <div class="spinner" id="spinner" aria-hidden="true"></div>
    </form>
  </div>
</main>

<footer>
  Portail Employés — accès protégé par CIN + mot de passe + code OTP (champ « Code OTP » du formulaire)<br>
  Vérification par code OTP (application d'authentification) obligatoire à CHAQUE connexion — QR code valable ${LIBELLE_OTP}<br>
  Le code OTP n'est JAMAIS affiché à l'écran : il est généré par votre application d'authentification (QR code)<br>
  Sécurité : mot de passe à changer obligatoirement tous les 15 jours.<br>
  En cas d'anomalie (mot de passe refusé, code OTP expiré, accès perdu), contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var form = document.getElementById("form");
  var inputCin = document.getElementById("cin");
  var inputPassword = document.getElementById("password");
  var inputOtp = document.getElementById("otp"); // (NOUVEAU Task 82) 3e champ du formulaire
  var inputRemember = document.getElementById("remember"); // (Task 33)
  var btn = document.getElementById("btn");
  var msg = document.getElementById("msg");
  var spinner = document.getElementById("spinner");

  // Compatibilite avec les passerelles qui exigent un parametre de port
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }

  function show(kind, text) {
    msg.className = "msg " + kind;
    msg.textContent = text;
  }
  function hideMsg() { msg.className = "msg"; msg.textContent = ""; }
  function setLoading(on) {
    btn.disabled = on;
    btn.style.opacity = on ? ".6" : "";
    spinner.style.display = on ? "block" : "none";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideMsg();
    var cin = (inputCin.value || "").toUpperCase().replace(/\\s+/g, "");
    var password = inputPassword.value || "";
    if (cin.length < 3) {
      show("error", "Veuillez saisir votre numéro CIN complet.");
      inputCin.focus();
      return;
    }
    if (!password) {
      show("error", "Veuillez saisir votre mot de passe.");
      inputPassword.focus();
      return;
    }
    // (NOUVEAU Task 82) tolérance de saisie : tirets/espaces ignorés (esprit
    // Task 66) — le champ peut rester VIDE (première connexion, ou code
    // souhaité à l'étape suivante).
    var otp = (inputOtp.value || "").replace(/[\\s-]/g, "");
    if (otp && !/^\\d{6}$/.test(otp)) {
      show("error", "Le code OTP doit contenir exactement 6 chiffres — ou laissez le champ Code OTP vide.");
      inputOtp.focus();
      return;
    }
    // (Esprit Task 17) les champs sont vidés dès la tentative envoyée —
    // le CIN, le mot de passe et le code OTP ne restent pas affichés à l'écran.
    inputCin.value = "";
    inputPassword.value = "";
    inputOtp.value = "";
    setLoading(true);
    fetch(apiUrl("/api/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cin: cin, password: password, otp: otp, remember: inputRemember.checked === true }),
      cache: "no-store"
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.ok) {
          if (r.data && r.data.otpRequired) {
            // NOUVEAU (Task 74, MODIFIÉ Task 76, Task 82) : CIN + mot de passe
            // validés SANS code OTP (champ vide) → le portail affiche le code
            // OTP (+ le QR code à la PREMIÈRE connexion) : l'employé confirme
            // le code à CHAQUE connexion. S'il avait saisi un code VALIDE dans
            // le champ « Code OTP », la réponse aurait déjà été une connexion
            // complète (ok + redirect) — ce bloc ne concerne que le parcours
            // en deux étapes.
            show("info", "Connexion validée — confirmez le code OTP affiché à l'écran…");
            location.replace(apiUrl("/otp"));
            return;
          }
          if (r.data && r.data.premiere) {
            // NOUVEAU (Task 83 — maquette) : PREMIÈRE connexion / accès
            // réinitialisé → PAGE DÉDIÉE /premiere (CIN + mot de passe initial
            // + nouveau mot de passe ×2 → « Valider » → étape 2 : QR + code
            // OTP). Le changement du mot de passe initial s'affiche DÈS LA
            // PREMIÈRE CONNEXION (retour utilisateur Task 82 : « Le changement
            // du mot de passe initial ne s'affiche pas »).
            show("info", "Première connexion — choisissez votre mot de passe et configurez votre OTP…");
            location.replace(apiUrl("/premiere"));
            return;
          }
          if (r.data && r.data.mustChangePassword) {
            // (Task 64, conservé Task 83 pour le cas « mot de passe expiré »,
            // chemin Task 82) : changement OBLIGATOIRE avant tout accès.
            show("info", "Connexion réussie — vous devez d'abord choisir votre nouveau mot de passe…");
            location.replace(apiUrl("/changer"));
            return;
          }
          show("info", "Connexion réussie — ouverture de votre portail…");
          location.replace(apiUrl("/"));
          return;
        }
        // (NOUVEAU Task 81) sur l'échec générique « CIN ou mot de passe
        // incorrect », le bandeau d'aide s'affiche : il explique la cause
        // LA PLUS COURANTE après une première connexion (l'employé recopie
        // l'initial alors qu'il a déjà choisi le sien) — et la voie de
        // récupération (réinitialisation par le RH).
        var err = (r.data && r.data.error) || "Connexion impossible. Réessayez.";
        show("error", err);
        var hintEchec = document.getElementById("hint-echec");
        if (hintEchec && err.indexOf("CIN ou mot de passe incorrect") >= 0) {
          hintEchec.hidden = false;
          hintEchec.style.display = "block";
        }
      })
      .catch(function () {
        show("error", "Impossible de contacter le serveur. Vérifiez votre connexion puis réessayez.");
      })
      .then(function () { setLoading(false); });
  });

  // (NOUVEAU Task 83 — maquette) œil afficher/masquer sur le champ mot de
  // passe : bascule le type du champ ciblé (data-cible).
  document.querySelectorAll(".oeil").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = document.getElementById(b.getAttribute("data-cible"));
      if (!i) return;
      var visible = i.type === "text";
      i.type = visible ? "password" : "text";
      b.setAttribute("aria-label", visible ? "Afficher le mot de passe" : "Masquer le mot de passe");
      b.style.color = visible ? "#94a3b8" : "#10b981";
    });
  });
})();
</script>
</body>
</html>
`;

// ============================================================
//  NOUVEAU (Task 64) : PAGE DE CHANGEMENT DE MOT DE PASSE OBLIGATOIRE
//  Servie uniquement avec une session « pending » (10 minutes). Tant que le
//  changement n'est pas fait, AUCUN accès aux fiches n'est possible.
//  Motifs (paramètre `motif`) :
//    - initial      : première connexion avec le mot de passe initial du RH ;
//    - reinitialise : accès réinitialisé par le RH/IT (nouveau mot de passe
//                     initial à usage unique) ;
//    - expire       : mot de passe expiré (politique : 15 jours, TOUS les
//                     utilisateurs — employés, RH, IT, superadmin).
// ============================================================
function changementMotDePasseHtml(motif) {
  const titres = {
    initial: {
      h: "Bienvenue — choisissez votre mot de passe",
      p: "C'est votre première connexion. Pour protéger votre accès, vous devez maintenant choisir <b>votre propre mot de passe</b>. Le mot de passe initial communiqué par le service RH ne servira plus ensuite.",
    },
    reinitialise: {
      h: "Accès réinitialisé — nouveau mot de passe",
      p: "Votre accès a été réinitialisé par le service RH/IT. Choisissez maintenant <b>votre nouveau mot de passe personnel</b> : le mot de passe temporaire qui vous a été remis ne fonctionnera plus.",
    },
    expire: {
      h: "Mot de passe expiré — changement obligatoire",
      p: "Par sécurité, les mots de passe <b>expirent tous les 15 jours</b> (règle appliquée à tous les utilisateurs : employés, RH, informatique et administration). Choisissez un <b>nouveau mot de passe</b> pour accéder de nouveau à vos fiches.",
    },
  };
  const t = titres[motif] || titres.expire;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : nouveau mot de passe</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: #f6fef9 fixed;
    color: #0f172a; display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    background: #ffffff; border-bottom: 1px solid #e2e8f0;
    padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .logo {
    /* MODIFIÉ (Task 115) : plus de carré vert — le logo Trailmix
       s'affiche directement (dégradé sur fond transparent). */
    height: 34px; display: inline-flex; align-items: center; flex: none;
  }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
  .brand small { display: block; font-weight: 500; font-size: 11.5px; color: #64748b; letter-spacing: 0; }
  main { flex: 1; width: 100%; max-width: 560px; margin: 0 auto; padding: 30px 18px 40px; }
  .hero { text-align: center; margin-bottom: 22px; }
  .hero h1 { font-size: 23px; font-weight: 800; letter-spacing: -0.4px; }
  .hero p { color: #475569; font-size: 14.5px; margin-top: 6px; line-height: 1.55; }
  .card {
    background: #ffffff; border: 1px solid #e6eaf2; border-radius: 16px;
    padding: 24px; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);
  }
  label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 7px; color: #1e293b; }
  .field { margin-bottom: 16px; }
  /* (MODIFIÉ Task 69) champs mot de passe harmonisés avec l'image fournie
     par l'utilisateur : fond blanc, coins bien arrondis (12px), bordure
     claire fine, masquage par points — identique au champ CIN. */
  input[type="password"] {
    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="password"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: #10b981; color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: #10b981; color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: #10b981; color: #fff;
    font-weight: 800; font-size: 17px; display: inline-flex; align-items: center;
    justify-content: center; flex: none; box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .carte-titre { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .carte-sous { color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 2px; }
  .champ-mdp { position: relative; }
  .champ-mdp input { padding-right: 48px; }
  .oeil {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 38px; height: 38px; border: none; background: transparent; color: #94a3b8;
    cursor: pointer; border-radius: 9px; display: inline-flex; align-items: center;
    justify-content: center; padding: 0;
  }
  .oeil:hover { background: #f1f5f9; color: #475569; }
  .oeil svg { width: 19px; height: 19px; }
  .note-verte {
    display: flex; gap: 10px; align-items: flex-start; background: #FFF3E8;
    border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #10b981;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #10b981;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #10b981; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer {
    margin-top: auto; padding: 16px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6;
  }
</style>
</head>
<body>
<header>
  <span class="logo" aria-hidden="true">
    <!-- MODIFIÉ (Task 115) : logo Trailmix (data URI PNG, fond transparent) -->
    <img src="${LOGO_TRAILMIX_PNG}" alt="" style="width:auto;height:34px;display:block" />
  </span>
  <span class="brand">AutoRH<small>Portail Employés</small></span>
</header>

<main>
  <div class="hero">
    <h1>${t.h}</h1>
    <p>${t.p}</p>
  </div>

  <div class="card">
    <!-- (MODIFIÉ Task 66) « actuel » = mot de passe DÉJÀ connu →
         autocomplete="current-password" (le navigateur propose le bon mot de
         passe au lieu d'en générer un) ; « nouveau » + « confirmer » =
         CRÉATION → "new-password" conservé (esprit Task 37). -->
    <form id="form" novalidate autocomplete="off">
      <div class="field">
        <label for="cur">Mot de passe actuel (celui qui vous a été remis / votre mot de passe expiré)</label>
        <input type="password" id="cur" name="cur" autocomplete="current-password" placeholder="••••••••">
        <p class="hint" style="margin-top:6px">Recopiez-le avec ou sans tirets — les tirets et espaces sont ignorés.</p>
      </div>
      <div class="field">
        <label for="new">Nouveau mot de passe</label>
        <input type="password" id="new" name="new" autocomplete="new-password" placeholder="Choisissez un mot de passe solide">
      </div>
      <div class="field">
        <label for="conf">Confirmer le nouveau mot de passe</label>
        <input type="password" id="conf" name="conf" autocomplete="new-password" placeholder="••••••••">
      </div>
      <button type="submit" id="btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Enregistrer mon nouveau mot de passe
      </button>
      <p class="hint">Règles : au moins <b>8 caractères</b> avec <b>minuscule</b>, <b>majuscule</b>,
         <b>chiffre</b> et <b>symbole</b> (par exemple ! ? _ % @), différent du mot de passe actuel
         et de votre numéro CIN. Les tirets et espaces du mot de passe sont ignorés à la saisie —
         prévoyez un symbole autre que le tiret.
         Il sera à nouveau à changer dans <b>15 jours</b> (sécurité appliquée à tout le monde).</p>
      <div class="msg" id="msg" role="alert" aria-live="polite"></div>
      <div class="spinner" id="spinner" aria-hidden="true"></div>
    </form>
  </div>
</main>

<footer>
  Portail Employés — changement de mot de passe obligatoire<br>
  En cas de difficulté, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var form = document.getElementById("form");
  var inputCur = document.getElementById("cur");
  var inputNew = document.getElementById("new");
  var inputConf = document.getElementById("conf");
  var btn = document.getElementById("btn");
  var msg = document.getElementById("msg");
  var spinner = document.getElementById("spinner");

  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }

  function show(kind, text) {
    msg.className = "msg " + kind;
    msg.textContent = text;
  }
  function setLoading(on) {
    btn.disabled = on;
    btn.style.opacity = on ? ".6" : "";
    spinner.style.display = on ? "block" : "none";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "";
    var cur = inputCur.value || "";
    var nw = inputNew.value || "";
    var conf = inputConf.value || "";
    if (!cur) { show("error", "Veuillez saisir votre mot de passe actuel."); inputCur.focus(); return; }
    // (MODIFIÉ Task 94 : politique de complexité — contrôle client, le serveur reste la référence)
    if (nw.length < 8 || !/[a-z]/.test(nw) || !/[A-Z]/.test(nw) || !/[0-9]/.test(nw) || !/[^A-Za-z0-9]/.test(nw)) {
      show("error", "Le nouveau mot de passe doit contenir au moins 8 caractères, avec minuscule, majuscule, chiffre et symbole (par exemple ! ? _ % @ — tirets et espaces ignorés).");
      inputNew.focus(); return;
    }
    if (nw === cur) { show("error", "Le nouveau mot de passe doit être DIFFÉRENT du mot de passe actuel."); inputNew.focus(); return; }
    if (nw !== conf) { show("error", "La confirmation ne correspond pas au nouveau mot de passe."); inputConf.focus(); return; }
    // Les champs sont vidés dès l'envoi (aucun mot de passe ne reste à l'écran)
    inputCur.value = ""; inputNew.value = ""; inputConf.value = "";
    setLoading(true);
    fetch(apiUrl("/api/change-password"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      cache: "no-store"
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.ok) {
          show("info", "Mot de passe enregistré — ouverture de votre portail…");
          location.replace(apiUrl("/"));
          return;
        }
        show("error", (r.data && r.data.error) || "Changement impossible. Réessayez.");
      })
      .catch(function () {
        show("error", "Impossible de contacter le serveur. Vérifiez votre connexion puis réessayez.");
      })
      .then(function () { setLoading(false); });
  });
})();
</script>
</body>
</html>
`;
}

// ============================================================
//  NOUVEAU (Task 74, MODIFIÉ Task 76) : PAGE OTP — CODE À USAGE UNIQUE
//  (QR CODE UNIQUEMENT À LA PREMIÈRE CONNEXION) — 10 MINUTES
//  Servie avec une session « otp » (CIN + mot de passe DÉJÀ validés).
//  L'employé lit le code à l'écran — et le scanne via le QR code à la
//  PREMIÈRE connexion uniquement (Task 76) — puis le confirme pour ouvrir sa
//  session. Le code (et le QR éventuel) expirent ensemble : 10 minutes
//  (PORTAL_OTP_TTL_MS ne sert qu'à RÉDUIRE la durée en test).
// ============================================================

/** Échappement pour attribut HTML (le contenu du QR est du JSON avec guillemets). */
function echapperAttribut(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// CSS commun aux deux états de la page OTP (active / expirée) — même charte
// que la page de connexion (émeraude, cartes 16px, champs 12px — Task 69).
const CSS_OTP = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: #f6fef9 fixed;
    color: #0f172a; display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    background: #ffffff; border-bottom: 1px solid #e2e8f0;
    padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .logo {
    /* MODIFIÉ (Task 115) : plus de carré vert — le logo Trailmix
       s'affiche directement (dégradé sur fond transparent). */
    height: 34px; display: inline-flex; align-items: center; flex: none;
  }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
  .brand small { display: block; font-weight: 500; font-size: 11.5px; color: #64748b; letter-spacing: 0; }
  main { flex: 1; width: 100%; max-width: 560px; margin: 0 auto; padding: 30px 18px 40px; }
  .hero { text-align: center; margin-bottom: 22px; }
  .hero h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.4px; }
  .hero p { color: #475569; font-size: 14.5px; margin-top: 6px; line-height: 1.55; }
  .card {
    background: #ffffff; border: 1px solid #e6eaf2; border-radius: 16px;
    padding: 24px; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);
  }
  label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 7px; color: #1e293b; }
  .field { margin-bottom: 16px; }
  input[type="text"] {
    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; text-transform: uppercase; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="text"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  /* (NOUVEAU Task 83) champ MOT DE PASSE dans CSS_OTP : la page /premiere
     (étape 1 de la première connexion) utilise CE bloc CSS — sans cette
     règle, ses 3 champs mot de passe (initial / nouveau / répétition)
     s'affichaient en style navigateur BRUT. Style identique au champ CIN
     (coins 12px, bordure 1.5px, hauteur 48px, anneau émeraude au focus). */
  input[type="password"] {
    width: 100%; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="password"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  input.code {
    letter-spacing: 10px; font-size: 22px; font-weight: 700; text-align: center;
    text-transform: none; padding-left: 0; padding-right: 0;
  }
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: #10b981; color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: #10b981; color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: #10b981; color: #fff;
    font-weight: 800; font-size: 17px; display: inline-flex; align-items: center;
    justify-content: center; flex: none; box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .carte-titre { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .carte-sous { color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 2px; }
  .champ-mdp { position: relative; }
  .champ-mdp input { padding-right: 48px; }
  .oeil {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 38px; height: 38px; border: none; background: transparent; color: #94a3b8;
    cursor: pointer; border-radius: 9px; display: inline-flex; align-items: center;
    justify-content: center; padding: 0;
  }
  .oeil:hover { background: #f1f5f9; color: #475569; }
  .oeil svg { width: 19px; height: 19px; }
  .note-verte {
    display: flex; gap: 10px; align-items: flex-start; background: #FFF3E8;
    border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #10b981;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #10b981;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .otp-intro { color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
  .otp-qr {
    display: flex; justify-content: center; align-items: center;
    padding: 14px; border: 1px solid #e2e8f0; border-radius: 14px;
    background: #ffffff; margin-bottom: 10px; min-height: 244px;
  }
  .otp-qr svg { width: 216px; height: 216px; display: block; }
  .otp-scan { text-align: center; color: #64748b; font-size: 12.5px; margin-bottom: 14px; line-height: 1.55; }
  /* (SUPPRIMÉ Task 85) styles .otp-code / .otp-compte du code affiché en
     clair : le code OTP n'est JAMAIS affiché — la fenêtre montre uniquement
     le QR code (demande utilisateur Task 85). */
  .otp-liens { display: flex; gap: 10px; margin-top: 14px; }
  .lien-b {
    flex: 1; height: 42px; background: #FFF9F3; color: #334155;
    border: 1.5px solid #cbd5e1; font-weight: 600; font-size: 13.5px;
  }
  .lien-b:hover { background: #f1f5f9; }
  footer {
    margin-top: auto; padding: 16px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6;
  }
`;

// ============================================================
//  NOUVEAU (Task 83 — MAQUETTE UTILISATEUR) : PAGE « PREMIÈRE CONNEXION »
//  (étape 1 : identification + changement du mot de passe initial).
//  Demande utilisateur : « Créer une page avec les champs suivants : CIN,
//  Mot de passe initial, Nouveau mot de passe, Répéter le nouveau mot de
//  passe, Bouton Valider ». Après validation → étape 2 (/otp) : QR code +
//  champ Code OTP + mention d'expiration + bouton « Valider ». Accessible
//  via le lien de la page de connexion (et redirection automatique depuis
//  /api/verify quand le compte exige encore le changement initial).
// ============================================================
const PREMIERE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : première connexion</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="card">
    <div class="carte-tete">
      <span class="icon-rond" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </span>
      <span>
        <span class="carte-titre">Première connexion</span>
        <span class="carte-sous">Pour des raisons de sécurité, vous devez changer votre mot de
        passe initial et configurer votre compte OTP.</span>
      </span>
    </div>

    <form id="form-premiere" novalidate autocomplete="off">
      <div class="field">
        <label for="cin">CIN</label>
        <input type="text" id="cin" name="cin" placeholder="Votre numéro CIN"
               autocomplete="off" spellcheck="false" autofocus>
      </div>
      <div class="field">
        <label for="password">Mot de passe initial</label>
        <div class="champ-mdp">
          <input type="password" id="password" name="password" placeholder="Mot de passe initial"
                 autocomplete="current-password">
          <button type="button" class="oeil" data-cible="password" aria-label="Afficher le mot de passe initial" tabindex="-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="field">
        <label for="nouveau">Nouveau mot de passe</label>
        <div class="champ-mdp">
          <input type="password" id="nouveau" name="nouveau" placeholder="8 car. min. : minuscule, majuscule, chiffre, symbole"
                 autocomplete="new-password">
          <button type="button" class="oeil" data-cible="nouveau" aria-label="Afficher le nouveau mot de passe" tabindex="-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
        <p class="hint" style="margin-top:6px">Au moins <b>8 caractères</b> avec <b>minuscule</b>, <b>majuscule</b>,
           <b>chiffre</b> et <b>symbole</b> (par exemple ! ? _ % @ — tirets et espaces ignorés à la saisie),
           différent du mot de passe initial et de votre CIN. Il sera à nouveau à changer dans 15 jours.</p>
      </div>
      <div class="field">
        <label for="repete">Répéter le nouveau mot de passe</label>
        <div class="champ-mdp">
          <input type="password" id="repete" name="repete" placeholder="Répétez le nouveau mot de passe"
                 autocomplete="new-password">
          <button type="button" class="oeil" data-cible="repete" aria-label="Afficher la répétition" tabindex="-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <button type="submit" id="btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Valider
      </button>
      <a class="lien-premiere" href="/login">Déjà configuré ? Se connecter (CIN + mot de passe + OTP)</a>
      <div class="msg" id="msg" role="alert" aria-live="polite"></div>
      <div class="spinner" id="spinner" aria-hidden="true"></div>
    </form>
  </div>
</main>

<footer>
  Première connexion — étape 1 sur 2 : identification + changement du mot de passe.<br>
  <!-- (MODIFIÉ Task 86 : le QR d'inscription expire VRAIMENT — nouveau secret à chaque fenêtre) -->
  À l'étape suivante, le QR code d'inscription s'affiche avec un compte à rebours de ${LIBELLE_OTP} :
  scannez-le et confirmez le code DANS CE DÉLAI, sinon il devient invalide et un NOUVEAU QR vous sera présenté.<br>
  En cas d'anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var form = document.getElementById("form-premiere");
  var inputCin = document.getElementById("cin");
  var inputInitial = document.getElementById("password");
  var inputNouveau = document.getElementById("nouveau");
  var inputRepete = document.getElementById("repete");
  var btn = document.getElementById("btn");
  var msg = document.getElementById("msg");
  var spinner = document.getElementById("spinner");
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  function show(kind, text) { msg.className = "msg " + kind; msg.textContent = text; }
  function setLoading(on) {
    btn.disabled = on;
    btn.style.opacity = on ? ".6" : "";
    spinner.style.display = on ? "block" : "none";
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.className = "msg"; msg.textContent = "";
    var cin = (inputCin.value || "").toUpperCase().replace(/[\\s]+/g, "");
    var initial = inputInitial.value || "";
    var nouveau = inputNouveau.value || "";
    var repete = inputRepete.value || "";
    if (cin.length < 3) { show("error", "Veuillez saisir votre numéro CIN complet."); inputCin.focus(); return; }
    if (!initial) { show("error", "Veuillez saisir votre mot de passe initial."); inputInitial.focus(); return; }
    if (!nouveau) { show("error", "Veuillez choisir un nouveau mot de passe."); inputNouveau.focus(); return; }
    if (nouveau !== repete) { show("error", "La répétition ne correspond pas au nouveau mot de passe."); inputRepete.focus(); return; }
    // (Esprit Task 17) les champs sont vidés dès la tentative envoyée.
    inputCin.value = ""; inputInitial.value = ""; inputNouveau.value = ""; inputRepete.value = "";
    setLoading(true);
    fetch(apiUrl("/api/premiere"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cin: cin, password: initial, newPassword: nouveau, confirm: repete }),
      cache: "no-store"
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.ok) {
          // (Task 83 — maquette, carte 2) étape 2 : QR code + champ Code OTP.
          show("info", "Mot de passe enregistré — configuration de votre application d'authentification…");
          location.replace(apiUrl("/otp"));
          return;
        }
        show("error", (r.data && r.data.error) || "Impossible d'enregistrer le mot de passe. Réessayez.");
      })
      .catch(function () {
        show("error", "Impossible de contacter le serveur. Vérifiez votre connexion puis réessayez.");
      })
      .then(function () { setLoading(false); });
  });
  document.querySelectorAll(".oeil").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = document.getElementById(b.getAttribute("data-cible"));
      if (!i) return;
      var visible = i.type === "text";
      i.type = visible ? "password" : "text";
      b.setAttribute("aria-label", visible ? "Afficher le mot de passe" : "Masquer le mot de passe");
      b.style.color = visible ? "#94a3b8" : "#10b981";
    });
  });
})();
</script>
</body>
</html>
`;

// ============================================================
//  NOUVEAU (Task 83 — MAQUETTE UTILISATEUR) : PAGE « CONFIGURATION RÉUSSIE »
//  (/premiere-reussie — carte 3 de la maquette) : confirmation visuelle de
//  la première connexion (QR scanné + code OTP validé), encadré « Le QR
//  code n'est affiché que lors de la première connexion. ».
//  (MODIFIÉ Task 87) redirection automatique (5 s) ET bouton vers la
//  FENÊTRE INITIALE de connexion /login (CIN + mot de passe + code OTP) —
//  la session d'inscription est FERMÉE au moment où la page est servie.
// ============================================================
const SUCCESS_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : configuration réussie</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="card" style="text-align:center; padding:34px 24px;">
    <div style="width:64px; height:64px; border-radius:50%; background:#FFE6CC; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.3px;">Configuration réussie</h1>
    <p style="color:#475569; font-size:14.5px; line-height:1.6; margin-top:8px;">
      Votre compte est maintenant sécurisé avec l'authentification à deux
      facteurs (OTP). Les connexions suivantes se font avec votre <b>CIN</b>,
      votre <b>mot de passe</b> et un <b>code OTP</b>.
    </p>
    <div class="note-verte" style="text-align:left; margin-top:16px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>Le QR code n'est affiché que lors de la première connexion.</span>
    </div>
    <p style="color:#64748b; font-size:13.5px; margin-top:14px;">
      Vous allez maintenant être redirigé vers la fenêtre de connexion
      (CIN, mot de passe et code OTP).
    </p>
    <a href="/login" id="btn-connexion" style="margin-top:18px; display:inline-flex; width:100%; height:48px; border-radius:12px; background:#10b981; color:#fff; font-size:15px; font-weight:700; align-items:center; justify-content:center; gap:8px; text-decoration:none;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
      </svg>
      Aller à la page de connexion
    </a>
  </div>
</main>

<footer>
  Configuration terminée — accès protégé par CIN + mot de passe + code OTP.<br>
  En cas d'anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  // (MODIFIÉ Task 87) Redirection automatique vers la fenêtre INITIALE de
  // connexion — CIN + mot de passe + code OTP (5 secondes).
  setTimeout(function () { location.replace(apiUrl("/login")); }, 5000);
})();
</script>
</body>
</html>
`;

function enteteOtp() {
  return `<header>
  <span class="logo" aria-hidden="true">
    <!-- MODIFIÉ (Task 115) : logo Trailmix (data URI PNG, fond transparent) -->
    <img src="${LOGO_TRAILMIX_PNG}" alt="" style="width:auto;height:34px;display:block" />
  </span>
  <span class="brand">AutoRH<small>Portail Employés</small></span>
</header>`;
}

/**
 * (REFONTE Task 85) FENÊTRE DE CONFIRMATION OTP — CONNEXIONS SUIVANTES :
 * QR code UNIQUEMENT (AUCUN code affiché) + champ « Code OTP » + « Valider ».
 * Demande utilisateur : « jamais affiche le code otp comme ca — dans cette
 * fenetre n affiche que qr code qui expire apres 10 minute ». Alignée sur la
 * fenêtre d'inscription otpPremiereHtml (Task 83) : le QR encode l'URI
 * STANDARD otpauth://totp/… (secret TOTP PERSISTANT — le même que celui
 * scanné à la première connexion : l'application déjà inscrite continue de
 * générer les codes ; le QR permet en plus de RÉ-ASSOCIER un compte perdu).
 * À l'expiration du défi (10 minutes), bascule automatique vers la page
 * « code expiré » (bouton « Se reconnecter »).
 * (SUPPRIMÉ Task 85) : bloc code affiché en clair, compte à rebours du code,
 * bouton « Générer un nouveau code » (et son endpoint /api/otp/nouveau),
 * code stocké dans le défi — la SEULE voie de confirmation est le code TOTP
 * de l'application d'authentification (vérifié par /api/otp/verify).
 * @param {Object} defi  défi OTP actif (expireAt, premiere, cin, totpSecret)
 * @param {string} svgQr QR code SVG généré côté serveur ("" si échec de
 *        génération — pratiquement impossible ; le champ de saisie reste
 *        alors utilisable par une application déjà inscrite)
 */
function otpHtml(defi, svgQr) {
  const expireAtMs = defi.expireAt;
  const payload = contenuQrOtp(defi);
  // (Task 86) libellé HONNÊTE : le QR d'un employé NON INSCRIT (secret de
  // fenêtre) expire VRAIMENT avec la fenêtre ; le QR d'un employé INSCRIT
  // (secret définitif) reste valable — c'est la FENÊTRE qui se ferme.
  const libelle = defi.fenetre ? "Le QR code expire dans" : "Cette fenêtre expire dans";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : code OTP</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="hero">
    <h1>Vérification en deux étapes</h1>
    <p>Votre <b>CIN</b> et votre <b>mot de passe</b> sont validés.<br>
       Dernière étape : scannez le QR code ci-dessous avec votre application
       d'authentification puis confirmez le code OTP qu'elle génère — ${defi.fenetre ? "le QR code expire dans " + LIBELLE_OTP : "cette fenêtre expire dans " + LIBELLE_OTP}.</p>
  </div>

  <div class="card">
    ${svgQr ? `<div class="otp-qr" id="qr-bloc" data-payload="${echapperAttribut(payload)}">${svgQr}</div>
    <p class="otp-scan">Format standard « otpauth://totp » : scannez ce QR code avec votre
       application d'authentification (PAS avec l'appareil photo) — elle générera
       vos codes OTP, valables 30 secondes chacun.</p>` : ""}
    <form id="form-otp" novalidate autocomplete="off">
      <p class="expire-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        <!-- (MODIFIÉ Task 86) compte à rebours RESTANT affiché en direct -->
        ${libelle} <b id="qr-cd">&nbsp;${LIBELLE_OTP}</b>.
      </p>
      <div class="field">
        <label for="otp-saisie">Confirmez le code OTP (6 chiffres)</label>
        <input type="text" id="otp-saisie" class="code" inputmode="numeric" maxlength="8"
               placeholder="••••••" autocomplete="one-time-code" autofocus>
      </div>
      <button type="submit" id="btn-otp">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
        </svg>
        Valider le code
      </button>
    </form>
    <div class="msg" id="msg" role="alert" aria-live="polite"></div>
    <div class="otp-liens">
      <button type="button" id="btn-deconnexion" class="lien-b">Se déconnecter</button>
    </div>
    <p class="hint">Le code à 6 chiffres vient UNIQUEMENT de votre application
       d'authentification : il n'est JAMAIS affiché sur cette page.<br>
       ${defi.fenetre ? "QR code expiré ? Il est DÉFINITIVEMENT invalide : déconnectez-vous puis reconnectez-vous avec votre CIN et votre mot de passe pour afficher un NOUVEAU QR code (nouveau secret, 10 minutes)." : "Fenêtre expirée ? Déconnectez-vous puis reconnectez-vous avec votre CIN et votre mot de passe pour afficher de nouveau la fenêtre QR (10 minutes)."}</p>
  </div>
</main>

<footer>
  Étape 2 sur 2 — vérification par code OTP (fenêtre valable ${LIBELLE_OTP}).<br>
  En cas d'anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  var expireMs = ${expireAtMs};
  // (MODIFIÉ Task 85) plus de compte à rebours ni de bouton « Générer un
  // nouveau code » : à l'expiration du défi (${LIBELLE_OTP}), bascule
  // automatique vers la page « code expiré » (bouton « Se reconnecter ») —
  // le QR code et sa fenêtre expirent ensemble après 10 minutes.
  // (NOUVEAU Task 86) le temps RESTANT s'affiche en direct (mm:ss).
  var form = document.getElementById("form-otp");
  var input = document.getElementById("otp-saisie");
  var btn = document.getElementById("btn-otp");
  var btnDeconnexion = document.getElementById("btn-deconnexion");
  var msg = document.getElementById("msg");
  var cd = document.getElementById("qr-cd");
  function majCd() {
    if (!cd) return;
    var s = Math.max(0, Math.ceil((expireMs - Date.now()) / 1000));
    var m = Math.floor(s / 60);
    cd.textContent = " " + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function show(kind, text) { msg.className = "msg " + kind; msg.textContent = text; }
  function basculerExpire() { location.replace(apiUrl("/otp")); }
  var bascule = false;
  majCd();
  var timer = setInterval(function () {
    if (bascule) { clearInterval(timer); return; }
    majCd();
    if (expireMs - Date.now() <= 0) {
      bascule = true;
      clearInterval(timer);
      basculerExpire();
    }
  }, 500);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    bascule = true; clearInterval(timer);
    // (Esprit Task 66) tolérance de saisie : tirets/espaces ignorés
    var code = (input.value || "").replace(/[\\s-]/g, "");
    if (!/^\\d{6}$/.test(code)) {
      show("error", "Veuillez saisir le code OTP à 6 chiffres généré par votre application d'authentification.");
      input.focus();
      return;
    }
    btn.disabled = true; btn.style.opacity = ".6";
    fetch(apiUrl("/api/otp/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: code }),
      cache: "no-store"
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) {
          // (MODIFIÉ Task 90) la destination est décidée par le serveur :
          //  - « /changer » : changement de mot de passe obligatoire (Task 64) ;
          //  - « /premiere-reussie » (NOUVEAU Task 90) : la confirmation vient
          //    de TERMINER l'inscription (QR de fenêtre confirmé pour la
          //    première fois — p. ex. QR expiré puis re-scanne à la
          //    reconnexion) : la page « Configuration réussie » referme la
          //    session et ramène à la FENÊTRE INITIALE de connexion (CIN +
          //    mot de passe + code OTP — même parcours que la première
          //    connexion, Task 87) ;
          //  - « / » dans les autres cas : employé DÉJÀ INSCRIT (secret
          //    scellé) — connexion normale, ouverture directe de l'espace.
          var dest = (r.d && typeof r.d.redirect === "string") ? r.d.redirect : "/";
          if (dest === "/premiere-reussie") {
            show("info", "Code confirmé — configuration terminée…");
            location.replace(apiUrl("/premiere-reussie"));
            return;
          }
          show("info", "Code confirmé — ouverture de votre espace…");
          location.replace(apiUrl(dest === "/changer" ? "/changer" : "/"));
          return;
        }
        btn.disabled = false; btn.style.opacity = "";
        if (r.d && (r.d.code === "OTP_EXPIRE" || r.d.code === "OTP_ANNULE" || r.d.code === "OTP_SESSION_ABSENTE")) {
          basculerExpire();
          return;
        }
        show("error", (r.d && r.d.error) || "Code refusé. Réessayez.");
        input.select(); input.focus();
      })
      .catch(function () {
        btn.disabled = false; btn.style.opacity = "";
        show("error", "Impossible de contacter le serveur. Réessayez.");
      });
  });
  btnDeconnexion.addEventListener("click", function () {
    btnDeconnexion.disabled = true;
    fetch(apiUrl("/api/logout"), { method: "POST", cache: "no-store" })
      .then(function () { location.replace(apiUrl("/login")); })
      .catch(function () { location.replace(apiUrl("/login")); });
  });
})();
</script>
</body>
</html>
`;
}

/**
 * MODIFIÉ (Task 83 — MAQUETTE, carte 2) PAGE D'INSCRIPTION — ÉTAPE 2 :
 * « Configuration OTP » — RENOMMÉE otpPremiereHtml (remplace otpQrSeulHtml
 * Task 80 : la demande « uniquement le QR code » est REMPLACÉE par la
 * maquette utilisateur — l'étape 2 porte de nouveau le champ « Code OTP »
 * et le bouton « Valider », sinon l'inscription ne pouvait JAMAIS être
 * complétée depuis cette fenêtre).
 * Servie à la TOUTE PREMIÈRE connexion (défi en mode `premiere`) : le QR
 * encode l'URI STANDARD otpauth://totp/… (Task 78, secret Base32
 * persistant) ; l'employé scanne, saisit le code à 6 chiffres de son
 * application et valide → /api/otp/verify → /premiere-reussie.
 * À l'expiration du défi, la page bascule d'elle-même vers la page
 * « code expiré » (bouton « Se reconnecter »).
 * @param {Object} defi  défi OTP actif (premiere:true, expireAt, totpSecret, cin)
 * @param {string} svgQr QR code SVG généré côté serveur (page servie SEULEMENT si non vide)
 */
function otpPremiereHtml(defi, svgQr) {
  const expireAtMs = defi.expireAt;
  const payload = contenuQrOtp(defi);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : configuration OTP</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="card">
    <div class="carte-tete">
      <span class="etq-etape" aria-hidden="true">2</span>
      <span>
        <span class="carte-titre">Configuration OTP</span>
        <span class="carte-sous">Scannez le QR code avec votre application
        d'authentification (Google Authenticator, Microsoft Authenticator,
        Authy, FreeOTP…) pour associer votre compte. Puis saisissez le code
        OTP généré par votre application.</span>
      </span>
    </div>

    <div class="otp-qr otp-premiere" id="qr-bloc" data-payload="${echapperAttribut(payload)}">${svgQr}</div>

    <form id="form-otp" novalidate autocomplete="off">
      <div class="field">
        <label for="otp-saisie">Code OTP</label>
        <input type="text" id="otp-saisie" class="code" inputmode="numeric" maxlength="8"
               placeholder="••••••" autocomplete="one-time-code" autofocus>
      </div>
      <p class="expire-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        <!-- (MODIFIÉ Task 86) le compte à rebours RESTANT est affiché en
             direct (mm:ss) — le QR expire VRAIMENT à la fin du décompte -->
        Le QR code expire dans <b id="qr-cd">&nbsp;${LIBELLE_OTP}</b>.
      </p>
      <button type="submit" id="btn-otp">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        Valider
      </button>
    </form>
    <div class="msg" id="msg" role="alert" aria-live="polite"></div>
    <p class="hint">Après expiration, ce QR code est DÉFINITIVEMENT invalide :
       à la reconnexion, un NOUVEAU QR code (nouveau secret) vous sera présenté —
       scannez-le et confirmez le code dans les ${LIBELLE_OTP}.</p>
  </div>
</main>

<footer>
  Première connexion — étape 2 sur 2 : configuration de l'authentification à deux facteurs.<br>
  Le QR code ne sera plus affiché aux connexions suivantes.<br>
  En cas d'anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  var expireMs = ${expireAtMs};
  // (MODIFIÉ Task 83) la fenêtre porte le QR code ET le formulaire de
  // confirmation : à l'expiration, bascule automatique vers la page
  // « code expiré » (bouton « Se reconnecter »).
  // (NOUVEAU Task 86) le temps RESTANT s'affiche en direct (mm:ss) — la
  // promesse « le QR code expire après 10 minutes » est VISIBLE et VRAIE :
  // à la fin du décompte le QR est mort (nouveau secret à la reconnexion).
  var form = document.getElementById("form-otp");
  var input = document.getElementById("otp-saisie");
  var btn = document.getElementById("btn-otp");
  var msg = document.getElementById("msg");
  var cd = document.getElementById("qr-cd");
  function majCd() {
    if (!cd) return;
    var s = Math.max(0, Math.ceil((expireMs - Date.now()) / 1000));
    var m = Math.floor(s / 60);
    cd.textContent = " " + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function show(kind, text) { msg.className = "msg " + kind; msg.textContent = text; }
  function basculerExpire() { location.replace(apiUrl("/otp")); }
  var bascule = false;
  majCd();
  var timer = setInterval(function () {
    if (bascule) { clearInterval(timer); return; }
    majCd();
    if (expireMs - Date.now() <= 0) {
      bascule = true;
      clearInterval(timer);
      basculerExpire();
    }
  }, 500);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    bascule = true; clearInterval(timer);
    // (Esprit Task 66) tolérance de saisie : tirets/espaces ignorés
    var code = (input.value || "").replace(/[\\s-]/g, "");
    if (!/^\\d{6}$/.test(code)) {
      show("error", "Veuillez saisir le code OTP à 6 chiffres généré par votre application.");
      input.focus();
      return;
    }
    btn.disabled = true; btn.style.opacity = ".6";
    fetch(apiUrl("/api/otp/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: code }),
      cache: "no-store"
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) {
          // (Task 83 — maquette, carte 3) page « Configuration réussie ».
          show("info", "Code confirmé — configuration terminée…");
          location.replace(apiUrl("/premiere-reussie"));
          return;
        }
        btn.disabled = false; btn.style.opacity = "";
        if (r.d && (r.d.code === "OTP_EXPIRE" || r.d.code === "OTP_ANNULE" || r.d.code === "OTP_SESSION_ABSENTE")) {
          basculerExpire();
          return;
        }
        show("error", (r.d && r.d.error) || "Code refusé. Réessayez.");
        input.select(); input.focus();
      })
      .catch(function () {
        btn.disabled = false; btn.style.opacity = "";
        show("error", "Impossible de contacter le serveur. Réessayez.");
      });
  });
})();
</script>
</body>
</html>
`;
}

/**
 * Page OTP EXPIRÉE : servie quand la session « otp » existe encore mais que
 * le défi a expiré (10 minutes écoulées, déjà consommé ou annulé) — le code
 * ne vaut plus rien, la reconnexion CIN + mot de passe est requise.
 */
function otpExpireHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : code OTP expiré</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="hero">
    <h1>Code OTP expiré</h1>
    <p>Par sécurité, le QR code de vérification n'est valable que ${LIBELLE_OTP}.</p>
  </div>

  <div class="card">
    <div class="otp-intro"><b>Ce QR code n'est plus valable.</b><br>
       <!-- (MODIFIÉ Task 86 : le QR d'inscription non confirmé est mort pour de bon) -->
       Il a expiré au bout de ${LIBELLE_OTP} — pour un QR d'inscription non
       confirmé, le secret encodé est DÉFINITIVEMENT mort : aucun code généré
       à partir de lui ne sera accepté. Reconnectez-vous avec votre CIN et
       votre mot de passe : un NOUVEAU QR code (nouveau secret) sera affiché
       pour ${LIBELLE_OTP}. Le code à 6 chiffres vient de votre application
       d'authentification — il n'est JAMAIS affiché ici.</div>
    <form id="form-retour" novalidate>
      <button type="submit" id="btn-retour">Se reconnecter</button>
    </form>
    <p class="hint">Aucune fiche de paie n'est accessible sans connexion complète :
       CIN + mot de passe + code OTP confirmé.</p>
    <div class="msg" id="msg" role="alert" aria-live="polite"></div>
  </div>
</main>

<footer>
  Étape 2 sur 2 — vérification par code OTP (QR code valable ${LIBELLE_OTP}).<br>
  En cas d'anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  document.getElementById("form-retour").addEventListener("submit", function (e) {
    e.preventDefault();
    fetch(apiUrl("/api/logout"), { method: "POST", cache: "no-store" })
      .then(function () { location.replace(apiUrl("/login")); })
      .catch(function () { location.replace(apiUrl("/login")); });
  });
})();
</script>
</body>
</html>
`;
}

// ============================================================
//  PAGE UNIQUE (HTML autonome : aucun fichier externe, aucun CDN)
//  (Servie UNIQUEMENT avec une session COMPLÈTE — c'est-à-dire APRES le
//   changement de mot de passe quand il est exigé, Task 64 ; l'ancien
//   formulaire de recherche libre est remplacé par un chargement
//   automatique des fiches liées au CIN de la session.)
// ============================================================
const PAGE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : vos fiches de paie</title>
<!-- NOUVEAU (Task 26) : même logo (favicon) que la page administration -->
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: #f6fef9 fixed;
    color: #0f172a; display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    background: #ffffff; border-bottom: 1px solid #e2e8f0;
    padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .logo {
    /* MODIFIÉ (Task 115) : plus de carré vert — le logo Trailmix
       s'affiche directement (dégradé sur fond transparent). */
    height: 34px; display: inline-flex; align-items: center; flex: none;
  }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
  .brand small { display: block; font-weight: 500; font-size: 11.5px; color: #64748b; letter-spacing: 0; }
  /* (MODIFIÉ 0.2.55 — Task 134) max-width 700px : la barre d'outils accueille
     le bouton « Fiches de paie » DEPLACÉ ici (5 éléments) sur UNE ligne. */
  main { flex: 1; width: 100%; max-width: 700px; margin: 0 auto; padding: 30px 18px 40px; }
  .hero { text-align: center; margin-bottom: 22px; }
  .hero h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.4px; }
  .hero p { color: #475569; font-size: 14.5px; margin-top: 6px; line-height: 1.55; }
  .card {
    background: #ffffff; border: 1px solid #e6eaf2; border-radius: 16px;
    padding: 24px; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);
  }
  label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 7px; color: #1e293b; }
  .row { display: flex; gap: 10px; }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs mot de passe
     arrondis (image utilisateur) sur les pages connexion et changement. */
  input[type="text"] {
    flex: 1; min-width: 0; height: 48px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 0 14px; font-size: 16px; text-transform: uppercase; outline: none; background: #fff;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="text"]:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: #10b981; color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 8px; transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 9px; line-height: 1.5; }
  /* NOUVEAU (Task 18) : barre d'outils de la session (CIN masqué + actions) */
  /* (MODIFIÉ 0.2.55 — Task 134) gap 8px + boutons plus compacts : la barre
     accueille DÉSORMAIS 5 éléments (pastille CIN + Fiches de paie + Mes
     demandes + Actualiser + Déconnexion) et reste sur UNE seule ligne. */
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cin-chip {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #FFF3E8; color: #047857; border: 1px solid #a7f3d0;
    /* (MODIFIÉ 0.2.55 — Task 134) 13px / 6px 9px : barre sur une ligne */
    font-weight: 800; font-size: 13px; padding: 6px 9px; border-radius: 999px;
  }
  .tb-spacer { flex: 1; }
  /* (MODIFIÉ 0.2.55 — Task 134) 12.5px / 0 10px : 5 éléments sur une ligne */
  .toolbar button { height: 40px; font-size: 12.5px; padding: 0 10px; }
  .btn-logout { background: #ffffff; color: #334155; border: 1.5px solid #cbd5e1; }
  .btn-logout:hover { background: #f1f5f9; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: #10b981; color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: #10b981; color: #fff;
    font-weight: 800; font-size: 17px; display: inline-flex; align-items: center;
    justify-content: center; flex: none; box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .carte-titre { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .carte-sous { color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 2px; }
  .champ-mdp { position: relative; }
  .champ-mdp input { padding-right: 48px; }
  .oeil {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 38px; height: 38px; border: none; background: transparent; color: #94a3b8;
    cursor: pointer; border-radius: 9px; display: inline-flex; align-items: center;
    justify-content: center; padding: 0;
  }
  .oeil:hover { background: #f1f5f9; color: #475569; }
  .oeil svg { width: 19px; height: 19px; }
  .note-verte {
    display: flex; gap: 10px; align-items: flex-start; background: #FFF3E8;
    border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #10b981;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #10b981;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #10b981; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #results { margin-top: 20px; }
  .count { font-size: 13.5px; color: #475569; font-weight: 600; margin-bottom: 10px; }
  /* NOUVEAU (0.2.60) barre de pagination « ‹ Précédent / 1 2 3 … / Suivant › » */
  .pagin {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center;
    margin: 18px 0 6px;
  }
  .pag-btn {
    min-width: 38px; height: 36px; padding: 0 12px; border-radius: 9px;
    border: 1.5px solid #a7f3d0; background: #ffffff; color: #065f46;
    font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .pag-btn:hover:not(:disabled) { background: #FFF3E8; }
  .pag-btn:disabled { opacity: .45; cursor: default; }
  .pag-actif { background: #10b981; border-color: #10b981; color: #ffffff; }
  .pag-actif:hover:not(:disabled) { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  .pag-suite { color: #94a3b8; font-weight: 700; padding: 0 2px; }
  /* NOUVEAU (0.2.61) bouton « Tout afficher » / « Pages de 100 » — l'employé
     choisit : navigation page par page OU toutes les fiches d'un coup. */
  .pag-bascule { margin-left: 14px; border-style: dashed; background: #ecfdf5; }
  .payslip {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 16px 14px;
    margin-bottom: 12px; box-shadow: 0 2px 8px rgba(2,44,34,.04); transition: box-shadow .15s;
  }
  .payslip:hover { box-shadow: 0 6px 18px rgba(2,44,34,.09); }
  .p-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
  .period { font-size: 16px; font-weight: 800; letter-spacing: -0.2px; }
  .emp { color: #475569; font-size: 13.5px; margin-top: 2px; }
  .net {
    background: #FFF3E8; color: #047857; border: 1px solid #a7f3d0;
    font-weight: 800; font-size: 13.5px; padding: 5px 11px; border-radius: 999px; white-space: nowrap;
  }
  .p-meta { color: #64748b; font-size: 12.5px; margin-top: 8px; display: flex; gap: 14px; flex-wrap: wrap; }
  .p-actions { display: flex; gap: 8px; margin-top: 13px; flex-wrap: wrap; }
  .p-actions a {
    text-decoration: none; height: 38px; padding: 0 14px; border-radius: 9px; font-size: 13.5px;
    font-weight: 700; display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
  }
  .a-open { background: #10b981; color: #fff; }
  .a-open:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  .a-dl { background: #ffffff; color: #065f46; border: 1.5px solid #a7f3d0; }
  .a-dl:hover { background: #FFF3E8; }
  footer {
    margin-top: auto; padding: 16px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6;
  }
  @media (max-width: 480px) {
    .row { flex-direction: column; }
    button { width: 100%; justify-content: center; }
    /* (0.2.60) la pagination reste compacte même sur petit écran */
    .pagin button { width: auto; min-width: 40px; }
    .hero h1 { font-size: 20px; }
  }
</style>
</head>
<body>
<header>
  <span class="logo" aria-hidden="true">
    <!-- MODIFIÉ (Task 115) : logo Trailmix (data URI PNG, fond transparent) -->
    <img src="${LOGO_TRAILMIX_PNG}" alt="" style="width:auto;height:34px;display:block" />
  </span>
  <span class="brand">AutoRH<small>Portail Employés</small></span>
</header>

<main>
  <div class="hero">
    <h1>Vos fiches de paie</h1>
    <p>Accès sécurisé : session liée à votre numéro de CIN.<br>
       Seules les fiches contenant <b>exactement</b> votre CIN sont affichées.</p>
  </div>

  <div class="card">
    <!-- MODIFIÉ (Task 18) : le formulaire de recherche libre est remplacé par
         une barre de session — les fiches sont chargées automatiquement et la
         recherche est VERROUILLÉE côté serveur sur le CIN de la session. -->
    <div class="toolbar">
      <span class="cin-chip" id="cin-chip" title="Votre CIN (masqué)">•••••</span>
      <span class="tb-spacer"></span>
      <!-- (DÉPLACÉ 0.2.55 — Task 134) bouton « Fiches de paie » DÉPLACÉ de la
           rangée d'onglets de la page « Demandes administratives » vers CETTE
           barre d'outils, dans la zone demandée par l'utilisateur : à GAUCHE
           du bouton « Mes demandes ». Il désigne la rubrique courante
           (aria-current="page") et recharge la liste au clic. -->
      <button type="button" id="btn-fiches" aria-current="page" title="Vos fiches de paie — rubrique actuelle">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>
        </svg>
        Fiches de paie
      </button>
      <!-- NOUVEAU (Task 116) : accès à la section Demandes administratives -->
      <button type="button" id="btn-demandes" title="Demandes administratives : attestations, congé, autorisation de sortie, parrainage">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        Mes demandes
      </button>
      <button type="button" id="btn-refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
        </svg>
        Actualiser
      </button>
      <button type="button" id="btn-logout" class="btn-logout">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>
        </svg>
        Déconnexion
      </button>
    </div>
    <div class="msg" id="msg" role="alert" aria-live="polite"></div>
    <div class="spinner" id="spinner" aria-hidden="true"></div>
  </div>

  <section id="results" aria-live="polite"></section>
</main>

<footer>
  Portail employés AutoRH — fiches de paie et demandes administratives<br>
  En cas d'anomalie (CIN introuvable, données incorrectes), contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  // MODIFIÉ (Task 18) : plus de formulaire de recherche libre — la page est
  // réservée aux sessions valides et affiche les fiches du CIN de session.
  var btnRefresh = document.getElementById("btn-refresh");
  var btnLogout = document.getElementById("btn-logout");
  var cinChip = document.getElementById("cin-chip");
  var msg = document.getElementById("msg");
  var spinner = document.getElementById("spinner");
  var results = document.getElementById("results");

  // Compatibilite avec les passerelles qui exigent un parametre de port
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // NOUVEAU (Task 17) : masquage du CIN — seuls les 3 derniers caracteres restent
  // visibles (ex. 07778889 -> "•••889"). Masquage purement visuel : la recherche
  // et l'acces aux PDF continuent d'utiliser le CIN complet.
  function maskCin(s) {
    var v = String(s == null ? "" : s);
    if (v.length <= 3) return v;
    return "•••" + v.slice(-3);
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }); }
    catch (e) { return iso; }
  }
  function fmtSize(o) {
    if (!o && o !== 0) return "";
    if (o < 1024) return o + " o";
    if (o < 1048576) return (o / 1024).toFixed(0) + " Ko";
    return (o / 1048576).toFixed(1) + " Mo";
  }

  function show(kind, text) {
    msg.className = "msg " + kind;
    msg.textContent = text;
  }
  function hideMsg() { msg.className = "msg"; msg.textContent = ""; }

  function setLoading(on) {
    btnRefresh.disabled = on;
    btnRefresh.style.opacity = on ? ".6" : "";
    spinner.style.display = on ? "block" : "none";
  }

  // NOUVEAU (0.2.60) — PAGINATION COMPLÈTE : la liste ne s'arrête plus à
  // 100 fiches (ancien MAX_RESULTS). L'API renvoie total/page/totalPages/
  // hasMore et cette page affiche « X fiches … - page N sur M » avec une
  // barre « ‹ Précédent / 1 2 3 … / Suivant › » : TOUTES les fiches sont
  // accessibles, sans perte ni doublon (l'ordre serveur est stable).
  var pageCourante = 1;

  // Construit la barre de navigation (numéros fenêtrés au-delà de 9 pages).
  // (NOUVEAU 0.2.61) un bouton de bascule complète la barre :
  //   - mode pages   → « Tout afficher »  (charge TOUTES les fiches d'un coup) ;
  //   - mode illimité → « Pages de 100 »  (revient à la navigation par pages).
  function barrePagination(page, totalPages, tout) {
    function btn(p, actif, desactive, titre, libelle) {
      return '<button type="button" class="pag-btn' + (actif ? " pag-actif" : "") + '"' +
        (desactive ? " disabled" : "") +
        ' data-page="' + p + '" aria-label="' + esc(titre) + '"' +
        (actif ? ' aria-current="page"' : "") + ">" + libelle + "</button>";
    }
    var html = '<nav class="pagin" aria-label="Pages de fiches de paie">';
    html += btn(page - 1, false, page <= 1, "Page précédente", "‹ Précédent");
    var numeros = [];
    if (totalPages <= 9) {
      for (var i = 1; i <= totalPages; i++) numeros.push(i);
    } else {
      numeros.push(1);
      var d = Math.max(2, page - 1);
      var f = Math.min(totalPages - 1, page + 1);
      if (d > 2) numeros.push(-1); // -1 = séquence de pages masquée « … »
      for (var j = d; j <= f; j++) numeros.push(j);
      if (f < totalPages - 1) numeros.push(-1);
      numeros.push(totalPages);
    }
    for (var k = 0; k < numeros.length; k++) {
      var n = numeros[k];
      if (n === -1) html += '<span class="pag-suite" aria-hidden="true">…</span>';
      else html += btn(n, n === page, false, "Page " + n, String(n));
    }
    html += btn(page + 1, false, page >= totalPages, "Page suivante", "Suivant ›");
    // (NOUVEAU 0.2.61) bascule d'affichage illimité (data-perpage, traitée par
    // la délégation de clic en même titre que data-page).
    html += '<button type="button" class="pag-btn pag-bascule" data-perpage="' +
      (tout ? "pages" : "all") + '" aria-label="' +
      (tout ? "Revenir aux pages de 100" : "Tout afficher sur une seule page") +
      '">' + (tout ? "Pages de 100" : "Tout afficher") + "</button>";
    html += "</nav>";
    return html;
  }

  function render(items, query, meta) {
    var total = (meta && meta.total) || items.length;
    var page = (meta && meta.page) || 1;
    var totalPages = (meta && meta.totalPages) || 1;
    if (!items.length) {
      results.innerHTML =
        '<div class="card" style="text-align:center;padding:26px">' +
        '<div style="font-size:34px" aria-hidden="true">🔍</div>' +
        '<p style="font-weight:700;margin-top:8px">Aucune fiche de paie trouvée</p>' +
        '<p style="color:#475569;font-size:13.5px;margin-top:5px;line-height:1.55">' +
        // Task 17 : CIN masqué dans le message d'absence de résultat
        'Aucun bulletin ne contient exactement votre CIN « ' + esc(maskCin(query)) + ' ».<br>' +
        'Vérifiez que le numéro est complet, ou contactez votre service RH.</p></div>';
      return;
    }
    // (MODIFIÉ 0.2.60) le compteur affiche le TOTAL de fiches du CIN (renvoyé
    // par l'API) et, quand la liste est découpée, « - page N sur M » — la
    // MÊME information que le portail administratif (551 fiches = 551 fiches).
    var html = '<p class="count">' + total + ' fiche' + (total > 1 ? "s" : "") +
      ' de paie trouvée' + (total > 1 ? "s" : "") + ' avec un CIN se terminant par ' +
      // Task 17 : CIN masqué — seuls les 3 derniers caractères sont visibles
      '<b>' + esc(maskCin(query)) + '</b>' +
      (totalPages > 1
        ? ' - page <b>' + page + '</b> sur <b>' + totalPages + '</b>'
        : (meta && meta.tout ? ' — <b>toutes affichées</b>' : "")) +
      '</p>';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var cinEnc = encodeURIComponent(query);
      var openUrl = apiUrl("/api/payslip/" + encodeURIComponent(it.id) + "/file?cin=" + cinEnc);
      var dlUrl = openUrl + "&download=1";
      // MODIFIÉ (Task 16) : nom de l'employé + net à payer MASQUÉS (demande administrateur) ;
      // le libellé du bouton d'ouverture devient simplement « Ouvrir ».
      // Période, fichier, taille, date et bouton Télécharger inchangés.
      html +=
        '<article class="payslip">' +
        '  <div class="p-top">' +
        '    <div><div class="period">' + esc(it.period || "Période non précisée") + '</div>' +
        // NOUVEAU (Task 231) : badge « signée électroniquement » — la copie
        // affichée ET téléchargée est la copie signée conservée (PAdES).
        (it.signeeElectronique
          ? '<div class="badge-sig" title="La copie affichée et téléchargée porte une signature électronique valide (PAdES)">🔏 Signée électroniquement</div>'
          : '') +
        '    </div>' +
        '  </div>' +
        '  <div class="p-meta"><span>📄 ' + esc(it.fileName) + '</span>' +
        '  <span>' + fmtSize(it.fileSize) + '</span><span>Importé le ' + fmtDate(it.uploadedAt) + '</span></div>' +
        '  <div class="p-actions">' +
        '    <a class="a-open" target="_blank" rel="noopener" href="' + esc(openUrl) + '">Ouvrir</a>' +
        '    <a class="a-dl" href="' + esc(dlUrl) + '">Télécharger</a>' +
        '  </div>' +
        '</article>';
    }
    // (0.2.60) barre de navigation dès que la liste dépasse une page ;
    // (0.2.61) en mode illimité, la barre affiche la bascule « Pages de 100 ».
    if (totalPages > 1 || (meta && meta.tout))
      html += barrePagination(page, totalPages, !!(meta && meta.tout));
    results.innerHTML = html;
  }

  // NOUVEAU (Task 18) : chargement automatique des fiches de la session.
  // La recherche est verrouillée côté serveur sur le CIN de la session —
  // l'employé ne peut consulter que SES propres fiches.
  // (MODIFIÉ 0.2.60) paramètre de page : loadMine(N) charge la page N.
  // (NOUVEAU 0.2.61) paramètre d'affichage : loadMine(N, "all") charge TOUTES
  // les fiches en une seule réponse (perPage=all — affichage illimité).
  function loadMine(page, per) {
    var p = parseInt(page, 10);
    if (!Number.isFinite(p) || p < 1) p = 1;
    var tout = per === "all";
    hideMsg();
    results.innerHTML = "";
    setLoading(true);
    fetch(apiUrl("/api/my-fiches?page=" + p + (tout ? "&perPage=all" : "")), { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) {
          // Session expirée ou absente → retour à la page de connexion
          location.replace(apiUrl("/login"));
          return null;
        }
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (!r) return;
        if (r.ok) {
          if (cinChip) cinChip.textContent = maskCin(r.data.cin || "");
          pageCourante = (r.data && r.data.page) || p;
          render(r.data.items || [], r.data.cin || "", r.data);
          // (0.2.60) après un changement de page, on repart du haut de la liste
          if (pageCourante > 1) {
            try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
          }
        } else {
          show("error", (r.data && r.data.error) || "Erreur lors du chargement. Réessayez.");
        }
      })
      .catch(function () {
        show("error", "Impossible de contacter le serveur. Vérifiez votre connexion puis réessayez.");
      })
      .then(function () { setLoading(false); });
  }

  // (MODIFIÉ 0.2.60) « Actualiser » et « Fiches de paie » reviennent à la
  // page 1 : un bulletin importé entre-temps apparaît immédiatement.
  btnRefresh.addEventListener("click", function () { loadMine(1); });

  // (NOUVEAU 0.2.55 — Task 134) bouton « Fiches de paie » de la barre
  // d'outils : il désigne la rubrique COURANTE de cette page (aria-current).
  // Au clic, la liste est rechargée (un bulletin importé entre-temps
  // apparaît immédiatement) — même comportement que « Actualiser ».
  var btnFiches = document.getElementById("btn-fiches");
  if (btnFiches) {
    btnFiches.addEventListener("click", function () { loadMine(1); });
  }

  // (NOUVEAU 0.2.60) navigation par pagination : UN SEUL écouteur délégué —
  // les boutons « ‹ Précédent / numéros / Suivant › » portent data-page.
  // Les pages sont servies par l'API : cliquer une page charge SES fiches,
  // la navigation couvre donc l'ENSEMBLE des fiches disponibles.
  // (NOUVEAU 0.2.61) les boutons « Tout afficher » / « Pages de 100 » portent
  // data-perpage et basculent le mode d'affichage (illimité ⇄ pages).
  results.addEventListener("click", function (ev) {
    var cible = ev.target;
    while (cible && cible !== results &&
           !(cible.classList && cible.classList.contains("pag-btn"))) {
      cible = cible.parentNode;
    }
    if (!cible || cible === results || cible.disabled) return;
    var per = cible.getAttribute("data-perpage");
    if (per === "all") { loadMine(1, "all"); return; }
    if (per === "pages") { loadMine(1); return; }
    var p = parseInt(cible.getAttribute("data-page"), 10);
    if (Number.isFinite(p) && p >= 1) loadMine(p);
  });

  // NOUVEAU (Task 116) : accès à la section « Demandes administratives »
  var btnDemandes = document.getElementById("btn-demandes");
  if (btnDemandes) {
    btnDemandes.addEventListener("click", function () {
      location.href = apiUrl("/demandes");
    });
  }


  btnLogout.addEventListener("click", function () {
    fetch(apiUrl("/api/logout"), { method: "POST", cache: "no-store" })
      .catch(function () {})
      .then(function () { location.replace(apiUrl("/login")); });
  });

  // Chargement initial des fiches de la session
  loadMine();
})();
</script>
</body>
</html>
`;

const DEMANDES_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoRH — Portail Employés : demandes administratives</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f6fef9 fixed; color: #0f172a;
    display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    background: #ffffff; border-bottom: 1px solid #e2e8f0;
    padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .logo { height: 34px; display: inline-flex; align-items: center; flex: none; }
  .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
  .brand small { display: block; font-weight: 500; font-size: 11.5px; color: #64748b; letter-spacing: 0; }
  main { flex: 1; width: 100%; max-width: 660px; margin: 0 auto; padding: 24px 18px 40px; }
  .card {
    background: #ffffff; border: 1px solid #e6eaf2; border-radius: 16px;
    padding: 22px; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07); margin-bottom: 16px;
  }
  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .cin-chip {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #FFF3E8; color: #047857; border: 1px solid #a7f3d0;
    font-weight: 800; font-size: 14px; padding: 6px 12px; border-radius: 999px;
  }
  .tb-spacer { flex: 1; }
  button {
    height: 44px; padding: 0 18px; border: none; border-radius: 12px; cursor: pointer;
    background: #10b981; color: #fff; font-size: 14px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .btn-secondaire { background: #ffffff; color: #334155; border: 1.5px solid #cbd5e1; }
  .btn-secondaire:hover { background: #f1f5f9; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 12px 0 6px; color: #1e293b; }
  input, select, textarea {
    width: 100%; min-height: 44px; border: 1.5px solid #cbd5e1; border-radius: 12px;
    padding: 8px 14px; font-size: 15px; outline: none; background: #fff;
    font-family: inherit; transition: border-color .15s, box-shadow .15s;
  }
  textarea { min-height: 84px; resize: vertical; }
  input:focus, select:focus, textarea:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
  input[readonly] { background: #FFF9F3; color: #475569; }
  .deux-colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 8px; line-height: 1.5; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin: 12px 0; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  /* (NOUVEAU v0.2.50) avertissement ambre — incohérence nom / prénom détectée */
  .msg.warn { display: block; background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  /* (SUPPRIMÉ 0.2.55 — Task 134) les styles des fiches (.fiche-*) partent
     avec l'onglet DÉPLACÉ : la consultation des bulletins vit dans la page
     d'accueil du portail, qui a ses propres styles (.payslip, .a-open,
     .a-dl). */
  .titre-carte { font-size: 16.5px; font-weight: 800; letter-spacing: -0.2px; display: flex; align-items: center; gap: 9px; }
  .titre-carte svg { width: 19px; height: 19px; color: #10b981; flex: none; }
  .sous-titre { color: #475569; font-size: 13.5px; margin-top: 6px; line-height: 1.55; }
  /* Onglets */
  .onglets { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .onglet {
    height: 38px; padding: 0 13px; border-radius: 999px; border: 1.5px solid #cbd5e1;
    background: #ffffff; color: #334155; font-size: 12.5px; font-weight: 700;
  }
  .onglet:hover { background: #f1f5f9; }
  .onglet.actif { background: #10b981; border-color: #10b981; color: #ffffff; }
  .panneau { display: none; }
  .panneau.actif { display: block; }
  /* Statuts */
  .statut {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
    font-size: 12px; font-weight: 800; padding: 4px 11px; border: 1px solid;
  }
  .st-EN_ATTENTE { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
  .st-ACCEPTEE { background: #FFF3E8; color: #047857; border-color: #a7f3d0; }
  .st-REFUSEE { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
  /* (NOUVEAU Task 178) VALIDEE — validation automatique par réponse e-mail */
  .st-VALIDEE { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }
  .st-INFORMATION_REQUISE { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
  .st-DOC { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  /* (NOUVEAU Task 231) signature électronique — badges vert émeraude */
  .st-SIG { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
  /* (NOUVEAU Task 200 — v0.2.155) STATUT FINAL — badge plus visible : point
     de couleur + taille supérieure, lisible d'un seul coup d'œil dans la
     liste « Mes demandes ». */
  .statut.statut-final { font-size: 12.5px; padding: 5px 13px; box-shadow: 0 1px 5px rgba(15, 23, 42, .08); }
  .statut.statut-final .puce { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
  /* (SUPPRIMÉ v0.2.178 — demande utilisateur) les styles de la barre
     d'ÉTAPES DE VALIDATION Manager → RH (cadre vert de la capture) partent
     avec l'affichage : « 1. Manager : … → 2. Auto-RH : … » n'est plus
     rendu dans « Mes demandes » (workflow inchangé — voir rendreDemandes). */
  /* (NOUVEAU v0.2.177 — CONFIDENTIALITÉ DE LA DÉCISION) note affichée sous la
     barre d'étapes tant que le manager ET le service RH n'ont pas répondu
     (congé / autorisation de sortie) : le statut final, les décisions d'étape
     et les pièces jointes des réponses restent masqués jusqu'alors. */
  .demande .d-note {
    margin-top: 7px; padding: 7px 11px; border-radius: 10px;
    background: #f8fafc; border: 1px dashed #e2e8f0;
    color: #64748b; font-size: 12.3px; line-height: 1.5;
  }
  /* (NOUVEAU Task 200) ligne de fraîcheur — actualisation automatique */
  .maj-ligne { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 10px 0 2px; color: #64748b; font-size: 12.3px; }
  .maj-ligne .btn-lire { height: 28px; padding: 0 11px; font-size: 11.5px; border-radius: 8px; background: #eef2f7; color: #334155; margin: 0; }
  .maj-ligne .btn-lire:hover { background: #e2e8f0; }
  .badge-sig {
    display: inline-block; margin-top: 5px; padding: 2.5px 10px; border-radius: 999px;
    background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
    font-size: 11px; font-weight: 800; letter-spacing: .1px;
  }
  .demande .d-doc-sig {
    display: inline-block; padding: 2.5px 10px; border-radius: 999px;
    background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
    font-size: 11px; font-weight: 800;
  }
  /* (NOUVEAU Task 122) Documents transmis par le service RH */
  .demande .d-docs { margin-top: 10px; border: 1px solid #a7f3d0; background: #ecfdf5; border-radius: 10px; padding: 10px 12px; }
  .demande .d-docs-titre { font-size: 12.5px; font-weight: 800; color: #047857; margin-bottom: 7px; }
  .demande .d-doc { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 5px 0; border-top: 1px dashed #a7f3d0; }
  .demande .d-doc:first-of-type { border-top: none; }
  .demande .d-doc-nom { font-weight: 700; font-size: 12.8px; color: #0f172a; word-break: break-all; }
  .demande .d-doc-meta { color: #64748b; font-size: 11.8px; }
  .demande .btn-doc {
    height: 28px; padding: 0 11px; border-radius: 8px; font-size: 11.5px; font-weight: 700;
    display: inline-flex; align-items: center; text-decoration: none; cursor: pointer;
    background: #10b981; color: #ffffff; border: none;
  }
  .demande .btn-doc:hover { background: linear-gradient(135deg, #D9541B 0%, #DB931F 26%, #D95F52 46%, #C42F79 68%, #3D2474 100%); }
  .demande .btn-doc.doc-telecharger { background: #ffffff; color: #334155; border: 1.5px solid #cbd5e1; }
  .demande .btn-doc.doc-telecharger:hover { background: #f1f5f9; }
  /* Liste des demandes */
  .demande { border: 1px solid #e6eaf2; border-radius: 12px; padding: 13px 15px; margin-top: 10px; background: #fbfdff; }
  .demande .d-haut { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .demande .d-ref { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 800; font-size: 12.5px; color: #0f172a; }
  .demande .d-type { font-weight: 700; font-size: 13px; color: #334155; }
  .demande .d-date { color: #64748b; font-size: 12px; }
  .demande .d-details { margin-top: 9px; display: none; border-top: 1px dashed #e2e8f0; padding-top: 9px; }
  .demande.ouvert .d-details { display: block; }
  .demande .d-ligne { font-size: 12.8px; color: #475569; line-height: 1.6; }
  .demande .d-ligne b { color: #0f172a; }
  .demande .d-bas { margin-top: 8px; }
  .demande .btn-lire { height: 30px; padding: 0 12px; font-size: 11.5px; border-radius: 8px; background: #eef2f7; color: #334155; }
  .demande .btn-lire:hover { background: #e2e8f0; }
  .aucune { text-align: center; color: #64748b; font-size: 13.5px; padding: 22px 10px; line-height: 1.6; }
  @media (max-width: 480px) {
    .deux-colonnes { grid-template-columns: 1fr; }
    button { width: 100%; }
    .toolbar button { width: auto; }
    .onglet { flex: 1 1 auto; text-align: center; }
  }
</style>
</head>
<body>
<header>
  <span class="logo" aria-hidden="true">
    <img src="${LOGO_TRAILMIX_PNG}" alt="" style="width:auto;height:34px;display:block" />
  </span>
  <span class="brand">AutoRH<small>Demandes administratives</small></span>
</header>

<main>
  <div class="toolbar">
    <button type="button" id="btn-retour" class="btn-secondaire">&larr; Mes fiches de paie</button>
    <span class="tb-spacer"></span>
    <span class="cin-chip" id="cin-chip" title="Votre CIN (masqué)">•••••</span>
    <button type="button" id="btn-logout" class="btn-secondaire">Déconnexion</button>
  </div>

  <div class="msg" id="msg" role="alert" aria-live="polite"></div>

  <!-- E-mail de notification (suivi des demandes) -->
  <div class="card">
    <div class="titre-carte">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
      E-mail de notification
    </div>
    <p class="sous-titre">Vous recevrez à cette adresse un e-mail à chaque changement de statut de vos demandes (acceptée, refusée, information requise).</p>
    <div class="deux-colonnes">
      <div>
        <label for="mon-email">Votre adresse e-mail</label>
        <input type="email" id="mon-email" placeholder="prenom.nom@entreprise.tn" autocomplete="off">
      </div>
      <div style="align-self:end">
        <button type="button" id="btn-email">Enregistrer l&apos;adresse</button>
      </div>
    </div>
  </div>

  <!-- Onglets -->
  <div class="onglets" role="tablist">
    <!-- (SUPPRIMÉ 0.2.55 — Task 134) l'ancien onglet « Fiches de paie » est
         DÉPLACÉ dans la barre d'outils de la page d'accueil du portail, à
         côté de « Mes demandes » (zone demandée par l'utilisateur). Depuis
         cette page, le bouton « ← Mes fiches de paie » de la barre d'outils
         conduit à la consultation des bulletins. -->
    <button type="button" class="onglet actif" data-pan="pan-mes">Mes demandes</button>
    <button type="button" class="onglet" data-pan="pan-att-travail">Attestation de travail</button>
    <button type="button" class="onglet" data-pan="pan-att-salaire">Attestation de salaire</button>
    <button type="button" class="onglet" data-pan="pan-conge">Congé</button>
    <button type="button" class="onglet" data-pan="pan-sortie">Autorisation de sortie</button>
    <button type="button" class="onglet" data-pan="pan-parrainage">Parrainage</button>
  </div>

  <!-- (SUPPRIMÉ 0.2.55 — Task 134) la section « Fiches de paie » de cette
       page est DÉPLACÉE : la consultation des bulletins se fait désormais
       depuis la page d'accueil du portail (bouton « Fiches de paie » de la
       barre d'outils, à côté de « Mes demandes »). -->

  <!-- Mes demandes -->
  <section class="panneau actif" id="pan-mes">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Historique de mes demandes
      </div>
      <p class="sous-titre">Statut de chaque demande : En attente, Acceptée, Refusée ou Information requise — actualisé AUTOMATIQUEMENT dès que le manager ou le service RH traite votre demande. Cliquez sur « Détails » pour revoir les informations envoyées.</p>
      <!-- (NOUVEAU Task 200) fraîcheur du statut : contrôle automatique toutes
           les 30 secondes + rafraîchissement manuel à la demande -->
      <div class="maj-ligne">
        <span id="maj-info">Statut actualisé automatiquement toutes les 30 secondes.</span>
        <span class="tb-spacer"></span>
        <button type="button" id="btn-actualiser" class="btn-lire">Actualiser maintenant</button>
      </div>
      <div id="liste-demandes"><div class="aucune">Chargement…</div></div>
    </div>
  </section>

  <!-- Attestation de travail -->
  <section class="panneau" id="pan-att-travail">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>
        Attestation de travail
      </div>
      <p class="sous-titre">Aucune saisie : un seul clic sur « Envoyer ». Votre demande part automatiquement au service RH qui prépare votre attestation de travail. Votre nom et prénom sont récupérés automatiquement depuis le Portail Administration — aucun champ à remplir. Dès qu'elle sera prête, le document vous sera transmis par e-mail ET dans « Mes demandes ».</p>
      <form id="form-att-travail" style="margin-top:14px">
        <!-- (MODIFIÉ — demande utilisateur, points 2-6 v0.2.88) champ « Nom et
             prénom » SUPPRIMÉ : l'information est récupérée AUTOMATIQUEMENT côté
             serveur depuis les données de l'employé (Portail Administration,
             sinon fiches de paie du CIN). Formulaire = bouton Envoyer SEUL. -->
        <button type="submit">Envoyer</button>
      </form>
    </div>
  </section>

  <!-- Attestation de salaire -->
  <section class="panneau" id="pan-att-salaire">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>
        Attestation de salaire
      </div>
      <p class="sous-titre">Aucune saisie : un seul clic sur « Envoyer ». Votre demande part automatiquement au service RH qui prépare votre attestation de salaire. Votre nom et prénom sont récupérés automatiquement depuis le Portail Administration — aucun champ à remplir. Dès qu'elle sera prête, le document vous sera transmis par e-mail ET dans « Mes demandes ».</p>
      <form id="form-att-salaire" style="margin-top:14px">
        <!-- (MODIFIÉ — demande utilisateur, points 2-6 v0.2.88) champ « Nom et
             prénom » SUPPRIMÉ : récupération AUTOMATIQUE côté serveur.
             Formulaire = bouton Envoyer SEUL. -->
        <button type="submit">Envoyer</button>
      </form>
    </div>
  </section>

  <!-- Demande de congé -->
  <section class="panneau" id="pan-conge">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        Demande de congé
      </div>
      <p class="sous-titre">Après validation, la demande est automatiquement envoyée — en arrière-plan, sans action supplémentaire de votre part — à votre manager responsable pour validation, avec copie informative au service RH et à votre adresse e-mail de notification. Aucun responsable à saisir : votre manager est récupéré automatiquement depuis le Portail Administration (affectation « Manager responsable » de la fenêtre « Mot de passe initial — CIN »), ainsi que votre nom, prénom et adresse e-mail. À défaut de manager affecté, la demande est traitée par le service RH.</p>
      <form id="form-conge" novalidate>
        <label>Date de la demande (automatique)</label>
        <input type="text" id="conge-date-demande" readonly value="">
        <!-- (MODIFIÉ — demande utilisateur, point 4 v0.2.88) champ « Votre
             CIN » SUPPRIMÉ : la CIN est récupérée AUTOMATIQUEMENT depuis le
             compte de l'employé connecté (session du portail) côté serveur. -->
        <label>Type de congé *</label>
        <select id="conge-type">
          <option value="">— Choisir —</option>
          <option>Maladie</option>
          <option>Annuel</option>
          <option>Maternité</option>
          <option>Paternité</option>
          <option>Exceptionnel</option>
          <option>Autre</option>
        </select>
        <div class="deux-colonnes">
          <div>
            <label>Date de début *</label>
            <input type="date" id="conge-debut" required>
          </div>
          <div>
            <label>Date de fin *</label>
            <input type="date" id="conge-fin" required>
          </div>
        </div>
        <!-- (SUPPRIMÉ — v0.2.132, demande utilisateur) le champ « Adresse e-mail
             du N+1 / responsable hiérarchique » disparaît du formulaire : le
             MANAGER RESPONSABLE affecté à l'employé (fenêtre « Mot de passe
             initial — CIN » du Portail Administration) est récupéré
             AUTOMATIQUEMENT côté serveur — tout emailN1 envoyé par un ancien
             client est ignoré. -->
        <label>Commentaire</label>
        <textarea id="conge-commentaire" placeholder="Précisions utiles (optionnel)"></textarea>
        <button type="submit" style="margin-top:14px">Envoyer la demande de congé</button>
      </form>
    </div>
  </section>

  <!-- Autorisation de sortie -->
  <section class="panneau" id="pan-sortie">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
        Autorisation de sortie
      </div>
      <p class="sous-titre">Après validation, la demande est automatiquement envoyée — en arrière-plan, sans action supplémentaire de votre part — à votre manager responsable pour validation, avec copie informative au service RH et à votre adresse e-mail de notification. Aucun responsable à saisir : votre manager est récupéré automatiquement depuis le Portail Administration (affectation « Manager responsable » de la fenêtre « Mot de passe initial — CIN »), ainsi que votre nom, prénom et adresse e-mail. À défaut de manager affecté, la demande est traitée par le service RH.</p>
      <form id="form-sortie" novalidate>
        <label>Date *</label>
        <input type="date" id="sortie-date" required>
        <!-- (MODIFIÉ — demande utilisateur, point 6 v0.2.88) champ « Nom et
             prénom » SUPPRIMÉ : récupération AUTOMATIQUE côté serveur
             (session du portail + Portail Administration). -->
        <!-- (SUPPRIMÉ — v0.2.132, demande utilisateur) le champ « Responsable
             N+1 » disparaît du formulaire (il avait remplacé « Département »,
             v0.2.88) : le MANAGER RESPONSABLE affecté à l'employé (fenêtre
             « Mot de passe initial — CIN » du Portail Administration) est
             récupéré AUTOMATIQUEMENT côté serveur — tout responsableN1 envoyé
             par un ancien client est ignoré. -->
        <label>Motif *</label>
        <input type="text" id="sortie-motif" placeholder="Motif de la sortie">
        <div class="deux-colonnes">
          <div>
            <label>Nombre d&apos;heures *</label>
            <input type="number" id="sortie-heures" min="0.5" step="0.5" placeholder="Ex. 2">
          </div>
          <div>
            <label>Compensation des heures *</label>
            <select id="sortie-compensation">
              <option value="OUI">Oui — heures compensées</option>
              <option value="NON">Non — heures non compensées</option>
            </select>
          </div>
        </div>
        <div class="deux-colonnes">
          <div>
            <label>Heure de sortie *</label>
            <input type="time" id="sortie-h-debut" required>
          </div>
          <div>
            <label>Heure de retour *</label>
            <input type="time" id="sortie-h-retour" required>
          </div>
        </div>
        <button type="submit" style="margin-top:14px">Envoyer l&apos;autorisation de sortie</button>
      </form>
    </div>
  </section>

  <!-- Demande de parrainage -->
  <section class="panneau" id="pan-parrainage">
    <div class="card">
      <div class="titre-carte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
        Demande de parrainage
      </div>
      <p class="sous-titre">Après validation, la demande est automatiquement envoyée à l'adresse e-mail DÉDIÉE aux demandes de parrainage (configurée dans le Portail Administration) et une CONFIRMATION vous est adressée sur votre adresse e-mail de notification (section « Accès portail par mot de passe »). Votre nom, prénom et adresse e-mail (ceux du parrain) sont récupérés automatiquement depuis le Portail Administration.</p>
      <form id="form-parrainage" novalidate>
        <!-- (SUPPRIMÉ — v0.2.92, demande utilisateur) le champ « Adresse e-mail
             du N+1 / responsable hiérarchique » disparaît du formulaire : le
             routage vers l'adresse DÉDIÉE du parrainage est AUTOMATIQUE (ainsi
             qu'une confirmation à l'employé demandeur). Aucune saisie e-mail. -->
        <div class="deux-colonnes">
          <div>
            <label>Date du parrainage *</label>
            <input type="date" id="parr-date" required>
          </div>
          <div>
            <label>Opération / Hiérarchie *</label>
            <input type="text" id="parr-operation" required>
          </div>
        </div>
        <div class="deux-colonnes">
          <div>
            <label>Nom et prénom du filleul *</label>
            <input type="text" id="parr-filleul" required>
          </div>
          <div>
            <label>Téléphone du filleul *</label>
            <input type="tel" id="parr-tel" placeholder="+216 …" required>
          </div>
        </div>
        <button type="submit" style="margin-top:14px">Envoyer la demande de parrainage</button>
      </form>
    </div>
  </section>
</main>

<footer style="border-top:1px solid #e2e8f0;background:#ffffff;padding:14px 20px;text-align:center;color:#64748b;font-size:12.5px;line-height:1.6">
  Portail Employés — demandes administratives<br>
  En cas d&apos;anomalie, contactez votre service RH.
</footer>

<script>
(function () {
  "use strict";
  var XP = new URLSearchParams(location.search).get("XTransformPort");
  function apiUrl(p) {
    if (!XP) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=" + encodeURIComponent(XP);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function maskCin(s) {
    var v = String(s == null ? "" : s);
    return v.length <= 3 ? v : "•••" + v.slice(-3);
  }
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
        " à " + new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return iso; }
  }
  var msg = document.getElementById("msg");
  function show(kind, text) { msg.className = "msg " + kind; msg.textContent = text; }
  function hideMsg() { msg.className = "msg"; msg.textContent = ""; }

  // ---------- Onglets ----------
  var onglets = document.querySelectorAll(".onglet");
  for (var i = 0; i < onglets.length; i++) {
    onglets[i].addEventListener("click", function () {
      for (var j = 0; j < onglets.length; j++) {
        onglets[j].classList.remove("actif");
        document.getElementById(onglets[j].getAttribute("data-pan")).classList.remove("actif");
      }
      this.classList.add("actif");
      document.getElementById(this.getAttribute("data-pan")).classList.add("actif");
      hideMsg();
      // (NOUVEAU Task 122) au retour sur « Mes demandes », la liste est
      // rechargée : un document transmis par le service RH entre-temps
      // (réception IMAP automatique) apparaît immédiatement avec ses
      // boutons Visualiser / Télécharger.
      if (this.getAttribute("data-pan") === "pan-mes") {
        chargerMesDemandes();
      }
      // (SUPPRIMÉ 0.2.55 — Task 134) le cas « pan-fiches » disparaît avec
      // l'onglet : la consultation des fiches de paie est DÉPLACÉE dans la
      // barre d'outils de la page d'accueil du portail.
    });
  }

  // ---------- Navigation / déconnexion ----------
  document.getElementById("btn-retour").addEventListener("click", function () {
    location.href = apiUrl("/");
  });
  document.getElementById("btn-logout").addEventListener("click", function () {
    fetch(apiUrl("/api/logout"), { method: "POST", cache: "no-store" })
      .catch(function () {})
      .then(function () { location.replace(apiUrl("/login")); });
  });

  // ---------- E-mail de notification ----------
  var monEmail = document.getElementById("mon-email");
  function chargerMonEmail() {
    fetch(apiUrl("/api/mon-email"), { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) { location.replace(apiUrl("/login")); return null; }
        return res.json();
      })
      .then(function (d) {
        if (!d) return;
        document.getElementById("cin-chip").textContent = maskCin(d.cin || "");
        if (d.email) monEmail.value = d.email;
        // Pré-remplissage de la date du formulaire de congé
        document.getElementById("conge-date-demande").value =
          new Date().toLocaleDateString("fr-FR");
        // (MODIFIÉ — demande utilisateur, points 2-6 v0.2.88) attestations,
        // congé, autorisation de sortie ET parrainage SANS AUCUN champ
        // d'identité affiché : le nom, le prénom et la CIN sont récupérés
        // AUTOMATIQUEMENT CÔTÉ SERVEUR (session du portail + Portail
        // Administration « Accès portail par mot de passe » + fiches de
        // paie du CIN). Les formulaires ne présentent plus que leurs
        // champs métier et le bouton « Envoyer ».
      })
      .catch(function () {});
  }
  document.getElementById("btn-email").addEventListener("click", function () {
    hideMsg();
    var btn = this;
    btn.disabled = true;
    fetch(apiUrl("/api/mon-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: monEmail.value }),
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) show("info", r.d.message || "Adresse enregistrée.");
        else show("error", r.d.error || "Enregistrement impossible.");
      })
      .catch(function () { show("error", "Erreur réseau. Réessayez."); })
      .then(function () { btn.disabled = false; });
  });

  // ---------- Mes demandes ----------
  var liste = document.getElementById("liste-demandes");

  // ---------- (SUPPRIMÉ 0.2.55 — Task 134) Fiches de paie (onglet dédié) ----------
  // Le bloc chargerMesFiches() + rendu des fiches est DÉPLACÉ : la
  // consultation des bulletins vit désormais UNIQUEMENT dans la page
  // d'accueil du portail (bouton « Fiches de paie » de la barre d'outils,
  // à côté de « Mes demandes »), qui recharge déjà sa liste via loadMine().
  function rendreDemandes(items) {
    if (!items.length) {
      liste.innerHTML = '<div class="aucune">Aucune demande pour le moment.<br>' +
        "Utilisez les onglets ci-dessus pour créer votre première demande.</div>";
      return;
    }
    var html = "";
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var lignes = "";
      var donnees = d.donnees || {};
      var cles = Object.keys(donnees);
      // (MODIFIÉ — v0.2.88) libellés lisibles : « responsableN1 » s'affiche
      // « Responsable N+1 » (le champ « Département » est remplacé) ; les
      // autres clés gardent leur affichage historique.
      var LIBELLES_CHAMPS = { responsableN1: "Responsable N+1", departement: "Département", managerNom: "Manager responsable" };
      for (var k = 0; k < cles.length; k++) {
        var v = donnees[cles[k]];
        if (!v) continue;
        lignes += '<div class="d-ligne"><b>' + esc(LIBELLES_CHAMPS[cles[k]] || cles[k]) + "</b> : " + esc(v) + "</div>";
      }
      if (d.commentaire) {
        lignes += '<div class="d-ligne" style="margin-top:6px;color:#b45309"><b>Commentaire du traitement :</b> ' + esc(d.commentaire) + "</div>";
      }
      // (MODIFIÉ Task 196 / v0.2.152) pièces jointes des RÉPONSES e-mail —
      // le manager ET le service RH peuvent joindre des documents à leur
      // réponse : l'employé les consulte et les télécharge depuis SON portail,
      // quel que soit le statut de la demande (Acceptée, Refusée ou En
      // attente) — l'expéditeur (recuDe) est affiché quand il s'agit d'une
      // réponse e-mail réelle (les documents générés gardent leur badge).
      // (RÉTABLI v0.2.184 — demande utilisateur) les pièces jointes restent
      // VISIBLES et CONSULTABLES À TOUTES LES ÉTAPES : l'API employé ne les
      // masque plus pendant la validation à deux étapes (congé / autorisation)
      // — seule la DÉCISION reste confidentielle jusqu'à la fin de la matrice
      // (règle v0.2.177). L'employé reçoit EN PLUS chaque document par e-mail
      // (notification automatique neutre) dès la réponse qui le porte.
      var docsHtml = "";
      var docs = d.documents || [];
      if (docs.length) {
        docsHtml += '<div class="d-docs"><div class="d-docs-titre">📄 Pièce(s) jointe(s) transmise(s) avec la réponse (RH ou manager) :</div>';
        for (var j = 0; j < docs.length; j++) {
          var doc = docs[j];
          var envoyePar = doc.recuDe && String(doc.recuDe).indexOf("Génération automatique") !== 0 ? " — envoyé par " + esc(doc.recuDe) : "";
          docsHtml += '<div class="d-doc">' +
            '<span class="d-doc-nom">' + esc(doc.nomFichier) + "</span>" +
            '<span class="d-doc-meta">' + esc(doc.tailleLisible || String(doc.taille || "") + " octets") +
            (doc.recuLe ? " — reçu le " + fmtDate(doc.recuLe) : "") + envoyePar + "</span>" +
            // NOUVEAU (Task 231) : document signé électroniquement (registre)
            (doc.signeeElectronique ? '<span class="d-doc-sig" title="Ce document porte une signature électronique valide (PAdES) et son intégrité est vérifiable">🔏 Signée électroniquement</span>' : "") +
            '<a class="btn-doc" target="_blank" rel="noopener" href="' + apiUrl("/api/mes-demandes/documents/" + doc.id) + '">Visualiser</a>' +
            '<a class="btn-doc doc-telecharger" href="' + apiUrl("/api/mes-demandes/documents/" + doc.id) + '?telecharger=1">Télécharger</a>' +
            "</div>";
        }
        docsHtml += "</div>";
      }
      // (NOUVEAU Task 200 — v0.2.155) ÉTAPES DE VALIDATION Manager → RH :
      // pour les demandes à deux étapes (congé, autorisation de sortie), la
      // décision de CHAQUE acteur était affichée EN PERMANENCE (sans
      // dépliage) — « 1. Manager : … → 2. Auto-RH : … ».
      // (SUPPRIMÉ v0.2.178 — demande utilisateur) CETTE BARRE D'ÉTAPES EST
      // MASQUÉE (capture utilisateur : bloc encadré en vert dans « Mes
      // demandes »). L'employé voit le STATUT FINAL (badge, révélé après les
      // réponses du manager ET du service RH — règle v0.2.177), les pièces
      // jointes et le détail ; le FIL de validation interne reste consultable
      // côté administration. AUCUNE conséquence sur le workflow : la matrice
      // Manager × RH, les transmissions, les PDF et les e-mails sont
      // inchangés (modification d'AFFICHAGE uniquement). Le champ deuxEtapes
      // reste exposé par l'API pour les autres usages éventuels.
      var etapesHtml = "";
      // (NOUVEAU v0.2.177 — CONFIDENTIALITÉ DE LA DÉCISION) tant que le
      // manager ET le service RH n'ont pas répondu (congé / autorisation de
      // sortie), le serveur masque TOUTE information de décision (statut
      // final, décisions d'étape, pièces jointes reçues, commentaire) :
      // l'employé voit uniquement « En attente ». Une note visible SANS
      // dépliage l'informe de quand la décision apparaîtra — et que les
      // pièces jointes transmises avec les réponses seront affichées EN
      // MÊME TEMPS que le statut final.
      var noteHtml = "";
      if (d.decisionMasquee) {
        noteHtml =
          '<div class="d-note">Décision finale communiquée après les réponses du manager et du service RH — ' +
          "le statut final et les pièces jointes transmises avec les réponses seront affichés à ce moment-là.</div>";
      }
      html +=
        '<div class="demande" id="dem-' + esc(d.id) + '">' +
        '<div class="d-haut">' +
        '<span class="d-ref">' + esc(d.reference) + "</span>" +
        '<span class="d-type">' + esc(d.typeLibelle) + "</span>" +
        // (MODIFIÉ Task 200) STATUT FINAL mis en évidence : badge agrandi avec
        // point de couleur — En attente / Acceptée / Refusée / Information requise
        // (MODIFIÉ v0.2.185 — DEMANDE UTILISATEUR) RÈGLE D'AFFICHAGE DU REFUS :
        // lorsque la demande est refusée, le badge n'affiche QUE la mention
        // « Refusée » (les libellés raffinés « Refusée par le Manager » /
        // « Refusée par les RH » ne sont plus exposés à l'employé — le
        // serveur masque aussi l'acteur de traitement et le commentaire de
        // refus ; les e-mails et le portail d'administration sont inchangés).
        '<span class="statut statut-final st-' + esc(d.statut) + '"><span class="puce"></span>' + esc(d.statutLibelle) + "</span>" +
        (docs.length ? '<span class="statut st-DOC">📄 Document disponible</span>' : "") +
        // NOUVEAU (Task 231) : au moins un document signé électroniquement
        (docs.some(function (dd) { return dd.signeeElectronique; })
          ? '<span class="statut st-SIG">🔏 Signée électroniquement</span>'
          : "") +
        '<span class="tb-spacer"></span>' +
        '<span class="d-date">créée le ' + fmtDate(d.createdAt) + "</span>" +
        "</div>" +
        etapesHtml +
        noteHtml +
        '<div class="d-details">' +
        // (NOUVEAU Task 200) première ligne du détail : le STATUT FINAL en
        // toutes lettres, avec la date et l'acteur de la décision — remplace
        // l'ancienne ligne « Traitée le » seule.
        // (MODIFIÉ v0.2.177) décision masquée → la mention « en cours de
        // traitement » devient « communiquée après les réponses du manager
        // et du service RH ».
        // (MODIFIÉ v0.2.185 — DEMANDE UTILISATEUR) demande REFUSÉE → la ligne
        // affiche « Statut final : Refusée — décision rendue le … » SANS
        // l'acteur (« par … » supprimé pour les refus : traitePar vaut null
        // côté serveur — aucune mention du département ni du manager).
        '<div class="d-ligne" style="margin-bottom:5px"><b>Statut final&nbsp;:</b> ' + esc(d.statutLibelle) +
        (d.traiteLe
          ? " — décision rendue le " + fmtDate(d.traiteLe) + (d.traitePar ? " par " + esc(d.traitePar) : "")
          : (d.decisionMasquee
            ? " — communiquée après les réponses du manager et du service RH"
            : " — en cours de traitement")) +
        "</div>" +
        lignes +
        "</div>" +
        docsHtml +
        '<div class="d-bas"><button type="button" class="btn-lire" data-dem="' + esc(d.id) + '">Détails</button></div>' +
        "</div>";
    }
    liste.innerHTML = html;
    var boutons = liste.querySelectorAll(".btn-lire");
    for (var b = 0; b < boutons.length; b++) {
      boutons[b].addEventListener("click", function () {
        var carte = document.getElementById("dem-" + this.getAttribute("data-dem"));
        if (carte) carte.classList.toggle("ouvert");
      });
    }
  }
  function chargerMesDemandes(silencieux) {
    if (!silencieux) liste.innerHTML = '<div class="aucune">Chargement…</div>';
    fetch(apiUrl("/api/mes-demandes"), { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) {
          // (MODIFIÉ Task 200) session expirée PENDANT un contrôle automatique :
          // on arrête le minuteur avant de renvoyer vers la connexion.
          if (minuteurStatut) clearInterval(minuteurStatut);
          location.replace(apiUrl("/login"));
          return null;
        }
        return res.json();
      })
      .then(function (d) {
        if (!d) return;
        var items = d.items || [];
        // (NOUVEAU Task 200) détection des CHANGEMENTS depuis le contrôle
        // précédent : l'employé est prévenu en page quand le manager ou le
        // service RH a fait évoluer une demande — sans recharger la page.
        var nouvelleEmpreinte = empreinteDemandes(items);
        var change = !premierChargement && nouvelleEmpreinte !== empreinteStatuts;
        rendreDemandes(items);
        empreinteStatuts = nouvelleEmpreinte;
        var majInfo = document.getElementById("maj-info");
        if (majInfo) {
          majInfo.textContent =
            "Statut actualisé automatiquement toutes les 30 secondes — dernier contrôle à " +
            new Date().toLocaleTimeString("fr-FR") + ".";
        }
        if (change) {
          var modifiees = [];
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var avant = statutsConnus[it.id];
            if (avant && avant !== it.statut) {
              modifiees.push(it.reference + " (" + it.typeLibelle + ") est désormais : " + it.statutLibelle);
            }
            statutsConnus[it.id] = it.statut;
          }
          if (modifiees.length) {
            show("info", "Mise à jour automatique du statut — " + modifiees.join(" ; ") + ".");
          }
        } else {
          for (var k = 0; k < items.length; k++) statutsConnus[items[k].id] = items[k].statut;
        }
        premierChargement = false;
      })
      .catch(function () {
        // (MODIFIÉ Task 200) en contrôle automatique (silencieux), un échec
        // réseau passager n'écrase PAS la liste affichée — le contrôle
        // suivant retentera ; le message d'erreur ne concerne que le
        // chargement initial / manuel.
        if (!silencieux) {
          liste.innerHTML = '<div class="aucune">Impossible de charger vos demandes. Réessayez avec « Mes fiches de paie » puis revenez.</div>';
        }
      });
  }

  // ---------- (NOUVEAU Task 200 — v0.2.155) MISE À JOUR AUTOMATIQUE DU
  //  STATUT FINAL : le statut affiché (« En attente », « Acceptée »,
  //  « Refusée »…) se rafraîchit TOUT SEUL dès que le manager ou le service
  //  RH traite la demande — l'employé n'a plus rien à faire.
  //  - contrôle toutes les 30 secondes, UNIQUEMENT quand la page est visible
  //    (économie de requêtes quand l'onglet est en arrière-plan) ;
  //  - contrôle immédiat au retour sur l'onglet (visibilitychange) ;
  //  - bouton « Actualiser maintenant » pour un rafraîchissement manuel ;
  //  - empreinte (statut + décisions manager/RH + date de traitement +
  //    documents) : le rendu n'est comparé qu'à ces données, jamais deviné.
  var FRAICHEUR_MS = 30000;
  var minuteurStatut = null;
  var empreinteStatuts = "";
  var statutsConnus = {};
  var premierChargement = true;

  function empreinteDemandes(items) {
    return (items || []).map(function (d) {
      return [
        d.id,
        d.statut,
        d.decisionManager || "",
        d.decisionRh || "",
        d.traiteLe || "",
        (d.documents || []).length,
      ].join(":");
    }).join("|");
  }

  function demarrerRafraichissementStatut() {
    if (minuteurStatut) clearInterval(minuteurStatut);
    minuteurStatut = setInterval(function () {
      if (document.visibilityState === "visible") chargerMesDemandes(true);
    }, FRAICHEUR_MS);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") chargerMesDemandes(true);
  });
  var btnActualiser = document.getElementById("btn-actualiser");
  if (btnActualiser) {
    btnActualiser.addEventListener("click", function () {
      chargerMesDemandes(false);
    });
  }

  // ---------- Envoi d'une demande (boutons + formulaires) ----------
  function posterDemande(payload, bouton, succesHtml) {
    hideMsg();
    bouton.disabled = true;
    fetch(apiUrl("/api/demandes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) {
          var extra = "";
          if (r.d.email && r.d.email.envoye) {
            extra = "Un e-mail a été envoyé à " + r.d.destinataire + ".";
          } else if (r.d.email && r.d.email.arrierePlan) {
            // (NOUVEAU — demande utilisateur, point 7 v0.2.88) les e-mails
            // partent en arrière-plan : la demande est confirmée SANS attendre
            // le SMTP.
            extra = "Notifications par e-mail" +
              ((r.d.destinataires && r.d.destinataires.length)
                ? " (" + r.d.destinataires.join(", ") + ")"
                : "") +
              " en cours d'envoi en arrière-plan.";
          } else if (r.d.email && r.d.email.erreur) {
            extra = "Demande enregistrée, mais l'e-mail n'a pas pu être envoyé (" + r.d.email.erreur + "). Le service concerné verra votre demande dès son traitement.";
          } else if (r.d.destinataire) {
            extra = "Destinataire : " + r.d.destinataire + ".";
          }
          // (NOUVEAU v0.2.50) signalement IMMÉDIAT à l'employé d'une
          // incohérence nom / prénom détectée automatiquement (fiches de
          // paie = référence) — la demande reste créée (jamais bloquant).
          if (r.d.anomalie) {
            show("warn", "Demande créée — référence " + r.d.reference + ". " + extra +
              " ⚠ Incohérence détectée dans votre nom / prénom : " + r.d.anomalie +
              " Vous pouvez vérifier votre saisie dans vos fiches de paie (bouton « Fiches de paie » de la page d'accueil du portail).");
          } else {
            show("info", "Demande créée — référence " + r.d.reference + ". " + extra);
          }
          if (bouton.form) bouton.form.reset();
          chargerMesDemandes();
          chargerMonEmail();
        } else {
          show("error", r.d.error || "Création impossible. Réessayez.");
        }
      })
      .catch(function () { show("error", "Erreur réseau. Réessayez."); })
      .then(function () { bouton.disabled = false; });
  }

  // (MODIFIÉ — demande utilisateur) les attestations n'exigent PLUS AUCUNE
  // SAISIE : un seul bouton « Envoyer ». Le nom et le prénom sont récupérés
  // automatiquement côté serveur depuis le Portail Administration (nomPrenom
  // de l'accès portail, sinon fiches de paie) — tout champ envoyé est ignoré.
  document.getElementById("form-att-travail").addEventListener("submit", function (e) {
    e.preventDefault();
    posterDemande({ type: "ATTESTATION_TRAVAIL" }, this.querySelector('button[type="submit"]'));
  });
  document.getElementById("form-att-salaire").addEventListener("submit", function (e) {
    e.preventDefault();
    posterDemande({ type: "ATTESTATION_SALAIRE" }, this.querySelector('button[type="submit"]'));
  });
  document.getElementById("form-conge").addEventListener("submit", function (e) {
    e.preventDefault();
    // (MODIFIÉ — v0.2.132) PLUS AUCUN champ e-mail N+1 : le manager responsable
    // est résolu AUTOMATIQUEMENT côté serveur (affectation « Mot de passe
    // initial — CIN ») ; la fiche n'envoie que les informations réellement à
    // saisir.
    posterDemande({
      type: "CONGE",
      typeConge: document.getElementById("conge-type").value,
      dateDebut: document.getElementById("conge-debut").value,
      dateFin: document.getElementById("conge-fin").value,
      commentaire: document.getElementById("conge-commentaire").value,
    }, this.querySelector('button[type="submit"]'));
  });
  document.getElementById("form-sortie").addEventListener("submit", function (e) {
    e.preventDefault();
    // (MODIFIÉ — Task 175) PLUS AUCUN champ nom / prénom / e-mail : la
    // fiche de sortie n'envoie que les informations réellement à saisir —
    // l'identité de l'employé est résolue côté serveur.
    // (MODIFIÉ — v0.2.132) PLUS AUCUN champ « Responsable N+1 » : le manager
    // responsable est résolu AUTOMATIQUEMENT côté serveur (affectation
    // « Mot de passe initial — CIN ») ; la demande lui part automatiquement
    // ET au service RH (en arrière-plan).
    posterDemande({
      type: "AUTORISATION_SORTIE",
      date: document.getElementById("sortie-date").value,
      motif: document.getElementById("sortie-motif").value,
      nombreHeures: document.getElementById("sortie-heures").value,
      heureSortie: document.getElementById("sortie-h-debut").value,
      heureRetour: document.getElementById("sortie-h-retour").value,
      compensation: document.getElementById("sortie-compensation").value,
    }, this.querySelector('button[type="submit"]'));
  });
  document.getElementById("form-parrainage").addEventListener("submit", function (e) {
    e.preventDefault();
    // (MODIFIÉ — Task 175 puis v0.2.92) PLUS AUCUN champ nom / e-mail du
    // parrain NI e-mail du N+1 : la demande n'envoie que les informations
    // réellement à saisir — l'identité du parrain (employé connecté) est
    // résolue côté serveur et le routage vers l'adresse DÉDIÉE du parrainage
    // est automatique (confirmation envoyée à l'employé demandeur).
    posterDemande({
      type: "PARRAINAGE",
      dateParrainage: document.getElementById("parr-date").value,
      operation: document.getElementById("parr-operation").value,
      nomFilleul: document.getElementById("parr-filleul").value,
      telFilleul: document.getElementById("parr-tel").value,
    }, this.querySelector('button[type="submit"]'));
  });

  // ---------- Chargement initial ----------
  chargerMonEmail();
  chargerMesDemandes();
  // (NOUVEAU Task 200) lancement du rafraîchissement automatique du statut
  demarrerRafraichissementStatut();
})();
</script>
</body>
</html>
`;

// ============================================================
//  SERVEUR HTTP
// ============================================================

// ---------- (NOUVEAU Task 18) Recherche des fiches d'un CIN (logique partagée) ----------
// Même logique que l'ancien /api/search : pré-filtre rapide sur normalizedContent
// puis filtre EXACT (le CIN doit être un numéro COMPLET du contenu).
// Utilisée par /api/search (verrouillée sur la session) et /api/my-fiches.
async function searchPayslipsByCin(q) {
  // (MODIFIÉ Task 32 : base chiffrée) l'ancien pré-filtre SQL
  // `where: { normalizedContent: { contains: q } }` n'est plus possible (la
  // colonne est chiffrée à IV aléatoire). Les lignes sont donc déchiffrées
  // (champs sensibles — voir scripts/lib-crypto-bd.js) puis le MÊME
  // pré-filtre est appliqué en JavaScript : comportement identique.
  // (MODIFIÉ 0.2.60) plus de `take: 5000` : TOUTES les lignes sont lues —
  // un plafond ici aurait continué à perdre des fiches au-delà du volume
  // plafonné (retour utilisateur : « sans limitation ni perte de données »).
  const lignes = await prisma.payslip.findMany({
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      employeeName: true,
      period: true,
      netSalary: true,
      fileSize: true,
      uploadedAt: true,
      cin: true,
      content: true,
      normalizedContent: true,
    },
  });
  const candidates = lignes
    .map((r) => cryptoBd.dechiffrerObjet("Payslip", r))
    .filter((r) => String(r.normalizedContent || "").includes(q));
  return candidates
    .filter((r) => {
      // (CORRECTIF « l'employé ne voit pas sa fiche ») : comparaison du CHAMP
      // cin sur la forme NORMALISÉE (majuscules, sans espaces/tirets/points/
      // slashs) — un CIN stocké « SPEC-0001 » ou « 12 345 678 » correspond
      // désormais à la saisie normalisée « SPEC0001 » / « 12345678 ». Le filtre
      // par contenu reste identique (aucun comportement antérieur retiré).
      if (r.cin && normalizeText(r.cin) === q) return true;
      return isExactCinInContent(r.content, q);
    })
    .map((r) => ({
      id: r.id,
      fileName: r.fileName,
      employeeName: r.employeeName,
      period: r.period,
      netSalary: r.netSalary,
      fileSize: r.fileSize,
      uploadedAt: r.uploadedAt.toISOString(),
    }));
}

// ---------- (NOUVEAU 0.2.60) Découpage en pages des résultats ----------
// Même contrat de métadonnées que l'administration (Task 99) : total, page,
// perPage, totalPages, hasMore. Paramètres acceptés dans la query :
//   ?page=N      numéro de page (défaut 1, bornée à [1 ; totalPages]) ;
//   ?perPage=M   taille de page (défaut 100, plafond 500).
// AUCUNE fiche n'est perdue : totalPages = ceil(total / perPage) et la
// dernière page contient le reste ; l'ordre (uploadedAt desc) est stable,
// donc la concaténation des pages 1..totalPages restitue EXACTEMENT la
// liste complète, sans doublon ni omission.
function paginerResultats(rows, url) {
  const total = rows.length;
  // (NOUVEAU 0.2.61) AFFICHAGE ILLIMITÉ : ?perPage=all (ou « tout ») renvoie
  // TOUTES les fiches du CIN en une seule réponse — aucune découpe, aucune
  // limite. La sécurité reste identique : la liste est toujours verrouillée
  // sur le CIN de la session (Task 18) ; seul le DÉCOUPAGE change.
  const brutPer = (url.searchParams.get("perPage") || "").trim().toLowerCase();
  if (brutPer === "all" || brutPer === "tout") {
    return {
      meta: {
        total,
        page: 1,
        perPage: total > 0 ? total : PAR_PAGE_DEFAUT,
        totalPages: 1,
        hasMore: false,
        tout: true,
      },
      items: rows,
    };
  }
  let parPage = parseInt(brutPer, 10);
  if (!Number.isFinite(parPage) || parPage < 1) parPage = PAR_PAGE_DEFAUT;
  if (parPage > PAR_PAGE_MAX) parPage = PAR_PAGE_MAX;
  const totalPages = Math.max(1, Math.ceil(total / parPage));
  let page = parseInt(url.searchParams.get("page") || "", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  const debut = (page - 1) * parPage;
  return {
    meta: {
      total,
      page,
      perPage: parPage,
      totalPages,
      hasMore: page < totalPages,
    },
    items: rows.slice(debut, debut + parPage),
  };
}

// ============================================================
//  NOUVEAU (Task 116) — DEMANDES ADMINISTRATIVES : OUTILS PORTE
// ============================================================
//  Jumelle JS de src/lib/demandes.ts + src/lib/mailer.ts (⚠ libellés et
//  formats ALIGNÉS). Le portail (4001) :
//   - crée les demandes des employés (5 types) avec référence lisible
//     DEM-AAAA-NNNNN ;
//   - envoie l'E-MAIL DE CRÉATION au destinataire concerné (service RH pour
//     les attestations — v0.2.196 : la boîte RH redevient destinataire
//     PRINCIPAL et l'adresse DÉDIÉE du type reçoit une COPIE systématique,
//     ancienne sémantique Task 197 « dédiée prioritaire » remplacée —,
//     MANAGER RESPONSABLE de l'employé pour le congé et
//     l'autorisation de sortie — v0.2.132 : résolu AUTOMATIQUEMENT depuis
//     l'affectation « Mot de passe initial — CIN », plus AUCUN N+1 saisi —,
//     ADRESSE DÉDIÉE pour le parrainage — v0.2.92 — via la configuration SMTP
//     de l'administration (MailConfig, identifiants déchiffrés localement,
//     JAMAIS journalisés) ; COPIES AUTOMATIQUES à l'adresse DÉDIÉE de chaque
//     type quand elle est configurée (congeEmail / autorisationEmail — v0.2.94,
//     attestations — v0.2.196, parrainageCopieEmail — v0.2.197 : le
//     responsable principal du parrainage reçoit une COPIE ; copie identique
//     au principal = IGNORÉE + JOURNALISÉE), au service RH (repli de la copie
//     congé / autorisation quand l'adresse dédiée est vide) et à l'employé
//     demandeur (tous types — confirmation v0.2.92/197) ;
//   - journalise chaque tentative dans logs/journal-emails.log (même fichier
//     que l'administration — actions "demande-creation").
//  L'envoi n'est JAMAIS bloquant : la demande est créée même si SMTP est
//  absent ou en échec (le RH traite, le journal garde la trace).

// (Task 116) transporteur e-mail — nodemailer est une dépendance du projet.
let nodemailerDemandes = null;
try {
  nodemailerDemandes = require("nodemailer");
} catch (e) {
  console.error("[DEMANDES] nodemailer indisponible :", e.message);
}

const LIBELLES_TYPE_DEMANDE = {
  ATTESTATION_TRAVAIL: "Attestation de travail",
  ATTESTATION_SALAIRE: "Attestation de salaire",
  CONGE: "Demande de congé",
  AUTORISATION_SORTIE: "Autorisation de sortie",
  PARRAINAGE: "Demande de parrainage",
};
// (MODIFIÉ Task 178) — VALIDEE : statut posé AUTOMATIQUEMENT quand la
// réponse e-mail du manager est reconnue comme une VALIDATION (cahier des
// charges « reconnaissance des formulations d'acceptation/refus »).
const LIBELLES_STATUT_DEMANDE = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  VALIDEE: "Validée",
  INFORMATION_REQUISE: "Information requise",
};
const TYPES_DEMANDE_VALABLES = Object.keys(LIBELLES_TYPE_DEMANDE);
const PLAFOND_DEMANDES_OUVERTES = 30; // garde-fou anti-spam par employé

function libelleTypeDemande(t) {
  return LIBELLES_TYPE_DEMANDE[t] || String(t || "");
}
function libelleStatutDemande(s) {
  return LIBELLES_STATUT_DEMANDE[s] || String(s || "");
}
function masquerCinDemande(s) {
  const v = String(s == null ? "" : s);
  return v.length <= 3 ? v : "•••" + v.slice(-3);
}
function emailValideDemande(s) {
  const v = String(s == null ? "" : s).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}
function formatDateDemande(d) {
  try {
    return new Date(d).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return String(d);
  }
}

/** Lit la configuration SMTP + routage (identifiants DÉCHIFFRÉS en mémoire). */
async function lireConfigMailDemandes() {
  const cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!cfg) return null;
  let username = null;
  let password = null;
  try {
    username = cfg.username ? cryptoBd.dechiffrerChamp(cfg.username) : null;
  } catch (e) { username = null; }
  try {
    password = cfg.password ? cryptoBd.dechiffrerChamp(cfg.password) : null;
  } catch (e) { password = null; }
  // (CORRIGÉ v0.2.178 — découvert en campagne E2E réelle) les adresses de
  // ROUTAGE sont stockées CHIFFRÉES (même discipline que username/password
  // depuis le chiffrement au repos de la configuration) : l'ancien code les
  // renvoyait BRUTES — l'e-mail de demande partait vers la chaîne chiffrée
  // « encbd1:… » (SMTP « No recipients defined ») et le parrainage ne
  // recevait JAMAIS sa demande. dechiffrerChamp est IDEMPOTENT : une valeur
  // historique en clair passe telle quelle (compatibilité totale).
  const dechiffrerAdresse = function (v) {
    if (!v) return "";
    try { return String(cryptoBd.dechiffrerChamp(v) || "").trim(); }
    catch (e) { return String(v).trim(); }
  };
  return {
    host: cfg.host || "",
    port: cfg.port || 587,
    username: username,
    password: password,
    from: cfg.from || "",
    rhEmail: dechiffrerAdresse(cfg.rhEmail),
    itEmail: dechiffrerAdresse(cfg.itEmail),
    responsablesMap: cfg.responsablesMap || "",
    // (NOUVEAU v0.2.49) adresse DÉDIÉE des demandes de parrainage
    parrainageEmail: dechiffrerAdresse(cfg.parrainageEmail),
    // (NOUVEAU v0.2.94, Task 197 ; MODIFIÉ v0.2.196 ; MODIFIÉ v0.2.197 —
    // parrainageCopieEmail) MAP DE CONFIGURATION
    // DES MAILS — une adresse DÉDIÉE par type de demande (attestations :
    // COPIE systématique, la boîte du service RH redevient destinataire
    // principal ; congé / autorisation de sortie : copie systématique,
    // manager responsable principal).
    attestationTravailEmail: dechiffrerAdresse(cfg.attestationTravailEmail),
    attestationSalaireEmail: dechiffrerAdresse(cfg.attestationSalaireEmail),
    congeEmail: dechiffrerAdresse(cfg.congeEmail),
    autorisationEmail: dechiffrerAdresse(cfg.autorisationEmail),
    // (NOUVEAU v0.2.197, demande utilisateur « en copie du responsable
    // principal du parrainage ») adresse qui reçoit une COPIE des demandes
    // de parrainage — l'adresse dédiée (parrainageEmail) reste destinataire
    // PRINCIPAL pour la validation par réponse e-mail.
    parrainageCopieEmail: dechiffrerAdresse(cfg.parrainageCopieEmail),
  };
}

/** Table des responsables : lignes « DEPARTEMENT=email », clé DEFAUT incluse. */
function analyserResponsablesDemandes(txt) {
  const map = {};
  let defaut = "";
  String(txt || "").split(/\r?\n/).forEach(function (ligneBrute) {
    const ligne = ligneBrute.trim();
    if (!ligne || ligne.indexOf("=") < 0) return;
    const i = ligne.indexOf("=");
    const cle = ligne.slice(0, i).trim().toUpperCase();
    const val = ligne.slice(i + 1).trim();
    if (!cle || !val) return;
    if (cle === "DEFAUT") defaut = val;
    else map[cle] = val;
  });
  return { map: map, defaut: defaut };
}

/** Destinataire du traitement selon le type de demande (cahier des charges).
 * (MODIFIÉ — v0.2.132) `managerInfo` = { nom, email } du MANAGER RESPONSABLE
 * de l'employé, résolu AUTOMATIQUEMENT par l'appelant (acc.managerId) —
 * congé et autorisation de sortie. */
function destinatairePourDemande(type, donnees, cfg, managerInfo) {
  if (!cfg) return { dest: null, motif: "SMTP non configuré" };
  if (type === "ATTESTATION_TRAVAIL" || type === "ATTESTATION_SALAIRE") {
    // (MODIFIÉ — v0.2.196, demande utilisateur « en copie ») la demande
    // d'attestation repart à la BOÎTE DU SERVICE RH comme destinataire
    // PRINCIPAL (comportement historique Task 116 restauré) ; l'adresse
    // DÉDIÉE du type (attestationTravailEmail / attestationSalaireEmail —
    // Task 197) reçoit DÉSORMAIS une COPIE systématique (bloc 2 de
    // envoyerEmailsDemandeEnArrierePlan), exactement comme le congé et
    // l'autorisation de sortie. Sans boîte RH configurée : REPLI sur
    // l'adresse dédiée (la demande doit toujours aboutir quelque part).
    if (cfg.rhEmail) {
      return {
        dest: cfg.rhEmail,
        motif:
          "Auto-RH (copie systématique à l'adresse dédiée des demandes d'" +
          (type === "ATTESTATION_TRAVAIL" ? "attestation de travail" : "attestation de salaire") +
          " — panneau SMTP → routage)",
      };
    }
    const dediee =
      type === "ATTESTATION_TRAVAIL" ? cfg.attestationTravailEmail : cfg.attestationSalaireEmail;
    if (dediee) {
      return {
        dest: dediee,
        motif:
          "Adresse dédiée des demandes d'" +
          (type === "ATTESTATION_TRAVAIL" ? "attestation de travail" : "attestation de salaire") +
          " (repli — boîte du service RH non configurée)",
      };
    }
    return {
      dest: null,
      motif:
        "E-mail du service RH et adresse dédiée des demandes d'" +
        (type === "ATTESTATION_TRAVAIL" ? "attestation de travail" : "attestation de salaire") +
        " non configurés (panneau SMTP → routage)",
    };
  }
  if (type === "CONGE") {
    // (MODIFIÉ — v0.2.132, demande utilisateur) le N+1 SAISI par l'employé
    // disparaît : le destinataire PRINCIPAL est le MANAGER RESPONSABLE affecté
    // à l'employé dans la fenêtre « Mot de passe initial — CIN » (résolu
    // automatiquement par l'appelant — managerInfo). Sans manager affecté :
    // REPLI sur la boîte du service RH (la demande doit toujours aboutir).
    if (managerInfo && managerInfo.email && emailValideDemande(managerInfo.email)) {
      return {
        dest: managerInfo.email,
        motif: "Manager responsable de l'employé (affectation « Mot de passe initial — CIN »)",
      };
    }
    return cfg.rhEmail
      ? { dest: cfg.rhEmail, motif: "Auto-RH (aucun manager responsable affecté à l'employé)" }
      : { dest: null, motif: "Aucun manager responsable affecté et e-mail du service RH non configuré (panneau SMTP → routage)" };
  }
  if (type === "PARRAINAGE") {
    // (MODIFIÉ — v0.2.92) le champ « e-mail du N+1 » disparaît du formulaire :
    // le routage est AUTOMATIQUE vers l'adresse DÉDIÉE des demandes de
    // parrainage (configurable dans l'administration, panneau SMTP → routage).
    // Sans adresse dédiée configurée : REPLI sur la boîte du service RH (la
    // demande doit toujours aboutir quelque part) — plus jamais le N+1 saisi.
    // (NOUVEAU — v0.2.197, demande utilisateur « en copie du responsable
    // principal du parrainage ») l'adresse dédiée reste destinataire
    // PRINCIPAL ; une COPIE est envoyée automatiquement en arrière-plan
    // (envoyerEmailsDemandeEnArrierePlan) à parrainageCopieEmail quand elle
    // est configurée — AUCUN repli (jamais de doublon du principal).
    if (cfg.parrainageEmail) {
      return { dest: cfg.parrainageEmail, motif: "Adresse dédiée des demandes de parrainage (copie automatique au responsable principal — v0.2.197)" };
    }
    return cfg.rhEmail
      ? { dest: cfg.rhEmail, motif: "Auto-RH (aucune adresse dédiée au parrainage configurée — onglet Accès portail → routage)" }
      : { dest: null, motif: "Aucune adresse dédiée au parrainage configurée et e-mail du service RH absent (onglet Accès portail → routage)" };
  }
  if (type === "AUTORISATION_SORTIE") {
    // (MODIFIÉ — v0.2.132) le destinataire PRINCIPAL est le MANAGER RESPONSABLE
    // affecté à l'employé (résolu automatiquement — managerInfo) ; l'ancien
    // routage « Responsable N+1 saisi / département » (v0.2.88) reste le repli
    // pour les anciens clients. La COPIE au service RH est envoyée
    // AUTOMATIQUEMENT en arrière-plan (envoyerEmailsDemandeEnArrierePlan —
    // congé et autorisation de sortie).
    if (managerInfo && managerInfo.email && emailValideDemande(managerInfo.email)) {
      return {
        dest: managerInfo.email,
        motif: "Manager responsable de l'employé (copie automatique au service RH)",
      };
    }
    const n1 = String(donnees.responsableN1 || "").trim();
    if (n1 && emailValideDemande(n1)) {
      return {
        dest: n1,
        motif: "Responsable N+1 indiqué par l'employé (copie automatique au service RH)",
      };
    }
    const r = analyserResponsablesDemandes(cfg.responsablesMap);
    const cle = String(donnees.departement || "").trim().toUpperCase();
    const dest = (cle && r.map[cle]) || r.defaut || cfg.rhEmail || null;
    return {
      dest: dest,
      motif: dest
        ? (cle && r.map[cle] ? "Responsable du département " + cle : "Responsable par défaut")
        : "Aucun responsable configuré (table des responsables vide)",
    };
  }
  return { dest: null, motif: "Type de demande inconnu" };
}

/** Expéditeur effectif (même logique que src/lib/mailer.ts). */
function expediteurEffectifDemandes(cfg) {
  if (cfg && cfg.from) return cfg.from;
  if (cfg && cfg.username && emailValideDemande(cfg.username)) {
    return "AutoRH <" + cfg.username + ">";
  }
  return "AutoRH";
}

// ============================================================================
// NOUVEAU (Task 118) — TAMPON AUTOMATIQUE « SIGNATURE ÉLECTRONIQUE & QR CODE »
// ============================================================================
// Jumelle JavaScript EXACTE de src/lib/stamp.ts (⚠ garder alignées : empreinte
// HMAC, charge utile, contenu QR, géométrie de placement). Le tampon est
// apposé AU SERVAGE des fiches du portail employé : l'original stocké reste
// intact, les fiches déjà importées sont tamponnées elles aussi, et la
// configuration se règle dans l'administration (onglet Importation → rubrique
// « Signature électronique & QR code »).pdf-lib et qrcode sont déjà des
// dépendances du projet (chargées paresseusement : le portail démarre même
// sans ces paquets, le tampon est simplement ignoré — jamais bloquant).

let _pdfLibTampon = null;
function chargePdfLibTampon() {
  if (!_pdfLibTampon) _pdfLibTampon = require("pdf-lib");
  return _pdfLibTampon;
}
let _qrcodeTampon = null;
function chargeQrcodeTampon() {
  if (!_qrcodeTampon) _qrcodeTampon = require("qrcode");
  return _qrcodeTampon;
}

const SEL_SIGNATURE_TAMPON = "autorh-signature-v1";
let _cleEmpreinteTampon = null;
function cleEmpreinteTampon() {
  if (!_cleEmpreinteTampon) {
    const matiere =
      process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
      process.env.AUTH_SECRET ||
      "autorh-storage-local-a-changer-dans-env";
    _cleEmpreinteTampon = crypto.scryptSync(matiere, SEL_SIGNATURE_TAMPON, 32);
  }
  return _cleEmpreinteTampon;
}

/** Charge utile commune (TS ⇄ JS portail) : mêmes champs, même ordre. */
function chargeEmpreinteTampon(rec) {
  let up = "";
  if (rec.uploadedAt) {
    const d = new Date(rec.uploadedAt);
    up = (Number.isNaN(d.getTime()) ? new Date(rec.uploadedAt) : d).toISOString();
  }
  return [rec.id, rec.cin || "", rec.period || "", rec.netSalary || "", up].join("|");
}

/** Empreinte de contrôle = HMAC-SHA256 → 12 caractères hex MAJUSCULES. */
function empreinteFicheTampon(rec) {
  return crypto
    .createHmac("sha256", cleEmpreinteTampon())
    .update(chargeEmpreinteTampon(rec))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

// NOUVEAU (Task 180, v0.2.86) — JETON DE LA FICHE EN LIGNE : jumelle EXACTE de
// jetonFiche() de src/lib/stamp.ts (domaine distinct de l'empreinte, 24
// caractères hex MAJUSCULES, dérivé du SEUL id — non expirant). Le QR
// « Fiche en ligne » encode {qrUrl}/verification/fiche/{id}?t={jeton} : la
// page publique de vérification (site d'administration) valide ce jeton
// avec jetonFicheValide() avant de révéler quoi que ce soit.
const DOMAINE_JETON_FICHE_TAMPON = "fiche-en-ligne-v1";

function jetonFicheTampon(rec) {
  return crypto
    .createHmac("sha256", cleEmpreinteTampon())
    .update(DOMAINE_JETON_FICHE_TAMPON + "|" + rec.id)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

function dateFrTampon(d) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(d));
  } catch (e) {
    return String(d);
  }
}

// ============================================================================
// (NOUVEAU v0.2.88) — CERTIFICAT DE SIGNATURE (Switch ON/OFF) — JUMELLES
// EXACTES de certificatAffichable() / lignesCertificat() de stamp.ts : le
// bloc certificat n'est dessiné QUE quand le Switch certActif est ON et
// qu'un certificat importé porte des métadonnées exploitables (Task 181).
// ============================================================================

function certificatAffichableTampon(cfg) {
  return Boolean(
    cfg && cfg.certActif &&
    String(cfg.certSujet || "").trim() &&
    String(cfg.certEmpreinte || "").trim()
  );
}

/** Lignes du bloc certificat dessiné sur le document (texte compact 6,5 pt). */
function lignesCertificatTampon(cfg) {
  if (!certificatAffichableTampon(cfg)) return [];
  const sujet = String(cfg.certSujet || "").trim();
  const emetteur = String(cfg.certEmetteur || "").trim();
  const serie = String(cfg.certSerie || "").trim().slice(0, 24);
  const jusquAu = cfg.certValideAu ? dateFrTampon(cfg.certValideAu) : "";
  const empreinte = String(cfg.certEmpreinte || "").replace(/\s+/g, "").toUpperCase();
  return [
    "Signature électronique certifiée — Titulaire : " + sujet,
    emetteur
      ? "Émetteur : " + emetteur + (jusquAu ? " — Valide jusqu'au " + jusquAu : "")
      : jusquAu ? "Valide jusqu'au " + jusquAu : "",
    "Certificat SHA-256 : " + empreinte.slice(0, 48) + (empreinte.length > 48 ? "…" : "") + (serie ? " — N° " + serie : ""),
  ].filter(function (l) { return l.trim(); });
}

/** Contenu du QR (4 modes — identique à contenuQr() de src/lib/stamp.ts).
 * (NOUVEAU Task 180, v0.2.86) mode « FICHE » : lien signé de la fiche en ligne —
 * {qrUrl}/verification/fiche/{id}?t={jeton} ; qrUrl vide = QR non apposé.
 * (NOUVEAU v0.2.88) un `rec` porteur de `urlVerification` encode DIRECTEMENT
 * cette adresse (documents de réponse RH — branche jumelle de stamp.ts ; le
 * portail ne tamponne que des fiches, qui n'ont JAMAIS ce champ : aucune
 * incidence sur le rendu historique). */
function contenuQrTampon(rec, cfg) {
  const urlReponse = String(rec && rec.urlVerification ? rec.urlVerification : "").trim();
  if (urlReponse) return urlReponse;
  if (cfg.qrMode === "TEXTE") return String(cfg.qrTexte || "").trim();
  if (cfg.qrMode === "FICHE") {
    const base = String(cfg.qrUrl || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    return base + "/verification/fiche/" + rec.id + "?t=" + jetonFicheTampon(rec);
  }
  if (cfg.qrMode === "URL") {
    const base = String(cfg.qrUrl || "").trim();
    if (!base) return "";
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return (
      base +
      sep +
      "ref=" + encodeURIComponent(rec.id) +
      "&cin=" + encodeURIComponent(rec.cin || "") +
      "&h=" + empreinteFicheTampon(rec)
    );
  }
  return [
    "AutoRH — Fiche de paie",
    "Réf : " + rec.id,
    "Employé : " + (String(rec.employeeName || "").trim() || "—"),
    "CIN : " + (String(rec.cin || "").trim() || "—"),
    "Période : " + (String(rec.period || "").trim() || "—"),
    "Net à payer : " + (String(rec.netSalary || "").trim() || "—"),
    "Importée le : " + dateFrTampon(rec.uploadedAt),
    "Empreinte : " + empreinteFicheTampon(rec),
  ].join("\n");
}

const MARGE_TAMPON = 24;
const HAUT_MENTION_TAMPON = 22;
const ECART_ELEMENTS_TAMPON = 14;

/**
 * (MODIFIÉ 0.2.47 ; LIBÉRÉ 0.2.54) jumelle EXACTE de coinVersBoite() de
 * src/lib/stamp.ts : coin de départ + décalage utilisateur borné au PÉRIMÈTRE
 * de la page (décalages ±1500 pt côté interface/API : placement LIBRE sur
 * toute la feuille, l'élément restant toujours entièrement visible).
 */
function coinVersBoiteTampon(position, pageW, pageH, w, h, mentionPresente, decalX, decalY) {
  const haut = position.indexOf("HAUT") === 0;
  const droite = position.slice(-6) === "DROITE";
  const basDecal = mentionPresente ? HAUT_MENTION_TAMPON : MARGE_TAMPON;
  const brutX = (droite ? pageW - MARGE_TAMPON - w : MARGE_TAMPON) + (Number(decalX) || 0);
  const brutY = (haut ? pageH - MARGE_TAMPON - h : basDecal) + (Number(decalY) || 0);
  const maxX = Math.max(MARGE_TAMPON, pageW - MARGE_TAMPON - w);
  // Plancher Y = HAUT_MENTION (22) : autorise la position naturelle de la
  // mention — un plancher à MARGE (24) aurait déplacé le réglage historique.
  const maxY = Math.max(HAUT_MENTION_TAMPON, pageH - MARGE_TAMPON - h);
  return {
    x: Math.min(maxX, Math.max(MARGE_TAMPON, brutX)),
    y: Math.min(maxY, Math.max(HAUT_MENTION_TAMPON, brutY)),
  };
}

/**
 * (NOUVEAU v0.2.92) jumelle EXACTE de certVersBoite() de src/lib/stamp.ts :
 * placement du BLOC CERTIFICAT — BAS_CENTRE (défaut) = rendu historique
 * exact (centré, posé sur yBasDefaut du moteur + décalages bornés) ; les
 * 4 coins passent par coinVersBoiteTampon (réserve de mention en bas).
 */
function certVersBoiteTampon(position, pageW, pageH, w, h, mentionPresente, yBasDefaut, decalX, decalY) {
  if (String(position || "BAS_CENTRE") === "BAS_CENTRE") {
    const brutX = (pageW - w) / 2 + (Number(decalX) || 0);
    const brutY = yBasDefaut + (Number(decalY) || 0);
    const maxX = Math.max(6, pageW - 6 - w);
    const maxY = Math.max(yBasDefaut, pageH - h);
    return {
      x: Math.min(maxX, Math.max(6, brutX)),
      y: Math.min(maxY, Math.max(0, brutY)),
    };
  }
  return coinVersBoiteTampon(String(position), pageW, pageH, w, h, mentionPresente, decalX, decalY);
}

/** (NOUVEAU v0.2.92) jumelle d'echelleCertificat() de stamp.ts : échelle du
 * bloc certificat — certTaille (50 → 300 %) / 100, défaut 1. */
function echelleCertificatTampon(cfg) {
  const n = Number(cfg && cfg.certTaille);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(3, n / 100));
}

/**
 * (NOUVEAU 0.2.56) jumelle EXACTE de rotationPageEffective() de stamp.ts :
 * rotation /Rotate EFFECTIVE d'une page (dictionnaire de page OU HÉRITÉE des
 * nœuds /Pages parents), normalisée 0|90|180|270. Fiches Sage PAYSAGE avec
 * /Rotate 270 : pdf-lib dessine dans l'espace NON pivoté — sans correction,
 * le tampon « bas droite » apparaissait visuellement en haut et tourné
 * (cause racine Task 135).
 */
function rotationPageEffectiveTampon(page) {
  try {
    var brut = page.node && typeof page.node.Rotate === "function" ? page.node.Rotate() : null;
    var n = brut && typeof brut.asNumber === "function" ? brut.asNumber() : Number(brut || 0);
    var q = Math.round((Number.isFinite(n) ? n : 0) / 90) * 90;
    return ((q % 360) + 360) % 360;
  } catch (e) {
    return 0;
  }
}

/* --- (NOUVEAU 0.2.54) ROTATION — jumelles EXACTES de src/lib/stamp.ts --- */

/** Angle normalisé 0..359 (degrés SENS HORAIRE, défaut 0). */
function angleNormaliseeTampon(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const a = Math.round(n) % 360;
  return a < 0 ? a + 360 : a;
}

/** Boîte englobante d'un rectangle w×h tourné de angleDeg (0° = inchangée). */
function boiteTourneeTampon(w, h, angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { w: w * c + h * s, h: w * s + h * c };
}

/** Point local (px, py — bloc NON tourné, origine bas-gauche, y vers le haut)
 * après rotation HORAIRE de angleDeg autour du centre du bloc, le centre
 * tourné étant placé en (cx, cy). pdf-lib tourne en ANTI-HORAIRE autour de
 * l'ancrage → dessiner avec rotate: degrees(-angleDeg). */
function pointTourneTampon(cx, cy, bw, bh, angleDeg, px, py) {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = px - bw / 2;
  const dy = py - bh / 2;
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos,
  };
}

function chevaucheTampon(a, b) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + ECART_ELEMENTS_TAMPON &&
    b.x < a.x + a.w + ECART_ELEMENTS_TAMPON &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/**
 * Assainit un texte pour l'écriture avec une police standard WinAnsi
 * (Helvetica) — jumelle EXACTE de texteWinAnsi() de src/lib/stamp.ts.
 */
function texteWinAnsiTampon(texte) {
  let t = String(texte || "")
    .replace(/[\u2190-\u21FF\u2794\u27A1]/g, "->")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=")
    .replace(/[\u2260]/g, "!=")
    .replace(/[\u2212]/g, "-");
  t = t.replace(
    /[^\x20-\x7E\u00A0-\u00FF\u20AC\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u2039\u203A\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC]/g,
    "?"
  );
  return t;
}

function couperLignesTampon(texte, font, taille, largeurMax) {
  const lignes = [];
  String(texte || "").split(/\r?\n/).forEach(function (brut) {
    let courante = "";
    brut.split(/\s+/).filter(Boolean).forEach(function (mot) {
      const essai = courante ? courante + " " + mot : mot;
      if (font.widthOfTextAtSize(essai, taille) <= largeurMax || !courante) {
        courante = essai;
      } else {
        lignes.push(courante);
        courante = mot;
      }
    });
    if (courante) lignes.push(courante);
  });
  return lignes;
}

function decoderImageTampon(sigImage) {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(String(sigImage || ""));
  if (!m) return null;
  try {
    return { octets: Buffer.from(m[2], "base64"), png: m[1] === "png" };
  } catch (e) {
    return null;
  }
}

/**
 * Appose signature et/ou QR et/ou mention sur TOUTES les pages du PDF.
 * Ne lève JAMAIS d'exception : fiche servie sans tampon en cas d'erreur.
 */
async function tamponnerFicheTampon(donnees, rec, cfg) {
  try {
    if (!cfg || !cfg.actif) return donnees;
    if (!cfg.sigActif && !cfg.qrActif && !cfg.mentionActif) return donnees;
    const { PDFDocument, StandardFonts, rgb, degrees } = chargePdfLibTampon();
    const pdf = await PDFDocument.load(donnees, { ignoreEncryption: true });
    const pages = pdf.getPages();
    if (!pages.length) return donnees;

    const font = await pdf.embedFont(StandardFonts.Helvetica);

    // ---- Ressources dessinables (une seule fois) ----
    // (NOUVEAU 0.2.56) octets bruts conservés : indispensables pour intégrer
    // les images dans un CALQUE quand la page porte un /Rotate (voir plus bas).
    let qrOctets = null;
    let qrEstPng = true;
    let sigOctets = null;
    let sigEstPng = true;
    let qrImg = null;
    let qrL = 0;
    let qrH = 0;
    if (cfg.qrActif) {
      // (NOUVEAU 0.2.47) mode IMAGE : QR FOURNI par l'établissement (jumelle
      // exacte de stamp.ts — image importée, ajustée dans la boîte, ratio gardé).
      if (cfg.qrMode === "IMAGE") {
        const dec = decoderImageTampon(cfg.qrImage);
        if (dec) {
          qrImg = dec.png ? await pdf.embedPng(dec.octets) : await pdf.embedJpg(dec.octets);
          qrOctets = dec.octets;
          qrEstPng = dec.png;
          // (LIBÉRÉ 0.2.54) taille 40 → 1200 pt (au lieu de 60 → 220)
          const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
          const echelle = cote / Math.max(qrImg.width, qrImg.height);
          qrL = qrImg.width * echelle;
          qrH = qrImg.height * echelle;
        }
      } else {
        const contenu = contenuQrTampon(rec, cfg);
        if (contenu) {
          const QRCode = chargeQrcodeTampon();
          const png = await QRCode.toBuffer(contenu, {
            type: "png", margin: 0, width: 640, errorCorrectionLevel: "M",
          });
          qrImg = await pdf.embedPng(png);
          qrOctets = png;
          qrEstPng = true;
          // (LIBÉRÉ 0.2.54) taille 40 → 1200 pt (au lieu de 60 → 220)
          const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
          qrL = cote;
          qrH = cote;
        }
      }
    }

    let sigImg = null;
    let sigL = 0;
    let sigH = 0;
    if (cfg.sigActif) {
      const dec = decoderImageTampon(cfg.sigImage);
      if (dec) {
        sigImg = dec.png ? await pdf.embedPng(dec.octets) : await pdf.embedJpg(dec.octets);
        sigOctets = dec.octets;
        sigEstPng = dec.png;
        // (LIBÉRÉ 0.2.54) largeur 40 → 1200 pt (au lieu de 60 → 240)
        sigL = Math.max(40, Math.min(1200, Number(cfg.sigTaille) || 120));
        const echelle = sigL / sigImg.width;
        sigH = sigImg.height * echelle;
      }
    }

    const texteBrut = String(cfg.sigTexte || "").trim();
    const tailleTexte = 8;
    const opacite = Math.max(0.3, Math.min(1, Number(cfg.sigOpacite) || 0.9));
    const mentionBrute = texteWinAnsiTampon(
      String(cfg.mentionTexte || "").replace(/\{DATE\}/g, dateFrTampon(new Date()))
    );
    // (NOUVEAU v0.2.88) lignes du bloc certificat (Switch certActif ON +
    // certificat importé) — jumelle exacte du moteur stamp.ts.
    const lignesCert = lignesCertificatTampon(cfg).map(function (l) { return texteWinAnsiTampon(l); });
    // (NOUVEAU 0.2.54) angles normalisés (degrés horaires) — calculés UNE fois
    const angleQr = angleNormaliseeTampon(cfg.qrRotation);
    const angleSig = angleNormaliseeTampon(cfg.sigRotation);

    // (NOUVEAU 0.2.56) jumelle de dessinerTamponSur (stamp.ts) : dessin du
    // tampon sur UNE cible — la page ELLE-MÊME (rot 0, rendu historique
    // STRICTEMENT inchangé) ou un CALQUE aux dimensions VISUELLES.
    const dessinerTamponSurTampon = function (cible, W, H, font, qrImg, sigImg) {
      let boiteQr = null;
      let boiteSig = null;
      // (0.2.54) dims NON tournées du bloc signature pour le dessin tourné
      let sigDims = null;

      if (qrImg) {
        // (MODIFIÉ 0.2.54) placement sur la BOÎTE ENGLOBANTE de l'élément
        // tourné (0° = boîte historique, rendu inchangé)
        const bbQr = boiteTourneeTampon(qrL, qrH, angleQr);
        const pos = coinVersBoiteTampon(cfg.qrPosition, W, H, bbQr.w, bbQr.h, cfg.mentionActif, cfg.qrDecalX, cfg.qrDecalY);
        boiteQr = { x: pos.x, y: pos.y, w: bbQr.w, h: bbQr.h };
      }

      let lignesTexte = [];
      if (sigImg || texteBrut) {
        lignesTexte = texteBrut ? couperLignesTampon(texteWinAnsiTampon(texteBrut), font, tailleTexte, 170) : [];
        const hauteurTexte = lignesTexte.length
          ? lignesTexte.length * (tailleTexte + 2) + 3
          : 0;
        const hauteurTotale = (sigImg ? sigH : 0) + hauteurTexte;
        if (hauteurTotale > 0) {
          let largeur = sigImg ? sigL : 0;
          lignesTexte.forEach(function (l) {
            largeur = Math.max(largeur, font.widthOfTextAtSize(l, tailleTexte));
          });
          sigDims = { w: largeur, h: hauteurTotale };
          const bbSig = boiteTourneeTampon(largeur, hauteurTotale, angleSig);
          const pos = coinVersBoiteTampon(cfg.sigPosition, W, H, bbSig.w, bbSig.h, cfg.mentionActif, cfg.sigDecalX, cfg.sigDecalY);
          boiteSig = { x: pos.x, y: pos.y, w: bbSig.w, h: bbSig.h };
          if (chevaucheTampon(boiteSig, boiteQr) && boiteQr) {
            const aDroite = cfg.sigPosition.slice(-6) === "DROITE";
            boiteSig.x = aDroite
              ? boiteQr.x - ECART_ELEMENTS_TAMPON - boiteSig.w
              : boiteQr.x + boiteQr.w + ECART_ELEMENTS_TAMPON;
          }
        }
      }

      if (qrImg && boiteQr) {
        if (angleQr === 0) {
          cible.drawImage(qrImg, { x: boiteQr.x, y: boiteQr.y, width: boiteQr.w, height: boiteQr.h });
        } else {
          // (NOUVEAU 0.2.54) rotation HORAIRE autour du CENTRE de la boîte
          // placée : ancre = coin bas-gauche de l'image NON tournée, angle
          // pdf-lib = -angleQr (pdf-lib : positif = anti-horaire)
          const ancreQr = pointTourneTampon(
            boiteQr.x + boiteQr.w / 2, boiteQr.y + boiteQr.h / 2,
            qrL, qrH, angleQr, 0, 0
          );
          cible.drawImage(qrImg, {
            x: ancreQr.x, y: ancreQr.y, width: qrL, height: qrH,
            rotate: degrees(-angleQr),
          });
        }
      }

      if (boiteSig && sigDims) {
        const cxS = boiteSig.x + boiteSig.w / 2; // centre de la boîte placée
        const cyS = boiteSig.y + boiteSig.h / 2;
        if (angleSig === 0) {
          // Rendu historique (0°) STRICTEMENT identique
          let y = boiteSig.y + sigDims.h;
          if (sigImg) {
            y -= sigH;
            cible.drawImage(sigImg, {
              x: boiteSig.x + (sigDims.w - sigL) / 2,
              y: y,
              width: sigL,
              height: sigH,
              opacity: opacite,
            });
          }
          lignesTexte.forEach(function (ligne) {
            y -= tailleTexte + 2;
            const wLigne = font.widthOfTextAtSize(ligne, tailleTexte);
            cible.drawText(ligne, {
              x: boiteSig.x + Math.max(0, (sigDims.w - wLigne) / 2),
              y: y,
              size: tailleTexte,
              font: font,
              color: rgb(0.2, 0.2, 0.2),
            });
          });
        } else {
          // (NOUVEAU 0.2.54) rotation HORAIRE du bloc ENTIER (image + texte)
          // autour du centre de la boîte placée — ancres locales tournées.
          if (sigImg) {
            const ix = (sigDims.w - sigL) / 2;
            const iy = sigDims.h - sigH;
            const ancre = pointTourneTampon(cxS, cyS, sigDims.w, sigDims.h, angleSig, ix, iy);
            cible.drawImage(sigImg, {
              x: ancre.x, y: ancre.y, width: sigL, height: sigH,
              opacity: opacite,
              rotate: degrees(-angleSig),
            });
          }
          let yLocal = sigDims.h - (sigImg ? sigH : 0);
          lignesTexte.forEach(function (ligne) {
            yLocal -= tailleTexte + 2;
            const wLigne = font.widthOfTextAtSize(ligne, tailleTexte);
            const lx = Math.max(0, (sigDims.w - wLigne) / 2);
            const ancreL = pointTourneTampon(cxS, cyS, sigDims.w, sigDims.h, angleSig, lx, yLocal);
            cible.drawText(ligne, {
              x: ancreL.x,
              y: ancreL.y,
              size: tailleTexte,
              font: font,
              color: rgb(0.2, 0.2, 0.2),
              rotate: degrees(-angleSig),
            });
          });
        }
      }

      if (cfg.mentionActif && mentionBrute.trim()) {
        const m = mentionBrute.length > 110 ? mentionBrute.slice(0, 110) : mentionBrute;
        const wM = font.widthOfTextAtSize(m, 7.5);
        cible.drawText(m, {
          x: Math.max(6, (W - wM) / 2),
          y: 10,
          size: 7.5,
          font: font,
          color: rgb(0.35, 0.35, 0.35),
        });
      }

      // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) BLOC CERTIFICAT DE SIGNATURE
      // (Switch certActif) — jumelle exacte du moteur stamp.ts : texte
      // compact POSITIONNABLE — BAS_CENTRE (défaut) = rendu historique exact
      // (centré au-dessus de la mention, ou au bord inférieur quand la
      // mention est absente) ; 4 coins + décalages certDecalX/Y + échelle
      // certTaille pour le placement libre.
      if (lignesCert.length) {
        const echelleCert = echelleCertificatTampon(cfg);
        const tailleCert = 6.5 * echelleCert;
        const pasCert = 9 * echelleCert;
        const yBas = cfg.mentionActif && mentionBrute.trim() ? HAUT_MENTION_TAMPON : 10;
        const wBloc = Math.max.apply(null, lignesCert.map(function (l) { return font.widthOfTextAtSize(l, tailleCert); }));
        const hBloc = lignesCert.length * pasCert;
        const posCert = certVersBoiteTampon(
          cfg.certPosition,
          W,
          H,
          wBloc,
          hBloc,
          Boolean(cfg.mentionActif && mentionBrute.trim()),
          yBas,
          cfg.certDecalX,
          cfg.certDecalY
        );
        let yC = posCert.y + hBloc;
        for (const ligne of lignesCert) {
          yC -= pasCert;
          const wC = font.widthOfTextAtSize(ligne, tailleCert);
          cible.drawText(ligne, {
            x: posCert.x + Math.max(0, (wBloc - wC) / 2),
            y: yC,
            size: tailleCert,
            font: font,
            color: rgb(0.3, 0.3, 0.3),
          });
        }
      }
    };

    // (MODIFIÉ 0.2.56) pages avec /Rotate : calque VISUEL + composition tournée
    // (jumelle exacte de la boucle stamp.ts — ancres 90/180/270 dérivées :
    // un point visuel (px,py) est replacé EXACTEMENT à px du bord gauche et
    // py du bord bas de la page telle qu'affichée à l'écran).
    for (const page of pages) {
      const taillePage = page.getSize();
      const Wm = taillePage.width;
      const Hm = taillePage.height;
      const rotPage = rotationPageEffectiveTampon(page);
      if (rotPage === 0) {
        dessinerTamponSurTampon(page, Wm, Hm, font, qrImg, sigImg);
        continue;
      }
      const echange = rotPage === 90 || rotPage === 270;
      const Wv = echange ? Hm : Wm;
      const Hv = echange ? Wm : Hm;
      const calque = await PDFDocument.create();
      const fontCalque = await calque.embedFont(StandardFonts.Helvetica);
      const imgQrCalque = qrOctets
        ? qrEstPng
          ? await calque.embedPng(qrOctets)
          : await calque.embedJpg(qrOctets)
        : null;
      const imgSigCalque = sigOctets
        ? sigEstPng
          ? await calque.embedPng(sigOctets)
          : await calque.embedJpg(sigOctets)
        : null;
      dessinerTamponSurTampon(
        calque.addPage([Wv, Hv]),
        Wv,
        Hv,
        fontCalque,
        imgQrCalque,
        imgSigCalque
      );
      const embarques = await pdf.embedPdf(await calque.save());
      const mb = page.getMediaBox();
      const ancre =
        rotPage === 90
          ? { x: mb.x + Wm, y: mb.y, a: 90 }
          : rotPage === 180
          ? { x: mb.x + Wm, y: mb.y + Hm, a: 180 }
          : { x: mb.x, y: mb.y + Hm, a: -90 };
      page.drawPage(embarques[0], { x: ancre.x, y: ancre.y, rotate: degrees(ancre.a) });
    }

    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  } catch (e) {
    console.error("[PORTAIL] Tampon signature/QR non appliqué:", e && e.message ? e.message : e);
    return donnees;
  }
}

/* ==================================================================== */
/* (NOUVEAU 0.2.48) — TAMPON DES AUTRES FORMATS : IMAGE, DOCX, XLSX     */
/* Jumelle EXACTE de src/lib/stamp.ts (section 0.2.48) — mêmes algo,    */
/* mêmes constantes, mêmes marqueurs : ne pas modifier seul.            */
/* ==================================================================== */

let _sharpTampon = undefined;
function chargeSharpTampon() {
  if (_sharpTampon === undefined) {
    try { _sharpTampon = require("sharp"); } catch (e) { _sharpTampon = null; }
  }
  return _sharpTampon;
}
let _jszipTampon = undefined;
function chargeJszipTampon() {
  if (_jszipTampon === undefined) {
    try { _jszipTampon = require("jszip"); } catch (e) { _jszipTampon = null; }
  }
  return _jszipTampon;
}

const ECHELLE_SURFACE_TAMPON = 3;      // px par point (netteté du texte rasterisé)
const EMU_PAR_PT_TAMPON = 12700;       // OOXML : 914400 EMU / po ÷ 72 pt
const EMU_PAR_PX_TAMPON = 9525;        // 96 dpi
const FONT_SVG_TAMPON = "Helvetica, Arial, sans-serif";
const NS_WP_TAMPON = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A_TAMPON = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC_TAMPON = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_R_TAMPON = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_XDR_TAMPON = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const REL_IMAGE_TAMPON = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function echapperXmlTampon(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Métriques Helvetica EXACTES (mêmes coupures que le PDF), police cachée. */
let _helvTampon = null;
async function helveticaTampon() {
  if (!_helvTampon) {
    const { PDFDocument, StandardFonts } = chargePdfLibTampon();
    const doc = await PDFDocument.create();
    _helvTampon = await doc.embedFont(StandardFonts.Helvetica);
  }
  return _helvTampon;
}

async function redimensionnerPngTampon(octets, largeurCiblePx) {
  const sharp = chargeSharpTampon();
  if (!sharp) return null;
  try {
    return await sharp(octets, { failOn: "none" })
      .resize({ width: Math.max(1, Math.round(largeurCiblePx)) })
      .png().toBuffer();
  } catch (e) { return null; }
}

async function dimensionsImageTampon(octets) {
  const sharp = chargeSharpTampon();
  if (!sharp) return null;
  try {
    const m = await sharp(octets, { failOn: "none" }).metadata();
    if (!m.width || !m.height) return null;
    return { w: m.width, h: m.height };
  } catch (e) { return null; }
}

async function rasteriserSvgTampon(svg) {
  const sharp = chargeSharpTampon();
  if (!sharp) return null;
  try {
    return await sharp(Buffer.from(svg), { failOn: "none" }).png().toBuffer();
  } catch (e) { return null; }
}

/**
 * (NOUVEAU 0.2.54) jumelle de tournerSurfacePng() : tourne un PNG de surface
 * de angleDeg degrés SENS HORAIRE (fond transparent, canevas étendu à la
 * boîte englobante). 0° = PNG rendu tel quel ; sharp indisponible/échec →
 * PNG NON tourné (tampon apposé sans rotation — jamais bloquant).
 */
async function tournerSurfacePngTampon(png, angleDeg) {
  if (!angleDeg) return png;
  const sharp = chargeSharpTampon();
  if (!sharp) return png;
  try {
    return await sharp(png, { failOn: "none" })
      .rotate(angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
  } catch (e) { return png; }
}

/** Surface du QR : IMAGE = image fournie (ratio gardé) ; sinon QR généré.
 * (MODIFIÉ 0.2.54) taille 40 → 1200 pt + rotation cuite dans le PNG. */
async function surfaceQrTampon(rec, cfg) {
  const cote = Math.max(40, Math.min(1200, Number(cfg.qrTaille) || 110));
  const angle = angleNormaliseeTampon(cfg.qrRotation);
  if (cfg.qrMode === "IMAGE") {
    const dec = decoderImageTampon(cfg.qrImage);
    if (!dec) return null;
    const dims = await dimensionsImageTampon(dec.octets);
    if (!dims) return null;
    const ech = cote / Math.max(dims.w, dims.h);
    const png = await redimensionnerPngTampon(dec.octets, Math.max(dims.w, dims.h) * ECHELLE_SURFACE_TAMPON);
    if (!png) return null;
    const bb = boiteTourneeTampon(dims.w * ech, dims.h * ech, angle);
    const pngT = await tournerSurfacePngTampon(png, angle);
    return { png: pngT, wPt: bb.w, hPt: bb.h };
  }
  const contenu = contenuQrTampon(rec, cfg);
  if (!contenu) return null;
  try {
    const QRCode = chargeQrcodeTampon();
    const png = await QRCode.toBuffer(contenu, {
      type: "png", margin: 0,
      width: Math.min(1240, Math.round(cote * ECHELLE_SURFACE_TAMPON)),
      errorCorrectionLevel: "M",
    });
    const bb = boiteTourneeTampon(cote, cote, angle);
    const pngT = await tournerSurfacePngTampon(png, angle);
    return { png: pngT, wPt: bb.w, hPt: bb.h };
  } catch (e) { return null; }
}

/** Surface signature : image (opacité appliquée) + textes INTÉGRÉS. */
async function surfaceSignatureTampon(cfg) {
  const dec = decoderImageTampon(cfg.sigImage);
  const texteBrut = String(cfg.sigTexte || "").trim();
  if (!dec && !texteBrut) return null;

  const tailleTexte = 8;
  const opacite = Math.max(0.3, Math.min(1, Number(cfg.sigOpacite) || 0.9));
  const font = await helveticaTampon();

  let imgW = 0, imgH = 0, imgPng = null;
  if (dec) {
    const dims = await dimensionsImageTampon(dec.octets);
    if (dims) {
      // (LIBÉRÉ 0.2.54) largeur 40 → 1200 pt (au lieu de 60 → 240)
      imgW = Math.max(40, Math.min(1200, Number(cfg.sigTaille) || 120));
      imgH = imgW * (dims.h / dims.w);
      imgPng = await redimensionnerPngTampon(dec.octets, imgW * ECHELLE_SURFACE_TAMPON);
    }
  }

  const lignes = texteBrut ? couperLignesTampon(texteWinAnsiTampon(texteBrut), font, tailleTexte, 170) : [];
  let largeurTextes = 0;
  lignes.forEach(function (l) { largeurTextes = Math.max(largeurTextes, font.widthOfTextAtSize(l, tailleTexte)); });
  const hauteurTextes = lignes.length ? lignes.length * (tailleTexte + 2) + 3 : 0;

  const boiteW = Math.max(imgW, largeurTextes);
  const boiteH = (imgPng ? imgH : 0) + hauteurTextes;
  if (boiteW <= 0 || boiteH <= 0) return null;

  const W = boiteW * ECHELLE_SURFACE_TAMPON;
  const H = boiteH * ECHELLE_SURFACE_TAMPON;
  const parties = [];
  if (imgPng) {
    const xImg = ((boiteW - imgW) / 2) * ECHELLE_SURFACE_TAMPON;
    parties.push(
      '<image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,' +
      imgPng.toString("base64") +
      '" x="' + xImg + '" y="0" width="' + imgW * ECHELLE_SURFACE_TAMPON + '" height="' +
      imgH * ECHELLE_SURFACE_TAMPON + '" opacity="' + opacite + '" preserveAspectRatio="none"/>'
    );
  }
  let yPt = imgPng ? imgH : 0;
  lignes.forEach(function (ligne) {
    yPt += tailleTexte + 2;
    const wL = font.widthOfTextAtSize(ligne, tailleTexte);
    const xL = Math.max(0, (boiteW - wL) / 2) * ECHELLE_SURFACE_TAMPON;
    parties.push(
      '<text x="' + xL + '" y="' + (yPt * ECHELLE_SURFACE_TAMPON - 2 * ECHELLE_SURFACE_TAMPON) +
      '" font-family="' + FONT_SVG_TAMPON + '" font-size="' + tailleTexte * ECHELLE_SURFACE_TAMPON +
      '" fill="#333333">' + echapperXmlTampon(ligne) + "</text>"
    );
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + " " + H + '">' + parties.join("") + "</svg>";
  const png = await rasteriserSvgTampon(svg);
  if (!png) return null;
  // (NOUVEAU 0.2.54) rotation HORAIRE du bloc signature ENTIER (image +
  // textes) — cuite dans le PNG ; wPt/hPt = boîte englobante.
  const angleSig = angleNormaliseeTampon(cfg.sigRotation);
  const bbSig = boiteTourneeTampon(boiteW, boiteH, angleSig);
  const pngT = await tournerSurfacePngTampon(png, angleSig);
  return { png: pngT, wPt: bbSig.w, hPt: bbSig.h };
}

/** Surface de la mention (texte centré 7,5 pt comme le PDF). */
async function surfaceMentionTampon(cfg) {
  const brute = texteWinAnsiTampon(
    String(cfg.mentionTexte || "").replace(/\{DATE\}/g, dateFrTampon(new Date()))
  ).trim();
  if (!brute) return null;
  const m = brute.length > 110 ? brute.slice(0, 110) : brute;
  const font = await helveticaTampon();
  const taille = 7.5;
  const wM = font.widthOfTextAtSize(m, taille);
  const wPt = wM + 4;
  const hPt = 12;
  const W = wPt * ECHELLE_SURFACE_TAMPON;
  const H = hPt * ECHELLE_SURFACE_TAMPON;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + " " + H + '">' +
    '<text x="' + W / 2 + '" y="' + 8.5 * ECHELLE_SURFACE_TAMPON + '" text-anchor="middle" font-family="' +
    FONT_SVG_TAMPON + '" font-size="' + taille * ECHELLE_SURFACE_TAMPON + '" fill="#595959">' +
    echapperXmlTampon(m) + "</text></svg>";
  const png = await rasteriserSvgTampon(svg);
  if (!png) return null;
  return { png: png, wPt: wPt, hPt: hPt };
}

/**
 * (NOUVEAU v0.2.88) Surface du bloc certificat (texte multi-lignes centré,
 * 6,5 pt comme le PDF) — jumelle EXACTE de surfaceCertificat() de stamp.ts,
 * dessinée AU-DESSUS de la mention quand les deux existent.
 */
async function surfaceCertificatTampon(cfg) {
  const lignes = lignesCertificatTampon(cfg).map(function (l) { return texteWinAnsiTampon(l); });
  if (!lignes.length) return null;
  const font = await helveticaTampon();
  // (MODIFIÉ v0.2.92) échelle du bloc (certTaille 50 → 300 %, défaut 100).
  const echelleCert = echelleCertificatTampon(cfg);
  const taille = 6.5 * echelleCert;
  const pas = 9 * echelleCert;
  let wPt = 0;
  lignes.forEach(function (l) {
    wPt = Math.max(wPt, font.widthOfTextAtSize(l, taille));
  });
  wPt += 4;
  const hPt = lignes.length * pas + 4;
  const W = wPt * ECHELLE_SURFACE_TAMPON;
  const H = hPt * ECHELLE_SURFACE_TAMPON;
  const parties = [];
  let yPt = pas; // première ligne (SVG mesure depuis le HAUT)
  lignes.forEach(function (ligne) {
    parties.push(
      '<text x="' + W / 2 + '" y="' + yPt * ECHELLE_SURFACE_TAMPON +
      '" text-anchor="middle" font-family="' + FONT_SVG_TAMPON + '" font-size="' +
      taille * ECHELLE_SURFACE_TAMPON + '" fill="#4d4d4d">' + echapperXmlTampon(ligne) + "</text>"
    );
    yPt += pas;
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + " " + H + '">' + parties.join("") + "</svg>";
  const png = await rasteriserSvgTampon(svg);
  if (!png) return null;
  return { png: png, wPt: wPt, hPt: hPt };
}

async function preparerSurfacesTampon(rec, cfg) {
  const sur = { qr: null, sig: null, mention: null, cert: null };
  if (cfg.qrActif) sur.qr = await surfaceQrTampon(rec, cfg);
  if (cfg.sigActif) sur.sig = await surfaceSignatureTampon(cfg);
  if (cfg.mentionActif) sur.mention = await surfaceMentionTampon(cfg);
  // (NOUVEAU v0.2.88) bloc certificat — Switch certActif ON + certificat importé.
  if (certificatAffichableTampon(cfg)) sur.cert = await surfaceCertificatTampon(cfg);
  return sur;
}

/** Boîtes en points (y = bas-up comme le PDF) — mêmes règles que le PDF. */
function boitesTamponTampon(pageW, pageH, cfg, sur) {
  let boiteQr = null;
  if (sur.qr) {
    const pos = coinVersBoiteTampon(cfg.qrPosition, pageW, pageH, sur.qr.wPt, sur.qr.hPt, cfg.mentionActif, cfg.qrDecalX, cfg.qrDecalY);
    boiteQr = { x: pos.x, y: pos.y, w: sur.qr.wPt, h: sur.qr.hPt };
  }
  let boiteSig = null;
  if (sur.sig) {
    const pos = coinVersBoiteTampon(cfg.sigPosition, pageW, pageH, sur.sig.wPt, sur.sig.hPt, cfg.mentionActif, cfg.sigDecalX, cfg.sigDecalY);
    boiteSig = { x: pos.x, y: pos.y, w: sur.sig.wPt, h: sur.sig.hPt };
    if (chevaucheTampon(boiteSig, boiteQr) && boiteQr) {
      const aDroite = cfg.sigPosition.slice(-6) === "DROITE";
      boiteSig.x = aDroite
        ? boiteQr.x - ECART_ELEMENTS_TAMPON - boiteSig.w
        : boiteQr.x + boiteQr.w + ECART_ELEMENTS_TAMPON;
    }
  }
  return { qr: boiteQr, sig: boiteSig };
}

/** Compose les surfaces SUR LES PIXELS de la fiche image (1 px = 1 pt). */
async function tamponnerFicheImageTampon(donnees, rec, cfg) {
  if (!cfg || !cfg.actif) return donnees;
  if (!cfg.sigActif && !cfg.qrActif && !cfg.mentionActif) return donnees;
  const sharp = chargeSharpTampon();
  if (!sharp) {
    console.warn("[PORTAIL] sharp indisponible — image servie sans tampon");
    return donnees;
  }
  try {
    const base = sharp(donnees, { failOn: "none" }).rotate(); // EXIF appliqué
    const meta = await base.metadata();
    if (!meta.width || !meta.height) return donnees;
    const W = meta.width;
    const H = meta.height; // 1 px = 1 pt
    const sur = await preparerSurfacesTampon(rec, cfg);
    const boites = boitesTamponTampon(W, H, cfg, sur);

    const calques = [];
    if (sur.qr && boites.qr) {
      calques.push({
        input: await sharp(sur.qr.png)
          .resize(Math.max(1, Math.round(boites.qr.w)), Math.max(1, Math.round(boites.qr.h)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(boites.qr.x)),
        top: Math.max(0, Math.round(H - boites.qr.y - boites.qr.h)),
      });
    }
    if (sur.sig && boites.sig) {
      calques.push({
        input: await sharp(sur.sig.png)
          .resize(Math.max(1, Math.round(boites.sig.w)), Math.max(1, Math.round(boites.sig.h)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(boites.sig.x)),
        top: Math.max(0, Math.round(H - boites.sig.y - boites.sig.h)),
      });
    }
    if (sur.mention) {
      calques.push({
        input: await sharp(sur.mention.png)
          .resize(Math.max(1, Math.round(sur.mention.wPt)), Math.max(1, Math.round(sur.mention.hPt)))
          .png().toBuffer(),
        left: Math.max(0, Math.round((W - sur.mention.wPt) / 2)),
        top: Math.max(0, Math.round(H - sur.mention.hPt - 6)),
      });
    }
    // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE
    // (jumelle stamp.ts) — BAS_CENTRE (défaut) = rendu historique exact ;
    // 4 coins + décalages certDecalX/Y pour le placement libre.
    if (sur.cert) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posCert = certVersBoiteTampon(
        cfg.certPosition,
        W,
        H,
        sur.cert.wPt,
        sur.cert.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.certDecalX,
        cfg.certDecalY
      );
      calques.push({
        input: await sharp(sur.cert.png)
          .resize(Math.max(1, Math.round(sur.cert.wPt)), Math.max(1, Math.round(sur.cert.hPt)))
          .png().toBuffer(),
        left: Math.max(0, Math.round(posCert.x)),
        top: Math.max(0, Math.round(H - posCert.y - sur.cert.hPt)),
      });
    }
    if (!calques.length) return donnees;
    const sortie = base.composite(calques);
    return meta.format === "jpeg"
      ? await sortie.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      : await sortie.png().toBuffer();
  } catch (e) {
    console.error("[PORTAIL] Tampon image impossible:", e && e.message ? e.message : e);
    return donnees;
  }
}

/** Paragraphe porteur d'une image ANCRÉE À LA PAGE (OOXML autonome). */
function ancreDocxTampon(docPrId, rId, nom, xPt, yPt, wPt, hPt) {
  const cx = Math.round(wPt * EMU_PAR_PT_TAMPON);
  const cy = Math.round(hPt * EMU_PAR_PT_TAMPON);
  const x = Math.round(Math.max(0, xPt) * EMU_PAR_PT_TAMPON);
  const y = Math.round(Math.max(0, yPt) * EMU_PAR_PT_TAMPON);
  return (
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>' +
    '<wp:anchor xmlns:wp="' + NS_WP_TAMPON + '" distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="' + (251658240 + (docPrId % 1000)) + '" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>' + x + "</wp:posOffset></wp:positionH>" +
    '<wp:positionV relativeFrom="page"><wp:posOffset>' + y + "</wp:posOffset></wp:positionV>" +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="' + docPrId + '" name="' + echapperXmlTampon(nom) + '"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic xmlns:a="' + NS_A_TAMPON + '"><a:graphicData uri="' + NS_PIC_TAMPON + '">' +
    '<pic:pic xmlns:pic="' + NS_PIC_TAMPON + '">' +
    '<pic:nvPicPr><pic:cNvPr id="' + docPrId + '" name="' + echapperXmlTampon(nom) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip xmlns:r="' + NS_R_TAMPON + '" r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    "</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>"
  );
}

/** Word .docx : images ancrées aux coins de la page (archive enrichie). */
async function tamponnerFicheDocxTampon(donnees, rec, cfg) {
  if (!cfg || !cfg.actif) return donnees;
  if (!cfg.sigActif && !cfg.qrActif && !cfg.mentionActif) return donnees;
  const JSZip = chargeJszipTampon();
  if (!JSZip) return donnees;
  try {
    const zip = await JSZip.loadAsync(donnees);
    const docFile = zip.file("word/document.xml");
    const relsFile = zip.file("word/_rels/document.xml.rels");
    const typesFile = zip.file("[Content_Types].xml");
    if (!docFile || !relsFile || !typesFile) return donnees;
    const xml = await docFile.async("string");
    let rels = await relsFile.async("string");
    let types = await typesFile.async("string");
    if (xml.indexOf("</w:body>") < 0) return donnees;

    // Taille de page (twips → points ; A4 par défaut)
    let W = 595, H = 842;
    const pg = xml.match(/<w:pgSz[^>]*>/);
    if (pg) {
      const mw = /w:w="(\d+)"/.exec(pg[0]);
      const mh = /w:h="(\d+)"/.exec(pg[0]);
      if (mw) W = parseInt(mw[1], 10) / 20;
      if (mh) H = parseInt(mh[1], 10) / 20;
    }

    const sur = await preparerSurfacesTampon(rec, cfg);
    if (!sur.qr && !sur.sig && !sur.mention && !sur.cert) return donnees;
    const boites = boitesTamponTampon(W, H, cfg, sur);

    let maxRid = 0;
    let m;
    const reRid = /Id="rId(\d+)"/g;
    while ((m = reRid.exec(rels)) !== null) maxRid = Math.max(maxRid, parseInt(m[1], 10));
    let docPr = 99001;
    const reDocPr = /<wp:docPr id="(\d+)"/g;
    while ((m = reDocPr.exec(xml)) !== null) docPr = Math.max(docPr, parseInt(m[1], 10) + 1);

    const paragraphes = [];
    const relsPush = function (cible) {
      maxRid += 1;
      const rId = "rId" + maxRid;
      rels = rels.replace(/<\/Relationships>/,
        '<Relationship Id="' + rId + '" Type="' + REL_IMAGE_TAMPON + '" Target="' + cible + '"/></Relationships>');
      return rId;
    };

    if (sur.qr && boites.qr) {
      zip.file("word/media/tampon-qr.png", sur.qr.png);
      // OOXML : posOffset positionV se mesure depuis le HAUT de la page
      // (boîtes en coordonnées PDF = depuis le BAS) → conversion.
      paragraphes.push(ancreDocxTampon(docPr++, relsPush("media/tampon-qr.png"), "TamponQR", boites.qr.x, H - boites.qr.y - boites.qr.h, boites.qr.w, boites.qr.h));
    }
    if (sur.sig && boites.sig) {
      zip.file("word/media/tampon-sig.png", sur.sig.png);
      paragraphes.push(ancreDocxTampon(docPr++, relsPush("media/tampon-sig.png"), "TamponSignature", boites.sig.x, H - boites.sig.y - boites.sig.h, boites.sig.w, boites.sig.h));
    }
    if (sur.mention) {
      zip.file("word/media/tampon-mention.png", sur.mention.png);
      paragraphes.push(ancreDocxTampon(docPr++, relsPush("media/tampon-mention.png"), "TamponMention", (W - sur.mention.wPt) / 2, H - 6 - sur.mention.hPt, sur.mention.wPt, sur.mention.hPt));
    }
    // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE
    // (jumelle stamp.ts) — BAS_CENTRE (défaut) = rendu historique exact ;
    // 4 coins + décalages certDecalX/Y pour le placement libre.
    if (sur.cert) {
      const decalMention = sur.mention ? sur.mention.hPt : 0;
      const posCert = certVersBoiteTampon(
        cfg.certPosition,
        W,
        H,
        sur.cert.wPt,
        sur.cert.hPt,
        Boolean(sur.mention),
        6 + decalMention,
        cfg.certDecalX,
        cfg.certDecalY
      );
      zip.file("word/media/tampon-certificat.png", sur.cert.png);
      paragraphes.push(ancreDocxTampon(docPr++, relsPush("media/tampon-certificat.png"), "TamponCertificat", posCert.x, H - posCert.y - sur.cert.hPt, sur.cert.wPt, sur.cert.hPt));
    }
    if (!paragraphes.length) return donnees;

    if (!/Extension="png"/.test(types)) {
      types = types.replace(/<\/Types>/, '<Default Extension="png" ContentType="image/png"/></Types>');
    }

    // Insertion AVANT le sectPr FINAL du corps (jamais après)
    const idxBody = xml.lastIndexOf("</w:body>");
    let insertion = idxBody;
    const idxSect = xml.lastIndexOf("<w:sectPr");
    if (idxSect >= 0 && idxSect < idxBody) {
      const queue = xml.slice(idxSect, idxBody);
      if (/^<w:sectPr[\s\S]*<\/w:sectPr>\s*$/.test(queue)) insertion = idxSect;
    }
    zip.file("word/document.xml", xml.slice(0, insertion) + paragraphes.join("") + xml.slice(insertion));
    zip.file("word/_rels/document.xml.rels", rels);
    zip.file("[Content_Types].xml", types);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (e) {
    console.error("[PORTAIL] Tampon DOCX impossible:", e && e.message ? e.message : e);
    return donnees;
  }
}

function colonneVersIndexTampon(lettres) {
  let n = 0;
  for (let i = 0; i < lettres.length; i++) n = n * 26 + (lettres.charCodeAt(i) - 64);
  return n;
}

/** Excel .xlsx/.xlsm : ancrage absolu à droite de la plage utilisée. */
async function tamponnerFicheXlsxTampon(donnees, rec, cfg) {
  if (!cfg || !cfg.actif) return donnees;
  if (!cfg.sigActif && !cfg.qrActif && !cfg.mentionActif) return donnees;
  const JSZip = chargeJszipTampon();
  if (!JSZip) return donnees;
  try {
    const zip = await JSZip.loadAsync(donnees);
    if (!zip.file("xl/workbook.xml")) return donnees;
    const sur = await preparerSurfacesTampon(rec, cfg);
    if (!sur.qr && !sur.sig && !sur.mention && !sur.cert) return donnees;

    if (sur.qr) zip.file("xl/media/tampon-qr.png", sur.qr.png);
    if (sur.sig) zip.file("xl/media/tampon-sig.png", sur.sig.png);
    if (sur.mention) zip.file("xl/media/tampon-mention.png", sur.mention.png);
    if (sur.cert) zip.file("xl/media/tampon-certificat.png", sur.cert.png);

    let types = (await zip.file("[Content_Types].xml").async("string")) || "";
    if (!types) return donnees;
    if (!/Extension="png"/.test(types)) {
      types = types.replace(/<\/Types>/, '<Default Extension="png" ContentType="image/png"/></Types>');
    }

    const feuilles = Object.keys(zip.files)
      .filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort();
    const elementsApres = ["legacyDrawing", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"];
    let dessinsAjoutes = 0;

    for (const chemin of feuilles.slice(0, 20)) {
      const xml = await zip.file(chemin).async("string");
      if (!xml || xml.indexOf("<drawing ") >= 0) continue; // dessin existant : intact

      // Plage utilisée → boîte de contenu (px ; 1 px ≈ 1 pt pour la géométrie)
      let dernierCol = 10, dernierLig = 30;
      const dim = xml.match(/<dimension[^>]*ref="([^"]*)"/);
      if (dim && dim[1].indexOf(":") >= 0) {
        const fin = dim[1].split(":")[1];
        const lettres = fin.match(/^[A-Z]+/);
        const chiffres = fin.match(/\d+$/);
        if (lettres) dernierCol = colonneVersIndexTampon(lettres[0]);
        if (chiffres) dernierLig = parseInt(chiffres[0], 10);
      }
      const largeurs = {};
      let mm;
      const reCol = /<col\b[^>]*>/g;
      while ((mm = reCol.exec(xml)) !== null) {
        const tag = mm[0];
        const min = Number((/min="(\d+)"/.exec(tag) || [0, 0])[1]);
        const max = Number((/max="(\d+)"/.exec(tag) || [0, 0])[1]);
        const wAttr = /width="([\d.]+)"/.exec(tag);
        if (min > 0 && max >= min && wAttr) {
          const px = Math.round(parseFloat(wAttr[1]) * 7) + 5;
          for (let c = min; c <= Math.min(max, min + 199); c++) largeurs[c] = px;
        }
      }
      let bordDroitPx = 0;
      for (let c = 1; c <= dernierCol; c++) bordDroitPx += largeurs[c] || 64;
      const basPx = dernierLig * 20; // hauteur de ligne par défaut ≈ 20 px

      // Coins du tampon = coins de la PLAGE UTILISÉE (mêmes règles que le
      // PDF : coin + décalage borné + écart) — le tampon reste ainsi DANS la
      // zone imprimable, comme un vrai cachet apposé sur le tableau.
      const boites = boitesTamponTampon(bordDroitPx, basPx, cfg, sur);

      // Style openpyxl (VALIDÉ LibreOffice + Excel) : espace de noms PAR
      // DÉFAUT (éléments non préfixés), a:/r: déclarés en ligne, ancrage
      // oneCellAnchor, cibles de relations absolues.
      const ancres = [];
      const relsDessin = [];
      let idMedia = 0;
      const celluleDepuisPx = function (xPx) {
        let cumule = 0;
        for (let c = 1; c <= 600; c++) {
          const l = largeurs[c] || 64;
          if (xPx < cumule + l) return { col: c - 1, offPx: xPx - cumule };
          cumule += l;
        }
        return { col: 599, offPx: 0 };
      };
      const calque = function (surface, nom, xPx, yPx) {
        idMedia += 1;
        const rId = "rId" + idMedia;
        const cell = celluleDepuisPx(Math.max(0, xPx));
        const yPos = Math.max(0, yPx);
        const lig = Math.floor(yPos / 20);
        const cx = Math.round(surface.wPt * EMU_PAR_PX_TAMPON);
        const cy = Math.round(surface.hPt * EMU_PAR_PX_TAMPON);
        relsDessin.push('<Relationship Type="' + REL_IMAGE_TAMPON + '" Target="/xl/media/' + nom + '" Id="' + rId + '"/>');
        ancres.push(
          '<oneCellAnchor><from><col>' + cell.col + '</col><colOff>' + Math.round(cell.offPx * EMU_PAR_PX_TAMPON) + '</colOff>' +
          '<row>' + lig + '</row><rowOff>' + Math.round((yPos - lig * 20) * EMU_PAR_PX_TAMPON) + '</rowOff></from>' +
          '<ext cx="' + cx + '" cy="' + cy + '"/>' +
          '<pic><nvPicPr><cNvPr id="' + idMedia + '" name="' + nom + '"/><cNvPicPr/></nvPicPr>' +
          '<blipFill><a:blip xmlns:a="' + NS_A_TAMPON + '" xmlns:r="' + NS_R_TAMPON + '" cstate="print" r:embed="' + rId + '"/>' +
          '<a:stretch xmlns:a="' + NS_A_TAMPON + '"><a:fillRect/></a:stretch></blipFill>' +
          '<spPr><a:prstGeom xmlns:a="' + NS_A_TAMPON + '" prst="rect"/></spPr></pic>' +
          '<clientData/></oneCellAnchor>'
        );
      };
      // NB : boitesTamponTampon renvoie des y « bas-up » (convention PDF) —
      // la feuille se mesure depuis le HAUT : conversion yTop = H − y − h.
      if (sur.qr && boites.qr) calque(sur.qr, "tampon-qr.png", boites.qr.x, basPx - boites.qr.y - boites.qr.h);
      if (sur.sig && boites.sig) calque(sur.sig, "tampon-sig.png", boites.sig.x, basPx - boites.sig.y - boites.sig.h);
      if (sur.mention) {
        const xM = Math.max(0, (bordDroitPx - sur.mention.wPt) / 2);
        const yM = Math.max(0, basPx - sur.mention.hPt - 4);
        calque(sur.mention, "tampon-mention.png", xM, yM);
      }
      // (NOUVEAU v0.2.88 ; MODIFIÉ v0.2.92) bloc certificat POSITIONNABLE
      // (jumelle stamp.ts) — BAS_CENTRE (défaut) = rendu historique exact ;
      // 4 coins + décalages certDecalX/Y pour le placement libre.
      if (sur.cert) {
        const decalMention = sur.mention ? sur.mention.hPt : 0;
        const posCert = certVersBoiteTampon(
          cfg.certPosition,
          bordDroitPx,
          basPx,
          sur.cert.wPt,
          sur.cert.hPt,
          Boolean(sur.mention),
          4 + decalMention,
          cfg.certDecalX,
          cfg.certDecalY
        );
        calque(sur.cert, "tampon-certificat.png", posCert.x, basPx - posCert.y - sur.cert.hPt);
      }
      if (!ancres.length) continue;

      const numFeuille = (chemin.match(/sheet(\d+)\.xml/) || [0, String(dessinsAjoutes + 1)])[1];
      const nomDessin = "tampon-feuille-" + numFeuille + ".xml";
      zip.file("xl/drawings/" + nomDessin,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<wsDr xmlns="' + NS_XDR_TAMPON + '">' +
        ancres.join("") + "</wsDr>");
      zip.file("xl/drawings/_rels/" + nomDessin + ".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        relsDessin.join("") + "</Relationships>");
      types = types.replace(/<\/Types>/,
        '<Override PartName="/xl/drawings/' + nomDessin + '" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');

      const cheminRels = "xl/worksheets/_rels/sheet" + numFeuille + ".xml.rels";
      let rIdFeuille = "rId1";
      const relsFeuilleExistante = await zip.file(cheminRels) ? await zip.file(cheminRels).async("string") : null;
      if (relsFeuilleExistante) {
        let maxR = 0;
        const reR = /Id="rId(\d+)"/g;
        while ((mm = reR.exec(relsFeuilleExistante)) !== null) maxR = Math.max(maxR, parseInt(mm[1], 10));
        rIdFeuille = "rId" + (maxR + 1);
        zip.file(cheminRels, relsFeuilleExistante.replace(/<\/Relationships>/,
          '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/' + nomDessin + '" Id="' + rIdFeuille + '"/></Relationships>'));
      } else {
        zip.file(cheminRels,
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/' + nomDessin + '" Id="' + rIdFeuille + '"/>' +
          "</Relationships>");
      }

      // <drawing r:id="…"/> juste avant le premier élément qui DOIT le suivre
      // (l'élément déclare son propre xmlns:r : aucune retouche de la racine)
      let idxIns = xml.lastIndexOf("</worksheet>");
      for (const balise of elementsApres) {
        const i = xml.indexOf("<" + balise);
        if (i >= 0 && i < idxIns) idxIns = i;
      }
      zip.file(chemin, xml.slice(0, idxIns) + '<drawing xmlns:r="' + NS_R_TAMPON + '" r:id="' + rIdFeuille + '"/>' + xml.slice(idxIns));
      dessinsAjoutes += 1;
    }
    if (!dessinsAjoutes) return donnees;
    zip.file("[Content_Types].xml", types);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (e) {
    console.error("[PORTAIL] Tampon XLSX impossible:", e && e.message ? e.message : e);
    return donnees;
  }
}

/** Type tamponnable (null = servi tel quel, ex. .xls binaire). */
function typeFichierTamporableTampon(contentType) {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/png" || contentType === "image/jpeg") return "image";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      contentType === "application/vnd.ms-excel.sheet.macroEnabled.12") return "xlsx";
  return null;
}

/** Répartiteur par type — mêmes moteurs que src/lib/stamp.ts. */
async function tamponnerFicheDossierTampon(donnees, rec, cfg, type) {
  if (type === "pdf") return tamponnerFicheTampon(donnees, rec, cfg);
  if (type === "image") return tamponnerFicheImageTampon(donnees, rec, cfg);
  if (type === "docx") return tamponnerFicheDocxTampon(donnees, rec, cfg);
  if (type === "xlsx") return tamponnerFicheXlsxTampon(donnees, rec, cfg);
  return donnees;
}

/** Lit la configuration du tampon (null = absent/inactive/ancienne base). */
async function lireConfigTampon() {
  try {
    const cfg = await prisma.signatureConfig.findUnique({ where: { id: "signature" } });
    if (!cfg || !cfg.actif) return null;
    // (MODIFIÉ v0.2.88) le certificat de signature (Switch certActif ON +
    // certificat importé) compte lui aussi comme élément du tampon — jumelle
    // de tamponActif() de stamp.ts.
    if (!cfg.sigActif && !cfg.qrActif && !cfg.mentionActif && !certificatAffichableTampon(cfg)) return null;
    return cfg;
  } catch (e) {
    // table pas encore créée (base non migrée) : tampon silencieusement absent
    return null;
  }
}

// ============================================================================
// (NOUVEAU v0.2.119) — CACHET « SIGNATURE ÉLECTRONIQUE » DU TAMPON : CHOIX
// ARCHITECTURAL DU PORTAIL
// ============================================================================
// Le Switch elecActif (colonnes elec* de SignatureConfig) alimente le cachet
// ENCADRÉ « SIGNATURE ÉLECTRONIQUE » dessiné par stamp.ts (les 4 moteurs) —
// il est TOUJOURS suivi de la signature PAdES sur les mêmes octets
// (completerConfigTamponAvecElec de signature-api.ts injecte les métadonnées
// du certificat du module AVANT le tamponnage ; GARANTIE : cachet ⇒ signé).
//
// LE PORTAIL EMPLOYÉ NE DESSINE JAMAIS CE CACHET, VOLONTAIREMENT :
//  - une fiche portant le cachet est le produit de la chaîne ADMIN
//    (tampon + signature → copie signée CONSERVÉE) : le portail sert cette
//    copie signée telle quelle (trouverCopieSignee, v0.2.118) — le cachet
//    y est déjà, couvert par la signature ;
//  - en repli (aucune copie signée : module inactif ou échec), le portail
//    retamponne avec SA jumelle (sig/QR/mention/certificat ci-dessus) mais
//    SANS cachet elec : un document non signé ne doit jamais porter le
//    cachet « Signature électronique » ;
//  - elecActif n'est donc PAS compté ici dans l'élément actif du tampon
//    (certificatAffichableTampon exige cfg.certSujet/certEmpreinte, jamais
//    les champs elec) — aucune autre modification nécessaire.
// ============================================================================


/** Journal d'envoi — MÊME fichier que l'administration (format identique). */
function journaliserEnvoiDemandes(e) {
  try {
    const dossier = path.join(ROOT, "logs");
    fs.mkdirSync(dossier, { recursive: true });
    const ligne = JSON.stringify(Object.assign({ horodatage: new Date().toISOString() }, e)) + "\n";
    fs.appendFileSync(path.join(dossier, "journal-emails.log"), ligne, "utf8");
  } catch (err) {
    // journal indisponible : jamais bloquant
  }
}

/** Référence lisible unique : DEM-<année>-<numéro sur 5 chiffres>. */
async function genererReferenceDemande() {
  const annee = new Date().getFullYear();
  let n = (await prisma.demandeAdministrative.count()) + 1;
  for (let i = 0; i < 10000; i++) {
    const ref = "DEM-" + annee + "-" + String(n).padStart(5, "0");
    const existe = await prisma.demandeAdministrative.findUnique({
      where: { reference: ref },
      select: { id: true },
    });
    if (!existe) return ref;
    n++;
  }
  return "DEM-" + annee + "-" + Date.now().toString(36).toUpperCase();
}

/**
 * (NOUVEAU v0.2.43) Résolution du VRAI nom de l'employé depuis les fiches de
 * paie importées — jumelle de nomEmployeDepuisFiches() de src/lib/demandes.ts.
 * La fiche la plus RÉCENTE dont le CIN correspond (champ cin détecté en
 * égalité indexée cinIndex, ou numéro présent DANS LE CONTENU via les jetons
 * indexés PayslipCinToken) fournit son employeeName (déchiffré). Retourne
 * "" si aucun nom trouvé : l'appelant garde alors le libellé générique
 * « Employé (CIN •••123) ». JAMAIS bloquant (erreur base/déchiffrement → "").
 */
async function nomEmployeDepuisFiches(cin) {
  try {
    const q = normalizeText(cin || "");
    if (!q) return "";
    const idx = cryptoBd.chiffrerChamp(q, true);
    if (!idx) return "";
    // 1) fiches dont le champ cin détecté correspond (égalité SQL indexée).
    //    (MODIFIÉ v0.2.50) la référence est le nom le plus FRÉQUENT parmi
    //    les 8 fiches les plus récentes (à égalité : la plus récente) —
    //    MÊME RÈGLE que la détection d'anomalies à l'import : une fiche
    //    récente mal orthographiée ou sans nom ne devient JAMAIS la référence.
    const candidates = await prisma.payslip.findMany({
      where: { cinIndex: idx },
      orderBy: { uploadedAt: "desc" },
      take: 8,
      select: { employeeName: true },
    });
    const compte = new Map();
    for (const c of candidates) {
      const d = cryptoBd.dechiffrerObjet("Payslip", c);
      const nom = String((d && d.employeeName) || "").trim();
      if (!nom) continue;
      const cle = formeLettresNom(nom);
      if (!cle) continue;
      const ex = compte.get(cle);
      if (ex) ex.n += 1;
      else compte.set(cle, { n: 1, nom: nom });
    }
    let meilleure = null;
    for (const v of compte.values()) {
      if (!meilleure || v.n > meilleure.n) meilleure = v;
    }
    if (meilleure) return meilleure.nom;
    // 2) repli : numéro présent DANS LE CONTENU (jetons indexés)
    const jetons = await prisma.payslipCinToken.findMany({
      where: { token: idx },
      orderBy: { payslip: { uploadedAt: "desc" } },
      take: 8,
      select: { payslip: { select: { employeeName: true } } },
    });
    const compteJ = new Map();
    for (const j of jetons) {
      if (j && j.payslip && j.payslip.employeeName) {
        const d = cryptoBd.dechiffrerObjet("Payslip", j.payslip);
        const nom = String((d && d.employeeName) || "").trim();
        if (!nom) continue;
        const cle = formeLettresNom(nom);
        if (!cle) continue;
        const ex = compteJ.get(cle);
        if (ex) ex.n += 1;
        else compteJ.set(cle, { n: 1, nom: nom });
      }
    }
    let meilleureJ = null;
    for (const v of compteJ.values()) {
      if (!meilleureJ || v.n > meilleureJ.n) meilleureJ = v;
    }
    return meilleureJ ? meilleureJ.nom : "";
  } catch (e) {
    return ""; // jamais bloquant — repli libellé générique
  }
}

/**
 * (NOUVEAU v0.2.107 — demande utilisateur) MATRICULE DE L'EMPLOYÉ pour les
 * e-mails de demandes : valeur manuelle posée par le RH sur l'accès portail
 * (PortalAccess.matricule — colonne « Matricule » du Portail Administration,
 * PRIORITAIRE), sinon matricule de la fiche de paie la PLUS RÉCENTE du même
 * CIN qui en porte un (recherche indexée cinIndex — même mécanisme que
 * nomEmployeDepuisFiches). `acc` = accès portail DÉJÀ CHARGÉ si disponible
 * (création de demande) — sinon il est chargé ici (une requête indexée).
 * JAMAIS bloquant : retourne "" si aucun matricule — la ligne « Matricule »
 * est alors simplement omise dans les e-mails.
 */
async function matriculeEmployeDemandes(cin, acc) {
  try {
    const q = normalizeText(cin || "");
    if (!q) return "";
    const idx = cryptoBd.chiffrerChamp(q, true);
    if (!idx) return "";
    let acces = acc || null;
    if (!acces) {
      acces = await prisma.portalAccess.findUnique({ where: { cin: idx } });
    }
    if (acces && acces.matricule) {
      const m = String(cryptoBd.dechiffrerChamp(acces.matricule) || "").trim();
      if (m) return m;
    }
    const candidates = await prisma.payslip.findMany({
      where: { cinIndex: idx },
      orderBy: { uploadedAt: "desc" },
      take: 8,
      select: { matricule: true },
    });
    for (const c of candidates) {
      const d = cryptoBd.dechiffrerObjet("Payslip", c);
      const m = String((d && d.matricule) || "").trim();
      if (m) return m;
    }
    return "";
  } catch (e) {
    return ""; // jamais bloquant — ligne omise dans les e-mails
  }
}

// ============================================================================
//  (NOUVEAU v0.2.50 ; DÉSACTIVÉ Task 175) — DÉTECTION DES ERREURS NOM & PRÉNOM
//  JUMELLE JS de src/lib/nom-anomalies.ts (⚠ mêmes seuils, mêmes libellés).
//  (MODIFIÉ — Task 175) les formulaires de demandes ne collectent PLUS le
//  nom / prénom de l'employé (récupérés automatiquement du Portail
//  Administration) : la comparaison saisie ↔ fiches n'a plus lieu d'être à
//  la création des demandes. verifierCoherenceNomDemande() n'est PLUS
//  APPELÉE — les fonctions ci-dessous sont conservées pour référence
//  (jumelle d'alignement) ; formeLettresNom() reste utilisée par la règle de
//  fréquence de nomEmployeDepuisFiches(). Les demandes ANTÉRIEURES peuvent
//  toujours afficher leur donnees.anomalieNom historique.
// ============================================================================

/** Forme « lettres uniquement » : majuscules sans accents, séparateurs retirés. */
function formeLettresNom(s) {
  return String(s == null ? "" : s)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z]/g, "");
}

/** Jetons du nom (majuscules sans accents, découpés sur tout séparateur). */
function jetonsNomDemande(s) {
  return String(s == null ? "" : s)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/** Distance de Levenshtein (faute de frappe probable). */
function distanceLevenshteinNom(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let precedent = new Array(b.length + 1);
  let courant = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) precedent[j] = j;
  for (let i = 1; i <= a.length; i++) {
    courant[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courant[j] = Math.min(precedent[j] + 1, courant[j - 1] + 1, precedent[j - 1] + cout);
    }
    const echange = precedent;
    precedent = courant;
    courant = echange;
  }
  return precedent[b.length];
}

/** Seuil « faute de frappe probable » (identique à nom-anomalies.ts). */
function seuilLevenshteinNom(a, b) {
  const n = Math.min(a.length, b.length);
  if (n <= 0) return 0;
  if (n <= 8) return 1;
  if (n <= 14) return 2;
  return 3;
}

/**
 * Appariement par JETONS TRIÉS : une seule paire qui diffère (distance ≤
 * seuil), toutes les autres identiques → faute de frappe localisée.
 * Indispensable pour comparer « PRÉNOM NOM » (formulaire) à « NOM PRÉNOM »
 * (fiche Sage) : la rotation fausse la distance au niveau des lettres.
 * (Jumelle de prochesParJetons(), src/lib/nom-anomalies.ts.)
 */
function prochesParJetonsNom(a, b) {
  if (a.length !== b.length || a.length === 0) return false;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  let ecarts = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] === sb[i]) continue;
    ecarts++;
    if (ecarts > 1) return false;
    if (distanceLevenshteinNom(sa[i], sb[i]) > seuilLevenshteinNom(sa[i], sb[i])) return false;
  }
  return ecarts === 1;
}

/** Contrôles de format d'un champ unique (chiffres / longueur). */
function anomaliesFormatChampDemande(v) {
  const brut = String(v == null ? "" : v).trim();
  if (!brut) return [];
  if (/\d/.test(brut)) {
    return ["Le champ « " + brut + " » contient des chiffres — vérifiez la saisie."];
  }
  if (formeLettresNom(brut).length < 2) {
    return ["Le champ « " + brut + " » est trop court — vérifiez la saisie."];
  }
  return [];
}

/**
 * Vérifie la cohérence du nom / prénom saisis dans une demande avec le nom
 * trouvé sur les fiches de paie du même CIN. Renvoie le TEXTE de l'anomalie
 * (ou null = cohérent, ou aucune fiche de référence). Le même ensemble de
 * jetons est cohérent QUEL QUE SOIT l'ordre (formulaire « Prénom + Nom »
 * contre fiche Sage « NOM PRENOM ») — seuls les vrais écarts sont signalés.
 */
function verifierCoherenceNomDemande(nom, prenom, nomFiches) {
  const reference = String(nomFiches == null ? "" : nomFiches).trim();
  const nomPropre = String(nom == null ? "" : nom).trim();
  const prenomPropre = String(prenom == null ? "" : prenom).trim();
  if (!reference || (!nomPropre && !prenomPropre)) return null;
  const saisi = (prenomPropre + " " + nomPropre).trim();
  // Contrôles de format des champs eux-mêmes (chiffres, longueur).
  const format = anomaliesFormatChampDemande(nomPropre).concat(
    anomaliesFormatChampDemande(prenomPropre)
  );
  // Un seul mot au TOTAL = nom ou prénom manquant.
  if (jetonsNomDemande(saisi).length < 2) {
    format.push("Un seul mot détecté (« " + saisi + " ») : le nom ou le prénom semble manquer.");
  }
  // Comparaison à la référence (fiches de paie).
  let ecart = null;
  const la = formeLettresNom(saisi);
  const lb = formeLettresNom(reference);
  if (la !== lb) {
    const ja = jetonsNomDemande(saisi);
    const jb = jetonsNomDemande(reference);
    const memeJetons =
      ja.join(" ") && ja.slice().sort().join(" ") === jb.slice().sort().join(" ");
    if (!memeJetons) {
      if (prochesParJetonsNom(ja, jb)) {
        ecart = "Probable faute de saisie : « " + saisi + " » diffère du nom sur vos fiches de paie (« " + reference + " »).";
      } else {
        const d = distanceLevenshteinNom(la, lb);
        if (d > 0 && d <= seuilLevenshteinNom(la, lb)) {
          ecart = "Probable faute de saisie : « " + saisi + " » diffère du nom sur vos fiches de paie (« " + reference + " »).";
        } else {
          ecart = "Nom / prénom saisis (« " + saisi + " ») différents de ceux des fiches de paie (« " + reference + " »).";
        }
      }
    }
  }
  if (!ecart) return format.length ? format.join(" ") : null;
  return format.length ? format.join(" ") + " " + ecart : ecart;
}

/** Échappement HTML pour les e-mails. */
function echappeEmailDemande(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Corps TEXTE de l'e-mail de création (cahier des charges : type, nom, date, infos, statut, référence). */
function texteEmailDemandeCreation(d) {
  // (MODIFIÉ v0.2.42) les types SANS formulaire (attestations) stockent déjà
  // « Employé (CIN •••233) » dans nomEmploye — ne pas ajouter le CIN une 2e fois.
  const employe = String(d.nomEmploye).indexOf(d.cinMasque) >= 0
    ? d.nomEmploye
    : d.nomEmploye + " (CIN " + d.cinMasque + ")";
  const lignes = d.infos
    .map(function (p) { return "  " + p[0].padEnd(28, " ") + ": " + p[1]; })
    .join("\n");
  return [
    "Bonjour,",
    "",
    "Une nouvelle demande administrative nécessite votre traitement.",
    "",
    "  Référence unique           : " + d.reference,
    "  Type de demande            : " + d.typeLibelle,
    "  Employé                    : " + employe,
    // (NOUVEAU v0.2.107 — demande utilisateur) matricule de l'employé,
    // récupéré automatiquement depuis ses fiches de paie (omis si non détecté).
    d.matricule ? "  Matricule                  : " + d.matricule : null,
    d.emailEmploye ? "  E-mail employé             : " + d.emailEmploye : null,
    "  Date de la demande         : " + d.dateDemande,
    "  Statut                     : " + d.statutLabel,
    d.infos.length ? "" : null,
    d.infos.length ? "Informations de la demande :" : null,
    d.infos.length ? lignes : null,
    // (NOUVEAU — demande utilisateur, point 8 v0.2.88) congé et autorisation :
    // le MANAGER RESPONSABLE (v0.2.132 — plus de N+1 saisi) peut VALIDER en
    // répondant directement à cet e-mail.
    d.validationParReponse ? "" : null,
    d.validationParReponse
      ? "VALIDATION PAR E-MAIL : répondez directement à cet e-mail (« Répondre »)\n" +
        "en écrivant « Acceptée » pour VALIDER la demande, ou « Refusée » pour la\n" +
        "refuser. Votre réponse est rattachée automatiquement à la référence\n" +
        d.reference + " — aucune autre manipulation nécessaire. L'employé et le\n" +
        "service RH sont notifiés automatiquement après votre réponse."
      : null,
    "",
    "Merci de traiter cette demande. L'employé suit son avancement dans sa",
    "section « Demandes administratives » du portail employé.",
    "",
    "Cet e-mail a été envoyé automatiquement par AutoRH. Si vous n'êtes pas",
    "le destinataire prévu, ignorez et supprimez ce message.",
  ].filter(function (x) { return x !== null; }).join("\n");
}

/** Corps HTML de l'e-mail de création (même contenu, présentation soignée). */
function htmlEmailDemandeCreation(d) {
  const ligne = function (l, v) {
    return '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">' +
      echappeEmailDemande(l) + '</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' +
      echappeEmailDemande(v) + "</b></td></tr>";
  };
  const tds = d.infos.map(function (p) { return ligne(p[0], p[1]); }).join("");
  // (NOUVEAU v0.2.46) ligne « E-mail employé » juste sous le nom (omise si vide)
  const ligneEmailEmploye = d.emailEmploye ? ligne("E-mail employé", d.emailEmploye) : "";
  // (NOUVEAU v0.2.107 — demande utilisateur) ligne « Matricule » juste sous
  // le nom (omise si non détecté dans les fiches de paie du CIN).
  const ligneMatricule = d.matricule ? ligne("Matricule", d.matricule) : "";
  // (MODIFIÉ v0.2.42) même règle que texteEmailDemandeCreation pour le nom.
  const employe = String(d.nomEmploye).indexOf(d.cinMasque) >= 0
    ? d.nomEmploye
    : d.nomEmploye + " (CIN " + d.cinMasque + ")";
  return '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<div style="background:#10b981;padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Demande administrative — ' + echappeEmailDemande(d.typeLibelle) + "</div>" +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(d.reference) + " — AutoRH</div>" +
    "</div>" +
    '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
    '<p style="margin:0 0 14px;">Une nouvelle demande administrative nécessite votre traitement.</p>' +
    '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +
    '<table style="border-collapse:collapse;width:100%;">' +
    ligne("Référence unique", d.reference) +
    ligne("Type de demande", d.typeLibelle) +
    ligne("Employé", employe) +
    ligneMatricule +
    ligneEmailEmploye +
    ligne("Date de la demande", d.dateDemande) +
    ligne("Statut", d.statutLabel) +
    tds +
    "</table></div>" +
    // (NOUVEAU — demande utilisateur, point 8 v0.2.88) consigne de validation
    // par réponse directe (congé + autorisation uniquement).
    (d.validationParReponse
      ? '<div style="background:#ECFDF5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#065f46;font-size:13px;">' +
        "<b>VALIDATION PAR E-MAIL :</b> répondez directement à cet e-mail (« Répondre ») en écrivant " +
        "<b>« Acceptée »</b> pour VALIDER la demande, ou <b>« Refusée »</b> pour la refuser. " +
        "Votre réponse est rattachée automatiquement à la référence " + echappeEmailDemande(d.reference) +
        " — aucune autre manipulation nécessaire. L'employé et le service RH sont notifiés automatiquement après votre réponse.</div>"
      : "") +
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par AutoRH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
    "</div></div>";
}

/**
 * Envoie l'e-mail de CRÉATION au destinataire du traitement et journalise la
 * tentative (succès OU échec). Ne lève JAMAIS d'exception : retourne
 * { envoye, dest, messageId?, erreur? }.
 */
async function envoyerEmailDemandeCreation(demande, dest, cfg) {
  const contenu = {
    reference: demande.reference,
    typeLibelle: libelleTypeDemande(demande.type),
    nomEmploye: demande.nomEmploye,
    // (NOUVEAU v0.2.107 — demande utilisateur) matricule de l'employé —
    // résolu automatiquement à la création (acc.matricule sinon fiches) et
    // affiché dans l'e-mail (chaîne vide = ligne omise).
    matricule: String(demande.matricule || ""),
    // (NOUVEAU v0.2.46) ligne « E-mail employé » de l'e-mail RH (vide = omise)
    emailEmploye: String(demande.emailEmploye || ""),
    cinMasque: masquerCinDemande(demande.cin),
    dateDemande: formatDateDemande(demande.createdAt),
    statutLabel: libelleStatutDemande(demande.statut),
    infos: demande.infos,
    // (NOUVEAU — point 8 v0.2.88) consigne « VALIDATION PAR E-MAIL » (congé +
    // autorisation uniquement) incluse dans les corps texte et HTML.
    validationParReponse: demande.validationParReponse === true,
  };
  const journalBase = {
    action: "demande-creation",
    dest: dest || "",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
  };
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : la demande est enregistrée, mais AUCUN e-mail n'a pu être envoyé. Configurez le SMTP dans l'administration (onglet Accès portail).";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) en-tête système : cet e-mail REVIENT dans la boîte
      // IMAP quand le destinataire est la boîte SMTP elle-même (copies de
      // routage) — le poller ne doit JAMAIS le classer comme une réponse
      // (le corps contient le texte du FORMULAIRE : « Compensation : Non »…).
      headers: { "X-Auto-RH-Systeme": "demande-creation" },
      subject: "AutoRH — " + contenu.typeLibelle + " " + contenu.reference + " (traitement requis)",
      text: texteEmailDemandeCreation(contenu),
      html: htmlEmailDemandeCreation(contenu),
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
    }));
    return { envoye: true, messageId: info.messageId, dest: dest };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/**
 * (NOUVEAU v0.2.92 — demande utilisateur) E-MAIL DE CONFIRMATION au DEMANDEUR
 * d'une demande de parrainage : envoyé AUTOMATIQUEMENT à l'adresse e-mail de
 * notification de l'employé (PortalAccess.email — colonne « E-mail d'accès »
 * du tableau « Accès portail par mot de passe » du Portail Administration),
 * EN MÊME TEMPS que l'e-mail de traitement parti à l'adresse DÉDIÉE des
 * demandes de parrainage. JAMAIS bloquant : tout échec est journalisé.
 */
async function envoyerEmailDemandeConfirmation(demande, dest, cfg) {
  const journalBase = {
    action: "demande-creation-confirmation-demandeur",
    dest: dest || "",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
  };
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      succes: false,
      code: "MAIL_NON_CONFIGURE",
      erreur: "SMTP non configuré : confirmation au demandeur non envoyée",
    }));
    return { envoye: false };
  }
  const lignesInfos = (demande.infos || [])
    .map(function (p) { return "  - " + p[0] + " : " + p[1]; })
    .join("\n");
  // (MODIFIÉ — v0.2.94, Task 197) confirmation GÉNÉRALISÉE à tous les types :
  // le libellé du type remplace la mention « parrainage » historique.
  const libelleConf = libelleTypeDemande(demande.type);
  const texte =
    "Bonjour " + (demande.nomEmploye || "employé") + ",\n\n" +
    "Votre demande « " + libelleConf + " » " + demande.reference + " a bien été enregistrée le " +
    formatDateDemande(demande.createdAt) + ".\n\n" +
    "Elle vient d'être transmise automatiquement au service chargé de son traitement. " +
    "Vous recevrez une réponse via votre portail et votre adresse e-mail de notification.\n\n" +
    "Récapitulatif de votre demande :\n" + lignesInfos + "\n\n" +
    "Référence : " + demande.reference + "\n" +
    (demande.matricule ? "Matricule : " + demande.matricule + "\n" : "") +
    "Statut : " + libelleStatutDemande(demande.statut) + "\n\n" +
    "Vous pouvez suivre votre demande dans « Mes demandes » du portail employés.\n\n" +
    "— AutoRH (envoi automatique — NE PAS répondre)";
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">' +
    '<h2 style="color:#047857;margin-bottom:4px">AutoRH — Demande enregistrée « ' + echapperXmlTampon(libelleConf) + "</h2>" +
    '<p style="margin:0 0 12px;color:#475569">Référence <b>' + echapperXmlTampon(demande.reference) + "</b></p>" +
    (demande.matricule
      ? '<p style="margin:0 0 12px;color:#475569">Matricule : <b>' + echapperXmlTampon(demande.matricule) + "</b></p>"
      : "") +
    "<p>Bonjour " + echapperXmlTampon(demande.nomEmploye || "employé") + ",</p>" +
    "<p>Votre demande « " + echapperXmlTampon(libelleConf) + " » <b>" + echapperXmlTampon(demande.reference) + "</b> a bien été " +
    "enregistrée le " + formatDateDemande(demande.createdAt) + " et vient d'être transmise " +
    "automatiquement au service chargé de son traitement. Vous recevrez une réponse via votre " +
    "portail et votre adresse e-mail de notification.</p>" +
    ((demande.infos || []).length
      ? '<table style="border-collapse:collapse;margin:12px 0">' +
        (demande.infos || [])
          .map(function (p) {
            return '<tr><td style="border:1px solid #e2e8f0;padding:5px 9px;background:#f8fafc;font-weight:600">' +
              echapperXmlTampon(p[0]) + '</td><td style="border:1px solid #e2e8f0;padding:5px 9px">' +
              echapperXmlTampon(p[1]) + "</td></tr>";
          })
          .join("") +
        "</table>"
      : "") +
    '<p style="color:#475569">Vous pouvez suivre votre demande dans «&nbsp;Mes demandes&nbsp;» du portail employés.</p>' +
    '<p style="color:#94a3b8;font-size:12px;margin-top:16px">AutoRH — e-mail automatique (confirmation demandeur — NE PAS répondre)</p>' +
    "</div>";
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    const info = await transport.sendMail({
      from: from,
      to: dest,
      subject: "AutoRH — " + libelleTypeDemande(demande.type) + " " + demande.reference + " (confirmation d'envoi)",
      text: texte,
      html: html,
      // (NOUVEAU Task 251) confirmation SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Auto-RH-Systeme": "confirmation-demandeur" },
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
    }));
    return { envoye: true, messageId: info.messageId, dest: dest };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/**
 * (NOUVEAU — demande utilisateur, point 7 v0.2.88) ENVOI EN ARRIÈRE-PLAN des
 * e-mails de création. La réponse HTTP à l'employé est rendue IMMÉDIATEMENT
 * après l'enregistrement de la demande : l'envoi SMTP (potentiellement lent)
 * s'exécute ensuite, sans jamais lever d'exception.
 *   1) e-mail PRINCIPAL au destinataire du traitement (MANAGER RESPONSABLE de
 *      l'employé pour le congé et l'autorisation de sortie — v0.2.132 : résolu
 *      automatiquement depuis l'affectation « Mot de passe initial — CIN » —,
 *      RH pour les attestations, boîte dédiée pour le parrainage) — le
 *      Message-ID est mémorisé pour la reconnaissance des réponses
 *      (In-Reply-To) ;
 *   2) COPIE AUTOMATIQUE — congé et autorisation de sortie (points 7-8 : le
 *      RH reçoit la demande ET la validation du manager), attestations de
 *      travail / de salaire (v0.2.196) et PARRAINAGE (v0.2.197) : l'adresse
 *      DÉDIÉE du type reçoit une copie quand elle est configurée ;
 *   3) (NOUVEAU v0.2.92) CONFIRMATION AUTOMATIQUE au DEMANDEUR — étendue
 *      v0.2.94 (Task 197) à TOUS les types — à son adresse e-mail de
 *      notification (PortalAccess.email — colonne « E-mail d'accès » du
 *      Portail Administration).
 */
async function envoyerEmailsDemandeEnArrierePlan(demandeCreee, creeId, destPrincipal, cfg) {
  try {
    // 1) e-mail principal (manager responsable / responsable du département /
    //    RH)
    if (destPrincipal) {
      const envoi = await envoyerEmailDemandeCreation(demandeCreee, destPrincipal, cfg);
      // Mémorisation du Message-ID du message principal : la RÉPONSE du
      // responsable N+1 sera reconnue par les en-têtes In-Reply-To /
      // References même si le sujet est modifié (jamais bloquant).
      if (envoi && envoi.envoye && envoi.messageId) {
        try {
          await prisma.demandeAdministrative.update({
            where: { id: creeId },
            data: { messageIdEnvoi: String(envoi.messageId).replace(/[<>]/g, "").trim() },
          });
        } catch (e) {
          console.error("[DEMANDES] messageIdEnvoi non mémorisé:", e && e.message ? e.message : e);
        }
      }
    } else {
      journaliserEnvoiDemandes({
        action: "demande-creation",
        dest: "",
        from: "",
        host: cfg ? cfg.host : "",
        port: cfg ? cfg.port : 0,
        secure: cfg ? cfg.port === 465 : false,
        succes: false,
        code: "DESTINATAIRE_ABSENT",
        erreur: "Aucun destinataire de traitement résolu pour cette demande",
        reference: demandeCreee.reference,
        type: demandeCreee.type,
      });
    }
    // 2) COPIE systématique — congé, autorisation de sortie, ATTESTATIONS de
    //    travail / de salaire (v0.2.196, demande utilisateur « en copie ») ET
    //    (NOUVEAU v0.2.197, demande utilisateur « en copie du responsable
    //    principal du parrainage ») PARRAINAGE : l'adresse dédiée du type
    //    reçoit une COPIE quand elle est configurée —
    //      congé / autorisation : cfg.congeEmail / cfg.autorisationEmail,
    //        sinon à la boîte RH (comportement v0.2.88 conservé ; le MANAGER
    //        RESPONSABLE de l'employé, v0.2.132 — plus de N+1 saisi, reste
    //        destinataire PRINCIPAL, jamais écrasé par la copie) ;
    //      attestations : cfg.attestationTravailEmail / cfg.attestationSalaireEmail
    //        — la boîte du service RH reste destinataire PRINCIPAL
    //        (destinatairePourDemande) — AUCUN repli RH ici (ce serait un
    //        doublon du principal) ;
    //      parrainage : cfg.parrainageCopieEmail — l'adresse DÉDIÉE du
    //        parrainage (parrainageEmail) reste destinataire PRINCIPAL pour
    //        la validation par réponse e-mail — AUCUN repli (jamais de
    //        doublon du principal).
    //    Adresses vides = AUCUNE copie (attestations / parrainage). Dans
    //    TOUS les cas, une copie identique au destinataire principal est
    //    IGNORÉE (pas de doublon) et JOURNALISÉE (v0.2.197 — visibilité
    //    immédiate du routage dans le journal d'envoi).
    const typeValidation =
      demandeCreee.type === "CONGE" || demandeCreee.type === "AUTORISATION_SORTIE";
    const typeAttestation =
      demandeCreee.type === "ATTESTATION_TRAVAIL" || demandeCreee.type === "ATTESTATION_SALAIRE";
    const typeParrainage = demandeCreee.type === "PARRAINAGE";
    if (typeValidation || typeAttestation || typeParrainage) {
      const copieDediee = cfg
        ? typeValidation
          ? demandeCreee.type === "CONGE" ? cfg.congeEmail : cfg.autorisationEmail
          : demandeCreee.type === "ATTESTATION_TRAVAIL"
            ? cfg.attestationTravailEmail
            : demandeCreee.type === "ATTESTATION_SALAIRE"
              ? cfg.attestationSalaireEmail
              : cfg.parrainageCopieEmail
        : "";
      const destCopie = typeValidation
        ? (copieDediee || (cfg && cfg.rhEmail) || "")
        : (copieDediee || "");
      if (destCopie && destCopie === destPrincipal) {
        // (NOUVEAU v0.2.197) copie IGNORÉE : identique au destinataire
        // principal — JOURNALISÉE pour le diagnostic « je ne reçois pas la
        // copie » (l'adresse en copie NE DOIT PAS être celle qui traite
        // déjà la demande, sinon elle la recevrait en double).
        journaliserEnvoiDemandes({
          action: "demande-creation-copie-ignoree",
          dest: destCopie,
          from: "",
          host: cfg ? cfg.host : "",
          port: cfg ? cfg.port : 0,
          secure: cfg ? cfg.port === 465 : false,
          succes: true,
          code: "COPIE_IDENTIQUE_PRINCIPAL",
          erreur:
            "Copie non envoyée : l'adresse en copie configurée (" + destCopie +
            ") est identique au destinataire principal de la demande — aucun doublon n'est envoyé.",
          reference: demandeCreee.reference,
          type: demandeCreee.type,
        });
      } else if (destCopie) {
        const copie = await envoyerEmailDemandeCreation(demandeCreee, destCopie, cfg);
        journaliserEnvoiDemandes({
          action: copieDediee ? "demande-creation-copie-dediee" : "demande-creation-copie-rh",
          dest: destCopie,
          from: "",
          host: cfg.host,
          port: cfg.port,
          secure: cfg.port === 465,
          succes: Boolean(copie && copie.envoye),
          messageId: copie && copie.messageId ? copie.messageId : undefined,
          erreur: copie && copie.erreur ? copie.erreur : undefined,
          reference: demandeCreee.reference,
          type: demandeCreee.type,
        });
      }
    }
    // 3) (v0.2.92, ÉTENDU v0.2.94 Task 197 à TOUS les types) CONFIRMATION
    //    AUTOMATIQUE au DEMANDEUR — envoyée à son adresse e-mail de
    //    notification (PortalAccess.email, colonne « E-mail d'accès » du
    //    Portail Administration), en plus de l'e-mail de traitement parti au
    //    destinataire du type. Jamais bloquant, toujours journalisée.
    if (
      demandeCreee.emailEmploye &&
      demandeCreee.emailEmploye !== destPrincipal
    ) {
      const conf = await envoyerEmailDemandeConfirmation(demandeCreee, demandeCreee.emailEmploye, cfg);
      journaliserEnvoiDemandes({
        action: "demande-creation-confirmation-demandeur",
        dest: demandeCreee.emailEmploye,
        from: "",
        host: cfg ? cfg.host : "",
        port: cfg ? cfg.port : 0,
        secure: cfg ? cfg.port === 465 : false,
        succes: Boolean(conf && conf.envoye),
        messageId: conf && conf.messageId ? conf.messageId : undefined,
        erreur: conf && conf.erreur ? conf.erreur : undefined,
        reference: demandeCreee.reference,
        type: demandeCreee.type,
      });
    }
  } catch (e) {
    console.error("[DEMANDES] envoi arrière-plan:", e && e.message ? e.message : e);
  }
}

// ============================================================================
// NOUVEAU (Task 122) — RÉCEPTION AUTOMATIQUE DES RÉPONSES DU RH (IMAP)
// ============================================================================
// Le service RH répond à l'e-mail de la demande (créée ci-dessus) en joignant
// le document demandé (ex. Attestation_Travail.pdf). La réponse atterrit dans
// la boîte de réception du COMPTE D'ENVOI (ou d'un compte IMAP dédié — les
// identifiants par défaut sont ceux du SMTP, configurables dans l'onglet
// « Accès portail »). Le portail interroge périodiquement cette boîte :
//   1. messages NON LUS de INBOX (ImapFlow — même auteur que nodemailer) ;
//   2. rattachement à la demande par les en-têtes In-Reply-To / References
//      (Message-ID mémorisé à l'envoi) OU par la référence DEM-AAAA-NNNNN
//      du sujet (repli : transfert de mail, modification du sujet) ;
//   3. contrôle de sécurité : l'expéditeur de la réponse doit être le
//      DESTINATAIRE de la demande (rhEmail / N+1 / responsable) ;
//   4. pièces jointes exploitableS uniquement (pdf, doc, docx, jpg, jpeg,
//      png — 15 Mo max par fichier), dédupliquées par empreinte SHA-256,
//      stockées CHIFFRÉES dans storage/documents-demandes/ ;
//   5. une réponse avec document = demande TRAITÉE : statut automatiquement
//      porté à ACCEPTEE si elle était EN_ATTENTE / INFORMATION_REQUISE
//      (statut REFUSEE conservé) ;
//   6. notification e-mail à l'employé « document disponible » (non
//      bloquante, journalisée) ;
//   7. l'employé visualise/télécharge le document dans « Mes demandes ».
// Aucune étape n'est bloquante pour le portail : tout échec IMAP est
// journalisé et le polling retente à la prochaine échéance.

let ImapFlowReception = null;
try {
  ImapFlowReception = require("imapflow").ImapFlow;
} catch (e) {
  console.error("[RECEPTION] paquet imapflow indisponible :", e.message);
}
let simpleParserReception = null;
try {
  simpleParserReception = require("mailparser").simpleParser;
} catch (e) {
  console.error("[RECEPTION] paquet mailparser indisponible :", e.message);
}
// (NOUVEAU — demande utilisateur, point 8 v0.2.88) règles de VALIDATION PAR
// RÉPONSE du responsable N+1 (congé + autorisation) : module pur, testable
// isolément. Si indisponible : la validation par réponse est simplement
// désactivée (comportement historique conservé, aucune rupture).
let libValidationN1 = null;
try {
  libValidationN1 = require("./lib-validation-n1.js");
} catch (e) {
  console.error("[RECEPTION] module lib-validation-n1.js indisponible :", e.message);
}

/** Extensions de pièces jointes acceptées (sécurité : liste blanche). */
const EXTENSIONS_DOCUMENTS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
/** Taille maximale d'une pièce jointe importée (15 Mo, cohérent avec l'import de fiches). */
const TAILLE_MAX_DOCUMENT = 15 * 1024 * 1024;
/** Plafond de messages traités par passage de vérification (protection anti-blocage). */
// (MODIFIÉ v0.2.162 — correction « statuts non mis à jour ») 50 → 12 → 6 : chaque
// message est récupéré/analysé sur Gmail (≈ 1,5-2 s) — un passage plafonné à
// 6 messages dure ≈ 10-15 s ; combiné au scan « Envoyés » PRIORITAIRE, la mise
// à jour d'un statut est GARANTIE en MOINS DE 60 SECONDES après la réception
// d'une réponse valide (exigence utilisateur ; à 50 messages/passage, un
// passage durait ≈ 85 s). Le backlog ancien est traité sur plusieurs passages
// successifs (aucun impact métier : dédoublonnage + marquage \Seen).
const PLAFOND_MESSAGES_PAR_PASSAGE = 6;
// (NOUVEAU v0.2.163) Fenêtre de recherche INBOX : seuls les messages reçus
// depuis 48 h sont récupérés et analysés — le backlog historique (36 000+
// non lus anciens : spams 2025) n'est PLUS JAMAIS fetché. Conséquences :
// chaque passage ne porte que sur les messages récents (fetch GROUPÉ en un
// seul aller-retour, < 5 s), une réponse reçue est traitée au passage suivant
// (≤ 15 s) et la mise à jour du statut est GARANTIE EN MOINS DE 60 SECONDES
// (exigence utilisateur). Les messages plus anciens ne sont ni récupérés ni
// marqués lus (invisibles pour le poller, aucun impact métier).
const FENETRE_INBOX_MS = 48 * 60 * 60 * 1000;
/** Fenêtre d'observation de la boîte « Envoyés » (auto-réponses marquées LUES
 * par Gmail quand le RH répond depuis la MÊME boîte que le système — voir
 * scannerBoiteEnvoyes). 10 minutes : couvre toute réponse humaine récente et
 * rend le re-scan après redémarrage inoffensif (dédoublonnage Message-ID). */
const FENETRE_ENVOYES_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// (v0.2.165) CURSEURS UID PERSISTANTS — remplace le filtre « non lu » :
// PROBLÈME CONSTATÉ EN TEST RÉEL : sur une boîte réelle manipulée par un
// humain, le marqueur « non lu » n'est PAS fiable pour distinguer « traité »
// de « à traiter » : ouvrir le FIL Gmail (vue conversation) marque TOUTES les
// réponses du fil comme LUES avant que le poller ne les traite — la recherche
// { seen: false } ne les voit JAMAIS (constaté : 2 réponses manager
// APPENDÉES restées invisibles, marquées \Seen sans jamais être analysées).
// SOLUTION : un CURSEUR UID par boîte (INBOX / Envoyés) — chaque passage
// fetch directement la plage (curseur+1 : *) SANS recherche IMAP (la SEARCH
// Gmail s'est aussi révélée intermittente sur les boîtes saturées de spam :
// UIDVALIDITY réinitialisée, UIDs renumérotés en live) ; le curseur est
// PERSISTÉ dans logs/auto-rh-imap-curseurs.json (survit aux redémarrages).
// Le fetch ImapFlow utilise BODY.PEEK (ne marque PAS lu) ; les messages
// traités sont marqués lus APRÈS analyse (cosmétique, pour l'utilisateur).
// Le dédoublonnage reponsesRecues (Message-ID) reste la seconde barrière.
// ---------------------------------------------------------------------------
const CHEMIN_CURSEURS_IMAP = path.join(ROOT, "logs", "auto-rh-imap-curseurs.json");
let _curseursImapCache = null;
let _dernierUidInbox = 0;
function lireCurseurImap(cle) {
  if (_curseursImapCache === null) {
    try {
      _curseursImapCache = JSON.parse(fs.readFileSync(CHEMIN_CURSEURS_IMAP, "utf8"));
    } catch (e) {
      _curseursImapCache = {};
    }
  }
  const valeur = Number(_curseursImapCache && _curseursImapCache[cle]);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 0;
}
function ecrireCurseurImap(cle, valeur) {
  try {
    if (_curseursImapCache === null) lireCurseurImap(cle);
    _curseursImapCache = Object.assign({}, _curseursImapCache, { [cle]: valeur, maj: new Date().toISOString() });
    fs.mkdirSync(path.dirname(CHEMIN_CURSEURS_IMAP), { recursive: true });
    fs.writeFileSync(CHEMIN_CURSEURS_IMAP, JSON.stringify(_curseursImapCache), "utf8");
  } catch (e) {
    // persistance indisponible : le curseur en mémoire reste valable pour
    // la session en cours (les redémarrages reprendront à uidNext-1).
  }
}
/** Récupère les messages AU-DELÀ d'un curseur UID (sans SEARCH, fetch PEEK).
 * Retourne [{ uid, source }] triés par UID croissant, plafonnés. */
async function fetchApresCurseur(client, curseur, plafond) {
  const uidNextBoite = Number((client.mailbox && client.mailbox.uidNext) || 1);
  if (curseur >= uidNextBoite - 1) return []; // rien de nouveau
  const plage = (curseur + 1) + ":*";
  const candidats = [];
  for await (const msg of client.fetch(plage, { source: true }, { uid: true })) {
    const u = Number(msg && msg.uid);
    if (u > curseur && msg && msg.source) candidats.push({ uid: u, source: msg.source });
  }
  candidats.sort(function (a, b) { return a.uid - b.uid; });
  return candidats.slice(0, plafond);
}

// (NOUVEAU Task 178) — CLASSIFICATION AUTOMATIQUE DES RÉPONSES : module
// autonome reconnaissant les formulations d'acceptation et de refus du
// cahier des charges dans les réponses e-mail (sujet + corps). Voir
// scripts/classification-reponses.js (listes exactes, priorité refus,
// ambiguïté → « En attente »).
const classificationReponses = require("./classification-reponses.js");
/**
 * Types de demandes soumis à la CLASSIFICATION AUTOMATIQUE du contenu des
 * réponses e-mail (Task 178 : congé ; MODIFIÉ Task 181 : autorisations de
 * sortie ; MODIFIÉ v0.2.162 — correction « statuts non mis à jour » : LES
 * QUATRE TYPES. Les attestations de travail et de salaire étaient EXCLUES :
 * une réponse TEXTE (« Acceptée », « Je valide », « Refusée »…) sans pièce
 * jointe était purement IGNORÉE et leur statut restait « En attente » —
 * c'était la cause principale du défaut côté attestations. Le comportement
 * historique « pièce jointe reçue = acceptation » reste conservé (§5).
 * (MODIFIÉ v0.2.178 — demande utilisateur) le PARRAINAGE rejoint la liste :
 * le destinataire de l'ADRESSE DÉDIÉE aux demandes de parrainage répond par
 * e-mail avec les MÊMES expressions d'acceptation / de refus que le congé et
 * l'autorisation de sortie (même classificateur, mêmes tolérances :
 * casse, accents, apostrophes, ponctuation, citations, négations) — sa
 * décision est appliquée AUTOMATIQUEMENT (validation en UNE SEULE étape,
 * voir la branche PARRAINAGE de traiterMessageRecu ci-dessous).
 */
const TYPES_CLASSIFICATION_AUTO = [
  "CONGE",
  "AUTORISATION_SORTIE",
  "ATTESTATION_TRAVAIL",
  "ATTESTATION_SALAIRE",
  "PARRAINAGE",
];

// ============================================================================
// NOUVEAU (Task 181) — VALIDATION À DEUX ÉTAPES MANAGER → RH
// ============================================================================
// Jumelle JS de src/lib/demandes.ts (statutFinalDepuisDecisions / libelle-
// StatutFinal — ⚠ garder les deux alignées). Le statut final d'une demande de
// congé ou d'autorisation suit la MATRICE :
//   Manager Acceptée + RH Acceptée → « Acceptée » (ACCEPTEE) ;
//   Manager Refusée → « Refusée par le Manager » (REFUSEE + refuseePar=
//                     MANAGER — refus IMMÉDIAT, AUCUNE transmission RH) ;
//   Manager Acceptée + RH Refusée → « Refusée par les RH » ;
//   toute autre combinaison → « En attente » (EN_ATTENTE).
function calculerStatutFinalDeuxEtapes(decisionManager, decisionRh) {
  const m = decisionManager === "ACCEPTEE" || decisionManager === "REFUSEE"
    ? decisionManager : "EN_ATTENTE";
  const r = decisionRh === "ACCEPTEE" || decisionRh === "REFUSEE"
    ? decisionRh : "EN_ATTENTE";
  if (m === "REFUSEE") return { statut: "REFUSEE", refuseePar: "MANAGER" };
  if (r === "REFUSEE") return { statut: "REFUSEE", refuseePar: "RH" };
  if (m === "ACCEPTEE" && r === "ACCEPTEE") return { statut: "ACCEPTEE", refuseePar: null };
  return { statut: "EN_ATTENTE", refuseePar: null };
}

/** Libellé RAFFINÉ du statut final (jumelle de libelleStatutFinal). */
function libelleStatutFinalDemande(statut, refuseePar) {
  if (statut === "REFUSEE") {
    if (refuseePar === "MANAGER") return "Refusée par le Manager";
    if (refuseePar === "RH") return "Refusée par les RH";
  }
  return LIBELLES_STATUT_DEMANDE[statut] || String(statut || "");
}

/**
 * (NOUVEAU Task 200 — v0.2.155) Libellé d'une décision d'ÉTAPE (manager ou
 * RH) exposée au portail employé : ACCEPTEE → « Acceptée », REFUSEE →
 * « Refusée », sinon (null ou EN_ATTENTE) → « En attente ». Mêmes mots que
 * l'interface d'administration pour une lecture sans ambiguïté.
 */
function libelleDecisionEtapeDemande(v) {
  if (v === "ACCEPTEE") return "Acceptée";
  if (v === "REFUSEE") return "Refusée";
  return "En attente";
}

/**
 * (NOUVEAU Task 178) Extrait le TEXTE BRUT d'un message parsé (mailparser)
 * pour la classification : parsed.text en priorité, sinon HTML dépouillé
 * (balises, style/script, entités courantes). Jamais bloquant.
 */
function extraireTexteMessage(parsed) {
  const t = parsed && typeof parsed.text === "string" ? parsed.text : "";
  if (t.trim()) return t;
  const h = parsed && typeof parsed.html === "string" ? parsed.html : "";
  if (!h) return "";
  return String(h)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (m, d) {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return " "; }
    });
}


/**
 * (NOUVEAU Task 194) HISTORIQUE DES RÉPONSES E-MAIL REÇUES — cahier des
 * charges §3.5-7 et §4 : « Enregistrer la réponse reçue dans l'historique de
 * la demande », « Conserver la date, l'heure et l'expéditeur », le RH devant
 * pouvoir consulter la réponse ORIGINALE, le statut résultant, les pièces
 * jointes et l'expéditeur depuis le portail administratif — y compris pour
 * les réponses AMBIGUÏES ou NON RECONNUES (le statut reste « En attente »,
 * AUCUNE décision automatique, mais la trace est conservée).
 *
 * @param {object} demande  Demande chargée AVANT toute mise à jour (les
 *                          réponses existantes sont lues dans
 *                          demande.reponsesRecues, chiffré JSON).
 * @param {object} entree   { le, de, role, sujet, texte, decision,
 *                          formulations, piecesJointes,
 *                          piecesJointesImportees, piecesJointesIds,
 *                          statutAvant, statutApres }
 * JAMAIS bloquant : tout échec est tracé console (l'ID de la demande est
 * relue AVANT les mises à jour de statut — aucune condition de course).
 */
const REPONSES_RECU_MAX = 30;       // dernières réponses conservées
const REPONSES_RECU_TEXTE_MAX = 4000; // caractères du corps conservés
async function enregistrerReponseRecue(demande, entree) {
  try {
    let liste = [];
    if (demande.reponsesRecues) {
      try {
        const brut = cryptoBd.dechiffrerChamp(demande.reponsesRecues);
        const parse = JSON.parse(brut || "[]");
        if (Array.isArray(parse)) liste = parse;
      } catch (e) { liste = []; }
    }
    liste.push(entree);
    while (liste.length > REPONSES_RECU_MAX) liste.shift();
    await prisma.demandeAdministrative.update({
      where: { id: demande.id },
      data: { reponsesRecues: cryptoBd.chiffrerChamp(JSON.stringify(liste)) },
    });
  } catch (e) {
    console.error("[demandes] historique réponse e-mail non enregistré (" + (demande && demande.reference) + "):", e.message);
  }
}

/** Construit l'entrée d'historique d'une réponse e-mail (Task 194). */
function entreeReponseRecue(demande, infos) {
  return {
    le: new Date().toISOString(),
    // (NOUVEAU v0.2.162) Message-ID de la réponse : dédoublonnage INBOX ↔
    // boîte « Envoyés » (une auto-réponse du RH existe dans LES DEUX boîtes —
    // ne la traiter qu'UNE fois, voir scannerBoiteEnvoyes).
    messageId: String(infos.messageId || ""),
    de: String(infos.de || ""),
    role: String(infos.role || ""),
    sujet: String(infos.sujet || "").slice(0, 500),
    texte: String(infos.texte || "").trim().slice(0, REPONSES_RECU_TEXTE_MAX),
    decision: infos.decision || null,
    formulations: Array.isArray(infos.formulations) ? infos.formulations.slice(0, 10) : [],
    piecesJointes: Array.isArray(infos.piecesJointes) ? infos.piecesJointes.slice(0, 20) : [],
    piecesJointesImportees: Array.isArray(infos.piecesJointesImportees) ? infos.piecesJointesImportees.slice(0, 20) : [],
    // (NOUVEAU Task 196 / v0.2.152) identifiants des DocumentDemande importés
    // avec CETTE réponse : chaque réponse e-mail reste LIÉE à ses pièces
    // jointes (consultables et téléchargeables depuis les DEUX portails,
    // quel que soit le statut de la demande) — pas seulement par leur nom.
    piecesJointesIds: Array.isArray(infos.piecesJointesIds) ? infos.piecesJointesIds.slice(0, 20) : [],
    statutAvant: infos.statutAvant || null,
    statutApres: infos.statutApres || null,
    reference: demande.reference,
  };
}

/** Verrou : un seul passage IMAP à la fois (polling + requêtes manuelles). */
let _verifReceptionEnCours = false;

/** Taille lisible (ex. « 84,2 Ko », « 1,3 Mo ») — affichage e-mails et interface. */
function formaterTailleDocument(o) {
  const n = Number(o || 0);
  if (!isFinite(n) || n <= 0) return "0 Ko";
  if (n >= 1048576) return (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(n / 1024)) + " Ko";
}

/** Assainit un nom de fichier de pièce jointe (aucun séparateur ni contrôle). */
function assainirNomDocument(nom) {
  let n = String(nom == null ? "" : nom)
    .replace(/[\\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*"]/g, "")
    .trim();
  if (n.length > 150) {
    const point = n.lastIndexOf(".");
    const ext = point > 0 ? n.slice(point) : "";
    n = n.slice(0, 150 - ext.length) + ext;
  }
  return n;
}

/** Extension (minuscule) d'un nom de fichier, sans le point. */
function extensionDocument(nom) {
  const n = String(nom == null ? "" : nom);
  const point = n.lastIndexOf(".");
  if (point < 0 || point === n.length - 1) return "";
  return n.slice(point + 1).toLowerCase();
}

/** Type MIME servi au navigateur selon l'extension (cohérent fiches/attestations). */
function mimeDepuisExtension(ext) {
  switch (String(ext || "").toLowerCase()) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

/**
 * Dossier d'ÉCRITURE des documents : voisin « documents-demandes » du
 * premier dossier de fiches (même racine de stockage — le site et le
 * portail partagent donc les documents comme ils partagent les fiches).
 */
function dossierEcritureDocumentsDemandes() {
  const premier = STORAGE_CANDIDATES[0];
  if (premier) return path.join(path.dirname(premier), "documents-demandes");
  return path.join(process.cwd(), "storage", "documents-demandes");
}

/** Dossiers de LECTURE possibles des documents (mêmes règles que les fiches). */
function candidatsDocumentsDemandes() {
  const liste = [];
  for (const dir of STORAGE_CANDIDATES) {
    liste.push(path.join(path.dirname(dir), "documents-demandes"));
  }
  for (const base of DEEP_SEARCH_ROOTS) {
    liste.push(path.join(base, "storage", "documents-demandes"));
  }
  return [...new Set(liste)];
}

/**
 * (NOUVEAU v0.2.49 — « rendre les documents du dossier documents-demandes
 * illisibles, comme les fiches de paie ») BALAYAGE DE CHIFFREMENT AU
 * DÉMARRAGE : tout document stocké EN CLAIR (sans l'en-tête PAIESAGE1) dans
 * un des dossiers documents-demandes est chiffré SUR PLACE — même
 * AES-256-GCM que les écritures courantes (qui le sont déjà depuis la
 * Task 122). Idempotent et JAMAIS bloquant : les fichiers déjà chiffrés ne
 * sont pas retouchés, une erreur sur un fichier n'arrête ni le balayage ni
 * le démarrage du portail. Le même traitement existe hors-ligne via
 * scripts/chiffrer-storage.js (v0.2.49 : couvre les deux dossiers) et le
 * raccourci CHIFFRER-FICHES-WINDOWS.bat.
 */
function chiffrerDocumentsDemandesEnClair() {
  if (!storageEncryptionActive()) return;
  let scannes = 0, chiffres = 0;
  for (const dir of candidatsDocumentsDemandes()) {
    let fichiers = [];
    try {
      fichiers = fs.readdirSync(dir).filter((f) => {
        try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; }
      });
    } catch { continue; }
    for (const f of fichiers) {
      const p = path.join(dir, f);
      try {
        const brut = fs.readFileSync(p);
        scannes++;
        if (isEncryptedBuffer(brut)) continue; // déjà illisible sur le disque
        const tmp = p + ".tmp-enc";
        fs.writeFileSync(tmp, encryptForStorage(brut));
        fs.renameSync(tmp, p);
        chiffres++;
        console.log("[DOCUMENTS] document en clair chiffré : " + p);
      } catch (err) {
        console.error("[DOCUMENTS] chiffrement impossible (" + f + ") : " + (err && err.message ? err.message : err));
        try { fs.unlinkSync(p + ".tmp-enc"); } catch {}
      }
    }
  }
  if (chiffres) {
    console.log("[DOCUMENTS] balayage de démarrage : " + chiffres + " document(s) chiffré(s) sur " + scannes + " examiné(s).");
  }
}

/**
 * Retrouve un document stocké dans les dossiers candidats (comme
 * findStoredFile pour les fiches, sous-dossier documents-demandes).
 */
function trouverDocumentStocke(nomStocke) {
  const nom = String(nomStocke || "").replace(/[\\\/]/g, "");
  if (!nom) return null;
  for (const dir of candidatsDocumentsDemandes()) {
    const p = path.join(dir, nom);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  // Recherche approfondie (même stratégie que les fiches : .next/standalone, etc.)
  const SKIP = new Set(["node_modules", ".git"]);
  for (const base of DEEP_SEARCH_ROOTS) {
    const stack = [{ dir: base, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      if (depth > 6) continue;
      const direct = path.join(dir, "storage", "documents-demandes", nom);
      try {
        if (fs.statSync(direct).isFile()) return direct;
      } catch {}
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isDirectory() && !SKIP.has(e.name)) {
          stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
      }
    }
  }
  return null;
}

/* ============================================================
 * (NOUVEAU Task 231) COPIES SIGNÉES CONSERVÉES — portail employé
 * ------------------------------------------------------------
 * La signature électronique PAdES (API de certification & signature,
 * src/lib/signature-api.ts) conserve chaque document signé chiffré dans
 * storage/signatures/documents/<nom> et l'enregistre dans le registre
 * SignatureApiDocument (MÊME base SQLite que le portail). Le portail lit ce
 * registre pour servir à l'employé LA COPIE SIGNÉE (fiches de paie) et
 * afficher l'état de signature des réponses — comme le site d'administration.
 * ============================================================ */

/** Dossiers possibles des copies signées (mêmes règles de résolution que les
 * fiches : candidats du stockage + recherche approfondie .next/standalone…). */
function candidatsCopiesSignees() {
  const liste = [];
  for (const dir of STORAGE_CANDIDATES) {
    const base = path.dirname(dir);
    liste.push(path.join(base, "signatures", "documents"));
    liste.push(path.join(base, "signatures"));
  }
  for (const base of DEEP_SEARCH_ROOTS) {
    liste.push(path.join(base, "storage", "signatures", "documents"));
    liste.push(path.join(base, "storage", "signatures"));
  }
  return [...new Set(liste)];
}

/** Retrouve une copie signée conservée (nom relatif du registre) — null si
 * absente. Le nom est nettoyé (aucun séparateur) comme trouverDocumentStocke. */
function trouverCopieSignee(nomStocke) {
  const nom = String(nomStocke || "").replace(/[\\\/]/g, "");
  if (!nom) return null;
  for (const dir of candidatsCopiesSignees()) {
    const p = path.join(dir, nom);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

/* ============================================================================
 * (NOUVEAU Task 244) — COPIES SIGNÉES FIGÉES : PRÉSERVATION DE LA SIGNATURE
 * D'ORIGINE (jumelle de src/lib/copie-signee.ts)
 * ============================================================================
 * La PREMIÈRE signature posée sur une fiche (tampon visuel et/ou PAdES) est
 * conservée UNE FOIS pour toutes (storage/copies-signees/, chiffrée) et
 * servie TELLE QUELLE à l'employé : modifier ou remplacer la signature dans
 * les paramètres (image, position, QR, cachet, certificat…) N'AUCUN effet
 * sur les fiches déjà signées ; la signature active ne concerne que les
 * fiches pas ENCORE signées (en pratique les nouvelles fiches générées après
 * la modification). Aucun document déjà signé n'est modifié ni re-signé.
 * ========================================================================== */
function dossierEcritureCopiesFigees() {
  const premier = STORAGE_CANDIDATES[0];
  if (premier) return path.join(path.dirname(premier), "copies-signees");
  return path.join(process.cwd(), "storage", "copies-signees");
}

/** Dossiers de LECTURE des copies figées (mêmes règles que les fiches — le
 * site d'administration écrit dans <racine>/storage/copies-signees). */
function candidatsCopiesFigees() {
  const liste = [];
  for (const dir of STORAGE_CANDIDATES) {
    liste.push(path.join(path.dirname(dir), "copies-signees"));
  }
  for (const base of DEEP_SEARCH_ROOTS) {
    liste.push(path.join(base, "storage", "copies-signees"));
  }
  return [...new Set(liste)];
}

/** Retrouve une copie figée (nom déterministe « copie-<id> ») — null si absente. */
function trouverCopieFigee(nomStocke) {
  const nom = String(nomStocke || "").replace(/[\\\/]/g, "");
  if (!nom) return null;
  for (const dir of candidatsCopiesFigees()) {
    const p = path.join(dir, nom);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

/** FIGE définitivement les octets servis comme signature d'origine de la
 * fiche (PREMIER figeage gagnant — jamais réécrit ensuite). nature :
 * "PADES" (document signé cryptographiquement) | "TAMPON" (signature
 * visuelle seule). JAMAIS bloquant. */
async function figerCopieSigneePortail(ficheId, donnees, nature) {
  try {
    const deja = await prisma.payslip.findUnique({
      where: { id: ficheId },
      select: { copieSigneeNom: true },
    });
    if (deja && deja.copieSigneeNom) return false;
    const dossier = dossierEcritureCopiesFigees();
    fs.mkdirSync(dossier, { recursive: true });
    try { fs.chmodSync(dossier, 0o700); } catch {}
    const nom = "copie-" + String(ficheId).replace(/[^A-Za-z0-9_-]/g, "");
    const cible = path.join(dossier, nom);
    const tmp = cible + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, encryptForStorage(donnees), { mode: 0o600 });
    fs.renameSync(tmp, cible);
    try { fs.chmodSync(cible, 0o600); } catch {}
    const empreinte = crypto.createHash("sha256").update(donnees).digest("hex");
    await prisma.payslip.updateMany({
      where: { id: ficheId, copieSigneeNom: null },
      data: {
        copieSigneeNom: nom,
        copieSigneeEmpreinte: empreinte,
        copieSigneeNature: nature,
        copieSigneeLe: new Date(),
      },
    });
    console.log("[PORTAIL] Signature d'origine FIGÉE pour la fiche", ficheId, "(" + nature + ")");
    return true;
  } catch (e) {
    console.error("[PORTAIL] Figage de la signature impossible (non bloquant):", e && e.message ? e.message : e);
    return false;
  }
}

/** Identifiants des fiches possédant une copie signée conservée (registre).
 * JAMAIS bloquant : toute erreur → ensemble vide (indicateur simplement absent). */
async function idsFichesSignees(ficheIds) {
  const ids = (ficheIds || []).filter(Boolean);
  if (!ids.length) return [];
  try {
    const lignes = await prisma.signatureApiDocument.findMany({
      where: { type: "FICHE_PAIE", sourceId: { in: ids }, chemin: { not: "" } },
      select: { sourceId: true },
    });
    return lignes.map((l) => l.sourceId);
  } catch (e) {
    console.error("[PORTAIL] registre signatures indisponible:", e && e.message ? e.message : e);
    return [];
  }
}

/**
 * Lit la configuration IMAP de réception (identifiants DÉCHIFFRÉS en
 * mémoire, jamais journalisés). Champs IMAP vides = identifiants du SMTP
 * (cas standard : la boîte qui ENVOIE les demandes reçoit les réponses).
 * Retourne null si la réception est désactivée ou incomplète.
 */
async function chargerConfigImap() {
  const cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (!cfg || !cfg.imapActif || !cfg.imapHost) return null;
  const dechiffrer = (v) => {
    if (!v) return null;
    try { return cryptoBd.dechiffrerChamp(v); } catch (e) { return null; }
  };
  // (MODIFIÉ Task 122) sécurité déduite du port comme le SMTP (Task 102) :
  // 993 = SSL/TLS direct, autre port = STARTTLS/négocié par ImapFlow.
  const user = dechiffrer(cfg.imapUser) || dechiffrer(cfg.username);
  const pass = dechiffrer(cfg.imapPassword) || dechiffrer(cfg.password);
  if (!user || !pass) return null;
  return {
    host: String(cfg.imapHost || "").trim(),
    port: Number(cfg.imapPort) || 993,
    secure: (Number(cfg.imapPort) || 993) === 993,
    user: user,
    pass: pass,
  };
}

/**
 * NOUVEAU (v0.2.106 — demande utilisateur, point 3) : construit la liste des
 * PIÈCES JOINTES nodemailer à partir des documents importés pour une demande
 * (lignes DocumentDemande) : chaque fichier stocké chiffré est déchiffré en
 * mémoire (déchiffrement storage — octets ORIGINAUX reçus/stockés). Utilisée
 * par la notification « document disponible » (tous types) et par la
 * notification de validation N+1 (congé / autorisation de sortie) quand la
 * réponse e-mail du traitant comportait des pièces jointes exploitables.
 * Jamais bloquant : en cas d'erreur de lecture/déchiffrement, le document
 * concerné est simplement ÉCARTÉ de la liste (il reste dans le portail).
 */
function piecesJointesDepuisDocumentsDemande(docs) {
  const dossier = dossierEcritureDocumentsDemandes();
  const jointes = [];
  for (const doc of docs || []) {
    try {
      const cheminComplet = path.join(dossier, doc.chemin);
      const contenu = decryptFromStorage(fs.readFileSync(cheminComplet));
      jointes.push({
        filename: doc.nomFichier,
        content: contenu,
        contentType: doc.typeMime || mimeDepuisExtension(extensionDocument(doc.nomFichier)),
      });
    } catch (e) {
      console.error("[RECEPTION/PIECE JOINTE] lecture impossible de " + doc.nomFichier + " : " + (e && e.message ? e.message : e));
    }
  }
  return jointes;
}

/**
 * Envoie à l'EMPLOYÉ l'e-mail « votre demande a été traitée, le document est
 * disponible » (texte + HTML) et journalise la tentative. JAMAIS bloquant :
 * retourne { envoye, dest, messageId?, erreur? }.
 * (MODIFIÉ v0.2.106 — demande utilisateur, point 3) le(s) document(s) est/
 * sont désormais JOINT(S) À L'E-MAIL (tous types de demandes) EN PLUS du
 * stockage portail — le corps annonce explicitement la pièce jointe.
 * (MODIFIÉ v0.2.184 — demande utilisateur) paramètre `contexte` (optionnel) :
 * "etape-intermediaire" = réponse de décision à une étape intermédiaire du
 * congé / de l'autorisation de sortie (matrice à deux étapes non achevée) —
 * formulation NEUTRE : aucun acteur ni décision n'est révélé, seuls les
 * documents transmis sont annoncés (la confidentialité de la décision
 * intermédiaire — règle v0.2.177 — reste entière).
 */
async function envoyerEmailDocumentDisponible(demande, docs, statutApres, cfg, contexte) {
  const dest = (function () {
    if (!demande.employeEmail) return null;
    try { return cryptoBd.dechiffrerChamp(demande.employeEmail); } catch (e) { return null; }
  })();
  const journalBase = {
    action: "demande-document-notification",
    dest: dest || "",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
  };
  if (!dest) {
    return { envoye: false, erreur: "Aucune adresse e-mail de notification connue pour l'employé." };
  }
  const listeDocs = docs.map(function (d) {
    return { nom: d.nomFichier, taille: formaterTailleDocument(d.taille) };
  });
  const statutLabel = libelleStatutDemande(statutApres);
  // (NOUVEAU v0.2.182 — DEMANDE UTILISATEUR) pour le PARRAINAGE, les documents
  // transmis par e-mail viennent du RESPONSABLE concerné (boîte dédiée du
  // parrainage), pas du service RH — formulation adaptée dans l'e-mail.
  // Autres types : formulation « service RH » historique conservée.
  const estParrainageDoc = demande.type === "PARRAINAGE";
  // (NOUVEAU v0.2.184 — demande utilisateur) ÉTAPE INTERMÉDIAIRE du congé /
  // de l'autorisation de sortie : formulation NEUTRE — le nom de l'acteur
  // (manager / RH) et la décision ne sont PAS révélés, seuls les documents
  // transmis sont annoncés (la demande « poursuit son circuit de validation
  // habituel »). Le parrainage garde sa formulation v0.2.182, les autres
  // types la formulation historique « service RH ».
  const etapeIntermediaire = contexte === "etape-intermediaire";
  const transmetteurLabel = estParrainageDoc
    ? "Document(s) transmis par le responsable de votre demande"
    : (etapeIntermediaire
      ? "Document(s) transmis avec la réponse à votre demande"
      : "Document(s) transmis par le service RH");
  const traiteParPhraseDoc = estParrainageDoc
    ? "Votre demande de parrainage a reçu une réponse : elle a été traitée par le responsable concerné."
    : (etapeIntermediaire
      ? "Votre demande a reçu une réponse : des documents vous sont transmis. Elle poursuit son circuit de validation habituel."
      : "Votre demande administrative a reçu une réponse : elle a été traitée par le service RH.");
  // (NOUVEAU v0.2.49) le NOM et le PRÉNOM de l'employé sont affichés dans la
  // notification : priorité aux champs Nom/Prénom du formulaire (attestations
  // v0.2.49, autorisation de sortie), puis au nom saisi du parrainage, puis
  // au nom résolu depuis les fiches de paie (jumelle de l'administration),
  // sinon libellé générique avec CIN masqué. Jamais bloquant.
  let nomEmployeDoc = "";
  try {
    const dj = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}");
    nomEmployeDoc = [dj.prenom, dj.nom].filter(Boolean).join(" ").trim() ||
      String(dj.nomParrain || "").trim();
  } catch (e) { nomEmployeDoc = ""; }
  let cinBrut = "";
  try { cinBrut = String(cryptoBd.dechiffrerChamp(demande.cin) || ""); } catch (e) { cinBrut = ""; }
  if (!nomEmployeDoc && cinBrut) {
    try { nomEmployeDoc = (await nomEmployeDepuisFiches(cinBrut)) || ""; } catch (e) { nomEmployeDoc = ""; }
  }
  const employeAfficheDoc = nomEmployeDoc || "Employé (CIN " + masquerCinDemande(cinBrut) + ")";
  // (NOUVEAU v0.2.107 — demande utilisateur) matricule de l'employé —
  // résolu automatiquement (accès portail prioritaire, sinon fiches de paie
  // du CIN) et affiché dans la notification (vide = ligne omise).
  const matriculeDoc = await matriculeEmployeDemandes(cinBrut, null);
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : notification « document disponible » non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    // (NOUVEAU v0.2.106) pièces jointes : documents déchiffrés en mémoire.
    const jointes = piecesJointesDepuisDocumentsDemande(docs);
    const mentionJointe = jointes.length
      ? transmetteurLabel + " — JOINT(S) À CET E-MAIL :"
      : transmetteurLabel + " :";
    const lignesTexte = listeDocs.map(function (d) { return "    - " + d.nom + " (" + d.taille + ")"; }).join("\n");
    const lignesHtml = listeDocs.map(function (d) {
      return '<li style="margin:3px 0;">' + echappeEmailDemande(d.nom) +
        ' <span style="color:#64748b;font-size:12px;">(' + echappeEmailDemande(d.taille) + ")</span></li>";
    }).join("");
    const texte = [
      "Bonjour,",
      "",
      traiteParPhraseDoc,
      "",
      "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
      "les réponses envoyées à cette adresse ne sont pas lues.",
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + libelleTypeDemande(demande.type),
      "  Employé                    : " + employeAfficheDoc,
      matriculeDoc ? "  Matricule                  : " + matriculeDoc : null,
      "  Statut                     : " + statutLabel,
      "",
      mentionJointe,
      lignesTexte,
      "",
      jointes.length
        ? "Le(s) document(s) est/sont JOINT(S) à cet e-mail : vous pouvez aussi le(s)"
        : "Vous pouvez visualiser et télécharger ce(s) document(s) dans la section",
      jointes.length
        ? "visualiser et le(s) télécharger dans la section « Demandes administratives »"
        : "« Demandes administratives » de votre portail employé. Pour toute",
      jointes.length
        ? "de votre portail employé. Pour toute question, contactez le service RH."
        : "question, contactez le service RH.",
      "",
      "E-mail automatique AutoRH — notification SANS réponse.",
    ].join("\n");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#10b981;padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">Document disponible — ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + "</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — AutoRH</div>" +
      "</div>" +
      '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
      '<p style="margin:0 0 14px;">' + echappeEmailDemande(traiteParPhraseDoc) + '</p>' +
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;"><b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues. Le suivi de votre demande se fait dans votre portail employé.</div>' +
      '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
      '<div style="margin-bottom:6px;"><b>Référence unique :</b> ' + echappeEmailDemande(demande.reference) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Type de demande :</b> ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Employé :</b> ' + echappeEmailDemande(employeAfficheDoc) + "</div>" +
      (matriculeDoc
        ? '<div style="margin-bottom:6px;"><b>Matricule :</b> ' + echappeEmailDemande(matriculeDoc) + "</div>"
        : "") +
      '<div style="margin-bottom:6px;"><b>Statut :</b> ' + echappeEmailDemande(statutLabel) + "</div>" +
      '<div style="margin-top:10px;font-weight:700;">' + echappeEmailDemande(mentionJointe) + "</div>" +
      '<ul style="margin:6px 0 0;padding-left:22px;">' + lignesHtml + "</ul>" +
      "</div>" +
      '<p style="margin:0 0 10px;">' + (jointes.length
        ? "Le(s) document(s) est/sont <b>joint(s) à cet e-mail</b> ; vous pouvez aussi le(s) visualiser et le(s) télécharger dans la section « Demandes administratives » de votre portail employé."
        : "Vous pouvez visualiser et télécharger ce(s) document(s) dans la section « Demandes administratives » de votre portail employé.") + " Pour toute question, contactez le service RH.</p>" +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique AutoRH (notification SANS réponse).</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Auto-RH-Systeme": "document-disponible" },
      subject: "AutoRH — Document disponible : " + libelleTypeDemande(demande.type) + " " + demande.reference,
      text: texte,
      html: html,
      ...(jointes.length ? { attachments: jointes } : {}),
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
      documents: listeDocs.map(function (d) { return d.nom; }),
    }));
    return { envoye: true, messageId: info.messageId, dest: dest };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/**
 * (NOUVEAU v0.2.180 — DEMANDE UTILISATEUR) Transmission à l'EMPLOYÉ des
 * documents du service RH avec la décision finale d'une demande d'attestation
 * (travail / salaire) ou de parrainage : quand le décideur répond par e-mail
 * avec une décision reconnue (acceptée / refusée) et des pièces jointes
 * (attestation réelle, documents nécessaires…), l'employé reçoit UN SEUL
 * e-mail contenant la décision ET les documents transmis. AUCUN PDF
 * auto-généré (règle v0.2.179) : seules les pièces jointes DU RH partent.
 * JAMAIS bloquant ; sans pièce jointe, AUCUN e-mail (comportement v0.2.179).
 *
 * (MODIFIÉ v0.2.182 — DEMANDE UTILISATEUR) PARRAINAGE : la décision et les
 * documents viennent du RESPONSABLE concerné (boîte dédiée du parrainage —
 * décision unique), l'e-mail parle donc du « responsable de votre demande »
 * au lieu du service RH. Attestations (travail / salaire) : formulation
 * « service RH » strictement inchangée.
 */
async function envoyerEmailDecisionDocumentsRh(demande, statutApres, pieces, cfg, formulationAffichee) {
  const dest = (function () {
    if (!demande.employeEmail) return null;
    try { return cryptoBd.dechiffrerChamp(demande.employeEmail); } catch (e) { return null; }
  })();
  const journalBase = {
    action: "demande-decision-documents-rh",
    dest: dest || "",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
  };
  if (!dest) {
    return { envoye: false, erreur: "Aucune adresse e-mail de notification connue pour l'employé." };
  }
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : transmission des documents du RH non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  const acceptee = statutApres === "ACCEPTEE";
  const statutLabel = libelleStatutDemande(statutApres);
  // (NOUVEAU v0.2.182 — DEMANDE UTILISATEUR) l'AUTEUR des documents dépend du
  // type : pour le PARRAINAGE, la décision ET les documents viennent du
  // RESPONSABLE concerné (boîte dédiée du parrainage — décision unique en une
  // seule étape), pas du service RH ; pour les attestations, l'auteur reste
  // le service RH (formulation historique v0.2.180 conservée).
  const estParrainage = demande.type === "PARRAINAGE";
  const auteurDocuments = estParrainage
    ? "Le responsable de votre demande"
    : "Le service RH";
  const traiteParPhrase = estParrainage
    ? "Votre demande de parrainage a été traitée par le responsable concerné"
    : "Votre demande administrative a été traitée par le service RH";
  const listeDocs = pieces.map(function (d) {
    return { nom: d.filename, taille: formaterTailleDocument(d.content ? d.content.length : 0) };
  });
  // Identité de l'employé (jumelle de la notification « document disponible »).
  let nomEmployeDoc = "";
  try {
    const dj = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}");
    nomEmployeDoc = [dj.prenom, dj.nom].filter(Boolean).join(" ").trim() ||
      String(dj.nomParrain || "").trim();
  } catch (e) { nomEmployeDoc = ""; }
  let cinBrut = "";
  try { cinBrut = String(cryptoBd.dechiffrerChamp(demande.cin) || ""); } catch (e) { cinBrut = ""; }
  if (!nomEmployeDoc && cinBrut) {
    try { nomEmployeDoc = (await nomEmployeDepuisFiches(cinBrut)) || ""; } catch (e) { nomEmployeDoc = ""; }
  }
  const employeAfficheDoc = nomEmployeDoc || "Employé (CIN " + masquerCinDemande(cinBrut) + ")";
  let matriculeDoc = "";
  try { matriculeDoc = await matriculeEmployeDemandes(cinBrut, null); } catch (e) { matriculeDoc = ""; }
  const mentionFormulation = formulationAffichee
    ? " — formulation reconnue : « " + formulationAffichee + " »"
    : "";
  const lignesTexte = listeDocs.map(function (d) { return "    - " + d.nom + " (" + d.taille + ")"; }).join("\n");
  const lignesHtml = listeDocs.map(function (d) {
    return '<li style="margin:3px 0;">' + echappeEmailDemande(d.nom) +
      ' <span style="color:#64748b;font-size:12px;">(' + echappeEmailDemande(d.taille) + ")</span></li>";
  }).join("");
  const texte = [
    "Bonjour,",
    "",
    traiteParPhrase + ".",
    "",
    "  Référence unique           : " + demande.reference,
    "  Type de demande            : " + libelleTypeDemande(demande.type),
    "  Employé                    : " + employeAfficheDoc,
    matriculeDoc ? "  Matricule                  : " + matriculeDoc : null,
    "  Décision                   : " + statutLabel + mentionFormulation,
    "",
    auteurDocuments + " vous transmet le(s) document(s) suivant(s) —",
    "JOINT(S) À CET E-MAIL :",
    lignesTexte,
    "",
    "Vous pouvez aussi visualiser et télécharger ces documents, et suivre la",
    "décision, dans la section « Demandes administratives » de votre portail",
    "employé. Pour toute question, contactez le service RH.",
    "",
    "E-mail automatique AutoRH — notification SANS réponse.",
  ].filter(function (x) { return x !== null; }).join("\n");
  const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<div style="background:' + (acceptee ? "16a34a" : "b91c1c") + ';padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Votre demande : ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + " — " + echappeEmailDemande(statutLabel) + "</div>" +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — AutoRH</div>" +
    "</div>" +
    '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
    '<p style="margin:0 0 14px;">' + echappeEmailDemande(traiteParPhrase) + echappeEmailDemande(mentionFormulation) + '.</p>' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
    '<div style="margin-bottom:6px;"><b>Référence unique :</b> ' + echappeEmailDemande(demande.reference) + "</div>" +
    '<div style="margin-bottom:6px;"><b>Type de demande :</b> ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + "</div>" +
    '<div style="margin-bottom:6px;"><b>Employé :</b> ' + echappeEmailDemande(employeAfficheDoc) + "</div>" +
    (matriculeDoc
      ? '<div style="margin-bottom:6px;"><b>Matricule :</b> ' + echappeEmailDemande(matriculeDoc) + "</div>"
      : "") +
    '<div style="margin-bottom:6px;"><b>Décision :</b> ' + echappeEmailDemande(statutLabel) + "</div>" +
    '</div>' +
    '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
    '<div style="margin-bottom:6px;font-weight:700;">' + echappeEmailDemande(auteurDocuments) + " vous transmet le(s) document(s) suivant(s) — joint(s) à cet e-mail :</div>" +
    '<ul style="margin:6px 0 0;padding-left:22px;">' + lignesHtml + "</ul>" +
    "</div>" +
    '<p style="margin:0 0 10px;">Vous pouvez aussi visualiser et télécharger ces documents, et suivre la décision, dans la section « Demandes administratives » de votre portail employé. Pour toute question, contactez le service RH.</p>' +
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique AutoRH (notification SANS réponse).</p>' +
    "</div></div>";
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // notification SYSTÈME — jamais classée comme réponse (Garde 2).
      headers: { "X-Auto-RH-Systeme": "decision-documents-rh" },
      subject: "AutoRH — Votre demande : " + libelleTypeDemande(demande.type) + " " + demande.reference + " — " + statutLabel + " — documents joints",
      text: texte,
      html: html,
      attachments: pieces,
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
      documents: listeDocs.map(function (d) { return d.nom; }),
    }));
    return { envoye: true, messageId: info.messageId, dest: dest, documents: listeDocs.map(function (d) { return d.nom; }) };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/**
 * CŒUR DE LA RÉCEPTION (Task 122) — rattache un message reçu à une demande,
 * importe les pièces jointes valides, met à jour le statut et notifie
 * l'employé. `parsed` = résultat simpleParser (mailparser). Jamais
 * bloquant : retourne { statut: TRAITE|IGNORE|ERREUR, ... }.
 */
async function envoyerEmailsValidationN1(demande, intention, statutApres, cfg, piecesJointes) {
  const acceptee = intention === "VALIDEE";
  const motAction = acceptee ? "acceptée" : "refusée";
  // (MODIFIÉ v0.2.108 — demande utilisateur) l'auteur de la décision est le
  // destinataire prévu de la demande : le responsable N+1 pour les types à
  // validation hiérarchique (congé, autorisation de sortie), le service RH
  // pour les autres (attestations, parrainage…). La copie au service RH
  // n'est envoyée que lorsque la décision vient du N+1 — l'action du RH
  // n'a pas besoin d'être recopiée au RH lui-même.
  const estAuteurN1 = demande.type === "CONGE" || demande.type === "AUTORISATION_SORTIE";
  const auteurPossessif = estAuteurN1 ? "votre responsable N+1" : "le service RH";
  const auteurNom = estAuteurN1 ? "le responsable N+1" : "le service RH";
  const journalBase = {
    action: "demande-validation-n1",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
    intention: intention,
  };
  // Nom affiché de l'employé : champs du formulaire → fiches de paie → CIN masqué
  let nomEmployeDoc = "";
  try {
    const dj = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}");
    nomEmployeDoc = [dj.prenom, dj.nom].filter(Boolean).join(" ").trim() ||
      String(dj.nomParrain || "").trim();
  } catch (e) { nomEmployeDoc = ""; }
  let cinBrut = "";
  try { cinBrut = String(cryptoBd.dechiffrerChamp(demande.cin) || ""); } catch (e) { cinBrut = ""; }
  if (!nomEmployeDoc && cinBrut) {
    try { nomEmployeDoc = (await nomEmployeDepuisFiches(cinBrut)) || ""; } catch (e) { nomEmployeDoc = ""; }
  }
  const employeAffiche = nomEmployeDoc || "Employé (CIN " + masquerCinDemande(cinBrut) + ")";
  // (NOUVEAU v0.2.107 — demande utilisateur) matricule de l'employé —
  // résolu automatiquement (accès portail prioritaire, sinon fiches de paie
  // du CIN) et affiché dans les e-mails de validation N+1 (vide = ligne omise).
  const matriculeN1 = await matriculeEmployeDemandes(cinBrut, null);
  const typeLib = libelleTypeDemande(demande.type);
  const dateRep = new Date().toLocaleString("fr-FR");

  // Destinataires (MODIFIÉ v0.2.108) : décision du N+1 → copie service RH +
  // employé demandeur ; décision du service RH → employé demandeur UNIQUEMENT.
  const dests = [];
  if (estAuteurN1 && cfg && cfg.rhEmail) dests.push({ dest: cfg.rhEmail, role: "rh" });
  let destEmploye = "";
  if (demande.employeEmail) {
    try { destEmploye = String(cryptoBd.dechiffrerChamp(demande.employeEmail) || "").trim(); }
    catch (e) { destEmploye = ""; }
  }
  if (destEmploye && !dests.some(function (d) { return d.dest === destEmploye; })) {
    dests.push({ dest: destEmploye, role: "employe" });
  }
  const resultats = [];
  for (const d of dests) {
    const texteEmploye = d.role === "employe";
    // (NOUVEAU v0.2.106 — demande utilisateur, point 3) les documents joints
    // par le traitant (pièces jointes de SA réponse e-mail) sont transmis
    // À L'EMPLOYÉ en pièces jointes de la notification (copies RH SANS
    // pièces jointes — le service RH possède déjà les documents).
    const jointesN1 = texteEmploye && Array.isArray(piecesJointes) ? piecesJointes : [];
    const texte = [
      "Bonjour,",
      "",
      texteEmploye
        ? "Votre demande administrative a été " + motAction + " par " + auteurPossessif + "."
        : "La demande administrative ci-dessous a été " + motAction + " par " + auteurNom + " (réponse directe à l'e-mail de la demande).",
      ...(texteEmploye
        ? ["", "NOTIFICATION AUTOMATIQUE — merci de NE PAS répondre à cet e-mail :",
           "les réponses envoyées à cette adresse ne sont pas lues."]
        : []),
      ...(texteEmploye && jointesN1.length
        ? ["", "Document(s) joint(s) à cet e-mail : " + jointesN1.map(function (j) { return j.filename; }).join(", "),
           "(également disponible(s) dans la section « Mes demandes » de votre portail employé)."]
        : []),
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + typeLib,
      "  Employé                    : " + employeAffiche,
      matriculeN1 ? "  Matricule                  : " + matriculeN1 : null,
      "  Statut                     : " + libelleStatutDemande(statutApres),
      "  Réponse du responsable     : " + dateRep,
      "",
      texteEmploye
        ? (acceptee
          ? "Vous pouvez suivre l'avancement de votre demande dans la section"
          : "Vous pouvez consulter le statut de votre demande dans la section")
        : (acceptee
          ? "La demande est désormais au statut « Acceptée » : merci de finaliser son traitement"
          : "La demande est désormais au statut « Refusée » : aucune action supplémentaire requise"),
      texteEmploye
        ? "« Mes demandes » du portail employé."
        : "dans la section « Demandes administratives » du portail d'administration.",
      "",
      ...(texteEmploye
        ? ["E-mail automatique AutoRH — notification SANS réponse."]
        : ["Cet e-mail a été envoyé automatiquement par AutoRH. Si vous n'êtes pas",
           "le destinataire prévu, ignorez et supprimez ce message."]),
    ].join("\n");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:' + (acceptee ? "#16a34a" : "#dc2626") + ';padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">Demande ' + motAction + " par " + auteurNom + " — " + echappeEmailDemande(typeLib) + "</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — AutoRH</div>" +
      "</div>" +
      '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
      "<p style=\"margin:0 0 14px;\">" +
      (texteEmploye
        ? "Votre demande administrative a été <b>" + motAction + "</b> par " + auteurPossessif + "."
        : "La demande administrative ci-dessous a été <b>" + motAction + "</b> par " + auteurNom + " (réponse directe à l'e-mail de la demande).") +
      "</p>" +
      (texteEmploye
        ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;"><b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues.</div>' +
          (jointesN1.length
            ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#166534;font-size:13px;"><b>Document(s) joint(s) à cet e-mail :</b> ' + echappeEmailDemande(jointesN1.map(function (j) { return j.filename; }).join(", ")) + " — également disponible(s) dans la section « Mes demandes » de votre portail employé.</div>"
            : "")
        : "") +
      '<div style="background:#FFF9F3;border:1px solid #e2e8f0;border-radius:8px;padding:10px 0;margin-bottom:14px;">' +
      '<table style="border-collapse:collapse;width:100%;">' +
      '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Référence unique</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(demande.reference) + "</b></td></tr>" +
      '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Type de demande</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(typeLib) + "</b></td></tr>" +
      '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Employé</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(employeAffiche) + "</b></td></tr>" +
      (matriculeN1
        ? '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Matricule</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(matriculeN1) + "</b></td></tr>"
        : "") +
      '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Statut</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(libelleStatutDemande(statutApres)) + "</b></td></tr>" +
      '<tr><td style="padding:6px 14px;color:#475569;font-size:13px;white-space:nowrap;">Réponse du responsable</td><td style="padding:6px 14px;"><b style="color:#0f172a;">' + echappeEmailDemande(dateRep) + "</b></td></tr>" +
      "</table></div>" +
      (texteEmploye
        ? '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique AutoRH (notification SANS réponse).</p>'
        : '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par AutoRH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>') +
      "</div></div>";
    try {
      if (!nodemailerDemandes || !cfg || !cfg.host) {
        journaliserEnvoiDemandes(Object.assign({}, journalBase, {
          dest: d.dest, succes: false, code: "MAIL_NON_CONFIGURE",
          erreur: "Serveur SMTP non configuré : notification de validation non envoyée.",
        }));
        resultats.push({ dest: d.dest, envoye: false });
        continue;
      }
      const transport = nodemailerDemandes.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
        tls: { rejectUnauthorized: false },
      });
      const info = await transport.sendMail({
        from: expediteurEffectifDemandes(cfg),
        to: d.dest,
        // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
        headers: { "X-Auto-RH-Systeme": "notification-employe" },
        subject: texteEmploye
          ? "AutoRH — Votre demande " + typeLib + " " + demande.reference + " a été " + motAction + " par " + auteurPossessif
          : "AutoRH — " + typeLib + " " + demande.reference + " " + motAction + " par " + auteurNom,
        text: texte,
        html: html,
        ...(jointesN1.length ? { attachments: jointesN1 } : {}),
      });
      journaliserEnvoiDemandes(Object.assign({}, journalBase, {
        dest: d.dest,
        role: d.role,
        succes: true,
        messageId: info.messageId,
        reponseSmtp: info.response || "",
      }));
      resultats.push({ dest: d.dest, envoye: true });
    } catch (e) {
      journaliserEnvoiDemandes(Object.assign({}, journalBase, {
        dest: d.dest,
        role: d.role,
        succes: false,
        code: "SMTP_ECHEC",
        erreur: e && e.message ? e.message : String(e),
      }));
      resultats.push({ dest: d.dest, envoye: false });
    }
  }
  return { envoyees: resultats.filter(function (r) { return r.envoye; }).length, detail: resultats };
}

/**
 * (NOUVEAU Task 178) — NOTIFICATION DE DÉCISION AUTOMATIQUE À L'EMPLOYÉ.
 * Envoyée quand la réponse e-mail du manager d'une demande de congé est
 * reconnue comme une VALIDATION (« Congé accepté », « Je valide »…) ou un
 * REFUS (« Congé refusé », « Je refuse »…). Liste les pièces jointes reçues
 * avec la réponse le cas échéant. Non bloquante et journalisée.
 * Retourne { envoye, dest, messageId?, erreur? }.
 */
// (MODIFIÉ Task 181) paramètre refuseePar : libellé RAFFINÉ du statut final
// (« Refusée par le Manager » / « Refusée par les RH ») + libellés de type
// (congé OU autorisation de sortie — validation à deux étapes).
async function envoyerEmailDecisionConge(demande, statutApres, formulations, docs, cfg, refuseePar, opts) {
  // (NOUVEAU v0.2.168) opts : { pieceJointe: { filename, content, contentType },
  // cc: [adresses], documentSigneNom } — le PDF signé électroniquement est
  // JOINT à cette réponse automatique (une seule notification à l'employé),
  // avec copies au service RH et au manager. JAMAIS bloquant : sans pièce
  // jointe (génération absente/échouée), la réponse part quand même.
  // (MODIFIÉ v0.2.188 — DEMANDE UTILISATEUR) la pièce jointe PDF n'est plus
  // fournie QUE pour une ACCEPTATION : en cas de REFUS (congé / autorisation),
  // AUCUN PDF de refus n'est généré ni envoyé — pieceJointe vaut null et
  // l'e-mail de notification de refus part SANS document officiel.
  // (NOUVEAU v0.2.171) opts.piecesReponses : [{ filename, content,
  // contentType }] — TOUTES les pièces jointes fournies par le RH et/ou le
  // manager dans LEURS réponses e-mail (réponse courante + antérieures,
  // cumulées) sont transmises au demandeur avec la notification — aucune
  // pièce jointe n'est perdue (REFUS : c'est le SEUL transport des fichiers
  // des décideurs depuis v0.2.188, le PDF de refus n'existant plus ;
  // ACCEPTATION : elles accompagnent toujours le PDF signé). JAMAIS
  // bloquant : liste absente/vide → e-mail sans ces pièces.
  const o = opts || {};
  // (MODIFIÉ v0.2.193 — DEMANDE UTILISATEUR) LES NOTIFICATIONS D'ACCEPTATION /
  // DE REFUS SONT TOUJOURS ENVOYÉES — employé « À », service RH et manager en
  // copies, comportement historique — QUELLE QUE SOIT la position des
  // interrupteurs. Les interrupteurs du panneau « Envoi par e-mail (réponse
  // PDF en pièce jointe) » ne gouvernent PLUS QUE LA RÉPONSE PDF (le document
  // signé et tamponné joint à la décision) :
  //   o.avecPdf = { employe, rh, manager } — drapeaux EFFECTIFS (maître ET
  //   interrupteur du destinataire, calculés par l'appelant) :
  //     - true  → ce destinataire reçoit la notification AVEC le PDF joint ;
  //     - false → il reçoit LA MÊME notification SANS le PDF.
  //   Défaut (absent) : tous true — comportement historique inchangé.
  //   o.rh / o.manager : adresses historiques des copies (boîte RH, boîte du
  //   manager destinataire de la demande). Repli : o.cc = [rh, manager].
  // En pratique : UN message quand tous les drapeaux valent la même chose
  // (ou quand aucun PDF n'est disponible — refus v0.2.188, maître OFF),
  // DEUX messages sinon (groupe « avec PDF » + groupe « sans PDF ») — même
  // objet, même corps, mêmes pièces des décideurs ; seul le PDF joint varie.
  const avecPdf = Object.assign({ employe: true, rh: true, manager: true }, o.avecPdf || {});
  const pieceJointe = o.pieceJointe && o.pieceJointe.content ? o.pieceJointe : null;
  // (v0.2.171) assemblage des pièces jointes FINALES de l'e-mail : le PDF
  // signé d'abord (nom prioritaire), puis les pièces jointes des réponses
  // (dédupliquées par nom — collision → suffixe « -2 », « -3 »…).
  const piecesReponses = Array.isArray(o.piecesReponses)
    ? o.piecesReponses.filter(function (p) { return p && p.content && p.filename; })
    : [];
  const piecesTotales = [];
  const nomsPrisEnvoi = new Set();
  if (pieceJointe) {
    piecesTotales.push(pieceJointe);
    nomsPrisEnvoi.add(String(pieceJointe.filename).toLowerCase());
  }
  for (const pr of piecesReponses) {
    let nom = String(pr.filename);
    let n = 2;
    while (nomsPrisEnvoi.has(nom.toLowerCase())) {
      const point = nom.lastIndexOf(".");
      const base = point > 0 ? nom.slice(0, point) : nom;
      const ext = point > 0 ? nom.slice(point) : "";
      nom = base + "-" + n + ext;
      n++;
    }
    nomsPrisEnvoi.add(nom.toLowerCase());
    piecesTotales.push({ filename: nom, content: pr.content, contentType: pr.contentType || "application/octet-stream" });
  }
  const ccListe = (Array.isArray(o.cc) ? o.cc : []).filter(Boolean).filter(function (x, i, t) { return t.indexOf(x) === i; });
  const dest = (function () {
    if (!demande.employeEmail) return null;
    try { return cryptoBd.dechiffrerChamp(demande.employeEmail); } catch (e) { return null; }
  })();
  // (NOUVEAU v0.2.193) adresses historiques PAR RÔLE — o.rh / o.manager
  // prioritaires ; repli sur o.cc = [rh, manager] (ancien format).
  const adresseRh = String(o.rh || "").trim() || (ccListe[0] || "");
  const adresseManager = String(o.manager || "").trim() ||
    (ccListe.filter(function (x) { return x !== adresseRh; })[0] || "");
  // (MODIFIÉ v0.2.193) GROUPES de destinataires : le PDF est joint au groupe
  // « avec PDF » (maître ON ET interrupteur du destinataire ON) ; tout
  // destinataire exclu reçoit LA MÊME notification SANS le PDF — personne
  // n'est JAMAIS retiré de la notification. Au sein de CHAQUE message,
  // l'employé membre du groupe en reste le destinataire « À » ; sinon le
  // premier membre (RH puis manager) est promu « À » (sémantique historique).
  function membresGroupe(vouluAvecPdf) {
    const membres = [];
    // (v0.2.193) AUCUN PDF disponible (refus — v0.2.188, génération absente,
    // maître OFF) → les drapeaux de la réponse PDF sont SANS EFFET : tout le
    // monde reçoit LA notification (personne n'est jamais exclu).
    const retenu = (k) => (!pieceJointe ? true : (vouluAvecPdf ? avecPdf[k] : !avecPdf[k]));
    if (dest && retenu("employe")) membres.push(dest);
    if (adresseRh && adresseRh !== dest && retenu("rh")) membres.push(adresseRh);
    if (adresseManager && adresseManager !== dest && membres.indexOf(adresseManager) < 0 && retenu("manager")) membres.push(adresseManager);
    return membres;
  }
  const membresAvecPdf = pieceJointe ? membresGroupe(true) : [];
  const membresSansPdf = membresGroupe(false);
  // Messages prévus : au plus DEUX — « avec PDF » d'abord, puis « sans PDF ».
  const envoisPrevus = [];
  if (membresAvecPdf.length) envoisPrevus.push({ a: membresAvecPdf[0], cc: membresAvecPdf.slice(1), pdf: pieceJointe });
  if (membresSansPdf.length) envoisPrevus.push({ a: membresSansPdf[0], cc: membresSansPdf.slice(1), pdf: null });
  const journalCommun = {
    action: "demande-decision-notification",
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
    statut: statutApres,
    pieceJointeSignee: pieceJointe ? pieceJointe.filename : null,
    // (NOUVEAU v0.2.171) pièces jointes des réponses transmises au demandeur.
    piecesJointesReponses: piecesTotales
      .filter(function (p) { return p !== pieceJointe; })
      .map(function (p) { return p.filename; }),
  };
  // (MODIFIÉ v0.2.193) adresse employé inconnue : PLUS JAMAIS bloquant — la
  // notification part aux copies (RH / manager) ; l'employé la retrouve dans
  // son portail (« Mes demandes »).
  // (MODIFIÉ v0.2.193) AUCUNE adresse connue (employé sans e-mail ET aucune
  // copie RH/manager) → AUCUN envoi, incident journalisé — jamais bloquant.
  // (Avant v0.2.193 ce cas pouvait provenir des interrupteurs ; désormais
  // les interrupteurs n'excluent PLUS PERSONNE de la notification.)
  if (!envoisPrevus.length) {
    journaliserEnvoiDemandes(Object.assign({}, journalCommun, { dest: "", cc: [], succes: false, code: "AUCUN_DESTINATAIRE", erreur: "Aucune adresse de notification connue (employé sans e-mail et aucune copie RH/manager)." }));
    return { envoye: false, erreur: "Aucune adresse e-mail de notification connue (employé + RH + manager)." };
  }
  const validee = statutApres === "VALIDEE" || statutApres === "ACCEPTEE";
  const statutLabel = libelleStatutFinalDemande(statutApres, refuseePar);
  const typeLibBas = libelleTypeDemande(demande.type);
  const formulationsAffichees = (formulations || []).slice(0, 3).map(function (f) { return "« " + f + " »"; }).join(", ");
  // (MODIFIÉ v0.2.171) liste affichée = pièces jointes des réponses RÉELLEMENT
  // TRANSMISES avec l'e-mail (piecesTotales hors PDF signé, qui a son propre
  // encadré) — plus l'ancien listing des seuls documents de la réponse
  // courante renvoyé vers « Mes demandes ».
  const listeDocs = piecesTotales
    .filter(function (p) { return p !== pieceJointe; })
    .map(function (p) {
      return { nom: p.filename, taille: formaterTailleDocument(p.content.length) };
    });
  // Nom de l'employé (même règle que la notification « document disponible »)
  let nomEmployeDec = "";
  try {
    const dj = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}");
    nomEmployeDec = [dj.prenom, dj.nom].filter(Boolean).join(" ").trim() ||
      String(dj.nomParrain || "").trim();
  } catch (e) { nomEmployeDec = ""; }
  let cinBrutDec = "";
  try { cinBrutDec = String(cryptoBd.dechiffrerChamp(demande.cin) || ""); } catch (e) { cinBrutDec = ""; }
  if (!nomEmployeDec && cinBrutDec) {
    try { nomEmployeDec = (await nomEmployeDepuisFiches(cinBrutDec)) || ""; } catch (e) { nomEmployeDec = ""; }
  }
  const employeAfficheDec = nomEmployeDec || "Employé (CIN " + masquerCinDemande(cinBrutDec) + ")";
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : notification de décision non envoyée.";
    journaliserEnvoiDemandes(Object.assign({}, journalCommun, { dest: (envoisPrevus[0] && envoisPrevus[0].a) || "", cc: envoisPrevus[0] ? envoisPrevus[0].cc : [], succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    // (NOUVEAU v0.2.193) UN envoi PAR GROUPE (au plus deux) : « avec PDF »
    // puis « sans PDF » — même objet, même corps, mêmes pièces des décideurs ;
    // seul le PDF signé varie. Une panne SMTP sur un groupe n'empêche PAS
    // l'autre groupe de partir (chaque envoi a son propre try/catch).
    let envoisOk = 0;
    let dernierMessageId = "";
    const erreursEnvoi = [];
    for (const prevu of envoisPrevus) {
      const pjMessage = prevu.pdf;
      const piecesMessage = pjMessage
        ? piecesTotales
        : piecesTotales.filter(function (p) { return p !== pieceJointe; });
      const journalBase = Object.assign({}, journalCommun, {
        dest: prevu.a || "",
        cc: prevu.cc,
        // (NOUVEAU v0.2.193) l'envoi portait-il la réponse PDF ?
        reponsePdf: Boolean(pjMessage),
      });
      const blocDocsTexte = listeDocs.length
        ? ["", "Pièce(s) jointe(s) fournie(s) par le RH / le manager dans leur réponse", "e-mail — transmise(s) avec cet e-mail (aucune pièce jointe n'est perdue) :", ""].concat(
            listeDocs.map(function (d) { return "    - " + d.nom + " (" + d.taille + ")"; }),
            ["", "Elles sont également disponibles dans la section « Mes demandes » de votre portail."]
          ).join("\n")
        : "";
      const texte = [
        "Bonjour,",
        "",
        validee
          ? "Bonne nouvelle : votre " + typeLibBas.toLowerCase() + " a été ACCEPTÉE."
          : "Votre " + typeLibBas.toLowerCase() + " a été REFUSÉE (" + statutLabel + ").",
        "",
        "  Référence unique           : " + demande.reference,
        "  Type de demande            : " + libelleTypeDemande(demande.type),
        "  Employé                    : " + employeAfficheDec,
        "  Statut                     : " + statutLabel,
        ...(formulationsAffichees ? [
          "",
          "Décision prise automatiquement à partir de la réponse e-mail du manager",
          "(formulation reconnue : " + formulationsAffichees + ").",
        ] : []),
        blocDocsTexte,
        ...(pjMessage ? [
          "",
          "Le document officiel signé électroniquement est JOINT à cet e-mail :",
          "    - " + pjMessage.filename,
          "  Il est également disponible dans la section « Mes demandes » du portail.",
        ] : [
          "",
          "Le document officiel est disponible dans la section « Mes demandes » du portail.",
        ]),
        "",
        "Cet e-mail a été envoyé automatiquement par Auto-RH. Si vous n'êtes pas",
        "le destinataire prévu, ignorez et supprimez ce message.",
      ].join("\n");
      const lignesDocsHtml = listeDocs.map(function (d) {
        return '<li style="margin:3px 0;">' + echappeEmailDemande(d.nom) +
          ' <span style="color:#64748b;font-size:12px;">(' + echappeEmailDemande(d.taille) + ")</span></li>";
      }).join("");
      const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid ' + (validee ? "#a7f3d0" : "#fecaca") + ';border-radius:12px;overflow:hidden;">' +
        '<div style="background:' + (validee ? "#047857" : "#b91c1c") + ';padding:18px 22px;color:#fff;">' +
        '<div style="font-size:18px;font-weight:700;">' +
        echappeEmailDemande(typeLibBas) + (validee ? " acceptée" : " refusée") + " — " + echappeEmailDemande(demande.reference) + "</div>" +
        '<div style="font-size:12px;opacity:.85;margin-top:4px;">Auto-RH</div>' +
        "</div>" +
        '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
        '<p style="margin:0 0 14px;">' +
        (validee
          ? "Bonne nouvelle : votre " + echappeEmailDemande(typeLibBas.toLowerCase()) + " a été <b>acceptée</b>."
          : "Votre " + echappeEmailDemande(typeLibBas.toLowerCase()) + " a été <b>refusée</b> (" + echappeEmailDemande(statutLabel) + ").") +
        "</p>" +
        '<div style="background:' + (validee ? "#ecfdf5" : "#fef2f2") + ';border:1px solid ' + (validee ? "#a7f3d0" : "#fecaca") + ';border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
        '<div style="margin-bottom:6px;"><b>Référence unique :</b> ' + echappeEmailDemande(demande.reference) + "</div>" +
        '<div style="margin-bottom:6px;"><b>Type de demande :</b> ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + "</div>" +
        '<div style="margin-bottom:6px;"><b>Employé :</b> ' + echappeEmailDemande(employeAfficheDec) + "</div>" +
        '<div style="margin-bottom:6px;"><b>Statut :</b> ' + echappeEmailDemande(statutLabel) + "</div>" +
        (formulationsAffichees
          ? '<div style="margin-top:10px;font-size:12.5px;color:#64748b;">Décision prise automatiquement à partir de la réponse e-mail du manager (formulation reconnue : ' + echappeEmailDemande(formulationsAffichees) + ").</div>"
          : "") +
        (listeDocs.length
          ? '<div style="margin-top:10px;font-weight:700;">Pièce(s) jointe(s) du RH / du manager — transmise(s) avec cet e-mail :</div><ul style="margin:6px 0 0;padding-left:22px;">' + lignesDocsHtml + "</ul>"
          : "") +
        "</div>" +
        (listeDocs.length
          ? '<p style="margin:0 0 10px;">Aucune pièce jointe n\'est perdue : tous les documents fournis par le RH ou le manager dans leur réponse e-mail vous sont transmis avec cet e-mail (et restent disponibles dans « Mes demandes »).</p>'
          : "") +
        (pjMessage
          ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin:0 0 14px;"><b>📄 Document officiel joint :</b> ' + echappeEmailDemande(pjMessage.filename) + ' — signé électroniquement, il fait foi. Il est également disponible dans « Mes demandes ».</div>'
          : '') +
        '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto-RH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
        "</div></div>";
      try {
        const info = await transport.sendMail({
          from: from,
          // (MODIFIÉ v0.2.193) « À » = employé du groupe (ou premier membre
          // promu : RH puis manager) — la notification part TOUJOURS ; seuls
          // les drapeaux de la réponse PDF répartissent les destinataires
          // entre le message avec PDF et le message sans PDF.
          to: prevu.a,
          // (NOUVEAU v0.2.168) copies au service RH et au manager (autres
          // acteurs de la décision) — omises quand aucune adresse valide.
          ...(prevu.cc.length ? { cc: prevu.cc } : {}),
          // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
          headers: { "X-Auto-RH-Systeme": "decision-demande" },
          subject: "Auto-RH — " + typeLibBas + " " + (validee ? "acceptée" : "refusée") + " : " + demande.reference,
          text: texte,
          html: html,
          // (v0.2.168/171, MODIFIÉ v0.2.193) le PDF signé n'est joint QU'AU
          // groupe « avec PDF » ; les pièces des décideurs accompagnent
          // TOUTES les notifications (aucune pièce n'est perdue).
          ...(piecesMessage.length ? { attachments: piecesMessage } : {}),
        });
        journaliserEnvoiDemandes(Object.assign(journalBase, {
          from: from,
          succes: true,
          messageId: info.messageId,
          reponseSmtp: info.response || "",
          formulations: formulations || [],
          documents: listeDocs.map(function (d) { return d.nom; }),
        }));
        envoisOk++;
        dernierMessageId = info.messageId || dernierMessageId;
      } catch (eEnvoi) {
        const erreurEnvoi = eEnvoi && eEnvoi.message ? eEnvoi.message : String(eEnvoi);
        journaliserEnvoiDemandes(Object.assign(journalBase, { from: from, succes: false, code: "SMTP_ECHEC", erreur: erreurEnvoi }));
        erreursEnvoi.push(erreurEnvoi);
      }
    }
    if (!envoisOk) {
      return { envoye: false, erreur: erreursEnvoi.join(" | ") || "Échec d'envoi SMTP." };
    }
    return {
      envoye: true,
      messageId: dernierMessageId,
      dest: dest || (envoisPrevus[0] && envoisPrevus[0].a) || "",
      cc: (function () { const t = []; for (const p of envoisPrevus) for (const x of p.cc) if (t.indexOf(x) < 0) t.push(x); return t; })(),
      pieceJointe: pieceJointe ? pieceJointe.filename : null,
      piecesReponses: listeDocs.map(function (d) { return d.nom; }),
      piecesReponsesTotal: piecesTotales.length,
      // (NOUVEAU v0.2.193) résumé de la répartition de la réponse PDF
      reponsePdfPour: membresAvecPdf.slice(),
      sansReponsePdfPour: membresSansPdf.slice(),
      envois: envoisOk,
    };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign({}, journalCommun, { dest: (envoisPrevus[0] && envoisPrevus[0].a) || "", cc: envoisPrevus[0] ? envoisPrevus[0].cc : [], succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/**
 * CŒUR DE LA RÉCEPTION (Task 122) — rattache un message reçu à une demande,
 * importe les pièces jointes valides, met à jour le statut et notifie
 * l'employé. `parsed` = résultat simpleParser (mailparser). Jamais
 * bloquant : retourne { statut: TRAITE|IGNORE|ERREUR, ... }.
 */
/**
 * (NOUVEAU Task 179) — DOCUMENT D'ACCEPTATION SIGNÉ ÉLECTRONIQUEMENT ET
 * TAMPONNÉ : quand une demande de congé devient VALIDÉE (réponse e-mail du
 * manager reconnue — Task 178) ou qu'une AUTORISATION DE SORTIE passe à
 * ACCEPTEE (réponse avec document), le document officiel est généré
 * automatiquement (toutes les informations de la demande), TAMponné
 * (paraphe + cachet + mention) et SIGNÉ ÉLECTRONIQUEMENT avec le certificat
 * configuré depuis l'administration, puis conservé (visible dans « Mes
 * demandes » de l'employé) et ENVOYÉ automatiquement à l'employé, au
 * service RH et au manager. JAMAIS bloquant : tout incident est tracé sur
 * la demande (docSigneErreur) et journalisé — la décision e-mail reste
 * appliquée quoi qu'il arrive.
 */
const documentAcceptation = require("./document-acceptation.js");

// ============================================================================
// NOUVEAU (Task 181) — TRANSMISSION AUTOMATIQUE AUX RH + NOTIFICATION DU
// REFUS MANAGER (validation à deux étapes Manager → RH)
// ============================================================================

/** Lecture DÉCHIFFRÉE d'un fichier stocké au niveau module (candidats
 *  STORAGE_CANDIDATES + cwd — même convention que optionsMoteurDocument). */
async function lireFichierStockeGlobal(cheminRelatif) {
  const candidats = (STORAGE_CANDIDATES || []).map(function (p) {
    return path.join(path.dirname(p), cheminRelatif);
  });
  candidats.push(path.join(process.cwd(), cheminRelatif));
  for (const candidat of candidats) {
    try {
      if (fs.existsSync(candidat)) {
        return decryptFromStorage(fs.readFileSync(candidat));
      }
    } catch (e) { /* essai suivant */ }
  }
  return null;
}

/**
 * (NOUVEAU v0.2.168) Lecture DÉCHIFFRÉE d'un DOCUMENT de demande (PDF signé
 * généré par les modules document-acceptation / document-refus) — candidats
 * = dossiers documents-demandes (dossierEcritureDocumentsDemandes +
 * candidatsDocumentsDemandes + repli cwd). JAMAIS bloquant (null si absent).
 */
function lireDocumentDemandeStocke(cheminRelatif) {
  if (!cheminRelatif) return null;
  const candidats = [path.join(dossierEcritureDocumentsDemandes(), cheminRelatif)];
  for (const dir of candidatsDocumentsDemandes()) {
    candidats.push(path.join(dir, cheminRelatif));
  }
  candidats.push(path.join(process.cwd(), "storage", "documents-demandes", cheminRelatif));
  for (const candidat of candidats) {
    try {
      if (fs.existsSync(candidat)) {
        return decryptFromStorage(fs.readFileSync(candidat));
      }
    } catch (e) { /* essai suivant */ }
  }
  return null;
}

/** Paires d'information de la demande pour les e-mails RH (jumelle allégée
 *  de pairesInfosDemande — congé et autorisation de sortie). */
function infosPairesPourEmailRh(demande) {
  let donnees = {};
  try { donnees = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}"); }
  catch (e) { donnees = {}; }
  const infos = [];
  if (demande.type === "CONGE") {
    if (donnees.typeConge) infos.push(["Type de congé", String(donnees.typeConge)]);
    if (donnees.dateDebut) infos.push(["Date de début", String(donnees.dateDebut)]);
    if (donnees.dateFin) infos.push(["Date de fin", String(donnees.dateFin)]);
    if (donnees.emailN1) infos.push(["E-mail du N+1 / responsable", String(donnees.emailN1)]);
    if (donnees.commentaire) infos.push(["Commentaire", String(donnees.commentaire)]);
  } else if (demande.type === "AUTORISATION_SORTIE") {
    if (donnees.date) infos.push(["Date", String(donnees.date)]);
    if (donnees.nom) infos.push(["Nom et prénom", String(donnees.nom)]);
    if (donnees.departement) infos.push(["Département", String(donnees.departement)]);
    if (donnees.motif) infos.push(["Motif", String(donnees.motif)]);
    if (donnees.nombreHeures) infos.push(["Nombre d'heures", String(donnees.nombreHeures)]);
    if (donnees.heureSortie) infos.push(["Heure de sortie", String(donnees.heureSortie)]);
    if (donnees.heureRetour) infos.push(["Heure de retour", String(donnees.heureRetour)]);
  }
  return infos;
}

/** Nom affiché de l'employé (formulaire → fiches → générique). */
async function nomAfficheDemande(demande) {
  let nom = "";
  try {
    const dj = JSON.parse(cryptoBd.dechiffrerChamp(demande.donnees) || "{}");
    nom = [dj.prenom, dj.nom].filter(Boolean).join(" ").trim() || String(dj.nomParrain || "").trim();
  } catch (e) { nom = ""; }
  let cinBrut = "";
  try { cinBrut = String(cryptoBd.dechiffrerChamp(demande.cin) || ""); } catch (e) { cinBrut = ""; }
  if (!nom && cinBrut) {
    try { nom = (await nomEmployeDepuisFiches(cinBrut)) || ""; } catch (e) { nom = ""; }
  }
  return nom || "Employé (CIN " + masquerCinDemande(cinBrut) + ")";
}

/** Pièces jointes DÉCHIFFRÉES de la demande pour la transmission RH :
 *  d'abord les documents VIENT d'être reçus de la réponse du manager
 *  (importes), puis les documents déjà associés à la demande — dédupliqués
 *  par chemin stocké. JAMAIS bloquant (pièces illisibles ignorées). */
async function piecesJointesPourTransmissionRh(demande, importes) {
  const candidats = [];
  for (const d of importes || []) candidats.push(d);
  try {
    const tous = await prisma.documentDemande.findMany({
      where: { demandeId: demande.id },
      orderBy: { recuLe: "asc" },
    });
    for (const d of tous) candidats.push(d);
  } catch (e) { /* repli : seules les pièces récentes */ }
  const pieces = [];
  const dejaVus = new Set();
  for (const doc of candidats) {
    if (!doc || !doc.chemin || dejaVus.has(doc.chemin)) continue;
    dejaVus.add(doc.chemin);
    try {
      // (CORRIGÉ v0.2.171) lecture DÉDIÉE documents-demandes (candidats du
      // moteur de documents) + repli lecteur global — les pièces jointes des
      // réponses vivent dans storage/documents-demandes/.
      const contenu = lireDocumentDemandeStocke(doc.chemin) || (await lireFichierStockeGlobal(doc.chemin));
      if (contenu && contenu.length) {
        pieces.push({
          filename: doc.nomFichier || "document",
          content: contenu,
          contentType: doc.typeMime || "application/octet-stream",
        });
      }
    } catch (e) { /* pièce ignorée — jamais bloquant */ }
  }
  return pieces;
}

/** (NOUVEAU v0.2.171) PIÈCES JOINTES DES RÉPONSES → TRANSMISES AU DEMANDEUR.
 *  Construit la liste des pièces jointes à transmettre au DEMANDEUR avec la
 *  réponse de décision : TOUTES les pièces jointes fournies par les décideurs
 *  (RH et/ou manager) dans LEURS réponses e-mail — exigence « aucune pièce
 *  jointe n'est perdue, tous les documents sont correctement transmis au
 *  demandeur » :
 *    - la réponse COURANTE d'abord (importes — pièces jointes de l'e-mail de
 *      décision qui vient d'être reconnu) ;
 *    - puis les pièces jointes des réponses ANTÉRIEURES (DocumentDemande dont
 *      recuDe est une adresse e-mail — recuDe vide = pièce d'ORIGINE déposée
 *      avec la demande, recuDe « Génération automatique… » = document signé
 *      généré par le système : ni l'une ni l'autre n'est renvoyée à
 *      l'employé — il possède déjà les siennes et le PDF signé est joint à
 *      part). Ainsi, quand le manager a répondu avec des pièces jointes à
 *      l'étape 1 puis que la réponse RH achève la matrice, les pièces du
 *      manager ET celles du RH partent ensemble au demandeur.
 *  Dédupliquées par chemin stocké ; collision de nom → suffixe « -2 », « -3 ».
 *  JAMAIS bloquant : pièce illisible ignorée. */
async function piecesJointesReponsesPourEmploye(demande, importes) {
  const candidats = [];
  for (const d of importes || []) candidats.push(d);
  try {
    const anterieures = await prisma.documentDemande.findMany({
      where: { demandeId: demande.id, recuDe: { contains: "@" } },
      orderBy: { recuLe: "asc" },
    });
    for (const d of anterieures) candidats.push(d);
  } catch (e) { /* repli : seules les pièces récentes */ }
  const pieces = [];
  const dejaVus = new Set();
  const nomsPris = new Set();
  for (const doc of candidats) {
    if (!doc || !doc.chemin || dejaVus.has(doc.chemin)) continue;
    dejaVus.add(doc.chemin);
    try {
      // (CORRIGÉ v0.2.171) les pièces jointes des réponses sont stockées dans
      // storage/documents-demandes/ — lecture par le lecteur DÉDIÉ (candidats
      // documents-demandes), avec repli sur le lecteur global (autres stockages).
      const contenu = lireDocumentDemandeStocke(doc.chemin) || (await lireFichierStockeGlobal(doc.chemin));
      if (contenu && contenu.length) {
        let nom = doc.nomFichier || "document";
        let n = 2;
        while (nomsPris.has(nom.toLowerCase())) {
          const point = nom.lastIndexOf(".");
          const base = point > 0 ? nom.slice(0, point) : nom;
          const ext = point > 0 ? nom.slice(point) : "";
          nom = base + "-" + n + ext;
          n++;
        }
        nomsPris.add(nom.toLowerCase());
        pieces.push({
          filename: nom,
          content: contenu,
          contentType: doc.typeMime || "application/octet-stream",
        });
      }
    } catch (e) { /* pièce ignorée — jamais bloquant */ }
  }
  return pieces;
}

/** (Task 181) TRANSMISSION AUTOMATIQUE AUX RH — envoyée quand le MANAGER
 *  accepte (réponse e-mail reconnue) et que le service RH n'a pas encore
 *  décidé : rappel de la demande, de la décision du manager (formulation
 *  reconnue) et pièces jointes (demande + documents du manager). L'e-mail
 *  part vers l'adresse du service RH (cfg.rhEmail). Non bloquant. */
async function envoyerEmailTransmissionRh(demande, importes, cfg, formulation) {
  const dest = cfg && cfg.rhEmail ? cfg.rhEmail : "";
  const journalBase = {
    action: "demande-transmission-rh",
    dest: dest,
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
    decisionManager: "ACCEPTEE",
  };
  if (!dest) {
    const erreur = "E-mail du service RH non configuré (onglet Accès portail → routage) : transmission non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "RH_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  const pieces = await piecesJointesPourTransmissionRh(demande, importes);
  const infos = infosPairesPourEmailRh(demande);
  const employe = await nomAfficheDemande(demande);
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : transmission aux RH non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  try {
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    const typeLib = libelleTypeDemande(demande.type);
    const lignesInfos = infos.map(function (p) { return "  " + p[0] + " : " + p[1]; }).join("\n");
    const texte = [
      "Bonjour,",
      "",
      "Une demande a été ACCEPTÉE PAR LE MANAGER — votre validation (étape RH) est requise.",
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + typeLib,
      "  Employé                    : " + employe,
      "  Décision manager           : Acceptée (réponse e-mail reconnue" + (formulation ? " — « " + formulation + " »" : "") + ")",
      ...(lignesInfos ? ["", "Informations de la demande :", lignesInfos] : []),
      ...(pieces.length ? ["", "Pièces jointes : " + pieces.map(function (p) { return p.filename; }).join(", ")] : []),
      "",
      "Traitez cette demande depuis l'administration (onglet Demandes) ou",
      "répondez directement à CET E-MAIL (Répondre — ne pas modifier l'objet) :",
      "  ACCEPTER  : « Congé accepté », « Je valide », « J'accorde », « D'accord », « OK »",
      "  REFUSER   : « Congé refusé », « Je refuse », « Désaccord », « NON », « Refus »",
      "Votre réponse (envoyée depuis cette adresse du service RH) sera enregistrée",
      "automatiquement comme décision RH et achèvera la validation à deux étapes",
      "(statut final « Acceptée » ou « Refusée par les RH »).",
      "",
      "Cet e-mail a été envoyé automatiquement par Auto-RH.",
    ].join("\n");
    const lignesInfosHtml = infos.map(function (p) {
      return '<div style="margin-bottom:4px;"><b>' + echappeEmailDemande(p[0]) + " :</b> " + echappeEmailDemande(p[1]) + "</div>";
    }).join("");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #bfdbfe;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#1d4ed8;padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">' + echappeEmailDemande(typeLib) + " " + echappeEmailDemande(demande.reference) + " — acceptée par le manager</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Validation à deux étapes — décision RH requise</div>' +
      "</div>" +
      '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
      '<p style="margin:0 0 14px;">Le manager a <b>accepté</b> la demande (réponse e-mail reconnue' + (formulation ? " — « " + echappeEmailDemande(formulation) + " »" : "") + "). Votre décision RH achèvera la validation.</p>" +
      '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
      '<p style="margin:0 0 6px;font-weight:600;color:#166534;">Réponse par e-mail possible (v0.2.146)</p>' +
      '<p style="margin:0 0 6px;">Répondez directement à cet e-mail (<b>Répondre</b>, sans modifier l\'objet) depuis cette adresse du service RH — votre formulation sera reconnue automatiquement :</p>' +
      '<p style="margin:0 0 4px;"><b>Accepter :</b> « Congé accepté », « Je valide », « J\'accorde », « D\'accord », « OK »</p>' +
      '<p style="margin:0;"><b>Refuser :</b> « Congé refusé », « Je refuse », « Désaccord », « NON », « Refus »</p>' +
      '</div>' +
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
      '<div style="margin-bottom:6px;"><b>Référence :</b> ' + echappeEmailDemande(demande.reference) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Type :</b> ' + echappeEmailDemande(typeLib) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Employé :</b> ' + echappeEmailDemande(employe) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Décision manager :</b> Acceptée' + (formulation ? " (« " + echappeEmailDemande(formulation) + " »)" : "") + "</div>" +
      lignesInfosHtml +
      "</div>" +
      (pieces.length
        ? '<p style="margin:0 0 10px;"><b>Pièces jointes :</b> ' + pieces.map(function (p) { return echappeEmailDemande(p.filename); }).join(", ") + "</p>"
        : "") +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto-RH.</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Auto-RH-Systeme": "transmission-rh" },
      subject: "Auto-RH — " + typeLib + " " + demande.reference + " acceptée par le manager — validation RH requise",
      text: texte,
      html: html,
      ...(pieces.length ? { attachments: pieces } : {}),
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
      piecesJointes: pieces.map(function (p) { return p.filename; }),
    }));
    return { envoye: true, messageId: info.messageId, dest: dest };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

/** (Task 181) NOTIFICATION DU SERVICE RH après REFUS DU MANAGER : le refus
 *  est immédiat et définitif — AUCUNE transmission aux RH, mais le service
 *  RH est informé (cahier des charges du workflow e-mail). Non bloquant.
 *  (MODIFIÉ v0.2.187 — DEMANDE UTILISATEUR) cette notification n'est PLUS
 *  envoyée pour le PARRAINAGE : après le refus du responsable (décision
 *  unique, boîte dédiée v0.2.178), aucun e-mail de notification de refus
 *  ne part vers le service RH — le point d'appel unique exclut désormais
 *  demande.type === "PARRAINAGE" (congé / autorisation inchangés). */
async function envoyerEmailRefusManagerRh(demande, cfg, formulation) {
  const dest = cfg && cfg.rhEmail ? cfg.rhEmail : "";
  const journalBase = {
    action: "demande-refus-manager-rh",
    dest: dest,
    from: "",
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : 0,
    secure: cfg ? cfg.port === 465 : false,
    reference: demande.reference,
    type: demande.type,
    decisionManager: "REFUSEE",
  };
  if (!dest) {
    const erreur = "E-mail du service RH non configuré : notification du refus non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "RH_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  if (!nodemailerDemandes || !cfg || !cfg.host) {
    const erreur = "Serveur SMTP non configuré : notification du refus non envoyée.";
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "MAIL_NON_CONFIGURE", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
  try {
    const infos = infosPairesPourEmailRh(demande);
    const employe = await nomAfficheDemande(demande);
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const from = expediteurEffectifDemandes(cfg);
    const typeLib = libelleTypeDemande(demande.type);
    const texte = [
      "Bonjour,",
      "",
      "Une demande a été REFUSÉE PAR LE MANAGER (décision immédiate et définitive",
      "— elle ne vous est PAS transmise pour validation).",
      "",
      "  Référence unique           : " + demande.reference,
      "  Type de demande            : " + typeLib,
      "  Employé                    : " + employe,
      "  Décision manager           : Refusée (réponse e-mail reconnue" + (formulation ? " — « " + formulation + " »" : "") + ")",
      "",
      "L'employé a été notifié du refus et le document de décision de refus signé",
      "électroniquement a été généré automatiquement.",
      "",
      "Cet e-mail a été envoyé automatiquement par Auto-RH.",
    ].join("\n");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #fecaca;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#b91c1c;padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">' + echappeEmailDemande(typeLib) + " " + echappeEmailDemande(demande.reference) + " — refusée par le manager</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Validation à deux étapes — information service RH</div>' +
      "</div>" +
      '<div style="padding:20px 22px;color:#334155;font-size:14px;">' +
      '<p style="margin:0 0 14px;">La demande a été <b>refusée par le manager</b> (réponse e-mail reconnue' + (formulation ? " — « " + echappeEmailDemande(formulation) + " »" : "") + "). Refus immédiat et définitif : elle ne vous est pas transmise.</p>" +
      '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:14px;">' +
      '<div style="margin-bottom:6px;"><b>Référence :</b> ' + echappeEmailDemande(demande.reference) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Type :</b> ' + echappeEmailDemande(typeLib) + "</div>" +
      '<div style="margin-bottom:6px;"><b>Employé :</b> ' + echappeEmailDemande(employe) + "</div>" +
      "</div>" +
      '<p style="margin:0;color:#94a3b8;font-size:12px;">L’employé a été notifié ; le document de refus signé électroniquement a été généré. E-mail envoyé automatiquement par Auto-RH.</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Auto-RH-Systeme": "refus-manager" },
      subject: "Auto-RH — " + typeLib + " " + demande.reference + " refusée par le manager",
      text: texte,
      html: html,
    });
    journaliserEnvoiDemandes(Object.assign(journalBase, {
      from: from,
      succes: true,
      messageId: info.messageId,
      reponseSmtp: info.response || "",
    }));
    return { envoye: true, messageId: info.messageId, dest: dest };
  } catch (e) {
    const erreur = e && e.message ? e.message : String(e);
    journaliserEnvoiDemandes(Object.assign(journalBase, { succes: false, code: "SMTP_ECHEC", erreur: erreur }));
    return { envoye: false, erreur: erreur };
  }
}

// (NOUVEAU Task 180) moteur du document de REFUS signé & tamponné
const documentRefus = require("./document-refus.js");

/**
 * (Task 180) Options communes des DEUX moteurs de documents (acceptation /
 * refus) : outils injectés par le portail — lecture déchiffrée du certificat,
 * résolution d'identité, envoi SMTP, journalisation, chiffrement.
 */
async function optionsMoteurDocument(declencheur, action) {
  // lecture DÉCHIFFRÉE d'un fichier stocké (certificat) — mêmes candidats
  // de dossiers que les fiches (STORAGE_CANDIDATES + cwd)
  const lireFichierStocke = async function (cheminRelatif) {
    const candidats = (STORAGE_CANDIDATES || []).map(function (p) {
      return path.join(path.dirname(p), cheminRelatif);
    });
    candidats.push(path.join(process.cwd(), cheminRelatif));
    for (const candidat of candidats) {
      try {
        if (fs.existsSync(candidat)) {
          return decryptFromStorage(fs.readFileSync(candidat));
        }
      } catch (e) { /* essai suivant */ }
    }
    return null;
  };
  // Identité : Accès portail « Nom et prénom » → fiches → formulaire
  const resoudreIdentite = async function (_prisma, cin, donnees) {
    let nom = "";
    let matricule = "";
    try {
      if (cin) {
        const acces = await prisma.portalAccess.findUnique({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
        if (acces && acces.nomPrenom) {
          nom = String(cryptoBd.dechiffrerChamp(acces.nomPrenom) || "").trim();
        }
        if (!nom) nom = (await nomEmployeDepuisFiches(cin)) || "";
        if (!matricule) {
          const idx = cryptoBd.chiffrerChamp(cin, true);
          const fiche = idx
            ? await prisma.payslip.findFirst({ where: { cinIndex: idx }, orderBy: { uploadedAt: "desc" }, select: { matricule: true } })
            : null;
          if (fiche && fiche.matricule) matricule = String(cryptoBd.dechiffrerChamp(fiche.matricule) || "").trim();
        }
      }
    } catch (e) { /* jamais bloquant */ }
    if (!nom) {
      nom = [donnees.prenom, donnees.nom].filter(Boolean).join(" ").trim() ||
        String(donnees.nom || "").trim() || String(donnees.nomParrain || "").trim() || "";
    }
    return { nom: nom, matricule: matricule };
  };
  // Envoi via le SMTP du portail (même configuration que les demandes)
  // (MODIFIÉ v0.2.158 — Task 205) « 553 Sender is not allowed to relay » :
  // quand le message du moteur porte un champ `from` VIDE ou undefined, il
  // ÉCRASE l'expéditeur par défaut (Object.assign) et Zoho refuse l'envoi.
  // L'expéditeur du portail est donc rétabli pour TOUT message qui ne définit
  // pas lui-même un expéditeur valide.
  const envoyerMail = async function (message) {
    const cfg = await lireConfigMailDemandes();
    if (!cfg || !cfg.host || !nodemailerDemandes) {
      throw new Error("Serveur SMTP non configuré (portail).");
    }
    const messageNet = Object.assign({}, message);
    const fromPropre = String(messageNet.from || "").trim();
    if (!fromPropre || !emailValideDemande(fromPropre.replace(/^.*</, "").replace(/>.*/, ""))) {
      messageNet.from = expediteurEffectifDemandes(cfg);
    }
    const transport = nodemailerDemandes.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.username && cfg.password ? { user: cfg.username, pass: cfg.password } : undefined,
      tls: { rejectUnauthorized: false },
    });
    const info = await transport.sendMail(messageNet);
    return { messageId: info.messageId || "", response: info.response || "" };
  };
  return {
    dechiffrerChamp: cryptoBd.dechiffrerChamp,
    // le portail n'a PAS de middleware Prisma : les moteurs chiffrent
    // eux-mêmes les traces de destinataires via chiffrerChamp.
    chiffrerChamp: cryptoBd.chiffrerChamp,
    encryptForStorage: encryptForStorage,
    decryptFromStorage: decryptFromStorage,
    lireFichierStocke: lireFichierStocke,
    dossierDocumentsDemandes: dossierEcritureDocumentsDemandes(),
    resoudreIdentite: resoudreIdentite,
    envoyerMail: envoyerMail,
    journaliser: function (e) {
      journaliserEnvoiDemandes(Object.assign({}, e, { action: action || "doc-signe" }));
    },
    declencheur: declencheur || "Réponse e-mail (portail)",
  };
}

async function traiterDocumentSigneAcceptation(demandeId, declencheur, opts) {
  try {
    const statutsAcceptes = documentAcceptation.STATUTS_ACCEPTES;
    const demande = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
    if (!demande) return null;
    // congé : ACCEPTEE/VALIDEE ; autorisation : ACCEPTEE (module partagé)
    if (documentAcceptation.TYPES_DOCUMENT_SIGNE.indexOf(demande.type) < 0) return null;
    if (statutsAcceptes.indexOf(demande.statut) < 0) return null;
    return await documentAcceptation.traiterAcceptationFinale(
      prisma,
      demandeId,
      Object.assign(await optionsMoteurDocument(declencheur, "doc-signe"), opts || {})
    );
  } catch (e) {
    journaliserEnvoiDemandes({
      action: "doc-signe",
      succes: false,
      code: "DOC_SIGNE_ECHEC",
      erreur: (e && e.message) || String(e),
      reference: "",
      type: null,
    });
    return { genere: false, erreur: (e && e.message) || String(e) };
  }
}

/**
 * (NOUVEAU Task 180) Déclencheur PORTAIL du document de REFUS signé &
 * tamponné : appelé dès qu'une demande devient REFUSÉE suite à une réponse
 * e-mail reconnue (Task 178 — « Congé refusé », « Je refuse », …). TOUS les
 * types sont concernés (congé, autorisation, attestations, parrainage).
 * JAMAIS bloquant : tout incident est tracé (docRefusErreur) et journalisé
 * (action « doc-refus ») — la décision e-mail reste appliquée quoi qu'il arrive.
 */
async function traiterDocumentRefusDecision(demandeId, declencheur, opts) {
  try {
    const demande = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
    if (!demande) return null;
    if (documentRefus.TYPES_REFUS.indexOf(demande.type) < 0) return null;
    if (demande.statut !== documentRefus.STATUT_REFUS) return null;
    return await documentRefus.traiterRefus(
      prisma,
      demandeId,
      Object.assign(await optionsMoteurDocument(declencheur, "doc-refus"), opts || {})
    );
  } catch (e) {
    journaliserEnvoiDemandes({
      action: "doc-refus",
      succes: false,
      code: "DOC_REFUS_ECHEC",
      erreur: (e && e.message) || String(e),
      reference: "",
      type: null,
    });
    return { genere: false, erreur: (e && e.message) || String(e) };
  }
}


async function traiterMessageRecu(parsed) {
  const sujet = String((parsed && parsed.subject) || "");
  const exp = parsed && parsed.from && parsed.from.value && parsed.from.value[0]
    ? String(parsed.from.value[0].address || "").toLowerCase().trim()
    : "";
  // (v0.2.163) trace d'ENTRÉE : chaque message analysé est journalisé (sujet,
  // expéditeur, In-Reply-To) — condition sine qua non du diagnostic « où est
  // passée ma réponse ? ». JAMAIS bloquant.
  console.log("[RECEPTION] " + new Date().toISOString() + " | analyse message | de=" + (exp || "?") + " | sujet=" + sujet.slice(0, 110) + (parsed && parsed.inReplyTo ? " | irt=" + String(parsed.inReplyTo).slice(0, 48) : ""));
  // ---- 1) retrouver la demande ----
  let demande = null;
  const candidatsIds = [];
  if (parsed && parsed.inReplyTo) candidatsIds.push(String(parsed.inReplyTo));
  if (parsed && parsed.references) {
    const refs = Array.isArray(parsed.references)
      ? parsed.references.map(String)
      : String(parsed.references).split(/\s+/);
    for (const r of refs) if (r) candidatsIds.push(r);
  }
  const idsPropres = [...new Set(
    candidatsIds.map(function (x) { return x.replace(/[<>]/g, "").trim(); }).filter(Boolean)
  )];
  if (idsPropres.length) {
    demande = await prisma.demandeAdministrative.findFirst({
      where: { messageIdEnvoi: { in: idsPropres } },
    });
  }
  if (!demande) {
    const m = sujet.match(/DEM-\d{4}-\d{5}/i);
    if (m) {
      demande = await prisma.demandeAdministrative.findUnique({
        where: { reference: m[0].toUpperCase() },
      });
    }
  }
  if (!demande) {
    return { statut: "IGNORE", motif: "Aucune demande ne correspond à ce message (sujet : " + sujet.slice(0, 100) + ")" };
  }
  // ---- 1 bis) (NOUVEAU v0.2.158 — Task 205) GARDES ANTI-BOUCLE ----
  // GARDE 1 — l'e-mail de la DEMANDE elle-même : quand le destinataire est la
  // boîte SMTP elle-même (demande auto-adressée), l'e-mail de demande REVIENS
  // dans INBOX ; son Message-ID est EXACTEMENT messageIdEnvoi. Il ne doit
  // JAMAIS être traité comme une réponse : son corps contient le texte du
  // FORMULAIRE (ex. « Compensation des heures : Non — heures non compensées »)
  // que le classificateur peut prendre pour un REFUS (faux refus mesuré en
  // réel — trace 1a11d0d9b629c401). Une VRAIE réponse a TOUJOURS un Message-ID
  // différent (généré par le client de messagerie de celui qui répond).
  const idMessagePropre = parsed && parsed.messageId
    ? String(parsed.messageId).replace(/[<>]/g, "").trim() : "";
  const idEnvoiPropre = demande.messageIdEnvoi
    ? String(demande.messageIdEnvoi).replace(/[<>]/g, "").trim() : "";
  if (idMessagePropre && idEnvoiPropre && idMessagePropre === idEnvoiPropre) {
    journaliserEnvoiDemandes({
      action: "demande-document",
      from: exp,
      succes: true,
      ignore: true,
      reference: demande.reference,
      type: demande.type,
      motif: "E-mail de la demande elle-même (Message-ID = Message-ID d'envoi) — jamais traité comme une réponse.",
    });
    return { statut: "IGNORE", motif: "E-mail de la demande elle-même (Message-ID d'envoi identique) — pas une réponse.", reference: demande.reference, expediteur: exp };
  }
  // GARDE 2 — notifications SANS réponse émises par le système (documents
  // signés, décisions…) qui reviennent dans INBOX quand un destinataire est
  // la boîte SMTP elle-même (Cc manager auto-adressé) : ces messages portent
  // l'en-tête X-Auto-RH-Systeme et ne doivent jamais être classifiés.
  // (CORRIGÉ v0.2.178 — découvert en campagne E2E réelle) mailparser
  // normalise le nom d'en-tête en MINUSCULES en CONSERVANT les séparateurs
  // d'origine : « X-Auto-RH-Systeme » devient « x-auto-rh-systeme »
  // (AVEC l'espace). L'ancienne lecture « x-auto-rh-systeme » (tirets)
  // renvoyait TOUJOURS undefined : la garde ne s'activait JAMAIS — une copie
  // Cc d'une décision (sujet « … acceptée : DEM-… ») pouvait être
  // re-classifiée et trancher une AUTRE demande portant la même référence.
  try {
    const enteteSysteme = parsed && parsed.headers && typeof parsed.headers.get === "function"
      ? (parsed.headers.get("x-auto-rh-systeme") || parsed.headers.get("x-auto-rh-systeme"))
      : null;
    if (enteteSysteme) {
      return { statut: "IGNORE", motif: "Notification automatique du système (X-Auto-RH-Systeme : " + String(enteteSysteme).slice(0, 60) + ") — pas une réponse exploitable.", reference: demande.reference, expediteur: exp };
    }
  } catch (e) { /* jamais bloquant */ }
  // ---- 1 ter) (NOUVEAU v0.2.162) DÉDOUBLONNAGE Message-ID — une réponse du
  // RH existe souvent en DEUX exemplaires (copie INBOX + copie « Envoyés »
  // quand il répond depuis la boîte du système) : ne la traiter qu'UNE fois.
  // La trace est l'entrée reponsesRecues portant le même messageId (posée par
  // le premier traitement — INBOX non lue OU boîte Envoyés, peu importe).
  if (idMessagePropre && reponseDejaTraitee(demande, idMessagePropre)) {
    return { statut: "IGNORE", motif: "Réponse déjà traitée (doublon Message-ID INBOX/Envoyés)", reference: demande.reference, expediteur: exp };
  }
  // ---- 2) contrôle de l'expéditeur + RÔLE DE LA RÉPONSE (MODIFIÉ v0.2.146 puis v0.2.151) ----
  // Deux expéditeurs légitimes :
  //   - le DESTINATAIRE de la demande (le manager responsable) → décision
  //     MANAGER (étape 1, Task 178/181 — comportement inchangé) ;
  //   - (v0.2.146) l'ADRESSE DU SERVICE RH (cfg.rhEmail — celle qui
  //     reçoit l'e-mail de transmission « — validation RH requise ») quand la
  //     demande a été adressée au manager → décision RH (étape 2) : les RH
  //     peuvent répondre par e-mail (« Acceptée », « Je valide », « D'accord »
  //     / « Refusée », « Je refuse », « NON »…), la décision est enregistrée
  //     automatiquement et le statut final suit la matrice ;
  //   - (NOUVEAU v0.2.151 — MÊME TRAITEMENT POUR LES E-MAILS RH) quand la
  //     demande a été adressée DIRECTEMENT à la boîte du service RH (repli
  //     « aucun manager responsable affecté » de destinatairePourDemande),
  //     la réponse de CETTE boîte est une décision RH (et non manager) :
  //     l'étape manager de la matrice ne peut JAMAIS être satisfaite par
  //     e-mail, elle est donc satisfaite AUTOMATIQUEMENT (section 5) — la
  //     réponse RH achève la validation en UNE SEULE étape (formulations,
  //     tolérances, négations, ambiguïtés, historique et pièces jointes :
  //     EXACTEMENT le même traitement que pour le manager).
  let destAttendu = "";
  if (demande.destinataire) {
    try { destAttendu = String(cryptoBd.dechiffrerChamp(demande.destinataire) || "").toLowerCase().trim(); }
    catch (e) { destAttendu = ""; }
  }
  if (!exp) {
    return { statut: "IGNORE", motif: "Expéditeur illisible", reference: demande.reference };
  }
  const cfgMail = await lireConfigMailDemandes();
  const rhAdresse = cfgMail && cfgMail.rhEmail ? String(cfgMail.rhEmail).toLowerCase().trim() : "";
  // (NOUVEAU v0.2.151) la demande a-t-elle été adressée DIRECTEMENT à la
  // boîte du service RH (routage de repli quand AUCUN manager responsable
  // n'est affecté à l'employé — destinatairePourDemande) ?
  const demandeAdresseeRh = Boolean(
    destAttendu && rhAdresse && destAttendu === rhAdresse
  );
  // ---- (NOUVEAU v0.2.163) MANAGER RESPONSABLE de l'employé — 3ᵉ expéditeur
  // légitime ----
  // Les demandes d'ATTESTATION sont routées à la boîte du service RH
  // (destinatairePourDemande) : quand le MANAGER RESPONSABLE de l'employé
  // répond (comportement observé en production — réponses restées sans effet
  // « Expéditeur non autorisé »), sa décision doit être acceptée. Son adresse
  // est résolue depuis l'accès portail de l'employé de la demande
  // (managerId → email, sinon mailEnvoyeA). JAMAIS bloquant.
  let managerResponsable = "";
  try {
    const accEmp = demande.cin
      ? await prisma.portalAccess.findUnique({ where: { cin: demande.cin } })
      : null;
    if (accEmp && accEmp.managerId) {
      const mgr = await prisma.portalAccess.findUnique({ where: { id: accEmp.managerId } });
      let emailMgr = "";
      if (mgr && mgr.email) {
        try { emailMgr = String(cryptoBd.dechiffrerChamp(mgr.email) || "").toLowerCase().trim(); }
        catch (e) { emailMgr = ""; }
      }
      if (!emailMgr && mgr && mgr.mailEnvoyeA) {
        try { emailMgr = String(cryptoBd.dechiffrerChamp(mgr.mailEnvoyeA) || "").toLowerCase().trim(); }
        catch (e) { emailMgr = ""; }
      }
      managerResponsable = emailMgr;
    }
  } catch (e) { managerResponsable = ""; }
  const expManagerResponsable = Boolean(
    managerResponsable && exp === managerResponsable && exp !== destAttendu
  );
  // ---- (NOUVEAU v0.2.196) ADRESSE DÉDIÉE DES ATTESTATIONS — 4ᵉ expéditeur
  // légitime ----
  // La copie des demandes d'attestation part à la boîte DÉDIÉE du type
  // (attestationTravailEmail / attestationSalaireEmail — v0.2.196) : sa
  // réponse est une décision RH (rôle « rh »), au même titre que la boîte du
  // service RH — avant v0.2.196 cette boîte ÉTAIT le destinataire principal
  // (Task 197) et ses réponses étaient donc acceptées ; la continuité est
  // préservée. JAMAIS bloquant : l'adresse dédiée n'est lue que pour LE type
  // de la demande (travail ↔ attestationTravailEmail, salaire ↔ idem).
  let attestationDediee = "";
  if (demande.type === "ATTESTATION_TRAVAIL" && cfgMail.attestationTravailEmail) {
    attestationDediee = String(cfgMail.attestationTravailEmail).toLowerCase().trim();
  } else if (demande.type === "ATTESTATION_SALAIRE" && cfgMail.attestationSalaireEmail) {
    attestationDediee = String(cfgMail.attestationSalaireEmail).toLowerCase().trim();
  }
  const expAttestationDediee = Boolean(
    attestationDediee && exp === attestationDediee && exp !== destAttendu
  );
  let roleReponse = "manager"; // repli historique : destinataire absent → aucun garde possible
  if (destAttendu && exp !== destAttendu) {
    // L'expéditeur n'est pas le destinataire principal : dérogations —
    // (v0.2.146) la réponse vient de la boîte du service RH alors que la
    // demande avait été adressée au manager → décision RH (étape 2) ;
    // (v0.2.163) la réponse vient du MANAGER RESPONSABLE de l'employé :
    //   - demande adressée au service RH (attestations, routage rhEmail) →
    //     décision d'AUTORITÉ FINALE en une seule étape (rôle « rh » — la
    //     matrice à deux étapes n'a pas de sens : la demande n'est pas
    //     routée au manager) ;
    //   - demande adressée à un autre destinataire → décision MANAGER
    //     (étape 1) ;
    // (v0.2.196) la réponse vient de l'ADRESSE DÉDIÉE des attestations
    //   (copie systématique depuis v0.2.196) → décision RH (rôle « rh »).
    if (rhAdresse && exp === rhAdresse && destAttendu !== rhAdresse) {
      roleReponse = "rh";
    } else if (expManagerResponsable) {
      roleReponse = demandeAdresseeRh ? "rh" : "manager";
    } else if (expAttestationDediee) {
      roleReponse = "rh";
    } else {
      return { statut: "IGNORE", motif: "Expéditeur non autorisé (attendu : " + destAttendu + ")", reference: demande.reference, expediteur: exp };
    }
  } else if (demandeAdresseeRh) {
    // (NOUVEAU v0.2.151) l'expéditeur EST le destinataire ET ce destinataire
    // est la boîte du service RH → l'acteur est le SERVICE RH (décision RH,
    // étape manager satisfaite automatiquement en section 5).
    roleReponse = "rh";
  }
  // ---- 2.5) (NOUVEAU Task 178) CLASSIFICATION AUTOMATIQUE DU CONTENU ----
  // Demandes de congé : le contenu de la réponse (sujet + corps) est analysé
  // pour reconnaître les formulations d'acceptation / de refus du cahier des
  // charges — même si la formulation varie (casse, accents, ponctuation,
  // texte autour). Réponse ambiguë ou non reconnue → AUCUNE décision
  // automatique (la demande reste « En attente »).
  const classificationActive = TYPES_CLASSIFICATION_AUTO.indexOf(demande.type) >= 0;
  let classification = null;
  if (classificationActive) {
    classification = classificationReponses.classifierReponse(sujet, extraireTexteMessage(parsed));
  }
  // ---- 3) pièces jointes exploitables uniquement (liste blanche + taille) ----
  const atts = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const valides = [];
  const detailPj = [];
  for (const a of atts) {
    const contenu = a && a.content && Buffer.isBuffer(a.content) ? a.content : null;
    if (!contenu || !contenu.length) continue;
    const nomAssaini = assainirNomDocument(a.filename);
    let ext = extensionDocument(nomAssaini);
    if (EXTENSIONS_DOCUMENTS.indexOf(ext) < 0) {
      // repli : type MIME connu et nom absent (ex. « document.pdf » sans nom)
      if (!nomAssaini && a.contentType) {
        const ct = String(a.contentType).toLowerCase();
        if (ct === "application/pdf") ext = "pdf";
        else if (ct === "image/png") ext = "png";
        else if (ct === "image/jpeg") ext = "jpg";
        else if (ct.indexOf("wordprocessingml") >= 0) ext = "docx";
        else if (ct === "application/msword") ext = "doc";
      }
    }
    detailPj.push(nomAssaini || "(sans nom)");
    if (EXTENSIONS_DOCUMENTS.indexOf(ext) < 0) continue; // extension refusée
    if (contenu.length > TAILLE_MAX_DOCUMENT) continue;   // trop volumineux
    valides.push({
      nom: nomAssaini || ("document-" + demande.reference.toLowerCase() + "." + ext),
      ext: ext,
      contenu: contenu,
      typeMime: mimeDepuisExtension(ext),
    });
  }
  if (!valides.length) {
    // (MODIFIÉ Task 178) une réponse de CONGÉ SANS pièce jointe mais dont le
    // contenu contient une décision reconnue (validation/refus) est
    // DORÉNAVANT traitée — les réponses texte seul ne sont plus ignorées.
    if (classificationActive && classification && classification.decisive) {
      // continuer : décision à appliquer (aucune pièce jointe à importer)
    } else {
      // (NOUVEAU Task 194) la réponse ambiguë / non reconnue est malgré tout
      // enregistrée dans l'HISTORIQUE de la demande (cahier des charges §3.5
      // et §5 : le RH doit pouvoir consulter le texte original — le statut
      // reste « En attente »).
      await enregistrerReponseRecue(demande, entreeReponseRecue(demande, {
        messageId: idMessagePropre,
        de: exp,
        role: roleReponse,
        sujet: sujet,
        texte: extraireTexteMessage(parsed),
        decision: classificationActive && classification ? classification.decision : null,
        formulations: classificationActive && classification ? classification.formulations : [],
        piecesJointes: detailPj,
        statutAvant: demande.statut,
        statutApres: demande.statut,
      }));
      return {
        statut: "IGNORE",
        motif: classificationActive
          ? "Réponse sans pièce jointe exploitable et sans formulation d'acceptation/refus reconnue dans le contenu (la demande reste « En attente »)"
          : "Aucune pièce jointe exploitable (extensions acceptées : " + EXTENSIONS_DOCUMENTS.join(", ") + " ; 15 Mo max)",
        reference: demande.reference,
        expediteur: exp,
        piecesJointes: detailPj,
        ...(classificationActive ? { decision: classification.decision } : {}),
      };
    }
  }
  // ---- 4) import dédupliqué (empreinte SHA-256) + stockage chiffré ----
  const dossier = dossierEcritureDocumentsDemandes();
  fs.mkdirSync(dossier, { recursive: true });
  const importes = [];
  let compteur = 0;
  for (const v of valides) {
    const empreinte = crypto.createHash("sha256").update(v.contenu).digest("hex");
    const deja = await prisma.documentDemande.findFirst({
      where: { demandeId: demande.id, empreinte: empreinte },
      select: { id: true },
    });
    if (deja) continue; // doublon (renvoi du même fichier) — jamais réimporté
    compteur++;
    const nomStocke = demande.reference + "-" + Date.now() + "-" + compteur + "-" + empreinte.slice(0, 8) + "." + v.ext;
    fs.writeFileSync(path.join(dossier, nomStocke), encryptForStorage(v.contenu));
    const doc = await prisma.documentDemande.create({
      data: {
        demandeId: demande.id,
        nomFichier: v.nom,
        chemin: nomStocke,
        taille: v.contenu.length,
        typeMime: v.typeMime,
        empreinte: empreinte,
        // (v0.2.51) la pièce jointe e-mail n'est JAMAIS retouchée : les
        // octets d'origine sont ceux du contenu stocké.
        empreinteOrigine: empreinte,
        recuDe: exp,
      },
    });
    importes.push(doc);
  }
  if (!importes.length && !(classificationActive && classification && classification.decisive)) {
    // (NOUVEAU Task 194) doublon : l'historique conserve malgré tout la
    // trace de cette réponse (pièces jointes déjà importées).
    await enregistrerReponseRecue(demande, entreeReponseRecue(demande, {
      messageId: idMessagePropre,
      de: exp,
      role: roleReponse,
      sujet: sujet,
      texte: extraireTexteMessage(parsed),
      decision: classificationActive && classification ? classification.decision : null,
      formulations: classificationActive && classification ? classification.formulations : [],
      piecesJointes: detailPj,
      piecesJointesImportees: [],
      statutAvant: demande.statut,
      statutApres: demande.statut,
    }));
    return { statut: "IGNORE", motif: "Document(s) déjà importé(s) précédemment (doublon détecté)", reference: demande.reference, expediteur: exp };
  }
  // ---- 5) STATUT AUTOMATIQUE (MODIFIÉ Task 181 — VALIDATION À DEUX ÉTAPES) ----
  // La décision reconnue dans la réponse e-mail est la décision du MANAGER
  // (étape 1 de la validation à deux étapes) : elle est tracée dans les
  // champs decisionManager* et le statut FINAL est recalculé par la MATRICE
  // (Manager × RH — jumelle de src/lib/demandes.ts). Elle NE finalise PLUS la
  // demande à elle seule :
  //   - le MANAGER accepte → TRANSMISSION AUTOMATIQUE AUX RH (pièces jointes
  //     de la demande + documents du manager) tant que les RH n'ont pas
  //     décidé — la demande reste « En attente » ;
  //   - le MANAGER refuse → REFUS IMMÉDIAT ET DÉFINITIF (« Refusée par le
  //     Manager ») : e-mail de refus à l'employé + notification du service
  //     RH, AUCUNE transmission aux RH ;
  //   - RH déjà accepté + manager accepte → statut final « Acceptée »
  //     (document signé Task 179 + notification employé).
  const statutAvant = demande.statut;
  let statutApres = statutAvant;
  const maj = {};
  const decision = classification ? classification.decision : null;
  const decisionApplicable =
    classificationActive &&
    classification &&
    classification.decisive &&
    (statutAvant === "EN_ATTENTE" || statutAvant === "INFORMATION_REQUISE");
  const formulationAffichee = classification && Array.isArray(classification.formulations) && classification.formulations.length
    ? String(classification.formulations[0] || "")
    : "";
  let transmissionRh = null;      // (Task 181) transmission automatique aux RH
  let notificationRhRefus = null; // (Task 181) notification RH du refus manager
  let notificationEtapeIntermediaire = false; // (NOUVEAU v0.2.184) « document disponible » envoyée à l'employé à une étape intermédiaire (pièces jointes, décision non finale)
  if (
    decisionApplicable &&
    roleReponse === "manager" &&
    demande.type === "PARRAINAGE"
  ) {
    // =====================================================================
    // (NOUVEAU v0.2.178 — demande utilisateur) PARRAINAGE — DÉCISION UNIQUE
    // =====================================================================
    // La demande de parrainage est adressée à l'ADRESSE DÉDIÉE du parrainage
    // (MailConfig.parrainageEmail). Le destinataire de CETTE boîte répond par
    // e-mail avec les MÊMES expressions que le congé / l'autorisation
    // (« J'accepte votre demande », « OK », « D'accord », « Je valide »,
    // « J'approuve », « Je vous accorde », « Acceptée », « Validée »,
    // « Approuvée », « Accordée », « Délivrée » / « Je refuse », « Refus »,
    // « Non », « Désaccord », « Pas d'accord », « Hors de question »,
    // « Refusée », « Je ne valide pas », « Je n'accepte pas », « Je ne peux
    // pas accepter »… — mêmes tolérances : casse, accents, apostrophes,
    // ponctuation, texte autour, citations). Sa décision est FINALE en UNE
    // SEULE étape (la matrice à deux étapes n'a pas de sens : la demande
    // n'est PAS transmise au manager puis aux RH) :
    //   - ACCEPTATION → statut « Acceptée » IMMÉDIAT + réponse automatique à
    //     l'employé avec le PDF d'acceptation signé (si la signature est
    //     activée) — pas de transmission aux RH ;
    //   - REFUS → statut « Refusée » IMMÉDIAT ET DÉFINITIF + réponse
    //     automatique avec le PDF de refus signé — refuseePar=« PARRAINAGE »
    //     (les libellés MANAGER/RH ne s'appliquent pas : l'affichage reste
    //     « Refusée » partout, portail et administration).
    const validationParrainage = decision === classificationReponses.DECISIONS.VALIDATION;
    maj.decisionManager = validationParrainage ? "ACCEPTEE" : "REFUSEE";
    maj.decisionManagerLe = new Date();
    maj.decisionManagerPar = "Service parrainage (réponse e-mail)";
    maj.decisionManagerNote = formulationAffichee
      ? "Formulation reconnue : « " + formulationAffichee + " ». Décision unique du destinataire de la demande de parrainage (validation en une seule étape)."
      : "Décision unique du destinataire de la demande de parrainage (validation en une seule étape).";
    statutApres = validationParrainage ? "ACCEPTEE" : "REFUSEE";
    maj.statut = statutApres;
    if (!validationParrainage) maj.refuseePar = "PARRAINAGE";
    maj.traitePar = "Service parrainage (réponse e-mail)";
    maj.traiteLe = new Date();
    maj.commentaire = String(
      (demande.commentaire ? demande.commentaire + " — " : "") +
      (validationParrainage
        ? "Acceptée par le service chargé du parrainage (réponse e-mail" +
          (formulationAffichee ? " — formulation reconnue : « " + formulationAffichee + " »" : "") +
          ") — décision unique et définitive."
        : "Refusée par le service chargé du parrainage — décision immédiate et définitive (réponse e-mail" +
          (formulationAffichee ? " — formulation reconnue : « " + formulationAffichee + " »" : "") +
          ").")
    ).slice(0, 800);
  } else if (decisionApplicable && roleReponse === "manager") {
    if (decision === classificationReponses.DECISIONS.VALIDATION) {
      // ===== ÉTAPE 1 : le MANAGER ACCEPTE =====
      maj.decisionManager = "ACCEPTEE";
      maj.decisionManagerLe = new Date();
      maj.decisionManagerPar = "Manager (réponse e-mail)";
      maj.decisionManagerNote = formulationAffichee
        ? "Formulation reconnue : « " + formulationAffichee + " »."
        : null;
      const finale = calculerStatutFinalDeuxEtapes("ACCEPTEE", demande.decisionRh);
      statutApres = finale.statut;
      if (statutApres === "ACCEPTEE") {
        // Matrice complète : les RH avaient DÉJÀ accepté → décision FINALE.
        maj.statut = "ACCEPTEE";
        maj.refuseePar = null;
        maj.traitePar = "Manager (réponse e-mail)";
        maj.traiteLe = new Date();
        const mention = "Validation à deux étapes complète : manager ET service RH ont accepté" +
          (formulationAffichee ? " — formulation reconnue : « " + formulationAffichee + " »." : ".");
        maj.commentaire = String(
          (demande.commentaire ? demande.commentaire + " — " : "") + mention
        ).slice(0, 800);
      } else {
        // Les RH n'ont pas encore décidé : la demande RESTE « En attente »,
        // transmission automatique aux RH (section 6 ci-dessous).
        maj.statut = statutAvant === "INFORMATION_REQUISE" ? "EN_ATTENTE" : statutAvant;
        if (!demande.commentaire) {
          maj.commentaire = "Acceptée par le manager" +
            (formulationAffichee ? " (« " + formulationAffichee + " »)" : "") +
            " — transmise automatiquement au service RH pour validation.";
        }
      }
    } else {
      // ===== ÉTAPE 1 : le MANAGER REFUSE — REFUS IMMÉDIAT ET DÉFINITIF =====
      maj.decisionManager = "REFUSEE";
      maj.decisionManagerLe = new Date();
      maj.decisionManagerPar = "Manager (réponse e-mail)";
      maj.decisionManagerNote = formulationAffichee
        ? "Formulation reconnue : « " + formulationAffichee + " »."
        : null;
      statutApres = "REFUSEE";
      maj.statut = "REFUSEE";
      maj.refuseePar = "MANAGER";
      maj.traitePar = "Manager (réponse e-mail)";
      maj.traiteLe = new Date();
      const mention = "Refusée par le manager — décision immédiate et définitive (aucune transmission aux RH)" +
        (formulationAffichee ? " — formulation reconnue : « " + formulationAffichee + " »." : ".");
      maj.commentaire = String(
        (demande.commentaire ? demande.commentaire + " — " : "") + mention
      ).slice(0, 800);
    }
  } else if (decisionApplicable && roleReponse === "rh") {
    // =====================================================================
    // (v0.2.146, MODIFIÉ v0.2.151) DÉCISION RH PAR E-MAIL
    // =====================================================================
    // Le service RH répond depuis la boîte configurée (cfg.rhEmail — celle
    // qui reçoit la transmission « — validation RH requise ») : sa décision
    // est tracée dans les champs decisionRh* et le statut final est
    // recalculé par la MATRICE (jumelle de src/lib/demandes.ts) :
    //   - RH accepte + manager avait accepté → « Acceptée » FINALE (document
    //     signé + notification employé, sections 6-7) ;
    //   - RH refuse → « Refusée par les RH » (immédiat, définitif — document
    //     de refus + notification employé, sections 6 et 8) ;
    //   - RH accepte mais manager pas encore décidé → la demande RESTE
    //     « En attente » (statut final dès la réponse e-mail du manager).
    // (NOUVEAU v0.2.151 — PARITÉ RH, « même chose pour les e-mails RH ») :
    //   1) la formulation reconnue est conservée dans decisionRhNote
    //      (jumelle de decisionManagerNote — visible dans le détail) ;
    //   2) demande adressée DIRECTEMENT au service RH (aucun manager
    //      responsable affecté — routage de repli) : l'étape manager de la
    //      matrice est satisfaite AUTOMATIQUEMENT (mention explicite) — la
    //      réponse RH vaut DÉCISION UNIQUE et achève la validation en une
    //      seule étape (« Congé accepté » → Acceptée ; « Je refuse » →
    //      Refusée par les RH). JAMAIS de transmission aux RH (elles viennent
    //      de décider elles-mêmes) — même résultat qu'une saisie manuelle RH.
    const validationRh = decision === classificationReponses.DECISIONS.VALIDATION;
    // (v0.2.163) libellé HONNÊTE de l'auteur : la décision d'autorité finale
    // peut venir de la boîte du service RH (rhEmail) OU du manager responsable
    // de l'employé (v0.2.163 — attestations routées au service RH).
    const auteurRh = (rhAdresse && exp === rhAdresse)
      ? "Auto-RH (réponse e-mail)"
      : "Responsable traitant (réponse e-mail)";
    if (demandeAdresseeRh) {
      maj.decisionManager = "ACCEPTEE";
      maj.decisionManagerLe = new Date();
      maj.decisionManagerPar = auteurRh + " — étape manager satisfaite automatiquement";
      maj.decisionManagerNote = (rhAdresse && exp === rhAdresse)
        ? "Aucun manager responsable affecté : la demande a été adressée directement au service RH — sa réponse e-mail vaut décision unique (étape manager satisfaite automatiquement)."
        : "La demande est routée au service RH : la réponse e-mail du responsable traitant vaut décision unique (étape manager satisfaite automatiquement).";
    }
    const decisionManagerEffective = maj.decisionManager || demande.decisionManager;
    maj.decisionRh = validationRh ? "ACCEPTEE" : "REFUSEE";
    maj.decisionRhLe = new Date();
    maj.decisionRhPar = auteurRh;
    // (NOUVEAU v0.2.151) formulation reconnue conservée (parité avec le
    // manager — decisionManagerNote).
    maj.decisionRhNote = formulationAffichee
      ? "Formulation reconnue : « " + formulationAffichee + " »."
      : null;
    const finaleRh = calculerStatutFinalDeuxEtapes(decisionManagerEffective, maj.decisionRh);
    statutApres = finaleRh.statut;
    const mentionRh = formulationAffichee
      ? " — formulation reconnue : « " + formulationAffichee + " »."
      : ".";
    if (statutApres === "ACCEPTEE") {
      // Matrice complète : le manager avait DÉJÀ accepté → décision FINALE.
      maj.statut = "ACCEPTEE";
      maj.refuseePar = null;
      maj.traitePar = auteurRh;
      maj.traiteLe = new Date();
      maj.commentaire = String(
        (demande.commentaire ? demande.commentaire + " — " : "") +
        "Validation à deux étapes complète : manager ET service RH ont accepté (réponse e-mail des RH" + mentionRh + ")"
      ).slice(0, 800);
    } else if (statutApres === "REFUSEE") {
      // Refus des RH : immédiat et définitif (manager en attente ou acceptant).
      maj.statut = "REFUSEE";
      maj.refuseePar = "RH";
      maj.traitePar = auteurRh;
      maj.traiteLe = new Date();
      maj.commentaire = String(
        (demande.commentaire ? demande.commentaire + " — " : "") +
        "Refusée par les RH — décision immédiate et définitive (réponse e-mail des RH" + mentionRh + ")"
      ).slice(0, 800);
    } else if (demande.type === "CONGE" || demande.type === "AUTORISATION_SORTIE") {
      // =====================================================================
      // (MODIFIÉ v0.2.168 — RÈGLE UTILISATEUR) ACCEPTATION = LES DEUX DÉCISIONS
      // =====================================================================
      // Les RH acceptent un congé/autorisation alors que le manager n'a PAS
      // encore décidé → la demande RESTE « En attente » (decisionRh=ACCEPTEE
      // tracé ci-dessus) : la réponse automatique avec le PDF signé ne part
      // que lorsque manager ET service RH ont TOUS LES DEUX accepté.
      //
      // (v0.2.168 — CORRECTION DU BUG MANAGER) l'ancien comportement v0.2.162
      // (« les RH sont l'autorité finale : acceptation RH = décision
      // immédiate ») rendait le statut ACCEPTEE AVANT la réponse du manager ;
      // la réponse ULTÉRIEURE du manager était alors systématiquement
      // ignorée (garde decisionApplicable : statutAvant doit être
      // EN_ATTENTE/INFORMATION_REQUISE) et son statut restait bloqué à
      // « En attente » dans l'administration. Désormais la demande reste
      // EN_ATTENTE : la réponse du manager est prise en compte normalement
      // (decisionManager enregistré selon SA décision) et achève la matrice.
      // Le REFUS RH reste immédiat et définitif (branche au-dessus, inchangée).
      statutApres = statutAvant === "INFORMATION_REQUISE" ? "INFORMATION_REQUISE" : "EN_ATTENTE";
      maj.commentaire = String(
        (demande.commentaire ? demande.commentaire + " — " : "") +
        "Acceptée par le service RH (réponse e-mail" + mentionRh + ") — en attente de la validation du manager."
      ).slice(0, 800);
    } else {
      // (v0.2.162 conservé pour les AUTRES types — attestations et, DEPUIS
      // v0.2.178, parrainage) les RH sont l'AUTORITÉ FINALE UNIQUE : leur
      // ACCEPTATION par e-mail achève la validation même si aucun manager
      // n'est impliqué (la matrice à deux étapes n'a pas de sens pour ces
      // types — pour le parrainage, la voie NORMALE reste la réponse de la
      // boîte dédiée, branche PARRAINAGE ci-dessus).
      statutApres = "ACCEPTEE";
      maj.statut = "ACCEPTEE";
      maj.refuseePar = null;
      maj.traitePar = auteurRh;
      maj.traiteLe = new Date();
      maj.commentaire = String(
        (demande.commentaire ? demande.commentaire + " — " : "") +
        "Acceptée par le service RH (décision directe par e-mail — autorité RH" +
        (decisionManagerEffective === "ACCEPTEE" ? ", manager favorable" : ", avant toute décision du manager") +
        mentionRh + ")"
      ).slice(0, 800);
    }
  } else if (
    !classificationActive &&
    importes.length &&
    (statutAvant === "EN_ATTENTE" || statutAvant === "INFORMATION_REQUISE")
  ) {
    // comportement historique (attestations, etc.) — inchangé
    statutApres = "ACCEPTEE";
    maj.statut = "ACCEPTEE";
    maj.traitePar = "Auto-RH (e-mail)";
    maj.traiteLe = new Date();
    if (!demande.commentaire) {
      maj.commentaire = "Document transmis par le service RH par e-mail.";
    }
  } else if (classificationActive && importes.length) {
    // (MODIFIÉ v0.2.162) pièce(s) jointe(s) reçue(s) SANS décision reconnue :
    //   - ATTESTATIONS (travail / salaire) : comportement HISTORIQUE conservé
    //     (Task 116) — le document transmis par le service RH vaut acceptation
    //     (avant la correction c'était le SEUL cas où leurs statuts bougeaient,
    //     d'où le « parfois ça marche / parfois non » constaté) ;
    //   - CONGÉ / AUTORISATION : simple trace pour le RH, la demande reste
    //     « En attente » (Task 178, inchangé).
    if (
      demande.type === "ATTESTATION_TRAVAIL" || demande.type === "ATTESTATION_SALAIRE"
    ) {
      if (statutAvant === "EN_ATTENTE" || statutAvant === "INFORMATION_REQUISE") {
        statutApres = "ACCEPTEE";
        maj.statut = "ACCEPTEE";
        maj.traitePar = "Auto-RH (e-mail)";
        maj.traiteLe = new Date();
        if (!demande.commentaire) {
          maj.commentaire = "Document transmis par le service RH par e-mail.";
        }
      } else if (!demande.commentaire) {
        maj.commentaire = "Pièce(s) jointe(s) reçue(s) par e-mail (demande déjà traitée).";
      }
    } else if (!demande.commentaire) {
      maj.commentaire = "Pièce(s) jointe(s) reçue(s) par e-mail — formulation d'acceptation/refus non reconnue dans le contenu, demande toujours en attente.";
    }
  }
  if (Object.keys(maj).length) {
    await prisma.demandeAdministrative.update({ where: { id: demande.id }, data: maj });
  }
  // ---- 6) NOTIFICATIONS (MODIFIÉ Task 181 — non bloquantes, journalisées) ----
  // (MODIFIÉ v0.2.146) cfgMail est chargé DÈS LA SECTION 2 (résolution du
  // rôle de l'expéditeur) — la transmission aux RH et la notification de
  // refus manager ne concernent que la voie MANAGER ; quand c'est le service
  // RH qui répond par e-mail, seule la notification FINALE à l'employé
  // s'applique (le RH vient de décider lui-même).
  //
  // (NOUVEAU v0.2.168 — RÈGLE UTILISATEUR) le document SIGNÉ ÉLECTRONIQUEMENT
  // est généré AVANT la réponse automatique et JOINT à CELLE-CI : l'employé
  // reçoit UNE SEULE réponse par e-mail — la décision d'ACCEPTATION ne part
  // que lorsque manager ET service RH ont tous les deux accepté (matrice
  // ci-dessus), le REFUS part immédiatement dès qu'un des deux refuse.
  // JAMAIS bloquant : si la génération échoue, la réponse part sans pièce
  // jointe (incident tracé).
  // ---- (NOUVEAU v0.2.179 — DEMANDE UTILISATEUR) RÉPONSE AUTOMATIQUE PDF
  // DÉSACTIVÉE pour les attestations (travail / salaire) et le PARRAINAGE :
  // la décision par e-mail (acceptation / refus) reste DÉTECTÉE et les
  // statuts restent mis à jour AUTOMATIQUEMENT (portail + administration +
  // historique de la réponse), mais AUCUNE réponse automatique n'est envoyée
  // à l'employé et AUCUN PDF signé n'est généré pour ces trois types — le
  // service RH assure la réponse manuellement (ex. l'attestation réelle
  // jointe à sa réponse e-mail, transmise à l'employé par la notification
  // « document disponible », toujours active). CONGÉ / AUTORISATION :
  // comportement inchangé (réponse automatique avec PDF signé, matrice à
  // deux étapes, transfert des pièces jointes v0.2.171).
  // ---- (MODIFIÉ v0.2.188 — DEMANDE UTILISATEUR) REFUS (congé /
  // autorisation) : AUCUN PDF de refus n'est plus GÉNÉRÉ ni ENVOYÉ. En cas de
  // refus par le manager OU le service RH (statut REFUSEE), le document de
  // refus signé n'est plus produit : l'employé reçoit UNIQUEMENT l'e-mail de
  // NOTIFICATION de refus — SANS PDF — qui transporte TOUTES les pièces
  // jointes fournies par le manager et/ou le service RH dans leurs réponses
  // (réponse courante + antérieures, cumulées — mécanisme v0.2.171 conservé).
  // Si les DEUX intervenants ont joint des fichiers, l'ENSEMBLE part à
  // l'employé. Le statut final « Refusée » est conservé dans le portail
  // employé (affichage v0.2.185 : seule mention « Refusée », sans acteur) et
  // les pièces jointes restent visibles/consultables dans « Mes demandes »
  // (v0.2.184). L'ACCEPTATION (congé / autorisation) conserve le document
  // signé électroniquement (inchangé) ; les autres types de demandes ne sont
  // pas modifiés. JAMAIS bloquant.
  const sansReponseAutoPdf = demande.type === "ATTESTATION_TRAVAIL" ||
    demande.type === "ATTESTATION_SALAIRE" || demande.type === "PARRAINAGE";
  let docFinal = null; // { genre: "acceptation", resultat, pieceJointe }
  // (MODIFIÉ v0.2.188 — DEMANDE UTILISATEUR) le document signé n'est généré
  // QUE pour une ACCEPTATION (congé / autorisation). Le REFUS ne génère PLUS
  // de PDF : traiterDocumentRefusDecision n'est plus appelé depuis la voie
  // automatique — la notification de refus part SANS PDF (pièces jointes des
  // décideurs transportées par envoyerEmailDecisionConge, cf. ci-dessous).
  if (decisionApplicable && !sansReponseAutoPdf && statutApres === "ACCEPTEE") {
    const declencheurDoc = "Validation à deux étapes complète (réponse e-mail " +
      (roleReponse === "rh" ? "des RH" : "du manager") + ")";
    try {
      const resultatDoc = await traiterDocumentSigneAcceptation(demande.id, declencheurDoc, { sansEmail: true });
      docFinal = {
        genre: "acceptation",
        resultat: resultatDoc,
      };
      if (resultatDoc && resultatDoc.genere && resultatDoc.document && resultatDoc.document.chemin) {
        const pdfOctets = lireDocumentDemandeStocke(resultatDoc.document.chemin);
        if (pdfOctets && pdfOctets.length) {
          docFinal.pieceJointe = {
            filename: resultatDoc.document.nom || ("decision-" + demande.reference.toLowerCase() + ".pdf"),
            content: pdfOctets,
            contentType: "application/pdf",
          };
        }
      }
    } catch (e) { /* jamais bloquant — déjà journalisé par le module */ }
  }
  let notification = null;
  if (decisionApplicable) {
    const validation = decision === classificationReponses.DECISIONS.VALIDATION;
    if (sansReponseAutoPdf && (statutApres === "ACCEPTEE" || statutApres === "REFUSEE")) {
      // (NOUVEAU v0.2.179 — DEMANDE UTILISATEUR) attestations (travail /
      // salaire) et parrainage : décision ENREGISTRÉE sans réponse
      // automatique — aucun PDF signé généré (règle strictement conservée).
      // (NOUVEAU v0.2.180 — DEMANDE UTILISATEUR) le service RH PEUT joindre
      // des documents à sa décision : quand sa réponse (ou une réponse
      // antérieure sur cette demande) contient des pièces jointes, elles sont
      // transmises à l'EMPLOYÉ avec la décision — UN SEUL e-mail, SANS PDF
      // auto-généré (règle v0.2.179 conservée). Sans pièce jointe : AUCUN
      // e-mail (v0.2.179 inchangé). JAMAIS bloquant.
      let piecesRh = [];
      try {
        piecesRh = await piecesJointesReponsesPourEmploye(demande, importes);
      } catch (e) { piecesRh = []; }
      if (piecesRh.length) {
        notification = await envoyerEmailDecisionDocumentsRh(demande, statutApres, piecesRh, cfgMail, formulationAffichee);
      }
      console.log("[DEMANDES] " + demande.reference + " | " + demande.type +
        " | statut=" + statutApres +
        " | réponse automatique PDF DÉSACTIVÉE (v0.2.179) — décision enregistrée" +
        (piecesRh.length
          ? " + " + piecesRh.length + " document(s) du RH transmis à l'employé (v0.2.180 — " + (notification && notification.envoye ? "envoyé" : "échec") + ")"
          : " — aucune pièce jointe, aucune réponse envoyée (réponse manuelle du service RH)") + ".");
    } else if (statutApres === "ACCEPTEE" || statutApres === "REFUSEE") {
      // Décision FINALE (matrice complète ou refus manager/RH) → réponse
      // automatique à l'EMPLOYÉ + copies (CC) au service RH et au manager.
      // (MODIFIÉ v0.2.188 — DEMANDE UTILISATEUR) ACCEPTATION : le PDF signé
      // électroniquement est joint (v0.2.168 inchangé). REFUS (congé /
      // autorisation) : AUCUN PDF n'est généré ni joint — docFinal est null
      // (plus d'appel à traiterDocumentRefusDecision) → pieceJointe = null :
      // l'employé reçoit l'e-mail de NOTIFICATION de refus SANS PDF, avec
      // TOUTES les pièces jointes fournies par le manager et/ou le service RH
      // dans leurs réponses (piecesReponses — v0.2.171 : réponse courante +
      // antérieures, cumulées ; si les DEUX intervenants ont joint des
      // fichiers, l'ENSEMBLE part à l'employé). Statut final « Refusée »
      // conservé (portail employé inchangé — v0.2.184/185).
      // (MODIFIÉ v0.2.193 — DEMANDE UTILISATEUR) lecture des interrupteurs
      // « Envoi par e-mail (réponse PDF en pièce jointe) » du panneau Réponse
      // PDF (ReponsePdfConfig : emailActif + envoyerEmploye / envoyerRh /
      // envoyerManager — défauts ON, identiques aux valeurs par défaut du
      // panneau). NOUVELLE SÉMANTIQUE : les e-mails de NOTIFICATION
      // d'acceptation / de refus partent TOUJOURS à TOUS les destinataires
      // historiques (employé « À », service RH et manager en Cc) — AUCUN
      // interrupteur ne peut plus en exclure quelqu'un (avant v0.2.193 :
      // « Auto-RH » désactivé retirait la boîte RH des Cc, « Manager »
      // désactivé retirait la boîte du manager, « Employé » désactivé le
      // sortait du champ « À », maître OFF supprimait TOUT envoi). Les
      // interrupteurs ne gouvernent PLUS QUE LA RÉPONSE PDF : le document
      // signé et tamponné n'est joint qu'aux destinataires dont l'interrupteur
      // est activé (maître ON) — les autres reçoivent la même notification
      // SANS le PDF. Config absente ou illisible → tous ACTIVÉS (comportement
      // historique v0.2.168 conservé). JAMAIS bloquant.
      let cfgReponsePdfDec = null;
      try {
        if (!prisma.reponsePdfConfig) {
          // (NOUVEAU v0.2.191) diagnostic EXPLICITE : un client Prisma ancien
          // (généré avant l'ajout du modèle) rendait la lecture silencieusement
          // impossible → les interrupteurs semblaient inertes (défauts ON).
          throw new Error("modèle ReponsePdfConfig absent du client Prisma — exécutez « npx prisma generate » puis redémarrez le portail");
        }
        cfgReponsePdfDec = await prisma.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
      } catch (e) {
        cfgReponsePdfDec = null;
        // (MODIFIÉ v0.2.191) l'échec de lecture n'est PLUS silencieux : trace
        // console explicite (jamais bloquant — défauts ON conservés).
        console.warn("[REPONSE-PDF] " + demande.reference + " | lecture des interrupteurs IMPOSSIBLE (" + (e && e.message ? e.message : String(e)) + ") — DÉFAUTS APPLIQUÉS : tous les destinataires activés.");
      }
      const envoyerEmployeDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerEmploye === false);
      const envoyerRhDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerRh === false);
      const envoyerManagerDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.envoyerManager === false);
      // (MODIFIÉ v0.2.193) interrupteur MAÎTRE « Envoi automatique de l'e-mail »
      // (emailActif) — la NOTIFICATION de décision part TOUJOURS ; ce maître
      // ne coupe PLUS que la RÉPONSE PDF jointe (avec les 3 interrupteurs de
      // destinataires — cf. avecPdfDecision ci-dessous). JAMAIS bloquant.
      const emailActifDecision = !(cfgReponsePdfDec && cfgReponsePdfDec.emailActif === false);
      // (NOUVEAU v0.2.193) drapeaux EFFECTIFS de la RÉPONSE PDF : maître ET
      // interrupteur du destinataire. La NOTIFICATION part TOUJOURS à tout le
      // monde (comportement historique — employé « À », RH + manager en Cc) ;
      // ces drapeaux décident UNIQUEMENT qui reçoit le PDF signé joint.
      const avecPdfDecision = {
        employe: emailActifDecision && envoyerEmployeDecision,
        rh: emailActifDecision && envoyerRhDecision,
        manager: emailActifDecision && envoyerManagerDecision,
      };
      // (MODIFIÉ v0.2.193) trace de diagnostic : position LUE des interrupteurs
      // à chaque décision + qui recevra la réponse PDF (visibilité immédiate).
      console.log("[REPONSE-PDF] " + demande.reference + " | interrupteurs lus : Envoi automatique=" +
        (emailActifDecision ? "ON" : "OFF") + ", Employé=" + (envoyerEmployeDecision ? "ON" : "OFF") +
        ", RH=" + (envoyerRhDecision ? "ON" : "OFF") + ", Manager=" + (envoyerManagerDecision ? "ON" : "OFF") +
        (cfgReponsePdfDec ? "" : " (config absente — défauts tous activés)") +
        " | notification TOUJOURS envoyée — réponse PDF pour : " +
        ([avecPdfDecision.employe ? "Employé" : null, avecPdfDecision.rh ? "RH" : null, avecPdfDecision.manager ? "Manager" : null].filter(Boolean).join(", ") || "PERSONNE (sans PDF)"));
      // (MODIFIÉ v0.2.193) copies HISTORIQUES — PLUS AUCUN filtrage par les
      // interrupteurs (la notification part toujours à l'employé « À », au
      // service RH et au manager) : ce sont désormais les drapeaux avecPdf
      // (cf. envoyerEmailDecisionConge) qui répartissent les destinataires
      // entre le message avec PDF et le message sans PDF.
      const ccDecision = (function () {
        const liste = [];
        if (rhAdresse) liste.push(rhAdresse);
        // Boîte du MANAGER = destinataire de la demande (congé / autorisation
        // de sortie — destinatairePourDemande). Quand la demande est adressée
        // DIRECTEMENT à la boîte du service RH (aucun manager affecté), la
        // même adresse ne figure qu'une fois.
        if (destAttendu && destAttendu !== rhAdresse && liste.indexOf(destAttendu) < 0) liste.push(destAttendu);
        return liste;
      })();
      // (NOUVEAU v0.2.171) TOUTES les pièces jointes fournies par les décideurs
      // (RH et/ou manager) dans LEURS réponses e-mail sont transmises au
      // DEMANDEUR avec le PDF signé : celles de la réponse courante (importes)
      // + celles des réponses antérieures (ex. pièces du manager reçues à
      // l'étape 1 quand la réponse RH achève la matrice) — aucune pièce
      // jointe n'est perdue. JAMAIS bloquant.
      let piecesReponsesEmploye = [];
      try {
        piecesReponsesEmploye = await piecesJointesReponsesPourEmploye(demande, importes);
      } catch (e) { piecesReponsesEmploye = []; }
      // (MODIFIÉ v0.2.193 — DEMANDE UTILISATEUR) la NOTIFICATION de décision
      // part TOUJOURS (employé « À », RH + manager en Cc) — l'interrupteur
      // maître « Envoi automatique de l'e-mail » ne coupe PLUS les e-mails :
      // avec les drapeaux des 3 interrupteurs de destinataires, il décide
      // UNIQUEMENT qui reçoit la RÉPONSE PDF jointe (document signé et
      // tamponné). Avant v0.2.193 : maître OFF → AUCUN e-mail du tout
      // (ENVOI_DESACTIVE) — supprimé.
      notification = await envoyerEmailDecisionConge(
        demande, statutApres, classification.formulations, importes, cfgMail,
        maj.refuseePar !== undefined ? maj.refuseePar : demande.refuseePar,
        {
          pieceJointe: docFinal && docFinal.pieceJointe ? docFinal.pieceJointe : null,
          piecesReponses: piecesReponsesEmploye,
          cc: ccDecision,
          // (NOUVEAU v0.2.193) adresses par rôle (notification historique) :
          rh: rhAdresse,
          manager: destAttendu && destAttendu !== rhAdresse ? destAttendu : "",
          // (MODIFIÉ v0.2.193) drapeaux EFFECTIFS de la RÉPONSE PDF (maître
          // ET interrupteur du destinataire) — true → notification AVEC le
          // PDF ; false → la MÊME notification SANS le PDF.
          avecPdf: avecPdfDecision,
          documentSigneNom: docFinal && docFinal.resultat && docFinal.resultat.genere
            && docFinal.resultat.document ? docFinal.resultat.document.nom : "",
        }
      );
      if (statutApres === "REFUSEE") {
        // (NOUVEAU v0.2.188) trace explicite : refus congé/autorisation →
        // AUCUN PDF de refus généré/envoyé ; notification e-mail SANS PDF avec
        // les pièces jointes des décideurs (0 = e-mail sans pièce jointe).
        console.log("[DEMANDES] " + demande.reference + " | " + demande.type +
          " | statut=REFUSEE | AUCUN PDF de refus généré ni envoyé (v0.2.188)" +
          " — notification e-mail SANS PDF transmise à l'employé" +
          (piecesReponsesEmploye.length
            ? " avec " + piecesReponsesEmploye.length + " pièce(s) jointe(s) du manager/RH (" + (notification && notification.envoye ? "envoyé" : "échec") + ")"
            : " (aucune pièce jointe fournie par les décideurs)"
          ) + ".");
      }
    }
    if (roleReponse === "manager" && validation && statutApres !== "ACCEPTEE") {
      // Manager a accepté, RH pas encore décidé → TRANSMISSION AUTOMATIQUE
      // AUX RH (pièces jointes de la demande + documents du manager).
      transmissionRh = await envoyerEmailTransmissionRh(demande, importes, cfgMail, formulationAffichee);
    }
    // =====================================================================
    // (NOUVEAU v0.2.184 — DEMANDE UTILISATEUR) ÉTAPE INTERMÉDIAIRE — congé /
    // autorisation de sortie : quand le manager OU les RH répondent avec des
    // pièces jointes alors que la matrice à deux étapes n'est PAS achevée
    // (statut encore EN_ATTENTE), l'employé reçoit AUTOMATIQUEMENT les
    // documents avec la notification neutre « document disponible » —
    // formulée SANS révéler l'acteur ni la décision intermédiaire (règle
    // v0.2.177 conservée : statut final, décisions par acteur et commentaire
    // restent masqués dans le portail). Les pièces jointes restent EN PLUS
    // visibles et consultables dans le portail employé À CHAQUE étape
    // (v0.2.184 — l'API employé ne les masque plus). À la décision FINALE,
    // TOUTES les pièces jointes existantes (celles-ci + les antérieures)
    // partent avec la réponse automatique et le PDF signé (v0.2.171
    // inchangé). JAMAIS bloquant.
    // =====================================================================
    if (!sansReponseAutoPdf && importes.length &&
        statutApres !== "ACCEPTEE" && statutApres !== "REFUSEE") {
      try {
        notification = await envoyerEmailDocumentDisponible(
          demande, importes, statutApres, cfgMail, "etape-intermediaire");
        notificationEtapeIntermediaire = true;
      } catch (e) { /* jamais bloquant */ }
    }
    // =====================================================================
    // (MODIFIÉ v0.2.187 — DEMANDE UTILISATEUR) PARRAINAGE — AUCUNE NOTIFICATION
    // DE REFUS AU SERVICE RH. Refus du manager → NOTIFICATION DU SERVICE RH
    // (aucune transmission) — SAUF pour le PARRAINAGE : après le refus du
    // RESPONSABLE (boîte dédiée du parrainage, décision unique v0.2.178),
    // AUCUN e-mail de notification de refus ne doit être envoyé au service RH.
    // Le refus reste intégralement enregistré (statut « Refusée »,
    // refuseePar=« PARRAINAGE », traçage, commentaire) et l'EMPLOYÉ continue
    // d'être notifié comme avant (documents transmis le cas échéant —
    // v0.2.180/182). CONGÉ / AUTORISATION DE SORTIE : notification inchangée
    // (le service RH reste informé du refus du manager — Task 181).
    // =====================================================================
    if (roleReponse === "manager" && !validation && demande.type !== "PARRAINAGE") {
      notificationRhRefus = await envoyerEmailRefusManagerRh(demande, cfgMail, formulationAffichee);
    }
  } else if (importes.length) {
    notification = await envoyerEmailDocumentDisponible(demande, importes, statutApres, cfgMail);
  }
  journaliserEnvoiDemandes(Object.assign({
    action: decisionApplicable ? "demande-decision-conge" : "demande-document",
    dest: (notification && notification.dest) || "",
    from: exp,
    host: cfgMail ? cfgMail.host : "",
    port: cfgMail ? cfgMail.port : 0,
    secure: cfgMail ? cfgMail.port === 465 : false,
    succes: true,
    reference: demande.reference,
    type: demande.type,
    statutAvant: statutAvant,
    statutApres: statutApres,
    decisionManager: maj.decisionManager || null,
    decisionRh: maj.decisionRh || null,
    roleReponse: roleReponse,
    refuseePar: maj.refuseePar || null,
    transmissionRh: transmissionRh && transmissionRh.envoye ? "envoyee" : (transmissionRh && transmissionRh.erreur ? "echec" : "absente"),
    notificationRhRefus: notificationRhRefus && notificationRhRefus.envoye ? "envoyee" : (notificationRhRefus && notificationRhRefus.erreur ? "echec" : "absente"),
    // (NOUVEAU v0.2.184 — demande utilisateur) notification neutre « document
    // disponible » envoyée à l'EMPLOYÉ à une étape intermédiaire (pièces
    // jointes du manager / des RH, décision pas encore finale) — les
    // documents partent aussi JOINTS à cet e-mail.
    notificationEtapeIntermediaire: notificationEtapeIntermediaire,
    documents: importes.map(function (d) { return d.nomFichier; }),
    notification: notification && notification.envoye ? "envoyee" : (notification && notification.erreur ? "echec" : "absente"),
    // (NOUVEAU v0.2.179 — demande utilisateur) réponse automatique PDF
    // DÉSACTIVÉE pour attestations (travail / salaire) + parrainage :
    // « desactivee » = décision enregistrée SANS envoi ni PDF (réponse
    // manuelle du RH) ; null sinon.
    reponseAutoPdf: decisionApplicable && sansReponseAutoPdf &&
      (statutApres === "ACCEPTEE" || statutApres === "REFUSEE") ? "desactivee" : null,
    // (NOUVEAU v0.2.188 — demande utilisateur) REFUS congé/autorisation :
    // « sans_pdf » = refus enregistré + notification e-mail SANS PDF de refus
    // (pièces jointes des décideurs transportées — v0.2.171) ; null sinon.
    pdfRefusDesactive: decisionApplicable && !sansReponseAutoPdf &&
      statutApres === "REFUSEE" ? "sans_pdf" : null,
    // (NOUVEAU v0.2.188) pièces jointes des décideurs transportées par la
    // notification de refus SANS PDF (congé / autorisation).
    piecesJointesNotificationRefus: decisionApplicable && !sansReponseAutoPdf &&
      statutApres === "REFUSEE" && notification && Array.isArray(notification.piecesReponses)
      ? notification.piecesReponses : null,
    // (NOUVEAU v0.2.180 — demande utilisateur) documents du RH transmis à
    // l'employé avec la décision (attestations + parrainage, sans PDF auto).
    documentsRhTransmis: notification && Array.isArray(notification.documents)
      ? notification.documents : null,
    // (NOUVEAU v0.2.168) document signé généré AVANT la réponse et JOINT à
    // celle-ci (une seule notification employé avec le PDF signé).
    documentSigne: docFinal && docFinal.genre === "acceptation" && docFinal.resultat && docFinal.resultat.genere
      ? (docFinal.resultat.document ? docFinal.resultat.document.nom : "genere")
      : (docFinal && docFinal.genre === "acceptation" && docFinal.resultat && docFinal.resultat.erreur ? "echec: " + docFinal.resultat.erreur : null),
    documentRefus: docFinal && docFinal.genre === "refus" && docFinal.resultat && docFinal.resultat.genere
      ? (docFinal.resultat.document ? docFinal.resultat.document.nom : "genere")
      : (docFinal && docFinal.genre === "refus" && docFinal.resultat && docFinal.resultat.erreur ? "echec: " + docFinal.resultat.erreur : null),
    pieceJointeReponse: notification && notification.pieceJointe ? true : false,
    // (NOUVEAU v0.2.171) pièces jointes des réponses RH/manager transmises au
    // demandeur + nombre TOTAL de pièces jointes de l'e-mail de décision
    // (PDF signé inclus) — preuve « aucune pièce jointe n'est perdue ».
    piecesJointesReponses: notification && Array.isArray(notification.piecesReponses) ? notification.piecesReponses : [],
    totalPiecesJointesDecision: notification && typeof notification.piecesReponsesTotal === "number" ? notification.piecesReponsesTotal : null,
  }, decision ? { decision: decision, formulations: classification.formulations } : {}));
  // ---- 7/8) (FUSIONNÉS v0.2.168) DOCUMENT SIGNÉ JOINT À LA RÉPONSE ----
  // Anciennes sections 7 (document d'acceptation, Task 179) et 8 (document de
  // refus, Task 180) : la génération se fait DÉSORMAIS AVANT l'envoi de la
  // réponse automatique (section 6) — le PDF signé électroniquement est
  // attaché À CETTE réponse (une seule notification à l'employé) au lieu d'un
  // second e-mail séparé. Le module de document ne s'envoie plus lui-même
  // (option sansEmail) : la traçabilité (docSigne*/docRefus*, DocumentDemande,
  // journal) reste assurée par les modules.
  // ---- 9) (NOUVEAU Task 194) HISTORIQUE DE LA RÉPONSE — CONSULTABLE RH ----
  // la réponse (expéditeur, date/heure, texte ORIGINAL, décision reconnue,
  // formulations, pièces jointes, statut avant/après) est conservée dans la
  // demande — y compris les décisions NON applicables (réponse tardive sur
  // demande déjà traitée : la trace subsiste, le statut est inchangé).
  await enregistrerReponseRecue(demande, entreeReponseRecue(demande, {
    messageId: idMessagePropre,
    de: exp,
    role: roleReponse,
    sujet: sujet,
    texte: extraireTexteMessage(parsed),
    decision: classificationActive && classification ? classification.decision : null,
    formulations: classificationActive && classification ? classification.formulations : [],
    piecesJointes: detailPj,
    piecesJointesImportees: importes.map(function (d) { return d.nomFichier; }),
    // (NOUVEAU Task 196 / v0.2.152) LIAISON DIRECTE réponse ↔ pièces jointes :
    // les identifiants des documents importés par CETTE réponse — le RH (et
    // l'employé) accèdent à chaque pièce jointe depuis l'historique, quel que
    // soit le statut de la demande (Acceptée, Refusée ou En attente).
    piecesJointesIds: importes.map(function (d) { return d.id; }),
    statutAvant: statutAvant,
    statutApres: statutApres,
  }));
  return Object.assign({
    statut: "TRAITE",
    reference: demande.reference,
    docs: importes.length,
    statutApres: statutApres,
    refuseePar: maj.refuseePar || null,
    decisionManager: maj.decisionManager || null,
    decisionRh: maj.decisionRh || null,
    roleReponse: roleReponse,
    transmissionRh: transmissionRh ? (transmissionRh.envoye ? true : transmissionRh.erreur) : null,
    notificationRhRefus: notificationRhRefus ? (notificationRhRefus.envoye ? true : notificationRhRefus.erreur) : null,
    notification: notification && notification.envoye,
    // (NOUVEAU v0.2.168) le PDF signé est joint à la réponse automatique :
    // résultat complet du module de document (traçabilité docSigne*/docRefus*).
    pieceJointeSignee: Boolean(docFinal && docFinal.pieceJointe),
  }, decision ? { decision: decision, formulations: classification.formulations } : {},
  docFinal && docFinal.genre === "acceptation" ? { docSigne: docFinal.resultat } : {},
  docFinal && docFinal.genre === "refus" ? { docRefus: docFinal.resultat } : {});
}

/**
 * (NOUVEAU 0.2.47) Traduit une erreur IMAP brute en explication ACTIONNABLE —
 * jumelle EXACTE de indiceImapLisible() de src/app/api/mail-config/route.ts :
 * garder les deux alignées.
 */
function messageImapLisible(message) {
  const m = String(message || "");
  const bas = m.toLowerCase();
  const contient = function (mots) {
    return mots.some(function (x) { return bas.indexOf(x.toLowerCase()) >= 0; });
  };
  if (contient(["ENOTFOUND", "EAI_AGAIN"])) {
    return "Nom de serveur introuvable : vérifiez l'orthographe de l'hôte (ex. imap.gmail.com).";
  }
  if (contient(["ECONNREFUSED"])) {
    return "Connexion refusée : le port est probablement faux ou bloqué (993 = SSL/TLS, 143 = STARTTLS).";
  }
  if (contient(["ETIMEDOUT", "timeout", "ESOCKETTIMEDOUT"])) {
    return "Le serveur ne répond pas dans le délai : vérifiez hôte/port et le pare-feu du serveur de messagerie.";
  }
  if (contient(["AUTHENTICATIONFAILED", "authentication failed", "invalid credentials", "login failed", "AUTHORIZATIONFAILED"])) {
    return "Identifiant ou mot de passe refusé : pour Gmail et Outlook, utilisez un MOT DE PASSE D'APPLICATION (compte -> sécurité -> validation en deux étapes).";
  }
  if (contient(["unsafe login", "plaintext"])) {
    return "Le serveur exige une connexion chiffrée : utilisez le port 993 (SSL/TLS).";
  }
  if (contient(["certificate", "self-signed", "ERR_SSL", "wrong version number", "EPROTO"])) {
    return "Problème TLS : port 993 attendu pour le SSL/TLS direct (143 = STARTTLS) — ou certificat du serveur interne à vérifier.";
  }
  if (contient(["no such mailbox", "nonexistent", "invalid mailbox"])) {
    return "La boîte INBOX est indisponible sur ce compte : vérifiez qu'il s'agit bien d'un compte de MESSAGERIE (IMAP) et pas d'un serveur SMTP.";
  }
  if (contient(["command failed"])) {
    return "Le serveur a refusé une commande IMAP — utilisez le bouton « Tester la connexion IMAP » du panneau SMTP pour l'étape exacte.";
  }
  return "Vérifiez l'hôte, le port (993 = SSL/TLS, 143 = STARTTLS), le compte et le mot de passe d'application.";
}

/**
 * Un passage de VÉRIFICATION de la boîte de réception : connexion IMAP,
 * messages NON LUS de INBOX, traitement de chacun, marquage LU. Verrouillé
 * (un seul passage simultané). Retourne un résumé sans lever d'exception
 * (les erreurs sont journalisées AVEC l'étape exacte + explication lisible
 * — MODIFIÉ 0.2.47 : le journal ne se contente plus du « Command failed »
 * brut d'ImapFlow, qui ne disait ni l'étape ni la réponse du serveur).
 */
/**
 * (NOUVEAU v0.2.162) Une réponse est-elle DÉJÀ tracée sur la demande ?
 * Dédoublonnage par Message-ID : la copie INBOX et la copie « Envoyés » d'une
 * même réponse ne doivent produire qu'UNE décision / UNE trace d'historique.
 */
function reponseDejaTraitee(demande, messageId) {
  if (!messageId) return false;
  try {
    // reponsesRecues est stocké CHIFFRÉ (Task 208) — déchiffrer avant lecture
    // (jumelle de enregistrerReponseRecue).
    const brut = demande && demande.reponsesRecues
      ? cryptoBd.dechiffrerChamp(demande.reponsesRecues) : null;
    const reps = brut ? JSON.parse(brut || "[]") : [];
    return Array.isArray(reps) && reps.some(function (r) { return r && r.messageId === messageId; });
  } catch (e) {
    return false;
  }
}

/**
 * (NOUVEAU v0.2.162) Scan de la boîte « ENVOYÉS » du compte IMAP : capte les
 * auto-réponses du RH (réponses émises depuis la boîte du système, marquées
 * LUES par Gmail dans INBOX — invisibles pour la recherche « non lus »).
 * Mêmes gardes et même traitement que l'INBOX (traiterMessageRecu) :
 * Garde 1 (Message-ID d'envoi), Garde 2 (X-Auto-RH-Systeme — les copies de
 * routage et notifications du système sont ignorées), §1 ter (dédoublonnage
 * Message-ID), contrôle de l'expéditeur, classification, pièces jointes.
 * Fenêtre : FENETRE_ENVOYES_MS (10 min) — plafonnée à PLAFOND_MESSAGES_PAR_PASSAGE.
 * (v0.2.162) Optimisation : seuls les messages PLUS NOUVEAUX que le dernier
 * passage sont récupérés/analysés (suivi du dernier UID vu en mémoire — au
 * redémarrage la fenêtre est re-scannée une fois, le dédoublonnage Message-ID
 * rend cela inoffensif) : les e-mails système déjà ignorés ne sont PAS
 * re-récupérés à chaque passage. JAMAIS bloquant.
 */
let _dernierUidEnvoyes = 0;
async function scannerBoiteEnvoyes(client) {
  let cheminEnvoyes = null;
  try {
    const liste = await client.list();
    const envoyee = (liste || []).find(function (m) {
      return m && (m.specialUse === "\\Sent" || /\bsent\b|envoy/i.test(String(m.path || "")));
    });
    if (envoyee) cheminEnvoyes = envoyee.path;
  } catch (e) { /* liste indisponible — repli ci-dessous */ }
  if (!cheminEnvoyes) {
    // Replis classiques (Gmail anglophone / francophone) puis abandon silencieux.
    cheminEnvoyes = "[Gmail]/Sent Mail";
  }
  // (v0.2.165) CURSEUR UID PERSISTANT au lieu de la recherche { since } :
  // fetch PEEK direct de la plage (curseur+1 : *) — immatériel au statut
  // lu/non-lu (le RH répond depuis la MÊME boîte : ses réponses y sont
  // parfois déjà lues) et insensible aux SEARCH Gmail intermittents.
  const lock = await client.getMailboxLock(cheminEnvoyes);
  let traites = 0;
  try {
    if (!_dernierUidEnvoyes) {
      _dernierUidEnvoyes = lireCurseurImap("envoyes")
        || Math.max(0, Number((client.mailbox && client.mailbox.uidNext) || 1) - 1);
    }
    const retenus = await fetchApresCurseur(client, _dernierUidEnvoyes, PLAFOND_MESSAGES_PAR_PASSAGE);
    for (const { uid, source: brut } of retenus) {
      try {
        const parsed = await simpleParserReception(brut);
        // (v0.2.171) DIAGNOSTIC : compter les pièces jointes vues à l'analyse
        // de chaque copie « Envoyés » (traçabilité de l'import des PJ RH).
        console.log("[RECEPTION] scan Envoyés | uid=" + uid + " | sujet=" + String(parsed.subject || "").slice(0, 60)
          + " | PJ=" + (Array.isArray(parsed.attachments) ? parsed.attachments.length : 0)
          + (Array.isArray(parsed.attachments) && parsed.attachments.length
            ? " [" + parsed.attachments.map(function (a) { return a.filename || "(sans nom)"; }).join(", ").slice(0, 120) + "]" : ""));
        const resultat = await traiterMessageRecu(parsed);
        if (resultat && resultat.statut === "TRAITE") traites++;
        console.log("[RECEPTION] scan Envoyés | uid=" + uid + " | résultat=" + (resultat ? resultat.statut : "?")
          + (resultat && resultat.motif ? " | " + String(resultat.motif).slice(0, 100) : ""));
      } catch (e) {
        // réponse envoyée illisible : jamais bloquant
        console.error("[RECEPTION] scan Envoyés | uid=" + uid + " | ERREUR : " + (e && e.message ? e.message.slice(0, 120) : e));
      }
      _dernierUidEnvoyes = Math.max(_dernierUidEnvoyes, uid);
    }
    if (retenus.length) ecrireCurseurImap("envoyes", _dernierUidEnvoyes);
  } finally {
    lock.release();
  }
  return { ok: true, traites: traites };
}

async function verifierBoiteDemandes() {
  if (_verifReceptionEnCours) {
    return { saute: true, motif: "Vérification déjà en cours" };
  }
  _verifReceptionEnCours = true;
  try {
    const cfg = await chargerConfigImap();
    if (!cfg) return { saute: true, motif: "Réception IMAP désactivée ou incomplète" };
    if (!ImapFlowReception || !simpleParserReception) {
      return { saute: true, motif: "Paquets IMAP indisponibles (imapflow / mailparser)" };
    }
    const client = new ImapFlowReception({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      tls: { rejectUnauthorized: false },
      logger: false,
      // (v0.2.172) garde-fous anti-blocage : sans eux, une connexion Gmail
      // suspendue (limite de sessions simultanées) bloquait le verrou de
      // polling INDEFINIMENT — plus aucun passage ne s'exécutait.
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 120000,
    });
    let recus = 0;
    let ignores = 0;
    let erreurs = 0;
    // (0.2.47) trace de l'étape en cours pour un diagnostic précis.
    let etape = "connexion au serveur";
    try {
      await client.connect();
      etape = "ouverture de la boîte INBOX";
      // (v0.2.162) PRIORITÉ au scan « Envoyés » : les auto-réponses du RH (le
      // cas utilisateur principal) y sont détectées en ≈ 5-10 s — AVANT le
      // traitement du backlog INBOX — pour tenir la latence < 60 s.
      try {
        const scanEnvoyes = await scannerBoiteEnvoyes(client);
        if (scanEnvoyes && scanEnvoyes.traites) {
          console.log("[RECEPTION] scan Envoyés : " + scanEnvoyes.traites + " réponse(s) auto-adressée(s) traitée(s).");
        }
      } catch (e) {
        console.error("[RECEPTION] scan Envoyés impossible : " + (e && e.message ? e.message : e));
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        etape = "récupération des nouveaux messages (curseur UID)";
        // (v0.2.165) CURSEUR UID PERSISTANT — remplace la recherche
        // { seen: false, since: 48 h } de la v0.2.163 : sur une boîte réelle,
        // le statut « non lu » n'est pas un marqueur fiable de « à traiter »
        // (la vue conversation Gmail marque les fils lus — constaté en test :
        // 2 réponses manager marquées lues avant traitement, jamais vues par
        // la recherche) et la SEARCH Gmail s'est montrée intermittente sur
        // les boîtes saturées (UIDVALIDITY réinitialisée, réponses vides).
        // Le curseur fetch DIRECTEMENT la plage (curseur+1 : *) en PEEK :
        // aucun message nouveau ne peut être manqué, lu ou non lu.
        if (!_dernierUidInbox) {
          _dernierUidInbox = lireCurseurImap("inbox")
            || Math.max(0, Number((client.mailbox && client.mailbox.uidNext) || 1) - 1);
        }
        let retenus = [];
        try {
          retenus = await fetchApresCurseur(client, _dernierUidInbox, PLAFOND_MESSAGES_PAR_PASSAGE);
        } catch (e) {
          console.error("[RECEPTION] fetch par curseur en échec : " + (e && e.message ? e.message : e));
        }
        for (const { uid, source: brut } of retenus) {
          let resultat = null;
          try {
            const parsed = await simpleParserReception(brut);
            resultat = await traiterMessageRecu(parsed);
          } catch (e) {
            resultat = { statut: "ERREUR", motif: e && e.message ? e.message : String(e) };
          }
          // (v0.2.163) JOURNAL DÉTAILLÉ de CHAQUE message : motif exact de
          // traitement/ignorance, référence, expéditeur, décision — plus
          // aucune réponse ne peut disparaître sans trace dans les logs.
          console.log("[RECEPTION] " + new Date().toISOString() + " | "
            + (resultat ? resultat.statut : "?") + " | uid=" + uid
            + (resultat && resultat.reference ? " | ref=" + resultat.reference : "")
            + (resultat && resultat.expediteur ? " | de=" + resultat.expediteur : "")
            + (resultat && resultat.motif ? " | motif=" + String(resultat.motif).slice(0, 180) : "")
            + (resultat && resultat.decision ? " | decision=" + resultat.decision : ""));
          // Marqué LU après analyse réussie (cosmétique pour la boîte de
          // l'utilisateur — la garantie « traité une seule fois » vient du
          // curseur UID + du dédoublonnage Message-ID, PAS du statut lu).
          if (resultat && resultat.statut !== "ERREUR") {
            try {
              await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
            } catch (e) { /* marquage non fatal */ }
          }
          if (resultat && resultat.statut === "TRAITE") recus += resultat.docs || 0;
          else if (resultat && resultat.statut === "IGNORE") ignores++;
          else erreurs++;
          // (v0.2.165) le curseur avance QUOIQUE il arrive (y compris ERREUR)
          // : un message illisible ne doit jamais bloquer la file — il reste
          // non marqué lu dans la boîte (visible pour l'utilisateur) et
          // l'erreur est tracée ci-dessus.
          _dernierUidInbox = Math.max(_dernierUidInbox, uid);
        }
        if (retenus.length) ecrireCurseurImap("inbox", _dernierUidInbox);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (e) {
      try { await client.logout(); } catch (_) { /* déjà fermé */ }
      const brut = e && e.message ? e.message : String(e);
      const texteServeur = e && e.responseText ? String(e.responseText) : "";
      const erreur = texteServeur ? brut + " — réponse du serveur : " + texteServeur : brut;
      const indice = messageImapLisible(brut + " " + texteServeur);
      journaliserEnvoiDemandes({
        action: "demande-imap",
        dest: "",
        from: "",
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        succes: false,
        code: "IMAP_ECHEC",
        etape: etape,
        erreur: erreur,
        indice: indice,
      });
      console.error("[RECEPTION] échec IMAP (" + etape + ") : " + erreur + " — " + indice);
      return { ok: false, erreur: erreur + " — " + indice, etape: etape, recus: 0, ignores: 0, erreurs: 1 };
    }
    // (MODIFIÉ v0.2.163) trace de passage TOUJOURS affichée, horodatée, avec
    // la durée réelle — permet de vérifier la cadence (15 s) et la latence.
    console.log("[RECEPTION] " + new Date().toISOString() + " | passage IMAP terminé : "
      + recus + " document(s) importé(s), " + ignores + " message(s) ignoré(s), "
      + erreurs + " erreur(s)"
      + " | curseurs inbox=" + _dernierUidInbox + " envoyés=" + _dernierUidEnvoyes);
    return { ok: true, recus: recus, ignores: ignores, erreurs: erreurs };
  } finally {
    _verifReceptionEnCours = false;
  }
}

/** Programme la vérification PÉRIODIQUE de la boîte (polling Task 122). */
function demarrerReceptionEmails() {
  // Intervalle réglable pour les tests : AUTO_RH_IMAP_INTERVALLE (secondes, min. 15).
  const secondes = Math.max(15, parseInt(process.env.AUTO_RH_IMAP_INTERVALLE || "120", 10) || 120);
  setTimeout(function () {
    verifierBoiteDemandes().catch(function (e) {
      console.error("[RECEPTION] 1er passage:", e && e.message ? e.message : e);
    });
  }, 10 * 1000).unref();
  setInterval(function () {
    // (v0.2.172) filet de sécurité : si un passage reste suspendu (réseau,
    // serveur IMAP), le verrou est relâché après 120 s pour que le polling
    // reparte au tick suivant — un passage abandonné est toujours tracé.
    const passage = verifierBoiteDemandes().catch(function (e) {
      console.error("[RECEPTION] passage périodique:", e && e.message ? e.message : e);
      return { abandon: false };
    });
    Promise.race([
      passage,
      new Promise(function (resoudre) {
        setTimeout(function () { resoudre({ delaiDepasse: true }); }, 120 * 1000).unref();
      }),
    ]).then(function (resultat) {
      if (resultat && resultat.delaiDepasse) {
        _verifReceptionEnCours = false;
        console.error("[RECEPTION] passage abandonné (délai 120 s dépassé) — verrou relâché, reprise au prochain tick.");
      }
    });
  }, secondes * 1000).unref();
  console.log("  Réception des réponses RH (IMAP) : vérification toutes les " + secondes + " s.");
}

async function handle(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?")
    .split(",")[0].trim();

  // ---- Page (MODIFIÉ Task 64) : sans session = page de connexion CIN +
  // mot de passe ; session PENDING = changement de mot de passe OBLIGATOIRE ;
  // session complète = page des fiches (verrouillées sur le CIN). ----
  if (pathname === "/" || pathname === "/index.html") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Méthode non autorisée." });
    }
    const sess = getSessionCin(req);
    if (sess && !sess.pending && !sess.otp)
      renouvelerSession(res, sess); // (Task 33) session glissante — (Task 74) JAMAIS pour une session OTP
    if (sess && sess.otp) {
      // NOUVEAU (Task 74) : étape code OTP en cours → page de confirmation
      res.writeHead(302, { ...BASE_HEADERS, Location: "/otp" });
      res.end();
      return;
    }
    if (sess && sess.pending) {
      // NOUVEAU (Task 64) : changement de mot de passe OBLIGATOIRE
      let motif = "expire";
      try {
        const acc = await prisma.portalAccess.findUnique({
          where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
        });
        if (acc) {
          motif = acc.mustChangePassword
            ? acc.passwordChangedAt
              ? "reinitialise"
              : "initial"
            : estMotDePasseExpire(acc.passwordChangedAt)
              ? "expire"
              : "initial";
        }
      } catch {}
      res.writeHead(200, {
        ...BASE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : changementMotDePasseHtml(motif));
      return;
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : sess ? PAGE_HTML : LOGIN_HTML);
    return;
  }

  // ---- Page de connexion (Task 64 : CIN + mot de passe) ----
  // ---------- Lecture du corps JSON (Task 116) ----------
  async function lireJsonDemandes(req2) {
    const brut = await readBody(req2);
    try { return JSON.parse(brut || "{}"); } catch (e) { return null; }
  }

  // ============================================================
  //  NOUVEAU (Task 116) — DEMANDES ADMINISTRATIVES
  //  Page « Demandes » (session complète requise, comme la page des fiches)
  //  + API : mon e-mail de notification, mes demandes, création de demande.
  // ============================================================
  if (pathname === "/demandes") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Méthode non autorisée." });
    }
    const sessD = getSessionCin(req);
    if (sessD && !sessD.pending && !sessD.otp) renouvelerSession(res, sessD);
    if (sessD && sessD.otp) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/otp" });
      res.end();
      return;
    }
    if (sessD && sessD.pending) {
      // changement de mot de passe obligatoire : même règle que la page « / »
      res.writeHead(302, { ...BASE_HEADERS, Location: "/" });
      res.end();
      return;
    }
    if (!sessD) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });
      res.end();
      return;
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : DEMANDES_HTML);
    return;
  }

  // ---------- E-mail de notification de l'employé (lecture) ----------
  if (pathname === "/api/mon-email" && req.method === "GET") {
    const sessE = getSessionCin(req);
    if (!sessE || sessE.pending || sessE.otp) {
      return sendJson(res, 401, { error: "Session absente ou incomplète.", code: "SESSION_ABSENTE" });
    }
    renouvelerSession(res, sessE);
    try {
      const acc = await prisma.portalAccess.findUnique({
        where: { cin: cryptoBd.chiffrerChamp(sessE.cin, true) },
      });
      let email = null;
      if (acc && acc.email) {
        try { email = cryptoBd.dechiffrerChamp(acc.email); } catch (e) { email = null; }
      }
      // (MODIFIÉ — demande utilisateur) NOM ET PRÉNOM récupérés
      // AUTOMATIQUEMENT depuis le Portail Administration : nomPrenom posé par
      // le RH/superadministrateur sur l'accès portail, sinon le nom de
      // référence des fiches de paie. Affiché en lecture seule dans les
      // panneaux d'attestation (plus aucune saisie employé).
      let nomPrenom = null;
      if (acc && acc.nomPrenom) {
        try { nomPrenom = cryptoBd.dechiffrerChamp(acc.nomPrenom) || null; } catch (e) { nomPrenom = null; }
      }
      if (!nomPrenom) nomPrenom = (await nomEmployeDepuisFiches(sessE.cin)) || null;
      return sendJson(res, 200, { cin: sessE.cin, email: email, nomPrenom: nomPrenom });
    } catch (e) {
      console.error("[DEMANDES] mon-email GET:", e);
      return sendJson(res, 500, { error: "Erreur serveur." });
    }
  }

  // ---------- E-mail de notification de l'employé (enregistrement) ----------
  if (pathname === "/api/mon-email" && req.method === "POST") {
    const sessE2 = getSessionCin(req);
    if (!sessE2 || sessE2.pending || sessE2.otp) {
      return sendJson(res, 401, { error: "Session absente ou incomplète.", code: "SESSION_ABSENTE" });
    }
    renouvelerSession(res, sessE2);
    const corps = await lireJsonDemandes(req);
    const emailPropre = String((corps && corps.email) || "").trim();
    if (!emailValideDemande(emailPropre)) {
      return sendJson(res, 400, { error: "Saisissez une adresse e-mail valide (ex. prenom.nom@entreprise.tn)." });
    }
    try {
      await prisma.portalAccess.update({
        where: { cin: cryptoBd.chiffrerChamp(sessE2.cin, true) },
        data: { email: cryptoBd.chiffrerChamp(emailPropre) },
      });
      return sendJson(res, 200, {
        ok: true,
        message: "Adresse de notification enregistrée : vous serez averti par e-mail à chaque changement de statut de vos demandes.",
      });
    } catch (e) {
      console.error("[DEMANDES] mon-email POST:", e);
      return sendJson(res, 500, { error: "Erreur serveur." });
    }
  }

  // ---------- Mes demandes (historique de l'employé connecté) ----------
  if (pathname === "/api/mes-demandes" && req.method === "GET") {
    const sessM = getSessionCin(req);
    if (!sessM || sessM.pending || sessM.otp) {
      return sendJson(res, 401, { error: "Session absente ou incomplète.", code: "SESSION_ABSENTE" });
    }
    renouvelerSession(res, sessM);
    try {
      const lignes = await prisma.demandeAdministrative.findMany({
        where: { cin: cryptoBd.chiffrerChamp(sessM.cin, true) },
        orderBy: { createdAt: "desc" },
        take: 200,
        // (NOUVEAU Task 122) documents transmis par le service RH par e-mail.
        include: { documents: { orderBy: { recuLe: "asc" } } },
      });
      // NOUVEAU (Task 231) : état de SIGNATURE ÉLECTRONIQUE des documents de
      // réponse — le registre des signatures (même base SQLite) enregistre
      // chaque document signé (type REPONSE, sourceId = demande, nomFichier
      // identique à DocumentDemande.nomFichier). Un document transmis par
      // e-mail avant l'activation du module (ou non PDF) reste sans signature
      // cryptographique : l'indicateur reflète le registre, jamais deviné.
      const clesSigReponse = new Set();
      try {
        const idsDem = lignes.map(function (d) { return d.id; });
        if (idsDem.length) {
          const sigs = await prisma.signatureApiDocument.findMany({
            where: { type: "REPONSE", sourceId: { in: idsDem }, chemin: { not: "" } },
            select: { sourceId: true, nomFichier: true },
          });
          for (const s of sigs) {
            clesSigReponse.add(s.sourceId + "\u0000" + s.nomFichier);
          }
        }
      } catch (e) {
        console.error("[PORTAIL] registre signatures (réponses) indisponible:", e && e.message ? e.message : e);
      }
      const items = lignes.map(function (d) {
        let donnees = {};
        try { donnees = JSON.parse(cryptoBd.dechiffrerChamp(d.donnees) || "{}"); }
        catch (e) { donnees = {}; }
        let employeEmail = null;
        if (d.employeEmail) {
          try { employeEmail = cryptoBd.dechiffrerChamp(d.employeEmail); } catch (e) { employeEmail = null; }
        }
        const deuxEtapesDem = d.type === "CONGE" || d.type === "AUTORISATION_SORTIE";
        // ==================================================================
        // (NOUVEAU v0.2.177 — RÈGLE UTILISATEUR) CONFIDENTIALITÉ DE LA
        // DÉCISION FINALE DANS LE PORTAIL EMPLOYÉ
        // ==================================================================
        // Pour les demandes à DEUX étapes (congé, autorisation de sortie),
        // le statut final n'est affiché à l'employé QU'APRÈS les réponses du
        // manager ET du service RH. Tant que la matrice n'est pas complète
        // (statut EN_ATTENTE), AUCUNE information de décision ne fuit :
        //   - décision du manager / des RH → masquées (« En attente ») ;
        //   - commentaire de traitement → masqué (il mentionnerait
        //     l'acceptation intermédiaire « Acceptée par le manager —
        //     transmise automatiquement au service RH » ou l'inverse) ;
        //   - (MODIFIÉ v0.2.184 — DEMANDE UTILISATEUR) pièces jointes reçues
        //     avec les réponses intermédiaires → RESTENT VISIBLES et
        //     CONSULTABLES (Visualiser / Télécharger) À CHAQUE étape, avec la
        //     notification automatique « document disponible » qui les
        //     transmet aussi par e-mail — elles étaient masquées jusqu'à la
        //     v0.2.183 incluse ; seules les informations de DÉCISION restent
        //     masquées (statut final, décisions par acteur, commentaire,
        //     date/acteur de traitement) ;
        //   - date et acteur de traitement → masqués.
        // La RÉVÉLATION est automatique : dès que le statut devient ACCEPTEE
        // (double acceptation manager + RH) ou REFUSEE (refus immédiat et
        // définitif — par conception la décision qui refuse ACHÈVE la
        // validation, aucune réponse RH ne suivra), tout est révélé d'un
        // coup : statut final, étapes, pièces jointes, commentaire.
        // (MODIFIÉ v0.2.185 — DEMANDE UTILISATEUR) pour un statut REFUSEE,
        // la révélation s'applique SANS l'acteur : la mention affichée est
        // « Refusée » (plus « Refusée par le Manager » / « Refusée par les
        // RH »), l'acteur de traitement et le commentaire de refus (qui
        // nomment le département ou le manager) restent masqués — voir
        // refusSansActeur ci-dessous. Les e-mails de décision et le portail
        // d'administration ne sont PAS affectés (affichage uniquement).
        // Les attestations et le parrainage (validation en une seule étape)
        // gardent l'affichage immédiat historique ; les e-mails de décision
        // ne sont PAS affectés (machine à états inchangée, v0.2.173).
        const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";
        // (NOUVEAU v0.2.185 — DEMANDE UTILISATEUR) RÈGLE D'AFFICHAGE DU REFUS
        // =====================================================================
        // Portail employé, TOUTES les demandes (congé, autorisation de sortie,
        // attestation de salaire, attestation de travail, parrainage) :
        // lorsque le statut est REFUSEE, l'employé ne voit QUE la mention
        // « Refusée » — SANS le département ni le manager à l'origine du refus :
        //   - badge de statut et ligne « Statut final » : « Refusée » (les
        //     libellés raffinés « Refusée par le Manager » / « Refusée par les
        //     RH » ne sont PLUS affichés à l'employé) ;
        //   - acteur de traitement (traitePar : « Manager (réponse e-mail) »,
        //     « Auto-RH (réponse e-mail) », « Service parrainage (réponse
        //     e-mail) », adresse du décideur…) → masqué (la ligne de détail
        //     n'affiche plus « par … ») ;
        //   - commentaire de traitement → masqué (il nomme l'acteur : « Refusée
        //     par le manager / les RH / le service chargé du parrainage —
        //     décision immédiate et définitive… ») ;
        //   - date de traitement CONSERVÉE (ne révèle aucun acteur).
        // Les statuts ACCEPTEE / VALIDEE / INFORMATION_REQUISE / EN_ATTENTE
        // gardent leur affichage historique ; la règle v0.2.177 (décision
        // masquée tant que la matrice deux étapes est incomplète, ci-dessous)
        // s'applique et reste stricte ; les e-mails de décision (libellé
        // raffiné conservé) et le portail d'administration ne sont PAS
        // affectés — modification d'AFFICHAGE uniquement.
        const refusSansActeur = d.statut === "REFUSEE";
        let statutVu = d.statut;
        let statutLibelleVu = refusSansActeur
          ? "Refusée"
          : libelleStatutFinalDemande(d.statut, d.refuseePar);
        let decisionManagerVu = d.decisionManager || null;
        let decisionManagerLibVu = libelleDecisionEtapeDemande(d.decisionManager);
        let decisionRhVu = d.decisionRh || null;
        let decisionRhLibVu = libelleDecisionEtapeDemande(d.decisionRh);
        let traiteParVu = refusSansActeur ? null : (d.traitePar || null);
        let traiteLeVu = d.traiteLe ? d.traiteLe.toISOString() : null;
        let commentaireVu = refusSansActeur ? "" : (d.commentaire || "");
        let documentsVu = (d.documents || []).map(function (doc) {
          return {
            id: doc.id,
            nomFichier: doc.nomFichier,
            taille: doc.taille,
            tailleLisible: formaterTailleDocument(doc.taille),
            typeMime: doc.typeMime || "",
            recuLe: doc.recuLe ? doc.recuLe.toISOString() : null,
            recuDe: doc.recuDe || "",
            // (Task 231) copie signée conservée dans le registre ?
            signeeElectronique: clesSigReponse.has(d.id + "\u0000" + doc.nomFichier),
          };
        });
        if (decisionMasquee) {
          statutVu = "EN_ATTENTE";
          statutLibelleVu = "En attente";
          decisionManagerVu = null;
          decisionManagerLibVu = "En attente";
          decisionRhVu = null;
          decisionRhLibVu = "En attente";
          traiteParVu = null;
          traiteLeVu = null;
          commentaireVu = "";
          // (MODIFIÉ v0.2.184 — DEMANDE UTILISATEUR) documentsVu est CONSERVÉ :
          // TOUTES les pièces jointes existantes (origine + reçues avec les
          // réponses du manager et/ou des RH) restent VISIBLES et
          // CONSULTABLES (Visualiser / Télécharger) à chaque étape. Seule la
          // DÉCISION reste masquée jusqu'à la fin de la matrice (règle
          // v0.2.177, strictement conservée pour le statut, les décisions par
          // acteur, le commentaire et la date/acteur de traitement).
        }
        return {
          id: d.id,
          reference: d.reference,
          type: d.type,
          typeLibelle: libelleTypeDemande(d.type),
          statut: statutVu,
          // (MODIFIÉ Task 181) libellé raffiné : « Refusée par le Manager » /
          // « Refusée par les RH » selon l'origine du refus.
          // (MODIFIÉ v0.2.185 — DEMANDE UTILISATEUR) RÈGLE D'AFFICHAGE DU
          // REFUS : dès que le statut est REFUSEE, l'employé voit UNIQUEMENT
          // la mention « Refusée » (voir refusSansActeur ci-dessus) — ni le
          // département ni le manager à l'origine du refus ne sont affichés
          // (traitePar et commentaire également masqués) ; les autres
          // statuts gardent leur libellé historique.
          statutLibelle: statutLibelleVu,
          // (NOUVEAU Task 200 — v0.2.155) STATUT FINAL DÉTAILLÉ DANS LE
          // PORTAIL EMPLOYÉ : l'employé voit OÙ EN EST sa demande après le
          // traitement du manager ET/OU du service RH — pour les demandes à
          // deux étapes (congé, autorisation de sortie), la décision de
          // CHAQUE étape est exposée avec son libellé (En attente / Acceptée
          // / Refusée) ; le portail affiche le fil Manager → RH et le statut
          // final se met à jour automatiquement (polling côté navigateur).
          // (MODIFIÉ v0.2.177) les décisions d'étape ne sont exposées qu'une
          // fois les DEUX réponses reçues (voir decisionMasquee ci-dessus) —
          // sinon elles trahiraient le statut final qu'elles masquent.
          deuxEtapes: deuxEtapesDem,
          // (NOUVEAU v0.2.177) vrai tant que la décision finale est masquée
          // (matrice deux étapes incomplète) — l'interface affiche alors la
          // note « communiquée après les réponses du manager et des RH ».
          decisionMasquee: decisionMasquee,
          decisionManager: decisionManagerVu,
          decisionManagerLibelle: decisionManagerLibVu,
          decisionRh: decisionRhVu,
          decisionRhLibelle: decisionRhLibVu,
          traitePar: traiteParVu,
          commentaire: commentaireVu,
          traiteLe: traiteLeVu,
          createdAt: d.createdAt.toISOString(),
          employeEmail: employeEmail,
          donnees: donnees,
          // (NOUVEAU Task 122) documents disponibles (Visualiser / Télécharger)
          // (MODIFIÉ v0.2.177) liste VIDE tant que la décision finale est
          // masquée — les pièces jointes des réponses apparaissent avec elle.
          // (RÉTABLI v0.2.184) les PJs restent VISIBLES à toutes les étapes.
          // (v0.2.185) règle du refus inchangée pour les documents : même
          // REFUSEE, les pièces jointes existantes restent consultables.
          documents: documentsVu,
        };
      });
      return sendJson(res, 200, { cin: sessM.cin, items: items });
    } catch (e) {
      console.error("[DEMANDES] mes-demandes:", e);
      return sendJson(res, 500, { error: "Erreur serveur." });
    }
  }

  // ---------- (NOUVEAU Task 122) Servage d'un document transmis par le RH ----------
  // GET /api/mes-demandes/documents/<id>[?telecharger=1]
  // Authentification OBLIGATOIRE (session CIN complète) et accès limité aux
  // documents des demandes de l'EMPLOYÉ LUI-MÊME (égalité du CIN chiffré
  // déterministe). Le fichier est déchiffré à la volée (AES-256-GCM) et servi
  // inline (Visualiser) ou en pièce téléchargeable (?telecharger=1).
  if (pathname.indexOf("/api/mes-demandes/documents/") === 0 && req.method === "GET") {
    const sessD = getSessionCin(req);
    if (!sessD || sessD.pending || sessD.otp) {
      return sendJson(res, 401, { error: "Session absente ou incomplète.", code: "SESSION_ABSENTE" });
    }
    renouvelerSession(res, sessD);
    try {
      const idDoc = pathname.slice("/api/mes-demandes/documents/".length);
      if (!idDoc || !/^[A-Za-z0-9_-]+$/.test(idDoc)) {
        return sendJson(res, 400, { error: "Identifiant de document invalide." });
      }
      const doc = await prisma.documentDemande.findUnique({
        where: { id: idDoc },
        include: { demande: { select: { cin: true, reference: true, type: true } } },
      });
      if (!doc) {
        return sendJson(res, 404, { error: "Document introuvable." });
      }
      // Propriétaire uniquement : le CIN de la demande doit être celui de la session.
      const cinDemande = doc.demande && doc.demande.cin
        ? cryptoBd.dechiffrerChamp(doc.demande.cin)
        : "";
      if (!cinDemande || normalizeText(cinDemande) !== normalizeText(sessD.cin)) {
        return sendJson(res, 403, { error: "Accès limité à vos propres documents." });
      }
      const cheminDoc = trouverDocumentStocke(doc.chemin);
      if (!cheminDoc) {
        console.error("[PORTAIL] document introuvable sur le disque :", doc.chemin);
        return sendJson(res, 404, { error: "Fichier introuvable sur le serveur. Le document a peut-être été supprimé du dossier de stockage." });
      }
      let data;
      try {
        data = decryptFromStorage(fs.readFileSync(cheminDoc));
      } catch (e) {
        console.error("[PORTAIL] document illisible (clé différente ?)", doc.chemin, e.message);
        return sendJson(res, 500, { error: "Document illisible sur le serveur : la clé de chiffrement (AUTO_RH_STORAGE_KEY dans .env) ne correspond pas à celle utilisée lors du chiffrement." });
      }
      const telecharger = url.searchParams.get("telecharger") === "1";
      const ext = extensionDocument(doc.chemin);
      const typeMime = doc.typeMime || mimeDepuisExtension(ext);
      const safeName = String(doc.nomFichier || "document").replace(/["\\\r\n]/g, "_");
      res.writeHead(200, {
        ...BASE_HEADERS,
        "Content-Type": typeMime,
        "Content-Length": String(data.length),
        "Content-Disposition":
          (telecharger ? "attachment" : "inline") +
          '; filename="' + safeName + '"' +
          "; filename*=UTF-8''" + encodeURIComponent(doc.nomFichier || "document"),
        "Cache-Control": "no-store",
      });
      res.end(data);
      return;
    } catch (e) {
      console.error("[DEMANDES] document:", e);
      return sendJson(res, 500, { error: "Erreur serveur." });
    }
  }

  // ---------- Création d'une demande administrative ----------
  if (pathname === "/api/demandes" && req.method === "POST") {
    const sessC = getSessionCin(req);
    if (!sessC || sessC.pending || sessC.otp) {
      return sendJson(res, 401, { error: "Session absente ou incomplète.", code: "SESSION_ABSENTE" });
    }
    renouvelerSession(res, sessC);
    try {
      const corps = (await lireJsonDemandes(req)) || {};
      const type = String(corps.type || "").trim();
      if (TYPES_DEMANDE_VALABLES.indexOf(type) < 0) {
        return sendJson(res, 400, { error: "Type de demande inconnu." });
      }
      // Garde-fou anti-spam : plafond de demandes non encore traitées.
      const ouvertes = await prisma.demandeAdministrative.count({
        where: { cin: cryptoBd.chiffrerChamp(sessC.cin, true), statut: "EN_ATTENTE" },
      });
      if (ouvertes >= PLAFOND_DEMANDES_OUVERTES) {
        return sendJson(res, 429, {
          error: "Vous avez déjà " + PLAFOND_DEMANDES_OUVERTES + " demandes en attente. Attendez leur traitement avant d'en créer de nouvelles.",
        });
      }
      // E-mail de notification de l'employé (PortAccess.email, chiffré)
      const acc = await prisma.portalAccess.findUnique({
        where: { cin: cryptoBd.chiffrerChamp(sessC.cin, true) },
      });
      let employeEmail = null;
      if (acc && acc.email) {
        try { employeEmail = cryptoBd.dechiffrerChamp(acc.email); } catch (e) { employeEmail = null; }
      }
      // (MODIFIÉ — Task 175) repli de notification pour TOUS les types : la
      // DERNIÈRE adresse utilisée par le RH/superadministrateur pour l'envoi
      // du mot de passe initial (mailEnvoyeA — tracée dans l'administration).
      // Rien n'est saisi nulle part : l'adresse vient du Portail
      // Administration (section « Accès portail par mot de passe »).
      if (!employeEmail && acc && acc.mailEnvoyeA) {
        try { employeEmail = cryptoBd.dechiffrerChamp(acc.mailEnvoyeA) || null; } catch (e) { employeEmail = null; }
      }

      // Champs du formulaire — validation par type (cahier des charges)
      const chaine = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 200);
      const donnees = {};
      // (MODIFIÉ — Task 175) NOM et PRÉNOM PLUS SAISIS dans AUCUN formulaire
      // (attestations, congé, autorisation de sortie, parrainage) : tout
      // champ d'identité envoyé par le client est IGNORÉ. Ils sont récupérés
      // AUTOMATIQUEMENT depuis le Portail Administration (section « Accès
      // portail par mot de passe ») :
      //   1. nomPrenom posé par le RH / superadministrateur sur l'accès
      //      portail (colonne « Nom et prénom ») ;
      //   2. sinon le nom de référence des fiches de paie importées (nomFiche,
      //      règle de fréquence — même règle que l'administration).
      let nomEmploye = "Employé (CIN " + masquerCinDemande(sessC.cin) + ")";
      const nomFiche = await nomEmployeDepuisFiches(sessC.cin);
      let nomAuto = "";
      if (acc && acc.nomPrenom) {
        try { nomAuto = String(cryptoBd.dechiffrerChamp(acc.nomPrenom) || "").trim(); } catch (e) { nomAuto = ""; }
      }
      if (!nomAuto) nomAuto = nomFiche;
      if (nomAuto) nomEmploye = nomAuto;
      // (NOUVEAU v0.2.107 — demande utilisateur) MATRICULE de l'employé,
      // résolu AUTOMATIQUEMENT (valeur manuelle de l'accès portail prioritaire,
      // sinon fiche la plus récente du CIN) — affiché dans TOUS les e-mails de
      // la demande et dans le Portail Administration (onglet « Demandes »).
      const matriculeEmploye = await matriculeEmployeDemandes(sessC.cin, acc);

      // (NOUVEAU — v0.2.132, demande utilisateur) MANAGER RESPONSABLE de
      // l'employé, résolu AUTOMATIQUEMENT depuis l'accès portail (affectation
      // « Manager responsable » de la fenêtre « Mot de passe initial — CIN »).
      // L'employé ne choisit JAMAIS son responsable : les demandes de congé et
      // d'autorisation de sortie lui partent pour VALIDATION (avec copies RH +
      // demandeur). Résolution :
      //   - nom : nomPrenom de l'accès du manager (sinon « prénom nom ») ;
      //   - e-mail : adresse de notification du manager (PortalAccess.email),
      //     sinon DERNIÈRE adresse de son mot de passe initial (mailEnvoyeA).
      // JAMAIS bloquant : tout échec → manager sans e-mail (repli service RH
      // au routage, motif journalisé). Aucun e-mail du formulaire n'est lu.
      let managerInfo = { nom: "", email: null };
      if (acc && acc.managerId) {
        try {
          const mgr = await prisma.portalAccess.findUnique({ where: { id: acc.managerId } });
          if (mgr) {
            let nomMgr = "";
            try { nomMgr = String(cryptoBd.dechiffrerChamp(mgr.nomPrenom) || "").trim(); } catch (e) { nomMgr = ""; }
            if (!nomMgr) {
              let nomSeul = "";
              let prenomSeul = "";
              try { nomSeul = String(cryptoBd.dechiffrerChamp(mgr.nom) || "").trim(); } catch (e) { nomSeul = ""; }
              try { prenomSeul = String(cryptoBd.dechiffrerChamp(mgr.prenom) || "").trim(); } catch (e) { prenomSeul = ""; }
              nomMgr = [prenomSeul, nomSeul].filter(Boolean).join(" ");
            }
            let emailMgr = null;
            try { emailMgr = mgr.email ? cryptoBd.dechiffrerChamp(mgr.email) : null; } catch (e) { emailMgr = null; }
            if (!emailMgr && mgr.mailEnvoyeA) {
              try { emailMgr = cryptoBd.dechiffrerChamp(mgr.mailEnvoyeA) || null; } catch (e) { emailMgr = null; }
            }
            if (emailMgr && !emailValideDemande(emailMgr)) emailMgr = null;
            managerInfo = { nom: nomMgr, email: emailMgr };
          }
        } catch (e) {
          console.error("[DEMANDES] manager responsable illisible:", e && e.message ? e.message : e);
        }
      }
      if (managerInfo.nom) donnees.managerNom = managerInfo.nom.slice(0, 160);

      if (type === "CONGE") {
        donnees.typeConge = chaine(corps.typeConge, 60);
        donnees.dateDebut = chaine(corps.dateDebut, 10);
        donnees.dateFin = chaine(corps.dateFin, 10);
        donnees.commentaire = chaine(corps.commentaire, 1000);
        if (!donnees.typeConge) return sendJson(res, 400, { error: "Le type de congé est obligatoire." });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(donnees.dateDebut) || !/^\d{4}-\d{2}-\d{2}$/.test(donnees.dateFin)) {
          return sendJson(res, 400, { error: "Les dates de début et de fin sont obligatoires (format JJ/MM/AAAA sélectionnable)." });
        }
        if (donnees.dateFin < donnees.dateDebut) {
          return sendJson(res, 400, { error: "La date de fin doit être postérieure ou égale à la date de début." });
        }
        // (SUPPRIMÉ — v0.2.132, demande utilisateur) le champ « Adresse e-mail
        // du N+1 / responsable hiérarchique » n'est PLUS LU ni stocké : le
        // manager responsable est résolu AUTOMATIQUEMENT (acc.managerId —
        // managerInfo ci-dessus) — tout `emailN1` envoyé par un ancien client
        // est IGNORÉ (même règle que le parrainage v0.2.92).
      } else if (type === "AUTORISATION_SORTIE") {
        donnees.date = chaine(corps.date, 10);
        // (MODIFIÉ — Task 175) nom, prénom et e-mail PLUS SAISIS : tout champ
        // éventuellement envoyé par le client est IGNORÉ. Le nom et le prénom
        // viennent automatiquement du Portail Administration (nomAuto,
        // résolu plus haut) — nom complet unique, comme pour les attestations.
        if (nomAuto) donnees.nom = nomAuto.slice(0, 80);
        // (MODIFIÉ — v0.2.132, demande utilisateur) « Responsable N+1 » (qui
        // avait remplacé « Département », v0.2.88) disparaît à son tour : le
        // manager responsable est résolu AUTOMATIQUEMENT. Compatibilité
        // historique conservée pour `departement` (anciens clients) : la
        // valeur éventuelle reste stockée telle quelle ; les anciennes
        // demandes conservent leur champ et s'affichent inchangées.
        if (chaine(corps.departement, 80)) {
          donnees.departement = chaine(corps.departement, 80);
        }
        donnees.motif = chaine(corps.motif, 500);
        donnees.nombreHeures = chaine(corps.nombreHeures, 10);
        donnees.heureSortie = chaine(corps.heureSortie, 5);
        donnees.heureRetour = chaine(corps.heureRetour, 5);
        donnees.compensation = chaine(corps.compensation, 3).toUpperCase() === "OUI" ? "OUI" : "NON";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(donnees.date)) {
          return sendJson(res, 400, { error: "La date de l'autorisation est obligatoire." });
        }
        // (SUPPRIMÉ — v0.2.132) les validations « Responsable N+1 obligatoire
        // / valide » disparaissent avec le champ : AUCUN responsable à saisir.
        if (!donnees.motif) return sendJson(res, 400, { error: "Le motif est obligatoire." });
        if (!donnees.nombreHeures || !/^\d+([.,]\d{1,2})?$/.test(donnees.nombreHeures)) {
          return sendJson(res, 400, { error: "Le nombre d'heures est obligatoire (nombre positif)." });
        }
        if (!/^\d{1,2}:\d{2}$/.test(donnees.heureSortie) || !/^\d{1,2}:\d{2}$/.test(donnees.heureRetour)) {
          return sendJson(res, 400, { error: "Les heures de sortie et de retour sont obligatoires." });
        }
      } else if (type === "PARRAINAGE") {
        // (MODIFIÉ — Task 175 puis v0.2.92) nom et prénom du parrain PLUS
        // SAISIS : tout champ éventuellement envoyé par le client est IGNORÉ —
        // ils viennent automatiquement du Portail Administration (nomAuto,
        // résolu plus haut). L'employé connecté EST le parrain.
        // (MODIFIÉ — v0.2.92) l'adresse e-mail du N+1 N'EST PLUS DEMANDÉE :
        // le champ disparaît du formulaire, tout `emailN1` envoyé par un
        // ancien client est IGNORÉ — le routage est automatique vers l'adresse
        // DÉDIÉE du parrainage (parrainageEmail), avec confirmation à l'employé.
        if (nomAuto) donnees.nomParrain = nomAuto.slice(0, 160);
        // E-mail du parrain : adresse du compte portail sinon DERNIÈRE adresse
        // du mot de passe initial (employeEmail — résolu plus haut). Rien
        // n'est saisi ; mémorisé seulement si résolu (information du N+1).
        if (employeEmail) donnees.emailParrain = String(employeEmail).slice(0, 254);
        donnees.dateParrainage = chaine(corps.dateParrainage, 10);
        donnees.operation = chaine(corps.operation, 160);
        donnees.nomFilleul = chaine(corps.nomFilleul, 160);
        donnees.telFilleul = chaine(corps.telFilleul, 30);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(donnees.dateParrainage)) {
          return sendJson(res, 400, { error: "La date du parrainage est obligatoire." });
        }
        if (!donnees.operation) return sendJson(res, 400, { error: "L'opération / hiérarchie est obligatoire." });
        if (!donnees.nomFilleul) return sendJson(res, 400, { error: "Le nom et prénom du filleul sont obligatoires." });
        if (!/^[+\d][\d ]{6,}$/.test(donnees.telFilleul)) {
          return sendJson(res, 400, { error: "Le numéro de téléphone du filleul est obligatoire (chiffres, espaces et + autorisés)." });
        }
        // (MODIFIÉ — Task 175) nomEmploye = nomAuto (résolu plus haut) ; plus
        // aucune réécriture depuis la saisie du formulaire.
      } else if (type === "ATTESTATION_TRAVAIL" || type === "ATTESTATION_SALAIRE") {
        // (MODIFIÉ — Task 174 puis 175) PLUS AUCUN FORMULAIRE DE SAISIE : un
        // seul bouton « Envoyer ». Tout champ éventuellement envoyé par le
        // client est IGNORÉ ; le nom/prénom (nomAuto) et l'adresse e-mail de
        // notification (employeEmail) sont résolus AUTOMATIQUEMENT plus haut,
        // depuis le Portail Administration, pour TOUS les types.
        if (nomAuto) donnees.nom = nomAuto.slice(0, 80);
      }

      // Libellés des informations (jumelle de pairesInfosDemande, src/lib/demandes.ts)
      const infos = [];
      if (type === "CONGE") {
        infos.push(["Type de congé", donnees.typeConge]);
        infos.push(["Date de début", donnees.dateDebut]);
        infos.push(["Date de fin", donnees.dateFin]);
        // (MODIFIÉ — v0.2.132) le MANAGER RESPONSABLE (résolu automatiquement)
        // remplace la ligne « E-mail du N+1 / responsable » ; l'ancienne ligne
        // ne s'affiche PLUS que pour les demandes ANTÉRIEURES qui portent
        // encore ce champ.
        if (donnees.managerNom) infos.push(["Manager responsable", donnees.managerNom]);
        if (donnees.emailN1) infos.push(["E-mail du N+1 / responsable", donnees.emailN1]);
        if (donnees.commentaire) infos.push(["Commentaire", donnees.commentaire]);
      } else if (type === "AUTORISATION_SORTIE") {
        infos.push(["Date", donnees.date]);
        // (MODIFIÉ — Task 175) nom complet unique récupéré AUTOMATIQUEMENT
        // depuis le Portail Administration (plus de saisie nom / prénom).
        if (donnees.nom) infos.push(["Nom et prénom", donnees.nom]);
        // (MODIFIÉ — v0.2.132) le MANAGER RESPONSABLE (résolu automatiquement)
        // s'affiche pour les demandes nouvelles ; les demandes ANTÉRIEURES
        // (Responsable N+1 / Département) restent affichées telles quelles.
        if (donnees.managerNom) infos.push(["Manager responsable", donnees.managerNom]);
        if (donnees.responsableN1) infos.push(["Responsable N+1", donnees.responsableN1]);
        else if (donnees.departement) infos.push(["Département", donnees.departement]);
        infos.push(["Motif", donnees.motif]);
        infos.push(["Nombre d'heures", donnees.nombreHeures]);
        infos.push(["Heure de sortie", donnees.heureSortie]);
        infos.push(["Heure de retour", donnees.heureRetour]);
        infos.push(["Compensation des heures", donnees.compensation === "OUI" ? "Oui — les heures d'absence seront compensées" : "Non — heures non compensées"]);
      } else if (type === "PARRAINAGE") {
        // (MODIFIÉ — Task 175 puis v0.2.92) parrain identifié AUTOMATIQUEMENT
        // (employé connecté) : paires affichées seulement si résolues. L'e-mail
        // du N+1 disparaît des demandes nouvelles (les demandes ANTÉRIEURES
        // qui portaient ce champ continueront de l'afficher via
        // pairesInfosDemande côté administration).
        if (donnees.nomParrain) infos.push(["Nom et prénom du parrain", donnees.nomParrain]);
        if (donnees.emailParrain) infos.push(["E-mail du parrain", donnees.emailParrain]);
        infos.push(["Date du parrainage", donnees.dateParrainage]);
        infos.push(["Opération / Hiérarchie", donnees.operation]);
        infos.push(["Nom et prénom du filleul", donnees.nomFilleul]);
        infos.push(["Téléphone du filleul", donnees.telFilleul]);
      } else if (type === "ATTESTATION_TRAVAIL" || type === "ATTESTATION_SALAIRE") {
        // (MODIFIÉ — demande utilisateur) nom récupéré AUTOMATIQUEMENT depuis
        // le Portail Administration (accès portail sinon fiches de paie) —
        // plus de saisie employé : les paires vides ne sont pas affichées.
        if (donnees.nom) infos.push(["Nom", donnees.nom]);
        if (donnees.prenom) infos.push(["Prénom", donnees.prenom]);
      }

      // (NOUVEAU v0.2.46 — MODIFIÉ Task 175) e-mail de notification EFFECTIF :
      // résolu AUTOMATIQUEMENT pour TOUS les types depuis le Portail
      // Administration (adresse du compte portail, sinon DERNIÈRE adresse de
      // l'envoi du mot de passe initial) — plus AUCUNE adresse saisie.
      const emailNotification = employeEmail || "";
      // Création en base (champs sensibles chiffrés : cin déterministe,
      // donnees / destinataire / employeEmail aléatoires — carte Task 116).
      const cfgMail = await lireConfigMailDemandes();
      const routage = destinatairePourDemande(type, donnees, cfgMail, managerInfo);
      const reference = await genererReferenceDemande();
      const cree = await prisma.demandeAdministrative.create({
        data: {
          reference: reference,
          type: type,
          cin: cryptoBd.chiffrerChamp(sessC.cin, true),
          statut: "EN_ATTENTE",
          destinataire: routage.dest ? cryptoBd.chiffrerChamp(routage.dest) : null,
          donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
          employeEmail: emailNotification ? cryptoBd.chiffrerChamp(emailNotification) : null,
        },
      });
      const demandeCreee = {
        reference: cree.reference,
        type: cree.type,
        cin: sessC.cin,
        statut: "EN_ATTENTE",
        createdAt: cree.createdAt,
        nomEmploye: nomEmploye,
        // (NOUVEAU v0.2.107) matricule de l'employé (vide = ligne omise dans
        // les e-mails et « — » dans l'administration).
        matricule: matriculeEmploye,
        // (NOUVEAU v0.2.46) ligne « E-mail employé » de l'e-mail RH (vide = omise)
        emailEmploye: emailNotification || "",
        // (NOUVEAU — demande utilisateur, point 8 v0.2.88) congé et
        // autorisation : l'e-mail au responsable N+1 porte la consigne de
        // VALIDATION PAR RÉPONSE (« Acceptée » / « Refusée »).
        // (MODIFIÉ v0.2.178) le PARRAINAGE aussi : l'e-mail part à l'ADRESSE
        // DÉDIÉE du parrainage, dont le destinataire doit savoir qu'il peut
        // valider ou refuser par simple réponse e-mail (même mécanisme que le
        // congé / l'autorisation de sortie).
        validationParReponse:
          type === "CONGE" || type === "AUTORISATION_SORTIE" || type === "PARRAINAGE",
        infos: infos,
      };
      // (MODIFIÉ — demande utilisateur, point 7 v0.2.88) les e-mails partent
      // EN ARRIÈRE-PLAN : la demande est enregistrée et confirmée
      // IMMÉDIATEMENT — l'envoi SMTP (potentiellement lent) ne bloque plus la
      // soumission. Node poursuit l'envoi après le renvoi de la réponse HTTP ;
      // la fonction ne lève jamais (tous les échecs sont journalisés).
      // congé + autorisation : COPIE AUTOMATIQUE au service RH en plus du
      // destinataire principal (N+1 saisi / responsable du département).
      const typeValidationN1 = type === "CONGE" || type === "AUTORISATION_SORTIE";
      const destinataires = [];
      if (routage.dest) destinataires.push(routage.dest);
      if (typeValidationN1 && cfgMail && cfgMail.rhEmail && cfgMail.rhEmail !== routage.dest) {
        destinataires.push(cfgMail.rhEmail);
      }
      envoyerEmailsDemandeEnArrierePlan(demandeCreee, cree.id, routage.dest, cfgMail)
        .catch(function (e) {
          console.error("[DEMANDES] arrière-plan:", e && e.message ? e.message : e);
        });
      return sendJson(res, 201, {
        ok: true,
        reference: reference,
        type: type,
        typeLibelle: libelleTypeDemande(type),
        statut: "EN_ATTENTE",
        destinataire: routage.dest || "",
        routageMotif: routage.motif,
        // (NOUVEAU) envoi DIFFÉRÉ : la réponse part avant le SMTP
        email: { envoye: false, arrierePlan: Boolean(routage.dest), erreur: routage.dest ? null : routage.motif },
        // (NOUVEAU) liste complète des destinataires des e-mails (N+1 + RH)
        destinataires: destinataires,
        // (NOUVEAU v0.2.50) incohérence nom / prénom détectée (affichée à
        // l'employé pour qu'il puisse la corriger) — null si cohérente.
        anomalie: donnees.anomalieNom || null,
        note: "Vous pouvez suivre le statut de votre demande dans « Mes demandes ».",
      });
    } catch (e) {
      console.error("[DEMANDES] création:", e);
      return sendJson(res, 500, { error: "Erreur serveur : la demande n'a pas pu être créée. Réessayez." });
    }
  }

  if (pathname === "/login" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : LOGIN_HTML);
    return;
  }

  // ---- (NOUVEAU Task 83 — MAQUETTE) PAGE « PREMIÈRE CONNEXION » (étape 1) :
  // CIN + mot de passe initial + nouveau mot de passe ×2 + « Valider ».
  // Public (le compte est identifié par le CIN saisi) ; un employé DÉJÀ
  // configuré (session complète) est renvoyé au portail ; une session
  // « pending » reste sur son parcours /changer ; une session OTP en cours
  // retourne à l'étape 2 (/otp).
  if (pathname === "/premiere" && (req.method === "GET" || req.method === "HEAD")) {
    const sess = getSessionCin(req);
    if (sess && sess.otp) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/otp" });
      res.end();
      return;
    }
    if (sess && sess.pending) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/changer" });
      res.end();
      return;
    }
    if (sess) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/" });
      res.end();
      return;
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : PREMIERE_HTML);
    return;
  }

  // ---- (NOUVEAU Task 83 — MAQUETTE) PAGE « CONFIGURATION RÉUSSIE »
  // (/premiere-reussie — carte 3) : confirmation visuelle de la première
  // connexion. Exige une session COMPLÈTE (l'étape 2 vient de réussir) :
  // sinon retour à la connexion.
  // (MODIFIÉ Task 87) la session d'inscription est FERMÉE au moment où la
  // page est servie (cookie effacé) : la redirection automatique (5 s) et le
  // bouton mènent à la FENÊTRE INITIALE de connexion /login (CIN + mot de
  // passe + code OTP) — l'employé s'authentifie COMPLÈTEMENT pour entrer au
  // portail (un rafraîchissement ou un accès direct à / renvoie à /login).
  if (pathname === "/premiere-reussie" && (req.method === "GET" || req.method === "HEAD")) {
    const sess = getSessionCin(req);
    if (!sess || sess.pending || sess.otp) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });
      res.end();
      return;
    }
    clearSessionCookie(res);
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : SUCCESS_HTML);
    return;
  }

  // ---- NOUVEAU (Task 64) Page de changement de mot de passe OBLIGATOIRE ----
  if (pathname === "/changer" && (req.method === "GET" || req.method === "HEAD")) {
    const sess = getSessionCin(req);
    if (!sess) {
      // Pas de session : retour à la connexion
      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });
      res.end();
      return;
    }
    if (sess.otp) {
      // NOUVEAU (Task 74) : confirmer d'abord le code OTP → page /otp
      res.writeHead(302, { ...BASE_HEADERS, Location: "/otp" });
      res.end();
      return;
    }
    if (!sess.pending) {
      // Session complète : rien à changer ici (sauf expiration en base)
      let expire = false;
      try {
        const acc = await prisma.portalAccess.findUnique({
          where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
        });
        expire = !acc || estMotDePasseExpire(acc.passwordChangedAt) || acc.mustChangePassword;
      } catch {
        expire = false;
      }
      if (!expire) {
        res.writeHead(302, { ...BASE_HEADERS, Location: "/" });
        res.end();
        return;
      }
    }
    let motif = "expire";
    try {
      const acc = await prisma.portalAccess.findUnique({
        where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
      });
      if (acc) {
        motif = acc.mustChangePassword
          ? acc.passwordChangedAt
            ? "reinitialise"
            : "initial"
          : estMotDePasseExpire(acc.passwordChangedAt)
            ? "expire"
            : "initial";
      }
    } catch {}
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : changementMotDePasseHtml(motif));
    return;
  }

  // ---- NOUVEAU (Task 74, MODIFIÉ Task 76, MODIFIÉ Task 80) PAGE OTP ----
  //  PREMIÈRE connexion : UNIQUEMENT LE QR CODE (page d'inscription) —
  //  connexions SUIVANTES : code affiché + formulaire de confirmation.
  // Servie UNIQUEMENT avec une session « otp » (posée après une connexion
  // CIN + mot de passe VALIDÉE).
  // (MODIFIÉ Task 80) à la PREMIÈRE connexion, la fenêtre n'affiche PLUS que
  // le QR code (demande utilisateur : « Dans cette fenêtre, afficher
  // uniquement le QR code ») — le code affiché, le compte à rebours, le
  // formulaire et les boutons ont été RETIRÉS de cette fenêtre. Dès que la
  // page QR est servie, le verrou PERSISTANT PortalAccess.qrPresente est
  // posé : le QR ne s'affichera plus aux connexions suivantes (même après
  // annulation ou expiration du défi) — la reconnexion CIN + mot de passe
  // ouvre directement la page de confirmation du code. Exception honnête :
  // si la génération SVG échoue (pratiquement impossible), l'ancienne page
  // complète (code + formulaire) reste servie pour ne JAMAIS bloquer
  // l'employé, et le verrou n'est PAS posé (le QR sera re-proposé).
  if (pathname === "/otp" && (req.method === "GET" || req.method === "HEAD")) {
    const sess = getSessionCin(req);
    if (!sess) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/login" });
      res.end();
      return;
    }
    if (sess.pending) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/changer" });
      res.end();
      return;
    }
    if (!sess.otp) {
      res.writeHead(302, { ...BASE_HEADERS, Location: "/" });
      res.end();
      return;
    }
    const defi = defiOtpValide(sess.cin);
    // (MODIFIÉ Task 85) la fenêtre /otp affiche LE QR CODE dans TOUS les cas :
    // inscription (defi.premiere → otpPremiereHtml « Configuration OTP »)
    // ET connexions suivantes (otpHtml — même contenu : QR + champ Code OTP +
    // « Valider ») — demande utilisateur : « jamais affiche le code otp comme
    // ca, dans cette fenetre n affiche que qr code qui expire apres 10
    // minute ». AUCUN code OTP n'est affiché en clair.
    // (Task 78) le QR est au FORMAT STANDARD otpauth://totp/… (secret Base32
    // persistant) — lisible par les applications d'authentification.
    // (Task 83) première connexion → pose du verrou qrPresente (une seule
    // fois) ; fallback = fenêtre de confirmation sans QR (quasi impossible).
    let html = otpExpireHtml();
    if (defi) {
      const svgQr = await svgQrOtp(defi);
      if (defi.premiere) {
        if (svgQr) {
          try {
            await prisma.portalAccess.updateMany({
              where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
              data: { qrPresente: true },
            });
          } catch {}
          html = otpPremiereHtml(defi, svgQr);
        } else {
          html = await otpHtml(defi, "");
        }
      } else {
        html = await otpHtml(defi, svgQr);
      }
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : html);
    return;
  }

  // ---- NOUVEAU (Task 74) CONFIRMATION DU CODE OTP (étape 2 de la connexion) ----
  // Le CIN + mot de passe ont DÉJÀ été validés (session « otp » posée) :
  // (MODIFIÉ Task 85) l'employé confirme le code OTP généré par SON
  // application d'authentification (lecture du QR code affiché par la
  // fenêtre /otp) — AUCUN code n'est affiché à l'écran.
  if (pathname === "/api/otp/verify" && req.method === "POST") {
    if (!allowRequest(ip, "otp")) {
      return sendJson(res, 429, {
        error: "Trop de tentatives depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const sess = getSessionCin(req);
    if (!sess) {
      return sendJson(res, 401, {
        error: "Session expirée. Reconnectez-vous avec votre CIN et votre mot de passe.",
        code: "OTP_SESSION_ABSENTE",
      });
    }
    if (!sess.otp) {
      return sendJson(res, 400, {
        error: "Aucune vérification par code OTP n'est en cours.",
        code: "OTP_HORS_ETAPE",
      });
    }
    const bodyRaw = await readBody(req);
    let body = null;
    try {
      body = bodyRaw ? JSON.parse(bodyRaw) : null;
    } catch {
      body = null;
    }
    // (Esprit Task 66) tolérance de saisie : tirets/espaces de la saisie ignorés
    const code = String(body?.otp ?? "").replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(code)) {
      return sendJson(res, 400, {
        error: "Veuillez saisir le code OTP à 6 chiffres généré par votre application d'authentification.",
      });
    }
    const defi = defiOtpValide(sess.cin);
    if (!defi) {
      // Expiré (10 minutes) ou déjà consommé : le QR et le code ne valent plus rien
      clearSessionCookie(res);
      return sendJson(res, 410, {
        error:
          "Code OTP expiré (validité : " + LIBELLE_OTP +
          "). Reconnectez-vous avec votre CIN et votre mot de passe pour afficher un nouveau QR code.",
        code: "OTP_EXPIRE",
      });
    }
    // (MODIFIÉ Task 78, REFONTE Task 85) UNE SEULE voie de confirmation :
    // le CODE TOTP généré par l'application d'authentification de l'employé
    // (Google Authenticator, Microsoft Authenticator, Authy, FreeOTP…),
    // calculé depuis le secret PERSISTANT en base (RFC 6238 : fenêtre 30 s,
    // tolérance ±1 fenêtre pour l'horloge du téléphone, anti-rejeu via
    // lastUsedWindow). L'ancienne voie « code affiché à l'écran » est
    // SUPPRIMÉE (demande utilisateur Task 85 : « jamais affiche le code otp
    // comme ca ») : plus aucun code n'est généré, affiché ni accepté.
    let codeCorrect = false;
    let fenetreTotp = null;
    {
      const accTotp = await prisma.portalAccess.findUnique({
        where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
        select: {
          totpSecret: true,
          lastUsedWindow: true,
          lastLoginAt: true,
          otpFenetreCreeA: true, // (Task 86) fenêtre du secret d'inscription
        },
      });
      // (NOUVEAU Task 86 — « Qr code n'expire pas apres 10 minute vérifier »)
      // GARDE D'EXPIRATION DU SECRET DE FENÊTRE : pour un employé NON INSCRIT,
      // le secret encodé par le QR ne vit que 10 minutes (otpFenetreCreeA) —
      // dépassées, le QR scanné est MORT : tout code est refusé (410), même si
      // le défi semblait encore valide. La reconnexion affichera un NOUVEAU QR
      // (nouveau secret).
      if (
        accTotp &&
        !accTotp.lastLoginAt &&
        accTotp.otpFenetreCreeA &&
        Date.now() - new Date(accTotp.otpFenetreCreeA).getTime() >= OTP_TTL_MS
      ) {
        otpDefis.delete(sess.cin);
        clearSessionCookie(res);
        return sendJson(res, 410, {
          error:
            "Code OTP expiré (validité du QR : " + LIBELLE_OTP +
            "). Reconnectez-vous avec votre CIN et votre mot de passe pour afficher un nouveau QR code.",
          code: "OTP_EXPIRE",
        });
      }
      if (accTotp && accTotp.totpSecret) {
        // (MODIFIÉ Task 80) le secret TOTP est CHIFFRÉ EN BASE (champ « alea »
        // de la carte Task 32 — écrit chiffré par le portail ET par
        // l'administration, dont le middleware le chiffre déjà) :
        // déchiffrement explicite AVANT la vérification. Les valeurs
        // historiques sans préfixe (secrets écrits en clair par les versions
        // Task 78/79) sont renvoyées telles quelles par dechiffrerChamp.
        const t = verifyTotp(
          cryptoBd.dechiffrerChamp(accTotp.totpSecret),
          code,
          accTotp.lastUsedWindow
        );
        if (t.ok) {
          codeCorrect = true;
          fenetreTotp = t.window;
        }
      }
    }
    if (!codeCorrect) {
      defi.tentatives += 1;
      if (defi.tentatives >= OTP_MAX_TENTATIVES) {
        otpDefis.delete(sess.cin);
        clearSessionCookie(res);
        return sendJson(res, 401, {
          error:
            "Trop de codes incorrects : vérification annulée. Reconnectez-vous avec votre CIN et votre mot de passe.",
          code: "OTP_ANNULE",
        });
      }
      const restantes = OTP_MAX_TENTATIVES - defi.tentatives;
      return sendJson(res, 401, {
        error:
          "Code OTP incorrect. Il vous reste " + restantes + " tentative" +
          (restantes > 1 ? "s" : "") + " avant de devoir vous reconnecter.",
      });
    }
    // Code correct : le défi est CONSOMMÉ (usage unique)
    otpDefis.delete(sess.cin);
    const remember = defi.remember;
    const acc = await prisma.portalAccess.findUnique({
      where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
    });
    if (!acc || !acc.isActive) {
      clearSessionCookie(res);
      return sendJson(res, 403, {
        error: "Accès introuvable ou désactivé. Contactez votre service RH.",
      });
    }
    // (MODIFIÉ Task 75, maintenu Task 76) la PREMIÈRE connexion est
    // COMPLÈTE : on l'enregistre maintenant (lastLoginAt n'est jamais écrit
    // dans /api/verify) — le QR code ne sera plus affiché aux connexions
    // suivantes (Task 76 : elles exigent toujours l'OTP, mais SANS QR). Un
    // défi abandonné, expiré ou annulé n'écrit RIEN : la première connexion
    // reste due (QR de nouveau affiché à la reconnexion).
    // (NOUVEAU Task 78) si le code confirmé vient de l'application
    // d'authentification, la fenêtre TOTP consommée est enregistrée
    // (lastUsedWindow) : le MÊME code ne peut pas être rejoué une 2e fois.
    // (NOUVEAU Task 86) SCELLEMENT du secret : le code a été confirmé dans
    // les 10 minutes → le secret de fenêtre devient DÉFINITIF
    // (otpFenetreCreeA repassé à null) — le QR scanné reste celui du compte.
    await prisma.portalAccess.update({
      where: { id: acc.id },
      data: {
        lastLoginAt: new Date(),
        ...(fenetreTotp != null ? { lastUsedWindow: fenetreTotp } : {}),
        ...(acc.otpFenetreCreeA ? { otpFenetreCreeA: null } : {}),
      },
    });
    // (Task 64) changement de mot de passe OBLIGATOIRE ? — vérifié MAINTENANT
    // (l'étape OTP peut durer quelques minutes : l'état a pu changer).
    const doitChanger =
      acc.mustChangePassword || estMotDePasseExpire(acc.passwordChangedAt);
    if (doitChanger) {
      // Session « pending » 10 minutes : AUCUN accès aux fiches tant que le
      // changement de mot de passe n'est pas enregistré. (CORRECTIF test74 :
      // le 3e paramètre est bien `pending` — une session PENDING, jamais une
      // session complète déguisée.)
      setSessionCookie(res, createPortalSession(sess.cin, false, true), PENDING_MAX_AGE);
      return sendJson(res, 200, {
        ok: true,
        mustChangePassword: true,
        motif: acc.mustChangePassword
          ? acc.passwordChangedAt
            ? "reinitialise"
            : "initial"
          : "expire",
        redirect: "/changer",
      });
    }
    // (NOUVEAU Task 90 — « Apres le scan du QR code, je veux etre redirige
    // vers la page d inscription initiale (CIN, Mot de passe, OTP) ») :
    // lorsque la confirmation du code TERMINE L'INSCRIPTION — l'employé
    // n'a JAMAIS completé de connexion (lastLoginAt null) et le secret
    // encodé par le QR est encore une FENÊTRE non scellée
    // (otpFenetreCreeA non null : cas du QR expiré puis re-scanne à la
    // reconnexion, Tasks 85/86 ; la confirmation vient juste de le
    // sceller ci-dessus) — la session COMPLÈTE n'est plus délivrée pour
    // ouvrir le portail : MÊME PARCOURS que la première connexion (Task
    // 87). La réponse renvoie redirect=/premiere-reussie ; la page
    // « Configuration réussie » est servie (elle referme la session) et
    // ramène à la FENÊTRE INITIALE de connexion (CIN + mot de passe +
    // code OTP). Le cookie COMPLET reste nécessaire ICI : la garde de
    // /premiere-reussie exige une session complète pour servir la page
    // avant de l'effacer. Un employé DÉJÀ INSCRIT (secret scellé :
    // otpFenetreCreeA null) ouvre son espace directement ci-dessous :
    // connexion normale à deux facteurs INCHANGÉE.
    if (!acc.lastLoginAt && acc.otpFenetreCreeA) {
      setSessionCookie(
        res,
        createPortalSession(sess.cin, remember, false),
        remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE
      );
      return sendJson(res, 200, {
        ok: true,
        cinMasked: "•••" + sess.cin.slice(-3),
        redirect: "/premiere-reussie",
      });
    }
    // (MODIFIÉ Task 33) durée du cookie alignée sur le choix « Se souvenir de moi »
    setSessionCookie(
      res,
      createPortalSession(sess.cin, remember, false),
      remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE
    );
    return sendJson(res, 200, {
      ok: true,
      cinMasked: "•••" + sess.cin.slice(-3),
      redirect: "/",
    });
  }

  // ---- (SUPPRIMÉ Task 85) endpoint /api/otp/nouveau ----
  // Il ne servait qu'à RÉGÉNÉRER le code à usage unique AFFICHÉ à l'écran
  // (bouton « Générer un nouveau code ») — mécanisme retiré : AUCUN code
  // n'est plus généré ni affiché (demande utilisateur Task 85). La fenêtre
  // expirée bascule vers « Code OTP expiré » → reconnexion CIN + mot de
  // passe. Toute requête reçoit 404 (comportement standard d'une route
  // inexistante) — les suites vérifient l'ABSENCE du marqueur.
  // ---- Sonde de santé ----
  if (pathname === "/api/health") {
    // (NOUVEAU) diagnostic stockage : dossiers candidats + nombre de PDF trouvés
    const storage = STORAGE_CANDIDATES.map((dir) => {
      let exists = false;
      let files = 0;
      try {
        files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).length;
        exists = true;
      } catch {
        exists = false;
      }
      return { dir, exists, pdfFiles: files };
    });
    return sendJson(res, 200, {
      ok: true,
      service: "auto-rh-portail-employes",
      port: PORT,
      storageDirUsed: STORAGE_CANDIDATES[0],
      storage,
    });
  }

  // ---- (MODIFIÉ Task 64) Connexion : CIN + MOT DE PASSE ----
  if (pathname === "/api/verify" && req.method === "POST") {
    if (!allowRequest(ip, "verify")) {
      return sendJson(res, 429, {
        error: "Trop de tentatives depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const bodyRaw = await readBody(req);
    let body = null;
    try {
      body = bodyRaw ? JSON.parse(bodyRaw) : null;
    } catch {
      body = null;
    }
    const cin = normalizeText(body?.cin);
    const password = String(body?.password ?? "");
    // NOUVEAU (Task 33) : « Se souvenir de moi » — session longue sur cet appareil
    const remember =
      body?.remember === true || body?.remember === "true" || body?.remember === 1;
    if (cin.length < 3 || cin.length > 30) {
      return sendJson(res, 400, { error: "Veuillez saisir votre numéro CIN complet." });
    }
    if (!password || password.length > 200) {
      return sendJson(res, 400, { error: "Veuillez saisir votre mot de passe." });
    }
    // (MODIFIÉ Task 32 : base chiffrée) le champ cin de PortalAccess est
    // stocké CHIFFRÉ DE FAÇON DÉTERMINISTE : la même valeur saisie produit la
    // même empreinte → le findUnique(where: { cin }) continue de fonctionner.
    const acc = await prisma.portalAccess.findUnique({
      where: { cin: cryptoBd.chiffrerChamp(cin, true) },
    });
    // Message IDENTIQUE quel que soit le problème (pas d'énumération de CIN)
    const generic = "CIN ou mot de passe incorrect. Réessayez.";
    if (!acc || !acc.isActive) {
      await sleep(400); // ralentit les tentatives d'énumération
      return sendJson(res, 401, { error: generic });
    }
    if (acc.lockedUntil && new Date(acc.lockedUntil).getTime() > Date.now()) {
      const mins = Math.max(
        1,
        Math.ceil((new Date(acc.lockedUntil).getTime() - Date.now()) / 60000)
      );
      return sendJson(res, 423, {
        error:
          "Trop de tentatives : accès temporairement verrouillé. Réessayez dans " +
          mins +
          " minute" +
          (mins > 1 ? "s" : "") +
          " ou contactez votre service RH.",
      });
    }
    // NOUVEAU (Task 64) : accès ancien (créé avant la connexion par mot de
    // passe) sans mot de passe enregistré → le RH/IT doit le RÉINITIALISER
    // (onglet Accès portail) pour lui donner un mot de passe initial.
    if (!acc.passwordHash) {
      await prisma.portalAccess.update({
        where: { id: acc.id },
        data: { failedAttempts: (acc.failedAttempts || 0) + 1 },
      });
      await sleep(400);
      return sendJson(res, 401, {
        error:
          "La connexion par mot de passe n'est pas encore activée pour ce CIN. Demandez à votre service RH de RÉINITIALISER votre accès : il vous remettra un mot de passe initial.",
      });
    }
    // (MODIFIÉ Task 66) vérification du mot de passe (scrypt, temps constant)
    // + TOLÉRANCE de saisie : tirets/espaces de la saisie ignorés (le mot de
    // passe initial peut être recopié avec ou sans tirets, et un collage
    // parasite d'espace ne fait plus échouer la connexion).
    const hashClair = cryptoBd.dechiffrerChamp(acc.passwordHash);
    if (!verifierMotDePasseTolerant(password, hashClair)) {
      const attempts = (acc.failedAttempts || 0) + 1;
      const lock = attempts >= MAX_VERIFY_ATTEMPTS;
      await prisma.portalAccess.update({
        where: { id: acc.id },
        data: {
          failedAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : acc.lockedUntil,
        },
      });
      await sleep(400); // ralentit le force-brute
      return sendJson(res, 401, { error: generic });
    }
    // Succès : compteur d'échecs remis à zéro.
    // (MODIFIÉ Task 76) `lastLoginAt` n'est JAMAIS écrit ici : il marque une
    // connexion COMPLÈTE et est posé par /api/otp/verify quand le code OTP est
    // confirmé (Task 75). Un défi abandonné, expiré ou annulé ne compte PAS
    // comme une connexion : l'OTP sera de nouveau exigé — et le QR code de
    // nouveau affiché si la PREMIÈRE connexion n'est toujours pas complétée.
    // (MODIFIÉ Task 80) VERROU D'AFFICHAGE DU QR : `!acc.lastLoginAt &&
    // !acc.qrPresente` — le QR ne s'affiche qu'à la TOUTE PREMIÈRE connexion
    // ET tant que la page QR n'a pas DÉJÀ été servie (qrPresente est posé par
    // GET /otp au moment de l'affichage) : après UN affichage, la reconnexion
    // ouvre directement la page de confirmation du code — le QR ne revient
    // plus (il reste ré-affichable par le RH/IT, section « Gestion des QR
    // codes », et réinitialisable avec un nouveau secret).
    // (NOUVEAU Task 83 — maquette) PREMIÈRE CONNEXION / ACCÈS RÉINITIALISÉ :
    // le changement du mot de passe initial se fait sur la PAGE DÉDIÉE
    // /premiere (CIN + mot de passe initial + nouveau mot de passe ×2 →
    // « Valider » → étape 2 : QR + code OTP — cartes 1 et 2 de la maquette).
    // La connexion classique oriente donc vers cette page SANS créer de défi
    // OTP (retours utilisateur : « Le changement du mot de passe initial ne
    // s'affiche pas » + maquette « 1. Identification + changement du mot de
    // passe »).
    if (acc.mustChangePassword) {
      return sendJson(res, 200, {
        ok: true,
        premiere: true,
        premiereConnexion: true,
        redirect: "/premiere",
        cinMasked: "•••" + cin.slice(-3),
      });
    }
    const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente; // Task 75/76 + verrou d'affichage Task 80
    await prisma.portalAccess.update({
      where: { id: acc.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    // (NOUVEAU Task 78) secret TOTP PERSISTANT de l'employé : généré UNE SEULE
    // FOIS à la première validation CIN + mot de passe, réutilisé ensuite
    // (les codes de l'application d'authentification restent valables d'une
    // connexion à l'autre). 20 octets aléatoires = 32 caractères Base32
    // (recommandation de la spec « Key URI Format »).
    // (MODIFIÉ Task 80) le secret est CHIFFRÉ EN BASE (champ « alea » — carte
    // Task 32, même standard que passwordHash) : déchiffrement explicite à la
    // lecture, chiffrement à l'écriture. Valeurs historiques en clair
    // (Task 78/79) tolérées : dechiffrerChamp les renvoie telles quelles.
    // (REFONTE Task 86 — « Qr code n'expire pas apres 10 minute vérifier »)
    // le secret d'un employé NON INSCRIT n'est plus persistant d'office : c'est
    // une FENÊTRE de 10 minutes (obtenirSecretFenetre — réutilisée tant qu'elle
    // est vivante, RÉGÉNÉRée sinon, scellée par la confirmation du code).
    // Un employé INSCRIT conserve son secret définitif (aucune rotation).
    const fenetre = await obtenirSecretFenetre(acc);
    const secretOtp = fenetre.secret;
    // ============================================================
    // (NOUVEAU Task 82) CHAMP « CODE OTP » DU FORMULAIRE DE CONNEXION
    // Retour utilisateur : « Il n'y a pas de champ permettant de saisir
    // l'OTP. » Le formulaire de connexion comporte DÉSORMAIS un 3ᵉ champ :
    // l'employé inscrit via le QR de la première connexion saisit son CIN,
    // son mot de passe ET le code de son application d'authentification en
    // UNE étape (demande Task 74 : « l'utilisateur doit obligatoirement
    // saisir son CIN, son mot de passe ainsi que l'OTP »).
    //  - code fourni et VALIDE (vérification TOTP directe, tolérance ±1
    //    fenêtre, anti-rejeu lastUsedWindow) → connexion COMPLÈTE en une
    //    requête : changement du mot de passe initial (/changer) si dû,
    //    sinon accès direct aux fiches ;
    //  - code fourni et REFUSÉ aux connexions SUIVANTES (2ᵉ et +) : même
    //    traitement qu'un mauvais mot de passe (compteur d'échecs partagé,
    //    verrouillage 15 minutes après 5 tentatives) + message explicite ;
    //  - code fourni et REFUSÉ à la PREMIÈRE connexion : l'employé n'a
    //    normalement pas encore d'application inscrite (le QR du portail
    //    n'a jamais été affiché) — le code ne peut être que parasite : il
    //    est IGNORÉ et le parcours d'inscription QR continue (jamais de
    //    blocage de la première connexion). Exception couverte : le QR
    //    montré par le RH (action « Afficher le QR » de la section
    //    « Gestion des QR codes », même secret persistant) — si le code
    //    fourni EST valable, la connexion complète s'ouvre directement ;
    //  - code malformé (≠ 6 chiffres après tolérance tirets/espaces) → 400.
    // Champ VIDE → parcours en deux étapes INCHANGÉ (défi OTP + page /otp).
    // ============================================================
    const otpSaisi = String(body?.otp ?? "").replace(/[\s-]/g, "");
    let tOtp = null; // résultat de la vérification TOTP si un code a été fourni
    if (otpSaisi) {
      if (!/^\d{6}$/.test(otpSaisi)) {
        return sendJson(res, 400, {
          error:
            "Le code OTP doit contenir exactement 6 chiffres. Première connexion ? Laissez le champ Code OTP vide : le portail affichera le QR code d'inscription.",
        });
      }
      tOtp = verifyTotp(secretOtp, otpSaisi, acc.lastUsedWindow);
      if (!tOtp.ok && !premiereConnexion) {
        const attempts = (acc.failedAttempts || 0) + 1;
        const lock = attempts >= MAX_VERIFY_ATTEMPTS;
        await prisma.portalAccess.update({
          where: { id: acc.id },
          data: {
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : acc.lockedUntil,
          },
        });
        await sleep(400); // ralentit le force-brute sur le code
        if (lock) {
          const mins = Math.ceil(LOCK_MS / 60000);
          return sendJson(res, 401, {
            error:
              "Trop de codes OTP incorrects : accès temporairement verrouillé. Réessayez dans " +
              mins +
              " minutes ou contactez votre service RH.",
          });
        }
        const restantes = MAX_VERIFY_ATTEMPTS - attempts;
        return sendJson(res, 401, {
          error:
            "Code OTP incorrect. Il vous reste " + restantes + " tentative" +
            (restantes > 1 ? "s" : "") +
            ". Vérifiez le code de votre application d'authentification — ou laissez le champ Code OTP vide pour afficher la fenêtre QR code à l'étape suivante.",
        });
      }
      // (!tOtp.ok && premiereConnexion) → code parasite IGNORÉ : parcours QR.
    }
    if (tOtp && tOtp.ok) {
      // Connexion complète en UNE étape : anti-rejeu (fenêtre consommée),
      // première connexion SCELLÉE si elle ne l'était pas encore (Task 75 :
      // lastLoginAt marque une connexion complète — posé ici comme dans
      // /api/otp/verify), échecs remis à zéro ; un éventuel défi OTP en
      // cours devient sans objet.
      otpDefis.delete(cin);
      await prisma.portalAccess.update({
        where: { id: acc.id },
        data: {
          ...(acc.lastUsedWindow !== tOtp.window ? { lastUsedWindow: tOtp.window } : {}),
          ...(!acc.lastLoginAt ? { lastLoginAt: new Date() } : {}),
          // (Task 86) le code a été confirmé → le secret de fenêtre devient
          // DÉFINITIF (scellement : otpFenetreCreeA repassé à null).
          ...(acc.otpFenetreCreeA ? { otpFenetreCreeA: null } : {}),
        },
      });
      // (Task 64) changement du mot de passe OBLIGATOIRE ? — évalué ici
      // aussi (retour utilisateur Task 82 : « Le changement du mot de passe
      // initial ne s'affiche pas ») : dès la connexion en une étape, la
      // redirection /changer ouvre la page de changement quand le mot de
      // passe initial (ou réinitialisé, ou expiré) doit être remplacé.
      const doitChanger =
        acc.mustChangePassword || estMotDePasseExpire(acc.passwordChangedAt);
      if (doitChanger) {
        // Session « pending » 10 minutes : AUCUN accès aux fiches tant que
        // le changement n'est pas enregistré.
        setSessionCookie(res, createPortalSession(cin, false, true), PENDING_MAX_AGE);
        return sendJson(res, 200, {
          ok: true,
          mustChangePassword: true,
          motif: acc.mustChangePassword
            ? acc.passwordChangedAt
              ? "reinitialise"
              : "initial"
            : "expire",
          redirect: "/changer",
          cinMasked: "•••" + cin.slice(-3),
        });
      }
      // (MODIFIÉ Task 33) durée du cookie alignée sur « Se souvenir de moi »
      setSessionCookie(
        res,
        createPortalSession(cin, remember, false),
        remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE
      );
      return sendJson(res, 200, {
        ok: true,
        cinMasked: "•••" + cin.slice(-3),
        redirect: "/",
      });
    }
    // (NOUVEAU Task 74, MODIFIÉ Task 75, MODIFIÉ Task 76, MODIFIÉ Task 82,
    // MODIFIÉ Task 85) VÉRIFICATION EN DEUX ÉTAPES À CHAQUE CONNEXION
    // (demande utilisateur Task 76 : « Lors de la première connexion, le QR
    // code s'affiche. Lors des connexions suivantes, l'utilisateur doit
    // obligatoirement saisir son CIN, son mot de passe ainsi que l'OTP ») :
    // CIN et mot de passe VALIDÉS → le portail pose un défi OTP (valable
    // 10 MINUTES) et une session transitoire « otp ». (MODIFIÉ Task 82) CE
    // PARCOURS NE CONCERNE PLUS QUE les connexions SANS code fourni (champ
    // « Code OTP » vide, ou code parasite ignoré à la première connexion) :
    // l'employé qui SAISIT le code de son application dans le formulaire
    // s'est déjà connecté ci-dessus en UNE étape. (REFONTE Task 85) la
    // fenêtre /otp affiche LE QR CODE dans TOUS les cas — AUCUN code OTP
    // n'est généré ni affiché en clair (demande utilisateur : « jamais
    // affiche le code otp comme ca, dans cette fenetre n affiche que qr
    // code qui expire apres 10 minute ») : l'employé scanne le QR avec son
    // application d'authentification puis confirme le code qu'elle génère
    // pour ouvrir réellement sa session. La décision « changement de mot de
    // passe obligatoire ? » (Task 64) est évaluée APRÈS la confirmation du
    // code (route /api/otp/verify) — et DÈS la connexion en une étape
    // (Task 82).
    // (MODIFIÉ Task 86) la fenêtre du défi est ALIGNÉE sur la vie du secret
    // de fenêtre (expireAt = otpFenetreCreeA + 10 min pour un non inscrit) :
    // QR et fenêtre expirent ENSEMBLE.
    const defi = creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt);
    setSessionCookie(res, createPortalSession(cin, false, false, true), OTP_COOKIE_MAX_AGE);
    return sendJson(res, 200, {
      ok: true,
      otpRequired: true,
      premiereConnexion,
      redirect: "/otp",
      expireAt: new Date(defi.expireAt).toISOString(),
      cinMasked: "•••" + cin.slice(-3),
    });
  }

  // ---- (NOUVEAU Task 83 — MAQUETTE) /api/premiere : ÉTAPE 1 DE LA PREMIÈRE
  // CONNEXION — identification (CIN + mot de passe initial) + changement du
  // mot de passe initial en UNE requête, puis étape 2 (/otp : QR + code OTP).
  // Sécurité : mêmes gardes que /api/verify (limiteur de requêtes, message
  // générique identique CIN inconnu / mot de passe faux, compteur d'échecs +
  // verrouillage, temps constant) ; politique du nouveau mot de passe
  // IDENTIQUE à /api/change-password (Task 64/66 : >= 8 vrais caractères
  // hors tirets/espaces, != actuel, != CIN, forme nettoyée enregistrée).
  if (pathname === "/api/premiere" && req.method === "POST") {
    if (!allowRequest(ip, "premiere")) {
      return sendJson(res, 429, {
        error: "Trop de tentatives depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const bodyRaw = await readBody(req);
    let body = null;
    try {
      body = bodyRaw ? JSON.parse(bodyRaw) : null;
    } catch {
      body = null;
    }
    const cin = normalizeText(body?.cin);
    const motDePasseInitial = String(body?.password ?? "");
    const nouveauBrut = String(body?.newPassword ?? "");
    const repeteBrut = String(body?.confirm ?? "");
    if (cin.length < 3 || cin.length > 30) {
      return sendJson(res, 400, { error: "Veuillez saisir votre numéro CIN complet." });
    }
    if (!motDePasseInitial) {
      return sendJson(res, 400, { error: "Veuillez saisir votre mot de passe initial." });
    }
    if (!nouveauBrut) {
      return sendJson(res, 400, { error: "Veuillez choisir un nouveau mot de passe." });
    }
    if (!repeteBrut) {
      return sendJson(res, 400, { error: "Veuillez répéter le nouveau mot de passe." });
    }
    // (Task 83 — maquette) la répétition doit correspondre (champ
    // « Répéter le nouveau mot de passe »).
    if (nettoyerMotDePasse(nouveauBrut) !== nettoyerMotDePasse(repeteBrut)) {
      return sendJson(res, 400, {
        error: "La répétition ne correspond pas au nouveau mot de passe.",
      });
    }
    const acc = await prisma.portalAccess.findUnique({
      where: { cin: cryptoBd.chiffrerChamp(cin, true) },
    });
    // Message IDENTIQUE quel que soit le problème (pas d'énumération de CIN)
    const genericPremiere = "CIN ou mot de passe incorrect. Réessayez.";
    if (!acc || !acc.isActive) {
      await sleep(400); // ralentit les tentatives d'énumération
      return sendJson(res, 401, { error: genericPremiere });
    }
    if (acc.lockedUntil && new Date(acc.lockedUntil).getTime() > Date.now()) {
      const mins = Math.max(
        1,
        Math.ceil((new Date(acc.lockedUntil).getTime() - Date.now()) / 60000)
      );
      return sendJson(res, 423, {
        error:
          "Trop de tentatives : accès temporairement verrouillé. Réessayez dans " +
          mins +
          " minute" +
          (mins > 1 ? "s" : "") +
          " ou contactez votre service RH.",
      });
    }
    if (!acc.passwordHash) {
      await prisma.portalAccess.update({
        where: { id: acc.id },
        data: { failedAttempts: (acc.failedAttempts || 0) + 1 },
      });
      await sleep(400);
      return sendJson(res, 401, {
        error:
          "La connexion par mot de passe n'est pas encore activée pour ce CIN. Demandez à votre service RH de RÉINITIALISER votre accès : il vous remettra un mot de passe initial.",
      });
    }
    // Preuve d'identité : le mot de passe INITIAL est obligatoire (Task 66 :
    // vérification tolérante — tirets/espaces de la saisie ignorés).
    const hashInitial = cryptoBd.dechiffrerChamp(acc.passwordHash);
    if (!verifierMotDePasseTolerant(motDePasseInitial, hashInitial)) {
      const attempts = (acc.failedAttempts || 0) + 1;
      const lock = attempts >= MAX_VERIFY_ATTEMPTS;
      await prisma.portalAccess.update({
        where: { id: acc.id },
        data: {
          failedAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : acc.lockedUntil,
        },
      });
      await sleep(400);
      return sendJson(res, 401, { error: genericPremiere });
    }
    if (!acc.mustChangePassword) {
      // (Task 83) la page /premiere n'a de sens que pour un mot de passe
      // INITIAL (ou réinitialisé) à remplacer : un employé déjà configuré
      // se connecte normalement (CIN + mot de passe + code OTP).
      return sendJson(res, 400, {
        error:
          "Votre mot de passe est déjà personnalisé. Connectez-vous avec votre CIN, votre mot de passe et votre code OTP.",
      });
    }
    // (Task 64/66) politique du NOUVEAU mot de passe : identique à
    // /api/change-password — validation sur les formes NETTOYÉES.
    const nouveauPropre = nettoyerMotDePasse(nouveauBrut);
    const actuelPropre = nettoyerMotDePasse(motDePasseInitial);
    const erreurValidation = validerNouveauMotDePasse(nouveauPropre, actuelPropre, cin);
    if (erreurValidation) {
      return sendJson(res, 400, { error: erreurValidation });
    }
    // Enregistrement : nouveau hash + compteur des 15 jours remis à zéro +
    // échecs effacés (identité prouvée).
    // (Task 92) la COPIE CHIFFRÉE du mot de passe initial est EFFACÉE : le
    // mot de passe initial n'existe plus (l'employé vient de choisir le
    // sien) — le service « Send Mail » ne peut plus le renvoyer.
    await prisma.portalAccess.update({
      where: { id: acc.id },
      data: {
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse(nouveauPropre), false),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        initialPasswordEnc: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    // (Task 78/80) secret TOTP : généré s'il manque (le QR de l'étape 2 encode
    // TOUJOURS le secret persistant de l'employé).
    // (REFONTE Task 86) le secret de l'étape 2 est une FENÊTRE de 10 minutes
    // tant que l'inscription n'est pas confirmée (obtenirSecretFenetre) :
    // réutilisée si vivante, RÉGÉNÉRée sinon — le QR affiché à l'étape 2
    // expire VRAIMENT avec sa fenêtre.
    const fenetre = await obtenirSecretFenetre(acc);
    const secretPremiere = fenetre.secret;
    // Étape 2 : défi OTP (QR code à la PREMIÈRE connexion seule — verrou
    // Task 80 : !lastLoginAt && !qrPresente — JAMAIS de QR aux connexions
    // suivantes, règle utilisateur « Ne jamais afficher à nouveau le QR »).
    const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;
    // (MODIFIÉ Task 86) la fenêtre du défi est ALIGNÉE sur la vie du secret
    // de fenêtre — QR et fenêtre expirent ENSEMBLE.
    creerDefiOtp(cin, false, premiereInscription, secretPremiere, fenetre.expireAt);
    setSessionCookie(res, createPortalSession(cin, false, false, true), OTP_COOKIE_MAX_AGE);
    return sendJson(res, 200, {
      ok: true,
      step: 2,
      premiereConnexion: premiereInscription,
      redirect: "/otp",
      expireAt: new Date(
        fenetre.expireAt != null ? fenetre.expireAt : Date.now() + OTP_TTL_MS
      ).toISOString(),
      cinMasked: "•••" + cin.slice(-3),
    });
  }

  // ---- NOUVEAU (Task 64) Enregistrement du NOUVEAU mot de passe ----
  // Accessible UNIQUEMENT avec une session « pending » (posée après une
  // connexion par mot de passe initial / réinitialisé / expiré).
  if (pathname === "/api/change-password" && req.method === "POST") {
    if (!allowRequest(ip, "change")) {
      return sendJson(res, 429, {
        error: "Trop de tentatives depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const sess = getSessionCin(req);
    if (!sess) {
      return sendJson(res, 401, {
        error: "Session expirée. Reconnectez-vous avec votre CIN et votre mot de passe.",
      });
    }
    if (sess.otp) {
      // NOUVEAU (Task 74) : étape code OTP en cours — rien à changer avant
      return sendJson(res, 403, {
        error: "Confirmez d'abord le code OTP généré par votre application d'authentification.",
        code: "OTP_REQUIS",
      });
    }
    const bodyRaw = await readBody(req);
    let body = null;
    try {
      body = bodyRaw ? JSON.parse(bodyRaw) : null;
    } catch {
      body = null;
    }
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    if (!currentPassword || !newPassword) {
      return sendJson(res, 400, {
        error: "Veuillez saisir votre mot de passe actuel et le nouveau mot de passe.",
      });
    }
    const acc = await prisma.portalAccess.findUnique({
      where: { cin: cryptoBd.chiffrerChamp(sess.cin, true) },
    });
    if (!acc || !acc.isActive) {
      clearSessionCookie(res);
      return sendJson(res, 403, { error: "Accès introuvable ou désactivé. Contactez votre service RH." });
    }
    // 1) Preuve d'identité : le mot de passe ACTUEL est obligatoire
    //    (Task 66 : vérification tolérante — tirets/espaces de saisie ignorés)
    const hashClair = cryptoBd.dechiffrerChamp(acc.passwordHash);
    if (!hashClair || !verifierMotDePasseTolerant(currentPassword, hashClair)) {
      return sendJson(res, 401, { error: "Mot de passe actuel incorrect." });
    }
    // 2) Le changement reste-t-il exigé ? (déjà fait depuis un autre onglet ?)
    const doitChanger =
      sess.pending ||
      acc.mustChangePassword ||
      estMotDePasseExpire(acc.passwordChangedAt);
    if (!doitChanger) {
      // Rien à changer : émettre une session complète et terminer.
      setSessionCookie(res, createPortalSession(sess.cin, false, false), SESSION_MAX_AGE);
      return sendJson(res, 200, { ok: true, alreadyChanged: true });
    }
    // 3) (MODIFIÉ Task 66) Validation du NOUVEAU mot de passe sur sa forme
    //    NETTOYÉE (>= 8 vrais caractères hors tirets/espaces, != actuel,
    //    != CIN) puis ENREGISTREMENT du hash de la forme nettoyée : à la
    //    prochaine connexion, la saisie avec ou sans tirets/espaces sera
    //    acceptée par verifierMotDePasseTolerant().
    const nouveauPropre = nettoyerMotDePasse(newPassword);
    const actuelPropre = nettoyerMotDePasse(currentPassword);
    const erreurValidation = validerNouveauMotDePasse(nouveauPropre, actuelPropre, sess.cin);
    if (erreurValidation) {
      return sendJson(res, 400, { error: erreurValidation });
    }
    // 4) Enregistrement : nouveau hash + compteur des 15 jours remis à zéro
    // (Task 92) la COPIE CHIFFRÉE du mot de passe initial est EFFACÉE s'il
    // en restait une : le mot de passe initial n'existe plus.
    await prisma.portalAccess.update({
      where: { id: acc.id },
      data: {
        passwordHash: cryptoBd.chiffrerChamp(hacherMotDePasse(nouveauPropre), false),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        initialPasswordEnc: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    // 5) La session devient COMPLÈTE : accès aux fiches immédiat
    setSessionCookie(res, createPortalSession(sess.cin, false, false), SESSION_MAX_AGE);
    return sendJson(res, 200, {
      ok: true,
      message: "Mot de passe enregistré. Il sera à nouveau à changer dans 15 jours.",
    });
  }

  // ---- (NOUVEAU Task 18) Déconnexion du portail ----
  if (pathname === "/api/logout" && req.method === "POST") {
    // NOUVEAU (Task 74) : annule tout défi OTP en cours pour ce CIN
    const sessDeconnexion = getSessionCin(req);
    if (sessDeconnexion && sessDeconnexion.cin) otpDefis.delete(sessDeconnexion.cin);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // ---- (NOUVEAU Task 18) Fiches de la session connectée ----
  // Endpoint utilisé par la page authentifiée : renvoie UNIQUEMENT les fiches
  // du CIN de la session (jamais celles d'un autre employé).
  if (pathname === "/api/my-fiches" && req.method === "GET") {
    const sess = getSessionCin(req);
    if (!sess) {
      return sendJson(res, 401, { error: "Session expirée. Reconnectez-vous." });
    }
    // NOUVEAU (Task 64) : changement de mot de passe OBLIGATOIRE en cours —
    // aucune donnée tant que le nouveau mot de passe n'est pas enregistré.
    if (sess.pending) {
      return sendJson(res, 403, {
        error: "Vous devez d'abord choisir votre nouveau mot de passe.",
        code: "MUST_CHANGE_PASSWORD",
      });
    }
    // NOUVEAU (Task 74) : étape code OTP en cours — aucune donnée tant que le
    // code affiché (QR) n'est pas confirmé. AVANT le renouvellement glissant :
    // une session OTP ne doit JAMAIS être prolongée ni convertie en session
    // complète par la simple consultation.
    if (sess.otp) {
      return sendJson(res, 403, {
        error: "Confirmez d'abord le code OTP généré par votre application d'authentification.",
        code: "OTP_REQUIS",
      });
    }
    renouvelerSession(res, sess); // (Task 33) session glissante
    if (!allowRequest(ip, "search")) {
      return sendJson(res, 429, {
        error: "Trop de demandes depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const rows = await searchPayslipsByCin(sess.cin);
    // (MODIFIÉ 0.2.60) TOUTES les fiches du CIN sont trouvées puis servies par
    // pages (?page=N&perPage=M — défauts : page 1, 100/page, plafond 500).
    // `total` est le nombre TOTAL de fiches du CIN (plus jamais la taille de
    // la seule page servie) — l'interface affiche « X fiches … page N sur M »
    // avec navigation. Aucune limitation, aucune perte de données.
    const { meta, items } = paginerResultats(rows, url);
    // NOUVEAU (Task 231) : « signée électroniquement » — le registre des
    // signatures (même base SQLite) indique quelles fiches de la page
    // possèdent une copie signée conservée (import v0.2.116 ou servage).
    const idsSigMine = new Set(await idsFichesSignees(items.map((r) => r.id)));
    const itemsMine = items.map((r) =>
      Object.assign({}, r, { signeeElectronique: idsSigMine.has(r.id) })
    );
    return sendJson(res, 200, {
      exact: true,
      ...meta,
      items: itemsMine,
      // Le CIN complet est renvoyé au client UNIQUEMENT pour construire les
      // URLs d'ouverture des PDF ; il est affiché masqué (Task 17) et la
      // session ne porte que sur CE CIN.
      cin: sess.cin,
    });
  }

  // ---- Recherche par CIN (MODIFIÉ Task 18 : PROTÉGÉE PAR SESSION) ----
  // La recherche est VERROUILLÉE sur le CIN de la session connectée : un
  // employé ne peut jamais interroger le CIN d'une autre personne.
  if (pathname === "/api/search" && req.method === "GET") {
    const sess = getSessionCin(req);
    if (!sess) {
      return sendJson(res, 401, {
        error: "Connexion requise : saisissez votre CIN et votre mot de passe.",
      });
    }
    // NOUVEAU (Task 64) : changement de mot de passe OBLIGATOIRE en cours
    if (sess.pending) {
      return sendJson(res, 403, {
        error: "Vous devez d'abord choisir votre nouveau mot de passe.",
        code: "MUST_CHANGE_PASSWORD",
      });
    }
    // NOUVEAU (Task 74) : étape code OTP en cours — recherche bloquée
    if (sess.otp) {
      return sendJson(res, 403, {
        error: "Confirmez d'abord le code OTP généré par votre application d'authentification.",
        code: "OTP_REQUIS",
      });
    }
    if (!allowRequest(ip, "search")) {
      return sendJson(res, 429, {
        error: "Trop de recherches depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    // (ANCIEN comportement conservé) un paramètre cin est toléré uniquement
    // s'il correspond au CIN de la session — sinon accès refusé.
    const raw = normalizeText(url.searchParams.get("cin") || "");
    if (raw && raw !== sess.cin) {
      return sendJson(res, 403, { error: "Accès limité à vos propres fiches de paie." });
    }
    const q = sess.cin;
    if (q.length < 3 || q.length > 30) {
      return sendJson(res, 400, { error: "CIN de session invalide." });
    }
    const rows = await searchPayslipsByCin(q);
    // (MODIFIÉ 0.2.60) pagination identique à /api/my-fiches — même contrat,
    // mêmes paramètres ?page=N&perPage=M, métadonnées complètes.
    const { meta: metaRech, items: itemsRech } = paginerResultats(rows, url);
    // NOUVEAU (Task 231) : indicateur « signée électroniquement » (registre).
    const idsSigRech = new Set(await idsFichesSignees(itemsRech.map((r) => r.id)));
    const itemsRechSig = itemsRech.map((r) =>
      Object.assign({}, r, { signeeElectronique: idsSigRech.has(r.id) })
    );
    return sendJson(res, 200, {
      exact: true,
      ...metaRech,
      items: itemsRechSig,
    });
  }

  // ---- Fichier PDF (revérification obligatoire du CIN) ----
  const mFile = pathname.match(/^\/api\/payslip\/([A-Za-z0-9]+)\/file$/);
  if (mFile && req.method === "GET") {
    if (!allowRequest(ip, "file")) {
      return sendJson(res, 429, {
        error: "Trop de demandes depuis cet appareil. Veuillez patienter une minute puis réessayer.",
      });
    }
    const id = mFile[1];
    // (NOUVEAU Task 18) session OBLIGATOIRE + CIN limité à celui de la session
    const sess = getSessionCin(req);
    if (!sess) {
      return sendJson(res, 401, {
        error: "Connexion requise : saisissez votre CIN et votre mot de passe.",
      });
    }
    // NOUVEAU (Task 64) : changement de mot de passe OBLIGATOIRE en cours
    if (sess.pending) {
      return sendJson(res, 403, {
        error: "Vous devez d'abord choisir votre nouveau mot de passe.",
        code: "MUST_CHANGE_PASSWORD",
      });
    }
    // NOUVEAU (Task 74) : étape code OTP en cours — aucun fichier accessible
    if (sess.otp) {
      return sendJson(res, 403, {
        error: "Confirmez d'abord le code OTP généré par votre application d'authentification.",
        code: "OTP_REQUIS",
      });
    }
    const q = normalizeText(url.searchParams.get("cin") || "");
    if (q.length < 3) {
      return sendJson(res, 400, { error: "CIN manquant ou invalide : accès refusé." });
    }
    if (q !== sess.cin) {
      return sendJson(res, 403, { error: "Accès limité à vos propres fiches de paie." });
    }
    // (MODIFIÉ Task 32 : base chiffrée) déchiffrement des champs sensibles de
    // la fiche (cin, content, fileName…) avant la revérification d'accès.
    const rec = cryptoBd.dechiffrerObjet(
      "Payslip",
      await prisma.payslip.findUnique({ where: { id } })
    );
    // Revérification EXACTE : le CIN saisi doit etre un numero COMPLET
    // present dans le contenu de la fiche (un CIN partiel ne suffit pas).
    // (CORRECTIF « l'employé ne voit pas sa fiche ») : le champ cin est
    // aussi comparé sur sa forme NORMALISÉE — « SPEC-0001 » / « 12 345 678 »
    // en base correspondent à « SPEC0001 » / « 12345678 » (session). Aucun
    // comportement antérieur retiré : les tests d'origine restent en place.
    if (
      !rec ||
      !(
        (rec.cin && normalizeText(rec.cin) === q) ||
        isExactCinInContent(rec.content, q)
      )
    ) {
      return sendJson(res, 403, {
        error: "Accès refusé : ce CIN ne correspond pas à cette fiche de paie.",
      });
    }
    // (NOUVEAU) recherche du fichier dans les dossiers candidats + recherche
    // approfondie (ancien chemin ROOT/storage/payslips conservé — aucun
    // comportement retiré). Corrige notamment les PDF rangés par les versions
    // précédentes dans .next/standalone/storage/payslips/.
    const found = findStoredFile(rec.storedName);
    if (!found.filePath) {
      const triedList = found.tried.join("  |  ");
      console.error("[PORTAIL] PDF introuvable pour", rec.fileName, "— dossiers essayés :", triedList);
      return sendJson(res, 404, {
        error:
          "Fichier PDF introuvable sur le serveur. La fiche existe bien, mais aucun dossier examiné ne contient ce fichier. Dossiers vérifiés : " +
          found.tried.join(" ; ") +
          ". Solutions : 1) relancez le portail depuis le MÊME dossier que le site d'administration ; 2) ou définissez la variable STORAGE_DIR (ou AUTO_RH_STORAGE_DIR) vers le dossier storage\\payslips du site ; 3) si le site a été démarré avec une version antérieure, le fichier se trouve peut-être dans .next\\standalone\\storage\\payslips — mettez à jour le portail (scripts/portail-server.js) qui le retrouvera automatiquement.",
      });
    }
    const filePath = found.filePath;
    // (Task 21) lecture CHIFFRÉE sur le disque : on lit le fichier, on
    // déchiffre si besoin (AES-256-GCM), puis on sert le contenu en clair
    // UNIQUEMENT au navigateur de l'employé connecté. Le stream historique
    // est remplacé par une lecture complète (fiches de quelques Mo max) —
    // les fichiers non chiffrés (fiches anciennes) suivent le même chemin.
    let data;
    try {
      data = decryptFromStorage(fs.readFileSync(filePath));
    } catch (e) {
      console.error("[PORTAIL] Fichier illisible (clé de chiffrement différente ?)", rec.fileName, e.message);
      return sendJson(res, 500, {
        error:
          "Fiche illisible sur le serveur : la clé de chiffrement (AUTO_RH_STORAGE_KEY dans .env) ne correspond pas à celle utilisée lors du chiffrement. Vérifiez le fichier .env du site.",
      });
    }
    const download = url.searchParams.get("download") === "1";
    const safeName = rec.fileName.replace(/["\\\r\n]/g, "_");
    // NOUVEAU (ajouté sans modifier le comportement PDF historique) : les
    // fiches importées en IMAGE (PNG/JPG, lues par OCR sur le site admin)
    // sont servies avec le bon type MIME ; les PDF restent en application/pdf.
    // NOUVEAU (ajouté sans modifier les types ci-dessus) : Excel et Word.
    const lowerStored = String(rec.storedName || "").toLowerCase();
    const contentType = lowerStored.endsWith(".png")
      ? "image/png"
      : lowerStored.endsWith(".jpg") || lowerStored.endsWith(".jpeg")
        ? "image/jpeg"
        : lowerStored.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : lowerStored.endsWith(".xls")
            ? "application/vnd.ms-excel"
            : lowerStored.endsWith(".xlsm")
              ? "application/vnd.ms-excel.sheet.macroEnabled.12"
              : lowerStored.endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "application/pdf";
    // NOUVEAU (Task 118) — TAMPON AUTOMATIQUE (signature électronique et/ou
    // QR code et/ou mention) sur les PDF ; (MODIFIÉ 0.2.48) AUSSI sur les
    // fiches IMAGE (PNG/JPG), DOCX et XLSX/XLSM via le répartiteur
    // tamponnerFicheDossierTampon (jumelle de src/lib/stamp.ts) — le .xls
    // binaire reste servi tel quel. Jamais bloquant : repli interne sur le
    // fichier original en cas d'erreur.
    let donneesFinales = data;
    // ========================================================================
    // (NOUVEAU Task 244) — ÉTAPE 1 : COPIE FIGÉE = SIGNATURE D'ORIGINE.
    // Si cette fiche a DÉJÀ été signée (copie figée posée à sa première
    // signature), elle est servie TELLE QUELLE : l'employé revoit
    // EXACTEMENT le document signé qu'il a reçu, même si la signature a été
    // modifiée ou remplacée dans les paramètres entre-temps. Intégrité
    // contrôlée par SHA-256 ; toute anomalie → repli sur les étapes 2/3.
    // ========================================================================
    let copieFigeeServie = false;
    try {
      if (rec.copieSigneeNom) {
        const cheminFigee = trouverCopieFigee(rec.copieSigneeNom);
        if (cheminFigee) {
          const figee = decryptFromStorage(fs.readFileSync(cheminFigee));
          const empreinteFigee = crypto.createHash("sha256").update(figee).digest("hex");
          if (figee && figee.length && (!rec.copieSigneeEmpreinte || empreinteFigee === rec.copieSigneeEmpreinte)) {
            donneesFinales = figee;
            copieFigeeServie = true;
            console.log("[PORTAIL] Fiche", id, "— copie signée FIGÉE servie (signature d'origine préservée)");
          } else {
            console.error("[PORTAIL] Intégrité de la copie figée REFUSÉE pour la fiche", id, "— repli");
          }
        }
      }
    } catch (e) {
      console.error("[PORTAIL] Copie figée illisible (repli):", e && e.message ? e.message : e);
    }
    // NOUVEAU (Task 231, MODIFIÉ Task 244) — ÉTAPE 2 : COPIE SIGNÉE CONSERVÉE
    // (registre PAdES) — la PREMIÈRE signature de la fiche (signeLe ASC,
    // AVANT : la plus récente), c'est-à-dire sa signature D'ORIGINE, est
    // servie : l'employé télécharge EXACTEMENT le document signé que le RH
    // délivre. La copie conservée est DÉJÀ tamponnée : AUCUN retamponnage
    // ici (toute retouche invaliderait la signature). Elle est aussitôt
    // matérialisée en copie figée (étape 1 des servages suivants).
    // JAMAIS bloquant : copie absente ou illisible → étape 3.
    let copieSignee = null;
    if (!copieFigeeServie) {
      try {
        const sig = await prisma.signatureApiDocument.findFirst({
          where: { type: "FICHE_PAIE", sourceId: id, chemin: { not: "" } },
          orderBy: { signeLe: "asc" }, // (Task 244) PREMIÈRE signature = signature d'origine
        });
        if (sig && sig.chemin) {
          const cheminCopie = trouverCopieSignee(sig.chemin);
          if (cheminCopie) {
            const copie = decryptFromStorage(fs.readFileSync(cheminCopie));
            if (copie && copie.length) {
              donneesFinales = copie;
              copieSignee = sig;
              await figerCopieSigneePortail(id, copie, "PADES");
              console.log("[PORTAIL] Fiche", id, "— copie signée CONSERVÉE servie (signature d'origine)");
            }
          }
        }
      } catch (e) {
        console.error("[PORTAIL] Copie signée indisponible (repli original):", e && e.message ? e.message : e);
      }
    }
    // (MODIFIÉ Task 244) ÉTAPE 3 : tampon jumelle — UNIQUEMENT pour une fiche
    // pas ENCORE signée (aucune copie figée ni copie conservée) ; le rendu
    // produit avec la configuration ACTIVE est aussitôt FIGÉ : cette
    // première signature devient la signature d'origine de la fiche.
    if (!copieSignee && !copieFigeeServie) {
      const typeTampon = typeFichierTamporableTampon(contentType);
      if (typeTampon) {
        try {
          const cfgTampon = await lireConfigTampon();
          if (cfgTampon) {
            donneesFinales = await tamponnerFicheDossierTampon(data, rec, cfgTampon, typeTampon);
            await figerCopieSigneePortail(id, donneesFinales, "TAMPON");
          }
        } catch (e) {
          console.error("[PORTAIL] Tampon non appliqué:", e && e.message ? e.message : e);
        }
      }
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": contentType,
      "Content-Length": String(donneesFinales.length),
      "Content-Disposition":
        (download ? "attachment" : "inline") +
        '; filename="' + safeName + '"' +
        "; filename*=UTF-8''" + encodeURIComponent(rec.fileName),
      "Cache-Control": "no-store",
      // (Task 231, MODIFIÉ Task 244) même en-tête informatif que le site
      // d'administration — la signature d'origine servie est annoncée.
      ...(copieFigeeServie
        ? {
            "X-Signature-Electronique": encodeURIComponent(
              "signature d'origine préservée (copie figée " +
                (rec.copieSigneeNature || "signature") +
                " du " +
                (rec.copieSigneeLe ? new Date(rec.copieSigneeLe).toISOString() : "date inconnue") +
                ") — toute modification de la configuration ne s'applique pas aux fiches déjà signées"
            ),
          }
        : {}),
      ...(copieSignee
        ? {
            "X-Signature-Electronique": encodeURIComponent(
              "copie signée conservée — signature d'origine, signée par « " +
                (copieSignee.certSujet || "certificat") +
                " » le " + copieSignee.signeLe.toISOString()
            ),
          }
        : {}),
    });
    res.end(donneesFinales);
    return;
  }

  // ---- Tout le reste : interdit (le portail ne expose QUE sa page et son API) ----
  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "Ressource inconnue du portail employés." });
  }
  return sendErrorPage(
    res, 404,
    "Page introuvable",
    "Le portail employés comporte la page de connexion (CIN + mot de passe), l'écran de changement de mot de passe obligatoire et la consultation des fiches, disponibles à la racine du site."
  );
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[Portail] Erreur:", err);
    if (!res.headersSent) {
      if (isDbError(err)) {
        sendErrorPage(
          res, 503,
          "Base de données indisponible",
          "La base de données du site n'est pas encore initialisée. Lancez le démarrage silencieux (DEMARRER-SILENCIEUX-WINDOWS.vbs) puis réessayez."
        );
      } else {
        sendJson(res, 500, { error: "Erreur interne du portail. Réessayez dans un instant." });
      }
    } else {
      res.end();
    }
  });
});

// (MODIFIÉ — demande utilisateur, point 8 v0.2.88) DÉMARRAGE CONDITIONNEL :
// quand ce fichier est requis par un TEST (require.main !== module), le
// serveur HTTP et le polling IMAP NE démarrent PAS — seules les fonctions
// internes sont exportées (traiterMessageRecu…), ce qui permet de tester la
// validation par réponse du N+1 sans double instance.
if (require.main === module) {
  server.listen(PORT, HOST, () => {
  console.log("");
  console.log("============================================================");
  // MODIFIÉ (Task 64) : le portail est désormais protégé par CIN + mot de passe
  console.log("  AutoRH — Portail Employés (accès sécurisé CIN + mot de passe)");
  console.log("  Connexion : numéro CIN + mot de passe (initial du RH ou personnel)");
  console.log("  Sécurité  : changement OBLIGATOIRE à la 1re connexion puis tous les 15 jours");
  console.log("  (accès créés/réinitialisés dans l'administration, onglet « Accès portail »)");
  console.log("");
  console.log("  Local  :  http://localhost:" + PORT);
  console.log("  Réseau :  http://<adresse-ip-du-poste>:" + PORT);
  console.log("");
  console.log("  Administration RH/IT (autre port) : http://localhost:4000");
  console.log("  Laissez cette fenêtre ouverte. Ctrl+C = arrêter le portail.");
  console.log("============================================================");
  // (NOUVEAU) affichage des dossiers de stockage examinés — aide au diagnostic
  console.log("  Dossiers de PDF (storage) examinés, dans l'ordre :");
  for (const dir of STORAGE_CANDIDATES) {
    let info = "absent";
    try {
      info = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).length + " PDF";
    } catch {}
    console.log("    - " + dir + "  [" + info + "]");
  }
  console.log("");
  // (NOUVEAU v0.2.49) tout document des demandes stocké EN CLAIR est chiffré
  // au démarrage (même mécanisme AES-256-GCM que les fiches de paie) — le
  // dossier documents-demandes devient illisible comme storage/payslips.
  try { chiffrerDocumentsDemandesEnClair(); } catch (err) {
    console.error("[DOCUMENTS] balayage de démarrage en échec (non bloquant) : " + (err && err.message ? err.message : err));
  }
}); // fin server.listen
} // (fin du garde require.main === module : serveur HTTP)

// (NOUVEAU Task 122) RÉCEPTION AUTOMATIQUE DES RÉPONSES DU RH : vérification
// périodique de la boîte de réception (IMAP) pour détecter les réponses aux
// demandes administratives avec leur pièce jointe. Silencieux et sans effet
// tant que la réception n'est pas activée dans l'administration (onglet
// « Accès portail » → rubrique Réception des réponses (IMAP)).
// (MODIFIÉ) démarré UNIQUEMENT en exécution directe (voir garde ci-dessus).
if (require.main === module) {
  demarrerReceptionEmails();

  // Arrêt propre
  function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// (NOUVEAU — demande utilisateur, point 8 v0.2.88) EXPORTS POUR LES TESTS :
// requis par un script de test, le fichier n'ouvre ni port HTTP ni polling
// IMAP — il expose seulement le cœur de la réception (validation par réponse
// du N+1).
if (require.main !== module) {
  module.exports = {
    traiterMessageRecu,
    verifierBoiteDemandes,
    classifierReponse: classificationReponses.classifierReponse,
    calculerStatutFinalDeuxEtapes,
    libelleStatutFinalDemande,
    // (NOUVEAU Task 200) libellé d'une étape de validation exposé au portail
    libelleDecisionEtapeDemande,
    libValidationN1,
    destinatairePourDemande,
    envoyerEmailsValidationN1,
    enregistrerReponseRecue,
    entreeReponseRecue,
    prisma,
  };
}


