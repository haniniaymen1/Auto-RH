/**
 * NOUVEAU (ajouté SANS modifier le comportement existant) : support OCR des
 * fiches de paie "image" — PDF convertis depuis PNG/JPG, documents scannés,
 * captures d'écran — qui ne contiennent AUCUN texte extractible pour
 * pdf-parse (le PDF n'est qu'une photo de la fiche).
 *
 * Principe :
 *   1. Le texte classique est extrait avec pdf-parse (inchangé) ;
 *   2. Si ce texte est (presque) vide  ->  chaque page du PDF est rendue en
 *      image (pdf.js + canvas natif) puis lue par OCR (Tesseract, français) ;
 *   3. Le texte OCR est RETOURNÉ EN PLUS du texte historique (jamais à la
 *      place) : toutes les règles de détection existantes (CIN, nom,
 *      période, net, matricule) sont appliquées À L'IDENTIQUE sur le texte
 *      fusionné. Aucune règle de détection n'est modifiée.
 *
 * Les fichiers .png / .jpg sont aussi acceptés directement à l'import
 * (voir route upload) : ils sont lus par la même OCR, sans conversion
 * préalable en PDF par l'utilisateur.
 *
 * Dépendances ajoutées : tesseract.js (OCR), pdfjs-dist (déjà présent via
 * pdf-parse, utilisé ici pour le rendu), @napi-rs/canvas (canvas natif,
 * binaire précompilé Windows/macOS/Linux).
 *
 * Données de langue : ocr-data/fra.traineddata à la racine du projet
 * (chargées EN LOCAL : l'OCR fonctionne sans connexion Internet). Si le
 * fichier est absent, Tesseract bascule sur son CDN par défaut.
 */

/** Seuil (caractères) en dessous duquel un texte PDF est considéré "vide"
 * (PDF image). 40 caractères laissent passer les files d'attente de
 * conversion ("Converted by ...") sans déclencher d'OCR inutile. */
export const OCR_TEXT_MIN = 40;

/* ------------------------------------------------------------------ */
/* Résolution du dossier des données de langue OCR                     */
/* ------------------------------------------------------------------ */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "node:module";

/**
 * Charge @napi-rs/canvas via require CJS — la MÊME instance de module que
 * celle utilisée en interne par pdf.js (NodeCanvasFactory) et que le
 * polyfill globalThis.Path2D. Un import ESM créerait une DEUXIÈME instance
 * du module natif (classes distinctes) et le rendu échouerait avec
 * "Value is none of these types `String`, `Path`".
 */
// (CORRECTIF v0.2.201 — erreurs TypeScript TS2339 "Property 'Path2D' does
// not exist on type 'never'") : `typeof napiCanvasModule` inclut `null` dans
// son type (puisque napiCanvasModule est `{ ... } | null`). Quand on écrit
// `let napi: (typeof napiCanvasModule) | null = null`, le type de `napi`
// devient `({ ... } | null) | null` — TypeScript échoue alors à RETIRER
// `null` après `napi &&` car la trace de narrowing se confond avec le type
// `null` inclus dans `typeof napiCanvasModule`.
//
// Solution : déclarer un TYPE NOMMÉ `NapiCanvasModule` (sans null), puis
// typer `napiCanvasModule: NapiCanvasModule | null` et `napi: NapiCanvasModule
// | null`. Après `napi &&`, TypeScript sait que `napi` est `NapiCanvasModule`
// (non-null) — l'accès à `napi.Path2D` fonctionne correctement.
type NapiCanvasModule = {
  createCanvas: (w: number, h: number) => unknown;
  Path2D?: unknown;
  DOMMatrix?: unknown;
  ImageData?: unknown;
};

let napiCanvasModule: NapiCanvasModule | null = null;

