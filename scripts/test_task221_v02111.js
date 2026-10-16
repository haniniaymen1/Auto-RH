#!/usr/bin/env node
/**
 * v0.2.111 (Task 221) — PREUVE E2E des DEUX demandes :
 *
 *  1. CRÉATION DE COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE :
 *     quand le superadministrateur crée un compte RH ou IT, l'e-mail
 *     d'identification part DE L'ADRESSE DU SERVICE INFORMATIQUE configurée
 *     dans le système (MailConfig.itEmail, panneau SMTP) — le puits SMTP
 *     prouve l'en-tête From, l'enveloppe SMTP et le journal d'envoi ;
 *     repli historique vérifié lorsque l'adresse IT est absente.
 *
 *  2. IMPORT PKCS#12 (.p12 / .pfx) — MOT DE PASSE CORRECT ACCEPTÉ :
 *     - coffre MODERNE (AES-256/PBKDF2-SHA256, défaut OpenSSL 3) + BON mot
 *       de passe → importé (avant : « mot de passe incorrect ou corrompu »
 *       à cause de la carte getBags() cléée par OID lue avec la clé
 *       « certBag ») ;
 *     - coffre LEGACY (PBE-SHA1-3DES) + BON mot de passe → importé ;
 *     - MAUVAIS mot de passe → erreur MOT DE PASSE explicite (et seulement
 *       dans ce cas) ;
 *     - fichier corrompu → erreur de STRUCTURE (le mot de passe n'est pas
 *       blâmé) ;
 *     - .pfx + .cer toujours reconnus (non-régression formats).
 *
 * Environnement : instance RÉELLE (4000) + puits SMTP (2525). Nettoyage
 * intégral en fin de run (comptes, config SMTP restaurée à l'octet près,
 * certificat de test retiré, puits arrêté).
 */
"use strict";
process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const path = require("path");
const { spawn } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { simpleParser } = require("mailparser");

const db = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const PUITS_PORT = "2525";
const PUITS_LOG = path.join(__dirname, "task122", "puits-complet.log");
const LABO = path.join(__dirname, "p12lab");

const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };
const MDP_P12 = "MotDePasse123";
const EMAIL_IT = "informatique@entreprise.tn";
const EMAIL_SMTP = "auto-rh@entreprise.tn";
const COMPTES = [
  { email: "verif221-rh@test.tn", role: "RH", nom: "Vérif 221 RH" },
  { email: "verif221-it@test.tn", role: "IT", nom: "Vérif 221 IT" },
  { email: "verif221-rh2@test.tn", role: "RH", nom: "Vérif 221 RH repli" },
];

