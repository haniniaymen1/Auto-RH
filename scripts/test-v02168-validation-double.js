#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E v0.2.168 — VALIDATION À DEUX ÉTAPES MANAGER + RH (congé/autorisation)
 * Règles utilisateur (trace 1a12234c04eb0e79 / 1a1224026757efa5) :
 *
 *   1. ACCEPTATION : la réponse automatique avec le PDF SIGNÉ
 *      ÉLECTRONIQUEMENT ne part que lorsque manager ET service RH ont
 *      TOUS LES DEUX accepté la demande.
 *   2. REFUS : si le manager OU le service RH refuse par e-mail, la réponse
 *      automatique de refus avec le PDF signé part IMMÉDIATEMENT, sans
 *      attendre la réponse de l'autre responsable.
 *   3. STATUT MANAGER : quand le RH répond AVANT le manager, la réponse
 *      ULTÉRIEURE du manager doit être prise en compte (son statut passe à
 *      « Acceptée »/« Refusée » selon SA décision — plus jamais bloqué à
 *      « En attente »).
 *
 * SCÉNARIOS OBLIGATOIRES :
 *   S1 — RH répond en premier, puis le manager   (congé)
 *   S2 — Manager répond en premier, puis le RH   (autorisation de sortie)
 *   S3 — L'un des deux refuse avant l'autre      (congé ×2 : manager d'abord,
 *        puis RH d'abord)
 * CAS LIMITES ADDITIONNELS :
 *   S4 — RH accepte, puis manager refuse → REFUSÉE (règle OU-refus)
 *   S5 — Autorisation routée DIRECTEMENT au service RH (aucun manager) :
 *        réponse RH = décision unique (comportement v0.2.151 conservé)
 *
 * HARNaIS : le VRAI traiterMessageRecu du portail (module), SMTP de CAPTURE
 * local (les e-mails partants sont interceptés et analysés avec mailparser :
 * destinataires, CC, PIÈCE JOINTE PDF signée), certificat PKCS#12 de test →
 * signature cryptographique RÉELLE (signatureCrypto = true).
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim(); // OVERRIDES : la DB de test DOIT être celle du répertoire travail
}
const crypto = require("crypto");
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;

const SMTP_PORT = 12530;
const MANAGER = "manager.dual168@test.local";
const RH = "rh.dual168@test.local";
const EMPLOYE = "employe.dual168@test.local";
const CIN_TEST = "TS168DUAL1";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function relancer() { return new Promise((r) => setTimeout(r, 400)); }

/* ---------- serveur SMTP de CAPTURE ---------- */
const messagesCaptures = [];
const serveurSmtp = new SMTPServer({
  authOptional: true,
  onRcptTo(a, s, cb) { cb(); },
  onData(flux, session, cb) {
    const morceaux = [];
    flux.on("data", (d) => morceaux.push(d));
    flux.on("end", () => { messagesCaptures.push(Buffer.concat(morceaux)); cb(); });
    flux.on("error", () => cb(new Error("flux interrompu")));
  },
});
async function emailsCaptures() {
  await relancer();
  const parses = [];
  for (const brut of messagesCaptures) {
    try { parses.push(await simpleParser(brut)); } catch { /* */ }
  }
  return parses;
}
function viderCaptures() { messagesCaptures.length = 0; }

/* ---------- message « parsed » (comme simpleParser) ---------- */
function message({ sujet, de, inReplyTo = null, texte = "", piecesJointes = [] }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "X" }] },
    inReplyTo,
    references: inReplyTo ? [inReplyTo] : undefined,
    text: texte,
    html: null,
    attachments: piecesJointes,
  };
}

