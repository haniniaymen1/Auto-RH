/**
 * Copie cross-platform des ressources statiques dans le build standalone Next.js.
 * Remplace "cp -r" (Linux/Mac) / "xcopy" (Windows) qui ne sont pas portables.
 *
 * Après `next build` (output: "standalone"), il faut copier :
 *   .next/static  ->  .next/standalone/.next/static
 *   public        ->  .next/standalone/public
 *   .env          ->  .next/standalone/.env   (pour que Prisma trouve DATABASE_URL au runtime)
 *
 * Fonctionne avec Node.js et Bun, sur Windows / macOS / Linux.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

/**
 * Complète pdfjs-dist dans le build standalone.
 * pdf-parse charge le worker de pdf.js dynamiquement ("fake worker") :
 * pdf.worker.mjs n'est pas tracé par Next.js et doit être copié à la main.
 * On ajoute aussi standard_fonts/ et cmaps/ (utile pour les PDF dont les
 * polices ne sont pas embarquées, fréquent sur les exports administratifs).
 */
function copyPdfJsAssets() {
  // Localise pdfjs-dist (hoisté à la racine, ou imbriqué sous pdf-parse)
  const candidates = [
    path.join(ROOT, "node_modules", "pdfjs-dist"),
    path.join(ROOT, "node_modules", "pdf-parse", "node_modules", "pdfjs-dist"),
  ];
  const srcPkg = candidates.find((c) =>
    fs.existsSync(path.join(c, "package.json"))
  );
  if (!srcPkg) {
    console.warn(
      "[AVERTISSEMENT] pdfjs-dist introuvable dans node_modules — ignore."
    );
    return;
  }

  // Reconstruit le même chemin relatif sous node_modules du standalone
  const marker = `${path.sep}node_modules${path.sep}`;
  const rel = srcPkg.includes(marker)
    ? srcPkg.slice(srcPkg.lastIndexOf(marker) + marker.length)
    : "pdfjs-dist";
  const destPkg = path.join(STANDALONE, "node_modules", rel);

  fs.mkdirSync(destPkg, { recursive: true });
  copyFileIfExists(path.join(srcPkg, "package.json"), path.join(destPkg, "package.json"));

  // Fichiers du worker (build legacy + build standard)
  for (const buildDir of ["legacy/build", "build"]) {
    const srcBuild = path.join(srcPkg, ...buildDir.split("/"));
    if (!fs.existsSync(srcBuild)) continue;
    const destBuild = path.join(destPkg, ...buildDir.split("/"));
    fs.mkdirSync(destBuild, { recursive: true });
    for (const f of fs.readdirSync(srcBuild)) {
      if (f === "pdf.worker.mjs" || f === "pdf.worker.min.mjs" || f === "pdf.worker.js" || f === "pdf.worker.min.js") {
        fs.copyFileSync(path.join(srcBuild, f), path.join(destBuild, f));
      }
    }
  }
  console.log(`[OK] Worker pdf.js copié -> ${path.relative(ROOT, destPkg)}`);

  // Polices standard + cmaps (dossiers entiers, fusion silencieuse)
  for (const sub of ["standard_fonts", "cmaps"]) {
    const s = path.join(srcPkg, sub);
    if (fs.existsSync(s)) {
      fs.cpSync(s, path.join(destPkg, sub), { recursive: true, force: true });
    }
  }
  console.log("[OK] Polices standard + cmaps pdf.js copies.");
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log(`[OK] ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
}

function copyFileIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[OK] ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
  }
}

/**
 * NOUVEAU (ajouté SANS modifier les étapes précédentes) : ressources OCR
 * pour la lecture des fiches "image" (PNG -> PDF, scans) :
 *   - node_modules/tesseract.js        (worker + script du worker Node)
 *   - node_modules/tesseract.js-core   (moteur WASM chargé au runtime)
 *   - node_modules/@napi-rs/canvas*    (canvas natif pour le rendu PDF)
 *   - ocr-data/                        (fra.traineddata, langue française)
 * Ces paquets sont chargés dynamiquement au runtime : le traceur de Next.js
 * ne les copie pas seul dans le standalone.
 */
function copyOcrAssets() {
  const nm = path.join(ROOT, "node_modules");
  const destNm = path.join(STANDALONE, "node_modules");

  // 1) Paquets JS/WASM chargés dynamiquement
  for (const pkg of ["tesseract.js", "tesseract.js-core"]) {
    const src = path.join(nm, pkg);
    if (fs.existsSync(path.join(src, "package.json"))) {
      copyDir(src, path.join(destNm, pkg));
    } else {
      console.warn(`[AVERTISSEMENT] ${pkg} introuvable — OCR dégradé.`);
    }
  }

  // 2) Canvas natif (@napi-rs/canvas + variante plateforme installée)
  const napiDir = path.join(nm, "@napi-rs");
  if (fs.existsSync(napiDir)) {
    for (const entry of fs.readdirSync(napiDir)) {
      if (entry.startsWith("canvas")) {
        copyDir(
          path.join(napiDir, entry),
          path.join(destNm, "@napi-rs", entry)
        );
      }
    }
  } else {
    console.warn("[AVERTISSEMENT] @napi-rs/canvas introuvable — OCR dégradé.");
  }

  // 3) Données de langue française (ocr-data/fra.traineddata)
  const langSrc = path.join(ROOT, "ocr-data");
  if (fs.existsSync(path.join(langSrc, "fra.traineddata"))) {
    copyDir(langSrc, path.join(STANDALONE, "ocr-data"));
  } else {
    console.warn(
      "[AVERTISSEMENT] ocr-data/fra.traineddata introuvable — l'OCR utilisera le CDN (connexion requise)."
    );
  }
  console.log("[OK] Ressources OCR copiees.");
}

/**
 * NOUVEAU (Task 180, porté v0.2.87) — MATÉRIALISATION DES ALIAS D'EXTERNES (sharp, jszip…).
 *
 * Next.js 16 externalise certains paquets serveur sous un NOM ALIASÉ haché
 * (ex. « sharp-20c6a5da84e2135f », « jszip-974cf2cd4626bd20 ») : les chunks
 * compilés font require("<alias>") au runtime. Le traceur copie le paquet
 * RÉEL (node_modules/sharp) dans le standalone mais PAS le répertoire d'alias
 * → require("sharp-<hash>") échoue silencieusement → « [TAMPON] sharp
 * indisponible » : les fiches IMAGE/PNG/JPG et les DOCX/XLSX étaient servies
 * SANS tampon signature/QR côté site (le portail employé, Node pur, n'est
 * pas concerné).
 *
 * Correctif : balayer les chunks de .next/server pour recenser les alias
 * « <nom>-<16 hex> », puis créer pour chacun dans standalone/node_modules un
 * mini-paquet (package.json « main » relatif vers l'entrée du paquet réel).
 * Portable Windows/Linux/macOS (pas de symlink), idempotent, ré-exécuté à
 * chaque build.
 */
function materialiserAliasExternes() {
  const serverDir = path.join(ROOT, ".next", "server");
  if (!fs.existsSync(serverDir)) return;
  const reAlias = /["']([A-Za-z0-9@/._-]+)-([0-9a-f]{16})["']/g;
  const aliasNoms = new Set();
  const parcourir = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) parcourir(p);
      else if (ent.name.endsWith(".js")) {
        let contenu;
        try {
          contenu = fs.readFileSync(p, "utf8");
        } catch {
          continue;
        }
        let m;
        while ((m = reAlias.exec(contenu))) {
          // l'alias COMPLET = nom + «-» + hachage (ex. sharp-20c6a5da84e2135f)
          aliasNoms.add(m[1] + "-" + m[2]);
        }
      }
    }
  };
  parcourir(serverDir);

  const nmReel = path.join(ROOT, "node_modules");
  const nmStandalone = path.join(STANDALONE, "node_modules");
  const materialises = [];
  const reelsTouches = new Set();
  for (const alias of aliasNoms) {
    const reel = alias.replace(/-[0-9a-f]{16}$/, "");
    if (!reel || reel === alias) continue;
    const pkgReelPath = path.join(nmReel, reel, "package.json");
    if (!fs.existsSync(pkgReelPath)) continue; // pas un paquet réel : faux positif
    let pkgReel;
    try {
      pkgReel = JSON.parse(fs.readFileSync(pkgReelPath, "utf8"));
    } catch {
      continue;
    }
    const entree = String(pkgReel.main || "index.js");
    const dirAlias = path.join(nmStandalone, alias);
    fs.mkdirSync(dirAlias, { recursive: true });
    // « main » RELATIF au dossier de l'alias : ../<paquet>/<entrée>
    const mainRelatif = ("../" + reel + "/" + entree).replace(/\\+/g, "/");
    fs.writeFileSync(
      path.join(dirAlias, "package.json"),
      JSON.stringify(
        { name: alias, version: String(pkgReel.version || "0.0.0"), main: mainRelatif },
        null,
        2
      )
    );
    materialises.push(alias);
    reelsTouches.add(reel);
  }
  if (materialises.length) {
    console.log(
      `[OK] Alias d'externes matérialisés dans standalone/node_modules : ${materialises.join(", ")}`
    );
  } else {
    console.log("[OK] Aucun alias d'externe à matérialiser (ou déjà absent des chunks).");
  }

  // ---- COMPLÉTION DES PAQUETS RÉELS ----
  // Le traceur de Next copie les paquets externes mais OMET leurs fichiers
  // natifs/binaires chargés dynamiquement (ex. @img/sharp-libvips-linux-x64
  // réduit à son index.js — 20 Ko au lieu de 18 Mo → ERR_DLOPEN libvips-cpp).
  // On RÉ-COPIE intégralement chaque paquet réel concerné depuis
  // node_modules/, ainsi que les dépendances de plateforme @img/* de sharp.
  for (const reel of reelsTouches) {
    const src = path.join(nmReel, reel);
    const dest = path.join(nmStandalone, reel);
    try {
      fs.cpSync(src, dest, { recursive: true, force: true });
      console.log(`[OK] Paquet externe complété : ${reel} (copie complète)`);
    } catch (e) {
      console.warn(`[AVERTISSEMENT] complétion ${reel} impossible :`, e.message);
    }
    if (reel === "sharp") {
      // dépendances de plateforme natives de sharp (chargées par son index)
      const imgSrc = path.join(nmReel, "@img");
      if (fs.existsSync(imgSrc)) {
        for (const ent of fs.readdirSync(imgSrc)) {
          try {
            fs.cpSync(path.join(imgSrc, ent), path.join(nmStandalone, "@img", ent), {
              recursive: true,
              force: true,
            });
          } catch {
            /* jamais bloquant */
          }
        }
        console.log("[OK] Dépendances natives @img/* de sharp complétées.");
      }
    }
  }
}

