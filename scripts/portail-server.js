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
 *     "Auto RH:Espace employé" (MODIFIÉ Task 88 puis v0.2.105 : l'Account
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
 *     passent du BLEU au VERT puis à l'ORANGE logo #4F46E5 (même orange que les boutons),
 *     ombres portées orangées rgba(238,124,28,.28). AUCUNE règle fonctionnelle
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

// (MODIFIÉ Task 64, défaut ajusté v0.2.209) port par défaut du portail : 4001
// (l'administration : 4000, ligne PORT du .env).
// (NOUVEAU) PLUS de repli sur PORT : cette variable appartient à
// l'administration (scripts/start-prod.js). L'ancien repli faisait que la
// ligne « PORT=XXXX » ajoutée au .env POUR l'administration démarrait aussi
// le portail sur le MÊME port (conflit « EADDRINUSE » au lancement).
// Le portail n'écoute que PORTAL_PORT (variable d'environnement ou ligne
// du .env), sinon 4001 par défaut.
const PORT = parseInt(process.env.PORTAL_PORT || "4001", 10);
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
//   2. variable d'environnement SERVICE_RH_STORAGE_DIR     (posée par les scripts de démarrage)
//   3. <dossier du portail>/storage/payslips             (ancien comportement)
//   4. <répertoire de lancement>/storage/payslips        (site lancé depuis un autre cwd)
//   5. <dossier parent du portail>/storage/payslips      (copie imbriquée)
//   6. <racine déduite de DATABASE_URL>/storage/payslips (dossier du site détecté)
//   7. <dossier du portail>/.next/standalone/storage/payslips  (PDF écrits par l'ancien bug)
//   8. <répertoire de lancement>/.next/standalone/storage/payslips
const STORAGE_CANDIDATES = [...new Set(
  [
    process.env.STORAGE_DIR,
    process.env.SERVICE_RH_STORAGE_DIR,
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
const ENC_SALT = "paiesage-storage-v1";

function encKeyMaterial() {
  return (
    process.env.SERVICE_RH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "paiesage-storage-local-a-changer-dans-env"
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
// tel quel ; SERVICE_RH_STORAGE_DISABLE=1 conserve le comportement historique.
function storageEncryptionActive() {
  return process.env.SERVICE_RH_STORAGE_DISABLE !== "1";
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
  return process.env.AUTH_SECRET || "paiesage-secret-local-a-changer-dans-env";
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
 *  (MODIFIÉ Task 88, puis v0.2.105 — renommage Auto RH) le LABEL de l'URI
 *  est « Auto RH:Espace employé » — dans l'application Authenticator, le
 *  champ « Account Name » affiche « Espace employé » AU LIEU du CIN. Le
 *  label ne participe PAS au calcul TOTP (seul le secret compte) : les
 *  comptes déjà associés continuent de générer des codes valables. */
function contenuQrOtp(defi) {
  // (MODIFIÉ Task 88, v0.2.105) Account Name = « Espace employé » (PLUS le
  // CIN) : l'application d'authentification affiche « Espace employé » avec
  // l'émetteur Auto RH ; le CIN n'apparaît plus sur l'écran du téléphone.
  const label = encodeURIComponent("Auto RH:Espace employé");
  return (
    "otpauth://totp/" +
    label +
    "?secret=" +
    String(defi.totpSecret || "") +
    "&issuer=Auto%20RH&algorithm=SHA1&digits=6&period=30"
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
      color: { dark: "#3730A3", light: "#ffffff" },
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

// ---------- MODIFIÉ (v0.2.208) : LOGO « AUTO RH » (nouvelle charte) ----------
// Icône engrenage + personnage, dégradé indigo-violet (même visuel que
// public/icon-trailmix-192.png de l'administration) : header + favicon 64 px. Injectés en
// data URI PNG pour conserver le principe Task 18 : HTML 100 % autonome, aucun
// fichier externe à servir, aucune dépendance.
const LOGO_TRAILMIX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQCAYAAADnRuK4AAAzGUlEQVR42u19eZwcZZn/93mrqo+5cx8ECCEBAgjEEEAhTMIhEPFaHXZVDHgAq7vquv7WH4duEoUVV/H+ScKh8VjXZXYVVpSgkmQgoJFAOMIdggTIQY6ZzNFX1fs+vz/equ7q7uruqp6emQTsz2eYDFXdXce3nuf7fp+L0LAXU1cXRHf3cgZWKO//vvu8l6c7jjPPcdKnChjHA85sQExVxB0Ebiq8n3z/BUCE0m35f1XYpjdV2KbfWPpJRdsCvqnsWKjC+8q2B2zLb6WK3wTiwp5BZ1LY7t8mUgaJPsVql0nmVsXqacto2mRI2vzDPzTv8PZbhmXi6a7l1N0NVfik4b2oEZ/R1cWiu5uk9z+WnP3cXIa4SEFeAFanEGiyEDEADGapf6AA8MENnrIbPXLgIRQuR1jwFH4LEAkYMEFkQhBBqhyI+XWAHjPIvNdguuf2P7Q9431mVxcb3d3kvwmjD6CurjuM7u5LJAB0Hc+xgfFb3wPIjzPkOabZYjHbkCoLZofBpAAmInKvJVE5eKjkiEKCh6jsVtYHnsoAGQvwBFum0t/uv5gZDCa9jUEQgiwyRQKGsGDbA7YhzLUC5u39HS13dXdTzgckOcoAYurq6hbd3ZfIri42Bl9/cSlL53NCmG8BGI5KAQyHtVEQ5AdLAEDGBjxUyXlGBI9vayXwUIVz8oGHSj4rCniC3ZpGFekHlwlkWkYriAhK2U8KYX6rv735J93dJDWI6nNrkQG0bBmLFStIAcA7zn76fGLjBkNYC5TKQsqsBBGIILw7FOyWAm5sJfAEvO+NBp5Klqd4e/FhkP/IGcHAy2/T/yJmBQCmkTQMEYdSuYeh+Lrb13b8vvTejgiAPHPX2bm5I8nNNxKrq0AEx0lJEBERiSgA+SvnqZfzFFue4H0qWzYGK2Jmy2g29P8Vq2x779U/7jmqL6pLCw2gzs51Zk/PYucdC7ecRmyuNo343Jzdp/SNFKIUIOHAU6fb+it4qrit2m7R286sFIGQiI0XUmaeUWxffvvaiX/27nWjAJRfZV2wcMvlgPkDApJKph0QmUEgGFHwvMHd1miBp+AKAYZyLNFsElEaSn5q1dpxq8PyIhHC8hjd3STfceaWqw1K/IhVNillWtYED/0VPNVubqPAQ6X/DgEeKnmfgDClTEspM0lDJH505eK+qzVVWW/UwocI47bOP3PL9abZ9FXbGZKAYiIyyu1XhZsXyHnqdFt1L9Wrmdsobgu13VZlOdKnuFDgsQRZlkqcJ/AsAj4/+PsRAHwymBXn7H4ZM5q++veL913f07PYWdbJZl0uLM95ztxytWk2f9Wx+x2QMvKmpS639VfCPNqEuZLbQkXLxgyQTFjjTDs3eM3KnvE3Lutkc0UPOaEB5DHx8xc+fpklWlY79mADwPNXkfBg4Tyo6RaZASHjZqtpO0OXr1w/8cd3dLFxScDqTATpPN3dJM89+8kFArFVjjOkDj3wUIPAQ7XBQ7XBQyMIHqoDPFSDU+kLqAzbGVQGWas+efaeBZd0k1y2jEUNADEBwIWnPd9mSPqZAMWZncIdpiApK5gwUxjwEL0pVluVbm5NzoPahLn0XoQBDwLAEwAwUuyAQHES5s8+fSG36Y9kqgigri6IFStISSvzDctsPkbKtEMkRJCSXIswIwxhDkeRG0OYI7ut+glzNc5TSmhLwVFkGTgMYUZVwkwVzqwyeAuWUUAIR6acuNlyjJPa940VK0hd0lWMGSqARwdGl5z9zGJmsdaRaUkEY9Td1l8J8xhwnuDjKwRBIGNGk6GIz/ne2tZ1frVaeDse3/0UXzmfLUc6N3mhkzHhPHWBJ4jzUJ1ua/icJ4gwjyV4qA7wFIOfCcRglbvpyvlsHd9dsH9CL9nXmiuwQm1PPPUh02ye5zgpWTU88QYUCYkIhgCEAIQBCEH63/kfgmHobUSHjkhIVdxWNfD4z08QCdsZknHROi/R1P+hFSC1rHOd6bvbii688IWYGshsFsI6TsoskzjEA6Nl4KoOnlyWYdtcmkNQ5rYYBMsixONUzEPqyiRsjM5TLziDrVcwOJlZxUSSJNvPIjl+3vfWIAcINjs715o9PeTIwS3vsoymubYzKEmQ8WYRCYkAx2bMOTaGGUdYkE7QOkCfNzNgmoRXX3Gw7YUcLMsF0SEjEobkPAGfL0DCkWkZt9rnynTfu4Bx/72sc51pLlq0SPX0AAR1FQAuvdFvdJHQEAIDaYkLL27Bkne3IMzrnl8P4ZtfzSIeJyjnUBMJw7kt8q3mir9PMbO6CsB/Y9EiJVasIHXRWU8fQxCdjkqBiMWbSyRkkAByOYZSgG0DSgX/eNtyWf2c0SEpEg4DPETCloMgEp3/fNaBY1asICUAQLJ6l2m2WmCWHkN+s4mERKWkufIPEQBVXcQ7mEXCIDAHrRYD3kPMkHGjzWKBdxWW8QIXMtsu4OjNJxLWUZdAgSLdoSMSgqvcs+qcjJSyAZYXAoBY0vnSVLCaJ1UWOgE+rNt6I0bVw4OnEiijuK16CDONEGEmVM6vpmLnKKRKA+B5/6dzcKopVW6+IGuC4hy/uasnokEoyAKNlUiIkeI8KDke9mJkNpsUn8BKzhfMcr4QMei6LbwJMwlpmGA6tEXCGpynBDx5oClDxADi+QJEJ7hiBr05MwkDKo4icCBgbDMJQ4uEqI/zlFqmwmaGYDrBBDuzmYW7anpjiYTRAqN1EaE3hEhYmfMEWyYQgVlCUm62KUDT9Oq9/Jl/02QS1mGC6I0oElZxW8Xfz6TYgVBimslAuxY1xr5WnYSbkUvly8xGEmZP8yHSQVJWDI6ylGcA0tWEoEMcus4qmkiICODxrgmRe43GADx+lY+VBEDtJqi4xcpYlRuTIEg345YVwzQbCx4PMEoRbJvzqnI8DpgGEIuFt0KWRTBMIJ1i5LIMQYRYDLBiQn+PAhQHO/VikRChLY9jM4SbIGEIvQtVs241CDOquK3q4PHezyCgyTwYREJhEBwHkJKx/IapePkvNm7+7j50dJB7I+ojzJ6lkVLfbMcBkknC9MNMzJwVw+w5FmbNtjBlqokp03T82KhSCeVtW3xhEiecHMPrOyVe2mrjpRdsbH/Rwe6dEqmUgmkS4gmCaQCskLdu9YiEQgD9vQqX/lMbDptp4rvX9IEMDWBWlXWo6IS5nPNUX226+1+w8Ekey0xCfYMJUjKuWzEFCxfrgOaPb+vF6lv3o63dgFLROI8w9O9slpHNMFpaBeYcG8eC0xM4+a1xzJxlIZFoRGukwiuTYWx/0cGWR7PYvDGLbc/aGBpQiCfc1A8AmmqGd1tCAIMHGB+4sgXvv0Jfl4fXZnDzv/bDMJAHURiRsJbbqkiYq7hF0gDawmPFeYRBkK7lue7LU7BwUQukA5Abc9Ig6kVbuwAzlfSjKndbQuj/nUppNzhzVgxnL07izLObcNTRVtERKtcyeItPEtEAw8o9HNeXiJL3v/yijY09GfxxbQavbnNABCSbdNiVVQ3wECCoGDxK6e80TGDTugxu/lIJiEaMMFcGDzwAjQlhNgjKYUiJAnikdhPM+qIIQ4Pox7f2oa1daEsUAB7hRlZSaX03Tz4ljne+twWnvz1ZZGmkFyqm+rSfqoDiApkWPjeYzTAeeTCL3/9qCE9vtkHQQCqQ7vKbV2p5lCw8HN412rQug5VfOgDD0JmS2hJF5zy1CXO5ZSuybhe6Fmg0dR5hEBwJKIdx3ZenYuGi5vyF8ftqxfrC/eS2Xqy+tQ9tHdoS+VdMpiGQzSrkbMbJ85L4wN+14owzk0WgERTdwgwbUK6F84PpkQ1Z3P3zITz9aA5WDIgn/PlElS2PKGHLfhCt+tIBGIJgmJUtWzVhsZTzhMuRLmw3Zh/5qeWjCR5yOY+SVcDjM4hSAfNOTYIEsPGhDBIJt25S6FPq71eYPsPCJz87Hlf94zgcfoRVsAa+1ddov8gFLfsszfQjTXQuSWLqDAPbtzrYu0siHnclBfYsj8IHrmwtszz+l7cwmDHLxGFHmdi0Ngsw5WWFcCIhlXEeCuu2fNuN2TP/YXldbqse8BCgWOsupW6rklpHbirpKfOTIAI2PpRGslkgl9Hu731dbfi//zoRc4+Pu8v0AmjGAjiBQHLvjndsR86xsPCCJKQNvPCkDZaAFScM9nEBPEoDsNI5CAEoCRw2y8T0mSYeWZt1da3a4KE6CXPQdmP2kR6ARj4wSoKQzTKuWT4Fnee0wHEA0wx3A5QCTpmfAAnCgz0pHHGkhf/7rxPx7ve3Ih7XGtJYWZsoYAL0jY8nCSe/LY7Zx1vYusXGrlck/vaTBfCEORcSgHSAw442MfVwA5v+kIVpUaTAaPXSI6rh1gBzNETC/JVgLYJtWD+EM85sRiJB+YsV5uIzA0s/1o5Jkw0sOC2JiZMNKKkvpGHgkHkJ30LhpDPiuPb74/HEn3JY9O5kQYkPybMME8imGZvX5zTXK9Wd6hIJq2dOFv2+8OyneTQDo0IQ+nolzj6nBV+6fgpiMYp20Xz7hgXfwfzyn0M918HOMVZd049H1mbR2lGBSFcQCSNznhK5AfDVxo9WVF0pYNwEAxt6hvCVL+5GLsd5FxXWDXgazqEOHo/LMOtzimJ5iAA7C6y8ph+Prs+ibXx48NRLmINSdcVIEeZq5cZSAu3jDGzoSeVB5F3IsBd9xLkOF2s7I82Nwj4MzNpl21nGyusOYPN6bXn8csBIEeag6g8xVpmE0gHaxwls6Enj+i++nrdEzKNrAbynX0n9w1y8AvQ9B3pfdz+lxuBYVcFtrby2H5vXZWqCJyxhRgjwoAQ82oWNYSahcggd4wxsuD+Fr3xpT77eaqRvTB4IqvD0i3zdu97HcRiZtP5x7ILW6u1XiO6XAG8kweNZnms8yyMqgKc8fBF4J3yWR1T6jMC75yPkF3U+wyPJecJkEhoWcKCXcVZnE774lUmRiXWkcIMqVoczacb2lxy89EIOr/5FYs9uiQO9EulBhmO7S1ULaGrWYJ84xcCMmSZmHmPh8KNMJJK+B0JW126Gc9x5y3NNf023hQa6rVqWzQXQ2GcSGgZwoE9h4eJm/Mu1E9DcEtjXalhxKo9nDA0qPL4pi4cfzOLZLTns3eUgm9FxNCHcLh1uWMH/fpaAUgxiIJEQmDTNwDEnxjD/zDhOXBBHcwvlFwqNEjI9y5YeZPzoy/14ZG2miuUZZmC0BngoQAowD5bqCSn16uy+NUOYeZSFj17ZUV2ljrhMJgJ2vOrgD3ensGFdGrtedcAMxGMEK0aIxYWvg3v5RcxH7b0xJoqwZ4fEjr+k0fObNKbOMPC2cxJYdHETph5uNExm8CzmvT9L4Y+/zWDSdAEnF53zICJ4KnGe0s+nizqf5bEGj+cyHZsxcZKJf//OZEyeag7LAuXFNAL27ZX41c8HsfaeNA70SSQShFhMV8GxgtcasnADqBg0+c9SJWtKb/XE2r1k04z2DoGzlyRx8YdbMG6SKDqOut0XgL07Jb75D33o3S1hxahkSV3ZbUUWCbn2YJei93gAGuvqCSEImZTCV74+GQvOSA7r6fW/9567hvBfqwexZ5eDpmYBy3Q1p4CL6bks5eYoKTfF1jAA0yCYBhXAWXKhhSsvSAdIDylMnGrifR9txrnvaxq2NfII9JaHcvje5/qQaCJfItnIiYRhLJsxZ+Y/Lh9r8BgGYbBf4Z3vbcXf/G3bsFyXktrk79sjcdNX+vA//zEIJRlNzaJwM0qOy3ADk+khhnSA5haBydMMTD/cxMSpBpJJgpMDhgYYdlb3CDLNgnXIuzuXZyWT+mF4eF0WLz/v4Lh5FppaRJ5k16MTKQlMOdJA/16FFx61NYi4gSJhHbEzEEBLFj3HY+W2vGQwx2F0jDPw/dunor3dqNvke8Db8lgW37qhD7t2SLS1UonFKRyX56JSA4yWNsKpb0/gtLMTOPpYCx0TBGJuKmouy+jbp7DtORubejJ49KEshvoZza0EKB+QijiTTq8YOsCYNN3AVcvacNy8WB7g9brkwT6Ff1u6H4O9DMPU398okTAM5ykCD4oANDblxoYB9Pcr/PM1E7DkXS11X2DPRTxwXxrfubEPjsNIulH6oGoF76nOZRhnvyOJ9y9tweFHmaG+69WXHNz1k0FsWJNBPE75LEoK4CSGoYOdlkX4+HVtOP38RP3n6L7vgTvT+OmXB9HSTmBZm/MEZRI2AjwAwZgz89PLx2q6MQmdjH7s3AQ+9dlxOkmsjuWvZ3nuuyeNb17fC8MgxCxteYIujiDNVQwB/P0X2vHBK1rRPk6UqctExU+/t5xvHy9w2qIEJk418MSfslBSR8URUBcG1mVAioE//yGDSdMMHHmsVZc780TWw2abeOZPOezfpWC6hLqa26okElKdbssf/hIN4zx1jMYmAhwJdH2oFZZVn3ioXPA8uD6Db3+1V1sEgSLw+PvzkJtXbBrA1V8dh3Pe2aSVZFXcQIpKnou8Yi30vkoCiy5O4p+/Ng6GqYm3oOCiQlb6GOMJwu3X92PTugyEgTxJD48gt0+jRXjH0iYoJxznCXJrxMMHTz6YWp9IOLxadRJAJg3MPT6Oty/UeTAiIng8jeTZp3L41g29+fRQ5irlxgDsDONTV7fjpAVxOI4bwohgDcgNfUgHOHFBDFdc0w4755r2ChWjcFdSVoxw2/J+vPikrfOCVLRz9s7v5EVxHHWihVyai1NZhyESUgi35QdPAUBjMLhECF0huuTdLTBN8lVcRCCVBPT1Ktz0lV44NsMUpaus8tXWUL/Cee9pwpnnJiFDZERWexmmBtEZ5yWw+N1JpPu5iNuUHge7lk/awG3L+tHfq/JWJZIVchPJznpfQodbKDphrqUwV+I8fvC4wdTRI8yFYyDkcsD0GSbO6kzmn6x64kOrvt2H17Y7SCbLOU/pxXRsYPxEA5d8tKVh+UReduF7P9aMjgkC0narQCpEwJUiJJoIu7ZL/PzrA3UFj8kVL085N47JMwzY2WBLW+13kEhYGzwl+xE0BxrtnoRCAOm0wtsXNqGlVURKpsqvRgSw/ndp3P/7DNrahC5IDOA83pMnBJBJKSw8P4kJk4x8Xs1wXx4Axk828LZ3JJBJcR6YQT0JCdpqtbQT/vy7LDauyeQT5CPpQgpoaiWcvCgGO+W5sdoiYaWoeqCIWIK2oLJBMRb9eXRTA8LZi5P1SfsCGOhX+Nlt/YjHq7stz2yzAmJxwhmLEiOSesEMLDgnXn48lbpwKE2q71w5hKF+zpcARXFlADDvvDisBIFVtEzCeggzlVkl37CV6pyncYNLiHTN+sxZMRxzbCyy+/Jc16+7h7Bju1M0cqASeARp3jFpioGZs82Gl/x4n3f4bAvjpxiQLi+hKoNXmIFYHHj9ZYn7fpGK7Mq8a3bEXAvTjzbhZDlvDcJwnnoIc6klyruwkeY8xc0UCHYOeOupCZhWoaVLWPAIAfTuV7j3f4fQ1CwC8oADuqG6avfkqSaSzaLhuUbezU82EyZOM+A4HKrFCksg0ULY8Ks0+vepSGm9eQnDAo473YKTdXORGigSloKHSsCD8mV8Bc6D4XGeUhBYFuGU+fHIIQsPLOvWpLBnt4RllQh/VXoSKgm0dogiYbDRLgyAbgThVJVb8xZTXwtg/26FP/02U3SOUV5zTrVgWKiaux2qtCcE5yl9WMVIiYSVtjkOMGGigTnHxCIBiF2zbecYPb9LIx4vRKTDTr0RI5iIX/pk+tNjqpUba24G/PneDOxcIT0k9GoMwOFzLXRM0ivAyq33onMeBHCewt9UvIxvpEhYqSehEIBtMw4/wkJ7h4hcRAcCntmSw/ZtNhJF3Kd2E29PA6o3UBsWQakB1iGZoFEDQZmCDMQSAju2Smx7IqdLoMMCyG171zKOMGWmASfHJY0Kh8d5KIDz+MFTxIFGY7oxCcBxgKNmW/nVWHgfoX89/GBGz/USlcGDgJtkGsDeXXJEEve9ByGXZezbJYtTPXzHUCn2JAiQWWDLA7micw3Fg9xrOH2OCRWgQQ2H8yCA8/jBk+dAwwVPzUl/+RiTTso6apZVl2CnJPDME4U5XWEHl0Bp3rV3l8JrLztF3Tsaxn8Y2PUXif07FUyrJMBZo1adJWDFgBcfs+uO1E+bbcJwQzLku/bkHxJT8rsUKbUIcyl4CIA5XJGQFZDKcEW7Tt7VY/1v22ZMmx4t58d7wnfvdLDzVUdXbahoTbwNgzAwwHh0QxZHHWM1nkgT8NgDWaSHWFdMSJRZk0q16gBgxgh7XpHYt0Ni0uFGePfu7jNxhoC0GZkBv2jJVS2P5cYOwxLmoBWWWa9ISESwc4wjjzJx6cfayzpkBR2MFzCdNScigVYAGcD2bQ6GBhjNza56HaEPMysgkSTcf08aF13SjGRzY0qHvM9IDzIe+m0GiaQv3TRCT0LD0Pxpx4uOBpB7zjUts/sBhx1j4hPfba+gOAfzp/tuSWP3NoVYHEXtAysRZgqAg1mvSCjctIj2dgNnLmyqWz+J8np1u6NTGCh6E29PuNu5XeKe/xrC+z/e0rCqD8MAfv+LFHZvl2htd61PxBYrRDolZPdfZGTLBwDxZsJbFscivfVPd2TBSuZ7T4fhPKXcSQxXJJRuhaf3O8xPva89O6WvCXn0wSVKAU0thF//dAjPP2nDMBBJyCx9SUeDZ+sTNtb8JIWmFspbxroaWhKwf2f9Fyhfdl3rx3GraaXvQQzJeWqGMqKKhP5Eq7A/9S6R+3qVTtoKNayNApfMggAlGd//Ui92bnc0iJxopJrZBY8J7N4uccsXDxTa0anKOlTpaqjo2F1XOLCvfqkhX3Yd8ifoAGtxnvJQBjVK5xm5lwe69JAK1DkquS0EWCYvqNq3V+HGz/biucdzMMxC5QOrCstoLmQiEmnwvPC4jW9+ug8H9moewXJ4PQkFAZkhVSQSjvSLqnCeYD7kt1Lk7w90cIKnyGVUybWJMrhEuZHwvr0SX/9cH+760RDSg1zITHSTtjyX64mYXiZiepBx9w+H8K3P9uHAXqm7rcrh9ST0ChqlM3rX1t95JEgkrAWefIu74U36GxswDWdwiUd+Y3EdjL3jBwN48J40Fi5J4pSFcUw7woRpFZ+ZYwO7Xnbw+IYsHvpNBjtecgsV47XBE6rcmMpb6Y7WdfSE1VqEuRQ8IMAczqS/0TJG3lI5Fqe8wsuof3CJf2lPrIOs+3crdN88iF+vHsL4SQITphpobtORnqEDCvt3K/S+rpBNM+IJyjc4qO62EK1WnVmXLQMj0p2kOpDKCXOpG/M2+kFlRiHMY/XyLmZzc0kbt2FONxbQWoud1Yn2pqlBKgytcWVdPuIFOeNxgswxcmkGMelsABWUxB99cIlXp59sHT0A+TkPhyDMQdfZrI/zFKwPs14KRznhyC3q3As9bqJOQM7PzIrotvx7G0IDI5dWmDjVwEkXJHDS2+OYeZyJCVONsuNjBvbvkvjLsw62PJTFU3/MYf9OiVhSIBaDz40Noz8PAx0TReR4mLd/aImE/dpxRLdVGsqoh/N4hIuZYJo0ai12p0w3tEsYxnRjjxwOHmBMnm7gvCuaceZFycKNK4lv5Z9EAiZMMzBhmoH5i+Po26Ow8Z4M1nensXeHRHMb6S4fjLr784CB8YeJus1J1BhavhiSSloDV+E8VFGJjgIeaPBYFrBrp4MfrToAxeWrobKPcre9+5IWjJsgIsd7ZhxpuoHUcO1JyqLeApA5PbztvPcn8b5PtOSBkx8pFdAb0Q8qb0XWMUnggqVNOGNJAnffMoQNd2VgWoBlVurTjJLYXTl4TAuYcpQZbW3iWpOBvQoP/jxTU+2nfFwS6H1NV7b6XXAU8BRzoJqcpzg508um27dH4ec/Hij36QE3UZBuKXfS/DjGTYiHBpC3z+GzTLR3CKSH3KeNw083FgLIpRlNLQJXLWvDaecm8uotifDNzr34lAem9okCH762FcedFsMvvjaA9AAjnqTAKouKg0vcMEZLh8C0o+sLNO/aKnHv/0sh3iTKORkF6zyJZirOZKzmtip8vxmV8xRHR3VhXkeHKEruqmS2hQEYgrHrNQdAPLT6my+dmWRgxkwLT2/OIdlEgZMAgziPMIDsEGPSNAOfubEDR8wxC8Cp0/16YPKANP+8OKYcYeCWL/Rj/06JRFPJ8r5KubHu+cyYeqKJ9kkiesNxAPteUUi0CDR3+L63hkjoiaZROA+CQhn1gMdvevXQOEBJffDSF3eR0mvY5P3N+MtWJ7Jc762+Tpwfg2OXZN5VA4/Q4Jkyw8DV3x+XB4+/I+twxTgvV2nGMSY+e3M7Js0wkE1xnhvWqhgVrkg6e4FVdK5RXrtekHmlnL02xLKgruu/Kf83yzrAQ6X7EkSYTMJK4Cnq1lnB3FGJlbAswssv2tE7drkf+tazEmhqFoWnrEYTbCcLtI0T+Kd/78DEaUbdCVth4lBKaqJ91U3taBsn4GThK7WpzNuU1O7khIWxyA+WV1+/a6ujy7TrjKoHch4q388PnrwFqkWYq4EHNWJP/v/HCohZhB2vSOzbIwurnZBLf2bgyNkm5pzgNhWgKqstX/zq75e3Y/pMc8TAUwqiqTMNLP1ya36ceDXwCNLcbOZbTEw/xoxUMetduwO7Ffa9HNDqJUJU3bMUVCMG5gePTucIQZhRdalcQX6vsBIxTUJ/n8LzW+zI5trr1L7o4mQ+qFlRJHST6N/3iWacsCAG6YwseIpA5ADHnhbDRVc05xsuVJQbSLuT096TKDT9jOjWX9niYKhXaUJc9j3houqEkI3GS9RoEZXzVANPpaK2opMhAIrxxKZs5FCat/I6bVEChx9tFlmhIpGQgMwQY+5bY3jnR5q1uxzFcVDC0JzjvMuaMGd+DNmhgBYsXvPwNDBtjoG3nBPL91iM6tZf3GhrLFZYbYUNjNayUhQQyhD1cJ6gpXoo8ACA1OGCLY9kkU5x9GpM1pH0d36wWc/XEOV1YcxaJPu7z7RqsQyjG1fyTtUwgfd+tjnfAq/0+gh3dMGiS5OIJSK2uHHBlk0xtj3i6DihCo6q18t5aoEHxQAKx3lCE2YElxszA7EYYddrEk9tzuZ5Suin2wXcWRclcNzJMWSGdB2WXypIDTBOPzeB2SdaYzZTTLhd0maeZGLe+XFkBhiGKAZPZohx9DwT85ckIreb8RqHvvSIg/2vSljx6oHRqApzEGEO2leE4TyoQJhRBTwIAI//c1kBD92XCSIxocijaRI+9Ok2GIKKOsuz1DXqSz7cjLF+eae1eGmyTBdiBgxBeNfnWgpiXoTr4FmaJ3+f00tyisZ5woiEQeApC5+E4TxUB+ehGuBJJgmP/SmLPbtlZDfmPd3HnGTh4qXNGOxTMEyvBxDj5LfFcPgcM9/3cMwA5HZMO2yOiblnxpB1XbZhAqk+xjkfTWLmyWbkhpveSq1vp8ILD+UQ9ypMImQS1st5Som3qIcwR+E8VEHkMy2gb5/E/fek6xLPhNtk6X0fa8Epb49j6IBOxyACznpnMj/zYqxfXlD2tIvjeoCLCaQOMOaeFcP5VzTVBXLvWj322ywG9zEMCyAeHmEOy3mKv4PKl/GN5jxl7/FdhESCsP43aaQG62uw5OUmX7msHdOONNC/nzFjlom5p8byKahj/fIK92afZmHq0QYG9zMmH2nig19u0QQ/ogv3rE9mkLH57hxiTb4iywaLhLXAU9YfaDgiYRnnQbBb87uxeFxgx8sO1t2djqyB5IOQChg3UeCzX+tAIgnMfoulc5QVDo4R4O4xxhKEmSdZiCcJl9/UirZJorBqimh9iIBH/zeLPS9L3U2fR0YkrAUeAKD3vOM1bqjOg+otVoosGxGkDXRMELjxRxPQ3FbfjDBPYX7usRyUA8w9NXZQTXT2hqVsfVi39p31VqsuVTw/O6yfcfPSAxjcyzAtKuLfYd0WQnAeILhW3g8gMVLgIdSungADVhzY/aqDu/8zVZcVyseDGDj2lJh2Xzi4Jjp7rnT2Aguz3qrr8uual+Fanwf/I4P9rzCseIC1H0HCnCc0VByKGRHCjBrg8fdObm4VuLd7CK9sc+pqvu2dJKuDgzhXsyBcp2v1mqq//qLExv/KItlKRddpJETCILdV+jlipAhz2HJjz1pkUoyffadfX+RhPOkHBe+pAvJ6iT27ALzn22kdwjFGXiQM4jzBoYwGioSBYlq1cmPPCrUQHn8oi991p/I6z19fBdVZCGDjHRm88KBdZn1GSiSseD/9oYxGi4Rh3FbQak43zhboXjWApzfl8kNN3uwvTyfatsnBH27OINFGhfztEeY8ZSuugO8TjRYJ6y03JrcNXX+vwrZn7WLD+GYGkPt7xzMOUn1KZzny6IiEtcADuJWpjRYJ6yk3FgLo72P83adacfGlzXXNslDqEEAdRTuvfPD4IwnYGcbalRk0tbtLdw7PeerVeaqBh0CFFnfVhq+GEQlRBp7w5cZC6Dqtritb8DefaMnrJnWpvm/Al7fCXHyFDtGsu6UAoqI7M8rgAUrKehAAHqqbMIcrN9bgUfjAla14/xUtdQuASgH3/jSFvtelFte4Ni+sfnxUed/AKbNUNC8sr7h75yoAmWO0TRbovCwZfVqhu7BYfGUSRAUQ5YsZh0GYiSr0LKoAHr/KaNYrEobVecJYnjx45DCWuQxs+N80XnnWQbxoLLbvmLjCOfiKHsOcQ7VhdmWLCioAyE4D048zcfbSZF2dBoTbw2jRFXpITc8tWSTbUa5EhyDMwZwHNTlPqbUzxwQ8pC+GBk9LwfIMI+2UoKWAlg5CPFk8V71qW7my8x+h6cZEsBOMplYa1kl66bKLrkiCQFh/q+vOuNAmBqhPJAzrtvzbzHpFQkQkzKWVCEXgkRHcFiNfRl1qrfy1UFAA+xps+t2J/4n1yCij0KWibF8u/ttv1dh3fmXvJe9v3a+ZZbA0wb6y6jCmybNEnVckAAJ6fJwoDOcpbTBeL3i0IRhhkbCULxABA32q2PKIcBfO6yTqNcsuFRuj9CREgOUJXZng3yPs4BKqrPN4zcGLEBpiJacU0PmJBDqvSCDVxyWDgocvEpa9gYKLIkdcJCQfeHJZxoc/01ZseUKCh0g3Rlh9fT+eeTiXX+KWxYRC9iQczenGpdvyfYUEsO1hG3den4K0EX6Gqgci1xKd95kknKxbZNAgkTBUc4XRIszlC/toaiy5FQyrruvHn3+XwabfZ7Hk8mZcuLRJT1DOodChfRgtVsJMNw7DeeADT1GhC+ubbro9hR74SQb3r85gqFch1adwyQ3NML0KiyiTpH2uhkeIMAeGMuoVCesBDzMhHiP853cG8MvbBvOEsKblccc8rby2H4+uy2L8ZJ1I+T/fG8RNn+zFtidtmDGADKoiQ9RHmBs2uMR9nzA0eF550sGPPjmA330/DRDQPkXgmXU27rg2pafuhMjQ9BYeD9yewX3fTcNK+DpzRIyqB3GeytN6Cm7SOGHW55cTwmcSFkTC+iwPQY8cePzBLIQAjp8f06Q3gCcUWZ5r+7F5fVbPoXD0/okkYc92iT+vyWKwj7HnFYXUAQXToMqkvxZ4UH21Ve90Yy0GEhKthH3bFX77jRR6X1Nay4Em2PFmws7nJF5/UWJupwXDpOD0D3chIYQGz/23ZtDUIUZ0tUUB5wQQjBOP+pcvEJE1XM5T6cmtRMgTCcITD2UhBGHuqbEyk+23PKuu7cejfvDAP3dU352tm23kUpwHD0JwnjAqfCOHtRkmkB5gvLxZwoqTOyy3+HzizYSdz0rseUniuEUuiEravbDP8vTcmkFTu6iyjA/OJByO29KfaUAwUsZbjv6XfyQyWsGSyaVfjSDMCOEW4wnCEw/lQMJNQ5W+lrNCN79cWWp5Atyi18G1anC3Ts7TqOnG+QQsIsQSVLTi8u/LygORwuvbFI5bFINhFiZBK64OnrCZhMMBDwNskEkE7BWA2mmQiUJhSOMIc1UdyV09tbQRfrVyCHfdOqTJsCy4rZXXHagKnvw3eP1u6iXMqHz8FfclVJ5uTKg66c/fDT/oBilJaB5HeG69jf+5bii/uvJWrX7wQBWDp6GcJ1DRJggGG2SCiXcKwdZWggFyGVuUTMLiTMbKrW6r3TQPRL9cOYQ7bxmCYeruqSuv7cfmdZna4OEqMS0GyLtZbswov0Jj336qsH9hHyr7DP8M9vz+/keFS7QnLrgmRCw3Vg7QPJ7wXI+NX35RE2thAg/c5nIe1/IE6TON4jyVwiEMwDAMGCS2mkR4ivTTw8MRCQOlthrgyVsiJrS0A3euGoQQwO6XJR5dm0HbeFEBPNVFQq+Ar9CFKzhZrqJKWwrOQHNf6DZS8aK7GpchSKvQAZepWj6PcoDmcYRn19n4zb+lMeEIgZ7bMmhqE4VQzQiKhFVa3LH72DxFHz5v/zuJ+G4ls0xENBy3FSb8Uc45qEhozKR0E4J4CcEMsmxBoBICyKUYl3yhFcedYcGxK4dJSsMaUWNvtd7LCjAswtaNNn779ZRbBBi9J6EwADvNYEW+MuZqbquxhLmsey8zW0acwHSxadqxRxxjaJ8Q1gRmW1PSUQJPWQY2A03uBaoEnlqBUY+IPnl/Fmd9IIGD4fXcN+xwrXQDxD0PiFZSL3GCADhSImEQeAjMhoiRYnufiDc9In7c07KLBG02jQSIoWgkCHMN8BQNQXEDoVFXQ/4yoWQL4an7bWxao5tYefPAWI3Sj9t4FACeuDeH5zfYSHhjGuosNwaHA08jRcJSYLvXX8VNC0S0+aPdtMtVoo01hpaCGHWABxVypCtzn2DwEDdmcAkUIZYk/PYHKQz2qUIJjBidH8/tpPoY961MI5ZAWfPLkSw3Hr5ISIEcyOM/hiAQxJp8KANs/tq2B2zdUbmwnI8yuKRyVN93c0smelSL2lfjPLWi6t581L2vSNx501DdFa/1vjz1+J5vpdD7qoIVLyk/HkZPQlTkPLXBU40wozJh9mOHBQkjY2dsQfFfA4BYtozFT+9rfx7MPZbZAmJ9qYcjEtYizGVWKsJ047AioZJAczvh4buzeOAXaa0xOSMPHunWvG+8I4vHf5NDk1uGM5rlxo3lPEUCokqYTWBwz2V30vPLlrEQ69evFwBgQKwiEI0k5wkCQa3pxjSMqDorzYfu+uYQnlynR1uOJIiUO4T3mR4ba76dQqK1ODd7tMqNhyMSBoVAikBOIGKxCgCwPj9AUtGnL0SsP7dnsyFixzkyzYJIhLEMwyHMdYcPqkgBQNCQXW0VLvtaK457eyxSHlI4n1WIjG/9o407rh0CS61FoYGlN43MJERIzpPfl1lZZpKksp+dkk3Mu2gNcgRiATA6O9cb31tDWSLza6ZI6GlcjRAJUQ/nqS4SBnEeUSWK7nVsVRJY/fkBbLo7m59Y3Ahe5K2shAE89psc/vMLLnisCuAZBucZJZEw8L4ogGOGQYLE15asoezyzvVG0e7LwGLnfBi59r0bTRGbZzspJYhEIzkP6uQ8kWNbAeAUQs+KsDOMzo8kccEnk5rcKp9qHBU47vucLGPtLRk8+LMMYkm9FIEKJxJGd1sjKxIGHSeDVcJsErbKbc5NTpy+YxrkihWkCqswAE93gW55hGwB8/P6qS4Nrg6f89QCD40QeMhd2gsBxJsI636Yxs0f78cLG+2ipbeShSnN7IuNeRqScoeZ+CWBbX928MOrBrBhdQaJZiqaHT9W5cb1gIeqjrcUTGBYwvz8VbeQfcLTgQYL6Opio7ub5EfP2XNLwmy7ImPvcwSE2SjOUws8kQbUov7SG2HocAcRcHxnDGd8IIFZ862iUQFVV1o28NKjNjb9MovnHtAqc6KpymrrINB5InOe/IcopyXWYqZz6Vsvv6vpyju62Likm2QFWsK0fBlo/0a0pHK9DxtkHOPIlCISovJSvtQ1RSfM1UXECCkZXD2TsGhFKfTf2SHd5XTabBNHn2bhyJNNTDrSQPN4gbiu30M2DaR6Ffa8rLD9cQcvPWxj9zYF5TASzeQbm124C1STBI+uSIga4AnKbQIrFTeTQrF8fmI6tmDj6RhcvgJMvrtZMrGQeBmYvreG+q84d8+lgPGAINNillz46spuZTREwmrgCaD6Fb8fLvlNtury4F1bJV57WkKYevRSspXyLeScLCMzxMgNuQnxcTeBLeHG7bj2dOODXSREqeUBsyFMACrrwLl0yZp4P5/OgkoKvQLPz3NlHz9372Vxal6dcwYcQBnkA1EYkbCW28JIcp6ImYRC6CV/acyMoCcTCqHJsde3iIc56W8ky42HQ5jdAn8WEDJpJc2sk778sjubflzqulDrAensZLOnh5wrO/dfHYu1fDVr9zoENvyWaCQ4Tz3gqbfcuMzd+AQ+Cni6qaYlqHwjK3KQkXBb1cBak/MwE0i2xJrMrJ295iN3Jm5c18nm4h4KlGArLl57eshZ1snmLT3jb3ScgRsS5jgTTPk2lmFEwnoIcyW32HjwlJfe+CLO+iP8mYyoFnKobQUa1ZMwFGGuFzxQTEyqJdZkZpzcDR+5M3HjsirgqQogAFjRQ05n5zpz5boJX7Rl6pq41WYICAKXZyCPtkhYQd6sCR4EmPDKAtroDi4ZK5HQbU8iBRnUFGsysnb2mqW/in9xWSebK6qAp9b5eneburogurtJfuqc3ssJ5g+IOWnLlCNImAeDSNjI0pug6cZ1zZ44RERCb6keN5pMAqdZyk9deld8tct5avZ8CzMtnbu7SXZ2rjN/sHbcaoJcBNAzTdYEk5kVWKmxFgkpBHiCqicqJ1WNzeCS0RYJmfVSoSXWYgL8DJRadOld8dXLOteZLmGuWaUfKZzoMfHLOns72oV1I4ivIhBsZ1ACRMLVdMdSJKzOeVBOmCvwikiDSw41kZBZMcAJq8UAFATUqqwcvPqjd43rq7TaagiAAGDZMhZeHOQz5wycT8w3mBRfIFUWjkxL9ykX5B+BNsoiYRjwBJNJqumKDiWRsOScmd25PjGzyYgZAo6SDyvm65b+yvo9APAyFuTe2xEDUCkv6upiY8bezFKl7M+ZwnoLg+HIQTDDcdPARdAwzYOl3LgRnKfm0nmUyo3LqifATAwFASaQmTSbQQRIJZ+0DONbgvCTS7pJ3tHFRlc3FFXtBtVQABULjgCwrItjA6+n38NwPs6Q58SNNktxDlJmINnWJ+KeoXDX0KNdbowa4Anttg5CkZABFpyvYWQiCJMsiplxmALI2FlbCLHWMMTtFhl3XdJNOT8tqRcDjUipoq4uFt2+g/jCeZm5ylEXKWVfAPApBJpsipiOtrEDxQ6gFDjfhG4URcIR4DxjLRISCIIMGMKEIQwQAKlyYKjXBegxk8x7BYx7PngnPVPMZ/OF0RhLABW5teO7l/MKrMj70X85j6cLJztPqsypxHS8Yns2kTGVWXUQuGm0CHO9nOdQyCQUTClBRp8iucskYysDT1uGscmIm5s/9AvakeevYHFCF6gRwPFe/x/3cKmaLVYdYQAAAABJRU5ErkJggg==";
const LOGO_TRAILMIX_FAVICON_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAUNUlEQVR42t2babQdVZXHf/ucqrrTG/Iy85hkMhFRQVoUGgKJKKhtVFwPW9uhW3pQG9vxS6stRAXtYeHYYjvQsFxOpCEttqJMERQhQgs2BkwYDSGgBF7yhjtV1dn94VTdW/cNee9B8qG71rrr3Xtf3arz3+N/731KmPFQGRnZaDZuPDcFePXp2453qutV0zNEdZUKy0BDEARAhKnv/dup7/GfRfJvZ/ht9mnG9yDqv+u+B+P/G1s1T4rYbYEJfooG11xxfd/dACMjV9qNG0ec/0XvIVO/uAA1GxAH8KrTfrNO1X7QkZ4Z2HJJ1aEkqLruj/cJOLv8FMAzg8/hdgGDdAQ3DfwUAYgajFisCTFYXNJqWWNvUOGSy68fugngggvUbNjgsc0oAC+pc9NTT/3ZUI2lnzXGvkPEkqSToKTZegSM7F/NTwc/m+YNQAa8Cz4/T1UUNYqKWBsF/eBScMkV9fajH/j2z184OjKiduNGSacJIAd/1im/XoWNrg5M5dh2MupA1IixPVo5wJqfj9lPBW9mOtdpCkg1WmKStH5v4ibOuWzzIduKQpCi2b/81LufG0q0WSQYTtJ6LCJhx+Dk/xj4wrkoccn2h+riXYlpr/36jcu355gN+KuceeaDgxZ7jUg4nCb1RMT8vwDv3UbCOB1LrAmHw9Re89dnPj3IBaComJERzAbESWPsi6HtX5WkkzHGBN1F73/wYgRjBGsEYwVjsmscAPD5Z4sJkmQ8LgWDq2w7+eKGDeLOHcEIwFmnbD3NBtEtSdpIEA0OpObFCHFbiePe30aRIYzEB7j9DL7nPCUpBX0BSbLmc7cM/CzwWb/9UaSsioo5oOAhSWD4kIjhQwJcFoashcd3pTzxWEIYFM7fr+Dzl4rBaJvWR4Gz5cw1973AuOS/QQPJkR8gn7fWsGfU8ZfvGeLP3jHQwz++fcUY/37pGENDFpceCPCSXQcEUSOSGDUnGuPScwJbDVHcgQ943gWSWHEOkti/nIM09uxCiiAPAHhPdJ2LTF+ocE6A6lo07V5xAeCfGclRRMAY0GxBeRDMr6x64MBntFnUJaBubQC6ypEiPgwvTPMiiBEPRPcNXqxgs1dXcAVKKmANBAZSAzjpWfRMVNia7L46f/BeoCqqMUZ1VSAiS9UTJlkIeGuEOIZWy1GrGUQEpRe8iE93qkKrodSdMrZXiZNpNQlJrEzsdQRAYA2lElgLmpUwRfA5Ha5PKOWyEAbeanpp8szgs/+JagqqSwOEoEtCmBf4wAoTE8qhh0f8yesGuOLroyQphKGgLhOQFZIYJsaVcgWOPCbi+S8oceRRIS86odQx/fw4609qDB8c8Mj9MdvuiXn0oZhGQ6nWDEEgaMbejYCLvXDe9v5+Nm9q8PsdKbU+wSXzAZ9biSJigmCquc5H8/W6snR5wMcvWsmRR0WsOCjk4gv+QJpAWBLSBMb2OpYuC3jV+irrXlHjuaujHsCF6heAlQdbVh5cBXxQfPC+mJ9dV+e2G5qMPuno6zcEFpI2qFPedeEQL1lb4riXlLjkA6Ps3e2oVAzqmAf4giudfdpWnS94I0KcKIuGAj5zyTDPOTIibithJPziljqfuuBJ2m2olA2veX0f57xpgOXLbQekS73L+qA3pQOhHrgApvsTnvp9yg+/W+fGTXXaDUepJLz3U0OcuKbUufdjDyVc8r49TIwqUQi4eYIH5Ow1W3Wu4OcjvHcR5+BLXzuEI48ukSRKEAhp6k3yls11rvzWGOd/cDGrj406oBGmaX+uwznvz7kwHtgac8W/jPHat9U4aV25c880ARvAzvsTLj5vFCtFsHOAV5Cz19yr883znsbCGS/v48MfXYa10jFl53pBOue/n0nT+WuqO+zr/OK11XlWmafLNFEu/9Q4d17fIoqyQDgf8EAwt+YL6U2hVBJ+9INx4hg+smG5j9TazeszCaOj0VnMvwew67pJUTD5NVU9ePJ7pfC1j49z+48aDC424OYPXoCABTI8p8KSpQE3XjeJsU/yob9fSqkkHfBTo3uR7ACMPuV4+IGYJ3YmTOz1UukfNBx0cMDhx4QMLTEdMlQMlEWBkFlF3FIu/+Q4W65tMrTUkCZgmC94yQTwDOhtmsCSpZYfXTPByoNCznvXoo5PTtV6vvA7b2ty/Q/q/PaeNhNjStLWTtoKLEShYWDAsPqFIWtfW+WEU0rTrtFzXQs/+MYkt2xqsHzYkMQZeJ2f5iXjDcEzLWlbLRgeDln3ito0refBz1jYuSPhG1/Yy523tTBAuSJoAuWSMLDMa3tyr5K0odVQ7tjc4s7NLU44pcRb39fPQYcHnWt14kV2r5edVebW/2wSNxVrFgA+7y0CwTMpbIwRxscc571rkCOOCqctMP+85dYmn7tolPE9jsFBg0uFpKWse02FM86uMnyo/9HjO1J+9uMGP/9xg2rNl8d339riwXsS/ubjA5xwWqnnHrnvH3x0wGvOq/Ldf5xgYJFkJc3c4DscQUBefcZ2XUhhI2Jot5VDDwv50tdXEgTSE71zk73t5iaf/oeniQIfONPYB9H3fWwRJ68tzxgAf7m5yVc+sRfB09ukpaQxnH/xICeuLfe6QxYHkgT+8e2j/OGRhKgkPgjOAV4y8Ih0iqNu2JijqrMG2i1Yf04/UdQb/PIFPrg95l8+OUopFKJQwAmNScfb393PyWvLJIk/N09xzvl8ftLaMm9+Tz/NCQXnqXUUCV+7YIzfbUt8FnBdPalCGMHpIxXiZqbReYCXAngjHcDMXdKK0I5h+cqANWurvb6fCSJuK//6T3tIWkoY+kqt3VSOOCrkrNfXcM4Hyzwd5qWxsV4Q695Q5fCjA+KmgkIYCEkLvvnpMZJ2hkB7Y8GLz4xYstKQtnMh7Bu8ZOBFwMxX84IvcJoN5YQTywwMmg7ZAUiz9zf+qM5997Tp6xNcKhiBuKkce3yEDbqCmqkcRj2rW31CSNwCK4JLodovPPTrmF/8V7PDCfLfqIPaoGHVSRFxIxPsPMEXxmr77t6arHsrxr9e/EflnhyfW0ISK9f+5ySVsqBOOnU8wKIh401+DgqsCgNDGaHJF5hCqSzcfFWDJO5qvrMGhdUvjXyPILMoawQr3TUUwVNgncE+u7exkibSmS4IPgMc/dywh6Tkvr/9vpgdDyVUKgbS3rbW3qdcR+r7OkRg7CnttMfIAJbKwuMPpDyyNebo48POPfPwdciqACvQGNOMDHlpB4EQljw+U1iz4IN3MFv3Nk1g5UEhS5YEOPX9utRBf79hxcqgRwC5JfzmrhZJG0zVr1vwlVmpZLjvrpgkVoztDZw9mhTfI9x+V5ty2Wu+Y2EipC3lgV95AXRMKbvO4oMMz18T0RhTX6NkApp4yrHnCUcQdIXfqTs6THBanjeM1x2vfUM/bxjp36e2in93Ppx4zbnC2hyUy8LOhxKu+486r35zjTTxQi4KUJ33/xu+V2fXgyn9Az6vm4IfGwOPP5j0AM+vUaoJ531uYNoab/1Ok2s+U6e0uJtBcuvyQXCW7i0inVSVJLNXccVF7B1VAsO06Y46qNaE7106wS9+0sAG07OADWDLT5ps+vIk1VqR1GTERX32mHhapzVTpsYDFFzSFawplMhGuhVsxwJm694WQXcuPkPJmn90iXb9vGdKmxGPAL76qTF+dXObk9aVWHGod6U/PJrw3ze1uOvmFmHgMwdT2VwWSzSZZWMDvQrqkCbtBsC869d1AcnL4angBVQoRX5uN1czI/fpSiXzPZVODCgyrzSBtAX33tkmbilHrA5AYce2hIf+JyFtQShgwqwrXKzq8N+Vq9Jzz+JRXGdOm30A7HVXKQbBmSazqp6FPboj4Tf/0yZNfLGhqkSRcMzzomklrwDLVlhvuvnN8sGkheY4LF5med37a5z8yjKVWu/qm5PKlp80ufayOnt/76j20cPtDYKmytBK03PPYh/h0a0JSStrlqRgQ9j9iCMIpWsJGe0vuMD0PTmqUK0Zrv3BJD/cNNmpnlwKfVXh0u8sZ2iJ7WghDwtHPy9CtF5wAV/qTo7B844PefcnBlmywvY0SPKjXBNOP6fCC/+4xGUfG+PBX8XUBnzlWHSFw44NZrS+iacdl/3tOO1J7ZTlxgg2EMo16bTNi+BFwMw8n/eookColg3VilApC/19QrulPLYjmbHZcdyJEQOLTKfOtwYaE/Dc40I+/NkhlqywpEm3g1R8qXoXGVphOP/zgxz5gpDWRFbmZr7fNygc85Kwhwbn0t/9O0fSUqoDQqkqlGuGUkUIwkKDdAp4T4z2sTkB9YJQl/XhgLgFv70n7hFATk+XHWR50UklmhM+76aJ0D9geM8nBylXPa21wexU2AbeykpV4S8u7qc24IUZBNCaUFafHLF42Pq1TOEgv/t1TNrK47d0soHsA3yHae5rZ0Z3Xu8vHAbC3be3ZmyCAKx/a40oEgxCa0J5w3k1lg1b0ik9g9kOY70QlgxbXvVXNVqTimRV37q3V6YLLov0998WE0TZmKwIdDbw0uMCzGtnBs5H+gfubfPw9nhas9M5OGJ1yGve3MfuXY7Djg5Ys74yras715F3fF/2uhLDR1v2PO44460VDjk28AWYKXSHgce3pzy2NaVUNd3R2FzgO7hk6oaE2TcniHq/bjeU6zfVp/OBzBXe+Dd9HPvikONOiiiVpcdk5yWArMqLKsLql0YcdWLI2e+p9VSfRfr8y6t8W8zYhYEXAXndKx/TZ7on59OXLWH48KCnU5NH5T27Ha2GsuIQ6znBAgRQTHO7H02JqsLAUtOT+/PZwO5HUi59x3hWqBXBzQVechdYOHhrheak8t1Lx6exsryuX7TUsOJQOyNznK8VILD0MMvAUjNrH+H6Lzdo19X3GliA5vN+wDPRvKbQPyBsubHJdRvriMlGYAVunLe5XPrsXmmSFTHS23QVA1uubLH1hpjaYMZA5w2+GwSDzsxduxKca2eGEUjbvsobGDIzknNjOu2W/X7kllAbEqJKNi4PprK9fYAvfA4KTfF5g3cJaKr83UV+SquFsVXe83v84YSbvtfwXFy7rejC7s0OH0d71yAFgpW04JQ3l1l+hCdR1mZZwsFxr4gISsJ/fGQSk/GIYvEzK/ieYmghu7Hw4F2ivO9iD74zEcpubLPm5pM7U669fJJqn4F0pnHVDJOcQrbJt8y0JmH1aRHLDrcdPyebD7oUVq8JGbm4xlUfmcSIYIKuYOcC32MBhrn35OR1+Yf+eYgXnVzqjKbz6NxuKfffFfP8l0WUa4b+RSYTwPxmdfkWl07H1gphpJRqghhPdp7z4oAwm0Ua6xWyak3Im/65j6s+Mrkg8HkvotfsZiNEmqUMB7seTnvytWSB6bILx/invxrlqi9MsOfJ1AfM2Fdmmno+r6lM+dx9ueyzc+BctuVFYPwPjuu+0OCyvx5n04X1TsAtBsfdj/iNCGYh4AF505m7YoMJUJ33VrTJvY4/Pb+f9e+sdfz+ax8b45c/bjIwJNTHlL6BTPNZrp2v5vOnEToxNUu7jXGlNijUR5UXnB3xxg01xPrr33p5k5u+3KK2SOYP3gefJDAqu43YlUqsgshc4I3A4JBh45fGMQKvfEuVyy4cY8uPWyxa7LXW129wsT+3Ma69LlCYzE67R2fRihFv4pU+42cDWY+wb7Fh609iDHXWf7zCHd9tsfnSFn2LpdNKnwu8oGolFCXdLW95+RM/DWz59DSpO+M7/3NuQjRZYaQpDD/HsnN7QqUq2QalrqA0hdPeWPF5WsWTjmK0R3oITmezhvrWWmOvcsfVbR/5CyTHWIjryopjLE/v8PX/TJXejOC9NbpyWDWxa94cGDGbjdjTVdHOD/e1AzM3VwEJYNcD08HntLQx5uvzV76z+ozy/S3/3iSuK+GiwtAzi0OlmrD7YUdYmr/Zd7aCiqoVQ4psNo7g6jSuxyLWzGv7qRY05/zkN+8DFs/V1JvvtV+pc/8dvnKMWzon84t9pc1DdyTc9G8NKv294DvDTRWi8sLB++mRMe20ESP2avPtGxbfI+hNUdCPOE3nu/fWaCEnz7QnR31DNbDCtz42zu8fTglL3ZZ0PhA1tnffUFjyEX3ThZMEoW9rTQWfkxx04eDBpdWoiqI3vfP7pXuMT33RRaJORDwNWsjG431tSCKFKILJpx1fffcY22+PfclquuPtvKSVTCAPbkm44vwJ6nscYcksjN7OAd6TK6ugEkl4EYAdGVH77R9WH3nRYe89qhItOSFJ67HB2GcLvhgvwsjQnoC7r22x9wmlf4mhtsh02mNJG3b9NuGnX29y/ZcapG2Iyn5fwf4C7/mBxgPlWlhvN77559dUPn/liFpRVC68AHn81tF+dbolkPKqOB1LLCbg2YDXXnqbE5TmhFKqCEsPtQyu8HuExp9Unt7pSJpKZSAfjOxf8IpLqlF/kKTNbZWw/NKtxzJ+4QbUby3aAF+9YfFebafr1cW7SnYgQDXeL+ALvUWA2iJDEApP7XA8cHvMA7cnPLXDEYRQXSSd3uP+NHvQuBr1B87Fu6C9/tyNsjfrhWrhwUn/MOG71u5cZei/OrLVY5vtp50BNYh9xuBn25xgMsYn9FaKsv/Ag6ZGkP5yn4mT5N5mWj/nL68Z3HbliNpzswcnOxX7xo2Sjoyo/crmQ7ZpvOfUJJ28ohz0mXIwaD0QTf1jNarPFjyFuT+uO0p/1uD9o7POAxf6Sn22EvaZVhJfMdbedepU8DM/PF14wPj9a0fXqbMfFE3ODG2lpC5FNUY19fvtZ+P2PRqdDt7IAlrXswpnOre3EhCYkMAYYtdsWbE3IHLJ2zeF83t4erbH5z98eut41dZ61J0BbhXqlomfYy7M7GfS4n4ye4PEFvOkWLZZCX5qNbzmrd+XuwGuHFE7srH4EE73+F8s+DzqOtUckQAAAABJRU5ErkJggg==";
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
// SERVICE_RH_FORCE_SECURE_COOKIES=1. En HTTP local, absent (un cookie Secure
// n'est jamais envoyé par les navigateurs sur http — la connexion casserait).
function suffixeCookieSecure(res) {
  try {
    const req = res && res.req;
    const proto = req && req.headers && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const tlsNatif = req && req.socket && req.socket.encrypted === true;
    if (proto === "https" || tlsNatif || process.env.SERVICE_RH_FORCE_SECURE_COOKIES === "1") {
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
      "<title>Auto RH — Portail Employés</title>" +
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
<title>Auto RH — Portail Employés : connexion</title>
<!-- NOUVEAU (Task 26) : même logo (favicon) que la page administration -->
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: linear-gradient(160deg, #EEF2FF 0%, #F0F4FF 22%, #EDEAFE 45%, #F1EBFE 68%, #F4F0FE 85%, #F7F4FF 100%) fixed;
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
  input[type="text"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
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
  input[type="password"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
  input.code {
    letter-spacing: 10px; font-size: 22px; font-weight: 700; text-align: center;
    text-transform: none; padding-left: 0; padding-right: 0;
  }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  /* NOUVEAU (Task 33) : case « Se souvenir de moi » */
  .remember {
    display: flex; align-items: center; gap: 9px;
    font-weight: 500; font-size: 13.5px; color: #334155;
    margin: 2px 0 16px; cursor: pointer; user-select: none;
  }
  .remember input { width: 16px; height: 16px; accent-color: #4F46E5; cursor: pointer; margin: 0; }
  .remember span { line-height: 1.4; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #FFF6EC; color: #4338CA; border: 1px solid #FFDDB8; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
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
    display: flex; gap: 10px; align-items: flex-start; background: #EEF2FF;
    border: 1px solid #C7D2FE; color: #3730A3; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #4F46E5;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #4F46E5;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #4F46E5; animation: spin .8s linear infinite;
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
  <span class="brand">Auto RH<small>Portail Employés</small></span>
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
      b.style.color = visible ? "#94a3b8" : "#4F46E5";
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
<title>Auto RH — Portail Employés : nouveau mot de passe</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: linear-gradient(160deg, #EEF2FF 0%, #F0F4FF 22%, #EDEAFE 45%, #F1EBFE 68%, #F4F0FE 85%, #F7F4FF 100%) fixed;
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
  input[type="password"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #FFF6EC; color: #4338CA; border: 1px solid #FFDDB8; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
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
    display: flex; gap: 10px; align-items: flex-start; background: #EEF2FF;
    border: 1px solid #C7D2FE; color: #3730A3; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #4F46E5;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #4F46E5;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #4F46E5; animation: spin .8s linear infinite;
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
  <span class="brand">Auto RH<small>Portail Employés</small></span>
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
    background: linear-gradient(160deg, #EEF2FF 0%, #F0F4FF 22%, #EDEAFE 45%, #F1EBFE 68%, #F4F0FE 85%, #F7F4FF 100%) fixed;
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
  input[type="text"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
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
  input[type="password"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
  input.code {
    letter-spacing: 10px; font-size: 22px; font-weight: 700; text-align: center;
    text-transform: none; padding-left: 0; padding-right: 0;
  }
  button {
    width: 100%; height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: .6; cursor: default; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 12px; line-height: 1.55; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #FFF6EC; color: #4338CA; border: 1px solid #FFDDB8; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
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
    display: flex; gap: 10px; align-items: flex-start; background: #EEF2FF;
    border: 1px solid #C7D2FE; color: #3730A3; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #4F46E5;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #4F46E5;
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
<title>Auto RH — Portail Employés : première connexion</title>
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
      b.style.color = visible ? "#94a3b8" : "#4F46E5";
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
<title>Auto RH — Portail Employés : configuration réussie</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>${CSS_OTP}</style>
</head>
<body>
${enteteOtp()}

<main>
  <div class="card" style="text-align:center; padding:34px 24px;">
    <div style="width:64px; height:64px; border-radius:50%; background:#FFE6CC; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
      <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>Le QR code n'est affiché que lors de la première connexion.</span>
    </div>
    <p style="color:#64748b; font-size:13.5px; margin-top:14px;">
      Vous allez maintenant être redirigé vers la fenêtre de connexion
      (CIN, mot de passe et code OTP).
    </p>
    <a href="/login" id="btn-connexion" style="margin-top:18px; display:inline-flex; width:100%; height:48px; border-radius:12px; background:linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color:#fff; font-size:15px; font-weight:700; align-items:center; justify-content:center; gap:8px; text-decoration:none;">
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
  <span class="brand">Auto RH<small>Portail Employés</small></span>
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
<title>Auto RH — Portail Employés : code OTP</title>
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
<title>Auto RH — Portail Employés : configuration OTP</title>
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
<title>Auto RH — Portail Employés : code OTP expiré</title>
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
<title>Auto RH — Portail Employés : vos fiches de paie</title>
<!-- NOUVEAU (Task 26) : même logo (favicon) que la page administration -->
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* (MODIFIÉ Task 83 — maquette) fond clair neutre bleuté, cartes blanches
       à coins arrondis, ombres légères, boutons verts. */
    background: linear-gradient(160deg, #EEF2FF 0%, #F0F4FF 22%, #EDEAFE 45%, #F1EBFE 68%, #F4F0FE 85%, #F7F4FF 100%) fixed;
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
  input[type="text"]:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
  /* (MODIFIÉ Task 69) rayon 12px — cohérence avec les champs arrondis. */
  button {
    height: 48px; padding: 0 20px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; font-size: 15px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 8px; transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
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
    background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE;
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
  .msg.info { display: block; background: #FFF6EC; color: #4338CA; border: 1px solid #FFDDB8; }
  /* (NOUVEAU Task 83 — maquette) tête de carte : cercle icône vert + titre +
     sous-titre ; badge d'étape ; œil afficher/masquer ; notes vertes. */
  .carte-tete { display: flex; align-items: center; gap: 13px; margin-bottom: 14px; text-align: left; }
  .icon-rond {
    width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    box-shadow: 0 6px 14px rgba(238, 124, 28, 0.28);
  }
  .icon-rond svg { width: 22px; height: 22px; }
  .etq-etape {
    width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff;
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
    display: flex; gap: 10px; align-items: flex-start; background: #EEF2FF;
    border: 1px solid #C7D2FE; color: #3730A3; border-radius: 10px;
    padding: 11px 13px; font-size: 13.5px; line-height: 1.5;
  }
  .note-verte svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
  .expire-note {
    display: flex; gap: 7px; align-items: center; color: #4F46E5;
    font-size: 13.5px; font-weight: 600; margin: 2px 0 14px;
  }
  .expire-note svg { width: 16px; height: 16px; flex: none; }
  .lien-premiere {
    display: block; text-align: center; margin-top: 14px; color: #4F46E5;
    font-weight: 700; font-size: 13.5px; text-decoration: none;
  }
  .lien-premiere:hover { text-decoration: underline; }
  .spinner {
    display: none; width: 22px; height: 22px; margin: 18px auto 0; border-radius: 50%;
    border: 3px solid #FFE6CC; border-top-color: #4F46E5; animation: spin .8s linear infinite;
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
    border: 1.5px solid #C7D2FE; background: #ffffff; color: #3730A3;
    font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .pag-btn:hover:not(:disabled) { background: #EEF2FF; }
  .pag-btn:disabled { opacity: .45; cursor: default; }
  .pag-actif { background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); border-color: #4F46E5; color: #ffffff; }
  .pag-actif:hover:not(:disabled) { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
  .pag-suite { color: #94a3b8; font-weight: 700; padding: 0 2px; }
  /* NOUVEAU (0.2.61) bouton « Tout afficher » / « Pages de 100 » — l'employé
     choisit : navigation page par page OU toutes les fiches d'un coup. */
  .pag-bascule { margin-left: 14px; border-style: dashed; background: #FFF6EC; }
  .payslip {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 16px 14px;
    margin-bottom: 12px; box-shadow: 0 2px 8px rgba(2,44,34,.04); transition: box-shadow .15s;
  }
  .payslip:hover { box-shadow: 0 6px 18px rgba(2,44,34,.09); }
  .p-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
  .period { font-size: 16px; font-weight: 800; letter-spacing: -0.2px; }
  .emp { color: #475569; font-size: 13.5px; margin-top: 2px; }
  .net {
    background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE;
    font-weight: 800; font-size: 13.5px; padding: 5px 11px; border-radius: 999px; white-space: nowrap;
  }
  .p-meta { color: #64748b; font-size: 12.5px; margin-top: 8px; display: flex; gap: 14px; flex-wrap: wrap; }
  .p-actions { display: flex; gap: 8px; margin-top: 13px; flex-wrap: wrap; }
  .p-actions a {
    text-decoration: none; height: 38px; padding: 0 14px; border-radius: 9px; font-size: 13.5px;
    font-weight: 700; display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
  }
  .a-open { background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; }
  .a-open:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
  .a-dl { background: #ffffff; color: #3730A3; border: 1.5px solid #C7D2FE; }
  .a-dl:hover { background: #EEF2FF; }
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
  <span class="brand">Auto RH<small>Portail Employés</small></span>
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
  Portail employés Auto RH — fiches de paie et demandes administratives<br>
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
<title>Auto RH — Portail Employés : demandes administratives</title>
${LOGO_ADMIN_FAVICON_LINK}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: linear-gradient(160deg, #EEF2FF 0%, #F0F4FF 22%, #EDEAFE 45%, #F1EBFE 68%, #F4F0FE 85%, #F7F4FF 100%) fixed; color: #0f172a;
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
    background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE;
    font-weight: 800; font-size: 14px; padding: 6px 12px; border-radius: 999px;
  }
  .tb-spacer { flex: 1; }
  button {
    height: 44px; padding: 0 18px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #fff; font-size: 14px; font-weight: 700; white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s, transform .05s;
  }
  button:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
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
  input:focus, select:focus, textarea:focus { border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(238,124,28,.16); }
  input[readonly] { background: #FFF9F3; color: #475569; }
  .deux-colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .hint { color: #64748b; font-size: 12.5px; margin-top: 8px; line-height: 1.5; }
  .msg { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin: 12px 0; display: none; line-height: 1.5; }
  .msg.error { display: block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.info { display: block; background: #FFF6EC; color: #4338CA; border: 1px solid #FFDDB8; }
  /* (NOUVEAU v0.2.50) avertissement ambre — incohérence nom / prénom détectée */
  .msg.warn { display: block; background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  /* (SUPPRIMÉ 0.2.55 — Task 134) les styles des fiches (.fiche-*) partent
     avec l'onglet DÉPLACÉ : la consultation des bulletins vit dans la page
     d'accueil du portail, qui a ses propres styles (.payslip, .a-open,
     .a-dl). */
  .titre-carte { font-size: 16.5px; font-weight: 800; letter-spacing: -0.2px; display: flex; align-items: center; gap: 9px; }
  .titre-carte svg { width: 19px; height: 19px; color: #4F46E5; flex: none; }
  .sous-titre { color: #475569; font-size: 13.5px; margin-top: 6px; line-height: 1.55; }
  /* Onglets */
  .onglets { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .onglet {
    height: 38px; padding: 0 13px; border-radius: 999px; border: 1.5px solid #cbd5e1;
    background: #ffffff; color: #334155; font-size: 12.5px; font-weight: 700;
  }
  .onglet:hover { background: #f1f5f9; }
  .onglet.actif { background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); border-color: #4F46E5; color: #ffffff; }
  .panneau { display: none; }
  .panneau.actif { display: block; }
  /* Statuts */
  .statut {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
    font-size: 12px; font-weight: 800; padding: 4px 11px; border: 1px solid;
  }
  .st-EN_ATTENTE { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
  .st-ACCEPTEE { background: #EEF2FF; color: #4338CA; border-color: #C7D2FE; }
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
     avec l'affichage : « 1. Manager : … → 2. Service RH : … » n'est plus
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
  .demande .d-docs { margin-top: 10px; border: 1px solid #FFDDB8; background: #FFF6EC; border-radius: 10px; padding: 10px 12px; }
  .demande .d-docs-titre { font-size: 12.5px; font-weight: 800; color: #4338CA; margin-bottom: 7px; }
  .demande .d-doc { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 5px 0; border-top: 1px dashed #FFDDB8; }
  .demande .d-doc:first-of-type { border-top: none; }
  .demande .d-doc-nom { font-weight: 700; font-size: 12.8px; color: #0f172a; word-break: break-all; }
  .demande .d-doc-meta { color: #64748b; font-size: 11.8px; }
  .demande .btn-doc {
    height: 28px; padding: 0 11px; border-radius: 8px; font-size: 11.5px; font-weight: 700;
    display: inline-flex; align-items: center; text-decoration: none; cursor: pointer;
    background: linear-gradient(135deg, #4338CA 0%, #4F46E5 26%, #7C3AED 46%, #9333EA 68%, #A855F7 100%); color: #ffffff; border: none;
  }
  .demande .btn-doc:hover { background: linear-gradient(135deg, #312E81 0%, #4338CA 26%, #6D28D9 46%, #7C3AED 68%, #9333EA 100%); }
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
  <span class="brand">Auto RH<small>Demandes administratives</small></span>
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
      // dépliage) — « 1. Manager : … → 2. Service RH : … ».
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
          "Service RH (copie systématique à l'adresse dédiée des demandes d'" +
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
      ? { dest: cfg.rhEmail, motif: "Service RH (aucun manager responsable affecté à l'employé)" }
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
      ? { dest: cfg.rhEmail, motif: "Service RH (aucune adresse dédiée au parrainage configurée — onglet Accès portail → routage)" }
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
    return "Auto RH <" + cfg.username + ">";
  }
  return "Auto RH";
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

const SEL_SIGNATURE_TAMPON = "paiesage-signature-v1";
let _cleEmpreinteTampon = null;
function cleEmpreinteTampon() {
  if (!_cleEmpreinteTampon) {
    const matiere =
      process.env.SERVICE_RH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
      process.env.AUTH_SECRET ||
      "paiesage-storage-local-a-changer-dans-env";
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
    "Auto RH — Fiche de paie",
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
    "Cet e-mail a été envoyé automatiquement par Auto RH. Si vous n'êtes pas",
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
    '<div style="background:#4F46E5;padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Demande administrative — ' + echappeEmailDemande(d.typeLibelle) + "</div>" +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(d.reference) + " — Auto RH</div>" +
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
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto RH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
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
      headers: { "X-Service RH-Systeme": "demande-creation" },
      subject: "Auto RH — " + contenu.typeLibelle + " " + contenu.reference + " (traitement requis)",
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
    "— Auto RH (envoi automatique — NE PAS répondre)";
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">' +
    '<h2 style="color:#047857;margin-bottom:4px">Auto RH — Demande enregistrée « ' + echapperXmlTampon(libelleConf) + "</h2>" +
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
    '<p style="color:#94a3b8;font-size:12px;margin-top:16px">Auto RH — e-mail automatique (confirmation demandeur — NE PAS répondre)</p>' +
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
      subject: "Auto RH — " + libelleTypeDemande(demande.type) + " " + demande.reference + " (confirmation d'envoi)",
      text: texte,
      html: html,
      // (NOUVEAU Task 251) confirmation SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Service RH-Systeme": "confirmation-demandeur" },
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
// PERSISTÉ dans logs/service-rh-imap-curseurs.json (survit aux redémarrages).
// Le fetch ImapFlow utilise BODY.PEEK (ne marque PAS lu) ; les messages
// traités sont marqués lus APRÈS analyse (cosmétique, pour l'utilisateur).
// Le dédoublonnage reponsesRecues (Message-ID) reste la seconde barrière.
// ---------------------------------------------------------------------------
const CHEMIN_CURSEURS_IMAP = path.join(ROOT, "logs", "service-rh-imap-curseurs.json");
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
      "E-mail automatique Auto RH — notification SANS réponse.",
    ].join("\n");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#4F46E5;padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">Document disponible — ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + "</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — Auto RH</div>" +
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
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique Auto RH (notification SANS réponse).</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Service RH-Systeme": "document-disponible" },
      subject: "Auto RH — Document disponible : " + libelleTypeDemande(demande.type) + " " + demande.reference,
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
    "E-mail automatique Auto RH — notification SANS réponse.",
  ].filter(function (x) { return x !== null; }).join("\n");
  const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<div style="background:' + (acceptee ? "16a34a" : "b91c1c") + ';padding:18px 22px;color:#fff;">' +
    '<div style="font-size:18px;font-weight:700;">Votre demande : ' + echappeEmailDemande(libelleTypeDemande(demande.type)) + " — " + echappeEmailDemande(statutLabel) + "</div>" +
    '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — Auto RH</div>" +
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
    '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique Auto RH (notification SANS réponse).</p>' +
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
      headers: { "X-Service RH-Systeme": "decision-documents-rh" },
      subject: "Auto RH — Votre demande : " + libelleTypeDemande(demande.type) + " " + demande.reference + " — " + statutLabel + " — documents joints",
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
        ? ["E-mail automatique Auto RH — notification SANS réponse."]
        : ["Cet e-mail a été envoyé automatiquement par Auto RH. Si vous n'êtes pas",
           "le destinataire prévu, ignorez et supprimez ce message."]),
    ].join("\n");
    const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:' + (acceptee ? "#16a34a" : "#dc2626") + ';padding:18px 22px;color:#fff;">' +
      '<div style="font-size:18px;font-weight:700;">Demande ' + motAction + " par " + auteurNom + " — " + echappeEmailDemande(typeLib) + "</div>" +
      '<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — Auto RH</div>" +
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
        ? '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail automatique Auto RH (notification SANS réponse).</p>'
        : '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Auto RH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>') +
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
        headers: { "X-Service RH-Systeme": "notification-employe" },
        subject: texteEmploye
          ? "Auto RH — Votre demande " + typeLib + " " + demande.reference + " a été " + motAction + " par " + auteurPossessif
          : "Auto RH — " + typeLib + " " + demande.reference + " " + motAction + " par " + auteurNom,
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
        "Cet e-mail a été envoyé automatiquement par Service RH. Si vous n'êtes pas",
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
        '<div style="font-size:12px;opacity:.85;margin-top:4px;">Service RH</div>' +
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
        '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Service RH. Si vous n\'êtes pas le destinataire prévu, ignorez et supprimez ce message.</p>' +
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
          headers: { "X-Service RH-Systeme": "decision-demande" },
          subject: "Service RH — " + typeLibBas + " " + (validee ? "acceptée" : "refusée") + " : " + demande.reference,
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
      "Cet e-mail a été envoyé automatiquement par Service RH.",
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
      '<p style="margin:0;color:#94a3b8;font-size:12px;">E-mail envoyé automatiquement par Service RH.</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Service RH-Systeme": "transmission-rh" },
      subject: "Service RH — " + typeLib + " " + demande.reference + " acceptée par le manager — validation RH requise",
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
      "Cet e-mail a été envoyé automatiquement par Service RH.",
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
      '<p style="margin:0;color:#94a3b8;font-size:12px;">L’employé a été notifié ; le document de refus signé électroniquement a été généré. E-mail envoyé automatiquement par Service RH.</p>' +
      "</div></div>";
    const info = await transport.sendMail({
      from: from,
      to: dest,
      // (NOUVEAU Task 251) notification SYSTÈME — jamais classée (Garde 2).
      headers: { "X-Service RH-Systeme": "refus-manager" },
      subject: "Service RH — " + typeLib + " " + demande.reference + " refusée par le manager",
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
  // l'en-tête X-Service RH-Systeme et ne doivent jamais être classifiés.
  // (CORRIGÉ v0.2.178 — découvert en campagne E2E réelle) mailparser
  // normalise le nom d'en-tête en MINUSCULES en CONSERVANT les séparateurs
  // d'origine : « X-Service RH-Systeme » devient « x-service rh-systeme »
  // (AVEC l'espace). L'ancienne lecture « x-service-rh-systeme » (tirets)
  // renvoyait TOUJOURS undefined : la garde ne s'activait JAMAIS — une copie
  // Cc d'une décision (sujet « … acceptée : DEM-… ») pouvait être
  // re-classifiée et trancher une AUTRE demande portant la même référence.
  try {
    const enteteSysteme = parsed && parsed.headers && typeof parsed.headers.get === "function"
      ? (parsed.headers.get("x-service rh-systeme") || parsed.headers.get("x-service-rh-systeme"))
      : null;
    if (enteteSysteme) {
      return { statut: "IGNORE", motif: "Notification automatique du système (X-Service RH-Systeme : " + String(enteteSysteme).slice(0, 60) + ") — pas une réponse exploitable.", reference: demande.reference, expediteur: exp };
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
      ? "Service RH (réponse e-mail)"
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
    maj.traitePar = "Service RH (e-mail)";
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
        maj.traitePar = "Service RH (e-mail)";
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
      // « Service RH » désactivé retirait la boîte RH des Cc, « Manager »
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
 * Garde 1 (Message-ID d'envoi), Garde 2 (X-Service RH-Systeme — les copies de
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
  // Intervalle réglable pour les tests : SERVICE_RH_IMAP_INTERVALLE (secondes, min. 15).
  const secondes = Math.max(15, parseInt(process.env.SERVICE_RH_IMAP_INTERVALLE || "120", 10) || 120);
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
        //     « Service RH (réponse e-mail) », « Service parrainage (réponse
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
        return sendJson(res, 500, { error: "Document illisible sur le serveur : la clé de chiffrement (SERVICE_RH_STORAGE_KEY dans .env) ne correspond pas à celle utilisée lors du chiffrement." });
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
      service: "service-rh-portail-employes",
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
          ". Solutions : 1) relancez le portail depuis le MÊME dossier que le site d'administration ; 2) ou définissez la variable STORAGE_DIR (ou SERVICE_RH_STORAGE_DIR) vers le dossier storage\\payslips du site ; 3) si le site a été démarré avec une version antérieure, le fichier se trouve peut-être dans .next\\standalone\\storage\\payslips — mettez à jour le portail (scripts/portail-server.js) qui le retrouvera automatiquement.",
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
          "Fiche illisible sur le serveur : la clé de chiffrement (SERVICE_RH_STORAGE_KEY dans .env) ne correspond pas à celle utilisée lors du chiffrement. Vérifiez le fichier .env du site.",
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
          "La base de données du site n'est pas encore initialisée. Lancez le démarrage (DEMARRER-TOUT-WINDOWS.bat ou bash DEMARRER-TOUT-LINUX-MAC.sh) puis réessayez."
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
  console.log("  Auto RH — Portail Employés (accès sécurisé CIN + mot de passe)");
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