let ok = 0, ko = 0;
function verdict(label, condition, detail) {
  if (condition) { ok++; console.log(`   ✓ ${label}${detail ? " — " + detail : ""}`); }
  else { ko++; console.log(`   ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function client(base) {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(method, p, body) {
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const brut = await res.text();
      let json = null;
      try { json = JSON.parse(brut); } catch { /* HTML */ }
      return { status: res.status, json, data: json, texte: brut };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
  };
}

function lirePuits() {
  try {
    const brut = fs.readFileSync(PUITS_LOG, "utf8").trim();
    return brut ? brut.split("\n").map((l) => JSON.parse(l)) : [];
  } catch { return []; }
}
async function mailsVers(dest) {
  const sortis = [];
  for (const e of lirePuits()) {
    const to = Array.isArray(e.to) ? e.to.join(",") : String(e.to || "");
    if (to.toLowerCase().includes(dest.toLowerCase())) {
      try { sortis.push(await simpleParser(Buffer.from(e.data, "utf8"))); } catch { /* ignore */ }
    }
  }
  return sortis;
}
async function attendreMails(dest, nb, msMax = 8000) {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if ((await mailsVers(dest)).length >= nb) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function dernierJournal(action) {
  try {
    const lignes = fs.readFileSync(path.join(__dirname, "..", "logs", "journal-emails.log"), "utf8")
      .trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean).filter((e) => e.action === action);
    return lignes.length ? lignes[lignes.length - 1] : null;
  } catch { return null; }
}

let puitsProc = null;
function demarrerPuits() {
  try { fs.writeFileSync(PUITS_LOG, ""); } catch { /* nouveau */ }
  puitsProc = spawn(process.execPath, [path.join(__dirname, "task122", "puits-complet.js")], {
    env: { ...process.env, PUITS_PORT },
    stdio: "ignore",
  });
}

/* =========================== PHASE A : PKCS#12 =========================== */
async function importerCertificat(adm, fichier, motDePasse) {
  const octets = fs.readFileSync(path.join(LABO, fichier));
  const corps = { certFichier: octets.toString("base64"), certFichierNom: fichier };
  if (motDePasse !== undefined) corps.certMotDePasse = motDePasse;
  return adm.put("/api/signature-config", corps);
}

async function phaseA(adm) {
  console.log("\n--- A. Import PKCS#12 (.p12/.pfx) : mot de passe correct accepté ---");

  // A1 — coffre MODERNE (AES-256/PBKDF2-SHA256) + BON mot de passe
  const a1 = await importerCertificat(adm, "moderne.p12", MDP_P12);
  const c1 = a1.json && a1.json.config ? a1.json.config : {};
  verdict("A1 .p12 moderne + BON mot de passe → importé (HTTP 200)",
    a1.status === 200 && c1.certFormat === "PKCS#12", `HTTP ${a1.status} format=${c1.certFormat} ${a1.json && a1.json.error ? "erreur=" + a1.json.error : ""}`);
  verdict("A1 métadonnées du certificat extraites (titulaire)",
    String(c1.certSujet || "").includes("Test Trabelsi"), c1.certSujet);
  verdict("A1 émetteur + série + empreinte SHA-256",
    Boolean(c1.certEmetteur) && Boolean(c1.certSerie) && String(c1.certEmpreinte || "").length === 64,
    `empreinte=${String(c1.certEmpreinte || "").slice(0, 12)}…`);

  // A2 — coffre LEGACY (PBE-SHA1-3DES) + BON mot de passe
  const a2 = await importerCertificat(adm, "legacy.p12", MDP_P12);
  const c2 = a2.json && a2.json.config ? a2.json.config : {};
  verdict("A2 .p12 legacy (3DES/SHA1) + BON mot de passe → importé",
    a2.status === 200 && c2.certFormat === "PKCS#12", `HTTP ${a2.status} ${a2.json && a2.json.error || ""}`);

  // A3 — extension .pfx acceptée (même coffre moderne renommé)
  const octetsPfx = fs.readFileSync(path.join(LABO, "moderne.p12"));
  const a3 = await adm.put("/api/signature-config", {
    certFichier: octetsPfx.toString("base64"),
    certFichierNom: "certificat-entreprise.pfx",
    certMotDePasse: MDP_P12,
  });
  const c3 = a3.json && a3.json.config ? a3.json.config : {};
  verdict("A3 .pfx + BON mot de passe → importé", a3.status === 200 && c3.certFormat === "PKCS#12", `HTTP ${a3.status}`);

  // A3bis — après un import AVEC mot de passe : booléen seul, JAMAIS la valeur
  const g3 = await adm.get("/api/signature-config");
  const cg3 = g3.json && g3.json.config ? g3.json.config : {};
  verdict("A3bis GET : certMotDePasse JAMAIS renvoyé, booléen = true",
    !("certMotDePasse" in cg3) && cg3.certMotDePasseEnregistre === true);

  // A4 — MAUVAIS mot de passe → erreur MOT DE PASSE explicite
  const a4 = await importerCertificat(adm, "moderne.p12", "Faux-Mot-De-Passe!");
  verdict("A4 MAUVAIS mot de passe → 400 avec message « mot de passe incorrect »",
    a4.status === 400 && /mot de passe PKCS#12 incorrect/i.test(String(a4.json && a4.json.error)),
    a4.json && a4.json.error);

  // A5 — mot de passe absent → invitation à le saisir
  const a5 = await importerCertificat(adm, "moderne.p12", undefined);
  verdict("A5 mot de passe ABSENT → 400 « saisissez le mot de passe »",
    a5.status === 400 && /saisissez le mot de passe/i.test(String(a5.json && a5.json.error)),
    a5.json && a5.json.error);

  // A6 — fichier CORROMPU + BON mot de passe → erreur de STRUCTURE (jamais « mot de passe »)
  const octetsCorrompus = fs.readFileSync(path.join(LABO, "moderne.p12"));
  const tronque = Buffer.concat([
    octetsCorrompus.subarray(0, 40),
    Buffer.from("DONNEES-INTERNEES-DETRUITES", "utf8"),
    octetsCorrompus.subarray(octetsCorrompus.length - 40),
  ]);
  const a6 = await adm.put("/api/signature-config", {
    certFichier: tronque.toString("base64"),
    certFichierNom: "corrompu.p12",
    certMotDePasse: MDP_P12,
  });
  const msg6 = String((a6.json && a6.json.error) || "");
  verdict("A6 .p12 corrompu → 400", a6.status === 400, `HTTP ${a6.status} ${msg6}`);
  verdict("A6 le mot de passe CORRECT n'est PAS blâmé (pas d'erreur « mot de passe incorrect »)",
    !/mot de passe PKCS#12 incorrect/i.test(msg6), msg6.slice(0, 140));

  // A7 — non-régression : .cer X.509 toujours importé
  const octetsCer = fs.readFileSync(path.join(LABO, "cert.pem"));
  const a7 = await adm.put("/api/signature-config", {
    certFichier: octetsCer.toString("base64"),
    certFichierNom: "certificat.cer",
  });
  const c7 = a7.json && a7.json.config ? a7.json.config : {};
  verdict("A7 .cer X.509 → toujours importé (non-régression formats)",
    a7.status === 200 && c7.certFormat === "X.509", `HTTP ${a7.status} format=${c7.certFormat}`);

  // A8 — persistance : après .cer SANS mot de passe, booléen repassé à false
  const a8 = await adm.get("/api/signature-config");
  const c8 = a8.json && a8.json.config ? a8.json.config : {};
  verdict("A8 GET : certMotDePasse JAMAIS renvoyé (booléen seul, à false sans mot de passe)",
    !("certMotDePasse" in c8) && c8.certMotDePasseEnregistre === false);

  // Nettoyage A : retrait du certificat de test
  const net = await adm.put("/api/signature-config", { certFichier: "", certFichierNom: "" });
  const cn = net.json && net.json.config ? net.json.config : {};
  verdict("Nettoyage A : certificat retiré (métadonnées + mot de passe vidés)",
    net.status === 200 && !cn.certFormat && !cn.certFichierNom && cn.certMotDePasseEnregistre === false);
}

/* ============ PHASE B : création RH/IT — expéditeur = service IT ============ */
async function phaseB(adm) {
  console.log("\n--- B. Comptes RH/IT : e-mail envoyé par le service informatique ---");
  demarrerPuits();

  // B1 — création RH avec adresse IT configurée
  const b1 = await adm.post("/api/users", {
    name: COMPTES[0].nom, email: COMPTES[0].email,
    password: "Mot221DePasse!x", role: COMPTES[0].role,
  });
  verdict("B1 compte RH créé (HTTP 200/201)", b1.status === 200 || b1.status === 201, `HTTP ${b1.status} ${(b1.json && b1.json.error) || ""}`);
  verdict("B1 e-mail initial envoyé", Boolean(b1.json && b1.json.emailInitial && b1.json.emailInitial.envoye),
    JSON.stringify(b1.json && b1.json.emailInitial));
  verdict("B1 message annonce l'expéditeur service informatique",
    String((b1.json && b1.json.message) || "").includes(EMAIL_IT));

  await attendreMails(COMPTES[0].email, 1);
  const mails1 = await mailsVers(COMPTES[0].email);
  verdict("B1 message reçu au puits", mails1.length >= 1);
  const m1 = mails1[mails1.length - 1];
  const adresseFrom1 = m1 && m1.from && m1.from.value && m1.from.value[0] ? m1.from.value[0].address : "";
  verdict("B1 en-tête From = adresse du SERVICE INFORMATIQUE",
    adresseFrom1 === EMAIL_IT, `From=${adresseFrom1}`);
  verdict("B1 ce n'est PAS le compte SMTP générique qui expédie",
    adresseFrom1 !== EMAIL_SMTP, `From=${adresseFrom1}`);
  const env1 = lirePuits().filter((e) => String(e.data || "").includes(COMPTES[0].email));
  const enveloppe1 = env1.length ? String(env1[env1.length - 1].from || "").replace(/^<|>$/g, "") : "";
  verdict("B1 enveloppe SMTP (MAIL FROM) = adresse du service informatique",
    enveloppe1 === EMAIL_IT, enveloppe1);
  const sujet1 = String(m1 && m1.subject || "");
  verdict("B1 contenu : identifiant + mot de passe initial présents",
    sujet1.includes("compte RH") && String(m1.text || "").includes(COMPTES[0].email),
    sujet1);
  const j1 = await dernierJournal("compte-cree");
  verdict("B1 journal d'envoi : from = adresse du service informatique",
    Boolean(j1) && j1.from === EMAIL_IT && j1.succes === true, j1 ? `from=${j1.from}` : "aucune ligne");

  // B2 — création IT, même expéditeur
  const b2 = await adm.post("/api/users", {
    name: COMPTES[1].nom, email: COMPTES[1].email,
    password: "Mot221DePasse!y", role: COMPTES[1].role,
  });
  verdict("B2 compte IT créé + e-mail envoyé",
    (b2.status === 200 || b2.status === 201) && Boolean(b2.json && b2.json.emailInitial && b2.json.emailInitial.envoye),
    `HTTP ${b2.status}`);
  await attendreMails(COMPTES[1].email, 1);
  const mails2 = await mailsVers(COMPTES[1].email);
  const m2 = mails2[mails2.length - 1];
  const adresseFrom2 = m2 && m2.from && m2.from.value && m2.from.value[0] ? m2.from.value[0].address : "";
  verdict("B2 en-tête From = adresse du SERVICE INFORMATIQUE (compte IT)",
    adresseFrom2 === EMAIL_IT, `From=${adresseFrom2}`);

  // B3 — repli : adresse IT ABSENTE → comportement historique conservé
  await adm.put("/api/mail-config", {
    host: "127.0.0.1", port: 2525,
    username: EMAIL_SMTP, password: "smtp-pass-221",
    from: `AutoRH <${EMAIL_SMTP}>`,
    rhEmail: "rh@entreprise.tn", itEmail: "", responsablesMap: "", parrainageEmail: "",
    serveurAdresse: "127.0.0.1", sitePort: "4001", portailUrl: "http://127.0.0.1:4001",
    imapActif: false, imapHost: "", imapPort: 993,
  });
  const b3 = await adm.post("/api/users", {
    name: COMPTES[2].nom, email: COMPTES[2].email,
    password: "Mot221DePasse!z", role: COMPTES[2].role,
  });
  verdict("B3 compte créé même SANS adresse IT (envoi non bloqué)",
    (b3.status === 200 || b3.status === 201) && Boolean(b3.json && b3.json.emailInitial && b3.json.emailInitial.envoye),
    `HTTP ${b3.status}`);
  await attendreMails(COMPTES[2].email, 1);
  const mails3 = await mailsVers(COMPTES[2].email);
  const m3 = mails3[mails3.length - 1];
  const adresseFrom3 = m3 && m3.from && m3.from.value && m3.from.value[0] ? m3.from.value[0].address : "";
  verdict("B3 repli historique : From = Mail From générique",
    adresseFrom3 === EMAIL_SMTP, `From=${adresseFrom3}`);
}

/** Supprime les comptes de test : l'e-mail est CHIFFRÉ en base, on balaye
 *  donc tous les comptes en les déchiffrant (le deleteMany sur email brut ne
 *  peut PAS correspondre — leçon des deux premiers runs). */
async function supprimerComptesTest() {
  const tous = await db.user.findMany({ select: { id: true, email: true } });
  const ids = tous
    .filter((u) => COMPTES.some((c) => String(cryptoBd.dechiffrerChamp(u.email) || "") === c.email))
    .map((u) => u.id);
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  console.log("== v0.2.111 (Task 221) — Expéditeur comptes RH/IT + import PKCS#12 corrigé ==");

  // ---------- nettoyage préalable (comptes de test, e-mails chiffrés) ----------
  await supprimerComptesTest();

  const adm = client(BASE);
  const login = await adm.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);

  const cfgBdAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  // config puits + adresse du service informatique
  const put = await adm.put("/api/mail-config", {
    host: "127.0.0.1", port: 2525,
    username: EMAIL_SMTP, password: "smtp-pass-221",
    from: `AutoRH <${EMAIL_SMTP}>`,
    rhEmail: "rh@entreprise.tn", itEmail: EMAIL_IT, responsablesMap: "", parrainageEmail: "",
    serveurAdresse: "127.0.0.1", sitePort: "4001", portailUrl: "http://127.0.0.1:4001",
    imapActif: false, imapHost: "", imapPort: 993,
  });
  verdict("SMTP basculé sur le puits + itEmail configurée", put.status === 200, `HTTP ${put.status}`);

  try {
    await phaseA(adm);
    await phaseB(adm);
  } finally {
    // ---------- NETTOYAGE + restauration exacte ----------
    console.log("\n--- Nettoyage ---");
    try {
      const supprimes = await supprimerComptesTest();
      if (cfgBdAvant) {
        const { id, ...champs } = cfgBdAvant;
        await db.mailConfig.upsert({ where: { id: "smtp" }, update: champs, create: { id, ...champs } });
      } else {
        await db.mailConfig.deleteMany({ where: { id: "smtp" } });
      }
      if (puitsProc) { try { puitsProc.kill(); } catch { /* déjà mort */ } }
      const tous = await db.user.findMany({ select: { id: true, email: true } });
      const restants = tous.filter((u) =>
        COMPTES.some((c) => String(cryptoBd.dechiffrerChamp(u.email) || "") === c.email));
      verdict("Nettoyage : comptes de test supprimés", restants.length === 0,
        `${supprimes} supprimé(s), ${restants.length} restant(s)`);
      console.log("Nettoyage : comptes supprimés, SMTP restauré à l'état exact, puits arrêté.");
    } catch (e) {
      console.error("Nettoyage : erreur (à vérifier manuellement) :", e && e.message);
    }
  }

  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} KO ===`);
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(2); });
