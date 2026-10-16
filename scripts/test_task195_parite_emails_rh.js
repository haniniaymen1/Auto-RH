#!/usr/bin/env node
/**
 * ============================================================================
 * Task 195 (v0.2.151) — PARITÉ COMPLÈTE DES E-MAILS RH
 * « Même chose pour les mails de RH » : la reconnaissance automatique des
 * réponses e-mail (formulations d'acceptation/de refus, tolérances d'écriture,
 * négations, ambiguïtés, historique, pièces jointes) s'applique EXACTEMENT
 * comme pour le manager — plus deux renforts :
 *
 *   §1-§4  décision RH par e-mail (étape 2 de la matrice) : formulations,
 *          tolérances (casse/accents/ponctuation/apostrophes), decisionRhNote
 *          enregistrée (jumelle de decisionManagerNote), matrice complète ;
 *   §5     RH accepte AVANT le manager → En attente puis finalisation ;
 *   §6     négation RH (« Je ne valide pas… ») → Refusée ;
 *   §7     réponse RH AMBIGUÏE → statut inchangé + historique consultable ;
 *   §8     pièce jointe envoyée par le RH → importée, associée, tracée ;
 *   §9     (NOUVEAU v0.2.151) demande adressée DIRECTEMENT au service RH
 *          (aucun manager responsable affecté) : UNE SEULE réponse RH achève
 *          la validation (étape manager satisfaite automatiquement, AUCUNE
 *          transmission aux RH) — acceptation ET refus ;
 *   §10    API admin : decisionRhNote + historique (rôle « rh ») exposés.
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

const ADMIN = "http://localhost:4000";
const SMTP_PORT = 12530;
const MANAGER = "manager.diag195@test.local";
const RH = "rh.diag195@test.local";
const EMPLOYE = "employe.diag195@test.local";
const CIN_TEST = "TS1950RH01";

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
async function creerDemande(reference, messageId, statut, destinataire) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: statut || "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(destinataire || MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: destinataire || MANAGER, commentaire: "Dossier Task 195",
      })),
      messageIdEnvoi: messageId,
    },
  });
}

/** Purge toutes les demandes de test (référence non chiffrée) + leurs documents. */
async function nettoyerDemandesTest() {
  const demandes = await db.demandeAdministrative.findMany({
    where: { reference: { startsWith: "DEM-2026-131" } },
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
  return db.demandeAdministrative.count({ where: { reference: { startsWith: "DEM-2026-131" } } });
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

/** Recharge une demande fraîche depuis la base. */
async function relire(id) {
  return db.demandeAdministrative.findUnique({ where: { id } });
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
  console.log("== Task 195 — PARITÉ COMPLÈTE DES E-MAILS RH (v0.2.151) ==");
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

  // purge défensive (idempotence)
  await nettoyerDemandesTest();

  /* ==========================================================================
   * §1 — DÉCISION RH PAR E-MAIL (étape 2) : formulations + tolérances +
   *      decisionRhNote (jumelle de decisionManagerNote)
   * ======================================================================= */
  console.log("\n— §1 : décision RH (étape 2) — formulations et tolérances —");
  const d1 = await creerDemande("DEM-2026-13101", "dem195-a@test");
  const rM1 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13101", de: MANAGER, inReplyTo: "<dem195-a@test>",
    texte: "Congé accepté.",
  }));
  check("manager accepte → demande toujours EN_ATTENTE (étape RH requise)",
    rM1.statut === "TRAITE" && rM1.statutApres === "EN_ATTENTE", "statutApres=" + rM1.statutApres);
  // tolérances : majuscules + SANS accents + ponctuation (le RH écrit vite)
  const rR1 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13101", de: RH, inReplyTo: "<dem195-a@test>",
    texte: "Bonjour,\n\nVOTRE DEMANDE DE CONGE A ETE VALIDEE.\n\nCordialement, le service RH.",
  }));
  check("RH (accents omis, majuscules) → décision reconnue", rR1.statut === "TRAITE" && rR1.roleReponse === "rh", "rôle=" + rR1.roleReponse);
  const d1apres = await relire(d1.id);
  check("matrice complète manager+RH → statut ACCEPTEE", d1apres.statut === "ACCEPTEE", "statut=" + d1apres.statut);
  check("decisionRh = ACCEPTEE", d1apres.decisionRh === "ACCEPTEE", "decisionRh=" + d1apres.decisionRh);
  check("decisionRhNote enregistrée (jumelle decisionManagerNote)",
    /Formulation reconnue : « Votre demande de congé a été validée »/.test(d1apres.decisionRhNote || ""),
    "note=" + (d1apres.decisionRhNote || "").slice(0, 70));
  check("decisionRhPar = « Auto-RH (réponse e-mail) »", d1apres.decisionRhPar === "Auto-RH (réponse e-mail)", d1apres.decisionRhPar || "");
  const hist1 = await lireHistorique(d1.id);
  check("historique : 2 entrées (manager + RH)", hist1.length === 2, "entrées=" + hist1.length);
  check("historique : entrée RH tracée avec rôle + expéditeur + texte original",
    hist1.some((e) => e.role === "rh" && e.de === RH && /DEMANDE DE CONGE/i.test(e.texte)), "");

  console.log("\n— §1.b : autres formulations RH (variantes officielles) —");
  const variantesRh = [
    ["Je valide cette demande.", "ACCEPTEE", "VALIDATION"],
    ["Congé accordé pour la période demandée.", "ACCEPTEE", "VALIDATION"],
    ["Demande de congé rejetée.", "REFUSEE", "REFUS"],
    ["Votre demande de congé n'a pas été approuvée.", "REFUSEE", "REFUS"],
  ];
  let idx = 2;
  for (const [txt, statutAttendu, decAttendue] of variantesRh) {
    const dj = await creerDemande("DEM-2026-131" + String(10 + idx).padStart(2, "0"), "dem195-v" + idx + "@test");
    await portail.traiterMessageRecu(message({
      sujet: "RE: " + dj.reference, de: MANAGER, inReplyTo: "<dem195-v" + idx + "@test>",
      texte: "Congé accepté.",
    }));
    const rR = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dj.reference, de: RH, inReplyTo: "<dem195-v" + idx + "@test>",
      texte: txt,
    }));
    const dja = await relire(dj.id);
    check("RH « " + txt + " » → " + statutAttendu,
      rR.statut === "TRAITE" && dja.statut === statutAttendu && rR.decision === decAttendue,
      "statut=" + dja.statut + " décision=" + rR.decision);
    if (statutAttendu === "REFUSEE") {
      check("refus RH : refuseePar = RH (« Refusée par les RH »)", dja.refuseePar === "RH", "refuseePar=" + dja.refuseePar);
    }
    idx++;
  }

  /* ==========================================================================
   * §5 — RH ACCEPTE AVANT LE MANAGER (matrice préservée)
   * ======================================================================= */
  console.log("\n— §5 : RH accepte AVANT le manager —");
  const d5 = await creerDemande("DEM-2026-13160", "dem195-e@test");
  const rR5 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13160", de: RH, inReplyTo: "<dem195-e@test>",
    texte: "D'accord pour la période demandée.",
  }));
  const d5apres1 = await relire(d5.id);
  check("RH accepte seul → demande EN_ATTENTE (manager pas encore décidé)",
    rR5.statut === "TRAITE" && rR5.roleReponse === "rh" && d5apres1.statut === "EN_ATTENTE",
    "statut=" + d5apres1.statut);
  check("RH accepte seul : decisionRh = ACCEPTEE tracée", d5apres1.decisionRh === "ACCEPTEE", "");
  const rM5 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13160", de: MANAGER, inReplyTo: "<dem195-e@test>",
    texte: "Congé validé.",
  }));
  const d5apres2 = await relire(d5.id);
  check("manager accepte ensuite → matrice complète ACCEPTEE",
    rM5.statut === "TRAITE" && d5apres2.statut === "ACCEPTEE", "statut=" + d5apres2.statut);

  /* ==========================================================================
   * §6 — NÉGATION RH (priorité du refus explicite)
   * ======================================================================= */
  console.log("\n— §6 : négation RH (« Je ne valide pas… ») —");
  const d6 = await creerDemande("DEM-2026-13161", "dem195-f@test");
  await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13161", de: MANAGER, inReplyTo: "<dem195-f@test>",
    texte: "Congé accepté.",
  }));
  const rR6 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13161", de: RH, inReplyTo: "<dem195-f@test>",
    texte: "Après vérification du solde, je ne valide pas cette demande de congé.",
  }));
  const d6apres = await relire(d6.id);
  check("négation RH → REFUSEE (jamais une validation)",
    rR6.statut === "TRAITE" && rR6.decision === "REFUS" && d6apres.statut === "REFUSEE",
    "statut=" + d6apres.statut);
  check("négation RH : refuseePar = RH", d6apres.refuseePar === "RH", "");
  check("négation RH : decisionRhNote conserve la formulation",
    /Je ne valide pas/i.test(d6apres.decisionRhNote || ""), "note=" + (d6apres.decisionRhNote || "").slice(0, 60));

  /* ==========================================================================
   * §7 — RÉPONSE RH AMBIGUÏE (statut inchangé + historique consultable)
   * ======================================================================= */
  console.log("\n— §7 : réponse RH ambiguë —");
  const d7 = await creerDemande("DEM-2026-13162", "dem195-g@test");
  await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13162", de: MANAGER, inReplyTo: "<dem195-g@test>",
    texte: "Congé accepté.",
  }));
  const rR7 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13162", de: RH, inReplyTo: "<dem195-g@test>",
    texte: "Vu, je regarde et je vous reviens.",
  }));
  const d7apres = await relire(d7.id);
  check("réponse RH ambiguë → IGNORE (statut inchangé)",
    rR7.statut === "IGNORE" && d7apres.statut === "EN_ATTENTE", "retour=" + rR7.statut);
  const hist7 = await lireHistorique(d7.id);
  check("réponse RH ambiguë : TRACÉE (rôle rh, décision NON_RECONNU, texte original)",
    hist7.some((e) => e.role === "rh" && e.decision === "NON_RECONNU" && /je regarde/i.test(e.texte)), "");

  /* ==========================================================================
   * §8 — PIÈCE JOINTE ENVOYÉE PAR LE RH (importée, associée, tracée)
   * ======================================================================= */
  console.log("\n— §8 : pièce jointe du RH —");
  const d8 = await creerDemande("DEM-2026-13163", "dem195-h@test");
  const rR8 = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13163", de: RH, inReplyTo: "<dem195-h@test>",
    texte: "Veuillez trouver le justificatif en pièce jointe.",
    piecesJointes: [{ filename: "justificatif-rh.pdf", content: pdfMinimal(), contentType: "application/pdf" }],
  }));
  const d8apres = await relire(d8.id);
  const docs8 = await db.documentDemande.findMany({ where: { demandeId: d8.id } });
  check("pièce jointe du RH importée et associée à la demande",
    rR8.statut === "TRAITE" && docs8.length === 1 && docs8[0].recuDe === RH,
    "docs=" + docs8.length);
  check("pièce jointe du RH : statut inchangé (aucune décision reconnue)",
    d8apres.statut === "EN_ATTENTE", "statut=" + d8apres.statut);
  const hist8 = await lireHistorique(d8.id);
  check("pièce jointe du RH : historique trace l'import (rôle rh)",
    hist8.some((e) => e.role === "rh" && (e.piecesJointesImportees || []).indexOf("justificatif-rh.pdf") >= 0), "");

  /* ==========================================================================
   * §9 — (NOUVEAU v0.2.151) DEMANDE ADRESSÉE DIRECTEMENT AU SERVICE RH
   *      (aucun manager responsable affecté) : UNE SEULE réponse RH achève
   *      la validation — acceptation, refus, ambiguïté, garde expéditeur.
   * ======================================================================= */
  console.log("\n— §9 : demande adressée directement au RH — décision unique —");
  const d9a = await creerDemande("DEM-2026-13170", "dem195-i@test", "EN_ATTENTE", RH);
  const r9a = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13170", de: RH, inReplyTo: "<dem195-i@test>",
    texte: "Congé accepté.",
  }));
  const d9aa = await relire(d9a.id);
  check("réponse RH unique → statut ACCEPTEE (une seule étape)",
    r9a.statut === "TRAITE" && r9a.roleReponse === "rh" && d9aa.statut === "ACCEPTEE",
    "statut=" + d9aa.statut);
  check("décision unique : decisionRh = ACCEPTEE", d9aa.decisionRh === "ACCEPTEE", "");
  check("décision unique : étape manager satisfaite automatiquement (tracée)",
    d9aa.decisionManager === "ACCEPTEE" && /étape manager satisfaite automatiquement/.test(d9aa.decisionManagerPar || ""),
    "par=" + (d9aa.decisionManagerPar || "").slice(0, 60));
  check("décision unique : decisionRhNote conserve la formulation",
    /« Congé accepté »/.test(d9aa.decisionRhNote || ""), "note=" + (d9aa.decisionRhNote || "").slice(0, 60));
  check("décision unique : AUCUNE transmission aux RH (elles viennent de décider)",
    r9a.transmissionRh === null || r9a.transmissionRh === undefined, "transmissionRh=" + r9a.transmissionRh);
  const hist9a = await lireHistorique(d9a.id);
  check("décision unique : historique tracé (rôle rh, statutApres ACCEPTEE)",
    hist9a.length === 1 && hist9a[0].role === "rh" && hist9a[0].statutApres === "ACCEPTEE", "");

  const d9b = await creerDemande("DEM-2026-13171", "dem195-j@test", "EN_ATTENTE", RH);
  const r9b = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13171", de: RH, inReplyTo: "<dem195-j@test>",
    texte: "Je refuse, le solde est insuffisant.",
  }));
  const d9ba = await relire(d9b.id);
  check("réponse RH unique de refus → REFUSEE « Refusée par les RH »",
    r9b.statut === "TRAITE" && d9ba.statut === "REFUSEE" && d9ba.refuseePar === "RH",
    "statut=" + d9ba.statut + " refuseePar=" + d9ba.refuseePar);

  const d9c = await creerDemande("DEM-2026-13172", "dem195-k@test", "EN_ATTENTE", RH);
  const r9c = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13172", de: RH, inReplyTo: "<dem195-k@test>",
    texte: "Reçu, je dois vérifier.",
  }));
  const d9ca = await relire(d9c.id);
  check("réponse RH ambiguë (boîte RH destinataire) → statut inchangé",
    r9c.statut === "IGNORE" && d9ca.statut === "EN_ATTENTE", "retour=" + r9c.statut);
  const hist9c = await lireHistorique(d9c.id);
  check("réponse RH ambiguë (boîte RH) : historique consultable (rôle rh)",
    hist9c.length === 1 && hist9c[0].role === "rh" && hist9c[0].decision === "NON_RECONNU", "");

  const d9d = await creerDemande("DEM-2026-13173", "dem195-l@test", "EN_ATTENTE", RH);
  const r9d = await portail.traiterMessageRecu(message({
    sujet: "RE: DEM-2026-13173", de: "intrus@test.local", inReplyTo: "<dem195-l@test>",
    texte: "Congé accepté.",
  }));
  check("garde : réponse d'un AUTRE expédieur sur demande RH → IGNORE", r9d.statut === "IGNORE", "retour=" + r9d.statut);

  /* ==========================================================================
   * §10 — API ADMIN : decisionRhNote + historique (rôle « rh ») exposés
   * ======================================================================= */
  console.log("\n— §10 : API admin —");
  const api = await adm.get("/api/demandes/" + d1.id);
  check("API GET /api/demandes/[id] : 200", api.status === 200, "status=" + api.status);
  const item = api.json && api.json.item;
  if (!item) {
    check("API : champ item présent", false, JSON.stringify(api.json).slice(0, 120));
  } else {
    check("API : decisionRhNote exposée", typeof item.decisionRhNote === "string" && /Votre demande de congé a été validée/.test(item.decisionRhNote), "");
    const reps = item.reponsesRecues || [];
    check("API : reponsesRecues exposées (2 entrées)", reps.length === 2, "entrées=" + reps.length);
    check("API : entrée RH avec rôle + décision + expéditeur",
      reps.some((r) => r.role === "rh" && r.decision === "VALIDATION" && r.de === RH), "");
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
