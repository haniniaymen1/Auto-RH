#!/usr/bin/env node
/**
 * Task 200 — PREUVE E2E du correctif « exemples de signature électronique
 * et mots de passe des certificats » (v0.2.97).
 *
 * Symptôme signalé (reproduit avant correctif) :
 *   - les exemples .p7s / .p7m / .pkcs7 importés AVEC un mot de passe saisi
 *     étaient rejetés à tort : « Mot de passe PKCS#12 incorrect ou fichier
 *     .p12/.pfx corrompu » — le lecteur PKCS#7 n'était jamais essayé dès
 *     qu'un mot de passe (même correct) voyageait avec la requête ;
 *   - les utilisateurs en déduisaient que « les mots de passe ne sont pas
 *     acceptés ».
 *
 * Comportement ATENDU après correctif (vérifié ici, port 4000) :
 *   1. CHAQUE exemple de download/signatures-exemple/ s'importe AVEC le mot
 *      de passe documenté (200 + certificat identifié) — le mot de passe est
 *      simplement ignoré pour les formats qui n'en ont pas ;
 *   2. .p12/.pfx SANS mot de passe → 400 « Fichier PKCS#12 protégé… »
 *      (message clair, inchangé) ;
 *   3. .p12/.pfx avec MAUVAIS mot de passe → 400 « Mot de passe PKCS#12
 *      incorrect… » (inchangé) ;
 *   4. un .p12 MODERNE PBES2/AES (défaut OpenSSL 3.x) s'importe (forge ≥ 1.3
 *      + repli openssl) ;
 *   5. non-régression : formats XML/PEM/DER et erreurs 400 conservées.
 *
 * Aucune donnée persistante : configuration cert remise à l'état initial,
 * compte RH de test supprimé.
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
const EXEMPLES = path.join("download", "signatures-exemple");
const MDP = "PaieSage2026!";
const EMAIL = "rh-task200@test.autorh.local";
const MDP_COMPTE = "Test-200!Pass";

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function client() {
  let cookie = "";
  return {
    async req(method, p, body) {
      const res = await fetch(BASE + p, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      let json = null;
      try { json = await res.json(); } catch { /* vide */ }
      return { status: res.status, json };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
  };
}

