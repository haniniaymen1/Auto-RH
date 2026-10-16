#!/usr/bin/env node
/**
 * Vérification des MOTS DE PASSE réels des certificats de test Auto-RH.
 * Tente le déchiffrement PKCS#12 (node-forge) de chaque .p12/.pfx :
 *  - dans download/signatures-exemple/ (dossier courant)
 *  - dans download/signatures-exemple-auto-rh.zip (ZIP remis à l'utilisateur)
 *  - dans download/auto-rh-scripts-site-web-v0.2.90.zip (livrable principal)
 * Mots de passe candidats : PaieSage2026! (documenté) + variantes historiques.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
const forge = require("node-forge");
const { execSync } = require("child_process");

const CANDIDATS = ["PaieSage2026!", "auto-rh2026", "Auto-RH-2026!", "AutoRH-2026!Verif#1", "auto-rh", "Auto-RH2026", "password", ""];

function essayer(buffer, mdp) {
  try {
    const der = forge.util.createBuffer(buffer.toString("binary"));
    const p12 = forge.asn1.fromDer(der);
    forge.pkcs12.pkcs12FromAsn1(p12, mdp);
    return true;
  } catch {
    return false;
  }
}

function extraireZip(zip, cible, destTmp) {
  execSync(`unzip -o -q "${zip}" "${cible}" -d "${destTmp}"`, { stdio: "ignore" });
  return path.join(destTmp, cible);
}

function testerFichier(nomAffiche, chemin) {
  const buffer = fs.readFileSync(chemin);
  const bons = CANDIDATS.filter((m) => essayer(buffer, m));
  console.log(`${nomAffiche} → ${bons.length ? "MDP VALIDE : " + JSON.stringify(bons) : "AUCUN candidat"}`);
}

// 1) Dossier courant
const dossier = "download/signatures-exemple";
for (const f of ["signature-exemple.p12", "signature-exemple.pfx"]) {
  const p = path.join(dossier, f);
  if (fs.existsSync(p)) testerFichier(`DOSSIER  ${f}`, p);
}

// 2) ZIP signatures-exemple-auto-rh.zip
const zipExemple = "download/signatures-exemple-auto-rh.zip";
if (fs.existsSync(zipExemple)) {
  const tmp = "/home/z/my-project/tmp-verif-mdp";
  fs.rmSync(tmp, { recursive: true, force: true });
  const listing = execSync(`unzip -l "${zipExemple}"`).toString();
  const cibles = listing.match(/signature-exemple\.(p12|pfx)/g) || [];
  for (const c of [...new Set(cibles)]) {
    const p = extraireZip(zipExemple, c, tmp);
    testerFichier(`ZIP EXEMPLE ${c}`, p);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3) ZIP principal v0.2.90
const zipMain = "download/auto-rh-scripts-site-web-v0.2.90.zip";
if (fs.existsSync(zipMain)) {
  const tmp = "/home/z/my-project/tmp-verif-mdp";
  fs.rmSync(tmp, { recursive: true, force: true });
  const listing = execSync(`unzip -l "${zipMain}"`).toString();
  const cibles = listing.match(/[\w\/\-\.]*signatures-exemple\/signature-exemple\.(p12|pfx)/g) || [];
  for (const c of [...new Set(cibles)].slice(0, 2)) {
    const p = extraireZip(zipMain, c, tmp);
    testerFichier(`ZIP v0.2.90 ${c}`, p);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
