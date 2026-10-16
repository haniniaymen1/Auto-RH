#!/usr/bin/env node
/**
 * Task 205 — Preuve E2E de la régénération des exemples de signatures
 * (download/signatures-exemple/ + signatures-exemple-auto-rh.zip, v0.2.99).
 *
 * Vérifie, avec les fichiers RÉGÉNÉRÉS :
 *   1. IMPORT : signature-exemple.p12 + PaieSage2026! → 200, métadonnées
 *      extraites, certMotDePasseEnregistre=true, mot de passe jamais renvoyé ;
 *   2. RÉPONSES (scope=reponse) : le même .p12 importé DÉDIÉ → 200,
 *      mot de passe propre enregistré, jamais renvoyé ;
 *   3. INDÉPENDANCE : Import avec certificat-exemple.crt → les réponses
 *      gardent leur .p12 et l'Import porte le .crt (fichiers distincts
 *      simultanément dans les deux sections) ;
 *   4. APERÇU réponses → 200 PDF portant le titulaire de l'exemple ;
 *   5. APERÇU import → 200 PDF portant le titulaire de l'exemple.
 * Nettoyage complet (configs restaurées à l'état capturé, compte supprimé,
 * copies chiffrées de test retirées de storage/tampons).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const BASE = "http://localhost:4000";
const EMAIL = "rh-task205@test.autorh.local";
const MDP_COMPTE = "Test-205!Pass";
const MDP_DOC = "PaieSage2026!";
const DOSSIER = "download/signatures-exemple";
const TAMpons = "storage/tampons";
const TMP = "/tmp/task205exemples";

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log("  OK   " + label); }
  else { KO++; console.log("  FAIL " + label + (detail ? " — " + detail : "")); }
}

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + crypto.scryptSync(mdp, salt, 64).toString("hex");
}

function client() {
  let cookie = "";
  return {
    async req(method, p, body) {
      const res = await fetch(BASE + p, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const tampon = Buffer.from(await res.arrayBuffer());
      const texte = tampon.toString("utf8");
      let json = null;
      if ((res.headers.get("content-type") ?? "").includes("json")) {
        try { json = JSON.parse(texte); } catch { /* vide */ }
      }
      return { status: res.status, json, texte, octets: json ? null : tampon };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
  };
}

function b64(fichier) {
  return fs.readFileSync(path.join(DOSSIER, fichier)).toString("base64");
}

function textePdf(octets, nomBase) {
  fs.mkdirSync(TMP, { recursive: true });
  const chemin = path.join(TMP, nomBase + ".pdf");
  fs.writeFileSync(chemin, octets);
  return execSync('pdftotext "' + chemin + '" - 2>/dev/null').toString();
}

function champsCert(r) {
  if (!r) return null;
  const c = { ...r };
  delete c.id;
  return c;
}

