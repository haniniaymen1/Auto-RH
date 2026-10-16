#!/usr/bin/env node
/**
 * ============================================================
 *  Fiches de Paie - SECURISATION AUTOMATIQUE DES DOSSIERS
 *  (Task 40 : remplace les anciens lanceurs SECURISER-DOSSIER-*)
 * ============================================================
 *
 *  Appele AUTOMATIQUEMENT au demarrage des serveurs :
 *    - par scripts/auto-rh.js (mode silencieux) ;
 *    - par PREPARER-AUTO-RH-SILENCIEUX.bat, DEMARRER-WINDOWS.bat,
 *      DEMARRER-PORTAIL-WINDOWS.bat et les lanceurs Linux/macOS.
 *
 *  Ce qu'il fait, sans JAMAIS bloquer le demarrage :
 *    - WINDOWS   : restreint les autorisations NTFS des elements
 *      sensibles (.env, db, storage, storage\payslips, logs,
 *      backups) aux seuls comptes legitimes : VOTRE compte Windows
 *      + SYSTEME + Administrateurs (icacls /inheritance:r
 *      /grant:r ... -- exactement le choix [1] Verrouiller de
 *      l'ancien menu SECURISER-DOSSIER-WINDOWS.bat) ;
 *    - LINUX/MAC : chmod 700 sur les dossiers, 600 sur .env et
 *      les fichiers de base (*.db) ;
 *    - (NOUVEAU 0.2.59) CHIFFREMENT des copies de tampons restees
 *      en clair dans storage/tampons (AES-256-GCM, en-tete
 *      PAIESAGE1 -- memes regles que les fiches) : une image de
 *      cachet/signature est aussi sensible qu'une fiche. Les
 *      nouvelles copies sont deja chiffrees a l'ecriture par le
 *      site (v0.2.59+) ; cette phase rattrape les plus anciennes.
 *      Elle est ignoree si AUTO_RH_STORAGE_DISABLE=1.
 *
 *  Proprietes :
 *    - IDEMPOTENT  : peut tourner a CHAQUE demarrage sans risque ;
 *    - TOLERANT    : une erreur sur un element n'arrete rien et
 *      le script se termine TOUJOURS avec le code 0 ;
 *    - REVERSIBLE  : icacls "<element>" /inheritance:e (Windows)
 *      ou chmod 755 / 644 (Linux/macOS) restaure l'heritage
 *      standard a tout moment ;
 *    - JOURNAL     : logs/securisation-auto.log (1 ligne/action) ;
 *    - PAS D'EFS   : le chiffrement EFS (cipher /e, Windows Pro)
 *      reste une option MANUELLE documentee (README section 23),
 *      car il exige l'export d'un certificat apres activation.
 *
 *  Options :
 *    node scripts/securiser-auto.js           -> protege (mode demarrage)
 *    node scripts/securiser-auto.js --etat    -> affiche l'etat actuel
 *
 *  Echappatoire support : variable d'environnement
 *    AUTO_RH_SAUT_SECURISATION=1  -> aucune modification (diagnostic).
 * ============================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LOGS = path.join(ROOT, "logs");
const JOURNAL = path.join(LOGS, "securisation-auto.log");
const IS_WIN = process.platform === "win32";

// Elements sensibles : [chemin relatif, est-un-dossier]
const CIBLES = [
  [".env", false],
  ["db", true],
  ["storage", true],
  ["storage/payslips", true],
  ["logs", true],
  ["backups", true],
];

function journal(msg) {
  try {
    fs.mkdirSync(LOGS, { recursive: true });
    fs.appendFileSync(JOURNAL, "[" + new Date().toISOString() + "] " + msg + "\n");
  } catch (_) { /* best effort */ }
}

// ----------------------------------------------------------------
// (NOUVEAU 0.2.59) Phase CHIFFREMENT DES TAMPONS en clair.
// Meme format que les fiches : [PAIESAGE1][nonce 12][tag 16][AES-256-GCM]
// (constantes IDENTIQUES a storage-crypto.ts / chiffrer-storage.js /
// portail-server.js). IDEMPOTENT : un fichier deja chiffre est ignore.
// Reversible via scripts/chiffrer-storage.js --dechiffrer.
// ----------------------------------------------------------------

