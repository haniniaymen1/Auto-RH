import fs from "fs";
import path from "path";

/**
 * ============================================================
 *  AutoRH — Résolution ROBUSTE du dossier des PDF importés
 * ============================================================
 *
 *  PROBLÈME CORRIGÉ (« Fichier PDF introuvable sur le serveur ») :
 *  le serveur de production Next.js « standalone » (.next/standalone/
 *  server.js) force process.chdir(__dirname) au démarrage. Le répertoire
 *  courant du site devient donc <racine>/.next/standalone/ et l'ancien
 *  calcul  path.join(process.cwd(), "storage", "payslips")  envoyait les
 *  PDF importés dans .next/standalone/storage/payslips/ au lieu de
 *  storage/payslips/ — dossier que le portail employés examine.
 *
 *  SOLUTION (aucun comportement antérieur retiré) :
 *   1. override explicite par variable d'environnement :
 *        AUTO_RH_STORAGE_DIR  (nouvelle, posée par les scripts de
 *        démarrage : .bat, .sh, start-prod.js, Docker) ou STORAGE_DIR ;
 *   2. racine du projet détectée SANS se fier au répertoire courant :
 *        - variable AUTO_RH_ROOT (posée par start-prod.js),
 *        - dérivée de DATABASE_URL absolu (file:<racine>/db/custom.db,
 *          écrit par les scripts de démarrage Windows/Linux/Mac),
 *        - ou retrouvée en remontant de process.cwd() jusqu'au dossier
 *          contenant prisma/schema.prisma (mode dev / next start) ;
 *   3. à la LECTURE d'un fichier, plusieurs dossiers candidats sont
 *      essayés dans l'ordre — y compris l'ancien emplacement standalone
 *      .next/standalone/storage/payslips/ — pour continuer de servir les
 *      fiches importées AVANT ce correctif (fichiers « égarés »).
 * ============================================================
 */

/** Première variable d'environnement non vide, résolue en chemin absolu. */
function envDir(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      try {
        return path.resolve(value.trim());
      } catch {
        return value.trim();
      }
    }
  }
  return null;
}

/**
 * Racine extraite d'une DATABASE_URL absolue de la forme
 * « file:<racine>/db/custom.db » (écrite ainsi par DEMARRER-WINDOWS.bat,
 * DEMARRER-LINUX-MAC.sh et le Dockerfile), sinon null.
 */
function rootFromDatabaseUrl(): string | null {
  const url = String(process.env.DATABASE_URL || "");
  const m = url.match(/^file:(.+)[/\\]db[/\\][^/\\]+\.db\/?$/i);
  if (!m) return null;
  try {
    return path.resolve(m[1]);
  } catch {
    return null;
  }
}

/** Racine du projet, indépendante du répertoire courant du serveur. */
export function getProjectRoot(): string {
  // 1) override explicite (posé par scripts/start-prod.js)
  const explicit = envDir("AUTO_RH_ROOT");
  if (explicit) return explicit;

  // 2) dérivé de DATABASE_URL absolu (scripts de démarrage + Docker)
  const fromDb = rootFromDatabaseUrl();
  if (fromDb) return fromDb;

  // 3) remontée depuis le répertoire courant jusqu'à prisma/schema.prisma
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "prisma", "schema.prisma"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 4) cas build standalone lancé directement : cwd = <racine>/.next/standalone
  const cwd = process.cwd();
  if (
    path.basename(cwd) === "standalone" &&
    path.basename(path.dirname(cwd)) === ".next"
  ) {
    return path.dirname(path.dirname(cwd));
  }

  // 5) repli : répertoire courant (comportement historique conservé)
  return cwd;
}

/**
 * Dossier CANONIQUE d'enregistrement des PDF (écriture / import).
 * C'est toujours <racine>/storage/payslips, sauf override explicite.
 */
export function getStorageDir(): string {
  const override = envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR");
  if (override) return override;
  return path.join(getProjectRoot(), "storage", "payslips");
}

