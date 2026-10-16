#!/usr/bin/env node
/**
 * ============================================================================
 * Task 194 — RECONNAISSANCE AUTOMATIQUE DES RÉPONSES E-MAIL (validation /
 * refus d'une demande de congé) — cahier des charges complet :
 *
 *   §1  formulations d'ACCEPTATION (21 listées + variantes mineures)
 *   §2  formulations de REFUS (21 listées + variantes mineures)
 *   §3  analyse automatique : identification, décision, HISTORIQUE (date,
 *       heure, expéditeur, texte original) — via le VRAI traiterMessageRecu
 *   §4  pièces jointes : récupérées, conservées, associées, consultables
 *   §5  réponses AMBIGUÏES / inconnues → statut reste « En attente »
 *   §6  PRIORITÉ DU REFUS EXPLICITE (négations : « Je ne valide pas »…)
 *   §7  tableau final (validation / refus / ambigu / aucun e-mail)
 *
 * Le script restaure la configuration et supprime ses données de test.
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { SMTPServer } = require("smtp-server");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const classificationReponses = require("./classification-reponses.js");

const ADMIN = "http://127.0.0.1:4000";
const SMTP_PORT = 12529;
const MANAGER = "manager.diag194@test.local";
const RH = "rh.diag194@test.local";
const EMPLOYE = "employe.diag194@test.local";
const CIN_TEST = "TS1940RECO";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

/* ---------- serveur SMTP de CAPTURE (les notifications partent localement) -- */
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

/* ---------- client HTTP administrateur (cookie persistant) ---------- */
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null;
    try { json = JSON.parse(texte); } catch { /* html */ }
    return { status: res.status, json, texte };
  };
  return { req, post: (p, corps) => req("POST", p, corps), get: (p) => req("GET", p) };
}

/* ---------- construction d'un message « parsed » (comme simpleParser) ----- */
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

/* ---------- création d'une demande de congé de test ----------------------- */
async function creerDemande(reference, messageId, statut) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: statut || "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: MANAGER, commentaire: "Dossier Task 194",
      })),
      messageIdEnvoi: messageId,
    },
  });
}

