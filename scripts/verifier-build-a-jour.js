#!/usr/bin/env node
/**
 * verifier-build-a-jour.js — (NOUVEAU 0.2.53, Task 132)
 *
 * Contrôle « le build standalone est-il à jour ? » SANS `node -e` inline.
 *
 * POURQUOI CE FICHIER EXISTE :
 *   La 0.2.52 faisait ce contrôle via une ligne cmd « call node -e "<code
 *   minifié dense>" ». Sur certains postes Windows, un cmd CACHÉ (lancé par
 *   DEMARRER-SILENCIEUX-WINDOWS.vbs) qui spawn `node -e` avec un long code
 *   dense est silencieusement tué (antivirus / heuristiques / politique de
 *   scripts) : le batch s'arrêtait NET après [4/6], sans aucune erreur, sans
 *   ETAT=ERREUR. Un fichier JS ordinaire appelé par son chemin ne déclenche
 *   pas ces heuristiques et supprime tout risque de parsing cmd.
 *
 * RÈGLE (identique à la 0.2.52) :
 *   exit 0  <=>  .next/standalone/server.js EXISTE
 *                ET .next/standalone/.auto-rh-version === package.json.version
 *   exit 1  sinon (le lanceur doit (re)construire)
 *
 * Jamais d'exception jetée : tout incident => exit 1 (build = choix sûr).
 */
"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const racine = path.resolve(__dirname, "..");
  const serverJs = path.join(racine, ".next", "standalone", "server.js");
  const marque = path.join(racine, ".next", "standalone", ".auto-rh-version");
  const pkg = path.join(racine, "package.json");

  if (!fs.existsSync(serverJs)) {
    console.log("VERDICT=PAS_DE_BUILD (server.js absent)");
    return 1;
  }
  let versionBuild = "";
  try {
    versionBuild = fs.readFileSync(marque, "utf8").trim();
  } catch (e) {
    console.log("VERDICT=BUILD_PERIME (marque .auto-rh-version absente)");
    return 1;
  }
  let versionPkg = "";
  try {
    versionPkg = JSON.parse(fs.readFileSync(pkg, "utf8")).version || "";
  } catch (e) {
    console.log("VERDICT=INDETERMINE (package.json illisible) => rebuild par precaution");
    return 1;
  }
  if (versionBuild === versionPkg) {
    console.log("VERDICT=A_JOUR (build " + versionBuild + " = package " + versionPkg + ")");
    return 0;
  }
  console.log(
    "VERDICT=BUILD_PERIME (build " + (versionBuild || "?") + " != package " + versionPkg + ") => reconstruction automatique"
  );
  return 1;
}

process.exit(main());