/** Charge le .env de la racine (additif, comme chiffrer-storage.js). */
function chargerEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch (_) { /* best effort */ }
}

const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const SALT = "autorh-storage-v1";

function cleStockage() {
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  return crypto.scryptSync(materiel, SALT, 32);
}

function estChiffre(buf) {
  return buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Dossiers tampons candidats (meme logique que storage-dir.ts). */
function dossiersTampons() {
  const liste = [
    process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR || process.env.STORAGE_DIR
      ? path.join(path.dirname(String(process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR || process.env.STORAGE_DIR)), "tampons")
      : null,
    path.join(ROOT, "storage", "tampons"),
    path.join(ROOT, ".next", "standalone", "storage", "tampons"),
  ].filter(Boolean);
  return [...new Set(liste)];
}

/**
 * Chiffre en place les copies de tampons en clair. Jamais bloquant :
 * toute erreur est journalisee et le demarrage continue.
 */
function chiffrerTamponsEnClair() {
  // Echappatoire : le site lui-meme ecrit alors les copies en clair
  // (AUTO_RH_STORAGE_DISABLE=1) -- on ne les re-chiffre pas a contre-courant.
  if (process.env.AUTO_RH_STORAGE_DISABLE === "1") {
    journal("Chiffrement des tampons ignore (AUTO_RH_STORAGE_DISABLE=1).");
    return "ignore";
  }
  let chiffres = 0, deja = 0, erreurs = 0;
  const cle = cleStockage();
  for (const dir of dossiersTampons()) {
    let noms = [];
    try {
      noms = fs.readdirSync(dir).filter((f) => {
        try { return fs.statSync(path.join(dir, f)).isFile(); } catch (_) { return false; }
      });
    } catch (_) { continue; /* dossier absent */ }
    for (const nom of noms) {
      const p = path.join(dir, nom);
      try {
        const brut = fs.readFileSync(p);
        if (estChiffre(brut)) { deja++; continue; }
        const nonce = crypto.randomBytes(12);
        const c = crypto.createCipheriv("aes-256-gcm", cle, nonce);
        const enc = Buffer.concat([c.update(brut), c.final()]);
        const out = Buffer.concat([MAGIC, nonce, c.getAuthTag(), enc]);
        const tmp = p + ".tmp-enc";
        fs.writeFileSync(tmp, out);
        fs.renameSync(tmp, p);
        chiffres++;
      } catch (e) {
        erreurs++;
        try { fs.unlinkSync(p + ".tmp-enc"); } catch (_) { /* ignore */ }
        journal("AVERTISSEMENT chiffrement tampon " + nom + " : " +
          (e && e.message ? e.message.split("\n")[0] : "erreur"));
      }
    }
  }
  const resume = "Chiffrement des tampons : " + chiffres + " chiffre(s), " +
    deja + " deja chiffre(s), " + erreurs + " erreur(s).";
  journal(resume);
  return resume;
}

/** Compte Windows courant sous la forme DOMAINE\Utilisateur ("" si inconnu). */
function compteWindows() {
  const u = process.env.USERNAME || "";
  const d = process.env.USERDOMAIN || "";
  if (!u) return "";
  return d ? d + "\\" + u : u;
}

/**
 * Windows : UNE SEULE commande icacls par element (meme forme que
 * l'ancien menu verrouille) : l'heritage est coupe et les ACE
 * re-grantees dans la meme passe -- aucune fenetre de vulnerabilite.
 * SIDs literal : *S-1-5-18 = SYSTEME, *S-1-5-32-544 = Administrateurs
 * (independant de la langue de Windows).
 */
function protegerWindows(chemin, estDossier) {
  const compte = compteWindows();
  const droits = estDossier ? "(OI)(CI)F" : "F";
  const args = [chemin, "/inheritance:r", "/grant:r"];
  if (compte) args.push(compte + ":" + droits);
  args.push("*S-1-5-18:" + droits, "*S-1-5-32-544:" + droits);
  execFileSync("icacls", args, { stdio: "ignore", windowsHide: true });
}

/** Linux/macOS : 700 dossiers (proprietaire seul), 600 fichiers sensibles. */
function protegerUnix(chemin, rel, estDossier) {
  fs.chmodSync(chemin, estDossier ? 0o700 : 0o600);
  if (rel === "db") {
    let noms = [];
    try { noms = fs.readdirSync(chemin); } catch (_) { /* absent */ }
    for (const nom of noms) {
      if (nom.endsWith(".db")) {
        try { fs.chmodSync(path.join(chemin, nom), 0o600); } catch (_) { /* ignore */ }
      }
    }
  }
}

/** Affiche l'etat actuel (option --etat). */
function etat() {
  console.log("Etat de la securisation des dossiers sensibles :");
  for (const [rel, estDossier] of CIBLES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log("  " + rel + " : absent (ignore)"); continue; }
    if (IS_WIN) {
      try {
        const out = execFileSync("icacls", [p], { encoding: "utf8", windowsHide: true });
        console.log("  " + rel + " :");
        for (const ligne of out.trim().split(/\r?\n/)) console.log("    " + ligne.trim());
      } catch (_) {
        console.log("  " + rel + " : etat indisponible");
      }
    } else {
      let mode = "";
      try { mode = (fs.statSync(p).mode & 0o777).toString(8); } catch (_) { /* ignore */ }
      const verrouille = mode === "700" || mode === "600";
      console.log("  " + rel + " : " + (verrouille ? "verrouille (" + mode + ")" : "mode " + mode) + (estDossier ? " [dossier]" : " [fichier]"));
    }
  }
  console.log(IS_WIN
    ? "  Attendu : votre compte + SYSTEM (*S-1-5-18) + Administrateurs (*S-1-5-32-544), heritage coupe."
    : "  Attendu : dossiers 700 (proprietaire seul), fichiers sensibles 600.");
  console.log("  Journal : " + JOURNAL);
}

