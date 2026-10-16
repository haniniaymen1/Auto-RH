#!/usr/bin/env node
/**
 * v0.2.107 (Task 215) — PREUVE E2E de l'ajout du MATRICULE :
 *   1) TOUTES LES FICHES : colonne « Matricule » — la valeur extraite de la
 *      fiche de paie sort dans GET /api/payslips (liste) et le répertoire
 *      /api/payslips/employes associe AUTOmatiquement le matricule à chaque CIN.
 *   2) ACCÈS PORTAIL : colonne « Matricule » — GET /api/portal-access expose
 *      la valeur manuelle (repli auto-association côté UI) et l'action
 *      « modifier-matricule » MODIFIE le matricule comme le nom / prénom /
 *      e-mail : propagation à TOUTES les fiches du CIN, effacement (valeur
 *      vide = repli auto), validation de format.
 *   3) DEMANDES : le matricule de l'employé est présent dans la liste admin
 *      (GET /api/demandes) ET dans le contenu des e-mails — création (RH/N+1),
 *      confirmation demandeur, changement de statut (employé, « NE PAS
 *      répondre »), document-réponse avec pièce jointe (employé).
 *
 * Environnement : instance RÉELLE (4000/4001 v0.2.107) + puits SMTP Task 119
 * (2525). Nettoyage CIBLÉ en fin de run (fiches, accès, demandes, documents,
 * configuration SMTP restaurée à son état initial).
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
const CIN_TEST = "TEST21501";
const CIN_LEGACY = "TEST21502";
const NOM_FICHES = "Trabelsi Ali";
const MATRICULE_FICHE = "MAT-215A";
const MATRICULE_RH = "MAT-9999";
const MDP_PORTAIL = "Test-215!Pass";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL_EMPLOYE = "employe215@test.tn";
const EMAIL_N1 = "n1-215@test.tn";
const FICHIER = "e2e-215-a.pdf";
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
  console.log("== v0.2.107 (Task 215) — preuve E2E : matricule (fiches, accès portail, demandes, e-mails) ==");

  // ---------- PHASE 0 : nettoyage préalable + sémis ----------
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const cinDet2 = cryptoBd.chiffrerChamp(CIN_LEGACY, true);
  await db.payslip.deleteMany({ where: { fileName: FICHIER } });
  await db.portalAccess.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDet, cinDet2] } } });
  // Fiche de paie avec MATRICULE extrait (champ alea — chiffré ici à la main,
  // createMany passe HORS middleware, comme les autres harnais Task 214).
  await db.payslip.createMany({
    data: [{
      fileName: FICHIER,
      storedName: FICHIER,
      fileSize: 100,
      content: "FICHE DE PAIE " + CIN_TEST,
      normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: cryptoBd.chiffrerChamp(CIN_TEST),
      cinIndex: cinDet,
      employeeName: cryptoBd.chiffrerChamp(NOM_FICHES),
      matricule: cryptoBd.chiffrerChamp(MATRICULE_FICHE),
      period: cryptoBd.chiffrerChamp("09/2026"),
      netSalary: cryptoBd.chiffrerChamp("1 000,00"),
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
      nomPrenom: cryptoBd.chiffrerChamp(NOM_FICHES),
      email: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
      mailEnvoyeA: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE),
      mailEnvoyeLe: new Date(Date.now() - 3600000),
      // AUCUN matricule manuel : l'affichage doit replier sur l'auto-association.
      matricule: null,
    },
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet2,
      isActive: true,
      nomPrenom: cryptoBd.chiffrerChamp("Legacy Sans Fiche"),
      matricule: null,
    },
  });
  verdict("Sémis (1 fiche avec matricule, 2 accès sans override)", true);

  // ---------- PHASE 1 : configuration SMTP → puits ----------
  demarrerPuits();
  const cfgBdAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const adm = client(BASE);
  // (MODIFIÉ Task 231 — indépendance de l'environnement) connexion via le COMPTE
  // DE TEST TEMPORAIRE (lab226/creer-compte-e2e-116) : le mot de passe du
  // SUPERADMIN RÉEL n'est pas connu des harnesses.
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const ADMIN_231 = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const login = await adm.post("/api/auth/login", { email: ADMIN_231.email, password: ADMIN_231.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);

  const putPuits = await adm.put("/api/mail-config", {
    host: "127.0.0.1",
    port: 2525,
    username: "auto-rh@entreprise.tn",
    password: "smtp-pass-215",
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
    // ================= REQ 1 : TOUTES LES FICHES =================
    console.log("\n--- REQ 1 : colonne « Matricule » dans Toutes les fiches ---");
    const liste = await adm.get("/api/payslips?limit=200&page=1");
    verdict("GET /api/payslips (liste) → 200", liste.status === 200, `HTTP ${liste.status}`);
    const ficheListe = (liste.json?.items || []).find((x) => x.fileName === FICHIER);
    verdict("La liste porte le matricule EXTRAIT de la fiche",
      ficheListe && ficheListe.matricule === MATRICULE_FICHE,
      ficheListe ? String(ficheListe.matricule) : "fiche absente");

    const employes = await adm.get("/api/payslips/employes");
    verdict("GET /api/payslips/employes → 200", employes.status === 200, `HTTP ${employes.status}`);
    const emp215 = (employes.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("Répertoire : matricule AUTO-ASSOCIÉ au CIN (fiche la plus récente)",
      emp215 && emp215.matricule === MATRICULE_FICHE,
      emp215 ? String(emp215.matricule) : "employé absent");
    const empLegacy = (employes.json?.items || []).find((x) => x.cin === CIN_LEGACY);
    verdict("Répertoire : CIN sans fiche absent (pas d'association sauvage)", !empLegacy);

    // ================= REQ 2 : ACCÈS PORTAIL =================
    console.log("\n--- REQ 2 : colonne « Matricule » dans Accès portail (modifiable) ---");
    const listeAcces = await adm.get("/api/portal-access");
    const row215 = (listeAcces.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("GET : champ matricule exposé (null = pas de valeur manuelle)",
      row215 && "matricule" in row215 && row215.matricule === null,
      JSON.stringify(row215 ? row215.matricule : "ligne absente"));

    const modif = await adm.post("/api/portal-access", {
      action: "modifier-matricule", cin: CIN_TEST, matricule: MATRICULE_RH,
    });
    verdict("modifier-matricule → ok, fiches propagées, accès mémorisé",
      modif.status === 200 && modif.json?.ok && modif.json?.fichesModifiees === 1 && modif.json?.accesModifie === true,
      JSON.stringify(modif.json?.error || { f: modif.json?.fichesModifiees, a: modif.json?.accesModifie }));

    const listeAcces2 = await adm.get("/api/portal-access");
    const row215b = (listeAcces2.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("GET : valeur manuelle « " + MATRICULE_RH + " » renvoyée",
      row215b?.matricule === MATRICULE_RH, String(row215b?.matricule));

    const ficheDb = await db.payslip.findFirst({ where: { fileName: FICHIER } });
    const matFicheDb = ficheDb ? cryptoBd.dechiffrerChamp(ficheDb.matricule) : "";
    verdict("PROPAGATION : toutes les fiches du CIN portent le nouveau matricule",
      matFicheDb === MATRICULE_RH, String(matFicheDb));

    const employes2 = await adm.get("/api/payslips/employes");
    const emp215b = (employes2.json?.items || []).find((x) => x.cin === CIN_TEST);
    verdict("Répertoire rafraîchi : le matricule propagé devient la référence",
      emp215b?.matricule === MATRICULE_RH, String(emp215b?.matricule));

    // Accès SANS fiche : le matricule se mémorise quand même (comme le nom).
    const modifLegacy = await adm.post("/api/portal-access", {
      action: "modifier-matricule", cin: CIN_LEGACY, matricule: "EMP-7",
    });
    verdict("modifier-matricule (accès sans fiche) → ok, 0 fiche modifiée",
      modifLegacy.status === 200 && modifLegacy.json?.ok && modifLegacy.json?.fichesModifiees === 0 && modifLegacy.json?.accesModifie === true,
      JSON.stringify(modifLegacy.json?.error || {}));
    const listeAcces3 = await adm.get("/api/portal-access");
    const rowLegacy = (listeAcces3.json?.items || []).find((x) => x.cin === CIN_LEGACY);
    verdict("Accès sans fiche : matricule manuel « EMP-7 » mémorisé",
      rowLegacy?.matricule === "EMP-7", String(rowLegacy?.matricule));

    // EFFACEMENT : valeur vide = suppression de la valeur manuelle (repli auto).
    const efface = await adm.post("/api/portal-access", {
      action: "modifier-matricule", cin: CIN_LEGACY, matricule: "",
    });
    const listeAcces4 = await adm.get("/api/portal-access");
    const rowLegacy2 = (listeAcces4.json?.items || []).find((x) => x.cin === CIN_LEGACY);
    verdict("Valeur VIDE = effacement de la valeur manuelle (repli auto-association)",
      efface.status === 200 && rowLegacy2?.matricule === null,
      String(rowLegacy2?.matricule));

    const invalide = await adm.post("/api/portal-access", {
      action: "modifier-matricule", cin: CIN_TEST, matricule: "##//!!",
    });
    verdict("Validation : matricule avec caractères interdits → 400",
      invalide.status === 400, `HTTP ${invalide.status}`);

    // ================= REQ 3 : DEMANDES + E-MAILS =================
    console.log("\n--- REQ 3 : matricule dans les demandes et les e-mails ---");
    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false,
    });
    verdict("Connexion portail (CIN + mdp + OTP)", verif.status === 200 && verif.json?.ok, `HTTP ${verif.status}`);

    // a) ATTESTATION DE TRAVAIL — e-mails création (RH) + confirmation (employé)
    const repAtt = await port.post("/api/demandes", { type: "ATTESTATION_TRAVAIL" });
    verdict("POST demande ATTESTATION_TRAVAIL → 201", repAtt.status === 201 && repAtt.json?.ok, `HTTP ${repAtt.status}`);
    const refAtt = repAtt.json?.reference;

    await new Promise((r) => setTimeout(r, 1800));
    const mailsRH = await mailsVers("rh@entreprise.tn");
    const mailCreation = mailsRH.find((m) => /traitement requis/.test(m.subject || "") && (m.subject || "").includes(refAtt));
    verdict("E-mail de CRÉATION reçu par le service RH", Boolean(mailCreation), mailCreation ? String(mailCreation.subject) : "absent");
    const texteCreation = mailCreation ? (mailCreation.text || "") : "";
    verdict("CRÉATION : ligne « Matricule » présente avec la valeur de l'employé",
      /Matricule\s+:\s*MAT-9999/m.test(texteCreation),
      (texteCreation.match(/Matricule[^\n]*/) || ["absente"])[0]);
    const mailsEmp0 = await mailsVers(EMAIL_EMPLOYE);
    const mailConf = mailsEmp0.find((m) => /confirmation d'envoi/.test(m.subject || ""));
    verdict("CONFIRMATION au demandeur : matricule présent",
      Boolean(mailConf) && /Matricule\s*:\s*MAT-9999/.test(mailConf.text || ""),
      mailConf ? String(mailConf.subject) : "absent");

    // Liste admin : le matricule accompagne la demande
    const listeDem = await adm.get("/api/demandes");
    const dem215 = (listeDem.json?.items || []).find((x) => x.reference === refAtt);
    verdict("GET /api/demandes : matricule de l'employé dans la liste",
      dem215 && dem215.matricule === MATRICULE_RH,
      dem215 ? String(dem215.matricule) : "demande absente");

    // b) CHANGEMENT DE STATUT — e-mail employé « NE PAS répondre » + matricule
    const idAtt = refAtt ? (await db.demandeAdministrative.findUnique({ where: { reference: refAtt } }))?.id : null;
    const statutRep = await adm.post(`/api/demandes/${idAtt}`, { statut: "INFORMATION_REQUISE", commentaire: "Merci de préciser le service d'affectation." });
    verdict("POST statut INFORMATION_REQUISE → notification envoyée",
      statutRep.status === 200 && statutRep.json?.notification?.envoye === true,
      JSON.stringify(statutRep.json?.notification || statutRep.json?.error || {}));
    await new Promise((r) => setTimeout(r, 1500));
    const mailsEmp1 = await mailsVers(EMAIL_EMPLOYE);
    const mailStatut = mailsEmp1.find((m) => /demande.*information/i.test(m.subject || "") && (m.subject || "").includes(refAtt));
    const texteStatut = mailStatut ? (mailStatut.text || "") : "";
    verdict("STATUT : matricule présent dans la notification employé",
      /Matricule\s+:\s*MAT-9999/m.test(texteStatut),
      (texteStatut.match(/Matricule[^\n]*/) || ["absente"])[0]);
    verdict("STATUT : convention « NE PAS répondre » conservée (v0.2.105)",
      /NE PAS répondre/i.test(texteStatut));

    // c) RÉPONSE RH AVEC PIÈCE JOINTE — le matricule accompagne le document
    const form1 = new FormData();
    form1.append("document", new Blob([PDF_MIN], { type: "application/pdf" }), "Attestation_Reponse.pdf");
    form1.append("mode", "valider");
    form1.append("tampon", "aucun");
    const rep1 = await adm.req("POST", `/api/demandes/${idAtt}/repondre`, form1);
    verdict("Réponse RH import direct → 200 + notification + pièce jointe",
      rep1.status === 200 && rep1.json?.notification?.envoye === true,
      JSON.stringify(rep1.json?.notification || rep1.json?.error || {}));
    await new Promise((r) => setTimeout(r, 1500));
    const mailsEmp2 = await mailsVers(EMAIL_EMPLOYE);
    const mailDoc = mailsEmp2.find((m) => /votre document est disponible/.test(m.subject || ""));
    const att = mailDoc && mailDoc.attachments ? mailDoc.attachments : [];
    verdict("DOCUMENT : pièce jointe reçue (non-régression v0.2.106)",
      att.length === 1 && att[0].filename === "Attestation_Reponse.pdf",
      `nb=${att.length} ${att[0] ? att[0].filename : ""}`);
    verdict("DOCUMENT : matricule présent dans la notification",
      /Matricule\s+:\s*MAT-9999/m.test(mailDoc ? (mailDoc.text || "") : ""),
      (String(mailDoc ? mailDoc.text : "").match(/Matricule[^\n]*/) || ["absente"])[0]);

    // d) DEMANDE DE CONGÉ — e-mail de création au N+1 avec matricule
    const repCg = await port.post("/api/demandes", {
      type: "CONGE", typeConge: "Annuel", dateDebut: "2026-11-02", dateFin: "2026-11-05",
      emailN1: EMAIL_N1, commentaire: "Congé annuel planifié.",
    });
    verdict("POST demande CONGE → 201", repCg.status === 201 && repCg.json?.ok, `HTTP ${repCg.status}`);
    await new Promise((r) => setTimeout(r, 1800));
    const mailsN1 = await mailsVers(EMAIL_N1);
    const mailN1 = mailsN1.find((m) => /traitement requis/.test(m.subject || ""));
    verdict("CONGÉ : e-mail au N+1 avec ligne « Matricule »",
      Boolean(mailN1) && /Matricule\s+:\s*MAT-9999/m.test(mailN1 ? (mailN1.text || "") : ""),
      (String(mailN1 ? mailN1.text : "").match(/Matricule[^\n]*/) || ["absente"])[0]);
  } finally {
    // ---------- NETTOYAGE + restauration (CIBLÉ sur les données du test) ----------
    console.log("\n--- Nettoyage ---");
    const demTest = await db.demandeAdministrative.findMany({
      where: { cin: { in: [cinDet, cinDet2] } },
      select: { id: true },
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
      verdict("SMTP restauré : ligne créée par le test supprimée", true);
    }
    if (puitsProc) puitsProc.kill();
    const nbAcc = await db.portalAccess.count();
    verdict("Nettoyage : accès et données de test supprimés", true, `accès restants=${nbAcc}`);
  }

  console.log(`\n== RÉSULTAT : ${ok} OK / ${ko} KO ==`);
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/diag-nettoyage-116.cjs"], { stdio: "ignore" }); } catch {}
  process.exitCode = ko ? 1 : 0;
}

main()
  .catch((e) => { console.error("ERREUR FATALE:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