/**
 * Dossiers candidats pour la LECTURE d'un PDF déjà stocké, par ordre de
 * priorité. Les anciens emplacements (cwd historique, build standalone)
 * sont conservés pour continuer de servir les fiches importées avant
 * ce correctif.
 */
export function storageReadCandidates(): string[] {
  const root = getProjectRoot();
  const cwd = process.cwd();
  const fromDb = rootFromDatabaseUrl();

  const list = [
    envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR"),
    path.join(root, "storage", "payslips"),
    // — historiques conservés —
    path.join(cwd, "storage", "payslips"),
    // — PDF égarés par les versions précédentes (build standalone) —
    path.join(root, ".next", "standalone", "storage", "payslips"),
    path.join(cwd, ".next", "standalone", "storage", "payslips"),
    // — racine dérivée de la base, si différente —
    fromDb ? path.join(fromDb, "storage", "payslips") : null,
  ].filter(Boolean) as string[];

  return [...new Set(list)];
}

/**
 * (NOUVEAU Task 15bis — « l'aperçu d'une fiche PNG affiche une image cassée »)
 * Détecte le VRAI type d'un fichier stocké par ses octets de signature
 * (magic bytes) : PNG, JPEG ou PDF. Renvoie null si la signature n'est
 * pas reconnue (l'appelant retombe alors sur l'extension du nom stocké).
 *
 * UTILITÉ : si l'extension du nom stocké contredit le contenu réel
 * (ex. fiche enregistrée en « .png » mais dont les octets sont ceux d'un
 * PDF — import ZIP mal étiqueté, renommage manuel, ancienne version), le
 * navigateur recevait un « image/png » faux et affichait une ICÔNE D'IMAGE
 * CASSÉE au lieu du document. Servir le type DÉTECTÉ par le contenu corrige
 * l'affichage sans toucher au disque ni à la base.
 */
export function sniffContentType(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;
  // PNG : 89 50 4E 47 0D 0A 1A 0A (« \x89PNG\r\n\x1a\n »)
  if (buf.length >= 8 && buf.subarray(0, 4).toString("hex") === "89504e47") {
    return "image/png";
  }
  // JPEG : FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PDF : « %PDF- »
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

/**
 * Retrouve un PDF stocké dans les dossiers candidats.
 * Retourne le chemin absolu du fichier, ou null s'il est introuvable.
 *
 * (CORRECTIF SÉCURITÉ — Task 94) garde anti-traversée : un nom de fichier
 * stocké ne doit JAMAIS contenir de séparateur ni de « .. » (les noms sont
 * générés par le serveur : horodatage + hexadécimal + extension). Ce
 * contrôle empêche toute lecture/suppression hors du dossier de stockage
 * si la base venait à contenir une valeur manipulée.
 */
export function resolveStoredFile(storedName: string): string | null {
  if (
    typeof storedName !== "string" ||
    storedName.length === 0 ||
    storedName.length > 255 ||
    !/^[A-Za-z0-9._-]+$/.test(storedName) ||
    storedName.includes("..")
  ) {
    return null;
  }
  for (const dir of storageReadCandidates()) {
    try {
      const filePath = path.join(dir, storedName);
      if (fs.statSync(filePath).isFile()) return filePath;
    } catch {
      // dossier absent ou fichier absent — candidat suivant
    }
  }
  return null;
}

/**
 * (NOUVEAU Task 122) Dossier CANONIQUE d'enregistrement des DOCUMENTS des
 * demandes administratives (pièces jointes reçues par e-mail du service RH) :
 * voisin « documents-demandes » du dossier des fiches — même racine de
 * stockage, donc le portail employé (4001) et l'administration (4000)
 * partagent les documents comme ils partagent les fiches.
 */
export function getDocumentsDemandesDir(): string {
  const override = envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR");
  if (override) return path.join(path.dirname(override), "documents-demandes");
  return path.join(getProjectRoot(), "storage", "documents-demandes");
}

/**
 * (NOUVEAU Task 209 — « sécurisation du répertoire storage/tampons »)
 * Assure qu'un dossier de stockage est PRIVÉ au niveau du système de
 * fichiers : création avec mode 0700 ET chmod 0700 systématique — le chmod
 * rattrape un dossier PRÉEXISTANT trop permissif (ex. dossier recréé par
 * une restauration rsync avec umask 002 → 0755, lisible par « autres »).
 *
 * S'applique aux fiches de paie (storage/payslips), aux documents des
 * demandes (storage/documents-demandes) et aux copies de contrôle des
 * tampons/certificats (storage/tampons) : même chiffrés AES-256-GCM, ces
 * fichiers ne doivent être ni listables ni lisibles par un autre
 * utilisateur du système.
 */
export async function assurerDossierPrive(dir: string): Promise<string> {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.chmod(dir, 0o700);
  } catch {
    // système de fichiers sans permissions POSIX (ex. Windows) : sans effet
  }
  return dir;
}

