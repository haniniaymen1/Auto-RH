#!/usr/bin/env node
/**
 * v0.2.109 (Task 217) — PREUVE E2E « Accès portail : Matricule / E-mail /
 * Nom / Prénom » :
 *
 *   1) RÈGLES DE DÉCOUPAGE À L'IMPORTATION (demande utilisateur) — le nom
 *      complet des fiches de paie est DÉCOUPÉ automatiquement :
 *        - cas général : premier mot = Nom, mots suivants = Prénom
 *          (« Saidani Mohamed Amine » → Saidani / Mohamed Amine) ;
 *        - composés « Ben »/« Bel »/« Bou » : le composé appartient au Nom
 *          (« Ben Hnid Mohamed » → Ben Hnid / Mohamed ; « Bel Agha Mohamed
 *          Amine » → Bel Agha / Mohamed Amine ; « bou mnijel majdi » →
 *          bou mnijel / majdi).
 *      Vérifié via GET /api/payslips/employes (répertoire réellement
 *      consommé par le tableau Accès portail) sur 7 noms de test.
 *
 *   2) CRÉATION D'ACCÈS : les colonnes « Nom » / « Prénom » sont PRÉ-REMPLIES
 *      (persistées) à la création depuis le nom de référence des fiches.
 *
 *   3) NON-DESTRUCTION : une correction du RH (« modifier-nom ») N'EST PAS
 *      écrasée par un re-créer (branche update = comble seulement le vide).
 *
 *   4) CORRECTIF COLONNES : l'en-tête « Matricule » (manquant depuis la
 *      v0.2.107 — 8 en-têtes pour 9 cellules, les matricules s'affichaient
 *      sous « E-mail d'accès ») est rétabli ENTRE « Prénom » et « E-mail
 *      d'accès » — assertions sur les sources + comptage des colonnes.
 *
 * Nettoyage CIBLÉ en fin de run (fiches + accès de test uniquement).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const db = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };

const CINS = ["TEST21701", "TEST21702", "TEST21703", "TEST21704", "TEST21705", "TEST21706", "TEST21707"];
const FICHIERS = CINS.map((c) => `e2e-217-${c}.pdf`);

// Matrice de découpage (demande utilisateur, v0.2.109) :
const MATRICE = [
  { cin: "TEST21701", nomFiches: "Saidani Mohamed Amine", nom: "Saidani", prenom: "Mohamed Amine" }, // cas général
  { cin: "TEST21702", nomFiches: "Ben Hnid Mohamed", nom: "Ben Hnid", prenom: "Mohamed" }, // composé Ben
  { cin: "TEST21703", nomFiches: "Bel Agha Mohamed Amine", nom: "Bel Agha", prenom: "Mohamed Amine" }, // composé Bel
  { cin: "TEST21704", nomFiches: "bou mnijel majdi", nom: "bou mnijel", prenom: "majdi" }, // composé Bou (exemple utilisateur)
  { cin: "TEST21705", nomFiches: "BEN SALAH MOHAMED", nom: "BEN SALAH", prenom: "MOHAMED" }, // fiches en MAJUSCULES
  { cin: "TEST21706", nomFiches: "Mohamed Ben Salah", nom: "Ben Salah", prenom: "Mohamed" }, // composé EN FIN de nom
  { cin: "TEST21707", nomFiches: "Cherif", nom: "Cherif", prenom: null }, // mot unique
];

let ok = 0, ko = 0;
function verdict(label, condition, detail) {
  if (condition) { ok++; console.log(`   ✓ ${label}${detail ? " — " + detail : ""}`); }
  else { ko++; console.log(`   ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function client(base) {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(methode, p, corps) {
      const res = await fetch(base + p, {
        method: methode,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: corps ? JSON.stringify(corps) : undefined,
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      let data = null;
      try { data = await res.json(); } catch { /* pas du JSON */ }
      return { status: res.status, data };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
  };
}

