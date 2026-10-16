#!/usr/bin/env node
/**
 * v0.2.108 (Task 216) — PREUVE E2E des évolutions « GESTION DES RÉPONSES » :
 *   A. LIBELLÉS : la consigne « VALIDATION PAR E-MAIL » des e-mails de
 *      création porte désormais « Acceptée » / « Refusée » (accord féminin
 *      avec « demande ») — texte ET HTML — et le motif IGNORE invite à
 *      écrire ces mêmes libellés. Aucun « Accepté » / « Refusé » masculin
 *      ne subsiste dans les chaînes (commentaires exclus).
 *   B. DÉTECTEUR : les formes féminines sont comprises (et les masculines
 *      historiques le restent) ; la citation de l'e-mail d'origine et le
 *      bloc de consignes cité ne déclenchent aucun faux positif.
 *   C. DÉCISION PAR RÉPONSE E-MAIL POUR TOUS LES TYPES :
 *      - ATTESTATION_TRAVAIL (destinataire service RH) : « Refusée » sans
 *        pièce jointe → REFUSEE (traitePar « Auto-RH (e-mail) ») ;
 *        « Acceptée » → ACCEPTEE ; document + « Refusée » → REFUSEE avec
 *        document importé ET joint à l'e-mail de l'employé ; réponse sans
 *        décision ni pièce jointe → IGNORE (motif explicite) ;
 *      - CONGE (destinataire N+1) : « Acceptée » au féminin → ACCEPTEE avec
 *        copie RH + e-mail employé (« par votre responsable N+1 ») —
 *        « Refusée » → REFUSEE ; mauvais expéditeur → IGNORE (régression).
 *      L'e-mail de l'employé porte l'AUTEUR correct (service RH vs
 *      responsable N+1) et la copie au service RH n'est envoyée que lorsque
 *      la décision vient du N+1.
 *
 * Environnement : instance RÉELLE (4000/4001) + puits SMTP Task 119 (2525).
 * Nettoyage intégral en fin de run (demandes, documents, configuration SMTP
 * restaurée à son état initial exact).
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
const CIN_AT = "TEST21601";
const CIN_CG = "TEST21602";
const EMAIL_EMPLOYE = "employe216@test.tn";
const EMAIL_RH = "rh@entreprise.tn";
const EMAIL_N1 = "n1-216@entreprise.tn";
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

function det(t) { return lib.detecterIntentionValidation(t); }

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
  console.log("== v0.2.108 (Task 216) — réponse aux demandes : libellés féminins, décision tous types ==");

  // ---------- PHASE 0 : nettoyage préalable ----------
  const cinDet1 = cryptoBd.chiffrerChamp(CIN_AT, true);
  const cinDet2 = cryptoBd.chiffrerChamp(CIN_CG, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDet1, cinDet2] } } });

  // ---------- PHASE 1 : consignes + détecteur (unitaire) ----------
  console.log("\n--- A. Libellés de la section VALIDATION PAR E-MAIL ---");
  const src = fs.readFileSync("scripts/portail-server.js", "utf8");
  verdict("Consigne TEXTE : « Acceptée » pour VALIDER… « Refusée » pour la refuser",
    src.includes("« Acceptée » pour VALIDER la demande, ou « Refusée » pour la"));
  verdict("Consigne HTML : <b>« Acceptée »</b> … <b>« Refusée »</b>",
    src.includes("<b>« Acceptée »</b> pour VALIDER la demande, ou <b>« Refusée »</b> pour la refuser"));
  const srcSansCommentaires = src.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  verdict("Aucun « Accepté » / « Refusé » masculin dans les CHAÎNES (commentaires exclus)",
    !srcSansCommentaires.includes("« Accepté »") && !srcSansCommentaires.includes("« Refusé »"));
  verdict("Motif IGNORE : invite à écrire « Acceptée » ou « Refusée »",
    src.includes("aucune décision explicable") && src.includes("(écrire « Acceptée » ou « Refusée »)"));

  console.log("\n--- B. Détecteur d'intention (lib-validation-n1) ---");
  verdict("« Acceptée » → VALIDEE", det("Acceptée, bonne continuation.") === "VALIDEE");
  verdict("« Refusée » → REFUSEE", det("Désolé, refusée pour cette période.") === "REFUSEE");
  verdict("Masculin historique « Accepté » → VALIDEE (compatibilité)", det("Accepté.") === "VALIDEE");
  verdict("Masculin historique « Refusé » → REFUSEE (compatibilité)", det("Refusé.") === "REFUSEE");
  verdict("Consigne CITÉE (féminine) seule → null (faux positif évité)",
    det("Une nouvelle demande nécessite votre traitement.\nVALIDATION PAR E-MAIL : répondez « Acceptée » ou « Refusée ».") === null);
  verdict("Décision AU-DESSUS de la citation féminine → VALIDEE",
    det("D'accord.\n\n----- Message d'origine -----\nÉcrire « Acceptée » ou « Refusée ».") === "VALIDEE");

  // ---------- PHASE 2 : SMTP → puits ----------
  console.log("\n--- C. Décision par réponse e-mail — TOUS les types ---");
  demarrerPuits();
  const cfgBdAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const adm = client(BASE);
  const login = await adm.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);
  const putPuits = await adm.put("/api/mail-config", {
    host: "127.0.0.1",
    port: 2525,
    username: "auto-rh@entreprise.tn",
    password: "smtp-pass-216",
    from: "AutoRH <auto-rh@entreprise.tn>",
    rhEmail: EMAIL_RH,
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
    const suffixe = Date.now().toString().slice(-6);

    // ---- C1 : attestation — « Refusée » SANS pièce jointe ----
    const ref1 = "DEM-2026-" + suffixe.slice(0, 4) + "1";
    await creerDemande({ reference: ref1, type: "ATTESTATION_TRAVAIL", destinataire: EMAIL_RH, msgId: "<216-1-" + suffixe + ">", cin: CIN_AT });
    const v1 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Attestation de travail " + ref1 + " (traitement requis)",
      from: { value: [{ address: EMAIL_RH }] },
      inReplyTo: "<216-1-" + suffixe + ">",
      text: "Refusée — le collaborateur n'a plus de contrat actif.",
    });
    verdict("C1 réponse « Refusée » (RH) → TRAITE", v1.statut === "TRAITE", JSON.stringify(v1).slice(0, 120));
    verdict("C1 statut porté à REFUSEE", v1.statutApres === "REFUSEE");
    const b1 = await db.demandeAdministrative.findFirst({ where: { reference: ref1 } });
    verdict("C1 persisté : REFUSEE + traitePar « Auto-RH (e-mail) »",
      b1.statut === "REFUSEE" && String(b1.traitePar || "") === "Auto-RH (e-mail)", b1.traitePar || "");
    verdict("C1 commentaire « Refusée par le service RH… »",
      String(b1.commentaire || "").includes("Refusée par le service RH"), b1.commentaire || "");
    await attendreMails(EMAIL_EMPLOYE, 1);
    const m1 = (await mailsVers(EMAIL_EMPLOYE))[0];
    verdict("C1 e-mail employé : sujet « a été refusée par le service RH »",
      String(m1?.subject || "").includes("a été refusée par le service RH"), (m1?.subject || "").slice(0, 90));
    verdict("C1 e-mail employé : corps « refusée par le service RH »",
      String(m1?.text || "").includes("a été refusée par le service RH"));
    verdict("C1 AUCUNE copie au service RH (décision du RH elle-même)", (await mailsVers(EMAIL_RH)).length === 0);

    // ---- C2 : attestation — « Acceptée » sans pièce jointe ----
    const ref2 = "DEM-2026-" + suffixe.slice(0, 4) + "2";
    await creerDemande({ reference: ref2, type: "ATTESTATION_TRAVAIL", destinataire: EMAIL_RH, msgId: "<216-2-" + suffixe + ">", cin: CIN_AT });
    const v2 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Attestation de travail " + ref2,
      from: { value: [{ address: EMAIL_RH }] },
      text: "Acceptée, bon courage.",
    });
    verdict("C2 réponse « Acceptée » (RH) → ACCEPTEE", v2.statutApres === "ACCEPTEE", JSON.stringify(v2).slice(0, 120));
    await attendreMails(EMAIL_EMPLOYE, 2);
    const m2 = (await mailsVers(EMAIL_EMPLOYE))[1];
    verdict("C2 e-mail employé : « a été acceptée par le service RH »",
      String(m2?.subject || "").includes("a été acceptée par le service RH"), (m2?.subject || "").slice(0, 90));

    // ---- C3 : attestation — document joint + « Refusée » ----
    const ref3 = "DEM-2026-" + suffixe.slice(0, 4) + "3";
    await creerDemande({ reference: ref3, type: "ATTESTATION_TRAVAIL", destinataire: EMAIL_RH, msgId: "<216-3-" + suffixe + ">", cin: CIN_AT });
    const v3 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Attestation de travail " + ref3,
      from: { value: [{ address: EMAIL_RH }] },
      text: "Refusée — voir la lettre de notification jointe.",
      attachments: [{ filename: "lettre-refus-216.pdf", content: PDF_MIN, contentType: "application/pdf" }],
    });
    verdict("C3 document + « Refusée » → REFUSEE", v3.statutApres === "REFUSEE" && v3.docs === 1, JSON.stringify(v3).slice(0, 140));
    const b3 = await db.demandeAdministrative.findFirst({ where: { reference: ref3 } });
    const docs3 = await db.documentDemande.findMany({ where: { demandeId: b3.id } });
    verdict("C3 document importé (DocumentDemande)", docs3.length === 1 && docs3[0].nomFichier === "lettre-refus-216.pdf");
    await attendreMails(EMAIL_EMPLOYE, 3);
    const m3 = (await mailsVers(EMAIL_EMPLOYE))[2];
    const att3 = m3 && m3.attachments ? m3.attachments : [];
    verdict("C3 e-mail employé AVEC pièce jointe (octets = document)",
      att3.length === 1 && Buffer.compare(att3[0].content, PDF_MIN) === 0,
      att3.length ? `${att3[0].filename} — ${att3[0].content.length} octets` : "absent");
    verdict("C3 annonce « Document(s) joint(s) à cet e-mail » + mention portail",
      String(m3?.text || "").includes("Document(s) joint(s) à cet e-mail") &&
      String(m3?.text || "").includes("Mes demandes"));

    // ---- C4 : attestation — ni décision ni pièce jointe → IGNORE ----
    const ref4 = "DEM-2026-" + suffixe.slice(0, 4) + "4";
    await creerDemande({ reference: ref4, type: "ATTESTATION_TRAVAIL", destinataire: EMAIL_RH, msgId: "<216-4-" + suffixe + ">", cin: CIN_AT });
    const v4 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Attestation de travail " + ref4,
      from: { value: [{ address: EMAIL_RH }] },
      text: "Bonjour, veuillez trouver la version finale du dossier.",
    });
    verdict("C4 réponse sans décision ni PJ → IGNORE", v4.statut === "IGNORE", JSON.stringify(v4).slice(0, 140));
    verdict("C4 motif invite à écrire « Acceptée » ou « Refusée »",
      String(v4.motif || "").includes("écrire « Acceptée » ou « Refusée »"), (v4.motif || "").slice(0, 110));

    // ---- C5 : congé — « Acceptée » du N+1 (féminin) → copie RH + employé ----
    const ref5 = "DEM-2026-" + suffixe.slice(0, 4) + "5";
    await creerDemande({ reference: ref5, type: "CONGE", destinataire: EMAIL_N1, msgId: "<216-5-" + suffixe + ">", cin: CIN_CG });
    const v5 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref5 + " (traitement requis)",
      from: { value: [{ address: EMAIL_N1 }] },
      inReplyTo: "<216-5-" + suffixe + ">",
      text: "Acceptée.",
    });
    verdict("C5 congé : « Acceptée » du N+1 → ACCEPTEE", v5.statutApres === "ACCEPTEE", JSON.stringify(v5).slice(0, 120));
    const b5 = await db.demandeAdministrative.findFirst({ where: { reference: ref5 } });
    verdict("C5 traitePar « Responsable N+1 (e-mail) »", String(b5.traitePar || "") === "Responsable N+1 (e-mail)", b5.traitePar || "");
    await attendreMails(EMAIL_RH, 1);
    const m5rh = (await mailsVers(EMAIL_RH))[0];
    verdict("C5 COPIE au service RH : « acceptée par le responsable N+1 »",
      String(m5rh?.subject || "").includes("acceptée par le responsable N+1"), (m5rh?.subject || "").slice(0, 90));
    await attendreMails(EMAIL_EMPLOYE, 4);
    const m5emp = (await mailsVers(EMAIL_EMPLOYE))[3];
    verdict("C5 e-mail employé : « acceptée par votre responsable N+1 »",
      String(m5emp?.subject || "").includes("acceptée par votre responsable N+1"), (m5emp?.subject || "").slice(0, 90));

    // ---- C6 : congé — « Refusée » du N+1 ----
    const ref6 = "DEM-2026-" + suffixe.slice(0, 4) + "6";
    await creerDemande({ reference: ref6, type: "CONGE", destinataire: EMAIL_N1, msgId: "<216-6-" + suffixe + ">", cin: CIN_CG });
    const v6 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref6,
      from: { value: [{ address: EMAIL_N1 }] },
      text: "Refusée pour cette période.",
    });
    verdict("C6 congé : « Refusée » du N+1 → REFUSEE", v6.statutApres === "REFUSEE", JSON.stringify(v6).slice(0, 120));

    // ---- C7 : mauvais expéditeur → IGNORE (régression Task 178) ----
    const v7 = await portail.traiterMessageRecu({
      subject: "Re: AutoRH — Demande de congé " + ref6,
      from: { value: [{ address: "imposteur216@pirate.test" }] },
      text: "Acceptée",
    });
    verdict("C7 mauvais expéditeur → IGNORE (anti-validation croisée)", v7.statut === "IGNORE", JSON.stringify(v7).slice(0, 120));
  } finally {
    // ---------- NETTOYAGE + restauration exacte ----------
    const demTest = await db.demandeAdministrative.findMany({
      where: { cin: { in: [cinDet1, cinDet2] } },
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
    await db.demandeAdministrative.deleteMany({ where: { cin: { in: [cinDet1, cinDet2] } } });
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
  }

  console.log(`\n== RÉSULTAT v0.2.108 : ${ok} OK / ${ko} KO ==`);
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(2); });