/** Purge toutes les demandes de test (référence non chiffrée) + leurs documents. */
async function nettoyerDemandesTest() {
  const demandes = await db.demandeAdministrative.findMany({
    where: { reference: { startsWith: "DEM-2026-1300" } },
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
  return db.demandeAdministrative.count({ where: { reference: { startsWith: "DEM-2026-1300" } } });
}

/** Lit l'historique déchiffré des réponses reçues d'une demande. */
async function lireHistorique(demandeId) {
  const d = await db.demandeAdministrative.findUnique({ where: { id: demandeId } });
  if (!d || !d.reponsesRecues) return [];
  try {
    const liste = JSON.parse(cryptoBd.dechiffrerChamp(d.reponsesRecues) || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch { return []; }
}

/* ---------- PDF minimal (pièce jointe de test) ---------------------------- */
function pdfMinimal() {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF\n",
    "latin1"
  );
}

async function main() {
  console.log("== Task 194 — RECONNAISSANCE AUTOMATIQUE DES RÉPONSES E-MAIL ==");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" });
  check("Connexion superadministrateur", login.status === 200, "status=" + login.status);

  const cfgMailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });

  await new Promise((resolve) => serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resolve));
  console.log("-- serveur SMTP de capture local sur 127.0.0.1:" + SMTP_PORT + " --");

  if (cfgMailAvant) {
    await db.mailConfig.update({ where: { id: "smtp" }, data: {
      host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
    }});
  } else {
    await db.mailConfig.create({ data: {
      id: "smtp", host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
    }});
  }

  const { classifierReponse } = classificationReponses;
  const cl = (s, c) => classifierReponse(s, c || "");

  /* ==========================================================================
   * §1 — LES 21 FORMULATIONS D'ACCEPTATION DU CAHIER DES CHARGES
   * ======================================================================= */
  console.log("\n— §1 : les 21 formulations d'acceptation (sujet OU corps) —");
  const ACC21 = [
    "Demande de congé acceptée", "Congé accepté", "Congé validé",
    "Demande de congé validée", "Demande de congé approuvée", "Congé approuvé",
    "Demande de congé accordée", "Congé accordé",
    "Votre demande de congé a été acceptée", "Votre demande de congé a été validée",
    "Votre demande de congé a été approuvée",
    "Votre congé a été accepté", "Votre congé a été validé",
    "Validation de votre demande de congé", "Validation de la demande de congé",
    "Validation du congé", "Confirmation de validation de la demande de congé",
    "OK", "J'accorde", "Je valide", "D'accord",
  ];
  for (const f of ACC21) {
    const r = cl("", f);
    check("« " + f + " » → VALIDATION", r.decision === "VALIDATION" && r.decisive, "décision=" + r.decision);
  }
  // formulations reçues dans le CORPS (sujet quelconque)
  const rCorps = cl("RE: Votre demande de congé", "Bonjour,\n\nVotre demande de congé a été validée.\n\nCordialement.");
  check("formulation dans le CORPS du message reconnue", rCorps.decision === "VALIDATION", "décision=" + rCorps.decision);

  /* ==========================================================================
   * §2 — LES 21 FORMULATIONS DE REFUS DU CAHIER DES CHARGES
   * ======================================================================= */
  console.log("\n— §2 : les 21 formulations de refus —");
  const REF21 = [
    "Demande de congé refusée", "Congé refusé", "Demande de congé rejetée",
    "Congé rejeté", "Demande de congé non approuvée", "Demande de congé non validée",
    "Demande de congé non acceptée", "Demande de congé refusée par le manager",
    "Votre demande de congé a été refusée", "Votre demande de congé a été rejetée",
    "Votre demande de congé n'a pas été approuvée", "Votre demande de congé n'a pas été validée",
    "Refus de votre demande de congé", "Notification de refus de votre congé",
    "Refus de la demande de congé", "Refus du congé",
    "Notification de refus de la demande de congé",
    "NON", "Je refuse", "Refus", "Désaccord",
  ];
  for (const f of REF21) {
    const r = cl("", f);
    check("« " + f + " » → REFUS", r.decision === "REFUS" && r.decisive, "décision=" + r.decision);
  }

  /* ==========================================================================
   * Tolérances d'écriture (§1/§2 « variantes mineures »)
   * ======================================================================= */
  console.log("\n— tolérances : casse, accents, espaces, ponctuation, apostrophes —");
  const tolerances = [
    ["DEMANDE DE CONGE ACCEPTEE", "VALIDATION"],           // majuscules + sans accents
    ["conge accepte", "VALIDATION"],                        // minuscules sans accents
    ["C0ngé accepté", "VALIDATION"],                        // (corrigé v0.2.168) le mot « accepté » (participe) est présent SEUL dans la phrase — le chiffre dans « C0ngé » ne l'empêche pas d'être une acceptation ; la règle « chiffre = autre mot » vise les MOTS-CLÉS (N0N, okapi…)
    ["  Congé   accepté  !!! ", "VALIDATION"],              // espaces multiples + ponctuation
    ["Votre demande de congé a été validée.", "VALIDATION"],
    ["…congé VALIDÉ…", "VALIDATION"],
    ["D'accord", "VALIDATION"], ["d accord", "VALIDATION"], ["D’ACCORD", "VALIDATION"],
    ["J’accorde !", "VALIDATION"], ["j accorde", "VALIDATION"],
    ["je valide.", "VALIDATION"],
    ["N0N", "NON_RECONNU"],                                 // chiffre = mot différent
    ["non…", "REFUS"],                                      // ponctuation
    ["je refuse !!!", "REFUS"],
    ["Désaccord.", "REFUS"], ["desaccord", "REFUS"],
  ];
  for (const [txt, att] of tolerances) {
    const r = cl("", txt);
    check("« " + txt.trim() + " » → " + att, r.decision === att, "décision=" + r.decision);
  }

  /* ==========================================================================
   * §5 — RÉPONSES AMBIGUÏES / INCONNUES : AUCUNE décision automatique
   * ======================================================================= */
  console.log("\n— §5 : réponses ambiguës → aucune décision (reste « En attente ») —");
  const AMBIGUES = [
    "Je vais regarder", "Je vous répondrai plus tard", "Vu",
    "Reçu", "Je dois vérifier", "Peut-être", "À discuter",
  ];
  for (const f of AMBIGUES) {
    const r = cl("", f);
    check("« " + f + " » → NON décisif", !r.decisive, "décision=" + r.decision);
  }
  const rVu = cl("RE: Demande de congé", "Bonjour,\n\nReçu, je vais regarder et je vous répondrai plus tard.\n\nCordialement.");
  check("message d'attente poli dans le corps → aucune décision", !rVu.decisive, "décision=" + rVu.decision);
  const rMixte = cl("", "Congé accepté. Mais finalement, refus.");
  check("signaux acceptation + refus mélangés → AMBIGUE (pas de décision)", rMixte.decision === "AMBIGUE" && !rMixte.decisive, "décision=" + rMixte.decision);

  /* ==========================================================================
   * §6 — PRIORITÉ DU REFUS EXPLICITE (négations)
   * ======================================================================= */
  console.log("\n— §6 : négations explicites → REFUS —");
  const negations = [
    ["Je ne valide pas cette demande de congé.", "REFUS"],
    ["Je ne peux pas accepter cette demande.", "REFUS"],
    ["Je n'accepte pas ce congé.", "REFUS"],
    ["Je n'approuve pas la demande.", "REFUS"],
    ["Je n'accorde pas ce congé.", "REFUS"],
    ["On ne valide pas les demandes sans solde.", "REFUS"],
    ["Nous n'accordons pas de congé sur cette période.", "REFUS"],
    ["Votre demande n'a pas été acceptée.", "REFUS"],
    ["La demande n'est pas approuvée.", "REFUS"],
    ["Elle ne sera pas validée.", "REFUS"],
  ];
  for (const [txt, att] of negations) {
    const r = cl("", txt);
    check("« " + txt + " » → " + att, r.decision === att && r.decisive, "décision=" + r.decision);
  }
  // garde : « pas encore » = PAS DÉCIDÉ (jamais un refus)
  const pasEncore = cl("", "La demande n'a pas encore été validée.");
  check("garde « pas encore validée » → aucune décision", !pasEncore.decisive, "décision=" + pasEncore.decision);
  const toujoursPas = cl("", "Toujours pas validée, patientez.");
  check("garde « toujours pas validée » → aucune décision", !toujoursPas.decisive, "décision=" + toujoursPas.decision);

  /* ==========================================================================
   * Garde des MOTS ENTIERS (faux positifs)
   * ======================================================================= */
  console.log("\n— garde mots entiers (faux positifs) —");
  const g1 = cl("", "Vu l'okapi du zoo.");
  check("« okapi » ne déclenche pas « OK »", !g1.decisive, "décision=" + g1.decision);
  const g2 = cl("", "Notification automatique : message bien reçu.");
  check("« Notification » ne déclenche pas « NON »", !g2.decisive, "décision=" + g2.decision);
  const g3 = cl("", "J'écoute du d'accordéon.");
  check("« d'accordéon » ne déclenche pas « D'accord »", !g3.decisive, "décision=" + g3.decision);
  const g4 = cl("", "Je validerai votre demande la semaine prochaine.");
  check("« je validerai » (futur) ne déclenche pas « je valide »", !g4.decisive, "décision=" + g4.decision);

  /* ==========================================================================
   * §3 — ANALYSE AUTOMATIQUE E2E : le VRAI traiterMessageRecu
   * ======================================================================= */
  console.log("\n— §3 : cycle E2E manager → RH (historique, décisions, statuts) —");
  // purge défensive (idempotence) — la référence n'est PAS chiffrée, contrairement au CIN
  await nettoyerDemandesTest();

  const d1 = await creerDemande("DEM-2026-13001", "dem194-a@test");
  const rM1 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13001", de: MANAGER, inReplyTo: "<dem194-a@test>",
    texte: "Bonjour,\n\nCongé validé.\n\nCordialement.",
  }));
  const d1apresM = await db.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("manager « Congé validé » → décision manager ACCEPTEE", d1apresM.decisionManager === "ACCEPTEE", "statut=" + d1apresM.statut);
  check("statut reste EN_ATTENTE (validation à deux étapes Task 181)", d1apresM.statut === "EN_ATTENTE", "statut=" + d1apresM.statut);

  const rR1 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13001", de: RH, inReplyTo: "<dem194-a@test>",
    texte: "Je valide.",
  }));
  const d1apresR = await db.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("RH « Je valide » → statut final ACCEPTEE", d1apresR.statut === "ACCEPTEE", "statut=" + d1apresR.statut);

  // ---- historique : 2 entrées avec toutes les données du cahier des charges
  const hist1 = await lireHistorique(d1.id);
  check("historique : 2 entrées enregistrées", hist1.length === 2, "entrées=" + hist1.length);
  const eM = hist1.find((e) => e.role === "manager");
  const eR = hist1.find((e) => e.role === "rh");
  check("entrée manager : décision VALIDATION", eM && eM.decision === "VALIDATION", eM ? JSON.stringify(eM.decision) : "absente");
  check("entrée manager : formulation reconnue rapportée", eM && (eM.formulations || []).some((f) => /valid/i.test(f)), eM ? JSON.stringify(eM.formulations) : "");
  check("entrée manager : expéditeur conservé", eM && eM.de === MANAGER, eM ? eM.de : "");
  check("entrée manager : sujet conservé", eM && /DEM-2026-13001/.test(eM.sujet), eM ? eM.sujet : "");
  check("entrée manager : TEXTE ORIGINAL conservé", eM && /Congé validé/.test(eM.texte), eM ? (eM.texte || "").slice(0, 40) : "");
  check("entrée manager : date/heure ISO présente", eM && !isNaN(Date.parse(eM.le)), eM ? eM.le : "");
  check("entrée manager : statut avant/après = EN_ATTENTE", eM && eM.statutAvant === "EN_ATTENTE" && eM.statutApres === "EN_ATTENTE", eM ? eM.statutAvant + " → " + eM.statutApres : "");
  check("entrée RH : décision VALIDATION + statut final ACCEPTEE", eR && eR.decision === "VALIDATION" && eR.statutApres === "ACCEPTEE", eR ? eR.decision + " → " + eR.statutApres : "");
  check("entrée RH : expéditeur = " + RH, eR && eR.de === RH, eR ? eR.de : "");

  /* ==========================================================================
   * §4 — PIÈCES JOINTES : récupérées + associées + tracées
   * ======================================================================= */
  console.log("\n— §4 : pièces jointes du manager (récupérées + associées) —");
  const pjNom = "justificatif-manager-194.pdf";
  const d2 = await creerDemande("DEM-2026-13002", "dem194-b@test");
  const rM2 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13002", de: MANAGER, inReplyTo: "<dem194-b@test>",
    texte: "Demande de congé acceptée. Voir le justificatif en pièce jointe.",
    piecesJointes: [{ filename: pjNom, contentType: "application/pdf", content: pdfMinimal() }],
  }));
  const docs2 = await db.documentDemande.findMany({ where: { demandeId: d2.id } });
  check("pièce jointe importée (DocumentDemande créé)", docs2.length === 1, "documents=" + docs2.length);
  check("nom de fichier conservé", docs2[0] && docs2[0].nomFichier === pjNom, docs2[0] ? docs2[0].nomFichier : "");
  check("expéditeur de la pièce jointe = manager", docs2[0] && docs2[0].recuDe === MANAGER, docs2[0] ? docs2[0].recuDe : "");
  const d2apres = await db.demandeAdministrative.findUnique({ where: { id: d2.id } });
  check("formulation « acceptée » + PJ → décision manager ACCEPTEE", d2apres.decisionManager === "ACCEPTEE", "statut=" + d2apres.statut);
  const hist2 = await lireHistorique(d2.id);
  const e2 = hist2[hist2.length - 1];
  check("historique : pièces jointes VUES tracées", e2 && (e2.piecesJointes || []).includes(pjNom), e2 ? JSON.stringify(e2.piecesJointes) : "");
  check("historique : pièces jointes IMPORTÉES tracées", e2 && (e2.piecesJointesImportees || []).includes(pjNom), e2 ? JSON.stringify(e2.piecesJointesImportees) : "");
  check("historique : décision + texte original conservés", e2 && e2.decision === "VALIDATION" && /justificatif/.test(e2.texte), "");

  // ---- pièce jointe seule SANS formulation claire → importée MAIS pas de décision
  const d3 = await creerDemande("DEM-2026-13003", "dem194-c@test");
  const pjNom3 = "scan-attestation.pdf";
  const rM3 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13003", de: MANAGER, inReplyTo: "<dem194-c@test>",
    texte: "Veuillez trouver le document.",
    piecesJointes: [{ filename: pjNom3, contentType: "application/pdf", content: pdfMinimal() }],
  }));
  const docs3 = await db.documentDemande.findMany({ where: { demandeId: d3.id } });
  check("PJ seule (sans décision) : document QUAND MÊME importé", docs3.length === 1, "documents=" + docs3.length);
  const d3apres = await db.demandeAdministrative.findUnique({ where: { id: d3.id } });
  check("PJ seule : statut inchangé EN_ATTENTE (§5)", d3apres.statut === "EN_ATTENTE", "statut=" + d3apres.statut);
  const hist3 = await lireHistorique(d3.id);
  check("historique : réponse sans décision TRACÉE (consultable, NON_RECONNU)", hist3.length === 1 && hist3[0].decision === "NON_RECONNU", hist3.length ? "décision=" + hist3[0].decision : "absente");

  /* ==========================================================================
   * §5/§7 — RÉPONSE AMBIGUÏE E2E : statut reste « En attente »
   * ======================================================================= */
  console.log("\n— §5/§7 : réponses ambiguës E2E (statut inchangé) —");
  const d4 = await creerDemande("DEM-2026-13004", "dem194-d@test");
  const rM4 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13004", de: MANAGER, inReplyTo: "<dem194-d@test>",
    texte: "Reçu. Je vais regarder, je vous répondrai plus tard.",
  }));
  const d4apres = await db.demandeAdministrative.findUnique({ where: { id: d4.id } });
  check("réponse ambiguë : statut reste EN_ATTENTE", d4apres.statut === "EN_ATTENTE", "statut=" + d4apres.statut);
  check("réponse ambiguë : aucune décision enregistrée", !d4apres.decisionManager, "decisionManager=" + d4apres.decisionManager);
  check("retour traiterMessageRecu : IGNORE (pas de décision)", rM4.statut === "IGNORE", "statut=" + rM4.statut);
  const hist4 = await lireHistorique(d4.id);
  check("réponse ambiguë : TRACÉE dans l'historique (NON_RECONNU)", hist4.length === 1 && hist4[0].decision === "NON_RECONNU", hist4.length ? "décision=" + hist4[0].decision : "absente");
  check("réponse ambiguë : texte original consultable", hist4.length && /je vais regarder/i.test(hist4[0].texte), "");

  /* ==========================================================================
   * §6 — NÉGATION E2E : « Je ne peux pas accepter » → REFUSÉE
   * ======================================================================= */
  console.log("\n— §6 : négation explicite E2E —");
  const d5 = await creerDemande("DEM-2026-13005", "dem194-e@test");
  const rM5 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13005", de: MANAGER, inReplyTo: "<dem194-e@test>",
    texte: "Bonjour,\n\nJe ne peux pas accepter cette demande.\n\nCordialement.",
  }));
  const d5apres = await db.demandeAdministrative.findUnique({ where: { id: d5.id } });
  check("négation du manager → statut REFUSEE", d5apres.statut === "REFUSEE", "statut=" + d5apres.statut);
  check("négation : décision manager REFUSEE", d5apres.decisionManager === "REFUSEE", "decisionManager=" + d5apres.decisionManager);
  const hist5 = await lireHistorique(d5.id);
  const e5 = hist5[hist5.length - 1];
  check("négation : historique decision=REFUS + statutApres=REFUSEE", e5 && e5.decision === "REFUS" && e5.statutApres === "REFUSEE", e5 ? e5.decision + " → " + e5.statutApres : "");

  /* ==========================================================================
   * §7 — TABLEAU FINAL : cas « aucun e-mail » (statut initial) + API admin
   * ======================================================================= */
  console.log("\n— §7 : API admin (consultation RH) + cas « aucun e-mail » —");
  const d6 = await creerDemande("DEM-2026-13006", "dem194-f@test");
  const d6apres = await db.demandeAdministrative.findUnique({ where: { id: d6.id } });
  check("aucun e-mail reçu → statut EN_ATTENTE", d6apres.statut === "EN_ATTENTE", "statut=" + d6apres.statut);
  check("aucun e-mail : historique vide", (await lireHistorique(d6.id)).length === 0, "");

  const api = await adm.get("/api/demandes/" + d1.id);
  check("API GET /api/demandes/[id] : 200", api.status === 200, "status=" + api.status);
  const reps = api.json && api.json.item && api.json.item.reponsesRecues;
  if (!reps) {
    check("API : champ reponsesRecues exposé", false, JSON.stringify(api.json).slice(0, 120));
  } else {
    check("API : reponsesRecues exposé (2 entrées)", reps.length === 2, "entrées=" + reps.length);
    check("API : texte original présent", reps.some((r) => /Congé validé/.test(r.texte)), "");
    check("API : décision + rôle + expéditeur présents", reps.some((r) => r.decision === "VALIDATION" && r.role === "manager" && r.de === MANAGER), "");
    check("API : formulations exposées", reps.some((r) => (r.formulations || []).length > 0), "");
  }

  /* ==========================================================================
   * NETTOYAGE COMPLET
   * ======================================================================= */
  console.log("\n— nettoyage —");
  if (cfgMailAvant) {
    await db.mailConfig.update({ where: { id: "smtp" }, data: cfgMailAvant });
  } else {
    await db.mailConfig.delete({ where: { id: "smtp" } }).catch(() => {});
  }
  const reste = await nettoyerDemandesTest();
  check("nettoyage : demandes de test supprimées", reste === 0, "restantes=" + reste);
  serveurSmtp.close(() => {});

  console.log("\n========================================");
  console.log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  console.log("========================================");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE :", e); process.exit(1); });
