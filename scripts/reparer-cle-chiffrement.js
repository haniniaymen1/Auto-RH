#!/usr/bin/env node
"use strict";
/* ============================================================================
 * (NOUVEAU v0.2.167) RÉPARATION DE LA CLÉ DE CHIFFREMENT (.env ↔ base)
 * ============================================================================
 *
 * RÉPOND à : « Erreur serveur dans la configuration SMTP et IMAP » lorsque la
 * cause est une CLÉ DE CHIFFREMENT DÉSYNCHRONISÉE — typiquement :
 *   - la base a été déployée/livrée chiffrée avec la clé PAR DÉFAUT intégrée,
 *     puis le .env a reçu un nouvel AUTH_SECRET / AUTO_RH_STORAGE_KEY
 *     (généré par un lanceur, ou copie d'un autre dossier) ;
 *   - ou l'inverse : .env d'origine conservé + base d'un autre déploiement.
 *
 * SYMPTÔMES COUVERTS : « Erreur serveur » dans le panneau SMTP/IMAP (et les
 * autres pages), « Email ou mot de passe incorrect » au login RH/IT, fiches
 * illisibles, comptes portail introuvables.
 *
 * PRINCIPE : l'application chiffre les champs sensibles de db/custom.db avec
 * une clé dérivée de AUTO_RH_STORAGE_KEY (repli AUTH_SECRET, repli valeur
 * intégrée). Ce script TRANSCODE tous les champs chiffrés : déchiffrement
 * avec l'ANCIENNE clé, rechiffrement immédiat avec la clé ACTUELLE du .env —
 * y compris les empreintes déterministes (emails, CIN) et les index de
 * recherche (cinIndex, nomIndex, jetons de contenu) qui en dérivent.
 *
 * UTILISATION (Windows comme Linux/Mac) — depuis le dossier du site :
 *
 *   node scripts\reparer-cle-chiffrement.js --statut
 *       → diagnostic seul : compte les valeurs lisibles / illisibles.
 *
 *   node scripts\reparer-cle-chiffrement.js
 *       → réparation AUTOMATIQUE : si la base a été chiffrée avec la clé
 *         PAR DÉFAUT intégrée (cas de la base livrée), elle est rechiffrée
 *         avec la clé ACTUELLE du .env. Sauvegarde automatique avant écriture.
 *
 *   node scripts\reparer-cle-chiffrement.js --ancienne "mon ancien secret"
 *       → réparation lorsque l'ancienne clé est UN AUTRE secret précis
 *         (ex. AUTH_SECRET d'un ancien .env restauré depuis une sauvegarde).
 *
 * APRÈS RÉPARATION : redémarrer les services (DEMARRER-WINDOWS.bat ou
 * node scripts/redemarrer-services-4000-4001.js).
 * Idempotent : relancer le script ne modifie rien si tout est déjà lisible.
 * ==========================================================================*/
process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const ROOT = process.cwd();
const CLE_DEFAUT_INTEGREE = "autorh-storage-local-a-changer-dans-env";

/* ------------- Chargement du .env (identique au portail) ------------------ */
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

const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));

/** Clé ACTUELLE dérivée du .env (même chaîne de repli que l'application). */
function cleActuelle() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    CLE_DEFAUT_INTEGREE
  );
}

/** Basculer le moteur de chiffrement sur un secret donné. */
function activerSecret(secret) {
  process.env.AUTO_RH_STORAGE_KEY = secret;
  delete process.env.AUTH_SECRET; // AUTO_RH_STORAGE_KEY est prioritaire
  cryptoBd.reinitialiserCles();
}

/* ------------- Carte COMPLÈTE des champs chiffrés à transcoder ------------
 * ⚠ copie étendue de CARTE_CHAMPS (scripts/lib-crypto-bd.js) : elle ajoute
 * les COLONNES D'INDEX dérivées (cinIndex, nomIndex, jetons de contenu) qui
 * sont chiffrées de la même façon mais absentes de la carte applicative
 * (écrites par le middleware à partir des valeurs en clair).
 * Format : [modelePrisma, { det: [...], alea: [...] }]                        */