function principale() {
  if (process.argv.indexOf("--etat") !== -1) { etat(); return; }

  if (process.env.AUTO_RH_SAUT_SECURISATION === "1") {
    journal("AUTO_RH_SAUT_SECURISATION=1 : securisation ignoree (demande explicite).");
    console.log("Securisation ignoree (AUTO_RH_SAUT_SECURISATION=1).");
    return;
  }

  // Unix lance en root : ne surtout pas verrouiller les fichiers pour
  // le compte d'un utilisateur qui ne pourrait plus y acceder ensuite.
  if (!IS_WIN && typeof process.getuid === "function" && process.getuid() === 0) {
    journal("Execution en root : securisation ignoree par precaution.");
    console.log("Securisation ignoree (execution en root).");
    return;
  }

  const debut = Date.now();
  let ok = 0, absents = 0, alertes = 0;
  for (const [rel, estDossier] of CIBLES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { absents++; continue; }
    try {
      if (IS_WIN) protegerWindows(p, estDossier);
      else protegerUnix(p, rel, estDossier);
      ok++;
      journal((IS_WIN ? "icacls" : "chmod") + " OK : " + rel);
    } catch (e) {
      alertes++;
      journal("AVERTISSEMENT " + rel + " : " + (e && e.message ? e.message.split("\n")[0] : "erreur"));
    }
  }
  const resume = "Securisation automatique : " + ok + " protege(s), " + absents +
    " absent(s), " + alertes + " avertissement(s) (" + (Date.now() - debut) + " ms).";
  journal(resume);
  console.log(resume);

  // (NOUVEAU 0.2.59) phase 2 : chiffrement des tampons en clair.
  chargerEnv();
  console.log(chiffrerTamponsEnClair());
}

try { principale(); } catch (e) {
  journal("ERREUR inattendue : " + (e && e.message ? e.message : "inconnue"));
}
process.exit(0);
