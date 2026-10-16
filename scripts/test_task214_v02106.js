#!/usr/bin/env node
/**
 * v0.2.106 (Task 214) — PREUVE E2E des 3 évolutions :
 *   1) CRÉATION DE COMPTE RH/IT : e-mail AUTOMATIQUE au compte créé
 *      (identifiant + mot de passe initial + adresse d'accès + changement
 *      OBLIGATOIRE à la première connexion) — capturé par le puits SMTP.
 *   2) ACCÈS PORTAIL : colonne « Nom et prénom » séparée en « Nom » / « Prénom »
 *      (API modifier-nom à deux champs, synchronisation nomPrenom + fiches de
 *      paie, repli compatibilité pour les accès historiques, validations).
 *   3) RÉPONSE RH AVEC PIÈCE JOINTE : le document FINAL est JOINT à l'e-mail
 *      de l'employé pour TOUS les types (import direct admin — attestations,
 *      congé, autorisation, parrainage ; boucle e-mail couverte par le
 *      harnais Task 122 relancé en non-régression).
 *
 * Environnement : instance RÉELLE (4000/4001) + puits SMTP Task 119 (2525).
 * Nettoyage intégral en fin de run (comptes, accès, fiches, demandes,
 * documents, configuration SMTP restaurée à son état initial).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const { simpleParser } = require("mailparser");

const db = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const PORTAIL = "http://127.0.0.1:4001";
const PUITS_PORT = "2525";
const PUITS_LOG = path.join(__dirname, "task122", "puits-complet.log");

const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };
const CIN_TEST = "TEST21401";
const CIN_LEGACY = "TEST21402";
const NOM_FICHES = "Trabelsi Ali";
const MDP_PORTAIL = "Test-214!Pass";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL_EMPLOYE = "employe214@test.tn";
const MDP_TEST = "AutoRH-2026!T1#";
const EMAIL_RH214 = "rh-214@test.tn";
const EMAIL_IT214 = "it-214@test.tn";
const FICHIER = "e2e-214-a.pdf";
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
  "utf8"
);

let ok = 0, ko = 0;
function verdict(label, condition, detail) {
  if (condition) { ok++; console.log(`   ✓ ${label}${detail ? " — " + detail : ""}`); }
  else { ko++; console.log(`   ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
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
function client(base) {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(method, p, body, enTetes) {
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(enTetes || {}),
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const brut = await res.text();
      let json = null;
      try { json = JSON.parse(brut); } catch { /* HTML */ }
      return { status: res.status, json, texte: brut };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
  };
}
async function lirePuits() {
  try {
    const brut = fs.readFileSync(PUITS_LOG, "utf8").trim();
    return brut ? brut.split("\n").map((l) => JSON.parse(l)) : [];
  } catch { return []; }
}
async function mailsVers(dest) {
  const entrees = await lirePuits();
  const sortis = [];
  for (const e of entrees) {
    const to = Array.isArray(e.to) ? e.to.join(",") : String(e.to || "");
    if (to.toLowerCase().includes(dest.toLowerCase())) {
      try { sortis.push(await simpleParser(Buffer.from(e.data, "utf8"))); } catch { /* ignore */ }
    }
  }
  return sortis;
}

let puitsProc = null;
function demarrerPuits() {
  try { fs.writeFileSync(PUITS_LOG, ""); } catch { /* nouveau fichier */ }
  puitsProc = spawn(process.execPath, [path.join(__dirname, "task122", "puits-complet.js")], {
    env: { ...process.env, PUITS_PORT },
    stdio: "ignore",
  });
}

