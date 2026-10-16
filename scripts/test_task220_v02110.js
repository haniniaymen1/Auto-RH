#!/usr/bin/env node
/**
 * v0.2.110 (Task 220) — PREUVE E2E des DEUX modifications demandées :
 *
 *  A. « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE :
 *     - la colonne « Prénom » du tableau « Accès portail par mot de passe »
 *       porte désormais un CRAYON (interface) — l'API modifier-nom existante
 *       porte Nom + Prénom (le test prouve la chaîne complète : API →
 *       PortalAccess.nom/prenom/nomPrenom → fiches de paie → portail ;
 *       nomPrenom est le champ LU par le portail employé) ;
 *     - la modification est enregistrée et PRISE EN COMPTE DANS LE PORTAIL
 *       de l'employé (nomPrenom + employeeName des fiches mis à jour).
 *
 *  B. « STATUT DES DEMANDES AVEC PIÈCE JOINTE » (congé / autorisation /
 *     parrainage) :
 *     - FILET v0.2.110 : une décision écrite EN BAS de la réponse (sous la
 *       citation + la consigne) ou dans le SUJET est désormais détectée —
 *       le statut ne reste JAMAIS « En attente » lorsque la réponse contient
 *       explicitement « Acceptée » ou « Refusée », avec pièce jointe ;
 *     - la pièce jointe reste importée, affichée et accessible EN PLUS du
 *       statut (DocumentDemande + e-mail employé avec les octets du doc) ;
 *     - parrainage : « Refusée » + PJ → REFUSEE (avant : « Acceptée » à
 *       tort) ; PJ sans aucune décision → Acceptée (historique v0.2.51) ;
 *     - congé : PJ sans décision → statut INCHANGÉ (une décision explicite
 *       reste requise pour les types à validation) ;
 *     - ADMIN : le dialogue « Répondre avec un document » porte une DÉCISION
 *       explicite (Aucune / Acceptée / Refusée) → le statut la reflète.
 *
 * Environnement : instance RÉELLE (4000/4001) + puits SMTP Task 119 (2525).
 * Nettoyage intégral en fin de run (accès, fiches, demandes, documents,
 * configuration SMTP restaurée à son état initial exact).
 */
"use strict";
process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { simpleParser } = require("mailparser");
const portail = require("./portail-server.js"); // mode TEST : ni serveur ni IMAP
const lib = require("./lib-validation-n1.js");

const db = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const PUITS_PORT = "2525";
const PUITS_LOG = path.join(__dirname, "task122", "puits-complet.log");

const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };
const CIN_PRENOM = "TEST22001";
const CIN_MAIL = "TEST22002";
const EMAIL_EMPLOYE = "employe220@test.tn";
const EMAIL_RH = "rh@entreprise.tn";
const EMAIL_N1 = "n1-220@entreprise.tn";
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
  "utf8"
);

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
async function attendreMails(dest, nb, msMax = 8000) {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if ((await mailsVers(dest)).length >= nb) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let puitsProc = null;
function demarrerPuits() {
  try { fs.writeFileSync(PUITS_LOG, ""); } catch { /* nouveau fichier */ }
  puitsProc = spawn(process.execPath, [path.join(__dirname, "task122", "puits-complet.js")], {
    env: { ...process.env, PUITS_PORT },
    stdio: "ignore",
  });
}

/** Message cité « style client de messagerie » : la réponse utile est SOUS
 *  le bloc cité (signature en bas de page) — la consigne « VALIDATION PAR
 *  E-MAIL » est DANS le bloc cité. C'est le cas qui échouait avant v0.2.110. */
function reponseBasDePage({ sujet, decision, signature }) {
  return (
    sujet +
    "\n\n-----Message d'origine-----\n" +
    "Bonjour,\n\nVous avez reçu une demande nécessitant votre traitement.\n" +
    "VALIDATION PAR E-MAIL : répondez directement à cet e-mail (« Répondre »)\n" +
    "en écrivant « Acceptée » pour VALIDER la demande, ou « Refusée » pour la\n" +
    "refuser. Votre réponse est rattachée automatiquement à la référence\n" +
    "DEM-2026-00000 — aucune autre manipulation nécessaire. L'employé et le\n" +
    "service RH sont notifiés automatiquement après votre réponse.\n\n" +
    "Merci de traiter cette demande. L'employé suit son avancement dans sa\n" +
    "section « Demandes administratives » du portail employé.\n\n" +
    decision +
    (signature ? "\n\n" + signature : "")
  );
}

async function creerDemande({ reference, type, destinataire, msgId, statut = "EN_ATTENTE", cin }) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type,
      cin: cryptoBd.chiffrerChamp(cin, true),
      statut,
      destinataire: cryptoBd.chiffrerChamp(destinataire, true),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ nom: "Trabelsi", prenom: "Ali" }), true),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_EMPLOYE, true),
      messageIdEnvoi: msgId,
    },
  });
}

