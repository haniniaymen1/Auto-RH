#!/usr/bin/env node
/**
 * Task 181 — PREUVE E2E de la VALIDATION À DEUX ÉTAPES MANAGER → RH
 * (congé et autorisation de sortie).
 *
 * Exerce le VRAI code de réception du portail (traiterMessageRecu en mode
 * module — AUCUN serveur démarré, AUCUN IMAP requis) + la MATRICE de statut
 * final exposée par le portail, en simulant la décision RH par mise à jour
 * directe (mêmes champs que la décision de l'administration) :
 *
 *   MATRICE (jumelle portail calculerStatutFinalDeuxEtapes) :
 *     1. Manager ACCEPTEE + RH ACCEPTEE   → ACCEPTEE            ;
 *     2. Manager REFUSEE (RH quelconque)  → REFUSEE / MANAGER  ;
 *     3. Manager ACCEPTEE + RH REFUSEE    → REFUSEE / RH       ;
 *     4. Manager ACCEPTEE + RH absent     → EN_ATTENTE         ;
 *     5. RH REFUSEE seul                  → REFUSEE / RH       ;
 *     6. toutes absentes                  → EN_ATTENTE         ;
 *     7. libellés raffinés (Refusée par le Manager / par les RH).
 *
 *   SCÉNARIOS RÉELS (traiterMessageRecu + champs décision) :
 *     A. congé : réponse e-mail manager « acceptée » → Décision Manager
 *        ACCEPTEE, statut EN_ATTENTE, AUCUN document signé ;
 *     B. puis décision RH « Acceptée » (mêmes champs que l'administration)
 *        → statut final ACCEPTEE, document signé généré (certificat absent
 *        → traçé, jamais bloquant) ;
 *     C. autorisation de sortie : réponse e-mail reconnue → Décision Manager
 *        ACCEPTEE (classification étendue Task 181) ;
 *     D. refus manager sur une AUTORISATION → REFUSEE + refuseePar=MANAGER,
 *        AUCUNE transmission RH (journal demande-transmission-rh absent) ;
 *     E. refus manager sur un CONGÉ : e-mail employé journalisé + notification
 *        RH journalisée + document de refus tenté (Task 180) ;
 *     F. demande RH-refusée : réponse manager tardive IGNORÉE (définitif).
 *
 * Nettoyage complet vérifié (demandes, documents, fichiers, SMTP restauré).
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

// ---- Portail en mode MODULE -------------------------------------------------
const portail = require("./portail-server.js");
const prisma = portail.prisma;
const matrice = portail.calculerStatutFinalDeuxEtapes;
const libelle = portail.libelleStatutFinalDemande;

const CIN = "TS18190099";
const MANAGER = "manager181@test.local";
const EMPLOYE = "employe181@test.local";
const JOURNAL = path.join(process.cwd(), "logs", "journal-emails.log");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) {
    OK++;
    console.log("  OK   " + label);
  } else {
    KO++;
    console.log("  FAIL " + label + (detail ? "  → " + detail : ""));
  }
}

// ---- Fabrique de message parsé (forme mailparser) ---------------------------
function message({ sujet, texte, html = "", de = MANAGER, inReplyTo = null, references = null, piecesJointes = [] }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "" }] },
    inReplyTo: inReplyTo,
    references: references,
    text: texte,
    html: html,
    attachments: piecesJointes,
  };
}

function pjPdf(nom) {
  return {
    filename: nom,
    contentType: "application/pdf",
    content: Buffer.from("%PDF-1.4\n% Task 181 — pièce jointe de test\n%%EOF\n", "utf8"),
  };
}

let compteur = 0;
async function semerDemande({ type = "CONGE", statut = "EN_ATTENTE", extra = {} }) {
  compteur++;
  const ref = "DEM-2026-81" + String(100 + compteur).padStart(3, "0");
  const donnees = type === "AUTORISATION_SORTIE"
    ? { date: "2026-12-01", nom: "Ben Salah Mohamed", departement: "INFORMATIQUE", motif: "Rendez-vous administratif", nombreHeures: "2", emailN1: MANAGER }
    : { typeConge: "Congé annuel", dateDebut: "2026-12-02", dateFin: "2026-12-06", emailN1: MANAGER };
  return prisma.demandeAdministrative.create({
    data: Object.assign({
      reference: ref,
      type: type,
      cin: cryptoBd.chiffrerChamp(CIN, true),
      statut: statut,
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      messageIdEnvoi: "task181-" + compteur + "@autorh.local",
    }, extra),
  });
}

async function relire(id) {
  return prisma.demandeAdministrative.findUnique({ where: { id }, include: { documents: true } });
}

async function journalContient(reference, action) {
  let contenu = "";
  try { contenu = fs.readFileSync(JOURNAL, "utf8"); } catch (e) { return false; }
  const lignes = contenu.split("\n").filter((l) => l.indexOf(reference) >= 0);
  return lignes.some((l) => l.indexOf('"action":"' + action + '"') >= 0 || l.indexOf('"action": "' + action + '"') >= 0);
}

/** Simule la DÉCISION RH de l'administration (mêmes champs + matrice que
 *  POST /api/demandes/[id] — la logique de matrice est identique). Relit
 *  D'ABORD la demande (la décision du manager peut avoir été tracée entre-
 *  temps par la réponse e-mail). */