/* ---------- création d'une demande de test ---------- */
async function creerDemande(reference, messageId, type, destinataire) {
  const donnees = type === "CONGE"
    ? { typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18", emailN1: destinataire, commentaire: "Test v0.2.168" }
    : { nom: "Employé Test Dual", date: "2026-12-09", departement: "IT", motif: "Rendez-vous médical", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  return db.demandeAdministrative.create({
    data: {
      reference,
      type,
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(destinataire),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: messageId,
    },
  });
}

async function lireDemande(id) {
  return db.demandeAdministrative.findUnique({ where: { id } });
}

async function lireHistorique(demandeId) {
  const d = await db.demandeAdministrative.findUnique({ where: { id: demandeId } });
  if (!d || !d.reponsesRecues) return [];
  try {
    const liste = JSON.parse(cryptoBd.dechiffrerChamp(d.reponsesRecues) || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch { return []; }
}

/** Purge des demandes de test + fichiers de documents associés. */
async function nettoyerDemandesTest() {
  const demandes = await db.demandeAdministrative.findMany({
    where: { reference: { startsWith: "DEM-2026-140" } },
    select: { id: true },
  });
  for (const d of demandes) {
    const docs = await db.documentDemande.findMany({ where: { demandeId: d.id } });
    for (const doc of docs) {
      for (const base of ["storage/documents-demandes/" + doc.chemin, doc.chemin]) {
        try { fs.unlinkSync(base); break; } catch { /* suivant */ }
      }
    }
    await db.documentDemande.deleteMany({ where: { demandeId: d.id } });
    await db.demandeAdministrative.delete({ where: { id: d.id } }).catch(() => {});
  }
}

/* ---------- vérifications d'un e-mail de décision avec PDF signé ---------- */
function verifierEmailDecision(parses, etiquette, attendus) {
  const email = parses.find((p) => p.subject && p.subject.indexOf(attendus.sujetContient) >= 0);
  check(etiquette + " : e-mail de décision parti (sujet « " + attendus.sujetContient + " »)", Boolean(email),
    email ? "sujet=" + email.subject : "AUCUN e-mail capturé (" + parses.length + " message(s) : " + parses.map((p) => p.subject).join(" | ") + ")");
  if (!email) return null;
  const dest = (email.to && email.to.value || []).map((v) => v.address.toLowerCase());
  check(etiquette + " : destinataire = employé", dest.indexOf(EMPLOYE) >= 0, dest.join(", "));
  const cc = (email.cc && email.cc.value || []).map((v) => v.address.toLowerCase());
  if (attendus.cc && attendus.cc.length) {
    check(etiquette + " : CC = " + attendus.cc.join(" + "), attendus.cc.every((a) => cc.indexOf(a) >= 0), cc.join(", "));
  }
  const pj = (email.attachments || []).find((a) => (a.contentType || "").indexOf("pdf") >= 0);
  check(etiquette + " : PDF signé EN PIÈCE JOINTE", Boolean(pj), pj ? pj.filename + " (" + pj.content.length + " o)" : "absente");
  if (pj) {
    check(etiquette + " : pièce jointe = PDF authentique (%PDF en tête)", pj.content.subarray(0, 4).toString() === "%PDF", pj.content.subarray(0, 8).toString());
    check(etiquette + " : PDF substantiel (> 2 Ko)", pj.content.length > 2048, pj.content.length + " o");
  }
  const texte = (email.text || "") + (email.html || "");
  check(etiquette + " : corps mentionne le document joint", /joint/i.test(texte), "");
  return email;
}

async function main() {
  console.log("== TEST E2E v0.2.168 — VALIDATION DOUBLE MANAGER + RH ==");
  await new Promise((resolve) => serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resolve));
  console.log("-- SMTP de capture local : 127.0.0.1:" + SMTP_PORT + " --");

  // ---- configuration mail (SMTP de capture) + certificat de signature ----
  await db.mailConfig.upsert({
    where: { id: "smtp" },
    create: { id: "smtp", host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH },
    update: { host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH, imapActif: false },
  });
  // certificat PKCS#12 de test (source MODULE — signature cryptographique réelle)
  await db.signatureApiConfig.upsert({
    where: { id: "signature-api" },
    create: {
      id: "signature-api",
      actif: true,
      signerReponses: true,
      certChemin: "storage/certificats/test-e2e.p12",
      certMotDePasse: cryptoBd.chiffrerChamp("E2E-AutoRH-2026!"),
      certFichierNom: "test-e2e.p12",
    },
    update: {
      actif: true,
      signerReponses: true,
      certChemin: "storage/certificats/test-e2e.p12",
      certMotDePasse: cryptoBd.chiffrerChamp("E2E-AutoRH-2026!"),
    },
  });
  // configuration doc : génération + mention actives (défauts historiques)
  await db.signatureConfig.upsert({
    where: { id: "signature" },
    create: { id: "signature" },
    update: {},
  });

  await nettoyerDemandesTest();
  viderCaptures();

  /* ======================================================================
   * S1 — RH répond en PREMIER, puis le manager (congé)
   * ==================================================================== */
  console.log("\n— S1 : RH répond d'abord, puis le manager (congé) —");
  const d1 = await creerDemande("DEM-2026-14001", "dual168-a@test", "CONGE", MANAGER);

  const rRh1 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14001 (traitement requis)",
    de: RH, inReplyTo: "<dual168-a@test>",
    texte: "Acceptée",
  }));
  const apresRh1 = await lireDemande(d1.id);
  check("S1 · réponse RH « Acceptée » traitée", rRh1.statut === "TRAITE", "retour=" + rRh1.statut);
  check("S1 · décision RH tracée (ACCEPTEE)", apresRh1.decisionRh === "ACCEPTEE", "decisionRh=" + apresRh1.decisionRh);
  check("S1 · statut TOUJOURS EN_ATTENTE (les 2 acceptations requises)", apresRh1.statut === "EN_ATTENTE", "statut=" + apresRh1.statut);
  check("S1 · PAS de décision manager encore (son statut reste « En attente »)", !apresRh1.decisionManager, "decisionManager=" + apresRh1.decisionManager);
  check("S1 · commentaire annonce l'attente du manager", /en attente de la validation du manager/i.test(apresRh1.commentaire || ""), (apresRh1.commentaire || "").slice(-90));
  check("S1 · document signé NON généré (pas de décision finale)", !apresRh1.docSigneChemin, apresRh1.docSigneChemin || "");
  let emails = await emailsCaptures();
  check("S1 · AUCUNE réponse automatique envoyée aux RH seuls", emails.length === 0, emails.length + " message(s)");

  const rMgr1 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14001 (traitement requis)",
    de: MANAGER, inReplyTo: "<dual168-a@test>",
    texte: "OK pour moi, bon congé.",
  }));
  const apresMgr1 = await lireDemande(d1.id);
  check("S1 · réponse MANAGER traitée (bug corrigé : plus ignorée)", rMgr1.statut === "TRAITE", "retour=" + rMgr1.statut + (rMgr1.motif ? " (" + rMgr1.motif.slice(0, 80) + ")" : ""));
  check("S1 · statut MANAGER mis à jour → ACCEPTEE (plus « En attente »)", apresMgr1.decisionManager === "ACCEPTEE", "decisionManager=" + apresMgr1.decisionManager);
  check("S1 · statut FINAL ACCEPTEE (matrice complète)", apresMgr1.statut === "ACCEPTEE", "statut=" + apresMgr1.statut);
  check("S1 · document signé généré (docSigneChemin)", Boolean(apresMgr1.docSigneChemin), apresMgr1.docSigneNom || "");
  check("S1 · déclencheur = validation deux étapes complète", /deux étapes/i.test(apresMgr1.docSignePar || ""), apresMgr1.docSignePar || "");
  emails = await emailsCaptures();
  const emailS1 = verifierEmailDecision(emails, "S1", { sujetContient: "acceptée : DEM-2026-14001", cc: [RH, MANAGER] });
  if (emailS1) {
    check("S1 · UN SEUL e-mail de décision (PDF fusionné, pas de 2ᵉ envoi)", emails.filter((p) => /acceptée : DEM-2026-14001/.test(p.subject || "")).length === 1, emails.length + " message(s) au total");
  }
  const docS1 = await db.documentDemande.findFirst({ where: { demandeId: d1.id, recuDe: { contains: "signé" } } });
  check("S1 · DocumentDemande du document signé conservé (visible employé/RH)", Boolean(docS1), docS1 ? docS1.nomFichier : "absent");
  check("S1 · signature cryptographique appliquée (certificat P12)", rMgr1.docSigne && rMgr1.docSigne.signatureCrypto === true, "signatureCrypto=" + (rMgr1.docSigne && rMgr1.docSigne.signatureCrypto));
  const hist1 = await lireHistorique(d1.id);
  check("S1 · historique : 2 réponses tracées (rh puis manager)", hist1.length === 2 && hist1[0].role === "rh" && hist1[1].role === "manager", hist1.map((h) => h.role).join(" → "));
  viderCaptures();

  /* ======================================================================
   * S2 — Manager répond en PREMIER, puis le RH (autorisation de sortie)
   * ==================================================================== */
  console.log("\n— S2 : manager répond d'abord, puis le RH (autorisation de sortie) —");
  const d2 = await creerDemande("DEM-2026-14002", "dual168-b@test", "AUTORISATION_SORTIE", MANAGER);

  const rMgr2 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Autorisation de sortie DEM-2026-14002 (traitement requis)",
    de: MANAGER, inReplyTo: "<dual168-b@test>",
    texte: "J'accepte cette sortie.",
  }));
  const apresMgr2 = await lireDemande(d2.id);
  check("S2 · acceptation manager : décision tracée ACCEPTEE", apresMgr2.decisionManager === "ACCEPTEE", "decisionManager=" + apresMgr2.decisionManager);
  check("S2 · statut EN_ATTENTE (validation RH requise)", apresMgr2.statut === "EN_ATTENTE", "statut=" + apresMgr2.statut);
  check("S2 · document signé NON généré (RH pas encore décidé)", !apresMgr2.docSigneChemin, "");
  emails = await emailsCaptures();
  const transmission = emails.find((p) => /validation RH requise/i.test(p.subject || ""));
  check("S2 · TRANSMISSION automatique au service RH partiel", Boolean(transmission), transmission ? transmission.subject : emails.map((p) => p.subject).join(" | "));
  check("S2 · transmission adressée au RH", transmission && (transmission.to.value[0].address || "").toLowerCase() === RH, transmission ? JSON.stringify(transmission.to.value.map((v) => v.address)) : "");
  viderCaptures();

  const rRh2 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Autorisation de sortie DEM-2026-14002 (traitement requis)",
    de: RH, inReplyTo: "<dual168-b@test>",
    texte: "Je valide.",
  }));
  const apresRh2 = await lireDemande(d2.id);
  check("S2 · décision RH tracée ACCEPTEE", apresRh2.decisionRh === "ACCEPTEE", "decisionRh=" + apresRh2.decisionRh);
  check("S2 · statut FINAL ACCEPTEE", apresRh2.statut === "ACCEPTEE", "statut=" + apresRh2.statut);
  check("S2 · document signé généré", Boolean(apresRh2.docSigneChemin), apresRh2.docSigneNom || "");
  check("S2 · signature cryptographique appliquée", rRh2.docSigne && rRh2.docSigne.signatureCrypto === true, "signatureCrypto=" + (rRh2.docSigne && rRh2.docSigne.signatureCrypto));
  emails = await emailsCaptures();
  verifierEmailDecision(emails, "S2", { sujetContient: "acceptée : DEM-2026-14002", cc: [MANAGER] });
  const hist2 = await lireHistorique(d2.id);
  check("S2 · historique : manager → rh", hist2.length === 2 && hist2[0].role === "manager" && hist2[1].role === "rh", hist2.map((h) => h.role).join(" → "));
  viderCaptures();

  /* ======================================================================
   * S3a — Le MANAGER refuse avant la réponse du RH (congé)
   * ==================================================================== */
  console.log("\n— S3a : le manager refuse AVANT la réponse du RH (congé) —");
  const d3a = await creerDemande("DEM-2026-14003", "dual168-c@test", "CONGE", MANAGER);

  const rMgr3a = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14003 (traitement requis)",
    de: MANAGER, inReplyTo: "<dual168-c@test>",
    texte: "Je refuse, période chargée.",
  }));
  const apresMgr3a = await lireDemande(d3a.id);
  check("S3a · REFUS IMMÉDIAT (sans attendre le RH)", apresMgr3a.statut === "REFUSEE", "statut=" + apresMgr3a.statut);
  check("S3a · refuseePar = MANAGER", apresMgr3a.refuseePar === "MANAGER", "refuseePar=" + apresMgr3a.refuseePar);
  check("S3a · décision manager REFUSEE", apresMgr3a.decisionManager === "REFUSEE", "decisionManager=" + apresMgr3a.decisionManager);
  check("S3a · document de refus signé généré (docRefusChemin)", Boolean(apresMgr3a.docRefusChemin), apresMgr3a.docRefusNom || "");
  check("S3a · signature cryptographique du refus", rMgr3a.docRefus && rMgr3a.docRefus.signatureCrypto === true, "signatureCrypto=" + (rMgr3a.docRefus && rMgr3a.docRefus.signatureCrypto));
  emails = await emailsCaptures();
  const emailS3a = verifierEmailDecision(emails, "S3a", { sujetContient: "refusée : DEM-2026-14003", cc: [RH] });
  const notifRh3a = emails.find((p) => /refusée par le manager/i.test(p.subject || ""));
  check("S3a · service RH NOTIFIÉ du refus manager", Boolean(notifRh3a), notifRh3a ? notifRh3a.subject : "sujets=" + emails.map((p) => p.subject).join(" | "));

  // le RH répond ENSUITE → ignoré (décision déjà définitive), trace conservée
  const rRh3a = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14003 (traitement requis)",
    de: RH, inReplyTo: "<dual168-c@test>",
    texte: "Acceptée finalement.",
  }));
  const apresRh3a = await lireDemande(d3a.id);
  check("S3a · réponse tardive du RH : statut reste REFUSEE", apresRh3a.statut === "REFUSEE" && apresRh3a.decisionRh === null, "statut=" + apresRh3a.statut + " decisionRh=" + apresRh3a.decisionRh);
  const hist3a = await lireHistorique(d3a.id);
  check("S3a · réponse tardive TRACÉE dans l'historique (consultable)", hist3a.length === 2 && hist3a[1].role === "rh", hist3a.map((h) => h.role).join(" → "));
  viderCaptures();

  /* ======================================================================
   * S3b — Le RH refuse avant la réponse du manager (congé)
   * ==================================================================== */
  console.log("\n— S3b : le RH refuse AVANT la réponse du manager (congé) —");
  const d3b = await creerDemande("DEM-2026-14004", "dual168-d@test", "CONGE", MANAGER);

  const rRh3b = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14004 (traitement requis)",
    de: RH, inReplyTo: "<dual168-d@test>",
    texte: "Refusée — effectifs insuffisants sur la période.",
  }));
  const apresRh3b = await lireDemande(d3b.id);
  check("S3b · REFUS IMMÉDIAT du RH (sans attendre le manager)", apresRh3b.statut === "REFUSEE", "statut=" + apresRh3b.statut);
  check("S3b · refuseePar = RH", apresRh3b.refuseePar === "RH", "refuseePar=" + apresRh3b.refuseePar);
  check("S3b · décision RH REFUSEE", apresRh3b.decisionRh === "REFUSEE", "decisionRh=" + apresRh3b.decisionRh);
  check("S3b · document de refus signé généré", Boolean(apresRh3b.docRefusChemin), apresRh3b.docRefusNom || "");
  emails = await emailsCaptures();
  verifierEmailDecision(emails, "S3b", { sujetContient: "refusée : DEM-2026-14004", cc: [MANAGER] });

  // le manager accepte ENSUITE → ignoré (décision définitive)
  const rMgr3b = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14004 (traitement requis)",
    de: MANAGER, inReplyTo: "<dual168-d@test>",
    texte: "OK pour moi.",
  }));
  const apresMgr3b = await lireDemande(d3b.id);
  check("S3b · réponse tardive du manager : statut reste REFUSEE", apresMgr3b.statut === "REFUSEE", "statut=" + apresMgr3b.statut);
  check("S3b · AUCUN document d'acceptation généré (refus définitif)", !apresMgr3b.docSigneChemin, "");
  viderCaptures();

  /* ======================================================================
   * S4 — RH accepte, puis MANAGER refuse → REFUSÉE (règle OU-refus)
   * ==================================================================== */
  console.log("\n— S4 : RH accepte puis le manager refuse → refus immédiat —");
  const d4 = await creerDemande("DEM-2026-14005", "dual168-e@test", "CONGE", MANAGER);
  await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14005 (traitement requis)",
    de: RH, inReplyTo: "<dual168-e@test>",
    texte: "Acceptée.",
  }));
  const rMgr4 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Congé DEM-2026-14005 (traitement requis)",
    de: MANAGER, inReplyTo: "<dual168-e@test>",
    texte: "Je ne valide pas cette demande.",
  }));
  const apresMgr4 = await lireDemande(d4.id);
  check("S4 · refus du manager APRÈS acceptation RH → REFUSEE", apresMgr4.statut === "REFUSEE", "statut=" + apresMgr4.statut);
  check("S4 · refuseePar = MANAGER", apresMgr4.refuseePar === "MANAGER", "refuseePar=" + apresMgr4.refuseePar);
  check("S4 · statut manager = REFUSEE (sa décision est prise en compte)", apresMgr4.decisionManager === "REFUSEE", "decisionManager=" + apresMgr4.decisionManager);
  check("S4 · document de refus généré + signature", Boolean(apresMgr4.docRefusChemin) && rMgr4.docRefus && rMgr4.docRefus.signatureCrypto === true, apresMgr4.docRefusNom || "");
  emails = await emailsCaptures();
  verifierEmailDecision(emails, "S4", { sujetContient: "refusée : DEM-2026-14005", cc: [RH] });
  viderCaptures();

  /* ======================================================================
   * S5 — Autorisation routée DIRECTEMENT au service RH (aucun manager)
   *      → réponse RH = décision unique (v0.2.151 conservé)
   * ==================================================================== */
  console.log("\n— S5 : autorisation adressée directement au service RH (aucun manager) —");
  const d5 = await creerDemande("DEM-2026-14006", "dual168-f@test", "AUTORISATION_SORTIE", RH);
  const rRh5 = await portail.traiterMessageRecu(message({
    sujet: "RE: AutoRH — Autorisation de sortie DEM-2026-14006 (traitement requis)",
    de: RH, inReplyTo: "<dual168-f@test>",
    texte: "Acceptée.",
  }));
  const apresRh5 = await lireDemande(d5.id);
  check("S5 · réponse RH (destinataire direct) = décision unique → ACCEPTEE", apresRh5.statut === "ACCEPTEE", "statut=" + apresRh5.statut);
  check("S5 · étape manager satisfaite automatiquement (tracée)", apresRh5.decisionManager === "ACCEPTEE" && /automatique/i.test(apresRh5.decisionManagerPar || ""), apresRh5.decisionManagerPar || "");
  check("S5 · document signé généré", Boolean(apresRh5.docSigneChemin), apresRh5.docSigneNom || "");
  emails = await emailsCaptures();
  verifierEmailDecision(emails, "S5", { sujetContient: "acceptée : DEM-2026-14006" });
  viderCaptures();

  /* ======================================================================
   * NON-RÉGRESSION — la matrice historique reste correcte
   * ==================================================================== */
  console.log("\n— non-régression matrice deux étapes —");
  const m1 = portail.calculerStatutFinalDeuxEtapes("ACCEPTEE", "ACCEPTEE");
  const m2 = portail.calculerStatutFinalDeuxEtapes("ACCEPTEE", null);
  const m3 = portail.calculerStatutFinalDeuxEtapes(null, "ACCEPTEE");
  const m4 = portail.calculerStatutFinalDeuxEtapes("REFUSEE", "ACCEPTEE");
  const m5 = portail.calculerStatutFinalDeuxEtapes("ACCEPTEE", "REFUSEE");
  check("matrice : ACCEPTEE+ACCEPTEE → ACCEPTEE", m1.statut === "ACCEPTEE", "");
  check("matrice : manager seul → EN_ATTENTE", m2.statut === "EN_ATTENTE", "");
  check("matrice : RH seul → EN_ATTENTE", m3.statut === "EN_ATTENTE", "");
  check("matrice : refus manager → REFUSEE/MANAGER", m4.statut === "REFUSEE" && m4.refuseePar === "MANAGER", "");
  check("matrice : refus RH → REFUSEE/RH", m5.statut === "REFUSEE" && m5.refuseePar === "RH", "");

  /* ======================================================================
   * NETTOYAGE
   * ==================================================================== */
  console.log("\n— nettoyage —");
  await nettoyerDemandesTest();
  const reste = await db.demandeAdministrative.count({ where: { reference: { startsWith: "DEM-2026-140" } } });
  check("nettoyage : demandes de test supprimées", reste === 0, "restantes=" + reste);
  serveurSmtp.close(() => {});

  console.log("\n========================================");
  console.log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  console.log("========================================");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE :", e); process.exit(1); });
