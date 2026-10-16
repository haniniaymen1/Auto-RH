#!/usr/bin/env node
/**
 * v0.2.94 (Task 197, MODIFIÉ v0.2.196) — PREUVE E2E DE LA MAP DE
 * CONFIGURATION DES MAILS
 * ====================================================================
 * Une adresse e-mail DÉDIÉE par type de demande (panneau SMTP → routage) :
 *   1. ATTESTATION_TRAVAIL  → principal = boîte RH (v0.2.196 : restauré) +
 *      COPIE systématique à attestationTravailEmail (vide → AUCUNE copie) ;
 *   2. ATTESTATION_SALAIRE  → principal = boîte RH + COPIE à
 *      attestationSalaireEmail (idem) ;
 *   3. CONGE                → principal = manager responsable (v0.2.132) +
 *      COPIE systématique à congeEmail (vide → copie RH, v0.2.88 conservé) ;
 *   4. AUTORISATION_SORTIE  → principal = manager responsable + COPIE à
 *      autorisationEmail (idem) ;
 *   5. PARRAINAGE           → principal = parrainageEmail (v0.2.92, inchangé) +
 *      COPIE à parrainageCopieEmail (NOUVEAU v0.2.197, demande utilisateur
 *      « en copie du responsable principal du parrainage » — vide = aucune
 *      copie ; identique au principal = copie IGNORÉE et journalisée) ;
 *   6. CONFIRMATION AUTOMATIQUE au DEMANDEUR pour TOUS les types ;
 *   7. Validation API mail-config (adresses invalides → 400) ;
 *   8. Journal d'envoi : actions « demande-creation-copie-dediee » et
 *      « demande-creation-confirmation-demandeur » pour tous les types.
 *
 * Les destinataires RÉELS sont prouvés par un SMTP puits (capture RCPT TO).
 *
 * Usage : node scripts/test_v094_routage_emails.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const net = require("net");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();

const BASE = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const db = new PrismaClient();

const CIN_TEST = "TEST197001";
const FICHE_PDF = "e2e-197-fiche.pdf";
const EMAIL_DEMANDEUR = "employe197@test.tn";
const EMAIL_RH = "rh197@entreprise.tn";
const EMAIL_ATT_TRAVAIL = "att.travail197@entreprise.tn";
const EMAIL_ATT_SALAIRE = "att.salaire197@entreprise.tn";
const EMAIL_CONGE = "conge197@entreprise.tn";
const EMAIL_AUTORISATION = "autorisation197@entreprise.tn";
const EMAIL_PARRAINAGE = "parrainage197@entreprise.tn";
// (NOUVEAU v0.2.197) adresse en COPIE des demandes de parrainage — le
// responsable principal du parrainage reçoit une copie de chaque demande.
const EMAIL_PARRAINAGE_COPIE = "responsable.parrainage197@entreprise.tn";
// (MODIFIÉ v0.2.196 — mise à jour v0.2.132) le destinataire PRINCIPAL du
// congé et de l'autorisation est le MANAGER RESPONSABLE affecté à l'employé
// (PortalAccess.managerId) — plus AUCUN N+1 saisi.
const EMAIL_MANAGER = "manager197@entreprise.tn";
const CIN_MANAGER = "MAN197001";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

// --------------------------------------------------------------------
// Client HTTP avec cookies
// --------------------------------------------------------------------
function client(base = BASE) {
  let cookie = "";
  return {
    cookie() { return cookie; },
    async req(method, p, body, brut, entetes = {}) {
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...entetes,
        },
        body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const tampon = Buffer.from(await res.arrayBuffer());
      let json = null;
      try { json = JSON.parse(tampon.toString("utf8")); } catch { /* binaire */ }
      return { status: res.status, json, buf: tampon, texte: tampon.toString("utf8") };
    },
    get(p, e) { return this.req("GET", p, undefined, false, e || {}); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
    del(p, b) { return this.req("DELETE", p, b); },
  };
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function dossierStockage() {
  const racine = process.cwd();
  const candidats = [
    process.env.AUTO_RH_STORAGE_DIR || process.env.SERVICE_RH_STORAGE_DIR,
    process.env.STORAGE_DIR,
    path.join(racine, "storage", "payslips"),
    path.join(racine, ".next", "standalone", "storage", "payslips"),
  ].filter(Boolean);
  for (const c of candidats) if (fs.existsSync(c)) return c;
  fs.mkdirSync(candidats[2], { recursive: true });
  return candidats[2];
}