const CARTE_REPARATION = [
  ["payslip", {
    det: ["cinIndex", "nomIndex"],
    alea: ["cin", "fileName", "content", "normalizedContent", "employeeName",
      "period", "netSalary", "matricule", "anomalieNom"],
  }],
  ["payslipCinToken", { det: ["token"], alea: [] }],
  ["user", { det: ["email"], alea: ["name"] }],
  ["importLog", { det: [], alea: ["cinDetected", "fileName", "message"] }],
  ["portalAccess", {
    det: ["cin"],
    alea: ["totpSecret", "passwordHash", "initialPasswordEnc", "mailEnvoyeA",
      "email", "nomPrenom", "nom", "prenom", "matricule"],
  }],
  ["mailConfig", { det: [], alea: ["username", "password", "imapUser", "imapPassword"] }],
  ["signatureConfig", { det: [], alea: ["certMotDePasse", "certCleMotDePasse"] }],
  ["signatureConfigReponse", { det: [], alea: ["certMotDePasse", "certCleMotDePasse"] }],
  ["reponsePdfConfig", { det: [], alea: ["certMotDePasse"] }],
  ["signatureApiConfig", { det: [], alea: ["apiSecret", "certMotDePasse", "certCleMotDePasse"] }],
  ["demandeAdministrative", {
    det: ["cin"],
    alea: ["donnees", "destinataire", "employeEmail", "docSigneDestinataires",
      "docRefusDestinataires"],
  }],
];

/* ------------------------------------------------------------------------ */
function dechiffrerAvec(secret, valeur) {
  activerSecret(secret);
  try {
    return { clair: cryptoBd.dechiffrerChamp(valeur) };
  } catch (e) {
    return { erreur: e };
  }
}
function chiffrerAvec(secret, clair, deterministe) {
  activerSecret(secret);
  return cryptoBd.chiffrerChamp(clair, deterministe);
}

/** Sauvegarde horodatée de la base avant toute écriture. */
function sauvegarderBase() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbPath = dbUrl.replace(/^file:/, "") || path.join(ROOT, "db", "custom.db");
  const dest = dbPath + ".avant-reparation-" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(dbPath, dest);
  return dest;
}

