/**
 * VÉRIFICATEUR D'INTÉGRITÉ DE L'EXTRACTION (NOUVEAU v0.2.168)
 * ============================================================
 *
 * PROBLÈME CORRIGÉ : un ZIP mal extrait (outil de décompression, antivirus,
 * extraction interrompue, transfer.e-mail reconstitué sans contrôle MD5)
 * perd des fichiers — le plus souvent tout ou partie du dossier src\.
 * Le lanceur arrivait alors à l'étape « Construction du site » et Next.js
 * échouait avec une erreur CRYPTIQUE :
 *
 *     Error: > Couldn't find any `pages` or `app` directory.
 *             Please create one under the project root
 *
 * ... sans aucune indication que la VRAIE cause est une extraction incomplète.
 *
 * PRINCIPE : le ZIP livré embarque MANIFEST-LIVRAISON.txt — la liste exacte
 * (taille en octets + chemin relatif) de chaque fichier devant exister après
 * extraction. Ce vérificateur relit le manifeste, contrôle CHAQUE fichier
 * (présence + taille exacte) et affiche en français un diagnostic clair :
 *   - exit 0  : extraction complète ;
 *   - exit 2  : fichiers manquants ou corrompus (+ liste et remède) ;
 *   - exit 3  : manifeste introuvable (ZIP trop ancien — contrôle ignoré
 *               par les lanceurs, jamais bloquant).
 *
 * Options :
 *   --complet   vérifie aussi db/custom.db (présente uniquement dans le
 *               ZIP COMPLET, absente de la version légère) ;
 *   --silencieux  n'affiche rien si tout est OK (utile dans les journaux).
 *
 * Usage : node scripts\verifier-extraction.js [--complet] [--silencieux]
 */

const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..");
const MANIFESTE = path.join(RACINE, "MANIFEST-LIVRAISON.txt");
const args = process.argv.slice(2);
const modeComplet = args.includes("--complet");
const silencieux = args.includes("--silencieux");

if (!fs.existsSync(MANIFESTE)) {
  console.log(
    "[verifier-extraction] MANIFEST-LIVRAISON.txt introuvable : ZIP antérieur à 0.2.168, contrôle d'extraction ignoré."
  );
  process.exit(3);
}

const lignesBrutes = fs
  .readFileSync(MANIFESTE, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim().length > 0);

/* (v0.2.170) Ligne d'en-tête MODE=COMPLET|LEGER : en version légère,
 * db/custom.db est volontairement absente (créée par prisma db push au
 * premier démarrage) — le mode --complet ne doit donc pas l'exiger. */
const enteteMode = (lignesBrutes.find((l) => l.startsWith("MODE=")) || "MODE=COMPLET").trim();
const modeLeger = enteteMode === "MODE=LEGER";
const lignes = lignesBrutes.filter((l) => !l.startsWith("MODE="));

const manquants = [];
const corrompus = [];

for (const ligne of lignes) {
  const tab = ligne.indexOf("\t");
  if (tab < 1) continue;
  const taille = parseInt(ligne.slice(0, tab), 10);
  const chemin = ligne.slice(tab + 1).trim();
  if (!chemin || !Number.isFinite(taille)) continue;
  const absolu = path.join(RACINE, chemin);
  let stat = null;
  try {
    stat = fs.statSync(absolu);
  } catch {
    manquants.push(chemin);
    continue;
  }
  if (stat.size !== taille) corrompus.push(chemin + " (" + stat.size + " o au lieu de " + taille + " o)");
}

if (modeComplet && !modeLeger && !fs.existsSync(path.join(RACINE, "db", "custom.db"))) {
  manquants.push("db/custom.db (base de données — présente uniquement dans le ZIP COMPLET)");
}

const total = manquants.length + corrompus.length;

if (total === 0) {
  if (!silencieux) {
    console.log(
      "[verifier-extraction] Extraction complète : " +
        lignes.length +
        " fichiers contrôlés (présence + taille, mode " +
        (modeLeger ? "léger" : "complet") +
        "), aucun problème détecté."
    );
  }
  process.exit(0);
}

console.log("");
console.log("==============================================================");
console.log("  EXTRACTION INCOMPLÈTE DÉTECTÉE — " + total + " fichier(s) en défaut");
console.log("==============================================================");
console.log("");
console.log("Le dossier courant ne contient pas fidèlement le contenu du ZIP.");
if (manquants.length > 0) {
  console.log("Fichiers MANQUANTS (" + manquants.length + ") — exemples :");
  for (const m of manquants.slice(0, 15)) console.log("   - " + m);
  if (manquants.length > 15) console.log("   ... et " + (manquants.length - 15) + " autre(s)");
}
if (corrompus.length > 0) {
  console.log("Fichiers CORROMPUS (taille différente) (" + corrompus.length + ") — exemples :");
  for (const m of corrompus.slice(0, 15)) console.log("   - " + m);
  if (corrompus.length > 15) console.log("   ... et " + (corrompus.length - 15) + " autre(s)");
}
console.log("");
console.log("CAUSES FREQUENTES :");
console.log("  1. Extraction partielle (fichiers déplacés un à un, ou extraction arrêtée) ;");
console.log("  2. Antivirus ayant mis en quarantaine des fichiers pendant l'extraction ;");
console.log("  3. ZIP reconstitué depuis plusieurs e-mails SANS vérification du MD5.");
console.log("");
console.log("SOLUTION :");
console.log("  1. Re-téléchargez ou reconstituez le ZIP d'origine si besoin, puis");
console.log("     vérifiez son MD5 (commande fournie dans l'e-mail de livraison) :");
console.log("        certutil -hashfile <nom-du-fichier.zip> MD5");
console.log("  2. Ré-extrayez TOUT le contenu du ZIP dans ce dossier");
console.log("     (clic droit sur le ZIP -> « Extraire tout... » -> remplacer) ;");
console.log("  3. Relancez le lanceur (DEMARRER-TOUT-WINDOWS.bat ou bash DEMARRER-TOUT-LINUX-MAC.sh).");
console.log("");
process.exit(2);
