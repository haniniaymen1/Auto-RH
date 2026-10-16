#!/usr/bin/env node
/**
 * Task 178 — PREUVE E2E de la reconnaissance automatique des formulations
 * d'acceptation / de refus dans les réponses e-mail aux demandes de congé.
 *
 * Exerce le VRAI code de réception du portail (traiterMessageRecu, exposé
 * par scripts/portail-server.js en mode module — AUCUN serveur démarré,
 * AUCUN IMAP requis) sur des messages parsés (forme mailparser) :
 *
 *   1. validation texte seul (« Congé accepté »)      → décision manager
 *      ACCEPTEE + statut EN_ATTENTE + transmission RH (Task 181) ;
 *   2. refus texte seul (« Je refuse »)               → REFUSEE + refuseePar=
 *      MANAGER + notification RH (Task 181) ;
 *   3. négation (« … n'a pas été approuvée »)         → REFUSEE   ;
 *   4. réponse ambiguë                                → EN_ATTENTE ;
 *   5. réponse sans formulation reconnue              → EN_ATTENTE ;
 *   6. pièce jointe + « Congé validé »                → décision manager
 *      ACCEPTEE + PJ conservée + EN_ATTENTE (Task 181) ;
 *   7. pièce jointe + réponse ambiguë                 → PJ conservée, EN_ATTENTE ;
 *   8. pièce jointe seule (aucun texte décisionnel)   → PJ conservée, EN_ATTENTE
 *      (l'ancien passage automatique à « Acceptée » est supprimé pour le
 *      congé — cahier des charges 3.e) ;
 *   9. demande déjà REFUSEE + « Congé accepté »       → REFUSEE conservée ;
 *  10. expéditeur non autorisé                        → IGNORE    ;
 *  11. NON-RÉGRESSION attestations : PJ reçue         → ACCEPTEE (comportement
 *      historique inchangé, sans analyse de contenu) ;
 *  12. NON-RÉGRESSION attestations : sans PJ          → IGNORE ;
 *  13. rattachement par la référence du sujet (transfert, sans In-Reply-To).
 *
 * Nettoyage complet vérifié (demandes, documents, fichiers, config SMTP
 * restaurée à l'identique).
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");

// ---- Chargement du .env (comme start-prod.js) AVANT tout require -----------
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();

// ---- Portail en mode MODULE (expose traiterMessageRecu + prisma) -----------
const portail = require("./portail-server.js");
const prisma = portail.prisma;

const CIN = "TS17890099";
const MANAGER = "manager178@test.local";
const EMPLOYE = "employe178@test.local";
const JOURNAL = path.join(process.cwd(), "logs", "journal-emails.log");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log("  OK   " + label);
  } else {
    KO++;
    console.log("  FAIL " + label + (detail ? " — " + detail : ""));
  }
}

/** Message parsé minimal (forme simpleParser/mailparser). */
function message({ sujet, de = MANAGER, inReplyTo = null, texte = "", html = null, piecesJointes = [] }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "Manager" }] },
    inReplyTo: inReplyTo,
    references: inReplyTo ? [inReplyTo] : undefined,
    text: texte,
    html: html,
    attachments: piecesJointes,
  };
}

function pjPdf(nom, contenu) {
  return {
    filename: nom,
    contentType: "application/pdf",
    content: Buffer.from(contenu || "%PDF-1.4\n% Task 178 — pièce jointe de test\n%%EOF\n", "utf8"),
  };
}

let compteur = 0;
async function semerDemande({ type = "CONGE", statut = "EN_ATTENTE", commentaire = null }) {
  compteur++;
  const ref = "DEM-2026-78" + String(100 + compteur).padStart(3, "0");
  return prisma.demandeAdministrative.create({
    data: {
      reference: ref,
      type: type,
      cin: cryptoBd.chiffrerChamp(CIN, true),
      statut: statut,
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ typeConge: "Congé annuel", dateDebut: "2026-11-02", dateFin: "2026-11-06", emailN1: MANAGER })),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      commentaire: commentaire,
      messageIdEnvoi: "task178-" + compteur + "@autorh.local",
    },
  });
}

async function relire(id) {
  return prisma.demandeAdministrative.findUnique({ where: { id }, include: { documents: true } });
}

/** Marqueurs du journal e-mail ajoutés pendant le test (lecture de fin). */
const marqueursJournal = [];
function surveillerJournal(demande) {
  marqueursJournal.push(demande.reference);
}
async function journalContient(reference, action, decision) {
  let contenu = "";
  try { contenu = fs.readFileSync(JOURNAL, "utf8"); } catch (e) { return false; }
  const lignes = contenu.split("\n").filter((l) => l.indexOf(reference) >= 0);
  return lignes.some((l) => l.indexOf('"action":"' + action + '"') >= 0 || l.indexOf('"action": "' + action + '"') >= 0)
    && (decision === undefined || lignes.some((l) => l.indexOf('"' + decision + '"') >= 0 || l.indexOf('"' + decision) >= 0));
}