/** .p12 « MODERNE » (défaut OpenSSL 3.x : PBES2 / PBKDF2 / AES-256-CBC). */
function genererP12Moderne(dossier) {
  const nom = path.join(dossier, "moderne-pbes2.p12");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${dossier}/moderne-cle.pem ` +
    `-out ${dossier}/moderne-cert.pem -days 30 -nodes -sha256 -subj "/CN=Certificat Moderne PBES2" 2>/dev/null && ` +
    `openssl pkcs12 -export -out ${nom} -inkey ${dossier}/moderne-cle.pem ` +
    `-in ${dossier}/moderne-cert.pem -passout pass:${MDP} 2>/dev/null`
  );
  return nom;
}

async function main() {
  // État initial de la configuration certificat (restauration en fin)
  const avant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const etatInitial = avant ? {
    certFormat: avant.certFormat, certFichierNom: avant.certFichierNom,
    certChemin: avant.certChemin, certSujet: avant.certSujet,
    certEmetteur: avant.certEmetteur, certSerie: avant.certSerie,
    certValideDu: avant.certValideDu, certValideAu: avant.certValideAu,
    certEmpreinte: avant.certEmpreinte, certImportLe: avant.certImportLe,
  } : null;

  // 1) Compte RH temporaire (e-mail CHIFFRÉ déterministe — cf. Task 197)
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Test 200", true),
      role: "RH",
      isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE),
      passwordChangedAt: new Date(),
    },
  });
  console.log("== Compte RH temporaire créé ==");

  const c = client();
  const login = await c.post("/api/auth/login", { email: EMAIL, password: MDP_COMPTE, souvenir: false });
  check("Connexion RH", login.status === 200, "status=" + login.status);

  // 2) GET initial
  const get0 = await c.get("/api/signature-config");
  check("GET signature-config", get0.status === 200, "status=" + get0.status);

  // 3) (LE CŒUR DU CORRECTIF) CHAQUE exemple importé AVEC le mot de passe
  //    documenté — y compris les PKCS#7 qui, avant correctif, étaient
  //    rejetés avec un faux « mot de passe incorrect ».
  const fichiers = fs.readdirSync(EXEMPLES).filter((f) => /\.(p12|pfx|pkcs7|p7s|p7m|p7b|p7c|xml|ps7x|pem|cer|crt|der)$/i.test(f));
  console.log("== Import de chaque exemple AVEC mot de passe saisi (PaieSage2026!) ==");
  for (const f of fichiers.sort()) {
    const b64 = fs.readFileSync(path.join(EXEMPLES, f)).toString("base64");
    const r = await c.put("/api/signature-config", {
      certFichier: b64, certFichierNom: f, certMotDePasse: MDP,
    });
    const fmt = r.json?.config?.certFormat || "";
    const sujet = r.json?.config?.certSujet || "";
    check(`${f} → 200 + certificat identifié`, r.status === 200 && Boolean(fmt && sujet),
      `status=${r.status} erreur=${JSON.stringify(r.json?.error ?? "")}`);
  }

  // 4) Les mêmes SANS mot de passe (les formats non-P12 n'en ont pas besoin)
  console.log("== Import sans mot de passe (formats non PKCS#12) ==");
  for (const f of ["signature-exemple.p7s", "signature-exemple.pkcs7", "signature-exemple.p7m", "certificat-exemple.pem"]) {
    const b64 = fs.readFileSync(path.join(EXEMPLES, f)).toString("base64");
    const r = await c.put("/api/signature-config", { certFichier: b64, certFichierNom: f });
    check(`${f} sans mdp → 200`, r.status === 200, `status=${r.status} erreur=${JSON.stringify(r.json?.error ?? "")}`);
  }

  // 5) .p12 SANS mot de passe → 400 « protégé » (message clair conservé)
  console.log("== .p12 sans mot de passe (attendu : 400 « protégé ») ==");
  const b12 = fs.readFileSync(path.join(EXEMPLES, "signature-exemple.p12")).toString("base64");
  const rSans = await c.put("/api/signature-config", { certFichier: b12, certFichierNom: "signature-exemple.p12" });
  check("p12 sans mdp → 400", rSans.status === 400, "status=" + rSans.status);
  check("message « protégé » + invite mot de passe", /protégé/i.test(String(rSans.json?.error ?? "")) && /mot de passe/i.test(String(rSans.json?.error ?? "")),
    JSON.stringify(rSans.json?.error ?? ""));

  // 6) .p12 avec MAUVAIS mot de passe → 400 « mot de passe incorrect »
  console.log("== .p12 avec mauvais mot de passe (attendu : 400 « incorrect ») ==");
  const rMauvais = await c.put("/api/signature-config", {
    certFichier: b12, certFichierNom: "signature-exemple.p12", certMotDePasse: "MAUVAIS-mdp-123!",
  });
  check("p12 + mauvais mdp → 400", rMauvais.status === 400, "status=" + rMauvais.status);
  check("message « Mot de passe PKCS#12 incorrect »", /incorrect/i.test(String(rMauvais.json?.error ?? "")),
    JSON.stringify(rMauvais.json?.error ?? ""));

  // 7) .p12 MODERNE PBES2/AES (défaut OpenSSL 3.x — cas des vrais certificats)
  console.log("== .p12 MODERNE PBES2/AES-256 (défaut OpenSSL 3.x) ==");
  const tmp = "scripts/tmp_task200";
  fs.mkdirSync(tmp, { recursive: true });
  const nomModerne = genererP12Moderne(tmp);
  const bMod = fs.readFileSync(nomModerne).toString("base64");
  const rMod = await c.put("/api/signature-config", {
    certFichier: bMod, certFichierNom: "moderne-pbes2.p12", certMotDePasse: MDP,
  });
  check("p12 PBES2/AES + bon mot de passe → 200", rMod.status === 200,
    `status=${rMod.status} erreur=${JSON.stringify(rMod.json?.error ?? "")}`);
  const rMod2 = await c.put("/api/signature-config", {
    certFichier: bMod, certFichierNom: "moderne-pbes2.p12", certMotDePasse: "faux-mdp-9999",
  });
  check("p12 PBES2/AES + mauvais mot de passe → 400", rMod2.status === 400, "status=" + rMod2.status);

  // 8) Non-régression : fichier factice → 400 sans fausse piste mot de passe
  console.log("== Fichier factice (attendu : 400 format) ==");
  const factice = Buffer.from("Ceci n'est PAS un fichier de signature electronique du tout.").toString("base64");
  const rF = await c.put("/api/signature-config", {
    certFichier: factice, certFichierNom: "factice.p7s", certMotDePasse: "PaieSage2026!",
  });
  check("factice .p7s + mdp → 400", rF.status === 400, "status=" + rF.status);
  check("message de FORMAT (pas une fausse piste mot de passe)",
    /(format|non reconnu)/i.test(String(rF.json?.error ?? "")) && !/Mot de passe PKCS#12 incorrect/i.test(String(rF.json?.error ?? "")),
    JSON.stringify(rF.json?.error ?? ""));

  // 9) Nettoyage complet
  console.log("== Nettoyage ==");
  if (etatInitial) {
    await db.signatureConfig.update({ where: { id: "signature" }, data: etatInitial });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  console.log("  configuration cert restaurée, compte supprimé, fichiers temporaires supprimés");

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  await db.$disconnect();
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try { await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } }); } catch {}
  await db.$disconnect();
  process.exit(2);
});