async function main() {
  // ---- État initial (configs + fichiers tampons) ----
  const importAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });
  const tamponsAvant = fs.existsSync(TAMpons) ? fs.readdirSync(TAMpons).sort() : [];

  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Test 205", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE), passwordChangedAt: new Date(),
    },
  });

  const c = client();
  const login = await c.post("/api/auth/login", { email: EMAIL, password: MDP_COMPTE });
  check("Connexion RH", login.status === 200, "status=" + login.status);

  // ---- 1) IMPORT : .p12 régénéré + mot de passe documenté ----
  const putImport = await c.put("/api/signature-config", {
    actif: true, certActif: true, certFichier: b64("signature-exemple.p12"),
    certFichierNom: "signature-exemple.p12", certMotDePasse: MDP_DOC,
  });
  check("IMPORT : .p12 régénéré → 200", putImport.status === 200,
    "status=" + putImport.status + " " + JSON.stringify(putImport.json?.error ?? ""));
  check("IMPORT : titulaire = Signature Exemple Auto-RH",
    String(putImport.json?.config?.certSujet ?? "").includes("Signature Exemple Auto-RH"),
    JSON.stringify(putImport.json?.config?.certSujet ?? ""));
  check("IMPORT : format PKCS#12 reconnu",
    String(putImport.json?.config?.certFormat ?? "") === "PKCS#12",
    JSON.stringify(putImport.json?.config?.certFormat ?? ""));
  check("IMPORT : certMotDePasseEnregistre = true",
    putImport.json?.config?.certMotDePasseEnregistre === true,
    JSON.stringify(putImport.json?.config?.certMotDePasseEnregistre));
  check("IMPORT : le mot de passe ne sort JAMAIS du serveur",
    !putImport.texte.includes(MDP_DOC), "");

  // ---- 2) RÉPONSES : le même .p12 importé DÉDIÉ ----
  const putRep = await c.put("/api/signature-config", {
    scope: "reponse", actif: true, certActif: true,
    certFichier: b64("signature-exemple.p12"),
    certFichierNom: "signature-exemple.p12", certMotDePasse: MDP_DOC,
  });
  check("RÉPONSES : .p12 régénéré dédié → 200", putRep.status === 200,
    "status=" + putRep.status + " " + JSON.stringify(putRep.json?.error ?? ""));
  check("RÉPONSES : titulaire dédié = Signature Exemple Auto-RH",
    String(putRep.json?.config?.certSujet ?? "").includes("Signature Exemple Auto-RH"),
    JSON.stringify(putRep.json?.config?.certSujet ?? ""));
  check("RÉPONSES : certMotDePasseEnregistre = true",
    putRep.json?.config?.certMotDePasseEnregistre === true,
    JSON.stringify(putRep.json?.config?.certMotDePasseEnregistre));
  check("RÉPONSES : le mot de passe ne sort JAMAIS du serveur",
    !putRep.texte.includes(MDP_DOC), "");

  // ---- 3) INDÉPENDANCE : Import passe au .crt, les réponses gardent le .p12 ----
  const putImportCrt = await c.put("/api/signature-config", {
    actif: true, certActif: true,
    certFichier: b64("certificat-exemple.crt"), certFichierNom: "certificat-exemple.crt",
  });
  check("IMPORT : réimport certificat-exemple.crt → 200 (X.509)",
    putImportCrt.status === 200 && String(putImportCrt.json?.config?.certFormat ?? "") === "X.509",
    "status=" + putImportCrt.status + " format=" + JSON.stringify(putImportCrt.json?.config?.certFormat ?? ""));
  const getImport2 = await c.get("/api/signature-config");
  const getRep2 = await c.get("/api/signature-config?scope=reponse");
  check("INDÉPENDANCE : Import = certificat-exemple.crt",
    String(getImport2.json?.config?.certFichierNom ?? "") === "certificat-exemple.crt",
    JSON.stringify(getImport2.json?.config?.certFichierNom ?? ""));
  check("INDÉPENDANCE : réponses TOUJOURS signature-exemple.p12",
    String(getRep2.json?.config?.certFichierNom ?? "") === "signature-exemple.p12",
    JSON.stringify(getRep2.json?.config?.certFichierNom ?? ""));
  check("INDÉPENDANCE : mot de passe réponses toujours enregistré",
    getRep2.json?.config?.certMotDePasseEnregistre === true,
    JSON.stringify(getRep2.json?.config?.certMotDePasseEnregistre));

  // ---- 4) APERÇU réponses avec l'exemple régénéré ----
  const apRep = await c.post("/api/signature-config", {
    action: "apercu", scope: "reponse",
    actif: true, sigActif: false, qrActif: false, mentionActif: true,
    certActif: true, certPosition: "BAS_CENTRE", certTaille: 100,
  });
  check("APERÇU réponses → 200 PDF", apRep.status === 200 && (apRep.octets ?? Buffer.alloc(0)).length > 1000,
    "status=" + apRep.status);
  const tRep = textePdf(apRep.octets ?? Buffer.alloc(0), "apercu205-reponses");
  check("APERÇU réponses : bloc certificat = Signature Exemple Auto-RH",
    tRep.includes("Signature Exemple Auto-RH"), "");

  // ---- 5) APERÇU import avec l'exemple régénéré ----
  const apImp = await c.post("/api/signature-config", {
    action: "apercu",
    actif: true, sigActif: false, qrActif: false, mentionActif: true,
    certActif: true, certPosition: "BAS_CENTRE", certTaille: 100,
  });
  check("APERÇU import → 200 PDF", apImp.status === 200 && (apImp.octets ?? Buffer.alloc(0)).length > 1000,
    "status=" + apImp.status);
  const tImp = textePdf(apImp.octets ?? Buffer.alloc(0), "apercu205-import");
  check("APERÇU import : bloc certificat = Signature Exemple Auto-RH",
    tImp.includes("Signature Exemple Auto-RH"), "");

  // ---- Nettoyage complet ----
  if (importAvant) {
    await db.signatureConfig.update({ where: { id: "signature" }, data: champsCert(importAvant) });
  } else {
    await db.signatureConfig.deleteMany({ where: { id: "signature" } });
  }
  if (repAvant) {
    await db.signatureConfigReponse.update({ where: { id: "signature-reponse" }, data: champsCert(repAvant) });
  } else {
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  }
  const tamponsApres = fs.existsSync(TAMpons) ? fs.readdirSync(TAMpons).sort() : [];
  const crees = tamponsApres.filter((f) => !tamponsAvant.includes(f));
  for (const f of crees) {
    try { fs.unlinkSync(path.join(TAMpons, f)); } catch { /* déjà parti */ }
  }
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("(nettoyage : configs restaurées, " + crees.length + " copie(s) de test retirée(s), compte supprimé)");

  console.log("\n== RÉSULTAT : " + OK + " OK / " + KO + " FAIL ==");
  await db.$disconnect();
  process.exit(KO ? 2 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try { await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } }); } catch { /* rien */ }
  await db.$disconnect();
  process.exit(2);
});