async function loadNapiCanvas() {
  if (napiCanvasModule) return napiCanvasModule;
  const requireCjs = createRequire(import.meta.url);
  // Instance "racine" (node_modules/@napi-rs/canvas) — comportement historique
  let napi: NapiCanvasModule | null = null;
  try {
    napi = requireCjs("@napi-rs/canvas");
  } catch {
    /* ignoré : tentative ci-dessous avec la copie de pdf.js */
  }

  // NOUVEAU (ajouté SANS modifier la logique ci-dessus) : pdfjs-dist peut
  // embarquer sa PROPRE copie "nested" de @napi-rs/canvas
  // (node_modules/pdfjs-dist/node_modules/@napi-rs/canvas). Dans ce cas :
  //   1. pdf.js installe SES classes (Path2D/DOMMatrix/ImageData) dans
  //      globalThis dès son import (bloc isNodeJS) ;
  //   2. deux copies du module natif coexistent (deux .node chargés) —
  //      les classes sont DISTINCTES et le rendu échoue avec
  //      "Value is none of these types `String`, `Path`" (InvalidArg),
  //      voire des crashs natifs du heap (free(): invalid size).
  // Correctif : si globalThis.Path2D existe déjà (posé par pdf.js) et
  // diffère de notre instance, on ADOPTER la copie résolue DEPUIS pdf.js
  // pour que canvas + Path2D partagent le même module natif.
  const g = globalThis as Record<string, unknown>;
  if (
    g.Path2D &&
    napi &&
    napi.Path2D &&
    g.Path2D !== napi.Path2D
  ) {
    try {
      const pdfjsEntry = requireCjs.resolve("pdfjs-dist/legacy/build/pdf.mjs");
      const napiPdfjs = createRequire(pdfjsEntry)(
        "@napi-rs/canvas"
      ) as NapiCanvasModule | null;
      if (napiPdfjs && napiPdfjs.Path2D === g.Path2D) napi = napiPdfjs;
    } catch {
      /* repli : copie racine (comportement historique) */
    }
  }

  if (!napi) throw new Error("Module @napi-rs/canvas introuvable");

  // Polyfills globaux avec LES MÊMES classes CJS (si pdf.js ne l'a pas déjà
  // fait) : garantit la compatibilité des Path2D/DOMMatrix avec le canvas.
  if (!g.Path2D && napi.Path2D) g.Path2D = napi.Path2D;
  if (!g.DOMMatrix && napi.DOMMatrix) g.DOMMatrix = napi.DOMMatrix;
  if (!g.ImageData && napi.ImageData) g.ImageData = napi.ImageData;
  napiCanvasModule = napi;
  return napiCanvasModule;
}

/**
 * Localise le dossier contenant fra.traineddata :
 *  1. variable d'environnement AUTO_RH_OCR_LANG_PATH (surcharge) ;
 *  2. <AUTO_RH_ROOT>/ocr-data            (fixé par scripts/start-prod.js) ;
 *  3. <cwd>/ocr-data                      (démarrage classique) ;
 *  4. <cwd>/../ocr-data                   (exécution depuis .next/standalone).
 * Retourne null si introuvable -> Tesseract utilise son CDN par défaut.
 */
