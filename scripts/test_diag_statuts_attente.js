#!/usr/bin/env node
/**
 * DIAGNOSTIC « les statuts des demandes restent en attente »
 * (trace 1a1170cd584864d5)
 *
 * Reproduce le parcours complet sur le serveur VIVANT (port 4000) :
 *   A. Création d'une demande CONGÉ (statut EN_ATTENTE, aucune décision).
 *   B. Décision RH « Acceptée » (cible par défaut) → MATRICE Task 181 :
 *      la demande DOIT rester EN_ATTENTE tant que le manager n'a pas décidé
 *      (decisionRh=ACCEPTEE tracé + enAttenteManager=true dans la réponse).
 *   C. Enregistrement de la décision MANAGER « Acceptée » (cible=manager)
 *      → la demande DOIT passer ACCEPTEE.
 *   D. Deuxième demande : refus RH direct → REFUSEE immédiat (refuseePar=RH).
 *   E. Nettoyage complet.
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
const CIN = "TS1a1170diag";
const REF = "DEM-2026-1170";

let ok = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log("  OK  " + label + (extra ? " — " + extra : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? " — " + extra : "")); }
}

async function login() {
  // Le superadmin de l'environnement restauré (Task 185).
  const essais = [
    { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" },
    { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif" },
  ];
  for (const body of essais) {
    const r = await fetch(ADMIN + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
      if (cookie) return cookie;
    }
  }
  throw new Error("Connexion superadmin impossible");
}

async function postDecision(cookie, id, body) {
  const r = await fetch(ADMIN + "/api/demandes/" + id, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function main() {
  console.log("== Diagnostic statuts demandes (matrice deux étapes) ==");
  await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });

  const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
  const base = {
    cin: cinIdx,
    destinataire: cryptoBd.chiffrerChamp("employe.diag1170@test.local"),
    employeEmail: cryptoBd.chiffrerChamp("employe.diag1170@test.local"),
  };
  const donneesConge = cryptoBd.chiffrerChamp(JSON.stringify({
    typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
    emailN1: "manager.diag1170@test.local",
  }));
  const d1 = await prisma.demandeAdministrative.create({
    data: { ...base, reference: REF + "-A", type: "CONGE", statut: "EN_ATTENTE", donnees: donneesConge },
  });
  const d2 = await prisma.demandeAdministrative.create({
    data: { ...base, reference: REF + "-B", type: "CONGE", statut: "EN_ATTENTE", donnees: donneesConge },
  });
  console.log("Demandes créées : " + d1.reference + " / " + d2.reference);

  const cookie = await login();
  console.log("Connexion superadmin : OK");

  // ---- B. Décision RH « Acceptée » seule ----
  let r = await postDecision(cookie, d1.id, { statut: "ACCEPTEE" });
  check("B1 décision RH acceptée → HTTP 200", r.status === 200, "http=" + r.status + (r.data?.error ? " err=" + r.data.error : ""));
  const apresRh = await prisma.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("B2 decisionRh tracé = ACCEPTEE", apresRh.decisionRh === "ACCEPTEE", "decisionRh=" + apresRh.decisionRh);
  check("B3 statut final reste EN_ATTENTE (manager pas encore décidé — MATRICE Task 181)", apresRh.statut === "EN_ATTENTE", "statut=" + apresRh.statut);
  check("B4 réponse signale enAttenteManager=true", r.data?.enAttenteManager === true, "enAttenteManager=" + r.data?.enAttenteManager);

  // ---- C. Décision MANAGER enregistrée (cible=manager) ----
  r = await postDecision(cookie, d1.id, { statut: "ACCEPTEE", cible: "manager" });
  check("C1 décision manager acceptée → HTTP 200", r.status === 200, "http=" + r.status + (r.data?.error ? " err=" + r.data.error : ""));
  const apresMgr = await prisma.demandeAdministrative.findUnique({ where: { id: d1.id } });
  check("C2 decisionManager tracé = ACCEPTEE", apresMgr.decisionManager === "ACCEPTEE", "decisionManager=" + apresMgr.decisionManager);
  check("C3 statut final = ACCEPTEE (matrice complète M+RH)", apresMgr.statut === "ACCEPTEE", "statut=" + apresMgr.statut);

  // ---- D. Refus RH direct = définitif ----
  r = await postDecision(cookie, d2.id, { statut: "REFUSEE" });
  check("D1 refus RH → HTTP 200", r.status === 200, "http=" + r.status + (r.data?.error ? " err=" + r.data.error : ""));
  const apresRefus = await prisma.demandeAdministrative.findUnique({ where: { id: d2.id } });
  check("D2 statut = REFUSEE immédiat", apresRefus.statut === "REFUSEE", "statut=" + apresRefus.statut);
  check("D3 refuseePar = RH", apresRefus.refuseePar === "RH", "refuseePar=" + apresRefus.refuseePar);

  // ---- E. Nettoyage ----
  await prisma.demandeAdministrative.deleteMany({ where: { reference: { startsWith: REF } } });
  console.log("Nettoyage OK");

  console.log("\nRÉSULTAT : " + ok + " OK / " + fail + " FAIL");
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