/* ------------------------------------------------------------------------ */
(async () => {
  const args = process.argv.slice(2);
  const modeStatut = args.includes("--statut");
  const idxAncienne = args.indexOf("--ancienne");
  const ancienneFournie = idxAncienne >= 0 ? String(args[idxAncienne + 1] || "").trim() : "";

  const actuelle = cleActuelle();
  const ancienne = ancienneFournie || CLE_DEFAUT_INTEGREE;

  console.log("RÉPARATION DE LA CLÉ DE CHIFFREMENT — Auto-RH v0.2.167");
  console.log("Dossier : " + ROOT);
  console.log("");
  if (ancienneFournie) {
    console.log("Ancienne clé : fournie via --ancienne.");
  } else {
    console.log("Ancienne clé : clé PAR DÉFAUT intégrée (base livrée clé en main).");
    console.log("              (pour une autre ancienne clé : --ancienne \"secret\")");
  }
  console.log("Clé actuelle (du .env) : " + (process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY ? "AUTO_RH_STORAGE_KEY" : (process.env.AUTH_SECRET ? "AUTH_SECRET" : "valeur PAR DÉFAUT intégrée")) + (actuelle === ancienne ? "  ⚠ IDENTIQUE à l'ancienne" : ""));
  console.log("");

  if (actuelle === ancienne && !modeStatut) {
    console.log("La clé actuelle et l'ancienne clé sont IDENTIQUES : rien à transcoder.");
    console.log("Si la configuration e-mail reste en erreur, exécutez plutôt :");
    console.log("  node scripts/diagnostic-config-email.js");
    process.exit(0);
  }

  /* --------- PHASE 1 : état des lieux (sans écriture) -------------------- */
  const stats = [];
  let aReparer = 0;
  for (const [modele, carte] of CARTE_REPARATION) {
    const champListe = [...carte.det.map((c) => [c, true]), ...carte.alea.map((c) => [c, false])];
    let lignes = [];
    try {
      lignes = await db[modele].findMany();
    } catch (e) {
      stats.push({ modele, erreur: String(e.message).split("\n")[0] });
      continue;
    }
    const s = { modele, lignes: lignes.length, dejaBon: 0, enClair: 0, aTranscoder: 0, illisible: 0, erreurs: [] };
    for (const ligne of lignes) {
      for (const [champ, det] of champListe) {
        const v = ligne[champ];
        if (v === null || v === undefined || v === "" || !cryptoBd.estChiffre(v)) continue;
        const resActuelle = dechiffrerAvec(actuelle, v);
        if (!resActuelle.erreur) { s.dejaBon++; continue; }
        const resAncienne = dechiffrerAvec(ancienne, v);
        if (!resAncienne.erreur) { s.aTranscoder++; aReparer++; continue; }
        s.illisible++;
        if (s.erreurs.length < 3) s.erreurs.push(champ + " (id " + String(ligne.id).slice(0, 10) + "…)");
      }
    }
    stats.push(s);
  }

  console.log("ÉTAT DES LIEUX :");
  let toutBon = true;
  for (const s of stats) {
    if (s.erreur) { console.log("  - " + s.modele + " : ACCÈS IMPOSSIBLE — " + s.erreur); toutBon = false; continue; }
    const problemes = s.aTranscoder + s.illisible;
    if (!problemes) {
      console.log("  - " + s.modele.padEnd(24) + s.lignes + " ligne(s) — " + (s.dejaBon ? s.dejaBon + " valeur(s) déjà lisibles" : "rien de chiffré"));
    } else {
      toutBon = false;
      console.log("  - " + s.modele.padEnd(24) + s.lignes + " ligne(s) — " + s.aTranscoder + " valeur(s) à transcoder" + (s.illisible ? ", " + s.illisible + " ILLISIBLE(S) même avec l'ancienne clé " + JSON.stringify(s.erreurs) : ""));
    }
  }
  console.log("");

  if (modeStatut) {
    console.log("Mode --statut : aucune modification effectuée.");
    process.exit(toutBon ? 0 : 1);
  }

  if (aReparer === 0) {
    if (toutBon) {
      console.log("RIEN À RÉPARER : tous les champs chiffrés sont déjà lisibles avec la");
      console.log("clé actuelle du .env. Si le panneau SMTP/IMAP affiche toujours une");
      console.log("erreur, la cause est ailleurs — exécutez :");
      console.log("  node scripts/diagnostic-config-email.js");
      process.exit(0);
    }
    console.log("Aucune valeur transcodable (des valeurs restent ILLISIBLES même avec");
    console.log("l'ancienne clé proposée). Si l'ancienne clé n'était PAS la clé par");
    console.log("défaut intégrée, relancez avec : --ancienne \"l'ancien secret exact\".");
    process.exit(1);
  }

  /* --------- PHASE 2 : réparation (transcodage ancienne → actuelle) ------ */
  const sauvegarde = sauvegarderBase();
  console.log("Sauvegarde automatique de la base : " + path.basename(sauvegarde));
  console.log("Transcodage en cours…");

  let transcodes = 0;
  let echecsEcriture = 0;
  let illisiblesRestantes = 0;
  for (const [modele, carte] of CARTE_REPARATION) {
    const champListe = [...carte.det.map((c) => [c, true]), ...carte.alea.map((c) => [c, false])];
    let lignes = [];
    try {
      lignes = await db[modele].findMany();
    } catch { continue; }
    for (const ligne of lignes) {
      const maj = {};
      for (const [champ, det] of champListe) {
        const v = ligne[champ];
        if (v === null || v === undefined || v === "" || !cryptoBd.estChiffre(v)) continue;
        const resActuelle = dechiffrerAvec(actuelle, v);
        if (!resActuelle.erreur) continue; // déjà lisible avec la clé actuelle
        const resAncienne = dechiffrerAvec(ancienne, v);
        if (resAncienne.erreur) { illisiblesRestantes++; continue; }
        try {
          maj[champ] = chiffrerAvec(actuelle, resAncienne.clair, det);
          transcodes++;
        } catch {
          illisiblesRestantes++;
        }
      }
      if (Object.keys(maj).length) {
        try {
          await db[modele].update({ where: { id: ligne.id }, data: maj });
        } catch (e) {
          echecsEcriture++;
          console.log("  [!] écriture impossible " + modele + " id=" + ligne.id + " : " + String(e.message).split("\n")[0]);
        }
      }
    }
  }
  activerSecret(cleActuelle()); // restaurer l'état du processus

  console.log("");
  console.log("RÉSULTAT : " + transcodes + " valeur(s) transcodée(s) vers la clé actuelle — aucune erreur d'écriture." + (echecsEcriture ? " (" + echecsEcriture + " échec(s) d'écriture — voir [!] ci-dessus)" : ""));
  if (illisiblesRestantes) {
    console.log("NOTE : " + illisiblesRestantes + " valeur(s) restaient déjà illisibles AVANT la réparation");
    console.log("(lignes mortes historiques, illisibles même avec l'ancienne clé) : elles");
    console.log("n'ont pas été modifiées — elles n'empêchent pas l'application de fonctionner.");
  }
  console.log("");
  console.log("ÉTAPE SUIVANTE OBLIGATOIRE : redémarrez les services :");
  console.log("  - Windows : double-clic sur DEMARRER-WINDOWS.bat (ou redémarrez le");
  console.log("    portail : DEMARRER-PORTAIL-WINDOWS.bat) ;");
  console.log("  - Linux/Mac : node scripts/redemarrer-services-4000-4001.js");
  console.log("Puis vérifiez le panneau « Envoi d'e-mails (SMTP) » de l'administration");
  console.log("et relancez au besoin : node scripts/diagnostic-config-email.js");
  process.exit(echecsEcriture ? 1 : 0);
})().catch((e) => {
  console.error("ERREUR DE RÉPARATION :", e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e);
  process.exit(2);
}).finally(async () => {
  try { await db.$disconnect(); } catch { /* */ }
});