/** TOTP RFC 6238 (portail). */
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) {
    const v = A.indexOf(c.toUpperCase());
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}

// --------------------------------------------------------------------
// SMTP puits (capture RCPT TO — preuve réelle des destinataires)
// --------------------------------------------------------------------
function demarrerSmtpPuits(port) {
  const rcpts = [];
  const serveur = net.createServer((socket) => {
    socket.write("220 puits.local ESMTP\r\n");
    let tampon = "";
    let enData = false;
    socket.on("data", (chunk) => {
      tampon += chunk.toString();
      let idx;
      while ((idx = tampon.indexOf("\r\n")) >= 0) {
        const ligne = tampon.slice(0, idx);
        tampon = tampon.slice(idx + 2);
        if (enData) {
          if (ligne === ".") { enData = false; socket.write("250 OK data\r\n"); }
          continue;
        }
        const cmd = ligne.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          socket.write("250-puits.local\r\n250-SIZE 15728640\r\n250 OK\r\n");
        } else if (cmd.startsWith("MAIL FROM:")) {
          socket.write("250 OK\r\n");
        } else if (cmd.startsWith("RCPT TO:")) {
          const m = ligne.match(/<([^>]+)>/);
          if (m) rcpts.push(m[1].toLowerCase());
          socket.write("250 OK\r\n");
        } else if (cmd.startsWith("DATA")) {
          enData = true;
          socket.write("354 End with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resoudre) => serveur.listen(port, () => resoudre({ serveur, rcpts })));
}

const compte = (rcpts, dest) => rcpts.filter((r) => r === String(dest).toLowerCase()).length;

// --------------------------------------------------------------------
async function main() {
  console.log("== v0.2.94 — map de configuration des mails des demandes ==");
  const mailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });

  // PRÉ-NETTOYAGE (résilience — résidus d'un run antérieur interrompu) :
  // supprime les données de test AVANT de les recréer (le bloc finally ne
  // s'exécute pas si le processus est tué).
  {
    const cinDet0 = cryptoBd.chiffrerChamp(CIN_TEST, true);
    const cinMgr0 = cryptoBd.chiffrerChamp(CIN_MANAGER, true);
    const d1 = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet0 } });
    const d2 = await db.portalAccess.deleteMany({ where: { cin: cinDet0 } });
    const d2m = await db.portalAccess.deleteMany({ where: { cin: cinMgr0 } });
    const d3 = await db.payslip.deleteMany({ where: { fileName: FICHE_PDF } });
    const d4 = await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("it197@test.local", true) } });
    const d5 = await db.user.deleteMany({ where: { email: "it197@test.local" } });
    const res = [d1.count, d2.count + d2m.count, d3.count, d4.count + d5.count];
    if (res.some((n) => n > 0)) console.log(`Pré-nettoyage (résidus supprimés : demandes=${res[0]}, accès=${res[1]}, fiche=${res[2]}, user×${res[3]})`);
  }

  // Compte IT TEMPORAIRE (créé en base, supprimé au nettoyage) : la garde
  // mail-config est IT + SuperAdmin ; le mot de passe du superadmin réel
  // n'est pas manipulé par le test.
  const EMAIL_IT = "it197@test.local";
  // ⚠ User.email est chiffré DÉTERMINISTE par le middleware Prisma de
  // l'application (src/lib/db.ts + db-crypto.ts) : le login chiffre la
  // clause where de la même façon. Créé ici avec la jumelle JS
  // (lib-crypto-bd.js) pour que le serveur retrouve la ligne.
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL_IT, true) } });
  await db.user.deleteMany({ where: { email: EMAIL_IT } }); // résidu éventuel en clair
  await db.user.create({ data: {
    email: cryptoBd.chiffrerChamp(EMAIL_IT, true),
    name: cryptoBd.chiffrerChamp("IT Test 197"),
    passwordHash: hashScrypt("Test-197!ITpass"),
    role: "IT", isActive: true, passwordChangedAt: new Date(),
  } });

  // Configuration mail SEMÉE directement en base (le puits SMTP écoute déjà
  // sur 2525) — la section A vérifie ensuite l'API de configuration.
  await db.mailConfig.upsert({
    where: { id: "smtp" },
    create: { id: "smtp", host: "127.0.0.1", port: 2525, secure: false,
      from: "Auto-RH <auto-rh@test.local>", rhEmail: EMAIL_RH,
      parrainageEmail: EMAIL_PARRAINAGE, parrainageCopieEmail: EMAIL_PARRAINAGE_COPIE,
      attestationTravailEmail: EMAIL_ATT_TRAVAIL, attestationSalaireEmail: EMAIL_ATT_SALAIRE,
      congeEmail: EMAIL_CONGE, autorisationEmail: EMAIL_AUTORISATION },
    update: { host: "127.0.0.1", port: 2525, secure: false, username: null, password: null,
      from: "Auto-RH <auto-rh@test.local>", rhEmail: EMAIL_RH,
      parrainageEmail: EMAIL_PARRAINAGE, parrainageCopieEmail: EMAIL_PARRAINAGE_COPIE,
      attestationTravailEmail: EMAIL_ATT_TRAVAIL, attestationSalaireEmail: EMAIL_ATT_SALAIRE,
      congeEmail: EMAIL_CONGE, autorisationEmail: EMAIL_AUTORISATION },
  });

  // Fiche de paie (résolution automatique du nom de l'employé)
  const dossier = dossierStockage();
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.payslip.create({
    data: {
      fileName: FICHE_PDF, storedName: FICHE_PDF,
      fileSize: 1024,
      content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST, cinIndex: cinDet, employeeName: "Employe Demo 197",
      period: "09/2026", netSalary: "2 400,000",
    },
  });

  // Accès portail du MANAGER RESPONSABLE (v0.2.132 : destinataire principal
  // du congé et de l'autorisation de sortie — résolu par managerId).
  const mgrAcc = await db.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(CIN_MANAGER, true),
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Test-197!Mgr")),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      nomPrenom: cryptoBd.chiffrerChamp("Manager Test 197"),
      email: cryptoBd.chiffrerChamp(EMAIL_MANAGER),
    },
  });
  // Accès portail du demandeur (e-mail de notification = PortalAccess.email)
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Test-197!Pass")),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(TOTP),
      nomPrenom: cryptoBd.chiffrerChamp("Employe Demo 197"),
      email: cryptoBd.chiffrerChamp(EMAIL_DEMANDEUR),
      managerId: mgrAcc.id,
    },
  });
  console.log(`Semé : accès portail (${CIN_TEST}, ${EMAIL_DEMANDEUR}, manager ${EMAIL_MANAGER}) + fiche`);

  try {
    // =============================================================
    console.log("\n-- A. API mail-config : 4 adresses dédiées (validation + persistance) --");
    // =============================================================
    const sup = client();
    const login = await sup.post("/api/auth/login", {
      email: EMAIL_IT, password: "Test-197!ITpass",
    });
    check("A — Connexion compte IT temporaire", login.status === 200, `status=${login.status} ${JSON.stringify(login.json)}`);

    const put1 = await sup.put("/api/mail-config", {
      host: "127.0.0.1", port: 2525, from: "Auto-RH <auto-rh@test.local>",
      rhEmail: EMAIL_RH, itEmail: "", responsablesMap: "", parrainageEmail: EMAIL_PARRAINAGE,
      parrainageCopieEmail: EMAIL_PARRAINAGE_COPIE,
      attestationTravailEmail: EMAIL_ATT_TRAVAIL,
      attestationSalaireEmail: EMAIL_ATT_SALAIRE,
      congeEmail: EMAIL_CONGE,
      autorisationEmail: EMAIL_AUTORISATION,
    });
    check("A — PUT mail-config avec 4 adresses dédiées → 200", put1.status === 200, `status=${put1.status} ${JSON.stringify(put1.json)}`);

    const cfg = (await sup.get("/api/mail-config")).json?.config ?? {};
    check("A — GET : les 4 adresses dédiées PERSISTÉES",
      cfg.attestationTravailEmail === EMAIL_ATT_TRAVAIL &&
      cfg.attestationSalaireEmail === EMAIL_ATT_SALAIRE &&
      cfg.congeEmail === EMAIL_CONGE &&
      cfg.autorisationEmail === EMAIL_AUTORISATION,
      JSON.stringify({ t: cfg.attestationTravailEmail, s: cfg.attestationSalaireEmail, c: cfg.congeEmail, a: cfg.autorisationEmail }));
    check("A — GET : adresse en COPIE du parrainage PERSISTÉE (v0.2.197)",
      cfg.parrainageCopieEmail === EMAIL_PARRAINAGE_COPIE,
      JSON.stringify({ pc: cfg.parrainageCopieEmail }));

    const putInvalide = await sup.put("/api/mail-config", {
      host: "127.0.0.1", port: 2525, from: "Auto-RH <auto-rh@test.local>",
      rhEmail: EMAIL_RH, parrainageEmail: EMAIL_PARRAINAGE,
      parrainageCopieEmail: EMAIL_PARRAINAGE_COPIE,
      attestationTravailEmail: EMAIL_ATT_TRAVAIL,
      attestationSalaireEmail: EMAIL_ATT_SALAIRE,
      congeEmail: "pas-un-email",
      autorisationEmail: EMAIL_AUTORISATION,
    });
    check("A — PUT congeEmail invalide → 400 + message dédié", putInvalide.status === 400 &&
      String(putInvalide.json?.error || "").includes("demandes de congé"), `status=${putInvalide.status} ${JSON.stringify(putInvalide.json)}`);

    const putParrCopieInvalide = await sup.put("/api/mail-config", {
      host: "127.0.0.1", port: 2525, from: "Auto-RH <auto-rh@test.local>",
      rhEmail: EMAIL_RH, parrainageEmail: EMAIL_PARRAINAGE,
      parrainageCopieEmail: "copie-parrainage-invalide",
      attestationTravailEmail: EMAIL_ATT_TRAVAIL,
      attestationSalaireEmail: EMAIL_ATT_SALAIRE,
      congeEmail: EMAIL_CONGE,
      autorisationEmail: EMAIL_AUTORISATION,
    });
    check("A — PUT parrainageCopieEmail invalide → 400 + message dédié (v0.2.197)", putParrCopieInvalide.status === 400 &&
      String(putParrCopieInvalide.json?.error || "").includes("en copie des demandes de parrainage"), `status=${putParrCopieInvalide.status} ${JSON.stringify(putParrCopieInvalide.json)}`);

    // =============================================================
    console.log("\n-- B. Routage portail : les 5 types (destinataires réels, SMTP puits) --");
    // =============================================================
    // (v0.2.197) horodatage de DÉBUT des soumissions : la section G ne
    // retient que les entrées de journal de CE run (le fichier est cumulatif —
    // plusieurs runs/tests y écrivent).
    const t0Run = Date.now() - 5000; // marge 5 s (horodatage = date d'écriture)
    const { serveur: smtpPuits, rcpts } = await demarrerSmtpPuits(2525);
    console.log("SMTP puits en écoute sur 127.0.0.1:2525");

    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST, password: "Test-197!Pass", otp: totpNow(TOTP), remember: false,
    });
    check("B — Connexion portail (CIN + mot de passe + OTP)", verif.status === 200 && verif.json?.ok, `status=${verif.status} ${JSON.stringify(verif.json)}`);

    const att1 = await port.post("/api/demandes", { type: "ATTESTATION_TRAVAIL" });
    check("B — ATTESTATION_TRAVAIL → 201, destinataire PRINCIPAL = boîte RH (v0.2.196)",
      att1.status === 201 && att1.json?.destinataire === EMAIL_RH,
      `status=${att1.status} dest=${att1.json?.destinataire}`);

    const att2 = await port.post("/api/demandes", { type: "ATTESTATION_SALAIRE" });
    check("B — ATTESTATION_SALAIRE → 201, destinataire PRINCIPAL = boîte RH (v0.2.196)",
      att2.status === 201 && att2.json?.destinataire === EMAIL_RH,
      `status=${att2.status} dest=${att2.json?.destinataire}`);

    const cong = await port.post("/api/demandes", {
      type: "CONGE", typeConge: "Congé annuel",
      dateDebut: "2026-10-01", dateFin: "2026-10-05",
      commentaire: "Congé test 197",
    });
    check("C — CONGE → 201, destinataire PRINCIPAL = manager responsable (v0.2.132)",
      cong.status === 201 && cong.json?.destinataire === EMAIL_MANAGER,
      `status=${cong.status} dest=${cong.json?.destinataire}`);

    const auto = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE", date: "2026-10-02",
      motif: "Rendez-vous médical",
      nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00",
    });
    check("C — AUTORISATION_SORTIE → 201, destinataire PRINCIPAL = manager responsable (v0.2.132)",
      auto.status === 201 && auto.json?.destinataire === EMAIL_MANAGER,
      `status=${auto.status} dest=${auto.json?.destinataire}`);

    const parr = await port.post("/api/demandes", {
      type: "PARRAINAGE", dateParrainage: "2026-09-26",
      operation: "Opération Test 197", nomFilleul: "Filleul Test 197", telFilleul: "+216 20 111 197",
    });
    check("D — PARRAINAGE → 201, destinataire = adresse DÉDIÉE parrainage (inchangé)",
      parr.status === 201 && parr.json?.destinataire === EMAIL_PARRAINAGE,
      `status=${parr.status} dest=${parr.json?.destinataire}`);

    // Laisse les envois d'arrière-plan se terminer
    await new Promise((r) => setTimeout(r, 3500));

    // =============================================================
    console.log("\n-- E. SMTP puits : destinataires RÉELS (principal + copie + confirmation) --");
    // =============================================================
    check(`E — Attestation de travail : COPIE partie à l'adresse dédiée (${EMAIL_ATT_TRAVAIL})`, compte(rcpts, EMAIL_ATT_TRAVAIL) === 1, JSON.stringify(rcpts));
    check(`E — Attestation de salaire : COPIE partie à l'adresse dédiée (${EMAIL_ATT_SALAIRE})`, compte(rcpts, EMAIL_ATT_SALAIRE) === 1);
    check("E — Attestations : les 2 e-mails PRINCIPAUX partis à la boîte RH (v0.2.196)", compte(rcpts, EMAIL_RH) === 2, `reçus=${compte(rcpts, EMAIL_RH)}`);
    check(`E — Congé : e-mail PRINCIPAL parti au manager responsable (${EMAIL_MANAGER})`, compte(rcpts, EMAIL_MANAGER) === 2, `reçus=${compte(rcpts, EMAIL_MANAGER)}`);
    check(`E — Congé : COPIE dédiée partielle (${EMAIL_CONGE})`, compte(rcpts, EMAIL_CONGE) === 1);
    check(`E — Autorisation : COPIE dédiée partielle (${EMAIL_AUTORISATION})`, compte(rcpts, EMAIL_AUTORISATION) === 1);
    check(`E — Parrainage parti à l'adresse dédiée (${EMAIL_PARRAINAGE})`, compte(rcpts, EMAIL_PARRAINAGE) === 1);
    check(`E — Parrainage : COPIE partie au responsable principal (v0.2.197, ${EMAIL_PARRAINAGE_COPIE})`, compte(rcpts, EMAIL_PARRAINAGE_COPIE) === 1, JSON.stringify(rcpts));
    check(`E — CONFIRMATION au DEMANDEUR pour les 5 types (${EMAIL_DEMANDEUR})`, compte(rcpts, EMAIL_DEMANDEUR) === 5, `reçues=${compte(rcpts, EMAIL_DEMANDEUR)}`);

    // =============================================================
    console.log("\n-- F. Attestation sans adresse dédiée : AUCUNE copie, principal RH --");
    // =============================================================
    const rhAvantF = compte(rcpts, EMAIL_RH);
    await db.mailConfig.update({ where: { id: "smtp" }, data: { attestationTravailEmail: "" } });
    const att3 = await port.post("/api/demandes", { type: "ATTESTATION_TRAVAIL" });
    check("F — ATTESTATION_TRAVAIL sans adresse dédiée → 201, destinataire = boîte RH",
      att3.status === 201 && att3.json?.destinataire === EMAIL_RH,
      `status=${att3.status} dest=${att3.json?.destinataire}`);
    await new Promise((r) => setTimeout(r, 2000));
    check("F — SMTP : le principal RH a REÇU l'e-mail de traitement (3ᵉ attestation)",
      compte(rcpts, EMAIL_RH) === rhAvantF + 1, `reçus=${compte(rcpts, EMAIL_RH)} (attendu ${rhAvantF + 1})`);
    check("F — SMTP : AUCUNE copie dédiée supplémentaire (adresse vidée)",
      compte(rcpts, EMAIL_ATT_TRAVAIL) === 1, `reçues=${compte(rcpts, EMAIL_ATT_TRAVAIL)}`);
    await db.mailConfig.update({ where: { id: "smtp" }, data: { attestationTravailEmail: EMAIL_ATT_TRAVAIL } });

    // =============================================================
    console.log("\n-- G. Journal d'envoi : actions copie dédiée + confirmations --");
    // =============================================================
    const jrn = await sup.get("/api/demandes/journal");
    const itemsTous = jrn.json?.items ?? [];
    // (v0.2.197) SEULEMENT les entrées de CE run (journal cumulatif).
    const items = itemsTous.filter((i) => {
      const t = Date.parse(i.horodatage || "");
      return Number.isFinite(t) && t >= t0Run;
    });
    const actionsCopie = items.filter((i) => i.action === "demande-creation-copie-dediee");
    const actionsConf = items.filter((i) => i.action === "demande-creation-confirmation-demandeur");
    check("G — Journal : actions « demande-creation-copie-dediee » présentes (congé + autorisation + 2 attestations)",
      jrn.status === 200 && actionsCopie.length >= 4, `trouvées=${actionsCopie.length} status=${jrn.status}`);
    check("G — Copies dédiées adressées aux bonnes boîtes",
      actionsCopie.length >= 5 &&
      actionsCopie.every((i) => (i.type === "CONGE" && i.dest === EMAIL_CONGE) ||
        (i.type === "AUTORISATION_SORTIE" && i.dest === EMAIL_AUTORISATION) ||
        (i.type === "ATTESTATION_TRAVAIL" && i.dest === EMAIL_ATT_TRAVAIL) ||
        (i.type === "ATTESTATION_SALAIRE" && i.dest === EMAIL_ATT_SALAIRE) ||
        (i.type === "PARRAINAGE" && i.dest === EMAIL_PARRAINAGE_COPIE)),
      JSON.stringify(actionsCopie.map((i) => ({ d: i.dest, t: i.type }))));
    check("G — Journal : 6 confirmations demandeur (5 types + repli)",
      actionsConf.length >= 6 && actionsConf.every((i) => i.dest === EMAIL_DEMANDEUR),
      `trouvées=${actionsConf.length}`);

    // =============================================================
    console.log("\n-- H. Parrainage : copie identique au principal = IGNORÉE + JOURNALISÉE (v0.2.197) --");
    // =============================================================
    await db.mailConfig.update({ where: { id: "smtp" }, data: { parrainageCopieEmail: EMAIL_PARRAINAGE } });
    const parr2 = await port.post("/api/demandes", {
      type: "PARRAINAGE", dateParrainage: "2026-09-27",
      operation: "Opération Test 197 bis", nomFilleul: "Filleul Test 197 bis", telFilleul: "+216 20 111 198",
    });
    check("H — PARRAINAGE (copie = principal) → 201", parr2.status === 201, `status=${parr2.status} ${JSON.stringify(parr2.json)}`);
    await new Promise((r) => setTimeout(r, 2000));
    check("H — SMTP : AUCUN doublon (une seule boîte reçoit, 2 messages au total pour le parrainage)",
      compte(rcpts, EMAIL_PARRAINAGE) === 2 && compte(rcpts, EMAIL_PARRAINAGE_COPIE) === 1,
      `parrainage=${compte(rcpts, EMAIL_PARRAINAGE)} copie=${compte(rcpts, EMAIL_PARRAINAGE_COPIE)}`);
    const jrnH = await sup.get("/api/demandes/journal");
    const ignorees = (jrnH.json?.items ?? []).filter((i) => {
      const t = Date.parse(i.horodatage || "");
      return i.action === "demande-creation-copie-ignoree" && Number.isFinite(t) && t >= t0Run;
    });
    check("H — Journal : action « demande-creation-copie-ignoree » présente (COPIE_IDENTIQUE_PRINCIPAL)",
      jrnH.status === 200 && ignorees.some((i) => i.type === "PARRAINAGE" && i.dest === EMAIL_PARRAINAGE),
      JSON.stringify(ignorees.slice(0, 2)));
    await db.mailConfig.update({ where: { id: "smtp" }, data: { parrainageCopieEmail: EMAIL_PARRAINAGE_COPIE } });

    smtpPuits.close();
  } finally {
    // -------------------------------------------------------------
    // Nettoyage complet
    // -------------------------------------------------------------
    try {
      await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
      await db.portalAccess.deleteMany({ where: { cin: cinDet } });
      await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_MANAGER, true) } });
      await db.payslip.deleteMany({ where: { fileName: FICHE_PDF } });
      await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("it197@test.local", true) } });
      await db.user.deleteMany({ where: { email: "it197@test.local" } });
      if (mailAvant) {
        await db.mailConfig.update({ where: { id: "smtp" }, data: {
          host: mailAvant.host, port: mailAvant.port, secure: mailAvant.secure,
          rhEmail: mailAvant.rhEmail, parrainageEmail: mailAvant.parrainageEmail,
          parrainageCopieEmail: mailAvant.parrainageCopieEmail ?? "",
          responsablesMap: mailAvant.responsablesMap,
          attestationTravailEmail: mailAvant.attestationTravailEmail ?? "",
          attestationSalaireEmail: mailAvant.attestationSalaireEmail ?? "",
          congeEmail: mailAvant.congeEmail ?? "",
          autorisationEmail: mailAvant.autorisationEmail ?? "",
        } }).catch(() => {});
      }
      console.log("\nNettoyage effectué (demandes, accès, fiche, config mail restaurée).");
    } catch (e) {
      console.error("Nettoyage partiel:", e.message);
    }
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
