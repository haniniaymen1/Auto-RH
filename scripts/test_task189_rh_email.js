#!/usr/bin/env node
/**
 * v0.2.146 — PREUVE E2E « le RH peut répondre par e-mail » (étape 2 de la
 * validation à deux étapes, demande utilisateur trace 1a1173dfe4d1fe29).
 *
 * Exerce le VRAI code de réception (traiterMessageRecu, portail en mode
 * module — aucun serveur, aucun IMAP requis) avec la résolution de RÔLE
 * de l'expéditeur :
 *
 *   A. RH (cfg.rhEmail) accepte AVANT le manager (« Je valide »)
 *      → decisionRh=ACCEPTEE tracée, statut reste EN_ATTENTE ;
 *      puis manager accepte (« Congé accepté ») → STATUT FINAL ACCEPTEE.
 *   B. Manager accepte d'abord, puis RH répond à l'e-mail de TRANSMISSION
 *      (« Acceptée ») → STATUT FINAL ACCEPTEE + refuseePar=null.
 *   C. RH refuse (« Je refuse ») → REFUSEE + refuseePar=RH (immédiat).
 *   D. Expéditeur inconnu → IGNORED (garde préservée).
 *   E. (MODIFIÉ v0.2.151 — parité RH) demande routée DIRECTEMENT à la
 *      boîte RH (aucun manager) : la réponse de rhEmail est une DÉCISION
 *      RH UNIQUE (rôle « rh », étape manager satisfaite automatiquement)
 *      qui achève la matrice en une seule étape → STATUT FINAL ACCEPTEE.
 *      [Avant v0.2.151 : décision « manager » isolée, demande jamais
 *      finalisable par e-mail — remplacé par « même chose pour les
 *      e-mails RH ».]
 *   F. Réponse RH sur une demande DÉJÀ finale → aucune nouvelle décision.
 *
 * Nettoyage complet (demandes + rhEmail restauré) même en cas d'échec.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const prisma = portail.prisma;

const REF = "DEM-2026-118"; // préfixe de nettoyage ; refs réelles 11801…11805 (5 chiffres)
const MANAGER = "manager.diag1189@test.local";
const RH = "rh.diag1189@test.local";
const EMPLOYE = "employe.diag1189@test.local";
const INCONNU = "inconnu.diag1189@test.local";

let ok = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("  OK   " + label + (extra ? " — " + extra : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? " — " + extra : "")); }
}

function message({ sujet, de, inReplyTo = null, texte = "" }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "X" }] },
    inReplyTo,
    references: inReplyTo ? [inReplyTo] : undefined,
    text: texte,
    html: null,
    attachments: [],
  };
}

async function creerDemande(num, destinataire, messageId) {
  // format RÉEL : DEM-AAAA-NNNNN (EXACTEMENT 5 chiffres) — 11801…11805
  return prisma.demandeAdministrative.create({
    data: {
      reference: "DEM-2026-" + String(11800 + num),
      type: "CONGE",
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp("TS1a1189diag", true),
      destinataire: cryptoBd.chiffrerChamp(destinataire),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18", emailN1: destinataire,
      })),
      messageIdEnvoi: messageId || null,
    },
  });
}

async function main() {
  console.log("== v0.2.146 — décision RH par e-mail (validation deux étapes) ==");
  const cfgAvant = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  const rhEmailAvant = cfgAvant ? cfgAvant.rhEmail : null;
  try {
    if (cfgAvant) {
      // ⚠ rhEmail est stocké EN CLAIR dans MailConfig (lireConfigMailDemandes
      // ne le déchiffre pas) — mise à jour en clair.
      await prisma.mailConfig.update({ where: { id: "smtp" }, data: { rhEmail: RH } });
    } else {
      await prisma.mailConfig.create({ data: { id: "smtp", rhEmail: RH } });
    }
    await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });

    // ---------- A. RH accepte AVANT le manager ----------
    console.log("\n— A. RH accepte par e-mail avant le manager —");
    const dA = await creerDemande(1, MANAGER, "dem1189-a@test");
    const rA = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dA.reference, de: RH, inReplyTo: "<dem1189-a@test>", texte: "Je valide.",
    }));
    let dAb = await prisma.demandeAdministrative.findUnique({ where: { id: dA.id } });
    check("A1 rôle reconnu (rh) et décision tracée", rA && rA.statut === "TRAITE" && rA.roleReponse === "rh", JSON.stringify(rA || {}).slice(0, 140));
    check("A2 decisionRh=ACCEPTEE (Auto-RH (réponse e-mail))", dAb.decisionRh === "ACCEPTEE" && dAb.decisionRhPar === "Auto-RH (réponse e-mail)", "decisionRh=" + dAb.decisionRh);
    check("A3 statut reste EN_ATTENTE (manager pas encore décidé)", dAb.statut === "EN_ATTENTE", "statut=" + dAb.statut);
    const rA2 = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dA.reference, de: MANAGER, inReplyTo: "<dem1189-a@test>", texte: "Congé accepté.",
    }));
    dAb = await prisma.demandeAdministrative.findUnique({ where: { id: dA.id } });
    check("A4 manager accepte ensuite → STATUT FINAL = ACCEPTEE", dAb.statut === "ACCEPTEE", "statut=" + dAb.statut);
    check("A5 refuseePar=null + decisionManager=ACCEPTEE", dAb.refuseePar === null && dAb.decisionManager === "ACCEPTEE", "refuseePar=" + dAb.refuseePar);

    // ---------- B. RH répond à l'e-mail de TRANSMISSION ----------
    console.log("\n— B. RH répond à la transmission après le manager —");
    const dB = await creerDemande(2, MANAGER, "dem1189-b@test");
    await portail.traiterMessageRecu(message({
      sujet: "RE: " + dB.reference, de: MANAGER, inReplyTo: "<dem1189-b@test>", texte: "Congé accepté.",
    }));
    const dB1 = await prisma.demandeAdministrative.findUnique({ where: { id: dB.id } });
    check("B1 manager accepté → EN_ATTENTE (attente RH)", dB1.decisionManager === "ACCEPTEE" && dB1.statut === "EN_ATTENTE", "statut=" + dB1.statut);
    const rB = await portail.traiterMessageRecu(message({
      // sujet SIMULANT l'e-mail de transmission « — validation RH requise »
      sujet: "RE: Auto-RH — Congé " + dB.reference + " acceptée par le manager — validation RH requise",
      de: RH, texte: "Je valide, merci.",
    }));
    const dBb = await prisma.demandeAdministrative.findUnique({ where: { id: dB.id } });
    check("B2 réponse RH (sujet transmission) rattachée à la demande", rB && rB.statut === "TRAITE" && rB.roleReponse === "rh", JSON.stringify(rB || {}).slice(0, 140));
    check("B3 STATUT FINAL = ACCEPTEE (matrice complète par e-mail)", dBb.statut === "ACCEPTEE" && dBb.refuseePar === null, "statut=" + dBb.statut + " refuseePar=" + dBb.refuseePar);

    // ---------- C. RH refuse ----------
    console.log("\n— C. RH refuse par e-mail —");
    const dC = await creerDemande(3, MANAGER, "dem1189-c@test");
    await portail.traiterMessageRecu(message({
      sujet: "RE: " + dC.reference, de: MANAGER, inReplyTo: "<dem1189-c@test>", texte: "Congé accepté.",
    }));
    const rC = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dC.reference, de: RH, texte: "Je refuse cette demande.",
    }));
    const dCb = await prisma.demandeAdministrative.findUnique({ where: { id: dC.id } });
    check("C1 RH refuse → REFUSEE immédiat", dCb.statut === "REFUSEE" && dCb.refuseePar === "RH", "statut=" + dCb.statut + " refuseePar=" + dCb.refuseePar);
    check("C2 decisionRh=REFUSEE tracée", dCb.decisionRh === "REFUSEE" && dCb.decisionRhPar === "Auto-RH (réponse e-mail)", "decisionRh=" + dCb.decisionRh);

    // ---------- D. Expéditeur inconnu ----------
    console.log("\n— D. garde expéditeur préservée —");
    const dD = await creerDemande(4, MANAGER, "dem1189-d@test");
    const rD = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dD.reference, de: INCONNU, texte: "Congé accepté.",
    }));
    const dDb = await prisma.demandeAdministrative.findUnique({ where: { id: dD.id } });
    check("D1 réponse d'une adresse inconnue → IGNORED", rD && rD.statut === "IGNORE" && /non autorisé/.test(String(rD.motif)), JSON.stringify(rD || {}).slice(0, 140));
    check("D2 aucune décision tracée", dDb.decisionManager === null && dDb.decisionRh === null && dDb.statut === "EN_ATTENTE", "statut=" + dDb.statut);

    // ---------- E. Repli : demande routée directement à la boîte RH ----------
    console.log("\n— E. demande adressée directement à la boîte RH (v0.2.151 : décision RH unique) —");
    const dE = await creerDemande(5, RH, "dem1189-e@test");
    const rE = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dE.reference, de: RH, inReplyTo: "<dem1189-e@test>", texte: "Congé accepté.",
    }));
    const dEb = await prisma.demandeAdministrative.findUnique({ where: { id: dE.id } });
    check("E1 réponse de la boîte destinataire = décision RH (v0.2.151, rôle rh)", rE && rE.roleReponse === "rh" && dEb.decisionRh === "ACCEPTEE", "role=" + (rE && rE.roleReponse));
    check("E2 décision RH unique achève la matrice → ACCEPTEE (étape manager satisfaite automatiquement)", dEb.statut === "ACCEPTEE" && dEb.decisionManager === "ACCEPTEE" && /étape manager satisfaite automatiquement/.test(dEb.decisionManagerPar || ""), "statut=" + dEb.statut);

    // ---------- F. Réponse RH sur demande déjà finale ----------
    console.log("\n— F. demande déjà finale — aucune nouvelle décision —");
    const rF = await portail.traiterMessageRecu(message({
      sujet: "RE: " + dB.reference, de: RH, texte: "Congé accepté.",
    }));
    const dFb = await prisma.demandeAdministrative.findUnique({ where: { id: dB.id } });
    check("F1 demande déjà ACCEPTEE : aucune réouverture, décision inchangée", dFb.statut === "ACCEPTEE" && dFb.decisionRh === "ACCEPTEE" && rF && rF.statut === "TRAITE", "statut=" + dFb.statut);

    // ---------- Nettoyage ----------
    const suppr = await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });
    console.log("\nNettoyage OK (" + suppr.count + " demande(s) de test supprimée(s))");
    console.log("RÉSULTAT : " + ok + " OK / " + fail + " FAIL");
  } finally {
    // Restauration de la config mail dans TOUS les cas
    try {
      if (cfgAvant) {
        await prisma.mailConfig.update({ where: { id: "smtp" }, data: { rhEmail: rhEmailAvant } });
      } else {
        await prisma.mailConfig.delete({ where: { id: "smtp" } });
      }
      console.log("Config mail restaurée (rhEmail = " + (rhEmailAvant ? "valeur d'origine" : "absente au départ → ligne supprimée") + ").");
    } catch (e) { console.error("Restauration config: " + e.message); }
    await prisma.$disconnect();
  }
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
