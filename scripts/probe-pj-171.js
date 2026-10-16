#!/usr/bin/env node
/**
 * PROBE v0.2.171 — scénario minimal C1 (1 PJ manager + 1 PJ RH) pour
 * diagnostiquer l'import des pièces jointes du RH via le scan « Envoyés ».
 * Référence DEM-2026-16101 (sans collision avec les runs précédents).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const nodemailer = require("nodemailer");

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };
const REF = "DEM-2026-16101";
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 60>>stream\nBT /F1 10 Tf 20 60 Td (Probe PJ Auto-RH v0.2.171) Tj ET\nendstream\nendobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
  "trailer<</Root 1 0 R/Size 6>>\n%%EOF\n", "latin1");

function log(s) { try { fs.writeSync(1, s + "\n"); } catch (_) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function h() { return new Date().toISOString().slice(11, 23); }

async function main() {
  log("== PROBE v0.2.171 — " + REF + " ==");
  await db.demandeAdministrative.deleteMany({ where: { reference: REF } });
  const d = await db.demandeAdministrative.create({
    data: {
      reference: REF, type: "CONGE", statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp("TS168PJ1711", true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ typeConge: "Congé annuel", dateDebut: "2027-05-01", dateFin: "2027-05-05", commentaire: "Probe PJ v0.2.171" })),
      messageIdEnvoi: "pj171probe-" + Date.now() + "@auto-rh.test",
    },
  });
  log("[" + h() + "] demande créée");
  // manager accepte AVEC 1 PJ
  await nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false } }).sendMail({
    from: ZOHO.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + REF + " (traitement requis)",
    text: "Acceptée.", inReplyTo: "<" + d.messageIdEnvoi + ">", references: "<" + d.messageIdEnvoi + ">",
    attachments: [{ filename: "pj-manager-probe.pdf", content: PDF_MIN, contentType: "application/pdf" }],
  });
  log("[" + h() + "] réponse manager envoyée (+1 PJ)");
  let ok1 = false;
  for (let i = 0; i < 25; i++) {
    await sleep(4000);
    const x = await db.demandeAdministrative.findFirst({ where: { reference: REF } });
    if (x && x.decisionManager === "ACCEPTEE") { ok1 = true; log("[" + h() + "] decisionManager=ACCEPTEE"); break; }
  }
  if (!ok1) { log("[" + h() + "] ÉCHEC : decisionManager non détecté"); process.exitCode = 1; await db.$disconnect(); return; }
  // RH accepte AVEC 1 PJ
  await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } }).sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Congé " + REF + " (traitement requis)",
    text: "Validé en RH.", inReplyTo: "<" + d.messageIdEnvoi + ">", references: "<" + d.messageIdEnvoi + ">",
    attachments: [{ filename: "pj-rh-probe.pdf", content: PDF_MIN, contentType: "application/pdf" }],
  });
  log("[" + h() + "] réponse RH envoyée (+1 PJ)");
  let ok2 = false;
  for (let i = 0; i < 25; i++) {
    await sleep(4000);
    const x = await db.demandeAdministrative.findFirst({ where: { reference: REF } });
    if (x && x.statut === "ACCEPTEE") { ok2 = true; log("[" + h() + "] statut=ACCEPTEE"); break; }
  }
  const docs = await db.documentDemande.findMany({ where: { demande: { reference: REF } }, select: { nomFichier: true, recuDe: true } });
  log("[" + h() + "] documents en base : " + JSON.stringify(docs));
  process.exitCode = ok2 ? 0 : 1;
  await db.$disconnect();
}
main().catch(async (e) => { log("ERREUR : " + (e && e.message)); process.exitCode = 1; try { await db.$disconnect(); } catch (_) {} });