/**
 * (NOUVEAU 0.2.58 — « Path : l'emplacement des tampons importés ») Dossier
 * CANONIQUE des COPIES DE CONTRÔLE des images de tampon importées
 * (signature/cachet et QR fourni) : voisin « tampons » du dossier des fiches —
 * même racine de stockage que les fiches et les documents de demandes.
 *
 * RÔLE : quand l'utilisateur importe une image de tampon dans la rubrique
 * « Signature électronique & QR code », l'image est enregistrée en base
 * (dataURL — source de vérité du rendu) ET une copie fichier y est écrite
 * pour consultation ; le chemin de cette copie est affiché dans l'interface
 * (« Emplacement : storage/tampons/… »). Le moteur de rendu ne lit JAMAIS
 * ce dossier : une copie manquante ou modifiée ne peut pas affecter le
 * tamponnage des fiches.
 */
export function getTamponsDir(): string {
  const override = envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR");
  if (override) return path.join(path.dirname(override), "tampons");
  return path.join(getProjectRoot(), "storage", "tampons");
}

/**
 * (NOUVEAU Task 122) Dossiers candidats pour la LECTURE d'un document de
 * demande — mêmes règles que les fiches (storageReadCandidates) transposées
 * au sous-dossier « documents-demandes » voisin.
 */
export function documentsDemandesReadCandidates(): string[] {
  const root = getProjectRoot();
  const cwd = process.cwd();
  const fromDb = rootFromDatabaseUrl();
  const liste = [
    envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR")
      ? path.join(path.dirname(String(envDir("AUTO_RH_STORAGE_DIR", "STORAGE_DIR"))), "documents-demandes")
      : null,
    path.join(root, "storage", "documents-demandes"),
    path.join(cwd, "storage", "documents-demandes"),
    path.join(root, ".next", "standalone", "storage", "documents-demandes"),
    path.join(cwd, ".next", "standalone", "storage", "documents-demandes"),
    fromDb ? path.join(fromDb, "storage", "documents-demandes") : null,
  ].filter(Boolean) as string[];
  return [...new Set(liste)];
}

/**
 * (NOUVEAU Task 122) Retrouve un DOCUMENT de demande stocké dans les dossiers
 * candidats. Même garde anti-traversée que resolveStoredFile : un nom stocké
 * ne contient JAMAIS de séparateur ni de « .. » (les noms sont générés par le
 * serveur : référence + horodatage + empreinte + extension).
 */
export function resolveStoredDocument(storedName: string): string | null {
  if (
    typeof storedName !== "string" ||
    storedName.length === 0 ||
    storedName.length > 255 ||
    !/^[A-Za-z0-9._-]+$/.test(storedName) ||
    storedName.includes("..")
  ) {
    return null;
  }
  for (const dir of documentsDemandesReadCandidates()) {
    try {
      const filePath = path.join(dir, storedName);
      if (fs.statSync(filePath).isFile()) return filePath;
    } catch {
      // dossier absent ou fichier absent — candidat suivant
    }
  }
  return null;
}
