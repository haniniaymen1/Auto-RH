#!/usr/bin/env node
/**
 * Task 196 — SEMIS DE DÉMONSTRATION (preuves navigateur) :
 * crée une demande CONGE + réponse manager avec 2 pièces jointes + réponse RH
 * avec 1 pièce jointe, SANS nettoyage (les captures d'écran suivent, le
 * nettoyage est fait par nettoyage-demo-task196.js).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;

const MANAGER = "manager.demo196@test.local";
const RH = "rh.demo196@test.local";
const EMPLOYE = "employe.demo196@test.local";
const CIN_DEMO = "TS1960DEMO1";
const REF = "DEM-2026-13299";

function pdfMinimal(marqueur) {
  return Buffer.from(
    "%PDF-1.4\n% " + marqueur + "-" + crypto.randomUUID() + "\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF\n",
    "latin1"
  );
}
function message({ sujet, de, inReplyTo, texte, piecesJointes = [] }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "X" }] },
    inReplyTo, references: [inReplyTo], text: texte, html: null,
    attachments: piecesJointes,
  };
}

async function main() {
  // la réponse RH n'est acceptée que si l'expéditeur = MailConfig.rhEmail :
  // sauvegarde + bascule temporaire + restauration (comme les tests).
  const cfgAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  if (cfgAvant) {
    await db.mailConfig.update({ where: { id: "smtp" }, data: { rhEmail: RH } });
  } else {
    await db.mailConfig.create({ data: {
      id: "smtp", host: "127.0.0.1", port: 2525, from: "demo@test.local", rhEmail: RH,
    }});
  }
  try { await suite(); } finally {
    if (cfgAvant) await db.mailConfig.update({ where: { id: "smtp" }, data: cfgAvant });
    else await db.mailConfig.delete({ where: { id: "smtp" } }).catch(() => { });
  }
}

async function suite() {
  // purge défensive
  const anciennes = await db.demandeAdministrative.findMany({ where: { reference: REF }, select: { id: true } });
  for (const d of anciennes) {
    const docs = await db.documentDemande.findMany({ where: { demandeId: d.id } });
    for (const doc of docs) {
      for (const base of ["storage/documents-demandes/" + doc.chemin, doc.chemin]) {
        try { fs.unlinkSync(base); break; } catch { }
      }
    }
    await db.documentDemande.deleteMany({ where: { demandeId: d.id } });
    await db.demandeAdministrative.delete({ where: { id: d.id } }).catch(() => { });
  }

  const demande = await db.demandeAdministrative.create({
    data: {
      reference: REF,
      type: "CONGE",
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_DEMO, true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2027-02-01", dateFin: "2027-02-12",
        emailN1: MANAGER, commentaire: "Démonstration pièces jointes Task 196",
      })),
      messageIdEnvoi: "dem196-demo@test",
    },
  });

  await portail.traiterMessageRecu(message({
    sujet: "RE: " + REF, de: MANAGER, inReplyTo: "<dem196-demo@test>",
    texte: "Congé accepté. Vous trouverez en pièces jointes le planning de l'équipe ainsi que le justificatif d'effectif.",
    piecesJointes: [
      { filename: "planning-equipe.pdf", content: pdfMinimal("planning"), contentType: "application/pdf" },
      { filename: "justificatif-effectif.pdf", content: pdfMinimal("effectif"), contentType: "application/pdf" },
    ],
  }));
  await portail.traiterMessageRecu(message({
    sujet: "RE: " + REF, de: RH, inReplyTo: "<dem196-demo@test>",
    texte: "Vu, je regarde et je vous reviens rapidement.",
    piecesJointes: [
      { filename: "note-auto-rh.pdf", content: pdfMinimal("note-rh"), contentType: "application/pdf" },
    ],
  }));

  const docs = await db.documentDemande.findMany({ where: { demandeId: demande.id } });
  console.log("Demande de démonstration créée : " + REF + " (id=" + demande.id + ")");
  console.log("Documents : " + docs.map((d) => d.nomFichier + " (" + d.recuDe + ")").join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