try {
  if (!fs.existsSync(STANDALONE)) {
    console.error(
      "[ERREUR] Le dossier .next/standalone est introuvable. Lancez d'abord : next build"
    );
    process.exit(1);
  }

  // 1) Fichiers statiques du client (JS/CSS)
  const staticSrc = path.join(ROOT, ".next", "static");
  const staticDest = path.join(STANDALONE, ".next", "static");
  if (fs.existsSync(staticSrc)) copyDir(staticSrc, staticDest);
  else console.warn("[AVERTISSEMENT] .next/static introuvable");

  // 2) Dossier public (logo, robots.txt, ...)
  const publicSrc = path.join(ROOT, "public");
  const publicDest = path.join(STANDALONE, "public");
  if (fs.existsSync(publicSrc)) copyDir(publicSrc, publicDest);
  else console.warn("[AVERTISSEMENT] dossier public/ introuvable");

  // 3) .env pour le runtime standalone (Prisma lit DATABASE_URL au démarrage)
  copyFileIfExists(path.join(ROOT, ".env"), path.join(STANDALONE, ".env"));

  // 4) pdfjs-dist (moteur PDF utilisé par pdf-parse) : son worker est chargé
  //    dynamiquement au runtime, le traceur de Next.js ne le copie pas seul.
  //    Sans cette étape, l'import de PDF échoue en production avec
  //    "Setting up fake worker failed".
  copyPdfJsAssets();

  // 5) NOUVEAU : ressources OCR (tesseract.js, canvas natif, langue
  //    française) pour la lecture des fiches image (PNG -> PDF, scans).
  copyOcrAssets();

  // 5-bis) NOUVEAU (Task 180, porté v0.2.87) : matérialisation des alias
  //  d'externes (sharp-<hash>, jszip-<hash>…) — SANS CELA, le tampon
  //  signature/QR disparaît silencieusement des fiches servies.
  materialiserAliasExternes();

  // 6) (NOUVEAU 0.2.52) MARQUEUR DE VERSION : la version de package.json est
  //    écrite dans .next/standalone/.auto-rh-version après CHAQUE build. Les
  //    scripts de démarrage (PREPARER-AUTO-RH-SILENCIEUX.bat, DEMARRER-*.bat,
  //    *.sh) comparent cette marque à package.json : si elle diffère (nouvelle
  //    version extraite par-dessus une installation existante), le build est
  //    RELANCÉ. Correctif du bug « QR/signature absents sur PNG/DOCX/XLSX +
  //    décalages non appliqués » : l'ancien test « server.js existe → pas de
  //    build » laissait tourner un build PÉRIMÉ (moteurs 0.2.48+ absents).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    fs.writeFileSync(path.join(STANDALONE, ".auto-rh-version"), String(pkg.version ?? "0") + "\n", "utf8");
  } catch (e) {
    console.warn("[AVERTISSEMENT] marqueur de version non écrit :", e.message);
  }

  console.log("[DONE] Ressources standalone pretes.");
} catch (err) {
  console.error("[ERREUR] Copie des ressources standalone :", err);
  process.exit(1);
}
