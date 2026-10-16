/**
 * ============================================================================
 *  SAUVEGARDE CHIFFRÉE DE LA BASE DE DONNÉES (Task 32)
 * ============================================================================
 *
 *  db/custom.db contient les fiches de paie — depuis la Task 32 les champs
 *  sensibles y sont chiffrés, mais le fichier reste une base SQLite à
 *  protéger elle-même (structures, compteurs, anciennes lignes non migrées,
 *  copies .bak…). Ce script crée des SAUVEGARDES CHIFFRÉES (AES-256-GCM)
 *  du fichier de base, dans backups/.
 *
 *  UTILISATION :
 *    node scripts\sauvegarde-bd.js                     → sauvegarde chiffrée
 *    node scripts\sauvegarde-bd.js --liste             → liste des sauvegardes
 *    node scripts\sauvegarde-bd.js --restaurer <fichier> --sortie <chemin>
 *                                                      → restaure (+ sha256)
 *    node scripts\sauvegarde-bd.js --garder 15         → garder 15 sauvegardes
 *
 *  FORMAT (.pgb) :
 *    "PGBDSAVE1" + sel(16) + iv(12) + tag GCM(16) + données chiffrées
 *    (les données = en-tête JSON [liste fichiers + sha256] + contenus
 *    concaténés : custom.db + -wal/-shm si présents).
 *    Clé : scrypt(AUTO_RH_STORAGE_KEY || AUTH_SECRET, sel, 32) — le sel est
 *    UNIQUE à chaque sauvegarde. Même chaîne de repli que le reste du site.
 *
 *  CONSEIL : sauvegardez RÉGULIÈREMENT et, si possible, APRÈS avoir arrêté
 *  les serveurs (cohérence parfaite) — ARRETER-SILENCIEUX-WINDOWS.vbs puis
 *  SAUVEGARDER-BD-WINDOWS.bat, puis redémarrage.
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const MAGIC = Buffer.from("PGBDSAVE1", "utf8");
const DOSSIER = path.join(ROOT, "backups");

/* ---------------- Chargement du .env (même mécanique que le portail) ------ */
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

function materielSecret() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}

function cheminBase() {
  const m = String(process.env.DATABASE_URL || "").match(/^file:(.+)$/i);
  if (m) return path.resolve(m[1]);
  return path.join(ROOT, "db", "custom.db");
}

function fichiersDeBase() {
  const dbPath = cheminBase();
  const fichiers = [];
  if (!fs.existsSync(dbPath)) return fichiers;
  fichiers.push(dbPath);
  for (const ext of ["-wal", "-shm"]) {
    const f = dbPath + ext;
    if (fs.existsSync(f) && fs.statSync(f).size > 0) fichiers.push(f);
  }
  return fichiers;
}

/* ---------------- Chiffrement / déchiffrement ----------------------------- */
function chiffrerCharge(bloc) {
  const sel = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cle = crypto.scryptSync(materielSecret(), sel, 32);
  const chiffre = crypto.createCipheriv("aes-256-gcm", cle, iv);
  const donnees = Buffer.concat([chiffre.update(bloc), chiffre.final()]);
  const tag = chiffre.getAuthTag();
  return Buffer.concat([MAGIC, sel, iv, tag, donnees]);
}

function dechiffrerCharge(fichier) {
  const brut = fs.readFileSync(fichier);
  if (brut.length < MAGIC.length + 16 + 12 + 16 || !brut.subarray(0, 9).equals(MAGIC)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Auto-RH (.pgb) valide.");
  }
  const sel = brut.subarray(9, 25);
  const iv = brut.subarray(25, 37);
  const tag = brut.subarray(37, 53);
  const donnees = brut.subarray(53);
  const cle = crypto.scryptSync(materielSecret(), sel, 32);
  const clair = crypto.createDecipheriv("aes-256-gcm", cle, iv);
  clair.setAuthTag(tag);
  return Buffer.concat([clair.update(donnees), clair.final()]);
}