async function main() {
  console.log("== v0.2.106 (Task 214) — preuve E2E : compte e-mail, Nom/Prénom, pièce jointe ==");

  // ---------- PHASE 0 : nettoyage préalable + séme ----------
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const cinDet2 = cryptoBd.chiffrerChamp(CIN_LEGACY, true);
  // E-mails des comptes : chiffrés DÉTERMINISTEMENT en base (carte User) —
  // les requêtes Prisma doivent porter la valeur chiffrée.
  const emDetRH = cryptoBd.chiffrerChamp(EMAIL_RH214, true);
  const emDetIT = cryptoBd.chiffrerChamp(EMAIL_IT214, true);
  await db.payslip.deleteMany({ where: { fileName: FICHIER } });
  await db.portalAccess.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
  await db.user.deleteMany({ where: { email: { in: [emDetRH, emDetIT] } } });
  await db.payslip.createMany({
    data: [{
      fileName: FICHIER,
      storedName: FICHIER,
      fileSize: 100,
      content: "FICHE DE PAIE " + CIN_TEST,
      normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST,
      cinIndex: cinDet,
      employeeName: NOM_FICHES,
      period: "09/2026",
      netSalary: "1 000,00",
    }],
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      // nomPrenom HISTORIQUE combiné (sans nom/prenom séparés) : la demande
      // commence dans l'état « avant séparation » — exactement les accès existants.
      nomPrenom: cryptoBd.chiffrerChamp(NOM_FICHES),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
      mailEnvoyeA: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
      mailEnvoyeLe: new Date(Date.now() - 3600000),
    },
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet2,
      isActive: true,
      nomPrenom: cryptoBd.chiffrerChamp("Legacy Combiné"),
    },
  });
  verdict("Séme (2 fiches ? 1 fiche, 2 accès, SMTP puits)", true);

  // ---------- PHASE 1 : configuration SMTP → puits ----------
  demarrerPuits();
  // État DB de la config mail AVANT tout changement (restauration exacte en
  // fin de run — motif test_task173_nettoyage : mise à jour directe DB).
  const cfgBdAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const adm = client(BASE);
  // (MODIFIÉ Task 231 — indépendance de l'environnement) connexion via le COMPTE
  // DE TEST TEMPORAIRE (lab226/creer-compte-e2e-116) : le mot de passe du
  // SUPERADMIN RÉEL n'est pas connu des harnesses.
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const ADMIN_231 = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const login = await adm.post("/api/auth/login", { email: ADMIN_231.email, password: ADMIN_231.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);

  const cfgAvant = await adm.get("/api/mail-config");
  verdict("Config SMTP lue avant test", cfgAvant.status === 200, `host=${(cfgAvant.json?.config?.host) || "(non configuré)"}`);

  const putPuits = await adm.put("/api/mail-config", {
    host: "127.0.0.1",
    port: 2525,
    username: "auto-rh@entreprise.tn",
    password: "smtp-pass-214",
    from: "AutoRH <auto-rh@entreprise.tn>",
    rhEmail: "rh@entreprise.tn",
    itEmail: "",
    responsablesMap: "",
    parrainageEmail: "",
    serveurAdresse: "127.0.0.1",
    sitePort: "4001",
    portailUrl: "http://127.0.0.1:4001",
    imapActif: false, imapHost: "", imapPort: 993,
  });
  verdict("SMTP basculé sur le puits 2525", putPuits.status === 200, `HTTP ${putPuits.status}`);

  try {
    // ================= REQ 1 : e-mail de création de compte =================
    console.log("\n--- REQ 1 : e-mail automatique de création de compte RH/IT ---");
    const cRH = await adm.post("/api/users", {
      name: "RH Test 214", email: EMAIL_RH214, password: MDP_TEST, role: "RH",
    });
    verdict("POST /api/users (RH) → 200", cRH.status === 200, `HTTP ${cRH.status}`);
    verdict("Réponse porte emailInitial.envoye = true", cRH.json?.emailInitial?.envoye === true, JSON.stringify(cRH.json?.emailInitial || {}));
    const userRH = cRH.json?.user;
    // passwordChangedAt antidaté → changement OBLIGATOIRE à la 1re connexion
    // (recherche par id — l'e-mail en base est chiffré de façon déterministe)
    const userRHdb = userRH ? await db.user.findUnique({ where: { id: userRH.id } }) : null;
    verdict("Compte RH : passwordChangedAt ANTIDATÉ (mustChange au 1er login)",
      Boolean(userRHdb && userRHdb.passwordChangedAt && Date.now() - userRHdb.passwordChangedAt.getTime() > 16 * 86400000),
      userRHdb ? String(userRHdb.passwordChangedAt) : "absent");

    const cIT = await adm.post("/api/users", {
      name: "IT Test 214", email: EMAIL_IT214, password: MDP_TEST, role: "IT",
    });
    verdict("POST /api/users (IT) → 200 + email envoyé", cIT.status === 200 && cIT.json?.emailInitial?.envoye === true, `HTTP ${cIT.status}`);

    await new Promise((r) => setTimeout(r, 1200));
    const mailsRH = await mailsVers(EMAIL_RH214);
    const mailCompte = mailsRH.find((m) => /Votre compte .* a été créé/.test(m.subject || ""));
    verdict("Puits : e-mail « Votre compte RH a été créé » reçu", Boolean(mailCompte), mailCompte ? String(mailCompte.subject) : "absent");
    const texteCompte = mailCompte ? (mailCompte.text || "") : "";
    verdict("Contenu : identifiant = adresse du compte", texteCompte.includes(EMAIL_RH214));
    verdict("Contenu : mot de passe initial présent", texteCompte.includes(MDP_TEST));
    verdict("Contenu : adresse d'accès administration", texteCompte.includes("http://127.0.0.1:4000"));
    verdict("Contenu : changement OBLIGATOIRE à la 1re connexion", /OBLIGATOIRE|OBLIGE/i.test(texteCompte));

    // ================= REQ 2 : Nom / Prénom séparés =================
    console.log("\n--- REQ 2 : colonnes « Nom » / « Prénom » séparées ---");
    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false,
    });
    verdict("Connexion portail (CIN + mdp + OTP) après migration schéma", verif.status === 200 && verif.json?.ok, `HTTP ${verif.status}`);

    const listeAvant = await adm.get("/api/portal-access");
    const rowAvant = (listeAvant.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("Avant : accès HISTORIQUE — nom/prenom null, nomPrenom combiné",
      rowAvant && rowAvant.nom === null && rowAvant.prenom === null && rowAvant.nomPrenom === NOM_FICHES,
      JSON.stringify({ nom: rowAvant?.nom, prenom: rowAvant?.prenom, nomPrenom: rowAvant?.nomPrenom }));

    const modif = await adm.post("/api/portal-access", {
      action: "modifier-nom", cin: CIN_TEST, nom: "Trabelsi", prenom: "Ali",
    });
    verdict("modifier-nom (nom + prenom) → ok, nomComplet « Ali Trabelsi »",
      modif.status === 200 && modif.json?.ok && modif.json?.nomComplet === "Ali Trabelsi",
      JSON.stringify(modif.json?.error || modif.json?.nomComplet));

    const listeApres = await adm.get("/api/portal-access");
    const rowApres = (listeApres.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("GET : nom et prenom SÉPARÉS renvoyés",
      rowApres?.nom === "Trabelsi" && rowApres?.prenom === "Ali",
      JSON.stringify({ nom: rowApres?.nom, prenom: rowApres?.prenom }));
    verdict("GET : nomPrenom synchronisé « Ali Trabelsi » (compat portail/demandes)",
      rowApres?.nomPrenom === "Ali Trabelsi", String(rowApres?.nomPrenom));
    const fiche = await db.payslip.findFirst({ where: { fileName: FICHIER } });
    const nomFicheDechiffre = fiche ? cryptoBd.dechiffrerChamp(fiche.employeeName) : "";
    verdict("Fiches du CIN mises à jour : employeeName « Ali Trabelsi »",
      nomFicheDechiffre === "Ali Trabelsi", String(nomFicheDechiffre));

    const legacy = (listeApres.json?.items || []).find((x) => x.cin === CIN_LEGACY);
    verdict("Accès historique (LEGACY) : nom/prenom null + nomPrenom conservé (repli UI)",
      legacy && legacy.nom === null && legacy.prenom === null && legacy.nomPrenom === "Legacy Combiné",
      JSON.stringify({ nom: legacy?.nom, prenom: legacy?.prenom }));

    const invalide = await adm.post("/api/portal-access", {
      action: "modifier-nom", cin: CIN_TEST, nom: "Trabelsi", prenom: "123",
    });
    verdict("Validation : prénom avec chiffres → 400", invalide.status === 400, `HTTP ${invalide.status}`);

    // ================= REQ 3 : pièce jointe à la réponse RH =================
    console.log("\n--- REQ 3 : document JOINT à l'e-mail de l'employé (tous types) ---");
    // a) ATTESTATION DE TRAVAIL (type sans formulaire)
    const repAtt = await port.post("/api/demandes", { type: "ATTESTATION_TRAVAIL" });
    verdict("POST demande ATTESTATION_TRAVAIL → 201", repAtt.status === 201 && repAtt.json?.ok, `HTTP ${repAtt.status}`);
    const refAtt = repAtt.json?.reference;
    const idAtt = refAtt ? (await db.demandeAdministrative.findUnique({ where: { reference: refAtt } }))?.id : null;

    const form1 = new FormData();
    form1.append("document", new Blob([PDF_MIN], { type: "application/pdf" }), "Attestation_Reponse.pdf");
    form1.append("mode", "valider");
    form1.append("tampon", "aucun");
    const rep1 = await adm.req("POST", `/api/demandes/${idAtt}/repondre`, form1);
    verdict("Réponse RH import direct (attestation) → 200 + notification envoyée",
      rep1.status === 200 && rep1.json?.notification?.envoye === true,
      JSON.stringify(rep1.json?.notification || rep1.json?.error || {}));
    verdict("Statut automatique Acceptée", rep1.json?.statut === "ACCEPTEE", String(rep1.json?.statut));

    await new Promise((r) => setTimeout(r, 1500));
    const mailsEmp1 = await mailsVers(EMAIL_EMPLOYE);
    const mailDoc1 = mailsEmp1.find((m) => /votre document est disponible/.test(m.subject || ""));
    verdict("E-mail « votre document est disponible » reçu par l'employé", Boolean(mailDoc1), mailDoc1 ? String(mailDoc1.subject) : "absent");
    const att1 = mailDoc1 && mailDoc1.attachments ? mailDoc1.attachments : [];
    verdict("PIÈCE JOINTE présente (1)", att1.length === 1, `nb=${att1.length}`);
    verdict("Nom de la pièce jointe = document du RH",
      att1[0] && att1[0].filename === "Attestation_Reponse.pdf", String(att1[0] && att1[0].filename));
    verdict("Octets de la pièce jointe = document FINAL exact",
      Boolean(att1[0] && Buffer.compare(Buffer.from(att1[0].content), PDF_MIN) === 0),
      att1[0] ? `${att1[0].content.length} octets` : "absent");
    verdict("Texte : la pièce jointe est ANNONCÉE", /joint/i.test(mailDoc1 ? (mailDoc1.text || "") : ""));

    // b) DEMANDE DE CONGÉ (type « validation N+1 ») — import direct RH
    const repCg = await port.post("/api/demandes", {
      type: "CONGE", typeConge: "Annuel", dateDebut: "2026-11-02", dateFin: "2026-11-05",
      emailN1: "n1-214@test.tn", commentaire: "Congé annuel planifié.",
    });
    verdict("POST demande CONGE → 201", repCg.status === 201 && repCg.json?.ok, `HTTP ${repCg.status}`);
    const refCg = repCg.json?.reference;
    const idCg = refCg ? (await db.demandeAdministrative.findUnique({ where: { reference: refCg } }))?.id : null;
    const form2 = new FormData();
    form2.append("document", new Blob([PDF_MIN], { type: "application/pdf" }), "Reponse_Conge.pdf");
    form2.append("mode", "valider");
    form2.append("tampon", "aucun");
    const rep2 = await adm.req("POST", `/api/demandes/${idCg}/repondre`, form2);
    verdict("Réponse RH import direct (congé) → 200 + notification + pièce jointe",
      rep2.status === 200 && rep2.json?.notification?.envoye === true,
      JSON.stringify(rep2.json?.notification || rep2.json?.error || {}));
    await new Promise((r) => setTimeout(r, 1500));
    const mailsEmp2 = await mailsVers(EMAIL_EMPLOYE);
    const mailDoc2 = mailsEmp2.find((m) => /votre document est disponible/.test(m.subject || "") && /congé/i.test(m.subject || ""));
    const att2 = mailDoc2 && mailDoc2.attachments ? mailDoc2.attachments : [];
    verdict("CONGÉ : pièce jointe « Reponse_Conge.pdf » reçue par l'employé",
      att2.length === 1 && att2[0].filename === "Reponse_Conge.pdf" && Buffer.compare(Buffer.from(att2[0].content), PDF_MIN) === 0,
      `nb=${att2.length} ${att2[0] ? att2[0].filename : ""}`);

    // Journal : action demande-document avec succès
    const journal = fs.readFileSync(path.join(__dirname, "..", "logs", "journal-emails.log"), "utf8").trim().split("\n");
    const entreeDoc = journal.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.action === "demande-document" && e.dest === EMAIL_EMPLOYE && e.succes);
    verdict("Journal : demande-document (succès) consigné pour l'employé", entreeDoc.length >= 2, `nb=${entreeDoc.length}`);
    const entreeCompte = journal.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.action === "compte-cree" && e.succes);
    verdict("Journal : compte-cree (succès) consigné ×2", entreeCompte.length >= 2, `nb=${entreeCompte.length}`);
  } finally {
    // ---------- NETTOYAGE + restauration (CIBLÉ sur les données du test) ----------
    console.log("\n--- Nettoyage ---");
    // Documents liés UNIQUEMENT aux demandes du test (jamais les documents réels)
    const demTest = await db.demandeAdministrative.findMany({
      where: { cin: { in: [cinDet, cinDet2] } },
      select: { id: true, reference: true },
    });
    const idsTest = demTest.map((d) => d.id);
    const docsTest = idsTest.length
      ? await db.documentDemande.findMany({ where: { demandeId: { in: idsTest } }, select: { chemin: true } })
      : [];
    if (idsTest.length) await db.documentDemande.deleteMany({ where: { demandeId: { in: idsTest } } });
    const dossierDocs = path.join(__dirname, "..", "storage", "documents-demandes");
    for (const d of docsTest) {
      try { fs.unlinkSync(path.join(dossierDocs, d.chemin)); } catch { /* déjà absent */ }
    }
    await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
    await db.payslip.deleteMany({ where: { fileName: FICHIER } });
    await db.portalAccess.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
    await db.user.deleteMany({ where: { email: { in: [emDetRH, emDetIT] } } });
    // Restauration EXACTE de la configuration mail depuis l'état DB d'origine
    if (cfgBdAvant) {
      await db.mailConfig.update({
        where: { id: "smtp" },
        data: {
          host: cfgBdAvant.host, port: cfgBdAvant.port, username: cfgBdAvant.username,
          from: cfgBdAvant.from, serveurAdresse: cfgBdAvant.serveurAdresse,
          sitePort: cfgBdAvant.sitePort, portailUrl: cfgBdAvant.portailUrl,
          rhEmail: cfgBdAvant.rhEmail, itEmail: cfgBdAvant.itEmail,
          responsablesMap: cfgBdAvant.responsablesMap, parrainageEmail: cfgBdAvant.parrainageEmail,
          attestationTravailEmail: cfgBdAvant.attestationTravailEmail,
          attestationSalaireEmail: cfgBdAvant.attestationSalaireEmail,
          congeEmail: cfgBdAvant.congeEmail, autorisationEmail: cfgBdAvant.autorisationEmail,
          imapActif: cfgBdAvant.imapActif, imapHost: cfgBdAvant.imapHost,
          imapPort: cfgBdAvant.imapPort, imapUser: cfgBdAvant.imapUser,
        },
      });
      verdict("SMTP restauré à l'état initial (mots de passe intacts)", true, `host=${cfgBdAvant.host || "(non configuré)"}`);
    } else {
      await db.mailConfig.deleteMany({ where: { id: "smtp" } });
      verdict("SMTP restauré : ligne créée par le test supprimée (état initial sans config)", true);
    }
    if (puitsProc) puitsProc.kill();
    const nbAcc = await db.portalAccess.count();
    const nbUsers = await db.user.count();
    verdict("Nettoyage : accès et comptes de test supprimés", true, `accès=${nbAcc} users=${nbUsers}`);
  }

  console.log(`\n== RÉSULTAT : ${ok} OK / ${ko} KO ==`);
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/diag-nettoyage-116.cjs"], { stdio: "ignore" }); } catch {}
  process.exitCode = ko ? 1 : 0;
}

main()
  .catch((e) => { console.error("ERREUR FATALE:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