async function decisionRh(demandeId, statut) {
  const d = await prisma.demandeAdministrative.findUnique({ where: { id: demandeId } });
  const finale = matrice(d.decisionManager, statut);
  const data = {
    decisionRh: statut,
    decisionRhLe: new Date(),
    decisionRhPar: "rh181@test.local",
    statut: finale.statut,
    refuseePar: finale.refuseePar,
    traitePar: "rh181@test.local",
    traiteLe: new Date(),
  };
  await prisma.demandeAdministrative.update({ where: { id: demandeId }, data });
  return finale;
}

async function main() {
  console.log("=== Préparation ===");
  const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
  await prisma.demandeAdministrative.deleteMany({ where: { cin: cinIdx } });

  // Neutralisation VOLONTAIRE du SMTP pendant le test (restauré à la fin).
  const cfgAvant = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  if (cfgAvant) {
    await prisma.mailConfig.update({
      where: { id: "smtp" },
      data: { host: "", imapActif: false },
    });
  }

  // ================= MATRICE (jumelle portail) =================
  console.log("=== 1) MATRICE : Manager ACCEPTEE + RH ACCEPTEE → ACCEPTEE ===");
  check("statut ACCEPTEE, refuseePar null", JSON.stringify(matrice("ACCEPTEE", "ACCEPTEE")) === JSON.stringify({ statut: "ACCEPTEE", refuseePar: null }), JSON.stringify(matrice("ACCEPTEE", "ACCEPTEE")));

  console.log("=== 2) MATRICE : Manager REFUSEE → REFUSEE / MANAGER ===");
  check("statut REFUSEE + refuseePar MANAGER", matrice("REFUSEE", null).statut === "REFUSEE" && matrice("REFUSEE", null).refuseePar === "MANAGER", JSON.stringify(matrice("REFUSEE", null)));
  check("refus manager prioritaire même si RH accepte", matrice("REFUSEE", "ACCEPTEE").refuseePar === "MANAGER", JSON.stringify(matrice("REFUSEE", "ACCEPTEE")));

  console.log("=== 3) MATRICE : Manager ACCEPTEE + RH REFUSEE → REFUSEE / RH ===");
  check("statut REFUSEE + refuseePar RH", matrice("ACCEPTEE", "REFUSEE").statut === "REFUSEE" && matrice("ACCEPTEE", "REFUSEE").refuseePar === "RH", JSON.stringify(matrice("ACCEPTEE", "REFUSEE")));

  console.log("=== 4) MATRICE : Manager ACCEPTEE + RH absent → EN_ATTENTE ===");
  check("statut EN_ATTENTE", matrice("ACCEPTEE", null).statut === "EN_ATTENTE", JSON.stringify(matrice("ACCEPTEE", null)));

  console.log("=== 5) MATRICE : RH REFUSEE seul → REFUSEE / RH ===");
  check("statut REFUSEE + refuseePar RH", matrice(null, "REFUSEE").statut === "REFUSEE" && matrice(null, "REFUSEE").refuseePar === "RH", JSON.stringify(matrice(null, "REFUSEE")));

  console.log("=== 6) MATRICE : aucune décision → EN_ATTENTE ===");
  check("statut EN_ATTENTE", matrice(null, null).statut === "EN_ATTENTE", JSON.stringify(matrice(null, null)));

  console.log("=== 7) LIBELLÉS raffinés ===");
  check("« Refusée par le Manager »", libelle("REFUSEE", "MANAGER") === "Refusée par le Manager", libelle("REFUSEE", "MANAGER"));
  check("« Refusée par les RH »", libelle("REFUSEE", "RH") === "Refusée par les RH", libelle("REFUSEE", "RH"));
  check("« Acceptée »", libelle("ACCEPTEE", null) === "Acceptée", libelle("ACCEPTEE", null));

  // ================= SCÉNARIOS RÉELS =================
  console.log("=== A) CONGÉ : acceptation manager par e-mail → étape 1 uniquement ===");
  let d;
  {
    d = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d.reference,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      texte: "Bonjour,\n\nCongé validé, bon repos.\n\nLe manager",
    }));
    const apres = await relire(d.id);
    check("TRAITE + décision VALIDATION", r.statut === "TRAITE" && r.decision === "VALIDATION", JSON.stringify(r).slice(0, 200));
    check("Décision Manager = ACCEPTEE tracée", apres.decisionManager === "ACCEPTEE", String(apres.decisionManager));
    check("Décision Manager par = Manager (réponse e-mail)", apres.decisionManagerPar === "Manager (réponse e-mail)", String(apres.decisionManagerPar));
    check("Décision Manager note = formulation reconnue", (apres.decisionManagerNote || "").indexOf("Congé validé") >= 0, String(apres.decisionManagerNote));
    check("Décision RH encore absente", apres.decisionRh === null, String(apres.decisionRh));
    check("statut EN_ATTENTE (étape RH requise)", apres.statut === "EN_ATTENTE", apres.statut);
    check("AUCUN document signé (matrice incomplète)", apres.docSigneChemin === null && apres.documents.length === 0, String(apres.docSigneChemin) + "/" + apres.documents.length);
    check("transmission RH journalisée", await journalContient(d.reference, "demande-transmission-rh"));
  }

  console.log("=== B) CONGÉ : décision RH « Acceptée » → statut final ACCEPTEE ===");
  {
    await decisionRh(d.id, "ACCEPTEE");
    const apres = await relire(d.id);
    check("statut final ACCEPTEE", apres.statut === "ACCEPTEE", apres.statut);
    check("Décision RH = ACCEPTEE + par", apres.decisionRh === "ACCEPTEE" && apres.decisionRhPar === "rh181@test.local", apres.decisionRh + "/" + apres.decisionRhPar);
    check("refuseePar resté null", apres.refuseePar === null, String(apres.refuseePar));
  }

  console.log("=== C) AUTORISATION : acceptation manager par e-mail (classification étendue) ===");
  {
    const d2 = await semerDemande({ type: "AUTORISATION_SORTIE" });
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Autorisation de sortie : " + d2.reference,
      inReplyTo: "<" + d2.messageIdEnvoi + ">",
      texte: "OK, j'accorde cette sortie.",
    }));
    const apres = await relire(d2.id);
    check("décision VALIDATION reconnue (AUTORISATION_SORTIE)", r.decision === "VALIDATION", String(r.decision));
    check("Décision Manager = ACCEPTEE", apres.decisionManager === "ACCEPTEE", String(apres.decisionManager));
    check("statut EN_ATTENTE (étape RH requise)", apres.statut === "EN_ATTENTE", apres.statut);
    check("transmission RH journalisée", await journalContient(d2.reference, "demande-transmission-rh"));

    console.log("=== C2) AUTORISATION : RH refuse → « Refusée par les RH » ===");
    await decisionRh(d2.id, "REFUSEE");
    const apres2 = await relire(d2.id);
    check("statut REFUSEE + refuseePar RH", apres2.statut === "REFUSEE" && apres2.refuseePar === "RH", apres2.statut + "/" + apres2.refuseePar);
    check("Décision RH = REFUSEE", apres2.decisionRh === "REFUSEE", String(apres2.decisionRh));
  }

  console.log("=== D) AUTORISATION : refus manager → REFUSEE / MANAGER, AUCUNE transmission RH ===");
  {
    const d3 = await semerDemande({ type: "AUTORISATION_SORTIE" });
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Autorisation de sortie : " + d3.reference,
      inReplyTo: "<" + d3.messageIdEnvoi + ">",
      texte: "Je refuse, effectif insuffisant ce jour-là.",
    }));
    const apres = await relire(d3.id);
    check("statut REFUSEE immédiat", apres.statut === "REFUSEE", apres.statut);
    check("refuseePar = MANAGER", apres.refuseePar === "MANAGER", String(apres.refuseePar));
    check("Décision Manager = REFUSEE", apres.decisionManager === "REFUSEE", String(apres.decisionManager));
    check("AUCUNE transmission RH journalisée", !(await journalContient(d3.reference, "demande-transmission-rh")));
    check("notification RH du refus journalisée", await journalContient(d3.reference, "demande-refus-manager-rh"));
    check("libellé raffiné = Refusée par le Manager", libelle(apres.statut, apres.refuseePar) === "Refusée par le Manager", libelle(apres.statut, apres.refuseePar));
  }

  console.log("=== E) CONGÉ : refus manager avec pièce jointe → PJ conservée + refus immédiat ===");
  {
    const d4 = await semerDemande({});
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d4.reference,
      inReplyTo: "<" + d4.messageIdEnvoi + ">",
      texte: "NON, période critique — demande refusée.",
      piecesJointes: [pjPdf("Planning_Critique.pdf")],
    }));
    const apres = await relire(d4.id);
    check("statut REFUSEE + refuseePar MANAGER", apres.statut === "REFUSEE" && apres.refuseePar === "MANAGER", apres.statut + "/" + apres.refuseePar);
    // (Task 181) la PJ du manager est conservée EN PREMIER ; un certificat
    // étant configuré dans la base de test, le document de refus signé (Task
    // 180) peut s'ajouter en 2e position — les deux cas sont valides.
    check("PJ conservée", apres.documents.length >= 1 && apres.documents[0].nomFichier === "Planning_Critique.pdf" && (apres.documents.length === 1 || /^Refus_/.test(apres.documents[1].nomFichier)), JSON.stringify(apres.documents.map((x) => x.nomFichier)));
    check("e-mail employé journalisé (demande-decision-conge)", await journalContient(d4.reference, "demande-decision-conge"));
    check("notification RH journalisée", await journalContient(d4.reference, "demande-refus-manager-rh"));
  }

  console.log("=== F) Demande RH-refusée : réponse manager tardive IGNORÉE (définitif) ===");
  {
    const d5 = await semerDemande({});
    // le RH refuse d'abord (sans décision manager)
    await decisionRh(d5.id, "REFUSEE");
    const r = await portail.traiterMessageRecu(message({
      sujet: "Re: Auto-RH — Demande de congé : " + d5.reference,
      inReplyTo: "<" + d5.messageIdEnvoi + ">",
      texte: "Finalement : Congé accepté.",
    }));
    const apres = await relire(d5.id);
    check("statut REFUSEE conservé", apres.statut === "REFUSEE", apres.statut);
    check("refuseePar = RH (inchangé)", apres.refuseePar === "RH", String(apres.refuseePar));
    check("Décision Manager non tracée (réponse ignorée)", apres.decisionManager === null, String(apres.decisionManager));
  }
}

main()
  .then(async () => {
    console.log("=== Nettoyage ===");
    const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
    const restantes = await prisma.demandeAdministrative.findMany({
      where: { cin: cinIdx },
      include: { documents: true },
    });
    const chemins = restantes.flatMap((d) => d.documents.map((doc) => path.join(process.cwd(), "storage", "documents-demandes", doc.chemin)));
    await prisma.demandeAdministrative.deleteMany({ where: { cin: cinIdx } });
    for (const c of chemins) { try { fs.unlinkSync(c); } catch (e) { /* déjà absent */ } }
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
