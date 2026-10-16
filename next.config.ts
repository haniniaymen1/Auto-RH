import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // (NOUVEAU 0.2.168 — « Couldn't find any pages or app directory » chez un
  // utilisateur) Next.js 16 (Turbopack) déduit tout seul la « racine du
  // workspace » en cherchant des lockfiles/node_modules dans les dossiers
  // PARENTS (avertissement « We detected multiple lockfiles… »). Si le ZIP est
  // extrait sous un dossier contenant lui-même un package-lock.json ou
  // node_modules (ancienne installation, autre projet…), Next peut choisir
  // CE parent comme racine et se comporter de façon imprévisible. On FIXE la
  // racine au dossier du projet : les lanceurs (DEMARRER-WINDOWS.bat,
  // PREPARER-AUTO-RH-SILENCIEUX.bat, redemarrer-services, scripts Linux)
  // exécutent toujours « next build » avec le dossier du projet comme
  // répertoire courant, donc process.cwd() est la racine correcte.
  turbopack: {
    root: process.cwd(),
  },
  // (NOUVEAU Task 209 — « sécurisation storage/tampons ») Le suivi de
  // fichiers du build standalone recopiait AUTOMATIQUEMENT les dossiers de
  // DONNÉES référencés par des littéraux de chemins (node file tracing) :
  // storage/ (fiches, documents des demandes, tampons/certificats chiffrés),
  // db/ (base SQLite), logs/ (journaux de sécurité) et backups/ (archives)
  // se retrouvaient DOUBLÉS sous .next/standalone/ — doublons inutiles au
  // runtime (le serveur lit ces dossiers via AUTO_RH_ROOT / DATABASE_URL
  // qui pointent vers la RACINE du projet, jamais via le répertoire
  // standalone) et surface d'exposition superflue sur le disque. Exclusion
  // explicite : le build ne recopie plus aucune donnée ni aucun secret.
  outputFileTracingExcludes: {
    "*": [
      "storage/**/*",
      "db/**/*",
      "logs/**/*",
      "backups/**/*",
      ".env",
      ".env.*",
    ],
  },
  // (CORRECTIF IMPORT — Task 101) Next.js 16.3 plafonne à 10 Mo le corps des
  // requêtes couvertes par le middleware (« experimental.proxyClientMaxBodySize »,
  // défaut 10 485 760 octets — nouveau comportement apparu avec la mise à jour
  // next 16.1.3 -> 16.3.5 du package-lock). Concrètement : au-delà de 10 Mo, le
  // corps est TRONQUÉ côté serveur (voir body-streams.js « Request body exceeded
  // 10MB… ») et request.formData() échoue dans /api/payslips/upload — d'où
  // l'erreur « Requête invalide : envoyez un formulaire multipart contenant des
  // fichiers PDF. » constatée sur les gros fichiers (ex. ZIP de 13 Mo, PDF de
  // 23 Mo). 500 Mo rétablit les imports volumineux (fichiers « lourds » envoyés
  // un par un par l'interface) tout en conservant un garde-fou mémoire
  // raisonnable. La route d'import refuse au-delà avec un message explicite.
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
  // pdf-parse doit rester externe (pas de bundling de pdf.js côté serveur)
  // NOUVEAU (ajouté sans retirer pdf-parse) : paquets OCR — tesseract.js
  // charge son worker + wasm au runtime (doit rester externe) ;
  // @napi-rs/canvas contient un binaire natif (non bundleable).
  // NOUVEAU (ajouté sans retirer les précédents) : paquets ZIP / Excel /
  // Word — mammoth et xlsx chargent des ressources au runtime.
  // NOUVEAU (0.2.48) : sharp (binaire natif — tampon des fiches IMAGE et
  // surfaces PNG des DOCX/XLSX) et jszip (archive DOCX/XLSX) restent
  // externes, chargés depuis node_modules au runtime.
  serverExternalPackages: [
    "pdf-parse",
    "tesseract.js",
    "@napi-rs/canvas",
    "mammoth",
    "xlsx",
    "fflate",
    "sharp",
    "jszip",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // (CORRECTIF SÉCURITÉ — Task 94, ajusté Task 98) en-têtes HTTP de sécurité
  // pour TOUTES les routes : anti-clickjacking, anti-sniffing, pas de fuite
  // de référent. (La politique de même origine du portail est gérée par ses
  // propres en-têtes dans scripts/portail-server.js.)
  //
  // (CORRECTIF VISIONNEUSE — Task 98) X-Frame-Options passe de « DENY » à
  // « SAMEORIGIN » : « DENY » interdisait l'affichage d'une URL dans une
  // iframe MÊME EN MÊME ORIGINE — la visionneuse de l'administration
  // (src/components/payslip/pdf-dialog.tsx) affiche le PDF de la fiche dans
  // une <iframe src="/api/payslips/[id]/file"> de même origine : le
  // navigateur la bloquait donc silencieusement (cadre vide). Avec
  // « SAMEORIGIN » la visionneuse fonctionne à nouveau exactement comme dans
  // les versions précédentes, ET l'anti-clickjacking est PRÉSERVÉ : un site
  // externe ne peut toujours pas embarquer ni les pages ni les fichiers de
  // l'application dans une iframe.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // (NOUVEAU Task 208 — durcissement recommandé par l'audit sécurité)
          // HSTS : ignoré en HTTP local, actif dès que l'application est
          // servie derrière un proxy HTTPS — impose HTTPS pendant 2 ans.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // CSP : 'unsafe-inline'+'unsafe-eval' requis par le bootstrap Next.js
          // et les styles inline de l'interface ; data: pour les images de
          // signature/cachet (dataURL) ; blob: pour les aperçus PDF.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
              "font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; " +
              "object-src 'self'; base-uri 'self'; form-action 'self'; " +
              "frame-ancestors 'self'",
          },
          // Réduction de surface : l'application n'utilise ni caméra, ni
          // micro, ni géolocalisation.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