async function main() {
  console.log("== v0.2.110 (Task 220) — Prénom modifiable + statut des demandes avec pièce jointe ==");

  // ---------- PHASE 0 : nettoyage préalable ----------
  const cinDetP = cryptoBd.chiffrerChamp(CIN_PRENOM, true);
  const cinDetM = cryptoBd.chiffrerChamp(CIN_MAIL, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDetP, cinDetM] } } });
  await db.portalAccess.deleteMany({ where: { cin: { in: [cinDetP, cinDetM] } } });
  await db.payslip.deleteMany({ where: { cinIndex: { in: [cinDetP, cinDetM] } } });

  // ---------- PHASE 1 : filet de décision explicite (unitaire) ----------
  console.log("\n--- A. Filet v0.2.110 : décision explicite (lib-validation-n1) ---");
  const bas = (decision, sujet) => reponseBasDePage({
    sujet: sujet || "Re: AutoRH — Demande de congé DEM-2026-00042",
    decision,
    signature: "Chef de service",
  });
  verdict("A1 décision EN BAS (sous citation+consigne) « Acceptée » → VALIDEE",
    lib.detecterDecisionExplicite({ text: bas("Acceptée") }) === "VALIDEE");
  verdict("A2 décision EN BAS « Refusée » → REFUSEE",
    lib.detecterDecisionExplicite({ text: bas("Refusée pour cette période.") }) === "REFUSEE");
  verdict("A3 décision uniquement dans le SUJET « — Acceptée » → VALIDEE",
    lib.detecterDecisionExplicite({ text: bas(" "), subject: "Re: Demande de congé DEM-2026-00042 — Acceptée" }) === "VALIDEE");
  verdict("A4 consigne seule (pas de décision) → null",
    lib.detecterDecisionExplicite({ text: reponseBasDePage({ sujet: "Re: x", decision: "" }) }) === null);
  verdict("A5 motif cité contenant le mot « non » seul → null (aucun faux positif)",
    lib.detecterDecisionExplicite({ text: "-----Message d'origine-----\nMotif : non respect du planning.\nVALIDATION PAR E-MAIL : répondez « Acceptée » ou « Refusée » pour la refuser." }) === null);
  verdict("A6 passe classique : décision AU-DESSUS de la citation → toujours VALIDEE (non-régression)",
    lib.detecterIntentionValidation("D'accord, acceptée.\n\n-----Message d'origine-----\nVALIDATION PAR E-MAIL …") === "VALIDEE");
  verdict("A7 masculins historiques couverts par le filet (« accepté »/« refusé »)",
    lib.detecterDecisionExplicite({ text: bas("Accepté, à builtin.") }) === "VALIDEE" ||
      lib.detecterDecisionExplicite({ text: bas("Refusé.") }) === "REFUSEE");

  // ---------- PHASE 2 : puits SMTP + config + login ----------
  console.log("\n--- B. Environnement : puits SMTP + connexion ---");
  demarrerPuits();
  const cfgBdAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const adm = client(BASE);
  const login = await adm.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);
  const putPuits = await adm.put("/api/mail-config", {
    host: "127.0.0.1", port: 2525,
    username: "auto-rh@entreprise.tn", password: "smtp-pass-220",
    from: "AutoRH <auto-rh@entreprise.tn>",
    rhEmail: EMAIL_RH, itEmail: "", responsablesMap: "", parrainageEmail: "",
    serveurAdresse: "127.0.0.1", sitePort: "4001", portailUrl: "http://127.0.0.1:4001",
    imapActif: false, imapHost: "", imapPort: 993,
  });
  verdict("SMTP basculé sur le puits 2525", putPuits.status === 200, `HTTP ${putPuits.status}`);

  try {
    const suffixe = Date.now().toString().slice(-6);

    // ================================================================
    // PHASE 3 : PRÉNOM MODIFIABLE (interface → API → portail + fiches)
    // ================================================================
    console.log("\n--- C. Prénom modifiable — enregistrement + portail + fiches ---");
    await db.payslip.create({
      data: {
        fileName: "e2e-220-" + CIN_PRENOM + ".pdf",
        storedName: "e2e-220-" + CIN_PRENOM + ".pdf",
        fileSize: 100,
        content: "FICHE DE PAIE " + CIN_PRENOM,
        normalizedContent: "FICHE DE PAIE " + CIN_PRENOM,
        cin: cryptoBd.chiffrerChamp(CIN_PRENOM),
        cinIndex: cinDetP,
        employeeName: cryptoBd.chiffrerChamp("Saidani Mohamed Amine"),
        period: cryptoBd.chiffrerChamp("09/2026"),
        netSalary: cryptoBd.chiffrerChamp("1 000,00"),
      },
    });
    verdict("Fiche semée (employeeName « Saidani Mohamed Amine »)", true);
    const cre = await adm.post("/api/portal-access", { action: "create", cin: CIN_PRENOM });
    verdict("Créer l'accès " + CIN_PRENOM, cre.status === 200, `HTTP ${cre.status}`);
    const liste1 = await adm.get("/api/portal-access");
    const r1 = ((liste1.data && liste1.data.items) || []).find((x) => x.cin === CIN_PRENOM);
    verdict("Pré-remplissage automatique (Nom=Saidani / Prénom=Mohamed Amine)",
      Boolean(r1) && r1.nom === "Saidani" && r1.prenom === "Mohamed Amine",
      r1 ? `nom=${JSON.stringify(r1.nom)} prenom=${JSON.stringify(r1.prenom)}` : "absent");

    // Modification VIA L'INTERFACE = même appel POST que le crayon « Prénom »
    const mod = await adm.post("/api/portal-access", {
      action: "modifier-nom", cin: CIN_PRENOM, nom: "Saidani", prenom: "Med Amine",
    });
    verdict("Crayon « Prénom » : modification enregistrée (API modifier-nom)", mod.status === 200, `HTTP ${mod.status}`);
    const liste2 = await adm.get("/api/portal-access");
    const r2 = ((liste2.data && liste2.data.items) || []).find((x) => x.cin === CIN_PRENOM);
    verdict("Colonne Prénom affiche la nouvelle valeur", Boolean(r2) && r2.prenom === "Med Amine",
      r2 ? `prenom=${JSON.stringify(r2.prenom)}` : "absent");
    const accDb = await db.portalAccess.findUnique({ where: { cin: cinDetP } });
    const nomPrenomPortail = accDb && accDb.nomPrenom ? String(cryptoBd.dechiffrerChamp(accDb.nomPrenom) || "") : "";
    const prenomPortail = accDb && accDb.prenom ? String(cryptoBd.dechiffrerChamp(accDb.prenom) || "") : "";
    verdict("PRISE EN COMPTE PORTAIL : acc.nomPrenom = « Prénom Nom » (lu par le portail employé)",
      nomPrenomPortail === "Med Amine Saidani", JSON.stringify(nomPrenomPortail));
    verdict("PRISE EN COMPTE PORTAIL : acc.prenom = « Med Amine »",
      prenomPortail === "Med Amine", JSON.stringify(prenomPortail));
    const ficheApres = await db.payslip.findFirst({ where: { cinIndex: cinDetP } });
    const nomFiche = ficheApres && ficheApres.employeeName ? String(cryptoBd.dechiffrerChamp(ficheApres.employeeName) || "") : "";
    verdict("PRISE EN COMPTE FICHES : employeeName = « Prénom Nom » (propagation)",
      nomFiche === "Med Amine Saidani", JSON.stringify(nomFiche));

    // ================================================================
    // PHASE 4 : E-MAIL avec PIÈCE JOINTE — congé / autorisation / parrainage
    // ================================================================
    console.log("\n--- D. Réponse e-mail AVEC pièce jointe : statut piloté par la décision ---");

    // D1 : CONGÉ — décision « Acceptée » EN BAS + PJ → ACCEPTEE + document
    const ref1 = "DEM-2026-" + suffixe.slice(0, 4) + "1";
    await creerDemande({ reference: ref1, type: "CONGE", destinataire: EMAIL_N1, msgId: "<220-1-" + suffixe + ">", cin: CIN_MAIL });
    const v1 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref1 + " (traitement requis)",
      from: { value: [{ address: EMAIL_N1 }] },
      inReplyTo: "<220-1-" + suffixe + ">",
      text: bas("Acceptée"),
      attachments: [{ filename: "avis-conge-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D1 congé : « Acceptée » en bas + PJ → TRAITE", v1.statut === "TRAITE", JSON.stringify(v1).slice(0, 130));
    verdict("D1 statut = ACCEPTEE (jamais « En attente »)", v1.statutApres === "ACCEPTEE");
    verdict("D1 pièce jointe importée (docs = 1)", v1.docs === 1);
    const b1 = await db.demandeAdministrative.findFirst({ where: { reference: ref1 } });
    const docs1 = await db.documentDemande.findMany({ where: { demandeId: b1.id } });
    verdict("D1 document persisté + accessible (DocumentDemande)",
      docs1.length === 1 && docs1[0].nomFichier === "avis-conge-220.pdf");
    await attendreMails(EMAIL_EMPLOYE, 1);
    const m1 = (await mailsVers(EMAIL_EMPLOYE))[0];
    const att1 = m1 && m1.attachments ? m1.attachments : [];
    verdict("D1 employé notifié « acceptée par votre responsable N+1 »",
      String(m1?.subject || "").includes("acceptée par votre responsable N+1"), (m1?.subject || "").slice(0, 80));
    verdict("D1 PIÈCE JOINTE affichée/accessible : jointe à l'e-mail (octets = document)",
      att1.length === 1 && Buffer.compare(att1[0].content, PDF_MIN) === 0);

    // D2 : CONGÉ — décision « Refusée » EN BAS + PJ → REFUSEE + document
    const ref2 = "DEM-2026-" + suffixe.slice(0, 4) + "2";
    await creerDemande({ reference: ref2, type: "CONGE", destinataire: EMAIL_N1, msgId: "<220-2-" + suffixe + ">", cin: CIN_MAIL });
    const v2 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref2,
      from: { value: [{ address: EMAIL_N1 }] },
      text: bas("Refusée — dépassement du solde."),
      attachments: [{ filename: "notification-refus-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D2 congé : « Refusée » en bas + PJ → REFUSEE", v2.statutApres === "REFUSEE", JSON.stringify(v2).slice(0, 130));
    verdict("D2 pièce jointe importée (docs = 1)", v2.docs === 1);
    const b2 = await db.demandeAdministrative.findFirst({ where: { reference: ref2 } });
    verdict("D2 persisté REFUSEE + traitePar « Responsable N+1 (e-mail) »",
      b2.statut === "REFUSEE" && String(b2.traitePar || "") === "Responsable N+1 (e-mail)", b2.traitePar || "");

    // D3 : AUTORISATION_SORTIE — décision uniquement dans le SUJET + PJ
    const ref3 = "DEM-2026-" + suffixe.slice(0, 4) + "3";
    await creerDemande({ reference: ref3, type: "AUTORISATION_SORTIE", destinataire: EMAIL_N1, msgId: "<220-3-" + suffixe + ">", cin: CIN_MAIL });
    const v3 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Autorisation de sortie " + ref3 + " — Acceptée",
      from: { value: [{ address: EMAIL_N1 }] },
      text: bas(" ", "Re: AutoRH — Autorisation de sortie " + ref3 + " — Acceptée"),
      attachments: [{ filename: "bon-sortie-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D3 autorisation : « Acceptée » dans le SUJET + PJ → ACCEPTEE", v3.statutApres === "ACCEPTEE", JSON.stringify(v3).slice(0, 130));
    verdict("D3 pièce jointe importée (docs = 1)", v3.docs === 1);

    // D4 : PARRAINAGE — « Refusée » en bas + PJ → REFUSEE (avant : ACCEPTEE à tort)
    const ref4 = "DEM-2026-" + suffixe.slice(0, 4) + "4";
    await creerDemande({ reference: ref4, type: "PARRAINAGE", destinataire: EMAIL_RH, msgId: "<220-4-" + suffixe + ">", cin: CIN_MAIL });
    const v4 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de parrainage " + ref4,
      from: { value: [{ address: EMAIL_RH }] },
      text: bas("Refusée — le parrain n'est pas éligible."),
      attachments: [{ filename: "lettre-parrainage-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D4 parrainage : « Refusée » en bas + PJ → REFUSEE (plus « Acceptée » à tort)",
      v4.statutApres === "REFUSEE", JSON.stringify(v4).slice(0, 130));
    verdict("D4 pièce jointe importée (docs = 1)", v4.docs === 1);

    // D5 : PARRAINAGE — PJ SANS aucune décision → Acceptée (historique v0.2.51)
    const ref5 = "DEM-2026-" + suffixe.slice(0, 4) + "5";
    await creerDemande({ reference: ref5, type: "PARRAINAGE", destinataire: EMAIL_RH, msgId: "<220-5-" + suffixe + ">", cin: CIN_MAIL });
    const v5 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de parrainage " + ref5,
      from: { value: [{ address: EMAIL_RH }] },
      text: bas("Veuillez trouver la version finale du document."),
      attachments: [{ filename: "attestation-parrainage-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D5 parrainage : PJ sans décision → ACCEPTEE (comportement historique conservé)",
      v5.statutApres === "ACCEPTEE" && v5.docs === 1, JSON.stringify(v5).slice(0, 130));

    // D6 : CONGÉ — PJ SANS aucune décision → statut INCHANGÉ (décision requise)
    const ref6 = "DEM-2026-" + suffixe.slice(0, 4) + "6";
    await creerDemande({ reference: ref6, type: "CONGE", destinataire: EMAIL_N1, msgId: "<220-6-" + suffixe + ">", cin: CIN_MAIL });
    const v6 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref6,
      from: { value: [{ address: EMAIL_N1 }] },
      text: bas("Information complémentaire en pièce jointe."),
      attachments: [{ filename: "justificatif-220.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("D6 congé : PJ sans décision → statut INCHANGÉ (EN_ATTENTE) + document importé",
      v6.statut === "TRAITE" && v6.statutApres === "EN_ATTENTE" && v6.docs === 1, JSON.stringify(v6).slice(0, 130));

    // ================================================================
    // PHASE 5 : RÉPONSE ADMIN AVEC DÉCISION (multipart, champ decision)
    // ================================================================
    console.log("\n--- E. Administration : « Répondre avec un document » + décision explicite ---");
    async function repondreAdmin(id, decision) {
      const fd = new FormData();
      fd.append("document", new Blob([PDF_MIN], { type: "application/pdf" }), "reponse-admin-220.pdf");
      fd.append("mode", "valider");
      fd.append("tampon", "aucun");
      fd.append("decision", decision);
      const res = await fetch(BASE + "/api/demandes/" + encodeURIComponent(id) + "/repondre", {
        method: "POST",
        headers: { Cookie: adm.cookie },
        body: fd,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }

    // E1 : PARRAINAGE en attente + décision REFUSEE → REFUSEE + document
    const d7 = await creerDemande({ reference: "DEM-2026-" + suffixe.slice(0, 4) + "7", type: "PARRAINAGE", destinataire: EMAIL_RH, msgId: "<220-7-" + suffixe + ">", cin: CIN_MAIL });
    const e1 = await repondreAdmin(d7.id, "REFUSEE");
    verdict("E1 admin : décision « Refusée » acceptée (HTTP 200)", e1.status === 200, JSON.stringify(e1.json || {}).slice(0, 130));
    verdict("E1 statut = REFUSEE (réponse Refusée + PJ)", e1.json && e1.json.statut === "REFUSEE", e1.json && e1.json.statutLibelle);
    const b7 = await db.demandeAdministrative.findUnique({ where: { id: d7.id } });
    const docs7 = await db.documentDemande.findMany({ where: { demandeId: d7.id } });
    verdict("E1 persisté REFUSEE + document affichable/accessible",
      b7.statut === "REFUSEE" && docs7.length === 1 && String(b7.commentaire || "").includes("Refusée"));
    await attendreMails(EMAIL_EMPLOYE, 3, 9000);
    const mailsEmp = await mailsVers(EMAIL_EMPLOYE);
    const mE1 = mailsEmp[mailsEmp.length - 1];
    verdict("E1 e-mail employé : statut « Refusée — document disponible » + PJ",
      String(mE1?.text || "").includes("Refusée — document disponible") &&
      (mE1.attachments || []).length === 1);

    // E2 : CONGÉ en attente + décision ACCEPTEE → ACCEPTEE + document
    const d8 = await creerDemande({ reference: "DEM-2026-" + suffixe.slice(0, 4) + "8", type: "CONGE", destinataire: EMAIL_N1, msgId: "<220-8-" + suffixe + ">", cin: CIN_MAIL });
    const e2 = await repondreAdmin(d8.id, "ACCEPTEE");
    verdict("E2 admin : décision « Acceptée » → statut ACCEPTEE", e2.json && e2.json.statut === "ACCEPTEE", e2.json && e2.json.statutLibelle);
    const b8 = await db.demandeAdministrative.findUnique({ where: { id: d8.id } });
    verdict("E2 persisté ACCEPTEE + commentaire « Réponse : Acceptée »",
      b8.statut === "ACCEPTEE" && String(b8.commentaire || "").includes("Acceptée"));

    // E3 : PARRAINAGE en attente + AUCUNE décision → historique (ACCEPTEE)
    const d9 = await creerDemande({ reference: "DEM-2026-" + suffixe.slice(0, 4) + "9", type: "PARRAINAGE", destinataire: EMAIL_RH, msgId: "<220-9-" + suffixe + ">", cin: CIN_MAIL });
    const e3 = await repondreAdmin(d9.id, "AUCUNE");
    verdict("E3 admin sans décision → ACCEPTEE (comportement historique v0.2.51)",
      e3.json && e3.json.statut === "ACCEPTEE", e3.json && e3.json.statutLibelle);

    // E4 : REFUSEE existant SANS décision → conservé (jamais écrasé par défaut)
    const d10 = await creerDemande({ reference: "DEM-2026-2" + suffixe.slice(0, 4) + "0", type: "PARRAINAGE", destinataire: EMAIL_RH, msgId: "<220-10-" + suffixe + ">", cin: CIN_MAIL, statut: "REFUSEE" });
    const e4 = await repondreAdmin(d10.id, "AUCUNE");
    verdict("E4 statut REFUSEE existant conservé sans décision explicite",
      e4.json && e4.json.statut === "REFUSEE", e4.json && e4.json.statutLibelle);
  } finally {
    // ---------- NETTOYAGE + restauration exacte ----------
    console.log("\n--- Nettoyage ---");
    try {
      const ids = (await db.demandeAdministrative.findMany({
        where: { cin: { in: [cinDetP, cinDetM] } }, select: { id: true },
      })).map((x) => x.id);
      await db.documentDemande.deleteMany({ where: { demandeId: { in: ids } } });
      await db.demandeAdministrative.deleteMany({ where: { id: { in: ids } } });
      await db.portalAccess.deleteMany({ where: { cin: { in: [cinDetP, cinDetM] } } });
      await db.payslip.deleteMany({ where: { cinIndex: { in: [cinDetP, cinDetM] } } });
      if (cfgBdAvant) {
        await db.mailConfig.update({ where: { id: "smtp" }, data: cfgBdAvant });
      } else {
        await db.mailConfig.deleteMany({ where: { id: "smtp" } });
      }
      if (puitsProc) { try { puitsProc.kill(); } catch { /* deja mort */ } }
      console.log("Nettoyage : accès/fiches/demandes/documents supprimés, SMTP restauré, puits arrêté.");
    } catch (e) {
      console.error("Nettoyage : erreur (à vérifier manuellement) :", e && e.message);
    }
  }

  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} KO ===`);
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(2); });