function resolveOcrLangPath(): string | null {
  // (CORRECTIF v0.2.201) : `process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT`
  // est de type `string | undefined`. Si on le passe tel quel à path.join,
  // TypeScript refuse (le 1er argument doit être `string`). On extrait la
  // valeur dans une variable `string | undefined` puis on vérifie avant
  // l'appel — le comportement runtime est IDENTIQUE (path.join lèverait une
  // exception si la valeur était undefined, ce qui ne se produit jamais ici
  // car le `?` exclut ce cas).
  const root = process.env.AUTO_RH_ROOT || process.env.SERVICE_RH_ROOT;
  const candidates: (string | null)[] = [
    process.env.AUTO_RH_OCR_LANG_PATH ?? null,
    root ? path.join(root, "ocr-data") : null,
    path.join(process.cwd(), "ocr-data"),
    path.join(process.cwd(), "..", "ocr-data"),
  ];
  const filtered = candidates.filter((c): c is string => !!c);
  for (const dir of filtered) {
    try {
      if (fs.existsSync(path.join(dir, "fra.traineddata"))) return dir;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* (REFONTE Task 136) POOL OCR (Tesseract) — plusieurs workers créés   */
/* une seule fois et répartis sur les pages.                           */
/*                                                                     */
/* Pourquoi : un PDF multi-bulletins scanné de 200 pages passait ~19 s */
/* par tranche de 3 pages (OCR SÉQUENTIEL : 1 seul worker) soit plus   */
/* de 20 minutes pour l'import complet. Le pool (1 worker par cœur,    */
/* borné 1..4) divise le temps OCR par le nombre de cœurs disponibles. */
/* Chaque worker traite ses pages en CHAÎNE (jamais 2 recognize en     */
/* parallèle sur le même worker) ; la répartition choisit le worker    */
/* le moins chargé. Un worker qui échoue 3 fois de suite est remplacé  */
/* (recréé) sans interrompre les autres.                               */
/* ------------------------------------------------------------------ */

type TesseractWorker = {
  recognize: (image: Buffer | Uint8Array | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

import os from "os";

/** Modes de segmentation utilisés par les deux passes OCR. */
type Psm = "3" | "4";

/** Taille du pool : 1 worker par cœur CPU, borné à 1..4 (mémoire). */
function taillePoolOcr(): number {
  try {
    return Math.max(1, Math.min(4, (os.cpus() || []).length || 1));
  } catch {
    return 1;
  }
}

async function createOcrWorker(psm: Psm): Promise<TesseractWorker> {
  const { createWorker } = await import("tesseract.js");
  const langPath = resolveOcrLangPath();
  const worker = await createWorker("fra", 1, {
    // Données de langue LOCALES (ocr-data/fra.traineddata) -> fonctionne
    // hors-ligne. gzip: false = fichier non compressé sur disque.
    ...(langPath ? { langPath, gzip: false } : {}),
    logger: () => undefined, // silence (sinon spam de progression)
    errorHandler: (e: unknown) =>
      console.error("[OCR] erreur Tesseract (PSM" + psm + "):", e),
  });
  // Conserve les espacements entre colonnes (utile pour les fiches en
  // tableau : "Période de Paie    Date de Paiement").
  // PSM explicite : 3 (segmentation automatique) pour la passe standard,
  // 4 (« colonne unique de tailles variables ») pour la passe haute
  // lisibilité — voir les commentaires historiques ci-dessous.
  await worker.setParameters?.({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: psm as unknown as Parameters<
      typeof worker.setParameters
    >[0]["tessedit_pageseg_mode"],
  });
  return worker as unknown as TesseractWorker;
}

/** Pool par mode PSM : workers créés une seule fois. */
type PoolOcr = {
  workers: Promise<TesseractWorker[]>;
};
const pools = new Map<Psm, PoolOcr>();

async function getOcrPool(psm: Psm): Promise<TesseractWorker[]> {
  let pool = pools.get(psm);
  if (!pool) {
    pool = {
      workers: (async () => {
        const n = taillePoolOcr();
        const workers: TesseractWorker[] = [];
        const erreurs: unknown[] = [];
        for (let i = 0; i < n; i++) {
          try {
            workers.push(await createOcrWorker(psm));
          } catch (e) {
            erreurs.push(e);
          }
        }
        if (workers.length === 0) throw erreurs[0] ?? new Error("Aucun worker OCR");
        return workers;
      })().catch((e) => {
        pools.delete(psm); // permet un nouvel essai au prochain appel
        throw e;
      }),
    };
    pools.set(psm, pool);
  }
  return pool.workers;
}

/** Charge (tâches en attente) et chaîne (dernière tâche) par worker. */
const chargeWorker = new Map<TesseractWorker, number>();
const chainesWorker = new Map<TesseractWorker, Promise<unknown>>();
const echecsConsecutifs = new Map<TesseractWorker, number>();

/**
 * (NOUVEAU Task 136) Gare de « backpressure » : le rendu des pages ne doit
 * pas devancer l'OCR de plus de quelques images, sinon les PNG en attente
 * s'accumulent en mémoire (200 pages × ~2 Mo = 400 Mo dans la passe
 * hi-res). Le producteur (rendu pdf.js) se met en pause tant que le nombre
 * de tâches OCR en vol dépasse la capacité de la gare.
 */
function creerGare(capacite: number) {
  let enVol = 0;
  const attente: Array<() => void> = [];
  return {
    async acquerir() {
      if (enVol < capacite) {
        enVol++;
        return;
      }
      await new Promise<void>((r) => attente.push(r));
      enVol++;
    },
    liberer() {
      enVol = Math.max(0, enVol - 1);
      const suivant = attente.shift();
      if (suivant) suivant();
    },
  };
}

/**
 * Exécute une tâche OCR sur le worker le MOINS CHARGÉ du pool. Les tâches
 * d'un même worker sont chaînées (jamais 2 recognize simultanés sur un
 * worker). Une tâche en échec retourne undefined (l'appelant décide du
 * repli) ; 3 échecs consécutifs du même worker -> il est remplacé.
 */
async function surPoolOcr<T>(
  psm: Psm,
  tache: (w: TesseractWorker) => Promise<T>
): Promise<T | undefined> {
  let workers: TesseractWorker[];
  try {
    workers = await getOcrPool(psm);
  } catch {
    return undefined;
  }
  // worker le moins chargé
  let choisi = workers[0];
  let min = chargeWorker.get(choisi) ?? 0;
  for (const w of workers) {
    const c = chargeWorker.get(w) ?? 0;
    if (c < min) {
      min = c;
      choisi = w;
    }
  }
  chargeWorker.set(choisi, min + 1);
  const chaines = chainesWorker;
  const fin = (chaines.get(choisi) ?? Promise.resolve())
    .then(() => tache(choisi))
    .catch(() => {
      // échec de CETTE tâche : compte les échecs consécutifs du worker
      const n = (echecsConsecutifs.get(choisi) ?? 0) + 1;
      echecsConsecutifs.set(choisi, n);
      if (n >= 3) {
        // worker défaillant : remplacement asynchrone (les tâches déjà
        // chaînées dessus échoueront puis le nouveau prendra la suite)
        echecsConsecutifs.set(choisi, 0);
        const mort = choisi;
        void (async () => {
          try {
            await mort.terminate?.();
          } catch {
            /* ignorer */
          }
          try {
            const nouveau = await createOcrWorker(psm);
            const ws = await getOcrPool(psm);
            const idx = ws.indexOf(mort);
            if (idx >= 0) ws[idx] = nouveau;
          } catch {
            /* le pool garde le worker mort : les tâches retournent undefined */
          }
        })();
      }
      return undefined as unknown as T;
    })
    .finally(() => {
      chargeWorker.set(choisi, Math.max(0, (chargeWorker.get(choisi) ?? 1) - 1));
    });
  chaines.set(choisi, fin.catch(() => undefined));
  return fin;
}

/** OCR d'une image PNG ou JPEG (buffer) -> texte brut. */
export async function ocrImageBuffer(image: Buffer): Promise<string> {
  const res = await surPoolOcr("3", async (w) => {
    const { data } = await w.recognize(image);
    return (data?.text || "").replace(/\r/g, "").trim();
  });
  return res ?? "";
}

/* ------------------------------------------------------------------ */
/* Rendu des pages PDF en images (pdf.js + @napi-rs/canvas)            */
/* ------------------------------------------------------------------ */

/**
 * Rend chaque page du PDF en PNG (échelle adaptée à l'OCR, ~200 dpi).
 * Exporté pour les tests et réutilisable tel quel.
 * (Task 136) Implémenté au-dessus de renderPdfPagesStream — comportement
 * identique (1 buffer PNG par page, même ordre).
 */
export async function renderPdfPagesToPng(buffer: Buffer): Promise<Buffer[]> {
  const out: Buffer[] = [];
  await renderPdfPagesStream(buffer, async (png) => {
    out.push(png);
  });
  return out;
}

/**
 * (NOUVEAU Task 136) Rendu EN FLUX : chaque page rendue est passée au
 * callback AU FUR ET À MESURE puis libérée — le tableau complet des images
 * n'est plus jamais détenu en mémoire (un PDF scanné de 200 pages produisait
 * ~200-400 Mo de PNG simultanés). La fonction interne est partagée par la
 * passe standard et la passe haute lisibilité.
 */
async function renderPdfPagesStream(
  buffer: Buffer,
  surPage: (png: Buffer, indexPage: number) => Promise<void> | void
): Promise<void> {
  // Copie du buffer : pdf.js peut détacher (transfer) l'ArrayBuffer fourni ;
  // l'original doit rester intact pour la suite (stockage du fichier…).
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = (await loadNapiCanvas()) as {
    createCanvas: (w: number, h: number) => any;
  };

  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // Échelle adaptative : largeur rendue ~1800 px (bornée 1.5x - 4x)
      const scale = Math.min(4, Math.max(1.5, 1800 / (base.width || 595)));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );
      const ctx = canvas.getContext("2d");
      // Fond blanc : les PDF images n'ont pas toujours de fond défini
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        // (CORRECTIF v0.2.201) : la directive @ts-expect-error a été supprimée
        // car le paramètre `canvas` est désormais accepté par le type de
        // pdf.js v5 (RenderParameters). Si une version future de pdf.js le
        // retire à nouveau, ajouter `// @ts-expect-error` au-dessus.
        canvas,
      }).promise;
      const png = await canvas.encode("png");
      page.cleanup();
      await surPage(Buffer.from(png), i);
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* OCR d'un PDF complet, page par page                                 */
/* ------------------------------------------------------------------ */

/** Cache OCR (même process) : évite de refaire le rendu + OCR du même
 * fichier quand la route upload analyse d'abord le PDF entier puis
 * analysé page par page. Clé = empreinte SHA-1 du buffer. */
const ocrCache = new Map<string, string[]>();
const OCR_CACHE_MAX = 60;

/**
 * OCR de TOUTES les pages d'un PDF -> tableau de textes (1 entrée par page,
 * même ordre). Les résultats sont mis en cache pour la durée du process.
 * Lève une exception si le rendu échoue (l'appelant garde alors le
 * comportement historique).
 * (REFONTE Task 136) : rendu EN FLUX (l'image d'une page n'est plus détenue
 * au-delà de sa soumission à l'OCR) + OCR en PARALLÈLE sur le pool de
 * workers. La déduplication par page est conservée (copies identiques : un
 * seul OCR pour N pages) ainsi que la sémantique d'échec (page échouée =
 * texte vide, mémorisé).
 */
export async function ocrPdfPages(buffer: Buffer): Promise<string[]> {
  const key = crypto.createHash("sha1").update(buffer).digest("hex");
  const cached = ocrCache.get(key);
  if (cached) return cached;

  // (CORRECTIF Task 101) Déduplication PAR PAGE : un PDF de N copies de la
  // même fiche (ex. copies_150_one_pdf — 150 pages identiques) produit N
  // images RENDUES identiques — l'OCR de chaque page unique n'est exécuté
  // QU'UNE SEULE FOIS puis son texte est répliqué sur les copies. Les
  // promesses OCR sont partagées par empreinte SHA-1 de l'image rendue.
  const pageTextCache = new Map<string, Promise<string | undefined>>(); // sha1(png) -> texte OCR
  const hashImage = (img: Buffer) =>
    crypto.createHash("sha1").update(img).digest("hex");
  const pagePromises: Promise<string | undefined>[] = [];
  // gare bornée : ~4 images par worker du pool PSM 3 (le PNG d'une page est
  // libéré dès que son OCR est terminé)
  const gare = creerGare(Math.max(4, taillePoolOcr() * 4));

  await renderPdfPagesStream(buffer, async (img) => {
    const h = hashImage(img);
    let t = pageTextCache.get(h);
    if (!t) {
      await gare.acquerir();
      t = surPoolOcr("3", async (w) => {
        const { data } = await w.recognize(img);
        return (data?.text || "").replace(/\r/g, "").trim();
      }).finally(() => gare.liberer());
      pageTextCache.set(h, t);
    }
    pagePromises.push(t);
  });

  const texts = (await Promise.all(pagePromises)).map((t) => t ?? "");

  if (ocrCache.size >= OCR_CACHE_MAX) {
    // FIFO simple : supprime la première entrée
    const first = ocrCache.keys().next().value;
    if (first !== undefined) ocrCache.delete(first);
  }
  ocrCache.set(key, texts);
  return texts;
}

/** (REFONTE Task 136) Libère TOUS les workers OCR des deux pools
 * (optionnel, pour les tests). */
export async function terminateOcrWorker(): Promise<void> {
  for (const psm of ["3", "4"] as const) {
    const pool = pools.get(psm);
    if (!pool) continue;
    pools.delete(psm);
    try {
      const workers = await pool.workers;
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    } catch {
      /* pool jamais créé — rien à libérer */
    }
  }
  chargeWorker.clear();
  chainesWorker.clear();
  echecsConsecutifs.clear();
}

/* ------------------------------------------------------------------ */
/* NOUVEAU (ajouté SANS modifier les fonctions historiques ci-dessus) : */
/* passe OCR « haute lisibilité » pour les zones de tableau que le mode */
/* par défaut lit mal (l'OCR retourne du texte sans rapport, ex.        */
/* "PEN / ONE CECI SEE" à la place du bloc MATRICULE / NOM / CIN).      */
/* Deux leviers combinés :                                              */
/*   1. image AGRANDIE 2x (lanczos via @napi-rs/canvas, déjà présent) ; */
/*   2. segmentation PSM 4 (« colonne unique de tailles variables »),   */
/*      bien plus fiable que l'auto sur les fiches en tableau.          */
/* ------------------------------------------------------------------ */

/** (REFONTE Task 136) Le mode PSM 4 passe par le MÊME pool que la passe
 * standard (un pool séparé par mode PSM, workers créés une seule fois). */

/** OCR d'une image PNG/JPEG (buffer) en mode PSM 4 -> texte brut. */
export async function ocrImageBufferPsm4(image: Buffer): Promise<string> {
  const res = await surPoolOcr("4", async (w) => {
    const { data } = await w.recognize(image);
    return (data?.text || "").replace(/\r/g, "").trim();
  });
  return res ?? "";
}

/** Largeur cible max après agrandissement (limite mémoire canvas). */
const UPSCALE_MAX_WIDTH = 2800;

/**
 * Agrandit une image PNG/JPEG (x2, plafonné à UPSCALE_MAX_WIDTH de large)
 * avec fond blanc — prétraitement avant l'OCR haute lisibilité.
 * Retourne l'image D'ORIGINE si l'agrandissement échoue.
 */
export async function upscaleImageBuffer2x(image: Buffer): Promise<Buffer> {
  try {
    const canvasModule = (await loadNapiCanvas()) as {
      createCanvas: (w: number, h: number) => any;
      loadImage?: (src: Buffer) => Promise<{
        width: number;
        height: number;
      }> & { width: number; height: number };
    };
    const loadImage = (canvasModule as unknown as {
      loadImage: (src: Buffer) => Promise<any>;
    }).loadImage;
    if (!loadImage) return image;
    const img = await loadImage(image);
    const factor = Math.min(2, UPSCALE_MAX_WIDTH / (img.width || 1));
    if (!(factor > 1.05)) return image; // déjà assez grande
    const w = Math.round(img.width * factor);
    const h = Math.round(img.height * factor);
    const canvas = canvasModule.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return Buffer.from(await canvas.encode("png"));
  } catch (e) {
    console.error("[OCR] agrandissement 2x impossible:", e);
    return image;
  }
}

/** Cache OCR « haute lisibilité » (même process) : la route d'import lance
 * la passe hi-res via analyzePayslip PUIS via analyzePayslipPages pour le
 * MÊME fichier — sans cache, la passe (coûteuse : rendu + agrandissement 2x
 * + OCR PSM 4) était exécutée DEUX fois, et une fois de plus pour chaque
 * entrée identique d'un ZIP (ex. copies_150.zip : 150 PDF identiques).
 * Clé = empreinte SHA-1 du buffer. (CORRECTIF Task 101) */
const ocrHiResCache = new Map<string, string[]>();
const OCR_HIRES_CACHE_MAX = 40;

/**
 * OCR « haute lisibilité » de TOUTES les pages d'un PDF (rendu normal ->
 * agrandissement 2x -> OCR PSM 4). Retourne 1 texte par page (même ordre),
 * avec cache process (voir ocrHiResCache) et déduplication PAR PAGE (les
 * pages rendues identiques ne passent qu'une fois dans le pipeline
 * agrandissement + OCR — CORRECTIF Task 101).
 * (REFONTE Task 136) : rendu EN FLUX + OCR en parallèle sur le pool PSM 4
 * (mêmes principes que ocrPdfPages). L'agrandissement 2x reste séquentiel
 * (il partage le canvas natif avec le rendu) et ne retient qu'une image à
 * la fois.
 */
export async function ocrPdfPagesHighRes(buffer: Buffer): Promise<string[]> {
  const key = crypto.createHash("sha1").update(buffer).digest("hex");
  const cached = ocrHiResCache.get(key);
  if (cached) return cached;

  const pageTextCache = new Map<string, Promise<string | undefined>>(); // sha1(png) -> texte OCR
  const hashImage = (img: Buffer) =>
    crypto.createHash("sha1").update(img).digest("hex");
  const pagePromises: Promise<string | undefined>[] = [];
  // gare bornée (voir creerGare) : l'image ORIGINALE et l'agrandie 2x sont
  // retenues par tâche — capacité réduite en conséquence
  const gare = creerGare(Math.max(3, taillePoolOcr() * 3));

  await renderPdfPagesStream(buffer, async (img) => {
    const h = hashImage(img);
    let t = pageTextCache.get(h);
    if (!t) {
      await gare.acquerir();
      t = (async () => {
        const up = await upscaleImageBuffer2x(img);
        return surPoolOcr("4", async (w) => {
          const { data } = await w.recognize(up);
          return (data?.text || "").replace(/\r/g, "").trim();
        });
      })().finally(() => gare.liberer());
      pageTextCache.set(h, t);
    }
    pagePromises.push(t);
  });

  const texts = (await Promise.all(pagePromises)).map((t) => t ?? "");

  if (ocrHiResCache.size >= OCR_HIRES_CACHE_MAX) {
    const first = ocrHiResCache.keys().next().value;
    if (first !== undefined) ocrHiResCache.delete(first);
  }
  ocrHiResCache.set(key, texts);
  return texts;
}
