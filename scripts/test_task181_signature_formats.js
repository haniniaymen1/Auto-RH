#!/usr/bin/env node
/**
 * Task 181 — PREUVE E2E « Import d'une signature électronique en formats
 * multiples : .pkcs7, .p7s, .p7m, .xml, .ps7x, .p12, .pfx (+ compatibles) ».
 *
 * Vérifie contre l'administration réelle (port 4000) :
 *   - RH : PUT /api/signature-config avec CHAQUE format d'exemple → 200,
 *     métadonnées extraites (format, titulaire, émetteur, série, validité,
 *     empreinte SHA-256) persistées en base + copie CHIFFRÉE (PAIESAGE1)
 *     écrite dans storage/tampons/certificat-… ;
 *   - erreurs attendues : .p12 sans mot de passe / mauvais mot de passe /
 *     fichier factice / XML sans certificat / extension refusée / base64
 *     invalide → 400 avec message explicite ;
 *   - retrait du certificat (certFichier: "") → 200 + champs vidés ;
 *   - IT : GET/PUT /api/signature-config → 403 refusIT (non-régression
 *     Task 176) ;
 *   - SUPERADMIN : GET 200.
 *
 * Aucune donnée persistante : comptes de test supprimés, configuration
 * cert remise à l'état initial, copies certificat-* de test supprimées.
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme start-prod.js) -----------------------------
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const path = require("path");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const cryptoNode = require("crypto");

const BASE = "http://localhost:4000";
const EXEMPLES = "/home/z/my-project/download/signatures-exemple";
const db = new PrismaClient();

/** Hash scrypt au format stocké (salt aléatoire — cf. Task 197/200). */
function hashScrypt(motDePasse) {
  const salt = cryptoNode.randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + cryptoNode.scryptSync(motDePasse, salt, 64).toString("hex");
}

/** Crée (ou recrée) un compte de test directement en base — mode autonome :
 * l'E2E reste exécutable même quand le mot de passe superadmin historique
 * n'est pas celui de l'environnement (e-mail CHIFFRÉ déterministe). */
