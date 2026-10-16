#!/usr/bin/env node
/**
 * DIAGNOSTIC COMPLET « manager et rh répondent acceptée/refus et ça reste en
 * attente » (trace 1a1172285aca70a9)
 *
 * Reproduit sur le serveur VIVANT TOUTES les voies de décision d'un congé
 * (validation deux étapes Task 181) et TOUTES les causes possibles de
 * « réponse perdue » côté e-mail (Task 178) :
 *
 *   SCÉNARIO 1 — voie E-MAIL + UI (parcours nominal complet) :
 *     1a. manager répond par e-mail « Congé accepté » (VRAI traiterMessageRecu)
 *         → decisionManager=ACCEPTEE, statut reste EN_ATTENTE, transmission RH ;
 *     1b. RH accepte dans l'ADMINISTRATION (API POST) → statut final ACCEPTEE.
 *   SCÉNARIO 2 — manager refuse par e-mail « Je refuse » → REFUSEE immédiat
 *         (refuseePar=MANAGER), aucune transmission RH.
 *   SCÉNARIO 3 — RH refuse dans l'UI après acceptation manager → REFUSEE
 *         (refuseePar=RH).
 *   SCÉNARIO 4 — réponse AMBIGUÏE (« OK, d'accord ») → AUCUNE décision
 *         (formulation non reconnue) → reste EN_ATTENTE — CAUSE POSSIBLE n°1.
 *   SCÉNARIO 5 — réponse d'une AUTRE adresse que le destinataire de la
 *         demande → IGNORED (expéditeur non autorisé) — CAUSE POSSIBLE n°2.
 *   SCÉNARIO 6 — réponse sans In-Reply-To NI référence DEM-… dans le sujet
 *         → IGNORED (aucune demande ne correspond) — CAUSE POSSIBLE n°3.
 *   SCÉNARIO 7 — voie UI seule : RH enregistre la décision manager
 *         manuellement (cible=manager) puis décide → ACCEPTEE — la voie de
 *         repli quand l'e-mail ne marche pas.
 *
 * Nettoyage complet en fin de run.
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

const ADMIN = "http://localhost:4000";
const REF = "DEM-2026-1172"; // préfixe ; références réelles = DEM-2026-XXXXX (5 chiffres)
const MANAGER = "manager.diag1172@test.local";
const EMPLOYE = "employe.diag1172@test.local";
const AUTRE = "autre.personne@test.local";

let ok = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("  OK   " + label + (extra ? " — " + extra : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? " — " + extra : "")); }
}

function message({ sujet, de = MANAGER, inReplyTo = null, texte = "" }) {
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

async function creerDemande(suffix, messageId) {
  // format RÉEL de l'application : DEM-AAAA-00001 (5 chiffres) + messageId
  // mémorisé SANS chevrons (String(envoi.messageId).replace(/[<>]/g, ""))
  const num = String(suffix).replace(/\D/g, "").padStart(5, "0");
  return prisma.demandeAdministrative.create({
    data: {
      reference: REF + num,
      type: "CONGE",
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp("TS1a1172diag", true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: MANAGER,
      })),
      messageIdEnvoi: messageId,
    },
  });
}

async function login() {
  for (const password of ["AutoRH-2026!Verif#1", "AutoRH-2026!Verif"]) {
    const r = await fetch(ADMIN + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "superadmin@autorh.local", password }),
    });
    if (r.ok) return (r.headers.get("set-cookie") || "").split(";")[0];
  }
  throw new Error("login impossible");
}

async function decisionRh(cookie, id, body) {
  const r = await fetch(ADMIN + "/api/demandes/" + id, {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function main() {
  console.log("== Diagnostic complet : décisions manager + RH (e-mail & UI) ==");
  await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });
  const cookie = await login();

  // ---------- SCÉNARIO 1 : e-mail manager + UI RH ----------
  console.log("\n— SCÉNARIO 1 : manager répond par E-MAIL puis RH accepte dans l'UI —");
  const d1 = await creerDemande("S1", "dem-s1@auto-rh.test");
  const r1 = await portail.traiterMessageRecu(message({
    sujet: "RE: Demande de congé " + d1.reference,
    inReplyTo: "<dem-s1@auto-rh.test>",
    texte: "Congé accepté, bon courage.",
  }));
  check("1a.1 réponse manager reconnue (pas IGNORED)", r1 && r1.statut !== "IGNORE", JSON.stringify(r1 && r1.statut !== "IGNORE" ? { statut: r1.statut } : r1).slice(0, 160));
  let d1b = await prisma.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("1a.2 decisionManager=ACCEPTEE (tracée)", d1b.decisionManager === "ACCEPTEE", "decisionManager=" + d1b.decisionManager);
  check("1a.3 statut reste EN_ATTENTE (RH pas encore décidé — matrice 181)", d1b.statut === "EN_ATTENTE", "statut=" + d1b.statut);
  const r1b = await decisionRh(cookie, d1.id, { statut: "ACCEPTEE" });
  check("1b.1 RH accepte via UI → HTTP 200", r1b.status === 200, "http=" + r1b.status + (r1b.data && r1b.data.error ? " err=" + r1b.data.error : ""));
  d1b = await prisma.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("1b.2 STATUT FINAL = ACCEPTEE (manager e-mail + RH UI)", d1b.statut === "ACCEPTEE", "statut=" + d1b.statut);

  // ---------- SCÉNARIO 2 : manager refuse par e-mail ----------
  console.log("\n— SCÉNARIO 2 : manager refuse par E-MAIL —");
  const d2 = await creerDemande("S2", "dem-s2@auto-rh.test");
  const r2 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d2.reference, inReplyTo: "<dem-s2@auto-rh.test>", texte: "Je refuse cette demande.",
  }));
  const d2b = await prisma.demandeAdministrative.findUnique({ where: { id: d2.id } });
  check("2.1 refus e-mail appliqué", d2b.statut === "REFUSEE" && d2b.refuseePar === "MANAGER", "statut=" + d2b.statut + " refuseePar=" + d2b.refuseePar);

  // ---------- SCÉNARIO 3 : RH refuse dans l'UI après manager OK ----------
  console.log("\n— SCÉNARIO 3 : manager accepte (e-mail) puis RH REFUSE dans l'UI —");
  const d3 = await creerDemande("S3", "dem-s3@auto-rh.test");
  await portail.traiterMessageRecu(message({ sujet: "RE: " + d3.reference, inReplyTo: "<dem-s3@auto-rh.test>", texte: "Congé accepté." }));
  await decisionRh(cookie, d3.id, { statut: "REFUSEE" });
  const d3b = await prisma.demandeAdministrative.findUnique({ where: { id: d3.id } });
  check("3.1 REFUSEE par les RH", d3b.statut === "REFUSEE" && d3b.refuseePar === "RH", "statut=" + d3b.statut + " refuseePar=" + d3b.refuseePar);

  // ---------- SCÉNARIO 4 : formulation ambiguë ----------
  console.log("\n— SCÉNARIO 4 (CAUSE POSSIBLE n°1) : formulation NON reconnue —");
  const d4 = await creerDemande("S4", "dem-s4@auto-rh.test");
  // formulation réellement NON reconnue par le classificateur (Task 178) —
  // (« OK, d'accord » EST reconnu comme acceptation : découvert au 1er run)
  const r4 = await portail.traiterMessageRecu(message({ sujet: "RE: " + d4.reference, inReplyTo: "<dem-s4@auto-rh.test>", texte: "Peut-être, on verra plus tard." }));
  const d4b = await prisma.demandeAdministrative.findUnique({ where: { id: d4.id } });
  check("4.1 décision NON enregistrée (formulation ambiguë)", d4b.decisionManager === null, "decisionManager=" + d4b.decisionManager);
  check("4.2 demande reste EN_ATTENTE", d4b.statut === "EN_ATTENTE", "statut=" + d4b.statut);

  // ---------- SCÉNARIO 5 : mauvais expéditeur ----------
  console.log("\n— SCÉNARIO 5 (CAUSE POSSIBLE n°2) : réponse d'une AUTRE adresse —");
  const d5 = await creerDemande("S5", "dem-s5@auto-rh.test");
  const r5 = await portail.traiterMessageRecu(message({ sujet: "RE: " + d5.reference, inReplyTo: "<dem-s5@auto-rh.test>", texte: "Congé accepté.", de: AUTRE }));
  check("5.1 réponse IGNORED (expéditeur ≠ destinataire de la demande)", r5 && r5.statut === "IGNORE" && /expéditeur|Expéditeur/.test(String(r5.motif || "")), JSON.stringify(r5 || {}).slice(0, 160));
  const d5b = await prisma.demandeAdministrative.findUnique({ where: { id: d5.id } });
  check("5.2 aucune décision tracée", d5b.decisionManager === null && d5b.statut === "EN_ATTENTE", "decisionManager=" + d5b.decisionManager);

  // ---------- SCÉNARIO 6 : rattachement impossible ----------
  console.log("\n— SCÉNARIO 6 (CAUSE POSSIBLE n°3) : e-mail SANS lien avec la demande —");
  const d6 = await creerDemande("S6", "dem-s6@auto-rh.test");
  const r6 = await portail.traiterMessageRecu(message({ sujet: "Bonjour", inReplyTo: null, texte: "Congé accepté." }));
  check("6.1 réponse IGNORED (aucune demande ne correspond)", r6 && r6.statut === "IGNORE", JSON.stringify(r6 || {}).slice(0, 160));

  // ---------- SCÉNARIO 7 : voie de repli 100 % UI ----------
  console.log("\n— SCÉNARIO 7 : voie 100 % UI (saisie manuelle decision manager) —");
  const d7 = await creerDemande("S7", "dem-s7@auto-rh.test");
  let r7 = await decisionRh(cookie, d7.id, { statut: "ACCEPTEE", cible: "manager" });
  check("7.1 décision manager saisie dans l'UI → HTTP 200", r7.status === 200, "http=" + r7.status + (r7.data && r7.data.error ? " err=" + r7.data.error : ""));
  let d7b = await prisma.demandeAdministrative.findUnique({ where: { id: d7.id } });
  check("7.2 decisionManager=ACCEPTEE, statut encore EN_ATTENTE", d7b.decisionManager === "ACCEPTEE" && d7b.statut === "EN_ATTENTE", "statut=" + d7b.statut);
  r7 = await decisionRh(cookie, d7.id, { statut: "ACCEPTEE" });
  d7b = await prisma.demandeAdministrative.findUnique({ where: { id: d7.id } });
  check("7.3 RH accepte → STATUT FINAL = ACCEPTEE", d7b.statut === "ACCEPTEE", "statut=" + d7b.statut);

  // ---------- Nettoyage ----------
  await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });
  console.log("\nNettoyage OK");

  console.log("\nRÉSULTAT : " + ok + " OK / " + fail + " FAIL");
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