async function main() {
  console.log("=== Préparation ===");
  // Nettoyage préalable (relance)
  const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
  await prisma.demandeAdministrative.deleteMany({ where: { cin: cinIdx } });

  // Neutralisation VOLONTAIRE du SMTP pendant le test (restauré à la fin) :
  // aucune notification réelle ne doit partir, aucune attente réseau.
  const cfgAvant = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (cfgAvant) {
    await prisma.mailConfig.update({
      where: { id: "smtp" },
      data: { host: "", imapActif: false },
    });
  }

  // ---- 1) Validation texte seul -------------------------------------------
  console.log("=== 1) Validation texte seul (« Congé accepté ») ===");
  {
    const d = await semerDemande({});
    surveillerJournal(d);
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bonjour,\n\nCongé accepté pour la période demandée.\n\nCordialement,\nLe manager",
    }));
    const apres = await relire(d.id);
    check("résultat TRAITE", r.statut === "TRAITE", JSON.stringify(r));
    check("décision VALIDATION", r.decision === "VALIDATION", String(r.decision));
    // (MODIFIÉ Task 181) l'acceptation du manager NE finalise PLUS la demande :
    // Décision Manager = ACCEPTEE tracée, statut EN_ATTENTE (étape RH requise),
    // TRANSMISSION AUTOMATIQUE AUX RH, AUCUN document signé tant que la
    // matrice n'est pas complète.
    check("décision manager = ACCEPTEE", apres.decisionManager === "ACCEPTEE", String(apres.decisionManager));
    check("statut reste EN_ATTENTE (étape RH requise)", apres.statut === "EN_ATTENTE", apres.statut);
    check("traiteLe non posé (pas de décision finale)", apres.traiteLe === null, String(apres.traiteLe));
    check("commentaire : transmise au service RH", (apres.commentaire || "").indexOf("service RH") >= 0, String(apres.commentaire));
    check("AUCUN document généré (pas de doc signé avant décision finale)", apres.documents.length === 0, JSON.stringify(apres.documents.map((x) => x.nomFichier)));
    check("journal demande-decision-conge", await journalContient(d.reference, "demande-decision-conge"));
    check("journal transmission aux RH", await journalContient(d.reference, "demande-transmission-rh"));
    check("résultat : transmission RH tracée", r.transmissionRh === true || typeof r.transmissionRh === "string", JSON.stringify(r.transmissionRh));
  }

  // ---- 2) Refus texte seul --------------------------------------------------
  console.log("=== 2) Refus texte seul (« Je refuse ») ===");
  {
    const d = await semerDemande({});
    surveillerJournal(d);
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bonjour,\n\nJe refuse, la période coïncide avec un pic d'activité.\n\nCordialement.",
    }));
    const apres = await relire(d.id);
    check("statut → REFUSEE", r.statut === "TRAITE" && apres.statut === "REFUSEE", r.statut + "/" + apres.statut);
    check("décision REFUS", r.decision === "REFUS", String(r.decision));
    // (NOUVEAU Task 181) le refus du MANAGER est IMMÉDIAT et tracé.
    check("refuseePar = MANAGER", apres.refuseePar === "MANAGER", String(apres.refuseePar));
    check("décision manager = REFUSEE", apres.decisionManager === "REFUSEE", String(apres.decisionManager));
    check("journal décision avec formulations", await journalContient(d.reference, "demande-decision-conge", "REFUS"));
    check("journal notification RH du refus", await journalContient(d.reference, "demande-refus-manager-rh"));
  }

  // ---- 3) Négation (piège de priorité) --------------------------------------
  console.log("=== 3) Négation « … n'a pas été approuvée » → REFUS (jamais VALIDATION) ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bonjour,\n\nVotre demande de congé n'a pas été approuvée.\n\nCordialement.",
    }));
    const apres = await relire(d.id);
    check("statut → REFUSEE (pas VALIDEE)", apres.statut === "REFUSEE", apres.statut);
    check("décision REFUS", r.decision === "REFUS", String(r.decision));
    check("refuseePar = MANAGER", apres.refuseePar === "MANAGER", String(apres.refuseePar));
  }

  // ---- 4) Réponse ambiguë ---------------------------------------------------
  console.log("=== 4) Réponse ambiguë (acceptation + refus) → reste EN_ATTENTE ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Le service avait écrit « Congé accepté » mais je confirme : NON, impossible cette semaine.",
    }));
    const apres = await relire(d.id);
    check("décision AMBIGUE", r.decision === "AMBIGUE", String(r.decision));
    check("statut reste EN_ATTENTE", apres.statut === "EN_ATTENTE", apres.statut);
    check("pas de traiteLe posé", apres.traiteLe === null, String(apres.traiteLe));
  }

  // ---- 5) Réponse sans formulation reconnue ----------------------------------
  console.log("=== 5) Réponse neutre → reste EN_ATTENTE ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bien reçu, je reviens vers vous rapidement après vérification du planning.",
    }));
    const apres = await relire(d.id);
    check("message IGNORÉ (rien à décider)", r.statut === "IGNORE", r.statut);
    check("statut reste EN_ATTENTE", apres.statut === "EN_ATTENTE", apres.statut);
  }

  // ---- 6) Pièce jointe + « Congé validé » ------------------------------------
  console.log("=== 6) Pièce jointe + « Congé validé » → VALIDEE + PJ conservée ===");
  {
    const d = await semerDemande({});
    surveillerJournal(d);
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bonjour,\n\nCongé validé — vous trouverez le formulaire signé en pièce jointe.\n\nCordialement.",
      piecesJointes: [pjPdf("Formulaire_Conge_Signe.pdf")],
    }));
    const apres = await relire(d.id);
    // (MODIFIÉ Task 181) l'acceptation du manager ne finalise PLUS la demande :
    // décision manager tracée + PJ conservée, statut EN_ATTENTE (RH requis).
    check("décision manager = ACCEPTEE", apres.decisionManager === "ACCEPTEE", String(apres.decisionManager));
    check("statut reste EN_ATTENTE (étape RH requise)", apres.statut === "EN_ATTENTE", apres.statut);
    check("décision VALIDATION", r.decision === "VALIDATION", String(r.decision));
    check("PJ conservée (seul document — pas de doc signé avant décision finale)", apres.documents.length === 1 && apres.documents[0].nomFichier === "Formulaire_Conge_Signe.pdf", JSON.stringify(apres.documents.map((x) => x.nomFichier)));
    check("pièce jointe rattachée à l'expéditeur manager", apres.documents[0].recuDe === MANAGER, apres.documents[0].recuDe);
    const chemin = path.join(process.cwd(), "storage", "documents-demandes", apres.documents[0].chemin);
    check("fichier stocké sur le disque", fs.existsSync(chemin), chemin);
    if (fs.existsSync(chemin)) {
      const brut = fs.readFileSync(chemin);
      check("fichier stocké CHIFFRÉ (pas de %PDF en clair)", brut.slice(0, 20).indexOf("%PDF") < 0, brut.slice(0, 20).toString("hex"));
    }
  }

  // ---- 7) Pièce jointe + réponse ambiguë --------------------------------------
  console.log("=== 7) Pièce jointe + ambiguïté → PJ conservée, statut EN_ATTENTE ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Congé accepté par le chef d'équipe mais NON approuvé par la direction.",
      piecesJointes: [pjPdf("Planning_Equipe.pdf")],
    }));
    const apres = await relire(d.id);
    check("pièce jointe conservée", apres.documents.length === 1, String(apres.documents.length));
    check("statut reste EN_ATTENTE (ambiguïté)", apres.statut === "EN_ATTENTE", apres.statut);
    check("décision AMBIGUE", r.decision === "AMBIGUE", String(r.decision));
    check("trace pour le RH dans le commentaire", (apres.commentaire || "").indexOf("non reconnue") >= 0 || (apres.commentaire || "").indexOf("en attente") >= 0, String(apres.commentaire));
  }

  // ---- 8) Pièce jointe seule (ancien passage automatique supprimé) ------------
  console.log("=== 8) Pièce jointe seule, aucun texte décisionnel → EN_ATTENTE (cahier 3.e) ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "",
      piecesJointes: [pjPdf("Attestation_Conge.pdf")],
    }));
    const apres = await relire(d.id);
    check("pièce jointe conservée", apres.documents.length === 1, String(apres.documents.length));
    check("statut reste EN_ATTENTE (plus d'ACCEPTEE automatique pour le congé)", apres.statut === "EN_ATTENTE", apres.statut);
  }

  // ---- 9) Décision existante conservée ----------------------------------------
  console.log("=== 9) Demande déjà REFUSEE + « Congé accepté » → REFUSEE conservée ===");
  {
    const d = await semerDemande({ statut: "REFUSEE", commentaire: "Refus antérieur du manager." });
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Finalement : Congé accepté.",
    }));
    const apres = await relire(d.id);
    check("statut reste REFUSEE", apres.statut === "REFUSEE", apres.statut);
    check("commentaire d'origine conservé", (apres.commentaire || "").indexOf("Refus antérieur") >= 0, String(apres.commentaire));
  }

  // ---- 10) Expéditeur non autorisé ---------------------------------------------
  console.log("=== 10) Expéditeur non autorisé → IGNORE ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      de: "intrus@autre-domaine.test",
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Congé accepté (tentative d'usurpation).",
    }));
    const apres = await relire(d.id);
    check("message IGNORE", r.statut === "IGNORE", r.statut);
    check("statut reste EN_ATTENTE (garde de sécurité)", apres.statut === "EN_ATTENTE", apres.statut);
  }

  // ---- 11) NON-RÉGRESSION : attestation avec pièce jointe → ACCEPTEE ------------
  console.log("=== 11) NON-RÉGRESSION attestations : PJ reçue → ACCEPTEE (comportement historique) ===");
  {
    const d = await semerDemande({ type: "ATTESTATION_TRAVAIL" });
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Attestation de travail — " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Veuillez trouver votre attestation.",
      piecesJointes: [pjPdf("Attestation_Travail.pdf")],
    }));
    const apres = await relire(d.id);
    check("statut → ACCEPTEE (inchangé pour les attestations)", apres.statut === "ACCEPTEE", apres.statut);
    check("traitePar = Auto-RH (e-mail)", apres.traitePar === "Auto-RH (e-mail)", String(apres.traitePar));
    check("pièce jointe conservée", apres.documents.length === 1, String(apres.documents.length));
  }

  // ---- 12) NON-RÉGRESSION : attestation sans pièce jointe → IGNORE ---------------
  console.log("=== 12) NON-RÉGRESSION attestations : sans PJ → IGNORE (inchangé) ===");
  {
    const d = await semerDemande({ type: "ATTESTATION_TRAVAIL" });
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Attestation de travail — " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "OK, je prépare le document demain.",
    }));
    check("message IGNORE (attestations inchangées)", r.statut === "IGNORE", r.statut);
  }

  // ---- 13) Rattachement par la référence du sujet (transfert) --------------------
  console.log("=== 13) Rattachement par la référence du sujet (sans In-Reply-To) ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "TR: Demande de congé " + d.reference + " (transféré)",
      inReplyTo: null,
      texte: "Bonjour, je confirme : votre demande de congé a été validée.",
    }));
    const apres = await relire(d.id);
    check("demande retrouvée par la référence", r.statut === "TRAITE", JSON.stringify(r));
    check("décision manager = ACCEPTEE (statut EN_ATTENTE — Task 181)", apres.decisionManager === "ACCEPTEE" && apres.statut === "EN_ATTENTE", apres.decisionManager + "/" + apres.statut);
  }

  // ---- 14) HTML seul (corps sans text/plain) --------------------------------------
  console.log("=== 14) Corps HTML seul (text/plain absent) → décision reconnue ===");
  {
    const d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "",
      html: "<html><body><p>Bonjour,</p><p><b>Congé accepté</b>. Bon séjour.</p></body></html>",
    }));
    const apres = await relire(d.id);
    check("HTML dépouillé → décision manager ACCEPTEE (statut EN_ATTENTE)", apres.decisionManager === "ACCEPTEE" && apres.statut === "EN_ATTENTE", apres.decisionManager + "/" + apres.statut + " / " + r.decision);
  }
}

