#!/usr/bin/env node
/**
 * PREUVE E2E Task 245 (v0.2.128) — CACHET « SIGNATURE ÉLECTRONIQUE » :
 * FORMULAIRE DE CHOIX DES INFORMATIONS AFFICHÉES.
 *
 * Demande : « ne plus afficher les informations du certificat dans le cachet,
 * fournir un formulaire pour choisir les informations du cachet ».
 *
 * Scénario (administration 4000) :
 *   1. superadmin de test créé (scripts/creer-superadmin.js) puis login ;
 *   2. certificat PKCS#12 auto-signé (node-forge) importé via
 *      POST /api/signature-api/certificat ;
 *   3. module activé : PUT /api/signature-api/config (actif + signerFiches) ;
 *   4. CACHET par défaut (aucune case cochée) : l'aperçu NE doit afficher
 *      AUCUNE information du certificat (mention seule) ;
 *   5. toutes les cases cochées + ligne personnalisée : l'aperçu doit
 *      afficher signataire, organisation, émetteur, validité, empreinte,
 *      ligne personnalisée ;
 *   6. choix PARTIEL (signataire seul) : seuls le titre + le signataire ;
 *   7. forme ROND + choix : PDF généré (rendu non bloquant) ;
 *   8. scope=reponse : persistance des interrupteurs PROPRES ;
 *   9. non-régression : le tampon sans elec reste sans cachet, l'aperçu
 *      reste 200 avec elecActif OFF.
 * Nettoyage : comptes/configurations de test supprimés (base rendue propre).
 */
"use strict";
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const forge = require("node-forge");
process.env.SERVICE_RH_FORCE_PDFJS = "0";

const BASE = "http://localhost:4000";
const EMAIL = "test.t245@demo.tn";
const PASSWORD = "T245-demo!2026";
const OUT = path.join(__dirname, "out-task245");

let ok = 0;
let ko = 0;
function check(label, cond, detail) {
  if (cond) { ok++; console.log("  [OK] " + label); }
  else { ko++; console.log("  [KO] " + label + (detail ? " — " + detail : "")); }
}

/* Réplique de dechiffrerChamp (src/lib/db-crypto.ts) — le client Prisma brut
 * du script ne charge PAS le middleware de chiffrement de l'application. */
