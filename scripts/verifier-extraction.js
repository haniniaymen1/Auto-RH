/**
 * VÉRIFICATEUR D'INTÉGRITÉ DE L'EXTRACTION (NOUVEAU v0.2.168)
 * ============================================================
 *
 * (CORRECTIF v0.2.202 — "Extraction incomplete" sur Windows)
 * Le vérificateur contrôlait auparavant la TAILLE EXACTE de chaque fichier.
 * Sur Windows, les outils d'extraction (WinRAR, 7-Zip, Explorateur Windows)
 * convertissent souvent les fins de ligne LF → CRLF, ce qui modifie la taille
 * des fichiers texte et déclencheait faussement "Fichiers CORROMPUS".
 *
 * CORRECTION : le vérificateur ne contrôle désormais QUE la PRÉSENCE des
 * fichiers (pas leur taille). La taille est affichée à titre informatif
 * mais ne déclenche plus d'échec. Si un fichier est réellement manquant,
 * le build Next.js échouera de toute façon avec un message clair.
 *
 * PRINCIPE : le ZIP livré embarque MANIFEST-LIVRAISON.txt — la liste exacte
 * (taille en octets + chemin relatif) de chaque fichier devant exister après
 * extraction. Ce vérificateur relit le manifeste, contrôle CHAQUE fichier
 * (présence uniquement) et affiche en français un diagnostic clair :
 *   - exit 0  : extraction complète ;
 *   - exit 2  : fichiers manquants (+ liste et remède) ;
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

for (const ligne of lignes) {
  const tab = ligne.indexOf("\t");
  if (tab < 1) continue;
  const taille = parseInt(ligne.slice(0, tab), 10);
  const chemin = ligne.slice(tab + 1).trim();
  if (!chemin || !Number.isFinite(taille)) continue;
  const absolu = path.join(RACINE, chemin);
  try {
    fs.statSync(absolu);
  } catch {
    manquants.push(chemin);
  }
  // (CORRECTIF v0.2.202) On ne vérifie PLUS la taille exacte — la conversion
  // des fins de ligne LF → CRLF sur Windows modifie la taille des fichiers
  // texte sans pour autant corrompre leur contenu. Le build Next.js est le
  // véritable test final : si un fichier est réellement corrompu, le build
  // échouera avec un message d'erreur explicite.
}

if (modeComplet && !modeLeger && !fs.existsSync(path.join(RACINE, "db", "custom.db"))) {
  manquants.push("db/custom.db (base de données — présente uniquement dans le ZIP COMPLET)");
}

const total = manquants.length;

if (total === 0) {
  if (!silencieux) {
    console.log(
      "[verifier-extraction] Extraction complète : " +
        lignes.length +
        " fichiers contrôlés (présence, mode " +
        (modeLeger ? "léger" : "complet") +
        "), aucun problème détecté."
    );
  }
  process.exit(0);
}

console.log("");
console.log("==============================================================");
console.log("  EXTRACTION INCOMPLÈTE DÉTECTÉE — " + total + " fichier(s) manquant(s)");
console.log("==============================================================");
console.log("");
console.log("Le dossier courant ne contient pas fidèlement le contenu du ZIP.");
console.log("Fichiers MANQUANTS (" + manquants.length + ") — exemples :");
for (const m of manquants.slice(0, 15)) console.log("   - " + m);
if (manquants.length > 15) console.log("   ... et " + (manquants.length - 15) + " autre(s)");
console.log("");
console.log("CAUSES FREQUENTES :");
console.log("  1. Extraction partielle (fichiers déplacés un à un, ou extraction arrêtée) ;");
console.log("  2. Antivirus ayant mis en quarantaine des fichiers pendant l'extraction ;");
console.log("  3. ZIP reconstitué depuis plusieurs e-mails SANS vérification du MD5.");
console.log("");
console.log("SOLUTION :");
console.log("  1. Re-téléchargez le ZIP d'origine, puis vérifiez son MD5 :");
console.log("        certutil -hashfile <nom-du-fichier.zip> MD5");
console.log("  2. Ré-extrayez TOUT le contenu du ZIP dans ce dossier");
console.log("     (clic droit sur le ZIP -> « Extraire tout... » -> remplacer) ;");
console.log("  3. Relancez le lanceur (DEMARRER-SILENCIEUX-WINDOWS.vbs ou DEMARRER-WINDOWS.bat).");
console.log("");
process.exit(2);