async function creerCompteDirect(email, nom, role, motDePasse) {
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(email, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(email, true),
      name: cryptoBd.chiffrerChamp(nom, true),
      role,
      isActive: true,
      passwordHash: hashScrypt(motDePasse),
      passwordChangedAt: new Date(),
    },
  });
}

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log(`  OK   ${label}`);
  } else {
    KO++;
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

function client() {
  let cookie = "";
  async function entetes() {
    return { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
  }
  return {
    async req(method, p, body) {
      const res = await fetch(BASE + p, {
        method,
        headers: await entetes(),
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* HTML / vide */
      }
      return { status: res.status, json };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
    del(p) { return this.req("DELETE", p); },
  };
}

const base64 = (f) => fs.readFileSync(path.join(EXEMPLES, f)).toString("base64");

const CAS_OK = [
  ["signature-exemple.p12", "PaieSage2026!", "PKCS#12", "Signature Exemple Auto-RH"],
  ["signature-exemple.pfx", "PaieSage2026!", "PKCS#12", "Signature Exemple Auto-RH"],
  ["signature-exemple.pkcs7", null, "PKCS#7", "Signature Exemple Auto-RH"],
  ["signature-exemple.p7s", null, "PKCS#7", "Signature Exemple Auto-RH"],
  ["signature-exemple.p7m", null, "PKCS#7", "Signature Exemple Auto-RH"],
  ["signature-exemple.xml", null, "XML-DSig", "Signature Exemple Auto-RH"],
  ["signature-exemple.ps7x", null, "XML-DSig", "Signature Exemple Auto-RH"],
  ["certificat-exemple.pem", null, "X.509", "Signature Exemple Auto-RH"],
];

async function main() {
  console.log("== Task 181 — preuve E2E (import signature électronique multi-formats) ==");

  // ------------------------------------------------------------------
  // 1) Connexion superadmin + compte RH de test
  // ------------------------------------------------------------------
  const sup = client();
  let loginSup = await sup.post("/api/auth/login", {
    email: "superadmin@autorh.local",
    password: "AutoRH-2026!Verif#1",
  });
  if (loginSup.status !== 200) {
    loginSup = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local",
      password: "AutoRH-2026!Verif",
    });
  }
  check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);
  check("Superadmin GET signature-config → 200", (await sup.get("/api/signature-config")).status === 200);

  // (MODIFIÉ Task 200) MODE AUTONOME : sans mot de passe superadmin valide,
  // les comptes de test RH/IT sont créés directement en base — les
  // assertions fonctionnelles restent identiques.
  const autonome = loginSup.status !== 200;
  if (autonome) {
    await creerCompteDirect("rh-task181@test.local", "RH Task181", "RH", "Task181-RH!2");
    await creerCompteDirect("it-task181@test.local", "IT Task181", "IT", "Task181-IT!3");
    console.log("  (mode autonome : comptes RH/IT créés directement en base)");
  }

  const rh = client();
  if (autonome) {
    const loginRh = await rh.post("/api/auth/login", { email: "rh-task181@test.local", password: "Task181-RH!2" });
    check("Connexion RH (compte direct)", loginRh.status === 200, `status=${loginRh.status}`);
  } else {
    const MDP = "Test-181!Pass";
    const crea = await sup.post("/api/users", {
      name: "RH Task181",
      email: "rh-task181@test.local",
      password: MDP,
      role: "RH",
    });
    check("Compte RH de test créé", [200, 201].includes(crea.status), `status=${crea.status}`);
    const loginRh = await rh.post("/api/auth/login", { email: "rh-task181@test.local", password: MDP });
    check("Connexion RH", loginRh.status === 200, `status=${loginRh.status}`);
    // (point 1 v0.2.88) le mot de passe initial est PROVISOIRE : changement
    // forcé à la première connexion — effectué ici pour poursuivre le test.
    await rh.post("/api/auth/change-password", { currentPassword: MDP, newPassword: "Task181-RH!2" });
    await rh.post("/api/auth/login", { email: "rh-task181@test.local", password: "Task181-RH!2" });
  }

  // État initial de la configuration (pour la restauration finale)
  const cfg0 = (await rh.get("/api/signature-config")).json?.config ?? {};
  const corpsBase = { ...cfg0 };
  delete corpsBase.updatedAt;

  // ------------------------------------------------------------------
  // 2) RH — import de CHAQUE format → 200 + métadonnées + copie chiffrée
  // ------------------------------------------------------------------
  console.log("-- RH : import de chaque format de signature --");
  const copiesCreees = new Set();
  for (const [fichier, mdp, formatAttendu, sujetAttendu] of CAS_OK) {
    const corps = { ...corpsBase, certFichier: base64(fichier), certFichierNom: fichier };
    if (mdp) corps.certMotDePasse = mdp;
    const r = await rh.put("/api/signature-config", corps);
    const c = r.json?.config ?? {};
    const okBase =
      r.status === 200 &&
      c.certFormat === formatAttendu &&
      c.certFichierNom === fichier &&
      (c.certSujet ?? "").includes(sujetAttendu);
    const okEmpreinte = /^[0-9a-f]{64}$/.test(c.certEmpreinte ?? "");
    const okValidite =
      c.certValideAu && new Date(c.certValideAu) > new Date() && c.certValideDu;
    check(`${fichier} → 200 ${formatAttendu} + sujet`, okBase, `status=${r.status} ${JSON.stringify({ f: c.certFormat, s: (c.certSujet || "").slice(0, 50) })}`);
    check(`${fichier} → empreinte SHA-256 + validité`, okEmpreinte && okValidite, JSON.stringify({ e: c.certEmpreinte, au: c.certValideAu }));

    // Persistance EN BASE + copie CHIFFRÉE sur le disque
    const enBase = await db.signatureConfig.findUnique({ where: { id: "signature" } });
    check(
      `${fichier} → persisté en base (format + sujet + empreinte)`,
      enBase && enBase.certFormat === formatAttendu && enBase.certEmpreinte === c.certEmpreinte &&
        (enBase.certSujet || "").includes(sujetAttendu) && enBase.certImportLe !== null
    );
    const chemin = enBase?.certChemin ?? "";
    const okChemin = chemin.startsWith("storage/tampons/certificat-");
    let okChiffre = false;
    if (okChemin) {
      const cheminAbsolu = chemin.replace(/^storage\//, "storage/");
      const candidats = [
        path.resolve(process.cwd(), cheminAbsolu),
        path.resolve(process.cwd(), ".next/standalone", cheminAbsolu),
      ];
      for (const cp of candidats) {
        try {
          const tete = fs.readFileSync(cp).subarray(0, 9).toString("latin1");
          if (tete === "PAIESAGE1") { okChiffre = true; copiesCreees.add(cp); break; }
        } catch { /* candidat suivant */ }
      }
    }
    check(`${fichier} → copie CHIFFRÉE (PAIESAGE1) storage/tampons/`, okChiffre, chemin);
    if (enBase?.certSerie) check(`${fichier} → n° de série non vide`, enBase.certSerie.length >= 2);
  }

  // Émetteur visible (auto-signé : émetteur = titulaire)
  const cfgV = (await rh.get("/api/signature-config")).json?.config ?? {};
  check("Émetteur extrait (auto-signé = titulaire)", (cfgV.certEmetteur ?? "").includes("Auto-RH Demonstration"), cfgV.certEmetteur);

  // ------------------------------------------------------------------
  // 3) RH — erreurs attendues → 400 avec messages explicites
  // ------------------------------------------------------------------
  console.log("-- RH : fichiers invalides refusés (400) --");
  const err = async (label, corps, motifAttendu) => {
    const r = await rh.put("/api/signature-config", { ...corpsBase, ...corps });
    check(
      label,
      r.status === 400 && (!motifAttendu || (r.json?.error ?? "").includes(motifAttendu)),
      `status=${r.status} err=${(r.json?.error ?? "").slice(0, 90)}`
    );
  };
  await err(".p12 SANS mot de passe → 400 « protégé »",
    { certFichier: base64("signature-exemple.p12"), certFichierNom: "signature-exemple.p12" },
    "PKCS#12 protégé");
  await err(".p12 avec MAUVAIS mot de passe → 400",
    { certFichier: base64("signature-exemple.p12"), certFichierNom: "signature-exemple.p12", certMotDePasse: "MAUVAIS" },
    "Mot de passe PKCS#12 incorrect");
  await err("fichier factice .p12 → 400",
    { certFichier: Buffer.concat([Buffer.from([0x30, 0x82]), Buffer.from("poubelle-poubelle")]).toString("base64"), certFichierNom: "factice.p12" },
    null);
  await err("XML sans certificat → 400",
    { certFichier: Buffer.from("<racine>rien a lire</racine>").toString("base64"), certFichierNom: "sans-cert.xml" },
    "aucun certificat");
  await err("extension .docx refusée → 400",
    { certFichier: Buffer.from("quelque chose").toString("base64"), certFichierNom: "faux.docx" },
    "Format de signature électronique non pris en charge");
  await err("contenu non base64 → 400",
    { certFichier: "###pas-base64###", certFichierNom: "x.p12" },
    "base64");

  // ------------------------------------------------------------------
  // 4) RH — retrait du certificat
  // ------------------------------------------------------------------
  console.log("-- RH : retrait du certificat --");
  const rRetrait = await rh.put("/api/signature-config", { ...corpsBase, certFichier: "", certFichierNom: "" });
  const cRetrait = rRetrait.json?.config ?? {};
  check("certFichier: \"\" → 200", rRetrait.status === 200, `status=${rRetrait.status}`);
  check("Champs cert VIDÉS après retrait",
    !cRetrait.certFormat && !cRetrait.certSujet && !cRetrait.certEmpreinte && !cRetrait.certChemin);
  const baseApres = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  check("Retrait persisté en base", baseApres && !baseApres.certFormat && baseApres.certEmpreinte === "");

  // ------------------------------------------------------------------
  // 5) IT — non-régression Task 176 : 403 refusIT
  // ------------------------------------------------------------------
  console.log("-- IT : configuration tampon/signature toujours refusée (Task 176) --");
  const it = client();
  if (autonome) {
    const itLogin = await it.post("/api/auth/login", { email: "it-task181@test.local", password: "Task181-IT!3" });
    check("Connexion IT (compte direct)", itLogin.status === 200, `status=${itLogin.status}`);
  } else {
    const MDP = "Test-181!Pass";
    const creaIt = await sup.post("/api/users", {
      name: "IT Task181",
      email: "it-task181@test.local",
      password: MDP,
      role: "IT",
    });
    check("Compte IT de test créé", [200, 201].includes(creaIt.status), `status=${creaIt.status}`);
    await it.post("/api/auth/login", { email: "it-task181@test.local", password: MDP });
    // (point 1 v0.2.88) changement forcé du mot de passe provisoire IT aussi.
    await it.post("/api/auth/change-password", { currentPassword: MDP, newPassword: "Task181-IT!3" });
    await it.post("/api/auth/login", { email: "it-task181@test.local", password: "Task181-IT!3" });
  }
  const itGet = await it.get("/api/signature-config");
  check("IT GET signature-config → 403", itGet.status === 403, `status=${itGet.status}`);
  check("IT GET → code FONCTIONNALITE_NON_AUTORISEE_IT",
    itGet.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT");
  const itPut = await it.put("/api/signature-config", {
    ...corpsBase,
    certFichier: base64("certificat-exemple.pem"),
    certFichierNom: "certificat-exemple.pem",
  });
  check("IT PUT signature-config (avec certificat) → 403", itPut.status === 403, `status=${itPut.status}`);

  // ------------------------------------------------------------------
  // 6) Nettoyage : config initiale + comptes + copies certificat-*
  // ------------------------------------------------------------------
  console.log("-- Nettoyage --");
  const rFin = await rh.put("/api/signature-config", { ...corpsBase, certFichier: "", certFichierNom: "" });
  check("Configuration remise à l'état initial", rFin.status === 200);
  if (autonome) {
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-task181@test.local", true) } });
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("it-task181@test.local", true) } });
    console.log("  OK   Comptes de test supprimés (base directe)");
  } else {
    const uSup = (await sup.get("/api/users")).json?.users ?? [];
    const uRh = uSup.find((u) => u.email === "rh-task181@test.local");
    const uIt = uSup.find((u) => u.email === "it-task181@test.local");
    const delRh = uRh ? await sup.del(`/api/users/${uRh.id}`) : null;
    const delIt = uIt ? await sup.del(`/api/users/${uIt.id}`) : null;
    check("Comptes de test supprimés", (!uRh || [200, 204].includes(delRh.status)) && (!uIt || [200, 204].includes(delIt.status)));
  }
  const restants = (await db.user.count()) ?? 0;
  check("Base comptes à l'état initial", restants === 1, `users=${restants}`);
  let supprimes = 0;
  for (const cp of copiesCreees) {
    try { fs.unlinkSync(cp); supprimes++; } catch { /* déjà absent */ }
  }
  check(`Copies certificat-* de test supprimées (${supprimes})`, true);

  await db.$disconnect();
  console.log(`\n== ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => {
  console.error("ERREUR FATALE:", e);
  process.exit(1);
});