function dechiffre(valeur) {
  const texte = String(valeur ?? "");
  const det = texte.startsWith("encbd1d:");
  if (!det && !texte.startsWith("encbd1:")) return texte;
  try {
    const parties = texte.split(":");
    if (parties.length < 4) return texte;
    const secret = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env";
    const cle = crypto.scryptSync(secret, det ? "autorh-db-deterministe-v1" : "autorh-db-aleatoire-v1", 32);
    const iv = Buffer.from(parties[1], "base64");
    const tag = Buffer.from(parties[2], "base64");
    const donnees = Buffer.from(parties.slice(3).join(":"), "base64");
    const clair = crypto.createDecipheriv("aes-256-gcm", cle, iv);
    clair.setAuthTag(tag);
    return Buffer.concat([clair.update(donnees), clair.final()]).toString("utf8");
  } catch {
    return null; // ligne chiffrée avec une AUTRE clé (compte historique)
  }
}
/** Id de l'utilisateur de test (e-mail déchiffré = EMAIL), sinon null. */
async function idUtilisateurTest(db) {
  const lignes = await db.$queryRawUnsafe("SELECT id, email FROM User").catch(() => []);
  for (const l of lignes) {
    if (dechiffre(l.email) === EMAIL) return l.id;
  }
  return null;
}
async function api(chemin, options = {}, cookie = "") {
  const headers = Object.assign({}, options.headers || {});
  if (cookie) headers.cookie = cookie;
  if (options.body && !(options.body instanceof FormData) && typeof options.body === "string") {
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const reponse = await fetch(BASE + chemin, { ...options, headers, redirect: "manual" });
  return reponse;
}
async function jsonDe(reponse) { try { return await reponse.json(); } catch { return {}; } }

/* ------------------------------------------------------------------ */
/* Certificat PKCS#12 auto-signé (node-forge)                          */
/* ------------------------------------------------------------------ */
function genererP12(sujetCn, sujetO) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = "04" + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: sujetCn },
    { name: "organizationName", value: sujetO },
    { shortName: "C", value: "TN" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, cert, "", { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

/* ------------------------------------------------------------------ */
async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log("== 0. Pré-nettoyage (exécution ré-entrante) ==");
  try {
    const { PrismaClient } = require("@prisma/client");
    const db0 = new PrismaClient();
    const id0 = await idUtilisateurTest(db0);
    if (id0) await db0.user.delete({ where: { id: id0 } });
    await db0.signatureApiConfig.deleteMany({});
    await db0.signatureConfig.deleteMany({});
    await db0.signatureConfigReponse.deleteMany({});
    await db0.$disconnect();
    console.log("  [OK] état précédent supprimé");
  } catch (e) {
    console.log("  [KO] pré-nettoyage : " + String(e.message || e).slice(0, 120));
  }

  console.log("== 1. Compte superadmin de test ==");
  const { execFileSync } = require("child_process");
  execFileSync("node", [
    path.join(__dirname, "creer-superadmin.js"), "--creer",
    "--email", EMAIL, "--nom", "Test T245", "--password", PASSWORD,
  ], { stdio: "pipe" });
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  let brutCookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("login superadmin de test", login.status === 200 && brutCookie.length > 20, "status=" + login.status);
  // (politique de sécurité) le mot de passe initial est PROVISOIRE : changement
  // immédiat obligatoire avant tout appel API — puis re-login.
  const NVPASSWORD = "T245-demo!2026-B";
  const repChg = await api("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NVPASSWORD }),
  }, brutCookie);
  check("changement du mot de passe initial", repChg.status === 200, "status=" + repChg.status);
  const login2 = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: NVPASSWORD }),
  });
  brutCookie = (login2.headers.get("set-cookie") || "").split(";")[0];
  check("re-login après changement", login2.status === 200 && brutCookie.length > 20, "status=" + login2.status);

  console.log("== 2. Import d'un certificat PKCS#12 auto-signé ==");
  const p12 = genererP12("Jean Testeur", "MA SOCIETE TEST SARL");
  fs.writeFileSync(path.join(OUT, "certificat-test.p12"), p12);
  const formCert = new FormData();
  formCert.append("fichier", new Blob([p12]), "certificat-test.p12");
  formCert.append("motDePasse", "");
  const repCert = await api("/api/signature-api/certificat", { method: "POST", body: formCert }, brutCookie);
  const corpsCert = await jsonDe(repCert);
  check("import certificat 200", repCert.status === 200, JSON.stringify(corpsCert).slice(0, 200));
  check("sujet CN+O extraits", String(corpsCert.certificat?.sujet || corpsCert.cert?.sujet || "").includes("Jean Testeur") || JSON.stringify(corpsCert).includes("Jean Testeur"));

  console.log("== 3. Activation du module (LOCALE + fiches) ==");
  const repCfg = await api("/api/signature-api/config", {
    method: "PUT",
    body: JSON.stringify({ actif: true, signerFiches: true, mode: "LOCALE" }),
  }, brutCookie);
  check("PUT signature-api/config 200", repCfg.status === 200, "status=" + repCfg.status + " " + JSON.stringify(await jsonDe(repCert)).slice(0, 80));

  console.log("== 4. CACHET PAR DÉFAUT : AUCUNE information du certificat ==");
  const cfgBase = {
    actif: true, sigActif: false, qrActif: false, mentionActif: true,
    mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
    elecActif: true, elecPosition: "BAS_DROITE", elecDecalX: 0, elecDecalY: 0,
    elecTaille: 100, elecForme: "RECTANGLE",
    elecAffSignataire: false, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: "",
  };
  const repPut0 = await api("/api/signature-config", { method: "PUT", body: JSON.stringify(cfgBase) }, brutCookie);
  const cfg0 = await jsonDe(repPut0);
  check("PUT config cachet (défaut) 200", repPut0.status === 200, JSON.stringify(cfg0).slice(0, 150));
  check("interrupteurs persistés à false", cfg0.config && cfg0.config.elecActif === true && cfg0.config.elecAffSignataire === false && cfg0.config.elecAffEmpreinte === false && cfg0.config.elecTexteLibre === "");

  const apercu = async (cfg) => {
    const rep = await api("/api/signature-config", {
      method: "POST",
      body: JSON.stringify({ action: "apercu", ...cfg }),
    }, brutCookie);
    if (rep.status !== 200) return { status: rep.status, texte: "", octets: null };
    const octets = Buffer.from(await rep.arrayBuffer());
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(octets) });
    const resultat = await parser.getText();
    await parser.destroy();
    return { status: rep.status, texte: resultat.text || "", octets };
  };

  const r0 = await apercu(cfgBase);
  check("aperçu (défaut) 200 PDF", r0.status === 200 && Buffer.isBuffer(r0.octets) && r0.octets.length > 1000);
  fs.writeFileSync(path.join(OUT, "apercu-defaut.pdf"), r0.octets || Buffer.alloc(0));
  check("mention SIGNATURE ÉLECTRONIQUE présente", /SIGNATURE\s+ÉLECTRONIQUE/i.test(r0.texte));
  check("AUCUN « Signataire : » (défaut)", !/Signataire\s*:/i.test(r0.texte));
  check("AUCUN « Émetteur : » (défaut)", !/Émetteur\s*:/i.test(r0.texte));
  check("AUCUNE « Valide jusqu'au » (défaut)", !/Valide jusqu/i.test(r0.texte));
  check("AUCUNE empreinte SHA-256 (défaut)", !/SHA-256/i.test(r0.texte));
  check("AUCUNE organisation (défaut)", !/MA SOCIETE TEST/i.test(r0.texte));

  console.log("== 5. TOUTES LES CASES + ligne personnalisée ==");
  const cfgTout = {
    ...cfgBase,
    elecAffSignataire: true, elecAffOrganisation: true, elecAffEmetteur: true,
    elecAffValidite: true, elecAffEmpreinte: true,
    elecTexteLibre: "Direction des Ressources Humaines",
  };
  const repPutT = await api("/api/signature-config", { method: "PUT", body: JSON.stringify(cfgTout) }, brutCookie);
  const cfgT = await jsonDe(repPutT);
  check("PUT config (tout) 200", repPutT.status === 200);
  check("interrupteurs persistés à true", cfgT.config && cfgT.config.elecAffSignataire === true && cfgT.config.elecAffValidite === true && cfgT.config.elecTexteLibre === "Direction des Ressources Humaines");
  const rT = await apercu(cfgTout);
  fs.writeFileSync(path.join(OUT, "apercu-tout.pdf"), rT.octets || Buffer.alloc(0));
  check("aperçu (tout) 200", rT.status === 200);
  // (v0.2.121) formes ROND/RECTANGLE : le titulaire est dessiné SANS étiquette
  // « Signataire : » (style cachet d'entreprise) — nom seul au centre.
  check("Signataire affiché (nom au centre)", /Jean Testeur/i.test(rT.texte));
  check("Organisation affichée", /MA SOCIETE TEST SARL/i.test(rT.texte));
  check("Émetteur affiché", /Émetteur\s*:/i.test(rT.texte));
  check("Validité affichée", /Valide jusqu/i.test(rT.texte));
  check("Empreinte affichée", /SHA-256/i.test(rT.texte));
  check("Ligne personnalisée affichée", /Direction des Ressources Humaines/i.test(rT.texte));

  console.log("== 6. CHOIX PARTIEL : signataire seul ==");
  const cfgPartiel = { ...cfgBase, elecAffSignataire: true };
  const repPutP = await api("/api/signature-config", { method: "PUT", body: JSON.stringify(cfgPartiel) }, brutCookie);
  check("PUT config (partiel) 200", repPutP.status === 200);
  const rP = await apercu(cfgPartiel);
  fs.writeFileSync(path.join(OUT, "apercu-partiel.pdf"), rP.octets || Buffer.alloc(0));
  check("Signataire seul affiché (nom au centre)", /Jean Testeur/i.test(rP.texte));
  check("Pas d'organisation (partiel)", !/MA SOCIETE TEST/i.test(rP.texte));
  check("Pas d'empreinte (partiel)", !/SHA-256/i.test(rP.texte));
  check("Pas d'éméteur (partiel)", !/Émetteur\s*:/i.test(rP.texte));

  console.log("== 7. FORME ROND + choix (rendu non bloquant) ==");
  const cfgRond = { ...cfgTout, elecForme: "ROND" };
  const repPutR = await api("/api/signature-config", { method: "PUT", body: JSON.stringify(cfgRond) }, brutCookie);
  check("PUT config (rond) 200", repPutR.status === 200);
  const rR = await apercu(cfgRond);
  check("aperçu ROND 200 PDF", rR.status === 200 && Buffer.isBuffer(rR.octets) && rR.octets.length > 1000);
  fs.writeFileSync(path.join(OUT, "apercu-rond.pdf"), rR.octets || Buffer.alloc(0));

  console.log("== 8. scope=reponse : interrupteurs PROPRES ==");
  const repRep = await api("/api/signature-config?scope=reponse", {
    method: "GET",
  }, brutCookie);
  const cfgRepAvant = await jsonDe(repRep);
  check("GET scope=reponse 200", repRep.status === 200, "status=" + repRep.status);
  const repRepPut = await api("/api/signature-config", {
    method: "PUT",
    body: JSON.stringify({
      scope: "reponse",
      actif: false, sigActif: false, qrActif: false, mentionActif: true,
      mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
      elecActif: true, elecPosition: "BAS_DROITE", elecDecalX: 0, elecDecalY: 0,
      elecTaille: 100, elecForme: "RECTANGLE",
      elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
      elecAffValidite: false, elecAffEmpreinte: false,
      elecTexteLibre: "Service Paie",
    }),
  }, brutCookie);
  const cfgRep = await jsonDe(repRepPut);
  check("PUT scope=reponse 200", repRepPut.status === 200, JSON.stringify(cfgRep).slice(0, 150));
  check("réponses : interrupteurs propres persistés", cfgRep.config && cfgRep.config.elecAffSignataire === true && cfgRep.config.elecAffOrganisation === false && cfgRep.config.elecTexteLibre === "Service Paie");
  // l'Import n'a PAS bougé : il conserve la config de l'étape 7 (ROND —
  // toutes cases + « Direction des Ressources Humaines »), JAMAIS « Service
  // Paie » (valeur propre à la section réponses).
  const repImp = await api("/api/signature-config", { method: "GET" }, brutCookie);
  const cfgImp = await jsonDe(repImp);
  check(
    "Import inchangé (section indépendante)",
    cfgImp.config && cfgImp.config.elecAffSignataire === true &&
      cfgImp.config.elecTexteLibre === "Direction des Ressources Humaines" &&
      cfgImp.config.elecTexteLibre !== "Service Paie",
    JSON.stringify({ s: cfgImp.config?.elecAffSignataire, t: cfgImp.config?.elecTexteLibre })
  );

  console.log("== 9. Non-régression : cachet OFF ==");
  const repPutOff = await api("/api/signature-config", { method: "PUT", body: JSON.stringify({ ...cfgBase, elecActif: false }) }, brutCookie);
  check("PUT config (elec OFF) 200", repPutOff.status === 200);
  const rOff = await apercu({ ...cfgBase, elecActif: false });
  check("aperçu sans cachet 200", rOff.status === 200);
  check("AUCUN cachet (OFF)", !/SIGNATURE\s+ÉLECTRONIQUE/i.test(rOff.texte));

  /* ---------------------------- NETTOYAGE ---------------------------- */
  console.log("== Nettoyage ==");
  try {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient();
    await db.signatureApiConfig.deleteMany({});
    await db.signatureConfig.updateMany({
      data: { actif: false, elecActif: false, elecAffSignataire: false, elecAffOrganisation: false, elecAffEmetteur: false, elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: "" },
    });
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
    const idTest = await idUtilisateurTest(db);
    if (idTest) await db.user.delete({ where: { id: idTest } });
    await db.$disconnect();
    check("nettoyage (config + compte de test)", Boolean(idTest));
  } catch (e) {
    check("nettoyage", false, String(e.message || e).slice(0, 120));
  }

  console.log("\n===== RÉSULTAT : " + ok + " OK / " + ko + " KO =====");
  process.exit(ko > 0 ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(1); });