/* ---------------- Actions -------------------------------------------------- */
function sauvegarder(garder) {
  const fichiers = fichiersDeBase();
  if (fichiers.length === 0) {
    console.error("ERREUR : base introuvable (" + cheminBase() + ").");
    process.exit(1);
  }
  if (!process.env.AUTO_RH_STORAGE_KEY && !process.env.AUTH_SECRET) {
    console.log(
      "⚠ Avertissement : aucune clé dans .env (AUTO_RH_STORAGE_KEY / AUTH_SECRET) —\n" +
        "  la sauvegarde utilisera la clé de repli par défaut (protection faible)."
    );
  }
  const entrees = [];
  const blocs = [];
  for (const f of fichiers) {
    const contenu = fs.readFileSync(f);
    entrees.push({
      nom: path.basename(f),
      taille: contenu.length,
      sha256: crypto.createHash("sha256").update(contenu).digest("hex"),
    });
    blocs.push(contenu);
  }
  const entete = Buffer.from(
    JSON.stringify({
      version: 1,
      date: new Date().toISOString(),
      base: path.basename(cheminBase()),
      fichiers: entrees,
    }),
    "utf8"
  );
  const separateur = Buffer.from("\n", "utf8");
  const bloc = Buffer.concat([
    Buffer.from(String(entete.length).padStart(10, "0"), "utf8"),
    separateur,
    entete,
    ...blocs,
  ]);
  const horodatage = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  fs.mkdirSync(DOSSIER, { recursive: true });
  const cible = path.join(DOSSIER, "SERVICE-RH-BD-" + horodatage + ".pgb");
  fs.writeFileSync(cible, chiffrerCharge(bloc));

  console.log("============================================================");
  console.log("  Sauvegarde chiffrée de la base de données");
  console.log("============================================================");
  for (const e of entrees) {
    console.log("  • " + e.nom + " — " + (e.taille / 1024).toFixed(1) + " Ko — sha256 " + e.sha256.slice(0, 12) + "…");
  }
  console.log("");
  console.log("  Sauvegarde : " + cible);
  console.log("  Taille     : " + (fs.statSync(cible).size / 1024).toFixed(1) + " Ko (chiffrée AES-256-GCM)");
  console.log("  Clé        : " + (process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY ? "AUTO_RH_STORAGE_KEY" : process.env.AUTH_SECRET ? "AUTH_SECRET (repli)" : "repli par défaut (⚠ faible)"));
  console.log("");
  console.log("  Restauration : node scripts\\sauvegarde-bd.js --restaurer \"" + path.basename(cible) + "\" --sortie db\\custom.db");

  // Rotation : garder les N plus récentes
  const n = garder > 0 ? garder : 10;
  const liste = fs
    .readdirSync(DOSSIER)
    .filter((f) => f.startsWith("SERVICE-RH-BD-") && f.endsWith(".pgb"))
    .sort();
  if (liste.length > n) {
    for (const vieux of liste.slice(0, liste.length - n)) {
      fs.unlinkSync(path.join(DOSSIER, vieux));
      console.log("  Rotation : ancienne sauvegarde supprimée (" + vieux + ")");
    }
  }
  console.log("  Sauvegardes conservées : " + liste.length);
}

function lister() {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const liste = fs
    .readdirSync(DOSSIER)
    .filter((f) => f.startsWith("SERVICE-RH-BD-") && f.endsWith(".pgb"))
    .sort()
    .reverse();
  console.log("Sauvegardes chiffrées dans " + DOSSIER + " : " + liste.length);
  for (const f of liste) {
    const st = fs.statSync(path.join(DOSSIER, f));
    console.log("  • " + f + " — " + (st.size / 1024).toFixed(1) + " Ko — " + st.mtime.toISOString());
  }
}

function restaurer(fichierNom, sortie, forcer) {
  const fichier = path.isAbsolute(fichierNom)
    ? fichierNom
    : path.join(DOSSIER, fichierNom);
  if (!fs.existsSync(fichier)) {
    console.error("ERREUR : sauvegarde introuvable : " + fichier);
    process.exit(1);
  }
  if (!sortie) {
    console.error("ERREUR : précisez la destination : --sortie db\\custom.db.restauré");
    process.exit(1);
  }
  const dest = path.isAbsolute(sortie) ? sortie : path.join(ROOT, sortie);
  if (fs.existsSync(dest) && !forcer) {
    console.error(
      "ERREUR : " + dest + " existe déjà. Utilisez --forcer pour l'écraser,\n" +
        "ou choisissez un autre --sortie (ne JAMAIS écraser la base active sans précaution)."
    );
    process.exit(1);
  }
  let bloc;
  try {
    bloc = dechiffrerCharge(fichier);
  } catch (e) {
    console.error(
      "ERREUR : déchiffrement impossible (" + (e && e.message ? e.message : e) + ").\n" +
        "→ La clé actuelle (AUTO_RH_STORAGE_KEY / AUTH_SECRET du .env) ne correspond\n" +
        "  probablement pas à celle utilisée lors de cette sauvegarde."
    );
    process.exit(1);
  }
  const finTaille = bloc.indexOf("\n", 0, "utf8");
  const tailleEntete = parseInt(bloc.subarray(0, finTaille).toString("utf8"), 10);
  const entete = JSON.parse(bloc.subarray(finTaille + 1, finTaille + 1 + tailleEntete).toString("utf8"));
  let curseur = finTaille + 1 + tailleEntete;
  console.log("Sauvegarde du " + entete.date + " — base : " + entete.base);
  for (const e of entete.fichiers) {
    const contenu = bloc.subarray(curseur, curseur + e.taille);
    curseur += e.taille;
    const sha = crypto.createHash("sha256").update(contenu).digest("hex");
    if (sha !== e.sha256) {
      console.error("ERREUR : intégrité KO pour " + e.nom + " (sha256 différent) — fichier corrompu ?");
      process.exit(1);
    }
    const cibleFichier = dest + (e.nom === entete.base ? "" : e.nom.replace(entete.base, ""));
    fs.writeFileSync(cibleFichier, contenu);
    console.log("  ✔ " + e.nom + " → " + cibleFichier + " (sha256 vérifié)");
  }
  console.log("\nRestauration terminée. Vérifiez puis remplacez la base active si nécessaire.");
}

/* ---------------- Point d'entrée ------------------------------------------ */
const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};

if (args.includes("--liste")) {
  lister();
} else if (args.includes("--restaurer")) {
  restaurer(opt("--restaurer"), opt("--sortie"), args.includes("--forcer"));
} else {
  const g = parseInt(opt("--garder") || "10", 10);
  sauvegarder(Number.isFinite(g) ? g : 10);
}