main()
  .then(async () => {
    // ---- Nettoyage complet ----------------------------------------------------
    console.log("=== Nettoyage ===");
    const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
    const restantes = await prisma.demandeAdministrative.findMany({
      where: { cin: cinIdx },
      include: { documents: true },
    });
    const chemins = restantes.flatMap((d) => d.documents.map((doc) => path.join(process.cwd(), "storage", "documents-demandes", doc.chemin)));
    await prisma.demandeAdministrative.deleteMany({ where: { cin: cinIdx } });
    for (const c of chemins) { try { fs.unlinkSync(c); } catch (e) { /* déjà absent */ } }
    // Restauration de la configuration SMTP à l'identique (valeurs chiffrées sauvegardées telles quelles)
    if (typeof cfgAvant !== "undefined" && cfgAvant) {
      const { id, createdAt, updatedAt, ...data } = cfgAvant;
      await prisma.mailConfig.update({ where: { id: "smtp" }, data });
    }
    const reste = await prisma.demandeAdministrative.count({ where: { cin: cinIdx } });
    check("nettoyage : 0 demande restante", reste === 0, String(reste));
    console.log("");
    console.log("RÉSULTAT : " + OK + " OK, " + KO + " FAIL");
    process.exit(KO ? 1 : 0);
  })
  .catch((e) => {
    console.error("ERREUR FATALE:", e);
    process.exit(1);
  });