async function main() {
  console.log("== v0.2.109 (Task 217) — preuve E2E : Accès portail (Matricule / E-mail / Nom / Prénom) ==");

  // ---------- PHASE 0 : nettoyage préalable + sémis ----------
  console.log("— PHASE 0 : nettoyage + sémis (7 fiches de test) —");
  const empreintes = CINS.map((c) => cryptoBd.chiffrerChamp(c, true));
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: { in: empreintes } } });
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: empreintes } } });

  await db.payslip.createMany({
    data: MATRICE.map((m) => ({
      fileName: `e2e-217-${m.cin}.pdf`,
      storedName: `e2e-217-${m.cin}.pdf`,
      fileSize: 100,
      content: "FICHE DE PAIE " + m.cin,
      normalizedContent: "FICHE DE PAIE " + m.cin,
      cin: cryptoBd.chiffrerChamp(m.cin),
      cinIndex: cryptoBd.chiffrerChamp(m.cin, true),
      employeeName: cryptoBd.chiffrerChamp(m.nomFiches),
      period: cryptoBd.chiffrerChamp("09/2026"),
      netSalary: cryptoBd.chiffrerChamp("1 000,00"),
    })),
  });
  verdict("Sémis : 7 fiches (noms de la matrice, aucun accès portail)", true);

  // ---------- PHASE 1 : connexion ----------
  console.log("— PHASE 1 : connexion administration —");
  const adm = client(BASE);
  // (MODIFIÉ Task 231 — indépendance de l'environnement) connexion via le COMPTE
  // DE TEST TEMPORAIRE (lab226/creer-compte-e2e-116) : le mot de passe du
  // SUPERADMIN RÉEL n'est pas connu des harnesses.
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const ADMIN_231 = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const login = await adm.post("/api/auth/login", { email: ADMIN_231.email, password: ADMIN_231.password, remember: false });
  verdict("Connexion superadmin", login.status === 200 && Boolean(adm.cookie), `HTTP ${login.status}`);

  // ---------- PHASE 2 : règles de découpage via le répertoire ----------
  console.log("— PHASE 2 : découpage automatique Nom / Prénom (GET /api/payslips/employes) —");
  const rep = await adm.get("/api/payslips/employes");
  verdict("GET /api/payslips/employes 200", rep.status === 200, `HTTP ${rep.status}`);
  const items = (rep.data && rep.data.items) || [];
  for (const m of MATRICE) {
    const it = items.find((x) => x.cin === m.cin);
    verdict(
      `« ${m.nomFiches} »`,
      Boolean(it)
        && it.nom === m.nom
        && (it.prenom ?? null) === m.prenom
        && it.nomComplet === m.nomFiches,
      it ? `→ Nom=${JSON.stringify(it.nom)} Prénom=${JSON.stringify(it.prenom)} complet=${JSON.stringify(it.nomComplet)}` : "CIN absent du répertoire"
    );
  }

  // ---------- PHASE 3 : création d'accès = colonnes pré-remplies ----------
  console.log("— PHASE 3 : création d'accès (pré-remplissage persistant) —");
  const cre1 = await adm.post("/api/portal-access", { action: "create", cin: "TEST21701" });
  verdict("Créer l'accès TEST21701", cre1.status === 200, `HTTP ${cre1.status}`);
  const cre4 = await adm.post("/api/portal-access", { action: "create", cin: "TEST21704" });
  verdict("Créer l'accès TEST21704", cre4.status === 200, `HTTP ${cre4.status}`);
  const liste1 = await adm.get("/api/portal-access");
  const rows1 = (liste1.data && liste1.data.items) || [];
  const r1 = rows1.find((x) => x.cin === "TEST21701");
  const r4 = rows1.find((x) => x.cin === "TEST21704");
  verdict(
    "TEST21701 pré-rempli depuis les fiches",
    Boolean(r1) && r1.nom === "Saidani" && r1.prenom === "Mohamed Amine",
    r1 ? `nom=${JSON.stringify(r1.nom)} prenom=${JSON.stringify(r1.prenom)}` : "absent"
  );
  verdict(
    "TEST21704 pré-rempli (composé Bou)",
    Boolean(r4) && r4.nom === "bou mnijel" && r4.prenom === "majdi",
    r4 ? `nom=${JSON.stringify(r4.nom)} prenom=${JSON.stringify(r4.prenom)}` : "absent"
  );

  // ---------- PHASE 4 : non-destruction d'une correction RH ----------
  console.log("— PHASE 4 : correction RH puis re-créer (ne doit PAS écraser) —");
  const mod = await adm.post("/api/portal-access", { action: "modifier-nom", cin: "TEST21701", nom: "Saidani Revu", prenom: "Amine Test" });
  verdict("modifier-nom accepté", mod.status === 200, `HTTP ${mod.status}`);
  const recree = await adm.post("/api/portal-access", { action: "create", cin: "TEST21701" });
  verdict("Re-créer l'accès (réinitialisation)", recree.status === 200, `HTTP ${recree.status}`);
  const liste2 = await adm.get("/api/portal-access");
  const r1b = ((liste2.data && liste2.data.items) || []).find((x) => x.cin === "TEST21701");
  verdict(
    "Correction RH conservée après re-créer",
    Boolean(r1b) && r1b.nom === "Saidani Revu" && r1b.prenom === "Amine Test",
    r1b ? `nom=${JSON.stringify(r1b.nom)} prenom=${JSON.stringify(r1b.prenom)}` : "absent"
  );

  // ---------- PHASE 5 : correctif colonnes (assertions sources) ----------
  console.log("— PHASE 5 : correctif colonnes du tableau (sources) —");
  const ui = fs.readFileSync(path.join(__dirname, "..", "src", "components", "payslip", "portal-access-tab.tsx"), "utf8");
  const tete = ui.slice(ui.indexOf("<thead"), ui.indexOf("</thead>"));
  // Extraction des libellés : position de CHAQUE « <th » puis texte jusqu'à « </th> ».
  const colonnes = [...tete.matchAll(/<th /g)].map((m) => {
    const debutTexte = tete.indexOf(">", m.index) + 1;
    return tete.slice(debutTexte, tete.indexOf("</th>", debutTexte)).replace(/&apos;/g, "'").trim();
  });
  verdict("9 en-têtes (comme les 9 cellules du corps)", colonnes.length === 9, colonnes.join(" | "));
  const iMat = colonnes.indexOf("Matricule");
  const iPrenom = colonnes.indexOf("Prénom");
  const iMail = colonnes.findIndex((c) => c.startsWith("E-mail"));
  verdict("« Matricule » est SA propre colonne, entre « Prénom » et « E-mail d'accès »", iMat === iPrenom + 1 && iMail === iMat + 1, `index ${iMat}`);
  const iStatut = colonnes.indexOf("Statut");
  verdict("« Statut » suit « E-mail d'accès » (fin du décalage)", iStatut === iMail + 1, `index ${iStatut}`);
  const helper = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "nom-employe.ts"), "utf8");
  verdict("Helper : composés Ben / Bel / Bou (mot seul, insensible à la casse)", /\/\^\(ben\|bel\|bou\)\$\/i\.test\(m\)/.test(helper));
  const apiEmp = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "payslips", "employes", "route.ts"), "utf8");
  verdict("Répertoire : applique separerNomPrenom + renvoie nomComplet", apiEmp.includes("separerNomPrenom") && apiEmp.includes("nomComplet"));
  const apiAcc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "portal-access", "route.ts"), "utf8");
  verdict("Création d'accès : pré-remplissage nom/prenom (jamais destructif)", apiAcc.includes("nomEmployeDepuisFiches") && apiAcc.includes("nomAuto") && apiAcc.includes("existant?.nom"));

  // ---------- PHASE 6 : nettoyage ciblé ----------
  console.log("— PHASE 6 : nettoyage ciblé —");
  await db.demandeAdministrative.deleteMany({ where: { cin: { in: empreintes } } });
  await db.portalAccess.deleteMany({ where: { cin: { in: empreintes } } });
  const supF = await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  verdict("Nettoyage (accès + fiches de test supprimées)", true, `${supF.count} fiche(s)`);

  console.log(`\n== RÉSULTAT : ${ok} OK / ${ko} KO ==`);
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/diag-nettoyage-116.cjs"], { stdio: "ignore" }); } catch {}
  process.exitCode = ko ? 1 : 0;
}

main()
  .catch((e) => { console.error("ERREUR FATALE:", e); process.exitCode = 2; })
  .finally(() => db.$disconnect());
