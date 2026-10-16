#!/usr/bin/env node
/**
 * verifier-modules-natifs.js — (NOUVEAU 0.2.53, Task 132)
 *
 * Vérification NON BLOQUANTE des modules à binaire natif après `npm install`.
 *
 * CONTEXTE : les npm récents (fin 2025+) peuvent BLOQUER les scripts de
 * cycle de vie des dépendances par défaut et afficher :
 *   « npm warn install scripts run `npm install scripts is` to review,
 *     or `npm install scripts approve <pkg>` to allow. »
 * Pour notre pile, l'impact est en principe nul (sharp 0.35 utilise des
 * paquets de plateforme optionnels, prisma télécharge ses moteurs à la
 * demande — le `db push` du lanceur le prouve). Ce garde-fou vérifie le
 * seul module dont une panne dégraderait réellement le site (le tampon
 * PNG) et AFFICHE un remède clair dans le journal, sans jamais arrêter
 * l'installation (exit 0 dans tous les cas).
 *
 * ⚠ volontairement SANS auto-réparation : `npm install scripts approve …`
 * n'existe que sur les npm très récents et serait interprété par les npm
 * plus anciens comme « installer les paquets nommés scripts/approve » !
 */
"use strict";

function main() {
  const rapport = [];

  // 1) sharp (tampon des fiches PNG, compositions d'images)
  try {
    const version = require("sharp/package.json").version || "?";
    require("sharp");
    rapport.push("sharp : OK (v" + version + ")");
  } catch (e) {
    const motif = String(e && e.message ? e.message : e).split("\n")[0];
    rapport.push("sharp : INDISPONIBLE (" + motif + ")");
    rapport.push("  => Le tampon des fiches PNG serait degrade. Remede manuel :");
    rapport.push("     npm install scripts approve sharp   (npm recents uniquement),");
    rapport.push("     puis : npm rebuild sharp  (ou relancez l'installation).");
  }

  // 2) better-sqlite3 : n'est PAS une dependance du projet (Prisma gere
  //    SQLite directement) — note informative seulement.
  rapport.push("better-sqlite3 : non requis (Prisma gere SQLite directement).");

  for (const ligne of rapport) console.log("[modules-natifs] " + ligne);
  // NON BLOQUANT, TOUJOURS :
  return 0;
}

process.exit(main());
